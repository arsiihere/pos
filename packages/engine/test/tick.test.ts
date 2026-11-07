// 03a §3.6.1 items 1–4a (the intents of one `fires` pass), the nextDueAt terms (BF-5), §3.6.3 firesDue, D16
// auto-fill, D60 inferred completion, D42 overrun cascade, D44 (never fired twice), §3.7 abandon release; tests
// 32, 52, 62 engine, 96 tick, 110, 111 tick, 119 single_tap; Review Focus 3. Pure: every input is deep-frozen.
import { parseEvent, type EngineConfig, type ItemAddedPayload, type PosEvent } from '@pos/events';
import { aFireDispatched, anEngineConfigApplied, anItemAdded, anItemDone, anItemStarted, anOrderBatch, anOrderLinesAdded, aStockSet } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  buildEngineState,
  firesDue,
  getTickIntents,
  initialEngineState,
  liveInterval,
  nextDueAt,
  planOrder,
  stockOf,
  type EngineLine,
  type EngineOrder,
  type EngineState,
  type PlanResult,
  type ProposedOrder,
  type TickDraft,
} from '../src/index';
import { addInterval } from '../src/profile';
import { fryer, loadOf, submitB, voidB } from './batch-kit';

const T0 = 1_761_000_000_000; // "12:00"
const S = 1_000;
const M = 60_000;
const at = (min: number): number => T0 + min * M;

