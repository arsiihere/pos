import { describe, expect, it } from 'vitest';
import * as root from './index';
import { DEFAULT_DAY_MIN_GAP_HOURS, DEFAULT_DAY_STALE_AFTER_HOURS, lineTotalMinor } from './line-total';

describe('line total', () => {
  it('[01a §10 #150] lineTotalMinor rounds half-up per line with integer arithmetic', () => {
    expect(lineTotalMinor(120000, 2, 'piece')).toBe(240000);
    expect(lineTotalMinor(145550, 1, 'g')).toBe(146);
    expect(lineTotalMinor(145500, 1, 'g')).toBe(146);
    expect(lineTotalMinor(145400, 1, 'g')).toBe(145);
    expect(lineTotalMinor(240000, 1500, 'g')).toBe(360000);
    expect(lineTotalMinor(99, 250, 'ml')).toBe(25);
    expect(lineTotalMinor(1_000_000_000, 1_000_000, 'g')).toBe(1_000_000_000_000);
    expect(lineTotalMinor(1_000_000_000, 1_000_000, 'piece')).toBe(1_000_000_000_000_000);
    expect(lineTotalMinor(999_999_999, 999_999, 'ml')).toBe(999_998_999_000);
    expect(() => lineTotalMinor(1.5, 1, 'piece')).toThrow();
    expect(() => lineTotalMinor(100, 0.5, 'g')).toThrow();
    expect(() => lineTotalMinor(-1, 1, 'piece')).toThrow();
  });

  it('[01a S33] day-setting defaults are 16 and 4', () => {
    expect(DEFAULT_DAY_STALE_AFTER_HOURS).toBe(16);
    expect(DEFAULT_DAY_MIN_GAP_HOURS).toBe(4);
    expect(root.DEFAULT_DAY_STALE_AFTER_HOURS).toBe(16);
    expect(root.DEFAULT_DAY_MIN_GAP_HOURS).toBe(4);
    expect(root.lineTotalMinor).toBe(lineTotalMinor);
  });
});
