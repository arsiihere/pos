import { describe, expect, it } from 'vitest';
import * as root from '../index';
import { activeYield, yieldBpFromTest, type YieldRow } from './yield';

describe('08a inventory yield', () => {
  it('[08a #5] yieldBpFromTest: half up; out of range throws', () => {
    expect(yieldBpFromTest(10_000, 7_120)).toBe(7_120);
    expect(yieldBpFromTest(3, 2)).toBe(6_667);
    expect(yieldBpFromTest(1_000, 2_400)).toBe(24_000);
    expect(yieldBpFromTest(20_000, 1)).toBe(1); // 0.5 bp → 1 (half up)
    expect(yieldBpFromTest(1_000, 5_000)).toBe(50_000);
    expect(() => yieldBpFromTest(1_000, 6_000)).toThrow(RangeError); // 60 000 > 50 000
    expect(() => yieldBpFromTest(30_000, 1)).toThrow(RangeError); // 0.33 bp → 0
    expect(() => yieldBpFromTest(0, 1)).toThrow(RangeError);
    expect(() => yieldBpFromTest(1.5, 1)).toThrow(RangeError);
    expect(() => yieldBpFromTest(1_000_000_000, 1_000_000_000)).not.toThrow();
    expect(root.yieldBpFromTest).toBe(yieldBpFromTest);
  });

  it('[08a #5] activeYield: the latest row (created_at, then id); none → null', () => {
    const y = (id: string, bp: number, at: number): YieldRow => ({ yield_profile_id: id, yield_bp: bp, created_at: at });
    expect(activeYield([])).toBeNull();
    const rows = [y('a', 7000, 1), y('c', 7100, 2), y('b', 7200, 2)];
    expect(activeYield(rows)).toBe(rows[1]);
  });
});