function deepFreeze<V>(value: V): V {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const BASE = parseEvent(anEngineConfigApplied()).payload as unknown as EngineConfig;
type StationCfg = EngineConfig['stations'][number];
type Settings = EngineConfig['settings'];

let seq = 10;
const nextSeq = (n = 0): number => {
  const s = seq;
  seq += n + 1;
  return s;
};
const stamp = (e: PosEvent, t: number): PosEvent => {
  const s = nextSeq();
  return { ...e, recorded_at: t, occurred_at: t, seq: s, event_id: `01T${String(s).padStart(23, '0')}` };
};

function configEvent(stations: Array<Partial<StationCfg> & { station_id: string }>, settings: Partial<Settings> = {}): PosEvent {
  const list = [...stations].sort((a, b) => (a.station_id < b.station_id ? -1 : 1)).map((s) => ({ ...BASE.stations[0]!, name: s.station_id, ...s }));
  return stamp(anEngineConfigApplied({ payload: { stations: list, settings: { ...BASE.settings, ...settings } } }), T0 - 3_600_000);
}

function kitchen(stations: Array<Partial<StationCfg> & { station_id: string }>, settings: Partial<Settings> = {}): EngineState {
  return deepFreeze(applyEvent(initialEngineState(), deepFreeze(configEvent(stations, settings))));
}

function fold(state: EngineState, events: PosEvent[], opts?: { strict?: boolean }): EngineState {
  let s = deepFreeze(state);
  for (const e of events) s = deepFreeze(applyEvent(s, deepFreeze(e), opts));
  return s;
}

type Draw = { stock_item_id: string; quantity: number };
type Item = {
  id: string;
  station?: string;
  program?: string; // a batch line: its program, cook copied as program_cook_time_ms (§3.2)
  cook: number;
  prep?: number;
  mode?: 'sync' | 'immediate';
  units?: number;
  early?: number;
  draws?: Draw[];
  stock_cook?: number;
  from_stock?: boolean;
};
type OrderOpts = { pickup?: number; actor?: string | null; order_type?: 'dine_in' | 'takeaway' | 'delivery' | 'parking' };

function itemFields(i: Item): Record<string, unknown> {
  return {
    ...(i.program === undefined ? {} : { program_id: i.program, program_cook_time_ms: i.cook }),
    station_id: i.station ?? 'S1',
    cook_time_ms: i.cook,
    prep_buffer_ms: i.prep ?? 0,
    serve_mode: i.mode ?? 'immediate',
    quantity: i.units ?? 1,
    stock_time_ms: i.stock_cook ?? null,
    stock_draws: i.draws ?? [],
    out_of_stock_behaviour: 'cook_fresh',
  };
}

function proposed(order_id: string, items: Item[], o: OrderOpts = {}): ProposedOrder {
  const base = anItemAdded().payload as unknown as ItemAddedPayload;
  const order_type = o.order_type ?? (o.pickup === undefined ? 'dine_in' : 'delivery');
  return deepFreeze({
    order_id,
    order: { order_type, table_id: 'T12', table_key: 'dine_in:T12', follow_up: false, pickup_at_ms: o.pickup ?? null },
    lines: items.map((i) => ({
      ...base,
      ...(itemFields(i) as Partial<ItemAddedPayload>),
      order_id,
      order_item_id: i.id,
      alternates: [],
      point_id: null,
      carry_ms: 0,
      weight_pct: 100,
      max_early_ms: i.early ?? 60_000,
      max_late_ms: null,
      max_carry_ms: null,
      cook_ms_override: null,
      return_of: null,
    })),
  });
}

// planOrder at now, then the §4.2 batch 02 appends at recorded_at = now (StockReserved per draw of a from-stock line).
function submit(state: EngineState, order_id: string, items: Item[], now: number, o: OrderOpts = {}): { plan: PlanResult; state: EngineState } {
  const from_stock = Object.fromEntries(items.filter((i) => i.from_stock === true).map((i) => [i.id, true]));
  const plan = planOrder(state, proposed(order_id, items, o), now, from_stock);
  const reserved = items.filter((i) => i.from_stock === true).flatMap((i) => (i.draws ?? []).map((d) => ({ ...d, order_item_id: i.id })));
  const events = anOrderBatch({
    order_id,
    recorded_at: now,
    seq: nextSeq(items.length + reserved.length + 1),
    actor_id: o.actor ?? null,
    lines: items.map((i) => ({
      order_item_id: i.id,
      item: itemFields(i),
      line: { station_id: plan.lines.find((l) => l.order_item_id === i.id)!.station_id, max_early_ms: i.early ?? 60_000, from_stock: i.from_stock === true },
    })),
    order: { groups: plan.groups, order_type: o.order_type ?? (o.pickup === undefined ? 'dine_in' : 'delivery'), pickup_at_ms: o.pickup ?? null },
    reserved,
  }).map((e, k) => ({ ...e, event_id: `01S${String(seq + k).padStart(23, '0')}` }));
  return { plan, state: fold(state, events) };
}

// The host's part (task 22): the drafts become events stamped at the pass's now, folded in order.
function asEvents(drafts: readonly TickDraft[], now: number): PosEvent[] {
  return drafts.map((d) => {
    const s = nextSeq();
    return {
      ...d,
      payload: d.payload as unknown as Record<string, unknown>,
      event_id: `01K${String(s).padStart(23, '0')}`,
      tenant_id: 't',
      branch_id: 'b',
      occurred_at: now,
      recorded_at: now,
      actor_id: null,
      device_id: 'hub',
      seq: s,
    };
  });
}
function pass(state: EngineState, now: number, opts?: { strict?: boolean }): { drafts: TickDraft[]; state: EngineState } {
  const drafts = getTickIntents(state, now);
  return { drafts, state: fold(state, asEvents(drafts, now), opts) };
}

const start = (order_id: string, id: string, t: number, started_at = t): PosEvent =>
  stamp(anItemStarted({ stream_id: order_id, payload: { order_item_id: id, started_at, source: 'tap' } }), t);
const done = (order_id: string, id: string, t: number): PosEvent => stamp(anItemDone({ stream_id: order_id, payload: { order_item_id: id, done_at: t, source: 'tap' } }), t);
const fireEv = (station_id: string, ids: string[], t: number, due_at = t, reason = 'scheduled'): PosEvent =>
  stamp(aFireDispatched({ stream_id: station_id, payload: { station_id, order_item_ids: ids, load_id: null, due_at, reason } }), t);
const stockSet = (id: string, on_hand: number, t: number): PosEvent => stamp(aStockSet({ stream_id: id, payload: { stock_item_id: id, on_hand, unit: 'piece' } }), t);

// An OrderLinesAdded listing `id` whose ItemAdded has not been folded yet (awaiting > 0).
function pendingAddition(state: EngineState, order_id: string, id: string, t: number): PosEvent {
  const p = anOrderLinesAdded().payload as { groups: Array<Record<string, unknown>>; lines: Array<Record<string, unknown>> };
  return stamp(
    anOrderLinesAdded({
      stream_id: order_id,
      payload: {
        order_id,
        order_item_ids: [id],
        groups: p.groups.map((g) => ({ ...g, group_id: `${order_id}:${state.orders[order_id]!.next_group_index}`, order_item_ids: [id] })),
        lines: p.lines.map((l) => ({ ...l, order_item_id: id })),
      },
    }),
    t,
  );
}

const types = (drafts: readonly TickDraft[]): string[] => drafts.map((d) => d.event_type);
const fires = (drafts: readonly TickDraft[]) => drafts.filter((d) => d.event_type === 'FireDispatched').map((d) => d.payload as { station_id: string; order_item_ids: string[]; load_id: string | null; due_at: number; reason: string });

// ---- a synthetic placed state (D16 ordering fixtures need exact deadlines, slacks and waits) ----------------------

function withOrder(s: EngineState, o: { order_id: string; placed_at: number; order_type?: EngineOrder['order_type'] }): EngineState {
  const order: EngineOrder = {
    order_id: o.order_id,
    order_type: o.order_type ?? 'dine_in',
    table_key: `dine_in:${o.order_id}`,
    table_id: null,
    follow_up: false,
    pickup_at_ms: null,
    placed_at: o.placed_at,
    placed_by: null,
    target_land_ms: o.placed_at + 3_600_000,
    promise_ms: o.placed_at + 3_780_000,
    boosted: false,
    line_ids: [],
    awaiting: 0,
    last_served_at: null,
    last_line_fold_at: o.placed_at,
    next_group_index: 1,
    groups: { [`${o.order_id}:0`]: { target_land_ms: o.placed_at + 3_600_000, line_ids: [] } },
  };
  return { ...s, orders: { ...s.orders, [o.order_id]: order } };
}

type Placed = { id: string; order: string; station?: string; fire: number; deadline: number; cook: number; prep?: number; units?: number; early?: number; weight?: number };
// An unfired placed slot line: booked [fire + prep, fire + prep + cook) in its station's profile, in `unfired`.
function withLine(s: EngineState, p: Placed): EngineState {
  const station_id = p.station ?? 'S1';
  const units = p.units ?? 1;
  const booked = { start: p.fire + (p.prep ?? 0), end: p.fire + (p.prep ?? 0) + p.cook, units };
  const line: EngineLine = {
    order_item_id: p.id,
    order_id: p.order,
    group_id: `${p.order}:0`,
    serve_mode: 'sync',
    station_id,
    alternates: [],
    point_id: null,
    carry_ms: 0,
    units,
    prep_ms: p.prep ?? 0,
    cook_ms: p.cook,
    full_cook_ms: p.cook,
    from_stock: false,
    program_id: null,
    stock_cook_ms: null,
    stock_program_id: null,
    draws: [],
    reserved_seq: null,
    weight_pct: p.weight ?? 100,
    max_early_ms: p.early ?? 60_000,
    max_late_ms: null,
    max_carry_ms: null,
    stage: 'added',
    fire_ms: p.fire,
    deadline_ms: p.deadline,
    fired_at: null,
    started_at: null,
    done_at: null,
    mark: null,
    return_of: null,
    load_id: null,
    booked,
    capped: false,
    routed_station_id: station_id,
    expedited: false,
    rounds: null,
  };
  const st = s.stations[station_id]!;
  const order = s.orders[p.order]!;
  const lines = { ...s.lines, [p.id]: line };
  const unfired = [...st.unfired, p.id].sort((a, b) => lines[a]!.fire_ms! - lines[b]!.fire_ms! || (a < b ? -1 : 1));
  return {
    ...s,
    lines,
    orders: { ...s.orders, [p.order]: { ...order, line_ids: [...order.line_ids, p.id] } },
    stations: { ...s.stations, [station_id]: { ...st, profile: addInterval(st.profile, booked, units), unfired } },
  };
}

// ==================================================================================================================

describe('@pos/engine getTickIntents — scheduled fires (§3.6.1 item 1, D44)', () => {
  it('[03a #110] placed_by = actor_id, placed_at = recorded_at; a Start after recorded_at folds at recorded_at; due_at = the planned fire', () => {
    const k = kitchen([{ station_id: 'S1', capacity: 1 }]);
    const first = submit(k, 'O1', [{ id: 'L1', cook: 5 * M }], at(0), { actor: 'staff-7' });
    expect(first.state.orders.O1).toMatchObject({ placed_by: 'staff-7', placed_at: at(0) });
    const { state: s } = submit(first.state, 'O2', [{ id: 'L2', cook: 5 * M }], at(0));
    expect(s.lines.L2!.fire_ms).toBe(at(5));
    // A missed fire (the hub was down): due_at is the planned fire, before the pass's now.
    const late = pass(s, at(9));
    const f = fires(late.drafts);
    expect(f.map((x) => [x.order_item_ids, x.due_at, x.reason])).toEqual([
      [['L1'], at(0), 'scheduled'],
      [['L2'], at(5), 'scheduled'],
    ]);
    expect(late.state.lines.L2).toMatchObject({ fired_at: at(9), fire_ms: at(5) }); // AD-9: min(fire_ms, recorded_at)
    // An ItemStarted whose started_at is after its recorded_at is folded at recorded_at.
    const st = fold(late.state, [start('O1', 'L1', at(10), at(15))]);
    expect(st.lines.L1).toMatchObject({ stage: 'cooking', started_at: at(10) });
  });

  it('[03a §3.6.1] one FireDispatched per station and planned fire; lines of an order still awaiting lines are not fired', () => {
    const k = kitchen([{ station_id: 'S1', capacity: 2 }, { station_id: 'S2', capacity: 1 }]);
    let s = submit(k, 'O1', [{ id: 'A', cook: 5 * M }, { id: 'B', cook: 5 * M }, { id: 'C', station: 'S2', cook: 5 * M }], at(0)).state;
    const f = fires(getTickIntents(s, at(0)));
    expect(f).toEqual([
      { station_id: 'S1', order_item_ids: ['A', 'B'], load_id: null, due_at: at(0), reason: 'scheduled' },
      { station_id: 'S2', order_item_ids: ['C'], load_id: null, due_at: at(0), reason: 'scheduled' },
    ]);
    // An addition listed but not yet seen (awaiting > 0): its order's lines wait (AD-8: the fold would refuse them).
    s = fold(s, [pendingAddition(s, 'O1', 'L9', at(0))]);
    expect(s.orders.O1!.awaiting).toBe(1);
    expect(getTickIntents(s, at(0))).toEqual([]);
    expect(nextDueAt(s, at(0))).toBeNull();
  });
});

describe('@pos/engine getTickIntents — batch loads (§3.6.1 item 1, D14, D17, D34)', () => {
  it('[03a §3.6.1] a load fires whole: one FireDispatched with its load_id listing every member, due_at = the load fire', () => {
    const k = fryer({ capacity: 4, freshness: 5_000, freeze_ms: 3_600_000 });
    const a = submitB(k, 'O1', [{ id: 'A', cook: 3 * M }], T0);
    const b = submitB(a.state, 'O2', [{ id: 'B', cook: 3 * M }], T0);
    const load = loadOf(b.state, 'A')!;
    expect(load.order_item_ids).toEqual(['A', 'B']);
    expect(fires(getTickIntents(b.state, load.fire_ms - 1))).toEqual([]);
    expect(nextDueAt(b.state, load.fire_ms - 1)).toBe(load.fire_ms);
    const p = pass(b.state, load.fire_ms);
    expect(fires(p.drafts)).toEqual([{ station_id: 'F', order_item_ids: ['A', 'B'], load_id: load.load_id, due_at: load.fire_ms, reason: 'scheduled' }]);
    expect(p.state.stations.F!.loads).toEqual({});
    expect(p.state.lines.A).toMatchObject({ fired_at: load.fire_ms, load_id: load.load_id });
    expect(p.state.lines.B).toMatchObject({ fired_at: load.fire_ms, load_id: load.load_id });
    expect(getTickIntents(p.state, load.fire_ms + 500)).toEqual([]);
  });

  it('[03a §3.6.1] a firing load pulls in a compatible unfired line whose target is within the freshness window, capped by max_early_ms', () => {
    const k = fryer({ capacity: 2, freshness: 600_000, freeze_ms: 3_600_000 });
    const one = submitB(k, 'O1', [{ id: 'A', cook: 3 * M, early: 600_000 }, { id: 'B', cook: 3 * M, early: 600_000 }], T0);
    const two = submitB(one.state, 'O3', [{ id: 'C', cook: 3 * M, early: 600_000 }], T0);
    const X = loadOf(two.state, 'A')!;
    const Y = loadOf(two.state, 'C')!;
    expect(X.load_id).not.toBe(Y.load_id);
    expect(Y.booked.end - X.booked.end).toBe(3 * M);
    // B is voided: X has room again; X and Y are frozen, so the void's re-plan leaves them.
    const s = fold(two.state, [voidB('O1', 'B', 1, T0)]);
    expect(loadOf(s, 'A')!.order_item_ids).toEqual(['A']);
    const p = pass(s, X.fire_ms);
    expect(fires(p.drafts)).toEqual([{ station_id: 'F', order_item_ids: ['A', 'C'], load_id: X.load_id, due_at: X.fire_ms, reason: 'scheduled' }]);
    expect(p.state.lines.C).toMatchObject({ fired_at: X.fire_ms, load_id: X.load_id });
    expect(p.state.stations.F!.loads).toEqual({});
    // Capped per line by max_early_ms: with C's max_early_ms below the 3 min it would land early, C is not pulled.
    const k2 = fryer({ capacity: 2, freshness: 600_000, freeze_ms: 3_600_000 });
    const one2 = submitB(k2, 'O1', [{ id: 'A', cook: 3 * M, early: 600_000 }, { id: 'B', cook: 3 * M, early: 600_000 }], T0);
    const two2 = submitB(one2.state, 'O3', [{ id: 'C', cook: 3 * M, early: 2 * M }], T0);
    const s2 = fold(two2.state, [voidB('O1', 'B', 1, T0)]);
    expect(fires(getTickIntents(s2, loadOf(s2, 'A')!.fire_ms))[0]!.order_item_ids).toEqual(['A']);
  });

  it('[03a §3.6.1] never a partial load fire: a load with a member of an order still awaiting lines waits whole', () => {
    const k = fryer({ capacity: 4, freshness: 5_000, freeze_ms: 3_600_000 });
    const a = submitB(k, 'O1', [{ id: 'A', cook: 3 * M }], T0);
    const b = submitB(a.state, 'O2', [{ id: 'B', cook: 3 * M }], T0);
    const load = loadOf(b.state, 'A')!;
    const s = fold(b.state, [pendingAddition(b.state, 'O2', 'Z9', T0)]);
    expect(fires(getTickIntents(s, load.fire_ms))).toEqual([]);
    expect(nextDueAt(s, load.fire_ms)).toBeNull();
  });

  it('[03a BF-5] a load is due at max(load fire, its earliest member fire), the minimum over loads (task 14 review)', () => {
    // Shape-only states: a load's fire and its members' fire_ms set apart, as the scheduled-fire rule reads both.
    const k = fryer({ capacity: 4, freshness: 5_000, freeze_ms: 3_600_000 });
    const a = submitB(k, 'O1', [{ id: 'A', cook: 3 * M }], T0);
    const b = submitB(a.state, 'O2', [{ id: 'B', cook: 3 * M, program: 'P2' }], T0);
    const X = loadOf(b.state, 'A')!;
    const Y = loadOf(b.state, 'B')!;
    expect(X.load_id).not.toBe(Y.load_id);
    const f = Math.min(X.fire_ms, Y.fire_ms);
    const shape = (xLoad: number, xLine: number, yLoad: number, yLine: number): EngineState => {
      const F = b.state.stations.F!;
      return deepFreeze({
        ...b.state,
        lines: { ...b.state.lines, A: { ...b.state.lines.A!, fire_ms: xLine }, B: { ...b.state.lines.B!, fire_ms: yLine } },
        stations: { ...b.state.stations, F: { ...F, unfired: xLine <= yLine ? ['A', 'B'] : ['B', 'A'], loads: { [X.load_id]: { ...X, fire_ms: xLoad }, [Y.load_id]: { ...Y, fire_ms: yLoad } } } },
      });
    };
    // Members after the load fire: due at the member fire, not at the load fire (no intent there).
    const late = shape(f, f + 5 * S, f + 60 * S, f + 60 * S);
    expect(nextDueAt(late, f - 1)).toBe(f + 5 * S);
    expect(getTickIntents(late, f)).toEqual([]);
    expect(fires(getTickIntents(late, f + 5 * S)).map((x) => x.load_id)).toEqual([X.load_id]);
    // A later-listed member with an earlier fire but a later load fire never raises the bound.
    const mixed = shape(f + 5 * S, f, f + 30 * S, f + 1 * S);
    expect(nextDueAt(mixed, f - 1)).toBe(f + 5 * S);
    expect(fires(getTickIntents(mixed, f + 5 * S)).map((x) => x.load_id)).toEqual([X.load_id]);
  });
});

describe('@pos/engine getTickIntents — auto-fill (§3.6.1 item 2, D16)', () => {
  const k = (o: Partial<StationCfg> = {}) => deepFreeze(kitchen([{ station_id: 'S1', capacity: 1, ...o }], {}));
  const now = at(0);

  it('[03a #32] auto-fill fires from Next within max_early_ms: urgent (slack ≤ keep) first', () => {
    let s = withOrder(withOrder(k(), { order_id: 'OU', placed_at: now }), { order_id: 'ON', placed_at: now - 30 * M });
    // Both frozen (fire ≤ now + 120 s), 30 s cooks on one unit. U: slack 10 s ≤ keep 60 s (urgent), waiting 0.
    // N: earlier fire, slack 90 s, waiting 30 min.
    s = withLine(s, { id: 'U', order: 'OU', fire: now + 100 * S, deadline: now + 110 * S, cook: 30 * S, early: 3 * M });
    s = withLine(s, { id: 'N', order: 'ON', fire: now + 60 * S, deadline: now + 150 * S, cook: 30 * S, early: 10 * M });
    s = deepFreeze(s);
    const f = fires(getTickIntents(s, now));
    expect(f).toEqual([{ station_id: 'S1', order_item_ids: ['U'], load_id: null, due_at: now + 100 * S, reason: 'early_fill' }]);
    const p = pass(s, now);
    expect(p.state.lines.U).toMatchObject({ fired_at: now, fire_ms: now });
    expect(liveInterval(p.state, 'U', now)).toEqual({ start: now, end: now + 30 * S });
  });

  it('[03a #32] then the larger w × waiting (the order-type weight counts)', () => {
    let s = withOrder(withOrder(k(), { order_id: 'OD', placed_at: now - 6 * M }), { order_id: 'OT', placed_at: now - 4 * M, order_type: 'takeaway' });
    // Both frozen and not urgent (slack 90 s). Dine-in 100 × 6 min = 600 < takeaway 200 × 4 min = 800.
    s = withLine(s, { id: 'D', order: 'OD', fire: now + 30 * S, deadline: now + 120 * S, cook: 30 * S, early: 3 * M });
    s = withLine(s, { id: 'TK', order: 'OT', fire: now + 70 * S, deadline: now + 160 * S, cook: 30 * S, early: 10 * M });
    expect(fires(getTickIntents(deepFreeze(s), now)).map((f) => f.order_item_ids)).toEqual([['TK']]);
  });

  it('[03a #32] only within max_early_ms; frozen before hidden; FIFO never auto-fills; EDF by deadline', () => {
    let s = withOrder(withOrder(k(), { order_id: 'O1', placed_at: now }), { order_id: 'O2', placed_at: now - 60 * M });
    // F: frozen, eligible at d − max_early = now + 30 s. H: hidden (fire > now + freeze 120 s), waiting 1 h.
    s = withLine(s, { id: 'F', order: 'O1', fire: now + 40 * S, deadline: now + 90 * S, cook: 30 * S, early: 60 * S });
    s = withLine(s, { id: 'H', order: 'O2', fire: now + 40 * S + 10 * M, deadline: now + 40 * S + 12 * M, cook: 30 * S, early: 15 * M });
    s = deepFreeze(s);
    // At now only H is eligible: it fires (hidden lines are candidates too).
    expect(fires(getTickIntents(s, now)).map((f) => f.order_item_ids)).toEqual([['H']]);
    // From now + 30 s both are: the frozen one goes first, although H has waited an hour.
    expect(fires(getTickIntents(s, now + 30 * S)).map((f) => f.order_item_ids)).toEqual([['F']]);
    // FIFO: no auto-fill at all.
    const fifo = deepFreeze(
      withLine(withOrder(k({ policy: 'fifo' }), { order_id: 'O1', placed_at: now }), { id: 'F', order: 'O1', fire: now + 40 * S, deadline: now + 90 * S, cook: 5 * M, early: 60 * S }),
    );
    expect(getTickIntents(fifo, now + 30 * S)).toEqual([]);
    expect(nextDueAt(fifo, now + 30 * S)).toBe(now + 40 * S);
    // EDF: by deadline, waits and weights ignored.
    let e = withOrder(withOrder(k({ policy: 'edf' }), { order_id: 'O1', placed_at: now }), { order_id: 'O2', placed_at: now - 60 * M });
    e = withLine(e, { id: 'E1', order: 'O1', fire: now + 30 * S, deadline: now + 100 * S, cook: 5 * M, early: 5 * M });
    e = withLine(e, { id: 'E2', order: 'O2', fire: now + 30 * S + 5 * M, deadline: now + 100 * S + 5 * M, cook: 5 * M, early: 10 * M });
    expect(fires(getTickIntents(deepFreeze(e), now)).map((f) => f.order_item_ids)).toEqual([['E1']]);
  });

  it('[03a §3.6.1] the whole cook interval from now must fit (planned bookings and in-flight lines); capacity 2 fills both units', () => {
    // G is booked at now + 2 min (frozen, not eligible); L (5 min) would overlap it from now → not fired.
    let s = withOrder(k(), { order_id: 'O1', placed_at: now });
    s = withLine(s, { id: 'G', order: 'O1', fire: now + 2 * M, deadline: now + 10 * M, cook: 5 * M, early: 60 * S });
    s = withLine(s, { id: 'L', order: 'O1', fire: now + 7 * M, deadline: now + 7 * M, cook: 5 * M, early: 10 * M });
    s = deepFreeze(s);
    expect(getTickIntents(s, now)).toEqual([]);
    // A 1 min line fits before G.
    let s1 = withOrder(k(), { order_id: 'O1', placed_at: now });
    s1 = withLine(s1, { id: 'G', order: 'O1', fire: now + 2 * M, deadline: now + 10 * M, cook: 5 * M, early: 60 * S });
    s1 = withLine(s1, { id: 'Q', order: 'O1', fire: now + 7 * M, deadline: now + 7 * M, cook: 1 * M, early: 10 * M });
    expect(fires(getTickIntents(deepFreeze(s1), now)).map((f) => f.order_item_ids)).toEqual([['Q']]);
    // Capacity 2: two eligible lines fire in one pass (one FireDispatched per planned fire).
    let s2 = withOrder(k({ capacity: 2 }), { order_id: 'O1', placed_at: now });
    s2 = withLine(s2, { id: 'P1', order: 'O1', fire: now + 5 * M, deadline: now + 5 * M, cook: 5 * M, early: 10 * M });
    s2 = withLine(s2, { id: 'P2', order: 'O1', fire: now + 6 * M, deadline: now + 6 * M, cook: 5 * M, early: 10 * M });
    expect(fires(getTickIntents(deepFreeze(s2), now)).map((f) => [f.order_item_ids, f.due_at])).toEqual([
      [['P1'], now + 5 * M],
      [['P2'], now + 6 * M],
    ]);
  });

  it('[03a #96 tick] the tick reads the same in-flight occupancy as placement: a fired, not started line blocks auto-fill', () => {
    const tawa = kitchen([{ station_id: 'S1', capacity: 1 }]);
    let s = submit(tawa, 'O1', [{ id: 'A', cook: 5 * M }], at(0)).state;
    s = pass(s, at(0)).state; // A fired at 12:00, never started
    expect(s.lines.A!.fired_at).toBe(at(0));
    const { plan, state: s2 } = submit(s, 'O2', [{ id: 'B', cook: 5 * M, early: 10 * M }], at(6));
    expect(liveInterval(s2, 'A', at(6))).toEqual({ start: at(6), end: at(11) });
    expect(s2.lines.B!.booked).toEqual({ start: at(11), end: at(16), units: 1 });
    expect(plan.lines[0]!.eta_ms).toBe(at(16));
    // At 12:08 B is eligible (d − max_early ≤ now), but A's packed live interval [12:08, 12:13) holds the unit.
    expect(liveInterval(s2, 'A', at(8))).toEqual({ start: at(8), end: at(13) });
    expect(getTickIntents(s2, at(8))).toEqual([]);
    expect(nextDueAt(s2, at(8))).toBe(at(11));
    // A done at 12:07 frees it: B fills the idle unit at 12:08.
    const s3 = fold(s2, [done('O1', 'A', at(7))]);
    expect(fires(getTickIntents(s3, at(8)))).toEqual([{ station_id: 'S1', order_item_ids: ['B'], load_id: null, due_at: at(11), reason: 'early_fill' }]);
    expect(nextDueAt(s3, at(8))).toBe(at(8));
  });
});

describe('@pos/engine getTickIntents — inferred completion (§3.6.1 item 3, D60)', () => {
  it('[03a #52] single_tap: an inferred ItemStarted right after each fire; auto_done: an inferred ItemDone at started_at + prep + cook unless tapped', () => {
    const k = kitchen([
      { station_id: 'AD', capacity: 1, completion_mode: 'auto_done' },
      { station_id: 'ST', capacity: 2, completion_mode: 'single_tap' },
      { station_id: 'TT', capacity: 1, completion_mode: 'two_tap' },
    ]);
    const { state: s } = submit(k, 'O1', [{ id: 'A', station: 'AD', cook: 5 * M, prep: 1 * M }, { id: 'B', station: 'ST', cook: 5 * M }, { id: 'C', station: 'ST', cook: 4 * M }, { id: 'D', station: 'TT', cook: 5 * M }], at(0));
    const p = pass(s, at(0));
    expect(types(p.drafts)).toEqual(['FireDispatched', 'FireDispatched', 'FireDispatched', 'ItemStarted', 'ItemStarted']);
    expect(p.drafts.slice(3)).toEqual([
      { stream_type: 'order', stream_id: 'O1', event_type: 'ItemStarted', schema_version: 1, payload: { order_item_id: 'B', started_at: at(0), source: 'inferred' } },
      { stream_type: 'order', stream_id: 'O1', event_type: 'ItemStarted', schema_version: 1, payload: { order_item_id: 'C', started_at: at(0), source: 'inferred' } },
    ]);
    expect(p.state.lines.B).toMatchObject({ stage: 'cooking', started_at: at(0) });
    expect(p.state.lines.A).toMatchObject({ stage: 'added', fired_at: at(0) });
    // two_tap and single_tap: Done is tapped; auto_done: A is tapped started at 12:01, inferred done at 12:07.
    const s2 = fold(p.state, [start('O1', 'A', at(1)), start('O1', 'D', at(1))]);
    expect(nextDueAt(s2, at(2))).toBe(at(7));
    expect(getTickIntents(s2, at(7) - 1)).toEqual([]);
    const d = getTickIntents(s2, at(9));
    expect(d).toEqual([{ stream_type: 'order', stream_id: 'O1', event_type: 'ItemDone', schema_version: 1, payload: { order_item_id: 'A', done_at: at(7), source: 'inferred' } }]);
    expect(fold(s2, asEvents(d, at(9))).lines.A).toMatchObject({ stage: 'done', done_at: at(7) });
    // Tapped before: nothing inferred.
    const tapped = fold(s2, [done('O1', 'A', at(6))]);
    expect(getTickIntents(tapped, at(9))).toEqual([]);
    expect(nextDueAt(tapped, at(9))).toBeNull();
  });

  it('[03a #119] single_tap variant: the fires pass with the inferred starts commits (consumes clamp with breaches), and the next pass fires other stations', () => {
    const k = kitchen([{ station_id: 'S1', capacity: 4, completion_mode: 'single_tap' }, { station_id: 'S2', capacity: 1 }]);
    const s0 = fold(k, [stockSet('KB', 4, T0 - 60 * M)]);
    const lines = ['L1', 'L2', 'L3', 'L4'].map((id) => ({ id, cook: 20 * M, stock_cook: 60 * S, mode: 'sync' as const, draws: [{ stock_item_id: 'KB', quantity: 1 }], from_stock: true }));
    const sub = submit(s0, 'O1', lines, T0);
    const other = submit(sub.state, 'O2', [{ id: 'Z', station: 'S2', cook: 5 * M, mode: 'sync' }], T0, { pickup: T0 + 30 * M });
    let s = fold(other.state, [stockSet('KB', 2, T0 + 1 * S)]);
    expect(stockOf(s, 'KB')).toMatchObject({ on_hand: 2, reserved: 4 });
    const drafts = getTickIntents(s, T0 + 2 * S);
    expect(types(drafts)).toEqual(['FireDispatched', ...lines.flatMap(() => ['ItemStarted', 'StockConsumed'])]);
    expect(fires(drafts)[0]!.order_item_ids).toEqual(['L1', 'L2', 'L3', 'L4']);
    // Strict (tests) the third consume throws, like a tapped Start (stock-folds #119); the hub folds non-strict.
    expect(() => fold(s, asEvents(drafts, T0 + 2 * S))).toThrow(/stock invariant breach/);
    s = fold(s, asEvents(drafts, T0 + 2 * S), { strict: false });
    expect(stockOf(s, 'KB')).toMatchObject({ on_hand: 0, reserved: 0 });
    expect(s.diagnostics.filter((d) => d.kind === 'stock_breach').map((d) => d.detail.order_item_id)).toEqual(['L3', 'L4']);
    for (const l of lines) expect(s.lines[l.id]).toMatchObject({ stage: 'cooking', reserved_seq: null });
    // The next pass fires the other station's line and nothing on S1 again.
    const zFire = s.lines.Z!.fire_ms!;
    const next = getTickIntents(s, zFire);
    expect(fires(next)).toEqual([{ station_id: 'S2', order_item_ids: ['Z'], load_id: null, due_at: zFire, reason: 'scheduled' }]);
  });
});

describe('@pos/engine getTickIntents — overrun cascade (§3.6.1 item 4, F §4.7 D42, BF-5)', () => {
  // The F §4.7 test 12 fixture in ms (the test itself is in foundation.test.ts): capacity-1 slot stations X and Y,
  // cascade_step_ms 5.
  function f12(): EngineState {
    const k = kitchen([{ station_id: 'X', capacity: 1 }, { station_id: 'Y', capacity: 1 }], { cascade_step_ms: 5 });
    let s = submit(k, 'O1', [{ id: 'A', station: 'X', cook: 20 }], T0).state;
    s = fold(s, [fireEv('X', ['A'], T0), start('O1', 'A', T0)]);
    s = submit(s, 'O2', [{ id: 'B', station: 'X', cook: 10, mode: 'sync' }, { id: 'B2', station: 'Y', cook: 10, mode: 'sync' }], T0).state;
    s = submit(s, 'O3', [{ id: 'C', station: 'X', cook: 10, mode: 'sync' }], T0).state;
    expect(s.lines.B!.booked).toEqual({ start: T0 + 20, end: T0 + 30, units: 1 });
    expect(s.lines.B2!.booked).toEqual({ start: T0 + 20, end: T0 + 30, units: 1 });
    expect(s.lines.C!.booked).toEqual({ start: T0 + 30, end: T0 + 40, units: 1 });
    // The pass at T + 20 fires B and B2 (A's planned end: no overrun yet, no shift); B2 is started on time.
    const p = pass(s, T0 + 20);
    expect(fires(p.drafts).map((f) => [f.station_id, f.order_item_ids])).toEqual([
      ['X', ['B']],
      ['Y', ['B2']],
    ]);
    return fold(p.state, [start('O2', 'B2', T0 + 20)]);
  }

  it('[03a BF-5] the cascade term is due at the first ms the live end pushes into a later unstarted reservation, never at the planned end', () => {
    const s = f12();
    // At T + 20 (A's planned end) nothing is due; at T + 21 B, packed behind A, overlaps C by 1 ms → one step.
    expect(getTickIntents(s, T0 + 20)).toEqual([]);
    expect(nextDueAt(s, T0 + 20)).toBe(T0 + 21);
    expect(getTickIntents(s, T0 + 21)).toEqual([
      { stream_type: 'station', stream_id: 'X', event_type: 'ReservationsShifted', schema_version: 1, payload: { station_id: 'X', cause: 'overrun', shifts: [{ order_item_id: 'C', by_ms: 5 }] } },
    ]);
    // Overrun with an empty queue: once C is gone (removed), no term is left.
    const alone = fold(s, [stamp({ ...anItemStarted(), event_type: 'ItemRemoved', stream_id: 'O3', payload: { order_item_id: 'C' } }, T0 + 20)]);
    expect(alone.lines.C!.stage).toBe('removed');
    expect(nextDueAt(alone, T0 + 20)).toBeNull();
    expect(getTickIntents(alone, T0 + 500)).toEqual([]);
    // A COOKING line overrunning on an empty station: never due.
    const k = kitchen([{ station_id: 'X', capacity: 1 }]);
    let solo = submit(k, 'O1', [{ id: 'A', station: 'X', cook: 20 * S }], T0).state;
    solo = fold(solo, [fireEv('X', ['A'], T0), start('O1', 'A', T0)]);
    expect(nextDueAt(solo, T0 + 60 * S)).toBeNull();
    expect(getTickIntents(solo, T0 + 60 * S)).toEqual([]);
  });

  it('[03a #62 engine] boundary clause: a folded shift leaves the same now with no intent; fires is due only at each cascade_step_ms boundary', () => {
    let s = f12();
    const p = pass(s, T0 + 21);
    expect(types(p.drafts)).toEqual(['ReservationsShifted']);
    s = p.state;
    expect(s.lines.C!.booked).toEqual({ start: T0 + 35, end: T0 + 45, units: 1 });
    // A second pass at the same now writes nothing new; the next due instant is the next step boundary (+ 1 ms, the
    // first ms B, packed behind the overrunning A, overlaps C again).
    expect(getTickIntents(s, T0 + 21)).toEqual([]);
    expect(nextDueAt(s, T0 + 21)).toBe(T0 + 26);
    // A pass every ms while A keeps overrunning: one shift of one step per boundary, nothing in between.
    const shiftedAt: number[] = [];
    for (let now = T0 + 22; now <= T0 + 50; now++) {
      const due = nextDueAt(s, now)!;
      const q = pass(s, now);
      expect(q.drafts.length > 0, `pass ${now - T0}`).toBe(due <= now);
      if (q.drafts.length > 0) {
        expect(q.drafts).toEqual([
          { stream_type: 'station', stream_id: 'X', event_type: 'ReservationsShifted', schema_version: 1, payload: { station_id: 'X', cause: 'overrun', shifts: [{ order_item_id: 'C', by_ms: 5 }] } },
        ]);
        shiftedAt.push(now - T0);
      }
      s = q.state;
    }
    expect(shiftedAt).toEqual([26, 31, 36, 41, 46]);
    expect(s.lines.C!.booked).toEqual({ start: T0 + 60, end: T0 + 70, units: 1 });
    expect(s.lines.C!.deadline_ms).toBe(f12().lines.C!.deadline_ms);
  });
});

describe('@pos/engine getTickIntents — abandoned reservations (§3.6.1 item 4a, §3.7)', () => {
  it('[03a #111 tick] the pass at the abandon time releases every draw of each line with a live reservation, reason abandoned', () => {
    const k = kitchen([{ station_id: 'S1', capacity: 2 }], { order_abandon_ms: 3_600_000 });
    let s = fold(k, [stockSet('KB', 4, T0 - 60 * M), stockSet('NN', 4, T0 - 60 * M)]);
    const draws = [{ stock_item_id: 'KB', quantity: 1 }, { stock_item_id: 'NN', quantity: 2 }];
    s = submit(s, 'O1', [{ id: 'L', cook: 20 * M, stock_cook: 60 * S, draws, from_stock: true }], T0).state;
    // A delivery picked up in 6 h: its unfired line keeps the order in the engine.
    s = submit(s, 'O2', [{ id: 'H', cook: 5 * M, mode: 'sync' }], T0, { pickup: T0 + 360 * M }).state;
    const p = pass(s, T0);
    expect(fires(p.drafts).map((f) => f.order_item_ids)).toEqual([['L']]);
    s = p.state; // L fired at T0 and never tapped
    expect(stockOf(s, 'KB').reserved).toBe(1);
    const abandonAt = T0 + 3_600_000;
    expect(nextDueAt(s, T0 + 1 * M)).toBe(abandonAt);
    expect(getTickIntents(s, abandonAt - 1)).toEqual([]);
    const rel = getTickIntents(s, abandonAt);
    expect(rel).toEqual([
      { stream_type: 'stock', stream_id: 'KB', event_type: 'StockReleased', schema_version: 1, payload: { stock_item_id: 'KB', order_item_id: 'L', quantity: 1, reason: 'abandoned' } },
      { stream_type: 'stock', stream_id: 'NN', event_type: 'StockReleased', schema_version: 1, payload: { stock_item_id: 'NN', order_item_id: 'L', quantity: 2, reason: 'abandoned' } },
    ]);
    const after = fold(s, asEvents(rel, abandonAt));
    expect(stockOf(after, 'KB').reserved).toBe(0);
    expect(stockOf(after, 'NN').reserved).toBe(0);
    // AD-20 (task 14b): the removal step keeps O1 while L holds a reservation, so both releases find the line; once
    // released, O1 leaves at the next listed fold. It occupies nothing meanwhile.
    expect(after.orders.O1).toBeDefined();
    expect(after.lines.L!.reserved_seq).toBeNull();
    expect(getTickIntents(after, abandonAt)).toEqual([]);
    expect(fold(after, [stockSet('NN', 4, abandonAt + 1)]).orders.O1).toBeUndefined();
    expect(after.orders.O2).toBeDefined();
    // What is left is H's auto-fill eligibility (d − max_early_ms, the idle station), a minute before its fire.
    expect(nextDueAt(after, abandonAt)).toBe(after.lines.H!.deadline_ms - after.lines.H!.max_early_ms);
  });
});

describe('@pos/engine getTickIntents — Review Focus 3 (now before the last folded recorded_at)', () => {
  it('[03a Review Focus 3] now before fired_at / started_at: no throw, no negative interval, never a second fire', () => {
    const k = kitchen([{ station_id: 'S1', capacity: 1, completion_mode: 'auto_done' }, { station_id: 'S2', capacity: 1 }]);
    let s = submit(k, 'O1', [{ id: 'A', cook: 5 * M }, { id: 'B', station: 'S2', cook: 5 * M }, { id: 'C', station: 'S2', cook: 5 * M }], at(0)).state;
    s = fold(s, [fireEv('S1', ['A'], at(2), at(0)), start('O1', 'A', at(3)), fireEv('S2', ['B'], at(2), at(0))]);
    for (const now of [at(-1), at(0), at(1), at(2) - 1]) {
      const d = getTickIntents(s, now);
      expect(fires(d).flatMap((f) => f.order_item_ids)).not.toContain('A');
      expect(fires(d).flatMap((f) => f.order_item_ids)).not.toContain('B');
      expect(d.filter((x) => x.event_type === 'ItemDone')).toEqual([]);
      for (const id of ['A', 'B', 'C']) {
        const iv = liveInterval(s, id, now);
        if (iv !== null) expect(iv.end).toBeGreaterThan(iv.start);
      }
      const nd = nextDueAt(s, now);
      if (nd !== null) expect(getTickIntents(s, nd).length).toBeGreaterThan(0);
    }
  });
});

describe('@pos/engine firesDue (§3.6.3)', () => {
  it('[03a §3.6.3] crossed = stations with an unfired line whose fire_ms − freeze_ms lies in (last_pass_ms, now]; intents_due = now ≥ nextDueAt', () => {
    const k = kitchen([{ station_id: 'S1', capacity: 1 }, { station_id: 'S2', capacity: 1, freeze_ms: 60_000 }]);
    let s = submit(k, 'O1', [{ id: 'A', cook: 5 * M }, { id: 'B', cook: 5 * M }], at(0)).state; // A at 12:00, B at 12:05
    s = submit(s, 'O2', [{ id: 'C', station: 'S2', cook: 5 * M, mode: 'sync' }], at(0), { pickup: at(20) }).state; // C at 12:15
    s = pass(s, at(0)).state; // A fired
    expect(s.lines.B!.fire_ms).toBe(at(5));
    expect(s.lines.C!.fire_ms).toBe(at(15));
    // B enters Next at 12:03 (freeze 2 min), C at 12:14 (freeze 1 min).
    expect(firesDue(s, at(3) - 500, at(3))).toEqual({ intents_due: false, crossed: ['S1'] });
    expect(firesDue(s, at(3), at(3) + 500)).toEqual({ intents_due: false, crossed: [] });
    expect(firesDue(s, at(13), at(14))).toEqual({ intents_due: true, crossed: ['S2'] }); // B (12:05) is overdue
    expect(firesDue(s, at(2), at(14))).toEqual({ intents_due: true, crossed: ['S1', 'S2'] });
    expect(firesDue(s, at(5) - 500, at(5))).toEqual({ intents_due: true, crossed: [] });
  });
});

// ---- [03a #62 engine] property over 50 seeds ---------------------------------------------------------------------

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function checkPass(s: EngineState, now: number, label: string): TickDraft[] {
  const drafts = getTickIntents(s, now);
  expect(getTickIntents(s, now), label).toEqual(drafts); // pure, same result twice (F #13)
  const seen = new Set<string>();
  for (const f of fires(drafts)) {
    for (const id of f.order_item_ids) {
      const l = s.lines[id]!;
      expect(l.stage === 'added' && l.fired_at === null, `${label} fires ${id} once, unfired`).toBe(true);
      expect(seen.has(id), `${label} ${id} in one FireDispatched`).toBe(false);
      seen.add(id);
    }
    if (f.load_id !== null) {
      const load = s.stations[f.station_id]!.loads[f.load_id];
      if (load !== undefined) for (const m of load.order_item_ids) expect(f.order_item_ids, `${label} whole load`).toContain(m);
    }
  }
  for (const d of drafts) {
    if (d.event_type === 'ItemStarted') expect(seen.has((d.payload as { order_item_id: string }).order_item_id), label).toBe(true);
  }
  const nd = nextDueAt(s, now);
  expect(nd !== null && nd <= now, `${label} due ⇔ intents (nd ${nd})`).toBe(drafts.length > 0);
  if (nd !== null) expect(getTickIntents(s, nd).length, `${label} intents at nextDueAt ${nd - T0}`).toBeGreaterThan(0);
  const fd = firesDue(s, now - 500, now);
  expect(fd.intents_due, label).toBe(nd !== null && now >= nd);
  const crossed = new Set<string>();
  for (const l of Object.values(s.lines)) {
    if (l.stage !== 'added' || l.fired_at !== null || l.fire_ms === null || !s.stations[l.station_id]!.unfired.includes(l.order_item_id)) continue;
    const freeze = s.config!.stations.find((c) => c.station_id === l.station_id)!.freeze_ms;
    if (l.fire_ms - freeze > now - 500 && l.fire_ms - freeze <= now) crossed.add(l.station_id);
  }
  expect(fd.crossed, label).toEqual([...crossed].sort());
  return drafts;
}

describe('@pos/engine tick property (§3.6.1, BF-5)', () => {
  it('[03a #62 engine] over 50 seeds: getTickIntents(state, nextDueAt(state, t)) is non-empty; due ⇔ intents; pure; never a second fire', () => {
    const modes = ['two_tap', 'single_tap', 'auto_done'] as const;
    const policies = ['waada_guard', 'edf', 'fifo'] as const;
    for (let seed = 1; seed <= 50; seed++) {
      const rnd = prng(seed);
      const pick = <V>(xs: readonly V[]): V => xs[Math.floor(rnd() * xs.length)]!;
      const k = kitchen(
        [
          { station_id: 'S1', capacity: 1 + Math.floor(rnd() * 3), completion_mode: pick(modes), policy: pick(policies) },
          { station_id: 'S2', capacity: 1 + Math.floor(rnd() * 2), completion_mode: pick(modes), policy: pick(policies), freeze_ms: 60_000 },
          {
            station_id: 'F',
            station_type: 'batch',
            capacity: 2 + Math.floor(rnd() * 3),
            freshness_window_ms: pick([0, 30_000, 300_000]),
            completion_mode: pick(modes),
            policy: pick(['waada_guard', 'edf'] as const),
            programs: [
              { program_id: 'P1', name: 'Fry', cook_time_ms: 999_999, is_archived: false },
              { program_id: 'P2', name: 'Reheat', cook_time_ms: 999_999, is_archived: false },
            ],
          },
        ],
        // order_abandon_ms below 01a's range so a simulated hour reaches it (the engine reads the value as given).
        { cascade_step_ms: 30_000, order_abandon_ms: 1_200_000 },
      );
      let s = fold(k, [stockSet('KB', 1_000, T0 - 60 * M)]);
      let t = T0;
      let n = 0;
      for (let step = 0; step < 45; step++) {
        t += Math.floor(5 * S + rnd() * 120 * S);
        const r = rnd();
        if (r < 0.35) {
          n++;
          const items: Item[] = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, j) => {
            const fromStock = rnd() < 0.2;
            const where = rnd();
            if (where < 0.25) return { id: `L${n}_${j}`, station: 'F', program: rnd() < 0.7 ? 'P1' : 'P2', cook: rnd() < 0.7 ? 3 * M : 2 * M, mode: rnd() < 0.6 ? 'sync' : 'immediate', early: pick([60_000, 300_000]) };
            return {
              id: `L${n}_${j}`,
              station: where < 0.6 ? 'S1' : 'S2',
              cook: Math.floor(1 * M + rnd() * 8 * M),
              prep: rnd() < 0.3 ? Math.floor(rnd() * 2 * M) : 0,
              mode: rnd() < 0.6 ? 'sync' : 'immediate',
              early: rnd() < 0.5 ? 60_000 : Math.floor(rnd() * 10 * M),
              ...(fromStock ? { from_stock: true, stock_cook: 30 * S, draws: [{ stock_item_id: 'KB', quantity: 1 }] } : {}),
            };
          });
          const pickup = rnd() < 0.2 ? t + Math.floor(20 * M + rnd() * 60 * M) : undefined;
          s = submit(s, `O${n}`, items, t, pickup === undefined ? {} : { pickup }).state;
        } else if (r < 0.6) {
          const fired = Object.values(s.lines).filter((l) => l.stage === 'added' && l.fired_at !== null);
          if (fired.length > 0) {
            const l = pick(fired);
            s = fold(s, [start(l.order_id, l.order_item_id, t)], { strict: false });
          }
        } else if (r < 0.75) {
          const cooking = Object.values(s.lines).filter((l) => l.stage === 'cooking');
          if (cooking.length > 0) {
            const l = pick(cooking);
            s = fold(s, [done(l.order_id, l.order_item_id, t)], { strict: false });
          }
        }
        const label = `seed ${seed} step ${step} t ${t - T0}`;
        // Probe a few instants around and ahead of t on the same state.
        for (const probe of [t - 500, t, t + Math.floor(rnd() * 10 * M)]) {
          const nd = nextDueAt(s, probe);
          if (nd !== null) expect(getTickIntents(s, nd).length, `${label} probe ${probe - T0}`).toBeGreaterThan(0);
        }
        const drafts = checkPass(s, t, label);
        s = fold(s, asEvents(drafts, t), { strict: false });
      }
    }
  }, 60_000);
});

