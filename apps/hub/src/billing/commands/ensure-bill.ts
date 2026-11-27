// 05 §6 "Common bill-open step (ensure bill)", §6.1 `openBillOf`, B1, B8, H9-9, H16-2 (task 10). Every bill command
// resolves its `bill_ref` here: `openBillOf` (1 statement) → the bill, or none → the seating / order checks on the same
// row (no second read) → `BillOpened` (price mode and rounding rule in force now, frozen for the bill) +
// `ChargeApplied { source: 'rule' }` (`service_charge_bp[order_type]`; 0 → none). The drafts are the caller's to
// append in its own writer transaction; nothing is written here. The `bill` query reads the same row (projected bill).
import { DomainError, type ComputeRules } from '@pos/domain';
import { BillOpened, BillOpenedPayload, ChargeApplied, ChargeAppliedPayload, draftOf, type BranchConfig, type EventDraft } from '@pos/events';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { CommandCtx } from '../../commands/registry.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { computeRulesAt, hubBilling, type HubBilling } from '../defaults.js';

/** §6 `bill_ref`: exactly one of `{ bill_id }`, `{ seating_id }`, `{ order_id }`. */
export const BillRef = z.union([
  z.object({ bill_id: z.string().min(1) }).strict(),
  z.object({ seating_id: z.string().min(1) }).strict(),
  z.object({ order_id: z.string().min(1) }).strict(),
]);
export type BillRef = z.infer<typeof BillRef>;

export type BillOrderType = 'dine_in' | 'takeaway' | 'parking';
export type BillState = 'projected' | 'open' | 'partly_paid' | 'closed';

export interface BillDiscountState {
  kind: 'amount' | 'percent';
  value: number;
  reason_code: string;
  alert_id: string | null;
  frozen_minor: number | null;
}

export interface BillRounding {
  step_minor: number | null;
  mode: ComputeRules['rounding']['mode'];
  applies_to: ComputeRules['rounding']['applies_to'];
}

/** The bill a `bill_ref` names, as `openBillOf` read it (a projected bill has `bill_id: null`). */
export interface BillHead {
  bill_id: string | null;
  scope: 'seating' | 'key';
  seating_id: string | null;
  bill_key: string | null;
  order_type: BillOrderType;
  state: BillState;
  /** §3.9: merged into another bill; never live again */
  absorbed: boolean;
  reopen_mode: 'full' | 'corrections' | null;
  reopen_count: number;
  opened_at: number | null;
  sc_bp: number;
  sc_removed: boolean;
  discount: BillDiscountState | null;
  split_mode: 'items' | 'amount' | 'equal' | null;
  buyer_waived: boolean;
  check_printed_at: number | null;
  /** frozen at BillOpened (H9-9); null for a projected bill (the mode in force now applies) */
  prices_include_tax: boolean | null;
  /** frozen at BillOpened (H16-2); null for a projected bill */
  rounding: BillRounding | null;
  /** R-29: `bill_discount_lines` of the bill, read in the same statement */
  discount_line_ids: string[];
  /** 02a seating of a dine-in bill (read-only); null for scope `key` or an unknown seating */
  seating: { seating_id: string; state: string; holder_staff_id: string; primary_table_id: string; bill_requested_at: number | null; opened_at: number } | null;
  /** the order a `{ order_id }` ref named */
  /** ⚠️ 05 v1.0.35 §6.3a (run 3 R3-M-2): `business_date` for the addition guards, in the same read */
  ref_order: { order_id: string; order_type: BillOrderType; cancelled: boolean; placed_by: string; business_date: string } | null;
  /** the open business day, else the last one opened (`billing_day`); null before any */
  business_date: string | null;
  as_of_seq: number;
}

interface OpenBillRow {
  t_seating_id: string | null;
  t_bill_key: string | null;
  o_id: string | null;
  o_type: BillOrderType | null;
  o_cancelled_at: number | null;
  o_placed_by: string | null;
  o_business_date: string | null;
  bill_id: string | null;
  scope: 'seating' | 'key' | null;
  b_seating_id: string | null;
  table_key: string | null;
  order_type: BillOrderType | null;
  state: 'open' | 'partly_paid' | 'closed' | null;
  opened_at: number | null;
  sc_bp: number | null;
  sc_removed: number | null;
  discount_json: string | null;
  split_mode: BillHead['split_mode'];
  buyer_waived: number | null;
  check_printed_at: number | null;
  reopen_count: number | null;
  reopen_mode: BillHead['reopen_mode'];
  absorbed_into: string | null;
  prices_include_tax: number | null;
  rounding_json: string | null;
  discount_line_ids: string | null;
  s_id: string | null;
  s_state: string | null;
  s_holder: string | null;
  s_primary_table_id: string | null;
  s_bill_requested_at: number | null;
  s_opened_at: number | null;
  billing_date: string | null;
  as_of_seq: number;
}

