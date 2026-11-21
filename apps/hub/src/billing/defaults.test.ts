import { describe, expect, it } from 'vitest';
import { computeSplit } from '@pos/domain';
import { defaultBillingSettings, JURISDICTION_SEEDS, RATE_BP_TAX_CODE, type BranchConfig, type SnapshotBilling } from '@pos/events';
import { builtInBillingDefaults, computeRulesAt, hubBilling, MIN_EFFECTIVE_FROM, ruleInForce } from './defaults.js';

// 05 §4.5 row A-1 (5), H9-3, H10-4, H11-5: with no `billing` key in the snapshot the hub uses built-in rules equal
// to the `PK` seed for a PKR tenant and to the `none` seed otherwise, taken from the one shared seed constant; one
// cash mode; no service charge; thresholds 100 / 5 000 major units scaled by the currency exponent (A-1 (3)).
describe('built-in billing defaults', () => {
  it('[05 #14c defaults half] a PKR tenant gets the PK seed rules (step 100) and adapter none', () => {
    const d = builtInBillingDefaults({ currency_code: 'PKR', currency_exponent: 2 });
    expect(d.jurisdiction.jurisdiction_id).toBe('PK');
    expect(d.jurisdiction.adapter_key).toBe('none');
    expect(d.jurisdiction.currency_code).toBe('PKR');
    expect(d.jurisdiction.currency_exponent).toBe(2);
    expect(d.jurisdiction.rules).toEqual(JURISDICTION_SEEDS.PK);
    expect(d.jurisdiction.rules.rounding_step_minor).toBe(100);
  });

  it('[05 #14c defaults half] Pakistan thresholds: variance 10 000, petty cash 500 000 minor', () => {
    const d = builtInBillingDefaults({ currency_code: 'PKR', currency_exponent: 2 });
    expect(d.variance_threshold_minor).toBe(10_000);
    expect(d.petty_cash_limit_minor).toBe(500_000);
  });

  it.each([
    ['JPY', 0, 100, 5_000],
    ['AED', 2, 10_000, 500_000],
    ['KWD', 3, 100_000, 5_000_000],
  ] as const)(
    '[05 #14c defaults half] %s (exponent %i): none seed (no rounding), thresholds 100 / 5 000 major units',
    (currency_code, currency_exponent, variance, petty) => {
      const d = builtInBillingDefaults({ currency_code, currency_exponent });
      expect(d.jurisdiction.jurisdiction_id).toBe('none');
      expect(d.jurisdiction.adapter_key).toBe('none');
      // `none` has currency NULL = the tenant's currency
      expect(d.jurisdiction.currency_code).toBe(currency_code);
      expect(d.jurisdiction.currency_exponent).toBe(currency_exponent);
      expect(d.jurisdiction.rules).toEqual(JURISDICTION_SEEDS.none);
      expect(d.jurisdiction.rules.rounding_step_minor).toBeNull();
      expect(d.variance_threshold_minor).toBe(variance);
      expect(d.petty_cash_limit_minor).toBe(petty);
    },
  );

  it('[05 row A-1 (5)] one active cash mode of class cash, and no service charge on any order type', () => {
    for (const currency of [
      { currency_code: 'PKR', currency_exponent: 2 },
      { currency_code: 'USD', currency_exponent: 2 },
    ]) {
      const d = builtInBillingDefaults(currency);
      expect(d.payment_modes).toHaveLength(1);
      expect(d.payment_modes[0]).toMatchObject({ kind: 'cash', payment_class: 'cash', is_active: true });
      expect(d.service_charge_bp).toEqual({ dine_in: 0, takeaway: 0, parking: 0, delivery: 0 });
      expect(d.service_charge_tax_profile_id).toBeNull();
    }
  });

  it('[05 row A-1 H11-5] the rules are the seed constant itself, not a copy that can drift', () => {
    expect(builtInBillingDefaults({ currency_code: 'PKR', currency_exponent: 2 }).jurisdiction.rules).toBe(
      JURISDICTION_SEEDS.PK,
    );
    expect(builtInBillingDefaults({ currency_code: 'EUR', currency_exponent: 2 }).jurisdiction.rules).toBe(
      JURISDICTION_SEEDS.none,
    );
  });

  it('[05 row A-2 H16-10] no default carries pro_rata', () => {
    for (const currency_code of ['PKR', 'USD']) {
      expect(JSON.stringify(builtInBillingDefaults({ currency_code, currency_exponent: 2 }))).not.toContain('pro_rata');
    }
  });

  it('[05 row A-1 (5)] refuses an exponent that is not an integer 0 or more', () => {
    expect(() => builtInBillingDefaults({ currency_code: 'PKR', currency_exponent: -1 })).toThrow();
    expect(() => builtInBillingDefaults({ currency_code: 'PKR', currency_exponent: 2.5 })).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// P0.9b: the full built-in document (R-10, R-14, R-15) and the hub mapping snapshot → compute.ts inputs (G-23, G-3).
// ---------------------------------------------------------------------------------------------------------------

const TAX_CLASSES: BranchConfig['tax_classes'] = [
  { tax_class_id: 'tc-food', name: 'Food', rate_bp: 1600, is_archived: false },
  { tax_class_id: 'tc-old', name: 'Old', rate_bp: 500, is_archived: true },
];

function snapshotBilling(): SnapshotBilling {
  return {
    ...defaultBillingSettings({ currency_code: 'PKR', currency_exponent: 2 }),
    jurisdiction_id: 'PK-PB',
    jurisdiction: {
      jurisdiction_id: 'PK-PB',
      adapter_key: 'PRA',
      currency_code: 'PKR',
      currency_exponent: 2,
      rules: [
        {
          effective_from: '2000-01-01',
          prices_include_tax: false,
          rounding_step_minor: 100,
          rounding_mode: 'nearest',
          rounding_applies_to: 'all',
          mixed_class_rule: 'higher_rate',
          buyer_id: { threshold_minor: 5_000_000, accepted_types: [] },
          receipt: { fiscal_number_label: 'PRA invoice no.', tax_reg_labels: [{ code: 'NTN', label: 'NTN' }], show_qr: true, qr_url_template: null, buyer_id_on_receipt: true },
          catch_up_window_ms: 604_800_000,
          credit_support: 'credit_invoice',
          ref: 'eIMS Rules 2019',
        },
        {
          effective_from: '2026-12-01',
          prices_include_tax: true,
          rounding_step_minor: 500,
          rounding_mode: 'down',
          rounding_applies_to: 'cash',
          mixed_class_rule: 'higher_rate',
          buyer_id: { threshold_minor: 5_000_000, accepted_types: [] },
          receipt: { fiscal_number_label: null, tax_reg_labels: [], show_qr: false, qr_url_template: null, buyer_id_on_receipt: false },
          catch_up_window_ms: 604_800_000,
          credit_support: 'credit_invoice',
          ref: null,
        },
      ],
    },
    tax_profiles: [
      {
        tax_class_id: 'tc-food',
        taxes: [
          {
            seq: 1,
            tax_code: 'PST',
            label: 'Punjab sales tax on services',
            compound: false,
            rates: [
              { payment_class: 'digital', integration_status: 'integrated', effective_from: '2026-02-19', rate_bp: 500, ref: 'PRA.32-24/2026/1313' },
              { payment_class: 'cash', integration_status: 'integrated', effective_from: '2026-02-19', rate_bp: 1600, ref: 'PRA.32-24/2026/1313' },
            ],
          },
        ],
      },
    ],
  };
}

describe('[05 P0.9b] built-in defaults: the full document (R-10, R-14, R-15)', () => {
  it('[05 row A-1 (5) R-10 R-14] with no billing key the defaults carry the lists and the A-1 (3) values', () => {
    const d = builtInBillingDefaults({ currency_code: 'PKR', currency_exponent: 2 });
    expect(d.discount_reasons.map((r) => r.code)).toEqual(['regular_customer', 'staff', 'owner_guest', 'complaint', 'other']);
    expect(d.petty_categories.map((c) => c.category_id)).toEqual(['supplies', 'utilities', 'staff_advance', 'transport', 'other']);
    expect(d.receipt).toMatchObject({ invoice_prefix: '', header_lines: [], footer_lines: [] });
    expect(d.receipt.show).toEqual({ tax_reg_no: true, address: true, phone: true, cashier: true, order_no: true, bill_no: true });
    expect(d.max_discount_pct).toBe(100);
    expect(d.open_bill_flag_minutes).toBe(240);
    expect(d.fiscal.stuck_after_ms).toBe(1_800_000);
    expect(d.jurisdiction_id).toBe('PK');
  });

  it('[05 row A-1 (5)] the built-in document equals the cloud default document (one source)', () => {
    const d = builtInBillingDefaults({ currency_code: 'USD', currency_exponent: 2 });
    const doc: Partial<typeof d> = { ...d };
    delete doc.jurisdiction;
    expect(doc).toEqual(defaultBillingSettings({ currency_code: 'USD', currency_exponent: 2 }));
  });
});

describe('[05 P0.9b] hub mapping: snapshot → compute.ts inputs (G-23, G-3)', () => {
  it('[05 G-23] no billing key: one `none` rate row per class, payment class and integration status, minimum effective_from', () => {
    const b = hubBilling({ currency_code: 'PKR', tax_classes: TAX_CLASSES });
    expect(b.jurisdiction).toMatchObject({ jurisdiction_id: 'PK', adapter_key: 'none', currency_code: 'PKR', currency_exponent: 2 });
    expect(b.tax_profiles.map((p) => p.tax_profile_id)).toEqual(['tc-food', 'tc-old']);
    const food = b.tax_profiles[0]!;
    expect(food.taxes).toHaveLength(1);
    expect(food.taxes[0]).toMatchObject({ seq: 1, tax_code: RATE_BP_TAX_CODE, label: 'Food', compound: false });
    expect(food.taxes[0]!.rates).toEqual(
      (['cash', 'digital'] as const).flatMap((payment_class) =>
        (['integrated', 'not_integrated'] as const).map((integration_status) => ({
          payment_class,
          integration_status,
          effective_from: MIN_EFFECTIVE_FROM,
          rate_bp: 1600,
          ref: null,
        })),
      ),
    );
    expect(b.jurisdiction.rules).toHaveLength(1);
    expect(b.jurisdiction.rules[0]!.effective_from).toBe(MIN_EFFECTIVE_FROM);
  });

  it('[05 G-3] no billing key: the seed’s null receipt_fiscal maps to receipt with a null label and empty lists', () => {
    expect(hubBilling({ currency_code: 'EUR', tax_classes: [] }).jurisdiction.rules[0]!.receipt).toEqual({
      fiscal_number_label: null,
      tax_reg_labels: [],
      show_qr: false,
      qr_url_template: null,
      buyer_id_on_receipt: false,
    });
  });

  it('[05 #14c] no billing key: PKR rounds to 100 (PK), another currency does not round (none)', () => {
    const pk = hubBilling({ currency_code: 'PKR', tax_classes: [] });
    expect(computeRulesAt(pk, { business_date: '2026-11-19', tax_enabled: true })?.rounding.step_minor).toBe(100);
    const kwd = hubBilling({ currency_code: 'KWD', tax_classes: [] });
    expect(kwd.jurisdiction.currency_exponent).toBe(3);
    expect(computeRulesAt(kwd, { business_date: '2026-11-19', tax_enabled: true })?.rounding.step_minor).toBeNull();
  });

  it('[05 G-23] with a billing key: tax_class_id is renamed tax_profile_id and the taxes are copied', () => {
    const b = hubBilling({ currency_code: 'PKR', tax_classes: TAX_CLASSES, billing: snapshotBilling() });
    expect(b.tax_profiles).toEqual([
      { tax_profile_id: 'tc-food', taxes: snapshotBilling().tax_profiles[0]!.taxes },
    ]);
    expect(b.tax_profiles[0]).not.toHaveProperty('tax_class_id');
    expect(b.jurisdiction.adapter_key).toBe('PRA');
    expect(b.settings.jurisdiction_id).toBe('PK-PB');
    expect(b.settings).not.toHaveProperty('tax_profiles');
  });

  it('[05 #14b] a jurisdiction_rules row effective tomorrow is not used today; on its date it is', () => {
    const b = hubBilling({ currency_code: 'PKR', tax_classes: TAX_CLASSES, billing: snapshotBilling() });
    const today = computeRulesAt(b, { business_date: '2026-11-30', tax_enabled: true });
    expect(today).toEqual({
      tax_enabled: true,
      prices_include_tax: false,
      rounding: { step_minor: 100, mode: 'nearest', applies_to: 'all' },
      mixed_class_rule: 'higher_rate',
      integration_status: 'integrated',
      currency_exponent: 2,
    });
    expect(ruleInForce(b, '2026-11-30')?.ref).toBe('eIMS Rules 2019');
    const then = computeRulesAt(b, { business_date: '2026-12-01', tax_enabled: false });
    expect(then).toMatchObject({ tax_enabled: false, prices_include_tax: true, rounding: { step_minor: 500, mode: 'down', applies_to: 'cash' } });
  });

  it('[05 #14b] no rule row in force on the date → null (the caller blocks)', () => {
    const b = hubBilling({ currency_code: 'PKR', tax_classes: [], billing: snapshotBilling() });
    expect(computeRulesAt(b, { business_date: '1999-12-31', tax_enabled: true })).toBeNull();
  });

  it('[05 #14] the mapped profiles feed computeSplit: digital 5 %, cash 16 % on PK-PB', () => {
    const b = hubBilling({ currency_code: 'PKR', tax_classes: TAX_CLASSES, billing: snapshotBilling() });
    const rules = computeRulesAt(b, { business_date: '2026-11-19', tax_enabled: true })!;
    const line = { order_item_id: 'oi-1', line_kind: 'item' as const, units: 1, unit_price_minor: 100_000, base_minor: 100_000, discount_minor: 0, tax_profile_id: 'tc-food' };
    const split = computeSplit({
      split_no: 1,
      business_date: '2026-11-19',
      rules,
      tax_profiles: b.tax_profiles,
      lines: [line],
      service_charge: null,
      payments: [],
    });
    const at = (k: 'cash' | 'digital') => split.totals[k].taxes.reduce((sum, t) => sum + t.tax_minor, 0);
    expect(at('digital')).toBe(5_000);
    expect(at('cash')).toBe(16_000);
  });

  it('[05 row A-1 (5)] the result has no pro_rata anywhere', () => {
    expect(JSON.stringify(hubBilling({ currency_code: 'PKR', tax_classes: TAX_CLASSES }))).not.toContain('pro_rata');
  });
});