// Replay of a tick-written log equals the live state (D44: the intents are the only mutation).
describe('@pos/engine tick replay', () => {
  it('[03a §3.6.1] folding the tick drafts as events: replay = live, and no line is fired twice over the day', () => {
    const k = kitchen([{ station_id: 'S1', capacity: 2, completion_mode: 'single_tap' }]);
    const cfg = configEvent([{ station_id: 'S1', capacity: 2, completion_mode: 'single_tap' }]);
    const log: PosEvent[] = [cfg];
    let s = applyEvent(initialEngineState(), cfg);
    expect(s).toEqual(k);
    const fireCount = new Map<string, number>();
    for (let i = 0; i < 6; i++) {
      const now = at(i * 3);
      const p = planOrder(s, proposed(`O${i}`, [{ id: `L${i}`, cook: 4 * M }, { id: `M${i}`, cook: 2 * M }]), now, {});
      const batch = anOrderBatch({
        order_id: `O${i}`,
        recorded_at: now,
        seq: nextSeq(3),
        lines: [`L${i}`, `M${i}`].map((id, j) => ({ order_item_id: id, item: itemFields({ id, cook: (j === 0 ? 4 : 2) * M }) })),
        order: { groups: p.groups },
      }).map((e, j) => ({ ...e, event_id: `01R${String(seq + j).padStart(23, '0')}` }));
      for (const e of batch) {
        s = applyEvent(s, e);
        log.push(e);
      }
      for (const tt of [now, now + 1 * M, now + 2 * M]) {
        const ev = asEvents(getTickIntents(s, tt), tt);
        for (const e of ev) {
          if (e.event_type === 'FireDispatched') for (const id of (e.payload as { order_item_ids: string[] }).order_item_ids) fireCount.set(id, (fireCount.get(id) ?? 0) + 1);
          s = applyEvent(s, e);
          log.push(e);
        }
      }
    }
    expect([...fireCount.values()].every((c) => c === 1)).toBe(true);
    expect(buildEngineState(log)).toEqual(s);
  });
});
