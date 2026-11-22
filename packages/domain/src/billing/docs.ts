import type { Doc, DocBlock } from '../print.js';
import type {
  FiscalCreditInvoiceFields,
  FiscalInvoiceFields,
  FiscalInvoiceTax,
  FiscalSaleInvoiceFields,
} from './fiscal-snapshot.js';
import { isFiscalized } from './fiscal-snapshot.js';
import { groupByPartOf } from '../kds.js';
import type { PAYMENT_CLASSES } from './types.js';

// 05 §3.16, B17, B21, B29, §6.26; §11 task 4a: pure Doc builders over 03c's Doc / DocBlock (print.ts, unchanged).
// They lay out the numbers they are given: no tax, rounding, due or total is computed here (§3.5 is compute.ts's).
// The only arithmetic is summing the tax rows that share one (label, rate, class) into the one printed row (#34).
// Money is formatted with the currency exponent (row F-6), never an assumed 100. Browser-safe, 0 statements.
// Task 4b (rows P-3 / P-5; R-11 / G-2, G-24, G-25): the receipt / reprint / credit note take the invoice's fiscal state
// (PENDING / the number + QR / NOT ISSUED, B21); the receipt carries the buyer block as the fill block
// `{ fill: 'buyer_id', ref: invoice_id, last4 }`, filled at send by 03c's worker through 05's filler (B19: the full ID
// never enters a Doc, so never `print_jobs.payload`); a credit note prints only the last 4 (Q-3); inclusive prices
// print the tax inside the menu prices as a memo block, so the printed lines add up.

type PaymentClass = (typeof PAYMENT_CLASSES)[number];

// ---------------------------------------------------------------------------------------------------- formatting

/** Minor units → "5,996.00" with `exponent` decimals (F-6). */
export function formatMinor(amount_minor: number, exponent: number): string {
  if (!Number.isSafeInteger(amount_minor)) throw new RangeError(`not an integer amount: ${amount_minor}`);
  if (!Number.isInteger(exponent) || exponent < 0) throw new RangeError(`invalid currency exponent ${exponent}`);
  const sign = amount_minor < 0 ? '-' : '';
  const digits = String(Math.abs(amount_minor)).padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const frac = digits.slice(digits.length - exponent);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + grouped + (exponent > 0 ? `.${frac}` : '');
}

/** Basis points → "16%", "16.5%". */
export function formatRateBp(rate_bp: number): string {
  const whole = Math.trunc(rate_bp / 100);
  const frac = String(Math.abs(rate_bp % 100)).padStart(2, '0').replace(/0+$/, '');
  return frac === '' ? `${whole}%` : `${whole}.${frac}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "19 Nov 2026 1:22 PM", branch-local. */
function dateTime(at: number, utc_offset_ms: number): string {
  const d = new Date(at + utc_offset_ms);
  const h = d.getUTCHours();
  const clock = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${clock}`;
}

const CLASS_LABEL: Record<PaymentClass, string> = { cash: 'cash', digital: 'card' };

// ------------------------------------------------------------------------------------------------------ context

/** B29: the owner's receipt template (billing settings `receipt`, row A-1 (3)). */
export interface DocTemplate {
  header_lines: readonly string[];
  footer_lines: readonly string[];
  show: { tax_reg_no: boolean; address: boolean; phone: boolean; cashier: boolean; order_no: boolean; bill_no: boolean };
  address: string | null;
  phone: string | null;
}

export interface DocContext {
  width_cols: 32 | 48;
  /** `currencyExponent(currency_code)` (row F-6); the snapshot's `billing.jurisdiction.currency_exponent`. */
  currency_exponent: number;
  /** hub time's offset: dates print branch-local. */
  utc_offset_ms: number;
  branch_name: string;
  template: DocTemplate;
}

/** A tax row as printed: one per (label, rate, payment class). */
export interface DocTaxRow {
  label: string;
  rate_bp: number;
  payment_class: PaymentClass;
  tax_minor: number;
}

export interface DocLine {
  name: string;
  units: number;
  unit_price_minor: number;
  amount_minor: number;
  /** 05 v1.0.33 §3.16 (STAB-5): the first part of a split line (02b v1.0.20); absent / null = not split */
  part_of?: string | null;
}

/**
 * 05 v1.0.33 §3.16 (STAB-5): printed lines with the same `part_of`, name, unit price and amount per part are one row at
 * the first part's place — the amount the parts' sum, the units their count ("Karahi  5,750" / "  5 x 1,150"). Sums of
 * the stored integers only; a line without `part_of` stays a row of its own.
 */
