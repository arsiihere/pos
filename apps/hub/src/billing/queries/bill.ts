// 05 §6.1 `GET /queries/bill?seating_id|order_id|bill_id` (task 10; R-29: `lines[].added_after_close`, pinned `blocks`,
// `reopen_count`). The projected bill (no bill row) and an opened bill go through the same pure `computeBill` (#1).
// Statements ≤ 9 (§6.1), 8 since task 12, fixed whatever the number of lines, splits or payments (#91): openBillOf (1),
// orders of the bill (1), orderLines (1), pendingVoids (1), splits + payments + plan lines + closed units + current
// invoices (1, SPLITS_OF_BILL, shared with the bill commands), alerts.listOpen on the bill (1), bill_print_jobs +
// documentJobsStatus (2). Config and directory in memory. A projected
// bill skips the reads that need a bill row. Never a buyer tax ID; a payment's `reference` only to `take-payment`
// holders whose scope covers the bill (H2-20).
import {
  computeBill,
  DomainError,
  type ComputeBillInput,
  type ComputeBillResult,
  type ComputeDiscount,
  type ComputeLine,
  type ComputePayment,
  type ComputePlan,
  type ComputeRules,
  type ComputeTotals,
  type Identifier,
} from '@pos/domain';
import type { BranchConfig } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { alerts } from '../../alerts/raise.js';
import type { StaffDirectory } from '../../auth/staff-directory.js';
import { tableLabel } from '../../kds/details.js';
import type { LineView } from '../../orders/contracts.js';
import { orderLines } from '../../orders/exports.js';
import { documentJobsStatus } from '../../print/document-jobs.js';
import { defineQuery, queryRegistry, type QueryCtx } from '../../queries/registry.js';
import type { PendingVoid } from '../../voids/contracts.js';
import { pendingVoids } from '../../voids/exports.js';
import { billingAt, openBillOf, type BillHead, type BillRef } from '../commands/ensure-bill.js';
import type { HubBilling } from '../defaults.js';

type PaymentClass = 'cash' | 'digital';

/** §6.1 `Totals` (+ each tax row's `rate_ref`, #14: the bill view shows the row's ref). */
export interface Totals {
  subtotal_minor: number;
  discount_minor: number;
  service_charge_minor: number;
  taxes: Array<{ tax_profile_id: string; tax_code: string; label: string; payment_class: PaymentClass; rate_bp: number; base_minor: number; tax_minor: number; rate_ref: string | null }>;
  rounding_minor: number;
  total_minor: number;
}

/** §6.1 / R-29 pinned `blocks` reasons, in §3.3 rule order. */
export const BLOCK_REASONS = ['bill_not_open', 'void_pending', 'weight_pending', 'tax_unresolved', 'discount_pending', 'buyer_id_required', 'balance_due', 'shares_sum'] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];
export interface BillBlock {
  reason: BlockReason;
  split_no: number | null;
  details: Record<string, unknown>;
}

/** §3.14: the 05 request kinds whose subject is the bill (open_requests, rule 4). */
export const BILL_REQUEST_KINDS = ['discount', 'remove_service_charge', 'reopen_bill', 'remove_comp', 'close_without_buyer_id'] as const;

export interface BillViewPayment {
  payment_id: string;
  mode_id: string;
  mode_name: string;
  direction: 'in' | 'out';
  amount_minor: number;
  tendered_minor: number | null;
  change_minor: number;
  has_reference: boolean;
  reference?: string | null;
  taken_by_name: string | null;
  /** ⚠️ 05 v1.0.29 (R-90): the taker's staff id, so the client decides "own payment" for RemovePayment by id (§6.10). */
  taken_by_staff_id: string;
}

export interface BillViewSplit {
  split_no: number;
  state: 'open' | 'closed';
  plan: null | { lines: Array<{ order_item_id: string; units: number }> } | { share_minor: number } | { n: number; k: number };
  payments: BillViewPayment[];
  totals: { cash: Totals; digital: Totals; as_paid: Totals };
  balance_minor: number;
  /** ⚠️ 05 v1.0.29 (R-90): `invoice_id` is the `ref_id` of PrintBillDocument { doc: 'receipt' } (§6.22). */
  invoice: { invoice_id: string; invoice_ref: string; fiscal_number: string | null; fiscal_state: string | null } | null;
}

export interface BillView {
  bill_id: string | null;
  state: BillHead['state'];
  scope: 'seating' | 'key';
  order_type: BillHead['order_type'];
  identifier: string;
  orders: string[];
  lines: Array<{
    order_item_id: string;
    order_id: string;
    name: string;
    options: LineView['options'];
    units: number;
    base_minor: number;
    tax_profile_id: string | null;
    tags: Array<'comp' | 'pending_void' | 'weight_needed' | 'tax_unresolved'>;
    added_after_close: boolean;
    /** 05 v1.0.33 §6.1 (STAB-5): order_lines.part_of, the first part of a split line (02b v1.0.20); null = not split */
    part_of: string | null;
  }>;
  service_charge: { rate_bp: number; removed: boolean };
  discount: null | { kind: 'amount' | 'percent'; value: number; reason_code: string; frozen_minor: number | null; discount_minor: number };
  splits: BillViewSplit[];
  totals_default: Totals;
  buyer: { required: boolean; threshold_minor: number | null; waived: boolean };
  blocks: BillBlock[];
  open_requests: Array<{ kind: string; alert_id: string }>;
  prints: Array<{ job_id: string; doc_kind: string; state: string; printer_name: string | null; last_error: string | null }>;
  check_printed_at: number | null;
  reopen_count: number;
  currency: { code: string; exponent: number };
  prices_include_tax: boolean;
  as_of_seq: number;
}

