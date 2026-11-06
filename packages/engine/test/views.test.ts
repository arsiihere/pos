// 03a task 16b: pause fold, pressure bands, capacityForLanes, READY / hold at pass, the views (stationView, stationPlan,
// stationsLive, groupReadiness), pullEarly, lateStartShift. Every view is pure in (state, now): inputs are deep-frozen.
import { parseEvent, type EngineConfig, type ItemAddedPayload, type PosEvent } from '@pos/events';
import { aFireDispatched, anEngineConfigApplied, anItemAdded, anItemStarted, anOrderBatch, aReturnLinesAdded } from '@pos/events/testing';
import { DomainError } from '@pos/domain';
import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  buildEngineState,
  capacityForLanes,
  checkOrderable,
  getTickIntents,
  groupReadiness,
  initialEngineState,
  lateStartShift,
  liveInterval,
  planOrder,
  pressureBand,
  pullEarly,
  stationPlan,
  stationPressure,
  stationsLive,
  stationView,
  type EngineState,
  type PlanResult,
  type ProposedOrder,
} from '../src/index';
import { liveProfile } from '../src/live';

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

let seq = 1;
const nextSeq = (n = 0): number => {
  const s = seq;
  seq += n + 1;
  return s;
};

type Item = { id: string; station?: string; cook: number; prep?: number; units?: number; mode?: 'sync' | 'immediate'; early?: number; program?: string };
type OrderOpts = { pickup?: number };

function itemFields(i: Item): Record<string, unknown> {
  return i.program === undefined
    ? { station_id: i.station ?? 'S1', cook_time_ms: i.cook, prep_buffer_ms: i.prep ?? 0, serve_mode: i.mode ?? 'sync', quantity: i.units ?? 1 }
    : { station_id: i.station ?? 'F', program_id: i.program, program_cook_time_ms: i.cook, cook_time_ms: 999_999, prep_buffer_ms: i.prep ?? 0, serve_mode: i.mode ?? 'sync', quantity: i.units ?? 1 };
}

