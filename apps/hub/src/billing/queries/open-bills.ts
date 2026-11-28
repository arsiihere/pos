// 05 §6.2 `GET /queries/open-bills?floor_id?` (task 10; H1-21, H2-10, H2-25, H6-9, H6-18, J-2). Every non-closed,
// non-absorbed `bills` row whatever its seating's state, plus every open seating with an order that is neither billed nor
// cancelled and every `bill_key` (takeaway / parking) with such an order, one row per key, projected rows with
// `bill_id: null`. 3 statements whatever the counts (#91): open seatings with their lines; unbilled non-table orders by
// bill_key with their lines; bills ⋈ payment sums (+ closed units, discount lines, own lines of a corrections reopen,
// open requests), lines as JSON rows (the spec's per-profile sums are taken in memory by compute). Totals: the pure
// `computeBill` (half up per tax of each profile's list,
// capped discount spread), fed the same per-line rows in the same order through the bill view's `openComputeLines`, so
// the total equals the bill view's except pending voids, which the list does not subtract ("before pending voids").
import { computeBill, DomainError, type ComputeDiscount, type ComputeLine, type ComputePayment, type ComputeRules } from '@pos/domain';
import type { BranchConfig } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { StaffDirectory } from '../../auth/staff-directory.js';
import { tableLabel } from '../../kds/details.js';
import { defineQuery, queryRegistry, type QueryCtx } from '../../queries/registry.js';
import { billingAt, type BillDiscountState, type BillOrderType, type BillRounding } from '../commands/ensure-bill.js';
import type { HubBilling } from '../defaults.js';
import { BILL_REQUEST_KINDS, openComputeLines, planOf } from './bill.js';

// 02b §3.4 billed_minor per line (the same expression as orders/exports.ts BILLED, which 02b does not export), with the
// §3.1 base rules on top: a deal part and a return line 0, never below 0. Pinned against the bill view by the tests.
export const LINE_BASE = `CASE WHEN l.line_kind = 'deal_part' OR l.return_of IS NOT NULL THEN 0 ELSE MAX(0, CASE l.line_kind
    WHEN 'deal' THEN COALESCE(l.line_total_minor, 0) - COALESCE(
      (SELECT SUM(p.comp_minor + p.comp_voided_minor + p.removed_minor + p.refund_minor)
         FROM order_lines p WHERE p.order_id = l.order_id AND p.parent_order_item_id = l.order_item_id AND p.line_kind = 'deal_part'), 0)
    ELSE l.refundable_minor - l.comp_minor - l.comp_voided_minor - l.removed_minor - l.refund_minor
  END) END`;

/** Orders kept by a corrections reopen (§3.10) belong to that bill only (its bill_orders), never to the seating / key's. */
export const NOT_IN_CORRECTIONS = `NOT EXISTS (SELECT 1 FROM bill_orders bo JOIN bills x ON x.bill_id = bo.bill_id
  WHERE bo.order_id = o.order_id AND x.reopen_mode = 'corrections' AND x.state <> 'closed')`;

/**
 * The lines of `orders` (a FROM clause naming `o` and the joined `l`) as JSON rows, in the bill view's order (orders by
 * placed_at, order_id; lines by added_at, insertion): id, kind, profile, §3.1 base, live units, unit price (H6-18).
 */
export const lineRows = (from: string): string => `(SELECT json_group_array(json_object('id', z.id, 'k', z.k, 'p', z.p, 'b', z.b, 'u', z.u, 'up', z.up)) FROM (
  SELECT l.order_item_id AS id, l.line_kind AS k, l.tax_profile_id AS p, ${LINE_BASE} AS b,
         l.units - l.removed_units - l.voided_units AS u, l.unit_price_minor AS up
  FROM ${from} ORDER BY o.placed_at, o.order_id, l.added_at, l.rowid) z)`;

/**
 * ⚠️ 05 v1.0.35 §6.2, §6.2a (run 3 R3-B-1): the columns of bill `b`'s split plan — the number of its split rows, its
 * closed splits' Σ rounding (⚠️ v1.0.36 §3.8, QA BUG-1: the open remainder is rounded with it) and its
 * OPEN splits in split order, each with its plan, item-plan rows and live payments (class, direction, amount, tendered),
 * each collection aggregated in its own subquery (no join multiplies lines by payments). Read by `openPart`.
 */