// ------------------------------------------------------------------------------------------------ reads

export interface BillOrder {
  order_id: string;
  order_type: string;
  placed_by: string;
  placed_at: number;
  token: number | null;
  car_number: string | null;
  car_type: string | null;
  business_date: string;
}

// The bill's orders, cancelled ones never (#2): its own `bill_orders` (the reopen set, a closed bill's orders), and —
// for a live bill or a projected one — the target's orders that are neither billed nor cancelled and are not in
// another bill's `bill_orders` (a corrections reopen keeps its own). 1 statement. Shared with the bill commands.
export const ORDERS_OF_BILL = `
SELECT o.order_id, o.order_type, o.placed_by, o.placed_at, o.token, o.car_number, o.car_type, o.business_date
FROM orders o
WHERE o.cancelled_at IS NULL AND (
  (@bill_id IS NOT NULL AND o.order_id IN (SELECT order_id FROM bill_orders WHERE bill_id = @bill_id))
  OR (@own_only = 0 AND o.billed_at IS NULL
      AND ((@seating_id IS NOT NULL AND o.order_id IN (SELECT order_id FROM seating_orders WHERE seating_id = @seating_id))
        OR (@bill_key IS NOT NULL AND o.bill_key = @bill_key))
      AND NOT EXISTS (SELECT 1 FROM bill_orders bo WHERE bo.order_id = o.order_id AND bo.bill_id IS NOT @bill_id)))
ORDER BY o.placed_at, o.order_id`;

/** ORDERS_OF_BILL's parameters for `head`: a closed, absorbed or corrections bill reads its own orders only. */
export function ordersOfBillParams(head: BillHead): { bill_id: string | null; own_only: 0 | 1; seating_id: string | null; bill_key: string | null } {
  const own = head.state === 'closed' || head.absorbed || head.reopen_mode === 'corrections' ? 1 : 0;
  return { bill_id: head.bill_id, own_only: own, seating_id: head.seating_id, bill_key: head.bill_key };
}

/**
 * The bill's splits with their live payments (reference from the hub-only payment_references), item-plan rows (by
 * order_item_id), closed units and — for a closed split — its current sale invoice with the fiscal row's state:
 * 1 statement whatever the counts. Shared by the bill view and the bill commands (task 12 plan fix: one reading).
 */
export const SPLITS_OF_BILL = `
SELECT s.split_no, s.state, s.plan_json, s.invoice_id,
  (SELECT json_group_array(json_object('payment_id', p.payment_id, 'mode_id', p.mode_id, 'payment_class', p.payment_class,
            'direction', p.direction, 'amount_minor', p.amount_minor, 'tendered_minor', p.tendered_minor,
            'has_reference', p.has_reference, 'taken_by_staff_id', p.taken_by_staff_id, 'reference', r.reference))
     FROM (SELECT * FROM bill_payments WHERE bill_id = s.bill_id AND split_no = s.split_no AND removed_at IS NULL
           ORDER BY added_at, payment_id) p
     LEFT JOIN payment_references r ON r.payment_id = p.payment_id) AS payments_json,
  (SELECT json_group_array(json_object('order_item_id', l.order_item_id, 'units', l.units))
     FROM (SELECT order_item_id, units FROM bill_split_lines WHERE bill_id = s.bill_id AND split_no = s.split_no
           ORDER BY order_item_id) l) AS plan_lines_json,
  (SELECT json_group_array(json_object('order_item_id', c.order_item_id, 'units', c.units, 'share_minor', c.share_minor))
     FROM closed_split_units c WHERE c.bill_id = s.bill_id AND c.split_no = s.split_no) AS closed_json,
  i.invoice_ref, i.subtotal_minor AS inv_subtotal_minor, i.discount_minor AS inv_discount_minor,
  i.service_charge_minor AS inv_service_charge_minor, i.rounding_minor AS inv_rounding_minor, i.total_minor AS inv_total_minor,
  i.fiscal_number, i.doc_json, f.state AS fiscal_state
FROM bill_splits s
LEFT JOIN invoices i ON s.state = 'closed' AND i.invoice_id = s.invoice_id
LEFT JOIN fiscal_outbox f ON f.invoice_id = i.invoice_id
WHERE s.bill_id = ? ORDER BY s.split_no`;

const PRINT_JOBS = `
SELECT job_id, doc_kind FROM bill_print_jobs
WHERE (@bill_id IS NOT NULL AND bill_id = @bill_id) OR (@bill_id IS NULL AND bill_id IS NULL AND ref_id = @ref_id)
ORDER BY created_at DESC, job_id`;

