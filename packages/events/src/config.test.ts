import type { MenuLineDeal, MenuLineGroup, MenuLineItem } from '@pos/domain';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { aBranchConfig, aBranchConfigItemStock, anEngineConfigApplied } from '../testing/index';
import {
  BranchConfigSnapshotSchemaV4,
  SNAPSHOT_SCHEMA_VERSION,
  SyncConfigEnvelopeSchema,
  isStockTracked,
  type ConfigDeal,
  type ConfigItem,
  type ConfigModifierGroup,
  HUB_ENGINE_SETTING_DEFAULTS,
} from './config';
import { EngineSettings, EngineStationConfig } from './events/station/EngineConfigApplied.v1';

function without(o: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

// The §4.6 example of 01c spec v1.0.1, filled out to every key.
function exampleV2(): Record<string, unknown> {
  return {
    snapshot_schema_version: 2,
    config_version: 57,
    branch_id: '01JBF2A0000000000000BR0001',
    currency_code: 'PKR',
    tax_enabled: false,
    day_stale_after_hours: 16,
    day_min_gap_hours: 4,
    floors: [
      {
        floor_id: 'F1',
        name: 'Ground',
        sort_order: 1,
        tables: [
          { table_id: 'T1', name: 'T1', seats: 4, sort_order: 1 },
          { table_id: 'T2', name: 'T2', seats: null, sort_order: 2 },
        ],
      },
    ],
    stations: [
      {
        station_id: 'S1',
        name: 'Karahi',
        location_label: null,
        station_type: 'slot',
        capacity: 4,
        freshness_window_ms: null,
        completion_mode: 'two_tap',
        is_archived: false,
        programs: [],
      },
      {
        station_id: 'S2',
        name: 'Fryer',
        location_label: 'Back kitchen',
        station_type: 'batch',
        capacity: 8,
        freshness_window_ms: 0,
        completion_mode: 'two_tap',
        is_archived: false,
        programs: [
          { program_id: 'G1', name: 'Fry 180 °C', cook_time_ms: 360000, is_archived: false },
          { program_id: 'G2', name: 'Reheat', cook_time_ms: 120000, is_archived: false },
        ],
      },
    ],
    tax_classes: [{ tax_class_id: 'X1', name: 'Standard', rate_bp: 1600, is_archived: false }],
    categories: [
      { category_id: 'C1', name: 'Karahi', sort_order: 1, availability_windows: [] },
      {
        category_id: 'C2',
        name: 'Breakfast',
        sort_order: 2,
        availability_windows: [{ start_ms: 25200000, end_ms: 46800000 }],
      },
    ],
    variant_groups: [
      { variant_group_id: 'V1', category_id: 'C1', name: 'Chicken Karahi', description: null, sort_order: 1 },
    ],
    stock_items: [
      {
        stock_item_id: 'K1',
        name: 'Karahi pot',
        stock_unit: 'g',
        carries_over: false,
        station_id: 'S1',
        low_stock_threshold: 1000,
      },
    ],
    modifier_groups: [
      {
        modifier_group_id: 'M1',
        name: 'Spice level',
        min_choices: 1,
        max_choices: 1,
        sort_order: 1,
        has_plain_options: true,
        options: [
          { option_id: 'O1', name: 'Mild', price_minor: 0, max_quantity: 1, is_default: false, linked_item_id: null, sort_order: 1 },
          { option_id: 'O2', name: 'Normal', price_minor: 0, max_quantity: 1, is_default: true, linked_item_id: null, sort_order: 2 },
        ],
      },
      {
        modifier_group_id: 'M2',
        name: 'Bread',
        min_choices: 0,
        max_choices: 6,
        sort_order: 2,
        has_plain_options: false,
        options: [
          { option_id: 'O5', name: 'Naan', price_minor: 3000, max_quantity: 6, is_default: false, linked_item_id: 'I9', sort_order: 1 },
        ],
      },
    ],
    items: [
      {
        item_id: 'I1',
        category_id: 'C1',
        variant_group_id: 'V1',
        variant_name: 'Half',
        name: 'Chicken Karahi — Half',
        description: null,
        sort_order: 1,
        price_minor: 115000,
        tax_class_id: 'X1',
        serve_mode: 'sync',
        prep_buffer_ms: 0,
        cook_time_ms: 1200000,
        stock_time_ms: 300000,
        out_of_stock_behaviour: 'cook_fresh',
        sale_unit: 'piece',
        requires_weighing: false,
        stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 500 }],
        availability_windows: [],
        station_id: 'S1',
        program_id: null,
        stock_program_id: null,
        modifier_group_ids: ['M1', 'M2'],
      },
    ],
    deals: [
      {
        deal_id: 'D1',
        category_id: 'C3',
        name: 'Family karahi deal',
        description: null,
        sort_order: 1,
        price_minor: 320000,
        tax_class_id: 'X1',
        availability_windows: [],
        parts: [
          { deal_part_id: 'P1', quantity: 1, sort_order: 1, choices: [{ item_id: 'I2', extra_price_minor: 0, sort_order: 1 }] },
          {
            deal_part_id: 'P2',
            quantity: 4,
            sort_order: 2,
            choices: [
              { item_id: 'I9', extra_price_minor: 0, sort_order: 1 },
              { item_id: 'I10', extra_price_minor: 3000, sort_order: 2 },
            ],
          },
        ],
      },
    ],
  };
}

