import type { BranchConfig } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { describe, expect, it, vi } from 'vitest';
import type { HubClock } from '../../../../app/hub-clock';
import { createLiveBus } from '../../shell/live';
import type { StockLevel, StockMirror } from '../contracts';
import { createAvailability, itemAvailability, optionAvailability, type AvailabilityInputs } from './availability';
import { createStockMirror } from './stock-mirror';

const HOUR = 3_600_000;
// 2025-10-20 00:00 UTC; utc offset 0, so the local time of day is T's offset from here
const MIDNIGHT = Date.UTC(2025, 9, 20);
const T = MIDNIGHT + 12 * HOUR;

// I1 sold_out (K1, 500 g a piece), I2 cook_fresh, not tracked; I4 linked from an option of group G1 on I2.
function cfg(over: Partial<BranchConfig> = {}): BranchConfig {
  const base = aBranchConfig();
  return {
    ...base,
    stock_items: base.stock_items.map((s) => ({ ...s, low_stock_threshold: 1_500 })),
    items: [
      ...base.items.map((i) => (i.item_id === 'I1' ? { ...i, out_of_stock_behaviour: 'sold_out' as const } : i)),
      { ...base.items.find((i) => i.item_id === 'I2')!, item_id: 'I4', name: 'Raita', sort_order: 4 },
    ],
    modifier_groups: [
      {
        modifier_group_id: 'G1',
        name: 'Side',
        min_choices: 0,
        max_choices: 1,
        sort_order: 1,
        has_plain_options: false,
        options: [{ option_id: 'OP1', name: 'Raita', price_minor: 4_000, max_quantity: 1, is_default: false, linked_item_id: 'I4', sort_order: 1 }],
      },
    ],
    ...over,
  };
}

function fakeStock(units: Record<string, number | null>, levels: Record<string, StockLevel | null> = {}): StockMirror {
  return { available: (id) => units[id] ?? null, level: (id) => levels[id] ?? null, subscribe: () => () => {} };
}

function inputs(o: Partial<AvailabilityInputs> = {}): AvailabilityInputs {
  return {
    config: cfg(),
    stock: fakeStock({ I1: 10, I3: 5 }, { I1: 'ok', I3: 'ok' }),
    off: new Set(),
    nowMs: T,
    utcOffsetMs: 0,
    slowThresholdMs: 900_000,
    stationWaitMs: () => 0,
    ...o,
  };
}

const clockAt = (now: () => number): HubClock => ({ nowMs: now, utcOffsetMs: 0 });

