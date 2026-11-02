import {
  AlertCardSchema,
  AlertDetailsBase,
  AlertLockSchema,
  AlertViewSchema,
  WsAlertClosed,
  WsAlertSeen,
  type AlertDetails,
  type AlertDisplay,
  type AlertLock,
  type AlertView,
  type RequestOutcome,
  type AttemptSentPayload,
  type PosEvent,
  type RequestSeenPayload,
  type WsServerMessage,
} from '@pos/events';
import { DomainError } from '@pos/domain';
import type Database from 'better-sqlite3';
import { z, ZodError } from 'zod';
import type { StaffDirectory } from '../auth/staff-directory.js';
import type { ConnectedSession, WsHub } from '../ws/server.js';
import { kindOf, REQUEST_RESULT, type AlertKind } from './kinds.js';
import { registeredRoutes } from './routes.js';
import { mayAnswer, type AlertRequestPart } from './targets.js';
import { cachedPrepare } from './statements.js';

// 01d §6 batch 3 / §3.6 / §3.12: the alert frames (`alert`, `alert_closed`, `alert_seen`), sent from the
// writer's after-commit hook only (never on rollback), once per step per socket, not part of the seq stream.
// - `card` (display + details) only under the one card rule (cardRule, AD-162 / AD-163): a person recipient's
//   own row, or a viewer who may answer the request now, on that person's own staff-session sockets.
//   Read-only rows (informed, a lead's "for" row, a right removed) get `lock`.
// - `lock` only everywhere else: alert-mode sockets, and every socket of a device-target recipient,
//   whatever its session kind (a KDS station socket, a signed-in kiosk's cashier socket).
// - Hidden from the answering seat: no `alert` frame to `hidden_session_id` or any socket of `hidden_device_id`.
// Every outgoing frame is parsed with a strict schema here, so a stray `card` / `details` (or any unknown
// key, e.g. AD-23's answer fields) on a lock path throws instead of leaving the hub (§7).
// Statements: step frames 1 read, `alert_closed` 1 read, `alert_seen` 1 read, each per transaction.
// Logs carry alert ids, kinds, step numbers and error codes only, never card text or details (§7).

const StrictLock = AlertLockSchema.strict();
const StrictCard = AlertCardSchema.extend({ details: AlertDetailsBase.strict().nullable() }).strict();
// Built from the named lock-safe view fields (pick, not omit): a field later added to the signed-in view
// (AD-23's answers / needs_pin / silent) stays refused here (AD-81). AD-82's `outcome` is lock-safe.
/** The lock-only view (alert-mode sockets, device-target sockets, routes, a station's catch-up rows). */
export const StrictLockView = AlertViewSchema.pick({
  alert_id: true,
  kind: true,
  family: true,
  step: true,
  escalation: true,
  set: true,
  for_staff_id: true,
  raised_at: true,
  outcome: true,
})
  .extend({ lock: StrictLock })
  .strict();
/** The signed-in view (the person's own staff sockets, inbox, catch-up): card with details and the AD-23 fields. */
export const StrictCardView = AlertViewSchema.extend({ lock: StrictLock, card: StrictCard }).strict();
const LockAlertFrame = z.object({ type: z.literal('alert'), alert: StrictLockView }).strict();
const CardAlertFrame = z.object({ type: z.literal('alert'), alert: StrictCardView }).strict();
const SeenFrame = WsAlertSeen.strict();
const ClosedFrame = WsAlertClosed.strict();

const REQUEST_RESULT_KIND = REQUEST_RESULT.kind;

const STEP_EVENTS: ReadonlySet<string> = new Set(['AttemptSent', 'EscalationStepped']);
const CLOSE_EVENTS: ReadonlySet<string> = new Set(['AlertClosed', 'RequestAnswered', 'RequestWithdrawn']);

export interface FramesLog {
  error(obj: Record<string, unknown>, msg: string): void;
}

/** What the frames need: the hub database (read after commit), its socket hub and directory, a log. */
export interface FramesEnv {
  db: Database.Database;
  ws(): WsHub;
  directory(): StaffDirectory;
  log: FramesLog;
}

/** Plan Interfaces `ws-frames.ts`, as methods of the hub's instance (one per hub, from registerAlerts). */
export interface AlertFrames {
  /** The writer's after-commit hook: step, close and seen frames for one committed transaction. */
  afterCommit(appended: PosEvent[]): void;
  sendStepFrames(appended: PosEvent[]): void;
  sendCloseFrames(alertIds: string[]): void;
  sendSeenFrames(staffId: string, alertId: string): void;
}

