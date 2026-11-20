// 05 §6.26 `GET /queries/x-report` and `GET /queries/z-reports?business_date?|cursor&limit` (task 26b), B26, R-83,
// R-84. Permission `view-reports` (any grant: a read cannot be approved, as §6.23a / §6.27), the grant before any read.
//
// The X is the open day built through 26a's pure `buildReport` from the rows of fixed statements (§6.26: X ≤ 8):
//   1 invoices of the day (both series) with their tax rows, outbox state, the discount of a discounted sale
//     (the bill's last DiscountApplied before the invoice, by the events (stream_type, stream_id, seq) index) and a
//     credit's reason (the bill's last BillReopened before it);
//   2 the day's shifts with their takings;
//   3 petty-cash rows of the day's shifts + the advances not settled (any day);
//   4 the day's variance sign-offs + the pending sign-offs (any date);
//   5 the day's audit rows for voids, comps, comp removals, reopens, credits and full refunds (the events they map,
//     joined by event_id; "of the day" = after the day's BusinessDayOpened by seq (its audit row `day_opened`), the
//     recorded_at bound (01a S33: the same order as seq) only lets the action index narrow the range);
//   6 carried forward (live payments on open splits now), brought forward (the last earlier Z's carried forward: nothing
//     moves money between a close and the next open) and the carried orders of the day and of the previous day;
//   7 open bills (X only);
//   8 the staff names of every staff id in the report, from `staff_names` (X only; H16-5: names at render only).
// The Z build (`loadReportInput` with kind 'z', task 25's appender, §6.25 ≤ 6) runs statements 1–6 only.
// The Z list is 1 statement with a cursor (F §6.3), the stored `ZReportIssued.report` and its staff names.
// Logs carry ids only: `buildReport`'s warnings go to the hub log as { code, reopen_id, credit_invoice_id }.
import { buildReport, DomainError, type ReportDocInput, type ReportInput, type ReportWarning } from '@pos/domain';
import type { BranchConfig } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { StaffDirectory } from '../../auth/staff-directory.js';
import { tableLabel } from '../../kds/details.js';
import { defineQuery, queryRegistry, type QueryCtx } from '../../queries/registry.js';
import { hubBilling } from '../defaults.js';
import { NOT_IN_CORRECTIONS } from './open-bills.js';

type Warn = (w: ReportWarning) => void;

// ------------------------------------------------------------------------------------------------ statements

// 1. The day's invoices (invoices_day). The discount and the credit reason come from the bill's own stream, before the
// invoice's event (the outbox row's ord = that event's seq), so a discount applied on an earlier day still counts.
const INVOICES = `
SELECT i.invoice_id, i.series, i.bill_id, i.subtotal_minor, i.discount_minor, i.service_charge_minor, i.rounding_minor,
       i.total_minor, f.state AS fiscal_state,
       (SELECT json_group_array(json_object('tax_code', t.tax_code, 'label', t.label, 'tax_profile_id', t.tax_profile_id,
               'payment_class', t.payment_class, 'rate_bp', t.rate_bp, 'tax_minor', t.tax_minor))
          FROM invoice_taxes t WHERE t.invoice_id = i.invoice_id) AS taxes,
       CASE WHEN i.series = 'sale' AND i.discount_minor > 0 THEN (
         SELECT json_object('reason_code', json_extract(e.payload, '$.reason_code'),
                'requester_staff_id', json_extract(e.payload, '$.requester_staff_id'),
                'approver_staff_id', json_extract(e.payload, '$.approver_staff_id'))
           FROM events e WHERE e.stream_type = 'bill' AND e.stream_id = i.bill_id AND e.seq < f.ord AND e.event_type = 'DiscountApplied'
          ORDER BY e.seq DESC LIMIT 1) END AS discount,
       CASE WHEN i.series = 'credit' THEN (
         SELECT json_extract(e.payload, '$.reason_code')
           FROM events e WHERE e.stream_type = 'bill' AND e.stream_id = i.bill_id AND e.seq < f.ord AND e.event_type = 'BillReopened'
          ORDER BY e.seq DESC LIMIT 1) END AS credit_reason_code
FROM invoices i LEFT JOIN fiscal_outbox f ON f.invoice_id = i.invoice_id
WHERE i.business_date = @day
ORDER BY i.invoice_id`;
interface InvoiceRow {
  invoice_id: string;
  series: 'sale' | 'credit';
  bill_id: string;
  subtotal_minor: number;
  discount_minor: number;
  service_charge_minor: number;
  rounding_minor: number;
  total_minor: number;
  fiscal_state: ReportInput['invoices'][number]['fiscal_state'] | null;
  taxes: string;
  discount: string | null;
  credit_reason_code: string | null;
}

