import { expect, it } from 'vitest';
import { parseEvent } from '../../index.js';

it('[03b §6.22] replays the recorded Pass move and destination carry times', () => {
  const move = {
    order_item_id: 'L1',
    from_point_id: 'front',
    from_point_name: 'Front Pass',
    to_point_id: 'counter',
    carry_ms: 0,
    alternates: [{ station_id: 'grill', carry_ms: 30_000, home: false }],
  };
  const event = {
    event_id: 'E1', tenant_id: 'TN', branch_id: 'B1', stream_type: 'order', stream_id: 'O1',
    event_type: 'PassPointLinesMoved', schema_version: 1, occurred_at: 1, recorded_at: 1,
    actor_id: null, device_id: 'hub', seq: 1, payload: { order_id: 'O1', moves: [move] },
  };
  const live = parseEvent(event);
  expect(live).toEqual(event);
  expect(parseEvent(JSON.parse(JSON.stringify(live)))).toEqual(event);
  expect(() => parseEvent({ ...event, payload: { order_id: 'O1', moves: [{ ...move, carry_ms: null }] } })).toThrow();
});