export function groupDocLines(lines: readonly DocLine[]): DocLine[] {
  const keyOf = (l: DocLine): string | null =>
    l.part_of === undefined || l.part_of === null ? null : JSON.stringify([l.part_of, l.name, l.unit_price_minor, l.units, l.amount_minor]);
  return groupByPartOf(lines, keyOf).map((g) => {
    const first = g[0]!;
    if (g.length === 1) return first;
    return { ...first, units: g.reduce((n, l) => n + l.units, 0), amount_minor: g.reduce((n, l) => n + l.amount_minor, 0) };
  });
}

export interface DocPayment {
  mode_name: string;
  payment_class: PaymentClass;
  direction: 'in' | 'out';
  amount_minor: number;
}

/**
 * R-11 / G-2 (§3.16, B21, §6.22): the invoice's fiscal state as the hub holds it — the outbox row's state, and once
 * `FiscalNumberAssigned` exists the number and the answer's QR payload. `not_required` exactly when the invoice is
 * not fiscalized ({@link isFiscalized}); a state that disagrees with the snapshot is a caller bug (RangeError).
 */
export type DocFiscalState =
  | { state: 'not_required' }
  | { state: 'pending' }
  | { state: 'rejected' }
  | { state: 'acked'; fiscal_number: string; qr_payload: string | null };

/** B19, Q-3: what a Doc may know of a buyer tax ID — its type label and last 4; never the value, never the name. */
export interface DocBuyerMask {
  type_label: string;
  last4: string;
}

/**
 * Row P-5, §6.12 step 7: the fill block kind 05 registers with 03c's `registerDocumentFiller`. Its filler returns the
 * buyer block text (the buyer name and the full tax ID with its type label) from `invoice_buyers` by `ref` (the
 * invoice id); with no row, the worker prints the block's `last4` (the masked line).
 */
export const BUYER_ID_FILL = 'buyer_id';

/** 03c §3.6 (row P-3, R-26): a QR payload is 1–400 characters, counted as Unicode code points. */
const QR_MAX_CODE_POINTS = 400;

// ------------------------------------------------------------------------------------------------------ helpers

/** `left` and `right` on one line of `cols`, else `left` then `right` right-aligned (03c's ticket layout). */
function spread(left: string, right: string, cols: number, bold = false): DocBlock[] {
  const b = bold ? { bold: true } : {};
  if (left.length + 1 + right.length <= cols) return [{ text: left + ' '.repeat(cols - left.length - right.length) + right, ...b }];
  return [{ text: left, ...b }, { text: right, ...b, align: 'right' }];
}

const center = (text: string, bold = false): DocBlock => ({ text, align: 'center', ...(bold ? { bold: true } : {}) });

interface Vars {
  branch_name: string;
  tax_reg_no: string;
  address: string;
  phone: string;
  bill_no: string;
  date: string;
  cashier: string;
}

/** B29 variables in an owner line; `{tax_reg_no}` is every registration, one line each (a text block with \n). */
function substitute(line: string, vars: Vars): string {
  const fill = (text: string, v: Vars) =>
    // one pass with a function replacer: a value is never re-read as a pattern or a variable
    text.replace(/\{(branch_name|tax_reg_no|address|phone|bill_no|date|cashier)\}/g, (_m, key: keyof Vars) => v[key]).trimEnd();
  if (line.includes('{tax_reg_no}') && vars.tax_reg_no.includes('\n')) {
    return vars.tax_reg_no
      .split('\n')
      .map((reg) => fill(line, { ...vars, tax_reg_no: reg }))
      .join('\n');
  }
  return fill(line, vars);
}

function ownerLines(lines: readonly string[], vars: Vars): DocBlock[] {
  return lines.map((line) => center(substitute(line, vars)));
}

function registrationLines(invoice: FiscalInvoiceFields): string[] {
  const labels = new Map(invoice.fiscal.receipt.tax_reg_labels.map((l) => [l.code, l.label]));
  return invoice.fiscal.seller_registrations.map((r) => `${labels.get(r.code) ?? r.code}: ${r.number}`);
}

/** #34: one row per (label, rate, payment class), in first-seen order. */
function taxRows(taxes: ReadonlyArray<Pick<FiscalInvoiceTax, 'label' | 'rate_bp' | 'payment_class' | 'tax_minor'>>): DocTaxRow[] {
  const rows = new Map<string, DocTaxRow>();
  for (const t of taxes) {
    const key = JSON.stringify([t.label, t.rate_bp, t.payment_class]);
    const row = rows.get(key);
    if (row === undefined) rows.set(key, { label: t.label, rate_bp: t.rate_bp, payment_class: t.payment_class, tax_minor: t.tax_minor });
    else row.tax_minor += t.tax_minor;
  }
  return [...rows.values()];
}

