// 03a task 16: the two D15 exceptions. A boost (§3.9) and a capacity change (§3.10: StationCapacitySet, an
// EngineConfigApplied changing capacity, the BusinessDayOpened reset) re-place frozen lines: frozen first, each at
// earliestFit(its current fire), `mark 'moved'` when its fire changed, the late ones through §3.5.6 with the hidden
// lines; fired and COOKING lines never move. §3.8a returns_boost boosts the return line only.
import { parseEvent, type EngineConfig, type ItemAddedPayload, type PosEvent } from '@pos/events';
import { aFireDispatched, anEngineConfigApplied, anItemAdded, anItemStarted, anOrderBatch, aReturnLinesAdded } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { addInterval, applyEvent, buildEngineState, earliestFit, getAlertIntents, getTickIntents, initialEngineState, isOrderInEngine, latestFit, liveInterval, nextDueAt, planOrder, removeInterval, stationPlan, type EngineState, type PlanResult, type ProposedOrder } from '../src/index';
import { effectiveCapacity } from '../src/capacity';
import { liveProfile } from '../src/live';
import { weightOf } from '../src/replan';
import type { Profile } from '../src/state';

const T0 = 1_761_000_000_000;
const S = 1_000;
const M = 60_000;

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

function config(stations: Array<Partial<StationCfg>>, settings: Partial<Settings> = {}, recorded_at = T0 - 3_600_000, version = 1): PosEvent {
  return anEngineConfigApplied({
    recorded_at,
    occurred_at: recorded_at,
    seq: nextSeq(),
    payload: { config_version: version, stations: stations.map((s) => ({ ...BASE.stations[0]!, ...s })), settings: { ...BASE.settings, ...settings } },
  });
}

// One log per test: a fold of its events (inputs frozen) and the log kept, so rebuild = live can be asserted.
class Kitchen {
  log: PosEvent[] = [];
  state: EngineState = deepFreeze(initialEngineState());
  constructor(stations: Array<Partial<StationCfg>>, settings: Partial<Settings> = {}) {
    this.apply([config(stations, settings)]);
  }
  apply(events: PosEvent[], opts?: { strict?: boolean }): EngineState {
    for (const e of events) {
      this.log.push(e);
      this.state = deepFreeze(applyEvent(this.state, deepFreeze(e), opts));
    }
    return this.state;
  }
  submit(order_id: string, items: Item[], now: number, o: OrderOpts = {}): PlanResult {
    const plan = planOrder(this.state, proposed(order_id, items, o), now, {});
    const proposal = proposed(order_id, items, o);
    this.apply(
      anOrderBatch({
        order_id,
        recorded_at: now,
        seq: nextSeq(items.length),
        lines: items.map((i) => {
          const r = plan.lines.find((l) => l.order_item_id === i.id)!;
          const p = proposal.lines.find((l) => l.order_item_id === i.id)!;
          return {
            order_item_id: i.id,
            item: itemFields(i),
            line: { station_id: r.station_id, alternates: r.alternates, carry_ms: r.carry_ms, max_early_ms: p.max_early_ms, max_late_ms: p.max_late_ms, max_carry_ms: p.max_carry_ms },
          };
        }),
        order: {
          order_type: o.pickup === undefined ? 'dine_in' : 'delivery',
          table_id: null,
          table_key: `t:${order_id}`,
          pickup_at_ms: o.pickup ?? null,
          follow_up: false,
          groups: plan.groups,
        },
      }),
    );
    return plan;
  }
}

type Item = { id: string; station?: string; cook: number; prep?: number; units?: number; mode?: 'sync' | 'immediate'; early?: number; late?: number | null; program?: string; alternates?: Array<{ station_id: string; carry_ms: number; home: boolean }> };
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
      alternates: i.alternates ?? [],
      point_id: null,
      carry_ms: 0,
      weight_pct: 100,
      max_early_ms: i.early ?? 60_000,
      max_late_ms: i.late ?? null,
      max_carry_ms: null,
      cook_ms_override: null,
      return_of: null,
    })),
  });
}

function stamp(event: PosEvent, t: number): PosEvent {
  const s = nextSeq();
  return { ...event, recorded_at: t, occurred_at: t, seq: s, event_id: `01JD${String(s).padStart(22, '0')}` };
}
const orderEv = (event_type: string, order_id: string, payload: Record<string, unknown>, t: number): PosEvent =>
  stamp({ ...anItemStarted(), event_type, stream_id: order_id, payload }, t);
const boost = (order_id: string, t: number): PosEvent => orderEv('OrderBoosted', order_id, { order_id }, t);
const startEv = (order_id: string, id: string, t: number): PosEvent => orderEv('ItemStarted', order_id, { order_item_id: id, started_at: t, source: 'tap' }, t);
const fireEv = (station_id: string, id: string, t: number): PosEvent =>
  stamp(aFireDispatched({ stream_id: station_id, payload: { station_id, order_item_ids: [id], load_id: null, due_at: t, reason: 'scheduled' } }), t);
const capacity = (station_id: string, capacity_override: number | null, t: number, reason: 'manager' | 'lane_off' | 'lane_on' = 'manager', previous: number | null = null): PosEvent =>
  stamp({ ...anItemStarted(), stream_type: 'station', stream_id: station_id, event_type: 'StationCapacitySet', payload: { station_id, capacity_override, previous, reason } }, t);
const dayOpened = (t: number): PosEvent =>
  stamp({ ...anItemStarted(), stream_type: 'hub', stream_id: 'B1', event_type: 'BusinessDayOpened', payload: { business_date: '2026-11-07', stock_units: {}, draws: {} } }, t);

const moved = (s: EngineState): string[] =>
  Object.values(s.lines)
    .filter((l) => l.mark === 'moved')
    .map((l) => l.order_item_id)
    .sort();

// Every instant the station has a planned booking is within its effective capacity (in-flight lines are read live;
// fixed lines alone may exceed a lowered capacity, nothing else may share such an instant).
function expectNoOverbooking(s: EngineState, t: number, only?: ReadonlySet<string>): void {
  for (const station of Object.values(s.stations)) {
    if (only !== undefined && !only.has(station.station_id)) continue;
    const cap = effectiveCapacity(station);
    const live = liveProfile(s, station.station_id, t);
    for (let i = 0; i < station.profile.t.length; i++) {
      if (station.profile.u[i]! === 0) continue;
      const from = station.profile.t[i]!;
      const to = station.profile.t[i + 1]!;
      for (let j = 0; j < live.t.length; j++) {
        const a = live.t[j]!;
        const b = live.t[j + 1] ?? Number.POSITIVE_INFINITY;
        if (b <= from || a >= to) continue;
        expect(live.u[j]!, `${station.station_id} over ${cap} at ${a - T0}`).toBeLessThanOrEqual(cap);
      }
    }
  }
}

// AD-7: the stored profile is exactly the sum of the unfired bookings (each line's, each load's once).
function expectProfileExact(s: EngineState): void {
  for (const station of Object.values(s.stations)) {
    const bookings = [
      ...station.unfired.flatMap((id) => (s.lines[id]!.booked === null ? [] : [s.lines[id]!.booked!])),
      ...Object.values(station.loads).map((l) => l.booked),
    ];
    const delta = new Map<number, number>();
    for (const b of bookings) {
      delta.set(b.start, (delta.get(b.start) ?? 0) + b.units);
      delta.set(b.end, (delta.get(b.end) ?? 0) - b.units);
    }
    const out: Profile = { t: [], u: [] };
    let cur = 0;
    let prev = 0;
    for (const k of [...delta.keys()].sort((a, b) => a - b)) {
      cur += delta.get(k)!;
      if (cur === prev) continue;
      out.t.push(k);
      out.u.push(cur);
      prev = cur;
    }
    expect(station.profile, station.station_id).toEqual(out);
  }
}

const strip = (s: EngineState): EngineState => ({ ...s, diagnostics: [] });
function expectRebuild(k: Kitchen): void {
  expect(strip(buildEngineState(k.log))).toEqual(strip(k.state));
}

// A station with a late freeze window, so the fire of a delayed order is frozen at t.
const SLOT = (capacity_: number, freeze_ms = 120_000): Partial<StationCfg> => ({ station_id: 'S1', capacity: capacity_, freeze_ms });

