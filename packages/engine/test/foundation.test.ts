// Foundation §4.7 "Required unit tests for @pos/engine" (F tests 1–15), relative to T = 1_761_000_000_000.
// Times are in ms as the foundation writes them; the engine reads them as integer ms.
import { parseEvent, type EngineConfig, type ItemAddedPayload, type PosEvent } from '@pos/events';
import { aFireDispatched, anEngineConfigApplied, anItemAdded, anItemDone, anItemStarted, anOrderBatch } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import {
  addInterval,
  applyEvent,
  buildEngineState,
  getAlertIntents,
  getTickIntents,
  initialEngineState,
  liveInterval,
  planOrder,
  type EngineState,
  type PlanResult,
  type ProposedOrder,
} from '../src/index';
import { etaB, fireLoad, fold, fryer, loadOf, submitB } from './batch-kit';

const T = 1_761_000_000_000;
const PAD = 180_000;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const S1 = (parseEvent(anEngineConfigApplied()).payload as unknown as EngineConfig).stations[0]!;

// Slot stations X and Y, capacity 1 (F tests), with existing reservations [start, end) of 1 unit.
function kitchen(reservations: Record<string, Array<[number, number]>>, capacity = 1): EngineState {
  const ids = Object.keys(reservations);
  const cfg = anEngineConfigApplied({
    recorded_at: T - 60_000,
    payload: { stations: ids.map((station_id) => ({ ...S1, station_id, capacity })) },
  });
  let s = applyEvent(initialEngineState(), deepFreeze(cfg));
  for (const id of ids) {
    let profile = s.stations[id]!.profile;
    for (const [a, b] of reservations[id]!) profile = addInterval(profile, { start: a, end: b }, 1);
    s = { ...s, stations: { ...s.stations, [id]: { ...s.stations[id]!, profile } } };
  }
  return deepFreeze(s);
}

type Item = { id: string; station: string; cook: number; prep?: number; mode?: 'sync' | 'immediate' };

function order(items: Item[], order_id = 'O1'): ProposedOrder {
  const base = anItemAdded().payload as unknown as ItemAddedPayload;
  return deepFreeze({
    order_id,
    order: { order_type: 'dine_in', table_id: 'T12', table_key: 'dine_in:T12', follow_up: false, pickup_at_ms: null },
    lines: items.map((i) => ({
      ...base,
      order_id,
      order_item_id: i.id,
      station_id: i.station,
      cook_time_ms: i.cook,
      prep_buffer_ms: i.prep ?? 0,
      serve_mode: i.mode ?? 'sync',
      alternates: [],
      point_id: null,
      carry_ms: 0,
      weight_pct: 100,
      max_early_ms: 60_000,
      max_late_ms: null,
      max_carry_ms: null,
      cook_ms_override: null,
      return_of: null,
    })),
  });
}

// Plans at now = T, then folds the batch 02 would append at recorded_at = T (the same placement, §3.5.1).
function submit(state: EngineState, items: Item[], now = T, order_id = 'O1', seq = 10): { plan: PlanResult; state: EngineState } {
  const plan = planOrder(state, order(items, order_id), now, {});
  const batch = anOrderBatch({
    order_id,
    recorded_at: now,
    seq,
    lines: items.map((i) => ({
      order_item_id: i.id,
      item: { station_id: i.station, cook_time_ms: i.cook, prep_buffer_ms: i.prep ?? 0, serve_mode: i.mode ?? 'sync' },
      line: { station_id: i.station },
    })),
    order: { groups: plan.groups },
  });
  let s = state;
  for (const e of batch) s = deepFreeze(applyEvent(s, deepFreeze(e)));
  return { plan, state: s };
}

function eta(plan: PlanResult, id: string): number {
  return plan.lines.find((l) => l.order_item_id === id)!.eta_ms;
}
function target(plan: PlanResult): number {
  return plan.groups[0]!.target_land_ms;
}