// The target of the ref (t): a bill's own seating / key, the seating named, or the order's seating (dine-in) or
// bill_key (takeaway / parking, 02b row Q-6). The bill picked: the bill named; else the bill whose `bill_orders` hold
// the order named (its bill even when reopened for corrections); else the live bill of the target (the bills_live_*
// predicate); else, when the target has no order that is neither billed nor cancelled (orders kept by a corrections
// reopen are that bill's, §3.10, as open-bills reads them), its latest bill (a closed bill
// stays the seating's bill until a new order); else none (projected, B1).
const TARGET_BILL = `((t.seating_id IS NOT NULL AND b.seating_id = t.seating_id) OR (t.bill_key IS NOT NULL AND b.table_key = t.bill_key))`;
const OPEN_BILL_OF = `
WITH
ro AS (
  SELECT o.order_id, o.order_type, o.cancelled_at, o.bill_key, o.placed_by, o.business_date, so.seating_id,
         (SELECT bo.bill_id FROM bill_orders bo JOIN bills x ON x.bill_id = bo.bill_id
           WHERE bo.order_id = o.order_id AND x.absorbed_into IS NULL ORDER BY x.opened_at DESC, x.rowid DESC LIMIT 1) AS own_bill_id
  FROM orders o LEFT JOIN seating_orders so ON so.order_id = o.order_id
  WHERE o.order_id = @order_id
),
rb AS (SELECT bill_id, seating_id, table_key FROM bills WHERE bill_id = @bill_id),
t AS (
  SELECT
    CASE WHEN @bill_id IS NOT NULL THEN (SELECT seating_id FROM rb)
         WHEN @seating_id IS NOT NULL THEN @seating_id
         ELSE (SELECT seating_id FROM ro WHERE order_type = 'dine_in') END AS seating_id,
    CASE WHEN @bill_id IS NOT NULL THEN (SELECT table_key FROM rb)
         WHEN @seating_id IS NOT NULL THEN NULL
         ELSE (SELECT bill_key FROM ro WHERE order_type <> 'dine_in') END AS bill_key
),
pick AS (
  SELECT CASE
    WHEN @bill_id IS NOT NULL THEN (SELECT bill_id FROM rb)
    WHEN (SELECT own_bill_id FROM ro) IS NOT NULL THEN (SELECT own_bill_id FROM ro)
    ELSE COALESCE(
      (SELECT b.bill_id FROM bills b, t WHERE ${TARGET_BILL}
          AND b.absorbed_into IS NULL AND b.state <> 'closed' AND b.reopen_mode IS NOT 'corrections'),
      CASE WHEN EXISTS (
          SELECT 1 FROM orders o2, t WHERE o2.cancelled_at IS NULL AND o2.billed_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM bill_orders bo JOIN bills x ON x.bill_id = bo.bill_id
                              WHERE bo.order_id = o2.order_id AND x.reopen_mode = 'corrections' AND x.state <> 'closed')
             AND ((t.seating_id IS NOT NULL AND o2.order_id IN (SELECT order_id FROM seating_orders WHERE seating_id = t.seating_id))
               OR (t.bill_key IS NOT NULL AND o2.bill_key = t.bill_key)))
        THEN NULL
        ELSE (SELECT b.bill_id FROM bills b, t WHERE ${TARGET_BILL} AND b.absorbed_into IS NULL ORDER BY b.opened_at DESC, b.rowid DESC LIMIT 1)
      END)
  END AS bill_id
)
SELECT t.seating_id AS t_seating_id, t.bill_key AS t_bill_key,
       ro.order_id AS o_id, ro.order_type AS o_type, ro.cancelled_at AS o_cancelled_at, ro.placed_by AS o_placed_by, ro.business_date AS o_business_date,
       b.bill_id, b.scope, b.seating_id AS b_seating_id, b.table_key, b.order_type, b.state, b.opened_at, b.sc_bp, b.sc_removed,
       b.discount_json, b.split_mode, b.buyer_waived, b.check_printed_at, b.reopen_count, b.reopen_mode, b.absorbed_into,
       b.prices_include_tax, b.rounding_json,
       (SELECT json_group_array(d.order_item_id) FROM bill_discount_lines d WHERE d.bill_id = b.bill_id) AS discount_line_ids,
       s.seating_id AS s_id, s.state AS s_state, s.holder_staff_id AS s_holder, s.primary_table_id AS s_primary_table_id,
       s.bill_requested_at AS s_bill_requested_at, s.opened_at AS s_opened_at,
       (SELECT business_date FROM billing_day WHERE k = 1) AS billing_date,
       (SELECT COALESCE(MAX(seq), 0) FROM events) AS as_of_seq
FROM t LEFT JOIN ro ON 1 LEFT JOIN pick ON 1
LEFT JOIN bills b ON b.bill_id = pick.bill_id
LEFT JOIN seatings s ON s.seating_id = COALESCE(b.seating_id, t.seating_id)`;

