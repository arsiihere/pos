// ⚠️ 02b v1.0.25 §6.19 (R3-M-2, R3-M-5, R3-M-8; R2-m-12): UnpaidHandoverApproved v1, order stream, strict.
import { expect, it } from 'vitest';
import { latestVersion, parseEvent } from '../../index.js';

const event = {
  event_id: 'E1', tenant_id: 'TN', branch_id: 'B1', stream_type: 'order', stream_id: 'O1',
  event_type: 'UnpaidHandoverApproved', schema_version: 1, occurred_at: 1, recorded_at: 1,
  actor_id: 'S_MGR', device_id: 'D1', seq: 1,
  payload: { order_id: 'O1', alert_id: 'A1', approved_by_staff_id: 'S_MGR', due_minor: 50_000 },
};

it('[02b §6.19, #87] UnpaidHandoverApproved v1 parses and replays unchanged', () => {
  expect(latestVersion('UnpaidHandoverApproved')).toBe(1);
  const live = parseEvent(event);
  expect(live).toEqual(event);
  expect(parseEvent(JSON.parse(JSON.stringify(live)))).toEqual(event);
});

it('[02b §6.19] strict: a positive integer due; every field required; no extra key', () => {
  for (const due_minor of [0, -1, 1.5]) expect(() => parseEvent({ ...event, payload: { ...event.payload, due_minor } }), String(due_minor)).toThrow();
  for (const key of Object.keys(event.payload)) {
    const payload: Record<string, unknown> = { ...event.payload };
    delete payload[key];
    expect(() => parseEvent({ ...event, payload }), key).toThrow();
  }
  expect(() => parseEvent({ ...event, payload: { ...event.payload, order_ids: ['O1'] } })).toThrow();
});
