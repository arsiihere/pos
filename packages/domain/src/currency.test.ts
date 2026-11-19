import { describe, expect, it } from 'vitest';
import { currencyExponent, ISO_4217_CODES, UnknownCurrencyError } from './currency.js';

const EXPONENT_0 = ['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];
const EXPONENT_3 = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];
const EXPONENT_4 = ['CLF', 'UYW'];

describe('currencyExponent (05 row F-6)', () => {
  it('[05 #14c exponent half] PKR has exponent 2', () => {
    expect(currencyExponent('PKR')).toBe(2);
  });

  it('[05 #14c exponent half] exponent-0, -2 and -3 fixture currencies', () => {
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KRW')).toBe(0);
    expect(currencyExponent('USD')).toBe(2);
    expect(currencyExponent('EUR')).toBe(2);
    expect(currencyExponent('KWD')).toBe(3);
    expect(currencyExponent('BHD')).toBe(3);
  });

  it('[05 #14c exponent half] golden table: every non-2 code pinned, every other code is 2', () => {
    for (const c of EXPONENT_0) expect(currencyExponent(c), c).toBe(0);
    for (const c of EXPONENT_3) expect(currencyExponent(c), c).toBe(3);
    for (const c of EXPONENT_4) expect(currencyExponent(c), c).toBe(4);
    const special = new Set([...EXPONENT_0, ...EXPONENT_3, ...EXPONENT_4]);
    const twos = ISO_4217_CODES.filter((c) => !special.has(c));
    for (const c of twos) expect(currencyExponent(c), c).toBe(2);
    expect(ISO_4217_CODES.length).toBe(164);
    expect(twos.length).toBe(164 - special.size);
    for (const c of ISO_4217_CODES) expect(c).toMatch(/^[A-Z]{3}$/);
  });

  it('[05 #14c exponent half] an unknown code is refused with a typed error', () => {
    // PKX passes the cloud's ^[A-Z]{3}$ check but is not ISO 4217 (row H-5).
    const refused = [
      'PKX', 'pkr', 'PK', 'PKRR', '', ' PKR', 'PKR ', 'PKR\n',
      'XAU', 'XAG', 'XDR', 'XTS', 'XXX', // minor unit N.A.
      'BGN', 'HRK', 'ZWL', 'SLL', 'ANG', 'VEF', 'MRO', 'STD', 'CUC', // withdrawn
      'toString', '__proto__', 'constructor', 'hasOwnProperty',
    ];
    for (const code of refused) {
      expect(() => currencyExponent(code), JSON.stringify(code)).toThrow(UnknownCurrencyError);
    }
  });

  it('[05 #14c exponent half] the error carries the refused code (at most 8 characters) and a stable code', () => {
    try {
      currencyExponent('PKX');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(UnknownCurrencyError);
      expect(e).toBeInstanceOf(Error);
      const err = e as UnknownCurrencyError;
      expect(err.code).toBe('unknown_currency');
      expect(err.currency_code).toBe('PKX');
      expect(err.name).toBe('UnknownCurrencyError');
    }
    const long = 'A'.repeat(500);
    try {
      currencyExponent(long);
      expect.unreachable();
    } catch (e) {
      const err = e as UnknownCurrencyError;
      expect(err.currency_code).toBe('AAAAAAAA');
      expect(err.message.length).toBeLessThan(80);
    }
  });
});
