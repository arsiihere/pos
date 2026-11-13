import type { ConfigStockItem, PosEvent } from '@pos/events';
import { aBranchConfig, aStockAdded, aStockConsumed, aStockReleased, aStockReserved, aStockSet, anEngineConfigApplied, anItemStarted, anOrderBatch } from '@pos/events/testing';
import {
  applyEvent,
  availableStock,
  dayDraws,
  dayStockUnit,
  initialEngineState,
  openDayStartMs,
  saleUnitsAvailable,
  stockLevel,
  stockOf,
  type EngineState,
} from '@pos/engine';
import { describe, expect, it } from 'vitest';
import { createLiveBus } from '../../shell/live';
import { createStockMirror, type StockCatchUp } from './stock-mirror';

// Fixture: aBranchConfig — stock item K1 "Karahi pot" in g; I1 Half draws 500 g, I3 Full draws 1 000 g (slot station
// S1, stock_time_ms set → tracked); I2 is not stock-tracked.
const config = aBranchConfig();
const K1 = config.stock_items.find((s) => s.stock_item_id === 'K1') as ConfigStockItem;
const T = 1_761_000_000_000;
const DAY = T - 3_600_000;

let seq = 100;
const stamp = (e: PosEvent, at: number): PosEvent => {
  seq += 1;
  return { ...e, seq, recorded_at: at, occurred_at: at, event_id: `E${seq}` };
};
const dayOpened = (at: number): PosEvent =>
  stamp(
    {
      ...aStockSet(),
      stream_type: 'hub',
      stream_id: 'B1',
      event_type: 'BusinessDayOpened',
      schema_version: 2,
      payload: {
        business_date: '2025-10-21',
        stock_units: { K1: 'g' },
        draws: {
          I1: { sale_unit: 'piece', stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 500 }] },
          I3: { sale_unit: 'piece', stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 1_000 }] },
        },
      },
    },
    at,
  );
const set = (on_hand: number, at: number) => stamp(aStockSet({ stream_id: 'K1', payload: { stock_item_id: 'K1', on_hand, unit: 'g' } }), at);
const added = (quantity: number, at: number) => stamp(aStockAdded({ stream_id: 'K1', payload: { stock_item_id: 'K1', quantity, unit: 'g' } }), at);
const transferred = (quantity: number, at: number) =>
  stamp({ ...aStockSet({ stream_id: 'K1' }), event_type: 'StockTransferredOut', schema_version: 1, payload: { stock_item_id: 'K1', quantity, zone_id: 'Z1' } }, at);
const reserved = (line: string, quantity: number, at: number) => stamp(aStockReserved({ payload: { stock_item_id: 'K1', order_item_id: line, quantity } }), at);
const released = (line: string, quantity: number, at: number) => stamp(aStockReleased({ payload: { stock_item_id: 'K1', order_item_id: line, quantity, reason: 'voided' } }), at);
const consumed = (line: string, quantity: number, at: number) => stamp(aStockConsumed({ payload: { stock_item_id: 'K1', order_item_id: line, quantity } }), at);
const started = (order_id: string, line: string, at: number) =>
  stamp({ ...anItemStarted(), stream_id: order_id, payload: { order_item_id: line, started_at: at, source: 'tap' } }, at);
// The submit batch without its StockReserved (sent below as its own frame): OrderPlaced + ItemAdded of a from-stock line.
const order = (order_id: string, line: string, draw: number, at: number): PosEvent[] =>
  anOrderBatch({
    order_id,
    lines: [{ order_item_id: line, item: { name: 'Chicken Karahi', quantity: 1, stock_time_ms: 300_000, stock_draws: [{ stock_item_id: 'K1', quantity: draw }], out_of_stock_behaviour: 'sold_out' }, line: { from_stock: true } }],
  }).map((e) => stamp(e, at));

// The hub side: the full engine state (orders and lines), as the hub folds it.
const hubFold = (s: EngineState, events: PosEvent[]) => events.reduce((acc, e) => applyEvent(acc, e, { strict: true }), s);
const hubUnits = (s: EngineState, item_id: string) => {
  const item = config.items.find((i) => i.item_id === item_id)!;
  const draw = dayDraws(s, item, { K1: 'g' }).stock_draws[0]!;
  return saleUnitsAvailable(availableStock(s, 'K1', openDayStartMs(s), K1), draw.quantity_per_sale_unit);
};
// The catch-up `stock` part exactly as hub ws/restaurant-catch-up.ts builds it.
const catchUpOf = (s: EngineState): StockCatchUp => {
  const start = openDayStartMs(s);
  const entry = stockOf(s, 'K1');
  return {
    business_day: s.business_day,
    business_day_started_at: start,
    items: { K1: { on_hand: entry.on_hand, reserved: entry.reserved, set_at: entry.set_at, unit: dayStockUnit(s, K1), available: availableStock(s, 'K1', start, K1), level: stockLevel(s, 'K1', start, K1) } },
  };
};
const frameOf = (e: PosEvent) => ({ type: 'event' as const, seq: e.seq, event: { event_id: e.event_id, event_type: e.event_type, schema_version: e.schema_version, payload: e.payload } });

