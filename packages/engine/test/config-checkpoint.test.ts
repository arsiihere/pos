// 03a task 17: the EngineConfigApplied effects of §3.11 (capacity, cook time, archive, station type, policy) and the
// D26 checkpoint of §3.12 (toCheckpoint / fromCheckpoint, P-8).
import { parseEvent, type ConfigStockItem, type EngineConfig, type EventDraft, type ItemAddedPayload, type PosEvent } from '@pos/events';
import {
  aBusinessDayClosed,
  aBusinessDayOpened,
  anAlertClosed,
  anEngineConfigApplied,
  anItemAdded,
  anItemStarted,
  anOrderBatch,
  aStockAdded,
  aStockReleased,
  aStockSet,
} from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  buildEngineState,
  fromCheckpoint,
  getAlertIntents,
  getTickIntents,
  initialEngineState,
  liveInterval,
  noOrderInEngine,
  planOrder,
  stockEffects,
  toCheckpoint,
  type EngineCheckpointV1,
  type EngineState,
  type PlanResult,
  type ProposedOrder,
  type StockCtx,
} from '../src/index';
import { liveProfile } from '../src/live';
import { placeFrozen } from '../src/replan';
import { routeCtx, routeOptions } from '../src/route';
import type { Profile } from '../src/state';

const T0 = 1_761_000_000_000;
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
const stamp = (e: PosEvent, at: number): PosEvent => {
  const s = nextSeq();
  return { ...e, recorded_at: at, occurred_at: at, seq: s, event_id: `01J${String(s).padStart(23, '0')}` };
};

const PROGRAMS = [{ program_id: 'P1', name: 'Fry', cook_time_ms: 999_999, is_archived: false }];
const slotF: Partial<StationCfg> = { station_id: 'F', station_type: 'slot', capacity: 2 };
const batchF: Partial<StationCfg> = { station_id: 'F', station_type: 'batch', capacity: 2, freshness_window_ms: 0, programs: PROGRAMS };

function config(stations: Array<Partial<StationCfg>>, at: number, settings: Partial<Settings> = {}): PosEvent {
  return stamp(anEngineConfigApplied({ payload: { config_version: nextSeq(), stations: stations.map((s) => ({ ...BASE.stations[0]!, ...s })), settings: { ...BASE.settings, ...settings } } }), at);
}

type Item = {
  id: string;
  station?: string;
  cook: number;
  prep?: number;
  units?: number;
  mode?: 'sync' | 'immediate';
  early?: number;
  program?: string;
  alternates?: Array<{ station_id: string; carry_ms: number; home: boolean }>;
  draws?: Array<{ stock_item_id: string; quantity: number }>;
  stock_cook?: number;
  point?: string;
  carry?: number;
  max_carry?: number;
};
type OrderOpts = { pickup?: number; reserved?: Array<{ stock_item_id: string; order_item_id: string; quantity: number }> };

function itemFields(i: Item): Record<string, unknown> {
  const stock = i.draws === undefined ? {} : { stock_draws: i.draws, stock_time_ms: i.stock_cook ?? null };
  return i.program === undefined
    ? { station_id: i.station ?? 'F', cook_time_ms: i.cook, prep_buffer_ms: i.prep ?? 0, serve_mode: i.mode ?? 'sync', quantity: i.units ?? 1, ...stock }
    : { station_id: i.station ?? 'F', program_id: i.program, program_cook_time_ms: i.cook, cook_time_ms: 999_999, prep_buffer_ms: i.prep ?? 0, serve_mode: i.mode ?? 'sync', quantity: i.units ?? 1, ...stock };
}

function proposed(order_id: string, items: Item[], o: OrderOpts): ProposedOrder {
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
      point_id: i.point ?? null,
      carry_ms: i.carry ?? 0,
      weight_pct: 100,
      max_early_ms: i.early ?? 3_600_000,
      max_late_ms: null,
      max_carry_ms: i.max_carry ?? null,
      cook_ms_override: null,
      return_of: null,
    })),
  });
}

class Kitchen {
  log: PosEvent[] = [];
  state: EngineState = deepFreeze(initialEngineState());
  apply(...events: PosEvent[]): EngineState {
    for (const e of events) {
      this.log.push(e);
      this.state = deepFreeze(applyEvent(this.state, deepFreeze(e)));
    }
    return this.state;
  }
  submit(order_id: string, items: Item[], now: number, o: OrderOpts = {}): PlanResult {
    const from_stock = Object.fromEntries((o.reserved ?? []).map((r) => [r.order_item_id, true]));
    const prop = proposed(order_id, items, o);
    const plan = planOrder(this.state, prop, now, from_stock);
    this.apply(
      ...anOrderBatch({
        order_id,
        recorded_at: now,
        seq: nextSeq(items.length + (o.reserved?.length ?? 0)),
        lines: items.map((i) => {
          const r = plan.lines.find((l) => l.order_item_id === i.id)!;
          const p = prop.lines.find((l) => l.order_item_id === i.id)!;
          return {
            order_item_id: i.id,
            item: itemFields(i),
            line: { station_id: r.station_id, alternates: r.alternates, point_id: p.point_id, carry_ms: r.carry_ms, max_early_ms: p.max_early_ms, max_late_ms: null, max_carry_ms: p.max_carry_ms, from_stock: from_stock[i.id] === true },
          };
        }),
        order: { order_type: o.pickup === undefined ? 'dine_in' : 'delivery', table_id: null, table_key: `t:${order_id}`, pickup_at_ms: o.pickup ?? null, follow_up: false, groups: plan.groups },
        ...(o.reserved === undefined ? {} : { reserved: o.reserved }),
      }),
    );
    return plan;
  }
  fireAll(at: number): void {
    const env = anItemStarted();
    for (const d of getTickIntents(this.state, at)) this.apply(stamp({ ...env, ...d, payload: d.payload as Record<string, unknown> } as PosEvent, at));
  }
}

const ENV = anItemStarted();
const ev = (event_type: string, order_id: string, payload: Record<string, unknown>, at: number): PosEvent => stamp({ ...ENV, event_type, stream_id: order_id, payload }, at);
const started = (o: string, id: string, at: number): PosEvent => ev('ItemStarted', o, { order_item_id: id, started_at: at, source: 'tap' }, at);
const done = (o: string, id: string, at: number): PosEvent => ev('ItemDone', o, { order_item_id: id, source: 'tap' }, at);
const served = (o: string, ids: string[], at: number): PosEvent => ev('ItemServed', o, { order_item_ids: ids, source: 'tap' }, at);
const voided = (o: string, id: string, units: number, at: number): PosEvent => ev('ItemVoided', o, { order_item_id: id, units }, at);
const boosted = (o: string, at: number): PosEvent => ev('OrderBoosted', o, { order_id: o }, at);
const stationEv = (event_type: string, sid: string, payload: Record<string, unknown>, at: number): PosEvent => stamp({ ...anEngineConfigApplied(), event_type, stream_id: sid, payload }, at);
const open = (at: number, date = '2025-10-21'): PosEvent => stamp(aBusinessDayOpened({ payload: { business_date: date, stock_units: { KB: 'piece' }, draws: {} } }), at);
const closed = (at: number): PosEvent => stamp(aBusinessDayClosed(), at);
const stockSet = (id: string, on_hand: number, at: number): PosEvent => stamp(aStockSet({ stream_id: id, payload: { stock_item_id: id, on_hand, unit: 'piece' } }), at);

// The state as compared: diagnostics are host scratch (AD-6).
function comparable(s: EngineState): Omit<EngineState, 'diagnostics'> {
  const { diagnostics, ...rest } = s;
  void diagnostics;
  return rest;
}
const maxUnits = (p: Profile): number => Math.max(0, ...p.u);
const replayEquals = (k: Kitchen): void => expect(comparable(buildEngineState(k.log))).toEqual(comparable(k.state));

