import type { MenuLineDeal, MenuLineGroup, MenuLineItem } from '@pos/domain';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  BranchConfigSnapshotSchemaV1,
  BranchConfigSnapshotSchemaV2,
  SNAPSHOT_SCHEMA_VERSION,
  SyncConfigEnvelopeSchema,
  isStockTracked,
  isStockTrackedV1,
  type ConfigDeal,
  type ConfigItem,
  type ConfigModifierGroup,
} from './config';

// The §4.3 example of spec v1.0, with full ids.
function example(): Record<string, unknown> {
  return {
    snapshot_schema_version: 1,
    config_version: 42,
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
    items: [
      {
        item_id: 'I1',
        category_id: 'C1',
        name: 'Chicken Karahi — Half',
        group_label: 'Chicken Karahi',
        description: null,
        sort_order: 1,
        price_minor: 120000,
        tax_class_id: 'X1',
        serve_mode: 'sync',
        prep_buffer_ms: 0,
        cook_time_ms: 1200000,
        stock_time_ms: 300000,
        out_of_stock_behaviour: 'cook_fresh',
        stock_unit: 'g',
        sale_unit: 'piece',
        stock_per_sale_unit: 250,
        low_stock_threshold: 1000,
        carries_over: false,
        availability_windows: [],
        station_id: 'S1',
        program_id: null,
        stock_program_id: null,
      },
    ],
  };
}

type Snap = ReturnType<typeof example> & {
  stations: Array<Record<string, unknown> & { programs: Array<Record<string, unknown>> }>;
  tax_classes: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
};

function snap(): Snap {
  return example() as Snap;
}