describe('@pos/engine foundation §4.7 required tests (slot ETA, hold-and-fire)', () => {
  it('[03a F #1] slot: a future reservation blocks a long item (the 10 ms gap is too short)', () => {
    const state = kitchen({ X: [[T + 10, T + 30]] });
    // As an immediate line (the slot formula itself) and as a sync line held to its ETA.
    for (const mode of ['immediate', 'sync'] as const) {
      const { plan, state: s } = submit(state, [{ id: 'B', station: 'X', cook: 25, mode }]);
      expect(s.lines.B!.fire_ms).toBe(T + 30);
      expect(s.lines.B!.fire_ms!).toBeGreaterThanOrEqual(T + 30);
      expect(s.lines.B!.booked).toEqual({ start: T + 30, end: T + 55, units: 1 });
      expect(eta(plan, 'B')).toBe(T + 55);
      expect(target(plan)).toBe(T + 55);
    }
  });

  it('[03a F #2] hold-and-fire: a single sync item lands at its slot-formula ETA (no advancement)', () => {
    const state = kitchen({ X: [[T + 5, T + 20]] });
    const { plan, state: s } = submit(state, [{ id: 'S', station: 'X', cook: 20 }]);
    expect(target(plan)).toBe(T + 40);
    expect(plan.groups[0]!.promise_ms).toBe(T + 40 + PAD);
    // latest_start = T + 20; reservation [T + 20, T + 40) written.
    expect(s.lines.S!.fire_ms).toBe(T + 20);
    expect(s.lines.S!.deadline_ms).toBe(T + 20);
    expect(s.lines.S!.booked).toEqual({ start: T + 20, end: T + 40, units: 1 });
    expect(s.stations.X!.profile).toEqual({ t: [T + 5, T + 40], u: [1, 0] });
  });

  it('[03a F #5] hold-and-fire: advancing tlt for one item creates a new conflict for an already-checked item', () => {
    const state = kitchen({ X: [[T + 30, T + 50]], Y: [[T + 5, T + 20], [T + 45, T + 60]] });
    const { plan, state: s } = submit(state, [
      { id: 'A', station: 'X', cook: 20 },
      { id: 'B', station: 'Y', cook: 20 },
    ]);
    expect(target(plan)).toBe(T + 80);
    expect(s.lines.A!.booked).toEqual({ start: T + 60, end: T + 80, units: 1 });
    expect(s.lines.B!.booked).toEqual({ start: T + 60, end: T + 80, units: 1 });
    expect(eta(plan, 'A')).toBe(T + 80);
    expect(eta(plan, 'B')).toBe(T + 80);
  });

  it('[03a F #6] same-station sync items are serialised longest-first (D36)', () => {
    const state = kitchen({ X: [] });
    const { plan, state: s } = submit(state, [
      { id: 'A', station: 'X', cook: 20 },
      { id: 'B', station: 'X', cook: 15 },
    ]);
    expect(s.lines.A!.booked).toEqual({ start: T, end: T + 20, units: 1 });
    expect(s.lines.B!.booked).toEqual({ start: T + 20, end: T + 35, units: 1 });
    expect(target(plan)).toBe(T + 35);
    // Individual land times: A at T + 20, B at T + 35.
    expect(eta(plan, 'A')).toBe(T + 20);
    expect(eta(plan, 'B')).toBe(T + 35);
    // Listed in the other order, the result is the same (sorted by cook time, not by listing).
    const swapped = submit(state, [
      { id: 'B', station: 'X', cook: 15 },
      { id: 'A', station: 'X', cook: 20 },
    ]);
    expect(swapped.state.lines.A!.booked).toEqual(s.lines.A!.booked);
    expect(swapped.state.lines.B!.booked).toEqual(s.lines.B!.booked);
  });

  it("[03a F #7] an immediate item's tentative reservation blocks a sync item on the same station (D36)", () => {
    // [T, T + 5) is taken, so the immediate item I is tentatively reserved at [T + 5, T + 15).
    const state = kitchen({ X: [[T, T + 5]] });
    const { plan, state: s } = submit(state, [
      { id: 'S', station: 'X', cook: 20 },
      { id: 'I', station: 'X', cook: 10, mode: 'immediate' },
    ]);
    expect(s.lines.I!.booked).toEqual({ start: T + 5, end: T + 15, units: 1 });
    expect(plan.groups.find((g) => g.order_item_ids.includes('I'))!.target_land_ms).toBe(T + 15);
    // S's interval [tlt − 20, tlt) must not overlap [T + 5, T + 15): earliest tlt = T + 35.
    expect(plan.groups.find((g) => g.order_item_ids.includes('S'))!.target_land_ms).toBe(T + 35);
    expect(s.lines.S!.booked).toEqual({ start: T + 15, end: T + 35, units: 1 });
  });

  it('[03a F #10] the prep buffer does not occupy the station (D35)', () => {
    const state = kitchen({ X: [[T, T + 8]] });
    for (const mode of ['immediate', 'sync'] as const) {
      const { plan, state: s } = submit(state, [{ id: 'A', station: 'X', cook: 20, prep: 10, mode }]);
      expect(s.lines.A!.fire_ms).toBe(T);
      expect(s.lines.A!.booked).toEqual({ start: T + 10, end: T + 30, units: 1 });
      expect(eta(plan, 'A')).toBe(T + 30);
    }
  });
});