/** One SPLITS_OF_BILL row; the invoice columns are null unless the split is closed with a sale invoice. */
export interface SplitRow {
  split_no: number;
  state: 'open' | 'closed';
  plan_json: string | null;
  invoice_id: string | null;
  payments_json: string;
  plan_lines_json: string;
  closed_json: string;
  invoice_ref: string | null;
  inv_subtotal_minor: number | null;
  inv_discount_minor: number | null;
  inv_service_charge_minor: number | null;
  inv_rounding_minor: number | null;
  inv_total_minor: number | null;
  fiscal_number: string | null;
  doc_json: string | null;
  fiscal_state: string | null;
}

/** A bill with no `bill_splits` row yet (projected, or opened in this command): its one open split. */
export const ONE_OPEN_SPLIT: SplitRow = {
  split_no: 1,
  state: 'open',
  plan_json: null,
  invoice_id: null,
  payments_json: '[]',
  plan_lines_json: '[]',
  closed_json: '[]',
  invoice_ref: null,
  inv_subtotal_minor: null,
  inv_discount_minor: null,
  inv_service_charge_minor: null,
  inv_rounding_minor: null,
  inv_total_minor: null,
  fiscal_number: null,
  doc_json: null,
  fiscal_state: null,
};

/** One live payment of SPLITS_OF_BILL's `payments_json`. */
export interface PaymentRow {
  payment_id: string;
  mode_id: string;
  payment_class: PaymentClass;
  direction: 'in' | 'out';
  amount_minor: number;
  tendered_minor: number | null;
  has_reference: number;
  taken_by_staff_id: string;
  reference: string | null;
}

// ------------------------------------------------------------------------------------------------ scope

export type BillAccess = 'full' | 'read';

/**
 * §6.1 permission: `take-payment` whose scope covers the bill → full view; else `take-order` covering it → read-only
 * (no payment reference, H2-20). Scope (C8, last): `branch` any; `my_floors` → the seating's primary table is on one
 * of the caller's floors; `own_tables` → the caller holds the seating; a key bill (takeaway / parking): the caller
 * placed one of its orders (02b RemoveItems' rule) unless `branch`. 0 statements.
 */
export function requireBillGrant(directory: StaffDirectory, staffId: string | null, permissions: readonly ('take-payment' | 'take-order')[]): void {
  const held = staffId !== null && permissions.some((p) => {
    const g = directory.resolve(staffId, p).grant;
    return g === 'allowed' || g === 'requires_approval';
  });
  if (!held) throw new DomainError('PERMISSION_DENIED', { permission: permissions[0], grant: staffId === null ? 'not_granted' : directory.resolve(staffId, permissions[0]!).grant });
}

export function billAccess(
  directory: StaffDirectory,
  config: BranchConfig,
  staffId: string | null,
  bill: { seating: BillHead['seating']; scope: 'seating' | 'key'; placed_by: readonly string[] },
  permissions: readonly ('take-payment' | 'take-order')[],
): BillAccess {
  if (staffId === null) throw new DomainError('PERMISSION_DENIED', { permission: permissions[0], grant: 'not_granted' });
  let held = false;
  for (const permission of permissions) {
    const r = directory.resolve(staffId, permission);
    if (r.grant !== 'allowed' && r.grant !== 'requires_approval') continue;
    held = true;
    if (covers(directory, config, staffId, r.scope, bill)) return permission === 'take-payment' ? 'full' : 'read';
  }
  if (!held) throw new DomainError('PERMISSION_DENIED', { permission: permissions[0], grant: directory.resolve(staffId, permissions[0]!).grant });
  throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', ...(bill.seating === null ? {} : { table_ids: [bill.seating.primary_table_id] }) });
}

/** C8 scope test of §6.1 (also the `bill`-stream WS audience, §6.30): does a grant of `scope` cover the bill? 0 statements. */
export function covers(
  directory: StaffDirectory,
  config: BranchConfig,
  staffId: string,
  scope: string,
  bill: { seating: Pick<NonNullable<BillHead['seating']>, 'holder_staff_id' | 'primary_table_id'> | null; scope: 'seating' | 'key'; placed_by: readonly string[] },
): boolean {
  if (scope === 'branch') return true;
  if (bill.scope === 'key') return bill.placed_by.includes(staffId);
  if (bill.seating === null) return false;
  if (scope === 'own_tables') return bill.seating.holder_staff_id === staffId;
  if (scope === 'my_floors') {
    const table = bill.seating.primary_table_id;
    const floor = config.floors.find((f) => f.tables.some((t) => t.table_id === table));
    return floor !== undefined && directory.floorsOf(staffId).includes(floor.floor_id);
  }
  return false;
}

// ------------------------------------------------------------------------------------------------ pure parts

const ZERO_TOTALS: Totals = { subtotal_minor: 0, discount_minor: 0, service_charge_minor: 0, taxes: [], rounding_minor: 0, total_minor: 0 };

export function toTotals(t: ComputeTotals): Totals {
  return {
    subtotal_minor: t.subtotal_minor,
    discount_minor: t.discount_minor,
    service_charge_minor: t.service_charge_minor,
    taxes: t.taxes.map((x) => ({
      tax_profile_id: x.tax_profile_id,
      tax_code: x.tax_code,
      label: x.label,
      payment_class: x.payment_class,
      rate_bp: x.rate_bp,
      base_minor: x.base_minor,
      tax_minor: x.tax_minor,
      rate_ref: x.rate_ref,
    })),
    rounding_minor: t.rounding_minor,
    total_minor: t.total_minor,
  };
}

