// 05 §6.25, §3.13, B25 (task 25; 05-plan §3 row 25, G-74, G-77, R-76): 05's day-close guard and appender on 01a's
// `CloseBusinessDay` lists (rows A-3, A-4; commands/close-business-day.ts), registered by registerBilling after 04's
// void guard (registerVoids runs first in buildHubServer), so 04's `void_pending` answers before any 05 reason.
// Guard, in this order, the first hit refuses `409 DAY_CLOSE_BLOCKED` (≤ 40 listed, `count` via `COUNT(*) OVER ()`):
//   'shift_open'        open shifts of any day (1, `shifts_open_staff`);
//   'variance_pending'  shifts of any day with a pending sign-off (1, `shifts_signoff_pending`; R-76);
//   'unbilled_orders'   orders with billed_at and cancelled_at NULL, not carried for the open day (1).
// Appender (row A-4), drafts in this order: `AlertClosed { reason: 'obsolete', note: 'day_closed' }` (+ 01d's
// request_result raises) for every open 05 request but `shift_variance` (none is open here, R-76) and every open 02b
// `comp` and `hand_over_unpaid` request (⚠️ run 3 R3-M-4); then `ZReportIssued { business_date, z_no, report }` (hub stream; `report` = buildReport's Z).
// 01a then appends 03a's releases and BusinessDayClosed.
// Statements (01d's closeMany / raiseMany excluded: their own bound): the guard ≤ 3 (it stops at its first hit); the
// appender 8 — open requests (1, `alerts.listOpen`), Z number (1), buildReport's facts through 26b's loadReportInput
// (6, its Z statements 1–6). Bound ≤ 11 (v1.0.18): 3 + 8 = 11.
import { buildReport, type ReportWarning } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import { draftOf, ZReportIssued, ZReportIssuedPayload, type EventDraft } from '@pos/events';
import type Database from 'better-sqlite3';
import { alerts } from '../../alerts/raise.js';
import type { DayCloseAppender, DayCloseGuard } from '../../commands/close-business-day.js';
import type { CommandCtx } from '../../commands/registry.js';
import type { Clock } from '../../lib/clock.js';
import { COMP_KIND } from '../../orders/line-change.js';
import type { ReadOrderHead } from '../../orders/exports.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { voidIdentifier } from '../../voids/identifier.js';
import { BILL_REQUEST_KINDS, HAND_OVER_UNPAID_KIND } from '../kinds/values.js';
import { loadReportInput } from '../queries/reports.js';

/** §3.13: at most this many rows listed per reason; `count` is all of them. */
export const DAY_CLOSE_LISTED = 40;

// The guard has no clock of its own (01a's `DayCloseGuard` takes `(db, state)`), so `open_minutes` reads the hub clock
// bound by registerBilling, the bindBillPrints pattern; the appender's buildReport warnings go to the bound logger.
// Unbound (a unit call) → 0 minutes, warnings dropped.
/** ids-only warning fields: buildReport's (R-84 (2)) or the skipped Z's (R-85). */
type WarnFields = ReportWarning | { code: 'z_skipped_no_config'; business_date: string };
type WarnLog = (fields: WarnFields, msg: string) => void;
let hubClock: Clock | null = null;
let warnLog: WarnLog | null = null;

/** registerBilling: the clock `open_minutes` is measured on and the logger of buildReport's warnings. */
export function bindDayClose(o: { clock: Clock; warn: WarnLog }): void {
  hubClock = o.clock;
  warnLog = o.warn;
}

// ------------------------------------------------------------------------------------------------ guard reads

// §3.13 'shift_open': `{ shift_id, staff_name, opened_at, is_drawer }`, oldest first. Names from `staff_names` (never
// stored with the shift, H16-5). 1 statement.
const OPEN_SHIFTS = `SELECT s.shift_id, n.display_name AS staff_name, s.opened_at, s.drawer_device_id IS NOT NULL AS is_drawer,
       COUNT(*) OVER () AS count
  FROM shifts s LEFT JOIN staff_names n ON n.staff_id = s.staff_id
  WHERE s.state = 'open'
  ORDER BY s.opened_at, s.shift_id
  LIMIT ${DAY_CLOSE_LISTED}`;

// §3.13 'variance_pending' (R-76): `{ shift_id, staff_name, closed_at, alert_id }`, `alert_id` = `variance_alert_id`,
// oldest close first. 1 statement (`shifts_signoff_pending`).
const PENDING_SIGNOFFS = `SELECT s.shift_id, n.display_name AS staff_name, s.closed_at, s.variance_alert_id AS alert_id,
       COUNT(*) OVER () AS count
  FROM shifts s LEFT JOIN staff_names n ON n.staff_id = s.staff_id
  WHERE s.variance_state = 'pending'
  ORDER BY s.closed_at, s.shift_id
  LIMIT ${DAY_CLOSE_LISTED}`;