type SnapV2 = Record<string, unknown> & {
  stations: Array<Record<string, unknown> & { programs: Array<Record<string, unknown>> }>;
  tax_classes: Array<Record<string, unknown>>;
  categories: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
  modifier_groups: Array<Record<string, unknown>>;
};

function snapV2(): SnapV2 {
  return exampleV2() as SnapV2;
}

function snapV4(): SnapV2 {
  return exampleV4() as unknown as SnapV2;
}

describe('BranchConfigSnapshotSchemaV4: the 01a rules kept from schema 1', () => {
  it('[01a §4.3] SNAPSHOT_SCHEMA_VERSION is 4 (02a A-1, 02b A-1)', () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(4);
  });

  it('[01a S28 c] unknown fields are dropped, not rejected', () => {
    const s = snapV4();
    const withExtra = {
      ...s,
      business_day_start_ms: 21600000,
      future_field: 'x',
      items: [{ ...s.items[0], future_item_field: 1 }],
    };
    const r = BranchConfigSnapshotSchemaV4.safeParse(withExtra);
    expect(r.success).toBe(true);
    expect(r.data).not.toHaveProperty('business_day_start_ms');
    expect(r.data).not.toHaveProperty('future_field');
    expect(r.data?.items[0]).not.toHaveProperty('future_item_field');
  });

  it('[01a S27] price_minor "120000" fails', () => {
    const s = snapV4();
    s.items[0] = { ...s.items[0], price_minor: '120000' };
    expect(BranchConfigSnapshotSchemaV4.safeParse(s).success).toBe(false);
  });

  it('[01a S34] missing tax_enabled fails; tax_class_id null passes', () => {
    expect(BranchConfigSnapshotSchemaV4.safeParse(without(snapV4(), 'tax_enabled')).success).toBe(false);
    const s = snapV4();
    s.items[0] = { ...s.items[0], tax_class_id: null };
    expect(BranchConfigSnapshotSchemaV4.safeParse(s).success).toBe(true);
  });

  it('[01a S22] programs and tax classes require is_archived', () => {
    const s1 = snapV4();
    s1.stations[1]!.programs[0] = without(s1.stations[1]!.programs[0]!, 'is_archived');
    expect(BranchConfigSnapshotSchemaV4.safeParse(s1).success).toBe(false);
    const s2 = snapV4();
    s2.tax_classes[0] = without(s2.tax_classes[0]!, 'is_archived');
    expect(BranchConfigSnapshotSchemaV4.safeParse(s2).success).toBe(false);
  });

  it('[01a S33, S47] missing day_stale_after_hours or availability_windows fails', () => {
    expect(BranchConfigSnapshotSchemaV4.safeParse(without(snapV4(), 'day_stale_after_hours')).success).toBe(false);
    const s = snapV4();
    s.items[0] = without(s.items[0]!, 'availability_windows');
    expect(BranchConfigSnapshotSchemaV4.safeParse(s).success).toBe(false);
    const c = snapV4();
    c.categories[0] = without(c.categories[0]!, 'availability_windows');
    expect(BranchConfigSnapshotSchemaV4.safeParse(c).success).toBe(false);
  });

  it('[01a §6.1] SyncConfigEnvelopeSchema keeps the snapshot as a record and allows nulls', () => {
    expect(SyncConfigEnvelopeSchema.safeParse({ data: { config: null, directory: null } }).success).toBe(true);
    const r = SyncConfigEnvelopeSchema.safeParse({
      data: { config: { snapshot_hash: 'a'.repeat(64), snapshot: { anything: 1 } }, directory: null },
    });
    expect(r.success).toBe(true);
    expect(r.data?.data.config?.snapshot).toEqual({ anything: 1 });
  });
});

