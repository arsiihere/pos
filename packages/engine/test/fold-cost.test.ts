// 03a §7.1 (upkeep "O(lines of the touched keys) + O(open keys) per fold … no per-event scan in replay"), §3.8 touched
// keys only, §3.3 copy-on-write. Task 18p: the folds name what they touched, and these tests keep the extra scans out.
// One pass over `lines` remains on a fold that changes an in-flight line (most stage events): v3 has no per-station index
// of those lines (BF-14 (b)); it is pinned at one pass below, not removed. Counted reads on a Proxy over `lines`, never a
// wall clock. The per-key = full recompute check itself is slip.test.ts #92 / #106.
import type { PosEvent } from '@pos/events';
import { aStockReserved, anOrderBatch } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { foldNamed } from '../src/apply-event';
import * as engine from '../src/index';
import { applyEvent, initialEngineState, type EngineLine, type EngineOrder, type EngineState } from '../src/index';
import { batchConfig, deepFreeze, loadOf } from './batch-kit';
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

const changedLines = (a: EngineState, b: EngineState): string[] => [...new Set([...Object.keys(a.lines), ...Object.keys(b.lines)])].filter((id) => a.lines[id] !== b.lines[id]);

// The old full diff as the oracle: a fold that does not compare the whole maps must name every line and order it changed.
function expectNamed(prev: EngineState, next: EngineState, named: FoldScope): void {
  if (named.whole) return;
  for (const id of changedLines(prev, next)) expect(named.lineIds).toContain(id);
  for (const id of new Set([...Object.keys(prev.orders), ...Object.keys(next.orders)])) {
    if (prev.orders[id] !== next.orders[id]) expect(named.orderIds).toContain(id);
  }
}

const hiddenOn = (s: EngineState): EngineLine[] => {
  const station = Object.values(s.stations).find((st) => st.type === 'slot' && st.unfired.length >= 3);
  return station === undefined ? [] : station.unfired.map((id) => s.lines[id]!).filter((l) => l.fired_at === null && l.booked !== null && s.orders[l.order_id]!.awaiting === 0).reverse();
};

