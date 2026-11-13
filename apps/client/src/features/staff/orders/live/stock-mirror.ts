import type { BranchConfig, ConfigItem, ConfigStockItem, PosEvent } from '@pos/events';
import {
  applyEvent,
  availableStock,
  dayDraws,
  initialEngineState,
  openDayStartMs,
  saleUnitsAvailable,
  stockLevel,
  type EngineLine,
  type EngineState,
  type StockEntry,
} from '@pos/engine';
import type { LiveBus, LiveMessage } from '../../shell/live';
import type { StockLevel, StockMirror } from '../contracts';

// 02b §8 Ordering screen (owner ruling Q-22 (a), 02-client-gaps G2b-12): the device's stock mirror. Seeded from the
// catch-up `stock` part (hub ws/restaurant-catch-up.ts: per stock item on_hand, reserved, set_at, the day's unit,
// level; and the engine BusinessDay) and folded from the Stock* frames with @pos/engine `applyEvent` on a minimal
// EngineState (no orders, no stations), then read with the engine's own availableStock / stockLevel / dayDraws /
// saleUnitsAvailable — the functions the hub's submit and catch-up use, so the chips and the hub agree.
//
// Two things the minimal state needs, both kept inside this file:
//  - A frame carries no recorded_at (hub ws/server.ts deliver). The fold's times (StockSet's set_at, the day's
//    opened_at / closed_at) are stamped with the hub clock at receipt, never earlier than the last stamp or the open
//    day's start, so a count made in the open day stays valid on the device as on the hub (01a S41).
//  - The engine's StockReserved fold adds to `reserved` only for a line the state holds (03a §3.3: an absent line is a
//    no-op). The mirror has no order lines, so before a StockReserved it puts a holder line carrying just that draw
//    (quantity = what it already holds + the reservation, so the fold takes all of it, as the hub's take does for a
//    real line). A later StockReleased / StockConsumed of that line lowers it through the same fold; a holder holding
//    nothing is dropped. A reservation made before the catch-up has no holder: its release lowers the entry only,
//    as the engine does for a line it does not hold.
// Frames: StockSet, StockAdded, StockTransferredOut, StockReserved, StockReleased, StockConsumed (staff sockets,
// hub ws/restaurant-audiences.ts, ws/engine-audiences.ts) and BusinessDayOpened / BusinessDayClosed (the day the
// counts are valid for, 01a S33). Folded non-strict, as the hub folds (AD-6). Logs nothing.

const STOCK_FRAMES = new Set(['StockSet', 'StockAdded', 'StockTransferredOut', 'StockReserved', 'StockReleased', 'StockConsumed']);
const DAY_FRAMES = new Set(['BusinessDayOpened', 'BusinessDayClosed']);

/** The catch-up `stock` part (hub ws/restaurant-catch-up.ts). */
export interface StockCatchUp {
  business_day: EngineState['business_day'];
  business_day_started_at: number | null;
  items: Record<string, { on_hand: number; reserved: number; set_at: number | null; unit: StockEntry['unit']; available: number; level: StockLevel }>;
}

export interface StockMirrorOptions {
  live: LiveBus;
  /** the branch config snapshot (menu items, stock items, stations); null until the first read */
  snapshot: () => BranchConfig | null;
  /** hub-clock ms (apps/client/src/app/hub-clock.ts), never Date.now() */
  hubNow: () => number;
}

export interface DeviceStockMirror extends StockMirror {
  /** true once a catch-up `stock` part was folded in; until then every read is null (unknown, not sold out) */
  ready(): boolean;
  dispose(): void;
}

function isStockCatchUp(v: unknown): v is StockCatchUp {
  return typeof v === 'object' && v !== null && typeof (v as { items?: unknown }).items === 'object' && (v as { items?: unknown }).items !== null;
}

/** The catch-up as an engine state. A stock item the hub reads as not counted keeps no set_at, so the device reads it so too. */
function seed(part: StockCatchUp): EngineState {
  const stock: Record<string, StockEntry> = {};
  for (const [id, row] of Object.entries(part.items)) {
    stock[id] = { on_hand: row.on_hand, reserved: row.reserved, set_at: row.level === 'not_counted' ? null : row.set_at, unit: row.unit };
  }
  return { ...initialEngineState(), stock, business_day: part.business_day ?? null };
}

/** A line the engine's StockReserved / StockReleased / StockConsumed folds can find; it holds only the named draw. */
function holderLine(order_item_id: string, draws: EngineLine['draws']): EngineLine {
  return {
    order_item_id,
    order_id: '',
    group_id: '',
    serve_mode: 'immediate',
    station_id: '',
    alternates: [],
    point_id: null,
    carry_ms: 0,
    units: 1,
    prep_ms: 0,
    cook_ms: 0,
    full_cook_ms: 0,
    from_stock: true,
    program_id: null,
    stock_cook_ms: null,
    stock_program_id: null,
    draws,
    reserved_seq: null,
    weight_pct: 100,
    max_early_ms: 0,
    max_late_ms: null,
    max_carry_ms: null,
    stage: 'added',
    fire_ms: null,
    deadline_ms: 0,
    fired_at: null,
    started_at: null,
    done_at: null,
    mark: null,
    return_of: null,
    load_id: null,
    booked: null,
    capped: false,
    routed_station_id: '',
    expedited: false,
    rounds: null,
    done_undone: false,
  };
}