describe('BranchConfigSnapshotSchemaV4: the 01c rules kept from schema 2', () => {
  it('[01c §4.6] the §4.6 example, filled out to every key, parses', () => {
    const r = BranchConfigSnapshotSchemaV4.safeParse(exampleV4());
    expect(r.success).toBe(true);
    expect(r.data).toEqual(exampleV4());
  });

  it('[01c §4.6] snapshot_schema_version must be 4', () => {
    expect(BranchConfigSnapshotSchemaV4.safeParse({ ...exampleV4(), snapshot_schema_version: 1 }).success).toBe(false);
    expect(BranchConfigSnapshotSchemaV4.safeParse({ ...exampleV4(), snapshot_schema_version: 3 }).success).toBe(false);
  });

  it('[01c §4.6 M5] modifier_group_ids of 21 ids parses (no maximum)', () => {
    const s = snapV4();
    s.items[0] = { ...s.items[0], modifier_group_ids: Array.from({ length: 21 }, (_, n) => `M${n + 1}`) };
    const r = BranchConfigSnapshotSchemaV4.safeParse(s);
    expect(r.success).toBe(true);
    expect(r.data?.items[0]?.modifier_group_ids).toHaveLength(21);
  });

  it('[01c §4.6 M1] a missing has_plain_options fails', () => {
    const s = snapV4();
    s.modifier_groups[0] = without(s.modifier_groups[0], 'has_plain_options');
    expect(BranchConfigSnapshotSchemaV4.safeParse(s).success).toBe(false);
  });

  it('[01c §4.6 V2] group_label is dropped (not .strict())', () => {
    const s = snapV4();
    s.items[0] = { ...s.items[0], group_label: 'Chicken Karahi' };
    const r = BranchConfigSnapshotSchemaV4.safeParse({ ...s, future_field: 1 });
    expect(r.success).toBe(true);
    expect(r.data?.items[0]).not.toHaveProperty('group_label');
    expect(r.data).not.toHaveProperty('future_field');
  });

  it('[01c §4.6 V12, V18] requires_weighing, stock_draws and modifier_group_ids are required on items', () => {
    for (const field of ['requires_weighing', 'stock_draws', 'modifier_group_ids', 'variant_group_id', 'variant_name']) {
      const s = snapV4();
      s.items[0] = without(s.items[0], field);
      expect(BranchConfigSnapshotSchemaV4.safeParse(s).success, field).toBe(false);
    }
  });

  it('[01c §4.6 §3.3] stock_draws holds at most one entry', () => {
    const s = snapV4();
    const draw = { stock_item_id: 'K1', quantity_per_sale_unit: 500 };
    s.items[0] = { ...s.items[0], stock_draws: [draw, { ...draw, stock_item_id: 'K2' }] };
    expect(BranchConfigSnapshotSchemaV4.safeParse(s).success).toBe(false);
  });

  it('[01c §4.6 F1] a required group kept with options: [] parses', () => {
    const s = snapV4();
    s.modifier_groups[0] = { ...s.modifier_groups[0], options: [] };
    expect(BranchConfigSnapshotSchemaV4.safeParse(s).success).toBe(true);
  });

  it('[01c §4.2 V12] isStockTracked(item) is stock_draws.length > 0', () => {
    expect(isStockTracked({ stock_draws: [] })).toBe(false);
    expect(isStockTracked({ stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 500 }] })).toBe(true);
  });

  it('[01c §4.2 P-7] schema-3 types are assignable to the @pos/domain menu-line inputs', () => {
    expectTypeOf<ConfigItem>().toExtend<MenuLineItem>();
    expectTypeOf<ConfigModifierGroup>().toExtend<MenuLineGroup>();
    expectTypeOf<ConfigDeal>().toExtend<MenuLineDeal>();
  });
});