// Real lines for the overrun tests (D33): an order per line on station X, folded at recorded_at = T.
function stageEvents(o: { order_id: string; id: string; at: number; seq: number }) {
  const env = { stream_id: o.order_id, recorded_at: o.at, occurred_at: o.at, seq: o.seq, event_id: `01JF${String(o.seq).padStart(22, '0')}` };
  return {
    fire: deepFreeze(aFireDispatched({ ...env, stream_id: 'X', payload: { station_id: 'X', order_item_ids: [o.id], due_at: o.at } })),
    start: deepFreeze(anItemStarted({ ...env, payload: { order_item_id: o.id, started_at: o.at } })),
    done: deepFreeze(anItemDone({ ...env, payload: { order_item_id: o.id, done_at: o.at } })),
  };
}

describe('@pos/engine foundation §4.7 required tests (Done early, overrun, D33)', () => {
  it('[03a F #4] Done early frees capacity for the next item', () => {
    // Reservation A [T, T + 20) (fired and started at T), reservation B [T + 20, T + 40).
    let s = submit(kitchen({ X: [] }), [{ id: 'A', station: 'X', cook: 20 }], T, 'O1', 10).state;
    s = submit(s, [{ id: 'B', station: 'X', cook: 20 }], T, 'O2', 20).state;
    expect(s.lines.A!.booked).toEqual({ start: T, end: T + 20, units: 1 });
    expect(s.lines.B!.booked).toEqual({ start: T + 20, end: T + 40, units: 1 });
    s = applyEvent(s, stageEvents({ order_id: 'O1', id: 'A', at: T, seq: 30 }).fire);
    s = deepFreeze(applyEvent(s, stageEvents({ order_id: 'O1', id: 'A', at: T, seq: 31 }).start));
    // Control: still COOKING at T + 11, A occupies [T, T + 20), so C goes after B.
    expect(liveInterval(s, 'A', T + 11)).toEqual({ start: T, end: T + 20 });
    expect(eta(planOrder(s, order([{ id: 'C', station: 'X', cook: 5 }], 'O3'), T + 11, {}), 'C')).toBe(T + 45);

    // Done for A at T + 10: A's endsAt → T + 10 (it occupies nothing from then on).
    s = deepFreeze(applyEvent(s, stageEvents({ order_id: 'O1', id: 'A', at: T + 10, seq: 32 }).done));
    expect(s.lines.A!.done_at).toBe(T + 10);
    expect(liveInterval(s, 'A', T + 11)).toBeNull();
    const { plan, state: after } = submit(s, [{ id: 'C', station: 'X', cook: 5 }], T + 11, 'O3', 40);
    expect(after.lines.C!.fire_ms).toBe(T + 11);
    expect(after.lines.C!.booked).toEqual({ start: T + 11, end: T + 16, units: 1 });
    expect(eta(plan, 'C')).toBe(T + 16);
    // Without overlapping B.
    expect(after.lines.B!.booked).toEqual({ start: T + 20, end: T + 40, units: 1 });
  });

  it('[03a F #8] an overrunning item blocks the next slot (D33)', () => {
    let s = submit(kitchen({ X: [] }), [{ id: 'A', station: 'X', cook: 20 }], T, 'O1', 10).state;
    expect(s.lines.A!.booked).toEqual({ start: T, end: T + 20, units: 1 }); // planned endsAt = T + 20
    s = applyEvent(s, stageEvents({ order_id: 'O1', id: 'A', at: T, seq: 30 }).fire);
    s = deepFreeze(applyEvent(s, stageEvents({ order_id: 'O1', id: 'A', at: T, seq: 31 }).start));
    // now = T + 25, A still COOKING: live_endsAt(A) = T + 25.
    expect(liveInterval(s, 'A', T + 25)).toEqual({ start: T, end: T + 25 });
    const { plan, state: after } = submit(s, [{ id: 'B', station: 'X', cook: 10 }], T + 25, 'O2', 40);
    expect(after.lines.B!.fire_ms!).toBeGreaterThanOrEqual(T + 25);
    expect(after.lines.B!.booked).toEqual({ start: T + 25, end: T + 35, units: 1 });
    expect(eta(plan, 'B')).toBeGreaterThanOrEqual(T + 35);
  });
});