interface Money {
  cols: number;
  m: (minor: number) => string;
}

function lineBlocks(lines: readonly DocLine[], { cols, m }: Money): DocBlock[] {
  return groupDocLines(lines).flatMap((l) => [
    ...spread(l.name, m(l.amount_minor), cols),
    ...(l.units !== 1 ? [{ text: `  ${l.units} x ${m(l.unit_price_minor)}` }] : []),
  ]);
}

interface Totals {
  subtotal_minor: number;
  discount_minor: number;
  service_charge_minor: number;
  taxes: readonly DocTaxRow[];
  rounding_minor: number;
  /** G-24: inclusive prices — the charge's own taxes (§3.5 (6)(a), its `service_charge.taxes`); else null. */
  inclusive: null | { service_charge_taxes: readonly DocTaxRow[] };
}

const rowKey = (x: Pick<DocTaxRow, 'label' | 'rate_bp' | 'payment_class'>) => JSON.stringify([x.label, x.rate_bp, x.payment_class]);
const rowLabel = (x: DocTaxRow) => `${x.label} ${formatRateBp(x.rate_bp)} ${CLASS_LABEL[x.payment_class]}`;

/**
 * G-24, §3.5 (6): with inclusive prices a tax row is the lines' included part plus the charge's added part. The
 * printed rows minus the charge's part = the tax inside the menu prices (the memo); zero rows are left out.
 */
function includedRows(t: Totals): DocTaxRow[] {
  if (t.inclusive === null) return [];
  const sc = new Map(taxRows(t.inclusive.service_charge_taxes).map((x) => [rowKey(x), x.tax_minor]));
  const memo = t.taxes.map((x) => ({ ...x, tax_minor: x.tax_minor - (sc.get(rowKey(x)) ?? 0) }));
  for (const key of sc.keys()) {
    if (!t.taxes.some((x) => rowKey(x) === key)) throw new RangeError('a service-charge tax has no invoice tax row');
  }
  if (memo.some((x) => x.tax_minor < 0)) throw new RangeError('a service-charge tax exceeds its invoice tax row');
  return memo.filter((x) => x.tax_minor !== 0);
}

/**
 * Subtotal, discount, service charge, tax rows, then the rounding line outside every tax row (§25). Inclusive
 * prices (G-24): only the charge's taxes are added here (the charge is never tax-inclusive, §3.5 (4)); the rest is
 * inside the menu prices and prints after the total as a memo ({@link memoBlocks}), so the lines add up.
 */
function totalBlocks(t: Totals, { cols, m }: Money): DocBlock[] {
  const added = t.inclusive === null ? t.taxes : taxRows(t.inclusive.service_charge_taxes);
  const suffix = t.inclusive === null ? '' : ' on service charge';
  return [
    ...spread('Subtotal', m(t.subtotal_minor), cols),
    ...(t.discount_minor !== 0 ? spread('Discount', m(-t.discount_minor), cols) : []),
    ...(t.service_charge_minor !== 0 ? spread('Service charge', m(t.service_charge_minor), cols) : []),
    ...added.flatMap((x) => spread(rowLabel(x) + suffix, m(x.tax_minor), cols)),
    ...(t.rounding_minor !== 0 ? spread('Rounding adjustment', m(t.rounding_minor), cols) : []),
  ];
}

/** G-24: the memo of the tax inside inclusive menu prices (not added again); nothing with exclusive prices. */
function memoBlocks(t: Totals, { cols, m }: Money): DocBlock[] {
  const rows = includedRows(t);
  if (rows.length === 0) return [];
  return [{ text: 'Tax included in prices' }, ...rows.flatMap((x) => spread(`  ${rowLabel(x)}`, m(x.tax_minor), cols))];
}

/**
 * B21, §6.22, row P-3: the QR payload of an answered invoice — none unless the snapshot's receipt fields ask for one
 * (`show_qr`); the answer's own payload, else the snapshot's template with `{fiscal_number}` replaced (Appendix P).
 * A payload outside 03c's 1–400 code points is left out, so the receipt still prints with its number line.
 */
function qrPayload(receipt: FiscalInvoiceFields['fiscal']['receipt'], fiscal_number: string, qr_payload: string | null): string | null {
  if (!receipt.show_qr) return null;
  const payload = qr_payload ?? (receipt.qr_url_template === null ? null : receipt.qr_url_template.split('{fiscal_number}').join(fiscal_number));
  if (payload === null) return null;
  const chars = [...payload].length;
  return chars >= 1 && chars <= QR_MAX_CODE_POINTS ? payload : null;
}

