// 02b v1.0.20 §3.2 step 4a, test 40 (STAB-5): with a slot-station line sent as one-unit lines, a big order is not
// pushed back by later orders (03a AD-4 holds a multi-unit line until all its units are free together; proposal
// docs/plans/stab-b2-unit-split-proposal.md §1). The engine is unchanged; this pins the behaviour the split relies on.
import { parseEvent, type EngineConfig, type ItemAddedPayload, type PosEvent } from '@pos/events';
import { aFireDispatched, anEngineConfigApplied, anItemAdded, anOrderBatch } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { applyEvent, initialEngineState, planOrder, type EngineState, type PlanResult, type ProposedOrder } from '../src/index';
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


const karahi = (id: string): Item => ({ id, cook: 20, mode: 'immediate', early: 60 });
const parts = (order: string, n: number): Item[] => Array.from({ length: n }, (_, i) => karahi(`${order}${i + 1}`));

describe('[02b #40] one-unit lines on a slot station keep arrival order (STAB-5)', () => {
  it('capacity 4, one cooking; then ×4, ×2, ×3, ×5, ×1 and a stream of singles: free units start at once, no order waits behind a later one', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 4 }]);
    let r = submit(s, 'OA', [karahi('A1')], at(0));
    s = fold(r.state, [fire(['A1'], at(0))]);
    const orders: Array<[string, number, number]> = [['B', 4, 5], ['C', 2, 6], ['D', 3, 7], ['E', 5, 8], ['F', 1, 9]];
    for (let t = 10; t <= 30; t += 2) orders.push([`S${t}`, 1, t]);
    for (const [o, n, t] of orders) {
      r = submit(s, `O${o}`, parts(o, n), at(t));
      s = r.state;
    }
    const fireOf = (id: string): number => s.lines[id]!.fire_ms!;
    // B: the 3 free units start at once (+5), its 4th when A's unit frees
    expect(['B1', 'B2', 'B3'].map(fireOf)).toEqual([at(5), at(5), at(5)]);
    // arrival order: an order's first part never fires after a later order's first part
    const firsts = orders.map(([o]) => fireOf(`${o}1`));
    for (let i = 1; i < firsts.length; i += 1) expect(firsts[i]!, orders[i]![0]).toBeGreaterThanOrEqual(firsts[i - 1]!);
    // E ×5 is not left behind: every part of E fires no later than the first single ordered after it
    const eLast = Math.max(...[1, 2, 3, 4, 5].map((k) => fireOf(`E${k}`)));
    expect(eLast).toBeLessThanOrEqual(fireOf('S101')); // S10's only part (ordered at +10, after E)
  });
});
