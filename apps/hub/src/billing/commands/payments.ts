// 05 §6.9 `AddPayment` (⚠️ v1.0.37 R2-1: `expected_due_minor`, `BILL_DUE_CHANGED`), §6.10 `RemovePayment` (task 16), §3.5 (7), §3.7, B10, B11, B30, H1-20, H8-3 / R-46, R-44.
// Grant first (the pipeline's `take-payment`, 403 before any read), ensure bill inside the writer transaction, the scope
// last (C8). The money is the bill view's own reading (queries/bill.ts exports) and compute.ts: the split before this
// payment gives the dues an `in` / `out` is held to, the split with it gives the result (M-7). The reference text goes
// only to the hub-only `payment_references` (H1-20); `hashOmit` keeps it (and RemovePayment's note) out of
// `payload_hash` (H-4, H16-7), and no error, event, log or result carries it.
// Statements (handler; the append and its folds are 00's envelope), fixed whatever the number of lines, splits or
// payments — AddPayment ≤ 7: ensure bill (1), SPLITS_OF_BILL (1; none for a bill opened here), the money shift (1),
// orders of the bill (1), orderLines (1), pendingVoids (1), the payment_references insert (1, with a reference only).
// RemovePayment ≤ 2: the payment with its bill, split, shift, seating and order placers (1), the bill_texts note (1,
// with a note only).
import { computeBill, DomainError, type ComputeBillResult, type ComputePayment } from '@pos/domain';
import { draftOf, PaymentAdded, PaymentAddedPayload, PaymentRemoved, PaymentRemovedPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { orderLines } from '../../orders/exports.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { pendingVoids } from '../../voids/exports.js';
import { NONE_ADAPTER_KEY } from '../fiscal/none.js';
import {
  billAccess,
  billComputeBase,
  billLines,
  ONE_OPEN_SPLIT,
  ORDERS_OF_BILL,
  ordersOfBillParams,
  planOf,
  SPLITS_OF_BILL,
  toTotals,
  type PaymentRow,
  type SplitRow,
} from '../queries/bill.js';
import { CANCELLED_ORDERS_OF_BILL, emptyCloseDrafts } from './close-split.js';
import { billingAt, BillRef, ensureBill, type BillHead } from './ensure-bill.js';

/** H16-13: money caps scaled for any currency. */
const MAX_MINOR = Math.min(1e12, Number.MAX_SAFE_INTEGER);
const Minor = z.number().int().min(1).max(MAX_MINOR);

// ------------------------------------------------------------------------------------------------ AddPayment

/** §6.9: `reference` 1–60 (never echoed: hashOmit); `tendered_minor` only on an `in`, ≥ the amount (cash: handler). */
export const AddPaymentPayload = z
  .object({
    bill_ref: BillRef,
    split_no: z.number().int().min(1).max(20),
    mode_id: z.string().min(1),
    direction: z.enum(['in', 'out']),
    amount_minor: Minor,
    // ⚠️ 05 v1.0.37 §6.9 (owner 2026-11-28 QA-R2, R2-1; BUG-1): the due the cashier saw — the due field this payment is
    // held to, of the split before it (an in: cash_due / card_due; an out: its refund due). Required.
    expected_due_minor: z.number().int().min(0).max(MAX_MINOR),
    tendered_minor: Minor.optional(),
    reference: z.string().min(1).max(60).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.tendered_minor === undefined) return;
    if (p.direction !== 'in') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tendered_minor'], message: 'tendered only on a cash in' });
    else if (p.tendered_minor < p.amount_minor) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tendered_minor'], message: 'tendered below the amount' });
  });
export type AddPaymentPayload = z.infer<typeof AddPaymentPayload>;

// B11: the device's open drawer shift, else the caller's own open shift (1 statement).
const MONEY_SHIFT = `
SELECT
  (SELECT shift_id FROM shifts WHERE drawer_device_id = @device_id AND state = 'open') AS drawer_shift_id,
  (SELECT shift_id FROM shifts WHERE staff_id = @staff_id AND state = 'open') AS own_shift_id`;