function withHolder(state: EngineState, p: { stock_item_id: string; order_item_id: string; quantity: number }): EngineState {
  const line = state.lines[p.order_item_id];
  const draws = line?.draws ?? [];
  const i = draws.findIndex((d) => d.stock_item_id === p.stock_item_id);
  const next =
    i < 0
      ? [...draws, { stock_item_id: p.stock_item_id, quantity: p.quantity, reserved: 0 }]
      : draws.map((d, j) => (j === i ? { ...d, quantity: d.reserved + p.quantity } : d));
  return { ...state, lines: { ...state.lines, [p.order_item_id]: line === undefined ? holderLine(p.order_item_id, next) : { ...line, draws: next } } };
}

function dropEmptyHolder(state: EngineState, order_item_id: string): EngineState {
  const line = state.lines[order_item_id];
  if (line === undefined || line.draws.some((d) => d.reserved > 0)) return state;
  const lines = { ...state.lines };
  delete lines[order_item_id];
  return { ...state, lines };
}

// 01c V12: an item is stock-tracked when it draws and has a stock cook time on its station (slot: stock_time_ms;
// batch: a stock program), as the engine's reserveStock reads it.
function isTracked(config: BranchConfig, item: ConfigItem): boolean {
  if (item.stock_draws.length === 0) return false;
  const batch = config.stations.find((s) => s.station_id === item.station_id)?.station_type === 'batch';
  return batch ? item.stock_program_id !== null : item.stock_time_ms !== null;
}

export function createStockMirror(o: StockMirrorOptions): DeviceStockMirror {
  let state: EngineState | null = null;
  let lastStamp = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of [...listeners]) l();
  };

  const stamp = (): number => {
    const day = state?.business_day ?? null;
    const floor = day !== null && day.closed_at === null ? day.opened_at : 0;
    lastStamp = Math.max(Math.floor(o.hubNow()), lastStamp, floor);
    return lastStamp;
  };

  const fold = (seq: number, frame: { event_id: string; event_type: string; schema_version: number; payload: Record<string, unknown> }) => {
    if (state === null) return;
    const at = stamp();
    const stockItem = typeof frame.payload['stock_item_id'] === 'string' ? (frame.payload['stock_item_id'] as string) : '';
    const event: PosEvent = {
      event_id: frame.event_id,
      tenant_id: '',
      branch_id: '',
      stream_type: DAY_FRAMES.has(frame.event_type) ? 'hub' : 'stock',
      stream_id: stockItem,
      event_type: frame.event_type,
      schema_version: frame.schema_version,
      payload: frame.payload,
      occurred_at: at,
      recorded_at: at,
      actor_id: null,
      device_id: '',
      seq,
    };
    const line = typeof frame.payload['order_item_id'] === 'string' ? (frame.payload['order_item_id'] as string) : null;
    let s = state;
    if (frame.event_type === 'StockReserved' && line !== null) {
      s = withHolder(s, { stock_item_id: stockItem, order_item_id: line, quantity: Number(frame.payload['quantity']) });
    }
    s = applyEvent(s, event, { strict: false });
    if (line !== null) s = dropEmptyHolder(s, line);
    // the engine's AD-6 diagnostics are host scratch; the mirror keeps none
    state = s.diagnostics.length === 0 ? s : { ...s, diagnostics: [] };
    notify();
  };

  const onMessage = (m: LiveMessage) => {
    if (m.kind === 'catch_up') {
      const part = (m.state as Record<string, unknown>)['stock'];
      if (!isStockCatchUp(part)) return;
      state = seed(part);
      notify();
    } else if (m.kind === 'event' && (STOCK_FRAMES.has(m.event.event_type) || DAY_FRAMES.has(m.event.event_type))) {
      fold(m.seq, m.event);
    }
  };

  // A mirror created after the socket's catch-up starts from the last one the bus kept.
  const kept = o.live.part('stock');
  if (isStockCatchUp(kept)) state = seed(kept);
  const off = o.live.subscribe(onMessage);

  const tracked = (item_id: string): { config: BranchConfig; item: ConfigItem; s: EngineState } | null => {
    const config = o.snapshot();
    if (config === null || state === null) return null;
    const item = config.items.find((i) => i.item_id === item_id);
    if (item === undefined || !isTracked(config, item)) return null;
    return { config, item, s: state };
  };
  const stockItemOf = (config: BranchConfig, id: string): ConfigStockItem | undefined => config.stock_items.find((s) => s.stock_item_id === id);
  const unitsOf = (config: BranchConfig) => Object.fromEntries(config.stock_items.map((s) => [s.stock_item_id, s.stock_unit]));

  return {
    ready: () => state !== null,
    available(item_id) {
      const t = tracked(item_id);
      if (t === null) return null;
      const draws = dayDraws(t.s, t.item, unitsOf(t.config)).stock_draws;
      if (draws.length === 0) return null;
      const start = openDayStartMs(t.s);
      return Math.min(
        ...draws.map((d) => {
          const stockItem = stockItemOf(t.config, d.stock_item_id);
          // a draw on a stock item the config does not list reads as available 0 (engine reserveStock)
          const free = stockItem === undefined ? 0 : availableStock(t.s, d.stock_item_id, start, stockItem);
          return saleUnitsAvailable(free, d.quantity_per_sale_unit);
        }),
      );
    },
    level(item_id) {
      const t = tracked(item_id);
      if (t === null) return null;
      const draws = dayDraws(t.s, t.item, unitsOf(t.config)).stock_draws;
      // 01c: one draw per item (stock_draws .max(1)); its stock item's level is the item's
      const draw = draws[0];
      if (draw === undefined) return null;
      const stockItem = stockItemOf(t.config, draw.stock_item_id);
      if (stockItem === undefined) return 'out';
      return stockLevel(t.s, draw.stock_item_id, openDayStartMs(t.s), stockItem);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose: off,
  };
}
