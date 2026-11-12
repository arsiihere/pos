import type {
  AlertClosedPayload,
  AlertDeliveredPayload,
  AlertRaisedPayloadV3,
  AlertSeenPayload,
  AlertTarget,
  AttemptSentPayload,
  PosEvent,
  PresenceSetPayload,
  RequestAnsweredPayload,
  RequestSeenPayload,
  RequestWithdrawnPayload,
  StepSkippedPayload,
} from '@pos/events';
import type Database from 'better-sqlite3';
import { deviceBindingsProjection } from '../alerts/bindings.js';
import { kindOf, registeredAlertKinds, stepAt, type AlertKind } from '../alerts/kinds.js';
import { cachedPrepare } from '../alerts/statements.js';
import { stepTargets } from '../alerts/targets.js';
import type { Projection, ProjectionRegistry } from './registry.js';

// 01d §5.2 rows 1–3 and 5: the `alerts` (with alert_recipients, alert_inbox, request_seen), `alert_flags`,
// `alert_receipts` and `presence_today` projections. Times come from the event envelope (recorded_at).
// Reads: at most 2 statements per 01d step / close event (the alert row by id; the previous step's
// recipients of that alert), never a scan of open alerts (§3.5, M10). Every other statement is a write by key.
// AD-125: the statements of the raise, step, skip and close applies (and the receipt insert) are cached per
// connection (alerts/statements.ts); the cache does not change what runs, only how often it is prepared.

/** P-8 (Review Focus 3): the one log line for an AlertRaised whose kind this build does not register. */
export interface UnknownKindLine {
  alert_id: string;
  kind: string;
  error: 'unknown_kind';
}

/**
 * AD-123: the one error line for an alert retired because its next step's time or targets cannot be computed
 * from its stored values. No values, details or message text (a JSON.parse message can echo input, §7):
 * the error's name and code only.
 */
export interface StuckLine {
  alert_id: string;
  kind: string;
  error: 'alert_stuck';
  err: { name: string; code: string | null };
}

export type AlertProjectionLine = UnknownKindLine | StuckLine;

interface LogSlot {
  log: ((line: AlertProjectionLine) => void) | null;
  pending: AlertProjectionLine[];
}

// Boot replays projections (step 4) before the server and its logger exist (step 5), so lines wait here
// until registerAlerts binds the server log (bindAlertProjectionLog).
const slots = new WeakMap<ProjectionRegistry, LogSlot>();

export function registerAlertProjections(projections: ProjectionRegistry): void {
  const slot: LogSlot = { log: null, pending: [] };
  slots.set(projections, slot);
  projections.register(alertsProjection(slot));
  projections.register(alertFlagsProjection);
  projections.register(alertReceiptsProjection);
  projections.register(presenceTodayProjection);
  projections.register(deviceBindingsProjection()); // §5.2 row 4 (task 15), its own file per P-3
}

/** Binds the hub log for the `alerts` projection's unknown-kind and stuck lines; flushes lines written before. */
export function bindAlertProjectionLog(projections: ProjectionRegistry, log: (line: AlertProjectionLine) => void): void {
  const slot = slots.get(projections);
  if (slot === undefined) return;
  slot.log = log;
  for (const line of slot.pending.splice(0)) log(line);
}

const ALERTS_EVENTS = [
  'AlertRaised',
  'AttemptSent',
  'EscalationStepped',
  'StepSkipped',
  'RequestAnswered',
  'RequestWithdrawn',
  'AlertClosed',
  'RequestSeen',
  'BusinessDayClosed',
];

interface AlertDueRow {
  kind: string;
  target_json: string;
  values_json: string;
  raised_at: number;
  step: number;
}

/** Where a stuck line goes: the hub log, live applies only (a catch-up replays a line already written live). */
type StuckSink = (line: StuckLine) => void;

function emit(slot: LogSlot, line: AlertProjectionLine): void {
  if (slot.log === null) slot.pending.push(line);
  else slot.log(line);
}