const exceeds = (balance_minor: number) => new DomainError('PAYMENT_EXCEEDS_BALANCE', { balance_minor });

/** The bill / split refusal (§9 `{ bill_id, state }`): a closed or absorbed bill, a closed or unknown split → 'closed'. */
function notOpen(head: Pick<BillHead, 'bill_id' | 'absorbed' | 'state'>, splitClosed: boolean): DomainError {
  return new DomainError('BILL_NOT_OPEN', { bill_id: head.bill_id, state: head.absorbed ? 'absorbed' : splitClosed ? 'closed' : head.state });
}

export const AddPayment = defineCommand({
  commandType: 'AddPayment',
  payloadSchema: AddPaymentPayload,
  sessionKind: 'device',
  permission: 'take-payment',
  hashOmit: ['reference'],
  handle(ctx, p) {
    const staff_id = ctx.actor.staffId;
    if (staff_id === null) throw new DomainError('PERMISSION_DENIED', { permission: 'take-payment', grant: 'not_granted' });
    const { head, events, created } = ensureBill(ctx, p.bill_ref); // 1
    if (head.state === 'closed' || head.absorbed) throw notOpen(head, false);
    const bill_id = head.bill_id as string;
    const db = ctx.tx.db;
    const config = branchConfig();
    if (config === null || head.business_date === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');

    // split open (§3.3 rule 1)
    const rows = created ? [] : (db.prepare(SPLITS_OF_BILL).all(bill_id) as SplitRow[]); // 2
    const splits = rows.length === 0 ? [ONE_OPEN_SPLIT] : rows;
    const split = splits.find((s) => s.split_no === p.split_no);
    if (split === undefined || split.state !== 'open') throw notOpen(head, true);

    // mode active in settings → tender only on a cash in (H2-28)
    const { billing, rules: atDay } = billingAt(config, head.business_date);
    const mode = billing.settings.payment_modes.find((m) => m.mode_id === p.mode_id && m.is_active);
    if (mode === undefined) throw new DomainError('PAYMENT_MODE_NOT_FOUND', { mode_id: p.mode_id });
    const payment_class = mode.payment_class;
    if (p.tendered_minor !== undefined && payment_class !== 'cash') {
      throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'tendered_minor', message: 'tendered only on a cash in' }] });
    }

    // H8-3 / R-46: a split that will be fiscalized takes only a mode with a code for the branch's adapter
    const adapter_key = billing.jurisdiction.adapter_key;
    const f = billing.settings.fiscal;
    const now = ctx.clock.branchNow();
    const fiscalized = adapter_key !== NONE_ADAPTER_KEY && f.fiscalize_by_order_type[head.order_type] && (f.switched_at === null || now >= Date.parse(f.switched_at));
    if (fiscalized && !mode.authority_codes.some((c) => c.adapter_key === adapter_key)) {
      throw new DomainError('PAYMENT_MODE_NOT_FISCAL', { mode_id: mode.mode_id, adapter_key });
    }
    if (mode.reference_required && p.reference === undefined) throw new DomainError('PAYMENT_REFERENCE_REQUIRED', { mode_id: mode.mode_id });

    // the money shift (B11)
    const shift = db.prepare(MONEY_SHIFT).get({ device_id: ctx.actor.deviceId, staff_id }) as { drawer_shift_id: string | null; own_shift_id: string | null }; // 3
    const shift_id = shift.drawer_shift_id ?? shift.own_shift_id;
    if (shift_id === null) throw new DomainError('SHIFT_NOT_OPEN', { reason: 'no_shift' });

    // lines, pending voids, payments of the split → the split before this payment (§3.5, §3.6)
    const orders = db.prepare(ORDERS_OF_BILL).all({ ...ordersOfBillParams(head), bill_id: created ? null : bill_id }) as Array<{ order_id: string; placed_by: string }>; // 4
    const order_ids = orders.map((o) => o.order_id);
    const byOrder = orderLines(db, order_ids); // 5
    const voids = pendingVoids(db, order_ids); // 6
    const lines = billLines(order_ids, byOrder);
    const { input: base } = billComputeBase({ head, billing, rules: atDay, lines, voids, splits });
    const openRows = splits.filter((s) => s.state === 'open');
    const plan = planOf(head, openRows);
    const existing: ComputePayment[] = openRows.flatMap((s) =>
      (JSON.parse(s.payments_json) as PaymentRow[]).map((x) => ({ split_no: s.split_no, payment_class: x.payment_class, direction: x.direction, amount_minor: x.amount_minor, tendered_minor: x.tendered_minor })),
    );
    const before = splitOf(computeBill({ ...base, plan, payments: existing }), p.split_no);

    // ⚠️ 05 v1.0.37 §6.9 (R2-1): a stale screen (the bill changed since it was read) is refused before any amount rule;
    // nothing written. A resend with the same command_id replays the stored reply and never reaches here (00 pipeline).
    const seen =
      p.direction === 'in'
        ? payment_class === 'digital'
          ? before.card_due_minor
          : before.cash_due_minor
        : payment_class === 'digital'
          ? before.card_refund_due_minor
          : before.cash_refund_due_minor;
    if (p.expected_due_minor !== seen) throw new DomainError('BILL_DUE_CHANGED', { split_no: p.split_no, expected_minor: p.expected_due_minor, due_minor: seen });

    // §3.5 (7), H16-3, H17-1: an in only while B > 0 and ≤ its due field; an out ≤ its type's refund due
    const rounding = base.rules.rounding;
    const stepRule = rounding.applies_to === 'cash' && rounding.step_minor !== null && payment_class === 'cash';
    if (p.direction === 'in') {
      if (before.balance_minor <= 0) throw exceeds(0);
      const due = payment_class === 'digital' ? before.card_due_minor : before.cash_due_minor;
      if (p.amount_minor > due) throw exceeds(due);
    } else {
      const due = payment_class === 'digital' ? before.card_refund_due_minor : before.cash_refund_due_minor;
      if (p.amount_minor > due) throw exceeds(due);
    }
    if (stepRule && p.amount_minor % (rounding.step_minor as number) !== 0) throw new DomainError('PAYMENT_CASH_STEP', { step_minor: rounding.step_minor });

    // C8: the scope last
    billAccess(ctx.directory, config, staff_id, { seating: head.seating, scope: head.scope, placed_by: orders.map((o) => o.placed_by) }, ['take-payment']);

    const payment_id = ctx.ids.next();
    const tendered = p.tendered_minor ?? null;
    const payload = PaymentAddedPayload.parse({
      payment_id,
      bill_id,
      split_no: p.split_no,
      mode_id: mode.mode_id,
      payment_class,
      direction: p.direction,
      amount_minor: p.amount_minor,
      tendered_minor: tendered,
      change_minor: tendered === null ? null : tendered - p.amount_minor,
      has_reference: p.reference !== undefined,
      taken_by_staff_id: staff_id,
      shift_id,
    });
    if (p.reference !== undefined) db.prepare('INSERT INTO payment_references (payment_id, reference) VALUES (?, ?)').run(payment_id, p.reference); // 7
    events.push(draftOf(PaymentAdded, { stream_type: 'bill', stream_id: bill_id, payload, occurred_at: now, actor_id: staff_id, device_id: ctx.actor.deviceId }));

    // the result: the split recomputed with this payment (pure; nothing re-read)
    const mine: ComputePayment = { split_no: p.split_no, payment_class, direction: p.direction, amount_minor: p.amount_minor, tendered_minor: tendered };
    const whole = computeBill({ ...base, plan, payments: [...existing, mine] });
    const after = splitOf(whole, p.split_no);
    // §6.9 / §3.10 (H7-3, H8-4; task 19 plan fix): an `out` that leaves a bill row whose every order is cancelled with
    // every split balance 0 also appends BillClosedEmpty (task 17's drafts). Statements (R-73, owner ruling, 05 v1.0.20):
    // ≤ 10 on this path — 8 (ensure bill, splits, money shift, orders, + the cancelled orders, credits, the seating's
    // other open bills (dine-in, seating not CLOSED), listOpen), + 1 when a `reference` is written, + 1 when closeMany
    // closes open 05 requests (01d's request_result raise inside it is 01d's own); every other path stays ≤ 7.
    if (p.direction === 'out' && !created && order_ids.length === 0 && whole.splits.every((s) => s.balance_minor === 0)) {
      const cancelled = db.prepare(CANCELLED_ORDERS_OF_BILL).pluck().all({ bill_id, seating_id: head.seating_id, bill_key: head.bill_key }) as string[];
      events.push(...emptyCloseDrafts(ctx, { bill_id, seating: head.seating, order_ids: cancelled }));
    }
    return {
      events,
      result: {
        bill_id,
        payment_id,
        split_no: p.split_no,
        totals: { as_paid: toTotals(after.totals.as_paid) },
        balance_minor: after.balance_minor,
        card_due_minor: after.card_due_minor,
        cash_due_minor: after.cash_due_minor,
        card_refund_due_minor: after.card_refund_due_minor,
        cash_refund_due_minor: after.cash_refund_due_minor,
        rounding_minor: after.rounding_minor,
        change_due_minor: tendered === null ? 0 : tendered - p.amount_minor,
      },
    };
  },
});

