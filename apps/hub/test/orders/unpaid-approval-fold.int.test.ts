// ⚠️ 02b v1.0.25 §5, §6.19 (run 3 R3-M-2, R3-M-5, R3-M-8; D2), U-1: the orders projection folds UnpaidHandoverApproved
// into the named order only (approved time = recorded_at, approved due = due_minor); OpenOrderBillChanged clears both
// approval columns for its approval_cleared_order_ids; OrdersBilled and OrdersUnbilled clear them for their orders.
// Reset + replay rebuilds the columns (tests 87, 92 fold parts).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ordersProjection } from '../../src/orders/projection';
import { createProjectionRegistry } from '../../src/projections/registry';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { append } from '../kds/fixtures';
import { FX, appendOrder, openDay } from './fixtures';

let hub: TestHub;
beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
});
afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

const approval = (order_id: string) =>
  hub.deps.db.prepare('SELECT unpaid_handover_approved_at AS at, unpaid_handover_approved_due_minor AS due FROM orders WHERE order_id = ?').get(order_id) as { at: number | null; due: number | null };
const approve = (order_id: string, due_minor: number) =>
  append(hub, [{ stream_type: 'order', stream_id: order_id, event_type: 'UnpaidHandoverApproved', payload: { order_id, alert_id: `AL_${order_id}`, approved_by_staff_id: 'S_MGR', due_minor } }])[0]!;

describe('[02b #87, #92 fold] UnpaidHandoverApproved / OpenOrderBillChanged in the orders projection', () => {
  it('approval sets the named order only; the cleared subset of OpenOrderBillChanged clears; OrdersBilled / OrdersUnbilled clear; replay rebuilds', () => {
    openDay(hub);
    const a = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan }] }).order_id;
    const b = appendOrder(hub, { order_type: 'takeaway', adds_to_order_id: a, lines: [{ order_item_id: 'B1', item_id: FX.naan }] }).order_id;
    const c = appendOrder(hub, { order_type: 'parking', lines: [{ order_item_id: 'C1', item_id: FX.naan }] }).order_id;
    const e = approve(a, 65_000);
    expect(approval(a)).toEqual({ at: e.recorded_at, due: 65_000 });
    expect(approval(b)).toEqual({ at: null, due: null }); // a sibling of the same token needs its own approval
    const ec = approve(c, 30_000);
    expect(approval(c)).toEqual({ at: ec.recorded_at, due: 30_000 });

    // A money change on A's key: the writer decided A's approval ends (due rose); B is named but not cleared.
    append(hub, [{ stream_type: 'order', stream_id: a, event_type: 'OpenOrderBillChanged', payload: { order_ids: [a, b], approval_cleared_order_ids: [a] } }]);
    expect(approval(a)).toEqual({ at: null, due: null });
    expect(approval(c)).toEqual({ at: ec.recorded_at, due: 30_000 });

    // Billed and unbilled clear their orders' approvals.
    approve(a, 70_000);
    append(hub, [{ stream_type: 'order', stream_id: a, event_type: 'OrdersBilled', payload: { order_ids: [a], bill_id: 'BL1' } }]);
    expect(approval(a)).toEqual({ at: null, due: null });
    approve(c, 30_000);
    append(hub, [{ stream_type: 'order', stream_id: c, event_type: 'OrdersUnbilled', payload: { order_ids: [c], bill_id: 'BL2' } }]);
    expect(approval(c)).toEqual({ at: null, due: null });
    const last = approve(b, 12_000);

    const live = hub.deps.db.prepare('SELECT order_id, unpaid_handover_approved_at, unpaid_handover_approved_due_minor FROM orders ORDER BY order_id').all();
    expect(live).toContainEqual({ order_id: b, unpaid_handover_approved_at: last.recorded_at, unpaid_handover_approved_due_minor: 12_000 });
    hub.deps.db.prepare("DELETE FROM projection_checkpoints WHERE projection = 'orders'").run();
    const fresh = createProjectionRegistry();
    fresh.register(ordersProjection());
    fresh.catchUp(hub.deps.db, 'branch-1');
    expect(hub.deps.db.prepare('SELECT order_id, unpaid_handover_approved_at, unpaid_handover_approved_due_minor FROM orders ORDER BY order_id').all()).toEqual(live);
  });
});