describe('§3.11 EngineConfigApplied effects', () => {
  it('[03a #53] a capacity change re-plans the station, frozen lines too (no booking over the new capacity; moved frozen marked)', () => {
    const k = new Kitchen();
    k.apply(config([{ station_id: 'F', capacity: 2 }], T0 - 60 * M));
    k.submit('O1', [{ id: 'a', cook: 10 * M, mode: 'sync' }], T0);
    k.submit('O2', [{ id: 'b', cook: 10 * M, mode: 'sync' }], T0);
    const fa = k.state.lines.a!.fire_ms!;
    expect(k.state.lines.b!.fire_ms).toBe(fa);
    expect(fa).toBeLessThanOrEqual(T0 + 2 * M); // both frozen, side by side on two units
    const s = k.apply(config([{ station_id: 'F', capacity: 1 }], T0 + 1));
    expect(maxUnits(s.stations.F!.profile)).toBe(1);
    const moved = [s.lines.a!, s.lines.b!].filter((l) => l.fire_ms !== fa);
    expect(moved).toHaveLength(1);
    expect(moved[0]!.mark).toBe('moved');
    expect(moved[0]!.fire_ms!).toBeGreaterThan(fa);
    replayEquals(k);
  });

  it('[03a #53] a program cook-time / item-knob / padding change affects new orders only: open lines and profiles keep their D25 copies', () => {
    const k = new Kitchen();
    k.apply(config([batchF, { station_id: 'S1' }], T0 - 60 * M));
    k.submit('O1', [{ id: 'a', cook: 10 * M, program: 'P1' }], T0, { pickup: T0 + 60 * M });
    k.submit('O2', [{ id: 's', station: 'S1', cook: 10 * M }], T0, { pickup: T0 + 60 * M });
    const before = k.state;
    const s = k.apply(
      config(
        [
          { ...batchF, programs: [{ ...PROGRAMS[0]!, cook_time_ms: 123 }], reference_cook_ms: 123, promise_padding_ms: 5 },
          { station_id: 'S1', reference_cook_ms: 123 },
        ],
        T0 + 1,
        { promise_padding_dine_in_ms: 7, weight_dine_in_pct: 300 },
      ),
    );
    expect(Object.is(s.lines, before.lines)).toBe(true);
    expect(Object.is(s.stations.F, before.stations.F)).toBe(true);
    expect(Object.is(s.stations.S1, before.stations.S1)).toBe(true);
    // A new line brings its own copy of the new cook time (ItemAdded, §3.2), joining no longer with the old cook.
    k.submit('O3', [{ id: 'b', cook: 3 * M, program: 'P1' }], T0 + 2, { pickup: T0 + 60 * M });
    expect(k.state.lines.a!.cook_ms).toBe(10 * M);
    expect(k.state.lines.b!.cook_ms).toBe(3 * M);
    expect(k.state.lines.b!.load_id).not.toBe(k.state.lines.a!.load_id);
    replayEquals(k);
  });

  it('[03a #53] an archived station: open lines complete normally (fire, start, done, served; hidden ones still re-plan on it)', () => {
    const k = new Kitchen();
    k.apply(config([{ station_id: 'F', capacity: 1 }], T0 - 60 * M));
    k.submit('O1', [{ id: 'a', cook: 10 * M, mode: 'immediate' }], T0);
    k.submit('O2', [{ id: 'b', cook: 10 * M }], T0, { pickup: T0 + 60 * M });
    const fb = k.state.lines.b!.fire_ms!;
    const s = k.apply(config([{ station_id: 'F', capacity: 1, is_archived: true }], T0 + 1));
    expect(s.lines.b!.fire_ms).toBe(fb);
    k.fireAll(T0 + 2);
    k.apply(started('O1', 'a', T0 + 3), done('O1', 'a', T0 + 10 * M), served('O1', ['a'], T0 + 11 * M));
    expect(k.state.lines.a!.stage).toBe('served');
    k.fireAll(fb);
    expect(k.state.lines.b!.fired_at).toBe(fb);
    k.apply(started('O2', 'b', fb), done('O2', 'b', fb + 10 * M), served('O2', ['b'], fb + 11 * M));
    expect(k.state.lines.b!.stage).toBe('served');
    expect(k.state.stations.F!.profile).toEqual({ t: [], u: [] });
    replayEquals(k);
  });

  it('[03a #53] an archived station: no new line routes there, and a hidden line is not re-routed onto it', () => {
    const stations = (archived: boolean): Array<Partial<StationCfg>> => [
      { station_id: 'A', capacity: 1 },
      { station_id: 'B', capacity: 1, is_archived: archived },
    ];
    const alt = [{ station_id: 'B', carry_ms: 0, home: false }];
    // New line: A is busy, B is free. Not archived it takes B; archived it waits on A.
    const fresh = (archived: boolean): string => {
      const k = new Kitchen();
      k.apply(config(stations(archived), T0 - 60 * M));
      k.submit('O1', [{ id: 'x', station: 'A', cook: 30 * M, mode: 'immediate' }], T0);
      k.submit('O2', [{ id: 'n', station: 'A', cook: 5 * M, mode: 'immediate', alternates: alt }], T0 + 1);
      return k.state.lines.n!.station_id;
    };
    expect(fresh(false)).toBe('B');
    expect(fresh(true)).toBe('A');
    // Hidden line: its allowed stations in a re-plan (a re-route, §3.5.5 D10, reads these); on an archived station it stays.
    const placed = (archived: string | null): string[] => {
      const k = new Kitchen();
      k.apply(config([{ station_id: 'A', capacity: 1 }, { station_id: 'B', capacity: 1 }], T0 - 60 * M));
      k.submit('O1', [{ id: 'h', station: 'A', cook: 10 * M, early: 5 * M, alternates: alt }], T0, { pickup: T0 + 60 * M });
      const station_id = k.state.lines.h!.station_id;
      expect(station_id).toBe('A');
      k.apply(config([{ station_id: 'A', capacity: 1, is_archived: archived === 'A' }, { station_id: 'B', capacity: 1, is_archived: archived === 'B' }], T0 + 1));
      return routeOptions(routeCtx(k.state), k.state.lines.h!, true).map((o) => o.station_id);
    };
    expect(placed(null).sort()).toEqual(['A', 'B']);
    expect(placed('B')).toEqual(['A']);
    // A line already on the archived station keeps it (open lines complete) and may still leave it.
    expect(placed('A').sort()).toEqual(['A', 'B']);
  });

  it('[03a §3.11] policy, freeze, keep take effect from the next re-plan: the config fold itself moves nothing', () => {
    const k = new Kitchen();
    k.apply(config([{ station_id: 'F', capacity: 1 }], T0 - 60 * M));
    k.submit('O1', [{ id: 'a', cook: 10 * M }], T0, { pickup: T0 + 60 * M });
    const before = k.state;
    const s = k.apply(config([{ station_id: 'F', capacity: 1, policy: 'edf', freeze_ms: 0, min_slack_keep_ms: 0 }], T0 + 1));
    expect(Object.is(s.lines, before.lines)).toBe(true);
    expect(Object.is(s.stations.F, before.stations.F)).toBe(true);
    // The next re-plan reads keep = 0 on EDF: the hidden line's latest fit is its deadline.
    k.submit('O2', [{ id: 'b', cook: 1 * M }], T0 + 2, { pickup: T0 + 30 * M });
    expect(k.state.lines.a!.fire_ms).toBe(k.state.lines.a!.deadline_ms);
    replayEquals(k);
  });

  it('[03a §3.11] FIFO → Waada Guard: a line placed under FIFO keeps deadline = fire (no recompute in the fold); the next re-plan treats it as a held line, never later than that', () => {
    const k = new Kitchen();
    k.apply(config([{ station_id: 'F', capacity: 1, policy: 'fifo' }], T0 - 60 * M));
    k.submit('O0', [{ id: 'z', cook: 30 * M }], T0);
    k.submit('O1', [{ id: 'a', cook: 10 * M, early: 20 * M }], T0 + 1);
    const a = k.state.lines.a!;
    expect(a.deadline_ms).toBe(a.fire_ms);
    const s = k.apply(config([{ station_id: 'F', capacity: 1, policy: 'waada_guard' }], T0 + 2));
    expect(Object.is(s.lines.a, a)).toBe(true);
    k.submit('O2', [{ id: 'b', cook: 1 * M }], T0 + 3, { pickup: T0 + 300 * M });
    expect(k.state.lines.a!.deadline_ms).toBe(a.deadline_ms);
    expect(k.state.lines.a!.fire_ms!).toBeLessThanOrEqual(a.fire_ms!);
    replayEquals(k);
  });

  it('[03a §3.11] a new station appears with an empty profile; slip_threshold and order_abandon changes reach the readers without moving a line', () => {
    const k = new Kitchen();
    k.apply(config([{ station_id: 'F' }], T0 - 60 * M));
    k.submit('O1', [{ id: 'a', cook: 10 * M, mode: 'immediate' }], T0);
    const before = k.state.lines;
    const s = k.apply(config([{ station_id: 'F' }, { station_id: 'N', station_type: 'batch', capacity: 3, programs: PROGRAMS, freshness_window_ms: 0 }], T0 + 1, { slip_threshold_ms: 5, order_abandon_ms: 3_600_000 }));
    expect(s.stations.N).toEqual({ station_id: 'N', type: 'batch', capacity: 3, capacity_override: null, paused: false, profile: { t: [], u: [] }, unfired: [], loads: {} });
    expect(Object.is(s.lines, before)).toBe(true);
    expect(s.config!.settings.slip_threshold_ms).toBe(5);
  });
});