/** What `openBillOf` resolved: the head (projected when no bill row), and whether the ref found anything at all. */
export interface OpenBill {
  head: BillHead;
  /** a `{ bill_id }` ref naming no bill, or an `{ order_id }` ref naming no order */
  missing: boolean;
}

/**
 * §6, §6.1 `openBillOf`: the bill `ref` names, with its seating, `reopen_count` and `bill_discount_lines` ids, the
 * current business date and the last seq — 1 statement. `state` of the open business day comes from the caller.
 */
export function openBillOf(db: Database.Database, ref: BillRef, openDay: string | null): OpenBill {
  const params = {
    bill_id: 'bill_id' in ref ? ref.bill_id : null,
    seating_id: 'seating_id' in ref ? ref.seating_id : null,
    order_id: 'order_id' in ref ? ref.order_id : null,
  };
  const r = db.prepare(OPEN_BILL_OF).get(params) as OpenBillRow;
  const missing = (params.bill_id !== null && r.bill_id === null) || (params.order_id !== null && r.o_id === null);
  const seating =
    r.s_id === null
      ? null
      : {
          seating_id: r.s_id,
          state: r.s_state as string,
          holder_staff_id: r.s_holder as string,
          primary_table_id: r.s_primary_table_id as string,
          bill_requested_at: r.s_bill_requested_at,
          opened_at: r.s_opened_at as number,
        };
  const ref_order =
    r.o_id === null
      ? null
      : { order_id: r.o_id, order_type: r.o_type as BillOrderType, cancelled: r.o_cancelled_at !== null, placed_by: r.o_placed_by as string, business_date: r.o_business_date as string };
  const common = { seating, ref_order, business_date: openDay ?? r.billing_date, as_of_seq: r.as_of_seq };
  if (r.bill_id !== null) {
    const discount = r.discount_json === null ? null : (JSON.parse(r.discount_json) as BillDiscountState);
    return {
      missing,
      head: {
        bill_id: r.bill_id,
        scope: r.scope as 'seating' | 'key',
        seating_id: r.b_seating_id,
        bill_key: r.table_key,
        order_type: r.order_type as BillOrderType,
        state: r.state as 'open' | 'partly_paid' | 'closed',
        absorbed: r.absorbed_into !== null,
        reopen_mode: r.reopen_mode,
        reopen_count: r.reopen_count ?? 0,
        opened_at: r.opened_at,
        sc_bp: r.sc_bp ?? 0,
        sc_removed: r.sc_removed === 1,
        discount,
        split_mode: r.split_mode,
        buyer_waived: r.buyer_waived === 1,
        check_printed_at: r.check_printed_at,
        prices_include_tax: r.prices_include_tax === 1,
        rounding: JSON.parse(r.rounding_json as string) as BillRounding,
        discount_line_ids: JSON.parse(r.discount_line_ids ?? '[]') as string[],
        ...common,
      },
    };
  }
  const scope: 'seating' | 'key' = r.t_seating_id !== null || (ref_order !== null && ref_order.order_type === 'dine_in') || 'seating_id' in ref ? 'seating' : 'key';
  return {
    missing,
    head: {
      bill_id: null,
      scope,
      seating_id: scope === 'seating' ? (r.t_seating_id ?? null) : null,
      bill_key: scope === 'key' ? r.t_bill_key : null,
      order_type: scope === 'seating' ? 'dine_in' : ((ref_order?.order_type ?? 'takeaway') as BillOrderType),
      state: 'projected',
      absorbed: false,
      reopen_mode: null,
      reopen_count: 0,
      opened_at: null,
      sc_bp: 0,
      sc_removed: false,
      discount: null,
      split_mode: null,
      buyer_waived: false,
      check_printed_at: null,
      prices_include_tax: null,
      rounding: null,
      discount_line_ids: [],
      ...common,
    },
  };
}