// 02b §3.4 `billed_minor` per line (a copy of orders/exports.ts BILLED: 02b does not export the SQL text and 05 edits
// no 02b file): item / option_child = refundable − comp − comp_voided − removed − refund; deal_part = 0; deal =
// line_total − Σ its parts' money out. A pending weight contributes 0.
const BILLED = `CASE l.line_kind
    WHEN 'deal_part' THEN 0
    WHEN 'deal' THEN COALESCE(l.line_total_minor, 0) - COALESCE(
      (SELECT SUM(p.comp_minor + p.comp_voided_minor + p.removed_minor + p.refund_minor)
         FROM order_lines p WHERE p.order_id = l.order_id AND p.parent_order_item_id = l.order_item_id AND p.line_kind = 'deal_part'), 0)
    ELSE l.refundable_minor - l.comp_minor - l.comp_voided_minor - l.removed_minor - l.refund_minor
  END`;

// §3.13 'unbilled_orders': `{ order_id, identifier, total_minor, placed_at, open_minutes }`, oldest first; any business
// date (an earlier day's order carried yesterday blocks again unless carried today, #63c). `total_minor` = Σ the
// order's lines' 02b billed_minor; the identifier's parts (the seating's current tables, 02a read-only join). 1 statement.
const UNBILLED = `WITH u AS (
  SELECT o.order_id, o.order_type, o.business_date, o.token, o.car_number, o.car_type, o.placed_at, COUNT(*) OVER () AS count
    FROM orders o
   WHERE o.billed_at IS NULL AND o.cancelled_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM carried_orders c WHERE c.order_id = o.order_id AND c.business_date = @day)
   ORDER BY o.placed_at, o.order_id
   LIMIT ${DAY_CLOSE_LISTED})
SELECT u.*, s.primary_table_id,
       (SELECT json_group_array(st.table_id ORDER BY st.joined_at, st.table_id)
          FROM seating_tables st WHERE st.seating_id = so.seating_id) AS table_ids_json,
       (SELECT COALESCE(SUM(${BILLED}), 0) FROM order_lines l WHERE l.order_id = u.order_id) AS total_minor
  FROM u
  LEFT JOIN seating_orders so ON so.order_id = u.order_id
  LEFT JOIN seatings s ON s.seating_id = so.seating_id
 ORDER BY u.placed_at, u.order_id`;

interface ShiftRow {
  shift_id: string;
  staff_name: string | null;
  opened_at: number;
  is_drawer: number;
  count: number;
}

interface SignoffRow {
  shift_id: string;
  staff_name: string | null;
  closed_at: number | null;
  alert_id: string | null;
  count: number;
}

interface UnbilledRow {
  order_id: string;
  order_type: ReadOrderHead['order_type'];
  business_date: string;
  token: number | null;
  car_number: string | null;
  car_type: ReadOrderHead['car_type'];
  placed_at: number;
  count: number;
  primary_table_id: string | null;
  table_ids_json: string | null;
  total_minor: number;
}

/** §3.5 (04) identifier text of a listed order: the void card's, so the two day-close lists read alike. 0 statements. */
function identifierOf(state: Readonly<EngineState>, r: UnbilledRow): string {
  const head: ReadOrderHead = {
    order_id: r.order_id,
    order_type: r.order_type,
    placed_by: '',
    billed_at: null,
    business_date: r.business_date,
    token: r.token,
    car_number: r.car_number,
    car_type: r.car_type,
    seating_id: null,
    primary_table_id: r.primary_table_id,
    holder_staff_id: null,
    seating_state: null,
    table_ids: r.table_ids_json === null ? [] : (JSON.parse(r.table_ids_json) as string[]),
  };
  return voidIdentifier(state, head);
}

/**
 * §6.25 05 guard (rows A-3, R-76): `shift_open`, then `variance_pending`, then `unbilled_orders`; the first hit refuses
 * `DAY_CLOSE_BLOCKED { reason, <list>, count }`, else null. ≤ 3 statements.
 */
