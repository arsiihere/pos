import { DomainError } from '@pos/domain';
import { AlertInboxRow, AlertsInboxResponse } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { StaffDirectory } from '../../auth/staff-directory.js';
import { defineQuery, queryRegistry, type QueryCtx } from '../../queries/registry.js';
import { placeOf, seenByMe } from '../catch-up.js';
import { kindOf, PERSONAL_NOTICE_KINDS } from '../kinds.js';
import { mayAnswer, type AlertRequestPart } from '../targets.js';
import { safeBuild, signedInView, type ViewRow } from '../ws-frames.js';

// 01d §6.7 `GET /queries/alerts-inbox` (AD-13 containers `data.alerts`, `meta.next_cursor`; AD-22 state and
// close_reason on each row).
// - Rows: the alerts where this person is in `alert_inbox` (a lead's "for <report>" rows included, §3.4.3)
//   raised in the current business day (since the latest BusinessDayOpened; every row when no day was ever
//   opened), plus the person's OPEN personal notices of earlier days (§3.10, §12.4), minus the alerts hidden
//   from this session or this device (`hidden_session_id` / `hidden_device_id`, §3.10).
// - Order: open `action` alerts first, then `raised_at` desc (alert_id desc breaks ties). Keyset cursor over
//   (group, raised_at, alert_id); `limit` default 50, max 200 (pageParams).
// - Each row is the person's own signed-in view (ws-frames' one builder: card with details, AD-23 fields,
//   AD-82 outcome) + `seen_by_me` (request_seen, or an AlertSeen receipt; false on an open `closes_on: 'seen'`
//   alert, catch-up.ts seenByMe, §3.10), `moved_to_name`,
//   `for_staff_name` (directory, in memory), `state`, `close_reason`.
// Statements: 2 ((1) the page of ids by alert_inbox's primary key, (2) the views joined for those ids),
// whatever the page size, prepared per call (AD-125: the statement cache is for the tick, projections and raise
// only). Runs on the read-only connection (ctx.db). countsAsActivity false. A build error other than a
// DomainError is rethrown as an AlertViewError (name and code only, §7) for the HTTP error handler's log.

const Query = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().optional() });

const NOT_HIDDEN = `(a.hidden_session_id IS NULL OR a.hidden_session_id <> @session_id)
   AND (a.hidden_device_id IS NULL OR a.hidden_device_id <> @device_id)`;
const GROUP = `(CASE WHEN a.state = 'open' AND a.family = 'action' THEN 0 ELSE 1 END)`;

// (1) the page: ordering keys only
const PAGE_SQL = `
  SELECT a.alert_id, a.raised_at, ${GROUP} AS grp
  FROM alert_inbox i JOIN alerts a ON a.alert_id = i.alert_id
  WHERE i.staff_id = @staff_id
    AND (@day_start IS NULL OR a.raised_at >= @day_start
         OR (a.state = 'open' AND a.kind IN (SELECT value FROM json_each(@personal))))
    AND ${NOT_HIDDEN}
    AND (@c_grp IS NULL OR ${GROUP} > @c_grp
         OR (${GROUP} = @c_grp AND (a.raised_at < @c_at OR (a.raised_at = @c_at AND a.alert_id < @c_id))))
  ORDER BY grp, a.raised_at DESC, a.alert_id DESC
  LIMIT @limit`;

// (2) the views of the page's ids
const VIEWS_SQL = `
  SELECT a.alert_id, a.kind, a.family, a.step, a.display_json, a.details_json, a.values_json, a.request_json,
         a.raised_at, a.requester_staff_id, a.state, a.close_reason, i.moved_to,
         (SELECT json_group_array(json_object('for_staff_id', r.for_staff_id, 'set', r.recipient_set))
            FROM alert_recipients r
           WHERE r.alert_id = a.alert_id AND r.staff_id = @staff_id
             AND r.step = (SELECT MAX(r2.step) FROM alert_recipients r2 WHERE r2.alert_id = a.alert_id AND r2.staff_id = @staff_id)
         ) AS mine_json,
         (EXISTS (SELECT 1 FROM request_seen s WHERE s.alert_id = a.alert_id AND s.staff_id = @staff_id)
          OR EXISTS (SELECT 1 FROM alert_receipts k WHERE k.alert_id = a.alert_id AND k.staff_id = @staff_id AND k.kind = 'seen')) AS seen
  FROM alerts a JOIN alert_inbox i ON i.alert_id = a.alert_id AND i.staff_id = @staff_id
  WHERE a.alert_id IN (SELECT value FROM json_each(@ids))`;

interface PageRow {
  alert_id: string;
  raised_at: number;
  grp: 0 | 1;
}

