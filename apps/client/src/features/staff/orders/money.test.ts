import { afterEach, describe, expect, it } from 'vitest';
import { allocateDealMinor } from '@pos/domain';
import { setLanguage } from '../../../i18n';
import { MONEY_DIR, money, nextShareMinor } from './money';

afterEach(() => setLanguage('en'));

const line = (refundable_minor: number, units: number, out: { comped?: number; removed?: number; voided?: number } = {}) => ({
  refundable_minor,
  units,
  comped_units: out.comped ?? 0,
  removed_units: out.removed ?? 0,
  voided_units: out.voided ?? 0,
});

describe('[02b §8 Rules] money', () => {
  it('[02b §8 Rules] money(320000) = "Rs 3,200" LTR in both languages', () => {
    setLanguage('en');
    expect(money(320000)).toBe('Rs 3,200');
    setLanguage('ur');
    expect(money(320000)).toBe('Rs 3,200');
    expect(MONEY_DIR).toBe('ltr');
    expect(money(220000)).toBe('Rs 2,200');
    expect(money(123456789)).toBe('Rs 1,234,567.89');
    expect(money(1250)).toBe('Rs 12.50');
    expect(money(0)).toBe('Rs 0');
    expect(money(-20000)).toBe('-Rs 200');
    // Latin digits only
    expect(money(987654321)).toMatch(/^Rs [0-9,.]+$/);
    expect(() => money(1.5)).toThrow();
  });
});

describe('[02b §3.4] share rule', () => {
  it('[02b §3.4] shares are floor(refundable / units), the last one takes the remainder; units leave in order', () => {
    // Rs 100.00 over 3 units: 3333, 3333, 3334
    expect(nextShareMinor(line(10000, 3), 1)).toBe(3333);
    expect(nextShareMinor(line(10000, 3), 3)).toBe(10000);
    expect(nextShareMinor(line(10000, 3, { comped: 2 }), 1)).toBe(3334);
    expect(nextShareMinor(line(10000, 3, { comped: 1, removed: 1 }), 1)).toBe(3334);
    expect(nextShareMinor(line(10000, 3, { voided: 1 }), 2)).toBe(6667);
    // the same split as @pos/domain allocateDealMinor (the hub's lineShares)
    const shares = allocateDealMinor(10001, [1, 1, 1, 1]);
    expect(nextShareMinor(line(10001, 4, { comped: 1 }), 3)).toBe(shares[1]! + shares[2]! + shares[3]!);
    // a pending weight: units 1, refundable 0
    expect(nextShareMinor(line(0, 1), 1)).toBe(0);
  });

  it('[02b §3.4] more units than are free, or a bad count → null', () => {
    expect(nextShareMinor(line(10000, 3, { comped: 2 }), 2)).toBeNull();
    expect(nextShareMinor(line(10000, 3), -1)).toBeNull();
    expect(nextShareMinor(line(10000, 0), 0)).toBeNull();
    expect(nextShareMinor(line(10000, 2), 0)).toBe(0);
  });
});
