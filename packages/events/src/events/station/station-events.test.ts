import { describe, expect, it } from 'vitest';
import '../../index';
import { payloadSchema } from '../../registry';

// 03a §4.2 station-stream rows; EngineConfigApplied is the §3.11 list exactly (.strict()).
const STATION_EVENTS = ['FireDispatched', 'ReservationsShifted', 'EngineConfigApplied', 'StationCapacitySet', 'StationPauseSet'];

const station = {
  station_id: 'S1',
  name: 'Karahi',
  station_type: 'slot',
  capacity: 4,
  freshness_window_ms: null,
  completion_mode: 'two_tap',
  policy: 'waada_guard',
  freeze_ms: 120_000,
  min_slack_keep_ms: 60_000,
  promise_padding_ms: null,
  pressure_window_ms: 900_000,
  pressure_amber_bp: 8_000,
  pressure_red_bp: 10_000,
  pressure_alert_ms: 300_000,
  pause_enabled: false,
  lane_units: null,
  reserve_units: 0,
  point_id: 'P1',
  alternates: [{ station_id: 'S2', order_types: ['dine_in', 'takeaway'], home_for_order_types: ['takeaway'] }],
  carry_times: [{ point_id: 'P1', carry_ms: 30_000 }],
  programs: [{ program_id: 'G1', name: 'Naan batch', cook_time_ms: 300_000, is_archived: false }],
  reference_cook_ms: 1_200_000,
  is_archived: false,
};

const settings = {
  weight_dine_in_pct: 100,
  weight_takeaway_pct: 200,
  weight_delivery_pct: 200,
  weight_parking_pct: 200,
  weight_follow_up_pct: 300,
  promise_padding_dine_in_ms: 180_000,
  promise_padding_takeaway_ms: 180_000,
  promise_padding_delivery_ms: 180_000,
  promise_padding_parking_ms: 180_000,
  slip_threshold_ms: 120_000,
  slip_escalate_ms: 120_000,
  cascade_step_ms: 60_000,
  min_gain_ms: 60_000,
  returns_boost: true,
  order_abandon_ms: 14_400_000,
};

const config = { config_version: 7, stations: [station, { ...station, station_id: 'S2', name: 'Tandoor', alternates: [] }], settings };

const examples: Record<string, Record<string, unknown>> = {
  FireDispatched: { station_id: 'S1', order_item_ids: ['L1', 'L2'], load_id: 'S1:L1', due_at: 1_500_000, reason: 'scheduled' },
  ReservationsShifted: { station_id: 'S1', cause: 'overrun', shifts: [{ order_item_id: 'L1', by_ms: 60_000 }] },
  EngineConfigApplied: config,
  StationCapacitySet: { station_id: 'S1', capacity_override: 2, previous: null, reason: 'manager' },
  StationPauseSet: { station_id: 'S1', paused: true },
};

