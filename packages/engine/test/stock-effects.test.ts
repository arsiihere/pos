// 03a §3.7 / §6.1f (task 12b): stockEffects per cause (per-cause table, Q14, move to stock, StockAdded reserve),
// the StockReserved flip (from_stock false → true: stock cook, stock program, BF-7 re-place of that line only),
// the re-plan of a recount / close at its own event after its releases (§3.5.3), BF-1, BF-8.
import { parseEvent, type ConfigStockItem, type EventDraft, type PosEvent } from '@pos/events';
import {
  aBusinessDayClosed,
  aBusinessDayOpened,
  aFireDispatched,
  anEngineConfigApplied,
  anItemAdded,
  anItemStarted,
  anOrderBatch,
  aReturnLinesAdded,
  aStockAdded,
  aStockConsumed,
  aStockReleased,
  aStockReserved,
  aStockSet,
} from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { applyEvent, buildEngineState, initialEngineState, stockEffects, stockOf, type EngineState, type StockCtx } from '../src/index';
import { batchConfig, loadOf } from './batch-kit';

const T = 1_761_000_000_000;
const DAY = T - 3_600_000;
const COOK = 1_200_000;
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

const si = (id: string): ConfigStockItem => ({ stock_item_id: id, name: id, stock_unit: 'piece', carries_over: false, station_id: 'S1', low_stock_threshold: null });
const CTX: StockCtx = deepFreeze({ dayStartMs: DAY, stockItems: [si('KB'), si('X'), si('Y')], configStockUnits: { KB: 'piece', X: 'piece', Y: 'piece' } });

let seq = 10_000;
const nextSeq = (n = 0): number => {
  const s = seq;
  seq += n + 1;
  return s;
};
const stamp = (e: PosEvent, at: number): PosEvent => {
  const s = nextSeq();
  return { ...e, recorded_at: at, occurred_at: at, seq: s, event_id: `01J${String(s).padStart(23, '0')}` };
};
const ENV = anItemStarted();
// A draft (engine or command) as the host appends it: stamped at `at`.
const toEvent = (d: { stream_type: string; stream_id: string; event_type: string; schema_version: number; payload: Record<string, unknown> }, at: number): PosEvent =>
  stamp({ ...ENV, ...d, stream_type: d.stream_type as PosEvent['stream_type'], payload: d.payload }, at);
// The command's draft of an event (00's EventDraft: no ids, seq, recorded_at, tenant, branch).
const draftOf = (e: PosEvent): EventDraft => {
  const { event_id, seq: _s, recorded_at, tenant_id, branch_id, ...d } = e;
  void event_id;
  void _s;
  void recorded_at;
  void tenant_id;
  void branch_id;
  return d;
};
type Brief = { type: string; id?: string; line?: string; q?: number; reason?: string };
const brief = (d: { event_type: string; payload: Record<string, unknown> }): Brief => {
  const p = d.payload;
  const out: Brief = { type: d.event_type };
  if (typeof p.stock_item_id === 'string') out.id = p.stock_item_id;
  if (typeof p.order_item_id === 'string') out.line = p.order_item_id;
  if (typeof p.quantity === 'number') out.q = p.quantity;
  if (typeof p.reason === 'string') out.reason = p.reason;
  return out;
};

// The writer's commit: the command's drafts with their stockEffects in §4.2 batch order, stamped at `at` and folded.
function commit(state: EngineState, causes: PosEvent[], at: number, opts?: Opts): { events: PosEvent[]; state: EngineState } {
  const batch = stockEffects(state, causes.map((c) => ({ ...draftOf(c), occurred_at: at })), CTX);
  const events = batch.map((d) => toEvent(d, at));
  return { events, state: fold(events, state, opts) };
}

const cfg = (): PosEvent => stamp(anEngineConfigApplied(), DAY - 60_000);
const set = (id: string, on_hand: number, at: number, unit = 'piece'): PosEvent => stamp(aStockSet({ stream_id: id, payload: { stock_item_id: id, on_hand, unit } }), at);
const added = (id: string, quantity: number, at: number, unit = 'piece'): PosEvent => stamp(aStockAdded({ stream_id: id, payload: { stock_item_id: id, quantity, unit } }), at);
const orderEv = (event_type: string, order_id: string, payload: Record<string, unknown>, at: number): PosEvent => stamp({ ...ENV, event_type, stream_id: order_id, payload }, at);
const started = (o: string, line: string, at: number): PosEvent => orderEv('ItemStarted', o, { order_item_id: line, started_at: at, source: 'tap' }, at);
const fired = (ids: string[], at: number): PosEvent => stamp(aFireDispatched({ payload: { station_id: 'S1', order_item_ids: ids, load_id: null, due_at: at, reason: 'scheduled' } }), at);
const opened = (at: number, units: Record<string, string> = { KB: 'piece', X: 'piece', Y: 'piece' }): PosEvent =>
  stamp(aBusinessDayOpened({ payload: { business_date: '2025-10-20', stock_units: units, draws: {} } }), at);
const closed = (at: number): PosEvent => stamp(aBusinessDayClosed(), at);

type Draw = { stock_item_id: string; quantity: number };
type LineSpec = { id: string; quantity?: number; draws?: Draw[]; from_stock?: boolean };
const kb = (q = 1): Draw[] => [{ stock_item_id: 'KB', quantity: q }];

// A one-group order of stock-tracked slot lines on S1 (fresh 1 200 000, stock 60 000). `land`: the group's T; with
// `pickup` the order is a delivery picked up at T = pickup (its lines hidden until close to it). Without a pickup
// and with land near `at` the lines fire at once (frozen).
function submit(order_id: string, lines: LineSpec[], at: number, land: number, pickup?: number): PosEvent[] {
  const ids = lines.map((l) => l.id);
  return anOrderBatch({
    order_id,
    recorded_at: at,
    seq: nextSeq(lines.length * 4 + 2),
    lines: lines.map((l) => ({
      order_item_id: l.id,
      item: { name: 'Seekh kebab', quantity: l.quantity ?? 1, stock_time_ms: STOCK_COOK, stock_draws: l.draws ?? [], out_of_stock_behaviour: 'cook_fresh' },
      line: { from_stock: l.from_stock ?? false },
    })),
    order: {
      groups: [{ group_id: `${order_id}:0`, target_land_ms: land, promise_ms: land + 180_000, order_item_ids: ids }],
      ...(pickup === undefined ? {} : { order_type: 'delivery', pickup_at_ms: pickup }),
    },
    reserved: lines
      .filter((l) => l.from_stock === true)
      .flatMap((l) => (l.draws ?? []).map((d) => ({ stock_item_id: d.stock_item_id, order_item_id: l.id, quantity: d.quantity }))),
  });
}
const hidden = (order_id: string, lines: LineSpec[], pickup: number, at = T): PosEvent[] => submit(order_id, lines, at, pickup, pickup);
const frozen = (order_id: string, lines: LineSpec[], at = T): PosEvent[] => submit(order_id, lines, at, at + COOK + 30_000);

// Placement of every line: what a re-plan may change.
const placement = (s: EngineState): Record<string, unknown> =>
  Object.fromEntries(Object.values(s.lines).map((l) => [l.order_item_id, { fire_ms: l.fire_ms, booked: l.booked, load_id: l.load_id, deadline_ms: l.deadline_ms }]));
const changed = (a: EngineState, b: EngineState): string[] => {
  const pa = placement(a);
  const pb = placement(b);
  return Object.keys(pb).filter((k) => JSON.stringify(pa[k]) !== JSON.stringify(pb[k])).sort();
};
const breaches = (s: EngineState) => s.diagnostics.filter((d) => d.kind === 'stock_breach');
const replay = (log: PosEvent[]): EngineState => buildEngineState(log.map(deepFreeze));