/** §3.1 line base: `billed_minor` minus its pending voids' `refund_minor`; a deal part and a return line 0; never below 0. */
export function lineBase(l: LineView, pendingRefund: number): number {
  if (l.line_kind === 'deal_part' || l.return_of !== null) return 0;
  return Math.max(0, l.billed_minor - pendingRefund);
}

/** One bill line as both reads have it: live units, its §3.1 base (whole line), profile, LineView unit price. */
export interface OpenLineInput {
  order_item_id: string;
  line_kind: ComputeLine['line_kind'];
  live_units: number;
  base_minor: number;
  tax_profile_id: string | null;
  unit_price_minor: number | null;
}

/**
 * The compute lines of a bill's open part (H2-2), shared by the bill view and open-bills (H6-18: same lines, same
 * order, so the same discount spread): per line, units − its closed units and base − its closed shares, each clamped
 * at 0; a line with no live unit, or nothing left open, is left out. `unit_price_minor` from LineView (G-14; null
 * while a weight is pending → 0). Pure.
 */
export function openComputeLines(lines: readonly OpenLineInput[], closed: ReadonlyMap<string, { units: number; share: number }>): ComputeLine[] {
  const out: ComputeLine[] = [];
  for (const l of lines) {
    if (l.live_units <= 0) continue;
    const c = closed.get(l.order_item_id) ?? { units: 0, share: 0 };
    const units = Math.max(0, l.live_units - c.units);
    const base = Math.max(0, l.base_minor - c.share);
    if (units === 0 && base === 0) continue;
    out.push({ order_item_id: l.order_item_id, line_kind: l.line_kind, units, unit_price_minor: l.unit_price_minor ?? 0, base_minor: base, tax_profile_id: l.tax_profile_id });
  }
  return out;
}

/** The bill's compute rules: in force on the business date, with the bill's frozen price mode and rounding (H9-9, H16-2). */
export function billRules(rules: ComputeRules, head: BillHead): ComputeRules {
  if (head.bill_id === null || head.prices_include_tax === null || head.rounding === null) return rules;
  return { ...rules, prices_include_tax: head.prices_include_tax, rounding: { ...head.rounding } };
}

/** The bill's live lines in the orders' order (`orderLines` per order id), units > 0. */
export function billLines(order_ids: readonly string[], byOrder: ReadonlyMap<string, readonly LineView[]>): LineView[] {
  return order_ids.flatMap((id) => byOrder.get(id) ?? []).filter((l) => l.live_units > 0);
}

/** §3.1: Σ pending-void `refund_minor` per named line. */
export function refundsOf(voids: ReadonlyMap<string, readonly PendingVoid[]>): Map<string, number> {
  const out = new Map<string, number>();
  for (const list of voids.values()) for (const v of list) out.set(v.order_item_id, (out.get(v.order_item_id) ?? 0) + v.refund_minor);
  return out;
}

/** B15, H2-2: per line, Σ the units and shares closed splits invoiced (`closed_split_units`). */
export function closedUnitsOf(splits: ReadonlyArray<Pick<SplitRow, 'closed_json'>>): Map<string, { units: number; share: number }> {
  const out = new Map<string, { units: number; share: number }>();
  for (const s of splits) {
    for (const c of JSON.parse(s.closed_json) as Array<{ order_item_id: string; units: number; share_minor: number }>) {
      const cur = out.get(c.order_item_id) ?? { units: 0, share: 0 };
      out.set(c.order_item_id, { units: cur.units + c.units, share: cur.share + c.share_minor });
    }
  }
  return out;
}

/** The compute input of a bill's open part without its plan and payments (each caller adds its own). */
export interface BillComputeBase {
  input: Omit<ComputeBillInput, 'plan' | 'payments'>;
  refundOf: Map<string, number>;
  closedUnits: Map<string, { units: number; share: number }>;
  /** Σ the closed splits' current invoices' discount */
  closedDiscount: number;
}

/**
 * §3.5, §6.1: the one reading of a bill's open part that every bill read and command computes from — the open part
 * of each line (H2-2) with its §3.1 base, the bill's frozen price mode and rounding (H9-9, H16-2), the discount (frozen
 * after the first close, B7) and the sticky service charge (B8; a projected bill takes the order type's rate now). Pure.
 */
