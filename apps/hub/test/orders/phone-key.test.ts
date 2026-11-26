import { describe, expect, it } from 'vitest';
import { phoneKey } from '../../src/orders/phone-key';

// 02b v1.0.25 §3.1 Phone key (R1; run 1 m-2), test 64: one canonical key per stored phone (the typed digits only).
describe('[02b v1.0.25 §3.1, #64] phoneKey', () => {
  it('the §3.1 table', () => {
    const table: Array<[string, string]> = [
      ['03001234567', '923001234567'], // 0300 1234567, 0300-1234567 (rule 2)
      ['923001234567', '923001234567'], // 923001234567, +92 300 1234567 (rule 3)
      ['04235761234', '924235761234'], // a landline, 0 + 10 (rule 2)
      ['3001234567', '923001234567'], // 10 digits without the 0 (rule 3b)
      ['9203001234567', '923001234567'], // +92 0300 1234567 (rule 3a)
      ['442079460958', '442079460958'], // +44 20 7946 0958 (rule 4)
    ];
    for (const [d, key] of table) expect(phoneKey(d), d).toBe(key);
  });

  it('rule 1: only the digits count; anything else is unchanged (rule 4)', () => {
    expect(phoneKey('0300-123 4567')).toBe('923001234567');
    expect(phoneKey('+92 300 1234567')).toBe('923001234567');
    for (const d of ['1234567890', '93001234567', '0300123456', '92300123456']) expect(phoneKey(d), d).toBe(d);
  });
});
