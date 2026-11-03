import { readFileSync } from 'node:fs';
import { parseEvent, type EngineConfig, type PosEvent } from '@pos/events';
import { aBusinessDayOpened, aStockSet, anEngineConfigApplied } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  buildEngineState,
  ENGINE_REPLAY_EVENTS,
  ENGINE_STATE_VERSION,
  initialEngineState,
  type BusinessDay,
  type DayDraws,
  type EngineLine,
  type EngineOrder,
  type EngineState,
  type Load,
  type Profile,
  type SlipRecord,
  type StationRuntime,
  type StockEntry,
} from '../src/index';

const T0 = 1_761_000_000_000;

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')) as unknown;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

// D62 key-set snapshot. One entry per ENGINE_STATE_VERSION; an entry is never edited once its version
// ships. Adding or removing a key of any interface below fails the type check of this file (R31) until a
// new entry is written, and that entry needs ENGINE_STATE_VERSION bumped to its number.
const KEY_SETS = {
  3: {
    EngineState: ['stock', 'business_day', 'config', 'stations', 'orders', 'lines', 'slips', 'next_alert_due_at', 'slip_due'],
    StockEntry: ['on_hand', 'reserved', 'set_at', 'unit'],
    BusinessDay: ['business_date', 'opened_at', 'closed_at', 'stock_units', 'draws'],
    DayDraws: ['sale_unit', 'stock_draws'],
    SlipRecord: ['order_ids', 'last_estimate', 'alert_id', 'resolved_at'],
    StationRuntime: ['station_id', 'type', 'capacity', 'capacity_override', 'paused', 'profile', 'unfired', 'loads'],
    Profile: ['t', 'u'],
    Load: ['load_id', 'program_id', 'order_item_ids', 'fire_ms', 'fired_at'],
    EngineOrder: [
      'order_id', 'order_type', 'table_key', 'table_id', 'follow_up', 'pickup_at_ms', 'placed_at', 'placed_by',
      'target_land_ms', 'promise_ms', 'boosted', 'line_ids', 'awaiting', 'last_served_at', 'last_line_fold_at',
      'next_group_index', 'groups',
    ],
    EngineLine: [
      'order_item_id', 'order_id', 'group_id', 'serve_mode', 'station_id', 'alternates', 'point_id', 'carry_ms',
      'units', 'prep_ms', 'cook_ms', 'full_cook_ms', 'from_stock', 'program_id', 'stock_cook_ms', 'stock_program_id',
      'draws', 'reserved_seq', 'weight_pct', 'max_early_ms', 'max_late_ms', 'max_carry_ms', 'stage', 'fire_ms',
      'deadline_ms', 'fired_at', 'started_at', 'done_at', 'mark', 'return_of', 'load_id',
    ],
  },
} as const;

type Current = (typeof KEY_SETS)[typeof ENGINE_STATE_VERSION];
type SameKeys<T, K extends readonly PropertyKey[]> = [Exclude<keyof T, K[number]>, Exclude<K[number], keyof T>] extends [
  never,
  never,
]
  ? true
  : false;
const keysMatch: {
  EngineState: SameKeys<EngineState, Current['EngineState']>;
  StockEntry: SameKeys<StockEntry, Current['StockEntry']>;
  BusinessDay: SameKeys<BusinessDay, Current['BusinessDay']>;
  DayDraws: SameKeys<DayDraws, Current['DayDraws']>;
  SlipRecord: SameKeys<SlipRecord, Current['SlipRecord']>;
  StationRuntime: SameKeys<StationRuntime, Current['StationRuntime']>;
  Profile: SameKeys<Profile, Current['Profile']>;
  Load: SameKeys<Load, Current['Load']>;
  EngineOrder: SameKeys<EngineOrder, Current['EngineOrder']>;
  EngineLine: SameKeys<EngineLine, Current['EngineLine']>;
} = {
  EngineState: true,
  StockEntry: true,
  BusinessDay: true,
  DayDraws: true,
  SlipRecord: true,
  StationRuntime: true,
  Profile: true,
  Load: true,
  EngineOrder: true,
  EngineLine: true,
};

function stationConfig(payload: EngineConfig, id: string): EngineConfig['stations'][number] {
  const found = payload.stations.find((s) => s.station_id === id);
  if (found === undefined) throw new Error(id);
  return found;
}

const S1 = stationConfig(parseEvent(anEngineConfigApplied()).payload as unknown as EngineConfig, 'S1');

function configEvent(stations: Array<Partial<EngineConfig['stations'][number]>>, recorded_at = T0): PosEvent {
  return anEngineConfigApplied({ recorded_at, occurred_at: recorded_at, payload: { stations: stations.map((s) => ({ ...S1, ...s })) } });
}

