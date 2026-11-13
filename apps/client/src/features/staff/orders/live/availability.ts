import { inAvailabilityWindows, isDealOrderable, isItemOrderable, isOrderableByTime, localTimeOfDayMs, type AvailabilityWindow, type IsAvailable } from '@pos/domain';
import type { BranchConfig, ConfigItem } from '@pos/events';
import type { HubClock } from '../../../../app/hub-clock';
import type { ShellConfig } from '../../shell/config';
import type { LiveBus, LiveMessage } from '../../shell/live';
import type { StockMirror } from '../contracts';

// 02b §8 Ordering screen, §10 #36 (handoff 02b-C01 / 02-B06, CHANGES §2 Q1, Q9): what a menu tile, a linked option
// and a deal tile show, from the branch config, the device stock mirror (26a, Q-22), the manual Off list (catch-up
// `availability` + ItemMadeUnavailable / ItemMadeAvailable frames), the windows on the hub clock (S47) and the
// stations' wait (catch-up `stations_live`, 03a §6.5). One chip per tile, in this order:
//   off          manual Off (01a S30: Off wins over every window)                 → "Not available"
//   not_now      outside its own or its category's windows (S47)                   → "Not now · {window}"
//   unavailable  a required group no option can satisfy (01c §3.4.6, V11 d)        → "Not available"
//   not_counted  a sold_out item whose stock has no valid count today (S41, Q1)    → "Not counted today"
//   sold_out     a sold_out item with 0 sale units left (O15)                      → "Sold out"
//   left         a sold_out item at `low` (Q1: "N left" only at low)              → "{n} left"
//   slow         station wait + cook time past slow_item_threshold_ms (Q9)         → "{n} min"
// `cap` is the stepper's maximum (O15 "Only 2 left"): the sale units left for a sold_out stock-tracked item, else
// null (a cook_fresh item cooks fresh when the stock runs out, 01a S32). Sold out flips on the stock frame itself
// (the mirror notifies, E2-SOLD AC3); the windows are re-checked once a minute on the hub clock.

export type TileState =
  | { kind: 'ok' }
  | { kind: 'off' }
  | { kind: 'not_now'; windows: AvailabilityWindow[] }
  | { kind: 'unavailable' }
  | { kind: 'not_counted' }
  | { kind: 'sold_out' }
  | { kind: 'left'; n: number }
  | { kind: 'slow'; minutes: number };

export interface ItemAvailability {
  state: TileState;
  /** false for off, not_now, unavailable, not_counted, sold_out */
  orderable: boolean;
  /** the stepper's maximum; null = no stock cap */
  cap: number | null;
}

export type OptionAvailability = { on: true } | { on: false; reason: 'off' | 'not_now' | 'unavailable' | 'not_counted' | 'sold_out' };

export interface AvailabilityInputs {
  config: BranchConfig;
  stock: StockMirror;
  /** items switched Off by hand */
  off: ReadonlySet<string>;
  nowMs: number;
  utcOffsetMs: number;
  /** engine_settings.slow_item_threshold_ms; null = no slow chip */
  slowThresholdMs: number | null;
  /** the station's wait_ms from stations_live; null when not known */
  stationWaitMs: (station_id: string) => number | null;
}

const MINUTE_MS = 60_000;

function itemOf(inp: AvailabilityInputs, item_id: string): ConfigItem | undefined {
  return inp.config.items.find((i) => i.item_id === item_id);
}

function categoryWindows(inp: AvailabilityInputs, category_id: string): AvailabilityWindow[] | null {
  return inp.config.categories.find((c) => c.category_id === category_id)?.availability_windows ?? null;
}

