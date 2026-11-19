import { currencyExponent, type ComputeRules, type ComputeTaxProfile } from '@pos/domain';
import {
  BILLING_MIN_EFFECTIVE_FROM,
  defaultBillingSettings,
  JURISDICTION_SEEDS,
  RATE_BP_TAX_CODE,
  rateBpRates,
  snapshotReceipt,
  type BillingSettings,
  type BranchConfig,
  type JurisdictionRuleValues,
  type SnapshotBillingRule,
} from '@pos/events';

// 05 §4.5 row A-1 (5), H9-3, H10-4, H11-5: the hub's built-in billing rules when the snapshot has no `billing` key —
// the `PK` seed for a PKR tenant, the `none` seed otherwise, both taken from the shared seed constant
// (@pos/events admin/jurisdiction-seeds.ts). ⚠️ P0.G (R-10, R-14, R-15, G-23; 05 v1.0.2 A-1 (5)): the document part
// is the cloud's default document (`defaultBillingSettings`): one cash mode, no service charge, the minimal
// discount_reasons / petty_categories lists, empty invoice prefix and receipt header / footer, every other value
// per A-1 (3) (variance / petty limits 100 / 5 000 major units by the exponent). The caller passes the tenant's
// currency and its exponent (`currencyExponent`, row F-6).
//
// P0.9b: `hubBilling` maps the snapshot (or these defaults) to the plain inputs of `compute.ts`; `computeRulesAt`
// picks the jurisdiction rule row in force on a business date (#14b).

export interface BuiltInBillingDefaults extends BillingSettings {
  jurisdiction: {
    jurisdiction_id: string;
    adapter_key: string;
    currency_code: string;
    currency_exponent: number;
    rules: JurisdictionRuleValues;
  };
  service_charge_tax_profile_id: null;
}

export function builtInBillingDefaults(tenant: { currency_code: string; currency_exponent: number }): BuiltInBillingDefaults {
  const { currency_code, currency_exponent } = tenant;
  if (!Number.isInteger(currency_exponent) || currency_exponent < 0) {
    throw new RangeError(`invalid currency exponent ${currency_exponent}`);
  }
  const rules = currency_code === 'PKR' ? JURISDICTION_SEEDS.PK : JURISDICTION_SEEDS.none;
  return {
    ...defaultBillingSettings(tenant),
    service_charge_tax_profile_id: null,
    jurisdiction: {
      jurisdiction_id: rules.jurisdiction_id,
      adapter_key: rules.adapter_key,
      // `none` has no currency of its own: it is the tenant's
      currency_code: rules.currency_code ?? currency_code,
      currency_exponent,
      rules,
    },
  };
}

/** G-23: the built-in rule row and the synthesized `none` rate rows are in force from this date (shared constant). */
export const MIN_EFFECTIVE_FROM = BILLING_MIN_EFFECTIVE_FROM;

/** The branch's billing data as compute.ts reads it: tax profiles keyed by `tax_profile_id` (= 01a tax_class_id). */
export interface HubBilling {
  settings: BillingSettings;
  jurisdiction: {
    jurisdiction_id: string;
    adapter_key: string;
    currency_code: string;
    currency_exponent: number;
    rules: SnapshotBillingRule[];
  };
  tax_profiles: ComputeTaxProfile[];
}

/**
 * 05 §4.5 row A-1 (5), ⚠️ P0.G (G-23, G-3): the snapshot's `billing` key → compute.ts inputs, renaming
 * `tax_class_id` → `tax_profile_id`. With no key, the built-in defaults: the seed's rules as one row from
 * `MIN_EFFECTIVE_FROM` (its null `receipt_fiscal` mapped by `snapshotReceipt`), and per tax class one
 * `RATE_BP_TAX_CODE` tax at the class's `rate_bp` (§3.4) with a rate row for each payment class and integration
 * status, so the branch's status always finds one. Archived classes are kept (an open line may still carry one).
 */
export function hubBilling(config: Pick<BranchConfig, 'currency_code' | 'tax_classes' | 'billing'>): HubBilling {
  const billing = config.billing;
  if (billing !== undefined) {
    const { jurisdiction, tax_profiles, ...settings } = billing;
    return {
      settings,
      jurisdiction,
      tax_profiles: tax_profiles.map((p) => ({ tax_profile_id: p.tax_class_id, taxes: p.taxes })),
    };
  }
  const defaults = builtInBillingDefaults({
    currency_code: config.currency_code,
    currency_exponent: currencyExponent(config.currency_code),
  });
  const { jurisdiction, ...settings } = defaults;
  const seed = jurisdiction.rules;
  return {
    settings,
    jurisdiction: {
      jurisdiction_id: jurisdiction.jurisdiction_id,
      adapter_key: jurisdiction.adapter_key,
      currency_code: jurisdiction.currency_code,
      currency_exponent: jurisdiction.currency_exponent,
      rules: [ruleFromSeed(seed)],
    },
    tax_profiles: config.tax_classes.map((c) => ({
      tax_profile_id: c.tax_class_id,
      taxes: [{ seq: 1, tax_code: RATE_BP_TAX_CODE, label: c.name, compound: false, rates: rateBpRates(c.rate_bp) }],
    })),
  };
}

function ruleFromSeed(seed: JurisdictionRuleValues): SnapshotBillingRule {
  return {
    effective_from: MIN_EFFECTIVE_FROM,
    prices_include_tax: seed.prices_include_tax,
    rounding_step_minor: seed.rounding_step_minor,
    rounding_mode: seed.rounding_mode,
    rounding_applies_to: seed.rounding_applies_to,
    mixed_class_rule: seed.mixed_class_rule,
    buyer_id: {
      threshold_minor: seed.buyer_id.threshold_minor,
      accepted_types: seed.buyer_id.accepted_types.map((t) => ({ ...t })),
    },
    receipt: snapshotReceipt(seed.receipt_fiscal),
    catch_up_window_ms: seed.catch_up_window_ms,
    credit_support: seed.credit_support,
    ref: null,
  };
}

/** #14b: the jurisdiction rule row in force on `business_date` (the latest `effective_from` ≤ it); null = none. */
export function ruleInForce(billing: HubBilling, business_date: string): SnapshotBillingRule | null {
  let best: SnapshotBillingRule | null = null;
  for (const rule of billing.jurisdiction.rules) {
    if (rule.effective_from > business_date) continue;
    if (best === null || rule.effective_from > best.effective_from) best = rule;
  }
  return best;
}

/**
 * The compute rules on `business_date` (a bill freezes the price mode and rounding it opens with, H9-9, H16-2):
 * the rule row in force (overrides already applied by the snapshot builder), the branch's integration status
 * and the currency exponent; `tax_enabled` is 01a's branch flag. Null when no rule row is in force.
 */
export function computeRulesAt(
  billing: HubBilling,
  o: { business_date: string; tax_enabled: boolean },
): ComputeRules | null {
  const rule = ruleInForce(billing, o.business_date);
  if (rule === null) return null;
  return {
    tax_enabled: o.tax_enabled,
    prices_include_tax: rule.prices_include_tax,
    rounding: { step_minor: rule.rounding_step_minor, mode: rule.rounding_mode, applies_to: rule.rounding_applies_to },
    mixed_class_rule: rule.mixed_class_rule,
    integration_status: billing.settings.fiscal.integration_status,
    currency_exponent: billing.jurisdiction.currency_exponent,
  };
}