describe('§3.11 station type change: open lines are fixed input', () => {
  // Slot → batch: 'h' hidden, 'f' frozen, 'c' COOKING, 'r' fired (units 1 on a 2-unit station); all booked as slot lines.
  function slotToBatch(): Kitchen {
    const k = new Kitchen();
    k.apply(config([slotF], T0 - 60 * M));
    k.submit('Oh', [{ id: 'h', cook: 10 * M }], T0, { pickup: T0 + 60 * M });
    k.submit('Of', [{ id: 'f', cook: 10 * M }], T0);
    return k;
  }

  it('[03a #54] slot → batch: hidden and frozen lines keep placement, booking and profile at the fold and through every later re-plan', () => {
    const k = slotToBatch();
    const before = k.state;
    const s = k.apply(config([batchF], T0 + 1));
    expect(s.stations.F!.type).toBe('batch');
    expect(Object.is(s.lines, before.lines)).toBe(true);
    expect(s.stations.F!.profile).toEqual(before.stations.F!.profile);
    expect(s.stations.F!.unfired).toEqual(before.stations.F!.unfired);
    // New lines follow the new type: a whole-station load, never over a fixed slot booking.
    k.submit('On', [{ id: 'n', cook: 5 * M, program: 'P1' }], T0 + 2, { pickup: T0 + 45 * M });
    const after = k.state;
    expect(after.lines.h).toEqual(before.lines.h);
    expect(after.lines.f).toEqual(before.lines.f);
    expect(after.lines.n!.load_id).not.toBeNull();
    expect(after.lines.n!.booked).toBeNull();
    expect(maxUnits(after.stations.F!.profile)).toBeLessThanOrEqual(2);
    const load = Object.values(after.stations.F!.loads)[0]!;
    for (const id of ['h', 'f']) {
      const b = after.lines[id]!.booked!;
      expect(load.booked.end <= b.start || load.booked.start >= b.end, id).toBe(true);
    }
    replayEquals(k);
  });

  it('[03a #54] slot → batch: a later capacity change, a boost, a void and a release leave the fixed lines where they are; AD-7 exact', () => {
    const k = slotToBatch();
    k.apply(config([batchF], T0 + 1));
    k.submit('On', [{ id: 'n', cook: 5 * M, program: 'P1' }], T0 + 2, { pickup: T0 + 45 * M });
    const { h, f } = k.state.lines;
    // Capacity change: the load is placed against the fixed lines (they stay in its profile).
    k.apply(config([{ ...batchF, capacity: 3 }], T0 + 3));
    expect(k.state.lines.h).toEqual(h);
    expect(k.state.lines.f).toEqual(f);
    const load = Object.values(k.state.stations.F!.loads)[0]!;
    expect(load.booked.end <= h!.booked!.start || load.booked.start >= h!.booked!.end).toBe(true);
    expect(load.booked.end <= f!.booked!.start || load.booked.start >= f!.booked!.end).toBe(true);
    k.apply(stationEv('StationCapacitySet', 'F', { station_id: 'F', capacity_override: 2 }, T0 + 4));
    expect(k.state.lines.h).toEqual(h);
    // Boost of the order: the fixed line stays, unmarked.
    k.apply(boosted('Oh', T0 + 5));
    expect(k.state.lines.h).toMatchObject({ fire_ms: h!.fire_ms, booked: h!.booked, mark: null });
    // Void: exactly its booking leaves; strict would throw on an underflow.
    k.apply(voided('Oh', 'h', 1, T0 + 6), voided('Of', 'f', 1, T0 + 7), voided('On', 'n', 1, T0 + 8));
    expect(k.state.stations.F!.profile).toEqual({ t: [], u: [] });
    expect(k.state.stations.F!.loads).toEqual({});
    expect(k.state.stations.F!.unfired).toEqual([]);
    replayEquals(k);
  });

  it('[03a #54] slot → batch: fixed lines fire as placed and occupy their own units, not the whole station; a new load waits for them', () => {
    const k = slotToBatch();
    k.submit('O2', [{ id: 'g', cook: 10 * M }], T0);
    k.apply(config([batchF], T0 + 1));
    k.fireAll(T0 + 10 * M); // f and g: scheduled, no load
    const { f, g } = k.state.lines;
    expect(f!.fired_at).not.toBeNull();
    expect(g!.fired_at).not.toBeNull();
    expect(f!.load_id).toBeNull();
    const t = T0 + 10 * M + 1;
    const iv = liveInterval(k.state, 'f', t)!;
    // Side by side as they were booked: neither pushes the other back.
    expect(liveInterval(k.state, 'g', t)).toEqual(iv);
    expect(maxUnits(liveProfile(k.state, 'F', t))).toBe(2);
    k.apply(started('Of', 'f', t), started('O2', 'g', t));
    const cooking = liveInterval(k.state, 'f', t + 1)!;
    expect(liveInterval(k.state, 'g', t + 1)).toEqual(cooking);
    // A new load waits for the units.
    k.submit('On', [{ id: 'n', cook: 5 * M, program: 'P1', mode: 'immediate' }], t + 2);
    const load = Object.values(k.state.stations.F!.loads)[0]!;
    expect(load.booked.start).toBeGreaterThanOrEqual(cooking.end);
    replayEquals(k);
  });

  // Batch → slot: 'p', 'q' one hidden load; 'r' a frozen load.
  function batchToSlot(): Kitchen {
    const k = new Kitchen();
    k.apply(config([batchF], T0 - 60 * M));
    k.submit('Op', [{ id: 'p', cook: 10 * M, program: 'P1' }, { id: 'q', cook: 10 * M, program: 'P1' }], T0, { pickup: T0 + 60 * M });
    k.submit('Or', [{ id: 'r', cook: 10 * M, program: 'P1' }], T0);
    return k;
  }

  it('[03a #54] batch → slot: hidden and frozen loads keep booking, members and fire at the fold and through re-plans; new slot lines never over them', () => {
    const k = batchToSlot();
    const before = k.state;
    expect(Object.keys(before.stations.F!.loads)).toHaveLength(2);
    const s = k.apply(config([slotF], T0 + 1));
    expect(s.stations.F!.type).toBe('slot');
    expect(s.stations.F!.loads).toEqual(before.stations.F!.loads);
    expect(Object.is(s.lines, before.lines)).toBe(true);
    k.submit('On', [{ id: 'n', cook: 5 * M }], T0 + 2, { pickup: T0 + 62 * M });
    k.submit('Om', [{ id: 'm', cook: 5 * M, mode: 'immediate' }], T0 + 3);
    const after = k.state;
    expect(after.stations.F!.loads).toEqual(before.stations.F!.loads);
    expect(after.lines.p).toEqual(before.lines.p);
    expect(after.lines.r).toEqual(before.lines.r);
    expect(after.lines.n!.booked).not.toBeNull();
    expect(after.lines.n!.load_id).toBeNull();
    expect(maxUnits(after.stations.F!.profile)).toBeLessThanOrEqual(2);
    replayEquals(k);
  });

  it('[03a #54] batch → slot: a later capacity change and a boost keep the loads; no slot line is placed over them; AD-7 exact', () => {
    const k = batchToSlot();
    k.apply(config([slotF], T0 + 1));
    k.submit('On', [{ id: 'n', cook: 5 * M }], T0 + 2, { pickup: T0 + 62 * M });
    const loads = k.state.stations.F!.loads;
    k.apply(stationEv('StationCapacitySet', 'F', { station_id: 'F', capacity_override: 3 }, T0 + 3));
    expect(k.state.stations.F!.loads).toEqual(loads);
    // At 3 units the 2-unit load leaves 1 for a slot line, and the profile counts both.
    k.apply(stationEv('StationCapacitySet', 'F', { station_id: 'F', capacity_override: 2 }, T0 + 4));
    expect(k.state.stations.F!.loads).toEqual(loads);
    expect(maxUnits(k.state.stations.F!.profile)).toBeLessThanOrEqual(2);
    const p = k.state.lines.p!;
    k.apply(boosted('Op', T0 + 5));
    expect(k.state.lines.p).toMatchObject({ fire_ms: p.fire_ms, load_id: p.load_id, mark: null });
    expect(k.state.stations.F!.loads).toEqual(loads);
    // Void every member and the slot line: exactly the bookings leave.
    k.apply(voided('Op', 'p', 1, T0 + 6), voided('Op', 'q', 1, T0 + 7), voided('Or', 'r', 1, T0 + 8), voided('On', 'n', 1, T0 + 9));
    expect(k.state.stations.F!.profile).toEqual({ t: [], u: [] });
    expect(k.state.stations.F!.loads).toEqual({});
    replayEquals(k);
  });

  it('[03a #54] batch → slot: a capacity drop pushes a frozen slot line off a stored load that does not move (no over-booking)', () => {
    const k = batchToSlot();
    k.apply(config([slotF], T0 + 1), stationEv('StationCapacitySet', 'F', { station_id: 'F', capacity_override: 3 }, T0 + 2));
    k.submit('Oz', [{ id: 'z', cook: 5 * M, mode: 'immediate' }], T0 + 3);
    const r = k.state.stations.F!.loads[k.state.lines.r!.load_id!]!;
    const z = k.state.lines.z!;
    expect(z.booked!.start).toBeLessThan(r.booked.end); // beside the load, on the third unit
    expect(maxUnits(k.state.stations.F!.profile)).toBe(3);
    const s = k.apply(stationEv('StationCapacitySet', 'F', { station_id: 'F', capacity_override: 2 }, T0 + 4));
    expect(s.stations.F!.loads[r.load_id]).toEqual(r);
    expect(s.lines.z!.booked!.start).toBeGreaterThanOrEqual(r.booked.end);
    expect(s.lines.z!.mark).toBe('moved');
    expect(maxUnits(s.stations.F!.profile)).toBeLessThanOrEqual(2);
    replayEquals(k);
  });

  it('[03a #54] slot → batch: a boosted load is placed against the fixed slot bookings, never over them', () => {
    const k = new Kitchen();
    k.apply(config([slotF], T0 - 60 * M));
    k.submit('Of', [{ id: 'f', cook: 10 * M }], T0, { pickup: T0 + 30 * M });
    k.apply(config([batchF], T0 + 1));
    const f = k.state.lines.f!;
    k.submit('On', [{ id: 'n', cook: 30 * M, program: 'P1' }], T0 + 2, { pickup: T0 + 120 * M });
    const s = k.apply(boosted('On', T0 + 3));
    expect(s.lines.f).toEqual(f);
    const load = Object.values(s.stations.F!.loads)[0]!;
    expect(load.booked.end <= f.booked!.start || load.booked.start >= f.booked!.end).toBe(true);
    expect(s.lines.n!.mark).toBe('boost');
    replayEquals(k);
  });

  it('[03a #54] batch → slot: a load fires whole at its fire and completes; its booking leaves exactly once', () => {
    const k = batchToSlot();
    k.apply(config([slotF], T0 + 1));
    const fp = k.state.lines.p!.fire_ms!;
    k.fireAll(fp);
    expect(k.state.lines.p!.fired_at).toBe(fp);
    expect(k.state.lines.q!.fired_at).toBe(fp);
    expect(k.state.stations.F!.loads).toEqual({});
    expect(k.state.stations.F!.profile).toEqual({ t: [], u: [] });
    k.apply(started('Op', 'p', fp), started('Op', 'q', fp), done('Op', 'p', fp + 10 * M), done('Op', 'q', fp + 10 * M));
    expect(k.state.lines.q!.stage).toBe('done');
    replayEquals(k);
  });

  it('[03a #54] a fixed line is not a StockAdded candidate: it keeps its copy and its placement', () => {
    const CTX: StockCtx = deepFreeze({
      dayStartMs: T0 - 60 * M,
      stockItems: [{ stock_item_id: 'KB', name: 'KB', stock_unit: 'piece', carries_over: false, station_id: 'F', low_stock_threshold: null } satisfies ConfigStockItem],
      configStockUnits: { KB: 'piece' },
    });
    const k = new Kitchen();
    k.apply(config([slotF], T0 - 60 * M), stockSet('KB', 0, T0 - 60 * M));
    k.submit('O1', [{ id: 'h', cook: 10 * M, draws: [{ stock_item_id: 'KB', quantity: 1 }], stock_cook: M }], T0, { pickup: T0 + 60 * M });
    const add = stamp(aStockAdded({ stream_id: 'KB', payload: { stock_item_id: 'KB', quantity: 1, unit: 'piece' } }), T0 + 2);
    const { event_id, seq: _s, recorded_at, tenant_id, branch_id, ...draft } = add;
    void [event_id, _s, recorded_at, tenant_id, branch_id];
    // Native (no type change) it is a candidate; after the change it is not.
    expect(stockEffects(k.state, { ...(draft as EventDraft), occurred_at: T0 + 2 }, CTX).map((d) => d.event_type)).toContain('StockReserved');
    k.apply(config([batchF], T0 + 1));
    expect(stockEffects(k.state, { ...(draft as EventDraft), occurred_at: T0 + 2 }, CTX).map((d) => d.event_type)).not.toContain('StockReserved');
  });
});