describe('@pos/engine boost (§3.9, D4)', () => {
  it('[03a #34] boost: earliest fit; displaced lines late → slip intents; boosted promise unchanged (D4)', () => {
    const k = new Kitchen([SLOT(1)]);
    k.submit('O1', [{ id: 'A', cook: 20 * M }], T0);
    k.submit('O2', [{ id: 'B', cook: 20 * M }], T0);
    k.submit('O3', [{ id: 'C', cook: 10 * M }], T0);
    const before = k.state;
    expect(before.lines.C!.fire_ms).toBe(T0 + 40 * M);
    const s = k.apply([boost('O3', T0)]);

    // Earliest fit against the fixed lines (nothing is fired): C is first, T_b its land; the promise stays.
    expect(s.lines.C).toMatchObject({ fire_ms: T0, mark: 'boost', booked: { start: T0, end: T0 + 10 * M, units: 1 } });
    expect(s.orders.O3).toMatchObject({ boosted: true, target_land_ms: T0 + 10 * M, promise_ms: before.orders.O3!.promise_ms });
    expect(s.orders.O3!.groups['O3:0']!.target_land_ms).toBe(T0 + 10 * M);
    // Displaced: every other order keeps its T and promise, its lines land later; slips on the next pass.
    for (const o of ['O1', 'O2']) {
      expect(s.orders[o]).toMatchObject({ boosted: false, target_land_ms: before.orders[o]!.target_land_ms, promise_ms: before.orders[o]!.promise_ms });
    }
    expect(s.lines.A!.fire_ms).toBe(T0 + 10 * M);
    expect(s.lines.B!.fire_ms).toBe(T0 + 30 * M);
    const slips = getAlertIntents(s, T0 + 1).slips;
    expect(slips.map((x) => x.table_key).sort()).toEqual(['t:O1', 't:O2']);
    expect(Math.max(...liveProfile(s, 'S1', T0).u)).toBeLessThanOrEqual(1);
    expectProfileExact(s);
    expectRebuild(k);
  });

  it('[03a #97] boost in the freeze: no instant over capacity; moved frozen lines marked; slip past the threshold only; moves only later; fired unchanged', () => {
    const k = new Kitchen([SLOT(2, 360_000)]);
    const t = T0 + 10 * M;
    // A COOKING line holds one unit until t + 1 min (fired, unchanged by the boost).
    k.submit('OF', [{ id: 'CK', cook: 11 * M }], T0);
    k.apply([fireEv('S1', 'CK', T0), startEv('OF', 'CK', T0)]);
    // Two other orders frozen at t (freeze 6 min), at t + 30 s and t + 4 min 30 s, by their pickup.
    k.submit('OA', [{ id: 'FA', cook: 10 * M }], t - M, { pickup: t + 30 * S + 10 * M });
    k.submit('OB', [{ id: 'FB', cook: 10 * M }], t - M, { pickup: t + 270 * S + 10 * M });
    // The boosted order: both units, hidden behind them (no pickup: AD-29 Q11 B3 would hold it there).
    k.submit('OX', [{ id: 'X', cook: 5 * M, units: 2 }], t - M);
    const before = k.state;
    expect(before.lines.FA!.fire_ms).toBe(t + 30 * S);
    expect(before.lines.FB!.fire_ms).toBe(t + 270 * S);
    const s = k.apply([boost('OX', t)]);

    // X lands as soon as the fixed COOKING line lets both units in, in front of the frozen lines.
    expect(s.lines.X).toMatchObject({ fire_ms: t + M, mark: 'boost' });
    expect(s.orders.OX!.target_land_ms).toBe(t + 6 * M);
    expect(s.orders.OX!.promise_ms).toBe(before.orders.OX!.promise_ms);
    // Each frozen line moves only later and only as far as needed, and is marked.
    expect(s.lines.FA!.fire_ms).toBe(t + 6 * M);
    expect(s.lines.FB!.fire_ms).toBe(t + 6 * M);
    expect(moved(s)).toEqual(['FA', 'FB']);
    expect(s.lines.FA!.fire_ms!).toBeGreaterThan(before.lines.FA!.fire_ms!);
    // No instant over capacity.
    expect(Math.max(...liveProfile(s, 'S1', t).u)).toBeLessThanOrEqual(2);
    // FA was pushed 5 min 30 s (past the 2 min threshold): a slip; FB 1 min 30 s: none.
    expect(getAlertIntents(s, t + 1).slips.map((x) => x.table_key)).toEqual(['t:OA']);
    // Fired / COOKING: unchanged.
    expect(s.lines.CK).toEqual(before.lines.CK);
    expectProfileExact(s);
    expectRebuild(k);
  });

  // §3.4: pushed past t + freeze_ms, a frozen line is still the frozen line of this fold: pass 1 must not take it as hidden.
  it('[03a #97] a frozen line pushed past the freeze ends where it was needed: not later (t + 150 s, not its deadline t + 170 s)', () => {
    const t = T0 + 10 * M;
    const k = new Kitchen([SLOT(1)]);
    k.submit('OA', [{ id: 'A', cook: M }], t - M, { pickup: t + 170 * S + M }); // d = t + 170 s
    k.submit('OX', [{ id: 'X', cook: 150 * S }], t - M); // its pass 1 keeps A: fire d − keep
    expect(k.state.lines.A).toMatchObject({ fire_ms: t + 110 * S, deadline_ms: t + 170 * S });
    const s = k.apply([boost('OX', t)]);
    expect(s.lines.X).toMatchObject({ fire_ms: t, booked: { start: t, end: t + 150 * S, units: 1 } });
    expect(s.lines.A).toMatchObject({ fire_ms: t + 150 * S, mark: 'moved', station_id: 'S1' });
    expectProfileExact(s);
    expectRebuild(k);
  });

  it('[03a #97] a frozen line pushed past the freeze never lands before its frozen fire (a gap before the boost is not taken)', () => {
    const t = T0 + 10 * M;
    const k = new Kitchen([SLOT(2)]);
    k.submit('OF', [{ id: 'CK', cook: 80 * S }], t - M);
    k.apply([fireEv('S1', 'CK', t - M), startEv('OF', 'CK', t - M)]); // one unit until t + 20 s
    k.submit('OA', [{ id: 'A', cook: 15 * S, early: 5 * M }], t - M, { pickup: t + 170 * S + 15 * S });
    k.submit('OX', [{ id: 'X', cook: 150 * S, units: 2 }], t - M);
    expect(k.state.lines.A).toMatchObject({ fire_ms: t + 110 * S, deadline_ms: t + 170 * S });
    const s = k.apply([boost('OX', t)]);
    expect(s.lines.X).toMatchObject({ fire_ms: t + 20 * S, booked: { end: t + 170 * S } });
    expect(s.lines.A).toMatchObject({ fire_ms: t + 170 * S, mark: 'moved' });
    expectProfileExact(s);
    expectRebuild(k);
  });

  it('[03a #97] pushed past the freeze, a frozen line does not re-route off its station (§3.5.5 D10), on a capacity change either', () => {
    const t = T0 + 10 * M;
    const alt = [{ station_id: 'S2', carry_ms: 0, home: false }];
    const k = new Kitchen([SLOT(2), { station_id: 'S2', capacity: 2 }]);
    k.submit('OB', [{ id: 'B', station: 'S1', cook: 150 * S }], t - M, { pickup: t + 150 * S });
    k.submit('OA', [{ id: 'A', station: 'S1', cook: M, alternates: alt }], t - M, { pickup: t + 170 * S + M });
    k.submit('OC', [{ id: 'C', station: 'S1', cook: M }], t - M, { pickup: t + 60 * M }); // its pass 1 keeps A: fire d − keep
    expect(k.state.lines.A).toMatchObject({ station_id: 'S1', fire_ms: t + 110 * S });
    expect(k.state.lines.B!.fire_ms).toBe(t);
    const s = k.apply([capacity('S1', 1, t)]);
    expect(s.lines.A).toMatchObject({ station_id: 'S1', fire_ms: t + 150 * S, mark: 'moved' });
    expectProfileExact(s);
  });

  // Task 16 review (b): a frozen batch load is held the same way.
  it('[03a #97] batch: a frozen load pushed past the freeze by a boost of a 150 s load of another program ends at t + 150 s', () => {
    const t = T0 + 10 * M;
    const k = new Kitchen([{ station_id: 'F', station_type: 'batch', capacity: 4, freeze_ms: 120_000, freshness_window_ms: 0, programs: [{ program_id: 'P1', name: 'P1', cook_time_ms: 999_999, is_archived: false }, { program_id: 'P2', name: 'P2', cook_time_ms: 999_999, is_archived: false }] }]);
    k.submit('OA', [{ id: 'A', program: 'P1', cook: M }], t - M, { pickup: t + 170 * S + M }); // d = t + 170 s
    k.submit('OX', [{ id: 'X', program: 'P2', cook: 150 * S }], t - M); // its pass 1 keeps A: fire d − keep
    expect(k.state.lines.A).toMatchObject({ fire_ms: t + 110 * S, deadline_ms: t + 170 * S });
    const s = k.apply([boost('OX', t)]);
    expect(s.lines.X).toMatchObject({ fire_ms: t, mark: 'boost' });
    expect(s.lines.A).toMatchObject({ fire_ms: t + 150 * S, mark: 'moved', station_id: 'F' });
    expect(s.stations.F!.loads[s.lines.A!.load_id!]).toMatchObject({ fire_ms: t + 150 * S, booked: { start: t + 150 * S, end: t + 210 * S } });
    expectProfileExact(s);
    expectRebuild(k);
  });

  it('[03a §3.9] a boost never moves a fired line; its live interval stays a fixed input of T_b', () => {
    const k = new Kitchen([SLOT(1)]);
    k.submit('OF', [{ id: 'FD', cook: 10 * M }], T0);
    k.apply([fireEv('S1', 'FD', T0)]);
    k.submit('OX', [{ id: 'X', cook: 5 * M }], T0);
    const before = k.state;
    const s = k.apply([boost('OX', T0 + M)]);
    expect(s.lines.FD).toEqual(before.lines.FD);
    expect(liveInterval(s, 'FD', T0 + M)).toEqual({ start: T0 + M, end: T0 + 11 * M });
    expect(s.lines.X!.fire_ms).toBe(T0 + 11 * M);
    expect(s.orders.OX!.target_land_ms).toBe(T0 + 16 * M);
  });

  it('[03a §3.9] the group re-places as one group: hold-and-fire over the order\'s lines on all stations (T_b), a fired sibling floors it', () => {
    const k = new Kitchen([SLOT(1), { station_id: 'S2', capacity: 1 }]);
    k.submit('O1', [{ id: 'P', station: 'S1', cook: 30 * M }, { id: 'Q', station: 'S2', cook: 30 * M }], T0);
    k.submit('O2', [{ id: 'A', station: 'S1', cook: 10 * M }, { id: 'B', station: 'S2', cook: 20 * M }], T0);
    const s = k.apply([boost('O2', T0)]);
    // One group: B fires at once, A is held to land with it (T_b = 20 min), against the fixed lines only.
    expect(s.orders.O2!.target_land_ms).toBe(T0 + 20 * M);
    expect(s.lines.B!.fire_ms).toBe(T0);
    expect(s.lines.A!.fire_ms).toBe(T0 + 10 * M);
    // P and Q were displaced behind them.
    expect(s.lines.P!.fire_ms).toBe(T0 + 20 * M);
    expect(s.lines.Q!.fire_ms).toBe(T0 + 20 * M);
    expectProfileExact(s);
    expectRebuild(k);

    const m = new Kitchen([SLOT(1), { station_id: 'S2', capacity: 1 }]);
    m.submit('O3', [{ id: 'C', station: 'S1', cook: 40 * M }, { id: 'D', station: 'S2', cook: 5 * M }], T0);
    m.apply([fireEv('S1', 'C', T0), startEv('O3', 'C', T0)]);
    const f = m.apply([boost('O3', T0 + M)]);
    // The COOKING sibling lands at 40 min: D is held with it (sync), T_b = its land.
    expect(f.orders.O3!.target_land_ms).toBe(T0 + 40 * M);
    expect(f.lines.D!.booked).toMatchObject({ end: T0 + 40 * M });
    expect(f.lines.C!.started_at).toBe(T0);
  });

  it('[03a §3.9] an immediate line of a boosted order goes at its earliest fit, never held to the sync lines', () => {
    const k = new Kitchen([SLOT(1), { station_id: 'S2', capacity: 1 }]);
    k.submit('O1', [{ id: 'P', station: 'S1', cook: 30 * M }], T0);
    k.submit('O2', [{ id: 'I', station: 'S1', cook: 5 * M, mode: 'immediate' }, { id: 'M', station: 'S2', cook: 25 * M }], T0);
    const s = k.apply([boost('O2', T0)]);
    expect(s.lines.I).toMatchObject({ fire_ms: T0, mark: 'boost' });
    expect(s.orders.O2!.groups[s.lines.I!.group_id]!.target_land_ms).toBe(T0 + 5 * M);
    expect(s.lines.M).toMatchObject({ fire_ms: T0, mark: 'boost' });
    expect(s.orders.O2!.target_land_ms).toBe(T0 + 25 * M);
  });

  it('[03a §3.9] a hidden boosted line may take an alternate; a frozen one stays on its station (§3.5.5 D10)', () => {
    const k = new Kitchen([SLOT(1, 300_000), { station_id: 'S2', capacity: 1, freeze_ms: 300_000 }]);
    k.submit('O0', [{ id: 'Z', station: 'S1', cook: 10 * M }], T0);
    k.apply([fireEv('S1', 'Z', T0), startEv('O0', 'Z', T0)]);
    const alt = [{ station_id: 'S2', carry_ms: 0, home: false }];
    k.submit('O1', [{ id: 'H', station: 'S1', cook: 5 * M, alternates: alt }], T0, { pickup: T0 + 60 * M });
    // S1 taken by a line fired early over H's slot: at the pickup (AD-29 Q11 B3) only S2 can land it.
    k.submit('O3', [{ id: 'Q', station: 'S1', cook: 130 * M }], T0, { pickup: T0 + 200 * M });
    k.apply([fireEv('S1', 'Q', T0 + 10 * M), startEv('O3', 'Q', T0 + 10 * M)]);
    expect(k.state.lines.H!.station_id).toBe('S1');
    let s = k.apply([boost('O1', T0 + 10 * M)]);
    expect(s.lines.H).toMatchObject({ station_id: 'S2', fire_ms: T0 + 55 * M, mark: 'boost' });
    expect(s.stations.S1!.unfired).not.toContain('H');
    expect(s.stations.S2!.unfired).toContain('H');
    expectProfileExact(s);

    const m = new Kitchen([SLOT(1, 300_000), { station_id: 'S2', capacity: 1, freeze_ms: 300_000 }]);
    m.submit('O0', [{ id: 'Z', station: 'S1', cook: 10 * M }], T0);
    m.apply([fireEv('S1', 'Z', T0), startEv('O0', 'Z', T0)]);
    m.submit('O1', [{ id: 'H', station: 'S1', cook: 5 * M, alternates: alt }], T0, { pickup: T0 + 15 * M + 3 * M });
    expect(m.state.lines.H!.fire_ms).toBe(T0 + 13 * M);
    // S1 taken by a line fired over H's slot, S2 free: a hidden line would leave.
    m.submit('O3', [{ id: 'Q', station: 'S1', cook: 20 * M }], T0, { pickup: T0 + 60 * M });
    m.apply([fireEv('S1', 'Q', T0 + 9 * M), startEv('O3', 'Q', T0 + 9 * M)]);
    s = m.apply([boost('O1', T0 + 9 * M)]); // fire 13 min ≤ 9 + 5 min: frozen
    expect(s.lines.H).toMatchObject({ station_id: 'S1', fire_ms: T0 + 29 * M });
  });

  it('[03a §3.9] a boost that displaces a frozen line past its deadline runs §3.5.6 with the hidden lines (weights apply, the frozen line never moves earlier)', () => {
    const k = new Kitchen([SLOT(1, 300_000)]);
    k.submit('OF', [{ id: 'FR', cook: 10 * M }], T0, { pickup: T0 + 12 * M }); // fire 2 min: frozen, deadline 2 min
    k.submit('OH', [{ id: 'HD', cook: 10 * M }], T0, { pickup: T0 + 30 * M }); // fire 20 min: hidden
    k.submit('OX', [{ id: 'X', cook: 15 * M }], T0);
    const before = k.state;
    expect(before.lines.FR!.fire_ms).toBe(T0 + 2 * M);
    const s = k.apply([boost('OX', T0)]);
    expect(s.lines.X!.fire_ms).toBe(T0);
    expect(s.lines.FR!.fire_ms).toBe(T0 + 15 * M); // only as far as needed
    expect(s.lines.FR!.mark).toBe('moved');
    expect(s.lines.FR!.deadline_ms).toBe(before.lines.FR!.deadline_ms); // lateness shows as a slip (D6)
    expect(s.lines.HD!.mark).toBeNull(); // a hidden line is never marked
    expect(s.lines.HD!.fire_ms).toBeGreaterThanOrEqual(T0 + 25 * M);
    expect(s.orders.OF!.target_land_ms).toBe(before.orders.OF!.target_land_ms);
    expect(Math.max(...liveProfile(s, 'S1', T0).u)).toBeLessThanOrEqual(1);
    expectProfileExact(s);
  });

  it('[03a §3.9, AD-29 Q11 B3] a delivery boost keeps the pickup floor; the promise stays', () => {
    const k = new Kitchen([SLOT(1)]);
    const plan = k.submit('OD', [{ id: 'D', cook: 10 * M }], T0, { pickup: T0 + 60 * M });
    const s = k.apply([boost('OD', T0)]);
    expect(s.lines.D!.fire_ms).toBe(T0 + 50 * M);
    expect(s.orders.OD!.target_land_ms).toBe(T0 + 60 * M);
    expect(s.orders.OD!.promise_ms).toBe(plan.groups[0]!.promise_ms);
  });

  it('[03a §3.9] a boost folds on a batch station: the boosted lines leave their load, the other members keep it, frozen loads are pushed whole', () => {
    const k = new Kitchen([{ station_id: 'F', station_type: 'batch', capacity: 4, freeze_ms: 300_000, freshness_window_ms: 60_000, programs: [{ program_id: 'P1', name: 'P', cook_time_ms: 999_999, is_archived: false }, { program_id: 'P2', name: 'P2', cook_time_ms: 999_999, is_archived: false }] }]);
    k.submit('OA', [{ id: 'A', program: 'P2', cook: 10 * M }], T0, { pickup: T0 + 11 * M }); // fire 1 min: frozen
    k.submit('OB', [{ id: 'B', program: 'P1', cook: 10 * M }], T0, { pickup: T0 + 21 * M });
    k.submit('OC', [{ id: 'C', program: 'P1', cook: 10 * M }], T0); // joins B's load
    expect(k.state.lines.C!.load_id).toBe(k.state.lines.B!.load_id);
    const lb = k.state.lines.B!.load_id!;
    const s = k.apply([boost('OC', T0)]);
    expect(s.lines.C).toMatchObject({ mark: 'boost', fire_ms: T0 });
    expect(s.lines.C!.load_id).not.toBe(lb);
    expect(s.orders.OC!.target_land_ms).toBe(T0 + 10 * M);
    // A's frozen load is pushed behind it, whole, marked.
    expect(s.lines.A).toMatchObject({ fire_ms: T0 + 10 * M, mark: 'moved' });
    const ids = Object.values(s.stations.F!.loads).flatMap((l) => l.order_item_ids).sort();
    expect(ids).toEqual(['A', 'B', 'C']);
    expectProfileExact(s);
    expectNoOverbooking(s, T0);
    expectRebuild(k);
  });

  it('[03a AD-14] a boost leaves FIFO lines where they are: a boosted line on a FIFO station stays, its land floors T_b; others on the station never move', () => {
    const k = new Kitchen([{ station_id: 'Q', policy: 'fifo', capacity: 1 }, SLOT(1)]);
    k.submit('O1', [{ id: 'A', station: 'Q', cook: 10 * M }], T0);
    k.submit('O2', [{ id: 'B', station: 'Q', cook: 10 * M }, { id: 'C', station: 'S1', cook: 5 * M }], T0);
    const before = k.state;
    const s = k.apply([boost('O2', T0)]);
    expect(s.lines.A).toEqual(before.lines.A);
    expect(s.lines.B!.fire_ms).toBe(before.lines.B!.fire_ms);
    expect(s.lines.B!.mark).toBeNull();
    expect(s.lines.C!.mark).toBe('boost');
    expect(s.orders.O2!.boosted).toBe(true);
    expect(s.orders.O2!.target_land_ms).toBe(T0 + 20 * M);
    expect(s.lines.C!.booked!.end).toBe(T0 + 20 * M);
  });

  it('[03a §3.8a] a return line keeps mark return through its order\'s boost and a capacity move', () => {
    const k = returnKitchen({ returns_boost: false });
    k.apply(aReturnLinesAdded(k.log.find((e) => e.event_type === 'ItemAdded')!, 'fix', { recorded_at: at(10), target_land_ms: at(13), order_item_id: 'LR', adjust_time_ms: 3 * M }));
    expect(k.state.lines.LR!.mark).toBe('return');
    const b = k.apply([boost('OS', at(10))]);
    expect(b.lines.LR!.mark).toBe('return');
    expect(b.orders.OS!.boosted).toBe(true);
    // A capacity move of the frozen return line.
    const m = returnKitchen({ returns_boost: false });
    m.submit('OC', [{ id: 'C1', cook: 5 * M, units: 2 }], at(10));
    m.apply(aReturnLinesAdded(m.log.find((e) => e.event_type === 'ItemAdded')!, 'fix', { recorded_at: at(10), target_land_ms: at(18), order_item_id: 'LR', adjust_time_ms: 3 * M }));
    const before = m.state.lines.LR!.fire_ms;
    expect(before).toBe(at(15));
    const after = m.apply([capacity('S1', 1, at(14))]); // the 2-unit line now takes two rounds
    expect(after.lines.LR!.fire_ms).toBe(at(20));
    expect(after.lines.LR!.mark).toBe('return');
    expect(after.lines.LR!.return_of).not.toBeNull();
  });
});

