import { JURISDICTION_SEEDS, type BillingSettings, type JurisdictionRuleValues } from '@pos/events';

// 05 §4.5 row A-1 (5), H9-3, H10-4, H11-5: the hub's built-in billing rules when the snapshot has no `billing` key —
// the `PK` seed for a PKR tenant, the `none` seed otherwise, both taken from the shared seed constant
// (@pos/events admin/jurisdiction-seeds.ts); one cash mode; no service charge; the variance / petty-cash defaults of
// A-1 (3) (100 / 5 000 major units, Pakistan 10 000 / 500 000 minor). The caller passes the tenant's currency and its
// exponent (`currencyExponent`, row F-6); mapping tax classes to one tax at `rate_bp` is the snapshot mapper's (0b).

const VARIANCE_THRESHOLD_MAJOR = 100;
const PETTY_CASH_LIMIT_MAJOR = 5_000;

export interface BuiltInBillingDefaults {
  jurisdiction: {
    jurisdiction_id: string;
    adapter_key: string;
    currency_code: string;
    currency_exponent: number;
    rules: JurisdictionRuleValues;
  };
  payment_modes: BillingSettings['payment_modes'];
  service_charge_bp: BillingSettings['service_charge_bp'];
  service_charge_tax_profile_id: null;
  variance_threshold_minor: number;
  petty_cash_limit_minor: number;
}

export function builtInBillingDefaults(tenant: { currency_code: string; currency_exponent: number }): BuiltInBillingDefaults {
  const { currency_code, currency_exponent } = tenant;
  if (!Number.isInteger(currency_exponent) || currency_exponent < 0) {
    throw new RangeError(`invalid currency exponent ${currency_exponent}`);
  }
  const rules = currency_code === 'PKR' ? JURISDICTION_SEEDS.PK : JURISDICTION_SEEDS.none;
  const major = 10 ** currency_exponent;
  return {
    jurisdiction: {
      jurisdiction_id: rules.jurisdiction_id,
      adapter_key: rules.adapter_key,
      // `none` has no currency of its own: it is the tenant's
      currency_code: rules.currency_code ?? currency_code,
      currency_exponent,
      rules,
    },
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
    variance_threshold_minor: VARIANCE_THRESHOLD_MAJOR * major,
    petty_cash_limit_minor: PETTY_CASH_LIMIT_MAJOR * major,
  };
}