type Row = Record<string, unknown>;

// 01a v2.3 §5.2a (02b A-1) defaults, delivered in engine_settings (AD-10).
const V4_SETTINGS = {
  queue_auto_send_max_ms: 14_400_000,
  zone_undo_ms: 300_000,
  slow_item_threshold_ms: 900_000,
  served_estimate_ms: null as number | null,
  comp_reason_chips: ['Late', 'Wrong item', 'Quality', 'Guest', 'Other'],
};

// The §4.6 example of schema 2 plus every field of the 01a §4.3 "snapshot schema 3" marker; both the null and the
// non-null form of each nullable field appear.
function exampleV4() {
  const v2 = snapV2();
  const engineStation = {
    point_id: 'P1',
    policy: 'waada_guard',
    freeze_ms: 120_000,
    min_slack_keep_ms: 60_000,
    pressure_window_ms: 900_000,
    pressure_amber_bp: 8_000,
    pressure_red_bp: 10_000,
    pressure_alert_ms: 300_000,
    pause_enabled: false,
    reserve_units: 0,
  };
  const knobs = { weight_pct: 100, max_early_ms: 60_000, adjust_time_ms: 180_000 };
  return {
    ...v2,
    snapshot_schema_version: 4,
    // 01a §4.3 V4 (02a A-1, 02b A-1): zones per floor, an active one with lists and an archived one with none (AD-11).
    floors: [
      {
        floor_id: 'F1',
        name: 'Ground',
        sort_order: 1,
        zones: [
          {
            zone_id: 'Z1',
            name: 'Patio',
            sort_order: 1,
            is_archived: false,
            routes: [{ item_id: 'I1', station_id: 'S1' }],
            stock_items: [{ item_id: 'I2', threshold: 3 }],
          },
          { zone_id: 'Z2', name: 'Old hall', sort_order: 2, is_archived: true, routes: [] as Row[], stock_items: [] as Row[] },
        ],
        tables: [
          { table_id: 'T1', name: 'T1', seats: 4, sort_order: 1, zone_id: 'Z1' as string | null },
          { table_id: 'T2', name: 'T2', seats: null, sort_order: 2, zone_id: null as string | null },
        ],
      },
    ],
    points: [
      { point_id: 'P1', name: 'Pass', sort_order: 1, is_archived: false },
      { point_id: 'P2', name: 'Upstairs', sort_order: 2, is_archived: false },
    ],
    stations: [
      {
        ...v2.stations[0]!,
        ...engineStation,
        promise_padding_ms: null,
        lane_units: null,
        alternates: [{ station_id: 'S3', order_types: ['dine_in', 'takeaway'], home_for_order_types: ['takeaway'] }],
        carry_times: [{ point_id: 'P2', carry_ms: 45_000 }],
      },
      {
        ...v2.stations[1]!,
        ...engineStation,
        policy: 'edf',
        promise_padding_ms: 240_000,
        lane_units: 2,
        reserve_units: 1,
        alternates: [] as Row[],
        carry_times: [] as Row[],
      },
    ],
    items: [
      { ...v2.items[0]!, ...knobs, max_carry_ms: null, max_late_ms: null, is_ready_item: false },
      { ...v2.items[0]!, item_id: 'I2', ...knobs, weight_pct: 150, max_carry_ms: 90_000, max_late_ms: 600_000, is_ready_item: true },
    ],
    engine_settings: {
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
      table_lock_ttl_ms: 600_000,
      ...V4_SETTINGS,
    },
    goes_with: [
      { source_kind: 'category', source_id: 'C1', target_kind: 'category', target_id: 'C2', excluded: false },
      { source_kind: 'item', source_id: 'I1', target_kind: 'item', target_id: 'I2', excluded: true },
    ],
  };
}