const at = (min: number): number => T0 + min * M;

// Order OS: L1 served at 12:06 (cook 5 min), L2 a second sync line still cooking later; capacity 2 by default.
function returnKitchen(settings: Partial<Settings>, capacity_ = 2): Kitchen {
  const k = new Kitchen([{ station_id: 'S1', capacity: capacity_ }], settings);
  k.submit('OS', [{ id: 'L1', cook: 5 * M }], at(0));
  k.apply([
    fireEv('S1', 'L1', at(0)),
    startEv('OS', 'L1', at(0)),
    orderEv('ItemDone', 'OS', { order_item_id: 'L1', done_at: at(5), source: 'tap' }, at(5)),
    orderEv('ItemServed', 'OS', { order_item_ids: ['L1'], source: 'tap' }, at(6)),
  ]);
  return k;
}

function proposedReturn(k: Kitchen, cook: number): ProposedOrder {
  const added = k.log.find((e) => e.event_type === 'ItemAdded')!.payload as unknown as ItemAddedPayload;
  return deepFreeze({
    order_id: 'OS',
    order: { order_type: 'dine_in', table_id: null, table_key: 't:OS', follow_up: false, pickup_at_ms: null },
    lines: [
      {
        ...added,
        order_item_id: 'LR',
        line_kind: 'item',
        options: [],
        alternates: [],
        point_id: null,
        carry_ms: 0,
        weight_pct: 100,
        max_early_ms: 60_000,
        max_late_ms: null,
        max_carry_ms: null,
        cook_ms_override: cook,
        return_of: { order_item_id: 'L1', mode: 'fix' as const },
      },
    ],
  });
}

describe('@pos/engine returns_boost (§3.8a)', () => {
  function occupied(settings: Partial<Settings>): { k: Kitchen; plan: PlanResult; s: EngineState; before: EngineState } {
    const k = returnKitchen(settings, 1);
    // Another order frozen on the single unit from 12:11, and a second line of OS itself, hidden behind it.
    k.submit('O2', [{ id: 'X', cook: 10 * M }], at(10), { pickup: at(21) });
    k.apply(
      anOrderBatchAddition('OS', 'L3', at(10), at(40)),
    );
    const before = k.state;
    expect(before.lines.X!.fire_ms).toBe(at(11));
    const plan = planOrder(before, proposedReturn(k, 3 * M), at(10), {});
    k.apply(aReturnLinesAdded(k.log.find((e) => e.event_type === 'ItemAdded')!, 'fix', { recorded_at: at(10), target_land_ms: plan.groups[0]!.target_land_ms, promise_ms: plan.groups[0]!.promise_ms, order_item_id: 'LR', adjust_time_ms: 3 * M, group_index: 2 }));
    return { k, plan, s: k.state, before };
  }

  it('[03a #107 engine] with returns_boost only the return line is boosted: order.boosted false, the order\'s other lines and T unchanged; it may push others', () => {
    const { k, plan, s, before } = occupied({ returns_boost: true });
    // Earliest fit against the fixed lines; planOrder = the fold (one sequence).
    expect(s.lines.LR).toMatchObject({ mark: 'return', fire_ms: at(10), serve_mode: 'immediate', booked: { start: at(10), end: at(13), units: 1 } });
    expect(plan.lines[0]!.eta_ms).toBe(at(13));
    expect(s.orders.OS!.boosted).toBe(false);
    expect(s.orders.OS!.target_land_ms).toBe(before.orders.OS!.target_land_ms);
    expect(s.orders.OS!.promise_ms).toBe(before.orders.OS!.promise_ms);
    expect(s.orders.OS!.groups['OS:1']!.target_land_ms).toBe(before.orders.OS!.groups['OS:1']!.target_land_ms);
    expect(s.lines.L3!.mark).toBeNull();
    // X was frozen at 12:11: pushed behind the return, marked.
    expect(s.lines.X).toMatchObject({ fire_ms: at(13), mark: 'moved' });
    expect(s.orders.O2!.target_land_ms).toBe(before.orders.O2!.target_land_ms);
    expect(Math.max(...liveProfile(s, 'S1', at(10)).u)).toBeLessThanOrEqual(1);
    expectProfileExact(s);
    expectRebuild(k);
  });

  it('[03a #75] returns_boost: an order the return pushes past the threshold slips on the next getAlertIntents; one pushed less does not; never the return itself', () => {
    const run = (cook: number): string[] => {
      const k = returnKitchen({ returns_boost: true }, 1);
      k.submit('O2', [{ id: 'X', cook: 10 * M }], at(10), { pickup: at(21) }); // frozen at 12:11
      const plan = planOrder(k.state, proposedReturn(k, cook), at(10), {});
      const s = k.apply(aReturnLinesAdded(k.log.find((e) => e.event_type === 'ItemAdded')!, 'fix', { recorded_at: at(10), target_land_ms: plan.groups[0]!.target_land_ms, promise_ms: plan.groups[0]!.promise_ms, order_item_id: 'LR', adjust_time_ms: cook }));
      expect(s.lines.X!.mark).toBe('moved');
      expect(s.slips).toEqual({});
      return getAlertIntents(s, at(10) + 1).slips.flatMap((x) => x.order_ids);
    };
    expect(run(5 * M)).toEqual(['O2']); // X pushed 4 min
    expect(run(2 * M)).toEqual([]); // X pushed 1 min
  });

  // Task 16 review (a): the return path holds a pushed frozen line too (heldAfterFrozen), as boost and capacity do.
  it('[03a #97] return path: frozen A at t + 110 s, d = t + 170 s, a return of 150 s → A ends at t + 150 s, not re-placed again, never earlier', () => {
    const t = at(10);
    const k = returnKitchen({ returns_boost: true }, 1);
    k.submit('OA', [{ id: 'A', cook: M }], t - M, { pickup: t + 170 * S + M }); // d = t + 170 s
    k.submit('OX', [{ id: 'X', cook: 150 * S }], t - M, { pickup: t + 60 * M }); // its pass 1 keeps A: fire d − keep
    expect(k.state.lines.A).toMatchObject({ fire_ms: t + 110 * S, deadline_ms: t + 170 * S });
    const plan = planOrder(k.state, proposedReturn(k, 150 * S), t, {});
    const s = k.apply(aReturnLinesAdded(k.log.find((e) => e.event_type === 'ItemAdded')!, 'fix', { recorded_at: t, target_land_ms: plan.groups[0]!.target_land_ms, promise_ms: plan.groups[0]!.promise_ms, order_item_id: 'LR', adjust_time_ms: 150 * S }));
    expect(s.lines.LR).toMatchObject({ mark: 'return', fire_ms: t, booked: { start: t, end: t + 150 * S, units: 1 } });
    expect(s.lines.A).toMatchObject({ fire_ms: t + 150 * S, mark: 'moved', deadline_ms: t + 170 * S });
    expectProfileExact(s);
    expectRebuild(k);
  });

  it('[03a #107 engine] with returns_boost false the return waits for the frozen line (§3.8a expedite: nothing is pushed)', () => {
    const { plan, s, before } = occupied({ returns_boost: false });
    expect(s.lines.X).toEqual(before.lines.X);
    expect(s.lines.LR!.fire_ms).toBe(at(21));
    expect(plan.lines[0]!.eta_ms).toBe(at(24));
    expect(s.lines.LR!.mark).toBe('return');
  });
});

// A later OrderLinesAdded on order_id: one sync line, cook 10 min, placed by its pickup-less group T.
function anOrderBatchAddition(order_id: string, id: string, t: number, target: number): PosEvent[] {
  const s = nextSeq(1);
  const added = anItemAdded().payload;
  const linesAdded: PosEvent = {
    ...anItemStarted(),
    event_type: 'OrderLinesAdded',
    stream_id: order_id,
    recorded_at: t,
    occurred_at: t,
    seq: s,
    event_id: `01JD${String(s).padStart(22, '0')}`,
    payload: {
      order_id,
      order_item_ids: [id],
      groups: [{ group_id: `${order_id}:1`, target_land_ms: target, promise_ms: target + 180_000, order_item_ids: [id] }],
      lines: [{ order_item_id: id, station_id: 'S1', alternates: [], point_id: null, carry_ms: 0, from_stock: false, weight_pct: 100, max_early_ms: 60_000, max_late_ms: null, max_carry_ms: null, return_of: null, cook_ms_override: null }],
    },
  };
  const item: PosEvent = {
    ...anItemStarted(),
    event_type: 'ItemAdded',
    stream_id: order_id,
    recorded_at: t,
    occurred_at: t,
    seq: s + 1,
    event_id: `01JD${String(s + 1).padStart(22, '0')}`,
    payload: { ...added, order_id, order_item_id: id, station_id: 'S1', cook_time_ms: 10 * M, prep_buffer_ms: 0, serve_mode: 'sync', quantity: 1, stock_draws: [] },
  };
  return [linesAdded, item];
}

describe('@pos/engine returns_boost on a batch station (§3.8a, P-3)', () => {
  it('[03a §3.8a] the return forms its own load at its earliest fit; a frozen load is pushed whole; planOrder = the fold', () => {
    const k = new Kitchen([{ station_id: 'F', station_type: 'batch', capacity: 4, freeze_ms: 300_000, freshness_window_ms: 0, programs: [{ program_id: 'P1', name: 'P', cook_time_ms: 999_999, is_archived: false }] }]);
    k.submit('OS', [{ id: 'L1', program: 'P1', cook: 5 * M }], at(0));
    k.apply([fireEv('F', 'L1', at(0)), startEv('OS', 'L1', at(0)), orderEv('ItemDone', 'OS', { order_item_id: 'L1', done_at: at(5), source: 'tap' }, at(5)), orderEv('ItemServed', 'OS', { order_item_ids: ['L1'], source: 'tap' }, at(6))]);
    k.submit('O2', [{ id: 'X', program: 'P1', cook: 10 * M }], at(10), { pickup: at(21) });
    expect(k.state.lines.X!.fire_ms).toBe(at(11));
    const added = k.log.find((e) => e.event_type === 'ItemAdded')!;
    const plan = planOrder(k.state, { ...proposedReturn(k, 3 * M), lines: [{ ...proposedReturn(k, 3 * M).lines[0]!, station_id: 'F', cook_ms_override: 3 * M }] }, at(10), {});
    expect(plan.lines[0]!.eta_ms).toBe(at(13));
    const s = k.apply(aReturnLinesAdded(added, 'fix', { recorded_at: at(10), target_land_ms: at(13), order_item_id: 'LR', adjust_time_ms: 3 * M }));
    expect(s.lines.LR).toMatchObject({ mark: 'return', fire_ms: at(10) });
    expect(s.lines.LR!.load_id).not.toBe(s.lines.X!.load_id);
    expect(s.lines.X).toMatchObject({ fire_ms: at(13), mark: 'moved' });
    expect(Math.max(...liveProfile(s, 'F', at(10)).u)).toBeLessThanOrEqual(4);
    expectProfileExact(s);
    expectRebuild(k);
  });
});