export const OPEN_SPLIT_COLUMNS = `(SELECT COUNT(*) FROM bill_splits s WHERE s.bill_id = b.bill_id) AS split_count,
  COALESCE((SELECT SUM(i.rounding_minor) FROM bill_splits bs JOIN invoices i ON i.invoice_id = bs.invoice_id
            WHERE bs.bill_id = b.bill_id AND bs.state = 'closed'), 0) AS closed_rounding,
  (SELECT json_group_array(json_object('split_no', s.split_no, 'plan_json', s.plan_json,
            'plan_lines_json', json((SELECT json_group_array(json_object('order_item_id', pl.order_item_id, 'units', pl.units))
                                  FROM (SELECT order_item_id, units FROM bill_split_lines
                                        WHERE bill_id = s.bill_id AND split_no = s.split_no ORDER BY order_item_id) pl)),
            'payments', json((SELECT json_group_array(json_object('c', p.payment_class, 'd', p.direction, 'a', p.amount_minor, 't', p.tendered_minor))
                                FROM bill_payments p WHERE p.bill_id = s.bill_id AND p.split_no = s.split_no AND p.removed_at IS NULL))))
     FROM (SELECT * FROM bill_splits WHERE bill_id = b.bill_id AND state = 'open' ORDER BY split_no) s) AS open_splits`;

// 1: one row always (the business date of billing_day), then one per open seating with its unbilled orders' sums.
const SEATINGS = `
WITH so AS (
  SELECT so.seating_id, o.order_id FROM seating_orders so JOIN orders o ON o.order_id = so.order_id
  WHERE o.cancelled_at IS NULL AND o.billed_at IS NULL AND ${NOT_IN_CORRECTIONS})
SELECT (SELECT business_date FROM billing_day WHERE k = 1) AS billing_date, (SELECT COALESCE(MAX(seq), 0) FROM events) AS as_of_seq,
       s.seating_id, s.primary_table_id, s.holder_staff_id, s.opened_at, s.bill_requested_at,
       (SELECT COUNT(*) FROM so x WHERE x.seating_id = s.seating_id) AS order_count,
       ${lineRows(`so x JOIN orders o ON o.order_id = x.order_id JOIN order_lines l ON l.order_id = o.order_id WHERE x.seating_id = s.seating_id`)} AS sums
FROM (SELECT 1) one LEFT JOIN seatings s ON s.state <> 'CLOSED'`;

// 2: unbilled, uncancelled takeaway / parking orders by bill_key (02b row Q-6), root order first.
const KEYS = `
WITH ko AS (
  SELECT o.* FROM orders o
  WHERE o.order_type <> 'dine_in' AND o.bill_key IS NOT NULL AND o.cancelled_at IS NULL AND o.billed_at IS NULL AND ${NOT_IN_CORRECTIONS})
SELECT k.bill_key,
  (SELECT json_object('order_id', r.order_id, 'order_type', r.order_type, 'token', r.token, 'car_number', r.car_number,
          'car_type', r.car_type, 'business_date', r.business_date, 'placed_at', r.placed_at)
     FROM ko r WHERE r.bill_key = k.bill_key ORDER BY r.placed_at, r.order_id LIMIT 1) AS root,
  (SELECT json_group_array(DISTINCT r.placed_by) FROM ko r WHERE r.bill_key = k.bill_key) AS placed_by,
  ${lineRows(`ko o JOIN order_lines l ON l.order_id = o.order_id WHERE o.bill_key = k.bill_key`)} AS sums
FROM (SELECT DISTINCT bill_key FROM ko) k`;

