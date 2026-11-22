import { describe, expect, it } from 'vitest';
import { aBranchConfig } from '../testing/index';
import { BranchConfigSnapshotSchemaV4, MAX_DELAY_DEFAULT_MS, itemMaxDelay, maxDelayDefaultMs } from './config';

// 01a v2.7.5 §4.3 MD-5 (STAB-7, review M-8): items[].max_delay_ms / max_delay_unlimited and
// engine_settings.max_delay_default_ms are optional in the V4 parser (no version bump, R29) and exposed as parsed;
// the hub reads a MISSING key as null / false / 300 000, and keeps an explicit null default as null.
describe('[01a v2.7.5 MD-5] snapshot max delay keys', () => {
  const withKeys = () => {
    const base = aBranchConfig();
    return {
      ...base,
      items: base.items.map((item, i) => ({ ...item, max_delay_ms: i === 0 ? 600_000 : null, max_delay_unlimited: i === 1 })),
      engine_settings: { ...base.engine_settings, max_delay_default_ms: null },
    };
  };

  it('[01a #204] a snapshot without the three keys parses and the hub reads 300000 / null / false', () => {
    const parsed = BranchConfigSnapshotSchemaV4.parse(aBranchConfig());
    expect('max_delay_default_ms' in parsed.engine_settings).toBe(false);
    expect(maxDelayDefaultMs(parsed)).toBe(MAX_DELAY_DEFAULT_MS);
    expect(MAX_DELAY_DEFAULT_MS).toBe(300_000);
    expect(itemMaxDelay(parsed.items[0]!)).toEqual({ max_delay_ms: null, max_delay_unlimited: false });
  });

  it('[01a #204] a snapshot with the keys keeps them as parsed; an explicit null default stays null (not 300000)', () => {
    const parsed = BranchConfigSnapshotSchemaV4.parse(withKeys());
    expect(parsed.engine_settings.max_delay_default_ms).toBeNull();
    expect(maxDelayDefaultMs(parsed)).toBeNull();
    expect(itemMaxDelay(parsed.items[0]!)).toEqual({ max_delay_ms: 600_000, max_delay_unlimited: false });
    expect(itemMaxDelay(parsed.items[1]!)).toEqual({ max_delay_ms: null, max_delay_unlimited: true });
    const ten = { ...withKeys(), engine_settings: { ...withKeys().engine_settings, max_delay_default_ms: 600_000 } };
    expect(maxDelayDefaultMs(BranchConfigSnapshotSchemaV4.parse(ten))).toBe(600_000);
  });

  it('[01a #204] a wrong type on a key is refused', () => {
    const bad = withKeys();
    expect(BranchConfigSnapshotSchemaV4.safeParse({ ...bad, engine_settings: { ...bad.engine_settings, max_delay_default_ms: '5' } }).success).toBe(false);
    expect(BranchConfigSnapshotSchemaV4.safeParse({ ...bad, items: bad.items.map((i) => ({ ...i, max_delay_unlimited: 1 })) }).success).toBe(false);
  });
});