describe('@pos/engine capacity change (§3.10, D37, D15 exception)', () => {
  it('[03a #45] capacity change re-plans the station: frozen lines re-placed and marked, fired and COOKING fixed, nothing booked over the new capacity', () => {
    const k = new Kitchen([SLOT(3, 300_000)]);
    k.submit('OC', [{ id: 'CK', cook: 20 * M }], T0);
    k.submit('OD', [{ id: 'FD', cook: 20 * M }], T0);
    k.apply([startEv('OC', 'CK', T0), fireEv('S1', 'FD', T0)]);
    k.submit('O1', [{ id: 'F1', cook: 10 * M }], T0, { pickup: T0 + 13 * M }); // fire 3 min, frozen; third unit
    k.submit('O2', [{ id: 'H1', cook: 10 * M }], T0, { pickup: T0 + 40 * M }); // hidden
    const before = k.state;
    const s = k.apply([capacity('S1', 2, T0 + M)]);
    expect(s.stations.S1!.capacity_override).toBe(2);
    expect(s.lines.CK).toEqual(before.lines.CK);
    expect(s.lines.FD).toEqual(before.lines.FD);
    expect(s.lines.F1).toMatchObject({ fire_ms: T0 + 20 * M, mark: 'moved' });
    expect(s.lines.H1!.mark).toBeNull();
    expect(moved(s)).toEqual(['F1']);
    expect(Math.max(...liveProfile(s, 'S1', T0 + M).u)).toBeLessThanOrEqual(2);
    expectProfileExact(s);
    expectRebuild(k);
  });

  it('[03a #100] lane Off in the freeze: 30 → 15 with 30 units frozen in the next 2 min; re-placed within 15, marked, slip past the threshold; through §3.5.6; lane On and an EngineConfigApplied behave the same', () => {
    const build = (): Kitchen => {
      const k = new Kitchen([SLOT(30)]);
      k.submit('OA', [{ id: 'A', cook: 10 * M, units: 15 }], T0, { pickup: T0 + 10 * M });
      k.submit('OB', [{ id: 'B', cook: 10 * M, units: 15 }], T0, { pickup: T0 + 11 * M });
      k.submit('OC', [{ id: 'C', cook: 2 * M, units: 15 }], T0, { pickup: T0 + 30 * M }); // hidden
      return k;
    };
    const k = build();
    const before = k.state;
    expect(before.lines.A!.fire_ms).toBe(T0);
    expect(before.lines.B!.fire_ms).toBe(T0 + M);
    const off = k.apply([capacity('S1', 15, T0, 'lane_off')]);
    expect(effectiveCapacity(off.stations.S1!)).toBe(15);
    expect(off.lines.A).toEqual(before.lines.A);
    // B does not fit by its deadline: late set, §3.5.6; it still moves only as far as needed.
    expect(off.lines.B).toMatchObject({ fire_ms: T0 + 10 * M, mark: 'moved' });
    expect(off.lines.C!.mark).toBeNull();
    expect(Math.max(...liveProfile(off, 'S1', T0).u)).toBeLessThanOrEqual(15);
    expect(getAlertIntents(off, T0 + 1).slips.map((x) => x.table_key)).toEqual(['t:OB']);
    expectProfileExact(off);
    expectRebuild(k);

    // Lane On: more room. A (frozen) never moves earlier; B, hidden by now, may take its slot back (its old mark stays).
    const on = k.apply([capacity('S1', null, T0 + 2 * S, 'lane_on', 15)]);
    expect(on.lines.A).toEqual(before.lines.A);
    expect(on.lines.B).toMatchObject({ fire_ms: T0 + M, mark: 'moved' });
    expect(effectiveCapacity(on.stations.S1!)).toBe(30);
    expectProfileExact(on);

    // An EngineConfigApplied that changes capacity: the same plan as the override.
    const c = build();
    const cfg = c.apply([config([{ ...SLOT(15) }], {}, T0, 2)]);
    expect(cfg.lines.B).toEqual(off.lines.B);
    expect(cfg.lines.A).toEqual(off.lines.A);
    expect(cfg.lines.C).toEqual(off.lines.C);
    expect(cfg.stations.S1!.profile).toEqual(off.stations.S1!.profile);
    expectRebuild(c);

    // A config that changes something else re-plans nothing (§3.11: from the next re-plan).
    const d = build();
    const same = d.state;
    const unchanged = d.apply([config([{ ...SLOT(30), min_slack_keep_ms: 30_000 }], {}, T0, 2)]);
    expect(unchanged.lines).toEqual(same.lines);
  });

  it('[03a §3.10] a frozen line that fits at its fire stays unmarked; a re-plan at the same capacity moves nothing', () => {
    const k = new Kitchen([SLOT(2)]);
    k.submit('O1', [{ id: 'A', cook: 10 * M }], T0);
    k.submit('O2', [{ id: 'B', cook: 10 * M }], T0);
    const before = k.state;
    const s = k.apply([capacity('S1', 2, T0 + S)]);
    expect(s.lines).toEqual(before.lines);
    expect(moved(s)).toEqual([]);
  });

  it('[03a AD-7] after a capacity change every removal is exact: the old booked leaves, never recomputed at the new capacity', () => {
    const k = new Kitchen([SLOT(6)]);
    k.submit('O2', [{ id: 'B', cook: 10 * M, units: 4 }], T0, { pickup: T0 + 10 * M }); // frozen
    k.submit('O1', [{ id: 'A', cook: 10 * M, units: 4 }], T0, { pickup: T0 + 60 * M }); // hidden, 4 units × 10 min
    const s0 = k.state;
    expect(s0.lines.A!.booked).toEqual({ start: T0 + 50 * M, end: T0 + 60 * M, units: 4 });
    // Capacity 2: both over capacity, two rounds of two units; booked re-stored at the new shape.
    const s = k.apply([capacity('S1', 2, T0 + S)]);
    expect(s.lines.A!.booked!.units).toBe(2);
    expect(s.lines.A!.booked!.end - s.lines.A!.booked!.start).toBe(20 * M);
    expect(s.lines.B!.booked!.units).toBe(2);
    expectProfileExact(s);
    // Back at 6, the void of a line removes exactly its booked (strict: an inexact removal would throw).
    const up = k.apply([capacity('S1', null, T0 + 2 * S)]);
    expectProfileExact(up);
    const voided = k.apply([orderEv('ItemVoided', 'O2', { order_item_id: 'B', units: 4 }, T0 + 3 * S)]);
    expect(voided.lines.B!.booked).toBeNull();
    expectProfileExact(voided);
  });

  it('[03a AD-4] over_capacity diagnostics at the new capacity, in strict and non-strict folds, for the lines that still occupy the station', () => {
    const k = new Kitchen([SLOT(6)]);
    k.submit('O1', [{ id: 'A', cook: 10 * M, units: 4 }], T0);
    k.submit('O2', [{ id: 'B', cook: 10 * M, units: 2 }], T0);
    const n0 = k.state.diagnostics.length;
    const s = k.apply([capacity('S1', 3, T0 + S)]);
    const d = s.diagnostics.slice(n0).filter((x) => x.kind === 'over_capacity');
    expect(d).toEqual([expect.objectContaining({ kind: 'over_capacity', order_item_id: 'A', station_id: 'S1', detail: { units: 4, capacity: 3 } })]);
    // Non-strict the same; a station left unchanged appends nothing.
    const again = applyEvent(k.state, capacity('S1', 3, T0 + 2 * S), { strict: false });
    expect(again.diagnostics.length).toBe(s.diagnostics.length);
    const down = applyEvent(k.state, capacity('S1', 1, T0 + 2 * S), { strict: false });
    expect(down.diagnostics.slice(s.diagnostics.length).map((x) => x.order_item_id).sort()).toEqual(['A', 'B']);
  });

  it('[03a AD-6] a capacity re-plan whose stored profile lost a booking: strict throws, non-strict appends profile_underflow', () => {
    const k = new Kitchen([SLOT(2)]);
    k.submit('O1', [{ id: 'A', cook: 10 * M, units: 2 }], T0);
    const broken: EngineState = deepFreeze({ ...k.state, stations: { ...k.state.stations, S1: { ...k.state.stations.S1!, profile: { t: [], u: [] } } } });
    const ev = capacity('S1', 1, T0 + S);
    expect(() => applyEvent(broken, ev)).toThrow(RangeError);
    const s = applyEvent(broken, ev, { strict: false });
    expect(s.stations.S1!.capacity_override).toBe(1);
    expect(s.lines.A!.booked).toMatchObject({ units: 1 }); // two rounds of one unit at the new capacity
    expect(s.diagnostics.filter((d) => d.kind === 'profile_underflow')).toEqual([expect.objectContaining({ station_id: 'S1', detail: expect.objectContaining({ order_item_id: 'A' }) })]);
  });

  it('[03a AD-12] an over-size line keeps its slot end across a capacity change: the deadline moves by the occupancy difference, T stays', () => {
    const k = new Kitchen([SLOT(4)]);
    k.submit('O1', [{ id: 'A', cook: 10 * M, units: 4 }], T0, { pickup: T0 + 60 * M });
    const before = k.state.lines.A!;
    expect(before.deadline_ms).toBe(T0 + 50 * M);
    const s = k.apply([capacity('S1', 2, T0 + S)]);
    // Two rounds now: the latest fire that still lands at T is 10 min earlier.
    expect(s.lines.A!.deadline_ms).toBe(T0 + 40 * M);
    expect(s.lines.A!.booked!.end).toBeLessThanOrEqual(T0 + 60 * M);
    expect(s.orders.O1!.target_land_ms).toBe(T0 + 60 * M);
    const up = k.apply([capacity('S1', null, T0 + 2 * S)]);
    expect(up.lines.A!.deadline_ms).toBe(T0 + 50 * M);
  });

  it('[03a AD-17] the reserve sees the new effective capacity: a hidden non-home line leaves a station the drop shuts it out of; a frozen one stays', () => {
    const k = new Kitchen([{ station_id: 'S1', capacity: 2, reserve_units: 1, freeze_ms: 120_000 }, { station_id: 'S2', capacity: 1 }]);
    // The home is S2; the line sits on S1 as an alternate (S2 busy), seeing 2 − 1 = 1 unit.
    k.submit('O0', [{ id: 'Z', station: 'S2', cook: 40 * M }], T0);
    k.apply([fireEv('S2', 'Z', T0), startEv('O0', 'Z', T0)]);
    k.submit('O1', [{ id: 'H', station: 'S2', cook: 5 * M, alternates: [{ station_id: 'S1', carry_ms: 0, home: false }] }], T0, { pickup: T0 + 30 * M });
    expect(k.state.lines.H!.station_id).toBe('S1');
    k.submit('O2', [{ id: 'I', station: 'S2', cook: 5 * M, alternates: [{ station_id: 'S1', carry_ms: 0, home: false }] }], T0, { pickup: T0 + 6 * M });
    expect(k.state.lines.I).toMatchObject({ station_id: 'S1', fire_ms: T0 + M });
    const s = k.apply([capacity('S1', 1, T0 + S)]);
    // S1 now has 1 − 1 = 0 units for H: it leaves, late, for its home.
    expect(s.lines.H!.station_id).toBe('S2');
    expect(s.lines.H!.alternates.some((a) => a.station_id === 'S1')).toBe(true);
    expect(s.lines.H!.booked!.start).toBeGreaterThanOrEqual(T0 + 40 * M);
    // I is frozen: it belongs to its station (§3.5.5 D10) and keeps its place there at the full capacity.
    expect(s.lines.I).toMatchObject({ station_id: 'S1', fire_ms: T0 + M, mark: null });
    expectProfileExact(s);
  });

  it('[03a AD-15] the §3.5.6 search after a drop sets capped per AD-15 / AD-16, and getAlertIntents reports it', () => {
    const k = new Kitchen([SLOT(2, 60_000)]);
    k.submit('O1', [{ id: 'A', cook: 30 * M }], T0, { pickup: T0 + 35 * M });
    k.submit('O2', [{ id: 'B', cook: 30 * M, late: 60_000, early: 60_000 }], T0, { pickup: T0 + 35 * M });
    expect(k.state.lines.B!.capped).toBe(false);
    const s = k.apply([capacity('S1', 1, T0 + S)]);
    // One slot for two 30-min lines: one lands 30 min late; a line whose cap holds it is capped.
    const late = Object.values(s.lines).filter((l) => l.fire_ms! > l.deadline_ms);
    expect(late).toHaveLength(1);
    expect(s.lines.B!.capped).toBe(late[0]!.order_item_id === 'B');
    expect(Math.max(...liveProfile(s, 'S1', T0 + S).u)).toBeLessThanOrEqual(1);
    expect(getAlertIntents(s, T0 + S).overload.find((o) => o.station_id === 'S1')!.capped).toBe(s.lines.B!.capped);
  });

  it('[03a AD-14] a FIFO station stays out of the re-plan, but no booking stays over the new capacity (§3.10): lines only pushed later as needed', () => {
    const k = new Kitchen([{ station_id: 'Q', policy: 'fifo', capacity: 2, freeze_ms: 120_000 }]);
    k.submit('O1', [{ id: 'A', station: 'Q', cook: 10 * M }], T0);
    k.submit('O2', [{ id: 'B', station: 'Q', cook: 10 * M }], T0);
    k.submit('O3', [{ id: 'C', station: 'Q', cook: 10 * M }], T0); // hidden on FIFO, behind them
    const before = k.state;
    expect(before.lines.C!.fire_ms).toBe(T0 + 10 * M);
    const s = k.apply([capacity('Q', 1, T0)]);
    expect(s.lines.A).toEqual(before.lines.A);
    expect(s.lines.B).toMatchObject({ fire_ms: T0 + 10 * M, deadline_ms: T0 + 10 * M, mark: 'moved' });
    expect(s.lines.C).toMatchObject({ fire_ms: T0 + 20 * M, deadline_ms: T0 + 20 * M, mark: null });
    expect(Math.max(...liveProfile(s, 'Q', T0).u)).toBeLessThanOrEqual(1);
    // A rise moves nothing earlier: FIFO lines are never re-planned.
    const up = k.apply([capacity('Q', 3, T0 + S)]);
    expect(up.lines.C!.fire_ms).toBe(T0 + 20 * M);
    expectProfileExact(up);
    expectRebuild(k);
  });

  it('[03a AD-4] a load whose units exceed a lowered capacity keeps its rounds once fired: its live interval is its booking (load units, not per member)', () => {
    const k = new Kitchen([{ station_id: 'F', station_type: 'batch', capacity: 30, freeze_ms: 120_000, freshness_window_ms: 60_000, programs: [{ program_id: 'P1', name: 'P', cook_time_ms: 999_999, is_archived: false }] }]);
    k.submit('O1', [{ id: 'A', program: 'P1', cook: 10 * M, units: 15 }, { id: 'B', program: 'P1', cook: 10 * M, units: 15 }], T0, { pickup: T0 + 11 * M });
    const id = k.state.lines.A!.load_id!;
    expect(k.state.lines.B!.load_id).toBe(id);
    const s = k.apply([capacity('F', 20, T0)]);
    expect(s.stations.F!.loads[id]!.booked).toEqual({ start: T0 + M, end: T0 + 21 * M, units: 20 });
    const f = k.apply([stamp(aFireDispatched({ stream_id: 'F', payload: { station_id: 'F', order_item_ids: ['A', 'B'], load_id: id, due_at: T0 + M, reason: 'scheduled' } }), T0 + M)]);
    expect(liveInterval(f, 'A', T0 + M)).toEqual({ start: T0 + M, end: T0 + 21 * M });
    expect(liveInterval(f, 'B', T0 + M)).toEqual({ start: T0 + M, end: T0 + 21 * M });
    // A started: the COOKING group keeps the rounds too.
    const c = k.apply([startEv('O1', 'A', T0 + M), startEv('O1', 'B', T0 + M)]);
    expect(liveInterval(c, 'A', T0 + M)).toEqual({ start: T0 + M, end: T0 + 21 * M });
  });

  it('[03a AD-4] a load within the capacity packs one round, as before', () => {
    const k = new Kitchen([{ station_id: 'F', station_type: 'batch', capacity: 30, freeze_ms: 120_000, freshness_window_ms: 60_000, programs: [{ program_id: 'P1', name: 'P', cook_time_ms: 999_999, is_archived: false }] }]);
    k.submit('O1', [{ id: 'A', program: 'P1', cook: 10 * M, units: 10 }, { id: 'B', program: 'P1', cook: 10 * M, units: 10 }], T0);
    const id = k.state.lines.A!.load_id!;
    const f = k.apply([stamp(aFireDispatched({ stream_id: 'F', payload: { station_id: 'F', order_item_ids: ['A', 'B'], load_id: id, due_at: T0, reason: 'scheduled' } }), T0)]);
    expect(liveInterval(f, 'A', T0)).toEqual({ start: T0, end: T0 + 10 * M });
  });

  it('[03a AD-4] a pass-1 re-route onto a smaller station logs over_capacity there, in both modes', () => {
    const build = (): Kitchen => {
      const k = new Kitchen([{ station_id: 'S1', capacity: 4 }, { station_id: 'S2', capacity: 2 }]);
      k.submit('OL', [{ id: 'H', station: 'S1', cook: 5 * M, units: 3, early: 30 * M, alternates: [{ station_id: 'S2', carry_ms: 0, home: false }] }], T0, { pickup: T0 + 40 * M });
      return k;
    };
    const k = build();
    expect(k.state.lines.H!.station_id).toBe('S1');
    const fill = k.state;
    // S1's stored profile is patched full over H's window, so its re-plan finds no room there; S2 fits H in two rounds.
    const blocked: EngineState = deepFreeze({ ...fill, stations: { ...fill.stations, S1: { ...fill.stations.S1!, profile: { t: [T0, T0 + 35 * M, T0 + 40 * M], u: [4, 7, 0] } } } });
    const ev = capacity('S1', 4, T0 + S);
    const live = deepFreeze(applyEvent(blocked, deepFreeze(ev), { strict: false }));
    expect(live.lines.H!.station_id).toBe('S2');
    expect(live.diagnostics.filter((d) => d.kind === 'over_capacity')).toEqual([expect.objectContaining({ order_item_id: 'H', station_id: 'S2', detail: { units: 3, capacity: 2 } })]);
    const strictly = deepFreeze(applyEvent(blocked, deepFreeze(ev)));
    expect(strictly.lines.H!.station_id).toBe('S2');
    expect(strictly.diagnostics.filter((d) => d.kind === 'over_capacity')).toHaveLength(1);
  });

  it('[03a AD-4] a boost re-route onto a smaller station logs over_capacity there', () => {
    const k = new Kitchen([{ station_id: 'S1', capacity: 3 }, { station_id: 'S2', capacity: 2 }]);
    k.submit('O0', [{ id: 'Z', station: 'S1', cook: 40 * M, units: 3 }], T0);
    k.apply([fireEv('S1', 'Z', T0), startEv('O0', 'Z', T0)]);
    k.submit('O1', [{ id: 'H', station: 'S1', cook: 5 * M, units: 3, alternates: [{ station_id: 'S2', carry_ms: 0, home: false }] }], T0, { pickup: T0 + 60 * M });
    // S1 taken by a line fired early over H's slot: at the pickup (AD-29 Q11 B3) only S2 can land it.
    k.submit('O3', [{ id: 'Q', station: 'S1', cook: 130 * M, units: 3 }], T0, { pickup: T0 + 200 * M });
    k.apply([fireEv('S1', 'Q', T0), startEv('O3', 'Q', T0)]);
    expect(k.state.lines.H!.station_id).toBe('S1');
    const n = k.state.diagnostics.length;
    const s = k.apply([boost('O1', T0)]);
    expect(s.lines.H!.station_id).toBe('S2');
    expect(s.diagnostics.slice(n).filter((d) => d.kind === 'over_capacity')).toEqual([expect.objectContaining({ order_item_id: 'H', station_id: 'S2', detail: { units: 3, capacity: 2 } })]);
  });

  it('[03a §3.3] a StationCapacitySet naming an absent station is a no-op returning state itself', () => {
    const k = new Kitchen([SLOT(2)]);
    expect(applyEvent(k.state, capacity('NOPE', 1, T0))).toBe(k.state);
  });

  it('[03a §3.5.6] task 13: a capacity drop on a fryer with two hidden two-member loads: the members still share loads, no over-booking, rebuild = live', () => {
    const k = new Kitchen([{ station_id: 'F', station_type: 'batch', capacity: 4, freeze_ms: 60_000, freshness_window_ms: 60_000, programs: [{ program_id: 'P1', name: 'P', cook_time_ms: 999_999, is_archived: false }, { program_id: 'P2', name: 'Q', cook_time_ms: 999_999, is_archived: false }] }]);
    // Z (3 units, frozen): after the drop to 2 it takes two rounds and runs into both hidden loads.
    k.submit('OZ', [{ id: 'Z', program: 'P2', cook: 10 * M, units: 3 }], T0, { pickup: T0 + 10 * M });
    k.submit('O1', [{ id: 'A1', program: 'P1', cook: 5 * M }, { id: 'A2', program: 'P1', cook: 5 * M }], T0, { pickup: T0 + 16 * M });
    k.submit('O2', [{ id: 'B1', program: 'P1', cook: 5 * M }, { id: 'B2', program: 'P1', cook: 5 * M }], T0, { pickup: T0 + 22 * M });
    const before = k.state;
    expect(before.lines.A2!.load_id).toBe(before.lines.A1!.load_id);
    expect(before.lines.B2!.load_id).toBe(before.lines.B1!.load_id);
    const s = k.apply([capacity('F', 2, T0)]);
    expect(s.lines.Z!.fire_ms).toBe(T0);
    expect(liveInterval(s, 'Z', T0)).toEqual({ start: T0, end: T0 + 20 * M });
    // The members still share loads; each load stands alone on the station.
    expect(s.lines.A2!.load_id).toBe(s.lines.A1!.load_id);
    expect(s.lines.B2!.load_id).toBe(s.lines.B1!.load_id);
    expect(s.lines.A1!.load_id).not.toBe(s.lines.B1!.load_id);
    const loads = Object.values(s.stations.F!.loads).sort((a, b) => a.booked.start - b.booked.start);
    expect(loads.map((l) => l.order_item_ids.length).sort()).toEqual([1, 2, 2]);
    for (let i = 1; i < loads.length; i++) expect(loads[i]!.booked.start).toBeGreaterThanOrEqual(loads[i - 1]!.booked.end);
    for (const l of loads) expect(l.booked.units).toBe(2);
    expect(Math.max(...liveProfile(s, 'F', T0).u)).toBeLessThanOrEqual(2);
    expectProfileExact(s);
    expectRebuild(k);
  });
});

