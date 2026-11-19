// Test-only fixtures for 05 §3.4–§3.8 (compute.test.ts, compute.property.test.ts): jurisdiction rules shaped like the
// seeds of row A-1 (none, PK, PK-PB), test-only multi-tax and exponent-0 / -3 jurisdictions, and the Pakistan
// regression values from v0.6.2 (§6.31 and the named cases still in force in v1.0). Never imported by product code.
import type { ComputeLine, ComputeRules, ComputeTaxProfile, ComputeTaxRate } from './compute.js';

export const TODAY = '2026-11-19';

const BOTH_STATUSES = ['integrated', 'not_integrated'] as const;

/** Rate rows for one tax: the same rates under both integration statuses, effective from `from`. */
export function rates(cash_bp: number, digital_bp: number, from = '2026-01-01', ref: string | null = null): ComputeTaxRate[] {
  return BOTH_STATUSES.flatMap((integration_status) => [
    { payment_class: 'cash' as const, integration_status, effective_from: from, rate_bp: cash_bp, ref },
    { payment_class: 'digital' as const, integration_status, effective_from: from, rate_bp: digital_bp, ref },
  ]);
}

/** Jurisdiction `none` / `PK` (§3.4): one tax 'TAX' labelled with the tax class name at its rate_bp, both classes. */
export function rateBpProfile(tax_profile_id: string, label: string, rate_bp: number): ComputeTaxProfile {
  return { tax_profile_id, taxes: [{ seq: 1, tax_code: 'TAX', label, compound: false, rates: rates(rate_bp, rate_bp) }] };
}

/** `PK-PB` restaurant_service (row A-1 (2)): PST, cash 1600 bp, digital 500 bp, PRA.32-24/2026/1313 from 2026-02-19. */
export function pkPbProfile(tax_profile_id = 'restaurant'): ComputeTaxProfile {
  return {
    tax_profile_id,
    taxes: [
      {
        seq: 1,
        tax_code: 'PST',
        label: 'Punjab sales tax on services',
        compound: false,
        rates: rates(1600, 500, '2026-02-19', 'PRA.32-24/2026/1313'),
      },
    ],
  };
}

/** Test-only stacked pair (#11b): a federal + provincial shape. */
export function stackedProfile(tax_profile_id: string, first_bp: number, second_bp: number, compound: boolean): ComputeTaxProfile {
  return {
    tax_profile_id,
    taxes: [
      { seq: 1, tax_code: 'FED', label: 'Federal tax', compound: false, rates: rates(first_bp, first_bp) },
      { seq: 2, tax_code: 'PROV', label: 'Provincial tax', compound, rates: rates(second_bp, second_bp) },
    ],
  };
}

const RULES_BASE = {
  tax_enabled: true,
  prices_include_tax: false,
  mixed_class_rule: 'higher_rate' as const,
  integration_status: 'integrated' as const,
};

/** Seed `none`: exclusive, step NULL = no rounding, nearest, all (row A-1 (2), H9-3). */
export function noneRules(currency_exponent = 2): ComputeRules {
  return { ...RULES_BASE, currency_exponent, rounding: { step_minor: null, mode: 'nearest', applies_to: 'all' } };
}

/** Seed `PK`: as `none` but step 100 (Rs 1) — v0.6.2's adapter-`none` behaviour. */
export const PK_RULES: ComputeRules = {
  ...RULES_BASE,
  currency_exponent: 2,
  rounding: { step_minor: 100, mode: 'nearest', applies_to: 'all' },
};

/** Seed `PK-PB` rules: exclusive, 100, nearest, all, higher_rate. */
export const PK_PB_RULES: ComputeRules = PK_RULES;

/** A test-only cash-rounding jurisdiction (applies_to 'cash', step 5 minor units). */
export function cashStepRules(overrides: Partial<ComputeRules> = {}): ComputeRules {
  return {
    ...RULES_BASE,
    currency_exponent: 2,
    rounding: { step_minor: 5, mode: 'nearest', applies_to: 'cash' },
    ...overrides,
  };
}

export function line(order_item_id: string, base_minor: number, tax_profile_id: string | null, extra: Partial<ComputeLine> = {}): ComputeLine {
  return {
    order_item_id,
    line_kind: 'item',
    units: 1,
    unit_price_minor: base_minor,
    base_minor,
    tax_profile_id,
    ...extra,
  };
}

/**
 * Pakistan regression (#11): v0.6.2 §6.31, Table 7, Rs 5,710 of food (one profile, one tax). Values in paisa.
 * v0.6.2's §3.6 worked examples were `pro_rata` cases (declared class shares); `pro_rata` is out of v1.0 (§26), so
 * the regression keeps §6.31 (check bill, all card, `higher_rate` mixed) and the named v1.0 cases built on it.
 */
export const PK_REGRESSION = {
  net_minor: 571_000,
  // PK-PB (PRA rates): cash 16 %, digital 5 %, rounding Rs 1 nearest, all.
  pk_pb: {
    cash: { tax_minor: 91_360, exact_total_minor: 662_360, rounding_minor: 40, total_minor: 662_400 },
    digital: { tax_minor: 28_550, exact_total_minor: 599_550, rounding_minor: 50, total_minor: 599_600 },
    mixed_card_then_cash: { card_minor: 300_000, cash_minor: 362_400, total_minor: 662_400 },
  },
  // v0.6.2 adapter `none` (v1.0 seed `PK`): one tax at the tax class rate_bp (1 600) for both classes, Rs 1 rounding.
  pk_rate_bp_1600: {
    cash: { tax_minor: 91_360, exact_total_minor: 662_360, rounding_minor: 40, total_minor: 662_400 },
    digital: { tax_minor: 91_360, exact_total_minor: 662_360, rounding_minor: 40, total_minor: 662_400 },
  },
} as const;