// 3: the non-closed, non-absorbed bills with their seating, payment sums, closed shares and open requests; a
// corrections reopen's own orders (its bill_orders) with their sums.
const BILLS = `
SELECT b.bill_id, b.scope, b.seating_id, b.table_key, b.order_type, b.state, b.opened_at, b.check_printed_at, b.sc_bp,
       b.sc_removed, b.discount_json, b.reopen_mode, b.prices_include_tax, b.rounding_json,
       s.primary_table_id, s.holder_staff_id, s.bill_requested_at,
       COALESCE((SELECT SUM(CASE p.direction WHEN 'in' THEN p.amount_minor ELSE -p.amount_minor END) FROM bill_payments p
                 WHERE p.bill_id = b.bill_id AND p.removed_at IS NULL), 0) AS paid_minor,
       COALESCE((SELECT SUM(i.discount_minor) FROM bill_splits bs JOIN invoices i ON i.invoice_id = bs.invoice_id
                 WHERE bs.bill_id = b.bill_id AND bs.state = 'closed'), 0) AS closed_discount,
       (SELECT json_group_array(json_object('id', c.order_item_id, 'units', c.units, 'share', c.share_minor))
          FROM closed_split_units c WHERE c.bill_id = b.bill_id) AS closed,
       (SELECT json_group_array(d.order_item_id) FROM bill_discount_lines d WHERE d.bill_id = b.bill_id) AS discount_line_ids,
       b.split_mode, ${OPEN_SPLIT_COLUMNS},
       CASE WHEN b.reopen_mode = 'corrections' THEN ${lineRows(
         `orders o JOIN order_lines l ON l.order_id = o.order_id
            WHERE o.cancelled_at IS NULL AND o.order_id IN (SELECT order_id FROM bill_orders WHERE bill_id = b.bill_id)`,
       )} END AS own_sums,
       CASE WHEN b.reopen_mode = 'corrections' THEN (
         SELECT json_object('order_id', r.order_id, 'order_type', r.order_type, 'token', r.token, 'car_number', r.car_number,
                'car_type', r.car_type, 'business_date', r.business_date, 'placed_at', r.placed_at, 'placed_by',
                (SELECT json_group_array(DISTINCT q.placed_by) FROM orders q WHERE q.order_id IN (SELECT order_id FROM bill_orders WHERE bill_id = b.bill_id)))
         FROM orders r WHERE r.order_id IN (SELECT order_id FROM bill_orders WHERE bill_id = b.bill_id) ORDER BY r.placed_at, r.order_id LIMIT 1) END AS own_root,
       EXISTS (SELECT 1 FROM alerts a WHERE a.state = 'open' AND a.subject_stream_type = 'bill' AND a.subject_stream_id = b.bill_id
                 AND a.kind IN (SELECT value FROM json_each(@kinds))) AS has_open_request
FROM bills b LEFT JOIN seatings s ON s.seating_id = b.seating_id
WHERE b.state <> 'closed' AND b.absorbed_into IS NULL`;

/** One line row of `lineRows`. */
export interface Sum {
  id: string;
  k: ComputeLine['line_kind'];
  p: string | null;
  b: number;
  u: number;
  up: number | null;
}
interface Root {
  order_id: string;
  order_type: BillOrderType;
  token: number | null;
  car_number: string | null;
  car_type: string | null;
  business_date: string;
  placed_at: number;
  placed_by?: string[];
}
interface SeatingRow {
  billing_date: string | null;
  as_of_seq: number;
  seating_id: string | null;
  primary_table_id: string;
  holder_staff_id: string;
  opened_at: number;
  bill_requested_at: number | null;
  order_count: number;
  sums: string;
}
interface KeyRow {
  bill_key: string;
  root: string;
  placed_by: string;
  sums: string;
}
interface BillRow {
  bill_id: string;
  scope: 'seating' | 'key';
  seating_id: string | null;
  table_key: string | null;
  order_type: BillOrderType;
  state: 'open' | 'partly_paid';
  opened_at: number;
  check_printed_at: number | null;
  sc_bp: number;
  sc_removed: number;
  discount_json: string | null;
  reopen_mode: 'full' | 'corrections' | null;
  prices_include_tax: number;
  rounding_json: string;
  primary_table_id: string | null;
  holder_staff_id: string | null;
  bill_requested_at: number | null;
  paid_minor: number;
  closed_discount: number;
  closed: string;
  discount_line_ids: string;
  split_mode: 'items' | 'amount' | 'equal' | null;
  split_count: number;
  closed_rounding: number;
  open_splits: string;
  own_sums: string | null;
  own_root: string | null;
  has_open_request: number;
}

export interface OpenBillRow {
  bill_id: string | null;
  seating_id: string | null;
  order_id: string | null;
  identifier: string;
  order_type: BillOrderType;
  state: 'projected' | 'open' | 'partly_paid';
  total_default_minor: number;
  paid_minor: number;
  /** ⚠️ 05 v1.0.35 §6.2 (run 3 R3-B-1, D3): Σ the open splits' balance_minor; closed splits add 0 */
  due_minor: number;
  /** ⚠️ 05 v1.0.36 §6.2 (QA BUG-16): Σ the open splits' as-paid totals, as the bill page shows them */
  open_total_minor: number;
  /** ⚠️ 05 v1.0.36 §6.2 (QA BUG-16): Σ the open splits' net live payments; open_total − open_paid = due */
  open_paid_minor: number;
  check_printed_at: number | null;
  opened_at: number;
  open_minutes: number;
  flagged: boolean;
  partly_paid: boolean;
  has_open_request: boolean;
}

