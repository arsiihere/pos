// ⚠️ 03b v1.0.16 §6.22 (run 3 R3-B-3): PassBagReadyChanged v1, order stream; the start of an R8 epoch with the
// committed alert facts, or null clearing it.
import { expect, it } from 'vitest';
import { latestVersion, parseEvent } from '../../index.js';

const event = (ready: unknown) => ({
  event_id: 'E1', tenant_id: 'TN', branch_id: 'B1', stream_type: 'order', stream_id: 'O1',
  event_type: 'PassBagReadyChanged', schema_version: 1, occurred_at: 1, recorded_at: 1,
  actor_id: null, device_id: 'hub', seq: 1, payload: { order_id: 'O1', ready },
});

it('[03b §6.22] PassBagReadyChanged v1 parses and replays unchanged: a start and a clear', () => {
  expect(latestVersion('PassBagReadyChanged')).toBe(1);
  for (const ready of [{ bag_ready_since: 1_000, bag_ready_window_ms: 60_000, alert_id: 'A1', point_id: 'P1' }, { bag_ready_since: 1_000, bag_ready_window_ms: 60_000, alert_id: null, point_id: 'P1' }, null]) {
    const e = event(ready);
    expect(parseEvent(e)).toEqual(e);
    expect(parseEvent(JSON.parse(JSON.stringify(e)))).toEqual(e);
  }
});

it('[03b §6.22] strict: integer times, a point, no extra key', () => {
  const ok = { bag_ready_since: 1_000, bag_ready_window_ms: 60_000, alert_id: 'A1', point_id: 'P1' };
  expect(() => parseEvent(event({ ...ok, bag_ready_since: 1.5 }))).toThrow();
  expect(() => parseEvent(event({ ...ok, point_id: undefined }))).toThrow();
  expect(() => parseEvent(event({ ...ok, extra: 1 }))).toThrow();
  expect(() => parseEvent({ ...event(ok), payload: { order_id: 'O1', ready: ok, extra: true } })).toThrow();
});
