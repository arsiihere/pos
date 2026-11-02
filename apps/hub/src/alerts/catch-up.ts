import type { EngineState } from '@pos/engine';
import { AlertsCatchUpPart } from '@pos/events';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { StaffDirectory } from '../auth/staff-directory.js';
import type { CatchUpPart, SocketCtx } from '../ws/catch-up.js';
import { kindOf, type AlertKind } from './kinds.js';
import { mayAnswer, type AlertRequestPart } from './targets.js';
import { lockOnlyView, safeBuild, signedInView, StrictCardView, StrictLockView, type ViewRow } from './ws-frames.js';

// 01d §6 batch 3 "A missed frame is covered by … the `alerts` catch-up part" (H-7: built with the socket
// context), §3.10 hiding, §6.9 / N3 may-answer rows, §8.3 `seen_by_me`.
// - Session sockets only (staff and station): alert-mode sockets never pass through catch-up (H-1, H-7); they
//   get `alerts_open` (alert-sockets.ts).
// - Rows: the open alerts where this device is in any step's recipients (cumulative) or this person is in
//   `alert_inbox`, plus, for a staff socket, every open request the person may answer now (§3.3 rules 5–6, in
//   memory over the directory; v0.5 #3, N3). Never an alert hidden from this session or this device
//   (`hidden_session_id` / `hidden_device_id`, §3.10).
// - A device-target row gets the lock-only view (§6 batch 3: every socket of a device-target recipient gets
//   `lock` only, whatever its session kind), as does every row of a station socket. The person's own rows on a
//   staff socket (inbox rows and may-answer rows) get the signed-in view: `card` with `details` and the AD-23
//   fields. Every row is parsed with ws-frames' strict view schemas, so no `card` / `details` leaves on a lock
//   row (§7).
// - `seen_by_me`: this person's seen (`request_seen`, or an `AlertSeen` receipt); false on a station socket, and
//   false for an open `closes_on: 'seen'` alert (seenByMe): a valid seen would have closed it, so a receipt
//   on it came from the answering seat (§3.10) and must not mark it seen on the person's other devices.
// - `from_business_day` (BF-4, AD-5; task 35): the business date of an alert raised before the current
//   business day's `opened_at`, else null (fromBusinessDay), read in the same statements.
// - Every listed alert is "sent" to the device for the receipt check (`recordSent`, §6 batch 3, task 21 carry).
// Statements: 2 for a staff socket ((1) the device / inbox rows, (2) the open requests by
// `alerts_open_requests`), 1 for a station socket; fixed whatever the number of alerts.
// Determinism: no clock read. Logs: none here; a throw is rethrown as an AlertViewError (name and code only,
// §7) for the WS server's catch-up guard, which logs it and closes the socket.
// Statements are prepared per call (not cached: AD-125 limits the cache to the tick, projections and raise).

export interface AlertsCatchUpEnv {
  directory(): StaffDirectory;
  /** receipts.ts `recordSent`: this device was given the alert in the catch-up. */
  recordSent(deviceId: string, alertId: string): void;
  /** The hub's branch: the `hub` stream id whose BusinessDayOpened events date an earlier day's row (BF-4). */
  branchId: string;
}

interface CatchUpRow extends ViewRow {
  step: number;
  requester_staff_id: string | null;
  to_device: 0 | 1;
  device_set: z.infer<typeof StrictLockView>['set'] | null;
  in_inbox: 0 | 1;
  mine_json: string | null;
  seen: 0 | 1;
  from_day: string | null;
}

const COLUMNS = `a.alert_id, a.kind, a.family, a.step, a.display_json, a.details_json, a.values_json, a.request_json,
       a.raised_at, a.requester_staff_id`;

// The person's latest step rows of the alert (own row and "for" rows), and their seen (also requests-to-answer).
export const PERSON_COLUMNS = `
       (SELECT json_group_array(json_object('for_staff_id', r.for_staff_id, 'set', r.recipient_set))
          FROM alert_recipients r
         WHERE r.alert_id = a.alert_id AND r.staff_id = @staff_id
           AND r.step = (SELECT MAX(r2.step) FROM alert_recipients r2 WHERE r2.alert_id = a.alert_id AND r2.staff_id = @staff_id)
       ) AS mine_json,
       (EXISTS (SELECT 1 FROM request_seen s WHERE s.alert_id = a.alert_id AND s.staff_id = @staff_id)
        OR EXISTS (SELECT 1 FROM alert_receipts k WHERE k.alert_id = a.alert_id AND k.staff_id = @staff_id AND k.kind = 'seen')) AS seen`;

