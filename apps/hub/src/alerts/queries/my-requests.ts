import { DomainError } from '@pos/domain';
import { MyRequestRow, MyRequestsResponse } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineQuery, queryRegistry, type QueryCtx } from '../../queries/registry.js';
import { dayStartOf } from '../catch-up.js';
import { kindOf, type AlertKind } from '../kinds.js';
import { isListedDevice, listedDevicesOnly } from '../targets.js';
import { lockView, safeBuild, type LockViewRow } from '../ws-frames.js';
import { wsHubFor, type WsHub } from '../../ws/server.js';

// 01d §6.8 `GET /queries/my-requests` (AD-13 container `data.requests`; row fields AD-13).
// - Rows: the requests I raised (`requester_staff_id` = me) that are pending (open), plus the ones closed in
//   the current business day (`closed_at` since the latest BusinessDayOpened, open or closed; every closed one
//   when no day was ever opened, as the inbox's "today", AD row of task 34). Requests are never hidden
//   (`hidden_from` is set only on personal notices, §3.10), so no hiding filter.
// - Order: pending first, then `raised_at` desc (alert_id desc breaks ties).
// - Each row: state (§3.3: pending | approved | rejected | withdrawn | closed), close_reason, decision and the
//   answerer's name (answered only; directory, in memory), raised_at, waiting_ms (pending: now − raised_at;
//   closed: closed_at − raised_at; branch time, ctx.now), `ask_in_person` = step ≥ 2 (the escalation step has
//   been sent: at approval_branch_ms, or at once after the G1-9d shortcut, §3.5), and the lock view only (the
//   requester never gets the approver context, §3.12).
// - ⚠️ BUG-10 (01d v1.3.7 §4.3 To 02b R3-M-3, test 122; 02b v1.0.25 §8 OR-7): a one-step `holders` kind
//   (`hand_over_unpaid`) never reaches step 2 and gets no G1-9d shortcut, so on its pending rows `ask_in_person` is
//   "the sole holder asked, or the other holders are absent": none of the row's answerer recipients (the requester is
//   never one, §3.3 rule 5) has a route now — a staff screen socket of the person, or a connected device bound to them
//   (§3.4.3 routes 1, 2; listed devices only for a money kind). Memory over the hub's socket lists; the answerers and
//   their bindings come with the one statement (sub-selects).
// Statements: 1 (index alerts_requester), prepared per call (AD-125). Runs on the read-only connection.
// countsAsActivity false. A build error other than a DomainError is rethrown as an AlertViewError (§7).

const SQL = `
  SELECT a.alert_id, a.kind, a.family, a.step, a.display_json, a.values_json, a.raised_at, a.state, a.close_reason,
         a.decision, a.closed_by_staff_id, a.closed_at,
         CASE WHEN a.state = 'open' THEN (
           SELECT json_group_array(json_object('staff_id', r.staff_id, 'devices', (
             SELECT json_group_array(b.device_id) FROM device_bindings b WHERE b.staff_id = r.staff_id)))
           FROM (SELECT DISTINCT staff_id FROM alert_recipients
                  WHERE alert_id = a.alert_id AND recipient_set = 'answerer' AND staff_id IS NOT NULL AND for_staff_id IS NULL
                    AND step = a.step) r
         ) END AS answerers_json
  FROM alerts a
  WHERE a.requester_staff_id = @staff_id AND a.request_json IS NOT NULL
    AND (a.state = 'open' OR @day_start IS NULL OR a.closed_at >= @day_start)
  ORDER BY (CASE WHEN a.state = 'open' THEN 0 ELSE 1 END), a.raised_at DESC, a.alert_id DESC`;

type Row = z.infer<typeof MyRequestRow>;

interface DbRow extends LockViewRow {
  step: number;
  state: 'open' | 'closed';
  close_reason: Row['close_reason'];
  decision: Row['decision'];
  closed_by_staff_id: string | null;
  closed_at: number | null;
  /** open rows: the current step's answerer people with their bound devices (JSON), else null */
  answerers_json: string | null;
}

/** A one-step holders kind: no escalation step, so §6.8's `step ≥ 2` never holds (01d To 02b R3-M-3). */
const oneStepHolders = (kind: AlertKind): boolean => kind.request?.right.mode === 'holders' && !kind.steps.some((s) => s.escalation === true);

/** BUG-10: some answerer has a route now (a staff screen socket, or a connected bound device; listed only for money). */
function answererReachable(json: string | null, kind: AlertKind, ws: WsHub, requester: string): boolean {
  const answerers = (json === null ? [] : (JSON.parse(json) as Array<{ staff_id: string; devices: string[] }>)).filter((a) => a.staff_id !== requester);
  if (answerers.length === 0) return false;
  const reaches = (deviceId: string): boolean => !listedDevicesOnly(kind) || isListedDevice(deviceId);
  const sessions = ws.connectedSessions();
  const alertSockets = ws.alertSockets();
  const connected = (deviceId: string): boolean => alertSockets.some((s) => s.deviceId === deviceId) || sessions.some((s) => s.deviceId === deviceId);
  return answerers.some(
    (a) => sessions.some((s) => s.kind === 'staff' && s.staffId === a.staff_id && reaches(s.deviceId)) || a.devices.some((d) => reaches(d) && connected(d)),
  );
}

/** §3.3 request states from the alert row (accept kinds share the values, with their own labels). */
function stateOf(row: DbRow): Row['state'] {
  if (row.state === 'open') return 'pending';
  if (row.close_reason === 'withdrawn') return 'withdrawn';
  if (row.close_reason === 'answered') {
    if (row.decision === 'approve' || row.decision === 'accept') return 'approved';
    if (row.decision === 'reject' || row.decision === 'decline') return 'rejected';
  }
  return 'closed';
}

function handle(ctx: QueryCtx, ws: WsHub): z.infer<typeof MyRequestsResponse> {
  return safeBuild('my-requests', () => build(ctx, ws));
}

function build(ctx: QueryCtx, ws: WsHub): z.infer<typeof MyRequestsResponse> {
  const staffId = ctx.session?.staff_id ?? null;
  if (staffId === null) throw new DomainError('SESSION_INVALID');
  const rows = ctx.db.prepare(SQL).all({ staff_id: staffId, day_start: dayStartOf(ctx.state) }) as DbRow[];
  const requests: Row[] = [];
  for (const row of rows) {
    const kind = kindOf(row.kind);
    if (kind === undefined) continue; // P-8: an unknown kind has no labels
    const answered = row.close_reason === 'answered';
    const end = row.state === 'open' ? ctx.now : (row.closed_at ?? ctx.now);
    requests.push(
      MyRequestRow.parse({
        alert_id: row.alert_id,
        kind: row.kind,
        state: stateOf(row),
        close_reason: row.close_reason,
        decision: answered ? row.decision : null,
        answerer_name: answered && row.closed_by_staff_id !== null ? (ctx.directory.get(row.closed_by_staff_id)?.display_name ?? null) : null,
        raised_at: row.raised_at,
        waiting_ms: Math.max(0, end - row.raised_at),
        ask_in_person: row.step >= 2 || (row.state === 'open' && oneStepHolders(kind) && !answererReachable(row.answerers_json, kind, ws, staffId)),
        lock: lockView(row, kind, Math.max(0, row.step)).lock,
      }),
    );
  }
  return { data: { requests } };
}

export function registerMyRequests(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'my-requests',
      sessionKind: 'device',
      session: 'required',
      countsAsActivity: false,
      querySchema: z.object({}),
      handle: (ctx) => handle(ctx, wsHubFor(app)),
    }),
  );
}
