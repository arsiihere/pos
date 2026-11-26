import type { EngineState } from '@pos/engine';
import type { BranchConfig } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { pointViewBody } from '../../src/ws/point-catch-up';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { FX, append, appendOrder, fixtureMenu, openDay, removeLine, signInCook } from './fixtures';

// 03b v1.0.16 §3.4 (run 3 R3-B-1, R3-M-5), §6.15, §6.16 (plan K-3, 03b task 47 hub part), test 110: every point_view
// order carries the stable `pickup_at_ms` and `boosted` (engine memory); a pickup card also carries `pickup_readiness`
// (whole-order engine readiness across every point; the station-less hold) and `no_station_lines` (live unserved
// non-deal station-less lines, one batched read only with a pickup order). The live `point_lines` frame carries the
// same metadata for an order a commit changed (OrderBoosted here).

let hub: TestHub;
const sockets: WsClient[] = [];
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  swapBranchConfig(null);
  await hub?.close();
});

const HOUR = 3_600_000;
const engine = (): EngineState => hub.deps.state.get() as EngineState;
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

/** P1 (Karahi, S1) and P2 (Grill, S3). */
function menu(): BranchConfig {
  const base = fixtureMenu();
  const s1 = base.stations[0]!;
  return {
    ...base,
    points: [...base.points, { point_id: 'P2', name: 'Pass 2', sort_order: 1, is_archived: false }],
    stations: [...base.stations, { ...s1, station_id: 'S3', name: 'Grill', point_id: 'P2' }],
    items: [...base.items, { ...base.items.find((i) => i.item_id === FX.naan)!, item_id: 'I_GRILL', name: 'Tikka', station_id: 'S3', sort_order: 9 }],
  };
}

type ViewOrder = Record<string, unknown> & { order_id: string };

async function passSocket(point: 'P1' | 'P2', seat: { token: string; sessionToken: string }): Promise<WsClient> {
  const ws = await connectWs(hub.app);
  sockets.push(ws);
  ws.send({ type: 'auth', device_token: seat.token, session_token: seat.sessionToken });
  await ws.untilCount(1);
  const view = (ws.messages[0] as { state: { point_view: { point_id: string } } }).state.point_view;
  expect(view.point_id).toBe(point);
  return ws;
}
const viewOrders = (ws: WsClient): ViewOrder[] => (ws.messages[0] as { state: { point_view: { orders: ViewOrder[] } } }).state.point_view.orders;

/** A pickup takeaway: A1 at P1, G1 at P2, station-less C1 (live) and C2 (removed), deal-free. */
function pickupOrder(pickup_at_ms: number): string {
  const { order_id } = appendOrder(hub, {
    order_type: 'takeaway',
    pickup_at_ms,
    lines: [
      { order_item_id: 'A1', item_id: FX.piece },
      { order_item_id: 'G1', item_id: 'I_GRILL' },
      { order_item_id: 'C1', item_id: FX.optionItem, item: { station_id: null } },
      { order_item_id: 'C2', item_id: FX.optionItem, item: { station_id: null } },
    ],
  });
  removeLine(hub, order_id, 'C2');
  return order_id;
}

describe('[03b v1.0.16 §6.15, #110] point_view pickup metadata (K-3)', () => {
  it('catch-up: pickup_at_ms, boosted, pickup_readiness and only the live station-less lines on the pickup card; a plain card none; 5 statements with a pickup, 4 without', async () => {
    hub = await createTestHub({ provisioned: true });
    const cook = await signInCook(hub, { pointId: 'P1' });
    openDay(hub, { menu: menu() });
    const pickupAt = hub.clock.branchNow() + HOUR;
    const plain = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'B1', item_id: FX.piece }] }).order_id;

    const counter = statementCounter(hub.deps.db);
    pointViewBody(hub.deps.db, engine(), 'P1', hub.clock.branchNow());
    expect(counter.count, 'no pickup order').toBe(4);

    const order_id = pickupOrder(pickupAt);
    counter.reset();
    pointViewBody(hub.deps.db, engine(), 'P1', hub.clock.branchNow());
    expect(counter.count, 'with a pickup order').toBe(5);

    const ws = await passSocket('P1', cook);
    const orders = viewOrders(ws);
    expect(orders.find((o) => o.order_id === plain)).toMatchObject({ pickup_at_ms: null, boosted: false, pickup_readiness: null, no_station_lines: [] });
    const card = orders.find((o) => o.order_id === order_id)!;
    expect(card).toMatchObject({
      pickup_at_ms: pickupAt,
      boosted: false,
      pickup_readiness: { all_engine_lines_done: false, station_less_hold_until: pickupAt },
      no_station_lines: [{ order_item_id: 'C1', item_name: 'Raita', units: 1 }],
    });
    // station-less lines are listed outside the card's lines (no pick / Handover)
    expect((card.lines as Array<{ order_item_id: string }>).map((l) => l.order_item_id)).toEqual(['A1']);
  });

  it('after Boost: the live point_lines metadata and a fresh catch-up keep the original pickup_at_ms with boosted: true; the hold clears; cooking at P2 still blocks both cards', async () => {
    hub = await createTestHub({ provisioned: true });
    const p1 = await signInCook(hub, { pointId: 'P1' });
    const p2 = await signInCook(hub, { pointId: 'P2' });
    openDay(hub, { menu: menu() });
    const pickupAt = hub.clock.branchNow() + HOUR;
    const order_id = pickupOrder(pickupAt);
    const ws1 = await passSocket('P1', p1);
    const ws2 = await passSocket('P2', p2);
    append(hub, [{ stream_type: 'order', stream_id: order_id, event_type: 'OrderBoosted', payload: { order_id } }]);
    await settle();
    const expected = {
      order_id,
      pickup_at_ms: pickupAt,
      boosted: true,
      pickup_readiness: { all_engine_lines_done: false, station_less_hold_until: null },
      no_station_lines: [{ order_item_id: 'C1', item_name: 'Raita', units: 1 }],
    };
    for (const ws of [ws1, ws2]) {
      const meta = ws.messages.flatMap((m) => {
        const f = m as { type?: string; orders?: ViewOrder[] };
        return f.type === 'point_lines' && f.orders !== undefined ? f.orders : [];
      });
      expect(meta.filter((o) => o.order_id === order_id).at(-1)).toMatchObject(expected);
    }
    const again = await passSocket('P1', p1);
    expect(viewOrders(again).find((o) => o.order_id === order_id)).toMatchObject(expected);
  });
});