function splitOf(r: ComputeBillResult, split_no: number): ComputeBillResult['splits'][number] {
  const s = r.splits.find((x) => x.split_no === split_no);
  if (s === undefined) throw new Error(`AddPayment: split ${split_no} missing from the compute result`);
  return s;
}

// ------------------------------------------------------------------------------------------------ RemovePayment

/** §6.10; §4.4: `note` (≤ 200) required with reason `other` (never hashed: hashOmit). */
export const RemovePaymentPayload = z
  .object({
    payment_id: z.string().min(1),
    reason_code: PaymentRemovedPayload.shape.reason_code,
    note: z.string().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.reason_code === 'other' && p.note === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'note required for other' });
  });
export type RemovePaymentPayload = z.infer<typeof RemovePaymentPayload>;

interface PaymentOfRow {
  payment_id: string;
  bill_id: string;
  split_no: number;
  mode_id: string;
  payment_class: 'cash' | 'digital';
  direction: 'in' | 'out';
  amount_minor: number;
  tendered_minor: number | null;
  taken_by_staff_id: string;
  shift_id: string;
  removed_at: number | null;
  bill_state: 'open' | 'partly_paid' | 'closed';
  absorbed_into: string | null;
  scope: 'seating' | 'key';
  split_state: 'open' | 'closed' | null;
  shift_state: 'open' | 'closed' | null;
  s_id: string | null;
  s_state: string | null;
  s_holder: string | null;
  s_primary_table_id: string | null;
  s_bill_requested_at: number | null;
  s_opened_at: number | null;
  placed_by_json: string;
}

