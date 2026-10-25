import { describe, expect, it } from 'vitest';
import * as root from './index';
import { formatQuantity, parseQuantity } from './units';

describe('units', () => {
  it('[01a §10 #141] parseQuantity and formatQuantity', () => {
    expect(parseQuantity('1.5', 'g')).toEqual({ ok: true, value: 1500 });
    expect(parseQuantity('0.25', 'ml')).toEqual({ ok: true, value: 250 });
    expect(parseQuantity('2', 'piece')).toEqual({ ok: true, value: 2 });
    expect(parseQuantity('1.2345', 'g')).toEqual({ ok: false });
    expect(parseQuantity('-1', 'g')).toEqual({ ok: false });
    expect(parseQuantity('-1', 'piece')).toEqual({ ok: false });
    expect(parseQuantity('1.5', 'piece')).toEqual({ ok: false });
    expect(parseQuantity('abc', 'g')).toEqual({ ok: false });
    expect(parseQuantity('abc', 'piece')).toEqual({ ok: false });
    expect(parseQuantity('١', 'piece')).toEqual({ ok: false });
    expect(parseQuantity('١', 'g')).toEqual({ ok: false });
    expect(formatQuantity(1500, 'g')).toBe('1.5 kg');
    expect(formatQuantity(250, 'ml')).toBe('0.25 L');
    expect(formatQuantity(3, 'piece')).toBe('3');
  });

  it('[01a S44] "1.5kg" and "1,5" are rejected', () => {
    expect(parseQuantity('1.5kg', 'g')).toEqual({ ok: false });
    expect(parseQuantity('1,5', 'g')).toEqual({ ok: false });
    expect(parseQuantity('1,5', 'piece')).toEqual({ ok: false });
    expect(parseQuantity('', 'g')).toEqual({ ok: false });
    expect(parseQuantity('  2  ', 'piece')).toEqual({ ok: true, value: 2 });
    expect(parseQuantity(' 0.005 ', 'g')).toEqual({ ok: true, value: 5 });
  });

  it('[01a S44] exported from the @pos/domain root', () => {
    expect(root.parseQuantity).toBe(parseQuantity);
    expect(root.formatQuantity).toBe(formatQuantity);
  });
});
