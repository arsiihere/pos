// 05 §6.12 step 6, §6.13, §6.29, H9-6, H16-2: the jurisdiction snapshot an invoice records at issue
// (`InvoiceIssued.fiscal`, copied unchanged onto its credits) and the invoice fields the neutral fiscal
// submission (§3.15) reads. Plain TS types only; task 5's Zod event schemas `satisfies` them (plan PL-16).
// No buyer tax ID, name, token, note or other free text exists here, ever (§6.29, B19, B22).
// For task 5's `satisfies`: every `T | null` key is `.nullable()` in Zod (not `.optional()`), and arrays
// are plain (not `.readonly()`); extra event keys (number, bill_id, has_buyer_id, …) are fine.
import type {
  CREDIT_SUPPORT,
  FISCAL_ORDERING,
  INVOICE_SERIES,
  PAYMENT_CLASSES,
  ROUNDING_APPLIES_TO,
  ROUNDING_METHODS,
} from './types.js';

type PaymentClass = (typeof PAYMENT_CLASSES)[number];
type InvoiceSeries = (typeof INVOICE_SERIES)[number];

/** The adapter capabilities recorded at issue (§3.15 `FiscalAdapter.capabilities`). */
export type FiscalCapabilities = { ordering: (typeof FISCAL_ORDERING)[number]; credit: boolean };

/** A-1 `receipt_fiscal` as recorded on the invoice (H9-5: a list of registration labels). */
export type FiscalReceiptSnapshot = {
  fiscal_number_label: string | null;
  tax_reg_labels: { code: string; label: string }[];
  show_qr: boolean;
  qr_url_template: string | null;
  buyer_id_on_receipt: boolean;
};

/** `InvoiceIssued.fiscal` (§6.12 step 6): the snapshot in force at issue; credits and reprints read it. */
export type FiscalSnapshot = {
  adapter_key: string;
  pos_id: string | null;
  /**
   * H8-3 `fiscal.required`: the bill's order type has `fiscalize: true` and the invoice was issued at or after
   * the jurisdiction's `switched_at` (the close decides it). On its own it does **not** mean fiscalized: an
   * invoice is fiscalized iff `required && adapter_key !== 'none'` (05 §3.1, R-8) — always ask
   * {@link isFiscalized}, never this field alone. Fiscalized: outbox row `pending`, receipt fiscal block.
   */
  required: boolean;
  capabilities: FiscalCapabilities;
  credit_support: (typeof CREDIT_SUPPORT)[number];
  /** H16-2: the bill's frozen rounding rule. */
  rounding: {
    step_minor: number | null;
    mode: (typeof ROUNDING_METHODS)[number];
    applies_to: (typeof ROUNDING_APPLIES_TO)[number];
  };
  receipt: FiscalReceiptSnapshot;
  seller_registrations: { code: string; number: string }[];
  payment_codes: { payment_id: string; authority_code: string | null }[];
};

/** §3.15: the adapter key that is never called; its invoices are never fiscalized. */
const NONE_ADAPTER = 'none';

/**
 * 05 §3.1 "Fiscalized" (v1.0.2, R-8 / G-1), defined once: `required && adapter_key !== 'none'`. Every
 * "fiscalized" test (outbox row, receipt fiscal block, and the later close, worker and schema checks) uses this.
 */
export function isFiscalized(snapshot: FiscalSnapshot): boolean {
  return snapshot.required && snapshot.adapter_key !== NONE_ADAPTER;
}

/** One per-(profile, tax) row spread onto a line or the service charge (§6.12 step 6, J-2). */
export type FiscalLineTax = {
  tax_code: string;
  payment_class: PaymentClass;
  rate_bp: number;
  base_minor: number;
  tax_minor: number;
};

export type FiscalInvoiceLine = {
  order_item_id: string;
  item_id: string | null;
  /** The menu item's name as billed (§3.15 submission `lines[].name`); not a note. */
  name: string;
  units: number;
  unit_price_minor: number;
  base_minor: number;
  discount_minor: number;
  tax_profile_id: string | null;
  fiscal_category: string | null;
  taxes: FiscalLineTax[];
  /** 05 v1.0.33 §6.29 (STAB-5): the first part of a split line (02b v1.0.20); absent = not split */
  part_of?: string;
};

