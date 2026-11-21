import { z } from 'zod';
import {
  PAYMENT_CLASSES,
  PAYMENT_MODE_KINDS,
  ROUNDING_APPLIES_TO,
  ROUNDING_METHODS,
  type FiscalReceiptSnapshot,
} from '@pos/domain';
import { NoneAdapterSettings } from './fiscal-adapters/none.js';
import { PraAdapterSettings } from './fiscal-adapters/pra.js';
import type { ReceiptFiscal } from './jurisdiction-seeds.js';

// 05 §4.5 rows A-1 (3) and A-2: the Zod wire shape of the per-branch billing settings document, shared by the cloud
// billing routes (P0.9b) and the owner app (browser-safe: zod only). Shape and the A-1 (3) bounds refuse at parse
// (400 VALIDATION_FAILED; C6: a repeated key → `<list>.N.<key>`). The A-2 rules that answer 422
// CONFIG_REFERENCE_INVALID without reading the database are `billingSettingsConfigIssue` below; the checks that read
// it (not_found, profile_missing, currency_mismatch, authority codes per fiscalized order type, R-13
// default_pos_id) are `billingSettingsReferenceIssue` (P0.9b), given the catalog facts the cloud service reads.
// No secret field (B22): the fiscal token is a hub credential (fiscal_credentials, SetFiscalToken).

// The adapter settings schemas by adapter_key (A-2, H9-4: shared from fiscal-adapters/<key>.ts).
export const FISCAL_ADAPTER_SETTINGS_SCHEMAS: Readonly<Record<string, z.ZodType>> = Object.freeze({
  none: NoneAdapterSettings,
  PRA: PraAdapterSettings,
});

// A-1 (3) H16-13: rounding_step_minor is 1 … 10^(exponent + 4) minor units.
export function roundingStepMaxMinor(exponent: number): number {
  if (!Number.isInteger(exponent) || exponent < 0) throw new RangeError(`invalid currency exponent ${exponent}`);
  return 10 ** (exponent + 4);
}

const ADAPTER_SETTINGS_MAX_BYTES = 4096;

const Id = z.string().min(1);
const Label = z.string().trim().min(1);
const Int = z.number().int();
const PaymentClass = z.enum(PAYMENT_CLASSES);
const IntegrationStatus = z.enum(['integrated', 'not_integrated']);
const HttpsUrl = z.url({ protocol: /^https$/ });
const ReceiptLines = z.array(z.string().max(48)).max(6);
const ServiceChargeBp = Int.min(0).max(3000);

// C6: a second entry for one key → issue at `<list>.N.<key>` (N = the repeat as sent); `field` null puts it on the
// entry itself (composite keys).
function uniqueBy<T>(key: (entry: T) => string, field: string | null) {
  return (entries: readonly T[], ctx: z.RefinementCtx): void => {
    const seen = new Set<string>();
    entries.forEach((entry, i) => {
      const k = key(entry);
      if (seen.has(k)) ctx.addIssue({ code: 'custom', path: field === null ? [i] : [i, field], message: 'duplicate key' });
      seen.add(k);
    });
  };
}

const AuthorityCode = z.object({ adapter_key: Id, code: z.string().min(1).max(20) });

const PaymentMode = z.object({
  mode_id: Id,
  name: Label,
  kind: z.enum(PAYMENT_MODE_KINDS),
  payment_class: PaymentClass,
  reference_required: z.boolean(),
  is_active: z.boolean(),
  sort_order: Int,
  authority_codes: z.array(AuthorityCode).superRefine(uniqueBy((c) => c.adapter_key, 'adapter_key')),
});

const ByOrderType = <T extends z.ZodType>(value: T) =>
  z.object({ dine_in: value, takeaway: value, parking: value, delivery: value });

const DiscountReason = z.object({ code: Id, label: Label });
const PettyCategory = z.object({ category_id: Id, name: Label, is_active: z.boolean() });
const TaxRegistration = z.object({ code: Id, number: z.string().trim().min(1).max(30) });