function alertsProjection(slot: LogSlot): Projection {
  return {
    name: 'alerts',
    eventTypes: ALERTS_EVENTS,
    apply(tx, event, mode) {
      const stuck: StuckSink = mode === 'live' ? (line) => emit(slot, line) : () => undefined;
      switch (event.event_type) {
        case 'AlertRaised':
          return applyRaised(tx, event, slot, stuck);
        case 'AttemptSent':
        case 'EscalationStepped':
          return applyStep(tx, event, event.payload as AttemptSentPayload, stuck);
        case 'StepSkipped':
          return applySkipped(tx, event.payload as StepSkippedPayload, stuck);
        case 'RequestAnswered': {
          const p = event.payload as RequestAnsweredPayload;
          return close(tx, event, p.alert_id, 'answered', p.decision, p.answerer_staff_id);
        }
        case 'RequestWithdrawn': {
          const p = event.payload as RequestWithdrawnPayload;
          return close(tx, event, p.alert_id, 'withdrawn', null, p.by_staff_id);
        }
        case 'AlertClosed': {
          const p = event.payload as AlertClosedPayload;
          return close(tx, event, p.alert_id, p.reason, null, p.by_staff_id);
        }
        case 'RequestSeen':
          return applySeen(tx, event, event.payload as RequestSeenPayload);
        case 'BusinessDayClosed':
          return applyDayClose(tx, event);
      }
    },
    reset(tx) {
      tx.prepare('DELETE FROM request_seen').run();
      tx.prepare('DELETE FROM alert_inbox').run();
      tx.prepare('DELETE FROM alert_recipients').run();
      tx.prepare('DELETE FROM alerts').run();
    },
  };
}

/**
 * §3.5 (M1): the earlier of the next undue step's time and raised_at + closes_on.after_ms; null when neither.
 * AD-123: a next step whose time or targets cannot be computed from the stored values is never due: the alert
 * is retired (`stuck` is that error; next_due_at = the after_ms time, or NULL). It stays answerable and
 * closable. Deterministic over the event and the registered kinds, so a replay gives the same row. A throw
 * here would roll back the tick that sent the step before it, and fail boot replay.
 */
function nextDue(
  kind: AlertKind | undefined,
  alert: { raised_at: number; values: Record<string, unknown>; target: AlertTarget },
  step: number,
): { at: number | null; stuck: unknown } {
  if (kind === undefined) return { at: null, stuck: null }; // P-8: the tick never selects an alert of an unknown kind
  const times: number[] = [];
  let stuck: unknown = null;
  const next = kind.steps[step + 1];
  if (next !== undefined) {
    try {
      const at = stepAt(next, alert);
      stepTargets(next, alert); // the tick's from_value check, for the same step
      times.push(at);
    } catch (err) {
      stuck = err ?? new Error('step cannot be computed');
    }
  }
  if (typeof kind.closes_on === 'object') times.push(alert.raised_at + kind.closes_on.after_ms);
  return { at: times.length === 0 ? null : Math.min(...times), stuck };
}

function stuckLine(alertId: string, kind: string, err: unknown): StuckLine {
  const e = err as { name?: unknown; code?: unknown };
  return {
    alert_id: alertId,
    kind,
    error: 'alert_stuck',
    err: { name: typeof e.name === 'string' ? e.name : 'unknown', code: typeof e.code === 'string' ? e.code : null },
  };
}

/**
 * AD-123 "Stuck alerts: N" (hub admin, config-status): open alerts retired by `nextDue`. An open alert with
 * next_due_at NULL whose step is below its kind's last step: the next step cannot be computed (an alert with
 * every step sent has step = the last index; an after_ms alert keeps its expiry time; an unknown kind, P-8,
 * is not counted). One statement; the last step index of each registered kind is passed as JSON.
 */
