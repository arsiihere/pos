import { describe, expect, it } from 'vitest';
import { payloadHash } from './hash';

describe('hash', () => {
  it('[00 §3.7] payloadHash ignores key order (Review Focus 4)', () => {
    const left = { a: 1, b: { d: 2, c: 3 } };
    const right = { b: { c: 3, d: 2 }, a: 1 };
    expect(payloadHash(left)).toBe(payloadHash(right));
    expect(payloadHash({ a: 2, b: { d: 2, c: 3 } })).not.toBe(payloadHash(left));
  });
});