describe('@pos/engine day-open reset (§3.10, G4-1 #20, G4-2 #13)', () => {
  it('[03a #108] capacity_override and paused set at night are null / false after BusinessDayOpened; a reset from 40 to 30 re-plans the station and books no instant over 30', () => {
    const k = new Kitchen([SLOT(30)]);
    const night = T0;
    k.apply([capacity('S1', 40, night)]);
    k.submit('OA', [{ id: 'A', cook: 10 * M, units: 25 }], night + S, { pickup: night + S + 10 * M });
    k.submit('OB', [{ id: 'B', cook: 10 * M, units: 15 }], night + S, { pickup: night + S + 10 * M });
    k.submit('OH', [{ id: 'H', cook: 5 * M, units: 25 }], night + S, { pickup: night + 60 * M });
    expect(k.state.lines.A!.fire_ms).toBe(night + S);
    expect(k.state.lines.B!.fire_ms).toBe(night + S);
    const paused = deepFreeze({ ...k.state, stations: { ...k.state.stations, S1: { ...k.state.stations.S1!, paused: true } } });
    const before = k.state;
    const open = dayOpened(night + 2 * S);
    const s = deepFreeze(applyEvent(paused, deepFreeze(open)));
    expect(s.stations.S1).toMatchObject({ capacity_override: null, paused: false });
    expect(s.business_day!.business_date).toBe('2026-11-07');
    expect(s.lines.A).toEqual(before.lines.A);
    expect(s.lines.B).toMatchObject({ fire_ms: night + S + 10 * M, mark: 'moved' });
    expect(Math.max(...liveProfile(s, 'S1', night + 2 * S).u)).toBeLessThanOrEqual(30);
    expectProfileExact(s);
    k.apply([open]);
    expectRebuild(k);
  });

  it('[03a §3.10] a reset that does not change the effective capacity re-plans nothing (paused only; an override equal to the capacity)', () => {
    const k = new Kitchen([SLOT(2)]);
    k.submit('O1', [{ id: 'A', cook: 10 * M }], T0);
    const paused = deepFreeze({ ...k.state, stations: { ...k.state.stations, S1: { ...k.state.stations.S1!, paused: true, capacity_override: 2 } } });
    const s = applyEvent(paused, dayOpened(T0 + S));
    expect(s.stations.S1).toMatchObject({ capacity_override: null, paused: false });
    expect(s.lines).toBe(paused.lines);
    // No override anywhere: the stations are not copied.
    const plain = applyEvent(k.state, dayOpened(T0 + S));
    expect(plain.stations).toBe(k.state.stations);
  });
});

