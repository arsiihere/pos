import type { StockItemWire } from '@pos/events';
import { stockItemBranchVersion } from '../../src/modules/menu-variants/versions';
import { createStockItem, putStockItemBranch } from '../helpers/menu-variants';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import type { TestCloud } from '../helpers/test-cloud';

// 08a §10.3 (N-5, P-4) shared fixture: tenant A (restaurantFixture) with Lake City = branch A, the seeded menu
// (seedMenu, station ST-1 at Lake City), and the stock items of the spec's examples:
// - PAYE-COOKED: prepared, piece, carries_over, counted at Lake City (ST-1); "Paye Half" (active) draws 1 piece of it
// - beef, ghee, paye raw: ingredients in g (ghee and paye raw marked A-items)
// - TP-1: packet in g, code TP-1
// Created through the 01c routes, then kind / code / is_a_item set by SQL (the fixture must not depend on the
// lane writing the stock-item rules). Read a fresh wire with `stockItem()` before a versioned PATCH.
// State to know: PAYE-COOKED HAS a branch row at Lake City and Paye Half is ACTIVE, so a `kind` PATCH away from
// prepared answers 409; tests 19 / 19b remove the row (PUT station_id null) and archive Paye Half first.
export interface InventoryFixture {
  f: RestaurantFixture;
  menu: SeededMenu;
  lakeCity: string;
  ids: { payeCooked: string; beef: string; ghee: string; payeRaw: string; tp1: string };
  payeHalfItemId: string;
}

export async function inventoryFixture(cloud: TestCloud): Promise<InventoryFixture> {
  const f = await restaurantFixture(cloud);
  const menu = await seedMenu(cloud.pool, f, { items: 1 });
  const lakeCity = f.branches[0];
  const make = (name: string, stock_unit: 'piece' | 'g', carries_over = false) => createStockItem(cloud, f, { name, stock_unit, carries_over });
  const payeCooked = await make('PAYE-COOKED', 'piece', true);
  const beef = await make('Beef', 'g');
  const ghee = await make('Ghee', 'g');
  const payeRaw = await make('Paye raw', 'g');
  const tp1 = await make('TP-1 tikka packet', 'g');
  await putStockItemBranch(cloud, f, payeCooked.stock_item_id, lakeCity, {
    expected_version: stockItemBranchVersion(payeCooked.stock_item_id, lakeCity, null).version,
    station_id: menu.slotStationId,
    low_stock_threshold: null,
  });
  const set = (id: string, sql: string) =>
    cloud.pool.query(`UPDATE stock_items SET ${sql} WHERE tenant_id = $1 AND stock_item_id = $2`, [f.tenantId, id]);
  await set(beef.stock_item_id, `kind = 'ingredient'`);
  await set(ghee.stock_item_id, `kind = 'ingredient', is_a_item = true`);
  await set(payeRaw.stock_item_id, `kind = 'ingredient', is_a_item = true`);
  await set(tp1.stock_item_id, `kind = 'packet', code = 'TP-1'`);

  const response = await cloud.app.inject({
    method: 'POST',
    url: '/v1/admin/menu-items',
    ...owner(f),
    payload: {
      category_id: menu.categoryIds[0],
      tax_class_id: null,
      name: 'Paye Half',
      price_minor: 90000,
      serve_mode: 'sync',
      cook_time_ms: 600_000,
      routes: [{ branch_id: lakeCity, station_id: menu.slotStationId }],
      stock_draws: [{ stock_item_id: payeCooked.stock_item_id, quantity_per_sale_unit: 1 }],
    },
  });
  if (response.statusCode !== 201) throw new Error(`create Paye Half failed: ${response.statusCode} ${response.body}`);

  return {
    f,
    menu,
    lakeCity,
    ids: {
      payeCooked: payeCooked.stock_item_id,
      beef: beef.stock_item_id,
      ghee: ghee.stock_item_id,
      payeRaw: payeRaw.stock_item_id,
      tp1: tp1.stock_item_id,
    },
    payeHalfItemId: (response.json().data.item as { item_id: string }).item_id,
  };
}

// The stock item's current wire (fresh version) from the §6.1 list, active or archived.
export async function stockItem(cloud: TestCloud, f: RestaurantFixture, stockItemId: string): Promise<StockItemWire> {
  for (const status of ['active', 'archived']) {
    const response = await cloud.app.inject({ method: 'GET', url: `/v1/admin/stock-items?status=${status}`, headers: owner(f).headers });
    if (response.statusCode !== 200) throw new Error(`list stock items failed: ${response.statusCode} ${response.body}`);
    const found = (response.json().data.stock_items as StockItemWire[]).find((row) => row.stock_item_id === stockItemId);
    if (found !== undefined) return found;
  }
  throw new Error(`stock item ${stockItemId} not found`);
}
