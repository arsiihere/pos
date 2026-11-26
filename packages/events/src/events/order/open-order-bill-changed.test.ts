// ⚠️ 02b v1.0.25 §6.19 (run 3 R3-M-3, R3-M-5, R3-M-8): OpenOrderBillChanged v1 — the contract only. Order stream of the
// first affected order; { order_ids (unique, nonempty), approval_cleared_order_ids (unique, a subset) }; strict; no
// amounts, no contact. The owning billing transactions append it later (L-BILL-2, after 02b's B1-2 approval columns).
import { expect, it } from 'vitest';
import { anOpenOrderBillChanged } from '../../../testing/index.js';
import { latestVersion, parseEvent } from '../../index.js';

const event = {
  event_id: 'E1', tenant_id: 'TN', branch_id: 'B1', stream_type: 'order', stream_id: 'O1',
  event_type: 'OpenOrderBillChanged', schema_version: 1, occurred_at: 1, recorded_at: 1,
  actor_id: 'S_CASH', device_id: 'D1', seq: 1,
  payload: { order_ids: ['O1', 'O2'], approval_cleared_order_ids: ['O2'] },
};

const withPayload = (payload: Record<string, unknown>) => ({ ...event, payload });

it('[02b §6.19, R3-M-8] OpenOrderBillChanged v1 parses and replays unchanged; no clear is an empty list', () => {
  expect(latestVersion('OpenOrderBillChanged')).toBe(1);
  const live = parseEvent(event);
  expect(live).toEqual(event);
  expect(parseEvent(JSON.parse(JSON.stringify(live)))).toEqual(event);
  expect(parseEvent(withPayload({ order_ids: ['O1'], approval_cleared_order_ids: [] })).payload).toEqual({ order_ids: ['O1'], approval_cleared_order_ids: [] });
  expect(parseEvent(anOpenOrderBillChanged())).toMatchObject({ stream_type: 'order', event_type: 'OpenOrderBillChanged' });
});

it('[02b §6.19] order_ids nonempty and unique; clears unique and a subset of order_ids', () => {
  for (const payload of [
    { order_ids: [], approval_cleared_order_ids: [] },
    { order_ids: ['O1', 'O1'], approval_cleared_order_ids: [] },
    { order_ids: ['O1', 'O2'], approval_cleared_order_ids: ['O2', 'O2'] },
    { order_ids: ['O1'], approval_cleared_order_ids: ['O9'] },
    { order_ids: [''], approval_cleared_order_ids: [] },
  ]) {
    expect(() => parseEvent(withPayload(payload)), JSON.stringify(payload)).toThrow();
  }
});

it('[02b §6.19] strict: both lists required; no amount, contact or any other key', () => {
  expect(() => parseEvent(withPayload({ order_ids: ['O1'] }))).toThrow();
  expect(() => parseEvent(withPayload({ approval_cleared_order_ids: [] }))).toThrow();
  for (const extra of [{ due_minor: 100 }, { phone: '03001234567' }, { bill_id: 'B1' }]) {
    expect(() => parseEvent(withPayload({ ...event.payload, ...extra })), Object.keys(extra)[0]).toThrow();
  }
});