describe('@pos/engine EngineState v3', () => {
  it('[03a #56] buildEngineState(engine-log.v3.json) deep-equals engine-state.v3.json; the key set is snapshotted per ENGINE_STATE_VERSION', () => {
    expect(ENGINE_STATE_VERSION).toBe(3);
    const log = (fixture(`engine-log.v${ENGINE_STATE_VERSION}.json`) as unknown[]).map((e) => parseEvent(e));
    expect(log.map((e) => e.event_type)).toEqual(['EngineConfigApplied', 'BusinessDayOpened', 'StockSet']);
    const state = buildEngineState(deepFreeze(log));
    expect(state).toEqual(fixture(`engine-state.v${ENGINE_STATE_VERSION}.json`));

    const keys = KEY_SETS[ENGINE_STATE_VERSION];
    expect(Object.values(keysMatch).every(Boolean)).toBe(true);
    expect(Object.keys(state).sort()).toEqual([...keys.EngineState].sort());
    expect(Object.keys(state.stations)).toEqual(['S1', 'S2']);
    for (const station of Object.values(state.stations)) {
      expect(Object.keys(station).sort()).toEqual([...keys.StationRuntime].sort());
    }
    expect(Object.keys(initialEngineState()).sort()).toEqual([...keys.EngineState].sort());
  });

  it('[03a §3.3] initialEngineState is the empty v3 state', () => {
    expect(initialEngineState()).toEqual({
      stock: {},
      business_day: null,
      config: null,
      stations: {},
      orders: {},
      lines: {},
      slips: {},
      next_alert_due_at: null,
      slip_due: {},
    });
  });

  it('[03a §3.12] ENGINE_REPLAY_EVENTS are the §3.12 lists per stream', () => {
    expect(ENGINE_REPLAY_EVENTS).toEqual({
      order: [
        'OrderPlaced', 'OrderLinesAdded', 'ItemAdded', 'ItemStarted', 'ItemDone', 'ItemDoneUndone', 'ItemServed',
        'ItemRemoved', 'ItemVoided', 'ItemMovedToStock', 'ItemReturned', 'OrderBoosted', 'ItemsReleased', 'SlipWarned',
        'AlertClosed',
      ],
      station: ['FireDispatched', 'ReservationsShifted', 'EngineConfigApplied', 'StationCapacitySet', 'StationPauseSet'],
      stock: ['StockSet', 'StockAdded', 'StockReserved', 'StockReleased', 'StockConsumed'],
      hub: ['BusinessDayOpened', 'BusinessDayClosed'],
    });
  });

  it('[03a §3.11] EngineConfigApplied stores config and creates a StationRuntime per station with an empty profile', () => {
    const event = deepFreeze(configEvent([{ station_id: 'S1' }, { station_id: 'S2', station_type: 'batch', capacity: 2 }]));
    const before = deepFreeze(initialEngineState());
    const state = applyEvent(before, event);
    expect(before).toEqual(initialEngineState());
    expect(state.config).toEqual(event.payload);
    expect(state.stations).toEqual({
      S1: { station_id: 'S1', type: 'slot', capacity: 4, capacity_override: null, paused: false, profile: { t: [], u: [] }, unfired: [], loads: {} },
      S2: { station_id: 'S2', type: 'batch', capacity: 2, capacity_override: null, paused: false, profile: { t: [], u: [] }, unfired: [], loads: {} },
    });
  });

  it('[03a §3.11] the config fold keeps capacity_override / paused of an existing station and sets type / capacity from the payload', () => {
    const first = applyEvent(initialEngineState(), configEvent([{ station_id: 'S1' }, { station_id: 'S2' }]));
    const profile: Profile = { t: [T0, T0 + 60_000], u: [1, 0] };
    const held: EngineState = deepFreeze({
      ...first,
      stations: {
        ...first.stations,
        S1: { ...first.stations.S1!, capacity_override: 2, paused: true, profile, unfired: ['L1'] },
      },
    });
    const next = applyEvent(held, deepFreeze(configEvent([{ station_id: 'S1', station_type: 'batch', capacity: 6 }, { station_id: 'S2' }], T0 + 1000)));
    expect(next.stations.S1).toEqual({
      station_id: 'S1', type: 'batch', capacity: 6, capacity_override: 2, paused: true, profile, unfired: ['L1'], loads: {},
    });
    // §3.3 copy-on-write: an unchanged station keeps its reference (P-7 touchedStations).
    expect(next.stations.S2).toBe(held.stations.S2);
    expect(next.config?.stations.map((s) => s.capacity)).toEqual([6, 4]);
  });

  it('[03a §6.1a] a type off the replay lists returns state itself; the existing stock and day folds still apply', () => {
    const state = buildEngineState([anEngineConfigApplied(), aBusinessDayOpened({ recorded_at: T0 }), aStockSet({ recorded_at: T0 + 1 })]);
    const unknown = { ...aStockSet(), event_type: 'AlertSeen' } as PosEvent;
    expect(applyEvent(state, unknown)).toBe(state);
    expect(state.stock.I1).toEqual({ on_hand: 10, reserved: 0, set_at: T0 + 1, unit: 'piece' });
    expect(state.business_day?.opened_at).toBe(T0);
  });
});
