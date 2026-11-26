import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectionRegistry } from '../../src/projections/registry';
import { registerKdsProjections } from '../../src/kds/index';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { append } from '../kds/fixtures';

// 03b v1.0.16 §5 (run 3 R3-M-9, R3-B-3): the `pass` projection folds PassBagReadyChanged into pass_bag_ready (set /
// replace / delete), clears the alert link on AlertClosed (the epoch stays), and records ready_explicit on pass_orders
// from ReadyToServe.alert_id (cleared by ReadyToServeUndone). Rebuild reproduces the rows.

let hub: TestHub;
beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
});
afterEach(async () => {
  await hub.close();
});

const onOrder = (order_id: string, event_type: string, payload: Record<string, unknown>, schema_version = 1) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, schema_version, payload });
const bag = (order_id: string) => hub.deps.db.prepare('SELECT bag_ready_since, bag_ready_window_ms, alert_id, point_id FROM pass_bag_ready WHERE order_id = ?').get(order_id);
const explicit = (order_id: string, point_id: string) =>
  (hub.deps.db.prepare('SELECT ready_explicit FROM pass_orders WHERE order_id = ? AND point_id = ?').get(order_id, point_id) as { ready_explicit: number } | undefined)?.ready_explicit;
const dump = () => ({
  bag: hub.deps.db.prepare('SELECT * FROM pass_bag_ready ORDER BY order_id').all(),
  orders: hub.deps.db.prepare('SELECT * FROM pass_orders ORDER BY order_id, point_id').all(),
});
const ready = (order_id: string, point_id: string, alert_id: string | null) =>
  onOrder(order_id, 'ReadyToServe', { order_id, point_id, order_item_ids: ['L1'], added_ids: ['L1'], forced_ids: [], table_id: null, alert_id }, 2);

describe('[03b v1.0.16 §5] pass_bag_ready and ready_explicit', () => {
  it('PassBagReadyChanged sets, replaces and deletes the epoch; AlertClosed clears only the alert link', () => {
    append(hub, [onOrder('O1', 'PassBagReadyChanged', { order_id: 'O1', ready: { bag_ready_since: 1_000, bag_ready_window_ms: 60_000, alert_id: 'A1', point_id: 'P1' } })]);
    expect(bag('O1')).toEqual({ bag_ready_since: 1_000, bag_ready_window_ms: 60_000, alert_id: 'A1', point_id: 'P1' });
    append(hub, [{ stream_type: 'hub', stream_id: 'branch-1', event_type: 'AlertClosed', payload: { alert_id: 'A1', reason: 'expired', by_staff_id: null, note: null } }]);
    expect(bag('O1')).toEqual({ bag_ready_since: 1_000, bag_ready_window_ms: 60_000, alert_id: null, point_id: 'P1' });
    append(hub, [onOrder('O1', 'PassBagReadyChanged', { order_id: 'O1', ready: { bag_ready_since: 5_000, bag_ready_window_ms: 90_000, alert_id: 'A2', point_id: 'P2' } })]);
    expect(bag('O1')).toEqual({ bag_ready_since: 5_000, bag_ready_window_ms: 90_000, alert_id: 'A2', point_id: 'P2' });
    append(hub, [onOrder('O1', 'PassBagReadyChanged', { order_id: 'O1', ready: null })]);
    expect(bag('O1')).toBeUndefined();
  });

  it('ready_explicit from ReadyToServe.alert_id; kept when the alert closes; gone with the Undo; rebuild reproduces both tables', () => {
    append(hub, [ready('O1', 'P1', 'A1'), ready('O1', 'P2', null)]);
    expect([explicit('O1', 'P1'), explicit('O1', 'P2')]).toEqual([1, 0]);
    append(hub, [{ stream_type: 'hub', stream_id: 'branch-1', event_type: 'AlertClosed', payload: { alert_id: 'A1', reason: 'expired', by_staff_id: null, note: null } }]);
    expect(explicit('O1', 'P1')).toBe(1);
    append(hub, [onOrder('O1', 'ReadyToServeUndone', { order_id: 'O1', point_id: 'P1', alert_id: 'A1' })]);
    expect(explicit('O1', 'P1')).toBe(0);
    append(hub, [onOrder('O2', 'PassBagReadyChanged', { order_id: 'O2', ready: { bag_ready_since: 7, bag_ready_window_ms: 60_000, alert_id: 'A9', point_id: 'P1' } })]);
    const live = dump();
    hub.deps.db.prepare("DELETE FROM projection_checkpoints WHERE projection = 'pass'").run();
    const fresh = createProjectionRegistry();
    registerKdsProjections(fresh);
    fresh.catchUp(hub.deps.db, 'branch-1');
    expect(dump()).toEqual(live);
  });
});
