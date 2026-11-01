import {
  MarkAlertsSeenPayload,
  type AlertClosedPayload,
  type EventDraft,
  type PosEvent,
  type RequestSeenPayload,
} from '@pos/events';
import type { FastifyInstance } from 'fastify';
import type { CommandCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { kindOf } from '../kinds.js';
import { receiptBufferFor } from '../receipts.js';
import { mayAnswer, type AlertRequestPart } from '../targets.js';
import { sessionStaff } from './request-row.js';

// 01d §6.4 `MarkAlertsSeen`, §3.6 `RequestSeen` / `AlertSeen` / "Seen is a full command", §3.5 `closes_on:
// 'seen'` and the answering-seat exception (§3.10 `hidden_from`), §3.4.3 "for" rows.
// Processing: ONE statement reads the alerts for the ids, left-joined to this person's alert_inbox and
// request_seen rows. An id is acted on when it is in the person's inbox (a lead's "for Ali" row included,
// §3.4.3), or is an open request the person may answer now (§3.3 rules 5–6, in memory; v0.5 N3); every other
// id is ignored (no error, no leak). For each acted-on id:
// - an open request not yet in request_seen for this person → `RequestSeen` on the subject stream (the
//   projection upserts the seer's inbox row; ws-frames.ts sends `alert_seen` after commit, task 20);
// - an open `closes_on: 'seen'` alert → `AlertClosed 'done'`, unless this session is its hidden_session_id
//   or this device its hidden_device_id (the answering seat; the device part is cleared at day close).
//   These kinds are personal / single-recipient with `lead_fallback: false`, so they have no "for" rows and
//   the inbox row is the person's own (§3.5);
// - `AlertSeen` is queued with `tx.onCommit` into the receipt buffer (A11): a rolled-back call buffers nothing.
// Statements: 1. A repeat with a new command_id writes no second RequestSeen (request_seen) and buffers no
// duplicate receipt (the buffer's dedupe, §3.6). Events carry the session's staff and device (00 §3.7).

type Payload = MarkAlertsSeenPayload;

interface SeenRow {
  alert_id: string;
  kind: string;
  state: 'open' | 'closed';
  subject_stream_type: PosEvent['stream_type'];
  subject_stream_id: string;
  requester_staff_id: string | null;
  request_json: string | null;
  hidden_session_id: string | null;
  hidden_device_id: string | null;
  in_inbox: 0 | 1;
  request_seen: 0 | 1;
}

const READ_SEEN = `SELECT a.alert_id, a.kind, a.state, a.subject_stream_type, a.subject_stream_id, a.requester_staff_id,
       a.request_json, a.hidden_session_id, a.hidden_device_id,
       i.staff_id IS NOT NULL AS in_inbox, s.staff_id IS NOT NULL AS request_seen
  FROM alerts a
  LEFT JOIN alert_inbox i ON i.staff_id = @staff_id AND i.alert_id = a.alert_id
  LEFT JOIN request_seen s ON s.alert_id = a.alert_id AND s.staff_id = @staff_id
 WHERE a.alert_id IN (SELECT value FROM json_each(@ids))`;

/** §6.4 right check: in my inbox, or an open request I may answer now. No statement. */
function actedOn(ctx: CommandCtx, row: SeenRow, staffId: string): boolean {
  if (row.in_inbox === 1) return true;
  if (row.state !== 'open' || row.request_json === null) return false;
  return mayAnswer(ctx.directory, JSON.parse(row.request_json) as AlertRequestPart, row.requester_staff_id, staffId).ok;
}

function handle(app: FastifyInstance, ctx: CommandCtx, payload: Payload): { events: EventDraft[]; result: { seen: string[] } } {
  const staffId = sessionStaff(ctx.actor);
  const { deviceId, sessionId } = ctx.actor;
  const ids = [...new Set(payload.alert_ids)];
  const rows = new Map(
    (ctx.tx.db.prepare(READ_SEEN).all({ staff_id: staffId, ids: JSON.stringify(ids) }) as SeenRow[]).map((r) => [r.alert_id, r]),
  );
  const now = ctx.clock.branchNow();
  const draft = (row: SeenRow, event_type: string, p: EventDraft['payload']): EventDraft => ({
    stream_type: row.subject_stream_type,
    stream_id: row.subject_stream_id,
    event_type,
    schema_version: 1,
    payload: p,
    occurred_at: now,
    actor_id: staffId,
    device_id: deviceId,
  });

  const seen: string[] = [];
  const events: EventDraft[] = [];
  for (const id of ids) {
    const row = rows.get(id);
    if (row === undefined || !actedOn(ctx, row, staffId)) continue;
    seen.push(id);
    if (row.state !== 'open') continue;
    if (row.request_json !== null) {
      if (row.request_seen === 0) {
        const p: RequestSeenPayload = { alert_id: id, staff_id: staffId, device_id: deviceId };
        events.push(draft(row, 'RequestSeen', p));
      }
      continue;
    }
    // P-8: a kind this build does not register never closes here
    if (kindOf(row.kind)?.closes_on !== 'seen') continue;
    if (row.hidden_session_id === sessionId || row.hidden_device_id === deviceId) continue; // the answering seat
    const p: AlertClosedPayload = { alert_id: id, reason: 'done', by_staff_id: staffId, note: null };
    events.push(draft(row, 'AlertClosed', p));
  }

  if (seen.length > 0) {
    // A11: buffered only once this command's transaction commits
    ctx.tx.onCommit(() => {
      const buffer = receiptBufferFor(app);
      for (const id of seen) buffer.record({ alert_id: id, staff_id: staffId, device_id: deviceId, kind: 'seen' });
    });
  }
  return { events, result: { seen } };
}

export function registerMarkAlertsSeen(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'MarkAlertsSeen',
      payloadSchema: MarkAlertsSeenPayload,
      sessionKind: 'device',
      permission: 'checked-in-handler',
      handle: (ctx, payload) => handle(app, ctx, payload),
    }),
  );
}