// The payment with its bill, split, shift and seating, and the placers of the bill's orders (ORDERS_OF_BILL's
// predicate on the payment's bill, for a key bill's scope) — 1 statement.
const PAYMENT_OF = `
SELECT p.payment_id, p.bill_id, p.split_no, p.mode_id, p.payment_class, p.direction, p.amount_minor, p.tendered_minor,
       p.taken_by_staff_id, p.shift_id, p.removed_at,
       b.state AS bill_state, b.absorbed_into, b.scope,
       s.state AS split_state, sh.state AS shift_state,
       st.seating_id AS s_id, st.state AS s_state, st.holder_staff_id AS s_holder, st.primary_table_id AS s_primary_table_id,
       st.bill_requested_at AS s_bill_requested_at, st.opened_at AS s_opened_at,
       (SELECT json_group_array(o.placed_by) FROM orders o
         WHERE o.cancelled_at IS NULL AND (
           o.order_id IN (SELECT order_id FROM bill_orders WHERE bill_id = b.bill_id)
           OR (b.state <> 'closed' AND b.absorbed_into IS NULL AND b.reopen_mode IS NOT 'corrections' AND o.billed_at IS NULL
               AND ((b.seating_id IS NOT NULL AND o.order_id IN (SELECT order_id FROM seating_orders WHERE seating_id = b.seating_id))
                 OR (b.table_key IS NOT NULL AND o.bill_key = b.table_key))
               AND NOT EXISTS (SELECT 1 FROM bill_orders bo WHERE bo.order_id = o.order_id AND bo.bill_id IS NOT b.bill_id)))) AS placed_by_json
FROM bill_payments p
JOIN bills b ON b.bill_id = p.bill_id
LEFT JOIN bill_splits s ON s.bill_id = p.bill_id AND s.split_no = p.split_no
LEFT JOIN shifts sh ON sh.shift_id = p.shift_id
LEFT JOIN seatings st ON st.seating_id = b.seating_id
WHERE p.payment_id = ?`;

