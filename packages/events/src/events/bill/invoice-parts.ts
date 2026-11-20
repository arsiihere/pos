import {
  CREDIT_SUPPORT,
  FISCAL_ORDERING,
  type FiscalSnapshot,
  isFiscalized,
  MIXED_CLASS_RULES,
  PAYMENT_CLASSES,
  ROUNDING_APPLIES_TO,
  ROUNDING_METHODS,
} from '@pos/domain';
import { z } from 'zod';
import { BusinessDate, Minor, NonNegativeMinor, OrderType, PositiveMinor, RateBp, SplitNo } from './parts.js';

// 05 §6.12 step 6 / §6.13: the invoice fields `InvoiceIssued` and `InvoiceCredited` share. The `satisfies` checks
// against 5a's types sit on the event schemas (`@pos/domain/src/billing/fiscal-snapshot.ts`, plan PL-16).
// No buyer tax ID or name, ever (B19): `has_buyer_id` / `buyer_id_refused` only.

const LineTax = z
  .object({
    tax_code: z.string().min(1),
    payment_class: z.enum(PAYMENT_CLASSES),
    rate_bp: RateBp,
    base_minor: Minor,
    tax_minor: NonNegativeMinor,
  })
  .strict();

const InvoiceLine = z
  .object({
    order_item_id: z.string(),
    item_id: z.string().nullable(),
    /** The menu item's name as billed (§3.15 `lines[].name`); not free text. */
    name: z.string(),
    units: z.number().int().positive(),
    unit_price_minor: NonNegativeMinor,
    base_minor: Minor,
    discount_minor: NonNegativeMinor,
    tax_profile_id: z.string().nullable(),
    fiscal_category: z.string().nullable(),
    taxes: z.array(LineTax),
  })
  .strict();

/** G-27 / R-21: null when the split has no service charge (removed, absent, or 0). */
const ServiceCharge = z
  .object({ amount_minor: PositiveMinor, tax_profile_id: z.string().nullable(), taxes: z.array(LineTax) })
  .strict()
  .nullable();

const InvoiceTax = z
  .object({
    tax_profile_id: z.string(),
    tax_code: z.string().min(1),
    label: z.string(),
    seq: z.number().int().min(1).max(4),
    compound: z.boolean(),
    payment_class: z.enum(PAYMENT_CLASSES),
    rate_bp: RateBp,
    base_minor: Minor,
    tax_minor: NonNegativeMinor,
    rate_ref: z.string().nullable(),
  })
  .strict();

/** G-3: only the non-null `receipt` shape (a null `receipt_fiscal` is mapped before, by P0.9b's snapshot builder). */
const FiscalReceipt = z
  .object({
    fiscal_number_label: z.string().nullable(),
    tax_reg_labels: z.array(z.object({ code: z.string(), label: z.string() }).strict()),
    show_qr: z.boolean(),
    qr_url_template: z.string().nullable(),
    buyer_id_on_receipt: z.boolean(),
  })
  .strict();

/**
 * `fiscal` (§6.12 step 6, H9-6, H16-2): the jurisdiction snapshot at issue; a credit copies its original's.
 * R-8 / G-1: `required: true` with adapter `none` is refused — `required` holds only when the invoice is fiscalized.
 */
export const FiscalSnapshotSchema = z
  .object({
    adapter_key: z.string().min(1),
    pos_id: z.string().nullable(),
    required: z.boolean(),
    capabilities: z.object({ ordering: z.enum(FISCAL_ORDERING), credit: z.boolean() }).strict(),
    credit_support: z.enum(CREDIT_SUPPORT),
    rounding: z
      .object({
        step_minor: z.number().int().positive().nullable(),
        mode: z.enum(ROUNDING_METHODS),
        applies_to: z.enum(ROUNDING_APPLIES_TO),
      })
      .strict(),
    receipt: FiscalReceipt,
    seller_registrations: z.array(z.object({ code: z.string(), number: z.string() }).strict()),
    payment_codes: z.array(z.object({ payment_id: z.string(), authority_code: z.string().nullable() }).strict()),
  })
  .strict()
  .refine((f) => !f.required || isFiscalized(f), {
    message: 'fiscal.required needs an adapter other than none (05 §3.1, R-8)',
    path: ['required'],
  }) satisfies z.ZodType<FiscalSnapshot>;

/** B19, A7: a waived buyer ID (`buyer_id_refused`) leaves the buyer fields empty, so the two flags are never both true. */
export const buyerFlagsConsistent = (p: { has_buyer_id: boolean; buyer_id_refused: boolean }): boolean =>
  !(p.has_buyer_id && p.buyer_id_refused);
export const buyerFlagsMessage = (): { message: string; path: string[] } => ({
  message: 'has_buyer_id and buyer_id_refused are never both true (B19, A7)',
  path: ['buyer_id_refused'],
});

/** The fields both series carry (§6.12 step 6; §6.13 "…the original's amounts … copied"). */
export const invoiceShape = {
  invoice_id: z.string(),
  number: z.number().int().positive(),
  invoice_ref: z.string().min(1),
  bill_id: z.string(),
  split_no: SplitNo,
  business_date: BusinessDate,
  issued_at: z.number().int(),
  order_type: OrderType,
  jurisdiction_id: z.string().min(1),
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  prices_include_tax: z.boolean(),
  lines: z.array(InvoiceLine),
  service_charge: ServiceCharge,
  subtotal_minor: NonNegativeMinor,
  discount_minor: NonNegativeMinor,
  service_charge_minor: NonNegativeMinor,
  taxes: z.array(InvoiceTax),
  rounding_minor: Minor,
  total_minor: NonNegativeMinor,
  /** §5 `invoices.payment_class`: the split's class, or 'mixed' (G-27). */
  payment_class: z.enum([...PAYMENT_CLASSES, 'mixed']),
  mixed_rule: z.enum(MIXED_CLASS_RULES),
  payment_ids: z.array(z.string()),
  change_minor: NonNegativeMinor,
  fiscal: FiscalSnapshotSchema,
  has_buyer_id: z.boolean(),
  buyer_id_refused: z.boolean(),
  closed_by: z.string(),
};
