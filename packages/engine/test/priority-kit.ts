// 03a v1.2.10 §3.5.7, §10.3g (STAB-7, tests 152–177) test kit for slot stations: a kitchen of slot stations, a submit
// that plans with planOrder at now and folds the §4.2 batch 02 would append (with ItemAdded.max_delay_ms, PR-1), and the
// stage and priority events. After every fold the stored slip_due and priority_due equal their full recomputes (test
// 106). Pure: every input is deep-frozen. No timing asserts (AD-32).
import { parseEvent, type EngineConfig, type ItemAddedPayload, type PosEvent } from '@pos/events';
import { aFireDispatched, anEngineConfigApplied, anItemAdded, anItemDone, anItemStarted, anOrderBatch } from '@pos/events/testing';
import { expect } from 'vitest';
import { applyEvent, getAlertIntents, initialEngineState, planOrder, type EngineState, type LinePrioritizedDraft, type PlanResult, type ProposedOrder } from '../src/index';
import { priorityDueOf, slipDueOf } from '../src/slip';

export const T0 = 1_761_000_000_000; // "12:00"
export const S = 1_000;
export const M = 60_000;
export const at = (min: number): number => T0 + min * M;

export function deepFreeze<V>(value: V): V {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const BASE = parseEvent(anEngineConfigApplied()).payload as unknown as EngineConfig;
export type StationCfg = EngineConfig['stations'][number];
export type Settings = EngineConfig['settings'];

let seq = 10;
export const nextSeq = (n = 0): number => {
  const s = seq;
  seq += n + 1;
  return s;
};
export const stamp = (e: PosEvent, t: number): PosEvent => {
  const s = nextSeq();
  return { ...e, recorded_at: t, occurred_at: t, seq: s, event_id: `01P${String(s).padStart(23, '0')}` };
};

export function configEvent(stations: Array<Partial<StationCfg> & { station_id: string }>, settings: Partial<Settings> = {}, t = T0 - 3_600_000): PosEvent {
  const list = [...stations].sort((a, b) => (a.station_id < b.station_id ? -1 : 1)).map((s) => ({ ...BASE.stations[0]!, name: s.station_id, ...s }));
  return stamp(anEngineConfigApplied({ payload: { stations: list, settings: { ...BASE.settings, ...settings } } }), t);
}

export function checkUpkeep(s: EngineState): void {
  expect(s.slip_due).toEqual(slipDueOf(s));
  expect(s.priority_due).toEqual(priorityDueOf(s));
  const vals = [...Object.values(s.slip_due), ...Object.values(s.priority_due)];
  expect(s.next_alert_due_at).toBe(vals.length === 0 ? null : Math.min(...vals));
}

export function fold(state: EngineState, events: PosEvent[], log?: PosEvent[]): EngineState {
  let s = deepFreeze(state);
  for (const e of events) {
    s = deepFreeze(applyEvent(s, deepFreeze(e)));
    log?.push(e);
    checkUpkeep(s);
  }
  return s;
}

export function kitchen(stations: Array<Partial<StationCfg> & { station_id: string }>, settings: Partial<Settings> = {}, log?: PosEvent[]): EngineState {
  return fold(initialEngineState(), [configEvent(stations, settings)], log);
}

// maxDelay: the ItemAdded.max_delay_ms copy (undefined = the field absent on the event).
// batch: a line on a batch station with program P1 (its copied cook time, §3.2).
export type Item = { id: string; station?: string; cook: number; prep?: number; mode?: 'sync' | 'immediate'; units?: number; carry?: number; early?: number; maxDelay?: number | null; weight?: number; batch?: boolean };
export type OrderOpts = { key?: string; order_type?: 'dine_in' | 'takeaway' | 'delivery' | 'parking'; follow_up?: boolean; pickup_at_ms?: number | null };

function itemFields(i: Item): Record<string, unknown> {
  return {
    station_id: i.station ?? 'S1',
    cook_time_ms: i.cook,
    prep_buffer_ms: i.prep ?? 0,
    serve_mode: i.mode ?? 'sync',
    quantity: i.units ?? 1,
    ...(i.maxDelay === undefined ? {} : { max_delay_ms: i.maxDelay }),
    ...(i.batch === true ? { program_id: 'P1', program_cook_time_ms: i.cook, stock_program_id: null, stock_program_cook_time_ms: null, cook_time_ms: 999_999 } : {}),
  };
}

// A batch station config entry (one program P1 whose config cook time no placement may use, §3.2).
export function batchStation(station_id: string, o: Partial<StationCfg> = {}): Partial<StationCfg> & { station_id: string } {
  return {
    station_id,
    station_type: 'batch',
    capacity: 8,
    freshness_window_ms: 2 * M,
    freeze_ms: 2 * M,
    min_slack_keep_ms: M,
    programs: [{ program_id: 'P1', name: 'Bake', cook_time_ms: 999_999, is_archived: false }],
    ...o,
  } as Partial<StationCfg> & { station_id: string };
}

export function proposed(order_id: string, items: Item[], o: OrderOpts = {}): ProposedOrder {
  const base = anItemAdded().payload as unknown as ItemAddedPayload;
  return deepFreeze({
    order_id,
    order: { order_type: o.order_type ?? 'dine_in', table_id: 'T12', table_key: o.key ?? `t:${order_id}`, follow_up: o.follow_up ?? false, pickup_at_ms: o.pickup_at_ms ?? null },
    lines: items.map((i) => ({
      ...base,
      ...(itemFields(i) as Partial<ItemAddedPayload>),
      order_id,
      order_item_id: i.id,
      alternates: [],
      point_id: null,
      carry_ms: i.carry ?? 0,
      weight_pct: i.weight ?? 100,
      max_early_ms: i.early ?? 60_000,
      max_late_ms: null,
      max_carry_ms: null,
      cook_ms_override: null,
      return_of: null,
    })),
  });
}

// planOrder at now, then the §4.2 batch folded at now.
export function submit(state: EngineState, order_id: string, items: Item[], now: number, o: OrderOpts = {}, log?: PosEvent[]): { plan: PlanResult; state: EngineState } {
  const plan = planOrder(state, proposed(order_id, items, o), now, {});
  const first = nextSeq(items.length + 1);
  const events = anOrderBatch({
    order_id,
    recorded_at: now,
    seq: first,
    lines: items.map((i) => ({
      order_item_id: i.id,
      item: itemFields(i),
      line: { station_id: plan.lines.find((l) => l.order_item_id === i.id)!.station_id, carry_ms: i.carry ?? 0, max_early_ms: i.early ?? 60_000, weight_pct: i.weight ?? 100 },
    })),
    order: {
      groups: plan.groups,
      order_type: o.order_type ?? 'dine_in',
      table_id: 'T12',
      table_key: o.key ?? `t:${order_id}`,
      follow_up: o.follow_up ?? false,
      pickup_at_ms: o.pickup_at_ms ?? null,
    },
  }).map((e, k) => ({ ...e, event_id: `01Q${String(first + k).padStart(23, '0')}` }));
  return { plan, state: fold(state, events, log) };
}

export const fireEv = (station_id: string, ids: string[], t: number): PosEvent =>
  stamp(aFireDispatched({ stream_id: station_id, payload: { station_id, order_item_ids: ids, load_id: null, due_at: t, reason: 'scheduled' } }), t);
export const startEv = (order_id: string, id: string, t: number): PosEvent => stamp(anItemStarted({ stream_id: order_id, payload: { order_item_id: id, started_at: t, source: 'tap' } }), t);
export const doneEv = (order_id: string, id: string, t: number): PosEvent => stamp(anItemDone({ stream_id: order_id, payload: { order_item_id: id, done_at: t, source: 'tap' } }), t);
export const orderEv = (event_type: string, order_id: string, payload: Record<string, unknown>, t: number): PosEvent =>
  stamp({ ...anItemStarted(), event_type, stream_id: order_id, payload }, t);
export const stationEv = (event_type: string, station_id: string, payload: Record<string, unknown>, t: number): PosEvent =>
  stamp({ ...aFireDispatched(), stream_type: 'station', stream_id: station_id, event_type, payload }, t);
export const capacityEv = (station_id: string, capacity_override: number | null, t: number): PosEvent =>
  stationEv('StationCapacitySet', station_id, { station_id, capacity_override, previous: null, reason: 'manager' }, t);

// A LinePrioritized as fires_alerts writes it from a draft (§6.2a step 7), stamped at t.
export function prioritizedEv(d: LinePrioritizedDraft, t: number): PosEvent {
  return stamp({ ...anItemStarted(), stream_type: 'order', stream_id: d.stream_id, event_type: 'LinePrioritized', schema_version: 1, payload: { ...d.payload } as unknown as Record<string, unknown> }, t);
}

// The drafts of getAlertIntents at now folded at now (the priority half of one fires_alerts pass).
export function prioritize(s: EngineState, now: number, log?: PosEvent[]): EngineState {
  const drafts = getAlertIntents(s, now).prioritized;
  return fold(s, drafts.map((d) => prioritizedEv(d, now)), log);
}

export const G = (order_id: string, i = 0): string => `${order_id}:${i}`;
export const Tg = (s: EngineState, order_id: string, i = 0): number => s.orders[order_id]!.groups[G(order_id, i)]!.target_land_ms;
// A line's planned land at its point: its booking's end + carry.
export const landOf = (s: EngineState, id: string): number => s.lines[id]!.booked!.end + s.lines[id]!.carry_ms;
