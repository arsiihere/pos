import { BranchConfigSnapshotSchemaV3, type BranchConfig } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildSnapshot, type SnapshotHeader } from '../../src/modules/config-sync/builder';
import { stockItemBranchVersion } from '../../src/modules/menu-variants/versions';
import { createStockItem, createVariantGroup, putStockItemBranch } from '../helpers/menu-variants';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const HEADER: SnapshotHeader = {
  config_version: 7,
  currency_code: 'PKR',
  tax_enabled: false,
  day_stale_after_hours: 16,
  day_min_gap_hours: 4,
};

// 01c §4.6 rules 1 and 4, V2, V18: what an item written through the API carries in the schema-3 snapshot.
describe('01c snapshot item contents (§4.6)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let menu: SeededMenu;

  beforeAll(async () => {
    cloud = await createTestCloud();
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
    menu = await seedMenu(cloud.pool, f, { items: 1 });
    const [a, b] = f.branches;
    // A second slot station "Grill" at branch A; an archived slot station at branch B.
    await cloud.pool.query(
      `INSERT INTO stations (tenant_id, branch_id, station_id, point_id, name, station_type, capacity, archived_at, created_at, updated_at)
       VALUES ($1, $2, 'ST-G', (SELECT point_id FROM points WHERE tenant_id = $1 AND branch_id = $2 AND name = 'Pass'), 'Grill', 'slot', 4, NULL, 0, 0), ($1, $3, 'ST-BX', (SELECT point_id FROM points WHERE tenant_id = $1 AND branch_id = $3 AND name = 'Pass'), 'Old grill', 'slot', 2, 1, 0, 0)`,
      [f.tenantId, a, b],
    );
  });

  const build = async (branchId: string): Promise<BranchConfig> => {
    const client = await cloud.pool.connect();
    try {
      const tenant = Object.freeze({ tenantId: f.tenantId, branchIds: Object.freeze([...f.branches]) });
      return BranchConfigSnapshotSchemaV3.parse(await buildSnapshot(client, tenant, branchId, HEADER));
    } finally {
      client.release();
    }
  };
  const itemOf = (snapshot: BranchConfig, itemId: string) => snapshot.items.find((item) => item.item_id === itemId);
  const createItem = async (payload: object) => {
    const response = await cloud.app.inject({ method: 'POST', url: '/v1/admin/menu-items', ...owner(f), payload });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json().data.item as { item_id: string }).item_id;
  };
  const patchItem = (itemId: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/menu-items/${itemId}`, ...owner(f), payload });
  const putRoute = (itemId: string, branchId: string, payload: object) =>
    cloud.app.inject({
      method: 'PUT',
      url: `/v1/admin/menu-items/${itemId}/routes/${branchId}`,
      headers: { authorization: `Bearer ${f.token}` },
      payload,
    });
  // A counted stock item (§6.7 + §6.9 through the API).
  const countedStockItem = async (name: string, unit: 'g' | 'piece', branchId: string, stationId: string) => {
    const stockItem = await createStockItem(cloud, f, { name, stock_unit: unit });
    await putStockItemBranch(cloud, f, stockItem.stock_item_id, branchId, {
      expected_version: stockItemBranchVersion(stockItem.stock_item_id, branchId, null).version,
      station_id: stationId,
    });
    return stockItem.stock_item_id;
  };
  // E0-MENU AC4: Half (Rs 1,150, 20 min, Karahi) and Full (Rs 2,200, 25 min, Grill), 500 g / 1 000 g of one Karahi pot.
  const halfAndFull = async () => {
    const [a] = f.branches;
    const group = await createVariantGroup(cloud, f, { name: 'Chicken Karahi', category_id: menu.categoryIds[0] });
    const pot = await countedStockItem('Karahi pot', 'g', a, menu.slotStationId);
    const variant = (name: string, priceMinor: number, cookTimeMs: number, grams: number, stationId: string) =>
      createItem({
        category_id: menu.categoryIds[0],
        tax_class_id: null,
        variant_group_id: group.variant_group_id,
        variant_name: name,
        name: `Chicken Karahi ${name}`,
        price_minor: priceMinor,
        serve_mode: 'sync',
        cook_time_ms: cookTimeMs,
        stock_time_ms: 300_000,
        sale_unit: 'piece',
        stock_draws: [{ stock_item_id: pot, quantity_per_sale_unit: grams }],
        routes: [{ branch_id: a, station_id: stationId }],
      });
    const half = await variant('Half', 115_000, 1_200_000, 500, menu.slotStationId);
    const full = await variant('Full', 220_000, 1_500_000, 1_000, 'ST-G');
    return { group: group.variant_group_id, pot, half, full };
  };

  it('[01c #21] Half and Full in one group, 500 g / 1 000 g of one Karahi pot → each in the snapshot with its own price, cook time, station, group, variant name and draw', async () => {
    const [a] = f.branches;
    const { group, pot, half, full } = await halfAndFull();
    // Task 14 carry: both PATCHed through the API; the deprecated unit columns stay reset, the draws stay on stock_draws.
    for (const [itemId, name] of [
      [half, 'Karahi — Half'],
      [full, 'Karahi — Full'],
    ] as const) {
      const patched = await patchItem(itemId, { name });
      expect(patched.statusCode, patched.body).toBe(200);
    }
    const deprecated = await cloud.pool.query(
      `SELECT item_id, stock_unit, stock_per_sale_unit FROM menu_items WHERE item_id = ANY($1) ORDER BY item_id`,
      [[half, full]],
    );
    expect(deprecated.rows).toEqual(
      [half, full].sort().map((itemId) => ({ item_id: itemId, stock_unit: 'piece', stock_per_sale_unit: 1 })),
    );

    const snapshot = await build(a);
    expect(itemOf(snapshot, half)).toMatchObject({
      name: 'Karahi — Half',
      price_minor: 115_000,
      cook_time_ms: 1_200_000,
      station_id: menu.slotStationId,
      variant_group_id: group,
      variant_name: 'Half',
      sale_unit: 'piece',
      requires_weighing: false,
      stock_draws: [{ stock_item_id: pot, quantity_per_sale_unit: 500 }],
    });
    expect(itemOf(snapshot, full)).toMatchObject({
      name: 'Karahi — Full',
      price_minor: 220_000,
      cook_time_ms: 1_500_000,
      station_id: 'ST-G',
      variant_group_id: group,
      variant_name: 'Full',
      sale_unit: 'piece',
      requires_weighing: false,
      stock_draws: [{ stock_item_id: pot, quantity_per_sale_unit: 1_000 }],
    });
    expect(snapshot.variant_groups.map((g) => g.variant_group_id)).toEqual([group]);
    expect(snapshot.stock_items).toEqual([
      { stock_item_id: pot, name: 'Karahi pot', stock_unit: 'g', carries_over: false, station_id: menu.slotStationId, low_stock_threshold: null },
    ]);

    // Task 21 review minor (§4.6 rule 4): a batch route tracks only with a stock program.
    const fries = await countedStockItem('Fries', 'piece', a, menu.batchStationId);
    const plate = await createItem({
      category_id: menu.categoryIds[0],
      tax_class_id: null,
      name: 'Fries plate',
      price_minor: 30_000,
      serve_mode: 'sync',
      cook_time_ms: 360_000,
      stock_time_ms: 300_000,
      stock_draws: [{ stock_item_id: fries, quantity_per_sale_unit: 1 }],
      routes: [{ branch_id: a, station_id: menu.batchStationId, program_id: menu.programIds[0] }],
    });
    expect(itemOf(await build(a), plate)).toMatchObject({ stock_program_id: null, stock_draws: [] });
    const routed = await putRoute(plate, a, {
      station_id: menu.batchStationId,
      program_id: menu.programIds[0],
      stock_program_id: menu.programIds[1],
    });
    expect(routed.statusCode, routed.body).toBe(200);
    expect(itemOf(await build(a), plate)).toMatchObject({
      stock_program_id: menu.programIds[1],
      stock_draws: [{ stock_item_id: fries, quantity_per_sale_unit: 1 }],
    });
  });

  it('[01c #80] route PUT for Full to another branch’s station → 422 wrong_branch; to an archived station → 422 archived; Full is not in that branch’s snapshot', async () => {
    const [a, b] = f.branches;
    const { pot, half, full } = await halfAndFull();
    // The Karahi pot is also counted at branch B, where neither variant is routed.
    await putStockItemBranch(cloud, f, pot, b, {
      expected_version: stockItemBranchVersion(pot, b, null).version,
      station_id: 'ST-B',
    });
    const before = await cloud.pool.query(`SELECT branch_id, station_id FROM item_routes WHERE item_id = $1`, [full]);

    const wrongBranch = await putRoute(full, b, { station_id: 'ST-G' });
    expect(wrongBranch.statusCode, wrongBranch.body).toBe(422);
    expect(wrongBranch.json().error).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'station_id', reason: 'wrong_branch' },
    });
    const archived = await putRoute(full, b, { station_id: 'ST-BX' });
    expect(archived.statusCode, archived.body).toBe(422);
    expect(archived.json().error).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'station_id', reason: 'archived' },
    });
    const after = await cloud.pool.query(`SELECT branch_id, station_id FROM item_routes WHERE item_id = $1`, [full]);
    expect(after.rows).toEqual(before.rows);

    const atB = await build(b);
    expect(itemOf(atB, full)).toBeUndefined();
    expect(itemOf(atB, half)).toBeUndefined();
    expect(atB.variant_groups).toEqual([]);
    // Task 19 carry (F4): the pot is counted at B, but no item in B's snapshot draws from it (items not routed
    // here are left out), so the hub's drawers are empty and has_tracked_drawers is false.
    expect(atB.stock_items.map((s) => s.stock_item_id)).toEqual([pot]);
    expect(atB.items.filter((item) => item.stock_draws.some((draw) => draw.stock_item_id === pot))).toEqual([]);
    expect(itemOf(await build(a), full)).toMatchObject({ station_id: 'ST-G' });
  });

  it('[01c #84] POST requires_weighing with sale_unit piece → 400; PATCH sale_unit piece alone onto a weighed g item → 400; requires_weighing with g → 201, in the snapshot with requires_weighing: true', async () => {
    const [a] = f.branches;
    const fish = {
      category_id: menu.categoryIds[0],
      tax_class_id: null,
      name: 'Fried fish',
      price_minor: 40_000,
      serve_mode: 'sync',
      cook_time_ms: 900_000,
      routes: [{ branch_id: a, station_id: menu.slotStationId }],
    };
    const items = async () => Number((await cloud.pool.query<{ n: string }>(`SELECT count(*) AS n FROM menu_items`)).rows[0]!.n);
    const itemsBefore = await items();
    const piece = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/menu-items',
      ...owner(f),
      payload: { ...fish, sale_unit: 'piece', requires_weighing: true },
    });
    expect(piece.statusCode, piece.body).toBe(400);
    expect(piece.json().error).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'requires_weighing' }] } });
    expect(await items()).toBe(itemsBefore);

    const weighed = await createItem({ ...fish, sale_unit: 'g', requires_weighing: true });
    const toPiece = await patchItem(weighed, { sale_unit: 'piece' });
    expect(toPiece.statusCode, toPiece.body).toBe(400);
    expect(toPiece.json().error).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'sale_unit' }] } });

    expect(itemOf(await build(a), weighed)).toMatchObject({ sale_unit: 'g', requires_weighing: true, stock_draws: [] });
  });
});
