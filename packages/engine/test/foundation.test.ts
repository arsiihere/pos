// Foundation §4.7 "Required unit tests for @pos/engine" (F tests 1–15), relative to T = 1_761_000_000_000.
// Times are in ms as the foundation writes them; the engine reads them as integer ms.
import { parseEvent, type EngineConfig, type ItemAddedPayload } from '@pos/events';
import { anEngineConfigApplied, anItemAdded, anOrderBatch } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { addInterval, applyEvent, initialEngineState, planOrder, type EngineState, type PlanResult, type ProposedOrder } from '../src/index';

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

function order(items: Item[]): ProposedOrder {
  const base = anItemAdded().payload as unknown as ItemAddedPayload;
  return deepFreeze({
    order_id: 'O1',
    order: { order_type: 'dine_in', table_id: 'T12', table_key: 'dine_in:T12', follow_up: false, pickup_at_ms: null },
    lines: items.map((i) => ({
      ...base,
      order_id: 'O1',
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
function submit(state: EngineState, items: Item[]): { plan: PlanResult; state: EngineState } {
  const plan = planOrder(state, order(items), T, {});
  const batch = anOrderBatch({
    order_id: 'O1',
    recorded_at: T,
    seq: 10,
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

