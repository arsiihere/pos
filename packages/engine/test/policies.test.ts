// 03a §3.5.2 weights (branch weights read from state.config at each re-plan; the item weight_pct a copy), §3.5.3
// FIFO / EDF bullets, §3.5.4 per-station policy, D3 (padding 0 on FIFO / EDF), AD-14 (FIFO sync lines in a group).
import { parseEvent, type EngineConfig, type ItemAddedPayload, type PosEvent } from '@pos/events';
import { aFireDispatched, anEngineConfigApplied, anItemAdded, anOrderBatch } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { applyEvent, initialEngineState, planOrder, type EngineState, type PlanResult, type ProposedOrder } from '../src/index';
import { weightOf } from '../src/replan';

const T0 = 1_761_000_000_000; // "12:00"
const M = 60_000;
const at = (min: number): number => T0 + min * M;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const BASE = parseEvent(anEngineConfigApplied()).payload as unknown as EngineConfig;
const S1 = BASE.stations[0]!;
type StationCfg = EngineConfig['stations'][number];
type Settings = EngineConfig['settings'];

function configEvent(stations: Array<Partial<StationCfg>>, settings: Partial<Settings>, recorded_at: number, seq: number): PosEvent {
  return deepFreeze(
    anEngineConfigApplied({
      recorded_at,
      occurred_at: recorded_at,
      seq,
      payload: { stations: stations.map((s) => ({ ...S1, ...s })), settings: { ...BASE.settings, ...settings } },
    }),
  );
}

function kitchen(stations: Array<Partial<StationCfg>>, settings: Partial<Settings> = {}): EngineState {
  return deepFreeze(applyEvent(initialEngineState(), configEvent(stations, settings, T0 - 3_600_000, 1)));
}

function fold(state: EngineState, events: PosEvent[]): EngineState {
  let s = deepFreeze(state);
  for (const e of events) s = deepFreeze(applyEvent(s, deepFreeze(e)));
  return s;
}

type Item = { id: string; st?: string; cook: number; prep?: number; mode?: 'sync' | 'immediate'; early?: number };
type OrderType = 'dine_in' | 'takeaway' | 'delivery' | 'parking';
type OrderOver = { pickup_at_ms?: number | null; order_type?: OrderType };

let seq = 100;
const nextSeq = (n: number): number => {
  const s = seq;
  seq += n + 1;
  return s;
};

function proposed(order_id: string, items: Item[], o: OrderOver): ProposedOrder {
  const base = anItemAdded().payload as unknown as ItemAddedPayload;
  return deepFreeze({
    order_id,
    order: { order_type: o.order_type ?? 'dine_in', table_id: 'T12', table_key: 'dine_in:T12', follow_up: false, pickup_at_ms: o.pickup_at_ms ?? null },
    lines: items.map((i) => ({
      ...base,
      order_id,
      order_item_id: i.id,
      station_id: i.st ?? 'S1',
      cook_time_ms: i.cook * M,
      prep_buffer_ms: (i.prep ?? 0) * M,
      serve_mode: i.mode ?? 'sync',
      quantity: 1,
      alternates: [],
      point_id: null,
      carry_ms: 0,
      weight_pct: 100,
      max_early_ms: (i.early ?? 1) * M,
      max_late_ms: null,
      max_carry_ms: null,
      cook_ms_override: null,
      return_of: null,
    })),
  });
}

function batch(order_id: string, items: Item[], recorded_at: number, groups: PlanResult['groups'], o: OrderOver): PosEvent[] {
  return anOrderBatch({
    order_id,
    recorded_at,
    seq: nextSeq(items.length),
    lines: items.map((i) => ({
      order_item_id: i.id,
      item: { station_id: i.st ?? 'S1', cook_time_ms: i.cook * M, prep_buffer_ms: (i.prep ?? 0) * M, serve_mode: i.mode ?? 'sync', quantity: 1 },
      line: { station_id: i.st ?? 'S1', carry_ms: 0, max_early_ms: (i.early ?? 1) * M },
    })),
    order: { order_type: o.order_type ?? 'dine_in', pickup_at_ms: o.pickup_at_ms ?? null, groups },
  });
}

// planOrder at now, then the batch folded at now: the fold places every line where the plan said (one sequence).
function submit(state: EngineState, order_id: string, items: Item[], now: number, o: OrderOver = {}): { plan: PlanResult; state: EngineState } {
  const plan = planOrder(state, proposed(order_id, items, o), now, {});
  const s = fold(state, batch(order_id, items, now, plan.groups, o));
  for (const l of plan.lines) expect(s.lines[l.order_item_id]!.booked!.end + l.carry_ms).toBe(l.eta_ms);
  return { plan, state: s };
}

