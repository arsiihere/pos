import {
  BILL_REOPEN_REASONS,
  CHARGE_REMOVE_REASONS,
  COMP_REMOVE_REASONS,
  DISCOUNT_KINDS,
  PETTY_KINDS,
} from '@pos/domain';
import { AlertDetailsBase } from '@pos/events';
import { z } from 'zod';

// 05 §3.14 (task 9): the kinds' names, `values` and `details`. Values carry ids, codes, amounts and `note_id` /
// `has_note` only — never text (H3-5, H4-4: the texts are in `bill_texts`, written at raise; `apply` reads none).
// Details use AlertDetailsBase's existing keys only (H2-6). Fields the spec does not list in a kind's values are
// marked "inferred" (task 9 Readings); the raising command tasks follow them.

/** §3.14: the seven request kinds. */
export const BILL_REQUEST_KINDS = [
  'discount',
  'remove_service_charge',
  'reopen_bill',
  'remove_comp',
  'close_without_buyer_id',
  'petty_cash',
  'shift_variance',
] as const;
export type BillRequestKind = (typeof BILL_REQUEST_KINDS)[number];

/** §4.2 export `BILL_KINDS`: the seven kind names of §3.14 + `fiscal_outbox_stuck` (§3.15). */
export const BILL_KINDS = [...BILL_REQUEST_KINDS, 'fiscal_outbox_stuck'] as const;
export type BillKind = (typeof BILL_KINDS)[number];

const Id = z.string().min(1);
const NoteId = Id.nullable();

/** §6.6 / H4-4: the request's payload fields (bill_ref resolved to bill_id); `amount_minor` is computed by `apply`. */
export const DiscountValues = z.object({
  bill_id: Id,
  kind: z.enum(DISCOUNT_KINDS),
  value: z.number().int().positive(),
  reason_code: z.string().min(1),
  note_id: NoteId,
  has_note: z.boolean(),
});
export type DiscountValues = z.infer<typeof DiscountValues>;

/** §6.8 / H4-4. */
export const RemoveServiceChargeValues = z.object({
  bill_id: Id,
  reason_code: z.enum(CHARGE_REMOVE_REASONS),
  note_id: NoteId,
  has_note: z.boolean(),
});
export type RemoveServiceChargeValues = z.infer<typeof RemoveServiceChargeValues>;

/**
 * §6.13 `{ bill_id, invoice_ids, credit_invoice_ids, reason_code, note_id, has_note }` (H2-17, H4-4; ⚠️ 05 v1.0.9 R-47:
 * `reason_code`, copied to `BillReopened`; ⚠️ 05 v1.0.15 R-66 / G-62: `credit_invoice_ids`, ULIDs minted at raise, one
 * per `invoice_ids` entry in the same order — `apply` mints nothing, 01d AD-91).
 */
export const ReopenBillValues = z
  .object({
    bill_id: Id,
    invoice_ids: z.array(Id).min(1),
    credit_invoice_ids: z.array(Id).min(1),
    reason_code: z.enum(BILL_REOPEN_REASONS),
    note_id: NoteId,
    has_note: z.boolean(),
  })
  .refine((v) => v.credit_invoice_ids.length === v.invoice_ids.length && new Set(v.credit_invoice_ids).size === v.credit_invoice_ids.length, {
    message: 'one distinct credit_invoice_id per invoice_ids entry (R-66)',
    path: ['credit_invoice_ids'],
  });
export type ReopenBillValues = z.infer<typeof ReopenBillValues>;

/** §6.14 / H4-4: `units` resolved at raise (inferred: required); `order_id` (inferred: the request's subject). */
export const RemoveCompValues = z.object({
  order_id: Id,
  order_item_id: Id,
  units: z.number().int().min(1),
  reason_code: z.enum(COMP_REMOVE_REASONS),
  note_id: NoteId,
  has_note: z.boolean(),
});
export type RemoveCompValues = z.infer<typeof RemoveCompValues>;

/** §6.11 / H4-4. */
export const CloseWithoutBuyerIdValues = z.object({
  bill_id: Id,
  note_id: NoteId,
  has_note: z.boolean(),
});
export type CloseWithoutBuyerIdValues = z.infer<typeof CloseWithoutBuyerIdValues>;

/**
 * §6.20 / H3-5: the entry without text (`entry_id`, amount, ids, `has_note` / `has_paid_to`); `kind` (inferred: picks
 * the event). ⚠️ 05 v1.0.9 (R-48): no `note_id` — petty texts are keyed by `entry_id`, and the petty events carry none.
 * `advance_staff_id` is set on an advance only, as the petty events refine it.
 */
export const PettyCashValues = z.object({
  entry_id: Id,
  kind: z.enum(PETTY_KINDS),
  shift_id: Id,
  amount_minor: z.number().int().positive(),
  category_id: Id,
  has_paid_to: z.boolean(),
  advance_staff_id: Id.nullable(),
  has_note: z.boolean(),
}).refine((v) => (v.kind === 'advance') === (v.advance_staff_id !== null), { message: 'advance_staff_id is set on an advance only', path: ['advance_staff_id'] });
export type PettyCashValues = z.infer<typeof PettyCashValues>;

/** §3.14 / H8-9: the counted shift; `note_id` / `has_note` = CountShift's. */
export const ShiftVarianceValues = z.object({
  shift_id: Id,
  note_id: NoteId,
  has_note: z.boolean(),
});
export type ShiftVarianceValues = z.infer<typeof ShiftVarianceValues>;

/** §3.15: no values (dedupe `fiscal_stuck:<branch_id>`; counts in details). */
export const FiscalOutboxStuckValues = z.object({});
export type FiscalOutboxStuckValues = z.infer<typeof FiscalOutboxStuckValues>;

/** §3.14 / H2-6: `amount` (minor), `reason` (the reason code), `identifier`. */
export const BillRequestDetails = AlertDetailsBase.pick({ amount: true, reason: true, identifier: true });
export type BillRequestDetails = z.infer<typeof BillRequestDetails>;

/** §3.14: `shift_variance` → `{ amount: variance_minor }`. */
export const ShiftVarianceDetails = AlertDetailsBase.pick({ amount: true });
export type ShiftVarianceDetails = z.infer<typeof ShiftVarianceDetails>;

/** §3.15 / H2-6: `{ quantity: stuck count, minutes_late: oldest age in minutes }`. */
export const FiscalOutboxStuckDetails = AlertDetailsBase.pick({ quantity: true, minutes_late: true });
export type FiscalOutboxStuckDetails = z.infer<typeof FiscalOutboxStuckDetails>;

/** Values and details per request kind (the seam's types). */
export interface BillRequestKindTypes {
  discount: { values: DiscountValues; details: BillRequestDetails };
  remove_service_charge: { values: RemoveServiceChargeValues; details: BillRequestDetails };
  reopen_bill: { values: ReopenBillValues; details: BillRequestDetails };
  remove_comp: { values: RemoveCompValues; details: BillRequestDetails };
  close_without_buyer_id: { values: CloseWithoutBuyerIdValues; details: BillRequestDetails };
  petty_cash: { values: PettyCashValues; details: BillRequestDetails };
  shift_variance: { values: ShiftVarianceValues; details: ShiftVarianceDetails };
}