const Receipt = z.object({
  header_lines: ReceiptLines,
  footer_lines: ReceiptLines,
  show: z.object({
    tax_reg_no: z.boolean(),
    address: z.boolean(),
    phone: z.boolean(),
    cashier: z.boolean(),
    order_no: z.boolean(),
    bill_no: z.boolean(),
  }),
  tax_registrations: z.array(TaxRegistration).superRefine(uniqueBy((r) => r.code, 'code')),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  invoice_prefix: z.string().max(6),
});

// UTF-8 byte length (no TextEncoder: this package's lib has neither DOM nor node types).
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

const AdapterSettings = z
  .record(Id, z.record(z.string(), z.unknown()))
  .refine((settings) => utf8Bytes(JSON.stringify(settings)) <= ADAPTER_SETTINGS_MAX_BYTES, {
    message: `at most ${ADAPTER_SETTINGS_MAX_BYTES} bytes`,
  });

const Fiscal = z.object({
  environment: z.enum(['sandbox', 'production']),
  base_urls: z.record(Id, z.object({ sandbox: HttpsUrl.optional(), production: HttpsUrl.optional() })).optional(),
  pos_ids: z.array(z.object({ pos_id: Id, label: Label })).superRefine(uniqueBy((p) => p.pos_id, 'pos_id')),
  default_pos_id: Id.nullable(),
  device_pos_ids: z
    .array(z.object({ device_id: Id, pos_id: Id }))
    .superRefine(uniqueBy((d) => d.device_id, 'device_id')),
  integration_status: IntegrationStatus,
  fiscalize_by_order_type: ByOrderType(z.boolean()),
  stuck_after_ms: Int,
  // set by the service when jurisdiction_id changes (A-1 (3))
  switched_at: z.string().nullable(),
  adapter_settings: AdapterSettings,
});

const RateOverride = z.object({
  tax_class_id: Id,
  tax_code: Id,
  payment_class: PaymentClass,
  integration_status: IntegrationStatus,
  rate_bp: Int.min(0).max(10_000),
  effective_from: z.iso.date(),
  notification_ref: z.string().nullable(),
});

const documentShape = {
  jurisdiction_id: Id,
  // owner overrides; absent = the jurisdiction's
  prices_include_tax: z.boolean().optional(),
  rounding_step_minor: Int.min(1).optional(),
  rounding_method: z.enum(ROUNDING_METHODS).optional(),
  rounding_applies_to: z.enum(ROUNDING_APPLIES_TO).optional(),
  payment_modes: z.array(PaymentMode).superRefine(uniqueBy((m) => m.mode_id, 'mode_id')),
  service_charge_bp: ByOrderType(ServiceChargeBp),
  service_charge_tax_profile_id: Id.nullable(),
  discount_reasons: z.array(DiscountReason).superRefine(uniqueBy((r) => r.code, 'code')),
  max_discount_pct: Int,
  variance_threshold_minor: Int,
  petty_cash_limit_minor: Int,
  petty_categories: z.array(PettyCategory).superRefine(uniqueBy((c) => c.category_id, 'category_id')),
  open_bill_flag_minutes: Int,
  receipt: Receipt,
  fiscal: Fiscal,
  rate_overrides: z
    .array(RateOverride)
    .superRefine(
      uniqueBy(
        (o) => JSON.stringify([o.tax_class_id, o.tax_code, o.payment_class, o.integration_status, o.effective_from]),
        null,
      ),
    ),
};

/** The document without the exponent-dependent step bound (e.g. to type a stored or returned document). */
export const BillingSettings = z.object(documentShape);
export type BillingSettings = z.infer<typeof BillingSettings>;

function stepBound(exponent: number) {
  const max = roundingStepMaxMinor(exponent);
  return (doc: { rounding_step_minor?: number | undefined }, ctx: z.RefinementCtx): void => {
    if (doc.rounding_step_minor !== undefined && doc.rounding_step_minor > max) {
      ctx.addIssue({ code: 'custom', path: ['rounding_step_minor'], message: `at most ${max}` });
    }
  };
}

/** The document with the A-1 (3) bounds of a currency whose exponent is `exponent` (`currencyExponent`, row F-6). */
export function billingSettingsDocument(exponent: number) {
  return BillingSettings.superRefine(stepBound(exponent));
}

