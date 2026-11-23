import { describe, expect, it } from 'vitest';
import { parseEvent } from './codecs';
import './index';
import { anItemAdded } from '../testing/index';

// 01c v1.1.4 §4.3 (03a v1.2.10 §3.5.7 PR-1; STAB-7): ItemAdded.max_delay_ms is optional at v1 (additive, no upcaster),
// a whole ms value in 60 000–1 800 000 or null (= no limit); absent on an older event.
describe('[01c v1.1.4 §4.3] ItemAdded.max_delay_ms', () => {
  const base = anItemAdded();
  const withDelay = (v: unknown) => ({ ...base, payload: { ...base.payload, max_delay_ms: v } });

  it('[01c #130] parses 60000, 300000, 1800000 and null; without the key the parsed payload has none', () => {
    for (const v of [60_000, 300_000, 1_800_000, null]) {
      const parsed = parseEvent(withDelay(v));
      expect((parsed.payload as { max_delay_ms?: number | null }).max_delay_ms, String(v)).toBe(v);
    }
    expect('max_delay_ms' in (parseEvent(base).payload as object)).toBe(false);
  });

  it('[01c #130] refuses 0, 59999, 1800001, 7200000, -1 and 1.5 (fails on the v1.1.3 range)', () => {
    for (const v of [0, 59_999, 1_800_001, 7_200_000, -1, 1.5]) {
      expect(() => parseEvent(withDelay(v)), String(v)).toThrow();
    }
  });
});
