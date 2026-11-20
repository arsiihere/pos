import type { BillingDocument, PutBillingBody } from '../../../api/cloud-admin';
import { formatRupees, parseRupees } from '../money';

// 01a v2.7.1 §8.1 (05 row A-1 (6)): the Billing page's draft. The owner edits text; this module turns it into the
// document (or names the fields that fail) and maps the cloud's 422 / 400 answers onto the same fields. Every value the
// page does not edit (payment modes, discount reasons, petty categories, POS ids, rate overrides, adapter settings,
// rounding overrides) is carried from the loaded document unchanged, so a save never drops a part of it.
export const ORDER_TYPES = ['dine_in', 'takeaway', 'parking', 'delivery'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
export const SHOW_KEYS = ['tax_reg_no', 'address', 'phone', 'cashier', 'order_no', 'bill_no'] as const;
export type ShowKey = (typeof SHOW_KEYS)[number];

export interface Draft {
  jurisdiction_id: string;
  service: Record<OrderType, string>;
  max_discount_pct: string;
  variance: string;
  petty: string;
  open_bill_flag_minutes: string;
  header: string;
  footer: string;
  address: string;
  phone: string;
  invoice_prefix: string;
  show: Record<ShowKey, boolean>;
  registrations: Record<string, string>;
  environment: 'sandbox' | 'production';
  integration_status: 'integrated' | 'not_integrated';
  default_pos_id: string;
  fiscalize: Record<OrderType, boolean>;
}

const percent = (bp: number): string => String(bp / 100);

export function toDraft(doc: BillingDocument): Draft {
  return {
    jurisdiction_id: doc.jurisdiction_id,
    service: Object.fromEntries(ORDER_TYPES.map((o) => [o, percent(doc.service_charge_bp[o])])) as Record<OrderType, string>,
    max_discount_pct: String(doc.max_discount_pct),
    variance: formatRupees(doc.variance_threshold_minor),
    petty: formatRupees(doc.petty_cash_limit_minor),
    open_bill_flag_minutes: String(doc.open_bill_flag_minutes),
    header: doc.receipt.header_lines.join('\n'),
    footer: doc.receipt.footer_lines.join('\n'),
    address: doc.receipt.address ?? '',
    phone: doc.receipt.phone ?? '',
    invoice_prefix: doc.receipt.invoice_prefix,
    show: { ...doc.receipt.show },
    registrations: Object.fromEntries(doc.receipt.tax_registrations.map((r) => [r.code, r.number])),
    environment: doc.fiscal.environment,
    integration_status: doc.fiscal.integration_status,
    default_pos_id: doc.fiscal.default_pos_id ?? '',
    fiscalize: { ...doc.fiscal.fiscalize_by_order_type },
  };
}

// The A-1 (3) service charge: 0 – 30 % in whole basis points (two decimals).
const PERCENT_RE = /^(\d+)(?:\.(\d{1,2}))?$/;
export function parsePercentBp(text: string): number | null {
  const m = PERCENT_RE.exec(text.trim());
  return m === null ? null : Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

const WHOLE_RE = /^\d{1,9}$/;
export const SERVICE_MAX_BP = 3000;
export const LINE_MAX_CHARS = 48;
export const LINES_MAX = 6;
export const PREFIX_MAX_CHARS = 6;

export function splitLines(text: string): string[] {
  return text === '' ? [] : text.split(/\r?\n/);
}

export type ErrorKey =
  | 'service_range'
  | 'whole'
  | 'money'
  | 'lines_count'
  | 'line_length'
  | 'prefix_length'
  | 'reference'
  | 'not_found'
  | 'currency_mismatch'
  | 'profile_missing'
  | 'integration_status'
  | 'invalid';

export type FieldErrors = Record<string, ErrorKey>;

/** The input names the page shows; a cloud field path lands on the one it equals or sits under. */
export const SERVICE_FIELDS = ORDER_TYPES.map((o) => `service_charge_bp.${o}`);
export const REGISTRATION_PREFIX = 'receipt.tax_registrations.';
const FIELD_NAMES: readonly string[] = [
  'jurisdiction_id',
  ...SERVICE_FIELDS,
  'max_discount_pct',
  'variance_threshold_minor',
  'petty_cash_limit_minor',
  'open_bill_flag_minutes',
  'receipt.header_lines',
  'receipt.footer_lines',
  'receipt.address',
  'receipt.phone',
  'receipt.invoice_prefix',
  'fiscal.environment',
  'fiscal.integration_status',
  'fiscal.default_pos_id',
  ...ORDER_TYPES.map((o) => `fiscal.fiscalize_by_order_type.${o}`),
];

export function fieldFor(path: string): string | null {
  const direct = FIELD_NAMES.find((name) => path === name || path.startsWith(`${name}.`));
  return direct ?? null;
}

/** The document without its wire parts (branch and version): what a PUT carries beside `expected_version`. */
export function documentOf(wire: BillingDocument): Omit<BillingDocument, 'branch_id' | 'version'> {
  const copy: Partial<BillingDocument> = { ...wire };
  delete copy.branch_id;
  delete copy.version;
  return copy as Omit<BillingDocument, 'branch_id' | 'version'>;
}

export type Built = { ok: true; body: Omit<PutBillingBody, 'expected_version'> } | { ok: false; errors: FieldErrors };

export function build(draft: Draft, base: BillingDocument): Built {
  const errors: FieldErrors = {};
  const service = {} as Record<OrderType, number>;
  for (const o of ORDER_TYPES) {
    const bp = parsePercentBp(draft.service[o]);
    if (bp === null || bp > SERVICE_MAX_BP) errors[`service_charge_bp.${o}`] = 'service_range';
    else service[o] = bp;
  }
  const whole = (text: string, name: string): number => {
    if (!WHOLE_RE.test(text.trim())) {
      errors[name] = 'whole';
      return 0;
    }
    return Number(text.trim());
  };
  const maxDiscount = whole(draft.max_discount_pct, 'max_discount_pct');
  const openBill = whole(draft.open_bill_flag_minutes, 'open_bill_flag_minutes');
  const money = (text: string, name: string): number => {
    const parsed = parseRupees(text);
    if (!parsed.ok) {
      errors[name] = 'money';
      return 0;
    }
    return parsed.value;
  };
  const variance = money(draft.variance, 'variance_threshold_minor');
  const petty = money(draft.petty, 'petty_cash_limit_minor');
  const header = splitLines(draft.header);
  const footer = splitLines(draft.footer);
  for (const [name, lines] of [['receipt.header_lines', header], ['receipt.footer_lines', footer]] as const) {
    if (lines.length > LINES_MAX) errors[name] = 'lines_count';
    else if (lines.some((l) => l.length > LINE_MAX_CHARS)) errors[name] = 'line_length';
  }
  if (draft.invoice_prefix.length > PREFIX_MAX_CHARS) errors['receipt.invoice_prefix'] = 'prefix_length';
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const document = documentOf(base);
  // A registration the page shows is replaced by the typed number (blank removes it); the others stay as loaded.
  const registrations: BillingDocument['receipt']['tax_registrations'] = [];
  const seen = new Set<string>();
  for (const r of base.receipt.tax_registrations) {
    seen.add(r.code);
    const typed = draft.registrations[r.code];
    if (typed === undefined) registrations.push(r);
    else if (typed.trim() !== '') registrations.push({ code: r.code, number: typed.trim() });
  }
  for (const [code, typed] of Object.entries(draft.registrations)) {
    if (!seen.has(code) && typed.trim() !== '') registrations.push({ code, number: typed.trim() });
  }
  return {
    ok: true,
    body: {
      ...document,
      jurisdiction_id: draft.jurisdiction_id,
      service_charge_bp: service,
      max_discount_pct: maxDiscount,
      variance_threshold_minor: variance,
      petty_cash_limit_minor: petty,
      open_bill_flag_minutes: openBill,
      receipt: {
        ...base.receipt,
        header_lines: header,
        footer_lines: footer,
        address: draft.address.trim() === '' ? null : draft.address,
        phone: draft.phone.trim() === '' ? null : draft.phone,
        invoice_prefix: draft.invoice_prefix,
        show: { ...draft.show },
        tax_registrations: registrations,
      },
      fiscal: {
        ...base.fiscal,
        environment: draft.environment,
        integration_status: draft.integration_status,
        default_pos_id: draft.default_pos_id === '' ? null : draft.default_pos_id,
        fiscalize_by_order_type: { ...draft.fiscalize },
      },
    },
  };
}

// 01a §6.25 / 05 A-2: `422 CONFIG_REFERENCE_INVALID { field, reason? }` names a document path. A path with an input
// maps to it; any other (a payment mode, an adapter setting, a rate override) is `unmapped` and the page names it.
const REASONS: Record<string, ErrorKey> = {
  not_found: 'not_found',
  currency_mismatch: 'currency_mismatch',
  profile_missing: 'profile_missing',
  invalid: 'invalid',
};

export function referenceError(details: Record<string, unknown>): { field: string | null; path: string; key: ErrorKey } {
  const path = typeof details['field'] === 'string' ? details['field'] : '';
  const reason = typeof details['reason'] === 'string' ? details['reason'] : '';
  const field = fieldFor(path);
  // R-36: no catalog rate row for the chosen integration status has its own text.
  const key = path === 'fiscal.integration_status' ? 'integration_status' : (REASONS[reason] ?? 'reference');
  return { field, path, key };
}

/** C6: a `400 VALIDATION_FAILED` lists `issues[{ path }]`; each path with an input lands on it. */
export function validationErrors(details: Record<string, unknown>): FieldErrors {
  const issues = details['issues'];
  const found: FieldErrors = {};
  if (!Array.isArray(issues)) return found;
  for (const issue of issues as { path?: unknown }[]) {
    const field = typeof issue.path === 'string' ? fieldFor(issue.path) : null;
    if (field !== null) found[field] = field.startsWith('service_charge_bp') ? 'service_range' : 'invalid';
  }
  return found;
}

/** The names of the fields that differ from the loaded document, for the unsaved-changes guard. */
export function changedFields(draft: Draft, doc: BillingDocument): string[] {
  const base = toDraft(doc);
  return (Object.keys(base) as (keyof Draft)[]).filter((k) => JSON.stringify(base[k]) !== JSON.stringify(draft[k])).map(String);
}