describe('§3.10, §3.11 a capacity change re-places the bookings of the old type (D15 exception)', () => {
  // Slot → batch: two frozen slot lines side by side on two units.
  function twoFrozenSlot(units = 1): Kitchen {
    const k = new Kitchen();
    k.apply(config([slotF], T0 - 60 * M));
    k.submit('Oa', [{ id: 'a', cook: 10 * M, units }], T0);
    k.submit('Ob', [{ id: 'b', cook: 10 * M }], T0);
    return k;
  }
  // Batch → slot: 'p', 'q' one hidden load; 'r' a frozen load.
  function loads(): Kitchen {
    const k = new Kitchen();
    k.apply(config([batchF], T0 - 60 * M));
    k.submit('Op', [{ id: 'p', cook: 10 * M, program: 'P1' }, { id: 'q', cook: 10 * M, program: 'P1' }], T0, { pickup: T0 + 60 * M });
    k.submit('Or', [{ id: 'r', cook: 10 * M, program: 'P1' }], T0);
    return k;
  }

  it('[03a #45] slot → batch, then an override below the bookings: nothing over the new capacity, the pushed line marked moved, only later, a slip, AD-7 exact', () => {
    const k = twoFrozenSlot();
    k.apply(config([batchF], T0 + 1));
    const fire = k.state.lines.a!.fire_ms!;
    expect(k.state.lines.b!.fire_ms).toBe(fire);
    const s = k.apply(stationEv('StationCapacitySet', 'F', { station_id: 'F', capacity_override: 1 }, T0 + 2));
    expect(maxUnits(s.stations.F!.profile)).toBe(1);
    const moved = [s.lines.a!, s.lines.b!].filter((l) => l.fire_ms !== fire);
    expect(moved.map((l) => l.order_item_id)).toEqual(['b']);
    expect(moved[0]!.mark).toBe('moved');
    expect(moved[0]!.fire_ms!).toBeGreaterThanOrEqual(fire + 10 * M);
    expect(s.lines.a).toMatchObject({ fire_ms: fire, mark: null });
    expect(moved[0]!.booked!.start).toBeGreaterThanOrEqual(s.lines.a!.booked!.end);
    expect(getAlertIntents(s, T0 + 3).slips.map((x) => x.table_key)).toEqual(['t:Ob']);
    k.apply(voided('Oa', 'a', 1, T0 + 4), voided('Ob', 'b', 1, T0 + 5));
    expect(k.state.stations.F!.profile).toEqual({ t: [], u: [] });
    replayEquals(k);
  });

  it('[03a #45] batch → slot, then capacity 1: a stored load is a block at the new capacity, nothing over it, AD-7 exact', () => {
    const k = loads();
    k.apply(config([slotF], T0 + 1));
    const { p, r } = k.state.lines;
    const s = k.apply(config([{ ...slotF, capacity: 1 }], T0 + 2));
    expect(maxUnits(s.stations.F!.profile)).toBe(1);
    const block = s.stations.F!.loads[p!.load_id!]!;
    expect(block.booked.units).toBe(1);
    expect(block.booked.end - block.booked.start).toBe(20 * M); // AD-4: two units, two rounds
    expect(s.stations.F!.loads[r!.load_id!]!.booked.units).toBe(1);
    expect(s.lines.p!.fire_ms).toBe(s.lines.q!.fire_ms);
    k.apply(voided('Op', 'p', 1, T0 + 3), voided('Op', 'q', 1, T0 + 4), voided('Or', 'r', 1, T0 + 5));
    expect(k.state.stations.F!.profile).toEqual({ t: [], u: [] });
    expect(k.state.stations.F!.loads).toEqual({});
    replayEquals(k);
  });

  it('[03a #54] batch → slot: a block pushed past its deadline goes through §3.5.6, moves together, is marked moved', () => {
    const k = new Kitchen();
    k.apply(config([batchF], T0 - 60 * M));
    k.submit('Or', [{ id: 'r', cook: 10 * M, program: 'P1', early: 0 }, { id: 'u', cook: 10 * M, program: 'P1', early: 0 }], T0, { pickup: T0 + 11 * M });
    k.apply(config([slotF], T0 + 1), stationEv('StationCapacitySet', 'F', { station_id: 'F', capacity_override: 3 }, T0 + 2));
    const before = k.state.lines.r!;
    const block0 = k.state.stations.F!.loads[before.load_id!]!;
    k.submit('Oz', [{ id: 'z', cook: 5 * M, mode: 'immediate' }], T0 + 3);
    expect(k.state.lines.z!.fire_ms!).toBeLessThan(before.fire_ms!);
    expect(k.state.lines.z!.booked!.end).toBeGreaterThan(block0.booked.start); // overlaps: 2 + 1 units on 3
    const s = k.apply(stationEv('StationCapacitySet', 'F', { station_id: 'F', capacity_override: 2 }, T0 + 4));
    expect(maxUnits(s.stations.F!.profile)).toBeLessThanOrEqual(2);
    const r = s.lines.r!;
    expect(r.fire_ms!).toBeGreaterThan(before.fire_ms!);
    expect(r.fire_ms!).toBeGreaterThan(before.deadline_ms);
    expect(r.mark).toBe('moved');
    expect(s.lines.u).toMatchObject({ fire_ms: r.fire_ms, mark: 'moved', load_id: r.load_id });
    expect(s.stations.F!.loads[r.load_id!]!.booked.start).toBeGreaterThanOrEqual(s.lines.z!.booked!.end);
    k.apply(voided('Or', 'r', 1, T0 + 5), voided('Or', 'u', 1, T0 + 6), voided('Oz', 'z', 1, T0 + 7));
    expect(k.state.stations.F!.profile).toEqual({ t: [], u: [] });
    replayEquals(k);
  });

  it('[03a #54] one event changes type and capacity: as the two-event form, with the AD-4 warning', () => {
    const one = twoFrozenSlot(2);
    const s1 = one.apply(config([{ ...batchF, capacity: 1 }], T0 + 1));
    const two = twoFrozenSlot(2);
    two.apply(config([batchF], T0 + 1));
    const s2 = two.apply(config([{ ...batchF, capacity: 1 }], T0 + 1));
    expect(maxUnits(s1.stations.F!.profile)).toBe(1);
    expect(s1.lines).toEqual(s2.lines);
    expect(s1.stations.F!.profile).toEqual(s2.stations.F!.profile);
    expect(s1.diagnostics.filter((d) => d.kind === 'over_capacity')).toEqual([expect.objectContaining({ order_item_id: 'a', station_id: 'F', detail: { units: 2, capacity: 1 } })]);
    replayEquals(one);

    const back = loads();
    const s3 = back.apply(config([{ ...slotF, capacity: 1 }], T0 + 1));
    expect(s3.stations.F!.type).toBe('slot');
    expect(maxUnits(s3.stations.F!.profile)).toBe(1);
    replayEquals(back);
  });

  it('[03a #45] BusinessDayOpened resets an override: the fixed lines above the configured capacity are re-placed too', () => {
    const k = new Kitchen();
    k.apply(config([slotF], T0 - 60 * M), stationEv('StationCapacitySet', 'F', { station_id: 'F', capacity_override: 3 }, T0 - 1));
    k.submit('Oa', [{ id: 'a', cook: 10 * M }], T0);
    k.submit('Ob', [{ id: 'b', cook: 10 * M }], T0);
    k.submit('Oc', [{ id: 'c', cook: 10 * M }], T0);
    k.apply(config([{ ...batchF }], T0 + 1));
    expect(maxUnits(k.state.stations.F!.profile)).toBe(3);
    const s = k.apply(open(T0 + 2));
    expect(s.stations.F!.capacity_override).toBeNull();
    expect(maxUnits(s.stations.F!.profile)).toBe(2);
    expect(Object.values(s.lines).filter((l) => l.mark === 'moved')).toHaveLength(1);
    replayEquals(k);
  });

  it('[03a #54] outside the capacity fold a FIFO batch station leaves an old-type booking where it is (it stays in the fixed profile)', () => {
    const k = twoFrozenSlot();
    k.apply(config([{ ...batchF, policy: 'fifo' }], T0 + 1));
    const step = placeFrozen(k.state, ['F'], T0 + 2, { strict: true });
    expect(step.moves.size).toBe(0);
    expect(step.before.size).toBe(0);
  });

  it('[03a #54] a boost keeps today\'s rule: the old-type lines stay where they are', () => {
    const k = twoFrozenSlot();
    k.apply(config([batchF], T0 + 1));
    const { a, b } = k.state.lines;
    const s = k.apply(boosted('Oa', T0 + 2));
    expect(s.lines.b).toEqual(b);
    expect(s.lines.a).toMatchObject({ fire_ms: a!.fire_ms, booked: a!.booked, mark: null });
  });
});

