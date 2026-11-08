import { DomainError, OWNER_CLOSE_REASONS, type REQUEST_DECISIONS } from '@pos/domain';
import {
  latestVersion,
  type AlertClosedPayload,
  type AlertDetails,
  type AlertDisplay,
  type AlertRaisedPayloadV2,
  type AlertTarget,
  type EventDraft,
  type PosEvent,
} from '@pos/events';
import type Database from 'better-sqlite3';
import type { StaffDirectory } from '../auth/staff-directory.js';
import type { CommandCtx } from '../commands/registry.js';
import { rawDbOf } from '../engine-host/read-only-tx.js';
import type { WriterTx } from '../engine-host/writer.js';
import type { WsHub } from '../ws/server.js';
import { kindOf, type AlertKind, type AlertRecord, type RequestResultValues } from './kinds.js';
import { askRoutes, routeAsk, routeRecipients, type RouteRow } from './routes.js';
import { alertTxCache, batchReads, resolveStep, type AlertRequestPart, type AlertRow, type Recipient, type RecipientRow } from './targets.js';
import { recordReceipt } from './receipts.js';
import { cachedPrepare } from './statements.js';

// 01d §6.1 / §4.2 `alerts.raise` / `alerts.raiseMany`: pure on the transaction (the caller appends the
// drafts). Dedupe on (kind, dedupe_key) (open alert or a key returned earlier in this transaction), schema
// checks of values / details (§3.12), the request part, step 0 resolved and routed (§3.4), or the G1-9d
// shortcut for approval kinds whose step-0 answerers have no route (§3.5). Statements ≤ 6 + R + T
// (dedupe 1, the cached fixed reads 5, one call per resolver kind and per registered route); raiseMany
// costs the same as one raise. `ctx.permission` is never read (v0.4 m7). `details` is never logged (§7).

/** §4.2 `tickCtx(tx, now)` shape: a tick-raised alert has `raised_device_id = 'hub'`. */
export interface TickCtx {
  tx: WriterTx;
  now: number;
  actor_id: null;
  device_id: 'hub';
  session: null;
  permission: null;
}

/** A command handler's ctx, or a tick's. */
export type AlertCtx = CommandCtx | TickCtx;

/** §4.2, exactly. */
export interface RaiseInput {
  kind: string;
  subject: { stream_type: PosEvent['stream_type']; stream_id: string };
  target: AlertTarget;
  values?: Record<string, unknown>;
  display: AlertDisplay;
  details?: AlertDetails;
  dedupe_key: string;
  requester_staff_id?: string | null;
  request?: { approver_role_ids?: string[]; receiver_staff_id?: string };
  /**
   * 01d §3.10 (v1.0 #2, R2): the seat a personal notice is hidden from (`AlertRaised.hidden_from`): the
   * session and device that sent the answer or the PIN. Omitted or null → not hidden. Internal to 01d's
   * personal notices (pin_use_failed, approval_receipt, answered_on_requester_device).
   */
  hidden_from?: { session_id: string; device_id: string } | null;
}

export interface RaiseResult {
  alert_id: string;
  events: EventDraft[];
  deduped: boolean;
  requester_staff_id: string | null;
}

/** What raise needs beyond the transaction: the hub's directory and socket lists (in memory, no statement). */
export interface AlertEnv {
  directory(): StaffDirectory;
  ws(): WsHub;
}

const envs = new WeakMap<Database.Database, AlertEnv>();

/** Bound once per hub database by `registerAlerts` (tests bind a fake WsHub). */
export function bindAlertEnv(db: Database.Database, env: AlertEnv): void {
  envs.set(db, env);
}

function envOf(tx: WriterTx): AlertEnv {
  // keyed by the connection, also through a readOnlyTx view (prepare / preRead); reads still use tx.db
  const env = envs.get(rawDbOf(tx.db));
  if (env === undefined) throw new Error('alerts: env is not bound (registerAlerts)');
  return env;
}

/** The hub's directory for a tick transaction (the flag pass, §3.9), in memory, no statement. */
export function alertDirectoryOf(tx: WriterTx): StaffDirectory {
  return envOf(tx).directory();
}

