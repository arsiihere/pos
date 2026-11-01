import type { EngineState } from '@pos/engine';
import type { AlertTarget, EventDraft, PosEvent } from '@pos/events';
import type Database from 'better-sqlite3';
import { readOnlyDb } from '../engine-host/read-only-tx.js';
import type { WriterTx } from '../engine-host/writer.js';
import type { HubDeps } from '../server.js';
import { kindOf, stepAt } from './kinds.js';
import { draftOn, routeSteps, stepPayload, type StepItem } from './raise.js';
import type { AlertRequestPart, AlertRow } from './targets.js';

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
         request_json, step, raised_at
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
}

/** The tick's envelope (§4.2 tickCtx): no actor, device 'hub', occurred at the pass's `now`. */
const tickEnvelope = (now: number) => ({ now, actor_id: null, device_id: 'hub' });

/**
 * §3.5 step pass (task 28; expiry is task 29, the flag pass task 31). For each due alert, the steps whose
 * `at` has passed beyond the alert's current step: the latest is sent (`AttemptSent`, or `EscalationStepped`
 * for an `escalation: true` step) and each earlier one is `StepSkipped 'superseded'` (restart / tick lag,
 * G1-16b); none → nothing (next_due_at was the expiry time). All due alerts are resolved and routed in one
 * batch (routeSteps: the fixed reads, the previous step's recipients (7), one call per resolver kind and per
 * registered route), so the statement count does not grow with the number of due alerts. A failed send is
 * not retried: the frames and route sends run once, after commit (ws-frames' hook), per step event.
 */
function stepIntents(tx: WriterTx, now: number): EventDraft[] {
  const due = tx.db.prepare(DUE_ALERTS_SQL).all(now) as DueRow[];
  if (due.length === 0) return []; // the hint was stale (closed or answered since the pre-check)
  const plans: Array<{ subject: { stream_type: PosEvent['stream_type']; stream_id: string }; skipped: number[]; item: StepItem }> = [];
  for (const r of due) {
    const kind = kindOf(r.kind);
    if (kind === undefined) continue; // P-8: never due (next_due_at NULL); kept for a row written before a rollback
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
    kind.steps.forEach((step, index) => {
      if (index > row.step && stepAt(step, row) <= now) stepsDue.push(index);
    });
    const latest = stepsDue.pop();
    if (latest === undefined) continue;
    plans.push({
      subject: { stream_type: r.subject_stream_type, stream_id: r.subject_stream_id },
      skipped: stepsDue,
      item: { row, kind, step: latest },
    });
  }
  if (plans.length === 0) return [];
  const routed = routeSteps(
    tx,
    plans.map((p) => p.item),
    { previousStep: true, now },
  );
  const env = tickEnvelope(now);
  const drafts: EventDraft[] = [];
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

/** 01d's own tick (name `alerts`, first). `intents` is the §3.5 step / expiry / flag pass (tasks 28–31). */
export const alertsTick: TickDef = {
  name: 'alerts',
  due(db, _state, now) {
    return (db.prepare(ALERTS_DUE_SQL).get(now) as { due: number }).due === 1;
  },
  intents(tx, _state, now) {
    return stepIntents(tx, now);
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
  const timer = setInterval(() => {
    void tickPass(deps, db, log);
  }, TICK_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return () => {
    clearInterval(timer);
  };
}