describe('@pos/engine disturbance invariants (§3.9, §3.10, D15)', () => {
  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let z = Math.imul(a ^ (a >>> 15), 1 | a);
      z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
  }

  const STATIONS: Array<Partial<StationCfg>> = [
    // keep 90 s on S1: older lines sit before their deadline, so a frozen line can be pushed past the freeze and stay on time.
    { station_id: 'S1', capacity: 4, freeze_ms: 120_000, min_slack_keep_ms: 90_000 },
    { station_id: 'S2', capacity: 2, freeze_ms: 120_000 },
    { station_id: 'F', station_type: 'batch', capacity: 4, freeze_ms: 120_000, freshness_window_ms: 2 * M, programs: [{ program_id: 'P1', name: 'P', cook_time_ms: 999_999, is_archived: false }, { program_id: 'P2', name: 'Q', cook_time_ms: 999_999, is_archived: false }] },
  ];

  // §3.4 oracle, slot stations: walking the frozen lines in (fire, id) order against what is fixed in the result, each
  // on-time line ends exactly at its earliest fit from its old fire (minimal); one pushed past its deadline went
  // through §3.5.6, so it is checked only for "never earlier" (above) and is left out of the walk, as §3.4 says.
  function expectFrozenMinimal(before: EngineState, s: EngineState, t: number, disturbed: ReadonlySet<string>, boosted: string | null, seed: number): void {
    for (const sid of disturbed) {
      const station = s.stations[sid]!;
      if (station.type !== 'slot') continue;
      const cap = effectiveCapacity(station);
      const isOurs = (id: string): boolean => s.lines[id]!.order_id !== boosted;
      let work = liveProfile(s, sid, t);
      for (const id of station.unfired) {
        const b = s.lines[id]!.booked;
        if (b !== null && isOurs(id)) work = removeInterval(work, b, b.units);
      }
      const frozen = before.stations[sid]!.unfired
        .map((id) => before.lines[id]!)
        .filter((l) => l.order_id !== boosted && l.booked !== null && l.fire_ms! <= t + 120_000)
        .filter((l) => s.lines[l.order_item_id] !== undefined);
      for (const l of frozen) {
        const a = s.lines[l.order_item_id]!;
        const expected = l.fire_ms! < t && latestFit(work, l.fire_ms!, l.fire_ms!, l.prep_ms, a.cook_ms, a.units, cap) === l.fire_ms ? l.fire_ms! : earliestFit(work, Math.max(l.fire_ms!, t), l.prep_ms, a.cook_ms, a.units, cap);
        if (expected !== l.fire_ms && expected > a.deadline_ms) continue; // the late set
        expect(a.fire_ms, `seed ${seed} frozen ${l.order_item_id} at t + ${t - T0}`).toBe(expected);
        work = addInterval(work, a.booked!, a.booked!.units);
      }
    }
  }

  it('[03a §3.9, §3.10] property over 50 seeds: no booking over capacity, fired and COOKING never move, boost changes only the boosted order\'s T and never a promise, frozen lines only later, rebuild = live, AD-7 exact', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rnd = mulberry32(seed * 7919);
      const ri = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
      const k = new Kitchen(STATIONS);
      let t = T0;
      let n = 0;
      const orders: string[] = [];
      for (let step = 0; step < 30; step++) {
        t += ri(0, 90) * S;
        const roll = rnd();
        const before = k.state;
        const disturbed = new Set<string>();
        let boosted: string | null = null;
        if (roll < 0.45 || orders.length === 0) {
          const id = `O${seed}_${n++}`;
          const items: Item[] = [];
          for (let j = ri(1, 3); j > 0; j--) {
            const kind = rnd();
            const iid = `${id}_${j}`;
            if (kind < 0.35) items.push({ id: iid, program: rnd() < 0.5 ? 'P1' : 'P2', cook: ri(2, 8) * M, units: ri(1, 2), mode: rnd() < 0.1 ? 'immediate' : 'sync' });
            else if (kind < 0.7) items.push({ id: iid, station: 'S1', cook: ri(2, 12) * M, prep: rnd() < 0.2 ? 30 * S : 0, units: ri(1, 3), early: ri(1, 5) * M, late: rnd() < 0.2 ? 5 * M : null, alternates: rnd() < 0.5 ? [{ station_id: 'S2', carry_ms: 0, home: false }] : [], mode: rnd() < 0.1 ? 'immediate' : 'sync' });
            else items.push({ id: iid, station: 'S2', cook: ri(2, 12) * M, units: ri(1, 2), early: ri(1, 5) * M, alternates: rnd() < 0.5 ? [{ station_id: 'S1', carry_ms: 0, home: false }] : [] });
          }
          k.submit(id, items, t, rnd() < 0.6 ? { pickup: t + ri(4, 30) * M } : {});
          orders.push(id);
          continue;
        }
        if (roll < 0.65) {
          const station_id = ['S1', 'S2', 'F'][ri(0, 2)]!;
          const cap = ri(1, 5);
          disturbed.add(station_id);
          k.apply([capacity(station_id, rnd() < 0.2 ? null : cap, t)]);
        } else if (roll < 0.85) {
          const oid = orders[ri(0, orders.length - 1)]!;
          if (k.state.orders[oid] === undefined) continue;
          boosted = oid;
          k.apply([boost(oid, t)]);
          for (const id of before.orders[oid]!.line_ids) {
            const was = before.lines[id];
            if (was === undefined || was.stage !== 'added' || was.fired_at !== null) continue;
            disturbed.add(was.station_id);
            disturbed.add(k.state.lines[id]!.station_id);
          }
          for (const o of Object.values(before.orders)) {
            const a = k.state.orders[o.order_id];
            if (a === undefined) continue;
            expect(a.promise_ms, `seed ${seed} promise of ${o.order_id}`).toBe(o.promise_ms);
            if (o.order_id !== oid) expect(a.target_land_ms, `seed ${seed} T of ${o.order_id}`).toBe(o.target_land_ms);
          }
        } else {
          // Fire (and maybe start) the first unfired slot line that is due.
          const station = before.stations[rnd() < 0.5 ? 'S1' : 'S2']!;
          const id = station.unfired[0];
          if (id !== undefined) {
            const l = before.lines[id]!;
            k.apply([fireEv(l.station_id, id, t)]);
            if (rnd() < 0.5) k.apply([startEv(l.order_id, id, t)]);
          }
          continue;
        }
        const s = k.state;
        for (const l of Object.values(before.lines)) {
          const a = s.lines[l.order_item_id];
          if (a === undefined) continue;
          // Fired and COOKING lines never move.
          if (l.fired_at !== null || l.stage !== 'added') {
            expect(a.fire_ms, `seed ${seed} ${l.order_item_id}`).toBe(l.fire_ms);
            expect(a.fired_at).toBe(l.fired_at);
            expect(a.started_at).toBe(l.started_at);
            expect(a.station_id).toBe(l.station_id);
          }
          // A frozen line of any order but the boosted one moves only later (§3.4; booking start: a joiner with more prep
          // may move a load's fire earlier, never its interval). A line that was marked keeps a mark.
          const was = l.booked ?? (l.load_id === null ? undefined : before.stations[l.station_id]!.loads[l.load_id]?.booked);
          const now = a.booked ?? (a.load_id === null ? undefined : s.stations[a.station_id]!.loads[a.load_id]?.booked);
          const frozen = l.stage === 'added' && l.fired_at === null && l.fire_ms !== null && l.fire_ms <= t + 120_000;
          if (frozen && l.order_id !== boosted && was !== undefined && now !== undefined) {
            expect(now.start, `seed ${seed} frozen ${l.order_item_id}`).toBeGreaterThanOrEqual(was.start);
            expect(a.station_id).toBe(l.station_id);
          }
          if (l.mark === 'moved') expect(a.mark === 'moved' || a.mark === 'boost').toBe(true);
        }
        expectNoOverbooking(s, t, disturbed);
        expectProfileExact(s);
        expectFrozenMinimal(before, s, t, disturbed, boosted, seed);
      }
      expectRebuild(k);
    }
  }, 120_000);
});

// ---- task 18d, developer ruling AD-29 Q11 -------------------------------------------------------------------------

describe('@pos/engine task 18d B3: a boost keeps the pickup floor (§3.5.1 step 4, §3.9; AD-29 Q11)', () => {
  it('[03a AD-29 Q11 B3] a boosted delivery with a far pickup lands at its pickup, not before', () => {
    const k = new Kitchen([SLOT(1)]);
    k.submit('O1', [{ id: 'A', cook: 5 * M }], at(0), { pickup: at(60) });
    const promise = k.state.orders.O1!.promise_ms;
    const s = k.apply([boost('O1', at(1))]);
    expect(s.orders.O1).toMatchObject({ boosted: true, target_land_ms: at(60), promise_ms: promise });
    expect(s.lines.A).toMatchObject({ mark: 'boost', fire_ms: at(55), booked: { start: at(55), end: at(60), units: 1 } });
    expectProfileExact(s);
    expectRebuild(k);
  });

  it('[03a AD-29 Q11 B3] with a near pickup the station cannot meet, the boost lands at the loop result', () => {
    const k = new Kitchen([SLOT(1)]);
    k.submit('OZ', [{ id: 'Z', cook: 20 * M, mode: 'immediate' }], at(0));
    k.apply([fireEv('S1', 'Z', at(0)), startEv('OZ', 'Z', at(0))]);
    k.submit('O1', [{ id: 'A', cook: 5 * M }], at(0), { pickup: at(10) });
    const s = k.apply([boost('O1', at(1))]);
    expect(s.orders.O1!.target_land_ms).toBe(at(25));
    expect(s.lines.A).toMatchObject({ mark: 'boost', fire_ms: at(20) });
    expectRebuild(k);
  });

  it('[03a AD-29 Q11 B3] a boost held to its pickup still re-places first and displaces the line in its way (§3.9)', () => {
    const k = new Kitchen([SLOT(1)]);
    k.submit('O2', [{ id: 'X', cook: 10 * M }], at(0), { pickup: at(30) });
    k.submit('O1', [{ id: 'A', cook: 10 * M }], at(0), { pickup: at(30) });
    const before = k.state;
    expect(before.orders.O1!.target_land_ms).toBeGreaterThan(at(30)); // X had the slot
    const s = k.apply([boost('O1', at(1))]);
    expect(s.orders.O1!.target_land_ms).toBe(at(30));
    expect(s.lines.A).toMatchObject({ mark: 'boost', fire_ms: at(20), booked: { start: at(20), end: at(30), units: 1 } });
    expect(s.lines.X!.booked!.start).toBeGreaterThanOrEqual(at(30));
    expect(s.orders.O2!.promise_ms).toBe(before.orders.O2!.promise_ms);
    expectNoOverbooking(s, at(1));
    expectProfileExact(s);
    expectRebuild(k);
  });

  it('[03a AD-29 Q11 B3] proposed reading: an immediate line of a boosted pickup order keeps its earliest fit, as at submit (§3.5.1 step 3)', () => {
    const k = new Kitchen([SLOT(2)]);
    k.submit('O1', [{ id: 'A', cook: 5 * M }, { id: 'I', cook: 2 * M, mode: 'immediate' }], at(0), { pickup: at(60) });
    const s = k.apply([boost('O1', at(1))]);
    expect(s.lines.A!.fire_ms).toBe(at(55));
    expect(s.lines.I!.fire_ms).toBe(at(1));
    expectRebuild(k);
  });
});

