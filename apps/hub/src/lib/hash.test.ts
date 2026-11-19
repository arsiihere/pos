import { describe, expect, it } from 'vitest';
import { payloadHash } from './hash';

describe('hash', () => {
  it('[00 §3.7] payloadHash ignores key order (Review Focus 4)', () => {
    const left = { a: 1, b: { d: 2, c: 3 } };
    const right = { b: { c: 3, d: 2 }, a: 1 };
    expect(payloadHash(left)).toBe(payloadHash(right));
    expect(payloadHash({ a: 2, b: { d: 2, c: 3 } })).not.toBe(payloadHash(left));
  });

  it('[00 H-9] payloadHash with omit drops the named field before hashing', () => {
    expect(payloadHash({ a: 1, pin: '4711' }, 'pin')).toBe(payloadHash({ a: 1 }));
    expect(payloadHash({ a: 1, pin: '4711' }, 'pin')).not.toBe(payloadHash({ a: 1, pin: '4711' }));
  });

  it('[00 H-9] payloadHash without omit, or with an absent field, is unchanged', () => {
    const payload = { a: 1, b: { d: 2, c: 3 } };
    expect(payloadHash(payload, undefined)).toBe(payloadHash(payload));
    expect(payloadHash(payload, 'pin')).toBe(payloadHash(payload));
  });

  // 00 v1.12 §3.7 (⚠️ Changed by 05 (row H-4)); 05 v1.0.5 §4.5 row H-4; 05-plan §2B.4 P0.4b.
  it('[05 row H-4] dotted paths drop only the named nested field before hashing', () => {
    const payload = { split_id: 's1', buyer: { name: 'N-1', tax_id: { type: 'CNIC', value: 'V-1' } } };
    const hashed = payloadHash(payload, ['buyer.name', 'buyer.tax_id.value']);
    expect(hashed).toBe(payloadHash({ split_id: 's1', buyer: { tax_id: { type: 'CNIC' } } }));
    // a change only in an omitted field is the same hash; a change in a kept sibling is not
    expect(payloadHash({ ...payload, buyer: { name: 'N-2', tax_id: { type: 'CNIC', value: 'V-2' } } }, ['buyer.name', 'buyer.tax_id.value'])).toBe(hashed);
    expect(payloadHash({ ...payload, buyer: { name: 'N-1', tax_id: { type: 'NTN', value: 'V-1' } } }, ['buyer.name', 'buyer.tax_id.value'])).not.toBe(hashed);
    // the caller's payload is not mutated
    expect(payload.buyer.tax_id.value).toBe('V-1');
    expect(payload.buyer.name).toBe('N-1');
  });

  it('[05 row H-4] a whole-object path, a top-level path and the pinCheck field combine', () => {
    const payload = { a: 1, buyer: { name: 'N-1' }, note: 'free', pin: '4711' };
    expect(payloadHash(payload, ['buyer', 'note', 'pin'])).toBe(payloadHash({ a: 1 }));
  });

  it('[05 row H-4] an absent, null or non-object step on the path leaves the payload unchanged', () => {
    const payload = { a: 1, buyer: null, list: [{ note: 'x' }], s: 'str' };
    expect(payloadHash(payload, ['buyer.tax_id.value', 'missing.deep', 's.length', 'list.note', 'list.0.note'])).toBe(payloadHash(payload));
  });
});