function refused(snapshot: unknown): boolean {
  return !BranchConfigSnapshotSchemaV4.safeParse(snapshot).success;
}

const NEW_STATION_KEYS = [
  'point_id',
  'policy',
  'freeze_ms',
  'min_slack_keep_ms',
  'promise_padding_ms',
  'pressure_window_ms',
  'pressure_amber_bp',
  'pressure_red_bp',
  'pressure_alert_ms',
  'pause_enabled',
  'lane_units',
  'reserve_units',
  'alternates',
  'carry_times',
];
const NEW_ITEM_KEYS = ['weight_pct', 'max_early_ms', 'max_carry_ms', 'max_late_ms', 'adjust_time_ms'];

describe('BranchConfigSnapshotSchemaV4', () => {
  it('[01a §4.3 V3] a full example parses and round-trips', () => {
    const r = BranchConfigSnapshotSchemaV4.safeParse(exampleV4());
    expect(r.error).toBeUndefined();
    expect(r.data).toEqual(exampleV4());
  });

  it('[01a §4.3 V4] snapshot_schema_version 2 or 3 is refused; a V2 example is refused; schema 4 is the only schema', () => {
    expect(refused({ ...exampleV4(), snapshot_schema_version: 2 })).toBe(true);
    expect(refused({ ...exampleV4(), snapshot_schema_version: 3 })).toBe(true);
    expect(refused(exampleV2())).toBe(true);
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(4);
  });

  it.each(['points', 'engine_settings', 'goes_with'])('[01a §4.3 V3] missing top-level %s is refused', (key) => {
    expect(refused(without(exampleV4(), key))).toBe(true);
  });

  it.each(['point_id', 'name', 'sort_order', 'is_archived'])('[01a §4.3 V3] a point without %s is refused', (key) => {
    const s = exampleV4();
    s.points[0] = without(s.points[0]!, key) as (typeof s.points)[number];
    expect(refused(s)).toBe(true);
  });

  it.each(NEW_STATION_KEYS)('[01a §4.3 V3] a station without %s is refused', (key) => {
    const s = exampleV4();
    expect(refused({ ...s, stations: [without(s.stations[0]!, key), s.stations[1]] })).toBe(true);
  });

  it.each(['station_id', 'order_types', 'home_for_order_types'])('[01a §4.3 V3] an alternate without %s is refused', (key) => {
    const s = exampleV4();
    const alternates = [without(s.stations[0]!.alternates[0]!, key)];
    expect(refused({ ...s, stations: [{ ...s.stations[0], alternates }, s.stations[1]] })).toBe(true);
  });

  it.each(['point_id', 'carry_ms'])('[01a §4.3 V3] a carry time without %s is refused', (key) => {
    const s = exampleV4();
    const carry_times = [without(s.stations[0]!.carry_times[0]!, key)];
    expect(refused({ ...s, stations: [{ ...s.stations[0], carry_times }, s.stations[1]] })).toBe(true);
  });

  it.each(NEW_ITEM_KEYS)('[01a §4.3 V3] an item without %s is refused', (key) => {
    const s = exampleV4();
    expect(refused({ ...s, items: [without(s.items[0]!, key), s.items[1]] })).toBe(true);
  });

  it.each(Object.keys(exampleV4().engine_settings))('[01a §4.3 V3] engine_settings without %s is refused', (key) => {
    const s = exampleV4();
    expect(refused({ ...s, engine_settings: without(s.engine_settings, key) })).toBe(true);
  });

  it.each(['source_kind', 'source_id', 'target_kind', 'target_id', 'excluded'])('[01a §4.3 V3] a goes_with row without %s is refused', (key) => {
    const s = exampleV4();
    expect(refused({ ...s, goes_with: [without(s.goes_with[0]!, key)] })).toBe(true);
  });

  it('[01a §4.3 V3] bad enum values are refused: policy, order types, goes_with kinds', () => {
    const s = exampleV4();
    const station = s.stations[0]!;
    const link = s.goes_with[0]!;
    expect(refused({ ...s, stations: [{ ...station, policy: 'lifo' }] })).toBe(true);
    const alternates = [{ station_id: 'S3', order_types: ['catering'], home_for_order_types: [] }];
    expect(refused({ ...s, stations: [{ ...station, alternates }] })).toBe(true);
    expect(refused({ ...s, goes_with: [{ ...link, source_kind: 'deal' }] })).toBe(true);
    expect(refused({ ...s, goes_with: [{ ...link, target_kind: 'deal' }] })).toBe(true);
  });

  it('[01a §4.3 V3] only the §4.3 nullable fields take null; integers stay integers', () => {
    const s = exampleV4();
    expect(refused({ ...s, stations: [{ ...s.stations[0], freeze_ms: null }] })).toBe(true);
    expect(refused({ ...s, stations: [{ ...s.stations[0], freeze_ms: 1.5 }] })).toBe(true);
    expect(refused({ ...s, items: [{ ...s.items[0], weight_pct: null }] })).toBe(true);
    expect(refused({ ...s, engine_settings: { ...s.engine_settings, table_lock_ttl_ms: null } })).toBe(true);
  });

  it('[01a §4.3 V3] a station carries what anEngineConfigApplied carries, except reference_cook_ms', () => {
    const payload = anEngineConfigApplied().payload as { stations: Row[]; settings: Row };
    const engineStation = payload.stations[0]!;
    const s = exampleV4();
    const parsed = BranchConfigSnapshotSchemaV4.parse({
      ...s,
      stations: [{ location_label: null, ...engineStation }],
    });
    const station: Row = parsed.stations[0]!;
    for (const key of Object.keys(without(engineStation, 'reference_cook_ms'))) {
      expect(station, key).toHaveProperty(key);
      expect(station[key], key).toEqual(engineStation[key]);
    }
    expect(station).not.toHaveProperty('reference_cook_ms');
  });

  it('[01a §4.3 V3, AD-10] engine_settings holds every engine setting plus exactly table_lock_ttl_ms and the five 02b A-1 settings', () => {
    const { settings } = anEngineConfigApplied().payload as { settings: Row };
    const s = exampleV4();
    const parsed = BranchConfigSnapshotSchemaV4.parse({
      ...s,
      engine_settings: { ...settings, table_lock_ttl_ms: 600_000, ...V4_SETTINGS },
    });
    const keys = Object.keys(parsed.engine_settings);
    expect(keys).toEqual(expect.arrayContaining(Object.keys(settings)));
    expect(keys.filter((k) => !(k in settings)).sort()).toEqual(['table_lock_ttl_ms', ...Object.keys(V4_SETTINGS)].sort());
    let engineOnly: Row = without(parsed.engine_settings, 'table_lock_ttl_ms');
    for (const key of Object.keys(V4_SETTINGS)) engineOnly = without(engineOnly, key);
    expect(engineOnly).toEqual(settings);
    expect(Object.keys(settings).sort()).toEqual(Object.keys(EngineSettings.shape).sort());
    // On the schema itself: an optional extra key would not show in a parse of the fixture.
    const declared = Object.keys(BranchConfigSnapshotSchemaV4.shape.engine_settings.shape);
    // 03b A-1 (01a v2.4): + the two optional keys ready_window_ms, kds_offline_ms.
    expect(declared.sort()).toEqual(
      [...Object.keys(EngineSettings.shape), 'table_lock_ttl_ms', ...Object.keys(V4_SETTINGS), 'ready_window_ms', 'kds_offline_ms'].sort(),
    );
  });

  it('[01a §4.3 V3] a parsed station, less location_label plus reference_cook_ms, is a valid strict EngineStationConfig', () => {
    const declared = Object.keys(BranchConfigSnapshotSchemaV4.shape.stations.element.shape);
    const engineKeys = Object.keys(without(EngineStationConfig.shape, 'reference_cook_ms'));
    expect(declared.sort()).toEqual([...engineKeys, 'location_label'].sort());
    const parsed = BranchConfigSnapshotSchemaV4.parse(exampleV4());
    for (const station of parsed.stations) {
      const r = EngineStationConfig.safeParse({ ...without(station, 'location_label'), reference_cook_ms: 0 });
      expect(r.error).toBeUndefined();
    }
  });

  it('[01a §4.3 V3, S28 c] unknown keys are dropped at each new level, not refused', () => {
    const s = exampleV4();
    const station = s.stations[0]!;
    const r = BranchConfigSnapshotSchemaV4.safeParse({
      ...s,
      future_field: 1,
      points: [{ ...s.points[0], future_field: 1 }],
      stations: [
        {
          ...station,
          future_field: 1,
          reference_cook_ms: 1,
          alternates: [{ ...station.alternates[0], future_field: 1 }],
          carry_times: [{ ...station.carry_times[0], future_field: 1 }],
        },
      ],
      items: [{ ...s.items[0], future_field: 1 }],
      engine_settings: { ...s.engine_settings, future_field: 1 },
      goes_with: [{ ...s.goes_with[0], future_field: 1 }],
    });
    expect(r.error).toBeUndefined();
    const expected = exampleV4();
    expect(r.data).toEqual({ ...expected, stations: [expected.stations[0]], items: [expected.items[0]], goes_with: [expected.goes_with[0]], points: [expected.points[0]] });
  });
});

