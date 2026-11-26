import type { PosEvent } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerKdsProjections } from '../../src/kds/index';
import { createProjectionRegistry } from '../../src/projections/registry';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { audienceAllows } from '../../src/ws/audience';
import type { SocketCtx } from '../../src/ws/catch-up';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { FX, append, appendOrder, fixtureMenu, openDay, pairDevice, pairPassTablet, signInCook } from '../kds/fixtures';

// 03b v1.0.16 §5, §6.22 (run 3 R3-M-1): PassPointLinesMoved v1 (written by the D7 archive apply, a later lane). Its
// audience: the Pass sockets of every recorded from / to point, and the order's counter devices (R8 invalidation). The
// pass projection deletes the named old unsettled Ready memberships in one batched write; handovers stay.

let hub: TestHub;
beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
});
afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

const staff = (deviceId: string): SocketCtx => ({ deviceId, deviceType: 'tablet', sessionId: `X_${deviceId}`, kind: 'staff', staffId: 'S_CASH', stationId: null, asOfSeq: 0 });
const move = (order_item_id: string, from: string, to: string) => ({ order_item_id, from_point_id: from, from_point_name: `Pass ${from}`, to_point_id: to, carry_ms: 0, alternates: [] });
let seq = 9_000;
const ev = (order_id: string, moves: unknown[]): PosEvent =>
  ({ event_id: `E${(seq += 1)}`, tenant_id: 't', branch_id: 'branch-1', seq, stream_type: 'order', stream_id: order_id, event_type: 'PassPointLinesMoved', schema_version: 1, payload: { order_id, moves }, occurred_at: 0, recorded_at: 0, actor_id: null, device_id: 'hub' }) as PosEvent;

describe('[03b v1.0.16 §6.22] PassPointLinesMoved', () => {
  it('reaches the Pass sockets of the recorded from and to points and the order\'s counter devices, nobody else; 0 statements', async () => {
    await signInCook(hub, { pointId: 'P1' });
    const base = fixtureMenu();
    openDay(hub, { menu: { ...base, points: [...base.points, { point_id: 'P2', name: 'Pass 2', sort_order: 1, is_archived: false }, { point_id: 'P3', name: 'Pass 3', sort_order: 2, is_archived: false }] } });
    const p1 = pairPassTablet(hub, { pointId: 'P1' }).deviceId;
    const p2 = pairPassTablet(hub, { pointId: 'P2' }).deviceId;
    const p3 = pairPassTablet(hub, { pointId: 'P3' }).deviceId;
    const counter = pairDevice(hub, { type: 'cashier_kiosk', profile: { access: 'everyone', screens: ['takeaway'] } }).deviceId;
    const order_id = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan }] }).order_id;
    const e = ev(order_id, [move('A1', 'P1', 'P2')]);
    const spy = statementCounter(hub.deps.db);
    expect([p1, p2, p3, counter].map((d) => audienceAllows(e, staff(d)))).toEqual([true, true, false, true]);
    expect(spy.count).toBe(0);
  });

  it('the pass fold deletes the moved lines\' old unsettled Ready memberships only (one write); handovers stay; rebuild agrees', () => {
    const ready = (point_id: string, ids: string[]) => ({
      stream_type: 'order' as const, stream_id: 'O1', event_type: 'ReadyToServe', schema_version: 2,
      payload: { order_id: 'O1', point_id, order_item_ids: ids, added_ids: ids, forced_ids: [], table_id: null, alert_id: `A_${point_id}` },
    });
    append(hub, [ready('P1', ['L1', 'L2']), ready('P2', ['L3'])]);
    append(hub, [{ stream_type: 'order', stream_id: 'O1', event_type: 'Handover', payload: { handover_id: 'H1', order_id: 'O1', point_id: 'P1', receiver_staff_id: 'S_MGR', order_item_ids: ['L2'], alert_id: 'C1', ready_alert_closed: null } }]);
    append(hub, [{ stream_type: 'order', stream_id: 'O1', event_type: 'PassPointLinesMoved', payload: { order_id: 'O1', moves: [move('L1', 'P1', 'P2'), move('L3', 'P1', 'P3')] } }]);
    const members = () => hub.deps.db.prepare('SELECT order_item_id, point_id FROM pass_ready_lines WHERE settled_at IS NULL ORDER BY order_item_id').all();
    // L1 left P1's Ready; L3 was never at P1, so its P2 membership stays; L2 (handed) keeps its row and its hand-over
    expect(members()).toEqual([{ order_item_id: 'L2', point_id: 'P1' }, { order_item_id: 'L3', point_id: 'P2' }]);
    expect(hub.deps.db.prepare('SELECT order_item_id FROM handover_lines').all()).toEqual([{ order_item_id: 'L2' }]);
    const live = members();
    hub.deps.db.prepare("DELETE FROM projection_checkpoints WHERE projection = 'pass'").run();
    const fresh = createProjectionRegistry();
    registerKdsProjections(fresh);
    fresh.catchUp(hub.deps.db, 'branch-1');
    expect(members()).toEqual(live);
  });
});
