import { isOrderInEngine, type EngineState } from '@pos/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { branchConfig } from '../../src/sync/branch-config-holder';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { appendOrder, FX, fixtureMenu, openDay, openSeating, setZoneStock } from './fixtures';

let hub: TestHub;

afterEach(async () => {
  await hub.close();
});

const engine = (): EngineState => hub.deps.state.get() as EngineState;
const logged = (order_id: string) =>
  (
    hub.deps.db.prepare(`SELECT event_type, payload FROM events WHERE stream_id = ? OR (event_type = 'StockReserved') ORDER BY seq`).all(order_id) as Array<{
      event_type: string;
      payload: string;
    }>
  ).map((r) => ({ type: r.event_type, payload: JSON.parse(r.payload) as Record<string, unknown> }));

describe('[02b fixtures] shared order fixtures', () => {
  it('[02b fixtures] appendOrder writes an order the engine holds', async () => {
    hub = await createTestHub();
    const day = openDay(hub, { stock: { [FX.stock]: 10_000 } });
    expect(branchConfig()).toEqual(fixtureMenu());
    expect(engine().business_day).toMatchObject({ business_date: day.business_date, closed_at: null });
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'SEAT1' });
    setZoneStock(hub, FX.zone, FX.zoneItem, 5);

    const placed = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'SEAT1',
      lines: [
        { order_item_id: 'L1', item_id: FX.piece, quantity: 2 },
        { order_item_id: 'L1o', item_id: FX.optionItem, option_id: FX.option, parent_order_item_id: 'L1', quantity: 1 },
        { order_item_id: 'L2', item_id: FX.gram },
        { order_item_id: 'D1', deal_id: FX.deal, quantity: 1 },
        { order_item_id: 'D1a', deal_id: FX.deal, deal_part_id: FX.dealParts[0], item_id: FX.piece, parent_order_item_id: 'D1' },
        { order_item_id: 'D1b', deal_id: FX.deal, deal_part_id: FX.dealParts[1], item_id: FX.naan, parent_order_item_id: 'D1' },
        { order_item_id: 'L3', item_id: FX.ready, quantity: 1 },
        { order_item_id: 'Z1', item_id: FX.zoneItem, quantity: 1, from_zone: true },
      ],
    });

    const state = engine();
    expect(isOrderInEngine(state, placed.order_id, hub.clock.branchNow())).toBe(true);
    // Engine lines are held; the deal header and the zone-served line never are (03a :245, Q-3).
    for (const id of ['L1', 'L1o', 'L2', 'D1a', 'D1b', 'L3']) expect(state.lines[id]?.order_id).toBe(placed.order_id);
    expect(state.lines.D1).toBeUndefined();
    expect(state.lines.Z1).toBeUndefined();
    // The dine-in key and the zone route (02b §3.1, §3.10): the naan of the zone table goes to the zone's station.
    expect(state.orders[placed.order_id]).toMatchObject({ table_key: 'dine_in:SEAT1', table_id: FX.zoneTable });

    // 02b §3.2 step 10 order: OrderPlaced → ItemAdded (order_item_ids order) → zone ItemAdded → StockReserved → ItemServed zone.
    const events = logged(placed.order_id);
    expect(events.map((e) => e.type)).toEqual([
      'OrderPlaced',
      ...Array<string>(7).fill('ItemAdded'),
      'ItemAdded',
      'StockReserved',
      'StockReserved',
      'ItemServed',
    ]);
    const orderPlaced = events[0]!.payload;
    expect(orderPlaced.order_item_ids).toEqual(['L1', 'L1o', 'L2', 'D1', 'D1a', 'D1b', 'L3']);
    expect(orderPlaced).toMatchObject({ business_date: day.business_date, has_food: true, has_phone: false });
    expect(events.at(-1)!.payload).toEqual({ order_item_ids: ['Z1'], source: 'zone' });
    const added = new Map(events.filter((e) => e.type === 'ItemAdded').map((e) => [e.payload.order_item_id, e.payload]));
    expect(added.get('Z1')).toMatchObject({ served_from_zone_id: FX.zone });
    expect(added.get('D1b')).toMatchObject({ station_id: FX.zoneStation });
    expect(added.get('L3')).toMatchObject({ is_ready_item: true });
    expect(added.get('L2')).toMatchObject({ sale_unit: 'g', quantity: null, line_total_minor: null });
    expect(added.get('D1')).toMatchObject({ line_kind: 'deal', station_id: null });
    expect(placed.events.length).toBe(events.length);
    // No engine diagnostic, no absent-id line (03a host) and 02a found the seating (§10 #55 line absent).
    expect(engine().diagnostics).toEqual([]);
    expect(hub.logs()).not.toMatch(/absent id|names no open seating/);
  });

  it('[02b fixtures] takeaway and parking orders get their §3.1 table_key', async () => {
    hub = await createTestHub();
    openDay(hub);
    const food = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'T1', item_id: FX.naan, quantity: 3 }] });
    expect(isOrderInEngine(engine(), food.order_id, hub.clock.branchNow())).toBe(true);
    expect(engine().orders[food.order_id]).toMatchObject({ order_type: 'takeaway', table_key: `takeaway:${food.order_id}` });
    const parking = appendOrder(hub, {
      order_type: 'parking',
      car_number: 'LEB 1234',
      lines: [{ order_item_id: 'P1', item_id: FX.naan }],
    });
    expect(engine().orders[parking.order_id]).toMatchObject({ table_key: 'parking:LEB1234' });
  });

  it('[02b fixtures] 01c §3.4.2: a deal part quantity = part quantity × deal count (a 2× deal with a 500 g part → 1 000 g)', async () => {
    hub = await createTestHub();
    const base = fixtureMenu();
    const rice = { ...base.items.find((i) => i.item_id === FX.naan)!, item_id: 'I_RICE', name: 'Rice', sort_order: 7, sale_unit: 'g' as const, price_minor: 200_000 };
    const deal = base.deals[0]!;
    const menu = {
      ...base,
      items: [...base.items, rice],
      deals: [{ ...deal, parts: [...deal.parts, { deal_part_id: 'DP_RICE', quantity: 500, sort_order: 2, choices: [{ item_id: rice.item_id, extra_price_minor: 0, sort_order: 0 }] }] }],
    };
    openDay(hub, { menu, stock: { [FX.stock]: 10_000 } });
    const placed = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'D2', deal_id: FX.deal, quantity: 2 },
        { order_item_id: 'D2a', deal_id: FX.deal, deal_part_id: FX.dealParts[0], item_id: FX.piece, parent_order_item_id: 'D2' },
        { order_item_id: 'D2b', deal_id: FX.deal, deal_part_id: FX.dealParts[1], item_id: FX.naan, parent_order_item_id: 'D2' },
        { order_item_id: 'D2c', deal_id: FX.deal, deal_part_id: 'DP_RICE', item_id: rice.item_id, parent_order_item_id: 'D2' },
      ],
    });
    const added = new Map(logged(placed.order_id).filter((e) => e.type === 'ItemAdded').map((e) => [e.payload.order_item_id, e.payload]));
    expect(added.get('D2')).toMatchObject({ line_kind: 'deal', quantity: 2 });
    // Piece parts: 1 × 2 and 2 × 2; the g part: 500 g × 2 deals (never the deal count alone).
    expect(added.get('D2a')).toMatchObject({ line_kind: 'deal_part', sale_unit: 'piece', quantity: 2 });
    expect(added.get('D2b')).toMatchObject({ line_kind: 'deal_part', sale_unit: 'piece', quantity: 4 });
    expect(added.get('D2c')).toMatchObject({ line_kind: 'deal_part', sale_unit: 'g', quantity: 1_000 });
    expect(engine().diagnostics).toEqual([]);
  });
});