/** The envelope facts of a raise; `'actor' in ctx` tells a command ctx from a tick ctx (no getter is read). */
function envelopeOf(ctx: AlertCtx): { now: number; actor_id: string | null; device_id: string } {
  if ('actor' in ctx) return { now: ctx.clock.branchNow(), actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
  return { now: ctx.now, actor_id: ctx.actor_id, device_id: ctx.device_id };
}

const dedupeKey = (kind: string, key: string): string => `${kind}\u0000${key}`;

function kindFor(name: string): AlertKind {
  const kind = kindOf(name);
  if (kind === undefined) throw new Error(`alerts.raise: kind '${name}' is not registered`);
  return kind;
}

function invalid(issue: 'values_invalid' | 'details_invalid', kind: string, paths: PropertyKey[][]): DomainError {
  // paths only: never the values (§7)
  return new DomainError('VALIDATION_FAILED', { issue, kind, fields: paths.map((path) => path.map(String).join('.')) });
}

/** §6.1 (5): the request part as stored (`AlertRaised.request`). */
function requestPart(kind: AlertKind, input: RaiseInput): AlertRequestPart | null {
  const request = kind.request;
  if (request === null) return null;
  const base = { answers: [...request.answers], needs_pin: request.needs_pin };
  if (request.right.mode === 'approval') {
    const roles = input.request?.approver_role_ids;
    if (roles === undefined) throw new Error(`alerts.raise('${kind.kind}'): request.approver_role_ids is required for an approval kind`);
    return {
      ...base,
      right_mode: 'approval',
      base_permission: request.right.base_permission,
      range_permission: request.right.range_permission ?? null,
      approver_role_ids: [...roles],
      receiver_staff_id: null,
    };
  }
  const receiver = input.request?.receiver_staff_id;
  if (receiver === undefined || receiver === '') throw new Error(`alerts.raise('${kind.kind}'): request.receiver_staff_id is required for a named kind`);
  return { ...base, right_mode: 'named', base_permission: null, range_permission: null, approver_role_ids: [], receiver_staff_id: receiver };
}

interface Pending {
  index: number;
  kind: AlertKind;
  input: RaiseInput;
  row: AlertRow;
  payload: AlertRaisedPayloadV2;
  /** the G1-9d candidate: the kind's first escalation step, for approval kinds */
  escalation: number | null;
}

/** §4.2 `alerts.raiseMany`: one dedupe statement, the cached fixed reads, one call per resolver and route. */
function raiseMany(ctx: AlertCtx, inputs: readonly RaiseInput[]): RaiseResult[] {
  const tx = ctx.tx;
  const cache = alertTxCache(tx);
  const kinds = inputs.map((input) => kindFor(input.kind)); // §6.1 (1)
  const env = envelopeOf(ctx);

  // §6.1 (2): open (kind, key) in one statement, unless this transaction returned the key already
  const ask = new Map<string, [string, string]>();
  for (const i of inputs) {
    const k = dedupeKey(i.kind, i.dedupe_key);
    if (!cache.keys.has(k)) ask.set(k, [i.kind, i.dedupe_key]);
  }
  const open = new Map<string, { alert_id: string; requester_staff_id: string | null }>();
  if (ask.size > 0) {
    const rows = cachedPrepare(
      tx.db,
      `SELECT alert_id, kind, dedupe_key, requester_staff_id FROM alerts
       WHERE state = 'open' AND (kind, dedupe_key) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?))`,
    ).all(JSON.stringify([...ask.values()])) as Array<{
      alert_id: string;
      kind: string;
      dedupe_key: string;
      requester_staff_id: string | null;
    }>;
    for (const row of rows) open.set(dedupeKey(row.kind, row.dedupe_key), { alert_id: row.alert_id, requester_staff_id: row.requester_staff_id });
  }

  const results: Array<RaiseResult | null> = inputs.map(() => null);
  const pending: Pending[] = [];
  // keys of this call; kept in the transaction's map only once the whole call returns (a throw keeps none)
  const fresh = new Map<string, { alert_id: string; requester_staff_id: string | null }>();
  inputs.forEach((input, index) => {
    const kind = kinds[index] as AlertKind;
    const key = dedupeKey(input.kind, input.dedupe_key);
    const hit = cache.keys.get(key) ?? fresh.get(key) ?? open.get(key);
    if (hit !== undefined) {
      results[index] = { alert_id: hit.alert_id, events: [], deduped: true, requester_staff_id: hit.requester_staff_id };
      return;
    }
    // §6.1 (3)
    const values = kind.values_schema.safeParse(input.values ?? {});
    if (!values.success) throw invalid('values_invalid', kind.kind, values.error.issues.map((i) => i.path));
    let details: AlertDetails | null = null;
    if (kind.details_schema === null) {
      if (input.details !== undefined) throw invalid('details_invalid', kind.kind, []);
    } else {
      const parsed = kind.details_schema.safeParse(input.details);
      if (!parsed.success) throw invalid('details_invalid', kind.kind, parsed.error.issues.map((i) => i.path));
      details = parsed.data as AlertDetails;
    }
    if (kind.steps[0] === undefined) throw new Error(`alerts.raise('${kind.kind}'): the kind has no step 0`);
    // §6.1 (4), (5)
    const alert_id = tx.ids.next();
    const request = requestPart(kind, input);
    const requester = input.requester_staff_id ?? null;
    const valuesOut = values.data as Record<string, unknown>;
    const payload: AlertRaisedPayloadV2 = {
      alert_id,
      kind: kind.kind,
      family: kind.family,
      subject_stream_type: input.subject.stream_type,
      subject_stream_id: input.subject.stream_id,
      dedupe_key: input.dedupe_key,
      requester_staff_id: requester,
      target: input.target,
      values: valuesOut,
      display: input.display,
      details,
      hidden_from: input.hidden_from == null ? null : { session_id: input.hidden_from.session_id, device_id: input.hidden_from.device_id },
      request,
    };
    const row: AlertRow = { alert_id, kind: kind.kind, requester_staff_id: requester, target: input.target, values: valuesOut, request, step: -1, raised_at: env.now };
    const esc = kind.request?.right.mode === 'approval' ? kind.steps.findIndex((s) => s.escalation === true) : -1;
    pending.push({ index, kind, input, row, payload, escalation: esc > 0 ? esc : null });
    fresh.set(key, { alert_id, requester_staff_id: requester });
  });

  if (pending.length > 0) {
    const directory = 'actor' in ctx ? ctx.directory : envOf(tx).directory();
    // §6.1 (6): step 0 and, for approval kinds, the escalation step, resolved and routed in one batch
    const items: StepItem[] = [];
    for (const p of pending) {
      items.push({ row: p.row, kind: p.kind, step: 0 });
      if (p.escalation !== null) items.push({ row: p.row, kind: p.kind, step: p.escalation });
    }
    const routed = routeSteps(tx, items, { previousStep: false, now: env.now, directory });
    let next = 0;
    const resolved = pending.map((p) => {
      const step0 = routed[next++] as RoutedStep;
      return { step0, escalation: p.escalation === null ? null : (routed[next++] as RoutedStep) };
    });

    pending.forEach((p, i) => {
      const r = resolved[i] as (typeof resolved)[number];
      const raised = draftOf(p.input, env, 'AlertRaised', p.payload);
      let events: EventDraft[];
      if (p.escalation !== null && r.escalation !== null && !answererHasRoute(r.step0)) {
        // G1-9d shortcut (§3.5, v1.0 #4): skip every step before the first escalation step, send it now
        events = [raised];
        for (let step = 0; step < p.escalation; step += 1) {
          events.push(draftOf(p.input, env, 'StepSkipped', { alert_id: p.row.alert_id, step, reason: 'shortcut' }));
        }
        events.push(draftOf(p.input, env, 'EscalationStepped', stepPayload(p.row.alert_id, p.escalation, r.escalation)));
      } else {
        const type = p.kind.steps[0]?.escalation === true ? 'EscalationStepped' : 'AttemptSent';
        events = [raised, draftOf(p.input, env, type, stepPayload(p.row.alert_id, 0, r.step0))];
      }
      results[p.index] = { alert_id: p.row.alert_id, events, deduped: false, requester_staff_id: p.row.requester_staff_id };
    });
  }
  for (const [key, value] of fresh) cache.keys.set(key, value);
  return results as RaiseResult[];
}

/** G1-9d: some step-0 answerer row has a route (from routeRecipients only: rows + no_route). */
function answererHasRoute(step: { recipients: RecipientRow[]; no_route: string[] }): boolean {
  const none = new Set(step.no_route);
  return step.recipients.some((r) => r.set === 'answerer' && r.staff_id !== null && r.for_staff_id === null && !none.has(r.staff_id));
}

/** One step of one alert to resolve and route (raise: step 0 / the G1-9d escalation step; the tick: the latest due step). */
export interface StepItem {
  row: AlertRow;
  kind: AlertKind;
  step: number;
}

/** A routed step: its recipient rows, route rows and the person recipients with no route (§3.4.3). */
export type RoutedStep = ReturnType<typeof routeRecipients>;

/**
 * §3.4 / §3.5 "Reads per tick", shared by raise and the tick: every item's step resolved and routed in ONE
 * batch — `batchReads` (the cached fixed reads, (7) when `previousStep`, one call per resolver kind), then
 * one `routesFor` per registered route over every person of every item (read 10). The rest is in memory.
 * Results are in `items` order. `directory` defaults to the hub's (a command passes its own ctx.directory).
 */
export function routeSteps(
  tx: WriterTx,
  items: readonly StepItem[],
  o: { previousStep: boolean; now: number; directory?: StaffDirectory },
): RoutedStep[] {
  if (items.length === 0) return [];
  const env = envOf(tx);
  const directory = o.directory ?? env.directory();
  const ws = env.ws();
  const rows = new Map<string, AlertRow>();
  const steps = new Map<string, number[]>();
  for (const item of items) {
    rows.set(item.row.alert_id, item.row);
    steps.set(item.row.alert_id, [...(steps.get(item.row.alert_id) ?? []), item.step]);
  }
  const reads = batchReads(tx, [...rows.values()], { previousStep: o.previousStep, steps });
  const resolved = items.map((item) => {
    const step = item.kind.steps[item.step];
    if (step === undefined) throw new Error(`alerts: kind '${item.kind.kind}' has no step ${item.step}`);
    return resolveStep(step, item.row, reads, directory, ws);
  });
  reads.routes = askRoutes(
    tx,
    routeAsk(
      items.map((item, i) => ({ recipients: resolved[i] as Recipient[], kind: item.kind })),
      reads,
      directory,
    ),
  );
  return items.map((item, i) => routeRecipients(resolved[i] as Recipient[], item.kind, reads, directory, ws, o.now));
}

/** A step event payload (AttemptSent / EscalationStepped, §4.2). */
export function stepPayload(alertId: string, step: number, routed: { recipients: RecipientRow[]; routes: RouteRow[] }): Record<string, unknown> {
  return { alert_id: alertId, step, recipients: routed.recipients, routes: routed.routes };
}

function draftOf(
  input: RaiseInput,
  env: { now: number; actor_id: string | null; device_id: string },
  eventType: string,
  payload: Record<string, unknown>,
): EventDraft {
  return draftOn(input.subject, env, eventType, payload);
}

/** An event draft on the alert's subject with the raise / tick envelope (tick: actor_id null, device_id 'hub'). */
export function draftOn(
  subject: RaiseInput['subject'],
  env: { now: number; actor_id: string | null; device_id: string },
  eventType: string,
  payload: Record<string, unknown>,
): EventDraft {
  return {
    stream_type: subject.stream_type,
    stream_id: subject.stream_id,
    event_type: eventType,
    // 01d v1.1.2 D-2: each event at its latest version (AlertRaised v2; every other alert event is v1).
    schema_version: latestVersion(eventType),
    payload,
    occurred_at: env.now,
    actor_id: env.actor_id,
    device_id: env.device_id,
  };
}

/** §4.2 `alerts.raise`. */
function raise(ctx: AlertCtx, input: RaiseInput): RaiseResult {
  return raiseMany(ctx, [input])[0] as RaiseResult;
}

// ----------------------------------------------------------------------------------------------- close

export type OwnerCloseReason = (typeof OWNER_CLOSE_REASONS)[number];
type RequestDecision = (typeof REQUEST_DECISIONS)[number];

/** §4.2 `closeMany` item. */
export interface CloseItem {
  alert_id: string;
  reason: OwnerCloseReason;
  note?: string;
}

/** Alert ids `close` / `closeMany` returned an AlertClosed draft for in this transaction (appended or not). */
const closedInTx = new WeakMap<WriterTx, Set<string>>();

/** The facts of the request a `request_result` is about (§3.10). */
export interface ResultOf {
  alert_id: string;
  kind: string;
  subject: RaiseInput['subject'];
  requester_staff_id: string;
  display: AlertDisplay;
}

/**
 * §3.10 `request_result` input: to the requester, on the request's subject, with the request's lock-safe
 * display; the decision and answerer (answer) or the closer and reason (close) as values, the closer's note
 * as signed-in-only `details.reason` (§3.12, at most 200 characters; the full note stays on AlertClosed).
 */
export function requestResultInput(
  request: ResultOf,
  outcome: { close_reason: RequestResultValues['close_reason']; decision: RequestDecision | null; by_staff_id: string | null; note?: string | null },
): RaiseInput {
  const values: RequestResultValues = {
    request_alert_id: request.alert_id,
    request_kind: request.kind,
    close_reason: outcome.close_reason,
    decision: outcome.decision,
    by_staff_id: outcome.by_staff_id,
  };
  const note = outcome.note ?? null;
  return {
    kind: 'request_result',
    subject: request.subject,
    target: { kind: 'person', staff_id: request.requester_staff_id },
    values,
    display: request.display,
    details: note === null || note === '' ? {} : { reason: note.slice(0, 200) },
    dedupe_key: `request_result:${request.alert_id}`,
  };
}

interface CloseRow {
  alert_id: string;
  kind: string;
  state: 'open' | 'closed';
  subject_stream_type: PosEvent['stream_type'];
  subject_stream_id: string;
  requester_staff_id: string | null;
  display_json: string;
  is_request: 0 | 1;
}

/** §6.1 close / §4.2 `closeMany`: one alert read for every id and one `raiseMany` for the request_result raises. */
function closeMany(ctx: AlertCtx, items: readonly CloseItem[]): EventDraft[] {
  for (const item of items) {
    if (!(OWNER_CLOSE_REASONS as readonly string[]).includes(item.reason)) {
      throw new Error(`alerts.close: reason '${String(item.reason)}' is not an owner close reason`);
    }
  }
  const tx = ctx.tx;
  const done = closedInTx.get(tx) ?? new Set<string>();
  // a closed alert, one closed earlier in this transaction, or a repeated id → no events (§3.3)
  const wanted: CloseItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (done.has(item.alert_id) || seen.has(item.alert_id)) continue;
    seen.add(item.alert_id);
    wanted.push(item);
  }
  if (wanted.length === 0) return [];

  const rows = cachedPrepare(
    tx.db,
    `SELECT alert_id, kind, state, subject_stream_type, subject_stream_id, requester_staff_id, display_json,
            request_json IS NOT NULL AS is_request
     FROM alerts WHERE alert_id IN (SELECT value FROM json_each(?))`,
  ).all(JSON.stringify(wanted.map((i) => i.alert_id))) as CloseRow[];
  const byId = new Map(rows.map((r) => [r.alert_id, r]));

  const env = envelopeOf(ctx);
  const by = env.actor_id;
  const closes: Array<{ id: string; closed: EventDraft; result: number | null }> = [];
  const results: RaiseInput[] = [];
  for (const item of wanted) {
    const row = byId.get(item.alert_id);
    // gone (retention deletes closed alerts only) or closed already: whoever committed first won (§3.3)
    if (row === undefined || row.state !== 'open') continue;
    const subject = { stream_type: row.subject_stream_type, stream_id: row.subject_stream_id };
    const payload: AlertClosedPayload = { alert_id: row.alert_id, reason: item.reason, by_staff_id: by, note: item.note ?? null };
    const closed = draftOn(subject, env, 'AlertClosed', payload);
    let result: number | null = null;
    if (row.is_request === 1 && row.requester_staff_id !== null && (item.reason === 'obsolete' || item.reason === 'overridden')) {
      result = results.length;
      results.push(
        requestResultInput(
          { alert_id: row.alert_id, kind: row.kind, subject, requester_staff_id: row.requester_staff_id, display: JSON.parse(row.display_json) as AlertDisplay },
          { close_reason: item.reason, decision: null, by_staff_id: by, note: item.note ?? null },
        ),
      );
    }
    closes.push({ id: row.alert_id, closed, result });
  }
  // through the exported object, so callers (and tests) see the one batched raise
  const raised = results.length === 0 ? [] : alerts.raiseMany(ctx, results);
  const events: EventDraft[] = [];
  for (const c of closes) {
    events.push(c.closed);
    if (c.result !== null) events.push(...(raised[c.result] as RaiseResult).events);
  }
  for (const c of closes) done.add(c.id);
  closedInTx.set(tx, done);
  return events;
}

