import { PERMISSIONS, type Permission } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import type { AlertClosedPayload, AlertTarget, EventDraft, PosEvent } from '@pos/events';
import type Database from 'better-sqlite3';
import { readOnlyDb } from '../engine-host/read-only-tx.js';
import type { WriterTx } from '../engine-host/writer.js';
import type { StaffDirectory } from '../auth/staff-directory.js';
import type { HubDeps } from '../server.js';
import { kindOf, NO_APPROVER, PERSONAL_NOTICE_KINDS, registeredAlertKinds, stepAt, type AlertKind, type NoApproverValues } from './kinds.js';
import { alertDirectoryOf, alerts, draftOn, routeSteps, stepPayload, type RaiseInput, type StepItem } from './raise.js';
import { cachedPrepare } from './statements.js';
import { batchReads, stepTargets, type AlertRequestPart, type AlertRow } from './targets.js';

// 01d §3.5 "The tick" (A8, G1-16) and §4.2 `registerTick`: the hub's one tick loop (00 H-8 timers row).
// - Every TICK_MS a pass reads `now = clock.branchNow()` ONCE and gives it to every registered tick, in
//   registration order; 01d's `alerts` tick is registered first (here, at module load).
// - `due(db, state, now)` is the read-only pre-check, outside any transaction (it gets a read-only view of
//   the connection). Only when it is true does the tick get its OWN `writer.run`, in which `intents`
//   re-selects authoritatively (race rule) and its drafts are appended (D44 per tick).
// - `testHooks.betweenDueAndRun(name)` runs between the two (tests only, m11). Without it a pass has no
//   `await`, so it runs synchronously like any other writer caller.
// - Isolation: a throw in `due`, the hook or `intents` rolls back that tick only and is logged
//   `{ tick, err }` (pino's Error key, as AD-28); the other ticks of the pass still run.
// - Idle cost: nothing due → one indexed SELECT per registered tick (or none for a pure `due`), no transaction.
// Started after boot step 7 (F §5.8, lib/boot.ts) and stopped on close.

export const TICK_MS = 500;

/** §4.2 `registerTick` argument, exactly. */
export interface TickDef {
  name: string;
  due(db: Database.Database, state: Readonly<EngineState>, now: number): boolean;
  intents(tx: WriterTx, state: Readonly<EngineState>, now: number): EventDraft[];
}

