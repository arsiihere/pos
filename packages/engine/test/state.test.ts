import { readFileSync } from 'node:fs';
import { parseEvent, type EngineConfig, type PosEvent } from '@pos/events';
import { aBusinessDayOpened, aStockSet, anEngineConfigApplied } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import {
  addDiagnostic,
  applyEvent,
  buildEngineState,
  ENGINE_REPLAY_EVENTS,
  ENGINE_STATE_VERSION,
  initialEngineState,
  type BusinessDay,
  type DayDraws,
  type Diagnostic,
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
// AD-6: EngineState.diagnostics is host-side scratch (logged at warn and cleared after commit), not part of
// snapshots / checkpoints, so it stays outside every key set.
const KEY_SETS = {
  3: {
    EngineState: ['stock', 'business_day', 'config', 'stations', 'orders', 'lines', 'slips', 'next_alert_due_at', 'slip_due'],
    StockEntry: ['on_hand', 'reserved', 'set_at', 'unit'],
    BusinessDay: ['business_date', 'opened_at', 'closed_at', 'stock_units', 'draws'],
    DayDraws: ['sale_unit', 'stock_draws'],
    SlipRecord: ['order_ids', 'last_estimate', 'alert_id', 'resolved_at'],
    StationRuntime: ['station_id', 'type', 'capacity', 'capacity_override', 'paused', 'profile', 'unfired', 'loads'],
    Profile: ['t', 'u'],
    Load: ['load_id', 'program_id', 'order_item_ids', 'fire_ms', 'booked'],
    LoadBooked: ['start', 'end', 'units'],
    EngineOrder: [
      'order_id', 'order_type', 'table_key', 'table_id', 'follow_up', 'pickup_at_ms', 'placed_at', 'placed_by',
      'target_land_ms', 'promise_ms', 'boosted', 'line_ids', 'awaiting', 'last_served_at', 'last_line_fold_at',
      'next_group_index', 'groups',
    ],
    EngineLine: [
      'order_item_id', 'order_id', 'group_id', 'serve_mode', 'station_id', 'alternates', 'point_id', 'carry_ms',
      'units', 'prep_ms', 'cook_ms', 'full_cook_ms', 'from_stock', 'program_id', 'stock_cook_ms', 'stock_program_id',
      'draws', 'reserved_seq', 'weight_pct', 'max_early_ms', 'max_late_ms', 'max_carry_ms', 'stage', 'fire_ms',
      'deadline_ms', 'fired_at', 'started_at', 'done_at', 'mark', 'return_of', 'load_id', 'booked',
      'capped', 'routed_station_id', 'expedited', 'rounds',
    ],
    EngineOrderGroup: ['target_land_ms', 'line_ids'],
    EngineLineAlternate: ['station_id', 'carry_ms', 'home'],
    EngineLineDraw: ['stock_item_id', 'quantity', 'reserved'],
    EngineLineReturnOf: ['order_item_id', 'mode'],
    EngineLineBooked: ['start', 'end', 'units'],
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
  EngineState: SameKeys<Omit<EngineState, 'diagnostics'>, Current['EngineState']>;
  StockEntry: SameKeys<StockEntry, Current['StockEntry']>;
  BusinessDay: SameKeys<BusinessDay, Current['BusinessDay']>;
  DayDraws: SameKeys<DayDraws, Current['DayDraws']>;
  SlipRecord: SameKeys<SlipRecord, Current['SlipRecord']>;
  StationRuntime: SameKeys<StationRuntime, Current['StationRuntime']>;
  Profile: SameKeys<Profile, Current['Profile']>;
  Load: SameKeys<Load, Current['Load']>;
  EngineOrder: SameKeys<EngineOrder, Current['EngineOrder']>;
  EngineLine: SameKeys<EngineLine, Current['EngineLine']>;
  EngineOrderGroup: SameKeys<EngineOrder['groups'][string], Current['EngineOrderGroup']>;
  EngineLineAlternate: SameKeys<EngineLine['alternates'][number], Current['EngineLineAlternate']>;
  EngineLineDraw: SameKeys<EngineLine['draws'][number], Current['EngineLineDraw']>;
  EngineLineReturnOf: SameKeys<NonNullable<EngineLine['return_of']>, Current['EngineLineReturnOf']>;
  EngineLineBooked: SameKeys<NonNullable<EngineLine['booked']>, Current['EngineLineBooked']>;
  LoadBooked: SameKeys<Load['booked'], Current['LoadBooked']>;
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
  EngineOrderGroup: true,
  EngineLineAlternate: true,
  EngineLineDraw: true,
  EngineLineReturnOf: true,
  EngineLineBooked: true,
  LoadBooked: true,
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
    const { diagnostics, ...state } = buildEngineState(deepFreeze(log));
    expect(diagnostics).toEqual([]);
    expect(state).toEqual(fixture(`engine-state.v${ENGINE_STATE_VERSION}.json`));

    const keys = KEY_SETS[ENGINE_STATE_VERSION];
    expect(Object.values(keysMatch).every(Boolean)).toBe(true);
    expect(Object.keys(state).sort()).toEqual([...keys.EngineState].sort());
    expect(Object.keys(state.stations)).toEqual(['S1', 'S2']);
    for (const station of Object.values(state.stations)) {
      expect(Object.keys(station).sort()).toEqual([...keys.StationRuntime].sort());
    }
    const { diagnostics: initialDiagnostics, ...initial } = initialEngineState();
    expect(initialDiagnostics).toEqual([]);
    expect(Object.keys(initial).sort()).toEqual([...keys.EngineState].sort());
  });

  it('[03a AD-6] the key-set guard ignores diagnostics and still fails at compile time when a real key is added', () => {
    // A new real key breaks the v3 set (checked by typecheck:tests).
    // @ts-expect-error extra is not in the v3 EngineState key set
    const added: SameKeys<Omit<EngineState, 'diagnostics'> & { extra: number }, Current['EngineState']> = true;
    // diagnostics itself is outside the v3 set: comparing the full EngineState fails.
    // @ts-expect-error diagnostics is not in the v3 EngineState key set
    const full: SameKeys<EngineState, Current['EngineState']> = true;
    expect([added, full]).toEqual([true, true]);
    expect(fixture(`engine-state.v${ENGINE_STATE_VERSION}.json`)).not.toHaveProperty('diagnostics');
  });

  it('[03a AD-6] applyEvent defaults to strict and accepts { strict: false }; both fold the v3 log to the same state', () => {
    const log = (fixture(`engine-log.v${ENGINE_STATE_VERSION}.json`) as unknown[]).map((e) => deepFreeze(parseEvent(e)));
    const strict = buildEngineState(log);
    expect(buildEngineState(log, { strict: true })).toEqual(strict);
    expect(buildEngineState(log, { strict: false })).toEqual(strict);
    let s = initialEngineState();
    for (const e of log) s = applyEvent(s, e, { strict: false });
    expect(s).toEqual(strict);
    // Task 12 (BF-13, A-20): a StockAdded unit mismatch throws only when strict; non-strict leaves the entry as it is
    // and appends one 'stock_breach' diagnostic.
    const mismatch = { ...aStockSet({ recorded_at: T0 + 2 }), event_type: 'StockAdded', payload: { stock_item_id: 'I1', quantity: 1, unit: 'g' } } as PosEvent;
    expect(() => applyEvent(strict, mismatch)).toThrow('StockAdded unit mismatch');
    const loose = applyEvent(strict, mismatch, { strict: false });
    expect(loose.stock).toEqual(strict.stock);
    expect(loose.diagnostics).toMatchObject([{ kind: 'stock_breach', event_id: mismatch.event_id, stock_item_id: 'I1' }]);
  });

  it('[03a AD-6] addDiagnostic appends to a copy and never mutates the input', () => {
    const before = deepFreeze(initialEngineState());
    const d: Diagnostic = { kind: 'profile_underflow', event_id: 'E1', station_id: 'S1', detail: { at: T0, deficit: 2 } };
    const once = addDiagnostic(before, d);
    expect(before.diagnostics).toEqual([]);
    expect(once.diagnostics).toEqual([d]);
    expect(once).not.toBe(before);
    expect(once.stock).toBe(before.stock);
    const d2: Diagnostic = { kind: 'stock_breach', event_id: 'E2', stock_item_id: 'I1', detail: { on_hand: 1, reserved: 3 } };
    const twice = addDiagnostic(deepFreeze(once), d2);
    expect(once.diagnostics).toEqual([d]);
    expect(twice.diagnostics).toEqual([d, d2]);
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
      diagnostics: [],
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
      stock: ['StockSet', 'StockAdded', 'StockReserved', 'StockReleased', 'StockConsumed', 'StockTransferredOut'],
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