const envelope = (at: PosEvent, event_type: string, stream_id: string, payload: Record<string, unknown>): PosEvent => ({ ...at, event_type, stream_id, payload, schema_version: 1 });

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
      if (!named.whole) quiet++;
      expectNamed(state, next, named);
      state = applyEvent(state, event);
    }
    expect(quiet).toBeGreaterThan(log.length / 2);
  });

  it('[03a §7.1] naming: a void re-plans other lines, so it compares the whole maps', () => {
    // The first hidden line in the log whose void changes another line (the group's other lines, or a re-placed neighbour).
    let state = initialEngineState();
    let found: { prev: EngineState; next: EngineState; named: FoldScope; id: string } | null = null;
    for (const at of log) {
      for (const line of hiddenOn(state)) {
        const event = envelope(at, 'ItemVoided', line.order_id, { order_item_id: line.order_item_id, units: line.units });
        const { next, named } = foldNamed(state, event, {});
        if (changedLines(state, next).some((id) => id !== line.order_item_id)) {
          found = { prev: state, next, named, id: line.order_item_id };
          break;
        }
      }
      if (found !== null) break;
      state = applyEvent(state, at);
    }
    expect(found).not.toBeNull();
    const { prev, next, named } = found!;
    expectNamed(prev, next, named);
  });

  it('[03a §7.1] naming: a load shift names every member of the load', () => {
    const { state, event: at } = before((s) => Object.values(s.stations).some((st) => Object.values(st.loads).length > 0));
    const station = Object.values(state.stations).find((st) => Object.values(st.loads).length > 0)!;
    const load = Object.values(station.loads)[0]!;
    const event = envelope(at, 'ReservationsShifted', station.station_id, { station_id: station.station_id, cause: 'overrun', shifts: [{ order_item_id: load.order_item_ids[0]!, by_ms: 60_000 }] });
    const { next, named } = foldNamed(state, event, {});
    expect(named.whole).toBe(false);
    expect(changedLines(state, next)).toEqual(expect.arrayContaining([...load.order_item_ids]));
    expectNamed(state, next, named);
  });

  it('[03a §7.1] naming: a batch flip re-forms the loads of its station, so it compares the whole maps', () => {
    const T = 1_761_000_000_000;
    const pickup = T + 3_600_000;
    const stamp = (e: PosEvent, seq: number): PosEvent => ({ ...e, recorded_at: T, occurred_at: T, seq, event_id: `01K${String(seq).padStart(23, '0')}` });
    const order = (order_id: string, id: string, seq: number): PosEvent[] =>
      anOrderBatch({
        order_id,
        recorded_at: T,
        seq,
        lines: [
          {
            order_item_id: id,
            item: { station_id: 'F', program_id: 'P1', program_cook_time_ms: 300_000, stock_program_id: 'P2', stock_program_cook_time_ms: 60_000, cook_time_ms: 999_999, quantity: 1, stock_draws: [{ stock_item_id: 'KB', quantity: 1 }], out_of_stock_behaviour: 'cook_fresh' },
            line: { station_id: 'F', from_stock: false },
          },
        ],
        order: { order_type: 'delivery', pickup_at_ms: pickup, groups: [{ group_id: `${order_id}:0`, target_land_ms: pickup, promise_ms: pickup + 180_000, order_item_ids: [id] }] },
      });
    let state = initialEngineState();
    for (const e of [stamp(batchConfig({}, T - 60_000), 1), ...order('O1', 'B1', 10), ...order('O2', 'B2', 20)]) state = applyEvent(state, e);
    expect(loadOf(state, 'B1')).toBeDefined();
    expect(loadOf(state, 'B2')).toBeDefined();
    const event = stamp(aStockReserved({ payload: { stock_item_id: 'KB', order_item_id: 'B1', quantity: 1 } }), 30);
    const { next, named } = foldNamed(state, event, {});
    expect(next.lines.B1!.from_stock).toBe(true);
    expect(changedLines(state, next)).toContain('B2');
    expectNamed(state, next, named);
  });

  it('[03a §7.1, AD-6] a non-strict fold that writes and then throws leaves the removal step\'s result as it was', () => {
    const run = runDay(generateDay(7, { orders: 10 }));
    const live = deepFreeze(run.liveState);
    const at = run.events.at(-1)!.recorded_at + 3_600_000;
    const exited = exitedOrderIds(live, at);
    expect(exited.length).toBeGreaterThan(0);
    // listLines writes L9 into the fold's working copy, then finds the group id wrong (after the loop over the lines).
    const bad = anOrderBatch({
      order_id: 'BAD',
      recorded_at: at,
      seq: 1_000_000,
      lines: [{ order_item_id: 'L9' }],
      order: { groups: [{ group_id: 'BAD:7', target_land_ms: at + 60_000, promise_ms: at + 240_000, order_item_ids: ['L9'] }] },
    })[0]!;
    const next = applyEvent(live, deepFreeze(bad), { strict: false });
    expect(next.lines.L9).toBeUndefined();
    expect(next.orders.BAD).toBeUndefined();
    for (const id of exited) expect(next.orders[id]).toBeUndefined();
    expect(next.diagnostics.at(-1)).toMatchObject({ kind: 'invalid_event', detail: { reason: 'group_id_invalid' } });
    expect(() => applyEvent(live, bad)).toThrow('group_id_invalid');
  });

  it('[03a §7.1] the fold seam stays internal: not in the package index', () => {
    for (const name of ['foldNamed', 'FoldScope', 'upkeepSlips']) expect(Object.keys(engine)).not.toContain(name);
    for (const name of ['addDiagnostic', 'applyEvent', 'buildEngineState']) expect(Object.keys(engine)).toContain(name);
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