export const RemovePayment = defineCommand({
  commandType: 'RemovePayment',
  payloadSchema: RemovePaymentPayload,
  sessionKind: 'device',
  permission: 'take-payment',
  hashOmit: ['note'],
  handle(ctx, p) {
    const staff_id = ctx.actor.staffId;
    if (staff_id === null) throw new DomainError('PERMISSION_DENIED', { permission: 'take-payment', grant: 'not_granted' });
    const db = ctx.tx.db;
    const row = db.prepare(PAYMENT_OF).get(p.payment_id) as PaymentOfRow | undefined; // 1
    if (row === undefined || row.removed_at !== null) throw new DomainError('PAYMENT_NOT_FOUND', { payment_id: p.payment_id });
    if (row.taken_by_staff_id !== staff_id && ctx.directory.resolve(staff_id, 'close-shift-for-others').grant !== 'allowed') {
      throw new DomainError('PERMISSION_DENIED', { reason: 'not_own_payment' });
    }
    const absorbed = row.absorbed_into !== null;
    if (absorbed || row.bill_state === 'closed' || row.split_state !== 'open') {
      throw notOpen({ bill_id: row.bill_id, absorbed, state: row.bill_state }, true);
    }
    // H1-9, owner R4: a payment on a closed shift is never removed (money back is an `out` on today's shift)
    if (row.shift_state !== 'open') throw new DomainError('SHIFT_NOT_OPEN', { reason: 'payment_shift_closed' });

    // C8: the scope last
    const config = branchConfig();
    if (config === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
    const seating =
      row.s_id === null
        ? null
        : { seating_id: row.s_id, state: row.s_state as string, holder_staff_id: row.s_holder as string, primary_table_id: row.s_primary_table_id as string, bill_requested_at: row.s_bill_requested_at, opened_at: row.s_opened_at as number };
    billAccess(ctx.directory, config, staff_id, { seating, scope: row.scope, placed_by: JSON.parse(row.placed_by_json) as string[] }, ['take-payment']);

    // H3-5: the note in bill_texts under the payment_id; the event carries has_note only
    if (p.note !== undefined) db.prepare(`INSERT INTO bill_texts (subject_id, field, text) VALUES (?, 'note', ?)`).run(row.payment_id, p.note); // 2
    const payload = PaymentRemovedPayload.parse({
      payment_id: row.payment_id,
      bill_id: row.bill_id,
      split_no: row.split_no,
      reason_code: p.reason_code,
      has_note: p.note !== undefined,
      shift_id: row.shift_id,
      mode_id: row.mode_id,
      payment_class: row.payment_class,
      direction: row.direction,
      amount_minor: row.amount_minor,
      change_minor: row.tendered_minor === null ? 0 : row.tendered_minor - row.amount_minor,
      taken_by_staff_id: row.taken_by_staff_id,
    });
    const event = draftOf(PaymentRemoved, { stream_type: 'bill', stream_id: row.bill_id, payload, occurred_at: ctx.clock.branchNow(), actor_id: staff_id, device_id: ctx.actor.deviceId });
    return { events: [event], result: { payment_id: row.payment_id, bill_id: row.bill_id, split_no: row.split_no } };
  },
});

export function registerPayments(app: FastifyInstance): void {
  commandRegistry(app).register(AddPayment);
  commandRegistry(app).register(RemovePayment);
}
