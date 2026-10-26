import { describe, expect, it } from 'vitest';
import { formatRupees, parseRupees } from './money';

describe('owner money', () => {
  it('[01a §10 #74] rupees typed with commas become paisa; other input is rejected', () => {
    expect(parseRupees('1,200')).toEqual({ ok: true, value: 120000 });
    expect(parseRupees(' 1,200 ')).toEqual({ ok: true, value: 120000 });
    expect(parseRupees('1,20,000')).toEqual({ ok: true, value: 12000000 });
    expect(parseRupees('1,2,3')).toEqual({ ok: true, value: 12300 });
    expect(parseRupees('1200.5')).toEqual({ ok: true, value: 120050 });
    for (const bad of ['1.234', '-1', 'abc', '١٢٠٠']) expect(parseRupees(bad)).toEqual({ ok: false });
  });

  it('[01a §8.1] "Rs 1,200" and "₨1200" are rejected', () => {
    expect(parseRupees('Rs 1,200')).toEqual({ ok: false });
    expect(parseRupees('₨1200')).toEqual({ ok: false });
    expect(parseRupees('')).toEqual({ ok: false });
    expect(parseRupees('.5')).toEqual({ ok: false });
    expect(parseRupees('12.')).toEqual({ ok: false });
  });

  it('[01a §8.1] formatRupees shows paisa as rupees that parse back', () => {
    expect(formatRupees(120000)).toBe('1200');
    expect(formatRupees(120050)).toBe('1200.50');
    expect(formatRupees(5)).toBe('0.05');
    for (const minor of [0, 5, 120050, 12000000]) {
      expect(parseRupees(formatRupees(minor))).toEqual({ ok: true, value: minor });
    }
  });
});

describe('[01a S05] shown prices', () => {
  it('group thousands for display; decimals kept', async () => {
    const { shownRupees } = await import('./money');
    expect(shownRupees(220_000)).toBe('2,200');
    expect(shownRupees(3_000)).toBe('30');
    expect(shownRupees(12_000_050)).toBe('120,000.50');
  });
});