describe('@pos/engine task 18d P8: a return never queues (§3.8a Q15a, AD-29 Q11)', () => {
  type Pol = 'fifo' | 'edf' | 'waada_guard';
  function servedKitchen(policy: Pol, settings: Partial<Settings>, capacity_ = 1): Kitchen {
    const k = new Kitchen([{ station_id: 'S1', capacity: capacity_, policy, freeze_ms: 120_000 }], settings);
    k.submit('OS', [{ id: 'L1', cook: 5 * M }], at(0));
    k.apply([fireEv('S1', 'L1', at(0)), startEv('OS', 'L1', at(0)), orderEv('ItemDone', 'OS', { order_item_id: 'L1', done_at: at(5), source: 'tap' }, at(5)), orderEv('ItemServed', 'OS', { order_item_ids: ['L1'], source: 'tap' }, at(6))]);
    return k;
  }
  function sendBack(k: Kitchen, cook: number, t = at(10)): { plan: PlanResult; s: EngineState } {
    const plan = planOrder(k.state, proposedReturn(k, cook), t, {});
    const s = k.apply(aReturnLinesAdded(k.log.find((e) => e.event_type === 'ItemAdded')!, 'fix', { recorded_at: t, target_land_ms: plan.groups[0]!.target_land_ms, promise_ms: plan.groups[0]!.promise_ms, order_item_id: 'LR', adjust_time_ms: cook }));
    return { plan, s };
  }

  it.each<[Pol]>([['fifo'], ['edf'], ['waada_guard']])('[03a AD-29 Q11 P8] %s: the return goes at t, ahead of the queue; plan = fold; mark, boosted, T and P stay', (policy) => {
    const k = servedKitchen(policy, { returns_boost: true });
    k.submit('O2', [{ id: 'X', cook: 10 * M }], at(10));
    k.submit('O3', [{ id: 'Y', cook: 5 * M }], at(10));
    const before = k.state;
    expect(before.lines.X!.fire_ms).toBe(at(10));
    expect(before.lines.Y!.fire_ms).toBe(at(20));
    const { plan, s } = sendBack(k, 3 * M);
    expect(plan.lines[0]!.eta_ms).toBe(at(13));
    expect(s.lines.LR).toMatchObject({ mark: 'return', fire_ms: at(10), serve_mode: 'immediate', booked: { start: at(10), end: at(13), units: 1 } });
    expect(s.orders.OS!.boosted).toBe(false);
    expect(s.orders.OS!.target_land_ms).toBe(before.orders.OS!.target_land_ms);
    expect(s.orders.OS!.promise_ms).toBe(before.orders.OS!.promise_ms);
    // Displaced, never over-booked; other orders' T and P stay.
    expect(s.lines.X!.mark).toBe('moved');
    expect(s.lines.X!.booked!.start).toBeGreaterThanOrEqual(at(13));
    expect(s.orders.O2!.target_land_ms).toBe(before.orders.O2!.target_land_ms);
    expect(s.orders.O2!.promise_ms).toBe(before.orders.O2!.promise_ms);
    expect(s.orders.O3!.target_land_ms).toBe(before.orders.O3!.target_land_ms);
    expect(Math.max(...liveProfile(s, 'S1', at(10)).u)).toBeLessThanOrEqual(1);
    expectProfileExact(s);
    expectRebuild(k);
  });

  it.each<[Pol]>([['fifo'], ['edf'], ['waada_guard']])('[03a AD-29 Q11 P8] %s: an order the return pushes past the threshold slips on the next pass; one pushed less does not', (policy) => {
    const run = (cook: number): string[] => {
      const k = servedKitchen(policy, { returns_boost: true });
      k.submit('O2', [{ id: 'X', cook: 10 * M }], at(10));
      const { s } = sendBack(k, cook);
      expect(s.lines.X!.mark).toBe('moved');
      expect(s.slips).toEqual({});
      return getAlertIntents(s, at(10) + 1).slips.flatMap((x) => x.order_ids);
    };
    expect(run(5 * M)).toEqual(['O2']);
    expect(run(M)).toEqual([]);
  });

  it('[03a AD-29 Q11 P8] FIFO: displaced lines keep their order and move later only as far as needed; a hidden one is not marked', () => {
    const k = servedKitchen('fifo', { returns_boost: true });
    k.submit('O2', [{ id: 'X', cook: 10 * M }], at(10));
    k.submit('O3', [{ id: 'Y', cook: 5 * M }], at(10));
    const { s } = sendBack(k, 3 * M);
    expect(s.lines.X).toMatchObject({ fire_ms: at(13), deadline_ms: at(13), mark: 'moved' });
    expect(s.lines.Y).toMatchObject({ fire_ms: at(23), deadline_ms: at(23), mark: null });
    expectRebuild(k);
  });

  it('[03a AD-29 Q11 P8] FIFO with room beside the return: a line that still fits does not move', () => {
    const k = servedKitchen('fifo', { returns_boost: true }, 2);
    k.submit('O2', [{ id: 'X', cook: 10 * M }], at(10));
    k.submit('O3', [{ id: 'Y', cook: 10 * M }], at(10));
    const before = k.state;
    expect(before.lines.Y!.fire_ms).toBe(at(10));
    const { s } = sendBack(k, 3 * M);
    expect(s.lines.LR!.fire_ms).toBe(at(10));
    expect(s.lines.X).toEqual(before.lines.X);
    expect(s.lines.Y).toMatchObject({ fire_ms: at(13), deadline_ms: at(13), mark: 'moved' });
    expectProfileExact(s);
    expectRebuild(k);
  });

  it('[03a AD-29 Q11 P8] FIFO: the fired and COOKING lines stay; the return goes at the first room after them', () => {
    const k = servedKitchen('fifo', { returns_boost: true });
    k.submit('O2', [{ id: 'X', cook: 10 * M }], at(8));
    k.submit('O3', [{ id: 'Y', cook: 5 * M }], at(8));
    k.apply([fireEv('S1', 'X', at(8)), startEv('O2', 'X', at(8))]);
    const { s } = sendBack(k, 3 * M);
    expect(s.lines.X!.started_at).toBe(at(8));
    expect(s.lines.LR!.fire_ms).toBe(at(18));
    expect(s.lines.Y!.fire_ms).toBe(at(21));
    expectRebuild(k);
  });

  it('[03a AD-29 Q11 P8] a return may land on a FIFO alternate when that beats its home by min_gain_ms (the old filter left it out)', () => {
    const k = new Kitchen([{ station_id: 'S1', capacity: 1 }, { station_id: 'Q', capacity: 1, policy: 'fifo' }], { returns_boost: true, min_gain_ms: 60_000 });
    k.submit('OS', [{ id: 'L1', cook: 5 * M }], at(0));
    k.apply([fireEv('S1', 'L1', at(0)), startEv('OS', 'L1', at(0)), orderEv('ItemDone', 'OS', { order_item_id: 'L1', done_at: at(5), source: 'tap' }, at(5)), orderEv('ItemServed', 'OS', { order_item_ids: ['L1'], source: 'tap' }, at(6))]);
    k.submit('O2', [{ id: 'Z', cook: 30 * M }], at(10));
    k.apply([fireEv('S1', 'Z', at(10)), startEv('O2', 'Z', at(10))]);
    const base = proposedReturn(k, 3 * M);
    const plan = planOrder(k.state, { ...base, lines: base.lines.map((l) => ({ ...l, station_id: 'S1', alternates: [{ station_id: 'Q', carry_ms: 0, home: false }] })) }, at(10), {});
    expect(plan.lines[0]!.station_id).toBe('Q');
    expect(plan.lines[0]!.eta_ms).toBe(at(13));
    const r = plan.lines[0]!;
    const s = k.apply(aReturnLinesAdded(k.log.find((e) => e.event_type === 'ItemAdded')!, 'fix', { recorded_at: at(10), target_land_ms: plan.groups[0]!.target_land_ms, promise_ms: plan.groups[0]!.promise_ms, order_item_id: 'LR', adjust_time_ms: 3 * M, line: { station_id: r.station_id, alternates: r.alternates, carry_ms: r.carry_ms } }));
    expect(s.lines.LR).toMatchObject({ mark: 'return', station_id: 'Q', fire_ms: at(10), booked: { start: at(10), end: at(13), units: 1 } });
    expect(s.stations.Q!.unfired).toContain('LR');
    expect(s.lines.Z!.started_at).toBe(at(10));
    expectProfileExact(s);
    expectRebuild(k);
  });

  it('[03a AD-29 Q11 P8] a batch station on FIFO: the return forms its own load at t; the next load is pushed whole, only as far as needed', () => {
    const k = new Kitchen([{ station_id: 'F', station_type: 'batch', policy: 'fifo', capacity: 4, freeze_ms: 120_000, freshness_window_ms: 0, programs: [{ program_id: 'P1', name: 'P', cook_time_ms: 999_999, is_archived: false }] }], { returns_boost: true });
    k.submit('OS', [{ id: 'L1', program: 'P1', cook: 5 * M }], at(0));
    k.apply([fireEv('F', 'L1', at(0)), startEv('OS', 'L1', at(0)), orderEv('ItemDone', 'OS', { order_item_id: 'L1', done_at: at(5), source: 'tap' }, at(5)), orderEv('ItemServed', 'OS', { order_item_ids: ['L1'], source: 'tap' }, at(6))]);
    k.submit('O2', [{ id: 'X', program: 'P1', cook: 10 * M }], at(10));
    expect(k.state.lines.X!.fire_ms).toBe(at(10));
    const base = proposedReturn(k, 3 * M);
    const plan = planOrder(k.state, { ...base, lines: [{ ...base.lines[0]!, station_id: 'F', cook_ms_override: 3 * M }] }, at(10), {});
    expect(plan.lines[0]!.eta_ms).toBe(at(13));
    const s = k.apply(aReturnLinesAdded(k.log.find((e) => e.event_type === 'ItemAdded')!, 'fix', { recorded_at: at(10), target_land_ms: at(13), order_item_id: 'LR', adjust_time_ms: 3 * M }));
    expect(s.lines.LR).toMatchObject({ mark: 'return', fire_ms: at(10) });
    expect(s.lines.LR!.load_id).not.toBe(s.lines.X!.load_id);
    expect(s.lines.X).toMatchObject({ fire_ms: at(13), deadline_ms: at(13), mark: 'moved' });
    expectProfileExact(s);
    expectRebuild(k);
  });

  it.each<[Pol]>([['edf'], ['waada_guard']])('[03a AD-29 Q11 P8] %s, returns_boost false: §3.8a expedite stands, nothing is pushed', (policy) => {
    const k = servedKitchen(policy, { returns_boost: false });
    k.submit('O2', [{ id: 'X', cook: 10 * M }], at(10));
    const before = k.state;
    const { s } = sendBack(k, 3 * M);
    expect(s.lines.X).toEqual(before.lines.X);
    expect(s.lines.LR).toMatchObject({ mark: 'return', fire_ms: at(20) });
    expectRebuild(k);
  });

  it('[03a AD-29 Q11 P8] FIFO, returns_boost false: proposed reading, an ordinary immediate at its earliest fit; nothing is pushed', () => {
    const k = servedKitchen('fifo', { returns_boost: false });
    k.submit('O2', [{ id: 'X', cook: 10 * M }], at(10));
    const before = k.state;
    const { plan, s } = sendBack(k, 3 * M);
    expect(plan.lines[0]!.eta_ms).toBe(at(23));
    expect(s.lines.X).toEqual(before.lines.X);
    expect(s.lines.LR).toMatchObject({ mark: 'return', fire_ms: at(20) });
    expectRebuild(k);
  });

  it('[03a AD-29 Q11 P8] carried: a return pushed by a capacity drop on FIFO keeps its mark (§3.8a)', () => {
    const k = servedKitchen('fifo', { returns_boost: true }, 2);
    k.submit('O2', [{ id: 'Z', cook: 10 * M, mode: 'immediate' }], at(10));
    k.apply([fireEv('S1', 'Z', at(10)), startEv('O2', 'Z', at(10))]);
    sendBack(k, 3 * M);
    expect(k.state.lines.LR!.fire_ms).toBe(at(10));
    const s = k.apply([capacity('S1', 1, at(10))]);
    expect(s.lines.LR).toMatchObject({ fire_ms: at(20), mark: 'return' });
    expectRebuild(k);
  });
});

describe('@pos/engine task 18d P9: an expedite line keeps its follow-up weight (§3.5.2, AD-29 Q11)', () => {
  const released = (order_id: string, expedite: string[], t: number): PosEvent => orderEv('ItemsReleased', order_id, { order_id, alert_id: null, released: [], expedite }, t);

  it('[03a AD-29 Q11 P9] the ItemsReleased fold sets expedited; nothing else does', () => {
    const k = new Kitchen([SLOT(2)]);
    k.submit('O1', [{ id: 'A', cook: 5 * M }, { id: 'B', cook: 5 * M }], at(0), { pickup: at(40) });
    expect(k.state.lines.B!.expedited).toBe(false);
    const s = k.apply([released('O1', ['B'], at(1))]);
    expect(s.lines.B).toMatchObject({ expedited: true, mark: 'expedite' });
    expect(s.lines.A!.expedited).toBe(false);
    expectRebuild(k);
  });

  it('[03a AD-29 Q11 P9] expedite → boost: mark boost for the screen, follow-up weight for the plan; a later re-plan orders it first', () => {
    const k = new Kitchen([SLOT(2)]);
    k.submit('OZ', [{ id: 'Z1', cook: 30 * M, mode: 'immediate' }, { id: 'Z2', cook: 30 * M, mode: 'immediate' }], at(0));
    k.apply([fireEv('S1', 'Z1', at(0)), startEv('OZ', 'Z1', at(0)), fireEv('S1', 'Z2', at(0)), startEv('OZ', 'Z2', at(0))]);
    k.submit('OB', [{ id: 'B', cook: 5 * M }], at(1));
    k.apply([released('OB', ['B'], at(1)), boost('OB', at(1))]);
    k.submit('OA', [{ id: 'A', cook: 5 * M }], at(1));
    const s = k.state;
    expect(s.lines.B).toMatchObject({ mark: 'boost', expedited: true, fire_ms: at(30), deadline_ms: at(30) });
    expect(s.lines.A).toMatchObject({ fire_ms: at(30), deadline_ms: at(30), mark: null });
    expect(weightOf(s, s.lines.B!)).toBe(300);
    expect(weightOf(s, s.lines.A!)).toBe(100);
    // The view shows why it moved, unchanged.
    expect(stationPlan(s, 'S1', at(1)).lines.find((l) => l.order_item_id === 'B')!.mark).toBe('boost');
    // Same deadline, same wait: the weight decides who keeps the one unit left, not the id.
    const r = k.apply([capacity('S1', 1, at(2))]);
    expect(r.lines.B!.fire_ms).toBe(at(30));
    expect(r.lines.A!.fire_ms).toBe(at(35));
    expectNoOverbooking(r, at(2));
    expectRebuild(k);
  });

  it('[03a AD-29 Q11 P9] expedite → moved by a capacity change: mark moved, weight kept, replay = live', () => {
    const k = new Kitchen([SLOT(2)]);
    k.submit('OZ', [{ id: 'Z', cook: 10 * M, mode: 'immediate' }], at(0));
    k.apply([fireEv('S1', 'Z', at(0)), startEv('OZ', 'Z', at(0))]);
    k.submit('O1', [{ id: 'B', cook: 5 * M }], at(0));
    const s0 = k.apply([released('O1', ['B'], at(0))]);
    expect(s0.lines.B).toMatchObject({ mark: 'expedite', fire_ms: at(0) });
    const s = k.apply([capacity('S1', 1, at(0))]);
    expect(s.lines.B).toMatchObject({ mark: 'moved', expedited: true, fire_ms: at(10) });
    expect(weightOf(s, s.lines.B!)).toBe(300);
    expectRebuild(k);
  });
});