// F §4.7 batch station (D14, D17, D34, D35, D49): tests 3, 9, 14, 15 (task 13). Station F is a batch station; a
// load occupies the whole station (no two loads overlap, F §4.7 step 3(b)), so its booking holds `capacity` units.
// Targets are given as delivery pickups (§3.5.1: T = max(pickup, loop)); every F time here is inside freeze_ms,
// so the loads are frozen (fixed input that still accepts joiners, §3.7).
describe('@pos/engine foundation §4.7 required tests (batch loads)', () => {
  it('[03a F #3] batch: an item joins only when both freshness conditions hold', () => {
    // Batch A: endsAt = T + 10 000 (program P1, 6 000 ms), freshnessWindowMs = 5 000.
    let s = submitB(fryer({ freshness: 5_000 }), 'OA', [{ id: 'A0', cook: 6_000 }], T, { pickup_at_ms: T + 10_000 }).state;
    const A = loadOf(s, 'A0')!;
    expect(A).toMatchObject({ load_id: 'F:A0', program_id: 'P1', booked: { start: T + 4_000, end: T + 10_000, units: 4 } });
    // T + 10 000 joins A (exact match); T + 14 000 joins A (diff 4 000 ≤ 5 000); T + 16 000 does not (6 000 > 5 000).
    const r10 = submitB(s, 'O10', [{ id: 'X10', cook: 6_000 }], T, { pickup_at_ms: T + 10_000 });
    s = r10.state;
    expect(loadOf(s, 'X10')!.load_id).toBe('F:A0');
    expect(etaB(r10.plan, 'X10')).toBe(T + 10_000);
    const r14 = submitB(s, 'O14', [{ id: 'X14', cook: 6_000 }], T, { pickup_at_ms: T + 14_000 });
    s = r14.state;
    expect(loadOf(s, 'X14')!.load_id).toBe('F:A0');
    expect(etaB(r14.plan, 'X14')).toBe(T + 10_000);
    expect(r14.plan.groups[0]!.target_land_ms).toBe(T + 14_000);
    const r16 = submitB(s, 'O16', [{ id: 'X16', cook: 6_000 }], T, { pickup_at_ms: T + 16_000 });
    s = r16.state;
    expect(loadOf(s, 'X16')).toMatchObject({ load_id: 'F:X16', order_item_ids: ['X16'], booked: { start: T + 10_000, end: T + 16_000, units: 4 } });
    expect(loadOf(s, 'A0')!.order_item_ids).toEqual(['A0', 'X10', 'X14']);
    // A still holds the station once: 4 units over its interval, then the new load.
    expect(s.stations.F!.profile).toEqual({ t: [T + 4_000, T + 16_000], u: [4, 0] });
  });

  it('[03a F #9] a fired batch is closed to new joiners (D34)', () => {
    // Load L: startsAt = T − 5, endsAt = T + 1 000, 1 item, capacity 3, freshnessWindowMs = 5 000.
    const placed = submitB(fryer({ capacity: 3, freshness: 5_000 }), 'OL', [{ id: 'L0', cook: 1_005 }], T - 1_000, { pickup_at_ms: T + 1_000 }).state;
    expect(loadOf(placed, 'L0')).toMatchObject({ load_id: 'F:L0', fire_ms: T - 5, booked: { start: T - 5, end: T + 1_000, units: 3 } });
    // Control: before L starts, an item whose target is in L's window joins it.
    const before = submitB(placed, 'OX', [{ id: 'X', cook: 1_005 }], T - 10, { pickup_at_ms: T + 3_000 }).state;
    expect(loadOf(before, 'X')!.load_id).toBe('F:L0');
    // L fires at T − 5; at T, X (target T + 500 as in F, and T + 3 000 inside the window) does not join L.
    const fired = fold(placed, [fireLoad('F:L0', ['L0'], T - 5)]);
    expect(fired.lines.L0).toMatchObject({ fired_at: T - 5, load_id: 'F:L0' });
    expect(fired.stations.F!.loads).toEqual({});
    for (const pickup of [T + 500, T + 3_000]) {
      const s = submitB(fired, 'OX', [{ id: 'X', cook: 1_005 }], T, { pickup_at_ms: pickup }).state;
      const x = loadOf(s, 'X')!;
      expect(x).toMatchObject({ load_id: 'F:X', order_item_ids: ['X'] });
      // A new load, after L's live interval at T ([T, T + 1 005): packed from max(fire, now), §3.3).
      expect(liveInterval(s, 'L0', T)).toEqual({ start: T, end: T + 1_005 });
      expect(x.booked.start).toBeGreaterThanOrEqual(T + 1_005);
    }
  });

  it('[03a F #14] batch loads never mix programs (D49)', () => {
    // Capacity 4, P1 6 000 ms and P2 2 000 ms. Unfired load L (P1) with 1 item, endsAt = T + 10 000.
    const s0 = submitB(fryer({ capacity: 4 }), 'OL', [{ id: 'L0', cook: 6_000, program: 'P1' }], T, { pickup_at_ms: T + 10_000 }).state;
    const L = loadOf(s0, 'L0')!;
    expect(L.booked).toEqual({ start: T + 4_000, end: T + 10_000, units: 4 });
    // Sync item X (P2), target T + 10 000: free capacity and an exact freshness match, yet it does not join L.
    const s = submitB(s0, 'OX', [{ id: 'X', cook: 2_000, program: 'P2' }], T, { pickup_at_ms: T + 10_000 }).state;
    const x = loadOf(s, 'X')!;
    expect(x.load_id).not.toBe(L.load_id);
    expect(x.program_id).toBe('P2');
    expect(loadOf(s, 'L0')!.order_item_ids).toEqual(['L0']);
    // The new P2 load's station interval does not overlap L.
    expect(x.booked.start >= L.booked.end || x.booked.end <= L.booked.start).toBe(true);
    expect(x.booked).toEqual({ start: T + 10_000, end: T + 12_000, units: 4 });
  });

  it('[03a F #15] a new batch load excludes prep from station time (D35, D49)', () => {
    // Empty batch station, program P (cookTimeMs = 20); X: prep_buffer = 10; branchNow = T.
    for (const mode of ['sync', 'immediate'] as const) {
      const { plan, state: s } = submitB(fryer(), 'O1', [{ id: 'X', cook: 20, prep: 10, mode }], T);
      expect(etaB(plan, 'X')).toBe(T + 30);
      expect(loadOf(s, 'X')).toMatchObject({ fire_ms: T, booked: { start: T + 10, end: T + 30, units: 4 } });
      expect(s.lines.X!.fire_ms).toBe(T);
      // Reservation [T + 10, T + 30), not [T, T + 30).
      expect(s.stations.F!.profile).toEqual({ t: [T + 10, T + 30], u: [4, 0] });
    }
  });
});

