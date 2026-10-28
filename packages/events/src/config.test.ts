import { describe, expect, it } from 'vitest';
import { BranchConfigSnapshotSchemaV1, SNAPSHOT_SCHEMA_VERSION, SyncConfigEnvelopeSchema, isStockTracked } from './config';

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

  it('[01a §4.3] isStockTracked', () => {
    const config = BranchConfigSnapshotSchemaV1.parse(example());
    const item = config.items[0];
    expect(isStockTracked(config, { ...item, station_id: 'S1', stock_time_ms: 300000 })).toBe(true);
    expect(isStockTracked(config, { ...item, station_id: 'S1', stock_time_ms: null })).toBe(false);
    expect(
      isStockTracked(config, { ...item, station_id: 'S2', stock_time_ms: null, program_id: 'G1', stock_program_id: 'G2' }),
    ).toBe(true);
    expect(
      isStockTracked(config, { ...item, station_id: 'S2', stock_time_ms: 300000, program_id: 'G1', stock_program_id: null }),
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