/** The branch's billing data and the compute rules in force on `business_date` (0 statements; config in memory). */
export function billingAt(config: BranchConfig, business_date: string): { billing: HubBilling; rules: ComputeRules } {
  const billing = hubBilling(config);
  const rules = computeRulesAt(billing, { business_date, tax_enabled: config.tax_enabled });
  // MIN_EFFECTIVE_FROM precedes every business date the hub opens, and A-2 refuses a document without a row in force
  if (rules === null) throw new Error(`billing: no jurisdiction rule in force on ${business_date}`);
  return { billing, rules };
}

/**
 * §6 ensure bill. Returns the bill the ref names (any state: each command checks the state it needs), or the drafts
 * that open it: `BillOpened` + `ChargeApplied { source: 'rule' }` (none when the order type's rate is 0). Refusals,
 * in order: `404 BILL_NOT_FOUND` (unknown bill id), `404 ORDER_NOT_FOUND` (unknown order id), and with no bill:
 * `409 TABLE_NOT_OPEN` (a seating that is not open), `409 BILL_NOT_OPEN { bill_id: null, state: 'cancelled' }` (a
 * cancelled order), `409 BUSINESS_DAY_NOT_OPEN` (no config or no business day ever opened). 1 statement.
 */
export function ensureBill(ctx: CommandCtx, ref: BillRef): { head: BillHead; events: EventDraft[]; created: boolean } {
  const { head, missing } = openBillOf(ctx.tx.db, ref, ctx.state.business_day?.business_date ?? null);
  if (missing && 'bill_id' in ref) throw new DomainError('BILL_NOT_FOUND', { bill_id: ref.bill_id });
  if (missing && 'order_id' in ref) throw new DomainError('ORDER_NOT_FOUND', { order_id: ref.order_id });
  if (head.bill_id !== null) return { head, events: [], created: false };

  if (head.scope === 'seating') {
    if (head.seating === null || head.seating.state === 'CLOSED' || head.seating_id === null) {
      throw new DomainError('TABLE_NOT_OPEN', { table_id: head.seating?.primary_table_id ?? null });
    }
  }
  if (head.ref_order?.cancelled === true) throw new DomainError('BILL_NOT_OPEN', { bill_id: null, state: 'cancelled' });
  // a takeaway / parking order not yet sent cannot exist (B16); an order folded before 0021 has no bill_key
  if (head.scope === 'key' && head.bill_key === null) throw new DomainError('ORDER_NOT_FOUND', { order_id: head.ref_order?.order_id ?? null });

  const config = branchConfig();
  if (config === null || head.business_date === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  const { billing, rules } = billingAt(config, head.business_date);
  const bill_id = ctx.ids.next();
  const env = { occurred_at: ctx.clock.branchNow(), actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
  const rounding = { ...rules.rounding };
  const opened = BillOpenedPayload.parse({
    bill_id,
    scope: head.scope,
    seating_id: head.scope === 'seating' ? head.seating_id : null,
    bill_key: head.scope === 'key' ? head.bill_key : null,
    order_type: head.order_type,
    prices_include_tax: rules.prices_include_tax,
    rounding,
  });
  const events: EventDraft[] = [draftOf(BillOpened, { stream_type: 'bill', stream_id: bill_id, payload: opened, ...env })];
  const rate_bp = billing.settings.service_charge_bp[head.order_type];
  if (rate_bp > 0) {
    const charge = ChargeAppliedPayload.parse({ bill_id, charge: 'service', rate_bp, source: 'rule', has_note: false, note_id: null });
    events.push(draftOf(ChargeApplied, { stream_type: 'bill', stream_id: bill_id, payload: charge, ...env }));
  }
  return {
    created: true,
    events,
    head: {
      ...head,
      bill_id,
      state: 'open',
      opened_at: env.occurred_at,
      sc_bp: rate_bp,
      prices_include_tax: rules.prices_include_tax,
      rounding,
    },
  };
}