describe('§3.11 config alternates and carry reach hidden lines', () => {
  type Alt = StationCfg['alternates'][number];
  const altB = (over: Partial<Alt> = {}): Alt => ({ station_id: 'B', order_types: ['delivery'], home_for_order_types: [], ...over });
  const A = (alternates: Alt[] = [altB()], carry: number | null = null): Partial<StationCfg> => ({ station_id: 'A', capacity: 1, alternates, carry_times: carry === null ? [] : [{ point_id: 'P1', carry_ms: carry }] });
  const B = (carry: number | null = null): Partial<StationCfg> => ({ station_id: 'B', capacity: 1, carry_times: carry === null ? [] : [{ point_id: 'P1', carry_ms: carry }] });
  const pickup = T0 + 60 * M;

  function hidden(stations: Array<Partial<StationCfg>>, alternates: Array<{ station_id: string; carry_ms: number; home: boolean }>, carry = 0, max_carry?: number): Kitchen {
    const k = new Kitchen();
    k.apply(config(stations, T0 - 60 * M));
    k.submit('O1', [{ id: 'h', station: 'A', cook: 10 * M, early: 5 * M, alternates, point: 'P1', carry, ...(max_carry === undefined ? {} : { max_carry }) }], T0, { pickup });
    expect(k.state.lines.h!.station_id).toBe('A');
    return k;
  }
  const allowed = (s: EngineState, id: string): string[] => routeOptions(routeCtx(s), s.lines[id]!, true).map((o) => o.station_id);

  it('[03a §3.11] an alternate removed: a hidden line no longer has it, moves nowhere at the fold, and is not re-routed onto it', () => {
    const k = hidden([A(), B()], [{ station_id: 'B', carry_ms: 0, home: false }]);
    expect(allowed(k.state, 'h').sort()).toEqual(['A', 'B']);
    const before = k.state;
    const s = k.apply(config([A([]), B()], T0 + 1));
    expect(allowed(s, 'h')).toEqual(['A']);
    expect(s.lines.h!.alternates).toEqual([]);
    expect(s.lines.h!.fire_ms).toBe(before.lines.h!.fire_ms);
    expect(Object.is(s.stations.A, before.stations.A)).toBe(true);
    // A blocker takes its slot: with the alternate it would have gone to B; now it goes late on A.
    k.submit('O2', [{ id: 'x', station: 'A', cook: 50 * M, mode: 'immediate' }], T0 + 2);
    expect(k.state.lines.h!.station_id).toBe('A');
    replayEquals(k);
  });

  it('[03a §3.11] an alternate added: a hidden line may use it from the next re-plan; another order type may not', () => {
    const k = hidden([A([]), B()], []);
    expect(allowed(k.state, 'h')).toEqual(['A']);
    const s = k.apply(config([A([altB()]), B()], T0 + 1));
    expect(s.lines.h!.alternates).toEqual([{ station_id: 'B', carry_ms: 0, home: false }]);
    expect(allowed(s, 'h').sort()).toEqual(['A', 'B']);
    // A fired, not started line grows over h's window (§3.3 live interval): the next re-plan of A (a void) cannot keep h there.
    k.submit('O2', [{ id: 'x', station: 'A', cook: 30 * M, mode: 'immediate' }], T0 + 2);
    k.fireAll(T0 + 3);
    expect(k.state.lines.x!.fired_at).not.toBeNull();
    k.submit('O3', [{ id: 'y', station: 'A', cook: M }], T0 + 4, { pickup: T0 + 200 * M });
    k.apply(voided('O3', 'y', 1, T0 + 30 * M));
    expect(k.state.lines.h).toMatchObject({ station_id: 'B', carry_ms: 0, alternates: [{ station_id: 'A', carry_ms: 0, home: true }] });
    replayEquals(k);

    const other = hidden([A([]), B()], []);
    const s2 = other.apply(config([A([altB({ order_types: ['dine_in'] })]), B()], T0 + 1));
    expect(allowed(s2, 'h')).toEqual(['A']);
  });

  it('[03a §3.11] home_for_order_types: the flag follows the config (D9)', () => {
    const k = hidden([A([]), B()], []);
    const s = k.apply(config([A([altB({ home_for_order_types: ['delivery'] })]), B()], T0 + 1));
    expect(s.lines.h!.alternates).toEqual([{ station_id: 'B', carry_ms: 0, home: true }]);
    expect(routeOptions(routeCtx(s), s.lines.h!, true).find((o) => o.home)!.station_id).toBe('B');
  });

  it('[03a §3.11] a carry change: the deadline shifts by it, T and P stay; the fire moves only at the next re-plan, and the line still lands at T', () => {
    const k = hidden([A([]), B()], []);
    const before = k.state.lines.h!;
    const order = k.state.orders.O1!;
    const s = k.apply(config([A([], 5 * M), B()], T0 + 1));
    const h = s.lines.h!;
    expect(h.carry_ms).toBe(5 * M);
    expect(h.deadline_ms).toBe(before.deadline_ms - 5 * M);
    expect(h.fire_ms).toBe(before.fire_ms);
    expect(h.booked).toEqual(before.booked);
    expect(s.orders.O1).toEqual(order);
    // The next re-plan of the station (a void of another line): the line lands at T − carry on the station.
    k.submit('O2', [{ id: 'y', station: 'A', cook: 1 * M, mode: 'immediate' }], T0 + 2);
    k.apply(voided('O2', 'y', 1, T0 + 3));
    const after = k.state.lines.h!;
    expect(after.fire_ms).toBeLessThanOrEqual(h.deadline_ms);
    expect(after.booked!.end + after.carry_ms).toBeLessThanOrEqual(order.target_land_ms);
    expect(k.state.orders.O1!.promise_ms).toBe(order.promise_ms);
    replayEquals(k);
  });

  it('[03a §3.11] a carry change reaches the next tick: with no re-plan yet, the planned land passes T + threshold and the alert pass slips it', () => {
    const k = hidden([A([]), B()], []);
    expect(getAlertIntents(k.state, T0 + 2).slips).toEqual([]);
    const s = k.apply(config([A([], 10 * M), B()], T0 + 1));
    expect(getAlertIntents(s, T0 + 2).slips.map((x) => x.table_key)).toEqual(['t:O1']);
    expect(s.next_alert_due_at).not.toBeNull();
  });

  it('[03a §3.11] a missing carry row reads 0 (01a A-10); an alternate\'s new carry is read from the config and max_carry_ms stays the line\'s copy (#80)', () => {
    const k = hidden([A([], 5 * M), B(4 * M)], [], 5 * M, 6 * M);
    const before = k.state.lines.h!;
    const s0 = k.apply(config([A([altB()], 5 * M), B(4 * M)], T0 + 1));
    expect(s0.lines.h!.alternates).toEqual([{ station_id: 'B', carry_ms: 4 * M, home: false }]);
    // B's carry grows past the line's copied max_carry_ms: B is no longer offered; the copy is unchanged.
    const s1 = k.apply(config([A([altB()], 5 * M), B(7 * M)], T0 + 2));
    expect(s1.lines.h!.alternates).toEqual([{ station_id: 'B', carry_ms: 7 * M, home: false }]);
    expect(s1.lines.h!.max_carry_ms).toBe(6 * M);
    expect(allowed(s1, 'h')).toEqual(['A']);
    // A's row removed: carry 0.
    const s2 = k.apply(config([A([altB()]), B(7 * M)], T0 + 3));
    expect(s2.lines.h!.carry_ms).toBe(0);
    expect(s2.lines.h!.deadline_ms).toBe(before.deadline_ms + 5 * M);
    replayEquals(k);
  });

  it('[03a §3.11] a frozen line, a fired line and a line under the old type keep their copies (D10, fixed input)', () => {
    const k = new Kitchen();
    k.apply(config([A([]), B()], T0 - 60 * M));
    k.submit('O2', [{ id: 'r', station: 'B', cook: 10 * M, mode: 'immediate', point: 'P1' }], T0);
    k.fireAll(T0 + 1);
    k.submit('O1', [{ id: 'f', station: 'A', cook: 10 * M, point: 'P1' }], T0 + 2);
    const { f, r } = k.state.lines;
    expect(r!.fired_at).not.toBeNull();
    expect(f!.fired_at).toBeNull();
    expect(f!.fire_ms!).toBeLessThanOrEqual(T0 + 2 * M);
    const s = k.apply(config([A([altB({ order_types: ['dine_in'] })], 5 * M), B(5 * M)], T0 + 3));
    expect(s.lines.r).toEqual(r);
    expect(s.lines.f).toEqual(f);
    replayEquals(k);

    const old = new Kitchen();
    old.apply(config([{ ...slotF, carry_times: [] }], T0 - 60 * M));
    old.submit('O3', [{ id: 'h', cook: 10 * M, point: 'P1' }], T0, { pickup });
    const s2 = old.apply(config([{ ...batchF, carry_times: [{ point_id: 'P1', carry_ms: 5 * M }] }], T0 + 1));
    expect(s2.lines.h!.carry_ms).toBe(0);
    replayEquals(old);
  });

  it('[03a §3.11] a batch member takes the config carry too; a config that changes neither keeps the line objects', () => {
    const k = new Kitchen();
    const G: Partial<StationCfg> = { ...batchF, station_id: 'G', capacity: 2 };
    k.apply(config([G], T0 - 60 * M));
    k.submit('O1', [{ id: 'm', station: 'G', cook: 10 * M, program: 'P1', point: 'P1' }], T0, { pickup });
    const before = k.state.lines.m!;
    const same = k.apply(config([G], T0 + 1));
    expect(Object.is(same.lines.m, before)).toBe(true);
    const s = k.apply(config([{ ...G, carry_times: [{ point_id: 'P1', carry_ms: 3 * M }] }], T0 + 2));
    expect(s.lines.m!.carry_ms).toBe(3 * M);
    expect(s.lines.m!.deadline_ms).toBe(before.deadline_ms - 3 * M);
    replayEquals(k);
  });

  it('[03a §3.5.1] planOrder = the fold after a route change: the plan of a new order lands where the fold places it', () => {
    const k = hidden([A([]), B()], []);
    k.apply(config([A([altB()], 2 * M), B(M)], T0 + 1));
    const plan = k.submit('O2', [{ id: 'n', station: 'A', cook: 8 * M, point: 'P1', carry: 2 * M, alternates: [{ station_id: 'B', carry_ms: M, home: false }] }], T0 + 2, { pickup: T0 + 62 * M });
    const planned = plan.lines.find((l) => l.order_item_id === 'n')!;
    expect(k.state.lines.n!.station_id).toBe(planned.station_id);
    expect(k.state.lines.n!.carry_ms).toBe(planned.carry_ms);
    expect(k.state.lines.n!.booked!.end + k.state.lines.n!.carry_ms).toBe(plan.groups[0]!.target_land_ms);
    expect(k.state.lines.h!.carry_ms).toBe(2 * M);
    replayEquals(k);
  });
});

