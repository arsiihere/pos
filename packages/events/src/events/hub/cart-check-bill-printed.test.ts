// ⚠️ 05 v1.0.35 §6.3a, §6.29 (R2-M-4, R3-M-7): CartCheckBillPrinted v1, hub stream (stream id = the branch id), strict.
import { expect, it } from 'vitest';
import { latestVersion, parseEvent } from '../../index.js';

const event = {
  event_id: 'E1', tenant_id: 'TN', branch_id: 'B1', stream_type: 'hub', stream_id: 'B1',
  event_type: 'CartCheckBillPrinted', schema_version: 1, occurred_at: 1, recorded_at: 1,
  actor_id: 'S_CASH', device_id: 'D1', seq: 1,
  payload: { job_id: 'J1', printer_id: 'P1', line_count: 3, total_default_minor: 125_000, device_id: 'D1' },
};

it('[05 §6.3a, #60f] CartCheckBillPrinted v1 parses and replays unchanged; no printer → null ids', () => {
  expect(latestVersion('CartCheckBillPrinted')).toBe(1);
  expect(parseEvent(event)).toEqual(event);
  expect(parseEvent(JSON.parse(JSON.stringify(event)))).toEqual(event);
  const none = { ...event, payload: { ...event.payload, job_id: null, printer_id: null } };
  expect(parseEvent(none)).toEqual(none);
});

it('[05 §6.29] strict: counts are non-negative integers; no bill, order or line text', () => {
  for (const [key, value] of [['line_count', -1], ['line_count', 1.5], ['total_default_minor', -1]] as const) {
    expect(() => parseEvent({ ...event, payload: { ...event.payload, [key]: value } }), `${key} ${value}`).toThrow();
  }
  for (const extra of ['bill_id', 'order_id', 'lines']) expect(() => parseEvent({ ...event, payload: { ...event.payload, [extra]: 'x' } }), extra).toThrow();
  const payload: Record<string, unknown> = { ...event.payload };
  delete payload.device_id;
  expect(() => parseEvent({ ...event, payload })).toThrow();
});