// F §4.7 tests 12 and 13 (task 14): the fires tick (getTickIntents, D42, D44). Real logs: a config event with stations
// X and Y (capacity 1) and the §4.2 batches planned with planOrder, so buildEngineState replays them.
describe('@pos/engine foundation §4.7 required tests (fires tick, D42, D44)', () => {
  let n = 500;
  const ev = (e: PosEvent, at: number): PosEvent => {
    n++;
    return deepFreeze({ ...e, recorded_at: at, occurred_at: at, seq: n, event_id: `01JT${String(n).padStart(22, '0')}` });
  };
  const cfg = (cascade_step_ms: number): PosEvent => {
    const base = parseEvent(anEngineConfigApplied()).payload as unknown as EngineConfig;
    return ev(
      anEngineConfigApplied({
        payload: { stations: ['X', 'Y'].map((station_id) => ({ ...S1, station_id, capacity: 1 })), settings: { ...base.settings, cascade_step_ms } },
      }),
      T - 60_000,
    );
  };
  // planOrder at `at`, then the batch 02 appends (recorded_at = at).
  function batch(state: EngineState, items: Item[], at: number, order_id: string): PosEvent[] {
    const plan = planOrder(state, order(items, order_id), at, {});
    return anOrderBatch({
      order_id,
      recorded_at: at,
      seq: n + 1,
      lines: items.map((i) => ({
        order_item_id: i.id,
        item: { station_id: i.station, cook_time_ms: i.cook, prep_buffer_ms: i.prep ?? 0, serve_mode: i.mode ?? 'sync' },
        line: { station_id: i.station },
      })),
      order: { groups: plan.groups },
    }).map((e) => ev(e, at));
  }
  const fire = (station_id: string, id: string, at: number): PosEvent =>
    ev(aFireDispatched({ stream_id: station_id, payload: { station_id, order_item_ids: [id], load_id: null, due_at: at, reason: 'scheduled' } }), at);
  const start = (order_id: string, id: string, at: number): PosEvent =>
    ev(anItemStarted({ stream_id: order_id, payload: { order_item_id: id, started_at: at, source: 'tap' } }), at);
  function replay(log: PosEvent[]): EngineState {
    return deepFreeze(buildEngineState(log));
  }

  it('[03a F #11] capacity reduction triggers recalculation (D37): A keeps its slot, B moves after it; the slip is on the next getAlertIntents, not in the event (F-17)', () => {
    let s = deepFreeze(
      applyEvent(
        initialEngineState(),
        deepFreeze(
          anEngineConfigApplied({
            recorded_at: T - 60_000,
            payload: { stations: [{ ...S1, station_id: 'X', capacity: 2 }], settings: { ...(parseEvent(anEngineConfigApplied()).payload as unknown as EngineConfig).settings, slip_threshold_ms: 5 } },
          }),
        ),
      ),
    );
    // A = [T+5, T+25), B = [T+10, T+30) (prep off-station, D35; separate tables so the slip names B's order).
    s = submit(s, [{ id: 'A', station: 'X', cook: 20, prep: 5 }], T, 'OA', 10).state;
    s = submit(s, [{ id: 'B', station: 'X', cook: 20, prep: 10 }], T, 'OB', 20).state;
    expect(s.lines.A!.booked).toEqual({ start: T + 5, end: T + 25, units: 1 });
    expect(s.lines.B!.booked).toEqual({ start: T + 10, end: T + 30, units: 1 });
    const event = { ...anItemStarted(), stream_type: 'station', stream_id: 'X', event_type: 'StationCapacitySet', payload: { station_id: 'X', capacity_override: 1, previous: null, reason: 'manager' }, recorded_at: T, occurred_at: T, seq: 30 } as PosEvent;
    const after = deepFreeze(applyEvent(s, deepFreeze(event)));
    expect(after.lines.A!.booked).toEqual({ start: T + 5, end: T + 25, units: 1 });
    expect(after.lines.B!.booked).toEqual({ start: T + 25, end: T + 45, units: 1 });
    expect(after.lines.B!.mark).toBe('moved');
    expect(after.lines.A!.mark).toBeNull();
    // Both orders share a table_key in this kit: the slip names B's order, written on the next pass (D13: the fold wrote nothing).
    expect(after.slips).toEqual({});
    const slips = getAlertIntents(after, T).slips;
    expect(slips).toHaveLength(1);
    expect(slips[0]!.order_ids).toEqual(['OB']);
    expect(slips[0]!.estimate).toBe(T + 45);
  });

  it('[03a F #13] replay does not re-fire (D44); a missed fire is dispatched exactly once; the same intents twice (pure)', () => {
    // A's latest start is T + 10 (B holds X until then).
    const log: PosEvent[] = [cfg(60_000)];
    log.push(...batch(replay(log), [{ id: 'B', station: 'X', cook: 10, mode: 'immediate' }], T, 'OB'), fire('X', 'B', T));
    log.push(...batch(replay(log), [{ id: 'A', station: 'X', cook: 20, mode: 'immediate' }], T, 'OA'));
    expect(replay(log).lines.A!.fire_ms).toBe(T + 10);
    // First log: FireDispatched(A) at T + 10; rebuilt, the tick at T + 60 has no FireDispatched for A.
    const fired = replay([...log, fire('X', 'A', T + 10)]);
    expect(fired.lines.A!.fired_at).toBe(T + 10);
    expect(getTickIntents(fired, T + 60).filter((d) => d.event_type === 'FireDispatched')).toEqual([]);
    // Second log, no FireDispatched: exactly one FireDispatched intent for A (the missed fire).
    const missed = replay(log);
    const intents = getTickIntents(missed, T + 60);
    expect(intents).toEqual([
      { stream_type: 'station', stream_id: 'X', event_type: 'FireDispatched', schema_version: 1, payload: { station_id: 'X', order_item_ids: ['A'], load_id: null, due_at: T + 10, reason: 'scheduled' } },
    ]);
    expect(getTickIntents(missed, T + 60)).toEqual(intents);
  });

  it('[03a F #12] an overrun cascades down the station: one ReservationsShifted (quantised); other stations and targets unchanged; state unchanged until applied', () => {
    // X: A (O1) COOKING, planned [T, T + 20). B (O2, sync) [T + 20, T + 30), C (O3, sync) [T + 30, T + 40);
    // O2's sync sibling B2 on Y [T + 20, T + 30). cascade_step_ms = 5.
    const log: PosEvent[] = [cfg(5)];
    log.push(...batch(replay(log), [{ id: 'A', station: 'X', cook: 20, mode: 'immediate' }], T, 'O1'), fire('X', 'A', T), start('O1', 'A', T));
    log.push(...batch(replay(log), [{ id: 'B', station: 'X', cook: 10 }, { id: 'B2', station: 'Y', cook: 10 }], T, 'O2'));
    log.push(...batch(replay(log), [{ id: 'C', station: 'X', cook: 10 }], T, 'O3'));
    const s0 = replay(log);
    expect(s0.lines.B!.booked).toEqual({ start: T + 20, end: T + 30, units: 1 });
    expect(s0.lines.B2!.booked).toEqual({ start: T + 20, end: T + 30, units: 1 });
    expect(s0.lines.C!.booked).toEqual({ start: T + 30, end: T + 40, units: 1 });
    // The tick at T + 20 fired B and B2 (their fire time; A at its planned end, no shift); B2 was started then.
    expect(getTickIntents(s0, T + 20).map((d) => [d.event_type, d.stream_id])).toEqual([
      ['FireDispatched', 'X'],
      ['FireDispatched', 'Y'],
    ]);
    const s = replay([...log, fire('X', 'B', T + 20), fire('Y', 'B2', T + 20), start('O2', 'B2', T + 20)]);
    // Tick at T + 25, A still COOKING.
    const intents = getTickIntents(s, T + 25);
    expect(liveInterval(s, 'A', T + 25)).toEqual({ start: T, end: T + 25 });
    // B (fired, not started) is packed behind A's live end (F-20): [T + 25, T + 35); C is shifted by one 5 ms step
    // to [T + 35, T + 45); B2 on Y unchanged; the targets unchanged (slips for O2 / O3: getAlertIntents, task 15).
    expect(liveInterval(s, 'B', T + 25)).toEqual({ start: T + 25, end: T + 35 });
    expect(intents).toEqual([
      { stream_type: 'station', stream_id: 'X', event_type: 'ReservationsShifted', schema_version: 1, payload: { station_id: 'X', cause: 'overrun', shifts: [{ order_item_id: 'C', by_ms: 5 }] } },
    ]);
    expect(s.lines.C!.booked!.start + 5).toBe(T + 35);
    expect(liveInterval(s, 'B2', T + 25)).toEqual({ start: T + 20, end: T + 30 });
    expect([s.orders.O2!.target_land_ms, s.orders.O3!.target_land_ms]).toEqual([T + 30, T + 40]);
    // Pure: the state is unchanged until the intent is applied.
    expect(getTickIntents(s, T + 25)).toEqual(intents);
    expect(s.lines.C!.booked).toEqual({ start: T + 30, end: T + 40, units: 1 });
  });
});