function fire(ids: string[], recorded_at: number, station_id = 'S1'): PosEvent {
  return aFireDispatched({
    stream_id: station_id,
    recorded_at,
    occurred_at: recorded_at,
    seq: nextSeq(0),
    payload: { station_id, order_item_ids: ids, due_at: recorded_at, load_id: null, reason: 'scheduled' },
  });
}

function voided(order_id: string, id: string, recorded_at: number): PosEvent {
  const s = nextSeq(0);
  const base = anOrderBatch({ order_id })[0]!;
  return {
    ...base,
    event_type: 'ItemVoided',
    stream_id: order_id,
    payload: { order_item_id: id, units: 1 },
    recorded_at,
    occurred_at: recorded_at,
    seq: s,
    event_id: `01JZ${String(s).padStart(22, '0')}`,
  };
}

const fireOf = (s: EngineState, id: string): number => s.lines[id]!.fire_ms!;
const group = (plan: PlanResult, i = 0): PlanResult['groups'][number] => plan.groups[i]!;

// Every line of the order is on time at submit: fire ≤ deadline and land ≤ its group's T.
function nothingLate(s: EngineState, order_id: string): void {
  const order = s.orders[order_id]!;
  for (const id of order.line_ids) {
    const l = s.lines[id]!;
    expect(l.fire_ms!).toBeLessThanOrEqual(l.deadline_ms);
    expect(l.booked!.end + l.carry_ms).toBeLessThanOrEqual(order.groups[l.group_id]!.target_land_ms);
  }
}

