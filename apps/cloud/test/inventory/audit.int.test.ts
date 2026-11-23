import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listTenantScopes } from '../../src/plugins/tenant-scope';
import { owner } from '../helpers/restaurant';
import { ROUTE_CASES, type BIds } from '../helpers/route-cases';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { inventoryFixture, type InventoryFixture } from './fixtures';

// 08a §6.0, §4.2 (01a v2.8 A-1), I4, I6, I8, C7, §10.5 tests 34 (route half) and 36. The source-grep half of 34 is
// append-only.test.ts.
const STOCK_ITEM_ROUTES = [
  'GET /v1/admin/stock-items/:stock_item_id/inventory',
  'POST /v1/admin/stock-items/:stock_item_id/units',
  'POST /v1/admin/stock-items/:stock_item_id/prices',
  'POST /v1/admin/stock-items/:stock_item_id/yields',
];
const APPEND_ONLY_TABLES = ['stock_item_units', 'item_prices', 'yield_profiles'];

describe('08a audit, append-only routes and the cross-tenant sweep (§6.0, C7)', () => {
  let cloud: TestCloud;
  let fx: InventoryFixture;

  beforeAll(async () => {
    cloud = await createTestCloud();
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    fx = await inventoryFixture(cloud);
  });

  const post = (path: 'units' | 'prices' | 'yields', stockItemId: string, payload: object, headers = owner(fx.f).headers) =>
    cloud.app.inject({ method: 'POST', url: `/v1/admin/stock-items/${stockItemId}/${path}`, headers, payload });
  const audits = async (tenantId = fx.f.tenantId) =>
    (
      await cloud.pool.query<{
        entity: string;
        entity_id: string;
        action: string;
        actor_kind: string;
        actor_owner_user_id: string | null;
        branch_id: string | null;
        before: unknown;
        after: Record<string, unknown> | null;
      }>(
        `SELECT entity, entity_id, action, actor_kind, actor_owner_user_id, branch_id, before, after
           FROM config_audit WHERE tenant_id = $1 AND entity IN ('stock_item_unit', 'item_price', 'yield_profile')
          ORDER BY at, audit_id`,
        [tenantId],
      )
    ).rows;
  // Everything a refused write could leave behind: the three tables, their audit rows and the idempotency keys.
  const written = async () =>
    (
      await cloud.pool.query(
        `SELECT (SELECT count(*)::int FROM stock_item_units) AS units,
                (SELECT count(*)::int FROM item_prices) AS prices,
                (SELECT count(*)::int FROM yield_profiles) AS yields,
                (SELECT count(*)::int FROM config_audit WHERE entity IN ('stock_item_unit', 'item_price', 'yield_profile')) AS audit,
                (SELECT count(*)::int FROM idempotency_keys) AS keys`,
      )
    ).rows[0] as Record<string, number>;

  it('[08a #34] append-only: no registered route updates or deletes a unit, price or yield row (route inventory)', () => {
    const routes = listTenantScopes(cloud.app)
      .filter((route) => route.method !== 'HEAD')
      .map((route) => ({ key: `${route.method} ${route.url}`, method: route.method, url: route.url }));
    // Every route under /v1/admin/stock-items/:stock_item_id/… : the 01c branch PUT plus exactly 08a's four.
    expect(
      routes
        .filter((route) => route.url.startsWith('/v1/admin/stock-items/:stock_item_id/'))
        .map((route) => route.key)
        .sort(),
    ).toEqual([...STOCK_ITEM_ROUTES, 'PUT /v1/admin/stock-items/:stock_item_id/branches/:branch_id'].sort());
    // Only GET …/inventory and the three POSTs touch units / prices / yields; nothing anywhere else names them.
    const touching = routes.filter((route) => /\/(units|prices|yields|inventory)(\/|$)/.test(route.url));
    expect(touching.map((route) => route.key).sort()).toEqual([...STOCK_ITEM_ROUTES].sort());
    expect(touching.filter((route) => ['PATCH', 'PUT', 'DELETE'].includes(route.method))).toEqual([]);
    // No DELETE route under /v1/admin/stock-items at all.
    expect(routes.filter((route) => route.url.startsWith('/v1/admin/stock-items') && route.method === 'DELETE')).toEqual([]);
    // C7: each of the four has its cross-tenant / guard case.
    expect(Object.keys(ROUTE_CASES)).toEqual(expect.arrayContaining(STOCK_ITEM_ROUTES));
  });

  it('[08a #36] one config_audit row per POST: entity / create, actor = the owner, the price row carries its branch_id', async () => {
    const unit = await post('units', fx.ids.ghee, { unit_name: 'l', factor_num: 920 });
    expect(unit.statusCode, unit.body).toBe(201);
    const tenantPrice = await post('prices', fx.ids.beef, { kind: 'manual', unit_name: 'kg', price_minor: 150000 });
    expect(tenantPrice.statusCode, tenantPrice.body).toBe(201);
    const branchPrice = await post('prices', fx.ids.beef, {
      kind: 'market_rate',
      branch_id: fx.lakeCity,
      unit_name: 'kg',
      price_minor: 140000,
    });
    expect(branchPrice.statusCode, branchPrice.body).toBe(201);
    const mandiRate = await post('prices', fx.ids.beef, { kind: 'market_rate', unit_name: 'kg', price_minor: 145000 });
    expect(mandiRate.statusCode, mandiRate.body).toBe(201);
    const yieldRow = await post('yields', fx.ids.beef, { test_ap_qty: 10000, test_ep_qty: 7120 });
    expect(yieldRow.statusCode, yieldRow.body).toBe(201);

    const actor = { actor_kind: 'owner', actor_owner_user_id: fx.f.userId, action: 'create', before: null };
    const rows = await audits();
    expect(rows).toHaveLength(5);
    expect(rows).toEqual([
      expect.objectContaining({ ...actor, entity: 'stock_item_unit', entity_id: unit.json().data.unit.unit_row_id, branch_id: null }),
      expect.objectContaining({ ...actor, entity: 'item_price', entity_id: tenantPrice.json().data.price.price_id, branch_id: null }),
      expect.objectContaining({ ...actor, entity: 'item_price', entity_id: branchPrice.json().data.price.price_id, branch_id: fx.lakeCity }),
      expect.objectContaining({ ...actor, entity: 'item_price', entity_id: mandiRate.json().data.price.price_id, branch_id: null }),
      expect.objectContaining({ ...actor, entity: 'yield_profile', entity_id: yieldRow.json().data.yield.yield_profile_id, branch_id: null }),
    ]);
    // `after` is the stored row: the wire plus its stock_item_id, without the display-only recorded_by_name
    expect(rows[0]!.after).toMatchObject({ stock_item_id: fx.ids.ghee, unit_name: 'l', factor_num: '920', factor_den: 1 });
    expect(rows[1]!.after).toMatchObject({ stock_item_id: fx.ids.beef, price_id: rows[1]!.entity_id, branch_id: null, kind: 'manual', price_minor: 150000 });
    expect(rows[2]!.after).toMatchObject({ stock_item_id: fx.ids.beef, price_id: rows[2]!.entity_id, branch_id: fx.lakeCity, kind: 'market_rate' });
    expect(rows[3]!.after).toMatchObject({ stock_item_id: fx.ids.beef, price_id: rows[3]!.entity_id, branch_id: null, kind: 'market_rate' });
    expect(rows[4]!.after).toMatchObject({ stock_item_id: fx.ids.beef, yield_bp: 7120 });
    for (const row of rows) expect(row.after, row.entity).not.toHaveProperty('recorded_by_name');
    // §6.0: no other stock_item audit row is written by the three POSTs (their bump checks, ⚠️ 08b P-1, live in units / prices / yields tests)
    const other = await cloud.pool.query(`SELECT entity FROM config_audit WHERE tenant_id = $1 AND entity = 'stock_item' AND action <> 'create'`, [
      fx.f.tenantId,
    ]);
    expect(other.rows).toEqual([]);
  });

  it('[08a #36] no audit row on a replay or a refusal', async () => {
    const cases: Array<{ path: 'units' | 'prices' | 'yields'; id: string; payload: object }> = [
      { path: 'units', id: fx.ids.ghee, payload: { unit_name: 'peti', factor_num: 12000 } },
      { path: 'prices', id: fx.ids.beef, payload: { kind: 'manual', unit_name: 'kg', price_minor: 150000 } },
      { path: 'yields', id: fx.ids.beef, payload: { yield_bp: 7120 } },
    ];
    for (const c of cases) {
      const headers = owner(fx.f).headers;
      const first = await post(c.path, c.id, c.payload, headers);
      expect(first.statusCode, first.body).toBe(201);
      const before = await written();
      const versionsBefore = (await cloud.pool.query(`SELECT branch_id, config_version::text AS v FROM branches ORDER BY branch_id`)).rows;
      const replay = await post(c.path, c.id, c.payload, headers);
      expect(replay.statusCode, c.path).toBe(201);
      expect(replay.json(), c.path).toEqual(first.json());
      expect(await written(), `${c.path} replay`).toEqual(before);
      // ⚠️ 08b P-1: the POSTs bump now; a replay bumps nothing
      expect((await cloud.pool.query(`SELECT branch_id, config_version::text AS v FROM branches ORDER BY branch_id`)).rows, `${c.path} replay versions`).toEqual(versionsBefore);
    }
    expect(await audits()).toHaveLength(3);

    await cloud.pool.query(`UPDATE stock_items SET archived_at = 1 WHERE tenant_id = $1 AND stock_item_id = $2`, [fx.f.tenantId, fx.ids.ghee]);
    const refusals: Array<{ path: 'units' | 'prices' | 'yields'; id: string; payload: object; status: number }> = [
      { path: 'units', id: fx.ids.beef, payload: { unit_name: 'kg', factor_num: 1000 }, status: 400 }, // built-in on its own base (I4)
      { path: 'units', id: fx.ids.ghee, payload: { unit_name: 'peti', factor_num: 10000 }, status: 422 }, // archived
      { path: 'units', id: 'NO-SUCH-STOCK-ITEM', payload: { unit_name: 'peti', factor_num: 10000 }, status: 404 },
      { path: 'prices', id: fx.ids.beef, payload: { kind: 'manual', unit_name: 'peti', price_minor: 1 }, status: 422 }, // not convertible
      { path: 'prices', id: fx.ids.beef, payload: { kind: 'market_rate', branch_id: fx.f.other.branchId, unit_name: 'kg', price_minor: 1 }, status: 422 },
      { path: 'prices', id: fx.ids.beef, payload: { kind: 'manual', branch_id: fx.lakeCity, unit_name: 'kg', price_minor: 1 }, status: 400 },
      { path: 'yields', id: fx.ids.payeCooked, payload: { yield_bp: 7120 }, status: 422 }, // wrong_kind (I8)
      { path: 'yields', id: fx.ids.beef, payload: { test_ap_qty: 1000, test_ep_qty: 6000 }, status: 400 },
    ];
    const before = await written();
    for (const r of refusals) {
      const response = await post(r.path, r.id, r.payload);
      expect(response.statusCode, `${r.path} ${JSON.stringify(r.payload)} ${response.body}`).toBe(r.status);
    }
    // the owner row (S8) no longer covers every branch → 403 tenant_wide_write on each POST
    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [fx.f.tenantId, fx.f.userId, [fx.lakeCity]]);
    for (const c of cases) {
      const response = await post(c.path, c.id, c.payload);
      expect(response.statusCode, `${c.path} ${response.body}`).toBe(403);
      expect(response.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'tenant_wide_write' } });
    }
    expect(await written()).toEqual(before);
    expect(await audits()).toHaveLength(3);
  });

  it("[08a #36, C7] tenant A's JWT against tenant B's stock item: 404 STOCK_ITEM_NOT_FOUND on §6.4–§6.7, nothing written", async () => {
    // Tenant B's own ingredient, created through B's own route (so every rule but the tenant would pass).
    const createdB = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/stock-items',
      ...owner(fx.f, fx.f.other.token),
      payload: { name: 'B beef', stock_unit: 'g', kind: 'ingredient' },
    });
    expect(createdB.statusCode, createdB.body).toBe(201);
    const bStockItemId = createdB.json().data.stock_item.stock_item_id as string;
    // B's item is valid for B: B's own owner can read it (so A's 404 below is the tenant, not the item).
    const ownRead = await cloud.app.inject({
      method: 'GET',
      url: `/v1/admin/stock-items/${bStockItemId}/inventory`,
      headers: owner(fx.f, fx.f.other.token).headers,
    });
    expect(ownRead.statusCode, ownRead.body).toBe(200);

    const ids = { stockItemId: bStockItemId, branchId: fx.f.other.branchId } as BIds;
    const before = await written();
    for (const key of STOCK_ITEM_ROUTES) {
      const [method, route] = key.split(' ') as ['GET' | 'POST', string];
      const request = ROUTE_CASES[key]!(ids);
      expect(request.url, key).toBe(route.replace(':stock_item_id', bStockItemId));
      const response = await cloud.app.inject({
        method,
        url: request.url,
        headers: owner(fx.f).headers,
        ...(request.payload !== undefined ? { payload: request.payload as object } : {}),
      });
      expect(response.statusCode, `${key} ${response.body}`).toBe(404);
      expect(response.json().error, key).toMatchObject({ code: 'STOCK_ITEM_NOT_FOUND' });
      // nothing of B's but the id A sent comes back
      expect(JSON.stringify(response.json().error.details ?? {}), key).not.toContain(fx.f.other.tenantId);
    }
    // B's own branch on a market rate for B's item: the stock item lock answers first (404, not the C1 422).
    const withBranch = await post('prices', bStockItemId, {
      kind: 'market_rate',
      branch_id: fx.f.other.branchId,
      unit_name: 'kg',
      price_minor: 140000,
    });
    expect(withBranch.statusCode, withBranch.body).toBe(404);
    expect(withBranch.json().error.code).toBe('STOCK_ITEM_NOT_FOUND');
    // a branch-detail query naming B's branch is the C2 guard's 404, before any SQL
    const foreignBranch = await cloud.app.inject({
      method: 'GET',
      url: `/v1/admin/stock-items/${fx.ids.beef}/inventory?branch_id=${fx.f.other.branchId}`,
      headers: owner(fx.f).headers,
    });
    expect(foreignBranch.statusCode, foreignBranch.body).toBe(404);
    expect(foreignBranch.json().error.code).toBe('BRANCH_NOT_FOUND');

    expect(await written()).toEqual(before);
    expect(await audits(fx.f.other.tenantId)).toEqual([]);
    for (const table of APPEND_ONLY_TABLES) {
      const rows = await cloud.pool.query(`SELECT 1 FROM ${table} WHERE stock_item_id = $1`, [bStockItemId]);
      expect(rows.rows, table).toEqual([]);
    }
  });
});
