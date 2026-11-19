import { z } from 'zod';
import { PAYMENT_CLASSES, PAYMENT_MODE_KINDS, ROUNDING_APPLIES_TO, ROUNDING_METHODS } from '@pos/domain';
import { NoneAdapterSettings } from './fiscal-adapters/none.js';
import { PraAdapterSettings } from './fiscal-adapters/pra.js';

// 05 §4.5 rows A-1 (3) and A-2: the Zod wire shape of the per-branch billing settings document, shared by the cloud
// billing routes (P0.9b) and the owner app (browser-safe: zod only). Shape and the A-1 (3) bounds refuse at parse
// (400 VALIDATION_FAILED; C6: a repeated key → `<list>.N.<key>`). The A-2 rules that answer 422
// CONFIG_REFERENCE_INVALID without reading the database are `billingSettingsConfigIssue` below; the checks that read
// it (not_found, profile_missing, currency_mismatch, authority codes per fiscalized order type) are P0.9b's.
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
