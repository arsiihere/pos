// 03a §3.7 (01a S14, 01c §3.5.2): reserve at submit (every draw after the claims of this command; cook_fresh /
// sold_out), the StockReserved / StockReleased / StockConsumed folds (per-draw `reserved`, consume at Start with
// clamps), the partial-void share (BF-12: the ItemVoided fold lowers units and draws, the release only `reserved`),
// the StockSet excess and StockAdded unit mismatch (BF-13, A-20). AD-6: strict (default) → a stock invariant breach
// throws; { strict: false } (the hub) → the value clamps at 0 and one 'stock_breach' diagnostic is appended.
import { type ConfigStockItem, type ItemAddedPayload, type PosEvent } from '@pos/events';
import {
  aFireDispatched,
  anEngineConfigApplied,
  anItemAdded,
  anItemStarted,
  anOrderBatch,
  aBusinessDayClosed,
  aBusinessDayOpened,
  aStockAdded,
  aStockConsumed,
  aStockReleased,
  aStockReserved,
  aStockSet,
} from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { applyEvent, applyEvents, buildEngineState, initialEngineState, planOrder, reserveStock, stockEffects, stockOf, type EngineState, type ProposedOrder } from '../src/index';
import { batchConfig, fryer, loadOf, submitB, voidB } from './batch-kit';

const T = 1_761_000_000_000; // the builders' T
const DAY = T - 3_600_000; // the open day's start passed to reserveStock
const COOK = 1_200_000; // the builders' fresh cook_time_ms
const STOCK_COOK = 60_000;