interface Candidate {
  row: Omit<OpenBillRow, 'identifier' | 'total_default_minor' | 'due_minor' | 'open_total_minor' | 'open_paid_minor' | 'open_minutes' | 'flagged'>;
  sums: Sum[];
  closed: Array<{ id: string; units: number; share: number }>;
  /** dine-in: the seating for scope and the identifier; key: who placed its orders, its root */
  seating: { primary_table_id: string; holder_staff_id: string } | null;
  root: Root | null;
  placed_by: string[];
  bill: BillRow | null;
}

export interface OpenBillsCtx {
  db: Database.Database;
  config: BranchConfig;
  directory: StaffDirectory;
  staffId: string | null;
  openDay: string | null;
  now: number;
  floorId: string | undefined;
}

/** §6.2: the open-bills list, 3 statements. */
export function openBills(c: OpenBillsCtx): { bills: OpenBillRow[]; as_of_seq: number } {
  const { db, config } = c;
  const staffId = c.staffId;
  const grant = staffId === null ? { grant: 'not_granted' as const } : c.directory.resolve(staffId, 'take-payment');
  if (grant.grant !== 'allowed' && grant.grant !== 'requires_approval') throw new DomainError('PERMISSION_DENIED', { permission: 'take-payment', grant: grant.grant });
  const scope = grant.scope;

  const seatingRows = db.prepare(SEATINGS).all() as SeatingRow[]; // 1
  const keyRows = db.prepare(KEYS).all() as KeyRow[]; // 2
  const billRows = db.prepare(BILLS).all({ kinds: JSON.stringify(BILL_REQUEST_KINDS) }) as BillRow[]; // 3
  const business_date = c.openDay ?? seatingRows[0]?.billing_date ?? null;

  const seatings = new Map(seatingRows.filter((s) => s.seating_id !== null).map((s) => [s.seating_id as string, s]));
  const keys = new Map(keyRows.map((k) => [k.bill_key, k]));
  const out: Candidate[] = [];
  const usedSeatings = new Set<string>();
  const usedKeys = new Set<string>();
  for (const b of billRows) {
    const corrections = b.reopen_mode === 'corrections';
    const ownRoot = b.own_root === null ? null : (JSON.parse(b.own_root) as Root);
    let s: Sum[] = [];
    let root: Root | null = null;
    let placed_by: string[] = [];
    // ⚠️ 05 v1.0.38 §6.2 QB-1 (BUG-23): a bill row is open since the earliest of its own opened_at and what its projected
    // row showed (the seating's opened_at, the key's root placed_at) — a check bill that makes the row keeps the clock
    let since = b.opened_at;
    if (corrections) {
      s = JSON.parse(b.own_sums ?? '[]') as Sum[];
      root = ownRoot;
      placed_by = ownRoot?.placed_by ?? [];
    } else if (b.scope === 'seating' && b.seating_id !== null) {
      const row = seatings.get(b.seating_id);
      if (row !== undefined) {
        s = JSON.parse(row.sums) as Sum[];
        usedSeatings.add(b.seating_id);
        since = Math.min(since, row.opened_at);
      }
    } else if (b.table_key !== null) {
      const row = keys.get(b.table_key);
      if (row !== undefined) {
        s = JSON.parse(row.sums) as Sum[];
        root = JSON.parse(row.root) as Root;
        placed_by = JSON.parse(row.placed_by) as string[];
        usedKeys.add(b.table_key);
        if (root !== null) since = Math.min(since, root.placed_at);
      }
    }
    out.push({
      row: {
        bill_id: b.bill_id,
        seating_id: b.seating_id,
        order_id: b.scope === 'key' ? (root?.order_id ?? null) : null,
        order_type: b.order_type,
        state: b.state,
        paid_minor: b.paid_minor,
        check_printed_at: maxOrNull(b.check_printed_at, b.bill_requested_at),
        opened_at: since,
        partly_paid: b.state === 'partly_paid',
        has_open_request: b.has_open_request === 1,
      },
      sums: s,
      closed: JSON.parse(b.closed) as Candidate['closed'],
      seating: b.primary_table_id === null ? null : { primary_table_id: b.primary_table_id, holder_staff_id: b.holder_staff_id as string },
      root,
      placed_by,
      bill: b,
    });
  }
  for (const [seating_id, s] of seatings) {
    if (usedSeatings.has(seating_id) || s.order_count === 0) continue;
    out.push({
      row: { bill_id: null, seating_id, order_id: null, order_type: 'dine_in', state: 'projected', paid_minor: 0, check_printed_at: s.bill_requested_at, opened_at: s.opened_at, partly_paid: false, has_open_request: false },
      sums: JSON.parse(s.sums) as Sum[],
      closed: [],
      seating: { primary_table_id: s.primary_table_id, holder_staff_id: s.holder_staff_id },
      root: null,
      placed_by: [],
      bill: null,
    });
  }
  for (const [bill_key, k] of keys) {
    if (usedKeys.has(bill_key)) continue;
    const root = JSON.parse(k.root) as Root;
    out.push({
      row: { bill_id: null, seating_id: null, order_id: root.order_id, order_type: root.order_type, state: 'projected', paid_minor: 0, check_printed_at: null, opened_at: root.placed_at, partly_paid: false, has_open_request: false },
      sums: JSON.parse(k.sums) as Sum[],
      closed: [],
      seating: null,
      root,
      placed_by: JSON.parse(k.placed_by) as string[],
      bill: null,
    });
  }

  const floorOf = new Map(config.floors.flatMap((f) => f.tables.map((t) => [t.table_id, f.floor_id] as const)));
  const nameOf = new Map(config.floors.flatMap((f) => f.tables.map((t) => [t.table_id, t.name] as const)));
  const myFloors = staffId === null ? [] : c.directory.floorsOf(staffId);
  const visible = out.filter((x) => {
    const dineIn = x.row.order_type === 'dine_in';
    if (c.floorId !== undefined && (!dineIn || x.seating === null || floorOf.get(x.seating.primary_table_id) !== c.floorId)) return false;
    if (scope === 'branch') return true;
    if (!dineIn) return x.placed_by.includes(staffId as string);
    if (x.seating === null) return false;
    if (scope === 'own_tables') return x.seating.holder_staff_id === staffId;
    if (scope === 'my_floors') return myFloors.includes(floorOf.get(x.seating.primary_table_id) ?? '');
    return false;
  });

  if (visible.length > 0 && business_date === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  const at = business_date === null ? null : billingAt(config, business_date);
  const rows: OpenBillRow[] = visible.map((x) => {
    const { billing, rules } = at!;
    const { total_default_minor, due_minor, open_total_minor, open_paid_minor } = openPart(billing, rules, business_date!, { order_type: x.row.order_type, sums: x.sums, closed: x.closed, bill: x.bill });
    const open_minutes = Math.max(0, Math.floor((c.now - x.row.opened_at) / 60_000));
    return { ...x.row, identifier: identifierOf(x, nameOf, c.openDay), total_default_minor, due_minor, open_total_minor, open_paid_minor, open_minutes, flagged: open_minutes > billing.settings.open_bill_flag_minutes };
  });
  rows.sort((a, b) => {
    if (a.check_printed_at !== b.check_printed_at) {
      if (a.check_printed_at === null) return 1;
      if (b.check_printed_at === null) return -1;
      return b.check_printed_at - a.check_printed_at;
    }
    return a.opened_at - b.opened_at;
  });
  return { bills: rows, as_of_seq: seatingRows[0]?.as_of_seq ?? 0 };
}

function maxOrNull(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/** The bill-row fields `openPart` reads (BILLS and keyBalances' statement both return them). */
export interface OpenPartBill {
  sc_bp: number;
  sc_removed: number;
  discount_json: string | null;
  prices_include_tax: number;
  rounding_json: string;
  closed_discount: number;
  discount_line_ids: string;
  split_mode: 'items' | 'amount' | 'equal' | null;
  split_count: number;
  closed_rounding: number;
  open_splits: string;
}

interface OpenSplit {
  split_no: number;
  plan_json: string | null;
  plan_lines_json: Array<{ order_item_id: string; units: number }>;
  payments: Array<{ c: 'cash' | 'digital'; d: 'in' | 'out'; a: number; t: number | null }>;
}

/**
 * The open remainder of a bill (§6.2, §6.2a), before pending voids, as the bill view computes it (H6-18): one
 * `computeBill` over one compute line per bill line (shared openComputeLines), the bill's frozen rules, discount and
 * sticky service charge, its open splits' plan and their live payments. `total_default_minor` = the open remainder's
 * total at the default class; ⚠️ run 3 (R3-B-1, D3) `due_minor` = Σ the open splits' `balance_minor` (each split's total
 * less its own net payments; closed splits add 0; negative kept). A projected bill (or a bill with no split row yet):
 * one open split, no payments. Pure.
 */
export function openPart(
  billing: HubBilling,
  atDay: ComputeRules,
  business_date: string,
  x: { order_type: BillOrderType; sums: readonly Sum[]; closed: ReadonlyArray<{ id: string; units: number; share: number }>; bill: OpenPartBill | null },
): { total_default_minor: number; due_minor: number; open_total_minor: number; open_paid_minor: number } {
  const b = x.bill;
  const rules = b === null ? atDay : { ...atDay, prices_include_tax: b.prices_include_tax === 1, rounding: { ...(JSON.parse(b.rounding_json) as BillRounding) } };
  const closed = new Map(x.closed.map((c) => [c.id, { units: c.units, share: c.share }]));
  const lines = openComputeLines(
    x.sums.map((l) => ({ order_item_id: l.id, line_kind: l.k, live_units: l.u, base_minor: l.b, tax_profile_id: l.p, unit_price_minor: l.up })),
    closed,
  );
  const d = b?.discount_json == null ? null : (JSON.parse(b.discount_json) as BillDiscountState);
  const discount: ComputeDiscount | null =
    d === null
      ? null
      : {
          kind: d.kind,
          value: d.value,
          frozen: d.frozen_minor === null ? null : { amount_minor: d.frozen_minor, closed_discount_minor: b!.closed_discount, line_ids: JSON.parse(b!.discount_line_ids) as string[] },
        };
  const sc = b === null ? { rate_bp: billing.settings.service_charge_bp[x.order_type], removed: false } : { rate_bp: b.sc_bp, removed: b.sc_removed === 1 };
  const open: OpenSplit[] = b === null || b.split_count === 0 ? [{ split_no: 1, plan_json: null, plan_lines_json: [], payments: [] }] : (JSON.parse(b.open_splits) as OpenSplit[]);
  if (open.length === 0) return { total_default_minor: 0, due_minor: 0, open_total_minor: 0, open_paid_minor: 0 };
  const payments: ComputePayment[] = open.flatMap((s) => s.payments.map((p) => ({ split_no: s.split_no, payment_class: p.c, direction: p.d, amount_minor: p.a, tendered_minor: p.t })));
  const result = computeBill({
    business_date,
    rules,
    tax_profiles: billing.tax_profiles,
    lines,
    discount,
    service_charge: { ...sc, tax_profile_id: billing.settings.service_charge_tax_profile_id },
    plan: planOf(
      { split_mode: b === null ? null : b.split_mode },
      open.map((s) => ({ split_no: s.split_no, plan_json: s.plan_json, plan_lines_json: JSON.stringify(s.plan_lines_json) })),
    ),
    payments,
    closed_rounding_minor: b === null ? 0 : b.closed_rounding,
  });
  const sum = (f: (s: (typeof result.splits)[number]) => number) => result.splits.reduce((a, s) => a + f(s), 0);
  return {
    total_default_minor: result.totals_default.total_minor,
    due_minor: sum((s) => s.balance_minor),
    // QA BUG-16: the bill page's own numbers, from the same result (open_total − open_paid = due)
    open_total_minor: sum((s) => s.totals.as_paid.total_minor),
    open_paid_minor: sum((s) => s.paid_cash_minor + s.paid_digital_minor),
  };
}

function identifierOf(x: Candidate, nameOf: ReadonlyMap<string, string>, today: string | null): string {
  if (x.row.order_type === 'dine_in') {
    const table = x.seating?.primary_table_id ?? '';
    return tableLabel(nameOf.get(table) ?? table).slice(0, 40);
  }
  const r = x.root;
  if (r === null) return '';
  if (r.order_type === 'parking') return `PARKING ${r.car_number ?? ''} ${(r.car_type ?? 'sedan').toUpperCase()}`.slice(0, 40);
  return (r.business_date === today ? `#${r.token ?? 0}` : `#${r.token ?? 0} ${r.business_date}`).slice(0, 40);
}

export function registerOpenBillsQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'open-bills',
      sessionKind: 'device',
      session: 'required',
      querySchema: z.object({ floor_id: z.string().min(1).optional() }).strict(),
      handle(ctx: QueryCtx, q) {
        if (ctx.branchConfig === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
        return {
          data: openBills({
            db: ctx.db,
            config: ctx.branchConfig,
            directory: ctx.directory,
            staffId: ctx.session?.staff_id ?? null,
            openDay: ctx.state.business_day?.business_date ?? null,
            now: ctx.now,
            floorId: q.floor_id,
          }),
        };
      },
    }),
  );
}
