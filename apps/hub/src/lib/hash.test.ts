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
});
