import { DomainError } from '@pos/domain';
import { RequestToAnswerRow, RequestsToAnswerResponse } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineQuery, queryRegistry, type QueryCtx } from '../../queries/registry.js';
import { dayStartOf, FROM_DAY_COLUMN, fromBusinessDay, NOT_HIDDEN, PERSON_COLUMNS, placeOf, seenByMe } from '../catch-up.js';
import { kindOf } from '../kinds.js';
import { mayAnswer, type AlertRequestPart } from '../targets.js';
import { cardRule, lockOnlyView, safeBuild, signedInView, type ViewRow } from '../ws-frames.js';

// 01d §6.9 `GET /queries/requests-to-answer` (AD-13: `data.requests`, view + can_answer + seen_by_me; BF-4 /
// AD-5 `from_business_day`).
// - Every open request I may answer now (§3.3 rules 5–6 with the directory in memory, not from the inbox; v0.5
//   #3, N3), `can_answer: true`, set = my latest step row's set, else `answerer` (a late approver has none).
// - Plus the open requests where I have an inbox row but may not answer now (informed, a lead's "for" rows, a
//   right removed after the step): read-only, `can_answer: false`, with my latest set (else `informed`).
// - ws-frames' one card rule (cardRule, AD-162 / AD-163), as the `alerts` catch-up: a row I may answer now
//   gets my signed-in view (card with details, AD-23 fields); a read-only row, or any row on a device that is
//   a device target of the request (a kiosk, an always-on tablet), gets the lock-only view. Each row + `seen_by_me`
//   (catch-up.ts seenByMe) + `from_business_day`.
// - Never a row hidden from this session or device (§3.10; a request is never hidden in practice, the filter
//   is the catch-up's). Order: raised_at, then alert_id (oldest waiting first).
// Statements: 2 ((1) every open request by index alerts_open_requests, with my latest set, my seen and the
// earlier day's date in the same statement; (2) my inbox rows of open requests), whatever the count; prepared
// per call (AD-125). Read-only connection; countsAsActivity false; AlertViewError on a build error (§7).

// (1) every open request
const OPEN_SQL = `
  SELECT a.alert_id, a.kind, a.family, a.step, a.display_json, a.details_json, a.values_json, a.request_json,
         a.raised_at, a.requester_staff_id,
         EXISTS (SELECT 1 FROM alert_recipients d WHERE d.device_id = @device_id AND d.alert_id = a.alert_id) AS to_device,
         ${PERSON_COLUMNS}, ${FROM_DAY_COLUMN}
  FROM alerts a
  WHERE a.state = 'open' AND a.request_json IS NOT NULL AND a.step >= 0 AND ${NOT_HIDDEN}
  ORDER BY a.raised_at, a.alert_id`;

// (2) my inbox rows of open requests
const INBOX_SQL = `
  SELECT i.alert_id FROM alert_inbox i JOIN alerts a ON a.alert_id = i.alert_id
  WHERE i.staff_id = @staff_id AND a.state = 'open' AND a.request_json IS NOT NULL`;

interface DbRow extends ViewRow {
  step: number;
  request_json: string;
  requester_staff_id: string | null;
  to_device: 0 | 1;
  mine_json: string | null;
  seen: 0 | 1;
  from_day: string | null;
}

function handle(ctx: QueryCtx, branchId: string): z.infer<typeof RequestsToAnswerResponse> {
  return safeBuild('requests-to-answer', () => build(ctx, branchId));
}

function build(ctx: QueryCtx, branchId: string): z.infer<typeof RequestsToAnswerResponse> {
  const session = ctx.session;
  if (session === undefined || session.staff_id === null || ctx.device === undefined) throw new DomainError('SESSION_INVALID');
  const staffId = session.staff_id;
  const open = ctx.db.prepare(OPEN_SQL).all({
    staff_id: staffId,
    session_id: session.session_id,
    device_id: ctx.device.device_id,
    day_start: dayStartOf(ctx.state),
    branch_id: branchId,
  }) as DbRow[];
  const inbox = new Set(ctx.db.prepare(INBOX_SQL).pluck().all({ staff_id: staffId }) as string[]);
  const requests: Array<z.infer<typeof RequestToAnswerRow>> = [];
  for (const row of open) {
    const kind = kindOf(row.kind);
    if (kind === undefined) continue; // P-8: an unknown kind has no labels
    const can = mayAnswer(ctx.directory, JSON.parse(row.request_json) as AlertRequestPart, row.requester_staff_id, staffId).ok;
    if (!can && !inbox.has(row.alert_id)) continue;
    const place = { escalation: kind.steps[row.step]?.escalation === true, ...placeOf(row.mine_json, can ? 'answerer' : 'informed') };
    const card = cardRule({ deviceTarget: row.to_device === 1, set: place.set, for_staff_id: place.for_staff_id, request: true, canAnswer: can });
    requests.push(
      RequestToAnswerRow.parse({
        ...(card ? signedInView(row, kind, row.step, place) : lockOnlyView(row, kind, row.step, place)),
        can_answer: can,
        seen_by_me: seenByMe(kind, 'open', row.seen),
        from_business_day: fromBusinessDay(row.from_day, row.raised_at),
      }),
    );
  }
  return { data: { requests } };
}

export function registerRequestsToAnswer(app: FastifyInstance, branchId: string): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'requests-to-answer',
      sessionKind: 'device',
      session: 'required',
      countsAsActivity: false,
      querySchema: z.object({}),
      handle: (ctx) => handle(ctx, branchId),
    }),
  );
}