// 2. The day's shifts (shifts_day) with their takings rows.
const SHIFTS = `
SELECT s.shift_id, s.staff_id, s.float_minor, s.expected_cash_minor, s.counted_minor, s.variance_minor, s.count_skipped,
       s.variance_state,
       (SELECT json_group_array(json_object('mode_id', t.mode_id, 'taken_by_staff_id', t.taken_by_staff_id,
               'in_minor', t.in_minor, 'out_minor', t.out_minor, 'change_minor', t.change_minor))
          FROM shift_takings t WHERE t.shift_id = s.shift_id) AS takings
FROM shifts s WHERE s.business_date = @day
ORDER BY s.shift_id`;
interface ShiftRow {
  shift_id: string;
  staff_id: string;
  float_minor: number;
  expected_cash_minor: number;
  counted_minor: number | null;
  variance_minor: number | null;
  count_skipped: number;
  variance_state: 'pending' | 'approved' | 'disputed' | null;
  takings: string;
}

// 3. Petty cash on the day's shifts (petty_cash_shift) + every advance not settled (petty_cash_open).
const PETTY = `
SELECT 'day' AS src, p.kind, p.amount_minor, p.category_id, p.advance_staff_id, p.at
  FROM shifts s JOIN petty_cash p ON p.shift_id = s.shift_id WHERE s.business_date = @day
UNION ALL
SELECT 'open', p.kind, p.amount_minor, p.category_id, p.advance_staff_id, p.at
  FROM petty_cash p WHERE p.kind = 'advance' AND p.settled_at IS NULL`;
interface PettyRow {
  src: 'day' | 'open';
  kind: string;
  amount_minor: number;
  category_id: string | null;
  advance_staff_id: string | null;
  at: number;
}

// 4. Sign-offs answered in the day, any shift date (shift_signoffs_day) + pending sign-offs, any date (shifts_signoff_pending).
const SIGNOFFS = `
SELECT 'done' AS src, s.business_date AS shift_date, s.staff_id, s.variance_minor, o.outcome, o.approver_staff_id, o.signed_at
  FROM shift_signoffs o JOIN shifts s ON s.shift_id = o.shift_id WHERE o.business_date = @day
UNION ALL
SELECT 'pending', s.business_date, s.staff_id, s.variance_minor, NULL, NULL, NULL
  FROM shifts s WHERE s.variance_state = 'pending'`;
interface SignoffRow {
  src: 'done' | 'pending';
  shift_date: string;
  staff_id: string;
  variance_minor: number | null;
  outcome: string | null;
  approver_staff_id: string | null;
  signed_at: number | null;
}

// 5. The day's audit rows (audit_entries_action) for voids, comps, comp removals, reopens, credits and full refunds,
// with the events they map (by event_id), after the day's BusinessDayOpened seq; a BillClosedEmpty with the totals of
// its credit invoices.
const DAY_EVENTS = `
SELECT e.seq, e.event_id, e.event_type, e.payload,
       CASE WHEN e.event_type = 'BillClosedEmpty' THEN (
         SELECT json_group_array(c.total_minor) FROM invoices c
          WHERE c.invoice_id IN (SELECT value FROM json_each(e.payload, '$.credit_invoice_ids'))) END AS credit_totals
FROM audit_entries a JOIN events e ON e.event_id = a.event_id
WHERE a.action IN ('item_voided', 'line_comped', 'comp_removed', 'bill_reopened', 'invoice_credited', 'bill_closed_empty')
  AND a.recorded_at >= @opened_at
  AND a.seq > (SELECT MAX(d.seq) FROM audit_entries d WHERE d.action = 'day_opened')
ORDER BY e.seq`;
interface DayEventRow {
  seq: number;
  event_id: string;
  event_type: string;
  payload: string;
  credit_totals: string | null;
}