export const billingDayCloseGuard: DayCloseGuard = (db: Database.Database, state: Readonly<EngineState>) => {
  const open = db.prepare(OPEN_SHIFTS).all() as ShiftRow[]; // 1
  if (open.length > 0) {
    return {
      code: 'DAY_CLOSE_BLOCKED',
      details: {
        reason: 'shift_open',
        shifts: open.map((r) => ({ shift_id: r.shift_id, staff_name: r.staff_name, opened_at: r.opened_at, is_drawer: r.is_drawer === 1 })),
        count: open[0]!.count,
      },
    };
  }
  const pending = db.prepare(PENDING_SIGNOFFS).all() as SignoffRow[]; // 2
  if (pending.length > 0) {
    return {
      code: 'DAY_CLOSE_BLOCKED',
      details: {
        reason: 'variance_pending',
        shifts: pending.map((r) => ({ shift_id: r.shift_id, staff_name: r.staff_name, closed_at: r.closed_at, alert_id: r.alert_id })),
        count: pending[0]!.count,
      },
    };
  }
  const day = state.business_day?.business_date ?? null;
  const unbilled = db.prepare(UNBILLED).all({ day }) as UnbilledRow[]; // 3
  if (unbilled.length === 0) return null;
  const now = hubClock?.branchNow() ?? null;
  return {
    code: 'DAY_CLOSE_BLOCKED',
    details: {
      reason: 'unbilled_orders',
      orders: unbilled.map((r) => ({
        order_id: r.order_id,
        identifier: identifierOf(state, r),
        total_minor: r.total_minor,
        placed_at: r.placed_at,
        open_minutes: now === null ? 0 : Math.max(0, Math.floor((now - r.placed_at) / 60_000)),
      })),
      count: unbilled[0]!.count,
    },
  };
};

// ------------------------------------------------------------------------------------------------ appender

/**
 * §3.13: the 05 request kinds the appender closes (`shift_variance` is never open at a close, R-76) + 02b's `comp` and
 * ⚠️ run 3 (R3-M-4) 02b's `hand_over_unpaid` (§6.25; carried orders included): one closeMany from the one open list.
 */
const CLOSED_AT_DAY_CLOSE: ReadonlySet<string> = new Set([...BILL_REQUEST_KINDS.filter((k) => k !== 'shift_variance'), COMP_KIND, HAND_OVER_UNPAID_KIND]);

// The next Z number: MAX + 1. 1 statement. (The last Z's carried forward, today's brought forward, is 26b's
// loadReportInput statement 6.)
const Z_NO = `SELECT COALESCE(MAX(z_no), 0) + 1 FROM z_reports`;

/**
 * §6.25 05 appender (row A-4): `AlertClosed` (obsolete, `day_closed`) for the open 05 and 02b comp / hand_over_unpaid requests, then
 * `ZReportIssued`. buildReport's warnings (R-84 (2)) are logged with ids only and never block. 8 statements.
 */
export const billingDayCloseAppender: DayCloseAppender = (ctx: CommandCtx): EventDraft[] => {
  const open = alerts.listOpen(ctx.tx.db, {}).filter((a) => CLOSED_AT_DAY_CLOSE.has(a.kind)); // 1
  const closes = open.length === 0 ? [] : alerts.closeMany(ctx, open.map((a) => ({ alert_id: a.alert_id, reason: 'obsolete' as const, note: 'day_closed' })));

  const day = ctx.state.business_day!;
  const config = branchConfig();
  // ⚠️ 05 v1.0.24 (R-85): no branch config → no Z (it cannot be built: modes, categories, tables); the close still
  // succeeds (01a A-14: a close needs no stock context), a warning with ids only is logged. 1 statement.
  if (config === null) {
    warnLog?.({ code: 'z_skipped_no_config', business_date: day.business_date }, 'z report skipped: no branch config');
    return closes;
  }
  const z_no = ctx.tx.db.prepare(Z_NO).pluck().get() as number; // 2
  // 26b's loader, in this transaction: its Z statements 1–6 (§6.25 buildReport ≤ 6)
  const input = loadReportInput(ctx.tx.db, config, { kind: 'z', z_no, business_date: day.business_date, opened_at: day.opened_at, issued_at: ctx.clock.branchNow() }); // 3–8
  const report = buildReport(input, {
    // R-84 (2): ids only (the reopen and the missing credit), never an amount or a name
    warn: (w) => warnLog?.({ code: w.code, reopen_id: w.reopen_id, credit_invoice_id: w.credit_invoice_id }, 'z report: reopen credit missing'),
  });
  const payload = ZReportIssuedPayload.parse({ business_date: day.business_date, z_no, report });
  const issued = draftOf(ZReportIssued, {
    stream_type: 'hub',
    stream_id: ctx.branch.branchId,
    payload,
    occurred_at: ctx.clock.branchNow(),
    actor_id: ctx.actor.staffId,
    device_id: ctx.actor.deviceId,
  });
  return [...closes, issued];
};