function proposed(order_id: string, items: Item[], o: OrderOpts = {}): ProposedOrder {
  const base = anItemAdded().payload as unknown as ItemAddedPayload;
  return deepFreeze({
    order_id,
    order: { order_type: o.pickup === undefined ? 'dine_in' : 'delivery', table_id: null, table_key: `t:${order_id}`, follow_up: false, pickup_at_ms: o.pickup ?? null },
    lines: items.map((i) => ({
      ...base,
      order_id,
      order_item_id: i.id,
      ...(itemFields(i) as Partial<ItemAddedPayload>),
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

function stamp(event: PosEvent, t: number): PosEvent {
  const s = nextSeq();
  return { ...event, recorded_at: t, occurred_at: t, seq: s, event_id: `01JE${String(s).padStart(22, '0')}` };
}

const orderEv = (event_type: string, order_id: string, payload: Record<string, unknown>, t: number): PosEvent => stamp({ ...anItemStarted(), event_type, stream_id: order_id, payload }, t);
const stationEv = (event_type: string, station_id: string, payload: Record<string, unknown>, t: number): PosEvent =>
  stamp({ ...anItemStarted(), stream_type: 'station', stream_id: station_id, event_type, payload: { station_id, ...payload } }, t);
const startEv = (order_id: string, id: string, t: number): PosEvent => orderEv('ItemStarted', order_id, { order_item_id: id, started_at: t, source: 'tap' }, t);
const doneEv = (order_id: string, id: string, t: number): PosEvent => orderEv('ItemDone', order_id, { order_item_id: id, done_at: t, source: 'tap' }, t);
const servedEv = (order_id: string, id: string, t: number): PosEvent => orderEv('ItemServed', order_id, { order_item_ids: [id], source: 'tap' }, t);
const fireEv = (station_id: string, ids: string | string[], t: number, reason: 'scheduled' | 'pulled' = 'scheduled'): PosEvent =>
  stamp(aFireDispatched({ stream_id: station_id, payload: { station_id, order_item_ids: Array.isArray(ids) ? ids : [ids], load_id: null, due_at: t, reason } }), t);
const pauseEv = (station_id: string, paused: boolean, t: number): PosEvent => stationEv('StationPauseSet', station_id, { paused }, t);

// A draft as the host folds it (recorded_at = t).
function fromDraft(d: { stream_type: PosEvent['stream_type']; stream_id: string; event_type: string; schema_version: number; payload: unknown }, t: number): PosEvent {
  return stamp({ ...anItemStarted(), stream_type: d.stream_type, stream_id: d.stream_id, event_type: d.event_type, schema_version: d.schema_version, payload: d.payload as Record<string, unknown> }, t);
}

class Kitchen {
  log: PosEvent[] = [];
  state: EngineState = deepFreeze(initialEngineState());
  constructor(stations: Array<Partial<StationCfg>>, settings: Partial<Settings> = {}) {
    const t = T0 - 3_600_000;
    this.apply([
      anEngineConfigApplied({
        recorded_at: t,
        occurred_at: t,
        seq: nextSeq(),
        payload: { stations: stations.map((s) => ({ ...BASE.stations[0]!, name: s.station_id ?? 'S1', ...s })), settings: { ...BASE.settings, ...settings } },
      }),
    ]);
  }
  apply(events: PosEvent[]): EngineState {
    for (const e of events) {
      this.log.push(e);
      this.state = deepFreeze(applyEvent(this.state, deepFreeze(e)));
    }
    return this.state;
  }
  submit(order_id: string, items: Item[], now: number, o: OrderOpts = {}): PlanResult {
    const proposal = proposed(order_id, items, o);
    const plan = planOrder(this.state, proposal, now, {});
    this.apply(this.batch(order_id, items, now, plan, o, proposal));
    return plan;
  }
  batch(order_id: string, items: Item[], now: number, plan: PlanResult, o: OrderOpts, proposal: ProposedOrder): PosEvent[] {
    return anOrderBatch({
      order_id,
      recorded_at: now,
      seq: nextSeq(items.length),
      lines: items.map((i) => {
        const r = plan.lines.find((l) => l.order_item_id === i.id)!;
        const p = proposal.lines.find((l) => l.order_item_id === i.id)!;
        return { order_item_id: i.id, item: itemFields(i), line: { station_id: r.station_id, alternates: r.alternates, carry_ms: r.carry_ms, max_early_ms: p.max_early_ms, max_late_ms: p.max_late_ms, max_carry_ms: p.max_carry_ms } };
      }),
      order: { order_type: o.pickup === undefined ? 'dine_in' : 'delivery', table_id: null, table_key: `t:${order_id}`, pickup_at_ms: o.pickup ?? null, follow_up: false, groups: plan.groups },
    });
  }
}

const SLOT = (capacity: number, o: Partial<StationCfg> = {}): Partial<StationCfg> => ({ station_id: 'S1', capacity, ...o });
const FRYER = (o: Partial<StationCfg> = {}): Partial<StationCfg> => ({
  station_id: 'F',
  station_type: 'batch',
  capacity: 4,
  freshness_window_ms: 60_000,
  programs: [
    { program_id: 'P1', name: 'P1', cook_time_ms: 999_999, is_archived: false },
    { program_id: 'P2', name: 'P2', cook_time_ms: 999_999, is_archived: false },
  ],
  ...o,
});

const strip = (s: EngineState): EngineState => ({ ...s, diagnostics: [] });
const ids = (lines: ReadonlyArray<{ order_item_id: string }>): string[] => lines.map((l) => l.order_item_id);
const maxUnits = (s: EngineState, sid: string, t: number): number => Math.max(0, ...liveProfile(s, sid, t).u);

describe('@pos/engine capacityForLanes (§3.10, §6.1m)', () => {
  it('[03a #46] lane_units set: lanes_on × lane_units clamped to [1, capacity]', () => {
    const st = deepFreeze({ capacity: 30, lane_units: 10 });
    expect(capacityForLanes(st, 2, 3)).toBe(20);
    expect(capacityForLanes(st, 3, 3)).toBe(30);
    expect(capacityForLanes(st, 5, 3)).toBe(30); // never above capacity
  });

  it('[03a #46] lane_units null: floor(capacity ÷ lane_count), same clamp, integers only', () => {
    const st = deepFreeze({ capacity: 10, lane_units: null });
    expect(capacityForLanes(st, 1, 3)).toBe(3);
    expect(capacityForLanes(st, 2, 3)).toBe(6);
    expect(capacityForLanes(st, 3, 3)).toBe(9); // integers: the remainder unit stays off
  });

  it('[03a #46] lane_count = 1: lanes_on × capacity, clamped', () => {
    const st = deepFreeze({ capacity: 8, lane_units: null });
    expect(capacityForLanes(st, 1, 1)).toBe(8);
    expect(capacityForLanes(st, 2, 1)).toBe(8);
  });

  it('[03a #46] never below 1: every lane off', () => {
    expect(capacityForLanes({ capacity: 30, lane_units: 10 }, 0, 3)).toBe(1);
    expect(capacityForLanes({ capacity: 30, lane_units: null }, 0, 3)).toBe(1);
  });

  it('[03a #46] [03a #108] lane_units null and lane_count > capacity: lane_units never 0, ≥ 1 per lane on', () => {
    const st = deepFreeze({ capacity: 2, lane_units: null });
    expect(capacityForLanes(st, 1, 5)).toBe(1); // floor(2 ÷ 5) = 0 would give 0 units for every lane on
    expect(capacityForLanes(st, 2, 5)).toBe(2);
    expect(capacityForLanes(st, 5, 5)).toBe(2); // and never above capacity
  });
});

describe('@pos/engine pause (§3.10, D21)', () => {
  it('[03a #47] pause: checkOrderable refuses STATION_PAUSED { station_id }; unpause allows; open lines continue', () => {
    const k = new Kitchen([SLOT(1, { pause_enabled: true })]);
    k.submit('O1', [{ id: 'A', cook: 5 * M }], T0);
    k.submit('O2', [{ id: 'B', cook: 5 * M }], T0);
    k.apply([fireEv('S1', 'A', T0), startEv('O1', 'A', T0)]);
    const before = k.state;
    const paused = k.apply([pauseEv('S1', true, at(1))]);
    expect(paused.stations.S1!.paused).toBe(true);

    const p = proposed('O3', [{ id: 'C', cook: M }]);
    expect(() => checkOrderable(before, p)).not.toThrow();
    let thrown: unknown;
    try {
      checkOrderable(paused, p);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown).toMatchObject({ code: 'STATION_PAUSED', details: { station_id: 'S1' } });

    // Open lines continue: nothing re-planned, the tick fires B, the chef's taps fold.
    expect(paused.lines.A).toEqual(before.lines.A);
    expect(paused.lines.B).toEqual(before.lines.B);
    expect(paused.stations.S1!.profile).toEqual(before.stations.S1!.profile);
    expect(paused.stations.S1!.unfired).toEqual(before.stations.S1!.unfired);
    const fires = getTickIntents(paused, at(5)).filter((d) => d.event_type === 'FireDispatched');
    expect(fires.flatMap((d) => (d.payload as { order_item_ids: string[] }).order_item_ids)).toEqual(['B']);
    const done = k.apply([doneEv('O1', 'A', at(5))]);
    expect(done.lines.A!.stage).toBe('done');

    const open = k.apply([pauseEv('S1', false, at(6))]);
    expect(open.stations.S1!.paused).toBe(false);
    expect(() => checkOrderable(open, p)).not.toThrow();
    expect(strip(buildEngineState(k.log))).toEqual(strip(k.state));
  });

  it('[03a #47] StationPauseSet for an absent station or with the same value returns state itself', () => {
    const k = new Kitchen([SLOT(1)]);
    expect(applyEvent(k.state, deepFreeze(pauseEv('NOPE', true, T0)))).toBe(k.state);
    expect(applyEvent(k.state, deepFreeze(pauseEv('S1', false, T0)))).toBe(k.state);
  });
});

describe('@pos/engine pressure bands (§3.10, D20)', () => {
  const bands = { pressure_amber_bp: 8_000, pressure_red_bp: 10_000 };

  it('[03a #48] green < amber ≤ amber band ≤ red < red', () => {
    expect(pressureBand(7_999, bands)).toBe('green');
    expect(pressureBand(8_000, bands)).toBe('amber');
    expect(pressureBand(10_000, bands)).toBe('amber');
    expect(pressureBand(10_001, bands)).toBe('red');
  });

  it('[03a #48] bands from the profile with the §5.2a defaults 900 000 / 8 000 / 10 000, pure in (state, now)', () => {
    expect(BASE.stations[0]).toMatchObject({ pressure_window_ms: 900_000, pressure_amber_bp: 8_000, pressure_red_bp: 10_000, pressure_alert_ms: 300_000, pause_enabled: false, lane_units: null });
    const band = (s: EngineState, t: number): string => stationsLive(s, t).stations[0]!.band;
    const of = (cook: number): EngineState => {
      const k = new Kitchen([SLOT(1)]);
      k.submit('O1', [{ id: 'A', cook }], T0);
      return k.state;
    };
    const justUnder = of(720_000 - 1);
    expect(stationPressure(justUnder, 'S1', T0)).toBe(7_999);
    expect(band(justUnder, T0)).toBe('green');
    const amber = of(720_000);
    expect(stationPressure(amber, 'S1', T0)).toBe(8_000);
    expect(band(amber, T0)).toBe('amber');
    // Same state, later now: less of the window is booked. No clock, no stored value.
    expect(stationPressure(amber, 'S1', at(6))).toBe(4_000);
    expect(band(amber, at(6))).toBe('green');
    expect(stationPressure(amber, 'S1', T0)).toBe(8_000);
    expect(band(of(900_000), T0)).toBe('amber'); // exactly the red bp is still amber

    // Red: two COOKING units on a station lowered to one, the §6.5 "more than the window holds" case.
    const k = new Kitchen([SLOT(2)]);
    k.submit('O1', [{ id: 'A', cook: 15 * M }], T0);
    k.submit('O2', [{ id: 'B', cook: 15 * M }], T0);
    k.apply([fireEv('S1', ['A'], T0), fireEv('S1', ['B'], T0), startEv('O1', 'A', T0), startEv('O2', 'B', T0)]);
    k.apply([stationEv('StationCapacitySet', 'S1', { capacity_override: 1, previous: null, reason: 'manager' }, T0)]);
    expect(stationPressure(k.state, 'S1', T0)).toBe(20_000);
    expect(band(k.state, T0)).toBe('red');
  });

  it('[03a #48] task 13 note: a batch load counts as time occupancy, whole station: a load with room reads as full', () => {
    const k = new Kitchen([FRYER()]);
    k.submit('O1', [{ id: 'A', program: 'P1', cook: 12 * M }], T0);
    expect(k.state.stations.F!.loads[k.state.lines.A!.load_id!]!.order_item_ids).toEqual(['A']); // one unit of four
    expect(stationPressure(k.state, 'F', T0)).toBe(8_000);
    expect(stationsLive(k.state, T0).stations[0]!.band).toBe('amber');
  });
});

describe('@pos/engine READY and hold at pass (§3.4, §3 #9, §6.1i)', () => {
  it('[03a #50] READY = every sync line done; hold for a done line with an undone sibling, immediate lines never held', () => {
    const k = new Kitchen([SLOT(4)]);
    k.submit('O1', [{ id: 'A', cook: 5 * M }, { id: 'B', cook: 10 * M }, { id: 'I', cook: M, mode: 'immediate' }], T0);
    const group = (s: EngineState) => {
      const g = groupReadiness(s, 'O1');
      return g.filter((x) => x.done.length + x.waiting.length > 0);
    };
    expect(group(k.state)).toEqual([{ group_id: expect.any(String), done: [], waiting: ['A', 'B'], hold: false }]);

    // The immediate line done: it holds nothing and no group waits on it.
    k.apply([fireEv('S1', 'I', T0), startEv('O1', 'I', T0), doneEv('O1', 'I', at(1))]);
    expect(group(k.state)).toEqual([{ group_id: expect.any(String), done: [], waiting: ['A', 'B'], hold: false }]);

    const held = k.apply([fireEv('S1', ['A', 'B'], at(5)), startEv('O1', 'A', at(5)), startEv('O1', 'B', at(5)), doneEv('O1', 'A', at(10))]);
    expect(group(held)).toEqual([{ group_id: expect.any(String), done: ['A'], waiting: ['B'], hold: true }]);

    // Undo returns it to waiting.
    const undone = applyEvent(held, deepFreeze(orderEv('ItemDoneUndone', 'O1', { order_item_id: 'A' }, at(10))));
    expect(group(undone)).toEqual([{ group_id: expect.any(String), done: [], waiting: ['A', 'B'], hold: false }]);

    // Last sync line done: READY, no hold; served is "or later".
    const ready = k.apply([doneEv('O1', 'B', at(15))]);
    expect(group(ready)).toEqual([{ group_id: expect.any(String), done: ['A', 'B'], waiting: [], hold: false }]);
    expect(groupReadiness(ready, 'O1').every((g) => g.waiting.length === 0)).toBe(true);
    const served = k.apply([servedEv('O1', 'A', at(16))]);
    expect(group(served)).toEqual([{ group_id: expect.any(String), done: ['A', 'B'], waiting: [], hold: false }]);
  });

  it('[03a #50] a void clears the wait; a served line with an undone sibling holds nothing; it is only a hint', () => {
    const k = new Kitchen([SLOT(4)]);
    k.submit('O1', [{ id: 'A', cook: 5 * M }, { id: 'B', cook: 10 * M }, { id: 'C', cook: 10 * M }], T0);
    k.apply([fireEv('S1', ['A', 'B', 'C'], T0), startEv('O1', 'A', T0), doneEv('O1', 'A', at(5))]);
    expect(groupReadiness(k.state, 'O1')[0]).toMatchObject({ done: ['A'], waiting: ['B', 'C'], hold: true });
    k.apply([servedEv('O1', 'A', at(6))]); // HOLD never blocks a serve (§3.4 v0.3)
    expect(k.state.lines.A!.stage).toBe('served');
    expect(groupReadiness(k.state, 'O1')[0]).toMatchObject({ done: ['A'], waiting: ['B', 'C'], hold: false });
    k.apply([startEv('O1', 'B', at(6)), doneEv('O1', 'B', at(16))]);
    expect(groupReadiness(k.state, 'O1')[0]).toMatchObject({ done: ['A', 'B'], waiting: ['C'], hold: true });
    k.apply([orderEv('ItemVoided', 'O1', { order_item_id: 'C', reason: 'x' }, at(17))]);
    expect(groupReadiness(k.state, 'O1')[0]).toMatchObject({ done: ['A', 'B'], waiting: [], hold: false });
  });

  it('[03a §6.1i] an absent order has none; an order out of the engine at now has none (the predicate, not the row)', () => {
    const k = new Kitchen([SLOT(1)], { order_abandon_ms: 3_600_000 });
    expect(groupReadiness(k.state, 'NOPE')).toEqual([]);
    k.submit('O1', [{ id: 'A', cook: 5 * M }], T0);
    k.apply([fireEv('S1', 'A', T0)]);
    expect(groupReadiness(k.state, 'O1', T0)[0]).toMatchObject({ waiting: ['A'] });
    expect(k.state.orders.O1).toBeDefined();
    expect(groupReadiness(k.state, 'O1', at(61))).toEqual([]);
  });
});

describe('@pos/engine stationView / stationPlan (§6.1h, §3.6.3, D16, D17)', () => {
  // Capacity 2, freeze 2 min: A COOKING, B fired; C, D booked at 12:10; E, F at 12:15.
  function floor(): Kitchen {
    const k = new Kitchen([SLOT(2)]);
    k.submit('O1', [{ id: 'A', cook: 10 * M }], T0);
    k.submit('O2', [{ id: 'B', cook: 10 * M }], T0);
    k.submit('O3', [{ id: 'D', cook: 5 * M }], T0);
    k.submit('O4', [{ id: 'C', cook: 5 * M }], T0);
    k.submit('O5', [{ id: 'F', cook: 5 * M }], T0);
    k.submit('O6', [{ id: 'E', cook: 5 * M }], T0);
    k.apply([fireEv('S1', ['A', 'B'], T0), startEv('O1', 'A', T0)]);
    return k;
  }

  it('[03a §6.1h] Now = fired, Next = frozen in fire order, Later = count; time moves lines into Next; Done removes', () => {
    const k = floor();
    expect(k.state.lines.C!.fire_ms).toBe(at(10));
    const early = stationView(k.state, 'S1', T0);
    expect(ids(early.now)).toEqual(['A', 'B']);
    expect(ids(early.next)).toEqual([]);
    expect(early.later_count).toBe(4);
    const later = stationView(k.state, 'S1', at(8));
    expect(ids(later.now)).toEqual(['A', 'B']);
    expect(ids(later.next)).toEqual(['C', 'D']); // at(8) + 2 min = their fire; tie by id
    expect(later.later_count).toBe(2);
    expect(stationView(k.state, 'S1', at(8) - 1).later_count).toBe(4);
    const all = stationView(k.state, 'S1', at(13));
    expect(ids(all.next)).toEqual(['C', 'D', 'E', 'F']);
    expect(all.later_count).toBe(0);

    // Now reads the in-flight lines through liveInterval: A COOKING, B packed beside it.
    expect(later.now.find((l) => l.order_item_id === 'A')).toMatchObject({ stage: 'cooking', live: liveInterval(k.state, 'A', at(8)) });
    expect(later.now.find((l) => l.order_item_id === 'B')).toMatchObject({ stage: 'added', live: liveInterval(k.state, 'B', at(8)) });
    expect(later.next[0]).toMatchObject({ order_id: 'O4', fire_ms: at(10), mark: null, live: { start: at(10), end: at(15) } });

    const s = k.apply([doneEv('O1', 'A', at(9))]);
    expect(ids(stationView(s, 'S1', at(9)).now)).toEqual(['B']);
    expect(stationView(s, 'NOPE', T0)).toEqual({ now: [], next: [], later_count: 0 });
  });

  it('[03a §6.1h] stationPlan lists every unfired line with frozen, in fire order, in the §3.6.3 shape (minus as_of_seq)', () => {
    const k = floor();
    const plan = stationPlan(k.state, 'S1', at(8));
    expect(plan.station_id).toBe('S1');
    expect(Object.keys(plan).sort()).toEqual(['lines', 'station_id']);
    expect(ids(plan.lines)).toEqual(['C', 'D', 'E', 'F']);
    expect(plan.lines.map((l) => l.frozen)).toEqual([true, true, false, false]);
    expect(plan.lines[0]).toEqual({ order_item_id: 'C', order_id: 'O4', fire_ms: at(10), deadline_ms: k.state.lines.C!.deadline_ms, mark: null, frozen: true });
    expect(stationPlan(k.state, 'NOPE', T0)).toEqual({ station_id: 'NOPE', lines: [] });
    // Same reading as the view.
    const view = stationView(k.state, 'S1', at(8));
    expect(plan.lines.filter((l) => l.frozen).map((l) => l.order_item_id)).toEqual(ids(view.next));
    expect(plan.lines.filter((l) => !l.frozen)).toHaveLength(view.later_count);
  });

  it('[03a §3.6.3] task 1b: every listed line has a number fire_ms, moved and boosted lines included', () => {
    const k = floor();
    k.apply([stationEv('StationCapacitySet', 'S1', { capacity_override: 1, previous: null, reason: 'manager' }, at(9))]);
    k.apply([orderEv('OrderBoosted', 'O6', { order_id: 'O6' }, at(9))]);
    const plan = stationPlan(k.state, 'S1', at(9));
    expect(plan.lines.length).toBeGreaterThan(0);
    for (const l of plan.lines) expect(typeof l.fire_ms).toBe('number');
    expect(plan.lines.map((l) => l.mark)).toContain('boost');
  });

  it('[03a §3.3] [03a AD-8] a placeholder of an order still awaiting its ItemAdded is not a line in any view', () => {
    const k = new Kitchen([SLOT(1)]);
    const p = proposed('O1', [{ id: 'A', cook: 5 * M }, { id: 'B', cook: 5 * M }]);
    const plan = planOrder(k.state, p, T0, {});
    const events = k.batch('O1', [{ id: 'A', cook: 5 * M }, { id: 'B', cook: 5 * M }], T0, plan, {}, p);
    const s = k.apply(events.slice(0, 2)); // OrderPlaced and A's ItemAdded: B is still a placeholder
    expect(s.lines.B).toBeDefined();
    expect(stationPlan(s, 'S1', T0).lines).toEqual([]);
    expect(stationView(s, 'S1', T0)).toEqual({ now: [], next: [], later_count: 0 });
    expect(stationsLive(s, T0).stations[0]!.later_count).toBe(0);
    expect(groupReadiness(s, 'O1')[0]!.waiting).toEqual(['A']);
  });

  it('[03a §3.3] [03a AD-20] a line of an order out of the engine is in no view, though its row is still there', () => {
    const k = new Kitchen([SLOT(1)], { order_abandon_ms: 3_600_000 });
    k.submit('O1', [{ id: 'A', cook: 5 * M }], T0);
    k.apply([fireEv('S1', 'A', T0)]);
    expect(ids(stationView(k.state, 'S1', at(59)).now)).toEqual(['A']);
    // Abandoned at 13:00: the row is present, no listed fold has run.
    expect(k.state.orders.O1).toBeDefined();
    expect(stationView(k.state, 'S1', at(61)).now).toEqual([]);
    expect(stationPressure(k.state, 'S1', at(61))).toBe(0);
    expect(stationsLive(k.state, at(61)).stations[0]).toMatchObject({ pressure_bp: 0, wait_ms: 0 });

    // AD-20: an order kept for its live reservation through a listed fold is out as well.
    const held = deepFreeze({ ...k.state, lines: { ...k.state.lines, A: { ...k.state.lines.A!, reserved_seq: 5 } } });
    k.state = held;
    const kept = k.apply([stationEv('StationCapacitySet', 'S1', { capacity_override: 1, previous: null, reason: 'manager' }, at(61))]);
    expect(kept.orders.O1).toBeDefined();
    expect(stationView(kept, 'S1', at(61)).now).toEqual([]);
    expect(groupReadiness(kept, 'O1', at(61))).toEqual([]);
  });
});

describe('@pos/engine stationsLive (§6.5, §6.1j)', () => {
  it('[03a §6.5] the §6.5 body minus as_of_seq, exactly; wait_ms from reference_cook_ms', () => {
    const k = new Kitchen([SLOT(1, { name: 'Tandoor', reference_cook_ms: 10 * M, pause_enabled: true })]);
    k.submit('O1', [{ id: 'A', cook: 5 * M }], T0);
    k.submit('O2', [{ id: 'B', cook: 5 * M }], T0);
    k.submit('O3', [{ id: 'C', cook: 5 * M }], T0);
    const body = stationsLive(k.state, T0);
    expect(body).toEqual({
      now_ms: T0,
      stations: [
        {
          station_id: 'S1',
          name: 'Tandoor',
          capacity: 1,
          capacity_override: null,
          effective_capacity: 1,
          paused: false,
          pause_enabled: true,
          pressure_bp: 10_000,
          band: 'amber',
          later_count: 2, // A is due now (frozen); B and C hidden
          wait_ms: 15 * M, // the first free stretch of 10 min starts at 12:15
        },
      ],
    });
    expect(Object.keys(body).sort()).toEqual(['now_ms', 'stations']);
    expect(stationsLive(k.state, T0)).toEqual(body);
  });

  it('[03a §6.5] wait_ms sees the in-flight lines (a fired line slides), and a gap too short for the reference cook is not a start', () => {
    const k = new Kitchen([SLOT(1, { reference_cook_ms: 5 * M })]);
    k.submit('O1', [{ id: 'A', cook: 5 * M }], T0);
    k.apply([fireEv('S1', 'A', T0)]);
    expect(stationsLive(k.state, at(3)).stations[0]!.wait_ms).toBe(5 * M); // packed [12:03, 12:08)
    k.apply([startEv('O1', 'A', T0)]);
    expect(stationsLive(k.state, at(3)).stations[0]!.wait_ms).toBe(2 * M); // COOKING until 12:05
    // A planned line at 12:08: the 3 min gap from 12:05 does not hold a 5 min cook, so the wait runs to 12:13.
    k.submit('O2', [{ id: 'B', cook: 5 * M }], at(3), { pickup: at(13) });
    expect(k.state.lines.B!.booked).toMatchObject({ start: at(8), end: at(13) });
    expect(stationsLive(k.state, at(3)).stations[0]!.wait_ms).toBe(10 * M);
    // reference_cook_ms 0 (no routed items): nothing has to fit.
    const z = new Kitchen([SLOT(1, { reference_cook_ms: 0 })]);
    z.submit('O1', [{ id: 'A', cook: 5 * M }], T0);
    expect(stationsLive(z.state, T0).stations[0]!.wait_ms).toBe(0);
  });

  it('[03a §6.5] station_ids filters, unknown ids are left out, archived stations too; sorted by id; effective capacity and pause read live', () => {
    const k = new Kitchen([
      { station_id: 'S1', capacity: 3 },
      { station_id: 'S2', capacity: 5, pause_enabled: true },
      { station_id: 'S3', capacity: 5, is_archived: true },
    ]);
    expect(stationsLive(k.state, T0).stations.map((s) => s.station_id)).toEqual(['S1', 'S2']);
    expect(stationsLive(k.state, T0, ['S2', 'NOPE', 'S3', 'S1']).stations.map((s) => s.station_id)).toEqual(['S1', 'S2']);
    expect(stationsLive(k.state, T0, []).stations).toEqual([]);
    const s = k.apply([stationEv('StationCapacitySet', 'S2', { capacity_override: 2, previous: null, reason: 'manager' }, T0), pauseEv('S2', true, T0)]);
    expect(stationsLive(s, T0, ['S2']).stations[0]).toMatchObject({ capacity: 5, capacity_override: 2, effective_capacity: 2, paused: true, pause_enabled: true });
  });
});

describe('@pos/engine pullEarly (§6.1k, D16 Give me more)', () => {
  // A held delivery: d is its slot's latest fire, far ahead.
  function held(early: number): Kitchen {
    const k = new Kitchen([SLOT(1)]);
    k.submit('O1', [{ id: 'A', cook: 5 * M, early }], T0, { pickup: at(30) });
    k.submit('O2', [{ id: 'B', cook: 5 * M, early }], T0, { pickup: at(40) });
    return k;
  }

  it('[03a #33] respects max_early_ms exactly; reason pulled; the fold marks it, fires it from now (AD-9), frees its booking', () => {
    const k = held(5 * M);
    const a = k.state.lines.A!;
    expect(a.deadline_ms).toBe(at(25));
    expect(a.fire_ms).toBeGreaterThan(at(20));
    expect(pullEarly(k.state, 'S1', 1, at(20) - 1)).toBeNull();
    const draft = pullEarly(k.state, 'S1', 1, at(20));
    expect(draft).toEqual({
      stream_type: 'station',
      stream_id: 'S1',
      event_type: 'FireDispatched',
      schema_version: 1,
      payload: { station_id: 'S1', order_item_ids: ['A'], load_id: null, due_at: a.fire_ms, reason: 'pulled' },
    });
    const s = k.apply([fromDraft(draft!, at(20))]);
    expect(s.lines.A).toMatchObject({ fired_at: at(20), fire_ms: at(20), mark: 'pulled', booked: null });
    expect(ids(stationView(s, 'S1', at(20)).now)).toEqual(['A']);
    expect(liveInterval(s, 'A', at(20))).toEqual({ start: at(20), end: at(25) });
    expect(strip(buildEngineState(k.log))).toEqual(strip(s));
  });

  it('[03a #33] max_early_ms 0: never pulled before its fire; a due line is the tick\'s, not a pull', () => {
    const k = held(0);
    const a = k.state.lines.A!;
    expect(pullEarly(k.state, 'S1', 1, a.deadline_ms - 1)).toBeNull();
    expect(pullEarly(k.state, 'S1', 1, a.fire_ms!)).toBeNull(); // due: getTickIntents fires it
    expect(getTickIntents(k.state, a.fire_ms!).map((d) => d.event_type)).toContain('FireDispatched');
  });

  it('[03a #33] the next n in fire order; only eligible lines; n < 1, an unknown or an idle station give null', () => {
    const k = held(15 * M);
    const n = pullEarly(k.state, 'S1', 5, at(21));
    expect(n!.payload.order_item_ids).toEqual(['A', 'B']);
    expect(n!.payload.due_at).toBe(k.state.lines.A!.fire_ms); // the earliest planned fire
    expect(pullEarly(k.state, 'S1', 1, at(21))!.payload.order_item_ids).toEqual(['A']);
    // At 12:12 only A is eligible (B's d − max_early = 12:20).
    expect(pullEarly(k.state, 'S1', 5, at(12))!.payload.order_item_ids).toEqual(['A']);
    expect(pullEarly(k.state, 'S1', 0, at(21))).toBeNull();
    expect(pullEarly(k.state, 'NOPE', 1, at(21))).toBeNull();
    expect(pullEarly(new Kitchen([SLOT(1)]).state, 'S1', 1, at(21))).toBeNull();
  });

  it('[03a §6.1k] a busy station may still pull: the ticket goes on Now and packs behind what is in flight, no instant over capacity', () => {
    const k = new Kitchen([SLOT(1)]);
    k.submit('O0', [{ id: 'CK', cook: 10 * M }], T0);
    k.apply([fireEv('S1', 'CK', T0), startEv('O0', 'CK', T0)]);
    k.submit('O1', [{ id: 'A', cook: 5 * M, early: 5 * M }], T0, { pickup: at(15) }); // [12:10, 12:15)
    expect(k.state.lines.A!.booked).toMatchObject({ start: at(10), end: at(15) });
    const draft = pullEarly(k.state, 'S1', 1, at(6));
    expect(draft!.payload.order_item_ids).toEqual(['A']);
    const s = k.apply([fromDraft(draft!, at(6))]);
    expect(liveInterval(s, 'A', at(6))).toEqual({ start: at(10), end: at(15) });
    expect(maxUnits(s, 'S1', at(6))).toBe(1);
  });

  it('[03a §6.1k] a line whose pulled interval would run over another line\'s booking is passed over (D15: nothing inserted before a frozen line)', () => {
    const k = new Kitchen([SLOT(1)]);
    k.submit('O1', [{ id: 'A', cook: 2 * M, early: 0 }], T0, { pickup: at(10) }); // A on [12:08, 12:10), not eligible
    k.submit('O2', [{ id: 'B', cook: 8 * M, early: 30 * M }], T0, { pickup: at(20) }); // B on [12:12, 12:20)
    const before = k.state;
    expect(before.lines.A!.booked).toMatchObject({ start: at(8), end: at(10) });
    expect(before.lines.B!.booked).toMatchObject({ start: at(12), end: at(20) });
    expect(pullEarly(before, 'S1', 1, at(1))).toBeNull(); // B from 12:01 would run through A's 12:08
    expect(pullEarly(before, 'S1', 1, at(11))).not.toBeNull(); // from 12:11, nothing in the way
  });

  it('[03a §6.1k] a mark pulled never overwrites return; a re-listed fired line is left as it is', () => {
    const k = new Kitchen([SLOT(1)], { returns_boost: false });
    k.submit('OS', [{ id: 'L1', cook: 5 * M }], T0);
    k.apply([fireEv('S1', 'L1', T0), startEv('OS', 'L1', T0), doneEv('OS', 'L1', at(5)), servedEv('OS', 'L1', at(6))]);
    k.apply(aReturnLinesAdded(k.log.find((e) => e.event_type === 'ItemAdded')!, 'fix', { recorded_at: at(10), target_land_ms: at(13), order_item_id: 'LR', adjust_time_ms: 3 * M }));
    expect(k.state.lines.LR!.mark).toBe('return');
    const s = k.apply([fireEv('S1', 'LR', at(10), 'pulled')]);
    expect(s.lines.LR).toMatchObject({ mark: 'return', fired_at: at(10) });
    // A scheduled fire writes no mark.
    const j = new Kitchen([SLOT(1)]);
    j.submit('O1', [{ id: 'A', cook: M }], T0);
    expect(j.apply([fireEv('S1', 'A', T0)]).lines.A!.mark).toBeNull();
  });

  describe('on a batch station', () => {
    function loads(earlyB = 15 * M): Kitchen {
      const k = new Kitchen([FRYER()]);
      k.submit('O1', [{ id: 'A', program: 'P1', cook: 5 * M, early: 15 * M }], T0, { pickup: at(30) });
      k.submit('O2', [{ id: 'B', program: 'P1', cook: 5 * M, early: earlyB }], T0, { pickup: at(30) });
      k.submit('O3', [{ id: 'C', program: 'P2', cook: 5 * M, early: 40 * M }], T0, { pickup: at(50) }); // eligible too
      return k;
    }

    it('[03a §6.1k] pulls a whole load, never part of one, one load per draft; the fold fires every member', () => {
      const k = loads();
      const load = k.state.lines.A!.load_id!;
      expect(k.state.lines.B!.load_id).toBe(load);
      const draft = pullEarly(k.state, 'F', 1, at(12));
      expect(draft!.payload).toEqual({ station_id: 'F', order_item_ids: ['A', 'B'], load_id: load, due_at: k.state.stations.F!.loads[load]!.fire_ms, reason: 'pulled' });
      // n = 5 with C's load eligible as well: one event names one load, the earlier one.
      expect(pullEarly(k.state, 'F', 5, at(12))).toEqual(draft);
      const s = k.apply([fromDraft(draft!, at(12))]);
      expect(s.lines.A).toMatchObject({ fired_at: at(12), mark: 'pulled', load_id: load });
      expect(s.lines.B).toMatchObject({ fired_at: at(12), mark: 'pulled', load_id: load });
      expect(s.stations.F!.loads[load]).toBeUndefined();
      expect(liveInterval(s, 'A', at(12))).toEqual({ start: at(12), end: at(17) });
      expect(maxUnits(s, 'F', at(12))).toBe(4);
      expect(strip(buildEngineState(k.log))).toEqual(strip(s));
    });

    it('[03a §6.1k] max_early_ms holds for every member: the tightest member decides', () => {
      const k = loads(2 * M);
      const d = k.state.lines.B!.deadline_ms;
      // A may, B may not: their load stays whole and only C's is eligible.
      expect(pullEarly(k.state, 'F', 1, at(12))!.payload.order_item_ids).toEqual(['C']);
      expect(pullEarly(k.state, 'F', 1, d - 2 * M)!.payload.order_item_ids).toEqual(['A', 'B']);
    });
  });
});

describe('@pos/engine lateStartShift (§3.3, §6.1l, F §4.7 D42)', () => {
  // Capacity 1, 5 min cooks, padding 3 min (the §5.2a default for §10 #96, #115).
  const padding = { promise_padding_dine_in_ms: 180_000 };
  const shiftOf = (id: string, by: number) => ({ order_item_id: id, by_ms: by });

  it('[03a #96 shift] one fired line: A starts at 12:08, B moves by the delay to [12:13, 12:18) and its promise holds; no instant has 2 units', () => {
    const k = new Kitchen([SLOT(1)], padding);
    k.submit('O1', [{ id: 'A', cook: 5 * M }], at(0));
    k.apply([fireEv('S1', 'A', at(0))]);
    const plan = k.submit('O2', [{ id: 'B', cook: 5 * M }], at(6));
    expect(k.state.lines.B!.booked).toMatchObject({ start: at(11), end: at(16) });
    const before = k.state;
    const draft = lateStartShift(before, 'A', at(8));
    expect(draft).toEqual({ stream_type: 'station', stream_id: 'S1', event_type: 'ReservationsShifted', schema_version: 1, payload: { station_id: 'S1', cause: 'late_start', shifts: [shiftOf('B', 2 * M)] } });
    const s = k.apply([startEv('O1', 'A', at(8)), fromDraft(draft!, at(8))]);
    expect(liveInterval(s, 'A', at(8))).toEqual({ start: at(8), end: at(13) });
    expect(liveInterval(s, 'B', at(8))).toEqual({ start: at(13), end: at(18) });
    expect(s.lines.B).toMatchObject({ fire_ms: at(13), deadline_ms: before.lines.B!.deadline_ms });
    expect(s.orders.O2).toMatchObject({ target_land_ms: at(16), promise_ms: at(19) });
    expect(at(18)).toBeLessThanOrEqual(plan.groups[0]!.promise_ms);
    expect(maxUnits(s, 'S1', at(8))).toBe(1);
    // The state after the ItemStarted fold gives the same draft.
    expect(lateStartShift(applyEvent(before, deepFreeze(startEv('O1', 'A', at(8)))), 'A', at(8))).toEqual(draft);
    expect(strip(buildEngineState(k.log))).toEqual(strip(s));
  });

  it('[03a #96 shift] prep > 0 variant: a Start at the packed Start moves nothing; 12:08 moves B to [12:17, 12:22), the promise holds', () => {
    const run = (): { k: Kitchen; plan: PlanResult } => {
      const k = new Kitchen([SLOT(1)], padding);
      k.submit('O1', [{ id: 'A', cook: 5 * M, prep: 4 * M }], at(0));
      k.apply([fireEv('S1', 'A', at(0))]);
      const plan = k.submit('O2', [{ id: 'B', cook: 5 * M }], at(6));
      expect(k.state.lines.B!.booked).toMatchObject({ start: at(15), end: at(20) });
      return { k, plan };
    };
    expect(lateStartShift(run().k.state, 'A', at(6))).toBeNull();
    const { k, plan } = run();
    const draft = lateStartShift(k.state, 'A', at(8));
    expect(draft!.payload.shifts).toEqual([shiftOf('B', 2 * M)]);
    const s = k.apply([startEv('O1', 'A', at(8)), fromDraft(draft!, at(8))]);
    expect(liveInterval(s, 'A', at(8))).toEqual({ start: at(12), end: at(17) });
    expect(liveInterval(s, 'B', at(8))).toEqual({ start: at(17), end: at(22) });
    expect(at(22)).toBeLessThanOrEqual(plan.groups[0]!.promise_ms);
    expect(maxUnits(s, 'S1', at(8))).toBe(1);
  });

  it('[03a #115 shift] two fired lines: A starts at 12:07; B moves by the packing, N is shifted to [12:17, 12:22) ≤ P; B is never listed', () => {
    const k = new Kitchen([SLOT(1)], padding);
    k.submit('O1', [{ id: 'A', cook: 5 * M }], at(0));
    k.apply([fireEv('S1', 'A', at(0))]);
    k.submit('O2', [{ id: 'B', cook: 5 * M }], at(0));
    k.apply([fireEv('S1', 'B', at(5))]);
    const plan = k.submit('O3', [{ id: 'N', cook: 5 * M }], at(6));
    expect(k.state.lines.N!.booked).toMatchObject({ start: at(16), end: at(21) });
    expect(plan.groups[0]).toMatchObject({ target_land_ms: at(21), promise_ms: at(24) });
    const draft = lateStartShift(k.state, 'A', at(7));
    expect(draft!.payload).toEqual({ station_id: 'S1', cause: 'late_start', shifts: [shiftOf('N', M)] });
    const s = k.apply([startEv('O1', 'A', at(7)), fromDraft(draft!, at(7))]);
    expect(liveInterval(s, 'B', at(7))).toEqual({ start: at(12), end: at(17) });
    expect(liveInterval(s, 'N', at(7))).toEqual({ start: at(17), end: at(22) });
    expect(at(22)).toBeLessThanOrEqual(plan.groups[0]!.promise_ms);
    expect(maxUnits(s, 'S1', at(7))).toBe(1);
  });

  it('[03a #115 shift] prep > 0: a Start on time never moves N; 12:07 moves it to [12:16, 12:21) ≤ P', () => {
    const run = (): { k: Kitchen; plan: PlanResult } => {
      const k = new Kitchen([SLOT(1)], padding);
      k.submit('O1', [{ id: 'A', cook: 5 * M, prep: 4 * M }], at(0));
      k.apply([fireEv('S1', 'A', at(0))]);
      const plan = k.submit('O2', [{ id: 'N', cook: 5 * M }], at(6));
      expect(plan.groups[0]).toMatchObject({ target_land_ms: at(20), promise_ms: at(23) });
      return { k, plan };
    };
    expect(lateStartShift(run().k.state, 'A', at(6))).toBeNull();
    const { k, plan } = run();
    const draft = lateStartShift(k.state, 'A', at(7));
    expect(draft!.payload.shifts).toEqual([shiftOf('N', M)]);
    const s = k.apply([startEv('O1', 'A', at(7)), fromDraft(draft!, at(7))]);
    expect(liveInterval(s, 'N', at(7))).toEqual({ start: at(16), end: at(21) });
    expect(at(21)).toBeLessThanOrEqual(plan.groups[0]!.promise_ms);
  });

  it('[03a §3.3] the shift is the delay, never a whole cook and never rounded to cascade_step_ms; the same delay passes down; a gap absorbs it', () => {
    const k = new Kitchen([SLOT(1)], { ...padding, cascade_step_ms: 60_000 });
    k.submit('O1', [{ id: 'A', cook: 5 * M }], at(0));
    k.apply([fireEv('S1', 'A', at(0))]);
    k.submit('O2', [{ id: 'B', cook: 5 * M }], at(1)); // [12:06, 12:11)
    k.submit('O3', [{ id: 'C', cook: 5 * M }], at(1)); // [12:11, 12:16)
    k.submit('O4', [{ id: 'D', cook: 5 * M }], at(1), { pickup: at(40) }); // far ahead
    expect(k.state.lines.B!.booked).toMatchObject({ start: at(6), end: at(11) });
    expect(k.state.lines.C!.booked).toMatchObject({ start: at(11), end: at(16) });
    const d = k.state.lines.D!.booked!;
    expect(d.start).toBeGreaterThan(at(20));
    const late = at(1) + 90 * S; // B was placed behind A's packed Start of 12:01: 90 s late, rounded it would be 120 s
    const draft = lateStartShift(k.state, 'A', late);
    expect(draft!.payload.shifts).toEqual([shiftOf('B', 90 * S), shiftOf('C', 90 * S)]);
    const s = k.apply([startEv('O1', 'A', late), fromDraft(draft!, late)]);
    expect(s.lines.D!.booked).toEqual(d);
    expect(maxUnits(s, 'S1', late)).toBe(1);
  });

  it('[03a §6.1l] null: absent line, ended or placeholder line, out of the engine, or a Start that collides with nothing', () => {
    const k = new Kitchen([SLOT(2)], { order_abandon_ms: 3_600_000 });
    expect(lateStartShift(k.state, 'NOPE', T0)).toBeNull();
    k.submit('O1', [{ id: 'A', cook: 5 * M }], T0);
    k.submit('O2', [{ id: 'B', cook: 5 * M }], T0);
    k.apply([fireEv('S1', 'A', T0)]);
    expect(lateStartShift(k.state, 'A', T0 + 10 * S)).toBeNull(); // the second unit is free
    expect(lateStartShift(k.state, 'A', at(61))).toBeNull(); // abandoned
    k.apply([startEv('O1', 'A', T0), doneEv('O1', 'A', at(5))]);
    expect(lateStartShift(k.state, 'A', at(5))).toBeNull();
  });

  it('[03a F D42] batch: a late Start pushes a whole later load, every member listed, by the same delay; the fold moves it once', () => {
    const k = new Kitchen([FRYER({ capacity: 4, freshness_window_ms: 0 })]);
    k.submit('O1', [{ id: 'A', program: 'P1', cook: 5 * M }], at(0));
    k.apply([fireEv('F', 'A', at(0))]);
    k.submit('O2', [{ id: 'B', program: 'P2', cook: 5 * M }], at(1));
    k.submit('O3', [{ id: 'C', program: 'P2', cook: 5 * M, mode: 'sync' }], at(1));
    const load = k.state.lines.B!.load_id!;
    const booked = k.state.stations.F!.loads[load]!.booked;
    expect(booked.start).toBe(at(6));
    const members = k.state.stations.F!.loads[load]!.order_item_ids;
    expect(members).toContain('B');
    const draft = lateStartShift(k.state, 'A', at(3));
    expect(draft!.payload.shifts).toEqual(members.map((id) => shiftOf(id, 2 * M)));
    const s = k.apply([startEv('O1', 'A', at(3)), fromDraft(draft!, at(3))]);
    expect(s.stations.F!.loads[load]!.booked).toMatchObject({ start: at(8), end: at(13) });
    expect(s.stations.F!.loads[load]!.fire_ms).toBe(at(8));
    expect(maxUnits(s, 'F', at(3))).toBe(4);
  });
});