// 6. Carried forward: live payments on the open splits of the open bills (bills_open, bill_payments_split), with the
// staff of the payment's shift. Brought forward: the carried forward of the last Z before the day. Carried orders of
// the day (carried over) and of the last closed day (carried in), with what labels them.
const FORWARD = `
WITH prev AS (SELECT business_date, report_json FROM z_reports WHERE business_date < @day ORDER BY business_date DESC LIMIT 1)
SELECT 'cf' AS src, p.mode_id AS a, s.staff_id AS b, p.direction AS c, p.amount_minor AS n, NULL AS j
  FROM bills b JOIN bill_splits sp ON sp.bill_id = b.bill_id AND sp.state = 'open'
  JOIN bill_payments p ON p.bill_id = sp.bill_id AND p.split_no = sp.split_no AND p.removed_at IS NULL
  JOIN shifts s ON s.shift_id = p.shift_id
 WHERE b.state <> 'closed' AND b.absorbed_into IS NULL
UNION ALL
SELECT 'bf', NULL, NULL, NULL, NULL, json_extract(prev.report_json, '$.carried_forward') FROM prev
UNION ALL
SELECT 'co', c.business_date, c.order_id, NULL, NULL,
       json_object('order_type', o.order_type, 'token', o.token, 'car_number', o.car_number, 'business_date', o.business_date,
                   'table_id', ao.table_id)
  FROM carried_orders c LEFT JOIN orders o ON o.order_id = c.order_id LEFT JOIN audit_orders ao ON ao.order_id = c.order_id
 WHERE c.business_date = @day OR c.business_date = (SELECT business_date FROM prev)`;
interface ForwardRow {
  src: 'cf' | 'bf' | 'co';
  a: string | null;
  b: string | null;
  c: 'in' | 'out' | null;
  n: number | null;
  j: string | null;
}

// 7. (X only) the open bills as §6.2 lists them, in one statement: every open, non-absorbed `bills` row (bills_open),
// plus the projected rows (`bill_id` NULL) — every open seating with an unbilled, uncancelled order and no live bill
// row, and every takeaway / parking `bill_key` with such an order and no live bill row (its root order first) — with
// the table of the seating or the root order of the key. Orders kept by a corrections reopen belong to that bill only
// (open-bills.ts NOT_IN_CORRECTIONS), and a corrections bill does not stand for its seating / key (as §6.2).
const OPEN_BILLS = `
WITH ko AS (
  SELECT o.order_id, o.bill_key, o.order_type, o.token, o.car_number, o.business_date, o.placed_at FROM orders o
  WHERE o.order_type <> 'dine_in' AND o.bill_key IS NOT NULL AND o.cancelled_at IS NULL AND o.billed_at IS NULL AND ${NOT_IN_CORRECTIONS})
SELECT b.bill_id, b.order_type, b.opened_at, s.primary_table_id,
       CASE WHEN b.table_key IS NOT NULL THEN (
         SELECT json_object('order_type', o.order_type, 'token', o.token, 'car_number', o.car_number, 'business_date', o.business_date)
           FROM orders o WHERE o.bill_key = b.table_key ORDER BY o.placed_at, o.order_id LIMIT 1) END AS root
  FROM bills b LEFT JOIN seatings s ON s.seating_id = b.seating_id
 WHERE b.state <> 'closed' AND b.absorbed_into IS NULL
UNION ALL
SELECT NULL, 'dine_in', st.opened_at, st.primary_table_id, NULL
  FROM seatings st
 WHERE st.state <> 'CLOSED'
   AND EXISTS (SELECT 1 FROM seating_orders so JOIN orders o ON o.order_id = so.order_id
                WHERE so.seating_id = st.seating_id AND o.cancelled_at IS NULL AND o.billed_at IS NULL AND ${NOT_IN_CORRECTIONS})
   AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.seating_id = st.seating_id AND b.state <> 'closed' AND b.absorbed_into IS NULL
                     AND b.reopen_mode IS NOT 'corrections')
UNION ALL
SELECT NULL, r.order_type, r.placed_at, NULL,
       json_object('order_type', r.order_type, 'token', r.token, 'car_number', r.car_number, 'business_date', r.business_date)
  FROM ko r
 WHERE r.order_id = (SELECT x.order_id FROM ko x WHERE x.bill_key = r.bill_key ORDER BY x.placed_at, x.order_id LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.table_key = r.bill_key AND b.state <> 'closed' AND b.reopen_mode IS NOT 'corrections')`;
