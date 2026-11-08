import { canonicalJson, sha256hex } from '@pos/domain/hash';
import { BranchConfigSnapshotSchemaV3 } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildSnapshot, type SnapshotHeader } from '../../src/modules/config-sync/builder';
import { stockItemBranchVersion } from '../../src/modules/menu-variants/versions';
import { createStockItem, putStockItemBranch } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture } from '../helpers/restaurant';
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
  const sql = (text: string, params: unknown[] = []) => cloud.pool.query(text, [f.tenantId, ...params]);
  // 01c §4.6: variant groups, stock items, their branch rows and draws by SQL. VG-1 holds IT-0000 (routed at A);
  // VG-B holds only IT-B (routed at B). 'Karahi pot' sorts after 'fries' by toLowerCase() (before it by code point).
  const seedVariants = async () => {
    const [a, b] = f.branches;
    await sql(
      `INSERT INTO variant_groups (tenant_id, variant_group_id, category_id, name, sort_order, created_at, updated_at)
       VALUES ($1, 'VG-1', 'CT-1', 'Chicken Karahi', 1, 0, 0), ($1, 'VG-B', 'CT-1', 'Branch B group', 2, 0, 0)`,
    );
    await sql(`UPDATE menu_items SET variant_group_id = 'VG-1', variant_name = 'Half' WHERE tenant_id = $1 AND item_id = 'IT-0000'`);
    await sql(`UPDATE menu_items SET variant_group_id = 'VG-B', variant_name = 'Only' WHERE tenant_id = $1 AND item_id = 'IT-B'`);
    await sql(
      `INSERT INTO stock_items (tenant_id, stock_item_id, name, stock_unit, carries_over, archived_at, created_at, updated_at)
       VALUES ($1, 'SK-1', 'Karahi pot', 'g', false, NULL, 0, 0), ($1, 'SK-2', 'fries', 'piece', true, NULL, 0, 0),
              ($1, 'SK-3', 'Old pot', 'g', false, 1, 0, 0), ($1, 'SK-4', 'Branch B pot', 'g', false, NULL, 0, 0)`,
    );
    await sql(
      `INSERT INTO stock_item_branches (tenant_id, branch_id, stock_item_id, station_id, low_stock_threshold, updated_at)
       VALUES ($1, $2, 'SK-1', 'ST-1', 1000, 0), ($1, $2, 'SK-2', 'ST-2', NULL, 0), ($1, $2, 'SK-3', 'ST-1', NULL, 0),
              ($1, $3, 'SK-4', 'ST-B', NULL, 0)`,
      [a, b],
    );
    await sql(
      `INSERT INTO stock_draws (tenant_id, item_id, stock_item_id, quantity_per_sale_unit)
       VALUES ($1, 'IT-0000', 'SK-1', 250), ($1, 'IT-0001', 'SK-2', 1), ($1, 'IT-B', 'SK-4', 100)`,
    );
  };

  it('[01a §10 #4] only active rows and this branch’s routes, except archived stations, programs and tax classes', async () => {
    await seedMenu(cloud.pool, f, { archived: true });
    await seedVariants();
    const snapshot = await build(f.branches[0]);
    const pass = (await sql(`SELECT point_id FROM points WHERE tenant_id = $1 AND branch_id = $2`, [f.branches[0]])).rows[0].point_id as string;
    // 01a §4.3 V3, §5.2a: the engine fields at their defaults.
    const engineStation = {
      point_id: pass,
      policy: 'waada_guard',
      freeze_ms: 120000,
      min_slack_keep_ms: 60000,
      promise_padding_ms: null,
      pressure_window_ms: 900000,
      pressure_amber_bp: 8000,
      pressure_red_bp: 10000,
      pressure_alert_ms: 300000,
      pause_enabled: false,
      lane_units: null,
      reserve_units: 0,
      alternates: [],
      carry_times: [],
    };
    const itemKnobs = { weight_pct: 100, max_early_ms: 60000, max_carry_ms: null, max_late_ms: null, adjust_time_ms: 180000 };
    expect(snapshot).toEqual({
      snapshot_schema_version: 3,
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
      points: [{ point_id: pass, name: 'Pass', sort_order: 0, is_archived: false }],
      stations: [
        {
          ...engineStation,
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
          ...engineStation,
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
          ...engineStation,
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
      variant_groups: [
        { variant_group_id: 'VG-1', category_id: 'CT-1', name: 'Chicken Karahi', description: null, sort_order: 1 },
      ],
      stock_items: [
        { stock_item_id: 'SK-2', name: 'fries', stock_unit: 'piece', carries_over: true, station_id: 'ST-2', low_stock_threshold: null },
        { stock_item_id: 'SK-1', name: 'Karahi pot', stock_unit: 'g', carries_over: false, station_id: 'ST-1', low_stock_threshold: 1000 },
      ],
      modifier_groups: [],
      deals: [],
      engine_settings: {
        weight_dine_in_pct: 100,
        weight_takeaway_pct: 200,
        weight_delivery_pct: 200,
        weight_parking_pct: 200,
        weight_follow_up_pct: 300,
        promise_padding_dine_in_ms: 180000,
        promise_padding_takeaway_ms: 180000,
        promise_padding_delivery_ms: 180000,
        promise_padding_parking_ms: 180000,
        slip_threshold_ms: 120000,
        slip_escalate_ms: 120000,
        cascade_step_ms: 60000,
        min_gain_ms: 60000,
        returns_boost: true,
        order_abandon_ms: 14400000,
        table_lock_ttl_ms: 600000,
      },
      goes_with: [],
      items: [
        {
          ...itemKnobs,
          item_id: 'IT-0000',
          category_id: 'CT-1',
          variant_group_id: 'VG-1',
          variant_name: 'Half',
          name: 'Chicken Karahi — Half',
          description: null,
          sort_order: 0,
          price_minor: 120000,
          tax_class_id: 'TX-1',
          serve_mode: 'sync',
          prep_buffer_ms: 0,
          cook_time_ms: 1200000,
          stock_time_ms: 300000,
          out_of_stock_behaviour: 'cook_fresh',
          sale_unit: 'piece',
          requires_weighing: false,
          stock_draws: [{ stock_item_id: 'SK-1', quantity_per_sale_unit: 250 }],
          availability_windows: [
            { start_ms: 3600000, end_ms: 5400000 },
            { start_ms: 3600000, end_ms: 7200000 },
          ],
          station_id: 'ST-1',
          program_id: null,
          stock_program_id: null,
          modifier_group_ids: [],
        },
        {
          ...itemKnobs,
          item_id: 'IT-0001',
          category_id: 'CT-1',
          variant_group_id: null,
          variant_name: null,
          name: 'Item 1',
          description: null,
          sort_order: 1,
          price_minor: 50001,
          tax_class_id: null,
          serve_mode: 'sync',
          prep_buffer_ms: 0,
          cook_time_ms: 1200000,
          stock_time_ms: null,
          out_of_stock_behaviour: 'cook_fresh',
          sale_unit: 'piece',
          requires_weighing: false,
          stock_draws: [{ stock_item_id: 'SK-2', quantity_per_sale_unit: 1 }],
          availability_windows: [],
          station_id: 'ST-2',
          program_id: 'PG-1',
          stock_program_id: 'PG-2',
          modifier_group_ids: [],
        },
      ],
    });

    // branch B sees only its own item and station; no floors
    const other = await build(f.branches[1]);
    expect((other.items as Array<{ item_id: string }>).map((item) => item.item_id)).toEqual(['IT-B']);
    expect((other.stations as Array<{ station_id: string }>).map((station) => station.station_id)).toEqual(['ST-B']);
    expect(other.floors).toEqual([]);
    expect(other.stock_items).toEqual([expect.objectContaining({ stock_item_id: 'SK-4', station_id: 'ST-B' })]);
  });

  it('[01c #57] the built snapshot parses with BranchConfigSnapshotSchemaV3; canonicalJson is stable across two builds', async () => {
    await seedMenu(cloud.pool, f, { archived: true });
    await seedVariants();
    const first = await build(f.branches[0]);
    const parsed = BranchConfigSnapshotSchemaV3.parse(first);
    expect(parsed).toEqual(first);
    const second = await build(f.branches[0]);
    expect(sha256hex(canonicalJson(second))).toBe(sha256hex(canonicalJson(first)));
  });

  it('[01c #58] a draw from a stock item not counted here, or on a slot route with no stock time → stock_draws: []; an API-written draw comes from stock_draws', async () => {
    const menu = await seedMenu(cloud.pool, f, { items: 3 });
    await seedVariants();
    // IT-0000 (stock time set) draws from SK-4, counted only at branch B; IT-0002 (slot, stock_time_ms null) from SK-1.
    await sql(`UPDATE stock_draws SET stock_item_id = 'SK-4' WHERE tenant_id = $1 AND item_id = 'IT-0000'`);
    await sql(`INSERT INTO stock_draws (tenant_id, item_id, stock_item_id, quantity_per_sale_unit) VALUES ($1, 'IT-0002', 'SK-1', 5)`);
    const drawsOf = (snapshot: Record<string, unknown>, itemId: string) =>
      (snapshot.items as Array<{ item_id: string; stock_draws: unknown }>).find((item) => item.item_id === itemId)?.stock_draws;
    const seeded = await build(f.branches[0]);
    expect(drawsOf(seeded, 'IT-0000')).toEqual([]);
    expect(drawsOf(seeded, 'IT-0002')).toEqual([]);
    expect(drawsOf(seeded, 'IT-0001')).toEqual([{ stock_item_id: 'SK-2', quantity_per_sale_unit: 1 }]);

    // A piece item with a g draw of 250, created and then PATCHed through the API: the snapshot reads stock_draws,
    // not the deprecated unit columns the 01c writes reset.
    const pot = await createStockItem(cloud, f, { name: 'API pot', stock_unit: 'g' });
    await putStockItemBranch(cloud, f, pot.stock_item_id, f.branches[0], {
      expected_version: stockItemBranchVersion(pot.stock_item_id, f.branches[0], null).version,
      station_id: menu.slotStationId,
    });
    const created = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/menu-items',
      ...owner(f),
      payload: {
        category_id: menu.categoryIds[0],
        tax_class_id: null,
        name: 'Mutton Karahi Half',
        price_minor: 150000,
        serve_mode: 'sync',
        cook_time_ms: 1_200_000,
        stock_time_ms: 300_000,
        sale_unit: 'piece',
        stock_draws: [{ stock_item_id: pot.stock_item_id, quantity_per_sale_unit: 250 }],
        routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId }],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const itemId = (created.json().data.item as { item_id: string }).item_id;
    const patched = await cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/menu-items/${itemId}`,
      ...owner(f),
      payload: { name: 'Mutton Karahi — Half' },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    const deprecated = await cloud.pool.query<{ stock_per_sale_unit: number }>(
      `SELECT stock_per_sale_unit FROM menu_items WHERE item_id = $1`,
      [itemId],
    );
    expect(deprecated.rows[0]!.stock_per_sale_unit).toBe(1);
    const viaApi = await build(f.branches[0]);
    expect(drawsOf(viaApi, itemId)).toEqual([{ stock_item_id: pot.stock_item_id, quantity_per_sale_unit: 250 }]);
  });

  it('[01c #60] a variant group with no member routed at a branch is absent there', async () => {
    await seedMenu(cloud.pool, f, { archived: true });
    await seedVariants();
    // VG-X's only member is archived (and routed at A); VG-B's only member is routed at B.
    await sql(
      `INSERT INTO variant_groups (tenant_id, variant_group_id, category_id, name, sort_order, created_at, updated_at)
       VALUES ($1, 'VG-X', 'CT-1', 'Old group', 3, 0, 0)`,
    );
    await sql(`UPDATE menu_items SET variant_group_id = 'VG-X', variant_name = 'Old' WHERE tenant_id = $1 AND item_id = 'IT-X'`);
    const groupsOf = (snapshot: Record<string, unknown>) =>
      (snapshot.variant_groups as Array<{ variant_group_id: string }>).map((group) => group.variant_group_id);
    expect(groupsOf(await build(f.branches[0]))).toEqual(['VG-1']);
    expect(groupsOf(await build(f.branches[1]))).toEqual(['VG-B']);
  });

  it('[01c #93] a batch route resolves program_id and stock_program_id in programs[] with cook_time_ms, archived included; a slot route has both null', async () => {
    await seedMenu(cloud.pool, f, { archived: true });
    await sql(`UPDATE batch_programs SET archived_at = 1 WHERE tenant_id = $1 AND program_id = 'PG-2'`);
    const snapshot = BranchConfigSnapshotSchemaV3.parse(await build(f.branches[0]));
    const batch = snapshot.items.find((item) => item.item_id === 'IT-0001')!;
    const programs = snapshot.stations.find((station) => station.station_id === batch.station_id)!.programs;
    expect(programs.find((program) => program.program_id === batch.program_id)).toMatchObject({ cook_time_ms: 360000, is_archived: false });
    expect(programs.find((program) => program.program_id === batch.stock_program_id)).toMatchObject({ cook_time_ms: 120000, is_archived: true });
    const slot = snapshot.items.find((item) => item.item_id === 'IT-0000')!;
    expect(slot).toMatchObject({ program_id: null, stock_program_id: null });
  });

  it('[01a §10 #5] snapshot query count is fixed (≤ 22, 01c §4.5) for 10 and 300 items', async () => {
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
    expect(ten).toBe(21); // 01c tasks 27, 28, 31: + modifier groups with options, this branch's option rows, links, deals with parts and choices, deal windows, deal branch rows; 03a C6: + points, alternates, carry times, engine settings, goes-with
    expect(threeHundred).toBe(ten);
    expect(ten).toBeLessThanOrEqual(22);
  });

  it('[01a §10 #140, 01c §4.5] the builder alone on a 5 000-item branch: ≤ 22 statements (transaction control excluded)', async () => {
    const counter = pgCounter(cloud.pool);
    await seedMenu(cloud.pool, f, { items: 5_000, archived: true });
    const client = await cloud.pool.connect();
    try {
      counter.reset();
      const snapshot = await buildSnapshot(client, tenant(), f.branches[0], HEADER);
      expect(snapshot.items).toHaveLength(5_000);
      expect(counter.count).toBeLessThanOrEqual(22); // 21 (01c tasks 27, 28, 31; 03a C6): 01a's 7 + variant groups, stock items, draws, modifier groups with options, option rows, links, deals with parts and choices, deal windows, deal branch rows, points, alternates, carry times, engine settings, goes-with
    } finally {
      client.release();
    }
   }, 120_000);

  it('[01a §10 #85] hash parity with the hub; a BIGINT left as a string fails the cloud-side parse', async () => {
    await seedMenu(cloud.pool, f);
    const wire = await build(f.branches[0]);
    expect(typeof (wire.items as Array<{ price_minor: unknown }>)[0]!.price_minor).toBe('number');
    const cloudHash = sha256hex(canonicalJson(wire));

    const body = JSON.stringify(wire);
    const hubHash = sha256hex(canonicalJson(BranchConfigSnapshotSchemaV3.parse(JSON.parse(body))));
    expect(hubHash).toBe(cloudHash);

    const raw = await cloud.pool.query<{ price_minor: unknown }>(
      `SELECT price_minor FROM menu_items WHERE item_id = 'IT-0000'`,
    );
    expect(raw.rows[0]!.price_minor).toBe('120000'); // pg returns BIGINT as a string
    const unconverted = JSON.parse(body) as { items: Array<Record<string, unknown>> };
    unconverted.items[0]!.price_minor = raw.rows[0]!.price_minor;
    expect(() => BranchConfigSnapshotSchemaV3.parse(unconverted)).toThrow();
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

  it('[01a D54] the window statement returns no item windows for a branch outside the caller’s branches', async () => {
    await seedMenu(cloud.pool, f);
    const client = await cloud.pool.connect();
    const windowRows: Array<{ item_id: string | null }> = [];
    const original = client.query.bind(client) as (...args: unknown[]) => Promise<{ rows: unknown[] }>;
    (client as { query: unknown }).query = async (...args: unknown[]) => {
      const result = await original(...args);
      if (typeof args[0] === 'string' && args[0].includes('FROM availability_windows')) {
        windowRows.push(...(result.rows as Array<{ item_id: string | null }>));
      }
      return result;
    };
    try {
      const otherOnly = Object.freeze({ tenantId: f.tenantId, branchIds: Object.freeze([f.branches[1]]) });
      // 01a CL-3: the out-of-scope caller also reads no engine settings row, and a missing row is an error.
      await expect(buildSnapshot(client, otherOnly, f.branches[0], HEADER)).rejects.toThrow(/engine settings/);
    } finally {
      (client as { query: unknown }).query = original;
      client.release();
    }
    expect(windowRows.length).toBeGreaterThan(0); // the statement ran: the tenant's category window
    expect(windowRows.filter((row) => row.item_id !== null)).toEqual([]);
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