describe('@pos/engine task 18d P4: an oversize load counts its rounds everywhere (AD-4, AD-29 Q11)', () => {
  // 15 + 15 units at capacity 30, lowered to 20 while frozen: booked [+1, +21), T = +11.
  function oversize(o: { F?: Partial<StationCfg>; settings?: Partial<Settings> } = {}): { k: Kitchen; id: string; fired: EngineState; cooking: EngineState } {
    const k = new Kitchen([{ station_id: 'F', station_type: 'batch', capacity: 30, freeze_ms: 120_000, freshness_window_ms: 60_000, programs: [{ program_id: 'P1', name: 'P', cook_time_ms: 999_999, is_archived: false }], ...o.F }], o.settings ?? {});
    k.submit('O1', [{ id: 'A', program: 'P1', cook: 10 * M, units: 15 }, { id: 'B', program: 'P1', cook: 10 * M, units: 15 }], T0, { pickup: T0 + 11 * M });
    const id = k.state.lines.A!.load_id!;
    const s = k.apply([capacity('F', 20, T0)]);
    expect(s.stations.F!.loads[id]!.booked).toEqual({ start: T0 + M, end: T0 + 21 * M, units: 20 });
    const fired = k.apply([stamp(aFireDispatched({ stream_id: 'F', payload: { station_id: 'F', order_item_ids: ['A', 'B'], load_id: id, due_at: T0 + M, reason: 'scheduled' } }), T0 + M)]);
    const cooking = k.apply([startEv('O1', 'A', T0 + M), startEv('O1', 'B', T0 + M)]);
    return { k, id, fired, cooking };
  }
  const dones = (s: EngineState, now: number): number[] => getTickIntents(s, now).flatMap((d) => (d.event_type === 'ItemDone' ? [(d.payload as { done_at: number }).done_at] : []));

  it('[03a AD-29 Q11 P4] the fire stores the load\'s rounds on every member, from its booking', () => {
    const { fired } = oversize();
    expect(fired.lines.A!.rounds).toBe(2);
    expect(fired.lines.B!.rounds).toBe(2);
    expect(fired.stations.F!.profile).toEqual({ t: [], u: [] }); // AD-7: exactly its booking left
  });

  it('[03a AD-29 Q11 P4] a load within capacity stores one round; a line fired with no load stores none', () => {
    const k = new Kitchen([{ station_id: 'F', station_type: 'batch', capacity: 30, freeze_ms: 120_000, freshness_window_ms: 60_000, programs: [{ program_id: 'P1', name: 'P', cook_time_ms: 999_999, is_archived: false }] }, SLOT(1)]);
    k.submit('O1', [{ id: 'A', program: 'P1', cook: 10 * M, units: 10 }, { id: 'B', program: 'P1', cook: 10 * M, units: 10 }], T0);
    k.submit('O2', [{ id: 'S', cook: 5 * M }], T0);
    const id = k.state.lines.A!.load_id!;
    const f = k.apply([stamp(aFireDispatched({ stream_id: 'F', payload: { station_id: 'F', order_item_ids: ['A', 'B'], load_id: id, due_at: T0, reason: 'scheduled' } }), T0), fireEv('S1', 'S', T0)]);
    expect(f.lines.A!.rounds).toBe(1);
    expect(f.lines.S!.rounds).toBeNull();
  });

  it('[03a AD-29 Q11 P4] 15 + 15, capacity 30 → 20: live interval, slip estimate, inferred Done and the cascade all read +21', () => {
    const { k, cooking } = oversize({ F: { completion_mode: 'auto_done' } });
    expect(liveInterval(cooking, 'A', T0 + M)).toEqual({ start: T0 + M, end: T0 + 21 * M });
    // Slip: T = +11, threshold 2 min: the estimate is the booked land, not one round.
    expect(getAlertIntents(cooking, T0 + 2 * M).slips[0]!.estimate).toBe(T0 + 21 * M);
    // Inferred Done at +21, not at +11; nextDueAt agrees.
    expect(dones(cooking, T0 + 21 * M - 1)).toEqual([]);
    expect(dones(cooking, T0 + 21 * M)).toEqual([T0 + 21 * M, T0 + 21 * M]);
    expect(nextDueAt(cooking, T0 + 12 * M)).toBe(T0 + 21 * M);
    expect(dones(cooking, T0 + 12 * M)).toEqual([]); // one round would be past its end here
    expectRebuild(k);
  });

  it('[03a AD-29 Q11 P4] the cascade reads the rounds: no overrun before +21, though a line fired behind the load overlaps a reservation; a shift after it', () => {
    const programs = ['P1', 'P2', 'P3'].map((program_id) => ({ program_id, name: program_id, cook_time_ms: 999_999, is_archived: false }));
    const { k } = oversize({ F: { programs } });
    k.submit('O2', [{ id: 'C', program: 'P1', cook: 5 * M, units: 1 }], T0 + M);
    k.submit('O3', [{ id: 'D', program: 'P2', cook: 5 * M, units: 1 }], T0 + M);
    k.submit('O4', [{ id: 'E', program: 'P3', cook: 5 * M, units: 1 }], T0 + M);
    expect(k.state.stations.F!.loads[k.state.lines.C!.load_id!]!.booked.start).toBe(T0 + 21 * M);
    expect(k.state.stations.F!.loads[k.state.lines.E!.load_id!]!.booked.start).toBe(T0 + 31 * M);
    const loadD = k.state.lines.D!.load_id!;
    const s = k.apply([stamp(aFireDispatched({ stream_id: 'F', payload: { station_id: 'F', order_item_ids: ['D'], load_id: loadD, due_at: T0 + 2 * M, reason: 'pulled' } }), T0 + 2 * M)]);
    expect(liveInterval(s, 'D', T0 + 12 * M)).toEqual({ start: T0 + 21 * M, end: T0 + 26 * M }); // over C's reservation
    const shifted = (now: number): string[] =>
      getTickIntents(s, now).flatMap((d) => (d.event_type === 'ReservationsShifted' ? (d.payload as { shifts: Array<{ order_item_id: string }> }).shifts.map((x) => x.order_item_id) : []));
    expect(shifted(T0 + 12 * M)).toEqual([]);
    expect(shifted(T0 + 21 * M)).toEqual([]);
    // Past +21 the load overruns: C fires, D and C pack behind it and reach E's reservation.
    expect(shifted(T0 + 21 * M + 1)).toEqual(['E']);
    expectRebuild(k);
  });

  it('[03a AD-29 Q11 P4] a member Done at +11 leaves +21 for the other (estimate, Done, a new placement)', () => {
    const { k } = oversize({ F: { completion_mode: 'auto_done' } });
    const s = k.apply([orderEv('ItemDone', 'O1', { order_item_id: 'A', done_at: T0 + 11 * M, source: 'tap' }, T0 + 11 * M)]);
    expect(liveInterval(s, 'B', T0 + 11 * M)).toEqual({ start: T0 + M, end: T0 + 21 * M });
    expect(dones(s, T0 + 21 * M - 1)).toEqual([]);
    expect(dones(s, T0 + 21 * M)).toEqual([T0 + 21 * M]);
    expect(liveProfile(s, 'F', T0 + 11 * M)).toEqual({ t: [T0 + M, T0 + 21 * M], u: [20, 0] });
    expectRebuild(k);
  });

  it('[03a AD-29 Q11 P4] a fired, not started member Done at +11 does not shorten the other either', () => {
    const { k, fired } = oversize();
    expect(liveInterval(fired, 'A', T0 + M)).toEqual({ start: T0 + M, end: T0 + 21 * M });
    const s = k.apply([orderEv('ItemDone', 'O1', { order_item_id: 'A', done_at: T0 + 11 * M, source: 'tap' }, T0 + 11 * M)]);
    expect(liveInterval(s, 'B', T0 + 11 * M)!.end).toBe(T0 + 21 * M);
  });

  it('[03a AD-29 Q11 P4] the abandon clock reads the rounds too: the order stays until +21', () => {
    const { cooking } = oversize({ settings: { order_abandon_ms: 5 * M } });
    expect(isOrderInEngine(cooking, 'O1', T0 + 12 * M)).toBe(true);
    expect(isOrderInEngine(cooking, 'O1', T0 + 21 * M)).toBe(false);
  });

  // Review round 1: a Start with no FireDispatched takes the line out of the load, so the rounds are stored there too.
  describe('a Start before the fire', () => {
    function unfired(): { k: Kitchen; id: string } {
      const k = new Kitchen([{ station_id: 'F', station_type: 'batch', capacity: 30, freeze_ms: 120_000, freshness_window_ms: 60_000, programs: [{ program_id: 'P1', name: 'P', cook_time_ms: 999_999, is_archived: false }] }]);
      k.submit('O1', [{ id: 'A', program: 'P1', cook: 10 * M, units: 15 }, { id: 'B', program: 'P1', cook: 10 * M, units: 15 }], T0, { pickup: T0 + 11 * M });
      const id = k.state.lines.A!.load_id!;
      k.apply([capacity('F', 20, T0)]);
      return { k, id };
    }

    it('[03a AD-29 Q11 P4] one member started: it stores the rounds, its live end is +21, the other stays in the load', () => {
      const { k, id } = unfired();
      const s = k.apply([startEv('O1', 'A', T0 + M)]);
      expect(s.lines.A).toMatchObject({ stage: 'cooking', rounds: 2, fired_at: null });
      expect(s.lines.B!.rounds).toBeNull();
      expect(s.stations.F!.loads[id]!.order_item_ids).toEqual(['B']);
      expect(liveInterval(s, 'A', T0 + M)).toEqual({ start: T0 + M, end: T0 + 21 * M });
      expectProfileExact(s);
      expectRebuild(k);
    });

    it('[03a AD-29 Q11 P4] both members started: the load is gone, the station stays occupied to +21', () => {
      const { k, id } = unfired();
      const s = k.apply([startEv('O1', 'A', T0 + M), startEv('O1', 'B', T0 + M)]);
      expect(s.stations.F!.loads[id]).toBeUndefined();
      expect(s.lines.A!.rounds).toBe(2);
      expect(s.lines.B!.rounds).toBe(2);
      expect(liveInterval(s, 'A', T0 + M)).toEqual({ start: T0 + M, end: T0 + 21 * M });
      expect(liveInterval(s, 'B', T0 + M)).toEqual({ start: T0 + M, end: T0 + 21 * M });
      expect(liveProfile(s, 'F', T0 + 12 * M)).toEqual({ t: [T0 + M, T0 + 21 * M], u: [20, 0] });
      expectRebuild(k);
    });

    it('[03a AD-29 Q11 P4] a member Done with no Start, then undone: it keeps the load\'s rounds too', () => {
      const { k } = unfired();
      k.apply([orderEv('ItemDone', 'O1', { order_item_id: 'A', done_at: T0 + 2 * M, source: 'tap' }, T0 + 2 * M)]);
      const s = k.apply([orderEv('ItemDoneUndone', 'O1', { order_item_id: 'A' }, T0 + 2 * M)]);
      expect(s.lines.A).toMatchObject({ stage: 'cooking', rounds: 2 });
      expect(liveInterval(s, 'A', T0 + 2 * M)!.end).toBe(T0 + 22 * M);
      expectRebuild(k);
    });

    it('[03a AD-4] a line with no stored load started before the fire stores no rounds', () => {
      const k = new Kitchen([SLOT(1)]);
      k.submit('O1', [{ id: 'A', cook: 5 * M }], T0);
      expect(k.apply([startEv('O1', 'A', T0)]).lines.A!.rounds).toBeNull();
    });
  });

  it('[03a AD-29 Q11 P4] the rounds count only lines the fire really fires: an already-fired line re-listed does not raise them', () => {
    const programs = ['P1', 'P2'].map((program_id) => ({ program_id, name: program_id, cook_time_ms: 999_999, is_archived: false }));
    const k = new Kitchen([{ station_id: 'F', station_type: 'batch', capacity: 20, freeze_ms: 120_000, freshness_window_ms: 60_000, programs }]);
    k.submit('O1', [{ id: 'E', program: 'P2', cook: 10 * M, units: 15 }], T0);
    k.apply([stamp(aFireDispatched({ stream_id: 'F', payload: { station_id: 'F', order_item_ids: ['E'], load_id: k.state.lines.E!.load_id!, due_at: T0, reason: 'scheduled' } }), T0)]);
    k.submit('O2', [{ id: 'A', program: 'P1', cook: 10 * M, units: 15 }], T0);
    const id = k.state.lines.A!.load_id!;
    const f = k.apply([stamp(aFireDispatched({ stream_id: 'F', payload: { station_id: 'F', order_item_ids: ['A', 'E'], load_id: id, due_at: T0 + M, reason: 'scheduled' } }), T0 + M)]);
    expect(f.lines.A!.rounds).toBe(1);
    expect(f.lines.E!.rounds).toBe(1);
    expectRebuild(k);
  });

  it('[03a AD-29 Q11 P4] the abandon clock reads the stored rounds at capacity 0 too, as slip and tick do', () => {
    const { k } = oversize({ settings: { order_abandon_ms: 5 * M } });
    const s = k.apply([capacity('F', 0, T0 + 2 * M)]);
    expect(isOrderInEngine(s, 'O1', T0 + 12 * M)).toBe(true);
    expect(isOrderInEngine(s, 'O1', T0 + 21 * M)).toBe(false);
  });

  it('[03a AD-29 Q11 P4] proposed reading: a capacity change after the fire leaves the stored rounds (fired and COOKING stay fixed, §3.10)', () => {
    const { k } = oversize();
    const s = k.apply([capacity('F', 30, T0 + 2 * M)]);
    expect(s.lines.A!.rounds).toBe(2);
    expect(liveInterval(s, 'A', T0 + 2 * M)).toEqual({ start: T0 + M, end: T0 + 21 * M });
  });

  it('[03a AD-29 Q11 P4] proposed reading: a partial void after the fire leaves the rounds; a line pulled in on the fire may raise them', () => {
    const { k } = oversize();
    const v = k.apply([orderEv('ItemVoided', 'O1', { order_item_id: 'A', units: 10 }, T0 + 2 * M)]);
    expect(v.lines.A).toMatchObject({ units: 5, rounds: 2 });
    expect(liveInterval(v, 'A', T0 + 2 * M)!.end).toBe(T0 + 21 * M);

    const p = new Kitchen([{ station_id: 'F', station_type: 'batch', capacity: 30, freeze_ms: 120_000, freshness_window_ms: 60_000, programs: [{ program_id: 'P1', name: 'P', cook_time_ms: 999_999, is_archived: false }] }]);
    p.submit('O1', [{ id: 'A', program: 'P1', cook: 10 * M, units: 15 }, { id: 'B', program: 'P1', cook: 10 * M, units: 15 }], T0);
    p.submit('O2', [{ id: 'C', program: 'P1', cook: 10 * M, units: 10 }], T0);
    const id = p.state.lines.A!.load_id!;
    expect(p.state.lines.C!.load_id).not.toBe(id);
    const f = p.apply([stamp(aFireDispatched({ stream_id: 'F', payload: { station_id: 'F', order_item_ids: ['A', 'B', 'C'], load_id: id, due_at: T0, reason: 'scheduled' } }), T0)]);
    expect(f.lines.C!.rounds).toBe(2);
    expect(liveInterval(f, 'C', T0)!.end).toBe(T0 + 20 * M);
    expectRebuild(p);
  });

  it('[03a AD-29 Q11 P4] proposed reading: a member voided before the fire leaves the booking, so the rounds stay with it', () => {
    const k = new Kitchen([{ station_id: 'F', station_type: 'batch', capacity: 30, freeze_ms: 120_000, freshness_window_ms: 60_000, programs: [{ program_id: 'P1', name: 'P', cook_time_ms: 999_999, is_archived: false }] }]);
    k.submit('O1', [{ id: 'A', program: 'P1', cook: 10 * M, units: 15 }, { id: 'B', program: 'P1', cook: 10 * M, units: 15 }], T0, { pickup: T0 + 11 * M });
    const id = k.state.lines.A!.load_id!;
    k.apply([capacity('F', 20, T0)]);
    const v = k.apply([orderEv('ItemVoided', 'O1', { order_item_id: 'A', units: 15 }, T0 + 30 * S)]);
    const booked = v.stations.F!.loads[id]!.booked;
    const f = k.apply([stamp(aFireDispatched({ stream_id: 'F', payload: { station_id: 'F', order_item_ids: ['B'], load_id: id, due_at: T0 + M, reason: 'scheduled' } }), T0 + M)]);
    expect(f.lines.B!.rounds).toBe(2);
    expect(liveInterval(f, 'B', T0 + M)!.end).toBe(booked.end);
  });
});