interface OpenBillRow {
  /** null = a projected row (§6.2) */
  bill_id: string | null;
  order_type: string;
  opened_at: number;
  primary_table_id: string | null;
  root: string | null;
}

// 8. (X only) names of the report's staff ids (leavers included).
const NAMES = `SELECT staff_id, display_name FROM staff_names WHERE staff_id IN (SELECT value FROM json_each(?))`;

// Z list (1): newest first by number, the stored report and the names of its staff ids (json_tree over the report).
const STAFF_KEYS = `('staff_id', 'requester_staff_id', 'approver_staff_id', 'taken_by_staff_id', 'advance_staff_id')`;
const Z_LIST = `
SELECT z.business_date, z.z_no, z.issued_at, z.report_json,
       (SELECT json_group_object(n.staff_id, n.display_name) FROM staff_names n
         WHERE n.staff_id IN (SELECT j.value FROM json_tree(z.report_json) j WHERE j.key IN ${STAFF_KEYS} AND j.type = 'text')) AS names
FROM z_reports z
WHERE (@business_date IS NULL OR z.business_date = @business_date) AND (@before IS NULL OR z.z_no < @before)
ORDER BY z.z_no DESC LIMIT @limit`;
interface ZRow {
  business_date: string;
  z_no: number;
  issued_at: number;
  report_json: string;
  names: string;
}

// ------------------------------------------------------------------------------------------------ the build

export interface ReportDay {
  kind: 'x' | 'z';
  z_no: number | null;
  business_date: string;
  /** The day's BusinessDayOpened `recorded_at` (01a S33: the day's start). */
  opened_at: number;
  issued_at: number;
}

const ORDER_LABEL_MAX = 40;

interface OrderFacts {
  order_type: string | null;
  token: number | null;
  car_number: string | null;
  business_date: string | null;
  table_id?: string | null;
}

/** The order's identifier as the open-bills list prints it (§6.2): table, `#token` (+ date when not today), plate. */
function orderLabel(o: OrderFacts, tableName: ReadonlyMap<string, string>, day: string, fallback: string): string {
  if (o.order_type === 'dine_in') {
    const t = o.table_id ?? null;
    return t === null ? fallback : tableLabel(tableName.get(t) ?? t).slice(0, ORDER_LABEL_MAX);
  }
  if (o.order_type === 'parking') return `PARKING ${o.car_number ?? ''}`.slice(0, ORDER_LABEL_MAX);
  if (o.order_type === 'takeaway') return (o.business_date === day ? `#${o.token ?? 0}` : `#${o.token ?? 0} ${o.business_date ?? ''}`).slice(0, ORDER_LABEL_MAX);
  return fallback;
}

/**
 * The `buildReport` input of one day, from statements 1–6 (+ 7 for an X): X 7, Z 6, fixed whatever the number of
 * invoices, shifts, payments or events. Names are not read (the report carries staff ids only, H16-5).
 */
