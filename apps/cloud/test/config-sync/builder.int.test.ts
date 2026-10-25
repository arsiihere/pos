import { canonicalJson, sha256hex } from '@pos/domain/hash';
import { BranchConfigSnapshotSchemaV1 } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildSnapshot, type SnapshotHeader } from '../../src/modules/config-sync/builder';
import { pgCounter } from '../helpers/pg-counter';
import { restaurantFixture, seedMenu, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const HEADER: SnapshotHeader = {
  config_version: 42,
  currency_code: 'PKR',
  tax_enabled: false,
  day_stale_after_hours: 16,
  day_min_gap_hours: 4,
};

describe('buildSnapshot', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;

  beforeAll(async () => {
    cloud = await createTestCloud();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
  });

  const tenant = () => Object.freeze({ tenantId: f.tenantId, branchIds: Object.freeze([...f.branches]) });
  const build = async (branchId: string, header: SnapshotHeader = HEADER) => {
    const client = await cloud.pool.connect();
    try {
      return await buildSnapshot(client, tenant(), branchId, header);
    } finally {
      client.release();
    }
  };

  it('[01a §10 #4] only active rows and this branch’s routes, except archived stations, programs and tax classes', async () => {
    await seedMenu(cloud.pool, f, { archived: true });
    const snapshot = await build(f.branches[0]);
    expect(snapshot).toEqual({
      snapshot_schema_version: 1,
      config_version: 42,
      branch_id: f.branches[0],
      currency_code: 'PKR',
      tax_enabled: false,
      day_stale_after_hours: 16,
      day_min_gap_hours: 4,
      floors: [
        {
          floor_id: 'FL-1',
          name: 'Ground',
          sort_order: 1,
          tables: [
            { table_id: 'TB-1', name: 'T1', seats: 4, sort_order: 1 },
            { table_id: 'TB-2', name: 'T2', seats: null, sort_order: 2 },
          ],
        },
      ],
      stations: [
        {
          station_id: 'ST-2',
          name: 'Fryer',
          location_label: 'Back kitchen',
          station_type: 'batch',
          capacity: 8,
          freshness_window_ms: 0,
          completion_mode: 'two_tap',
          is_archived: false,
          programs: [
            { program_id: 'PG-1', name: 'Fry 180 °C', cook_time_ms: 360000, is_archived: false },
            { program_id: 'PG-X', name: 'Old program', cook_time_ms: 60000, is_archived: true },
            { program_id: 'PG-2', name: 'Reheat', cook_time_ms: 120000, is_archived: false },
          ],
        },
        {
          station_id: 'ST-1',
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
          station_id: 'ST-X',
          name: 'Old tandoor',
          location_label: null,
          station_type: 'slot',
          capacity: 2,
          freshness_window_ms: null,
          completion_mode: 'two_tap',
          is_archived: true,
          programs: [],
        },
      ],
      tax_classes: [
        { tax_class_id: 'TX-X', name: 'Old tax', rate_bp: 500, is_archived: true },
        { tax_class_id: 'TX-1', name: 'Standard', rate_bp: 1600, is_archived: false },
      ],
      categories: [
        { category_id: 'CT-1', name: 'Karahi', sort_order: 1, availability_windows: [] },
        {
          category_id: 'CT-2',
          name: 'Breakfast',
          sort_order: 2,
          availability_windows: [{ start_ms: 25200000, end_ms: 46800000 }],
        },
      ],
      items: [
        {
          item_id: 'IT-0000',
          category_id: 'CT-1',
          name: 'Chicken Karahi — Half',
          group_label: 'Chicken Karahi',
          description: null,
          sort_order: 0,
          price_minor: 120000,
          tax_class_id: 'TX-1',
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
          availability_windows: [
            { start_ms: 3600000, end_ms: 5400000 },
            { start_ms: 3600000, end_ms: 7200000 },
          ],
          station_id: 'ST-1',
          program_id: null,
          stock_program_id: null,
        },
        {
          item_id: 'IT-0001',
          category_id: 'CT-1',
          name: 'Item 1',
          group_label: null,
          description: null,
          sort_order: 1,
          price_minor: 50001,
          tax_class_id: null,
          serve_mode: 'sync',
          prep_buffer_ms: 0,
          cook_time_ms: 1200000,
          stock_time_ms: null,
          out_of_stock_behaviour: 'cook_fresh',
          stock_unit: 'piece',
          sale_unit: 'piece',
          stock_per_sale_unit: 1,
          low_stock_threshold: null,
          carries_over: true,
          availability_windows: [],
          station_id: 'ST-2',
          program_id: 'PG-1',
          stock_program_id: 'PG-2',
        },
      ],
    });

    // branch B sees only its own item and station; no floors
    const other = await build(f.branches[1]);
    expect((other.items as Array<{ item_id: string }>).map((item) => item.item_id)).toEqual(['IT-B']);
    expect((other.stations as Array<{ station_id: string }>).map((station) => station.station_id)).toEqual(['ST-B']);
    expect(other.floors).toEqual([]);
  });

  it('[01a §10 #5] snapshot query count is fixed (≤ 13) for 10 and 300 items', async () => {
    const counter = pgCounter(cloud.pool);
    const countFor = async (items: number) => {
      f = await restaurantFixture(cloud);
      await seedMenu(cloud.pool, f, { items, archived: true });
      const client = await cloud.pool.connect();
      try {
        counter.reset();
        const snapshot = await buildSnapshot(client, tenant(), f.branches[0], HEADER);
        expect(snapshot.items).toHaveLength(items);
        return counter.count;
      } finally {
        client.release();
      }
    };
    const ten = await countFor(10);
    const threeHundred = await countFor(300);
    expect(ten).toBe(7);
    expect(threeHundred).toBe(ten);
    expect(ten).toBeLessThanOrEqual(13);
  });

  it('[01a §10 #85] hash parity with the hub; a BIGINT left as a string fails the cloud-side parse', async () => {
    await seedMenu(cloud.pool, f);
    const wire = await build(f.branches[0]);
    expect(typeof (wire.items as Array<{ price_minor: unknown }>)[0]!.price_minor).toBe('number');
    const cloudHash = sha256hex(canonicalJson(wire));

    const body = JSON.stringify(wire);
    const hubHash = sha256hex(canonicalJson(BranchConfigSnapshotSchemaV1.parse(JSON.parse(body))));
    expect(hubHash).toBe(cloudHash);

    const raw = await cloud.pool.query<{ price_minor: unknown }>(
      `SELECT price_minor FROM menu_items WHERE item_id = 'IT-0000'`,
    );
    expect(raw.rows[0]!.price_minor).toBe('120000'); // pg returns BIGINT as a string
    const unconverted = JSON.parse(body) as { items: Array<Record<string, unknown>> };
    unconverted.items[0]!.price_minor = raw.rows[0]!.price_minor;
    expect(() => BranchConfigSnapshotSchemaV1.parse(unconverted)).toThrow();
  });

  it('[01a S47] two windows with the same start are ordered by end', async () => {
    const menu = await seedMenu(cloud.pool, f);
    expect(menu.windowIds.itemLate < menu.windowIds.itemEarly).toBe(true); // id order is the other way
    const snapshot = await build(f.branches[0]);
    const item = (snapshot.items as Array<{ item_id: string; availability_windows: unknown }>)[0]!;
    expect(item.availability_windows).toEqual([
      { start_ms: 3600000, end_ms: 5400000 },
      { start_ms: 3600000, end_ms: 7200000 },
    ]);
  });

  it("[01a S33] the header's day settings are in the snapshot", async () => {
    await seedMenu(cloud.pool, f);
    const snapshot = await build(f.branches[0], {
      ...HEADER,
      tax_enabled: true,
      day_stale_after_hours: 20,
      day_min_gap_hours: 2,
    });
    expect(snapshot).toMatchObject({ tax_enabled: true, day_stale_after_hours: 20, day_min_gap_hours: 2 });
  });
});