export function countStuckAlerts(db: Database.Database): number {
  const lastStep = Object.fromEntries(registeredAlertKinds().map((kind) => [kind.kind, kind.steps.length - 1]));
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM alerts a JOIN json_each(?) k ON k.key = a.kind
         WHERE a.state = 'open' AND a.next_due_at IS NULL AND a.step < k.value`,
      )
      .get(JSON.stringify(lastStep)) as { n: number }
  ).n;
}

function applyRaised(tx: Database.Database, event: PosEvent, slot: LogSlot, stuck: StuckSink): void {
  const p = event.payload as AlertRaisedPayloadV3;
  const kind = kindOf(p.kind);
  if (kind === undefined) {
    // P-8: keep the row open, never due; one line, no payload values (details stay out of logs, §7).
    emit(slot, { alert_id: p.alert_id, kind: p.kind, error: 'unknown_kind' });
  }
  const raisedAt = event.recorded_at;
  const due = nextDue(kind, { raised_at: raisedAt, values: p.values, target: p.target }, -1);
  if (due.stuck !== null) stuck(stuckLine(p.alert_id, p.kind, due.stuck));
  cachedPrepare(
    tx,
    `INSERT INTO alerts (
       alert_id, kind, family, subject_stream_type, subject_stream_id, dedupe_key, requester_staff_id,
       raised_device_id, raised_seq, hidden_session_id, hidden_device_id,
       target_json, values_json, display_json, details_json, request_json,
       step, next_due_at, expire_due, state, raised_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, -1, ?, 0, 'open', ?)`,
  ).run(
    p.alert_id,
    p.kind,
    p.family,
    p.subject_stream_type,
    p.subject_stream_id,
    p.dedupe_key,
    p.requester_staff_id,
    event.device_id,
    event.seq,
    p.hidden_from?.session_id ?? null,
    p.hidden_from?.device_id ?? null,
    JSON.stringify(p.target),
    JSON.stringify(p.values),
    JSON.stringify(p.display),
    p.details === null ? null : JSON.stringify(p.details),
    p.request === null ? null : JSON.stringify(p.request),
    due.at,
    raisedAt,
  );
}

function readAlert(tx: Database.Database, alertId: string): AlertDueRow | undefined {
  return cachedPrepare(tx, 'SELECT kind, target_json, values_json, raised_at, step FROM alerts WHERE alert_id = ?').get(alertId) as
    | AlertDueRow
    | undefined;
}

// expire_due (day close) keeps next_due_at = the close time until the tick closes the alert.
const SET_STEP = `UPDATE alerts SET step = MAX(step, ?), next_due_at = CASE WHEN expire_due = 1 THEN next_due_at ELSE ? END
                  WHERE alert_id = ? AND state = 'open'`;

function setStep(tx: Database.Database, alertId: string, row: AlertDueRow, step: number, stuck: StuckSink): void {
  const reached = Math.max(row.step, step);
  const alert = {
    raised_at: row.raised_at,
    values: JSON.parse(row.values_json) as Record<string, unknown>,
    target: JSON.parse(row.target_json) as AlertTarget,
  };
  const due = nextDue(kindOf(row.kind), alert, reached);
  if (due.stuck !== null) stuck(stuckLine(alertId, row.kind, due.stuck));
  cachedPrepare(tx, SET_STEP).run(reached, due.at, alertId);
}

function applyStep(tx: Database.Database, event: PosEvent, p: AttemptSentPayload, stuck: StuckSink): void {
  const row = readAlert(tx, p.alert_id);
  if (row === undefined) return;
  const previous = new Set(
    (
      cachedPrepare(
        tx,
        `SELECT staff_id FROM alert_recipients
         WHERE alert_id = ? AND staff_id IS NOT NULL
           AND step = (SELECT MAX(step) FROM alert_recipients WHERE alert_id = ? AND step < ?)`,
      ).all(p.alert_id, p.alert_id, p.step) as Array<{ staff_id: string }>
    ).map((r) => r.staff_id),
  );
  const recipients = JSON.stringify(p.recipients);
  // Rows are inserted per step, never replaced; a person with no route is a row too (v0.5 N5).
  cachedPrepare(
    tx,
    `INSERT INTO alert_recipients (alert_id, staff_id, device_id, for_staff_id, recipient_set, step)
     SELECT ?, json_extract(value, '$.staff_id'), json_extract(value, '$.device_id'),
            json_extract(value, '$.for_staff_id'), json_extract(value, '$.set'), ?
     FROM json_each(?) ORDER BY key`,
  ).run(p.alert_id, p.step, recipients);
  cachedPrepare(
    tx,
    `INSERT INTO alert_inbox (staff_id, alert_id, first_at, moved_to)
     SELECT DISTINCT json_extract(value, '$.staff_id'), ?, ?, NULL FROM json_each(?)
     WHERE json_extract(value, '$.staff_id') IS NOT NULL
     ON CONFLICT (staff_id, alert_id) DO UPDATE SET moved_to = NULL`,
  ).run(p.alert_id, event.recorded_at, recipients);
  const current = new Set(p.recipients.flatMap((r) => (r.staff_id === null ? [] : [r.staff_id])));
  const dropped = [...previous].filter((staffId) => !current.has(staffId));
  const movedTo = p.recipients.find((r) => r.staff_id !== null)?.staff_id ?? null;
  if (dropped.length > 0 && movedTo !== null) {
    // G1-11c "Moved to Bilal": the first person of the new step.
    cachedPrepare(
      tx,
      `UPDATE alert_inbox SET moved_to = ? WHERE alert_id = ? AND staff_id IN (SELECT value FROM json_each(?))`,
    ).run(movedTo, p.alert_id, JSON.stringify(dropped));
  }
  setStep(tx, p.alert_id, row, p.step, stuck);
}

function applySkipped(tx: Database.Database, p: StepSkippedPayload, stuck: StuckSink): void {
  const row = readAlert(tx, p.alert_id);
  if (row === undefined) return;
  setStep(tx, p.alert_id, row, p.step, stuck);
}

function close(
  tx: Database.Database,
  event: PosEvent,
  alertId: string,
  reason: string,
  decision: string | null,
  byStaffId: string | null,
): void {
  // CLOSED is terminal (§3.2): a later close does not rewrite it.
  cachedPrepare(
    tx,
    `UPDATE alerts SET state = 'closed', close_reason = ?, decision = ?, closed_by_staff_id = ?, closed_at = ?,
            next_due_at = NULL
     WHERE alert_id = ? AND state = 'open'`,
  ).run(reason, decision, byStaffId, event.recorded_at, alertId);
}

function applySeen(tx: Database.Database, event: PosEvent, p: RequestSeenPayload): void {
  tx.prepare('INSERT OR IGNORE INTO request_seen (alert_id, staff_id, at) VALUES (?, ?, ?)').run(
    p.alert_id,
    p.staff_id,
    event.recorded_at,
  );
  // v0.5 N3: a late answerer who opened the request gets the close.
  tx.prepare(
    `INSERT INTO alert_inbox (staff_id, alert_id, first_at, moved_to)
     SELECT ?, alert_id, ?, NULL FROM alerts WHERE alert_id = ?
     ON CONFLICT (staff_id, alert_id) DO NOTHING`,
  ).run(p.staff_id, event.recorded_at, p.alert_id);
}

function applyDayClose(tx: Database.Database, event: PosEvent): void {
  // §3.5 day close: open non-request alerts of expires_at_day_close kinds; the tick closes them 'expired'.
  const expiring = registeredAlertKinds()
    .filter((kind) => kind.expires_at_day_close)
    .map((kind) => kind.kind);
  tx.prepare(
    `UPDATE alerts SET expire_due = 1, next_due_at = ?
     WHERE state = 'open' AND request_json IS NULL AND kind IN (SELECT value FROM json_each(?))`,
  ).run(event.recorded_at, JSON.stringify(expiring));
  // §3.10 (v1.0 R2): the device part of hidden_from lasts until the next day close; one statement.
  tx.prepare(`UPDATE alerts SET hidden_device_id = NULL WHERE state = 'open' AND hidden_device_id IS NOT NULL`).run();
}

/** §3.9: SessionStarted, SessionEnded, StaffDirectoryApplied, BusinessDayOpened, BusinessDayClosed → no_approver dirty. */
const alertFlagsProjection: Projection = {
  name: 'alert_flags',
  eventTypes: ['SessionStarted', 'SessionEnded', 'StaffDirectoryApplied', 'BusinessDayOpened', 'BusinessDayClosed'],
  apply(tx) {
    tx.prepare(
      `INSERT INTO alert_flags (name, dirty) VALUES ('no_approver', 1) ON CONFLICT (name) DO UPDATE SET dirty = 1`,
    ).run();
  },
  reset(tx) {
    tx.prepare('DELETE FROM alert_flags').run();
    tx.prepare(`INSERT INTO alert_flags (name, dirty) VALUES ('no_approver', 1)`).run();
  },
};

/** §3.6 (A11): one row per (alert, person, device, kind, step); '' for a device-target receipt. */
const alertReceiptsProjection: Projection = {
  name: 'alert_receipts',
  eventTypes: ['AlertDelivered', 'AlertSeen'],
  apply(tx, event) {
    const delivered = event.event_type === 'AlertDelivered';
    const p = event.payload as AlertDeliveredPayload | AlertSeenPayload;
    cachedPrepare(
      tx,
      `INSERT OR IGNORE INTO alert_receipts (alert_id, staff_id, device_id, kind, step, at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      p.alert_id,
      p.staff_id ?? '',
      p.device_id,
      delivered ? 'delivered' : 'seen',
      delivered ? (p as AlertDeliveredPayload).step : -1,
      event.recorded_at,
    );
  },
  reset(tx) {
    tx.prepare('DELETE FROM alert_receipts').run();
  },
};

/** §3.11: PresenceSet upserts; BusinessDayClosed clears. */
const presenceTodayProjection: Projection = {
  name: 'presence_today',
  eventTypes: ['PresenceSet', 'BusinessDayClosed'],
  apply(tx, event) {
    if (event.event_type === 'BusinessDayClosed') {
      tx.prepare('DELETE FROM presence_today').run();
      return;
    }
    const p = event.payload as PresenceSetPayload;
    tx.prepare(
      `INSERT INTO presence_today (staff_id, present, set_by, at)
       SELECT DISTINCT value, ?, ?, ? FROM json_each(?) WHERE true
       ON CONFLICT (staff_id) DO UPDATE SET present = excluded.present, set_by = excluded.set_by, at = excluded.at`,
    ).run(p.present ? 1 : 0, p.set_by, event.recorded_at, JSON.stringify(p.staff_ids));
  },
  reset(tx) {
    tx.prepare('DELETE FROM presence_today').run();
  },
};