export function loadReportInput(db: Database.Database, config: BranchConfig, day: ReportDay): ReportInput {
  const billing = hubBilling(config);
  const modeName = new Map(billing.settings.payment_modes.map((m) => [m.mode_id, m.name]));
  const categoryName = new Map(billing.settings.petty_categories.map((c) => [c.category_id, c.name]));
  const tableName = new Map(config.floors.flatMap((f) => f.tables).map((t) => [t.table_id, t.name]));
  const p = { day: day.business_date, opened_at: day.opened_at };

  const invoiceRows = db.prepare(INVOICES).all(p) as InvoiceRow[]; // 1
  const shiftRows = db.prepare(SHIFTS).all(p) as ShiftRow[]; // 2
  const pettyRows = db.prepare(PETTY).all(p) as PettyRow[]; // 3
  const signoffRows = db.prepare(SIGNOFFS).all(p) as SignoffRow[]; // 4
  const eventRows = db.prepare(DAY_EVENTS).all(p) as DayEventRow[]; // 5
  const forwardRows = db.prepare(FORWARD).all(p) as ForwardRow[]; // 6
  const openRows = day.kind === 'x' ? (db.prepare(OPEN_BILLS).all() as OpenBillRow[]) : []; // 7 (X only)

  const invoices: ReportInput['invoices'] = invoiceRows.map((r) => {
    if (r.fiscal_state === null) throw new Error(`report: invoice ${r.invoice_id} has no fiscal outbox row`);
    return {
      invoice_id: r.invoice_id,
      series: r.series,
      bill_id: r.bill_id,
      subtotal_minor: r.subtotal_minor,
      discount_minor: r.discount_minor,
      service_charge_minor: r.service_charge_minor,
      rounding_minor: r.rounding_minor,
      total_minor: r.total_minor,
      taxes: JSON.parse(r.taxes) as ReportInput['invoices'][number]['taxes'],
      fiscal_state: r.fiscal_state,
      discount: r.discount === null ? null : (JSON.parse(r.discount) as NonNullable<ReportInput['invoices'][number]['discount']>),
      credit_reason_code: r.credit_reason_code,
    };
  });

  const takings = shiftRows.flatMap((s) =>
    (JSON.parse(s.takings) as Array<{ mode_id: string; taken_by_staff_id: string; in_minor: number; out_minor: number; change_minor: number }>).map((t) => ({
      ...t,
      mode_name: modeName.get(t.mode_id) ?? t.mode_id,
    })),
  );

  // 5: voids, comps, comp removals; a reopen's credits are the InvoiceCredited events that follow its BillReopened on
  // the same bill (§6.13: one transaction, BillReopened first); the reopen id is the BillReopened event id (R-84).
  const voids: Array<ReportInput['voids'][number]> = [];
  const comps: Array<{ value_minor: number }> = [];
  const comp_removals: Array<{ comp_minor: number }> = [];
  const reopens: Array<{ reopen_id: string; requester_staff_id: string; approver_staff_id: string | null; credit_invoice_ids: string[] }> = [];
  const lastReopen = new Map<string, (typeof reopens)[number]>();
  const full_refunds: Array<{ bill_id: string; credit_totals_minor: number[] }> = [];
  for (const e of eventRows) {
    const pl = JSON.parse(e.payload) as Record<string, unknown>;
    switch (e.event_type) {
      case 'ItemVoided':
        voids.push({
          disposition: (pl['disposition'] as string | null | undefined) ?? null,
          units: pl['units'] as number,
          refund_minor: pl['refund_minor'] as number | undefined,
          comp_voided_minor: pl['comp_voided_minor'] as number | undefined,
        });
        break;
      case 'LineComped':
        comps.push({ value_minor: pl['value_minor'] as number });
        break;
      case 'LineCompRemoved':
        comp_removals.push({ comp_minor: pl['comp_minor'] as number });
        break;
      case 'BillReopened': {
        const r = {
          reopen_id: e.event_id,
          requester_staff_id: pl['requester_staff_id'] as string,
          approver_staff_id: (pl['approver_staff_id'] as string | null | undefined) ?? null,
          credit_invoice_ids: [] as string[],
        };
        reopens.push(r);
        lastReopen.set(pl['bill_id'] as string, r);
        break;
      }
      case 'InvoiceCredited':
        lastReopen.get(pl['bill_id'] as string)?.credit_invoice_ids.push(pl['invoice_id'] as string);
        break;
      case 'BillClosedEmpty':
        full_refunds.push({ bill_id: pl['bill_id'] as string, credit_totals_minor: e.credit_totals === null ? [] : (JSON.parse(e.credit_totals) as number[]) });
        break;
    }
  }

  const carried_forward: Array<ReportInput['carried_forward'][number]> = [];
  const brought_forward: Array<ReportInput['brought_forward'][number]> = [];
  const carried_over: Array<ReportInput['carried_over'][number]> = [];
  for (const r of forwardRows) {
    if (r.src === 'cf') {
      carried_forward.push({ mode_id: r.a!, mode_name: modeName.get(r.a!) ?? r.a!, shift_staff_id: r.b!, direction: r.c!, amount_minor: r.n! });
    } else if (r.src === 'bf') {
      // The earlier Z's rows are (mode_name, staff_id, in − out): each comes back as one signed payment of that mode
      // name (buildReport groups them again by the same key, so the rows equal that Z's carried forward).
      for (const row of r.j === null ? [] : (JSON.parse(r.j) as Array<{ mode_name: string; staff_id: string; amount_minor: number }>)) {
        brought_forward.push({
          mode_id: row.mode_name,
          mode_name: row.mode_name,
          shift_staff_id: row.staff_id,
          direction: row.amount_minor < 0 ? 'out' : 'in',
          amount_minor: Math.abs(row.amount_minor),
        });
      }
    } else {
      const facts = (r.j === null ? {} : JSON.parse(r.j)) as OrderFacts;
      carried_over.push({ label: orderLabel(facts, tableName, day.business_date, r.b!), carried_in: r.a !== day.business_date });
    }
  }

  const open_bills = openRows.map((b) => {
    const root = b.root === null ? null : (JSON.parse(b.root) as OrderFacts);
    const label = orderLabel(root ?? { order_type: b.order_type, token: null, car_number: null, business_date: null, table_id: b.primary_table_id }, tableName, day.business_date, b.bill_id ?? '');
    return { identifier: label, open_minutes: Math.max(0, Math.floor((day.issued_at - b.opened_at) / 60_000)) };
  });

  return {
    kind: day.kind,
    z_no: day.z_no,
    business_date: day.business_date,
    issued_at: day.issued_at,
    currency_code: config.currency_code,
    invoices,
    takings,
    comps,
    comp_removals,
    voids,
    reopens,
    full_refunds,
    petty: pettyRows
      .filter((r) => r.src === 'day')
      .map((r) => ({ category_name: (r.category_id === null ? null : categoryName.get(r.category_id)) ?? r.category_id ?? r.kind, kind: r.kind, amount_minor: r.amount_minor })),
    open_advances: pettyRows.filter((r) => r.src === 'open').map((r) => ({ staff_id: r.advance_staff_id ?? '', amount_minor: r.amount_minor, at: r.at })),
    shifts: shiftRows.map((s) => ({
      shift_id: s.shift_id,
      staff_id: s.staff_id,
      float_minor: s.float_minor,
      expected_cash_minor: s.expected_cash_minor,
      counted_minor: s.counted_minor,
      variance_minor: s.variance_minor,
      count_skipped: s.count_skipped === 1,
      variance_state: s.variance_state,
    })),
    variance_signoffs: signoffRows
      .filter((r) => r.src === 'done')
      .map((r) => ({ shift_date: r.shift_date, staff_id: r.staff_id, variance_minor: r.variance_minor ?? 0, outcome: r.outcome!, approver_staff_id: r.approver_staff_id, signed_at: r.signed_at! })),
    pending_signoffs: signoffRows.filter((r) => r.src === 'pending').map((r) => ({ shift_date: r.shift_date, staff_id: r.staff_id, variance_minor: r.variance_minor ?? 0 })),
    open_bills,
    open_bill_flag_minutes: billing.settings.open_bill_flag_minutes,
    carried_over,
    brought_forward,
    carried_forward,
  };
}