describe('§3.7, §3.11 a stock release keeps a fixed booking', () => {
  const CTX: StockCtx = deepFreeze({
    dayStartMs: T0 - 60 * M,
    stockItems: [{ stock_item_id: 'KB', name: 'KB', stock_unit: 'piece', carries_over: false, station_id: 'F', low_stock_threshold: null } satisfies ConfigStockItem],
    configStockUnits: { KB: 'piece' },
  });
  function reservedHidden(): Kitchen {
    const k = new Kitchen();
    k.apply(config([slotF], T0 - 60 * M), stockSet('KB', 5, T0 - 60 * M));
    k.submit('O1', [{ id: 'h', cook: 10 * M, draws: [{ stock_item_id: 'KB', quantity: 1 }], stock_cook: M }], T0, { pickup: T0 + 60 * M, reserved: [{ stock_item_id: 'KB', order_item_id: 'h', quantity: 1 }] });
    return k;
  }
  const draft = (e: PosEvent, at: number): EventDraft => {
    const { event_id, seq: _s, recorded_at, tenant_id, branch_id, ...rest } = e;
    void [event_id, _s, recorded_at, tenant_id, branch_id];
    return { ...(rest as EventDraft), occurred_at: at };
  };
  const types = (k: Kitchen, d: EventDraft): string[] => stockEffects(k.state, d, CTX).map((x) => x.event_type);

  it('[03a #54] a recount and a day close release a native hidden line, but not one placed under the old type', () => {
    const native = reservedHidden();
    expect(types(native, draft(stockSet('KB', 0, T0 + 2), T0 + 2))).toContain('StockReleased');
    expect(types(native, draft(closed(T0 + 2), T0 + 2))).toContain('StockReleased');
    const fixed = reservedHidden();
    fixed.apply(config([batchF], T0 + 1));
    expect(types(fixed, draft(stockSet('KB', 0, T0 + 2), T0 + 2))).not.toContain('StockReleased');
    expect(types(fixed, draft(closed(T0 + 2), T0 + 2))).not.toContain('StockReleased');
  });
});