export function billComputeBase(o: {
  head: BillHead;
  billing: HubBilling;
  /** the compute rules in force on the bill's business date (`billingAt`) */
  rules: ComputeRules;
  lines: readonly LineView[];
  voids: ReadonlyMap<string, readonly PendingVoid[]>;
  splits: readonly SplitRow[];
}): BillComputeBase {
  const { head, billing } = o;
  const refundOf = refundsOf(o.voids);
  const closedUnits = closedUnitsOf(o.splits);
  const closedDiscount = o.splits.reduce((a, s) => a + (s.state === 'closed' ? (s.inv_discount_minor ?? 0) : 0), 0);
  const discount: ComputeDiscount | null =
    head.discount === null
      ? null
      : {
          kind: head.discount.kind,
          value: head.discount.value,
          frozen: head.discount.frozen_minor === null ? null : { amount_minor: head.discount.frozen_minor, closed_discount_minor: closedDiscount, line_ids: head.discount_line_ids },
        };
  const sc = scOf(head, billing);
  if (head.business_date === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  return {
    refundOf,
    closedUnits,
    closedDiscount,
    input: {
      business_date: head.business_date,
      rules: billRules(o.rules, head),
      tax_profiles: billing.tax_profiles,
      lines: openComputeLines(
        o.lines.map((l) => ({ order_item_id: l.order_item_id, line_kind: l.line_kind, live_units: l.live_units, base_minor: lineBase(l, refundOf.get(l.order_item_id) ?? 0), tax_profile_id: l.tax_profile_id, unit_price_minor: l.unit_price_minor })),
        closedUnits,
      ),
      discount,
      service_charge: { rate_bp: sc.rate_bp, removed: sc.removed, tax_profile_id: billing.settings.service_charge_tax_profile_id },
      // §3.8 (owner ruling 2026-11-28, QA BUG-1): the open remainder is rounded with the closed splits' rounding
      closed_rounding_minor: o.splits.reduce((a, s) => a + (s.state === 'closed' ? (s.inv_rounding_minor ?? 0) : 0), 0),
    },
  };
}

/** §6.1 `service_charge`: the bill's (B8), or for a projected bill the order type's rate now. */
export function scOf(head: BillHead, billing: HubBilling): { rate_bp: number; removed: boolean } {
  return head.bill_id === null ? { rate_bp: billing.settings.service_charge_bp[head.order_type], removed: false } : { rate_bp: head.sc_bp, removed: head.sc_removed };
}

/** The payment-mode names of the settings (for `paymentView`). */
export function modeNames(billing: HubBilling): Map<string, string> {
  return new Map(billing.settings.payment_modes.map((m) => [m.mode_id, m.name]));
}

/** §6.1 payment entry; `reference` only with the full view (H2-20); names from settings and directory in memory. */
export function paymentView(p: PaymentRow, o: { modeName: ReadonlyMap<string, string>; directory: StaffDirectory; full: boolean }): BillViewPayment {
  return {
    payment_id: p.payment_id,
    mode_id: p.mode_id,
    mode_name: o.modeName.get(p.mode_id) ?? p.mode_id,
    direction: p.direction,
    amount_minor: p.amount_minor,
    tendered_minor: p.tendered_minor,
    change_minor: p.payment_class === 'cash' && p.direction === 'in' && p.tendered_minor !== null ? p.tendered_minor - p.amount_minor : 0,
    has_reference: p.has_reference === 1,
    ...(o.full ? { reference: p.reference } : {}),
    taken_by_name: o.directory.get(p.taken_by_staff_id)?.display_name ?? null,
    taken_by_staff_id: p.taken_by_staff_id,
  };
}

/** A closed split's view entry: totals from its current invoice (zero without one), balance 0, its own plan (§3.8). */
export function closedSplitView(s: SplitRow, splitMode: BillHead['split_mode'], payments: BillViewPayment[]): BillViewSplit {
  const t = invoiceTotals(s);
  return {
    split_no: s.split_no,
    state: 'closed',
    plan: planView(splitMode, s),
    payments,
    totals: { cash: t, digital: t, as_paid: t },
    balance_minor: 0,
    // the joined invoice row matched `s.invoice_id` (SPLITS_OF_BILL), so it is set whenever `invoice_ref` is (R-90)
    invoice: s.invoice_ref === null || s.invoice_id === null ? null : { invoice_id: s.invoice_id, invoice_ref: s.invoice_ref, fiscal_number: s.fiscal_number, fiscal_state: s.fiscal_state },
  };
}

export function identifierOf(head: BillHead, config: BranchConfig, orders: readonly BillOrder[], today: string | null): string {
  let id: Identifier;
  if (head.scope === 'seating') {
    const table = head.seating?.primary_table_id ?? '';
    const name = config.floors.flatMap((f) => f.tables).find((t) => t.table_id === table)?.name ?? table;
    id = { kind: 'table', label: tableLabel(name) };
  } else {
    const root = orders[0];
    if (root !== undefined && root.order_type === 'parking') id = { kind: 'parking', car_number: root.car_number ?? '', car_type: (root.car_type ?? 'sedan') as 'sedan' };
    else id = { kind: 'token', token: root?.token ?? 0, date: root === undefined || root.business_date === today ? null : root.business_date };
  }
  if (id.kind === 'table') return id.label.slice(0, 40);
  if (id.kind === 'token') return (id.date === null ? `#${id.token}` : `#${id.token} ${id.date}`).slice(0, 40);
  return `PARKING ${id.car_number} ${id.car_type.toUpperCase()}`.slice(0, 40);
}

// ------------------------------------------------------------------------------------------------ the view

export interface BillViewCtx {
  db: Database.Database;
  config: BranchConfig;
  directory: StaffDirectory;
  staffId: string | null;
  openDay: string | null;
  /** the permissions that may read the bill, first = the one that gives the full view */
  permissions: readonly ('take-payment' | 'take-order')[];
}

/** §6.1: the bill view of `ref`, ≤ 9 statements. */
export function billView(c: BillViewCtx, ref: BillRef): BillView {
  const { db, config } = c;
  requireBillGrant(c.directory, c.staffId, c.permissions); // C8: the grant before any read; the scope stays last
  const { head, missing } = openBillOf(db, ref, c.openDay); // 1
  if (missing && 'order_id' in ref) throw new DomainError('ORDER_NOT_FOUND', { order_id: ref.order_id });
  if (missing) throw new DomainError('BILL_NOT_FOUND', { bill_id: 'bill_id' in ref ? ref.bill_id : null });
  // a projected bill needs a seating that is not CLOSED (#2: a closed seating's orders never show as a projected bill)
  if (head.bill_id === null && head.scope === 'seating' && (head.seating === null || head.seating.state === 'CLOSED')) {
    throw new DomainError('BILL_NOT_FOUND', { bill_id: null });
  }
  if (head.business_date === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  const orders = db.prepare(ORDERS_OF_BILL).all(ordersOfBillParams(head)) as BillOrder[]; // 2
  const access = billAccess(c.directory, config, c.staffId, { seating: head.seating, scope: head.scope, placed_by: orders.map((o) => o.placed_by) }, c.permissions);

  const order_ids = orders.map((o) => o.order_id);
  const byOrder = orderLines(db, order_ids); // 3
  const voids = pendingVoids(db, order_ids); // 4
  const splitRows = head.bill_id === null ? [] : (db.prepare(SPLITS_OF_BILL).all(head.bill_id) as SplitRow[]); // 5, with the closed splits' invoices
  const open = head.bill_id === null ? [] : alerts.listOpen(db, { subject: { stream_type: 'bill', stream_id: head.bill_id } }); // 6
  const jobs = db.prepare(PRINT_JOBS).all({ bill_id: head.bill_id, ref_id: head.seating_id ?? head.bill_key }) as Array<{ job_id: string; doc_kind: string }>; // 7
  const jobStatus = documentJobsStatus(db, jobs.map((j) => j.job_id)); // 8

  const { billing, rules: atDay } = billingAt(config, head.business_date);
  const lines = billLines(order_ids, byOrder);
  const splits = splitRows.length === 0 ? [ONE_OPEN_SPLIT] : splitRows;
  const base = billComputeBase({ head, billing, rules: atDay, lines, voids, splits });
  const { refundOf, closedDiscount } = base;
  const rules = base.input.rules;

  // pending voids: a tag on every touched line (§3.1, #4)
  const pendingIds = new Set<string>();
  for (const list of voids.values()) for (const v of list) for (const id of [v.order_item_id, ...v.touched_ids]) pendingIds.add(id);

  const openSplits = splits.filter((s) => s.state === 'open');
  const closedRows = splits.filter((s) => s.state === 'closed');
  const hasClosed = closedRows.length > 0;
  const sc = scOf(head, billing);
  const paymentsOf = new Map(splits.map((s) => [s.split_no, JSON.parse(s.payments_json) as PaymentRow[]]));
  let result: ComputeBillResult | null = null;
  if (openSplits.length > 0) {
    const plan = planOf(head, openSplits);
    const payments: ComputePayment[] = openSplits.flatMap((s) =>
      (paymentsOf.get(s.split_no) ?? []).map((p) => ({ split_no: s.split_no, payment_class: p.payment_class, direction: p.direction, amount_minor: p.amount_minor, tendered_minor: p.tendered_minor })),
    );
    result = computeBill({ ...base.input, plan, payments });
  }
  const unresolved = new Set((result?.lines ?? []).filter((l) => l.tags.includes('tax_unresolved')).map((l) => l.order_item_id));

  // splits of the view
  const pv = { modeName: modeNames(billing), directory: c.directory, full: access === 'full' };
  const viewSplits: BillViewSplit[] = splits.map((s) => {
    const payments = (paymentsOf.get(s.split_no) ?? []).map((p) => paymentView(p, pv));
    if (s.state === 'closed') return closedSplitView(s, head.split_mode, payments);
    const r = result!.splits.find((x) => x.split_no === s.split_no)!;
    return {
      split_no: s.split_no,
      state: 'open',
      plan: planView(head.split_mode, s),
      payments,
      totals: { cash: toTotals(r.totals.cash), digital: toTotals(r.totals.digital), as_paid: toTotals(r.totals.as_paid) },
      balance_minor: r.balance_minor,
      invoice: null,
    };
  });

  // buyer (B19): the whole bill's net = closed invoices' + the open remainder's (bases − discount)
  const totalsDefault = result === null ? ZERO_TOTALS : toTotals(result.totals_default);
  const net = closedRows.reduce((a, s) => a + (s.inv_subtotal_minor ?? 0) - (s.inv_discount_minor ?? 0), 0) + totalsDefault.subtotal_minor - totalsDefault.discount_minor;
  const rule = billingRule(billing, head.business_date);
  const threshold = rule?.buyer_id.threshold_minor ?? null;
  const buyer = { required: threshold !== null && net > threshold, threshold_minor: threshold, waived: head.buyer_waived };

  const openRequests = open.filter((a) => (BILL_REQUEST_KINDS as readonly string[]).includes(a.kind)).map((a) => ({ kind: a.kind, alert_id: a.alert_id }));
  const blocks = blocksOf({ head, lines, pendingIds, result, openSplits: openSplits.map((s) => s.split_no), openRequests, buyer, net, accepted: rule?.buyer_id.accepted_types.map((t) => t.type) ?? [] });

  const statusOf = new Map(jobStatus.map((j) => [j.job_id, j]));
  const prints = jobs.flatMap((j) => {
    const st = statusOf.get(j.job_id);
    return st === undefined ? [] : [{ job_id: j.job_id, doc_kind: j.doc_kind, state: st.state, printer_name: st.printer_name, last_error: st.last_error }];
  });
  const discountLines = new Set(head.discount_line_ids);
  const checkPrinted = [head.check_printed_at, head.seating?.bill_requested_at ?? null].filter((x): x is number => x !== null);

  return {
    bill_id: head.bill_id,
    state: head.state,
    scope: head.scope,
    order_type: head.order_type,
    identifier: identifierOf(head, config, orders, c.openDay),
    orders: order_ids,
    lines: lines.map((l) => ({
      order_item_id: l.order_item_id,
      order_id: l.order_id,
      name: l.name,
      options: l.options,
      units: l.live_units,
      base_minor: lineBase(l, refundOf.get(l.order_item_id) ?? 0),
      tax_profile_id: l.tax_profile_id,
      tags: [
        ...(l.comped_units > 0 ? (['comp'] as const) : []),
        ...(pendingIds.has(l.order_item_id) ? (['pending_void'] as const) : []),
        ...(l.line_total_minor === null ? (['weight_needed'] as const) : []),
        ...(unresolved.has(l.order_item_id) ? (['tax_unresolved'] as const) : []),
      ],
      added_after_close: hasClosed && !discountLines.has(l.order_item_id),
      part_of: l.part_of,
    })),
    service_charge: sc,
    discount:
      head.discount === null
        ? null
        : { kind: head.discount.kind, value: head.discount.value, reason_code: head.discount.reason_code, frozen_minor: head.discount.frozen_minor, discount_minor: closedDiscount + (result?.discount_minor ?? 0) },
    splits: viewSplits,
    totals_default: totalsDefault,
    buyer,
    blocks,
    open_requests: openRequests,
    prints,
    check_printed_at: checkPrinted.length === 0 ? null : Math.max(...checkPrinted),
    reopen_count: head.reopen_count,
    currency: { code: billing.jurisdiction.currency_code, exponent: billing.jurisdiction.currency_exponent },
    prices_include_tax: rules.prices_include_tax,
    as_of_seq: head.as_of_seq,
  };
}

function billingRule(billing: HubBilling, business_date: string) {
  let best: HubBilling['jurisdiction']['rules'][number] | null = null;
  for (const r of billing.jurisdiction.rules) if (r.effective_from <= business_date && (best === null || r.effective_from > best.effective_from)) best = r;
  return best;
}

/** The open splits' compute plan (§3.8): no split mode → the one open split; items → their `bill_split_lines`. */
export function planOf(head: Pick<BillHead, 'split_mode'>, openSplits: ReadonlyArray<Pick<SplitRow, 'split_no' | 'plan_json' | 'plan_lines_json'>>): ComputePlan {
  const nos = openSplits.map((s) => s.split_no);
  if (head.split_mode === null) return { mode: 'none', split_no: nos[0]! };
  if (head.split_mode === 'items') {
    return { mode: 'items', splits: openSplits.map((s) => ({ split_no: s.split_no, lines: JSON.parse(s.plan_lines_json) as Array<{ order_item_id: string; units: number }> })) };
  }
  if (head.split_mode === 'amount') {
    return { mode: 'amount', splits: openSplits.map((s) => ({ split_no: s.split_no, share_minor: (JSON.parse(s.plan_json ?? '{"share_minor":0}') as { share_minor: number }).share_minor })) };
  }
  return { mode: 'equal', splits: openSplits.map((s) => ({ split_no: s.split_no })) };
}

/**
 * §6.1 `plan` of a split as the fold stores it (§5). A closed split keeps its own plan whatever the bill's mode now
 * (§3.8): its `plan_json` (amount `{ share_minor }`, equal `{ n, k }`), else its item rows, else null. An open split
 * follows the bill's `split_mode`: items → its `bill_split_lines` rows; otherwise `plan_json` (null for none).
 */
export function planView(splitMode: BillHead['split_mode'], s: Pick<SplitRow, 'state' | 'plan_json' | 'plan_lines_json'>): BillViewSplit['plan'] {
  const rows = (): Array<{ order_item_id: string; units: number }> => JSON.parse(s.plan_lines_json) as Array<{ order_item_id: string; units: number }>;
  if (s.state === 'closed' && s.plan_json === null) {
    const lines = rows();
    return lines.length === 0 ? null : { lines };
  }
  if (s.state === 'open' && splitMode === 'items') return { lines: rows() };
  if (s.plan_json === null) return null;
  return JSON.parse(s.plan_json) as { share_minor: number } | { n: number; k: number };
}

/** A closed split's totals from its current invoice (SPLITS_OF_BILL columns); zero when it has none. */
export function invoiceTotals(s: SplitRow): Totals {
  if (s.doc_json === null) return ZERO_TOTALS;
  const doc = JSON.parse(s.doc_json) as { taxes: Array<Totals['taxes'][number]> };
  return {
    subtotal_minor: s.inv_subtotal_minor as number,
    discount_minor: s.inv_discount_minor as number,
    service_charge_minor: s.inv_service_charge_minor as number,
    taxes: doc.taxes.map((x) => ({
      tax_profile_id: x.tax_profile_id,
      tax_code: x.tax_code,
      label: x.label,
      payment_class: x.payment_class,
      rate_bp: x.rate_bp,
      base_minor: x.base_minor,
      tax_minor: x.tax_minor,
      rate_ref: x.rate_ref ?? null,
    })),
    rounding_minor: s.inv_rounding_minor as number,
    total_minor: s.inv_total_minor as number,
  };
}

/**
 * R-29 (§6.1 table): one entry per §3.3 rule that would refuse `CloseSplit` now — bill rules once (`split_no: null`),
 * split rules per open split — ordered by rule, then split_no; `details` = the §9 error's. A CLOSED or absorbed bill
 * shows rule 1 only (the close stops there). Rules 5, 7, 9 never appear. In memory.
 */
function blocksOf(o: {
  head: BillHead;
  lines: readonly LineView[];
  pendingIds: ReadonlySet<string>;
  result: ComputeBillResult | null;
  openSplits: readonly number[];
  openRequests: ReadonlyArray<{ kind: string; alert_id: string }>;
  buyer: { required: boolean; threshold_minor: number | null; waived: boolean };
  net: number;
  accepted: string[];
}): BillBlock[] {
  const { head, result } = o;
  if (head.state === 'closed' || head.absorbed) return [{ reason: 'bill_not_open', split_no: null, details: { bill_id: head.bill_id, state: head.absorbed ? 'absorbed' : head.state } }];
  const out: BillBlock[] = [];
  // 2: pending voids on the bill's orders (≤ 40 ids)
  const voidIds = o.lines.map((l) => l.order_item_id).filter((id) => o.pendingIds.has(id));
  if (voidIds.length > 0) out.push({ reason: 'void_pending', split_no: null, details: { reason: 'void_pending', order_item_ids: voidIds.slice(0, 40) } });
  const splits = result?.splits ?? [];
  // 3: a pending weight on a line of the split
  const weightIds = new Set(o.lines.filter((l) => l.line_total_minor === null).map((l) => l.order_item_id));
  for (const s of splits) {
    const ids = s.lines.filter((l) => l.units > 0 && weightIds.has(l.order_item_id)).map((l) => l.order_item_id);
    if (ids.length > 0) out.push({ reason: 'weight_pending', split_no: s.split_no, details: { reason: 'weight_pending', order_item_ids: ids.slice(0, 40) } });
  }
  // 3a: compute's per-split tax_unresolved (may hold 'service_charge', R-1)
  for (const s of splits) {
    const ids = s.blocks.filter((b) => b.reason === 'tax_unresolved').flatMap((b) => b.ids);
    if (ids.length > 0) out.push({ reason: 'tax_unresolved', split_no: s.split_no, details: { reason: 'tax_unresolved', order_item_ids: [...new Set(ids)].slice(0, 40) } });
  }
  // 4: an open discount request on the bill
  const discountReq = o.openRequests.find((r) => r.kind === 'discount');
  if (discountReq !== undefined) out.push({ reason: 'discount_pending', split_no: null, details: { alert_id: discountReq.alert_id } });
  // 6: buyer tax ID required and not waived
  if (o.buyer.required && !o.buyer.waived) {
    out.push({ reason: 'buyer_id_required', split_no: null, details: { threshold_minor: o.buyer.threshold_minor, net_minor: o.net, accepted_types: o.accepted } });
  }
  // 8: balance not 0
  for (const s of splits) if (s.balance_minor !== 0) out.push({ reason: 'balance_due', split_no: s.split_no, details: { split_no: s.split_no, balance_minor: s.balance_minor } });
  // 8a: the re-based last amount share below 1 minor unit
  const shares = result?.blocks.find((b) => b.reason === 'shares_sum');
  if (shares !== undefined) out.push({ reason: 'shares_sum', split_no: Number(shares.ids[0] ?? o.openSplits[o.openSplits.length - 1]), details: { reason: 'shares_sum' } });
  return out;
}

// ------------------------------------------------------------------------------------------------ registration

/** §6.1 query string: exactly one of seating_id / order_id / bill_id. */
export const BillQuery = z
  .object({ seating_id: z.string().min(1).optional(), order_id: z.string().min(1).optional(), bill_id: z.string().min(1).optional() })
  .strict()
  .refine((q) => [q.seating_id, q.order_id, q.bill_id].filter((v) => v !== undefined).length === 1, { message: 'exactly one of seating_id, order_id, bill_id' });

export function refOf(q: z.infer<typeof BillQuery>): BillRef {
  if (q.bill_id !== undefined) return { bill_id: q.bill_id };
  if (q.seating_id !== undefined) return { seating_id: q.seating_id };
  return { order_id: q.order_id! };
}

export function registerBillQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'bill',
      sessionKind: 'device',
      session: 'required',
      querySchema: BillQuery,
      handle(ctx: QueryCtx, q) {
        if (ctx.branchConfig === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
        const view = billView(
          {
            db: ctx.db,
            config: ctx.branchConfig,
            directory: ctx.directory,
            staffId: ctx.session?.staff_id ?? null,
            openDay: ctx.state.business_day?.business_date ?? null,
            permissions: ['take-payment', 'take-order'],
          },
          refOf(q),
        );
        return { data: view };
      },
    }),
  );
}