describe('BranchConfigSnapshotSchemaV4: the V4 fields (01a v2.2 A-1, v2.3 A-1)', () => {
  it('[01a #192] snapshot V4 carries zones[].routes[], zones[].stock_items[], items[].is_ready_item', () => {
    const parsed = BranchConfigSnapshotSchemaV4.parse(exampleV4());
    const zone = parsed.floors[0]!.zones[0]!;
    expect(zone.routes).toEqual([{ item_id: 'I1', station_id: 'S1' }]);
    expect(zone.stock_items).toEqual([{ item_id: 'I2', threshold: 3 }]);
    expect(parsed.items.map((item) => item.is_ready_item)).toEqual([false, true]);
    expect(parsed.floors[0]!.tables.map((table) => table.zone_id)).toEqual(['Z1', null]);
  });

  it.each(['zones', 'tables'])('[01a §4.3 V4] a floor without %s is refused', (key) => {
    const s = exampleV4();
    expect(refused({ ...s, floors: [without(s.floors[0]!, key)] })).toBe(true);
  });

  it.each(['zone_id', 'name', 'sort_order', 'is_archived', 'routes', 'stock_items'])('[01a §4.3 V4] a zone without %s is refused', (key) => {
    const s = exampleV4();
    expect(refused({ ...s, floors: [{ ...s.floors[0]!, zones: [without(s.floors[0]!.zones[0]!, key)] }] })).toBe(true);
  });

  it.each([
    ['routes', 'item_id'],
    ['routes', 'station_id'],
    ['stock_items', 'item_id'],
    ['stock_items', 'threshold'],
  ] as const)('[01a §4.3 V4] a zone %s entry without %s is refused', (list, key) => {
    const s = exampleV4();
    const zone = s.floors[0]!.zones[0]!;
    const zones = [{ ...zone, [list]: [without(zone[list][0]!, key)] }];
    expect(refused({ ...s, floors: [{ ...s.floors[0]!, zones }] })).toBe(true);
  });

  it('[01a §4.3 V4] a table without zone_id, or an item without is_ready_item, is refused; zone_id null passes', () => {
    const s = exampleV4();
    const floor = s.floors[0]!;
    expect(refused({ ...s, floors: [{ ...floor, tables: [without(floor.tables[0]!, 'zone_id')] }] })).toBe(true);
    expect(refused({ ...s, items: [without(s.items[0]!, 'is_ready_item')] })).toBe(true);
    expect(refused({ ...s, floors: [{ ...floor, tables: [{ ...floor.tables[0]!, zone_id: null }] }] })).toBe(false);
  });

  it.each(Object.keys(V4_SETTINGS))('[01a §4.3 V4, AD-10] engine_settings without %s is refused', (key) => {
    const s = exampleV4();
    expect(refused({ ...s, engine_settings: without(s.engine_settings, key) })).toBe(true);
  });

  it('[01a §5.2a, AD-10] served_estimate_ms takes null or an integer; the other four do not take null; comp_reason_chips is a string list', () => {
    const s = exampleV4();
    const settings = (o: Row) => ({ ...s, engine_settings: { ...s.engine_settings, ...o } });
    expect(refused(settings({ served_estimate_ms: 600_000 }))).toBe(false);
    for (const key of ['queue_auto_send_max_ms', 'zone_undo_ms', 'slow_item_threshold_ms', 'comp_reason_chips']) {
      expect(refused(settings({ [key]: null })), key).toBe(true);
    }
    expect(refused(settings({ comp_reason_chips: [1] }))).toBe(true);
  });

  it('[01a §4.3 V4, S28 c] unknown keys on zones and their entries are dropped, not refused', () => {
    const s = exampleV4();
    const zone = s.floors[0]!.zones[0]!;
    const r = BranchConfigSnapshotSchemaV4.safeParse({
      ...s,
      floors: [
        {
          ...s.floors[0]!,
          zones: [
            {
              ...zone,
              future_field: 1,
              routes: [{ ...zone.routes[0]!, future_field: 1 }],
              stock_items: [{ ...zone.stock_items[0]!, future_field: 1 }],
            },
            s.floors[0]!.zones[1]!,
          ],
        },
      ],
    });
    expect(r.error).toBeUndefined();
    expect(r.data).toEqual(exampleV4());
  });

  it('[02p U5] every snapshot fixture is V4', () => {
    for (const config of [aBranchConfig(), aBranchConfigItemStock()]) {
      expect(config.snapshot_schema_version).toBe(4);
      expect(BranchConfigSnapshotSchemaV4.parse(config)).toEqual(config);
    }
    expect(exampleV4().snapshot_schema_version).toBe(4);
  });

  it('[02p AD-13] the deprecated BranchConfigSnapshotSchemaV3 alias is removed', async () => {
    const mod: Record<string, unknown> = await import('./config.js');
    expect('BranchConfigSnapshotSchemaV3' in mod).toBe(false);
  });
});

