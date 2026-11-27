import { describe, expect, it } from 'vitest';
import { groupedTyped, quickNotes } from './PayPanel';

// ⚠️ 02b-TK L-CLIENT-6b item 6 (frames PayCash, PayCashShort): quick cash notes that fit the amount, and the typed
// amount shown with thousands separators.

describe('[02b-TK L-CLIENT-6b item 6] pay panel cash', () => {
  it('[frame PayCash; QA] the notes round the due up: Rs 80 → 100 / 500 / 1,000; Rs 3,650 → 4,000 / 5,000 / 10,000', () => {
    expect(quickNotes(80)).toEqual([100, 500, 1_000]);
    expect(quickNotes(3_650)).toEqual([4_000, 5_000, 10_000]);
    expect(quickNotes(1_190)).toEqual([1_500, 2_000, 5_000]);
    // an exact note is Exact, not a quick note
    expect(quickNotes(500)).toEqual([1_000, 5_000, 10_000]);
    expect(quickNotes(10_000)).toEqual([]);
  });

  it('[QA "typed amount formatted"] 5000 shows as 5,000; decimals stay as typed', () => {
    expect(groupedTyped('5000')).toBe('5,000');
    expect(groupedTyped('12500.5')).toBe('12,500.5');
    expect(groupedTyped('')).toBe('');
    expect(groupedTyped('007')).toBe('7');
  });
});