/**
 * B21, R-11 / G-2: the fiscal block of a fiscalized invoice — "FISCAL NUMBER PENDING" before the answer, the number
 * with the snapshot's label (+ the QR block, its module size left to the printer, R-26) once acked, "FISCAL NUMBER
 * NOT ISSUED" when rejected; nothing when the invoice is not fiscalized.
 */
function fiscalBlocks(invoice: FiscalInvoiceFields, fiscal: DocFiscalState, cols: number): DocBlock[] {
  const fiscalized = isFiscalized(invoice.fiscal);
  if (fiscalized === (fiscal.state === 'not_required')) {
    throw new RangeError(`fiscal state ${fiscal.state} does not match the invoice snapshot (fiscalized: ${String(fiscalized)})`);
  }
  switch (fiscal.state) {
    case 'not_required':
      return [];
    case 'pending':
      return [{ rule: true }, center('FISCAL NUMBER PENDING', true)];
    case 'rejected':
      return [{ rule: true }, center('FISCAL NUMBER NOT ISSUED', true)];
    case 'acked': {
      const { receipt } = invoice.fiscal;
      const qr = qrPayload(receipt, fiscal.fiscal_number, fiscal.qr_payload);
      return [
        { rule: true },
        ...spread(receipt.fiscal_number_label ?? 'Fiscal no.', fiscal.fiscal_number, cols, true),
        ...(qr === null ? [] : [{ qr }]),
      ];
    }
  }
}

const reprint = (is_reprint: boolean): DocBlock[] => (is_reprint ? [center('** REPRINT **', true)] : []);

const END: DocBlock[] = [{ feed: 3 }, { cut: true }];

// ---------------------------------------------------------------------------------------------------- check bill

/**
 * B17, §6.3: the live bill at the default payment class (cash) — the hub maps `computeBill`'s totals onto it
 * (task 12). `cash_total_minor` is the rounded cash total (`cash_due` of the unpaid split, H16-4);
 * `digital_total_minor` the total if paid by card / digital (printed when it differs).
 */
export interface CheckBillDocInput {
  /** 03b identifier text, e.g. "T7", "#12". */
  identifier: string;
  printed_at: number;
  lines: readonly DocLine[];
  subtotal_minor: number;
  discount_minor: number;
  service_charge_minor: number;
  /** The tax rows at the cash class. */
  taxes: readonly DocTaxRow[];
  rounding_minor: number;
  cash_total_minor: number;
  /** G-25: `computeBill`'s `totals_default_digital.total_minor` (P0.19d). */
  digital_total_minor: number | null;
  /** The bill's frozen price mode (G-24). */
  prices_include_tax: boolean;
  /** G-24, inclusive prices: the charge's own tax rows at the cash class (`spreadLineTaxes`, P0.19c); else unused. */
  service_charge_taxes: readonly DocTaxRow[];
}

export function buildCheckBillDoc(input: CheckBillDocInput, ctx: DocContext): Doc {
  const cols = ctx.width_cols;
  const money: Money = { cols, m: (v) => formatMinor(v, ctx.currency_exponent) };
  const date = dateTime(input.printed_at, ctx.utc_offset_ms);
  // never an invoice or fiscal number on a check bill (B17): {bill_no} and {tax_reg_no} stay empty
  const vars: Vars = {
    branch_name: ctx.branch_name,
    tax_reg_no: '',
    address: ctx.template.address ?? '',
    phone: ctx.template.phone ?? '',
    bill_no: '',
    date,
    cashier: '',
  };
  const totals: Totals = {
    ...input,
    taxes: taxRows(input.taxes),
    inclusive: input.prices_include_tax ? { service_charge_taxes: input.service_charge_taxes } : null,
  };
  const blocks: DocBlock[] = [
    ...ownerLines(ctx.template.header_lines, vars),
    center('PROVISIONAL - NOT A TAX INVOICE', true),
    ...spread(input.identifier, date, cols),
    { rule: true },
    ...lineBlocks(input.lines, money),
    { rule: true },
    ...totalBlocks(totals, money),
    ...spread('Total if paid in cash', money.m(input.cash_total_minor), cols, true),
    ...(input.digital_total_minor !== null && input.digital_total_minor !== input.cash_total_minor
      ? spread('Total if paid by card', money.m(input.digital_total_minor), cols)
      : []),
    ...memoBlocks(totals, money),
    { rule: true },
    ...ownerLines(ctx.template.footer_lines, vars),
    ...END,
  ];
  return { width_cols: cols, blocks };
}

// -------------------------------------------------------------------------------------------------------- receipt

