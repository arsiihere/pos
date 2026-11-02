import { DomainError } from '@pos/domain';
import { MyRequestRow, MyRequestsResponse } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineQuery, queryRegistry, type QueryCtx } from '../../queries/registry.js';
import { dayStartOf } from '../catch-up.js';
import { kindOf } from '../kinds.js';
import { lockView, safeBuild, type LockViewRow } from '../ws-frames.js';

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
// Statements: 1 (index alerts_requester), prepared per call (AD-125). Runs on the read-only connection.
// countsAsActivity false. A build error other than a DomainError is rethrown as an AlertViewError (§7).

const SQL = `
  SELECT a.alert_id, a.kind, a.family, a.step, a.display_json, a.values_json, a.raised_at, a.state, a.close_reason,
         a.decision, a.closed_by_staff_id, a.closed_at
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

function handle(ctx: QueryCtx): z.infer<typeof MyRequestsResponse> {
  return safeBuild('my-requests', () => build(ctx));
}

function build(ctx: QueryCtx): z.infer<typeof MyRequestsResponse> {
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
        ask_in_person: row.step >= 2,
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
      handle: (ctx) => handle(ctx),
    }),
  );
}
