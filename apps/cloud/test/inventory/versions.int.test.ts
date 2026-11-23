import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { StockItemListResponse, StockItemResponse } from '@pos/events';
import { createStockItem } from '../helpers/menu-variants';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

// 08a test 12 (§5.3, C-7, I13): the stock-item wire carries kind / code / cost_category / is_a_item, and its version
// string covers each of them; a stale PATCH → 409 CONFIG_STALE; a version-only body → 400 (C9).
describe('[08a #12] stock-item wire and version (C-7)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;

  beforeAll(async () => {
    cloud = await createTestCloud();
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
  });

  const list = async () => {
    const response = await cloud.app.inject({ method: 'GET', url: '/v1/admin/stock-items', headers: owner(f).headers });
    expect(response.statusCode, response.body).toBe(200);
    return StockItemListResponse.parse(response.json()).data.stock_items;
  };
  const patch = (stockItemId: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/stock-items/${stockItemId}`, ...owner(f), payload });

  it('[08a #12] the wire has the four inventory fields (an existing item reads prepared / food / not an A-item)', async () => {
    const created = await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' });
    expect(created).toMatchObject({ kind: 'prepared', code: null, cost_category: 'food', is_a_item: false });
    const [listed] = await list();
    expect(listed).toMatchObject({ stock_item_id: created.stock_item_id, kind: 'prepared', code: null, cost_category: 'food', is_a_item: false });
    expect(listed!.version).toBe(created.version);
  });

  it('[08a #12] the version string covers every new field', async () => {
    const created = await createStockItem(cloud, f, { name: 'Ghee', stock_unit: 'g' });
    const seen = new Set([created.version]);
    for (const set of [`kind = 'ingredient'`, `code = 'GH-1'`, `cost_category = 'packaging'`, `is_a_item = true`]) {
      await cloud.pool.query(`UPDATE stock_items SET ${set} WHERE tenant_id = $1 AND stock_item_id = $2`, [f.tenantId, created.stock_item_id]);
      const [row] = await list();
      expect(seen.has(row!.version), set).toBe(false);
      seen.add(row!.version);
    }
  });

  it('[08a #12] a stale version → 409 CONFIG_STALE after an inventory-field change; a version-only body → 400', async () => {
    const created = await createStockItem(cloud, f, { name: 'Paye', stock_unit: 'g' });
    await cloud.pool.query(`UPDATE stock_items SET is_a_item = true WHERE tenant_id = $1 AND stock_item_id = $2`, [f.tenantId, created.stock_item_id]);
    const stale = await patch(created.stock_item_id, { expected_version: created.version, name: 'Paye raw' });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().error.code).toBe('CONFIG_STALE');
    const versionOnly = await patch(created.stock_item_id, { expected_version: created.version });
    expect(versionOnly.statusCode, versionOnly.body).toBe(400);
    const [fresh] = await list();
    const ok = await patch(created.stock_item_id, { expected_version: fresh!.version, name: 'Paye raw' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(StockItemResponse.parse(ok.json()).data.stock_item).toMatchObject({ name: 'Paye raw', is_a_item: true });
  });
});