/** Every staff id a report names (H16-5: the report holds ids only). */
export function reportStaffIds(r: ReportDocInput): string[] {
  const ids = new Set<string>();
  const add = (id: string | null) => {
    if (id !== null && id !== '') ids.add(id);
  };
  for (const e of [...r.sales.discounts.entries, ...r.reopens.entries]) {
    add(e.requester_staff_id);
    add(e.approver_staff_id);
  }
  for (const x of [...r.open_advances, ...r.shifts, ...r.pending_signoffs, ...r.takings_by_taker, ...r.brought_forward, ...r.carried_forward]) add(x.staff_id);
  for (const v of r.variance_signoffs) {
    add(v.staff_id);
    add(v.approver_staff_id);
  }
  return [...ids].sort();
}

/** Names of the given ids from `staff_names` (1 statement). */
export function staffNamesOf(db: Database.Database, ids: readonly string[]): Record<string, string> {
  const rows = db.prepare(NAMES).all(JSON.stringify(ids)) as Array<{ staff_id: string; display_name: string }>;
  return Object.fromEntries(rows.map((r) => [r.staff_id, r.display_name]));
}

// ------------------------------------------------------------------------------------------------ the queries

export interface XReportView {
  report: ReportDocInput;
  /** staff_id → name, for every staff id in the report that `staff_names` knows */
  staff_names: Record<string, string>;
}

