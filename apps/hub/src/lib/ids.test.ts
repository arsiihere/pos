import { ULID_RE } from '@pos/domain';
import { describe, expect, it } from 'vitest';
import { fixedClock, T } from './clock';
import { testIdGen, ulidGen } from './ids';
import { cryptoSecrets } from './secrets';

const CROCKFORD_6 = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/;

describe('ids', () => {
  it('[F §6.7] testIdGen yields valid increasing ULIDs', () => {
    const ids = testIdGen();
    const values = [ids.next(), ids.next(), ids.next()];
    for (const id of values) expect(ULID_RE.test(id)).toBe(true);
    expect(values[0]! < values[1]! && values[1]! < values[2]!).toBe(true);
  });

  it('[F §6.7] ulidGen is monotonic within one ms', () => {
    const ids = ulidGen(fixedClock(T));
    const a = ids.next();
    const b = ids.next();
    expect(ULID_RE.test(a)).toBe(true);
    expect(ULID_RE.test(b)).toBe(true);
    expect(a < b).toBe(true);
  });

  it('[00 §6.30] crockford(6) uses only the Crockford alphabet', () => {
    for (let i = 0; i < 30; i++) expect(cryptoSecrets.crockford(6)).toMatch(CROCKFORD_6);
  });
});
