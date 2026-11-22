import { describe, expect, it } from 'vitest';
import '../../index';
import { parseEvent } from '../../codecs';
import { latestVersion, payloadSchema } from '../../registry';
import { aLinePrioritized } from '../../../testing/index';

// 03a v1.2.10 §4.2, §3.5.7 PR-3 (STAB-7): LinePrioritized v1 on the order stream, written by fires_alerts.
// delay_ms / at_ms are display and audit only (the fold reads recorded_at and the state).
const example = { order_id: 'O1', group_id: 'O1:0', order_item_ids: ['L1', 'L2'], delay_ms: 300_001, at_ms: 1_900_000 };

describe('[03a v1.2.10 §4.2] LinePrioritized v1', () => {
  it('[03a #160] is registered at schema_version 1 and its fixture round-trips', () => {
    expect(latestVersion('LinePrioritized')).toBe(1);
    expect(payloadSchema('LinePrioritized', 1).parse(example)).toEqual(example);
    const parsed = parseEvent(aLinePrioritized({ payload: example }));
    expect(parsed.payload).toEqual(example);
  });

  it('[03a §4.2] refuses a missing key, an empty order_item_ids and a fractional delay_ms', () => {
    const schema = payloadSchema('LinePrioritized', 1);
    for (const key of Object.keys(example)) {
      const rest: Record<string, unknown> = { ...example };
      delete rest[key];
      expect(schema.safeParse(rest).success, key).toBe(false);
    }
    expect(schema.safeParse({ ...example, order_item_ids: [] }).success).toBe(false);
    expect(schema.safeParse({ ...example, delay_ms: 1.5 }).success).toBe(false);
  });
});