export interface ReceiptDocInput {
  /** The `InvoiceIssued` fields (5a); labels, registrations and fiscal fields from its snapshot (H9-6). */
  invoice: FiscalSaleInvoiceFields;
  /** The split's live payments, in the order taken. */
  payments: readonly DocPayment[];
  change_minor: number;
  cashier_name: string | null;
  /** The order identifier (show toggle `order_no`). */
  order_label: string | null;
  /** The bill / split identifier (show toggle `bill_no`). */
  bill_label: string | null;
  /** R-11: the outbox state; the number and QR payload from `FiscalNumberAssigned` once acked. */
  fiscal: DocFiscalState;
  /**
   * B19, row P-5: the invoice's buyer (`invoice_buyers`) as a mask only; printed as the fill block when the snapshot's
   * `buyer_id_on_receipt` is true. Null without a buyer (or a waiver).
   */
  buyer: DocBuyerMask | null;
  is_reprint: boolean;
  /**
   * 05 v1.0.33 §3.16 (STAB-5): the customer ready-time lines ("Ready ~2:40 PM", "Karahi: 4 ready ~2:20 PM · 1 ready
   * ~2:40 PM"), printed after the payments; empty / absent = none (another order type, the setting off, nothing left).
   */
  ready_times?: readonly string[];
}

function headerBlocks(
  invoice: FiscalInvoiceFields,
  ctx: DocContext,
  extra: { cashier_name: string | null; order_label: string | null; bill_label: string | null },
): { blocks: DocBlock[]; vars: Vars } {
  const { show, address, phone } = ctx.template;
  const cols = ctx.width_cols;
  const regs = registrationLines(invoice);
  const date = dateTime(invoice.issued_at, ctx.utc_offset_ms);
  const vars: Vars = {
    branch_name: ctx.branch_name,
    tax_reg_no: regs.join('\n'),
    address: address ?? '',
    phone: phone ?? '',
    bill_no: invoice.invoice_ref,
    date,
    cashier: extra.cashier_name ?? '',
  };
  const blocks: DocBlock[] = [
    ...ownerLines(ctx.template.header_lines, vars),
    ...(show.address && address !== null ? [center(address)] : []),
    ...(show.phone && phone !== null ? [center(phone)] : []),
    ...(show.tax_reg_no ? regs.map((r) => center(r)) : []),
    { rule: true },
    { text: date },
    ...(show.order_no && extra.order_label !== null ? spread('Order', extra.order_label, cols) : []),
    ...(show.bill_no && extra.bill_label !== null ? spread('Bill', extra.bill_label, cols) : []),
    ...(show.cashier && extra.cashier_name !== null ? spread('Closed by', extra.cashier_name, cols) : []),
  ];
  return { blocks, vars };
}

/** G-24: the charge's tax rows (`service_charge.taxes`, from `spreadLineTaxes` at close), labelled from the invoice row. */
function serviceChargeTaxRows(invoice: FiscalInvoiceFields): DocTaxRow[] {
  const sc = invoice.service_charge;
  if (sc === null) return [];
  return sc.taxes.map((x) => {
    const row = invoice.taxes.find(
      (t) => t.tax_profile_id === sc.tax_profile_id && t.tax_code === x.tax_code && t.payment_class === x.payment_class && t.rate_bp === x.rate_bp,
    );
    if (row === undefined) throw new RangeError(`the service charge's ${x.tax_code} tax has no invoice tax row`);
    return { label: row.label, rate_bp: x.rate_bp, payment_class: x.payment_class, tax_minor: x.tax_minor };
  });
}

function invoiceTotals(invoice: FiscalInvoiceFields): Totals {
  return {
    subtotal_minor: invoice.subtotal_minor,
    discount_minor: invoice.discount_minor,
    service_charge_minor: invoice.service_charge?.amount_minor ?? 0,
    taxes: taxRows(invoice.taxes),
    rounding_minor: invoice.rounding_minor,
    inclusive: invoice.prices_include_tax ? { service_charge_taxes: serviceChargeTaxRows(invoice) } : null,
  };
}

/** B19, row P-5, §6.12 step 7: the buyer block as the fill block — the mask only (last 4), never the full ID. */
function buyerBlocks(invoice: FiscalSaleInvoiceFields, buyer: DocBuyerMask | null): DocBlock[] {
  if (buyer === null || !invoice.fiscal.receipt.buyer_id_on_receipt) return [];
  // The fill block's `last4` holds the whole masked line with its type label ("CNIC: ****1234"): the worker prints it
  // as is when no filler answers (03c §3.7), and only the last 4 of the value ever enter it.
  return [{ fill: BUYER_ID_FILL, ref: invoice.invoice_id, last4: `${buyer.type_label}: ****${buyer.last4.slice(-4)}` }];
}