/** S47: the windows that keep the entity out now (its own first, else its category's); null = orderable by time. */
function blockingWindows(inp: AvailabilityInputs, entity: { availability_windows: AvailabilityWindow[]; category_id: string }): AvailabilityWindow[] | null {
  const cat = categoryWindows(inp, entity.category_id);
  if (isOrderableByTime(entity, cat === null ? null : { availability_windows: cat }, inp.nowMs, inp.utcOffsetMs)) return null;
  const t = localTimeOfDayMs(inp.nowMs, inp.utcOffsetMs);
  return inAvailabilityWindows(entity.availability_windows, t) ? (cat ?? []) : entity.availability_windows;
}

/** 01c §3.4.6: on, inside its windows and (a sold_out item) not short of `quantity` sale units. */
function isAvailableFn(inp: AvailabilityInputs): IsAvailable {
  return (item_id, quantity) => {
    const item = itemOf(inp, item_id);
    if (item === undefined || inp.off.has(item_id) || blockingWindows(inp, item) !== null) return false;
    if (item.out_of_stock_behaviour !== 'sold_out') return true;
    const left = inp.stock.available(item_id);
    return left === null || left >= quantity;
  };
}

function groupsById(config: BranchConfig) {
  return Object.fromEntries(config.modifier_groups.map((g) => [g.modifier_group_id, g]));
}
function itemsById(config: BranchConfig) {
  return Object.fromEntries(config.items.map((i) => [i.item_id, i]));
}

const closed = (state: TileState): ItemAvailability => ({ state, orderable: false, cap: state.kind === 'sold_out' || state.kind === 'not_counted' ? 0 : null });

export function itemAvailability(item_id: string, inp: AvailabilityInputs): ItemAvailability {
  const item = itemOf(inp, item_id);
  if (item === undefined || inp.off.has(item_id)) return closed({ kind: 'off' });
  const windows = blockingWindows(inp, item);
  if (windows !== null) return closed({ kind: 'not_now', windows });
  // its groups: the item itself is checked above (Off, windows) and below (stock); its linked children with their stock
  const others = isAvailableFn(inp);
  const groupsOk: IsAvailable = (id, quantity) => id === item_id || others(id, quantity);
  if (!isItemOrderable(item, groupsById(inp.config), itemsById(inp.config), 'line', 1, groupsOk)) return closed({ kind: 'unavailable' });

  const left = inp.stock.available(item_id);
  const level = inp.stock.level(item_id);
  let cap: number | null = null;
  if (item.out_of_stock_behaviour === 'sold_out' && left !== null) {
    if (level === 'not_counted') return closed({ kind: 'not_counted' });
    if (left === 0) return closed({ kind: 'sold_out' });
    cap = left;
    if (level === 'low') return { state: { kind: 'left', n: left }, orderable: true, cap };
  }

  // Q9: station wait + cook time; the stock cook time when the stock can serve one now (01c V12).
  const wait = inp.stationWaitMs(item.station_id);
  if (inp.slowThresholdMs !== null && wait !== null) {
    const cook = left !== null && left >= 1 && item.stock_time_ms !== null ? item.stock_time_ms : item.cook_time_ms;
    const total = wait + cook;
    if (total > inp.slowThresholdMs) return { state: { kind: 'slow', minutes: Math.ceil(total / MINUTE_MS) }, orderable: true, cap };
  }
  return { state: { kind: 'ok' }, orderable: true, cap };
}

/** handoff 02-D04: a linked option is off, with its reason, when its item is not orderable now; a plain option is on. */
export function optionAvailability(option: { linked_item_id: string | null }, inp: AvailabilityInputs): OptionAvailability {
  if (option.linked_item_id === null) return { on: true };
  const { state, orderable } = itemAvailability(option.linked_item_id, inp);
  if (orderable) return { on: true };
  const reason = state.kind === 'off' || state.kind === 'not_now' || state.kind === 'not_counted' || state.kind === 'sold_out' ? state.kind : 'unavailable';
  return { on: false, reason };
}

