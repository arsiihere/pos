import { DomainError } from '@pos/domain';
import type { AlertDetails, AlertDisplay, AlertRaisedPayload, AlertTarget, EventDraft, PosEvent } from '@pos/events';
import type Database from 'better-sqlite3';
import type { StaffDirectory } from '../auth/staff-directory.js';
import type { CommandCtx } from '../commands/registry.js';
import type { WriterTx } from '../engine-host/writer.js';
import type { WsHub } from '../ws/server.js';
import { kindOf, type AlertKind } from './kinds.js';
import { askRoutes, routeAsk, routeRecipients, type RouteRow } from './routes.js';
import { alertTxCache, batchReads, resolveStep, type AlertRequestPart, type AlertRow, type Recipient, type RecipientRow } from './targets.js';

// 01d §6.1 / §4.2 `alerts.raise` / `alerts.raiseMany`: pure on the transaction (the caller appends the
// drafts). Dedupe on (kind, dedupe_key) (open alert or a key returned earlier in this transaction), schema
// checks of values / details (§3.12), the request part, step 0 resolved and routed (§3.4), or the G1-9d
// shortcut for approval kinds whose step-0 answerers have no route (§3.5). Statements ≤ 6 + R + T
// (dedupe 1, the cached fixed reads 5, one call per resolver kind and per registered route); raiseMany
// costs the same as one raise. `ctx.permission` is never read (v0.4 m7). `details` is never logged (§7).

/** §4.2 `tickCtx(tx, now)` shape (built by task 19): a tick-raised alert has `raised_device_id = 'hub'`. */
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
  const env = envs.get(tx.db);
  if (env === undefined) throw new Error('alerts: env is not bound (registerAlerts)');
  return env;
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
  payload: AlertRaisedPayload;
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
  const ask = [...new Set(inputs.map((i) => dedupeKey(i.kind, i.dedupe_key)).filter((k) => !cache.keys.has(k)))];
  const open = new Map<string, { alert_id: string; requester_staff_id: string | null }>();
  if (ask.length > 0) {
    const rows = tx.db
      .prepare(
        `SELECT alert_id, kind, dedupe_key, requester_staff_id FROM alerts
         WHERE state = 'open' AND (kind, dedupe_key) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?))`,
      )
      .all(JSON.stringify(ask.map((k) => k.split('\u0000')))) as Array<{
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
    const payload: AlertRaisedPayload = {
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
      hidden_from: null,
      request,
    };
    const row: AlertRow = { alert_id, kind: kind.kind, requester_staff_id: requester, target: input.target, values: valuesOut, request, step: -1, raised_at: env.now };
    const esc = kind.request?.right.mode === 'approval' ? kind.steps.findIndex((s) => s.escalation === true) : -1;
    pending.push({ index, kind, input, row, payload, escalation: esc > 0 ? esc : null });
    fresh.set(key, { alert_id, requester_staff_id: requester });
  });

  if (pending.length > 0) {
    const { directory: directoryOf, ws: wsOf } = envOf(tx);
    const directory = 'actor' in ctx ? ctx.directory : directoryOf();
    const ws = wsOf();
    // §6.1 (6): reads for step 0 and, for approval kinds, the escalation step (one batch)
    const steps = new Map(pending.map((p) => [p.row.alert_id, p.escalation === null ? [0] : [0, p.escalation]]));
    const reads = batchReads(
      tx,
      pending.map((p) => p.row),
      { previousStep: false, steps },
    );
    const resolved = pending.map((p) => ({
      step0: resolveStep(p.kind.steps[0] as NonNullable<AlertKind['steps'][number]>, p.row, reads, directory, ws),
      escalation: p.escalation === null ? null : resolveStep(p.kind.steps[p.escalation] as AlertKind['steps'][number], p.row, reads, directory, ws),
    }));
    // §3.5 read (10): one routesFor call per registered route over every person of every step
    const asked: Array<{ recipients: readonly Recipient[]; kind: AlertKind }> = [];
    pending.forEach((p, i) => {
      const r = resolved[i] as (typeof resolved)[number];
      asked.push({ recipients: r.step0, kind: p.kind });
      if (r.escalation !== null) asked.push({ recipients: r.escalation, kind: p.kind });
    });
    reads.routes = askRoutes(tx, routeAsk(asked, reads, directory));

    pending.forEach((p, i) => {
      const r = resolved[i] as (typeof resolved)[number];
      const raised = draftOf(p.input, env, 'AlertRaised', p.payload);
      const step0 = routeRecipients(r.step0, p.kind, reads, directory, ws, env.now);
      let events: EventDraft[];
      if (p.escalation !== null && r.escalation !== null && !answererHasRoute(step0)) {
        // G1-9d shortcut (§3.5, v1.0 #4): skip every step before the first escalation step, send it now
        const esc = routeRecipients(r.escalation, p.kind, reads, directory, ws, env.now);
        events = [raised];
        for (let step = 0; step < p.escalation; step += 1) {
          events.push(draftOf(p.input, env, 'StepSkipped', { alert_id: p.row.alert_id, step, reason: 'shortcut' }));
        }
        events.push(draftOf(p.input, env, 'EscalationStepped', stepPayload(p.row.alert_id, p.escalation, esc)));
      } else {
        const type = p.kind.steps[0]?.escalation === true ? 'EscalationStepped' : 'AttemptSent';
        events = [raised, draftOf(p.input, env, type, stepPayload(p.row.alert_id, 0, step0))];
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

function stepPayload(alertId: string, step: number, routed: { recipients: RecipientRow[]; routes: RouteRow[] }): Record<string, unknown> {
  return { alert_id: alertId, step, recipients: routed.recipients, routes: routed.routes };
}

function draftOf(
  input: RaiseInput,
  env: { now: number; actor_id: string | null; device_id: string },
  eventType: string,
  payload: Record<string, unknown>,
): EventDraft {
  return {
    stream_type: input.subject.stream_type,
    stream_id: input.subject.stream_id,
    event_type: eventType,
    schema_version: 1,
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

/** §4.2: the 01d internal API for other modules (close, listOpen, … join in task 19). */
export const alerts = { raise, raiseMany };