interface ViewDbRow extends ViewRow {
  step: number;
  requester_staff_id: string | null;
  state: 'open' | 'closed';
  close_reason: z.infer<typeof AlertInboxRow>['close_reason'];
  moved_to: string | null;
  mine_json: string | null;
  seen: 0 | 1;
}

interface Cursor {
  grp: 0 | 1;
  at: number;
  id: string;
}

const CursorSchema = z.object({ g: z.union([z.literal(0), z.literal(1)]), t: z.number().int(), i: z.string().min(1) }).strict();

function encodeCursor(row: PageRow): string {
  return Buffer.from(JSON.stringify({ g: row.grp, t: row.raised_at, i: row.alert_id })).toString('base64url');
}

function decodeCursor(cursor: string | null): Cursor | null {
  if (cursor === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    parsed = null;
  }
  const result = CursorSchema.safeParse(parsed);
  if (!result.success) throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'cursor', message: 'cursor is not valid' }] });
  return { grp: result.data.g, at: result.data.t, id: result.data.i };
}

/** A person's display name from the directory (staff with a PIN, else the no-PIN cache); null when gone. */
function nameOf(directory: StaffDirectory, noPin: Map<string, string>, staffId: string | null): string | null {
  if (staffId === null) return null;
  return directory.get(staffId)?.display_name ?? noPin.get(staffId) ?? null;
}

function handle(ctx: QueryCtx): z.infer<typeof AlertsInboxResponse> {
  return safeBuild('alerts-inbox', () => buildInbox(ctx));
}

function buildInbox(ctx: QueryCtx): z.infer<typeof AlertsInboxResponse> {
  const session = ctx.session;
  if (session === undefined || session.staff_id === null || ctx.device === undefined) throw new DomainError('SESSION_INVALID');
  const staffId = session.staff_id;
  const cursor = decodeCursor(ctx.page.cursor);
  const day = ctx.state.business_day;
  const page = ctx.db.prepare(PAGE_SQL).all({
    staff_id: staffId,
    session_id: session.session_id,
    device_id: ctx.device.device_id,
    day_start: day === null ? null : day.opened_at,
    personal: JSON.stringify(PERSONAL_NOTICE_KINDS),
    c_grp: cursor?.grp ?? null,
    c_at: cursor?.at ?? null,
    c_id: cursor?.id ?? null,
    limit: ctx.page.limit + 1,
  }) as PageRow[];
  const more = page.length > ctx.page.limit;
  const rows = more ? page.slice(0, ctx.page.limit) : page;
  const views = ctx.db.prepare(VIEWS_SQL).all({ staff_id: staffId, ids: JSON.stringify(rows.map((r) => r.alert_id)) }) as ViewDbRow[];
  const byId = new Map(views.map((v) => [v.alert_id, v]));
  const directory = ctx.directory;
  let noPin: Map<string, string> | undefined;
  const names = (): Map<string, string> => (noPin ??= new Map(directory.noPinStaff().map((s) => [s.staff_id, s.display_name])));

  const alerts: Array<z.infer<typeof AlertInboxRow>> = [];
  for (const r of rows) {
    const v = byId.get(r.alert_id);
    const kind = v === undefined ? undefined : kindOf(v.kind);
    if (v === undefined || kind === undefined) continue; // P-8: an unknown kind has no labels
    const step = Math.max(0, v.step);
    // a late answerer's inbox row (RequestSeen, N3) has no recipient row: answerer if they may answer now
    const request = v.request_json === null ? null : (JSON.parse(v.request_json) as AlertRequestPart);
    const fallback = request === null ? 'recipient' : mayAnswer(directory, request, v.requester_staff_id, staffId).ok ? 'answerer' : 'informed';
    const place = { escalation: kind.steps[step]?.escalation === true, ...placeOf(v.mine_json, fallback) };
    alerts.push(
      AlertInboxRow.parse({
        ...signedInView(v, kind, step, place),
        seen_by_me: seenByMe(kind, v.state, v.seen),
        moved_to_name: v.moved_to === null ? null : nameOf(directory, names(), v.moved_to),
        for_staff_name: nameOf(directory, names(), place.for_staff_id),
        state: v.state,
        close_reason: v.close_reason,
      }),
    );
  }
  const last = rows[rows.length - 1];
  return { data: { alerts }, meta: { next_cursor: more && last !== undefined ? encodeCursor(last) : null } };
}

export function registerAlertsInbox(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'alerts-inbox',
      sessionKind: 'device',
      session: 'required',
      countsAsActivity: false,
      querySchema: Query,
      handle: (ctx) => handle(ctx),
    }),
  );
}
