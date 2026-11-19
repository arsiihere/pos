import type {
  CREDIT_SUPPORT,
  MIXED_CLASS_RULES,
  ROUNDING_APPLIES_TO,
  ROUNDING_METHODS,
} from '@pos/domain';

// 05 §4.5 row A-1 (2), H9-3, H11-5: the `none` and `PK` jurisdiction rule values, in one exported constant. The
// cloud `0016` seed and the hub's built-in defaults (apps/hub/src/billing/defaults.ts) both take their values from
// here, and a cloud test asserts the seeded rows equal it (P0.9b). Browser-safe (types only from @pos/domain).
// `effective_from`, `ref` and the jurisdiction's display name are the 0016 seed's columns, not rule values.

export interface BuyerIdType {
  type: string;
  label: string;
  pattern: string;
  strip: string;
}

export interface ReceiptFiscal {
  fiscal_number_label: string;
  tax_reg_labels: ReadonlyArray<{ code: string; label: string }>;
  show_qr: boolean;
  qr_url_template: string | null;
  buyer_id_on_receipt: boolean;
}

export interface JurisdictionRuleValues {
  jurisdiction_id: string;
  adapter_key: string;
  /** NULL only for `none` = the tenant's currency. */
  currency_code: string | null;
  prices_include_tax: boolean;
  /** NULL = 1 minor unit = no rounding (H10-3). */
  rounding_step_minor: number | null;
  rounding_mode: (typeof ROUNDING_METHODS)[number];
  rounding_applies_to: (typeof ROUNDING_APPLIES_TO)[number];
  mixed_class_rule: (typeof MIXED_CLASS_RULES)[number];
  buyer_id: { threshold_minor: number | null; accepted_types: readonly BuyerIdType[] };
  /** NULL = no fiscal fields on the receipt. */
  receipt_fiscal: ReceiptFiscal | null;
  catch_up_window_ms: number | null;
  credit_support: (typeof CREDIT_SUPPORT)[number];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

// none: exclusive, step NULL (no rounding), nearest, all, higher_rate, no buyer threshold, no fiscal fields,
// catch-up NULL, credit_invoice; no profile rows (§3.4 gives one tax at the class's rate_bp).
const NONE: JurisdictionRuleValues = {
  jurisdiction_id: 'none',
  adapter_key: 'none',
  currency_code: null,
  prices_include_tax: false,
  rounding_step_minor: null,
  rounding_mode: 'nearest',
  rounding_applies_to: 'all',
  mixed_class_rule: 'higher_rate',
  buyer_id: { threshold_minor: null, accepted_types: [] },
  receipt_fiscal: null,
  catch_up_window_ms: null,
  credit_support: 'credit_invoice',
};

// PK (Pakistan, no authority): the none rules with step 100, adapter none, PKR — v0.6.2's adapter-none behaviour
// and the pilot fallback (H9-3).
const PK: JurisdictionRuleValues = {
  ...NONE,
  jurisdiction_id: 'PK',
  currency_code: 'PKR',
  rounding_step_minor: 100,
  buyer_id: { threshold_minor: null, accepted_types: [] },
};

export const JURISDICTION_SEEDS: Readonly<{ none: JurisdictionRuleValues; PK: JurisdictionRuleValues }> = deepFreeze({
  none: NONE,
  PK,
});