describe('§3.11 minors', () => {
  it('[03a #54] batch → slot: a fired load holds the whole station as it did unfired, COOKING too; a slot line waits for it', () => {
    const k = new Kitchen();
    k.apply(config([batchF], T0 - 60 * M));
    k.submit('Or', [{ id: 'r', cook: 10 * M, program: 'P1' }], T0);
    k.apply(config([slotF], T0 + 1));
    const fire = k.state.lines.r!.fire_ms!;
    const at = Math.max(fire, T0 + 2);
    expect(maxUnits(liveProfile(k.state, 'F', at))).toBe(2);
    k.fireAll(at);
    expect(k.state.lines.r!.fired_at).not.toBeNull();
    expect(maxUnits(liveProfile(k.state, 'F', at + 1))).toBe(2);
    k.apply(started('Or', 'r', at + 1));
    expect(maxUnits(liveProfile(k.state, 'F', at + 2))).toBe(2);
    const iv = liveInterval(k.state, 'r', at + 2)!;
    k.submit('On', [{ id: 'n', cook: 5 * M, mode: 'immediate' }], at + 3);
    expect(k.state.lines.n!.booked!.start).toBeGreaterThanOrEqual(iv.end);
    replayEquals(k);
  });

  it('[03a §3.11] a new line whose only station is archived falls back to it (D3), filtered', () => {
    const k = new Kitchen();
    k.apply(config([{ station_id: 'A', capacity: 1, is_archived: true }], T0 - 60 * M));
    k.submit('O1', [{ id: 'n', station: 'A', cook: 5 * M, mode: 'immediate' }], T0);
    expect(k.state.lines.n!.station_id).toBe('A');
    expect(k.state.lines.n!.booked).not.toBeNull();
    const line = { ...k.state.lines.n!, booked: null, fire_ms: null };
    expect(routeOptions(routeCtx(k.state), line, false)).toEqual([expect.objectContaining({ station_id: 'A', fallback: 'filtered' })]);
    replayEquals(k);
  });
});