describe('[03b §4.5 A-1] ready_window_ms, kds_offline_ms: optional V4 engine_settings keys with hub defaults', () => {
  it('[03b §4.5 A-1] a V4 snapshot without the two keys parses; the hub default is read with ??', () => {
    const s = exampleV4();
    expect(s.engine_settings).not.toHaveProperty('ready_window_ms');
    const parsed = BranchConfigSnapshotSchemaV4.parse(s);
    expect(parsed.engine_settings.ready_window_ms).toBeUndefined();
    expect(parsed.engine_settings.kds_offline_ms).toBeUndefined();
    expect(parsed.engine_settings.ready_window_ms ?? HUB_ENGINE_SETTING_DEFAULTS.ready_window_ms).toBe(60_000);
    expect(parsed.engine_settings.kds_offline_ms ?? HUB_ENGINE_SETTING_DEFAULTS.kds_offline_ms).toBe(30_000);
  });

  it('[03b §4.5 A-1] the delivered values are kept; a non-integer or null is refused', () => {
    const s = exampleV4();
    const settings = (o: Row) => ({ ...s, engine_settings: { ...s.engine_settings, ...o } });
    const parsed = BranchConfigSnapshotSchemaV4.parse(settings({ ready_window_ms: 90_000, kds_offline_ms: 45_000 }));
    expect(parsed.engine_settings).toMatchObject({ ready_window_ms: 90_000, kds_offline_ms: 45_000 });
    for (const key of ['ready_window_ms', 'kds_offline_ms']) {
      expect(refused(settings({ [key]: null })), key).toBe(true);
      expect(refused(settings({ [key]: 1.5 })), key).toBe(true);
    }
  });

  it('[03b §4.5 A-1] HUB_ENGINE_SETTING_DEFAULTS holds the spec values exactly', () => {
    expect(HUB_ENGINE_SETTING_DEFAULTS).toStrictEqual({ ready_window_ms: 60_000, kds_offline_ms: 30_000 });
    expect(Object.isFrozen(HUB_ENGINE_SETTING_DEFAULTS)).toBe(true);
  });
});