describe('[02b §8 Ordering screen] availability', () => {
  it('[02b #36] sold out flips on the stock frame itself (no timer, E2-SOLD AC3)', () => {
    const live = createLiveBus();
    const config = cfg();
    const stock = createStockMirror({ live, snapshot: () => config, hubNow: () => T });
    const intervals: Array<() => void> = [];
    const availability = createAvailability({
      live,
      config: { snapshot: () => config, config: () => null, subscribe: () => () => {} },
      stock,
      clock: () => clockAt(() => T),
      setInterval: (fn) => intervals.push(fn),
      clearInterval: () => {},
    });
    const seen: string[] = [];
    availability.subscribe(() => seen.push(availability.item('I1')!.state.kind));
    const day = { business_date: '2025-10-20', opened_at: T - HOUR, closed_at: null, stock_units: { K1: 'g' }, draws: {} };
    live.frame({ type: 'catch_up', as_of_seq: 10, state: { stock: { business_day: day, business_day_started_at: T - HOUR, items: { K1: { on_hand: 500, reserved: 0, set_at: T - 1_000, unit: 'g', available: 500, level: 'low' } } } } });
    expect(availability.item('I1')).toEqual({ state: { kind: 'left', n: 1 }, orderable: true, cap: 1 });
    // another device's order takes the last one: the StockReserved frame alone flips the tile, no timer ran
    live.frame({ type: 'event', seq: 11, event: { event_id: 'E11', event_type: 'StockReserved', schema_version: 1, payload: { stock_item_id: 'K1', order_item_id: 'X1', quantity: 500 } } });
    expect(intervals).toHaveLength(1); // only the minute re-check exists, and it never fired
    expect(availability.item('I1')).toEqual({ state: { kind: 'sold_out' }, orderable: false, cap: 0 });
    expect(seen.at(-1)).toBe('sold_out');
    // a manual Off frame
    live.frame({ type: 'event', seq: 12, event: { event_id: 'E12', event_type: 'ItemMadeUnavailable', schema_version: 1, payload: { item_id: 'I2' } } });
    expect(availability.item('I2')!.state.kind).toBe('off');
    live.frame({ type: 'event', seq: 13, event: { event_id: 'E13', event_type: 'ItemMadeAvailable', schema_version: 1, payload: { item_id: 'I2' } } });
    expect(availability.item('I2')!.state.kind).toBe('ok');
    availability.dispose();
  });

  it('[02b #36] slow chip from slow_item_threshold_ms (station wait + cook time)', () => {
    // I2: cook 20 min; threshold 15 min
    expect(itemAvailability('I2', inputs({ stationWaitMs: () => 0 })).state).toEqual({ kind: 'slow', minutes: 20 });
    expect(itemAvailability('I2', inputs({ slowThresholdMs: 1_500_000, stationWaitMs: () => 300_000 })).state).toEqual({ kind: 'ok' });
    expect(itemAvailability('I2', inputs({ slowThresholdMs: 1_500_000, stationWaitMs: () => 330_000 })).state).toEqual({ kind: 'slow', minutes: 26 });
    // I1 is served from the pot: stock time 5 min + wait 9 min stays under 15 min
    expect(itemAvailability('I1', inputs({ stationWaitMs: () => 540_000 })).state).toEqual({ kind: 'ok' });
    // no wait known → no chip
    expect(itemAvailability('I2', inputs({ stationWaitMs: () => null })).state).toEqual({ kind: 'ok' });
  });

  it('[02b #36] "Only 2 left" caps the stepper (O15)', () => {
    const low = itemAvailability('I1', inputs({ stock: fakeStock({ I1: 2 }, { I1: 'low' }) }));
    expect(low).toEqual({ state: { kind: 'left', n: 2 }, orderable: true, cap: 2 });
    // not low: no chip, still capped
    expect(itemAvailability('I1', inputs({ stock: fakeStock({ I1: 7 }, { I1: 'ok' }), stationWaitMs: () => null }))).toEqual({ state: { kind: 'ok' }, orderable: true, cap: 7 });
    expect(itemAvailability('I1', inputs({ stock: fakeStock({ I1: 0 }, { I1: 'out' }) }))).toEqual({ state: { kind: 'sold_out' }, orderable: false, cap: 0 });
    expect(itemAvailability('I1', inputs({ stock: fakeStock({ I1: 0 }, { I1: 'not_counted' }) })).state).toEqual({ kind: 'not_counted' });
    // a cook_fresh tracked item (I3) cooks fresh when the pot is out: no cap, no stock chip
    expect(itemAvailability('I3', inputs({ stock: fakeStock({ I3: 0 }, { I3: 'out' }), stationWaitMs: () => null }))).toEqual({ state: { kind: 'ok' }, orderable: true, cap: null });
    // the mirror not ready yet: unknown is not sold out
    expect(itemAvailability('I1', inputs({ stock: fakeStock({}), stationWaitMs: () => null })).orderable).toBe(true);
  });

  it('[02b §8 Ordering screen] Not now · hours from config windows on the hub clock, re-checked each minute', () => {
    vi.useFakeTimers();
    try {
      const breakfast = [{ start_ms: 7 * HOUR, end_ms: 11 * HOUR }];
      const config = cfg({ categories: [{ category_id: 'C1', name: 'Breakfast', sort_order: 1, availability_windows: breakfast }] });
      let now = MIDNIGHT + 6 * HOUR + 59 * 60_000 + 30_000; // 06:59:30 hub time
      const live = createLiveBus();
      const availability = createAvailability({
        live,
        config: { snapshot: () => config, config: () => null, subscribe: () => () => {} },
        stock: fakeStock({}),
        clock: () => clockAt(() => now),
      });
      expect(availability.item('I2')).toEqual({ state: { kind: 'not_now', windows: breakfast }, orderable: false, cap: null });
      const kinds: string[] = [];
      availability.subscribe(() => kinds.push(availability.item('I2')!.state.kind));
      now += 60_000; // 07:00:30
      vi.advanceTimersByTime(60_000);
      expect(kinds).toEqual(['ok']);
      // the item's own window, outside, wins with its own hours
      const own = [{ start_ms: 18 * HOUR, end_ms: 23 * HOUR }];
      expect(itemAvailability('I2', inputs({ config: cfg({ items: cfg().items.map((i) => (i.item_id === 'I2' ? { ...i, availability_windows: own } : i)) }) })).state).toEqual({ kind: 'not_now', windows: own });
      availability.dispose();
      vi.advanceTimersByTime(60_000);
      expect(kinds).toEqual(['ok']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('[02b §8 Ordering screen] a linked option off with its reason', () => {
    expect(optionAvailability({ linked_item_id: null }, inputs())).toEqual({ on: true });
    expect(optionAvailability({ linked_item_id: 'I4' }, inputs())).toEqual({ on: true });
    expect(optionAvailability({ linked_item_id: 'I4' }, inputs({ off: new Set(['I4']) }))).toEqual({ on: false, reason: 'off' });
    expect(optionAvailability({ linked_item_id: 'I1' }, inputs({ stock: fakeStock({ I1: 0 }, { I1: 'out' }) }))).toEqual({ on: false, reason: 'sold_out' });
    expect(optionAvailability({ linked_item_id: 'I1' }, inputs({ stock: fakeStock({ I1: 0 }, { I1: 'not_counted' }) }))).toEqual({ on: false, reason: 'not_counted' });
    const late = cfg({ items: cfg().items.map((i) => (i.item_id === 'I4' ? { ...i, availability_windows: [{ start_ms: 18 * HOUR, end_ms: 23 * HOUR }] } : i)) });
    expect(optionAvailability({ linked_item_id: 'I4' }, inputs({ config: late }))).toEqual({ on: false, reason: 'not_now' });
    // a required group whose only option is off makes its item not available
    const required = cfg({ modifier_groups: cfg().modifier_groups.map((g) => ({ ...g, min_choices: 1 })), items: cfg().items.map((i) => (i.item_id === 'I2' ? { ...i, modifier_group_ids: ['G1'] } : i)) });
    expect(itemAvailability('I2', inputs({ config: required, off: new Set(['I4']) })).state).toEqual({ kind: 'unavailable' });
    expect(itemAvailability('I2', inputs({ config: required, stationWaitMs: () => null })).state).toEqual({ kind: 'ok' });
  });
});