const invoiceLines = (invoice: FiscalInvoiceFields): DocLine[] =>
  invoice.lines.map((l) => ({ name: l.name, units: l.units, unit_price_minor: l.unit_price_minor, amount_minor: l.base_minor, part_of: l.part_of ?? null }));

export function buildReceiptDoc(input: ReceiptDocInput, ctx: DocContext): Doc {
  const { invoice } = input;
  const cols = ctx.width_cols;
  const money: Money = { cols, m: (v) => formatMinor(v, ctx.currency_exponent) };
  const head = headerBlocks(invoice, ctx, input);
  const cashMoved = input.payments.some((p) => p.payment_class === 'cash');
  const totals = invoiceTotals(invoice);
  const blocks: DocBlock[] = [
    ...reprint(input.is_reprint),
    ...head.blocks,
    ...spread('Invoice', invoice.invoice_ref, cols, true),
    ...buyerBlocks(invoice, input.buyer),
    { rule: true },
    ...lineBlocks(invoiceLines(invoice), money),
    { rule: true },
    ...totalBlocks(totals, money),
    ...spread(`TOTAL ${invoice.currency_code}`, money.m(invoice.total_minor), cols, true),
    ...memoBlocks(totals, money),
    { rule: true },
    ...input.payments.flatMap((p) =>
      p.direction === 'in'
        ? spread(p.mode_name, money.m(p.amount_minor), cols)
        : spread(`${p.mode_name} refund`, money.m(-p.amount_minor), cols),
    ),
    ...(input.change_minor !== 0 ? spread('Change', money.m(input.change_minor), cols) : []),
    ...fiscalBlocks(invoice, input.fiscal, cols),
    ...((input.ready_times ?? []).length > 0 ? [{ rule: true } as const, ...(input.ready_times ?? []).map((text): DocBlock => ({ text, bold: true }))] : []),
    { rule: true },
    ...ownerLines(ctx.template.footer_lines, head.vars),
    ...END,
    // §3.16: the drawer opens when the split had a cash in or out payment
    ...(cashMoved ? [{ drawer: true } as const] : []),
  ];
  return { width_cols: cols, blocks };
}

// ---------------------------------------------------------------------------------------------------- credit note

export interface CreditNoteDocInput {
  /** The `InvoiceCredited` fields (5a): the original's amounts and snapshot, copied (H9-6). */
  invoice: FiscalCreditInvoiceFields;
  /** Q-3: the credit note prints the last 4 of a buyer ID only. */
  buyer_id: DocBuyerMask | null;
  /** R-11: as {@link ReceiptDocInput.fiscal} (the credit's own outbox row and number). */
  fiscal: DocFiscalState;
  is_reprint: boolean;
  cashier_name: string | null;
}

export function buildCreditNoteDoc(input: CreditNoteDocInput, ctx: DocContext): Doc {
  const { invoice } = input;
  const cols = ctx.width_cols;
  const money: Money = { cols, m: (v) => formatMinor(v, ctx.currency_exponent) };
  const head = headerBlocks(invoice, ctx, { cashier_name: input.cashier_name, order_label: null, bill_label: null });
  const totals = invoiceTotals(invoice);
  const blocks: DocBlock[] = [
    ...reprint(input.is_reprint),
    ...head.blocks,
    center('CREDIT NOTE', true),
    ...spread('Credit note', invoice.invoice_ref, cols, true),
    ...spread('Against invoice', invoice.ref_invoice_ref, cols),
    ...(input.buyer_id !== null ? [{ text: `${input.buyer_id.type_label}: ****${input.buyer_id.last4.slice(-4)}` }] : []),
    { rule: true },
    ...lineBlocks(invoiceLines(invoice), money),
    { rule: true },
    ...totalBlocks(totals, money),
    ...spread(`TOTAL CREDIT ${invoice.currency_code}`, money.m(invoice.total_minor), cols, true),
    ...memoBlocks(totals, money),
    ...fiscalBlocks(invoice, input.fiscal, cols),
    { rule: true },
    ...ownerLines(ctx.template.footer_lines, head.vars),
    ...END,
  ];
  return { width_cols: cols, blocks };
}

// -------------------------------------------------------------------------------------------------------- X / Z

/**
 * §6.26 report content as `buildReport` (task 26a) gives it: staff by id only (H16-5), every amount given. The
 * X hides a shift's expected cash until it is counted (B23); the builder enforces that too.
 */
