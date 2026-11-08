// Test kit for batch-station loads (F §4.7 batch, D14, D17, D34, D35, D49; 03a §3.2, §3.3, task 13): a batch
// station F (a fryer) beside slot station S1, programs P1 / P2 whose *config* cook times are deliberately wrong
// (the engine must read the ItemAdded copies, §3.2 / 01c B1), and a submit that plans with planOrder at now and
// folds the §4.2 batch 02 would append at recorded_at = now (the same placement, §3.5.1).
import { parseEvent, type EngineConfig, type ItemAddedPayload, type PosEvent } from '@pos/events';
import { aFireDispatched, anEngineConfigApplied, anItemAdded, anItemStarted, anOrderBatch } from '@pos/events/testing';
import { expect } from 'vitest';
import { applyEvent, initialEngineState, planOrder, type EngineState, type Load, type PlanResult, type ProposedOrder } from '../src/index';

export const T = 1_761_000_000_000;

export function deepFreeze<V>(value: V): V {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const S1 = (parseEvent(anEngineConfigApplied()).payload as unknown as EngineConfig).stations[0]!;
type StationCfg = EngineConfig['stations'][number];

// Config cook times that no placement may use (§3.2: batch cook time from the line copies, never config).
export const CONFIG_COOK = 999_999;

export function batchConfig(o: { capacity?: number; freshness?: number; freeze_ms?: number; F?: Partial<StationCfg> } = {}, recorded_at = T - 3_600_000): PosEvent {
  return anEngineConfigApplied({
    recorded_at,
    occurred_at: recorded_at,
    seq: 1,
    payload: {
      stations: [
        {
          ...S1,
          station_id: 'F',
          name: 'Fryer',
          station_type: 'batch',
          capacity: o.capacity ?? 4,
          freshness_window_ms: o.freshness ?? 5_000,
          freeze_ms: o.freeze_ms ?? S1.freeze_ms,
          programs: [
            { program_id: 'P1', name: 'Fry 180', cook_time_ms: CONFIG_COOK, is_archived: false },
            { program_id: 'P2', name: 'Reheat', cook_time_ms: CONFIG_COOK, is_archived: false },
          ],
          ...o.F,
        },
        { ...S1, station_id: 'S1' },
      ],
    },
  });
}

export function fryer(o: Parameters<typeof batchConfig>[0] = {}): EngineState {
  return deepFreeze(applyEvent(initialEngineState(), deepFreeze(batchConfig(o))));
}

// A batch line: program (default P1) and its copied cook time; stock: the copied stock program (01c B1).
export type BItem = {
  id: string;
  cook: number;
  program?: string;
  prep?: number;
  mode?: 'sync' | 'immediate';
  units?: number;
  early?: number;
  stock?: { program: string; cook: number };
  from_stock?: boolean;
};
export type BOrder = { pickup_at_ms?: number | null };

function itemFields(i: BItem): Record<string, unknown> {
  return {
    station_id: 'F',
    program_id: i.program ?? 'P1',
    program_cook_time_ms: i.cook,
    stock_program_id: i.stock?.program ?? null,
    stock_program_cook_time_ms: i.stock?.cook ?? null,
    cook_time_ms: CONFIG_COOK,
    prep_buffer_ms: i.prep ?? 0,
    serve_mode: i.mode ?? 'sync',
    quantity: i.units ?? 1,
  };
}

export function proposedB(order_id: string, items: BItem[], o: BOrder = {}): ProposedOrder {
  const base = anItemAdded().payload as unknown as ItemAddedPayload;
  const pickup = o.pickup_at_ms ?? null;
  return deepFreeze({
    order_id,
    order: { order_type: pickup === null ? 'dine_in' : 'delivery', table_id: 'T12', table_key: 'dine_in:T12', follow_up: false, pickup_at_ms: pickup },
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

let seq = 100;
export const nextSeq = (n = 0): number => {
  const s = seq;
  seq += n + 1;
  return s;
};

export function fold(state: EngineState, events: PosEvent[], opts?: { strict?: boolean }): EngineState {
  let s = deepFreeze(state);
  for (const e of events) s = deepFreeze(applyEvent(s, deepFreeze(e), opts));
  return s;
}

export function batchEvents(order_id: string, items: BItem[], now: number, plan: PlanResult, o: BOrder = {}): PosEvent[] {
  const pickup = o.pickup_at_ms ?? null;
  return anOrderBatch({
    order_id,
    recorded_at: now,
    seq: nextSeq(items.length),
    lines: items.map((i) => ({
      order_item_id: i.id,
      item: itemFields(i),
      line: { station_id: 'F', max_early_ms: i.early ?? 60_000, from_stock: i.from_stock ?? false },
    })),
    order: { order_type: pickup === null ? 'dine_in' : 'delivery', pickup_at_ms: pickup, groups: plan.groups },
  });
}

// The load (on F) a line is a member of, if any.
export function loadOf(s: EngineState, id: string): Load | undefined {
  return Object.values(s.stations.F!.loads).find((l) => l.order_item_ids.includes(id));
}

// planOrder at now, then the batch folded at now; every planned line is a member of an F load whose end is the
// plan's land time, and the line's fire is the load's.
export function submitB(state: EngineState, order_id: string, items: BItem[], now = T, o: BOrder = {}): { plan: PlanResult; state: EngineState } {
  const from_stock = Object.fromEntries(items.filter((i) => i.from_stock === true).map((i) => [i.id, true]));
  const plan = planOrder(state, proposedB(order_id, items, o), now, from_stock);
  const s = fold(state, batchEvents(order_id, items, now, plan, o));
  for (const l of plan.lines) {
    const load = loadOf(s, l.order_item_id);
    expect(load, l.order_item_id).toBeDefined();
    expect(load!.booked.end + l.carry_ms).toBe(l.eta_ms);
    expect(s.lines[l.order_item_id]!).toMatchObject({ fire_ms: load!.fire_ms, load_id: load!.load_id, booked: null });
  }
  return { plan, state: s };
}

export function etaB(plan: PlanResult, id: string): number {
  return plan.lines.find((l) => l.order_item_id === id)!.eta_ms;
}

export function fireLoad(load_id: string | null, ids: string[], recorded_at: number): PosEvent {
  return aFireDispatched({
    stream_id: 'F',
    recorded_at,
    occurred_at: recorded_at,
    seq: nextSeq(),
    payload: { station_id: 'F', order_item_ids: ids, load_id, due_at: recorded_at, reason: 'scheduled' },
  });
}

// An order-stream event of `order_id` at `recorded_at`.
export function orderEv(event_type: string, order_id: string, payload: Record<string, unknown>, recorded_at: number): PosEvent {
  const s = nextSeq();
  return { ...anItemStarted(), event_type, stream_id: order_id, payload, recorded_at, occurred_at: recorded_at, seq: s, event_id: `01J${String(s).padStart(23, '0')}` };
}
export const voidB = (o: string, id: string, units: number, t: number): PosEvent => orderEv('ItemVoided', o, { order_item_id: id, units }, t);
export const startB = (o: string, id: string, t: number): PosEvent => orderEv('ItemStarted', o, { order_item_id: id, started_at: t, source: 'tap' }, t);