/**
 * 05 v1.0.33 §3.15 (STAB-5): an invoice's lines for the authority with a split line's parts (same `part_of`, `item_id`,
 * `name`, `tax_profile_id`, `fiscal_category`, `unit_price_minor`, `base_minor`) as one entry at the first part's place:
 * units, `base_minor`, `discount_minor` summed, taxes summed per (`tax_code`, `payment_class`, `rate_bp`). Sums of the
 * stored integers only, so Σ per tax over the lines is unchanged; a line without `part_of` stays its own entry.
 */
export function groupInvoiceLines<L extends Omit<FiscalInvoiceLine, 'part_of'> & { part_of?: string | undefined }>(lines: readonly L[]): L[] {
  const groups: L[][] = [];
  const byKey = new Map<string, L[]>();
  for (const l of lines) {
    const key = l.part_of === undefined ? null : JSON.stringify([l.part_of, l.item_id, l.name, l.tax_profile_id, l.fiscal_category, l.unit_price_minor, l.base_minor]);
    const had = key === null ? undefined : byKey.get(key);
    if (had !== undefined) {
      had.push(l);
      continue;
    }
    const g = [l];
    groups.push(g);
    if (key !== null) byKey.set(key, g);
  }
  return groups.map((g) => {
    const first = g[0]!;
    if (g.length === 1) return first;
    const taxes: FiscalLineTax[] = [];
    for (const t of g.flatMap((l) => l.taxes)) {
      const had = taxes.find((x) => x.tax_code === t.tax_code && x.payment_class === t.payment_class && x.rate_bp === t.rate_bp);
      if (had === undefined) taxes.push({ ...t });
      else {
        had.base_minor += t.base_minor;
        had.tax_minor += t.tax_minor;
      }
    }
    return {
      ...first,
      units: g.reduce((n, l) => n + l.units, 0),
      base_minor: g.reduce((n, l) => n + l.base_minor, 0),
      discount_minor: g.reduce((n, l) => n + l.discount_minor, 0),
      taxes,
    };
  });
}

/** §6.12 step 6 `service_charge` (H10-8). */
export type FiscalServiceCharge = {
  amount_minor: number;
  tax_profile_id: string | null;
  taxes: FiscalLineTax[];
};

/** §6.12 step 6 invoice tax row (`invoice_taxes`). */
export type FiscalInvoiceTax = {
  tax_profile_id: string;
  tax_code: string;
  label: string;
  seq: number;
  compound: boolean;
  payment_class: PaymentClass;
  rate_bp: number;
  base_minor: number;
  tax_minor: number;
  rate_ref: string | null;
};

type FiscalInvoiceCommon = {
  invoice_id: string;
  invoice_ref: string;
  issued_at: number;
  order_type: string;
  jurisdiction_id: string;
  currency_code: string;
  prices_include_tax: boolean;
  lines: FiscalInvoiceLine[];
  /** Nullable as in §3.15's submission (no charge on the bill); §6.12 step 6 does not say. */
  service_charge: FiscalServiceCharge | null;
  subtotal_minor: number;
  discount_minor: number;
  taxes: FiscalInvoiceTax[];
  rounding_minor: number;
  total_minor: number;
  payment_ids: string[];
  buyer_id_refused: boolean;
  fiscal: FiscalSnapshot;
};

/** The `InvoiceIssued` fields the neutral submission reads (§3.15, §6.12 step 6). */
export type FiscalSaleInvoiceFields = FiscalInvoiceCommon & { series: Extract<InvoiceSeries, 'sale'> };

/**
 * The `InvoiceCredited` fields the neutral submission reads (§6.13: the original's data copied, H6-8, H9-6).
 * Reading (5a, for P0.G / task 5): §6.13 lists "…the original's amounts"; read as also copying the
 * original's `order_type`, `service_charge`, `payment_ids` and `buyer_id_refused` (§3.10: a credit is the
 * full original), and `issued_at` = the credit's own issue time (§3.15's submission needs it; §6.13 does
 * not list it).
 */
export type FiscalCreditInvoiceFields = FiscalInvoiceCommon & {
  series: Extract<InvoiceSeries, 'credit'>;
  ref_invoice_id: string;
  ref_invoice_ref: string;
};

export type FiscalInvoiceFields = FiscalSaleInvoiceFields | FiscalCreditInvoiceFields;