describe('@pos/engine stockEffects (§3.7, §6.1f)', () => {
  it('[03a #87] StockAdded reserves waiting hidden full-cook lines in deadline order; folding flips, switches to stock cook and re-plans; frozen, fired, return lines untouched; replay = live', () => {
    const p = T + 3_600_000;
    // R0 is served, then returned (remake): its return line R0R has no draw ([03a #75]).
    const r0 = frozen('O7', [{ id: 'R0', draws: kb() }]);
    const r0Added = r0.find((e) => e.event_type === 'ItemAdded')!;
    const head = [
      cfg(),
      set('KB', 0, DAY),
      ...frozen('O5', [{ id: 'FZ', draws: kb() }]), // frozen, earliest deadline (G4-3 #4): skipped
      ...frozen('O6', [{ id: 'FD', draws: kb() }]),
      fired(['FD'], T + 1),
      ...hidden('O1', [{ id: 'H1', draws: kb() }], p),
      ...hidden('O2', [{ id: 'H2', quantity: 1, draws: kb(3) }], p + 100_000), // does not fit: skipped
      ...hidden('O3', [{ id: 'H3', draws: kb() }], p + 200_000),
      ...hidden('O4', [{ id: 'H4', draws: kb() }], p + 300_000), // beyond the reach
      ...r0,
      fired(['R0'], T + 2),
      started('O7', 'R0', T + 3),
      orderEv('ItemDone', 'O7', { order_item_id: 'R0', done_at: T + 4 }, T + 4),
      orderEv('ItemServed', 'O7', { order_item_ids: ['R0'], source: 'tap' }, T + 5),
      ...aReturnLinesAdded({ ...r0Added, seq: nextSeq(4) }, 'remake', { recorded_at: T + 6, target_land_ms: T + 6 + COOK }),
    ];
    const s0 = fold(head);
    expect(s0.lines.R0R).toMatchObject({ draws: [], return_of: { order_item_id: 'R0', mode: 'remake' } });
    expect(s0.lines.FZ!.deadline_ms).toBeLessThan(s0.lines.H1!.deadline_ms);
    expect(s0.lines.FZ!.fire_ms! <= T + 1_000 + 120_000).toBe(true);
    for (const id of ['H1', 'H2', 'H3', 'H4']) expect(s0.lines[id]).toMatchObject({ from_stock: false, cook_ms: COOK });

    const add = added('KB', 2, T + 1_000);
    const fx = stockEffects(s0, { ...draftOf(add), occurred_at: T + 1_000 }, CTX);
    expect(fx).toEqual([
      { stream_type: 'stock', stream_id: 'KB', event_type: 'StockReserved', schema_version: 1, payload: { stock_item_id: 'KB', order_item_id: 'H1', quantity: 1 } },
      { stream_type: 'stock', stream_id: 'KB', event_type: 'StockReserved', schema_version: 1, payload: { stock_item_id: 'KB', order_item_id: 'H3', quantity: 1 } },
    ]);
    const { events, state: s1 } = commit(s0, [add], T + 1_000);
    expect(stockOf(s1, 'KB')).toMatchObject({ on_hand: 2, reserved: 2 });
    for (const [id, pickup] of [['H1', p], ['H3', p + 200_000]] as const) {
      const before = s0.lines[id]!;
      const after = s1.lines[id]!;
      expect(after).toMatchObject({ from_stock: true, cook_ms: STOCK_COOK, full_cook_ms: COOK });
      expect(after.fire_ms!).toBeGreaterThan(before.fire_ms!); // fires later …
      expect(after.booked!.end - after.booked!.start).toBe(STOCK_COOK);
      expect(after.booked!.end).toBeLessThanOrEqual(pickup); // … and still lands on its T
      expect(s1.orders[after.order_id]!.groups[after.group_id]!.target_land_ms).toBe(pickup);
    }
    for (const id of ['FZ', 'FD', 'H2', 'H4', 'R0R']) expect(s1.lines[id]).toEqual(s0.lines[id]);
    expect(changed(s0, s1)).toEqual(['H1', 'H3']);
    expect(replay([...head, ...events])).toEqual(s1);
  });

  it('[03a #87] batch: a line in a hidden load switches to its stock program and lands in a load of it; a line in a frozen or fired load is not a candidate', () => {
    const item = (draws: Draw[], cook = 300_000) => ({
      station_id: 'F',
      program_id: 'P1',
      program_cook_time_ms: cook,
      stock_program_id: 'P2',
      stock_program_cook_time_ms: 60_000,
      cook_time_ms: 999_999,
      quantity: 1,
      stock_draws: draws,
      out_of_stock_behaviour: 'cook_fresh',
    });
    const batchOrder = (order_id: string, id: string, land: number, pickup: number | null, cook = 300_000) =>
      anOrderBatch({
        order_id,
        recorded_at: T,
        seq: nextSeq(4),
        lines: [{ order_item_id: id, item: item(kb(), cook), line: { station_id: 'F', from_stock: false } }],
        order: {
          groups: [{ group_id: `${order_id}:0`, target_land_ms: land, promise_ms: land + 180_000, order_item_ids: [id] }],
          ...(pickup === null ? {} : { order_type: 'delivery', pickup_at_ms: pickup }),
        },
      });
    const p = T + 3_600_000;
    const pre = [
      stamp(batchConfig({}, DAY - 60_000), DAY - 60_000),
      set('KB', 0, DAY),
      ...batchOrder('OF', 'BZ', T + 330_000, null),
      ...batchOrder('OD', 'BD', T + 700_000, null, 240_000), // another cook: its own load, not BZ's
      ...batchOrder('OH', 'BH', p, p),
    ];
    const sPre = fold(pre);
    // BD's load fires (it then leaves `loads`, D34): a line of a fired load is not a candidate either.
    const bd = loadOf(sPre, 'BD')!;
    expect(bd.order_item_ids).toEqual(['BD']);
    const fireBd = stamp(aFireDispatched({ stream_id: 'F', payload: { station_id: 'F', order_item_ids: bd.order_item_ids, load_id: bd.load_id, due_at: T + 1, reason: 'scheduled' } }), T + 1);
    const head = [...pre, fireBd];
    const s0 = fold(head);
    expect(s0.lines.BD!.fired_at).toBe(T + 1);
    expect(loadOf(s0, 'BH')).toMatchObject({ program_id: 'P1' });
    expect(loadOf(s0, 'BZ')!.fire_ms <= T + 1_000 + 120_000).toBe(true); // frozen load
    const { events, state: s1 } = commit(s0, [added('KB', 3, T + 1_000)], T + 1_000);
    expect(events.map(brief)).toEqual([
      { type: 'StockAdded', id: 'KB', q: 3 },
      { type: 'StockReserved', id: 'KB', line: 'BH', q: 1 },
    ]);
    const load = loadOf(s1, 'BH')!;
    expect(load).toMatchObject({ program_id: 'P2', order_item_ids: ['BH'] });
    expect(load.booked.end - load.booked.start).toBe(60_000);
    expect(load.booked.end).toBeLessThanOrEqual(p);
    expect(s1.lines.BH).toMatchObject({ from_stock: true, cook_ms: 60_000, program_id: 'P1', stock_program_id: 'P2', load_id: load.load_id, fire_ms: load.fire_ms });
    // The old P1 load had BH alone: it left with its booking (AD-7); the profile holds the two loads only.
    expect(Object.keys(s1.stations.F!.loads).length).toBe(2);
    expect(s1.lines.BZ).toEqual(s0.lines.BZ);
    expect(loadOf(s1, 'BZ')).toEqual(loadOf(s0, 'BZ'));
    expect(s1.lines.BD).toEqual(s0.lines.BD);
    expect(replay([...head, ...events])).toEqual(s1);

    // BF-1: a later whole release (a recount to 0) sends BH back to its program_id; the StockSet re-plan puts it in a
    // P1 load at its full cook, landing on the same T.
    const r = commit(s1, [set('KB', 0, T + 2_000)], T + 2_000);
    expect(r.events.map(brief)).toEqual([{ type: 'StockReleased', id: 'KB', line: 'BH', q: 1, reason: 'recount' }, { type: 'StockSet', id: 'KB' }]);
    const back = loadOf(r.state, 'BH')!;
    expect(r.state.lines.BH).toMatchObject({ from_stock: false, cook_ms: 300_000, program_id: 'P1', stock_program_id: 'P2' });
    expect(back).toMatchObject({ program_id: 'P1', order_item_ids: ['BH'] });
    expect(back.booked.end - back.booked.start).toBe(300_000);
    expect(back.booked.end).toBeLessThanOrEqual(p);
  });

  it('[03a BF-7] a flip re-places only the flipped line: every other line keeps its fire_ms and booking', () => {
    const p = T + 3_600_000;
    const head = [
      cfg(),
      set('KB', 0, DAY),
      ...hidden('O1', [{ id: 'Y1' }, { id: 'Y2' }], p),
      ...hidden('O2', [{ id: 'X', draws: kb() }], p + 60_000),
      ...hidden('O3', [{ id: 'Y3' }], p + 120_000),
    ];
    const s0 = fold(head);
    const reserve = toEvent(stockEffects(s0, { ...draftOf(added('KB', 1, T + 1_000)), occurred_at: T + 1_000 }, CTX)[0]!, T + 1_000);
    const s1 = fold([added('KB', 1, T + 1_000)], s0);
    const s2 = fold([reserve], s1);
    expect(changed(s1, s2)).toEqual(['X']);
    for (const id of ['Y1', 'Y2', 'Y3']) {
      expect(s2.lines[id]!.fire_ms).toBe(s1.lines[id]!.fire_ms);
      expect(s2.lines[id]!.booked).toEqual(s1.lines[id]!.booked);
    }
    expect(s2.lines.X!.fire_ms!).toBeGreaterThan(s1.lines.X!.fire_ms!);
  });

  it('[03a #40] recount below reserved releases hidden lines newest first, every draw; frozen and fired kept; on_hand < reserved by exactly their units; one re-plan at the StockSet, at full cook', () => {
    const p = T + 3_600_000;
    const head = [
      cfg(),
      set('KB', 6, DAY),
      set('X', 2, DAY),
      ...hidden('O1', [{ id: 'A', draws: kb(), from_stock: true }], p),
      ...hidden('O2', [{ id: 'B', draws: [...kb(), { stock_item_id: 'X', quantity: 1 }], from_stock: true }], p + 100_000),
      ...hidden('O3', [{ id: 'C', draws: kb(), from_stock: true }], p + 200_000),
      ...frozen('O4', [{ id: 'Z', draws: kb(), from_stock: true }]),
      ...frozen('O5', [{ id: 'W', draws: kb(), from_stock: true }]),
      fired(['W'], T + 1),
    ];
    const s0 = fold(head);
    expect(stockOf(s0, 'KB')).toMatchObject({ on_hand: 6, reserved: 5 });
    const count = set('KB', 1, T + 1_000);
    const { events, state: s1 } = commit(s0, [count], T + 1_000);
    expect(events.map(brief)).toEqual([
      { type: 'StockReleased', id: 'KB', line: 'C', q: 1, reason: 'recount' },
      { type: 'StockReleased', id: 'KB', line: 'B', q: 1, reason: 'recount' },
      { type: 'StockReleased', id: 'X', line: 'B', q: 1, reason: 'recount' },
      { type: 'StockReleased', id: 'KB', line: 'A', q: 1, reason: 'recount' },
      { type: 'StockSet', id: 'KB' },
    ]);
    // Strict fold: no breach (the excess is held by Z and W only).
    expect(stockOf(s1, 'KB')).toMatchObject({ on_hand: 1, reserved: 2 });
    expect(stockOf(s1, 'X')).toMatchObject({ reserved: 0 });
    expect(breaches(s1)).toEqual([]);
    // The releases are bookkeeping only; the re-plan runs once, at the StockSet.
    let s = s0;
    for (const e of events.slice(0, 4)) {
      const n = fold([e], s);
      expect(n.stations).toBe(s.stations);
      s = n;
    }
    for (const [id, pickup] of [['A', p], ['B', p + 100_000], ['C', p + 200_000]] as const) {
      const l = s1.lines[id]!;
      expect(l).toMatchObject({ from_stock: false, cook_ms: COOK, reserved_seq: null });
      expect(l.booked!.end - l.booked!.start).toBe(COOK);
      expect(l.booked!.end).toBeLessThanOrEqual(pickup);
      expect(l.fire_ms!).toBeLessThan(s0.lines[id]!.fire_ms!);
    }
    for (const id of ['Z', 'W']) expect(s1.lines[id]).toEqual(s0.lines[id]);
    expect(replay([...head, ...events])).toEqual(s1);
  });

  it('[03a #109] recount by reserved_seq: three from-stock lines, a StockSet 1 below reserved releases the newest line whole', () => {
    const p = T + 3_600_000;
    const s0 = fold([
      cfg(),
      set('KB', 6, DAY),
      ...hidden('O1', [{ id: 'A', quantity: 2, draws: kb(2), from_stock: true }], p),
      ...hidden('O2', [{ id: 'B', quantity: 2, draws: kb(2), from_stock: true }], p),
      ...hidden('O3', [{ id: 'C', quantity: 2, draws: kb(2), from_stock: true }], p),
    ]);
    const { events, state } = commit(s0, [set('KB', 5, T + 1_000)], T + 1_000);
    expect(events.map(brief)).toEqual([{ type: 'StockReleased', id: 'KB', line: 'C', q: 2, reason: 'recount' }, { type: 'StockSet', id: 'KB' }]);
    expect(stockOf(state, 'KB')).toMatchObject({ on_hand: 5, reserved: 4 });
    expect(state.lines.C).toMatchObject({ from_stock: false, reserved_seq: null });
    expect(state.lines.A).toMatchObject({ from_stock: true });
  });

  it('[03a #88] stockEffects per trigger: removed, voided per unit, Start consumes a live reservation', () => {
    const p = T + 3_600_000;
    const s0 = fold([
      cfg(),
      set('KB', 9, DAY),
      set('X', 9, DAY),
      ...hidden('O1', [{ id: 'R', draws: [...kb(), { stock_item_id: 'X', quantity: 1 }], from_stock: true }], p),
      ...hidden('O2', [{ id: 'V', quantity: 3, draws: kb(3), from_stock: true }], p),
      ...hidden('O3', [{ id: 'F', draws: kb() }], p), // not from stock: nothing to release
    ]);
    const at = T + 1_000;
    const eff = (e: PosEvent) => stockEffects(s0, { ...draftOf(e), occurred_at: at }, CTX).map(brief);
    expect(eff(orderEv('ItemRemoved', 'O1', { order_item_id: 'R' }, at))).toEqual([
      { type: 'StockReleased', id: 'KB', line: 'R', q: 1, reason: 'removed' },
      { type: 'StockReleased', id: 'X', line: 'R', q: 1, reason: 'removed' },
    ]);
    expect(eff(orderEv('ItemVoided', 'O2', { order_item_id: 'V', units: 1 }, at))).toEqual([{ type: 'StockReleased', id: 'KB', line: 'V', q: 1, reason: 'voided' }]);
    expect(eff(orderEv('ItemVoided', 'O2', { order_item_id: 'V', units: 3 }, at))).toEqual([{ type: 'StockReleased', id: 'KB', line: 'V', q: 3, reason: 'voided' }]);
    expect(eff(orderEv('ItemRemoved', 'O3', { order_item_id: 'F' }, at))).toEqual([]);
    expect(eff(started('O1', 'R', at))).toEqual([
      { type: 'StockConsumed', id: 'KB', line: 'R', q: 1 },
      { type: 'StockConsumed', id: 'X', line: 'R', q: 1 },
    ]);
    expect(eff(started('O3', 'F', at))).toEqual([]);
    // A partial void committed: the cause, then its release; the line keeps from_stock with 2 units reserved.
    const v = commit(s0, [orderEv('ItemVoided', 'O2', { order_item_id: 'V', units: 1 }, at)], at);
    expect(v.events.map((e) => e.event_type)).toEqual(['ItemVoided', 'StockReleased']);
    expect(v.state.lines.V).toMatchObject({ units: 2, from_stock: true, draws: [{ stock_item_id: 'KB', quantity: 2, reserved: 2 }] });
  });

  // 03a v1.2 Q-4 (§3.7, §4.2): a partial ItemRemoved takes the partial-void unit path; its releases keep reason `removed`.
  const q4Head = (): PosEvent[] => [
    cfg(),
    set('KB', 9, DAY),
    set('X', 9, DAY),
    ...hidden('O4', [{ id: 'P', quantity: 3, draws: [...kb(3), { stock_item_id: 'X', quantity: 6 }], from_stock: true }], T + 3_600_000),
  ];

  it('[03a #126] units 1 on a 3-unit from-stock line → one unit\'s share released per draw, line keeps 2', () => {
    const head = q4Head();
    const s0 = fold(head);
    const at = T + 1_000;
    const cause = orderEv('ItemRemoved', 'O4', { order_item_id: 'P', units: 1 }, at);
    expect(stockEffects(s0, { ...draftOf(cause), occurred_at: at }, CTX).map(brief)).toEqual([
      { type: 'StockReleased', id: 'KB', line: 'P', q: 1, reason: 'removed' },
      { type: 'StockReleased', id: 'X', line: 'P', q: 2, reason: 'removed' },
    ]);
    const { events, state: s1 } = commit(s0, [cause], at);
    expect(events.map((e) => e.event_type)).toEqual(['ItemRemoved', 'StockReleased', 'StockReleased']);
    expect(s1.lines.P).toMatchObject({
      stage: 'added',
      units: 2,
      from_stock: true,
      draws: [
        { stock_item_id: 'KB', quantity: 2, reserved: 2 },
        { stock_item_id: 'X', quantity: 4, reserved: 4 },
      ],
    });
    expect(stockOf(s1, 'KB')).toMatchObject({ on_hand: 9, reserved: 2 });
    expect(stockOf(s1, 'X')).toMatchObject({ on_hand: 9, reserved: 4 });
    expect(breaches(s1)).toEqual([]);
    expect(replay([...head, ...events])).toEqual(s1);
  });

  it('[03a #126] units absent → whole line (test 88 holds)', () => {
    const head = q4Head();
    const s0 = fold(head);
    const at = T + 1_000;
    const { events, state: s1 } = commit(s0, [orderEv('ItemRemoved', 'O4', { order_item_id: 'P' }, at)], at);
    expect(events.map(brief)).toEqual([
      { type: 'ItemRemoved', line: 'P' },
      { type: 'StockReleased', id: 'KB', line: 'P', q: 3, reason: 'removed' },
      { type: 'StockReleased', id: 'X', line: 'P', q: 6, reason: 'removed' },
    ]);
    expect(s1.lines.P).toMatchObject({ stage: 'removed', units: 3 });
    expect(stockOf(s1, 'KB')).toMatchObject({ on_hand: 9, reserved: 0 });
    expect(stockOf(s1, 'X')).toMatchObject({ on_hand: 9, reserved: 0 });
    expect(replay([...head, ...events])).toEqual(s1);
  });

  it('[03a §3.7 Q-4] units ≥ line units removes the whole line once', () => {
    for (const units of [3, 5]) {
      const head = q4Head();
      const s0 = fold(head);
      const at = T + 1_000;
      const { events, state: s1 } = commit(s0, [orderEv('ItemRemoved', 'O4', { order_item_id: 'P', units }, at)], at);
      expect(events.map(brief)).toEqual([
        { type: 'ItemRemoved', line: 'P' },
        { type: 'StockReleased', id: 'KB', line: 'P', q: 3, reason: 'removed' },
        { type: 'StockReleased', id: 'X', line: 'P', q: 6, reason: 'removed' },
      ]);
      // The whole line: stage removed, units never negative, every draw released once (no breach).
      expect(s1.lines.P).toMatchObject({ stage: 'removed', units: 3, draws: [{ quantity: 3, reserved: 0 }, { quantity: 6, reserved: 0 }] });
      expect(stockOf(s1, 'KB')).toMatchObject({ on_hand: 9, reserved: 0 });
      expect(stockOf(s1, 'X')).toMatchObject({ on_hand: 9, reserved: 0 });
      expect(breaches(s1)).toEqual([]);
      // A second remove of the ended line drafts and folds nothing.
      const again = orderEv('ItemRemoved', 'O4', { order_item_id: 'P', units }, at + 1);
      expect(stockEffects(s1, { ...draftOf(again), occurred_at: at + 1 }, CTX).map(brief)).toEqual([]);
      expect(replay([...head, ...events])).toEqual(s1);
    }
  });

  it('[03a #88] BusinessDayClosed releases hidden lines of kept orders and exited lines still reserved, before the close; frozen and fired keep theirs and consume at Start; one re-plan at the close', () => {
    const p = T + 3_600_000;
    const head = [
      cfg(),
      opened(DAY),
      set('KB', 9, DAY),
      set('Y', 3, DAY), // reserved 0: no release for Y
      ...hidden('O1', [{ id: 'H', draws: kb(), from_stock: true }], p),
      ...frozen('O2', [{ id: 'Z', draws: kb(), from_stock: true }]),
      ...frozen('O3', [{ id: 'W', draws: kb(), from_stock: true }]),
      fired(['W'], T + 1),
      ...frozen('O4', [{ id: 'S', draws: kb(), from_stock: true }]),
      orderEv('ItemServed', 'O4', { order_item_ids: ['S'], source: 'tap' }, T + 2), // a log with no consume drafted: still reserved
    ];
    const s0 = fold(head);
    const at = T + 600_000;
    const { events, state: s1 } = commit(s0, [closed(at)], at);
    expect(events.map(brief)).toEqual([
      { type: 'StockReleased', id: 'KB', line: 'H', q: 1, reason: 'day_closed' },
      { type: 'StockReleased', id: 'KB', line: 'S', q: 1, reason: 'day_closed' },
      { type: 'BusinessDayClosed' },
    ]);
    let s = s0;
    for (const e of events.slice(0, 2)) {
      const n = fold([e], s);
      expect(n.stations).toBe(s.stations);
      s = n;
    }
    expect(s1.lines.H).toMatchObject({ from_stock: false, cook_ms: COOK });
    expect(s1.lines.H!.booked!.end - s1.lines.H!.booked!.start).toBe(COOK);
    expect(s1.lines.H!.booked!.end).toBeLessThanOrEqual(p);
    expect(s1.lines.S).toBeUndefined(); // O4 exited at the close
    expect(stockOf(s1, 'KB')).toMatchObject({ reserved: 2 });
    for (const id of ['Z', 'W']) expect(s1.lines[id]).toMatchObject({ from_stock: true, draws: [{ stock_item_id: 'KB', quantity: 1, reserved: 1 }] });
    expect(stockEffects(s1, { ...draftOf(started('O2', 'Z', at + 1)), occurred_at: at + 1 }, CTX).map(brief)).toEqual([{ type: 'StockConsumed', id: 'KB', line: 'Z', q: 1 }]);
    expect(replay([...head, ...events])).toEqual(s1);
  });

  it('[03a #42] close then open with a unit change: frozen and fired carried over the close; BusinessDayOpened drafts nothing; the unit-changing StockSet is preceded by their StockConsumed and enters with reserved 0', () => {
    const head = [
      cfg(),
      opened(DAY),
      set('KB', 9, DAY),
      ...frozen('O2', [{ id: 'Z', draws: kb(), from_stock: true }]),
      ...frozen('O3', [{ id: 'W', draws: kb(), from_stock: true }]),
      fired(['W'], T + 1),
    ];
    const close = commit(fold(head), [closed(T + 600_000)], T + 600_000);
    // BF-11 rewrite of the first clause: the close releases hidden lines only (#88), so the frozen and fired lines'
    // reservations are carried: reserved = 2 at the open.
    expect(close.events.map(brief)).toEqual([{ type: 'BusinessDayClosed' }]);
    const open = opened(T + 1_200_000, { KB: 'g', X: 'piece', Y: 'piece' });
    expect(stockEffects(close.state, { ...draftOf(open), occurred_at: T + 1_200_000 }, CTX)).toEqual([]);
    const s2 = fold([open], close.state);
    expect(stockOf(s2, 'KB')).toMatchObject({ reserved: 2, unit: 'piece' });
    const ctxG: StockCtx = { ...CTX, dayStartMs: T + 1_200_000, configStockUnits: { ...CTX.configStockUnits, KB: 'g' } };
    const count = set('KB', 500, T + 1_300_000, 'g');
    const batch = stockEffects(s2, [{ ...draftOf(count), occurred_at: T + 1_300_000 }], ctxG);
    expect(batch.map(brief)).toEqual([
      { type: 'StockConsumed', id: 'KB', line: 'Z', q: 1 },
      { type: 'StockConsumed', id: 'KB', line: 'W', q: 1 },
      { type: 'StockSet', id: 'KB' },
    ]);
    const s3 = fold(batch.map((d) => toEvent(d, T + 1_300_000)), s2);
    expect(stockOf(s3, 'KB')).toEqual({ on_hand: 500, reserved: 0, set_at: T + 1_300_000, unit: 'g' });
    expect(breaches(s3)).toEqual([]);
    for (const id of ['Z', 'W']) {
      expect(s3.lines[id]).toMatchObject({ from_stock: true, reserved_seq: null });
      expect(stockEffects(s3, { ...draftOf(started(s3.lines[id]!.order_id, id, T + 1_400_000)), occurred_at: T + 1_400_000 }, ctxG)).toEqual([]);
    }
  });

  it('[03a §3.7] a hidden line of an order kept over the close is a StockAdded candidate after the open when no unit changed', () => {
    const p = T + 3_600_000;
    const head = [cfg(), opened(DAY), set('KB', 1, DAY), ...hidden('O1', [{ id: 'H', draws: kb(), from_stock: true }], p)];
    const close = commit(fold(head), [closed(T + 600_000)], T + 600_000);
    expect(close.events.map(brief)).toEqual([{ type: 'StockReleased', id: 'KB', line: 'H', q: 1, reason: 'day_closed' }, { type: 'BusinessDayClosed' }]);
    expect(close.state.lines.H).toMatchObject({ from_stock: false, cook_ms: COOK });
    const s1 = fold([opened(T + 1_200_000)], close.state);
    const ctx: StockCtx = { ...CTX, dayStartMs: T + 1_200_000 };
    const count = set('KB', 2, T + 1_300_000);
    const batch = stockEffects(s1, [{ ...draftOf(count), occurred_at: T + 1_300_000 }], ctx);
    expect(batch.map(brief)).toEqual([{ type: 'StockSet', id: 'KB' }, { type: 'StockReserved', id: 'KB', line: 'H', q: 1 }]);
    const s2 = fold(batch.map((d) => toEvent(d, T + 1_300_000)), s1);
    expect(s2.lines.H).toMatchObject({ from_stock: true, cook_ms: STOCK_COOK });
    expect(s2.lines.H!.booked!.end).toBeLessThanOrEqual(p);
    // The release and the flip shift the deadline with the same capacity: back to the submit's deadline_ms.
    expect(s2.lines.H!.deadline_ms).toBe(fold(head).lines.H!.deadline_ms);
  });

  it('[03a #118] Q14 on a multi-draw line: a unit-changing StockSet of X consumes L\'s X and Y draws before it; both reserved 0; L\'s Start drafts nothing; no breach', () => {
    const head = [cfg(), opened(DAY), set('X', 2, DAY), set('Y', 2, DAY), ...frozen('O1', [{ id: 'L', draws: [{ stock_item_id: 'X', quantity: 1 }, { stock_item_id: 'Y', quantity: 1 }], from_stock: true }])];
    const close = commit(fold(head), [closed(T + 600_000)], T + 600_000);
    expect(close.events.map((e) => e.event_type)).toEqual(['BusinessDayClosed']);
    const s1 = fold([opened(T + 1_200_000, { KB: 'piece', X: 'g', Y: 'piece' })], close.state);
    const ctx: StockCtx = { ...CTX, dayStartMs: T + 1_200_000 };
    const count = set('X', 500, T + 1_300_000, 'g');
    const batch = stockEffects(s1, [{ ...draftOf(count), occurred_at: T + 1_300_000 }], ctx);
    expect(batch.map(brief)).toEqual([
      { type: 'StockConsumed', id: 'X', line: 'L', q: 1 },
      { type: 'StockConsumed', id: 'Y', line: 'L', q: 1 },
      { type: 'StockSet', id: 'X' },
    ]);
    const s2 = fold(batch.map((d) => toEvent(d, T + 1_300_000)), s1); // strict: would throw on a breach
    expect(stockOf(s2, 'X')).toMatchObject({ reserved: 0, unit: 'g', on_hand: 500 });
    expect(stockOf(s2, 'Y')).toMatchObject({ reserved: 0 });
    expect(s2.lines.L).toMatchObject({ reserved_seq: null, draws: [{ stock_item_id: 'X', quantity: 1, reserved: 0 }, { stock_item_id: 'Y', quantity: 1, reserved: 0 }] });
    expect(stockEffects(s2, { ...draftOf(started('O1', 'L', T + 1_400_000)), occurred_at: T + 1_400_000 }, ctx)).toEqual([]);
    expect(breaches(s2)).toEqual([]);
  });

  // AD-29 Q6 (owner ruling 2026-11-08): BF-9 stays parked; AD-2's re-reserve is superseded. A unit-changing StockSet
  // consumes every holding line first (Q14; tests #42, #118 above), so nothing is re-reserved in the new unit.
  it.todo('[03a BF-9] parked (AD-29 Q6): no re-reserve after a unit-changing StockSet — held lines are consumed before it (tests #42, #118); AD-2 superseded');

  it('[03a #84] move to stock: release moved (if reserved) + StockAdded moved per draw for the moved units; none without a draw; StockAdded without reason parses', () => {
    const s0 = fold([
      cfg(),
      set('KB', 1, DAY),
      ...frozen('O1', [{ id: 'M', quantity: 2, draws: kb(2) }]),
      fired(['M'], T + 1),
      started('O1', 'M', T + 2),
      ...frozen('O2', [{ id: 'M2', draws: kb(), from_stock: true }]),
      ...frozen('O3', [{ id: 'N' }]),
    ]);
    const at = T + 1_000;
    const eff = (e: PosEvent) => stockEffects(s0, { ...draftOf(e), occurred_at: at }, CTX);
    expect(eff(orderEv('ItemMovedToStock', 'O1', { order_item_id: 'M', units: 2 }, at))).toEqual([
      { stream_type: 'stock', stream_id: 'KB', event_type: 'StockAdded', schema_version: 2, payload: { stock_item_id: 'KB', quantity: 2, unit: 'piece', reason: 'moved' } },
    ]);
    expect(eff(orderEv('ItemMovedToStock', 'O1', { order_item_id: 'M', units: 1 }, at)).map(brief)).toEqual([{ type: 'StockAdded', id: 'KB', q: 1, reason: 'moved' }]);
    expect(eff(orderEv('ItemMovedToStock', 'O2', { order_item_id: 'M2', units: 1 }, at)).map(brief)).toEqual([
      { type: 'StockReleased', id: 'KB', line: 'M2', q: 1, reason: 'moved' },
      { type: 'StockAdded', id: 'KB', q: 1, reason: 'moved' },
    ]);
    expect(eff(orderEv('ItemMovedToStock', 'O3', { order_item_id: 'N', units: 1 }, at))).toEqual([]);
    expect(parseEvent(aStockAdded()).payload).toEqual({ stock_item_id: 'I1', quantity: 5, unit: 'piece' });
    expect(parseEvent(aStockAdded({ payload: { stock_item_id: 'I1', quantity: 5, unit: 'piece', reason: 'moved' } })).payload).toMatchObject({ reason: 'moved' });
  });

  it('[03a #105] move to stock reserves: one portion moved with one waiting fresh line → release, add, then StockReserved in one result', () => {
    const p = T + 3_600_000;
    const head = [cfg(), set('KB', 1, DAY), ...frozen('O1', [{ id: 'M', draws: kb(), from_stock: true }]), fired(['M'], T + 1), ...hidden('O2', [{ id: 'W', draws: kb() }], p)];
    const s0 = fold(head);
    const { events, state } = commit(s0, [orderEv('ItemMovedToStock', 'O1', { order_item_id: 'M', units: 1 }, T + 1_000)], T + 1_000);
    expect(events.map(brief)).toEqual([
      { type: 'ItemMovedToStock', line: 'M' },
      { type: 'StockReleased', id: 'KB', line: 'M', q: 1, reason: 'moved' },
      { type: 'StockAdded', id: 'KB', q: 1, reason: 'moved' },
      { type: 'StockReserved', id: 'KB', line: 'W', q: 1 },
    ]);
    expect(stockOf(state, 'KB')).toMatchObject({ on_hand: 2, reserved: 1 });
    expect(state.lines.W).toMatchObject({ from_stock: true, cook_ms: STOCK_COOK });
    expect(replay([...head, ...events])).toEqual(state);
  });

  it('[03a #104] one re-plan per batch: a from-stock submit (3 draws, and an OrderLinesAdded) re-plans at awaiting 0 and its StockReserved re-plan nothing; a StockAdded re-plans once per flipped line; a recount once at the StockSet; replay = live', () => {
    const draws3 = [...kb(), { stock_item_id: 'X', quantity: 1 }, { stock_item_id: 'Y', quantity: 1 }];
    const base = fold([cfg(), set('KB', 40, DAY), set('X', 40, DAY), set('Y', 40, DAY)]);
    const sub = hidden('O1', [{ id: 'L3', draws: draws3, from_stock: true }], T + 3_600_000);
    let s = base;
    for (const e of sub) {
      const n = fold([e], s);
      if (e.event_type === 'StockReserved') expect(n.stations).toBe(s.stations);
      if (e.event_type === 'ItemAdded') expect(n.stations).not.toBe(s.stations);
      s = n;
    }
    // OrderLinesAdded: a from-stock line added to O1, its ItemAdded, its StockReserved.
    const at = T + 500;
    const more = [
      orderEv(
        'OrderLinesAdded',
        'O1',
        {
          order_id: 'O1',
          order_item_ids: ['L4'],
          groups: [{ group_id: 'O1:1', target_land_ms: T + 3_600_000, promise_ms: T + 3_780_000, order_item_ids: ['L4'] }],
          lines: [{ order_item_id: 'L4', station_id: 'S1', alternates: [], point_id: null, carry_ms: 0, from_stock: true, weight_pct: 100, max_early_ms: 60_000, max_late_ms: null, max_carry_ms: null, return_of: null, cook_ms_override: null }],
        },
        at,
      ),
      stamp({ ...anItemAdded(), stream_id: 'O1', payload: { ...anItemAdded().payload, order_id: 'O1', order_item_id: 'L4', stock_time_ms: STOCK_COOK, stock_draws: draws3 } }, at),
      ...draws3.map((d) => stamp(aStockReserved({ stream_id: d.stock_item_id, payload: { stock_item_id: d.stock_item_id, order_item_id: 'L4', quantity: 1 } }), at)),
    ];
    for (const e of more) {
      const n = fold([e], s);
      if (e.event_type === 'StockReserved') expect(n.stations).toBe(s.stations);
      if (e.event_type === 'ItemAdded') expect(n.stations).not.toBe(s.stations);
      s = n;
    }
    expect(s.lines.L4).toMatchObject({ from_stock: true, cook_ms: STOCK_COOK });

    // 20 waiting lines; a StockAdded of 20 X reserves all (each also draws Y, available) and each flip re-places one.
    const xy = [{ stock_item_id: 'X', quantity: 1 }, { stock_item_id: 'Y', quantity: 1 }];
    const waits = Array.from({ length: 20 }, (_, i) => hidden(`W${i}`, [{ id: `w${String(i).padStart(2, '0')}`, draws: xy }], T + 3_600_000 + i * 120_000)).flat();
    const s20 = fold([set('X', 2, T + 600), ...waits], s);
    const add = commit(s20, [added('X', 20, T + 1_000)], T + 1_000);
    expect(add.events.filter((e) => e.event_type === 'StockReserved').length).toBe(40);
    let w = fold([add.events[0]!], s20);
    const flips: string[][] = [];
    for (const e of add.events.slice(1)) {
      const n = fold([e], w);
      const c = changed(w, n);
      if (c.length > 0) flips.push(c);
      else expect(n.stations).toBe(w.stations); // the Y reservation flips nothing, re-plans nothing
      w = n;
    }
    expect(flips).toEqual(Array.from({ length: 20 }, (_, i) => [`w${String(i).padStart(2, '0')}`]));
    expect(w).toEqual(add.state);

    // A recount that releases 5 lines: the releases leave the stations alone; the StockSet re-plans.
    const five = Array.from({ length: 5 }, (_, i) => hidden(`R${i}`, [{ id: `r${i}`, draws: kb(), from_stock: true }], T + 3_600_000 + i * 60_000)).flat();
    const s5 = fold([set('KB', 5, T + 1_500), ...five], base);
    const rc = commit(s5, [set('KB', 0, T + 2_000)], T + 2_000);
    expect(rc.events.map((e) => e.event_type)).toEqual([...Array<string>(5).fill('StockReleased'), 'StockSet']);
    let r = s5;
    for (const e of rc.events) {
      const n = fold([e], r);
      if (e.event_type === 'StockReleased') expect(n.stations).toBe(r.stations);
      else expect(changed(r, n)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
      r = n;
    }
    // Replay = live (also split across appends: the folds read only state and event).
    const log = [cfg(), set('KB', 40, DAY), set('X', 40, DAY), set('Y', 40, DAY), ...sub, ...more, set('X', 2, T + 600), ...waits, ...add.events];
    expect(replay(log).lines).toEqual(add.state.lines);
  });

  it('[03a BF-8] stockEffects threads the drafts of one command: the second entry sees the first entry\'s adds and claims; a StockSet raising available runs the waiting-line reserve', () => {
    const p = T + 3_600_000;
    const s0 = fold([
      cfg(),
      set('KB', 0, DAY),
      set('X', 0, DAY),
      set('Y', 0, DAY),
      ...hidden('O1', [{ id: 'N1', draws: kb() }], p),
      ...hidden('O2', [{ id: 'N2', quantity: 2, draws: kb(2) }], p + 60_000),
      ...hidden('O3', [{ id: 'M', draws: [{ stock_item_id: 'X', quantity: 1 }, { stock_item_id: 'Y', quantity: 1 }] }], p + 120_000),
    ]);
    const at = T + 1_000;
    const two = commit(s0, [added('KB', 1, at), added('KB', 1, at)], at);
    // Without threading the second entry would reserve N1 again; with it, 1 is left and N2 needs 2.
    expect(two.events.map(brief)).toEqual([
      { type: 'StockAdded', id: 'KB', q: 1 },
      { type: 'StockReserved', id: 'KB', line: 'N1', q: 1 },
      { type: 'StockAdded', id: 'KB', q: 1 },
    ]);
    // A multi-draw line drawing on both entries' items is reserved by the second.
    const xy = commit(s0, [added('X', 1, at), added('Y', 1, at)], at);
    expect(xy.events.map(brief)).toEqual([
      { type: 'StockAdded', id: 'X', q: 1 },
      { type: 'StockAdded', id: 'Y', q: 1 },
      { type: 'StockReserved', id: 'X', line: 'M', q: 1 },
      { type: 'StockReserved', id: 'Y', line: 'M', q: 1 },
    ]);
    expect(xy.state.lines.M).toMatchObject({ from_stock: true, cook_ms: STOCK_COOK });
    // A StockSet that raises available: the reserve follows it.
    const up = commit(s0, [set('KB', 3, at)], at);
    expect(up.events.map(brief)).toEqual([
      { type: 'StockSet', id: 'KB' },
      { type: 'StockReserved', id: 'KB', line: 'N1', q: 1 },
      { type: 'StockReserved', id: 'KB', line: 'N2', q: 2 },
    ]);
    expect(stockOf(up.state, 'KB')).toMatchObject({ on_hand: 3, reserved: 3 });
  });

  it('[03a §3.7 Q-5] an array [StockTransferredOut, StockAdded] drafts the same reservations as folding the transfer first', () => {
    // Task 17 review m1: book() threads a transfer as its fold does (on_hand −= quantity, clamped at 0).
    const p = T + 3_600_000;
    const s0 = fold([cfg(), set('KB', 2, DAY), ...hidden('O1', [{ id: 'N1', draws: kb() }], p), ...hidden('O2', [{ id: 'N2', quantity: 2, draws: kb(2) }], p + 60_000)]);
    const at = T + 1_000;
    const out = stamp({ ...aStockSet({ stream_id: 'KB' }), event_type: 'StockTransferredOut', schema_version: 1, payload: { stock_item_id: 'KB', quantity: 2, zone_id: 'Z1' } }, at);
    const add = added('KB', 1, at);
    const both = commit(s0, [out, add], at);
    // Folding the transfer first, then the add alone: on_hand 0 + 1 → only N1 fits.
    const afterOut = fold([out], s0);
    const alone = [brief(add), ...stockEffects(afterOut, { ...draftOf(add), occurred_at: at }, CTX).map(brief)];
    expect(alone).toEqual([
      { type: 'StockAdded', id: 'KB', q: 1 },
      { type: 'StockReserved', id: 'KB', line: 'N1', q: 1 },
    ]);
    expect(both.events.map(brief)).toEqual([{ type: 'StockTransferredOut', id: 'KB', q: 2 }, ...alone]);
    expect(stockOf(both.state, 'KB')).toMatchObject({ on_hand: 1, reserved: 1 });
    expect(breaches(both.state)).toEqual([]);
    // Past on_hand the scratch clamps at 0 as the fold does: a transfer of 5 then an add of 1 still reserves N1 only.
    const over = stamp({ ...out, payload: { stock_item_id: 'KB', quantity: 5, zone_id: 'Z1' } }, at);
    expect(stockEffects(s0, [over, add].map((c) => ({ ...draftOf(c), occurred_at: at })), CTX).map(brief).slice(1)).toEqual(alone);
  });

  it('[03a §6.1f] stock_ctx is required for StockAdded, ItemMovedToStock and StockSet; other drafts need none', () => {
    const s0 = fold([cfg(), set('KB', 1, DAY)]);
    expect(() => stockEffects(s0, { ...draftOf(added('KB', 1, T)), occurred_at: T })).toThrow(/stock_ctx/);
    expect(() => stockEffects(s0, { ...draftOf(set('KB', 1, T)), occurred_at: T })).toThrow(/stock_ctx/);
    expect(stockEffects(s0, { ...draftOf(closed(T)), occurred_at: T })).toEqual([]);
  });
});

// AD-29 Q7 (developer: "consume at Done (or Served) if there was no Start"): a from-stock line that skips its Start
// (AD-10 allows Done from `added`) consumes with the cause, exactly as the Start would (§3.7 consume, P-5, AD-6).
describe('@pos/engine stockEffects: consume at Done or Served without a Start (AD-29 Q7)', () => {
  const done = (o: string, line: string, at: number): PosEvent => orderEv('ItemDone', o, { order_item_id: line, done_at: at, source: 'tap' }, at);
  const served = (o: string, lines: string[], at: number): PosEvent => orderEv('ItemServed', o, { order_item_ids: lines, source: 'tap' }, at);
  const undo = (o: string, line: string, at: number): PosEvent => orderEv('ItemDoneUndone', o, { order_item_id: line }, at);
  const effects = (s: EngineState, e: PosEvent, at: number) => stockEffects(s, { ...draftOf(e), occurred_at: at }).map(brief);
  const two: Draw[] = [{ stock_item_id: 'KB', quantity: 2 }, { stock_item_id: 'X', quantity: 3 }];
  const stocked = (): PosEvent[] => [cfg(), set('KB', 9, DAY), set('X', 9, DAY)];

  it('[03a AD-29 Q7] Done with no Start: one StockConsumed per reserved draw, right after the cause; later taps draft nothing', () => {
    const head = [...stocked(), ...frozen('O1', [{ id: 'D', draws: two, from_stock: true }]), fired(['D'], T + 1)];
    const s0 = fold(head);
    const at = T + 2;
    const cause = done('O1', 'D', at);
    const { events, state: s1 } = commit(s0, [cause], at);
    expect(events.map(brief)).toEqual([{ type: 'ItemDone', line: 'D' }, { type: 'StockConsumed', id: 'KB', line: 'D', q: 2 }, { type: 'StockConsumed', id: 'X', line: 'D', q: 3 }]);
    expect(stockOf(s1, 'KB')).toMatchObject({ on_hand: 7, reserved: 0 });
    expect(stockOf(s1, 'X')).toMatchObject({ on_hand: 6, reserved: 0 });
    expect(s1.lines.D).toMatchObject({ stage: 'done', reserved_seq: null, from_stock: true, started_at: null });
    expect(breaches(s1)).toEqual([]);
    // Duplicate Done, a late Start, the Served: nothing further.
    expect(effects(s1, done('O1', 'D', at + 1), at + 1)).toEqual([]);
    expect(effects(s1, started('O1', 'D', at + 1), at + 1)).toEqual([]);
    expect(effects(s1, served('O1', ['D'], at + 1), at + 1)).toEqual([]);
    // Replay = live.
    expect(JSON.stringify(replay([...head, ...events]))).toBe(JSON.stringify(s1));
  });

  it('[03a AD-29 Q7] a hidden, frozen or fired line alike: the single form gives the consume alone; the stations are not re-planned', () => {
    const p = T + 7_200_000;
    const s0 = fold([...stocked(), ...hidden('O1', [{ id: 'H', draws: kb(), from_stock: true }], p), ...frozen('O2', [{ id: 'Z', draws: kb(), from_stock: true }]), ...frozen('O3', [{ id: 'W', draws: kb(), from_stock: true }]), fired(['W'], T + 1)]);
    for (const [o, id] of [['O1', 'H'], ['O2', 'Z'], ['O3', 'W']] as const) {
      expect(effects(s0, done(o, id, T + 2), T + 2)).toEqual([{ type: 'StockConsumed', id: 'KB', line: id, q: 1 }]);
    }
    const { events } = commit(s0, [done('O1', 'H', T + 2)], T + 2);
    const afterDone = fold([events[0]!], s0);
    expect(fold([events[1]!], afterDone).stations).toBe(afterDone.stations);
  });

  it('[03a AD-29 Q7] Served with neither: every listed line that was not started, with the cause first; absent, repeated, started, ended lines and lines with no reservation draft nothing', () => {
    const lines: LineSpec[] = [{ id: 'A', draws: kb(), from_stock: true }, { id: 'B', draws: kb(2), from_stock: true }, { id: 'C', draws: kb(), from_stock: true }, { id: 'F' }, { id: 'V', draws: kb(), from_stock: true }];
    const s0 = fold([...stocked(), ...frozen('O1', lines), fired(['C'], T + 1), started('O1', 'C', T + 2), stamp(aStockConsumed({ stream_id: 'KB', payload: { stock_item_id: 'KB', order_item_id: 'C', quantity: 1 } }), T + 2), orderEv('ItemVoided', 'O1', { order_item_id: 'V', units: 1 }, T + 3)]);
    expect(s0.lines.V!.reserved_seq).not.toBeNull(); // this log skipped the void's release: a closed line never consumes
    const at = T + 4;
    const cause = served('O1', ['A', 'A', 'B', 'C', 'F', 'V', 'NOPE'], at);
    const { events, state: s1 } = commit(s0, [cause], at);
    expect(events.map(brief)).toEqual([{ type: 'ItemServed' }, { type: 'StockConsumed', id: 'KB', line: 'A', q: 1 }, { type: 'StockConsumed', id: 'KB', line: 'B', q: 2 }]);
    expect(s1.lines.A).toMatchObject({ stage: 'served', reserved_seq: null });
    expect(s1.lines.B).toMatchObject({ stage: 'served', reserved_seq: null });
    expect(effects(s1, served('O1', ['A', 'B'], at + 1), at + 1)).toEqual([]);
  });

  // Reading 2, proposed (implementer): "no Start" is started_at null at any open stage. None of these is a legal state
  // after AD-29 Q7 (a writer drafted no consume); the first two consume at the Served, the third had a Start and does not.
  it('[03a AD-29 Q7] Served: a done line still holding consumes; a Start-less cooking line consumes; a started line still holding does not', () => {
    const line = (id: string): LineSpec => ({ id, draws: kb(), from_stock: true });
    const s0 = fold([...stocked(), ...frozen('O1', [line('D'), line('C'), line('S')]), fired(['C', 'S'], T + 1), done('O1', 'D', T + 2), started('O1', 'S', T + 2)]);
    expect(s0.lines.D).toMatchObject({ stage: 'done', started_at: null });
    expect(s0.lines.D!.reserved_seq).not.toBeNull();
    expect(s0.lines.S).toMatchObject({ stage: 'cooking', started_at: T + 2 });
    expect(s0.lines.S!.reserved_seq).not.toBeNull();
    const startLess: EngineState = { ...s0, lines: { ...s0.lines, C: { ...s0.lines.C!, stage: 'cooking', started_at: null } } };
    expect(effects(startLess, served('O1', ['D', 'C', 'S'], T + 3), T + 3)).toEqual([
      { type: 'StockConsumed', id: 'KB', line: 'D', q: 1 },
      { type: 'StockConsumed', id: 'KB', line: 'C', q: 1 },
    ]);
    // A Done drafts from `added` only: neither that started line nor the Start-less cooking one.
    expect(effects(startLess, done('O1', 'C', T + 3), T + 3)).toEqual([]);
    expect(effects(startLess, done('O1', 'S', T + 3), T + 3)).toEqual([]);
  });

  it('[03a AD-29 Q7] a Start consumes; its Done and Served draft nothing. A line already released, or fresh, drafts nothing', () => {
    const p = T + 7_200_000;
    const s0 = fold([...stocked(), ...frozen('O1', [{ id: 'A', draws: kb(), from_stock: true }]), fired(['A'], T + 1), ...hidden('O2', [{ id: 'R', draws: kb(), from_stock: true }], p), ...frozen('O3', [{ id: 'F', draws: kb() }])]);
    const { state: s1 } = commit(s0, [started('O1', 'A', T + 2)], T + 2);
    expect(stockOf(s1, 'KB').reserved).toBe(1);
    expect(effects(s1, done('O1', 'A', T + 3), T + 3)).toEqual([]);
    expect(effects(s1, served('O1', ['A'], T + 3), T + 3)).toEqual([]);
    const released = fold([stamp(aStockReleased({ stream_id: 'KB', payload: { stock_item_id: 'KB', order_item_id: 'R', quantity: 1, reason: 'recount' } }), T + 4)], s1);
    expect(released.lines.R!.reserved_seq).toBeNull();
    expect(effects(released, done('O2', 'R', T + 5), T + 5)).toEqual([]);
    expect(effects(released, served('O2', ['R'], T + 5), T + 5)).toEqual([]);
    expect(effects(s1, done('O3', 'F', T + 5), T + 5)).toEqual([]);
    expect(effects(s1, served('O3', ['F'], T + 5), T + 5)).toEqual([]);
  });

  it('[03a AD-29 Q7] the partial void left the rest reserved: Done consumes what is still reserved', () => {
    const s0 = fold([...stocked(), ...frozen('O1', [{ id: 'P', quantity: 3, draws: kb(3), from_stock: true }])]);
    const { state: s1 } = commit(s0, [orderEv('ItemVoided', 'O1', { order_item_id: 'P', units: 1 }, T + 1)], T + 1);
    expect(s1.lines.P!.draws[0]).toMatchObject({ reserved: 2 });
    expect(effects(s1, done('O1', 'P', T + 2), T + 2)).toEqual([{ type: 'StockConsumed', id: 'KB', line: 'P', q: 2 }]);
  });

  // Proposed (implementer): §3.7 has no event that puts a consumed plate back (a release needs a live reservation; only a
  // move to stock adds, and Undo is neither), and a Start's consume survives an Undo. So Undo reverses the stage only.
  it('[03a AD-29 Q7] Done then Undo: the consume stands; the second Done and a Start draft nothing; nothing folds twice', () => {
    const s0 = fold([...stocked(), ...frozen('O1', [{ id: 'U', draws: kb(2), from_stock: true }]), fired(['U'], T + 1)]);
    const { state: s1 } = commit(s0, [done('O1', 'U', T + 2)], T + 2);
    const { events, state: s2 } = commit(s1, [undo('O1', 'U', T + 3)], T + 3);
    expect(events.map(brief)).toEqual([{ type: 'ItemDoneUndone', line: 'U' }]);
    expect(s2.lines.U).toMatchObject({ stage: 'cooking', reserved_seq: null, from_stock: true, started_at: T + 2, done_at: null });
    expect(stockOf(s2, 'KB')).toMatchObject({ on_hand: 7, reserved: 0 });
    expect(effects(s2, started('O1', 'U', T + 4), T + 4)).toEqual([]);
    expect(effects(s2, done('O1', 'U', T + 4), T + 4)).toEqual([]);
    expect(effects(s2, served('O1', ['U'], T + 4), T + 4)).toEqual([]);
    const { state: s3 } = commit(s2, [done('O1', 'U', T + 5)], T + 5);
    expect(stockOf(s3, 'KB')).toMatchObject({ on_hand: 7, reserved: 0 });
    expect(breaches(s3)).toEqual([]);
  });

  it('[03a AD-29 Q7, AD-6] a consume past on_hand: strict throws; non-strict clamps at 0 with one breach, as a Start does', () => {
    const head = [...stocked(), ...frozen('O1', [{ id: 'D', draws: kb(2), from_stock: true }]), fired(['D'], T + 1), set('KB', 1, T + 2)];
    const s0 = fold(head, initialEngineState(), { strict: false });
    expect(stockOf(s0, 'KB')).toMatchObject({ on_hand: 1, reserved: 2 });
    expect(breaches(s0)).toEqual([]);
    const cause = done('O1', 'D', T + 3);
    expect(() => commit(s0, [cause], T + 3)).toThrow();
    const { state: s1 } = commit(s0, [cause], T + 3, { strict: false });
    expect(stockOf(s1, 'KB')).toMatchObject({ on_hand: 0, reserved: 0 });
    expect(s1.lines.D!.reserved_seq).toBeNull();
    expect(breaches(s1)).toHaveLength(1);
    // The same result as the Start.
    const { state: viaStart } = commit(s0, [started('O1', 'D', T + 3)], T + 3, { strict: false });
    expect(stockOf(viaStart, 'KB')).toEqual(stockOf(s1, 'KB'));
  });

  it('[03a AD-29 Q7] the array form: the effect follows its cause and a later cause of the command sees it; replay = live', () => {
    const head = [...stocked(), ...frozen('O1', [{ id: 'D', draws: kb(), from_stock: true }]), fired(['D'], T + 1)];
    const s0 = fold(head);
    const at = T + 2;
    const { events, state: s1 } = commit(s0, [done('O1', 'D', at), served('O1', ['D'], at)], at);
    expect(events.map(brief)).toEqual([{ type: 'ItemDone', line: 'D' }, { type: 'StockConsumed', id: 'KB', line: 'D', q: 1 }, { type: 'ItemServed' }]);
    expect(JSON.stringify(replay([...head, ...events]))).toBe(JSON.stringify(s1));
  });

  it('[03a AD-29 Q7] a move to stock after a Done without a Start adds the portion back once, net of the consume', () => {
    const s0 = fold([...stocked(), ...frozen('O1', [{ id: 'D', draws: kb(), from_stock: true }]), fired(['D'], T + 1)]);
    const { state: s1 } = commit(s0, [done('O1', 'D', T + 2)], T + 2);
    expect(stockOf(s1, 'KB')).toMatchObject({ on_hand: 8, reserved: 0 });
    const { events, state: s2 } = commit(s1, [orderEv('ItemMovedToStock', 'O1', { order_item_id: 'D', units: 1 }, T + 3)], T + 3);
    expect(events.map(brief)).toEqual([{ type: 'ItemMovedToStock', line: 'D' }, { type: 'StockAdded', id: 'KB', q: 1, reason: 'moved' }]);
    expect(stockOf(s2, 'KB')).toMatchObject({ on_hand: 9, reserved: 0 });
  });
});

// ⚠️ Changed by 04 (row T-2; G-17), 03a v1.2.4 §3.7 / §6.1f, test 141: the array overload pre-scans every line named by
// an ItemVoided / ItemRemoved anywhere in the array (earlier or later than the move, whole or partial; an ItemRemoved
// without units counts) and excludes them, with the moved line, from the waiting-line reserve. Strict folds throughout
// (04 #10f–#10h): a stock_reserved_past_added or a breach throws.
describe('@pos/engine stockEffects: a line the array ends never takes a moved portion (04 T-2, G-17; 03a #141)', () => {
  const P = T + 3_600_000;
  const AT = T + 1_000;
  type Head = { k1?: number; o1?: LineSpec[]; w4?: boolean; done?: boolean };
  // O1: K1 (quantity k1, draw KB × k1) fired and started (reserved 0, nothing consumed: KB counted 0), maybe Done, plus
  // the hidden waiting lines `o1`; O2 (another order, same pickup): the hidden waiting T4 line W4 (KB × 1), unless w4 false.
  // Every hidden line has the same deadline, so the candidate order is by order_item_id and W4 sorts last.
  const head = (o: Head): PosEvent[] => {
    const q = o.k1 ?? 2;
    return [
      cfg(),
      set('KB', 0, DAY),
      ...hidden('O1', [{ id: 'K1', quantity: q, draws: kb(q) }, ...(o.o1 ?? [])], P),
      fired(['K1'], T + 1),
      started('O1', 'K1', T + 2),
      ...(o.done === true ? [orderEv('ItemDone', 'O1', { order_item_id: 'K1', done_at: T + 3, source: 'tap' }, T + 3)] : []),
      ...(o.w4 === false ? [] : hidden('O2', [{ id: 'W4', draws: kb() }], P)),
    ];
  };
  const ev = (event_type: string, line: string, payload: Record<string, unknown>): PosEvent =>
    orderEv(event_type, line.startsWith('W') ? 'O2' : 'O1', { order_item_id: line, ...payload }, AT);
  const mv = (line: string, units: number) => ev('ItemMovedToStock', line, { units });
  const vd = (line: string, units: number) => ev('ItemVoided', line, { units });
  const rm = (line: string, units?: number) => ev('ItemRemoved', line, units === undefined ? {} : { units });
  const reservedOf = (ds: ReadonlyArray<{ event_type: string; payload: Record<string, unknown> }>): string[] =>
    ds.filter((d) => d.event_type === 'StockReserved').map((d) => d.payload.order_item_id as string);
  // The writer's commit in strict mode; no breach, replay = live; returns the lines the batch reserved.
  const run = (o: Head, causes: PosEvent[]): string[] => {
    const h = head(o);
    const s0 = fold(h);
    const { events, state } = commit(s0, causes, AT);
    expect(breaches(state)).toEqual([]);
    expect(replay([...h, ...events])).toEqual(state);
    return reservedOf(events);
  };

  it('[03a #141] [ItemMovedToStock L (2 of 4), ItemVoided L (2)] with a hidden waiting line of another order → it takes the portion, L does not', () => {
    expect(run({ k1: 4 }, [mv('K1', 2), vd('K1', 2)])).toEqual(['W4']);
  });

  it('[04 #10c] deal part P2 of the same order, unstarted, on the same stock item and voided later in the array → the portion goes to T4, never to P2', () => {
    expect(run({ o1: [{ id: 'P2', draws: kb() }] }, [mv('K1', 1), vd('K1', 1), vd('P2', 1)])).toEqual(['W4']);
  });

  it('[04 #10d] Void all on two karahi lines of one order (K1 moved), K2 named earlier or later in the array → T4 reserved', () => {
    const o1 = [{ id: 'K2', draws: kb() }];
    expect(run({ o1 }, [mv('K1', 1), vd('K1', 1), vd('K2', 1)])).toEqual(['W4']);
    expect(run({ o1 }, [vd('K2', 1), mv('K1', 1), vd('K1', 1)])).toEqual(['W4']);
  });

  it('[04 #10e] same order, second-round karahi K2 waiting and not voided, K1 voided moved → K2 reserved (a live line of the same order may take it)', () => {
    expect(run({ o1: [{ id: 'K2', draws: kb() }] }, [mv('K1', 1), vd('K1', 1)])).toEqual(['K2']);
  });

  it('[04 #10f] strict: [deal part P1 at added voided, karahi K1 done moved] in that order, with and without T4 → never StockReserved{P1}; T4 reserved when present', () => {
    const o1 = [{ id: 'P1', draws: kb() }];
    expect(run({ o1, done: true }, [vd('P1', 1), mv('K1', 1), vd('K1', 1)])).toEqual(['W4']);
    expect(run({ o1, done: true, w4: false }, [vd('P1', 1), mv('K1', 1), vd('K1', 1)])).toEqual([]);
  });

  it('[04 #10g] strict, pure array: one at-added line named by two partial causes (one before the move, one after) plus a moved line → that line never reserved', () => {
    const o1 = [{ id: 'A', quantity: 2, draws: kb(2) }];
    expect(run({ o1 }, [vd('A', 1), mv('K1', 2), vd('K1', 2), rm('A', 1)])).toEqual(['W4']);
    expect(run({ o1, w4: false }, [rm('A', 1), mv('K1', 2), vd('K1', 2), vd('A', 1)])).toEqual([]);
  });

  it('[04 #10h] strict: [deal ×2 part P (units 2) at added waiting voided 1, K1 ×2 done moved] and the reverse, T4 present → never StockReserved{P}, T4 reserved, no stock_breach', () => {
    const o1 = [{ id: 'P', quantity: 2, draws: kb(2) }];
    expect(run({ o1, done: true }, [vd('P', 1), mv('K1', 2), vd('K1', 2)])).toEqual(['W4']);
    expect(run({ o1, done: true }, [mv('K1', 2), vd('K1', 2), vd('P', 1)])).toEqual(['W4']);
  });

  it('[03a #141] a third line K named by an ItemRemoved without units (whole), earlier or later in the array → K never takes the portion', () => {
    const o1 = [{ id: 'K', draws: kb() }];
    expect(run({ o1 }, [rm('K'), mv('K1', 1), vd('K1', 1)])).toEqual(['W4']);
    expect(run({ o1 }, [mv('K1', 1), vd('K1', 1), rm('K')])).toEqual(['W4']);
  });

  it('[03a #141] the single-draft overload excludes only the moved line', () => {
    const s0 = fold(head({ o1: [{ id: 'P2', draws: kb() }] }));
    const one = stockEffects(s0, { ...draftOf(mv('K1', 1)), occurred_at: AT }, CTX);
    expect(reservedOf(one)).toEqual(['P2']);
  });

  it('[03a #141] an array with no ItemVoided / ItemRemoved (a StockAdded alone) reserves as before: the same drafts as the single overload', () => {
    const s0 = fold(head({ o1: [{ id: 'P2', draws: kb() }] }));
    const add = { ...draftOf(added('KB', 1, AT)), occurred_at: AT };
    const one = stockEffects(s0, add, CTX);
    expect(reservedOf(one)).toEqual(['P2']);
    expect(stockEffects(s0, [add], CTX)).toEqual([add, ...one]);
  });
});