export interface ReportDocInput {
  kind: 'x' | 'z';
  z_no: number | null;
  business_date: string;
  issued_at: number;
  currency_code: string;
  sales: {
    invoice_count: number;
    gross_minor: number;
    discounts: {
      count: number;
      value_minor: number;
      by_reason: ReadonlyArray<{ reason_code: string; count: number; value_minor: number }>;
      entries: ReadonlyArray<{ requester_staff_id: string; approver_staff_id: string | null; method: string; value_minor: number }>;
    };
    service_charge_minor: number;
    net_minor: number;
    taxes: ReadonlyArray<{ tax_code: string; label: string; tax_profile_id: string; payment_class: PaymentClass; rate_bp: number; tax_minor: number }>;
    rounding_minor: number;
    total_minor: number;
  };
  credits: { count: number; value_minor: number; by_reason: ReadonlyArray<{ reason_code: string; count: number; value_minor: number }> };
  /** net = sales − credits, as given. */
  net_after_credits_minor: number;
  payments_by_mode: ReadonlyArray<{ mode_name: string; in_minor: number; out_minor: number; change_minor: number }>;
  comps: { value_minor: number; voided_minor: number; removals: { count: number; value_minor: number } };
  voids: ReadonlyArray<{ disposition: string | null; count: number; value_minor: number }>;
  reopens: { count: number; value_minor: number; entries: ReadonlyArray<{ requester_staff_id: string; approver_staff_id: string | null }> };
  petty_cash: ReadonlyArray<{ category_name: string; kind: string; amount_minor: number }>;
  open_advances: ReadonlyArray<{ staff_id: string; amount_minor: number; age_minutes: number }>;
  shifts: ReadonlyArray<{
    staff_id: string;
    float_minor: number;
    expected_minor: number | null;
    counted_minor: number | null;
    variance_minor: number | null;
    skipped: boolean;
    signoff_state: string | null;
  }>;
  variance_signoffs: ReadonlyArray<{ shift_date: string; staff_id: string; amount_minor: number; outcome: string; approver_staff_id: string | null; at: number }>;
  pending_signoffs: ReadonlyArray<{ shift_date: string; staff_id: string; amount_minor: number }>;
  takings_by_taker: ReadonlyArray<{ staff_id: string; amount_minor: number }>;
  full_refunds: { count: number; value_minor: number };
  fiscal: { pending: number; acked: number; rejected: number; not_required: number };
  bills: { count: number; average_minor: number };
  /** X only. */
  open_bills: ReadonlyArray<{ identifier: string; open_minutes: number; flagged: boolean }>;
  carried_over: ReadonlyArray<{ label: string; carried_in: boolean }>;
  brought_forward: ReadonlyArray<{ mode_name: string; staff_id: string; amount_minor: number }>;
  carried_forward: ReadonlyArray<{ mode_name: string; staff_id: string; amount_minor: number }>;
}