/**
 * The `PUT` body without the exponent-dependent step bound: the route parses with this (the tenant's currency is
 * read in the transaction), the service then applies `billingSettingsDocument(exponent)`.
 */
export const PutBillingSettingsBodyShape = z.object({ expected_version: z.string().min(1), ...documentShape });

/** `PUT /v1/admin/branches/:branch_id/billing` body (A-1 (4)): the document plus `expected_version`. */
export function putBillingSettingsBody(exponent: number) {
  return z.object({ expected_version: z.string().min(1), ...documentShape }).superRefine(stepBound(exponent));
}

export interface BillingSettingsConfigIssue {
  field: string;
  reason?: 'invalid';
}

/**
 * The A-2 rules that answer `422 CONFIG_REFERENCE_INVALID` and read no table, first failing one in this order:
 * a mode of kind 'cash' has payment_class 'cash' (`payment_modes.N.payment_class`); at least one active mode of kind
 * 'cash' (`payment_modes`); `fiscal.adapter_settings[key]` parses by that key's settingsSchema
 * (`fiscal.adapter_settings.<key>`, reason 'invalid'; a key with no schema is invalid). Null = none fails.
 */
export function billingSettingsConfigIssue(doc: BillingSettings): BillingSettingsConfigIssue | null {
  const cashClassMiss = doc.payment_modes.findIndex((m) => m.kind === 'cash' && m.payment_class !== 'cash');
  if (cashClassMiss !== -1) return { field: `payment_modes.${cashClassMiss}.payment_class` };
  if (!doc.payment_modes.some((m) => m.kind === 'cash' && m.is_active)) return { field: 'payment_modes' };
  for (const [key, settings] of Object.entries(doc.fiscal.adapter_settings)) {
    const schema = Object.hasOwn(FISCAL_ADAPTER_SETTINGS_SCHEMAS, key) ? FISCAL_ADAPTER_SETTINGS_SCHEMAS[key] : undefined;
    if (schema === undefined || !schema.safeParse(settings).success) {
      return { field: `fiscal.adapter_settings.${key}`, reason: 'invalid' };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// P0.9b: built-in default document, the A-2 checks that read the catalog, the snapshot receipt mapping.
// ---------------------------------------------------------------------------------------------------------------

/**
 * §3.4: under a jurisdiction with no profile rows (the `none` and `PK` seeds) every tax class is one tax of this
 * code at the class's `rate_bp`, for both payment classes. Also the only override `tax_code` such a class has.
 */
export const RATE_BP_TAX_CODE = 'TAX';

/**
 * ⚠️ P0.G (G-23): the seeds hold no `effective_from`; the `none` / `PK` rule rows and every synthesized
 * `RATE_BP_TAX_CODE` rate row are in force from this date (the smallest `YYYY-MM-DD`). The 0014 seed uses it too.
 */
export const BILLING_MIN_EFFECTIVE_FROM = '0001-01-01';

/** §3.4: the `RATE_BP_TAX_CODE` tax's rate rows — one per payment class and integration status, from the minimum date. */
export function rateBpRates(rate_bp: number): Array<{
  payment_class: (typeof PAYMENT_CLASSES)[number];
  integration_status: 'integrated' | 'not_integrated';
  effective_from: string;
  rate_bp: number;
  ref: string | null;
}> {
  return PAYMENT_CLASSES.flatMap((payment_class) =>
    (['integrated', 'not_integrated'] as const).map((integration_status) => ({
      payment_class,
      integration_status,
      effective_from: BILLING_MIN_EFFECTIVE_FROM,
      rate_bp,
      ref: null,
    })),
  );
}

// A-1 (3) defaults: 100 / 5 000 major units (Pakistan 10 000 / 500 000 minor).
const VARIANCE_THRESHOLD_MAJOR = 100;
const PETTY_CASH_LIMIT_MAJOR = 5_000;

/**
 * 05 §4.5 row A-1 (3) / (5) (v1.0.2 R-10, R-14, R-15; 01a v2.6 §4.3, §5.2b): the billing settings document a branch
 * has before the owner saves one — the cloud `GET` answers it, and the hub's built-in defaults are built on it.
 * Jurisdiction `PK` for a PKR tenant, `none` otherwise; one cash mode; no service charge; the §4.4 example discount
 * reasons and the R-15 petty categories; empty invoice prefix and receipt header / footer; every other value per
 * A-1 (3). A fresh object on every call.
 */
export function defaultBillingSettings(tenant: { currency_code: string; currency_exponent: number }): BillingSettings {
  const { currency_code, currency_exponent } = tenant;
  if (!Number.isInteger(currency_exponent) || currency_exponent < 0) {
    throw new RangeError(`invalid currency exponent ${currency_exponent}`);
  }
  const major = 10 ** currency_exponent;
  return {
    jurisdiction_id: currency_code === 'PKR' ? 'PK' : 'none',
    payment_modes: [
      {
        mode_id: 'cash',
        name: 'Cash',
        kind: 'cash',
        payment_class: 'cash',
        reference_required: false,
        is_active: true,
        sort_order: 0,
        authority_codes: [],
      },
    ],
    service_charge_bp: { dine_in: 0, takeaway: 0, parking: 0, delivery: 0 },
    service_charge_tax_profile_id: null,
    discount_reasons: [
      { code: 'regular_customer', label: 'Regular customer' },
      { code: 'staff', label: 'Staff' },
      { code: 'owner_guest', label: 'Owner guest' },
      { code: 'complaint', label: 'Complaint' },
      { code: 'other', label: 'Other' },
    ],
    max_discount_pct: 100,
    variance_threshold_minor: VARIANCE_THRESHOLD_MAJOR * major,
    petty_cash_limit_minor: PETTY_CASH_LIMIT_MAJOR * major,
    petty_categories: [
      { category_id: 'supplies', name: 'Supplies', is_active: true },
      { category_id: 'utilities', name: 'Utilities', is_active: true },
      { category_id: 'staff_advance', name: 'Staff advance', is_active: true },
      { category_id: 'transport', name: 'Transport', is_active: true },
      { category_id: 'other', name: 'Other', is_active: true },
    ],
    open_bill_flag_minutes: 240,
    receipt: {
      header_lines: [],
      footer_lines: [],
      show: { tax_reg_no: true, address: true, phone: true, cashier: true, order_no: true, bill_no: true },
      tax_registrations: [],
      address: null,
      phone: null,
      invoice_prefix: '',
    },
    fiscal: {
      environment: 'sandbox',
      pos_ids: [],
      default_pos_id: null,
      device_pos_ids: [],
      integration_status: 'integrated',
      // Q17: delivery is not fiscalized by default
      fiscalize_by_order_type: { dine_in: true, takeaway: true, parking: true, delivery: false },
      stuck_after_ms: 1_800_000,
      switched_at: null,
      adapter_settings: {},
    },
    rate_overrides: [],
  };
}

/** The catalog facts the A-2 reference checks read (the cloud service loads them; no statement here). */
export interface BillingReferenceContext {
  tenant_currency_code: string;
  /** The document's jurisdiction; null = no such jurisdiction. */
  jurisdiction: {
    jurisdiction_id: string;
    adapter_key: string;
    /** NULL only for `none` = the tenant's currency. */
    currency_code: string | null;
    /** The codes of its rules' `receipt_fiscal.tax_reg_labels`. */
    tax_reg_codes: readonly string[];
    /** Its `jurisdiction_profile_taxes` rows; none = one tax at `rate_bp` per class (§3.4). */
    profile_taxes: ReadonlyArray<{ fiscal_category: string; tax_code: string }>;
    /** The `integration_status` values of its `jurisdiction_tax_rates` rows (R-36). */
    rate_integration_statuses: ReadonlyArray<'integrated' | 'not_integrated'>;
  } | null;
  /** The tenant's tax classes (01a tax class = 05 tax profile), archived ones included. */
  tax_classes: ReadonlyArray<{ tax_class_id: string; is_archived: boolean; fiscal_category: string | null }>;
}

export interface BillingSettingsReferenceIssue {
  field: string;
  reason?: 'not_found' | 'currency_mismatch' | 'profile_missing' | 'invalid';
  ids?: string[];
}

/**
 * The A-2 checks that need the catalog and the tenant's tax classes, after the DB-free ones, first failing one in this
 * order (C4 step 4, references first, C1): unknown `jurisdiction_id` (not_found); its currency ≠ the tenant's
 * (currency_mismatch, B31); `billingSettingsConfigIssue`; adapter ≠ `none` without `fiscal.default_pos_id` (R-13);
 * adapter ≠ `none`, an order type fiscalized and an active mode with no code for that adapter
 * (`payment_modes.N.authority_codes`, J-5); a jurisdiction with profile rows whose catalog has no rate row for
 * `fiscal.integration_status` (`{ field: 'fiscal.integration_status' }`, R-36, owner 2026-11-20: the last fiscal-settings
 * check, before the receipt and tax-class references); a registration code not in the jurisdiction's labels; an unknown
 * `service_charge_tax_profile_id`; an override's unknown `tax_class_id`, or a `tax_code` not in that class's profile
 * list (all not_found); then an active class whose `fiscal_category` has no profile row (profile_missing, ids sorted).
 * A jurisdiction with no profile rows gives every class the one `RATE_BP_TAX_CODE` tax (§3.4), so nothing is missing.
 */
export function billingSettingsReferenceIssue(
  doc: BillingSettings,
  ctx: BillingReferenceContext,
): BillingSettingsReferenceIssue | null {
  const j = ctx.jurisdiction;
  if (j === null) return { field: 'jurisdiction_id', reason: 'not_found' };
  if (j.currency_code !== null && j.currency_code !== ctx.tenant_currency_code) {
    return { field: 'jurisdiction_id', reason: 'currency_mismatch' };
  }
  const configIssue = billingSettingsConfigIssue(doc);
  if (configIssue !== null) return configIssue;
  if (j.adapter_key !== 'none') {
    if (doc.fiscal.default_pos_id === null) return { field: 'fiscal.default_pos_id' };
    if (Object.values(doc.fiscal.fiscalize_by_order_type).some(Boolean)) {
      const missing = doc.payment_modes.findIndex(
        (m) => m.is_active && !m.authority_codes.some((c) => c.adapter_key === j.adapter_key),
      );
      if (missing !== -1) return { field: `payment_modes.${missing}.authority_codes` };
    }
  }
  // R-36: a jurisdiction with no profile rows (none, PK) has no catalog rate rows; its one rate_bp tax is synthesized
  // for both statuses (G-23), so only a jurisdiction with profile rows is checked.
  if (j.profile_taxes.length > 0 && !j.rate_integration_statuses.includes(doc.fiscal.integration_status)) {
    return { field: 'fiscal.integration_status' };
  }
  const regCodes = new Set(j.tax_reg_codes);
  const badReg = doc.receipt.tax_registrations.findIndex((r) => !regCodes.has(r.code));
  if (badReg !== -1) return { field: `receipt.tax_registrations.${badReg}.code`, reason: 'not_found' };
  const classes = new Map(ctx.tax_classes.map((c) => [c.tax_class_id, c]));
  if (doc.service_charge_tax_profile_id !== null && !classes.has(doc.service_charge_tax_profile_id)) {
    return { field: 'service_charge_tax_profile_id', reason: 'not_found' };
  }
  const rateBpRule = j.profile_taxes.length === 0;
  const codesOf = (fiscalCategory: string | null): Set<string> =>
    rateBpRule
      ? new Set([RATE_BP_TAX_CODE])
      : new Set(j.profile_taxes.filter((p) => p.fiscal_category === fiscalCategory).map((p) => p.tax_code));
  for (const [i, o] of doc.rate_overrides.entries()) {
    const cls = classes.get(o.tax_class_id);
    if (cls === undefined) return { field: `rate_overrides.${i}.tax_class_id`, reason: 'not_found' };
    if (!codesOf(cls.fiscal_category).has(o.tax_code)) return { field: `rate_overrides.${i}.tax_code`, reason: 'not_found' };
  }
  if (!rateBpRule) {
    const categories = new Set(j.profile_taxes.map((p) => p.fiscal_category));
    const ids = ctx.tax_classes
      .filter((c) => !c.is_archived && (c.fiscal_category === null || !categories.has(c.fiscal_category)))
      .map((c) => c.tax_class_id)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (ids.length > 0) return { field: 'jurisdiction_id', reason: 'profile_missing', ids };
  }
  return null;
}

/**
 * 05 v1.0.2 G-3 (R-12; 01a v2.6 §4.3): the snapshot rule's `receipt` from the catalog's nullable `receipt_fiscal` —
 * null maps to a null `fiscal_number_label` and empty lists (no QR, no buyer ID). Owned by the snapshot builder.
 */
export function snapshotReceipt(r: ReceiptFiscal | null): FiscalReceiptSnapshot {
  if (r === null) {
    return { fiscal_number_label: null, tax_reg_labels: [], show_qr: false, qr_url_template: null, buyer_id_on_receipt: false };
  }
  return {
    fiscal_number_label: r.fiscal_number_label,
    tax_reg_labels: r.tax_reg_labels.map((l) => ({ code: l.code, label: l.label })),
    show_qr: r.show_qr,
    qr_url_template: r.qr_url_template,
    buyer_id_on_receipt: r.buyer_id_on_receipt,
  };
}

// A-1 (4) responses. `GET` / `PUT …/billing`: the document with its branch and version (the content hash,
// 01b B23 style); `expected_version` of the next PUT is that `version`.
export const BillingSettingsWire = BillingSettings.extend({ branch_id: z.string(), version: z.string() });
export type BillingSettingsWire = z.infer<typeof BillingSettingsWire>;
export const BillingSettingsResponse = z.object({ data: z.object({ billing: BillingSettingsWire }) });

// `GET /v1/admin/jurisdictions?jurisdiction_id=`: the read-only catalog (A-1 (2)); the filter is optional.
export const JurisdictionsQuery = z.object({ jurisdiction_id: z.string().min(1).optional() });
export const JurisdictionWire = z.object({
  jurisdiction_id: z.string(),
  name: z.string(),
  adapter_key: z.string(),
  currency_code: z.string().nullable(),
  rules: z.array(
    z.object({
      effective_from: z.string(),
      prices_include_tax: z.boolean(),
      rounding_step_minor: z.number().int().nullable(),
      rounding_mode: z.enum(ROUNDING_METHODS),
      rounding_applies_to: z.enum(ROUNDING_APPLIES_TO),
      mixed_class_rule: z.string(),
      buyer_id: z.object({
        threshold_minor: z.number().int().nullable(),
        accepted_types: z.array(z.object({ type: z.string(), label: z.string(), pattern: z.string(), strip: z.string() })),
      }),
      receipt_fiscal: z
        .object({
          fiscal_number_label: z.string(),
          tax_reg_labels: z.array(z.object({ code: z.string(), label: z.string() })),
          show_qr: z.boolean(),
          qr_url_template: z.string().nullable(),
          buyer_id_on_receipt: z.boolean(),
        })
        .nullable(),
      catch_up_window_ms: z.number().int().nullable(),
      credit_support: z.enum(['credit_invoice', 'none']),
      ref: z.string().nullable(),
    }),
  ),
  profile_taxes: z.array(
    z.object({ fiscal_category: z.string(), seq: z.number().int(), tax_code: z.string(), label: z.string(), compound: z.boolean() }),
  ),
  tax_rates: z.array(
    z.object({
      fiscal_category: z.string(),
      tax_code: z.string(),
      payment_class: PaymentClass,
      integration_status: IntegrationStatus,
      effective_from: z.string(),
      rate_bp: z.number().int(),
      notification_ref: z.string().nullable(),
      source_note: z.string().nullable(),
    }),
  ),
});
export type JurisdictionWire = z.infer<typeof JurisdictionWire>;
export const JurisdictionsResponse = z.object({ data: z.object({ jurisdictions: z.array(JurisdictionWire) }) });
