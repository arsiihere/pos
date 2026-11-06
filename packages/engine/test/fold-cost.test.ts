// 03a §7.1 (upkeep "O(lines of the touched keys) + O(open keys) per fold … no per-event scan in replay"), §3.8 touched
// keys only, §3.3 copy-on-write. Task 18p: the folds name what they touched, so the scan cannot come back. Counted reads
// on a Proxy over `lines`, never a wall clock. The per-key = full recompute check itself is slip.test.ts #92 / #106.
import type { PosEvent } from '@pos/events';
import { describe, expect, it } from 'vitest';
import { foldNamed } from '../src/apply-event';
import { applyEvent, initialEngineState, type EngineLine, type EngineOrder, type EngineState } from '../src/index';
import { exitedOrderIds, FoldScope } from '../src/lifecycle';
import { upkeepSlips } from '../src/slip';
import { generateDay, runDay } from './sim/index';

const UNRELATED = 2_000;

type Counted = { lines: Record<string, EngineLine>; gets: () => number; read: Set<string> };

function counted(lines: Record<string, EngineLine>): Counted {
  let gets = 0;
  const read = new Set<string>();
  const proxy = new Proxy(lines, {
    get(target, key, receiver) {
      if (typeof key === 'string') {
        gets++;
        read.add(key);
      }
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  return { lines: proxy, gets: () => gets, read };
}

// `state` with 2 000 lines of unrelated orders on their own table keys: hidden, on a real station, no in-flight line.
function withUnrelated(state: EngineState): EngineState {
  const sample = Object.values(state.orders)[0]!;
  const station_id = Object.keys(state.stations)[0]!;
  const line0 = Object.values(state.lines)[0]!;
  const lines: Record<string, EngineLine> = { ...state.lines };
  const orders: Record<string, EngineOrder> = { ...state.orders };
  for (let i = 0; i < UNRELATED; i++) {
    const id = `pad-line-${i}`;
    const order_id = `pad-order-${i}`;
    lines[id] = { ...line0, order_item_id: id, order_id, group_id: `${order_id}:0`, station_id, routed_station_id: station_id, stage: 'added', units: 1, fire_ms: sample.placed_at + 86_400_000, fired_at: null, started_at: null, done_at: null, booked: null, load_id: null };
    orders[order_id] = { ...sample, order_id, table_key: `pad-key-${i}`, line_ids: [id], awaiting: 0, last_served_at: null, groups: {} };
  }
  return { ...state, lines, orders };
}

const log = runDay(generateDay(7, { orders: 40 })).events;

// The state before the first event of the log that `pick` accepts.
function before(pick: (state: EngineState, e: PosEvent) => boolean): { state: EngineState; event: PosEvent } {
  let state = initialEngineState();
  for (const event of log) {
    if (pick(state, event)) return { state, event };
    state = applyEvent(state, event);
  }
  throw new Error('no such event in the log');
}

const isInFlight = (l: EngineLine): boolean => l.stage === 'cooking' || (l.stage === 'added' && l.fired_at !== null);

// A new order on a table key of its own, while other orders are open and none exits (the removal step touches the keys of
// what it removes): no in-flight line changes and none is on its key.
const quietFold = (s: EngineState, e: PosEvent): boolean =>
  e.event_type === 'OrderPlaced' && Object.keys(s.orders).length >= 5 && exitedOrderIds(s, e.recorded_at).length === 0 && !Object.values(s.orders).some((o) => o.table_key === (e.payload as { table_key: string }).table_key);

const doneFold = (s: EngineState, e: PosEvent): boolean => e.event_type === 'ItemDone' && Object.values(s.lines).filter(isInFlight).length >= 2;

describe('[03a §7.1] fold cost', () => {
  it('[03a §7.1] a fold with no in-flight change: upkeep reads no line outside the touched keys', () => {
    const { state, event } = before(quietFold);
    const prev = withUnrelated(state);
    const { next, named } = foldNamed(prev, event, {});
    const a = counted(prev.lines);
    const b = counted(next.lines);
    upkeepSlips({ ...prev, lines: a.lines }, { ...next, lines: b.lines }, event.recorded_at, named);
    const key = (event.payload as { table_key: string }).table_key;
    const allowed = new Set(Object.values(next.orders).filter((o) => o.table_key === key).flatMap((o) => o.line_ids));
    for (const id of [...a.read, ...b.read]) expect(allowed).toContain(id);
  });

  it('[03a §7.1, BF-14 (b)] a fold that changes an in-flight line: one pass at most, shared by the touched keys and the packing', () => {
    // v3 keeps no per-station list of in-flight lines, so finding the fired-not-started lines of a station is one read of
    // each line. Reported in task 18p: this is the one scan left, at most once per fold.
    const { state, event } = before(doneFold);
    const prev = withUnrelated(state);
    const { next, named } = foldNamed(prev, event, {});
    const a = counted(prev.lines);
    const b = counted(next.lines);
    upkeepSlips({ ...prev, lines: a.lines }, { ...next, lines: b.lines }, event.recorded_at, named);
    const n = Object.keys(next.lines).length;
    expect(a.gets()).toBeLessThan(50);
    expect(b.gets()).toBeLessThan(n + 500);
  });

  it.each([
    ['no in-flight change', quietFold],
    ['in-flight change', doneFold],
  ] as const)('[03a §7.1] applyEvent reads the input lines once, for its one copy (%s)', (_name, pick) => {
    const { state, event } = before(pick);
    const prev = withUnrelated(state);
    const c = counted(prev.lines);
    applyEvent({ ...prev, lines: c.lines }, event);
    expect(c.gets()).toBeLessThan(Object.keys(prev.lines).length + 50);
  });

  it('[03a §7.1] every changed line and order is named, or the fold compares the whole maps (a re-plan)', () => {
    let state = initialEngineState();
    let quiet = 0;
    for (const event of log) {
      const { next, named } = foldNamed(state, event, {});
      if (!named.whole) {
        quiet++;
        for (const id of new Set([...Object.keys(state.lines), ...Object.keys(next.lines)])) {
          if (state.lines[id] !== next.lines[id]) expect(named.lineIds).toContain(id);
        }
        for (const id of new Set([...Object.keys(state.orders), ...Object.keys(next.orders)])) {
          if (state.orders[id] !== next.orders[id]) expect(named.orderIds).toContain(id);
        }
      }
      state = applyEvent(state, event);
    }
    expect(quiet).toBeGreaterThan(log.length / 2);
  });

  it('[03a §3.3] one writable copy per fold; the removal step is sealed off from the fold', () => {
    const state = initialEngineState();
    const scope = new FoldScope();
    const lines = scope.writableLines(state);
    expect(lines).not.toBe(state.lines);
    expect(scope.writableLines({ ...state, lines })).toBe(lines);
    expect(scope.writableLines(state)).not.toBe(lines);
    const orders = scope.writableOrders(state);
    expect(scope.writableOrders({ ...state, orders })).toBe(orders);
    scope.seal();
    expect(scope.writableOrders({ ...state, orders })).not.toBe(orders);
  });
});