function without(o: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

describe('03a station-stream events', () => {
  it('[03a §4.2] the 5 station events are registered at schema_version 1 and each parses its example', () => {
    for (const type of STATION_EVENTS) {
      expect(payloadSchema(type, 1).parse(examples[type]), type).toEqual(examples[type]);
    }
  });

  it('[03a §4.2] each schema refuses its payload with any one field missing', () => {
    for (const type of STATION_EVENTS) {
      for (const key of Object.keys(examples[type]!)) {
        expect(payloadSchema(type, 1).safeParse(without(examples[type]!, key)).success, `${type}.${key}`).toBe(false);
      }
    }
  });

  it('[03a §4.2] FireDispatched.reason is scheduled, early_fill or pulled; missed is refused; load_id may be null', () => {
    const schema = payloadSchema('FireDispatched', 1);
    for (const reason of ['scheduled', 'early_fill', 'pulled']) {
      expect(schema.safeParse({ ...examples.FireDispatched, reason }).success, reason).toBe(true);
    }
    expect(schema.safeParse({ ...examples.FireDispatched, reason: 'missed' }).success).toBe(false);
    expect(schema.safeParse({ ...examples.FireDispatched, load_id: null }).success).toBe(true);
  });

  it('[03a §4.2] ReservationsShifted.cause is overrun or late_start; a shift needs order_item_id and by_ms', () => {
    const schema = payloadSchema('ReservationsShifted', 1);
    expect(schema.safeParse({ ...examples.ReservationsShifted, cause: 'late_start' }).success).toBe(true);
    expect(schema.safeParse({ ...examples.ReservationsShifted, cause: 'manual' }).success).toBe(false);
    expect(schema.safeParse({ ...examples.ReservationsShifted, shifts: [{ order_item_id: 'L1' }] }).success).toBe(false);
  });

  it('[03a §4.2] StationCapacitySet.capacity_override is 1–100 or null; reason is manager, lane_off or lane_on', () => {
    const schema = payloadSchema('StationCapacitySet', 1);
    for (const capacity_override of [1, 100, null]) {
      expect(schema.safeParse({ ...examples.StationCapacitySet, capacity_override }).success, String(capacity_override)).toBe(true);
    }
    for (const capacity_override of [0, 101, 1.5]) {
      expect(schema.safeParse({ ...examples.StationCapacitySet, capacity_override }).success, String(capacity_override)).toBe(false);
    }
    expect(schema.safeParse({ ...examples.StationCapacitySet, previous: 3 }).success).toBe(true);
    for (const reason of ['lane_off', 'lane_on']) {
      expect(schema.safeParse({ ...examples.StationCapacitySet, reason }).success, reason).toBe(true);
    }
    expect(schema.safeParse({ ...examples.StationCapacitySet, reason: 'tick' }).success).toBe(false);
  });

  it('[03a §4.2] StationPauseSet.paused is a boolean', () => {
    expect(payloadSchema('StationPauseSet', 1).safeParse({ station_id: 'S1', paused: 'yes' }).success).toBe(false);
  });
});

describe('03a EngineConfigApplied (§3.11)', () => {
  const schema = () => payloadSchema('EngineConfigApplied', 1);

  it('[03a §3.11] refuses stations not sorted by station_id (and a duplicate station_id)', () => {
    const [a, b] = config.stations;
    expect(schema().safeParse({ ...config, stations: [b, a] }).success).toBe(false);
    expect(schema().safeParse({ ...config, stations: [a, a] }).success).toBe(false);
    expect(schema().safeParse({ ...config, stations: [] }).success).toBe(true);
  });

  it('[03a §3.11] refuses any key outside the §3.11 list (top level, station, settings, nested rows)', () => {
    expect(schema().safeParse({ ...config, table_lock_ttl_ms: 600_000 }).success).toBe(false);
    expect(schema().safeParse({ ...config, stations: [{ ...station, location_label: null }] }).success).toBe(false);
    expect(schema().safeParse({ ...config, settings: { ...settings, table_lock_ttl_ms: 600_000 } }).success).toBe(false);
    for (const [key, row] of [
      ['alternates', { ...station.alternates[0], carry_ms: 0 }],
      ['carry_times', { ...station.carry_times[0], station_id: 'S1' }],
      ['programs', { ...station.programs[0], station_id: 'S1' }],
    ] as const) {
      expect(schema().safeParse({ ...config, stations: [{ ...station, [key]: [row] }] }).success, key).toBe(false);
    }
  });

  it('[03a §3.11] every station and settings field is required', () => {
    for (const key of Object.keys(station)) {
      expect(schema().safeParse({ ...config, stations: [without(station, key)] }).success, `stations[].${key}`).toBe(false);
    }
    for (const key of Object.keys(settings)) {
      expect(schema().safeParse({ ...config, settings: without(settings, key) }).success, `settings.${key}`).toBe(false);
    }
  });

  it('[03a §3.11] accepts reference_cook_ms 0 (no routed item) and the nullable fields as null', () => {
    expect(schema().safeParse({ ...config, stations: [{ ...station, reference_cook_ms: 0 }] }).success).toBe(true);
    expect(
      schema().safeParse({
        ...config,
        stations: [{ ...station, freshness_window_ms: 600_000, promise_padding_ms: 0, lane_units: 2 }],
      }).success,
    ).toBe(true);
  });

  it('[03a §3.11] enums: station_type, completion_mode, policy, order types; returns_boost is a boolean', () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ['station_type', { station_type: 'grill' }],
      ['completion_mode', { completion_mode: 'three_tap' }],
      ['policy', { policy: 'lifo' }],
      ['order_types', { alternates: [{ ...station.alternates[0], order_types: ['catering'] }] }],
      ['home_for_order_types', { alternates: [{ ...station.alternates[0], home_for_order_types: ['catering'] }] }],
    ];
    for (const [name, o] of bad) {
      expect(schema().safeParse({ ...config, stations: [{ ...station, ...o }] }).success, name).toBe(false);
    }
    for (const station_type of ['slot', 'batch']) {
      expect(schema().safeParse({ ...config, stations: [{ ...station, station_type }] }).success, station_type).toBe(true);
    }
    for (const completion_mode of ['two_tap', 'single_tap', 'auto_done']) {
      expect(schema().safeParse({ ...config, stations: [{ ...station, completion_mode }] }).success, completion_mode).toBe(true);
    }
    for (const policy of ['waada_guard', 'edf', 'fifo']) {
      expect(schema().safeParse({ ...config, stations: [{ ...station, policy }] }).success, policy).toBe(true);
    }
    expect(schema().safeParse({ ...config, settings: { ...settings, returns_boost: 1 } }).success).toBe(false);
  });
});