describe('@pos/engine policies (§3.5.2–§3.5.4, D3, AD-14)', () => {
  it('[03a #24] FIFO: earliest fit in submit order, no hold (pickup ignored), no re-plan of older lines; target = land, padding 0', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 1, policy: 'fifo' }]);
    // Z busy until 12:10.
    ({ state: s } = submit(s, 'OZ', [{ id: 'Z', cook: 10, mode: 'immediate' }], at(0)));
    // A (cook 10) for a pickup at 12:30: FIFO fires it at its earliest fit 12:10, never held to 12:20.
    const a = submit(s, 'OA', [{ id: 'A', cook: 10 }], at(0), { pickup_at_ms: at(30) });
    s = a.state;
    expect(fireOf(s, 'A')).toBe(at(10));
    expect(s.lines.A!.booked).toEqual({ start: at(10), end: at(20), units: 1 });
    expect(s.lines.A!.deadline_ms).toBe(at(10)); // AD-14: target = land, deadline = its fire
    expect(group(a.plan).target_land_ms).toBe(at(30)); // group T ≥ the pickup (as before)
    expect(group(a.plan).promise_ms).toBe(at(30)); // padding 0 (D3)
    // B (shorter, cook 5) at 12:01 queues behind A in submit order; A (hidden) is not re-planned.
    const aBefore = s.lines.A!;
    const b = submit(s, 'OB', [{ id: 'B', cook: 5 }], at(1));
    expect(b.state.lines.A).toEqual(aBefore);
    expect(fireOf(b.state, 'B')).toBe(at(20));
    expect(b.state.lines.B!.deadline_ms).toBe(at(20));
    expect(group(b.plan).target_land_ms).toBe(at(25));
    expect(group(b.plan).promise_ms).toBe(at(25));
    expect(b.state.stations.S1!.profile).toEqual({ t: [at(0), at(25)], u: [1, 0] });
    nothingLate(b.state, 'OB');
  });

  it('[03a #24] the same order on a Waada Guard station is held to its pickup (the FIFO contrast)', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 1 }]);
    ({ state: s } = submit(s, 'OZ', [{ id: 'Z', cook: 10, mode: 'immediate' }], at(0)));
    const a = submit(s, 'OA', [{ id: 'A', cook: 10 }], at(0), { pickup_at_ms: at(30) });
    expect(fireOf(a.state, 'A')).toBe(at(20));
    expect(group(a.plan).promise_ms).toBe(at(33));
  });

  it('[03a AD-14] a group spanning a FIFO and a Waada Guard station: the FIFO line at its earliest fit, T ≥ its land, nothing late', () => {
    const s = kitchen([
      { station_id: 'F', capacity: 1, policy: 'fifo' },
      { station_id: 'W', capacity: 1 },
    ]);
    // X (FIFO, cook 15) lands 12:15; Y (Waada Guard, cook 5) is held to land with it.
    const r = submit(s, 'OG', [{ id: 'X', st: 'F', cook: 15 }, { id: 'Y', st: 'W', cook: 5 }], at(0));
    expect(r.plan.groups).toHaveLength(1);
    expect(fireOf(r.state, 'X')).toBe(at(0));
    expect(r.state.lines.X!.deadline_ms).toBe(at(0));
    expect(group(r.plan).target_land_ms).toBe(at(15));
    expect(fireOf(r.state, 'Y')).toBe(at(10));
    expect(r.state.lines.Y!.deadline_ms).toBe(at(10));
    expect(group(r.plan).promise_ms).toBe(at(18)); // max padding over the group's stations: W 3 min, F 0
    nothingLate(r.state, 'OG');

    // The FIFO line lands early when the held line is the critical one ("naan may be ready early", D3).
    const r2 = submit(s, 'OH', [{ id: 'X2', st: 'F', cook: 5 }, { id: 'Y2', st: 'W', cook: 20 }], at(0));
    expect(fireOf(r2.state, 'X2')).toBe(at(0));
    expect(r2.state.lines.X2!.booked!.end).toBe(at(5));
    expect(group(r2.plan).target_land_ms).toBe(at(20));
    nothingLate(r2.state, 'OH');

    // A delivery pickup still floors T; the FIFO line ignores it.
    const r3 = submit(s, 'OD', [{ id: 'X3', st: 'F', cook: 5 }, { id: 'Y3', st: 'W', cook: 5 }], at(0), { pickup_at_ms: at(40), order_type: 'delivery' });
    expect(fireOf(r3.state, 'X3')).toBe(at(0));
    expect(group(r3.plan).target_land_ms).toBe(at(40));
    expect(fireOf(r3.state, 'Y3')).toBe(at(35));
    nothingLate(r3.state, 'OD');
  });

  it('[03a AD-14] two FIFO lines in one group: each at its earliest fit in listing order; T = the latest land', () => {
    const s = kitchen([
      { station_id: 'F', capacity: 1, policy: 'fifo' },
      { station_id: 'G', capacity: 1, policy: 'fifo' },
    ]);
    // Same station: listing order, no D36 longest-first queue; different stations: each from t.
    const r = submit(s, 'OG', [{ id: 'C1', st: 'F', cook: 5 }, { id: 'C2', st: 'F', cook: 10 }, { id: 'C3', st: 'G', cook: 3 }], at(0));
    expect(r.plan.groups).toHaveLength(1);
    expect(r.state.lines.C1!.booked).toEqual({ start: at(0), end: at(5), units: 1 });
    expect(r.state.lines.C2!.booked).toEqual({ start: at(5), end: at(15), units: 1 });
    expect(r.state.lines.C3!.booked).toEqual({ start: at(0), end: at(3), units: 1 });
    for (const id of ['C1', 'C2', 'C3']) expect(r.state.lines[id]!.deadline_ms).toBe(fireOf(r.state, id));
    expect(group(r.plan).target_land_ms).toBe(at(15));
    expect(group(r.plan).promise_ms).toBe(at(15));
    expect(r.state.orders.OG!.target_land_ms).toBe(at(15));
    nothingLate(r.state, 'OG');
  });

  it('[03a AD-14] a void re-loops the group\'s Waada Guard lines only: a hidden FIFO sibling never moves, its land floors T\'', () => {
    let s = kitchen([
      { station_id: 'F', capacity: 1, policy: 'fifo' },
      { station_id: 'W', capacity: 2 },
    ]);
    // F busy until 12:10, so X (FIFO, cook 5) fires 12:10 and lands 12:15 (hidden at 12:01).
    ({ state: s } = submit(s, 'OZ', [{ id: 'Z', st: 'F', cook: 10, mode: 'immediate' }], at(0)));
    const r = submit(s, 'OG', [{ id: 'X', st: 'F', cook: 5 }, { id: 'Y1', st: 'W', cook: 30 }, { id: 'Y2', st: 'W', cook: 20 }], at(0));
    s = r.state;
    expect(fireOf(s, 'X')).toBe(at(10));
    expect(group(r.plan).target_land_ms).toBe(at(30));
    expect(fireOf(s, 'Y2')).toBe(at(10));
    const xBefore = s.lines.X!;
    const after = fold(s, [voided('OG', 'Y1', at(1))]);
    // Y2 alone lands 12:21 at the earliest; T' = min(12:30, max(12:21, X's land 12:15)).
    expect(after.orders.OG!.groups['OG:0']!.target_land_ms).toBe(at(21));
    expect(fireOf(after, 'Y2')).toBe(at(1));
    expect(after.lines.X).toEqual(xBefore);
  });

  // The #90 / #25 fixture: capacity 2; C (fired, not started; prep 10, cook 10) takes one unit [t + 10, t + 20) at
  // the trigger. A (dine-in) and B (delivery), both cook 10 for 12:30, both d = 12:20, both hidden at 12:05. The
  // trigger N (12:05) runs pass 1: the first line in pass-1 order takes d − keep, the other the earlier gap.
  function fixture(stations: Array<Partial<StationCfg>>, settings: Partial<Settings>, raise?: Partial<Settings>): EngineState {
    let s = kitchen(stations, settings);
    ({ state: s } = submit(s, 'OC', [{ id: 'C', cook: 10, prep: 10, mode: 'immediate' }], at(0)));
    s = fold(s, [fire(['C'], at(0))]);
    ({ state: s } = submit(s, 'OA', [{ id: 'A', cook: 10, early: 30 }], at(0), { pickup_at_ms: at(30) }));
    ({ state: s } = submit(s, 'OB', [{ id: 'B', cook: 10, early: 30 }], at(0), { pickup_at_ms: at(30), order_type: 'delivery' }));
    expect(s.lines.A!.deadline_ms).toBe(at(20));
    expect(s.lines.B!.deadline_ms).toBe(at(20));
    if (raise !== undefined) s = fold(s, [configEvent(stations, { ...settings, ...raise }, at(4), nextSeq(0))]);
    return submit(s, 'ON', [{ id: 'N', cook: 1, mode: 'immediate' }], at(5)).state;
  }

  it('[03a #90] raising weight_delivery_pct re-weighs an open delivery line at the next re-plan; its weight_pct copy is unchanged', () => {
    const st = [{ station_id: 'S1', capacity: 2 }];
    const even = { weight_dine_in_pct: 100, weight_delivery_pct: 100 };
    // Equal weights: tie on (d − keep, w × waiting) → order_item_id: A first.
    const before = fixture(st, even);
    expect(fireOf(before, 'A')).toBe(at(19));
    expect(fireOf(before, 'B')).toBe(at(9));
    // EngineConfigApplied at 12:04 raises weight_delivery_pct to 200: B now goes first.
    const after = fixture(st, even, { weight_delivery_pct: 200 });
    expect(fireOf(after, 'B')).toBe(at(19));
    expect(fireOf(after, 'A')).toBe(at(9));
    expect(after.lines.B!.weight_pct).toBe(100);
    expect(after.lines.B!.weight_pct).toBe(before.lines.B!.weight_pct);
    expect(weightOf(after, after.lines.B!)).toBe(200);
    expect(weightOf(before, before.lines.B!)).toBe(100);
  });

  it('[03a #25] EDF = Waada Guard with weights 100, keep 0, padding 0: the same placement on a fixture', () => {
    // EDF with the default branch weights (delivery 200) ignores them: w = 100 for every line (D3).
    const edf = fixture([{ station_id: 'S1', capacity: 2, policy: 'edf' }], {});
    const flat = { weight_dine_in_pct: 100, weight_takeaway_pct: 100, weight_delivery_pct: 100, weight_parking_pct: 100, weight_follow_up_pct: 100 };
    const wg = fixture([{ station_id: 'S1', capacity: 2, policy: 'waada_guard', min_slack_keep_ms: 0, promise_padding_ms: 0 }], flat);
    expect(edf.lines).toEqual(wg.lines);
    expect(edf.stations.S1!.profile).toEqual(wg.stations.S1!.profile);
    expect(edf.stations.S1!.unfired).toEqual(wg.stations.S1!.unfired);
    for (const id of ['OA', 'OB', 'OC', 'ON']) {
      expect(edf.orders[id]!.target_land_ms).toBe(wg.orders[id]!.target_land_ms);
      expect(edf.orders[id]!.promise_ms).toBe(wg.orders[id]!.promise_ms);
      expect(edf.orders[id]!.promise_ms).toBe(edf.orders[id]!.target_land_ms); // padding 0
    }
    // Keep 0: the first line sits on its deadline 12:20 (not d − keep), the other the earlier gap.
    expect(fireOf(edf, 'A')).toBe(at(20));
    expect(fireOf(edf, 'B')).toBe(at(10));
    expect(weightOf(edf, edf.lines.B!)).toBe(100);
  });

  it('[03a §3.5.2] a return line takes the follow-up weight from return_of, whatever its mark', () => {
    const s0 = kitchen([{ station_id: 'S1', capacity: 2 }]);
    const s = submit(s0, 'OA', [{ id: 'A', cook: 5, mode: 'immediate' }], at(0)).state;
    const line = s.lines.A!;
    expect(weightOf(s, line)).toBe(100); // dine-in 100
    expect(weightOf(s, { ...line, mark: 'return', return_of: { order_item_id: 'Q', mode: 'fix' } })).toBe(300);
    expect(weightOf(s, { ...line, mark: 'moved', return_of: { order_item_id: 'Q', mode: 'remake' } })).toBe(300);
    expect(weightOf(s, { ...line, mark: 'expedite' })).toBe(300);
    expect(weightOf(s, { ...line, weight_pct: 150 })).toBe(150);
  });
});