/**
 * BF-4 / AD-5, a column of the row's own statement (no statement added): for an alert raised before the current
 * business day's `opened_at` (@day_start), the `business_date` of the latest BusinessDayOpened recorded at or
 * before its raise (index events_stream: the hub stream, newest first), '' when it was raised before any day
 * opened; null for an alert of the current day, or when no day was ever opened. See fromBusinessDay.
 */
export const FROM_DAY_COLUMN = `
       CASE WHEN @day_start IS NOT NULL AND a.raised_at < @day_start THEN
         COALESCE((SELECT json_extract(e.payload, '$.business_date') FROM events e
                    WHERE e.stream_type = 'hub' AND e.stream_id = @branch_id AND e.event_type = 'BusinessDayOpened'
                      AND e.recorded_at <= a.raised_at
                    ORDER BY e.seq DESC LIMIT 1), '')
       END AS from_day`;

export const NOT_HIDDEN = `(a.hidden_session_id IS NULL OR a.hidden_session_id <> @session_id)
   AND (a.hidden_device_id IS NULL OR a.hidden_device_id <> @device_id)`;

// (1) open alerts with this device in any step's recipients, or this person in alert_inbox (cumulative)
const ROWS_SQL = `
  SELECT ${COLUMNS},
         a.alert_id IN (SELECT r.alert_id FROM alert_recipients r WHERE r.device_id = @device_id) AS to_device,
         (SELECT r.recipient_set FROM alert_recipients r WHERE r.alert_id = a.alert_id AND r.device_id = @device_id
           ORDER BY r.step DESC LIMIT 1) AS device_set,
         EXISTS (SELECT 1 FROM alert_inbox i WHERE i.alert_id = a.alert_id AND i.staff_id = @staff_id) AS in_inbox,
         ${PERSON_COLUMNS}, ${FROM_DAY_COLUMN}
  FROM alerts a
  WHERE a.state = 'open' AND a.step >= 0 AND ${NOT_HIDDEN}
    AND (a.alert_id IN (SELECT r.alert_id FROM alert_recipients r WHERE r.device_id = @device_id)
         OR a.alert_id IN (SELECT i.alert_id FROM alert_inbox i WHERE i.staff_id = @staff_id))
  ORDER BY a.raised_at, a.alert_id`;

// (2) every open request (index alerts_open_requests); may-answer is decided in memory
const REQUESTS_SQL = `
  SELECT ${COLUMNS}, 0 AS to_device, NULL AS device_set, 0 AS in_inbox, ${PERSON_COLUMNS}, ${FROM_DAY_COLUMN}
  FROM alerts a
  WHERE a.state = 'open' AND a.request_json IS NOT NULL AND a.step >= 0 AND ${NOT_HIDDEN}
  ORDER BY a.raised_at, a.alert_id`;

const FromDay = AlertsCatchUpPart.shape.alerts.element.shape.from_business_day;
const StrictLockRow = StrictLockView.extend({ seen_by_me: z.boolean(), from_business_day: FromDay }).strict();
const StrictCardRow = StrictCardView.extend({ seen_by_me: z.boolean(), from_business_day: FromDay }).strict();
type PartRow = z.infer<typeof StrictLockRow> | z.infer<typeof StrictCardRow>;

/** The person's row of the alert's latest step they were in: their own row first, else a "for" row. */
export function placeOf(
  mineJson: string | null,
  fallbackSet: z.infer<typeof StrictLockView>['set'],
): { set: z.infer<typeof StrictLockView>['set']; for_staff_id: string | null } {
  const mine = mineJson === null ? [] : (JSON.parse(mineJson) as Array<{ for_staff_id: string | null; set: z.infer<typeof StrictLockView>['set'] | null }>);
  const rows = mine.filter((m) => m.set !== null);
  const own = rows.find((m) => m.for_staff_id === null) ?? rows[0];
  return own === undefined ? { set: fallbackSet, for_staff_id: null } : { set: own.set as z.infer<typeof StrictLockView>['set'], for_staff_id: own.for_staff_id };
}