export interface TickLog {
  error(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * §3.5 `alerts.due`: ONE statement on the `alerts_due` index and the `alert_flags` PK. Prepared per call (one
 * statement every TICK_MS) so it is counted like every other read.
 */
const ALERTS_DUE_SQL = `SELECT EXISTS (SELECT 1 FROM alerts WHERE state = 'open' AND next_due_at IS NOT NULL AND next_due_at <= ?)
    OR EXISTS (SELECT 1 FROM alert_flags WHERE dirty = 1) AS due`;

/** §3.5: at most this many due alerts per pass; the rest are due again on the next pass. */
export const TICK_DUE_LIMIT = 200;

/**
 * §3.5 `alerts.intents` read (1): the due alerts, INSIDE writer.run (after BEGIN IMMEDIATE), so it is
 * authoritative (race rule): an alert answered or closed since the pre-check is not selected.
 */
const DUE_ALERTS_SQL = `SELECT alert_id, kind, subject_stream_type, subject_stream_id, requester_staff_id, target_json, values_json,
         request_json, step, raised_at, expire_due
    FROM alerts
    WHERE state = 'open' AND next_due_at <= ?
    ORDER BY next_due_at LIMIT ${TICK_DUE_LIMIT}`;

interface DueRow {
  alert_id: string;
  kind: string;
  subject_stream_type: PosEvent['stream_type'];
  subject_stream_id: string;
  requester_staff_id: string | null;
  target_json: string;
  values_json: string;
  request_json: string | null;
  step: number;
  raised_at: number;
  expire_due: 0 | 1;
}

/** The tick's envelope (§4.2 tickCtx): no actor, device 'hub', occurred at the pass's `now`. */
const tickEnvelope = (now: number) => ({ now, actor_id: null, device_id: 'hub' });

/** Where the alerts tick logs a skipped alert; set by startTickLoop (the loop's own log). */
let alertsLog: TickLog | null = null;

/**
 * Task 28 fix (G1-16): one line per skipped alert (an unreadable row), with no values, no details and no
 * message text (a JSON.parse message can echo its input, §7): the error's name and code only.
 */
function logSkipped(alertId: string, kind: string, err: unknown): void {
  const e = err as { name?: unknown; code?: unknown } | null;
  alertsLog?.error(
    {
      tick: 'alerts',
      alert_id: alertId,
      kind,
      err: { name: typeof e?.name === 'string' ? e.name : 'unknown', code: typeof e?.code === 'string' ? e.code : null },
    },
    'alerts tick: alert skipped',
  );
}

type Plan = { subject: { stream_type: PosEvent['stream_type']; stream_id: string }; skipped: number[]; item: StepItem };

/**
 * The per-alert work of the step pass: parse the row and find the due steps. Steps are ordered, so the scan
 * stops at the first step that is not due yet; a step whose time or targets cannot be computed counts as not
 * due (a bad step 2 never blocks step 1). The `alerts` projection retires the alert when that step becomes
 * its next one (AD-123: next_due_at NULL, its one log line), so the tick never logs it and never selects it
 * again. Throws only for this alert (an unreadable row).
 */
function planOf(r: DueRow, kind: AlertKind, now: number): Plan | null {
  const row: AlertRow = {
    alert_id: r.alert_id,
    kind: r.kind,
    requester_staff_id: r.requester_staff_id,
    target: JSON.parse(r.target_json) as AlertTarget,
    values: JSON.parse(r.values_json) as Record<string, unknown>,
    request: r.request_json === null ? null : (JSON.parse(r.request_json) as AlertRequestPart),
    step: r.step,
    raised_at: r.raised_at,
  };
  const stepsDue: number[] = [];
  for (let index = row.step + 1; index < kind.steps.length; index += 1) {
    const step = kind.steps[index] as AlertKind['steps'][number];
    let at: number;
    try {
      at = stepAt(step, row);
      stepTargets(step, row); // from_value check: a step that cannot be routed is never sent
    } catch {
      break; // AD-123: the projection retires the alert (and logs it once) when this becomes its next step
    }
    if (at > now) break;
    stepsDue.push(index);
  }
  const latest = stepsDue.pop();
  if (latest === undefined) return null;
  return { subject: { stream_type: r.subject_stream_type, stream_id: r.subject_stream_id }, skipped: stepsDue, item: { row, kind, step: latest } };
}

/**
 * §3.5 expiry (task 29): is this due alert closed `expired` in this pass, instead of stepped?
 * - `expire_due` (day close, set by the projection on BusinessDayClosed for open non-request alerts of
 *   `expires_at_day_close` kinds) → yes.
 * - `closes_on.after_ms` reached (`now >= raised_at + after_ms`, M1) → yes, unless the alert is a request:
 *   requests never expire (§3.3 "No expiry for requests").
 * Reads only plain columns of the due row (no JSON, no step times), so a poisoned alert (task 28 guard)
 * still expires and is not skipped and logged on every pass forever.
 */
function expires(r: DueRow, kind: AlertKind | undefined, now: number): boolean {
  if (r.expire_due === 1) return true;
  if (kind === undefined || r.request_json !== null || typeof kind.closes_on !== 'object') return false;
  return now >= r.raised_at + kind.closes_on.after_ms;
}

/**
 * §3.5 step and expiry pass (tasks 28–29; the flag pass, flagIntents, is task 31). For each due alert, the steps whose
 * `at` has passed beyond the alert's current step: the latest is sent (`AttemptSent`, or `EscalationStepped`
 * for an `escalation: true` step) and each earlier one is `StepSkipped 'superseded'` (restart / tick lag,
 * G1-16b); none → nothing (clock rounding). An expiring alert is closed instead (`expires`, checked before
 * any step, so a step due at or after the expiry time is never sent). All due alerts are resolved and routed
 * in one batch (routeSteps: the fixed reads, the previous step's recipients (7), one call per resolver kind and
 * per registered route), so the statement count does not grow with the number of due alerts. A failed send is
 * not retried: the frames and route sends run once, after commit (ws-frames' hook), per step event.
 */
function stepIntents(tx: WriterTx, due: readonly DueRow[], now: number, closed: Set<string>): EventDraft[] {
  if (due.length === 0) return [];
  const env = tickEnvelope(now);
  // §3.5 expiry closes of this pass: their ids go into `closed` (the pseudocode's, m1), which the flag pass
  // skips. Each due row is one distinct alert, so each is closed at most once here. Written directly, not
  // through closeMany: 'expired' is not an owner reason, and the due row already holds what the draft needs.
  const closes: EventDraft[] = [];
  const plans: Plan[] = [];
  for (const r of due) {
    const kind = kindOf(r.kind);
    if (expires(r, kind, now)) {
      const p: AlertClosedPayload = { alert_id: r.alert_id, reason: 'expired', by_staff_id: null, note: null };
      closes.push(draftOn({ stream_type: r.subject_stream_type, stream_id: r.subject_stream_id }, env, 'AlertClosed', p));
      closed.add(r.alert_id);
      continue; // expiry, not a step: a step due at or after the expiry time is never sent
    }
    if (kind === undefined) continue; // P-8: never due (next_due_at NULL); kept for a row written before a rollback
    // Per-alert guard (task 28 fix, G1-16): an alert whose row cannot be read is skipped and logged; the
    // other alerts step normally in this same transaction. A step that cannot be computed is not this case:
    // planOf stops before it and the projection retires the alert (AD-123).
    try {
      const plan = planOf(r, kind, now);
      if (plan !== null) plans.push(plan);
    } catch (err) {
      logSkipped(r.alert_id, r.kind, err);
    }
  }
  if (plans.length === 0) return closes;
  const routed = routeSteps(
    tx,
    plans.map((p) => p.item),
    { previousStep: true, now },
  );
  const drafts: EventDraft[] = [...closes];
  plans.forEach((p, i) => {
    const { row, kind, step } = p.item;
    for (const skipped of p.skipped) {
      drafts.push(draftOn(p.subject, env, 'StepSkipped', { alert_id: row.alert_id, step: skipped, reason: 'superseded' }));
    }
    const type = kind.steps[step]?.escalation === true ? 'EscalationStepped' : 'AttemptSent';
    drafts.push(draftOn(p.subject, env, type, stepPayload(row.alert_id, step, routed[i] as (typeof routed)[number])));
  });
  return drafts;
}

// ------------------------------------------------------------------------------------------- flag pass

/** §3.5 read (2): the dirty flags (§3.9), inside the transaction. */
const DIRTY_FLAGS_SQL = `SELECT name FROM alert_flags WHERE dirty = 1`;

/**
 * The flag pass's one alert read: the open `no_approver` alerts and the open personal notices (BF-7), with the
 * person a notice is for (its raised target is `{ kind: 'person', staff_id }`, §3.10). One statement whatever
 * the number of rows (index `alerts_open_kind`).
 */
const FLAG_ALERTS_SQL = `SELECT alert_id, kind, dedupe_key, subject_stream_type, subject_stream_id, expire_due,
         json_extract(target_json, '$.staff_id') AS person
    FROM alerts
    WHERE state = 'open' AND kind IN (SELECT value FROM json_each(?))
    ORDER BY raised_at, raised_seq`;

/** §3.9: the tick clears the flag in the same transaction that evaluates it. */
const CLEAR_NO_APPROVER_SQL = `UPDATE alert_flags SET dirty = 0 WHERE name = 'no_approver'`;

const NO_APPROVER_PREFIX = 'no_approver:';

interface FlagRow {
  alert_id: string;
  kind: string;
  dedupe_key: string;
  subject_stream_type: PosEvent['stream_type'];
  subject_stream_id: string;
  expire_due: 0 | 1;
  person: string | null;
}

/**
 * §3.9, in memory from the directory and read (3): the permissions that some role grants with
 * `requires_approval` here (as resolved for a person who holds it: the same approver roles `mayAnswer` reads,
 * §3.3 rule 6) for which no person signed in anywhere holds one of the approver roles and, when a registered
 * approval kind gives the permission a `range_permission`, holds that permission `allowed` at branch scope.
 * Per permission only: the requester being the only approver signed in still counts (§12.4).
 */
function unapprovable(directory: StaffDirectory, signedIn: ReadonlySet<string>): Permission[] {
  const approverRoles = new Map<Permission, Set<string>>();
  for (const { staff_id } of directory.list()) {
    for (const permission of PERMISSIONS) {
      const r = directory.resolve(staff_id, permission);
      if (r.grant !== 'requires_approval') continue;
      const roles = approverRoles.get(permission) ?? new Set<string>();
      for (const role of r.approver_role_ids) roles.add(role);
      approverRoles.set(permission, roles);
    }
  }
  const ranges = new Map<string, Set<Permission>>();
  for (const kind of registeredAlertKinds()) {
    const right = kind.request?.right;
    if (right?.mode !== 'approval' || right.range_permission === undefined) continue;
    const set = ranges.get(right.base_permission) ?? new Set<Permission>();
    set.add(right.range_permission);
    ranges.set(right.base_permission, set);
  }
  const out: Permission[] = [];
  for (const [permission, roles] of approverRoles) {
    const range = [...(ranges.get(permission) ?? [])];
    const eligible = [...signedIn].some((staffId) => {
      const person = directory.get(staffId);
      if (person === undefined || !person.role_ids.some((role) => roles.has(role))) return false;
      return range.every((p) => {
        const r = directory.resolve(staffId, p);
        return r.grant === 'allowed' && r.scope === 'branch';
      });
    });
    if (!eligible) out.push(permission);
  }
  return out.sort();
}

/**
 * §3.5 flag pass (task 31), run when read (2) has `no_approver`:
 * - §3.9: while the business day is open, a `no_approver` alert is open per unapprovable permission; one that
 *   is no longer wanted (an approver signed in, the permission no longer needs approval, the day closed) is
 *   closed `done`; a missing one is raised (one `raiseMany`, its fixed reads cached from this transaction).
 * - BF-7 (AD-3 / P-7): the open personal notices of a person no longer in `staff` (removed, or moved to
 *   `no_pin_staff`) are closed `obsolete`.
 * - Alerts the expiry pass closed in this transaction (`closed`), and `no_approver` alerts marked `expire_due`
 *   by day close that the due read's LIMIT left for a later pass, are skipped (m1: one `AlertClosed 'expired'`).
 * - The flag is cleared in the same transaction (§3.9), so the next idle pass opens no transaction (#22).
 * Statements: the alert read 1, the fixed reads (cached when the step pass ran), the raise's dedupe 1 + T when
 * a warning is raised, and the flag write 1 — fixed, whatever the number of alerts or people.
 */
function flagIntents(tx: WriterTx, state: Readonly<EngineState>, now: number, closed: ReadonlySet<string>): EventDraft[] {
  const directory = alertDirectoryOf(tx);
  const reads = batchReads(tx, [], { previousStep: false }); // (3)–(6), (9): cached per transaction
  const signedIn = new Set(reads.sessions.map((s) => s.staff_id));
  const day = (state as Partial<EngineState>).business_day ?? null;
  const wanted = new Set<string>(day !== null && day.closed_at === null ? unapprovable(directory, signedIn) : []);
  const rows = cachedPrepare(tx.db, FLAG_ALERTS_SQL).all(JSON.stringify([NO_APPROVER.kind, ...PERSONAL_NOTICE_KINDS])) as FlagRow[];
  const env = tickEnvelope(now);
  const drafts: EventDraft[] = [];
  const close = (r: FlagRow, reason: 'done' | 'obsolete'): void => {
    const p: AlertClosedPayload = { alert_id: r.alert_id, reason, by_staff_id: null, note: null };
    drafts.push(draftOn({ stream_type: r.subject_stream_type, stream_id: r.subject_stream_id }, env, 'AlertClosed', p));
  };
  const open = new Set<string>();
  for (const r of rows) {
    if (closed.has(r.alert_id)) continue; // m1: expired in this pass
    if (r.kind === NO_APPROVER.kind) {
      // m1: marked by day close, it is expiry's to close `expired`, in this pass or a later one when the due
      // read's LIMIT 200 left it out of this pass's `due` (so it is not in `closed` either)
      if (r.expire_due === 1) continue;
      const permission = r.dedupe_key.startsWith(NO_APPROVER_PREFIX) ? r.dedupe_key.slice(NO_APPROVER_PREFIX.length) : r.dedupe_key;
      if (wanted.has(permission) && !open.has(permission)) open.add(permission);
      else close(r, 'done');
    } else if (r.person !== null && directory.get(r.person) === undefined) {
      close(r, 'obsolete'); // BF-7: the person is no longer in `staff`
    }
  }
  const inputs: RaiseInput[] = [...wanted]
    .filter((permission) => !open.has(permission))
    .map((permission) => {
      const values: NoApproverValues = { permission };
      return {
        kind: NO_APPROVER.kind,
        subject: { stream_type: 'hub', stream_id: tx.branchId },
        target: { kind: 'always_on' },
        values,
        display: { kind_label_key: NO_APPROVER.labels.lock },
        dedupe_key: NO_APPROVER_PREFIX + permission,
      };
    });
  if (inputs.length > 0) drafts.push(...alerts.raiseMany(alerts.tickCtx(tx, now), inputs).flatMap((r) => r.events));
  cachedPrepare(tx.db, CLEAR_NO_APPROVER_SQL).run();
  return drafts;
}

/** 01d's own tick (name `alerts`, first). `intents` is the §3.5 step / expiry / flag pass (tasks 28–31). */
export const alertsTick: TickDef = {
  name: 'alerts',
  due(db, _state, now) {
    return (db.prepare(ALERTS_DUE_SQL).get(now) as { due: number }).due === 1;
  },
  intents(tx, state, now) {
    const due = cachedPrepare(tx.db, DUE_ALERTS_SQL).all(now) as DueRow[]; // (1), AD-125
    const flags = (cachedPrepare(tx.db, DIRTY_FLAGS_SQL).all() as Array<{ name: string }>).map((f) => f.name); // (2)
    if (due.length === 0 && flags.length === 0) return []; // the hint was stale (closed or answered since the pre-check)
    const closed = new Set<string>();
    const drafts = stepIntents(tx, due, now, closed);
    if (flags.includes('no_approver')) drafts.push(...flagIntents(tx, state, now, closed));
    return drafts;
  },
};

const ticks: TickDef[] = [];

/** §4.2: registration order is the run order. A name registers once. */
export function registerTick(t: TickDef): void {
  if (ticks.some((registered) => registered.name === t.name)) throw new Error(`registerTick('${t.name}'): already registered`);
  ticks.push(t);
}

/** Tests only (fakes' `resetFakes`). Production never unregisters; 01d's own `alerts` tick cannot be. */
export function unregisterTick(name: string): void {
  if (name === alertsTick.name) throw new Error(`unregisterTick('${name}'): 01d's own tick`);
  const index = ticks.findIndex((t) => t.name === name);
  if (index !== -1) ticks.splice(index, 1);
}

/** Every registered tick, in run order. */
export function registeredTicks(): TickDef[] {
  return [...ticks];
}

registerTick(alertsTick);

/** One pass (§3.5 loop body). Never throws: each tick's failure is logged and the next tick runs. */
async function tickPass(deps: HubDeps, db: Database.Database, log: TickLog): Promise<void> {
  const now = deps.clock.branchNow();
  for (const t of [...ticks]) {
    try {
      if (!t.due(db, deps.state.get(), now)) continue;
      const hook = deps.testHooks?.betweenDueAndRun;
      if (hook !== undefined) await hook(t.name);
      deps.writer.run((tx) => tx.append(t.intents(tx, deps.state.get(), now)));
    } catch (err) {
      log.error({ tick: t.name, err }, 'tick failed');
    }
  }
}

/** Starts the loop (boot, after step 7); returns its stop. The interval does not keep the process alive. */
export function startTickLoop(deps: HubDeps, log: TickLog): () => void {
  const db = readOnlyDb(deps.db);
  alertsLog = log;
  const timer = setInterval(() => {
    void tickPass(deps, db, log);
  }, TICK_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return () => {
    clearInterval(timer);
  };
}