describe('§3.12 checkpoint (D26)', () => {
  const KEYS = ['business_day', 'checkpoint_schema', 'config', 'last_seq', 'stations', 'stock'];
  const lastSeq = (k: Kitchen): number => k.log[k.log.length - 1]!.seq;

  // A day: config, open, stock, an override, a pause, an order through to served, a void; closed with nothing open.
  function dayOne(): Kitchen {
    const k = new Kitchen();
    const day = T0 - 60 * M;
    k.apply(config([slotF, { ...batchF, station_id: 'B' }], day - 1), open(day, '2025-10-20'), stockSet('KB', 10, day + 1));
    k.submit('O1', [{ id: 'a', cook: 10 * M, mode: 'immediate' }, { id: 'v', cook: 10 * M, mode: 'immediate' }], T0);
    k.fireAll(T0 + 1);
    k.apply(voided('O1', 'v', 1, T0 + 2), started('O1', 'a', T0 + 3), done('O1', 'a', T0 + 10 * M), served('O1', ['a'], T0 + 11 * M));
    k.apply(stationEv('StationCapacitySet', 'F', { station_id: 'F', capacity_override: 1 }, T0 + 20 * M));
    k.apply(stationEv('StationPauseSet', 'B', { station_id: 'B', paused: true }, T0 + 21 * M));
    k.apply(closed(T0 + 120 * M));
    return k;
  }
  // The next day's log after the checkpoint.
  function dayTwo(k: Kitchen, start: number): void {
    k.apply(stockSet('KB', 7, start - 2));
    k.apply(open(start));
    k.submit('O2', [{ id: 'b', cook: 10 * M }, { id: 'c', cook: 5 * M }], start + 1, { pickup: start + 60 * M });
    k.submit('O3', [{ id: 'd', cook: 7 * M, program: 'P1', station: 'B' }], start + 2, { pickup: start + 40 * M });
    k.apply(boosted('O2', start + 3));
    k.apply(config([{ ...slotF, capacity: 3 }, { ...batchF, station_id: 'B' }], start + 4));
    k.fireAll(start + 5);
    k.apply(closed(start + 500 * M));
  }

  function bootCheck(k: Kitchen, cutAt: number): void {
    const events = k.log;
    const head = buildEngineState(events.slice(0, cutAt));
    const body = deepFreeze(JSON.parse(JSON.stringify(toCheckpoint(head, events[cutAt - 1]!.seq)))) as EngineCheckpointV1;
    let boot = deepFreeze(fromCheckpoint(body));
    expect(boot.diagnostics).toEqual([]);
    let full = head;
    for (const e of events.slice(cutAt)) {
      boot = deepFreeze(applyEvent(boot, deepFreeze(e)));
      full = applyEvent(full, e);
      expect(comparable(boot), `after ${e.event_type} seq ${e.seq}`).toEqual(comparable(full));
    }
  }

  it('[03a #55] the body has exactly the §3.12 keys and no order; diagnostics stay out', () => {
    const k = dayOne();
    const state = { ...k.state, diagnostics: [{ kind: 'stock_breach' as const, detail: { x: 1 } }] };
    const body = toCheckpoint(deepFreeze(state), lastSeq(k));
    expect(Object.keys(body).sort()).toEqual(KEYS);
    expect(body.checkpoint_schema).toBe(1);
    expect(body.last_seq).toBe(lastSeq(k));
    expect(body.business_day!.closed_at).toBe(T0 + 120 * M);
    expect(body.stations).toEqual({ F: { capacity_override: 1, paused: false }, B: { capacity_override: null, paused: true } });
    for (const station of Object.values(body.stations)) expect(Object.keys(station).sort()).toEqual(['capacity_override', 'paused']);
    const text = JSON.stringify(body);
    for (const word of ['orders', 'lines', 'diagnostics', 'slips', 'O1', '"profile"', '"unfired"']) expect(text, word).not.toContain(word);
    expect(body.stock).toEqual(k.state.stock);
    expect(body.config).toEqual(k.state.config);
  });

  it('[03a #55] fromCheckpoint: the empty runtime of §3.3 from config + the body; diagnostics []', () => {
    const k = dayOne();
    const boot = fromCheckpoint(deepFreeze(toCheckpoint(k.state, lastSeq(k))));
    expect(boot.diagnostics).toEqual([]);
    expect(boot.orders).toEqual({});
    expect(boot.lines).toEqual({});
    expect(boot.slips).toEqual({});
    expect(boot.slip_due).toEqual({});
    expect(boot.next_alert_due_at).toBeNull();
    expect(boot.stations.F).toEqual({ station_id: 'F', type: 'slot', capacity: 2, capacity_override: 1, paused: false, profile: { t: [], u: [] }, unfired: [], loads: {} });
    expect(boot.stations.B).toMatchObject({ type: 'batch', paused: true });
    // A new hub's empty document round-trips too.
    const empty = initialEngineState();
    expect(comparable(fromCheckpoint(toCheckpoint(empty, 0)))).toEqual(comparable(empty));
  });

  it('[03a #55] (a) a night boot equals a full replay, business_day included, at the boot and after the rest of the log', () => {
    const k = dayOne();
    const cut = k.log.length;
    const head = k.state;
    expect(noOrderInEngine(head, head.business_day!.closed_at!)).toBe(true);
    const night = fromCheckpoint(deepFreeze(JSON.parse(JSON.stringify(toCheckpoint(head, lastSeq(k)))) as EngineCheckpointV1));
    expect(comparable(night)).toEqual(comparable(head));
    expect(night.business_day).toEqual(head.business_day);
    dayTwo(k, T0 + 600 * M);
    bootCheck(k, cut);
    expect(comparable(buildEngineState(k.log))).toEqual(comparable(k.state));
  });

  it('[03a #55] (b) a day boot likewise: the override and the pause stand until the open clears them', () => {
    const k = dayOne();
    const cut = k.log.length;
    const start = T0 + 600 * M;
    dayTwo(k, start);
    bootCheck(k, cut);
    const openAt = k.log.findIndex((e, i) => i >= cut && e.event_type === 'BusinessDayOpened');
    const boot = fromCheckpoint(toCheckpoint(buildEngineState(k.log.slice(0, cut)), k.log[cut - 1]!.seq));
    const opened = k.log.slice(cut, openAt + 1).reduce((s, e) => applyEvent(s, e), boot);
    expect(opened.stations.F).toMatchObject({ capacity_override: null, paused: false });
    expect(opened.stations.B).toMatchObject({ capacity_override: null, paused: false });
    expect(opened.business_day).toMatchObject({ business_date: '2025-10-21', closed_at: null });
  });

  it('[03a #55] (b) the close commit carries the releases first, then BusinessDayClosed: last_seq = its last seq, nothing folded twice, reserved ≥ 0', () => {
    const k = new Kitchen();
    const day = T0 - 60 * M;
    k.apply(config([slotF, { ...batchF, station_id: 'B' }], day - 1), open(day, '2025-10-20'), stockSet('KB', 5, day + 1));
    k.submit('O1', [{ id: 'a', cook: 10 * M, mode: 'immediate', draws: [{ stock_item_id: 'KB', quantity: 2 }], stock_cook: 2 * M }], T0, { reserved: [{ stock_item_id: 'KB', order_item_id: 'a', quantity: 2 }] });
    k.fireAll(T0 + 1);
    // Never tapped: abandoned at last_line_fold_at + order_abandon_ms, kept while reserved (AD-20).
    const late = T0 + 1 + BASE.settings.order_abandon_ms + 1;
    expect(k.state.stock.KB!.reserved).toBe(2);
    k.apply(stamp(aStockReleased({ payload: { stock_item_id: 'KB', order_item_id: 'a', quantity: 2, reason: 'day_closed' } }), late), closed(late));
    expect(k.state.stock.KB).toMatchObject({ on_hand: 5, reserved: 0 });
    expect(noOrderInEngine(k.state, late)).toBe(true);
    expect(k.state.orders).toEqual({});
    const cut = k.log.length;
    dayTwo(k, late + 600 * M);
    bootCheck(k, cut);
    const boot = fromCheckpoint(toCheckpoint(buildEngineState(k.log.slice(0, cut)), k.log[cut - 1]!.seq));
    expect(boot.stock.KB).toMatchObject({ on_hand: 5, reserved: 0 });
    // Never stock_reserved: the releases of the commit are below last_seq, so step 3 reads none of them.
    expect(k.log.slice(cut).filter((e) => e.event_type === 'StockReleased')).toEqual([]);
  });

  it('[03a #55] a deferred checkpoint: an order carried over the close, slipped, then out by the predicate but still present: the body holds nothing of it, and the first listed fold makes boot = full replay', () => {
    const k = new Kitchen();
    const day = T0 - 60 * M;
    k.apply(config([slotF], day - 1), open(day, '2025-10-20'));
    k.submit('O1', [{ id: 'a', cook: 10 * M, mode: 'immediate' }], T0);
    k.fireAll(T0 + 1);
    k.apply(closed(T0 + 2));
    expect(Object.keys(k.state.orders)).toEqual(['O1']);
    expect(noOrderInEngine(k.state, T0 + 2)).toBe(false);
    k.apply(stamp({ ...anItemStarted(), event_type: 'SlipWarned', stream_id: 'O1', payload: { table_key: 't:O1', order_ids: ['O1'], alert_id: 'AL1', estimated_land_ms: T0 + 20 * M, target_land_ms: T0 + 10 * M, promise_ms: T0 + 12 * M } }, T0 + 3));
    k.apply(started('O1', 'a', T0 + 4), done('O1', 'a', T0 + 10 * M), served('O1', ['a'], T0 + 11 * M));
    const at = T0 + 11 * M + 1_800_000;
    expect(noOrderInEngine(k.state, at)).toBe(true);
    expect(Object.keys(k.state.orders)).toEqual(['O1']);
    expect(k.state.slips['t:O1']).toBeDefined();
    const cut = k.log.length;
    const body = toCheckpoint(k.state, k.log[cut - 1]!.seq);
    expect(JSON.stringify(body)).not.toContain('O1');
    const closeAlert = stamp(anAlertClosed({ stream_type: 'order', stream_id: 'O1', payload: { alert_id: 'AL1', reason: 'done', by_staff_id: null, note: null } }), at + 1);
    k.apply(closeAlert, open(at + 2));
    const boot = k.log.slice(cut).reduce((s, e) => applyEvent(s, e), fromCheckpoint(body));
    expect(comparable(boot)).toEqual(comparable(k.state));
    expect(k.state.orders).toEqual({});
    expect(k.state.slips).toEqual({});
  });

  it('[03a #55] purity: neither function changes its frozen input; the JSON document is the same value', () => {
    const k = dayOne();
    const body = toCheckpoint(k.state, lastSeq(k));
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
    expect(() => fromCheckpoint(deepFreeze(body))).not.toThrow();
  });
});