/**
 * §8.3 `seen_by_me` with §3.10: an open `closes_on: 'seen'` alert is never "seen by me", because the person's
 * valid seen closes it (§3.5); a seen receipt on an open one came from the answering seat (recorded, closes
 * nothing) and must not stop the person's own devices from showing it. No statement.
 */
export function seenByMe(kind: AlertKind, state: 'open' | 'closed', seen: 0 | 1 | null): boolean {
  if (state === 'open' && kind.closes_on === 'seen') return false;
  return seen === 1;
}

/** The hub's local date of `ms`, as OpenBusinessDay labels a day (S33). */
function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * BF-4 / AD-5: `from_business_day` from FROM_DAY_COLUMN. An alert raised before any business day opened (''),
 * but listed once a day is open, is dated by the hub's local date of its raise, so it is never re-notified as
 * today's. No clock read: the date comes from the stored raise time.
 */
export function fromBusinessDay(fromDay: string | null, raisedAt: number): string | null {
  if (fromDay === null) return null;
  return fromDay === '' ? localDate(raisedAt) : fromDay;
}

/** The current business day's start (`opened_at`; the latest day, open or closed), null when none ever opened. */
export function dayStartOf(state: Readonly<EngineState> | undefined): number | null {
  return state?.business_day?.opened_at ?? null;
}

export function createAlertsCatchUp(env: AlertsCatchUpEnv): CatchUpPart {
  function build(db: Database.Database, state: unknown, socket: SocketCtx): AlertsCatchUpPart {
    return safeBuild('alerts catch-up', () => buildRows(db, state as Readonly<EngineState> | undefined, socket));
  }

  function buildRows(db: Database.Database, state: Readonly<EngineState> | undefined, socket: SocketCtx): AlertsCatchUpPart {
    const staffId = socket.kind === 'staff' ? socket.staffId : null;
    const params = {
      device_id: socket.deviceId,
      session_id: socket.sessionId,
      staff_id: staffId,
      day_start: dayStartOf(state),
      branch_id: env.branchId,
    };
    const rows = db.prepare(ROWS_SQL).all(params) as CatchUpRow[];
    const out: PartRow[] = [];
    const listed = new Set<string>();
    let directory: StaffDirectory | undefined;
    const dir = (): StaffDirectory => (directory ??= env.directory());
    const push = (row: CatchUpRow, kind: AlertKind, signedIn: boolean, fallbackSet: z.infer<typeof StrictLockView>['set']): void => {
      const escalation = kind.steps[row.step]?.escalation === true;
      const seen_by_me = staffId !== null && seenByMe(kind, 'open', row.seen);
      const from_business_day = fromBusinessDay(row.from_day, row.raised_at);
      if (signedIn) {
        const place = { escalation, ...placeOf(row.mine_json, fallbackSet) };
        out.push(StrictCardRow.parse({ ...signedInView(row, kind, row.step, place), seen_by_me, from_business_day }));
      } else {
        const place = { escalation, set: row.device_set ?? 'recipient', for_staff_id: null };
        out.push(StrictLockRow.parse({ ...lockOnlyView(row, kind, row.step, place), seen_by_me, from_business_day }));
      }
      listed.add(row.alert_id);
    };
    for (const row of rows) {
      const kind = kindOf(row.kind);
      if (kind === undefined) continue; // P-8: an unknown kind has no labels
      // a device-target socket gets lock only (§6 batch 3); a station socket has no person
      push(row, kind, staffId !== null && row.to_device !== 1 && row.in_inbox === 1, 'recipient');
    }
    if (staffId !== null) {
      for (const row of db.prepare(REQUESTS_SQL).all(params) as CatchUpRow[]) {
        if (listed.has(row.alert_id) || row.request_json === null) continue;
        const kind = kindOf(row.kind);
        if (kind === undefined) continue;
        if (!mayAnswer(dir(), JSON.parse(row.request_json) as AlertRequestPart, row.requester_staff_id, staffId).ok) continue;
        push(row, kind, true, 'answerer');
      }
    }
    const part = AlertsCatchUpPart.parse({ alerts: out });
    for (const a of part.alerts) env.recordSent(socket.deviceId, a.alert_id);
    return part;
  }

  return { part: 'alerts', appliesTo: () => true, build };
}