interface StepAlertRow extends ViewRow {
  requester_staff_id: string | null;
  hidden_session_id: string | null;
  hidden_device_id: string | null;
}

interface CloseAlertRow {
  alert_id: string;
  state: 'open' | 'closed';
  close_reason: z.infer<typeof WsAlertClosed>['reason'] | null;
  decision: z.infer<typeof WsAlertClosed>['decision'];
  closed_by_staff_id: string | null;
  requester_staff_id: string | null;
  request_json: string | null;
  hidden_session_id: string | null;
  hidden_device_id: string | null;
  devices_json: string;
  people_json: string;
  bound_json: string;
}

type Recipients = AttemptSentPayload['recipients'];
type Routes = AttemptSentPayload['routes'];

/** One send: a frame for some session sockets (by session id) and some alert-mode sockets (by device id). */
interface Batch {
  frame: WsServerMessage;
  sessions: string[];
  alertDevices: string[];
}

export function createAlertFrames(env: FramesEnv): AlertFrames {
  const guarded = (what: string, fn: () => void, at: Record<string, unknown> = {}): void => {
    try {
      fn();
    } catch (err) {
      env.log.error({ ...safeError(err), ...at, frames: what }, 'alert frames failed');
    }
  };

  function sendStepFrames(appended: PosEvent[]): void {
    const steps = appended.filter((e) => STEP_EVENTS.has(e.event_type));
    if (steps.length === 0) return;
    const ids = [...new Set(steps.map((e) => String(e.payload.alert_id)))];
    const rows = cachedPrepare(
      env.db,
      `SELECT alert_id, kind, family, display_json, details_json, values_json, request_json, raised_at,
              raised_device_id, requester_staff_id, hidden_session_id, hidden_device_id
       FROM alerts WHERE alert_id IN (SELECT value FROM json_each(?))`,
    ).all(JSON.stringify(ids)) as StepAlertRow[];
    const byId = new Map(rows.map((r) => [r.alert_id, r]));
    const ws = env.ws();
    const sessions = ws.connectedSessions();
    const alertDevices = new Set(ws.alertSockets().map((s) => s.deviceId));
    let directory: StaffDirectory | undefined;
    const dir = (): StaffDirectory => (directory ??= env.directory());
    for (const event of steps) {
      const payload = event.payload as AttemptSentPayload;
      const row = byId.get(payload.alert_id);
      const kind = row === undefined ? undefined : kindOf(row.kind);
      if (row === undefined || kind === undefined) continue; // P-8: an unknown kind never steps
      guarded('step', () => {
        const views = stepViews(row, kind, payload.step, event.event_type === 'EscalationStepped');
        const request = row.request_json === null ? null : (JSON.parse(row.request_json) as AlertRequestPart);
        const canAnswer = (staffId: string): boolean =>
          request !== null && mayAnswer(dir(), request, row.requester_staff_id, staffId).ok;
        send(ws, planStep(row, payload.recipients, payload.routes, views, sessions, alertDevices, request !== null, canAnswer));
        sendRoutes(row, kind, payload, views);
      }, { alert_id: row.alert_id, kind: row.kind, step: payload.step });
    }
  }

  /** §3.8: registered routes get the lock view after commit; short_code only for a kind with a `short` label. */
  function sendRoutes(row: StepAlertRow, kind: AlertKind, payload: AttemptSentPayload, views: StepViews): void {
    const defs = new Map(registeredRoutes().map((d) => [d.route, d]));
    for (const r of payload.routes) {
      const def = defs.get(r.route);
      if (def === undefined) continue;
      if (def.format === 'short_code' && kind.labels.short === undefined) continue;
      const own = payload.recipients.find((p) => p.staff_id !== null && p.staff_id === r.staff_id);
      const view = views.lock(own?.set ?? 'recipient', own?.for_staff_id ?? null).alert as AlertView;
      try {
        def.send(view, payload.step, r.ref);
      } catch (err) {
        // the route's own error (§3.8: failures are the route's to log); it was handed the lock view only
        env.log.error({ err, alert_id: row.alert_id, kind: row.kind, step: payload.step, route: r.route }, 'alert route send failed');
      }
    }
  }

  function sendCloseFrames(alertIds: string[]): void {
    const ids = [...new Set(alertIds)];
    if (ids.length === 0) return;
    // §6 batch 3: the cumulative recipients of every alert closed in the transaction, one statement
    const rows = cachedPrepare(
      env.db,
      `SELECT a.alert_id, a.state, a.close_reason, a.decision, a.closed_by_staff_id, a.requester_staff_id,
              a.request_json, a.hidden_session_id, a.hidden_device_id,
              (SELECT json_group_array(DISTINCT r.device_id) FROM alert_recipients r
                WHERE r.alert_id = a.alert_id AND r.device_id IS NOT NULL) AS devices_json,
              (SELECT json_group_array(i.staff_id) FROM alert_inbox i WHERE i.alert_id = a.alert_id) AS people_json,
              (SELECT json_group_array(DISTINCT b.device_id) FROM alert_inbox i
                JOIN device_bindings b ON b.staff_id = i.staff_id WHERE i.alert_id = a.alert_id) AS bound_json
       FROM alerts a WHERE a.alert_id IN (SELECT value FROM json_each(?))`,
    ).all(JSON.stringify(ids)) as CloseAlertRow[];
    const ws = env.ws();
    const sessions = ws.connectedSessions();
    const alertDevices = ws.alertSockets().map((s) => s.deviceId);
    let directory: StaffDirectory | undefined;
    const dir = (): StaffDirectory => (directory ??= env.directory());
    for (const row of rows) {
      if (row.state !== 'closed' || row.close_reason === null) continue;
      guarded('close', () => {
        const answered = row.close_reason === 'answered';
        const byName = answered && row.closed_by_staff_id !== null ? (dir().get(row.closed_by_staff_id)?.display_name ?? null) : null;
        const frame = ClosedFrame.parse({
          type: 'alert_closed',
          alert_id: row.alert_id,
          reason: row.close_reason,
          decision: answered ? row.decision : null,
          by_name: byName,
        });
        const devices = new Set(JSON.parse(row.devices_json) as string[]);
        const people = new Set(JSON.parse(row.people_json) as string[]);
        const bound = new Set(JSON.parse(row.bound_json) as string[]);
        const request = row.request_json === null ? null : (JSON.parse(row.request_json) as AlertRequestPart);
        const hidden = hiddenOf(row);
        const toSessions = sessions
          .filter((s) => !hidden.session(s))
          .filter(
            (s) =>
              devices.has(s.deviceId) ||
              (s.kind === 'staff' && s.staffId !== null && people.has(s.staffId)) ||
              // §6.2 step (10): the requester's sockets (every request close: AD row, a close frame has no secret)
              (request !== null && s.kind === 'staff' && s.staffId !== null && s.staffId === row.requester_staff_id) ||
              // §3.3 rules 5–6, now, in memory: a late approver who saw it only in requests-to-answer
              (request !== null && s.kind === 'staff' && s.staffId !== null && mayAnswer(dir(), request, row.requester_staff_id, s.staffId).ok),
          )
          .map((s) => s.sessionId);
        const toAlert = alertDevices.filter((d) => !hidden.device(d) && (devices.has(d) || bound.has(d)));
        send(ws, [{ frame, sessions: toSessions, alertDevices: toAlert }]);
      }, { alert_id: row.alert_id });
    }
  }

  function sendSeenMany(pairs: ReadonlyArray<{ staff_id: string; alert_id: string }>): void {
    if (pairs.length === 0) return;
    const staffIds = [...new Set(pairs.map((p) => p.staff_id))];
    const rows = env.db
      .prepare('SELECT device_id, staff_id FROM device_bindings WHERE staff_id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(staffIds)) as Array<{ device_id: string; staff_id: string }>;
    const ws = env.ws();
    const done = new Set<string>();
    for (const p of pairs) {
      const key = `${p.staff_id}\u0000${p.alert_id}`;
      if (done.has(key)) continue;
      done.add(key);
      guarded('seen', () => {
        // a request is never hidden (hidden_from is set only on personal notices, §3.10), so no hiding here
        const frame = SeenFrame.parse({ type: 'alert_seen', alert_id: p.alert_id });
        ws.sendToStaff([p.staff_id], frame);
        ws.sendToAlertMode(
          rows.filter((r) => r.staff_id === p.staff_id).map((r) => r.device_id),
          frame,
        );
      }, { alert_id: p.alert_id });
    }
  }

  return {
    afterCommit(appended) {
      if (appended.length === 0) return;
      guarded('step', () => sendStepFrames(appended));
      const closed = appended.filter((e) => CLOSE_EVENTS.has(e.event_type)).map((e) => String(e.payload.alert_id));
      guarded('close', () => sendCloseFrames(closed));
      const seen = appended
        .filter((e) => e.event_type === 'RequestSeen')
        .map((e) => e.payload as RequestSeenPayload)
        .map((p) => ({ staff_id: p.staff_id, alert_id: p.alert_id }));
      guarded('seen', () => sendSeenMany(seen));
    },
    sendStepFrames,
    sendCloseFrames,
    sendSeenFrames(staffId, alertId) {
      sendSeenMany([{ staff_id: staffId, alert_id: alertId }]);
    },
  };
}

// ------------------------------------------------------------------------------------------------ views

interface StepViews {
  card(set: Recipients[number]['set'], forStaffId: string | null): z.infer<typeof CardAlertFrame>;
  lock(set: Recipients[number]['set'], forStaffId: string | null): z.infer<typeof LockAlertFrame>;
}

/** §3.12: the lock-safe display parameters (table, point, requester, device name) under a label key. */
function displayParams(display: AlertDisplay, key: string): AlertLock {
  const out: AlertLock = {
    kind_label_key: key,
    table_code: display.table_code ?? null,
    point_code: display.point_code ?? null,
    requester_name: display.requester_name ?? null,
  };
  if (display.device_name !== undefined) out.device_name = display.device_name;
  return out;
}

/**
 * The alert fields every lock-safe view is built from (an `alerts` row; never `details_json`). `values_json`
 * is read only for AD-82's request_result outcome (its values carry no amount, item or reason, kinds.ts).
 */
export interface LockViewRow {
  alert_id: string;
  kind: string;
  family: AlertView['family'];
  display_json: string;
  values_json: string;
  raised_at: number;
}

/** A signed-in view also reads the details and the request part (answers, needs_pin; AD-23). */
export interface ViewRow extends LockViewRow {
  details_json: string | null;
  request_json: string | null;
  /** AD-165: the raising device, on a request's signed-in view only */
  raised_device_id: string;
}

/** AD-82: a request_result's outcome from its values (kinds.ts RequestResultValues); null when unreadable. */
function outcomeOf(row: LockViewRow): RequestOutcome | null {
  const v = JSON.parse(row.values_json) as { close_reason?: unknown; decision?: unknown };
  switch (v.close_reason) {
    case 'answered':
      return v.decision === 'approve' || v.decision === 'accept' ? 'approved' : v.decision === 'reject' || v.decision === 'decline' ? 'rejected' : null;
    case 'withdrawn':
    case 'obsolete':
    case 'overridden':
      return v.close_reason;
    default:
      return null;
  }
}

/**
 * The one lock-view builder (§3.12, G1-13 e): the fields shared by every `alert` frame (lock and card), every
 * `alerts_open` row (alert-sockets.ts), every inbox and catch-up row. AD-82's `outcome` is added here, on a
 * `request_result` only (absent on every other kind).
 */
export function lockView(
  row: LockViewRow,
  kind: AlertKind,
  step: number,
): Pick<AlertView, 'alert_id' | 'kind' | 'family' | 'step' | 'lock' | 'raised_at' | 'outcome'> {
  const lock = displayParams(JSON.parse(row.display_json) as AlertDisplay, kind.labels.lock);
  const view: Pick<AlertView, 'alert_id' | 'kind' | 'family' | 'step' | 'lock' | 'raised_at' | 'outcome'> = {
    alert_id: row.alert_id,
    kind: row.kind,
    family: row.family,
    step,
    lock,
    raised_at: row.raised_at,
  };
  if (row.kind === REQUEST_RESULT_KIND) view.outcome = outcomeOf(row);
  return view;
}

/** Where a view goes in a step / catch-up / inbox: the recipient set, the "for" person, the escalation flag. */
export interface ViewPlace {
  escalation: boolean;
  set: AlertView['set'];
  for_staff_id: string | null;
}

/** §6 batch 3: the lock-only view, parsed strict (no card, details or AD-23 field can leave through it). */
export function lockOnlyView(row: LockViewRow, kind: AlertKind, step: number, place: ViewPlace): z.infer<typeof StrictLockView> {
  return StrictLockView.parse({ ...lockView(row, kind, step), ...place });
}

/**
 * §6 batch 3 / §3.12 / AD-23: the person's own signed-in view: card (the card label key and the kind's
 * details) plus `answers` / `needs_pin` from the stored request part (null for a non-request) and the kind's
 * `silent`; AD-165: plus `raised_device_id` on a request (absent on every other kind). Only for the person's
 * own staff sockets, inbox, catch-up and requests-to-answer rows (cardRule); the strict lock pick refuses it.
 */
export function signedInView(row: ViewRow, kind: AlertKind, step: number, place: ViewPlace): z.infer<typeof StrictCardView> {
  const details = row.details_json === null ? null : (JSON.parse(row.details_json) as AlertDetails);
  const request = row.request_json === null ? null : (JSON.parse(row.request_json) as Pick<AlertRequestPart, 'answers' | 'needs_pin'>);
  return StrictCardView.parse({
    ...lockView(row, kind, step),
    ...place,
    card: { ...displayParams(JSON.parse(row.display_json) as AlertDisplay, kind.labels.card), details },
    answers: request === null ? null : [...request.answers],
    needs_pin: request === null ? null : request.needs_pin,
    silent: kind.silent,
    ...(request === null ? {} : { raised_device_id: row.raised_device_id }),
  });
}

/** What the card rule needs to know about one viewer's row of one alert. */
export interface CardViewer {
  /** this device is a device target of the alert (any step): kiosk, KDS, always-on, point tablet */
  deviceTarget: boolean;
  /** the viewer's row (latest step): its set and its "for" person */
  set: AlertView['set'];
  for_staff_id: string | null;
  /** the alert is a request (`request_json` set) */
  request: boolean;
  /** §3.3 rules 5–6 now, in memory (false for a non-request) */
  canAnswer: boolean;
}

/**
 * AD-162 / AD-163, §3.12: the one card rule for the inbox, the catch-up, requests-to-answer and the frames,
 * asked only for a viewer on their own staff session. The card (with details) goes to a viewer who may answer
 * the request now, or who is a person recipient of a non-request alert on their own row. A device-target
 * device gets lock only, whatever the session; read-only rows get lock only: `informed`, a lead's "for" row,
 * and a request row whose right was removed after the step. Pure; no statement.
 */
export function cardRule(v: CardViewer): boolean {
  if (v.deviceTarget) return false;
  if (v.request) return v.canAnswer;
  return v.for_staff_id === null && v.set !== 'informed';
}

/** §3.12: lock = the lock-safe display parameters with the kind's lock key; card adds the card key and details. */
function stepViews(row: StepAlertRow, kind: AlertKind, step: number, escalation: boolean): StepViews {
  return {
    card: (set, for_staff_id) => CardAlertFrame.parse({ type: 'alert', alert: signedInView(row, kind, step, { escalation, set, for_staff_id }) }),
    lock: (set, for_staff_id) => LockAlertFrame.parse({ type: 'alert', alert: lockOnlyView(row, kind, step, { escalation, set, for_staff_id }) }),
  };
}

// ------------------------------------------------------------------------------------------------ plan

function hiddenOf(row: { hidden_session_id: string | null; hidden_device_id: string | null }): {
  session(s: ConnectedSession): boolean;
  device(deviceId: string): boolean;
} {
  return {
    session: (s) => s.sessionId === row.hidden_session_id || s.deviceId === row.hidden_device_id,
    device: (deviceId) => deviceId === row.hidden_device_id,
  };
}

/**
 * One step of one alert, in memory over the socket lists. Device-target rows first: every socket of the
 * device gets `lock`, and such a socket gets nothing else in this step. Then person rows: the person's own
 * staff sockets get `card` when cardRule allows it (else `lock`: informed, "for" rows, a right removed), the
 * alert-mode sockets of the step's `alert_connection` routes of that person get `lock`. One frame per socket per recipient (socket, for_staff_id), so a lead's "for Ali" and "for Bilal"
 * cards are two frames and a repeated row is one.
 */
function planStep(
  row: StepAlertRow,
  recipients: Recipients,
  routes: Routes,
  views: StepViews,
  sessions: ConnectedSession[],
  alertDevices: ReadonlySet<string>,
  request: boolean,
  canAnswer: (staffId: string) => boolean,
): Batch[] {
  const hidden = hiddenOf(row);
  const deviceTarget = new Set<string>();
  const taken = new Set<string>();
  const batches = new Map<string, Batch>();
  const claim = (socket: string, forStaffId: string | null, frame: () => WsServerMessage, target: { session?: string; device?: string }): void => {
    const key = `${socket}\u0000${forStaffId ?? ''}`;
    if (taken.has(key)) return;
    taken.add(key);
    const f = frame();
    const body = JSON.stringify(f);
    const batch = batches.get(body) ?? { frame: f, sessions: [], alertDevices: [] };
    if (target.session !== undefined) batch.sessions.push(target.session);
    if (target.device !== undefined) batch.alertDevices.push(target.device);
    batches.set(body, batch);
  };

  for (const r of recipients) {
    if (r.device_id === null) continue;
    const deviceId = r.device_id;
    const frame = (): WsServerMessage => views.lock(r.set, null);
    for (const s of sessions) {
      if (s.deviceId !== deviceId || hidden.session(s)) continue;
      deviceTarget.add(`s:${s.sessionId}`);
      claim(`s:${s.sessionId}`, null, frame, { session: s.sessionId });
    }
    if (alertDevices.has(deviceId) && !hidden.device(deviceId)) {
      deviceTarget.add(`a:${deviceId}`);
      claim(`a:${deviceId}`, null, frame, { device: deviceId });
    }
  }

  const bound = new Map<string, string[]>();
  for (const r of routes) {
    if (r.route !== 'alert_connection' || r.staff_id === null) continue;
    bound.set(r.staff_id, [...(bound.get(r.staff_id) ?? []), r.ref]);
  }
  for (const r of recipients) {
    if (r.staff_id === null) continue;
    const staffId = r.staff_id;
    let card: boolean | undefined;
    const cardFor = (): boolean =>
      (card ??= cardRule({ deviceTarget: false, set: r.set, for_staff_id: r.for_staff_id, request, canAnswer: request && canAnswer(staffId) }));
    for (const s of sessions) {
      if (s.kind !== 'staff' || s.staffId !== staffId || hidden.session(s)) continue;
      const socket = `s:${s.sessionId}`;
      if (deviceTarget.has(socket)) continue; // a device-target socket gets lock only (§6 batch 3)
      claim(
        socket,
        r.for_staff_id,
        () => (cardFor() ? views.card(r.set, r.for_staff_id) : views.lock(r.set, r.for_staff_id)),
        { session: s.sessionId },
      );
    }
    for (const deviceId of bound.get(staffId) ?? []) {
      const socket = `a:${deviceId}`;
      if (!alertDevices.has(deviceId) || hidden.device(deviceId) || deviceTarget.has(socket)) continue;
      claim(socket, r.for_staff_id, () => views.lock(r.set, r.for_staff_id), { device: deviceId });
    }
  }
  return [...batches.values()];
}

function send(ws: WsHub, batches: Batch[]): void {
  for (const b of batches) {
    if (b.sessions.length > 0) ws.sendToSessions(b.sessions, b.frame);
    if (b.alertDevices.length > 0) ws.sendToAlertMode(b.alertDevices, b.frame as Parameters<WsHub['sendToAlertMode']>[1]);
  }
}

/**
 * §7: an error a view builder (inbox, catch-up, alerts_open) hands to a caller that logs `{ err }` as is
 * (the WS server's catch-up / alerts_open guard, the HTTP error handler). It carries only the original
 * error's name and code (as `safeError`), never its message: a JSON.parse or Zod message can echo details.
 */
export class AlertViewError extends Error {
  readonly code: string | null;
  readonly cause_name: string;
  constructor(what: string, err: unknown) {
    super(`${what} failed`);
    this.name = 'AlertViewError';
    const safe = safeError(err);
    const inner = safe.err as { name?: string; code?: string | null } | undefined;
    this.cause_name = inner?.name ?? String(safe.error ?? 'unknown');
    this.code = inner?.code ?? null;
  }
}

/** Runs a view builder; a DomainError passes as is, anything else becomes an AlertViewError (§7). */
export function safeBuild<T>(what: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof DomainError) throw err;
    throw new AlertViewError(what, err);
  }
}

/** §7: a frame-schema failure logs issue codes and paths only (a received value could be a detail). */
function safeError(err: unknown): Record<string, unknown> {
  if (err instanceof ZodError) {
    return { error: 'frame_invalid', issues: err.issues.map((i) => ({ code: i.code, path: i.path.map(String).join('.') })) };
  }
  // §7: never the message or stack. A JSON.parse failure on a corrupt display_json / details_json echoes
  // the input in its message, which would put details in a log line.
  const e = err as { name?: unknown; code?: unknown } | null;
  return { err: { name: typeof e?.name === 'string' ? e.name : 'unknown', code: typeof e?.code === 'string' ? e.code : null } };
}
