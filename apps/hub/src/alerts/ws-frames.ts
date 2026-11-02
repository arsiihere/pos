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
  type AttemptSentPayload,
  type PosEvent,
  type RequestSeenPayload,
  type WsServerMessage,
} from '@pos/events';
import type Database from 'better-sqlite3';
import { z, ZodError } from 'zod';
import type { StaffDirectory } from '../auth/staff-directory.js';
import type { ConnectedSession, WsHub } from '../ws/server.js';
import { kindOf, type AlertKind } from './kinds.js';
import { registeredRoutes } from './routes.js';
import { mayAnswer, type AlertRequestPart } from './targets.js';
import { cachedPrepare } from './statements.js';

// 01d §6 batch 3 / §3.6 / §3.12: the alert frames (`alert`, `alert_closed`, `alert_seen`), sent from the
// writer's after-commit hook only (never on rollback), once per step per socket, not part of the seq stream.
// - `card` (display + details) only for person recipients, on that person's own staff-session sockets.
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
// (AD-23's answers / needs_pin / silent, task 34) stays refused here.
const LockAlertFrame = z
  .object({
    type: z.literal('alert'),
    alert: AlertViewSchema.pick({
      alert_id: true,
      kind: true,
      family: true,
      step: true,
      escalation: true,
      set: true,
      for_staff_id: true,
      raised_at: true,
    })
      .extend({ lock: StrictLock })
      .strict(),
  })
  .strict();
const CardAlertFrame = z
  .object({ type: z.literal('alert'), alert: AlertViewSchema.extend({ lock: StrictLock, card: StrictCard }).strict() })
  .strict();
const SeenFrame = WsAlertSeen.strict();
const ClosedFrame = WsAlertClosed.strict();

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

interface StepAlertRow {
  alert_id: string;
  kind: string;
  family: AlertView['family'];
  display_json: string;
  details_json: string | null;
  raised_at: number;
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
      `SELECT alert_id, kind, family, display_json, details_json, raised_at, hidden_session_id, hidden_device_id
       FROM alerts WHERE alert_id IN (SELECT value FROM json_each(?))`,
    ).all(JSON.stringify(ids)) as StepAlertRow[];
    const byId = new Map(rows.map((r) => [r.alert_id, r]));
    const ws = env.ws();
    const sessions = ws.connectedSessions();
    const alertDevices = new Set(ws.alertSockets().map((s) => s.deviceId));
    for (const event of steps) {
      const payload = event.payload as AttemptSentPayload;
      const row = byId.get(payload.alert_id);
      const kind = row === undefined ? undefined : kindOf(row.kind);
      if (row === undefined || kind === undefined) continue; // P-8: an unknown kind never steps
      guarded('step', () => {
        const views = stepViews(row, kind, payload.step, event.event_type === 'EscalationStepped');
        send(ws, planStep(row, payload.recipients, payload.routes, views, sessions, alertDevices));
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

/** §3.12: lock = the lock-safe display parameters with the kind's lock key; card adds the card key and details. */
function stepViews(row: StepAlertRow, kind: AlertKind, step: number, escalation: boolean): StepViews {
  const display = JSON.parse(row.display_json) as AlertDisplay;
  const lockParams = (key: string): AlertLock => {
    const out: AlertLock = {
      kind_label_key: key,
      table_code: display.table_code ?? null,
      point_code: display.point_code ?? null,
      requester_name: display.requester_name ?? null,
    };
    if (display.device_name !== undefined) out.device_name = display.device_name;
    return out;
  };
  const lock = lockParams(kind.labels.lock);
  const details = row.details_json === null ? null : (JSON.parse(row.details_json) as AlertDetails);
  const base = { alert_id: row.alert_id, kind: row.kind, family: row.family, step, escalation, lock, raised_at: row.raised_at };
  return {
    card: (set, for_staff_id) =>
      CardAlertFrame.parse({ type: 'alert', alert: { ...base, set, for_staff_id, card: { ...lockParams(kind.labels.card), details } } }),
    lock: (set, for_staff_id) => LockAlertFrame.parse({ type: 'alert', alert: { ...base, set, for_staff_id } }),
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
 * staff sockets get `card`, the alert-mode sockets of the step's `alert_connection` routes of that person get
 * `lock`. One frame per socket per recipient (socket, for_staff_id), so a lead's "for Ali" and "for Bilal"
 * cards are two frames and a repeated row is one.
 */
function planStep(
  row: StepAlertRow,
  recipients: Recipients,
  routes: Routes,
  views: StepViews,
  sessions: ConnectedSession[],
  alertDevices: ReadonlySet<string>,
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
    for (const s of sessions) {
      if (s.kind !== 'staff' || s.staffId !== staffId || hidden.session(s)) continue;
      const socket = `s:${s.sessionId}`;
      if (deviceTarget.has(socket)) continue; // a device-target socket gets lock only (§6 batch 3)
      claim(socket, r.for_staff_id, () => views.card(r.set, r.for_staff_id), { session: s.sessionId });
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