export interface ZReportView extends XReportView {
  business_date: string;
  z_no: number;
}

function requireViewReports(directory: StaffDirectory, staffId: string | null): void {
  const grant = staffId === null ? 'not_granted' : directory.resolve(staffId, 'view-reports').grant;
  if (grant !== 'allowed' && grant !== 'requires_approval') throw new DomainError('PERMISSION_DENIED', { permission: 'view-reports', grant });
}

/** §6.26 X: the open day through `buildReport`. 8 statements; 0 when refused. */
export function xReport(ctx: QueryCtx, warn?: Warn): XReportView {
  requireViewReports(ctx.directory, ctx.session?.staff_id ?? null);
  const day = ctx.state.business_day;
  if (day === null || day.closed_at !== null || ctx.branchConfig === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  const input = loadReportInput(ctx.db, ctx.branchConfig, { kind: 'x', z_no: null, business_date: day.business_date, opened_at: day.opened_at, issued_at: ctx.now }); // 1–7
  const report = buildReport(input, warn === undefined ? undefined : { warn });
  return { report, staff_names: staffNamesOf(ctx.db, reportStaffIds(report)) }; // 8
}

export const XReportQuery = z.object({}).strict();
export const ZReportsQuery = z
  .object({
    business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().optional(),
  })
  .strict();

const ZCursor = z.object({ z: z.number().int() }).strict();

function decodeZCursor(cursor: string | null): number | null {
  if (cursor === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    parsed = null;
  }
  const result = ZCursor.safeParse(parsed);
  if (!result.success) throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'cursor', message: 'cursor is not valid' }] });
  return result.data.z;
}

const encodeZCursor = (z_no: number): string => Buffer.from(JSON.stringify({ z: z_no })).toString('base64url');

/** §6.26 Z list: newest first, optionally the one Z of `business_date`; 1 statement; 0 when refused. */
export function zReports(ctx: QueryCtx, q: z.infer<typeof ZReportsQuery>): { data: { reports: ZReportView[] }; meta: { next_cursor: string | null } } {
  requireViewReports(ctx.directory, ctx.session?.staff_id ?? null);
  const before = decodeZCursor(ctx.page.cursor);
  const rows = ctx.db.prepare(Z_LIST).all({ business_date: q.business_date ?? null, before, limit: ctx.page.limit + 1 }) as ZRow[]; // 1
  const page = rows.slice(0, ctx.page.limit);
  const more = rows.length > ctx.page.limit;
  return {
    data: {
      reports: page.map((r) => ({
        business_date: r.business_date,
        z_no: r.z_no,
        report: JSON.parse(r.report_json) as ReportDocInput,
        staff_names: JSON.parse(r.names) as Record<string, string>,
      })),
    },
    meta: { next_cursor: more ? encodeZCursor(page.at(-1)!.z_no) : null },
  };
}

export function registerReportQueries(app: FastifyInstance): void {
  // R-84 (2): ids only, never a name or an amount
  const warn: Warn = (w) => app.log.warn({ code: w.code, reopen_id: w.reopen_id, credit_invoice_id: w.credit_invoice_id }, 'billing.report_warning');
  queryRegistry(app).register(
    defineQuery({
      resource: 'x-report',
      sessionKind: 'device',
      session: 'required',
      querySchema: XReportQuery,
      handle: (ctx) => ({ data: xReport(ctx, warn) }),
    }),
  );
  queryRegistry(app).register(
    defineQuery({
      resource: 'z-reports',
      sessionKind: 'device',
      session: 'required',
      querySchema: ZReportsQuery,
      handle: (ctx, q) => zReports(ctx, q),
    }),
  );
}