export function buildReportDoc(
  report: ReportDocInput,
  staff_names: Readonly<Record<string, string>>,
  ctx: Pick<DocContext, 'width_cols' | 'currency_exponent' | 'utc_offset_ms'>,
): Doc {
  const cols = ctx.width_cols;
  const m = (v: number) => formatMinor(v, ctx.currency_exponent);
  const name = (id: string | null) => (id === null ? '-' : Object.hasOwn(staff_names, id) ? staff_names[id]! : id);
  const row = (left: string, right: string | number) => spread(left, String(right), cols);
  const section = (title: string): DocBlock[] => [{ rule: true }, { text: title, bold: true }];
  const s = report.sales;
  const blocks: DocBlock[] = [
    center(report.kind === 'z' ? `Z REPORT #${report.z_no ?? ''}` : 'X REPORT (DAY NOT CLOSED)', true),
    center(`${report.business_date} ${report.currency_code}`),
    center(dateTime(report.issued_at, ctx.utc_offset_ms)),
    ...section('SALES'),
    ...row('Invoices', s.invoice_count),
    ...row('Gross', m(s.gross_minor)),
    ...row(`Discounts (${s.discounts.count})`, m(-s.discounts.value_minor)),
    ...s.discounts.by_reason.flatMap((r) => row(`  ${r.reason_code} (${r.count})`, m(r.value_minor))),
    ...s.discounts.entries.flatMap((e) =>
      row(`  ${name(e.requester_staff_id)} / ${name(e.approver_staff_id)} ${e.method}`, m(e.value_minor)),
    ),
    ...row('Service charge', m(s.service_charge_minor)),
    ...row('Net', m(s.net_minor)),
    ...s.taxes.flatMap((t) => row(`${t.label} ${formatRateBp(t.rate_bp)} ${CLASS_LABEL[t.payment_class]} ${t.tax_profile_id}`, m(t.tax_minor))),
    ...row('Rounding', m(s.rounding_minor)),
    ...spread('Total', m(s.total_minor), cols, true),
    ...section('CREDITS'),
    ...row(`Credits (${report.credits.count})`, m(report.credits.value_minor)),
    ...report.credits.by_reason.flatMap((r) => row(`  ${r.reason_code} (${r.count})`, m(r.value_minor))),
    ...row(`Full refunds (${report.full_refunds.count})`, m(report.full_refunds.value_minor)),
    ...spread('Net (sales - credits)', m(report.net_after_credits_minor), cols, true),
    ...section('PAYMENTS BY MODE'),
    ...report.payments_by_mode.flatMap((p) => [
      { text: p.mode_name },
      ...row('  In', m(p.in_minor)),
      ...row('  Out', m(-p.out_minor)),
      ...row('  Change', m(p.change_minor)),
    ]),
    ...report.brought_forward.flatMap((b) => row(`Brought forward ${b.mode_name} ${name(b.staff_id)}`, m(b.amount_minor))),
    ...report.carried_forward.flatMap((c) => row(`Carried forward ${c.mode_name} ${name(c.staff_id)}`, m(c.amount_minor))),
    ...section('TAKINGS BY TAKER'),
    ...report.takings_by_taker.flatMap((t) => row(name(t.staff_id), m(t.amount_minor))),
    ...section('COMPS, VOIDS, REOPENS'),
    ...row('Comps', m(report.comps.value_minor)),
    ...row('Voided comps', m(report.comps.voided_minor)),
    ...row(`Comp removals (${report.comps.removals.count})`, m(report.comps.removals.value_minor)),
    ...report.voids.flatMap((v) => row(`Voids ${v.disposition ?? 'no disposition'} (${v.count})`, m(v.value_minor))),
    ...row(`Reopens (${report.reopens.count})`, m(report.reopens.value_minor)),
    ...report.reopens.entries.map((e) => ({ text: `  ${name(e.requester_staff_id)} / ${name(e.approver_staff_id)}` })),
    ...section('PETTY CASH'),
    ...report.petty_cash.flatMap((p) => row(`${p.category_name} ${p.kind}`, m(p.amount_minor))),
    ...report.open_advances.flatMap((a) => row(`Advance ${name(a.staff_id)} ${a.age_minutes} min`, m(a.amount_minor))),
    ...section('SHIFTS'),
    ...report.shifts.flatMap((sh) => {
      // B23: on the X, a shift's expected cash is hidden until it is counted
      const hide = report.kind === 'x' && sh.counted_minor === null;
      return [
        { text: `${name(sh.staff_id)}${sh.skipped ? ' - count skipped' : ''}`, bold: true },
        ...row('  Float', m(sh.float_minor)),
        ...row('  Expected', hide ? 'hidden' : sh.expected_minor === null ? '-' : m(sh.expected_minor)),
        ...row('  Counted', sh.counted_minor === null ? '-' : m(sh.counted_minor)),
        ...row('  Variance', hide || sh.variance_minor === null ? '-' : m(sh.variance_minor)),
        ...(sh.signoff_state !== null ? [{ text: `  ${sh.signoff_state}` }] : []),
      ];
    }),
    ...section('VARIANCE SIGN-OFFS'),
    ...report.variance_signoffs.flatMap((v) =>
      row(`${v.shift_date} ${name(v.staff_id)} ${v.outcome} ${name(v.approver_staff_id)} ${dateTime(v.at, ctx.utc_offset_ms)}`, m(v.amount_minor)),
    ),
    ...section('PENDING SIGN-OFFS'),
    ...report.pending_signoffs.flatMap((p) => row(`${p.shift_date} ${name(p.staff_id)}`, m(p.amount_minor))),
    ...section('FISCAL'),
    ...row('Pending', report.fiscal.pending),
    ...row('Acked', report.fiscal.acked),
    ...row('Rejected', report.fiscal.rejected),
    ...row('Not required', report.fiscal.not_required),
    ...section('BILLS'),
    ...row('Bills', report.bills.count),
    ...row('Average bill', m(report.bills.average_minor)),
    ...(report.kind === 'x'
      ? report.open_bills.flatMap((b) => row(`${b.identifier} open ${b.open_minutes} min`, b.flagged ? 'OPEN TOO LONG' : ''))
      : []),
    ...report.carried_over.map((c) => ({ text: `${c.label} ${c.carried_in ? 'carried in' : 'carried over'}` })),
    ...END,
  ];
  return { width_cols: cols, blocks };
}
