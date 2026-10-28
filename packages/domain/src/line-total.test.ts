import { describe, expect, it } from 'vitest';
import * as root from './index';
import { DEFAULT_DAY_MIN_GAP_HOURS, DEFAULT_DAY_STALE_AFTER_HOURS, lineTotalMinor } from './line-total';

describe('line total', () => {
  it('[01a §10 #150] lineTotalMinor: pieces exact; g / ml rounded half-up to the whole rupee per line, integer arithmetic', () => {
    expect(lineTotalMinor(120000, 2, 'piece')).toBe(240000);
    expect(lineTotalMinor(220000, 1250, 'g')).toBe(275000);
    expect(lineTotalMinor(145550, 1, 'g')).toBe(100);
    expect(lineTotalMinor(150000, 1, 'g')).toBe(200);
    expect(lineTotalMinor(149000, 1, 'g')).toBe(100);
    expect(lineTotalMinor(240000, 1500, 'g')).toBe(360000);
    expect(lineTotalMinor(99, 250, 'ml')).toBe(0);
    expect(lineTotalMinor(99999, 1500, 'ml')).toBe(150000);
    expect(lineTotalMinor(1_000_000_000, 1_000_000, 'g')).toBe(1_000_000_000_000);
    expect(lineTotalMinor(1_000_000_000, 1_000_000, 'piece')).toBe(1_000_000_000_000_000);
    expect(lineTotalMinor(999_999_999, 999_999, 'ml')).toBe(999_998_999_000);
    expect(() => lineTotalMinor(1.5, 1, 'piece')).toThrow();
    expect(() => lineTotalMinor(100, 0.5, 'g')).toThrow();
    expect(() => lineTotalMinor(-1, 1, 'piece')).toThrow();
  });

  it('[01a §4.2, §10 #150] products above 2^53 still round exactly; a float version would not', () => {
    // 8998201150999 × 1001 = …352149999 (just under the half): BigInt gives …352100; floats see …352150000 and give …352200.
    expect(lineTotalMinor(8_998_201_150_999, 1001, 'g')).toBe(9_007_199_352_100);
    expect(Math.floor((8_998_201_150_999 * 1001) / 100000 + 0.5) * 100).not.toBe(9_007_199_352_100);
  });

  it('[01a §4.2] a total above Number.MAX_SAFE_INTEGER throws instead of losing precision', () => {
    expect(() => lineTotalMinor(1_000_000_000, 10_000_000, 'piece')).toThrow('lineTotalMinor: total is not a safe integer');
    expect(() => lineTotalMinor(9_007_199_254_740_991, 2000, 'g')).toThrow('lineTotalMinor: total is not a safe integer');
    expect(lineTotalMinor(9_007_199_254_740_991, 1, 'piece')).toBe(9_007_199_254_740_991);
  });

  it('[01a S33] day-setting defaults are 16 and 4', () => {
    expect(DEFAULT_DAY_STALE_AFTER_HOURS).toBe(16);
    expect(DEFAULT_DAY_MIN_GAP_HOURS).toBe(4);
    expect(root.DEFAULT_DAY_STALE_AFTER_HOURS).toBe(16);
    expect(root.DEFAULT_DAY_MIN_GAP_HOURS).toBe(4);
    expect(root.lineTotalMinor).toBe(lineTotalMinor);
  });
});
