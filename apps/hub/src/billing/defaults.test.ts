import { describe, expect, it } from 'vitest';
import { JURISDICTION_SEEDS } from '@pos/events';
import { builtInBillingDefaults } from './defaults.js';

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
