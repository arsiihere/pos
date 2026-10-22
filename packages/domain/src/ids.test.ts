import { describe, expect, it } from 'vitest';
import { ULID_RE } from './ids';

describe('ids', () => {
  it('[F §6.6] ULID_RE accepts Crockford ULIDs only', () => {
    expect(ULID_RE.test('01JBF3Q8ZK4M2N6P7R9S0T1V2W')).toBe(true);
    expect(ULID_RE.test('01JBF3Q8ZK4M2N6P7R9S0T1V2I')).toBe(false);
  });
});
