import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readyAtOf } from '../../src/kds/exports';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { append } from '../kds/fixtures';

// 03b v1.0.16 §4.2 `readyAtOf(db, order_ids)` (02b-tk R8; hostile run 1 M-3, m-10; plan B1-4), test 105 (the readyAtOf
// half; the R8 pair is D8's): per order the largest `pass_orders.ready_at` over its points, whatever the Ready's alert
// state; absent when none; 1 statement for any number of ids, 0 for [].

let hub: TestHub;
beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
});
afterEach(async () => {
  await hub.close();
});

const ready = (order_id: string, point_id: string, ids: string[], alert_id: string | null = `A-${order_id}-${point_id}`) => ({
  stream_type: 'order' as const,
  stream_id: order_id,
  event_type: 'ReadyToServe',
  schema_version: 2,
  payload: { order_id, point_id, order_item_ids: ids, added_ids: ids, forced_ids: [], table_id: null, alert_id },
});
const undone = (order_id: string, point_id: string) => ({
  stream_type: 'order' as const,
  stream_id: order_id,
  event_type: 'ReadyToServeUndone',
  payload: { order_id, point_id, alert_id: null },
});

describe('[03b v1.0.16 §4.2, #105] readyAtOf', () => {
  it('the later point timestamp per order, a Handover-only Ready (alert_id null) included; kept after the alert closes; absent once both points are undone', () => {
    const [p1] = append(hub, [ready('O1', 'P1', ['L1'])]);
    const [p2] = append(hub, [ready('O1', 'P2', ['L2'], null)]);
    const [o2] = append(hub, [ready('O2', 'P1', ['M1'])]);
    expect(readyAtOf(hub.deps.db, ['O1', 'O2', 'O3'])).toEqual(new Map([['O1', p2!.recorded_at], ['O2', o2!.recorded_at]]));
    expect(p2!.recorded_at).toBeGreaterThan(p1!.recorded_at);
    // the Ready's alert closes (expiry at day close, a close `done`): ready_at stays
    append(hub, [{ stream_type: 'hub', stream_id: 'branch-1', event_type: 'AlertClosed', payload: { alert_id: 'A-O2-P1', reason: 'expired', by_staff_id: null, note: null } }]);
    expect(readyAtOf(hub.deps.db, ['O2']).get('O2')).toBe(o2!.recorded_at);
    append(hub, [undone('O1', 'P2')]);
    expect(readyAtOf(hub.deps.db, ['O1']).get('O1')).toBe(p1!.recorded_at);
    append(hub, [undone('O1', 'P1')]);
    expect(readyAtOf(hub.deps.db, ['O1']).has('O1')).toBe(false);
  });

  it('one statement for 1 or 50 ids, none for []', () => {
    append(hub, [ready('O1', 'P1', ['L1'])]);
    const counter = statementCounter(hub.deps.db);
    expect(readyAtOf(hub.deps.db, [])).toEqual(new Map());
    expect(counter.count).toBe(0);
    readyAtOf(hub.deps.db, ['O1']);
    expect(counter.count).toBe(1);
    counter.reset();
    readyAtOf(hub.deps.db, Array.from({ length: 50 }, (_, i) => `O${i}`));
    expect(counter.count).toBe(1);
  });
});