function device(hub: EngineState, now: () => number) {
  const live = createLiveBus();
  const mirror = createStockMirror({ live, snapshot: () => config, hubNow: now });
  live.frame({ type: 'catch_up', as_of_seq: seq, state: { stock: catchUpOf(hub) } });
  return { live, mirror };
}

describe('[02b Q-22] stock mirror', () => {
  it('[02b Q-22] FIRST: a mirror seeded from catch-up stock and folded with @pos/engine over StockSet / StockAdded / StockTransferredOut / StockReserved / StockReleased / StockConsumed matches saleUnitsAvailable', () => {
    let now = T;
    let hub = hubFold(initialEngineState(), [stamp(anEngineConfigApplied(), DAY - 60_000), dayOpened(DAY), set(5_000, DAY + 1)]);
    const a = device(hub, () => now); // seeded before any reservation
    let b: ReturnType<typeof device> | null = null; // seeded while L1 holds 1 000 g
    const devices = () => [a, ...(b === null ? [] : [b])];
    const step = (hubOnly: PosEvent[], frames: PosEvent[]) => {
      hub = hubFold(hub, [...hubOnly, ...frames]);
      for (const d of devices()) for (const f of frames) d.live.frame(frameOf(f));
      for (const d of devices()) {
        expect(d.mirror.available('I1')).toBe(hubUnits(hub, 'I1'));
        expect(d.mirror.available('I3')).toBe(hubUnits(hub, 'I3'));
        expect(d.mirror.level('I1')).toBe(stockLevel(hub, 'K1', openDayStartMs(hub), K1));
      }
    };
    expect(a.mirror.available('I1')).toBe(10);
    expect(a.mirror.available('I2')).toBeNull(); // not stock-tracked
    now = T + 1_000;
    step(order('O1', 'L1', 1_000, now), [reserved('L1', 1_000, now)]);
    expect(a.mirror.available('I3')).toBe(4);
    b = device(hub, () => now);
    now += 1_000;
    step([], [added(500, now)]);
    now += 1_000;
    step([], [transferred(1_000, now)]);
    now += 1_000;
    step(order('O2', 'L2', 500, now), [reserved('L2', 500, now)]);
    now += 1_000;
    step([started('O1', 'L1', now)], [consumed('L1', 1_000, now)]); // b never saw L1's reservation
    now += 1_000;
    step([], [released('L2', 500, now)]);
    now += 1_000;
    step([], [set(1_200, now)]); // a recount
    expect(a.mirror.available('I1')).toBe(2);
    expect(b!.mirror.available('I1')).toBe(2);
  });

  it('[02b Q-22] reads null until the catch-up `stock` part; a reconnect catch-up replaces the mirror', () => {
    const live = createLiveBus();
    const mirror = createStockMirror({ live, snapshot: () => config, hubNow: () => T });
    expect(mirror.ready()).toBe(false);
    expect(mirror.available('I1')).toBeNull();
    expect(mirror.level('I1')).toBeNull();
    const hub = hubFold(initialEngineState(), [stamp(anEngineConfigApplied(), DAY - 60_000), dayOpened(DAY), set(1_000, DAY + 1)]);
    live.frame({ type: 'catch_up', as_of_seq: seq, state: { stock: catchUpOf(hub) } });
    expect(mirror.available('I1')).toBe(2);
    live.frame({ type: 'catch_up', as_of_seq: seq + 1, state: { stock: catchUpOf(hubFold(hub, [set(3_000, DAY + 2)])) } });
    expect(mirror.available('I1')).toBe(6);
  });

  it('[02b Q-22] a count from before the open day reads as not counted (01a S41), as the hub reads it', () => {
    const hub = hubFold(initialEngineState(), [set(5_000, DAY - 10), dayOpened(DAY)]);
    const { mirror } = device(hub, () => T);
    expect(mirror.level('I1')).toBe('not_counted');
    expect(mirror.available('I1')).toBe(0);
  });

  it('[02b §8 Ordering screen] saleUnit: the open day\'s frozen unit (01c V20), the config\'s until seeded; null off the menu', () => {
    const live = createLiveBus();
    const mirror = createStockMirror({ live, snapshot: () => config, hubNow: () => T });
    expect(mirror.saleUnit('I1')).toBe('piece'); // not seeded: the config's
    expect(mirror.saleUnit('NOPE')).toBeNull();
    const day = { business_date: '2025-10-21', opened_at: DAY, closed_at: null, stock_units: { K1: 'g' }, draws: { I1: { sale_unit: 'g', stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 1 }] } } };
    live.frame({ type: 'catch_up', as_of_seq: 1, state: { stock: { business_day: day, business_day_started_at: DAY, items: {} } } });
    expect(mirror.saleUnit('I1')).toBe('g');
    expect(mirror.saleUnit('I2')).toBe('piece'); // nothing frozen for it
  });
});