/** A deal tile: outside its (or its category's) windows → not_now; a part with no orderable choice → unavailable. */
export function dealAvailability(deal_id: string, inp: AvailabilityInputs): ItemAvailability {
  const deal = inp.config.deals.find((d) => d.deal_id === deal_id);
  if (deal === undefined) return closed({ kind: 'off' });
  const windows = blockingWindows(inp, deal);
  if (windows !== null) return closed({ kind: 'not_now', windows });
  if (!isDealOrderable(deal, 1, groupsById(inp.config), itemsById(inp.config), isAvailableFn(inp), true)) return closed({ kind: 'unavailable' });
  return { state: { kind: 'ok' }, orderable: true, cap: null };
}

// ------------------------------------------------------------------------------------------- live inputs

export interface Availability {
  /** null until the branch config and the hub clock are known */
  inputs(): AvailabilityInputs | null;
  item(item_id: string): ItemAvailability | null;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export interface AvailabilityOptions {
  live: LiveBus;
  config: Pick<ShellConfig, 'snapshot' | 'config' | 'subscribe'>;
  stock: StockMirror;
  clock: () => HubClock | null;
  /** injectable for tests; default the global timers */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

function offIds(part: unknown): string[] | null {
  const ids = (part as { unavailable_item_ids?: unknown } | undefined)?.unavailable_item_ids;
  return Array.isArray(ids) && ids.every((id) => typeof id === 'string') ? (ids as string[]) : null;
}

function waits(part: unknown): Map<string, number> | null {
  const stations = (part as { stations?: unknown } | undefined)?.stations;
  if (!Array.isArray(stations)) return null;
  const out = new Map<string, number>();
  for (const s of stations as Array<{ station_id?: unknown; wait_ms?: unknown }>) {
    if (typeof s.station_id === 'string' && typeof s.wait_ms === 'number') out.set(s.station_id, s.wait_ms);
  }
  return out;
}

export function createAvailability(o: AvailabilityOptions): Availability {
  let off = new Set(offIds(o.live.part('availability')) ?? []);
  let stationWaits = waits(o.live.part('stations_live')) ?? new Map<string, number>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of [...listeners]) l();
  };

  const onMessage = (m: LiveMessage) => {
    if (m.kind === 'catch_up') {
      const ids = offIds(m.state['availability']);
      if (ids !== null) off = new Set(ids);
      const w = waits(m.state['stations_live']);
      if (w !== null) stationWaits = w;
      notify();
    } else if (m.kind === 'event' && (m.event.event_type === 'ItemMadeUnavailable' || m.event.event_type === 'ItemMadeAvailable')) {
      const id = m.event.payload['item_id'];
      if (typeof id !== 'string') return;
      off = new Set(off);
      if (m.event.event_type === 'ItemMadeUnavailable') off.add(id);
      else off.delete(id);
      notify();
    }
  };
  const stops = [o.live.subscribe(onMessage), o.stock.subscribe(notify), o.config.subscribe(notify)];
  // S47: the windows are read on the hub clock; a tile turns "Not now" (or back) within the minute.
  const every = o.setInterval ?? ((fn: () => void, ms: number) => globalThis.setInterval(fn, ms));
  const stop = o.clearInterval ?? ((h: unknown) => globalThis.clearInterval(h as ReturnType<typeof globalThis.setInterval>));
  const tick = every(notify, MINUTE_MS);

  const inputs = (): AvailabilityInputs | null => {
    const config = o.config.snapshot();
    const clock = o.clock();
    if (config === null || clock === null) return null;
    return {
      config,
      stock: o.stock,
      off,
      nowMs: clock.nowMs(),
      utcOffsetMs: clock.utcOffsetMs,
      slowThresholdMs: o.config.config()?.slow_item_threshold_ms ?? null,
      stationWaitMs: (id) => stationWaits.get(id) ?? null,
    };
  };
  return {
    inputs,
    item(item_id) {
      const inp = inputs();
      return inp === null ? null : itemAvailability(item_id, inp);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose() {
      for (const s of stops) s();
      stop(tick);
    },
  };
}
