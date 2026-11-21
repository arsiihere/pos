import { describe, expect, it } from 'vitest';
import { MIXED_CLASS_RULES } from '@pos/domain';
import { JURISDICTION_SEEDS } from './jurisdiction-seeds.js';

// 05 §4.5 row A-1 (2), H9-3, H11-5: one constant holds the `none` and `PK` rule values; the 0014 seed (P0.9b)
// and apps/hub/src/billing/defaults.ts both read it.
describe('jurisdiction seeds', () => {
  it('[05 #14c seed half] none: adapter none, tenant currency, exclusive, no rounding, nearest, all, higher_rate', () => {
    expect(JURISDICTION_SEEDS.none).toEqual({
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
    });
  });

  it('[05 #14c seed half] PK: the none rules with step 100, adapter none, PKR', () => {
    expect(JURISDICTION_SEEDS.PK).toEqual({
      ...JURISDICTION_SEEDS.none,
      jurisdiction_id: 'PK',
      currency_code: 'PKR',
      rounding_step_minor: 100,
    });
    expect(JURISDICTION_SEEDS.PK.adapter_key).toBe('none');
  });

  it('[05 row A-2 H16-10] no seed carries pro_rata; every mixed_class_rule is a MIXED_CLASS_RULES value', () => {
    expect(JSON.stringify(JURISDICTION_SEEDS)).not.toContain('pro_rata');
    for (const seed of Object.values(JURISDICTION_SEEDS)) {
      expect(MIXED_CLASS_RULES).toContain(seed.mixed_class_rule);
    }
  });

  it('[05 row A-1 (2)] holds only the none and PK seeds', () => {
    expect(Object.keys(JURISDICTION_SEEDS).sort()).toEqual(['PK', 'none']);
  });

  it('[05 row A-1 H11-5] is frozen, so a reader cannot change the shared values', () => {
    expect(Object.isFrozen(JURISDICTION_SEEDS)).toBe(true);
    expect(Object.isFrozen(JURISDICTION_SEEDS.PK)).toBe(true);
    expect(Object.isFrozen(JURISDICTION_SEEDS.PK.buyer_id)).toBe(true);
    expect(Object.isFrozen(JURISDICTION_SEEDS.PK.buyer_id.accepted_types)).toBe(true);
  });
});