/** §4.2 `alerts.close`: `[AlertClosed]` (+ request_result for a request closed obsolete / overridden); closed → []. */
function close(ctx: AlertCtx, alertId: string, reason: OwnerCloseReason, note?: string): EventDraft[] {
  return closeMany(ctx, [note === undefined ? { alert_id: alertId, reason } : { alert_id: alertId, reason, note }]);
}

// ------------------------------------------------------------------------------------------------ reads

interface RecordRow {
  alert_id: string;
  kind: string;
  family: AlertRecord['family'];
  subject_stream_type: string;
  subject_stream_id: string;
  dedupe_key: string;
  requester_staff_id: string | null;
  receiver_staff_id: string | null;
  raised_device_id: string;
  values_json: string;
  display_json: string;
  details_json: string | null;
  step: number;
  raised_at: number;
}

/**
 * §4.2 `alerts.listOpen`: open alerts as AlertRecord, oldest first (raised_at, then log order), 1 statement
 * (`alerts_open_kind` when `kind` is given). For requests 01d never auto-closes (§3.3, M8).
 */
function listOpen(db: Database.Database, o: { kind?: string; subject?: { stream_type: string; stream_id: string } }): AlertRecord[] {
  const where = [`state = 'open'`];
  const args: string[] = [];
  if (o.kind !== undefined) {
    where.push('kind = ?');
    args.push(o.kind);
  }
  if (o.subject !== undefined) {
    where.push('subject_stream_type = ? AND subject_stream_id = ?');
    args.push(o.subject.stream_type, o.subject.stream_id);
  }
  const rows = db
    .prepare(
      `SELECT alert_id, kind, family, subject_stream_type, subject_stream_id, dedupe_key, requester_staff_id,
              json_extract(request_json, '$.receiver_staff_id') AS receiver_staff_id, raised_device_id,
              values_json, display_json, details_json, step, raised_at
       FROM alerts WHERE ${where.join(' AND ')} ORDER BY raised_at, raised_seq`,
    )
    .all(...args) as RecordRow[];
  return rows.map((r) => ({
    alert_id: r.alert_id,
    kind: r.kind,
    family: r.family,
    subject: { stream_type: r.subject_stream_type, stream_id: r.subject_stream_id },
    dedupe_key: r.dedupe_key,
    requester_staff_id: r.requester_staff_id,
    receiver_staff_id: r.receiver_staff_id,
    raised_device_id: r.raised_device_id,
    values: JSON.parse(r.values_json) as Record<string, unknown>,
    display: JSON.parse(r.display_json) as AlertDisplay,
    details: r.details_json === null ? null : (JSON.parse(r.details_json) as AlertDetails),
    step: r.step,
    raised_at: r.raised_at,
  }));
}

/** §4.2 `alerts.byDedupeKey`: the open alert's id for (kind, key), or null; 1 statement (`alerts_open_dedupe`). */
function byDedupeKey(db: Database.Database, kind: string, key: string): string | null {
  const hit = db.prepare(`SELECT alert_id FROM alerts WHERE state = 'open' AND kind = ? AND dedupe_key = ?`).get(kind, key) as
    | { alert_id: string }
    | undefined;
  return hit?.alert_id ?? null;
}

/** §4.2 `alerts.tickCtx`: the ctx a registered tick passes to raise / raiseMany / close / closeMany (v1.0 #5). */
function tickCtx(tx: WriterTx, now: number): TickCtx {
  return { tx, now, actor_id: null, device_id: 'hub', session: null, permission: null };
}

/** §4.2: the 01d internal API for other modules. */
export const alerts = { raise, raiseMany, close, closeMany, listOpen, byDedupeKey, tickCtx, recordReceipt };