function deepFreeze<V>(value: V): V {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

type Opts = { strict?: boolean };
function fold(events: PosEvent[], state: EngineState = initialEngineState(), opts?: Opts): EngineState {
  let s = deepFreeze(state);
  for (const e of events) s = deepFreeze(applyEvent(s, deepFreeze(e), opts));
  return s;
}

const si = (id: string, stock_unit: 'piece' | 'g' = 'piece'): ConfigStockItem => ({
  stock_item_id: id,
  name: id,
  stock_unit,
  carries_over: false,
  station_id: 'S1',
  low_stock_threshold: null,
});
const STOCK_ITEMS: ConfigStockItem[] = deepFreeze([si('KB'), si('X'), si('Y')]);
const UNITS = deepFreeze({ KB: 'piece', X: 'piece', Y: 'piece' } as const);

let seq = 1_000;
const nextSeq = (n = 0): number => {
  const s = seq;
  seq += n + 1;
  return s;
};
const stamp = (e: PosEvent, at: number): PosEvent => {
  const s = nextSeq();
  return { ...e, recorded_at: at, occurred_at: at, seq: s, event_id: `01J${String(s).padStart(23, '0')}` };
};

const cfg = (recorded_at = DAY - 60_000): PosEvent => stamp(anEngineConfigApplied(), recorded_at);
const set = (id: string, on_hand: number, at: number, unit = 'piece'): PosEvent =>
  stamp(aStockSet({ stream_id: id, payload: { stock_item_id: id, on_hand, unit } }), at);
const added = (id: string, quantity: number, at: number, unit = 'piece'): PosEvent =>
  stamp(aStockAdded({ stream_id: id, payload: { stock_item_id: id, quantity, unit } }), at);
const reserved = (id: string, line: string, quantity: number, at: number): PosEvent =>
  stamp(aStockReserved({ payload: { stock_item_id: id, order_item_id: line, quantity } }), at);
const released = (id: string, line: string, quantity: number, at: number, reason = 'voided'): PosEvent =>
  stamp(aStockReleased({ payload: { stock_item_id: id, order_item_id: line, quantity, reason } }), at);
const consumed = (id: string, line: string, quantity: number, at: number): PosEvent =>
  stamp(aStockConsumed({ payload: { stock_item_id: id, order_item_id: line, quantity } }), at);
// 03a v1.2 Q-5: StockTransferredOut v1 (stock / stock_item_id), stock moved from the kitchen to a zone.
const transferred = (id: string, quantity: number, at: number, zone_id = 'Z1'): PosEvent =>
  stamp({ ...aStockSet({ stream_id: id }), event_type: 'StockTransferredOut', schema_version: 1, payload: { stock_item_id: id, quantity, zone_id } }, at);
const orderEv = (event_type: string, order_id: string, payload: Record<string, unknown>, at: number): PosEvent =>
  stamp({ ...anItemStarted(), event_type, stream_id: order_id, payload }, at);
const started = (order_id: string, line: string, at: number): PosEvent => orderEv('ItemStarted', order_id, { order_item_id: line, started_at: at, source: 'tap' }, at);
const voided = (order_id: string, line: string, units: number, at: number): PosEvent => orderEv('ItemVoided', order_id, { order_item_id: line, units }, at);
const fired = (ids: string[], at: number): PosEvent =>
  stamp(aFireDispatched({ payload: { station_id: 'S1', order_item_ids: ids, load_id: null, due_at: at, reason: 'scheduled' } }), at);

type Draw = { stock_item_id: string; quantity: number };
type LineSpec = { id: string; quantity?: number; draws?: Draw[]; behaviour?: 'cook_fresh' | 'sold_out' | null; from_stock?: boolean; stock_time?: number | null };

// The ItemAdded fields of a stock-tracked slot line (01c V12: a stock time and a draw).
function item(l: LineSpec): Record<string, unknown> {
  return {
    name: 'Seekh kebab',
    quantity: l.quantity ?? 1,
    stock_time_ms: l.stock_time === undefined ? STOCK_COOK : l.stock_time,
    stock_draws: l.draws ?? [],
    out_of_stock_behaviour: l.behaviour === undefined ? 'cook_fresh' : l.behaviour,
  };
}

// The §4.2 submit batch 02 appends: OrderPlaced (from_stock per line), ItemAdded × n, StockReserved per draw of a
// from-stock line. target: the group's T (default the builders' T + 1 500 000); pickup: a delivery picked up then,
// which keeps its lines hidden (fire near the pickup) — without one a line fires at once (frozen).
const HIDDEN = { pickup: T + 3_600_000 };
function submit(order_id: string, lines: LineSpec[], at = T, target?: number, o: { pickup?: number } = {}): PosEvent[] {
  const s = nextSeq(lines.length * 4 + 2);
  const ids = lines.map((l) => l.id);
  return anOrderBatch({
    order_id,
    recorded_at: at,
    seq: s,
    lines: lines.map((l) => ({ order_item_id: l.id, item: item(l), line: { from_stock: l.from_stock ?? false } })),
    order: {
      ...(target === undefined ? {} : { groups: [{ group_id: `${order_id}:0`, target_land_ms: target, promise_ms: target + 180_000, order_item_ids: ids }] }),
      ...(o.pickup === undefined ? {} : { order_type: 'delivery', pickup_at_ms: o.pickup }),
    },
    reserved: lines
      .filter((l) => l.from_stock === true)
      .flatMap((l) => (l.draws ?? []).map((d) => ({ stock_item_id: d.stock_item_id, order_item_id: l.id, quantity: d.quantity }))),
  });
}

function proposed(order_id: string, lines: Array<LineSpec & { return_of?: { order_item_id: string; mode: 'fix' | 'remake' }; line_kind?: string; station_id?: string | null }>): ProposedOrder {
  const base = anItemAdded().payload as unknown as ItemAddedPayload;
  return deepFreeze({
    order_id,
    order: { order_type: 'dine_in', table_id: 'T12', table_key: 'dine_in:T12', follow_up: false, pickup_at_ms: null },
    lines: lines.map((l) => ({
      ...base,
      ...(item(l) as Partial<ItemAddedPayload>),
      ...(l.line_kind === undefined ? {} : { line_kind: l.line_kind as ItemAddedPayload['line_kind'] }),
      ...(l.station_id === undefined ? {} : { station_id: l.station_id }),
      order_id,
      order_item_id: l.id,
      alternates: [],
      point_id: null,
      carry_ms: 0,
      weight_pct: 100,
      max_early_ms: 60_000,
      max_late_ms: null,
      max_carry_ms: null,
      cook_ms_override: l.return_of?.mode === 'fix' ? 180_000 : null,
      return_of: l.return_of ?? null,
    })),
  });
}

const reserve = (s: EngineState, p: ProposedOrder, items: readonly ConfigStockItem[] = STOCK_ITEMS) => reserveStock(s, p, DAY, items, UNITS);

// The §3.7 invariants at a batch boundary.
function expectInvariants(s: EngineState): void {
  for (const [id, e] of Object.entries(s.stock)) {
    expect(e.on_hand, id).toBeGreaterThanOrEqual(0);
    expect(e.reserved, id).toBeGreaterThanOrEqual(0);
  }
  for (const l of Object.values(s.lines)) {
    for (const d of l.draws) {
      expect(d.reserved, l.order_item_id).toBeGreaterThanOrEqual(0);
      expect(d.reserved, l.order_item_id).toBeLessThanOrEqual(d.quantity);
    }
    expect(l.reserved_seq === null, l.order_item_id).toBe(l.draws.every((d) => d.reserved === 0));
  }
}

const breaches = (s: EngineState) => s.diagnostics.filter((d) => d.kind === 'stock_breach');

describe('@pos/engine reserveStock (§3.7, §6.1e)', () => {
  it('[03a #39] every draw must fit after the claims of this command; sold_out at available 0 refused; cook_fresh full cook', () => {
    const s = fold([cfg(), set('X', 4, DAY), set('Y', 1, DAY), set('KB', 3, DAY)]);
    // Platter × 2 draws 2 X and 2 Y: Y has 1 → not from stock (cook_fresh), nothing drafted for X either.
    const platter = { id: 'P', quantity: 2, draws: [{ stock_item_id: 'X', quantity: 2 }, { stock_item_id: 'Y', quantity: 2 }] };
    expect(reserve(s, proposed('O1', [platter]))).toEqual({ drafts: [], from_stock: { P: false }, refused: [] });
    const s2 = fold([set('Y', 2, DAY + 1)], s);
    const both = reserve(s2, proposed('O1', [platter]));
    expect(both.from_stock).toEqual({ P: true });
    expect(both.refused).toEqual([]);
    expect(both.drafts).toEqual([
      { stream_type: 'stock', stream_id: 'X', event_type: 'StockReserved', schema_version: 1, payload: { stock_item_id: 'X', order_item_id: 'P', quantity: 2 } },
      { stream_type: 'stock', stream_id: 'Y', event_type: 'StockReserved', schema_version: 1, payload: { stock_item_id: 'Y', order_item_id: 'P', quantity: 2 } },
    ]);

    // Two lines of one command, KB available 3, each needs 2: the second sees the first's claim.
    const two = reserve(s, proposed('O1', [{ id: 'A', quantity: 2, draws: [{ stock_item_id: 'KB', quantity: 2 }] }, { id: 'B', quantity: 2, draws: [{ stock_item_id: 'KB', quantity: 2 }] }]));
    expect(two.from_stock).toEqual({ A: true, B: false });
    expect(two.drafts.map((d) => d.payload)).toEqual([{ stock_item_id: 'KB', order_item_id: 'A', quantity: 2 }]);
    expect(two.refused).toEqual([]);
    // A line that does not fit claims nothing: the next one that fits still gets the units.
    const skip = reserve(s, proposed('O1', [{ id: 'A', quantity: 4, draws: [{ stock_item_id: 'KB', quantity: 4 }] }, { id: 'B', quantity: 3, draws: [{ stock_item_id: 'KB', quantity: 3 }] }]));
    expect(skip.from_stock).toEqual({ A: false, B: true });

    // sold_out at available 0 → refused (and nothing drafted for it); cook_fresh → not from stock.
    const out = fold([set('KB', 0, DAY + 2)], s);
    const r = reserve(out, proposed('O1', [{ id: 'S', draws: [{ stock_item_id: 'KB', quantity: 1 }], behaviour: 'sold_out' }, { id: 'F', draws: [{ stock_item_id: 'KB', quantity: 1 }] }]));
    expect(r).toEqual({ drafts: [], from_stock: { S: false, F: false }, refused: ['S'] });
    // A count that is not valid today (set before the day's start) reads as available 0 (01a S41).
    const stale = fold([set('KB', 9, DAY - 1)], s);
    expect(reserve(stale, proposed('O1', [{ id: 'S', draws: [{ stock_item_id: 'KB', quantity: 1 }], behaviour: 'sold_out' }])).refused).toEqual(['S']);
    // Proposed reading (implementer, overnight): a sold_out line that does not fit is refused also when 0 < available < needed.
    expect(reserve(s, proposed('O1', [{ id: 'S', quantity: 4, draws: [{ stock_item_id: 'KB', quantity: 4 }], behaviour: 'sold_out' }])).refused).toEqual(['S']);
    // A stock item the config does not list cannot serve (available 0).
    expect(reserve(s2, proposed('O1', [platter]), [si('X')]).from_stock).toEqual({ P: false });

    // cook_fresh → the line folds with its full cook time.
    const fresh = fold(submit('O1', [{ id: 'F', draws: [{ stock_item_id: 'KB', quantity: 1 }], from_stock: false }]), out);
    expect(fresh.lines.F).toMatchObject({ from_stock: false, cook_ms: COOK, full_cook_ms: COOK, stock_cook_ms: STOCK_COOK, reserved_seq: null });
    expect(fresh.lines.F!.draws).toEqual([{ stock_item_id: 'KB', quantity: 1, reserved: 0 }]);
    expectInvariants(fresh);
  });

  it('[03a §3.7] untracked lines draft nothing and are never refused: no draw, no stock cook time, a deal line', () => {
    const s = fold([cfg(), set('KB', 0, DAY)]);
    const r = reserve(
      s,
      proposed('O1', [
        { id: 'N', behaviour: 'sold_out' }, // no draw
        { id: 'C', draws: [{ stock_item_id: 'KB', quantity: 1 }], stock_time: null, behaviour: 'sold_out' }, // no stock time (01c V12)
        { id: 'D', line_kind: 'deal', station_id: null, draws: [], behaviour: 'sold_out' },
      ]),
    );
    expect(r).toEqual({ drafts: [], from_stock: { N: false, C: false, D: false }, refused: [] });
  });

  it('[03a #75] reserveStock drafts nothing for a return line (draws [], from_stock false), even with stock available', () => {
    const s = fold([cfg(), set('KB', 9, DAY)]);
    const r = reserve(s, proposed('O1', [{ id: 'R', draws: [{ stock_item_id: 'KB', quantity: 1 }], return_of: { order_item_id: 'L1', mode: 'remake' } }]));
    expect(r).toEqual({ drafts: [], from_stock: { R: false }, refused: [] });
  });

  it('[03a #74 engine] two submits claim the last unit: the second reserveStock on the folded state gets cook_fresh or refusal', () => {
    const s0 = fold([cfg(), set('KB', 1, DAY)]);
    const first = reserve(s0, proposed('O1', [{ id: 'A', draws: [{ stock_item_id: 'KB', quantity: 1 }] }]));
    expect(first.from_stock).toEqual({ A: true });
    const s1 = fold(submit('O1', [{ id: 'A', draws: [{ stock_item_id: 'KB', quantity: 1 }], from_stock: first.from_stock.A }]), s0);
    expect(stockOf(s1, 'KB')).toMatchObject({ on_hand: 1, reserved: 1 });
    expect(s1.lines.A).toMatchObject({ from_stock: true, cook_ms: STOCK_COOK });
    expectInvariants(s1);

    const fresh = reserve(s1, proposed('O2', [{ id: 'B', draws: [{ stock_item_id: 'KB', quantity: 1 }] }]));
    expect(fresh).toEqual({ drafts: [], from_stock: { B: false }, refused: [] });
    const sold = reserve(s1, proposed('O2', [{ id: 'B', draws: [{ stock_item_id: 'KB', quantity: 1 }], behaviour: 'sold_out' }]));
    expect(sold).toEqual({ drafts: [], from_stock: { B: false }, refused: ['B'] });
  });
});

describe('@pos/engine stock folds (§3.7)', () => {
  it('[03a #102] EngineLine.draws = ItemAdded.stock_draws (never the day draws or config); live = replay with a changed config between', () => {
    // The day froze no draw for this item (it was added to the menu after the open); I2's frozen draw differs.
    const open = stamp(aBusinessDayOpened({ payload: { business_date: '2026-11-06', stock_units: { KB: 'piece' }, draws: { I2: { sale_unit: 'piece', stock_draws: [{ stock_item_id: 'X', quantity_per_sale_unit: 7 }] } } } }), DAY);
    const draws = [{ stock_item_id: 'KB', quantity: 3 }];
    const batch = submit('O1', [{ id: 'L', quantity: 3, draws, from_stock: true }]);
    const changed = stamp(anEngineConfigApplied({ payload: { config_version: 2 } }), T - 1);
    const log = [cfg(), open, set('KB', 5, DAY + 1), changed, ...batch];
    let live = initialEngineState();
    for (const e of log) live = applyEvent(live, e);
    expect(live.lines.L!.draws).toEqual([{ stock_item_id: 'KB', quantity: 3, reserved: 3 }]);
    expect(live.lines.L!.reserved_seq).toBe(batch[batch.length - 1]!.seq);
    expect(buildEngineState(log.map(deepFreeze))).toEqual(live);
    expect(buildEngineState(log, { strict: false })).toEqual(live);
    expectInvariants(live);
  });

  it('[03a #41] StockConsumed at Start moves the units out of on_hand and reserved; a consume past on_hand clamps at 0, one breach, and commits', () => {
    const base = fold([cfg(), set('KB', 5, DAY), ...submit('O1', [{ id: 'L', quantity: 3, draws: [{ stock_item_id: 'KB', quantity: 3 }], from_stock: true }])]);
    expect(stockOf(base, 'KB')).toMatchObject({ on_hand: 5, reserved: 3 });
    const s = fold([started('O1', 'L', T + 1_000), consumed('KB', 'L', 3, T + 1_000)], base);
    expect(stockOf(s, 'KB')).toMatchObject({ on_hand: 2, reserved: 0 });
    expect(s.lines.L).toMatchObject({ stage: 'cooking', from_stock: true, cook_ms: STOCK_COOK, reserved_seq: null });
    expect(s.lines.L!.draws).toEqual([{ stock_item_id: 'KB', quantity: 3, reserved: 0 }]);
    expect(s.diagnostics).toEqual([]);
    expectInvariants(s);

    // The line is fired, then the pot is counted 1 (allowed: held by a fired line, no breach); its Start consumes 3.
    const short = fold([fired(['L'], T + 500), set('KB', 1, T + 600)], base);
    expect(stockOf(short, 'KB')).toMatchObject({ on_hand: 1, reserved: 3 });
    expect(short.diagnostics).toEqual([]);
    const start = started('O1', 'L', T + 1_000);
    const consume = consumed('KB', 'L', 3, T + 1_000);
    // Strict (tests): the breach throws.
    expect(() => fold([start, consume], short)).toThrow(/stock invariant breach/);
    // Non-strict (hub): on_hand clamps at 0, one breach with the values before the fold, the Start commits.
    const loose = fold([start, consume], short, { strict: false });
    expect(stockOf(loose, 'KB')).toMatchObject({ on_hand: 0, reserved: 0 });
    expect(loose.lines.L).toMatchObject({ stage: 'cooking', from_stock: true, reserved_seq: null });
    expect(loose.diagnostics).toEqual([
      { kind: 'stock_breach', event_id: consume.event_id, stock_item_id: 'KB', detail: { event_type: 'StockConsumed', order_item_id: 'L', quantity: 3, on_hand: 1, reserved: 3 } },
    ]);
    expectInvariants(loose);
  });

  it('[03a §3.7] StockReserved: reserved += quantity on the entry and the draw, reserved_seq = its seq; StockReleased of a whole line', () => {
    const batch = submit('O1', [{ id: 'L', quantity: 2, draws: [{ stock_item_id: 'X', quantity: 2 }, { stock_item_id: 'Y', quantity: 2 }], from_stock: true }]);
    const s = fold([cfg(), set('X', 5, DAY), set('Y', 5, DAY), ...batch]);
    expect(stockOf(s, 'X').reserved).toBe(2);
    expect(stockOf(s, 'Y').reserved).toBe(2);
    expect(s.lines.L!.draws).toEqual([
      { stock_item_id: 'X', quantity: 2, reserved: 2 },
      { stock_item_id: 'Y', quantity: 2, reserved: 2 },
    ]);
    expect(s.lines.L!.reserved_seq).toBe(batch[batch.length - 1]!.seq);
    expectInvariants(s);

    // ItemRemoved, then one release per draw: the line goes fresh only after the last draw is released.
    const removed = orderEv('ItemRemoved', 'O1', { order_item_id: 'L' }, T + 10);
    const one = fold([removed, released('X', 'L', 2, T + 10, 'removed')], s);
    expect(one.lines.L).toMatchObject({ from_stock: true, cook_ms: STOCK_COOK, reserved_seq: s.lines.L!.reserved_seq });
    const both = fold([released('Y', 'L', 2, T + 10, 'removed')], one);
    expect(both.lines.L).toMatchObject({ stage: 'removed', from_stock: false, cook_ms: COOK, reserved_seq: null });
    expect(both.lines.L!.draws).toEqual([
      { stock_item_id: 'X', quantity: 2, reserved: 0 },
      { stock_item_id: 'Y', quantity: 2, reserved: 0 },
    ]);
    expect(stockOf(both, 'X')).toMatchObject({ on_hand: 5, reserved: 0 });
    expect(stockOf(both, 'Y')).toMatchObject({ on_hand: 5, reserved: 0 });
    expect(both.diagnostics).toEqual([]);
    expectInvariants(both);
  });

  // AD-35 22b-4: the host frames a station whose reference changed, so a release that re-plans nothing must leave the
  // station's object as it was (reference-equal), not a copy.
  it('[03a AD-35 gap 7] the StockReleased test pins stations.S1 unchanged', () => {
    // A hidden from-stock line with two draws (a delivery picked up in an hour): booked on S1.
    const batch = submit('O1', [{ id: 'L', quantity: 2, draws: [{ stock_item_id: 'X', quantity: 2 }, { stock_item_id: 'Y', quantity: 2 }], from_stock: true }], T, undefined, HIDDEN);
    const s = fold([cfg(), set('X', 5, DAY), set('Y', 5, DAY), ...batch]);
    expect(s.lines.L!.booked).not.toBeNull();
    // Releasing one draw keeps the line from stock (its cook time and booking stay): S1 is the same object.
    const partial = fold([released('X', 'L', 2, T + 10)], s);
    expect(partial.lines.L).toMatchObject({ from_stock: true, cook_ms: STOCK_COOK, booked: s.lines.L!.booked });
    expect(stockOf(partial, 'X')).toMatchObject({ reserved: 0 });
    expect(partial.stations.S1).toBe(s.stations.S1);
    expectInvariants(partial);

    // The whole-line case of the test above: ItemRemoved re-plans S1; the releases after it (the line goes fresh only
    // at the last one) leave S1 as the removal left it.
    const removed = fold([orderEv('ItemRemoved', 'O1', { order_item_id: 'L' }, T + 10)], s);
    expect(removed.stations.S1).not.toBe(s.stations.S1);
    const one = fold([released('X', 'L', 2, T + 10, 'removed')], removed);
    expect(one.stations.S1).toBe(removed.stations.S1);
    const both = fold([released('Y', 'L', 2, T + 10, 'removed')], one);
    expect(both.lines.L).toMatchObject({ stage: 'removed', from_stock: false, cook_ms: COOK, reserved_seq: null });
    expect(both.stations.S1).toBe(one.stations.S1);
    expect(both.diagnostics).toEqual([]);
    expectInvariants(both);
  });

  it('[03a #117] partial void: "Seekh kebab × 3" from stock, 1 voided → units 2, draw { 2, 2 }; Start consumes 2; a count of 0 reports nothing', () => {
    const batch = submit('O1', [{ id: 'L', quantity: 3, draws: [{ stock_item_id: 'KB', quantity: 3 }], from_stock: true }], T, undefined, HIDDEN);
    const s0 = fold([cfg(), set('KB', 5, DAY), ...batch]);
    const seq0 = s0.lines.L!.reserved_seq;
    expect(s0.lines.L!.fire_ms! > T + 10 + 120_000).toBe(true); // hidden
    expect(s0.lines.L!.booked!.units).toBe(3);
    const s1 = fold([voided('O1', 'L', 1, T + 10), released('KB', 'L', 1, T + 10)], s0);
    expect(stockOf(s1, 'KB')).toMatchObject({ on_hand: 5, reserved: 2 });
    expect(s1.lines.L).toMatchObject({ stage: 'added', units: 2, from_stock: true, cook_ms: STOCK_COOK, reserved_seq: seq0 });
    expect(s1.lines.L!.draws).toEqual([{ stock_item_id: 'KB', quantity: 2, reserved: 2 }]);
    // The cause's fold re-plans the line's station: the hidden line is re-booked with its 2 units.
    expect(s1.lines.L!.booked!.units).toBe(2);
    expect(s1.stations.S1!.profile.u.every((u) => u <= 2)).toBe(true);
    expectInvariants(s1);

    const s2 = fold([started('O1', 'L', T + 20), consumed('KB', 'L', 2, T + 20)], s1);
    expect(stockOf(s2, 'KB')).toMatchObject({ on_hand: 3, reserved: 0 });
    expect(s2.lines.L).toMatchObject({ reserved_seq: null, from_stock: true });
    const s3 = fold([set('KB', 0, T + 30)], s2);
    expect(stockOf(s3, 'KB')).toMatchObject({ on_hand: 0, reserved: 0 });
    expect(s3.diagnostics).toEqual([]);
    expect(fold([set('KB', 0, T + 30)], s2, { strict: false }).diagnostics).toEqual([]);
    expectInvariants(s3);
  });

  it('[03a #117] variant: voiding the last units releases the rest, from_stock false with the full cook time', () => {
    const s0 = fold([cfg(), set('KB', 5, DAY), ...submit('O1', [{ id: 'L', quantity: 3, draws: [{ stock_item_id: 'KB', quantity: 3 }], from_stock: true }])]);
    const s1 = fold([voided('O1', 'L', 1, T + 10), released('KB', 'L', 1, T + 10), voided('O1', 'L', 2, T + 20), released('KB', 'L', 2, T + 20)], s0);
    expect(s1.lines.L).toMatchObject({ stage: 'voided', from_stock: false, cook_ms: COOK, reserved_seq: null, booked: null });
    expect(s1.lines.L!.draws.every((d) => d.reserved === 0)).toBe(true);
    expect(stockOf(s1, 'KB')).toMatchObject({ on_hand: 5, reserved: 0 });
    expect(s1.diagnostics).toEqual([]);
    expectInvariants(s1);
  });

  it('[03a BF-12] partial void of "Platter × 2" (2 X, 2 Y): the ItemVoided fold lowers units and every draw; each release lowers only reserved', () => {
    const s0 = fold([cfg(), set('X', 5, DAY), set('Y', 5, DAY), ...submit('O1', [{ id: 'P', quantity: 2, draws: [{ stock_item_id: 'X', quantity: 2 }, { stock_item_id: 'Y', quantity: 2 }], from_stock: true }])]);
    const afterVoid = fold([voided('O1', 'P', 1, T + 10)], s0);
    expect(afterVoid.lines.P).toMatchObject({ units: 1, stage: 'added' });
    expect(afterVoid.lines.P!.draws).toEqual([
      { stock_item_id: 'X', quantity: 1, reserved: 2 },
      { stock_item_id: 'Y', quantity: 1, reserved: 2 },
    ]);
    const s1 = fold([released('X', 'P', 1, T + 10), released('Y', 'P', 1, T + 10)], afterVoid);
    expect(s1.lines.P).toMatchObject({ units: 1, from_stock: true, cook_ms: STOCK_COOK, reserved_seq: s0.lines.P!.reserved_seq });
    expect(s1.lines.P!.draws).toEqual([
      { stock_item_id: 'X', quantity: 1, reserved: 1 },
      { stock_item_id: 'Y', quantity: 1, reserved: 1 },
    ]);
    expect(stockOf(s1, 'X')).toMatchObject({ on_hand: 5, reserved: 1 });
    expect(stockOf(s1, 'Y')).toMatchObject({ on_hand: 5, reserved: 1 });
    expect(s1.diagnostics).toEqual([]);
    expectInvariants(s1);
  });

  it('[03a BF-12] partial void of a line with no draw lowers units only; a share that is not whole is a writer bug (AD-8)', () => {
    const s0 = fold([cfg(), ...submit('O1', [{ id: 'N', quantity: 3 }], T, undefined, HIDDEN)]);
    const s1 = fold([voided('O1', 'N', 1, T + 10)], s0);
    expect(s1.lines.N).toMatchObject({ units: 2, stage: 'added', draws: [], booked: { units: 2 } });
    expectInvariants(s1);

    // A draw of 5 on a 3-unit line: a 1-unit share is not an integer.
    const odd = fold([cfg(), set('KB', 9, DAY), ...submit('O1', [{ id: 'L', quantity: 3, draws: [{ stock_item_id: 'KB', quantity: 5 }], from_stock: true }])]);
    const bad = voided('O1', 'L', 1, T + 10);
    expect(() => fold([bad], odd)).toThrow();
    const loose = fold([bad], odd, { strict: false });
    expect(loose.lines.L).toEqual(odd.lines.L);
    expect(loose.diagnostics).toMatchObject([{ kind: 'invalid_event', event_id: bad.event_id }]);
  });

  // Task 12 review (§3.5.3 lists ItemVoided with no partial / whole distinction; AD-11): a partial void re-plans
  // the group like a void — T' = min(T, loop), the promise never moves.
  it('[03a §3.5.3] a partial void that frees capacity lets the group T move earlier; the promise is unchanged', () => {
    const s0 = fold([cfg()]);
    const block = (units: number) => {
      const p = planOrder(s0, proposed('O0', [{ id: 'A', quantity: units }]), T, {});
      return fold(submit('O0', [{ id: 'A', quantity: units }], T, p.groups[0]!.target_land_ms), s0);
    };
    const withL = (s: EngineState) => {
      const p = planOrder(s, proposed('O1', [{ id: 'L', quantity: 3 }]), T + 1, {});
      return fold(submit('O1', [{ id: 'L', quantity: 3 }], T + 1, p.groups[0]!.target_land_ms), s);
    };
    // Capacity 4, 2 units busy for one cook: L × 3 waits for them (T = T + 2 cooks).
    const s1 = withL(block(2));
    const T1 = s1.orders.O1!.groups['O1:0']!.target_land_ms;
    const P1 = s1.orders.O1!.promise_ms;
    expect(T1).toBe(T + 2 * COOK);
    expect(s1.lines.L!.booked).toEqual({ start: T + COOK, end: T + 2 * COOK, units: 3 });
    // 1 unit voided: 2 + 2 fit together, the loop lands earlier.
    const s2 = fold([voided('O1', 'L', 1, T + 10)], s1);
    const T2 = s2.orders.O1!.groups['O1:0']!.target_land_ms;
    expect(T2).toBeLessThan(T1);
    expect(s2.orders.O1!.target_land_ms).toBe(T2);
    expect(s2.orders.O1!.promise_ms).toBe(P1);
    expect(s2.lines.L).toMatchObject({ units: 2, booked: { units: 2, end: T2 } });
    // AD-7: the old 3-unit booking left the profile exactly (A's 2 units + L's 2 units only).
    expect(Math.max(...s2.stations.S1!.profile.u)).toBe(4);
    expect(s2.diagnostics).toEqual([]);
  });

  it('[03a §3.5.3] a partial void whose loop would not land earlier keeps T, and the line is still re-booked at its lower units', () => {
    const s0 = fold([cfg()]);
    const pA = planOrder(s0, proposed('O0', [{ id: 'A', quantity: 3 }]), T, {});
    const sA = fold(submit('O0', [{ id: 'A', quantity: 3 }], T, pA.groups[0]!.target_land_ms), s0);
    const pL = planOrder(sA, proposed('O1', [{ id: 'L', quantity: 3 }]), T + 1, {});
    const s1 = fold(submit('O1', [{ id: 'L', quantity: 3 }], T + 1, pL.groups[0]!.target_land_ms), sA);
    const T1 = s1.orders.O1!.groups['O1:0']!.target_land_ms;
    // 3 busy + 2 still exceed 4: nothing lands earlier.
    const s2 = fold([voided('O1', 'L', 1, T + 10)], s1);
    expect(s2.orders.O1!.groups['O1:0']!.target_land_ms).toBe(T1);
    expect(s2.orders.O1!.promise_ms).toBe(s1.orders.O1!.promise_ms);
    expect(s2.lines.L!.booked).toEqual({ ...s1.lines.L!.booked!, units: 2 });
    expect(s2.stations.S1!.profile).toEqual({ t: [T, T + COOK, T + 2 * COOK], u: [3, 2, 0] });
  });

  it('[03a §3.5.3] a partial void of a line in a hidden batch load re-forms the load at the lower units (old booking removed exactly)', () => {
    // Fryer capacity 2: B1 × 3 needs two rounds; a delivery picked up in an hour keeps the load hidden.
    const a = submitB(fryer({ capacity: 2 }), 'OA', [{ id: 'B1', cook: 300_000, units: 3 }], T, { pickup_at_ms: T + 3_600_000 });
    const before = loadOf(a.state, 'B1')!;
    expect(before.booked.end - before.booked.start).toBe(600_000);
    const s1 = fold([voidB('OA', 'B1', 1, T + 10)], a.state);
    const after = loadOf(s1, 'B1')!;
    expect(s1.lines.B1).toMatchObject({ units: 2, load_id: 'F:B1', fire_ms: after.fire_ms });
    expect(after).toMatchObject({ load_id: 'F:B1', order_item_ids: ['B1'] });
    expect(after.booked.end - after.booked.start).toBe(300_000); // one round now
    expect(s1.stations.F!.profile).toEqual({ t: [after.booked.start, after.booked.end], u: [2, 0] });
    expect(s1.orders.OA!.groups['OA:0']!.target_land_ms).toBe(a.state.orders.OA!.groups['OA:0']!.target_land_ms);
  });

  it('[03a #117] variant: a partial void of a batch line in a frozen program-Q load keeps program Q and the load unchanged', () => {
    const fq = batchConfig({ freeze_ms: 3_600_000 }, DAY - 60_000);
    const item = {
      station_id: 'F',
      program_id: 'P1',
      program_cook_time_ms: 300_000,
      stock_program_id: 'P2',
      stock_program_cook_time_ms: 60_000,
      cook_time_ms: 999_999,
      quantity: 2,
      stock_draws: [{ stock_item_id: 'KB', quantity: 2 }],
      out_of_stock_behaviour: 'cook_fresh',
    };
    const batch = anOrderBatch({
      order_id: 'OB',
      recorded_at: T,
      seq: nextSeq(4),
      lines: [{ order_item_id: 'B1', item, line: { station_id: 'F', from_stock: true } }],
      reserved: [{ stock_item_id: 'KB', order_item_id: 'B1', quantity: 2 }],
    });
    const s0 = fold([stamp(fq, DAY - 60_000), set('KB', 4, DAY), ...batch]);
    const load = loadOf(s0, 'B1')!;
    expect(load).toMatchObject({ program_id: 'P2', order_item_ids: ['B1'] });
    expect(s0.lines.B1!.fire_ms! <= T + 3_600_000).toBe(true); // frozen
    const s1 = fold([voided('OB', 'B1', 1, T + 10), released('KB', 'B1', 1, T + 10)], s0);
    expect(loadOf(s1, 'B1')).toEqual(load);
    expect(s1.stations.F!.loads).toEqual(s0.stations.F!.loads);
    expect(s1.lines.B1).toMatchObject({ units: 1, from_stock: true, stock_program_id: 'P2', program_id: 'P1', cook_ms: 60_000 });
    expect(s1.lines.B1!.draws).toEqual([{ stock_item_id: 'KB', quantity: 1, reserved: 1 }]);
    expectInvariants(s1);
  });

  it('[03a #119] recount below frozen reservations: allowed; four Starts commit, the third and fourth clamp with one breach each; replay = live', () => {
    const lines = ['L1', 'L2', 'L3', 'L4'].map((id) => ({ id, draws: [{ stock_item_id: 'KB', quantity: 1 }], from_stock: true }));
    const head = [cfg(), set('KB', 4, DAY), ...submit('O1', lines, T, T + 120_000)];
    const s0 = fold(head);
    expect(stockOf(s0, 'KB')).toMatchObject({ on_hand: 4, reserved: 4 });
    for (const l of lines) {
      const line = s0.lines[l.id]!;
      expect(line.fired_at).toBeNull();
      expect(line.fire_ms! <= T + 1_000 + 120_000).toBe(true); // frozen on Next at the count
    }
    const count = set('KB', 2, T + 1_000);
    const s1 = fold([count], s0);
    expect(stockOf(s1, 'KB')).toMatchObject({ on_hand: 2, reserved: 4 });
    expect(s1.diagnostics).toEqual([]);

    const starts = lines.flatMap((l, i) => [started('O1', l.id, T + 2_000 + i), consumed('KB', l.id, 1, T + 2_000 + i)]);
    // Strict: the third Start's consume throws.
    expect(() => fold(starts, s1)).toThrow(/stock invariant breach/);
    const live = fold(starts, s1, { strict: false });
    expect(stockOf(live, 'KB')).toMatchObject({ on_hand: 0, reserved: 0 });
    for (const l of lines) expect(live.lines[l.id]).toMatchObject({ stage: 'cooking', reserved_seq: null });
    expect(breaches(live)).toEqual([
      { kind: 'stock_breach', event_id: starts[5]!.event_id, stock_item_id: 'KB', detail: { event_type: 'StockConsumed', order_item_id: 'L3', quantity: 1, on_hand: 0, reserved: 2 } },
      { kind: 'stock_breach', event_id: starts[7]!.event_id, stock_item_id: 'KB', detail: { event_type: 'StockConsumed', order_item_id: 'L4', quantity: 1, on_hand: 0, reserved: 1 } },
    ]);
    expectInvariants(live);
    // single_tap variant (the fires pass with inferred starts): task 14 (getTickIntents).

    // A unit-changing StockSet in the 2-of-4 state: its StockConsumed drafts (Q14, one per held draw) fold without
    // throwing (non-strict); the entry enters the new unit with reserved 0, so the count itself reports nothing.
    const q14 = lines.map((l) => consumed('KB', l.id, 1, T + 3_000));
    const recount = set('KB', 500, T + 3_000, 'g');
    const s2 = fold([...q14, recount], s1, { strict: false });
    expect(stockOf(s2, 'KB')).toEqual({ on_hand: 500, reserved: 0, set_at: T + 3_000, unit: 'g' });
    expect(breaches(s2).map((b) => b.event_id)).toEqual([q14[2]!.event_id, q14[3]!.event_id]);
    for (const l of lines) expect(s2.lines[l.id]).toMatchObject({ stage: 'added', from_stock: true, reserved_seq: null });
    // A StockAdded with a mismatched unit leaves the entry unchanged and reports a breach (A-20).
    const mismatch = added('KB', 1, T + 4_000, 'piece');
    const s3 = fold([mismatch], s2, { strict: false });
    expect(stockOf(s3, 'KB')).toEqual(stockOf(s2, 'KB'));
    expect(breaches(s3).at(-1)).toEqual({
      kind: 'stock_breach',
      event_id: mismatch.event_id,
      stock_item_id: 'KB',
      detail: { event_type: 'StockAdded', quantity: 1, unit: 'piece', entry_unit: 'g', on_hand: 500, reserved: 0 },
    });
    expectInvariants(s3);

    // Replay = live, with the same breaches.
    const log = [...head, count, ...q14, recount, mismatch];
    let incremental = initialEngineState();
    for (const e of log) incremental = applyEvent(incremental, e, { strict: false });
    expect(buildEngineState(log.map(deepFreeze), { strict: false })).toEqual(incremental);
    expect(incremental).toEqual(s3);
  });

  it('[03a §3.7] a StockSet excess not held by frozen or fired lines folds as counted and is a breach (strict throws)', () => {
    const s0 = fold([cfg(), set('KB', 5, DAY), ...submit('O1', [{ id: 'L', quantity: 3, draws: [{ stock_item_id: 'KB', quantity: 3 }], from_stock: true }], T, undefined, HIDDEN)]);
    // L is hidden (a delivery picked up in an hour): its release should have preceded the count (stockEffects, task 12b).
    expect(s0.lines.L!.fire_ms! > T + 1_000 + 120_000).toBe(true);
    const count = set('KB', 1, T + 1_000);
    expect(() => fold([count], s0)).toThrow(/stock invariant breach/);
    const loose = fold([count], s0, { strict: false });
    expect(stockOf(loose, 'KB')).toMatchObject({ on_hand: 1, reserved: 3, set_at: T + 1_000 });
    expect(loose.diagnostics).toEqual([
      { kind: 'stock_breach', event_id: count.event_id, stock_item_id: 'KB', detail: { event_type: 'StockSet', count: 1, held: 0, on_hand: 5, reserved: 3 } },
    ]);
    // A count at or above reserved is never a breach.
    expect(fold([set('KB', 3, T + 1_000)], s0).diagnostics).toEqual([]);
  });

  it('[03a BF-13] StockAdded with a unit other than the entry\'s: entry unchanged and one breach (non-strict); strict throws', () => {
    const s0 = fold([set('KB', 5, DAY, 'g')]);
    const bad = added('KB', 2, DAY + 1, 'piece');
    expect(() => fold([bad], s0)).toThrow('StockAdded unit mismatch');
    const loose = fold([bad], s0, { strict: false });
    expect(loose.stock).toEqual(s0.stock);
    expect(loose.diagnostics).toEqual([
      { kind: 'stock_breach', event_id: bad.event_id, stock_item_id: 'KB', detail: { event_type: 'StockAdded', quantity: 2, unit: 'piece', entry_unit: 'g', on_hand: 5, reserved: 0 } },
    ]);
    // A matching add reports nothing in either mode.
    const ok = added('KB', 2, DAY + 1, 'g');
    expect(fold([ok], s0).diagnostics).toEqual([]);
    expect(fold([ok], s0, { strict: false })).toEqual(fold([ok], s0));
  });

  it('[03a AD-6] a release or consume below 0 throws when strict; non-strict clamps at 0 with one breach', () => {
    const s0 = fold([cfg(), set('KB', 2, DAY), ...submit('O1', [{ id: 'L', quantity: 1, draws: [{ stock_item_id: 'KB', quantity: 1 }], from_stock: true }])]);
    const over = released('KB', 'L', 2, T + 10, 'removed');
    expect(() => fold([over], s0)).toThrow(/stock invariant breach/);
    const loose = fold([over], s0, { strict: false });
    expect(stockOf(loose, 'KB')).toMatchObject({ on_hand: 2, reserved: 0 });
    expect(loose.lines.L).toMatchObject({ from_stock: false, cook_ms: COOK, reserved_seq: null });
    expect(loose.lines.L!.draws).toEqual([{ stock_item_id: 'KB', quantity: 1, reserved: 0 }]);
    expect(breaches(loose)).toHaveLength(1);
    expect(loose.diagnostics[0]).toMatchObject({ kind: 'stock_breach', event_id: over.event_id, stock_item_id: 'KB', detail: { on_hand: 2, reserved: 1 } });
    expectInvariants(loose);
  });

  it('[03a §3.7] a StockReserved for a line not in the state (absent, or dropped by a non-strict fold, AD-8) is a no-op; a release or consume of one still moves the entry', () => {
    const s0 = fold([cfg(), set('KB', 5, DAY)]);
    const ghost = reserved('KB', 'GHOST', 2, T);
    expect(fold([ghost], s0)).toBe(s0);
    expect(fold([ghost], s0, { strict: false })).toBe(s0);

    // A writer-bug line dropped by the non-strict ItemAdded fold (null serve_mode): its StockReserved changes nothing.
    const batch = anOrderBatch({
      order_id: 'O1',
      recorded_at: T,
      seq: nextSeq(4),
      lines: [{ order_item_id: 'BAD', item: { ...item({ id: 'BAD', draws: [{ stock_item_id: 'KB', quantity: 1 }] }), serve_mode: null }, line: { from_stock: true } }],
      reserved: [{ stock_item_id: 'KB', order_item_id: 'BAD', quantity: 1 }],
    });
    const dropped = fold(batch, s0, { strict: false });
    expect(dropped.lines.BAD).toBeUndefined();
    expect(dropped.stock).toEqual(s0.stock);
    expect(dropped.diagnostics.map((d) => d.kind)).toEqual(['invalid_event']);

    // The abandon / day-close release of a line whose order the removal step already took out (§3.3) still
    // lowers the entry; a consume likewise.
    const held = fold([cfg(), set('KB', 5, DAY), ...submit('O1', [{ id: 'L', quantity: 2, draws: [{ stock_item_id: 'KB', quantity: 2 }], from_stock: true }])]);
    const out = deepFreeze({ ...held, orders: {}, lines: Object.fromEntries(Object.entries(held.lines).filter(([id]) => id !== 'L')) });
    expect(stockOf(fold([released('KB', 'L', 2, T + 10, 'abandoned')], out), 'KB')).toMatchObject({ on_hand: 5, reserved: 0 });
    expect(stockOf(fold([consumed('KB', 'L', 2, T + 10)], out), 'KB')).toMatchObject({ on_hand: 3, reserved: 0 });
  });

  it('[03a §3.7] a stock event naming a present line that has no draw on that stock item is a writer bug (AD-8)', () => {
    const s0 = fold([cfg(), set('KB', 5, DAY), set('X', 5, DAY), ...submit('O1', [{ id: 'L', draws: [{ stock_item_id: 'KB', quantity: 1 }], from_stock: true }])]);
    for (const e of [reserved('X', 'L', 1, T + 1), released('X', 'L', 1, T + 1), consumed('X', 'L', 1, T + 1)]) {
      expect(() => fold([e], s0)).toThrow();
      const loose = fold([e], s0, { strict: false });
      expect(loose.stock).toEqual(s0.stock);
      expect(loose.lines).toEqual(s0.lines);
      expect(loose.diagnostics).toMatchObject([{ kind: 'invalid_event', event_id: e.event_id }]);
    }
  });
});

// 03a v1.2 Q-5 (§3.7, §3.12, test 127): StockTransferredOut folds as a negative StockAdded — on_hand −= quantity, clamped at
// 0 with a breach (AD-6: strict throws, non-strict one 'stock_breach'); no reservation and no re-plan.
describe('@pos/engine StockTransferredOut fold (03a v1.2 Q-5)', () => {
  it('[03a #127] lowers on_hand, clamps at 0 with a logged breach', () => {
    const s0 = fold([cfg(), set('KB', 5, DAY), ...submit('O1', [{ id: 'L', quantity: 2, draws: [{ stock_item_id: 'KB', quantity: 2 }], from_stock: true }])]);
    expect(stockOf(s0, 'KB')).toEqual({ on_hand: 5, reserved: 2, set_at: DAY, unit: 'piece' });
    const out = transferred('KB', 2, T + 10);
    const s1 = fold([out], s0);
    // on_hand only: reserved, set_at and unit are kept; no line, station or order changes (no reservation, no re-plan).
    expect(stockOf(s1, 'KB')).toEqual({ on_hand: 3, reserved: 2, set_at: DAY, unit: 'piece' });
    expect(s1.diagnostics).toEqual([]);
    expect(s1.lines).toBe(s0.lines);
    expect(s1.stations).toBe(s0.stations);
    expect(s1.orders).toBe(s0.orders);
    expect(fold([out], s0, { strict: false })).toEqual(s1);
    // Exactly what is on hand: 0, no breach.
    expect(stockOf(fold([transferred('KB', 3, T + 11)], s1), 'KB').on_hand).toBe(0);
    expect(fold([transferred('KB', 3, T + 11)], s1).diagnostics).toEqual([]);

    // Past on_hand: strict throws; non-strict clamps at 0 with one breach carrying the values before the fold.
    const over = transferred('KB', 4, T + 12);
    expect(() => fold([over], s1)).toThrow(/stock invariant breach/);
    const loose = fold([over], s1, { strict: false });
    expect(stockOf(loose, 'KB')).toEqual({ on_hand: 0, reserved: 2, set_at: DAY, unit: 'piece' });
    expect(loose.diagnostics).toEqual([
      { kind: 'stock_breach', event_id: over.event_id, stock_item_id: 'KB', detail: { event_type: 'StockTransferredOut', quantity: 4, zone_id: 'Z1', on_hand: 3, reserved: 2 } },
    ]);
    expect(loose.lines).toBe(s1.lines);
    expect(stockEffects(s1, over)).toEqual([]);
  });

  it('[03a #127] unknown stock item creates no phantom entry beyond the clamp rule', () => {
    // Review Focus 5: a stock item the hub has never seen reads as { 0, 0, null, 'piece' } (stockOf); the transfer
    // clamps at 0, writes no entry, and logs one breach; replay = live.
    const head = [cfg(), set('KB', 5, DAY)];
    const s0 = fold(head);
    const ghost = transferred('NEVER_SEEN', 3, T + 10);
    expect(() => fold([ghost], s0)).toThrow(/stock invariant breach/);
    const loose = fold([ghost], s0, { strict: false });
    expect(loose.stock).toEqual(s0.stock);
    expect(loose.stock.NEVER_SEEN).toBeUndefined();
    expect(stockOf(loose, 'NEVER_SEEN')).toEqual({ on_hand: 0, reserved: 0, set_at: null, unit: 'piece' });
    expect(loose.diagnostics).toEqual([
      { kind: 'stock_breach', event_id: ghost.event_id, stock_item_id: 'NEVER_SEEN', detail: { event_type: 'StockTransferredOut', quantity: 3, zone_id: 'Z1', on_hand: 0, reserved: 0 } },
    ]);
    const log = [...head, ghost];
    expect(buildEngineState(log.map(deepFreeze), { strict: false })).toEqual(loose);
    expect(applyEvents(initialEngineState(), log.map(deepFreeze), { strict: false })).toEqual(loose);
  });

  it('[03a #127] replay = live over a day with transfers', () => {
    const open = stamp(aBusinessDayOpened(), DAY - 30_000);
    const L = [{ id: 'L', quantity: 2, draws: [{ stock_item_id: 'KB', quantity: 2 }], from_stock: true }];
    // count 10, reserve 2 → out 3 (7) → add 2 (9) → out 5 (4) → Start consumes 2 (2, reserved 0) → out 4 clamps (0, a
    // breach) → an unknown item's transfer (a breach, no entry) → close.
    const log = [
      cfg(),
      open,
      set('KB', 10, DAY),
      ...submit('O1', L),
      transferred('KB', 3, T + 10),
      added('KB', 2, T + 20),
      transferred('KB', 5, T + 30, 'Z2'),
      started('O1', 'L', T + 40),
      consumed('KB', 'L', 2, T + 40),
      transferred('KB', 4, T + 50),
      transferred('NEVER_SEEN', 1, T + 60),
      stamp(aBusinessDayClosed(), T + 70),
    ].map(deepFreeze);
    let live = initialEngineState();
    for (const e of log) live = applyEvent(live, e, { strict: false });
    expect(stockOf(live, 'KB')).toEqual({ on_hand: 0, reserved: 0, set_at: DAY, unit: 'piece' });
    expect(live.stock.NEVER_SEEN).toBeUndefined();
    expect(breaches(live).map((b) => b.event_id)).toEqual([log.at(-3)!.event_id, log.at(-2)!.event_id]);
    expectInvariants(live);
    expect(buildEngineState(log, { strict: false })).toEqual(live);
    expect(applyEvents(initialEngineState(), log, { strict: false })).toEqual(live);
    // Strict, the first clamp throws.
    expect(() => buildEngineState(log)).toThrow(/stock invariant breach/);
  });
});