function without(o: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

describe('BranchConfigSnapshotSchemaV1', () => {
  it('[01a §4.3] the §4.3 example parses', () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    const r = BranchConfigSnapshotSchemaV1.safeParse(example());
    expect(r.success).toBe(true);
    expect(r.data).toEqual(example());
  });

  it('[01a S28 c] unknown fields are dropped, not rejected', () => {
    const s = snap();
    const withExtra = {
      ...s,
      business_day_start_ms: 21600000,
      future_field: 'x',
      items: [{ ...s.items[0], future_item_field: 1 }],
    };
    const r = BranchConfigSnapshotSchemaV1.safeParse(withExtra);
    expect(r.success).toBe(true);
    expect(r.data).not.toHaveProperty('business_day_start_ms');
    expect(r.data).not.toHaveProperty('future_field');
    expect(r.data?.items[0]).not.toHaveProperty('future_item_field');
  });

  it('[01a S27] price_minor "120000" fails', () => {
    const s = snap();
    s.items[0] = { ...s.items[0], price_minor: '120000' };
    expect(BranchConfigSnapshotSchemaV1.safeParse(s).success).toBe(false);
  });

  it('[01a S34] missing tax_enabled fails; tax_class_id null passes', () => {
    expect(BranchConfigSnapshotSchemaV1.safeParse(without(snap(), 'tax_enabled')).success).toBe(false);
    const s = snap();
    s.items[0] = { ...s.items[0], tax_class_id: null };
    expect(BranchConfigSnapshotSchemaV1.safeParse(s).success).toBe(true);
  });

  it('[01a S22] programs and tax classes require is_archived', () => {
    const s1 = snap();
    s1.stations[1].programs[0] = without(s1.stations[1].programs[0], 'is_archived');
    expect(BranchConfigSnapshotSchemaV1.safeParse(s1).success).toBe(false);
    const s2 = snap();
    s2.tax_classes[0] = without(s2.tax_classes[0], 'is_archived');
    expect(BranchConfigSnapshotSchemaV1.safeParse(s2).success).toBe(false);
  });

  it('[01a S33, S44, S46, S47] missing day_stale_after_hours, stock_unit, carries_over or availability_windows fails', () => {
    expect(BranchConfigSnapshotSchemaV1.safeParse(without(snap(), 'day_stale_after_hours')).success).toBe(false);
    for (const field of ['stock_unit', 'carries_over', 'availability_windows', 'low_stock_threshold']) {
      const s = snap();
      s.items[0] = without(s.items[0], field);
      expect(BranchConfigSnapshotSchemaV1.safeParse(s).success, field).toBe(false);
    }
    const s = snap();
    const categories = s.categories as Array<Record<string, unknown>>;
    categories[0] = without(categories[0], 'availability_windows');
    expect(BranchConfigSnapshotSchemaV1.safeParse(s).success).toBe(false);
  });

  it('[01a §4.3] isStockTrackedV1', () => {
    const config = BranchConfigSnapshotSchemaV1.parse(example());
    const item = config.items[0];
    expect(isStockTrackedV1(config, { ...item, station_id: 'S1', stock_time_ms: 300000 })).toBe(true);
    expect(isStockTrackedV1(config, { ...item, station_id: 'S1', stock_time_ms: null })).toBe(false);
    expect(
      isStockTrackedV1(config, { ...item, station_id: 'S2', stock_time_ms: null, program_id: 'G1', stock_program_id: 'G2' }),
    ).toBe(true);
    expect(
      isStockTrackedV1(config, { ...item, station_id: 'S2', stock_time_ms: 300000, program_id: 'G1', stock_program_id: null }),
    ).toBe(false);
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
    floors: [],
    stations: [],
    tax_classes: [],
    categories: [],
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
  items: Array<Record<string, unknown>>;
  modifier_groups: Array<Record<string, unknown>>;
};

function snapV2(): SnapV2 {
  return exampleV2() as SnapV2;
}

describe('BranchConfigSnapshotSchemaV2', () => {
  it('[01c §4.6] the §4.6 example, filled out to every key, parses', () => {
    const r = BranchConfigSnapshotSchemaV2.safeParse(exampleV2());
    expect(r.success).toBe(true);
    expect(r.data).toEqual(exampleV2());
  });

  it('[01c §4.6] snapshot_schema_version must be 2', () => {
    expect(BranchConfigSnapshotSchemaV2.safeParse({ ...exampleV2(), snapshot_schema_version: 1 }).success).toBe(false);
  });

  it('[01c §4.6 M5] modifier_group_ids of 21 ids parses (no maximum)', () => {
    const s = snapV2();
    s.items[0] = { ...s.items[0], modifier_group_ids: Array.from({ length: 21 }, (_, n) => `M${n + 1}`) };
    const r = BranchConfigSnapshotSchemaV2.safeParse(s);
    expect(r.success).toBe(true);
    expect(r.data?.items[0]?.modifier_group_ids).toHaveLength(21);
  });

  it('[01c §4.6 M1] a missing has_plain_options fails', () => {
    const s = snapV2();
    s.modifier_groups[0] = without(s.modifier_groups[0], 'has_plain_options');
    expect(BranchConfigSnapshotSchemaV2.safeParse(s).success).toBe(false);
  });

  it('[01c §4.6 V2] group_label is dropped (not .strict())', () => {
    const s = snapV2();
    s.items[0] = { ...s.items[0], group_label: 'Chicken Karahi' };
    const r = BranchConfigSnapshotSchemaV2.safeParse({ ...s, future_field: 1 });
    expect(r.success).toBe(true);
    expect(r.data?.items[0]).not.toHaveProperty('group_label');
    expect(r.data).not.toHaveProperty('future_field');
  });

  it('[01c §4.6 V12, V18] requires_weighing, stock_draws and modifier_group_ids are required on items', () => {
    for (const field of ['requires_weighing', 'stock_draws', 'modifier_group_ids', 'variant_group_id', 'variant_name']) {
      const s = snapV2();
      s.items[0] = without(s.items[0], field);
      expect(BranchConfigSnapshotSchemaV2.safeParse(s).success, field).toBe(false);
    }
  });

  it('[01c §4.6 §3.3] stock_draws holds at most one entry', () => {
    const s = snapV2();
    const draw = { stock_item_id: 'K1', quantity_per_sale_unit: 500 };
    s.items[0] = { ...s.items[0], stock_draws: [draw, { ...draw, stock_item_id: 'K2' }] };
    expect(BranchConfigSnapshotSchemaV2.safeParse(s).success).toBe(false);
  });

  it('[01c §4.6 F1] a required group kept with options: [] parses', () => {
    const s = snapV2();
    s.modifier_groups[0] = { ...s.modifier_groups[0], options: [] };
    expect(BranchConfigSnapshotSchemaV2.safeParse(s).success).toBe(true);
  });

  it('[01c §4.2 V12] isStockTracked(item) is stock_draws.length > 0', () => {
    expect(isStockTracked({ stock_draws: [] })).toBe(false);
    expect(isStockTracked({ stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 500 }] })).toBe(true);
  });

  it('[01c §4.2 P-7] schema-2 types are assignable to the @pos/domain menu-line inputs', () => {
    expectTypeOf<ConfigItem>().toExtend<MenuLineItem>();
    expectTypeOf<ConfigModifierGroup>().toExtend<MenuLineGroup>();
    expectTypeOf<ConfigDeal>().toExtend<MenuLineDeal>();
  });
});
