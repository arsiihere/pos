import { afterEach, describe, expect, it, vi } from 'vitest';
import { ULID_RE } from '@pos/domain';
import { newUlid } from './ulid';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function decodeTime(id: string): number {
  let ms = 0;
  for (const ch of id.slice(0, 10)) ms = ms * 32 + CROCKFORD.indexOf(ch);
  return ms;
}

describe('ulid', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('[01a §10 #125] 26 Crockford characters, time from Date.now, random from getRandomValues, distinct, no randomUUID needed', () => {
    const now = 1_761_400_000_123;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const getRandomValues = vi.spyOn(globalThis.crypto, 'getRandomValues');
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto), randomUUID: undefined });

    const id = newUlid();
    expect(id).toMatch(ULID_RE);
    expect(decodeTime(id)).toBe(now);
    expect(decodeTime(newUlid(5))).toBe(5);

    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(newUlid());
    expect(ids.size).toBe(1000);
    for (const v of ids) expect(v).toMatch(ULID_RE);
    expect(getRandomValues).toHaveBeenCalled();
  });
});
