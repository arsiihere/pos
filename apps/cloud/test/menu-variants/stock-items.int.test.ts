import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stockItemBranchVersion } from '../../src/modules/menu-variants/versions';
import { createStockItem, createVariantGroup, putStockItemBranch } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

// 01c §6.6–§6.8: stock items (list, create, versioned PATCH).
describe('01c stock items (§6.6, §6.7, §6.8)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let menu: SeededMenu;
  let counter: ReturnType<typeof pgCounter>;

  beforeAll(async () => {
    cloud = await createTestCloud({ testHooks: { handlerStart: () => counter.reset() } });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
    menu = await seedMenu(cloud.pool, f, { items: 1 });
  });

  const post = (payload: object, headers?: Record<string, string>) =>
    cloud.app.inject({ method: 'POST', url: '/v1/admin/stock-items', headers: { ...owner(f).headers, ...headers }, payload });
  const patch = (stockItemId: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/stock-items/${stockItemId}`, ...owner(f), payload });
  const list = (query = '', token?: string) =>
    cloud.app.inject({ method: 'GET', url: `/v1/admin/stock-items${query}`, headers: owner(f, token).headers });
  const versions = async () =>
    (
      await cloud.pool.query<{ config_version: string }>(`SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`, [
        f.tenantId,
      ])
    ).rows.map((row) => Number(row.config_version));
  const auditRows = async () =>
    (
      await cloud.pool.query<{ entity_id: string; branch_id: string | null; action: string; before: unknown; after: unknown }>(
        `SELECT entity_id, branch_id, action, before, after FROM config_audit
          WHERE tenant_id = $1 AND entity = 'stock_item' ORDER BY at, audit_id`,
        [f.tenantId],
      )
    ).rows;
  const storedItems = async () => (await cloud.pool.query(`SELECT * FROM stock_items ORDER BY stock_item_id`)).rows;
  // Asserts the call answers `status` and changes no stock item, audit row or config version.
  const nothingWritten = async (call: () => Promise<{ statusCode: number; body: string; json(): unknown }>, status: number) => {
    const before = { items: await storedItems(), audit: await auditRows(), versions: await versions() };
    const response = await call();
    expect(response.statusCode, response.body).toBe(status);
    expect({ items: await storedItems(), audit: await auditRows(), versions: await versions() }).toEqual(before);
    return response.json() as { data?: { stock_item: unknown }; error: { code: string; details?: unknown } };
  };
  const item = async (o: object) => {
    const response = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/menu-items',
      ...owner(f),
      payload: {
        category_id: menu.categoryIds[0],
        tax_class_id: null,
        name: 'Chicken Karahi Half',
        price_minor: 115000,
        serve_mode: 'sync',
        cook_time_ms: 1_200_000,
        routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId }],
        ...o,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().data.item as { item_id: string; name: string };
  };
  const archiveItem = async (itemId: string) => {
    const response = await cloud.app.inject({ method: 'PATCH', url: `/v1/admin/menu-items/${itemId}`, ...owner(f), payload: { archived: true } });
    expect(response.statusCode, response.body).toBe(200);
  };

  it('[01c #28] create Karahi pot (g) → 201, audit, every branch bumped; replay → stored 201; duplicate active name → 409 stock_item', async () => {
    const before = await versions();
    const key = '01J00000000000000000000098';
    const created = await post({ name: 'Karahi pot', stock_unit: 'g' }, { 'idempotency-key': key });
    expect(created.statusCode, created.body).toBe(201);
    expect(counter.count).toBe(8); // key insert, tenant-wide check, insert, audit, 2 bump, key response, prune
    const pot = created.json().data.stock_item;
    expect(pot).toEqual({
      stock_item_id: expect.any(String),
      name: 'Karahi pot',
      stock_unit: 'g',
      carries_over: false,
      archived_at: null,
      version: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(await versions()).toEqual(before.map((v) => v + 1));
    const audit = await auditRows();
    expect(audit).toEqual([
      {
        entity_id: pot.stock_item_id,
        branch_id: null,
        action: 'create',
        before: null,
        after: expect.objectContaining({ name: 'Karahi pot', stock_unit: 'g', carries_over: false }),
      },
    ]);
    expect(audit[0]!.after).not.toHaveProperty('version');

    const replay = await post({ name: 'Karahi pot', stock_unit: 'g' }, { 'idempotency-key': key });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(created.json());
    expect(await versions()).toEqual(before.map((v) => v + 1));

    const taken = await nothingWritten(() => post({ name: 'KARAHI POT', stock_unit: 'ml' }), 409);
    expect(taken.error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'stock_item' } });
    for (const body of [{ name: 'Naan', stock_unit: 'kg' }, { name: '', stock_unit: 'g' }, { name: 'x'.repeat(61), stock_unit: 'g' }]) {
      expect((await nothingWritten(() => post(body), 400)).error.code, JSON.stringify(body)).toBe('VALIDATION_FAILED');
    }
    // an archived name is free again
    await createStockItem(cloud, f, { name: 'Old pot', stock_unit: 'g' }, { archived: true });
    const again = await post({ name: 'old pot', stock_unit: 'piece', carries_over: true });
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json().data.stock_item).toMatchObject({ name: 'old pot', stock_unit: 'piece', carries_over: true });
  });

  it('[01c #29] stock_unit to ml while an item draws with sale_unit piece → 200; while an item draws with sale_unit g → 422 unit_mismatch', async () => {
    const pot = await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' });
    await item({ stock_draws: [{ stock_item_id: pot.stock_item_id, quantity_per_sale_unit: 500 }] });
    const before = await versions();
    const changed = await patch(pot.stock_item_id, { expected_version: pot.version, stock_unit: 'ml' });
    expect(changed.statusCode, changed.body).toBe(200);
    // tenant-wide check, lock, drawers read, update, audit, 2 bump
    expect(counter.count).toBe(7);
    const ml = changed.json().data.stock_item;
    expect(ml).toMatchObject({ stock_item_id: pot.stock_item_id, stock_unit: 'ml' });
    expect(ml.version).not.toBe(pot.version);
    expect(await versions()).toEqual(before.map((v) => v + 1));
    expect((await auditRows()).at(-1)).toMatchObject({
      action: 'update',
      branch_id: null,
      before: expect.objectContaining({ stock_unit: 'g' }),
      after: expect.objectContaining({ stock_unit: 'ml' }),
    });

    const gravy = await createStockItem(cloud, f, { name: 'Gravy', stock_unit: 'g' });
    const grams = await item({ name: 'Gravy by weight', sale_unit: 'g', stock_draws: [{ stock_item_id: gravy.stock_item_id, quantity_per_sale_unit: 1 }] });
    const refused = await nothingWritten(() => patch(gravy.stock_item_id, { expected_version: gravy.version, stock_unit: 'ml' }), 422);
    expect(refused.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'stock_unit', reason: 'unit_mismatch' } });
    // to piece: the g drawer is not piece → 422 too
    expect((await nothingWritten(() => patch(gravy.stock_item_id, { expected_version: gravy.version, stock_unit: 'piece' }), 422)).error).toMatchObject({
      details: { field: 'stock_unit', reason: 'unit_mismatch' },
    });
    // only active drawers count
    await archiveItem(grams.item_id);
    const fine = await patch(gravy.stock_item_id, { expected_version: gravy.version, stock_unit: 'ml' });
    expect(fine.statusCode, fine.body).toBe(200);
  });

  it('[01c #30] archive with an active drawer → 409 CONFIG_IN_USE menu_item; drawer archived → 200 archive; restore → 200 restore', async () => {
    const pot = await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' });
    const half = await item({ stock_draws: [{ stock_item_id: pot.stock_item_id, quantity_per_sale_unit: 500 }] });
    const full = await item({ name: 'Chicken Karahi Full', stock_draws: [{ stock_item_id: pot.stock_item_id, quantity_per_sale_unit: 1000 }] });
    const refused = await nothingWritten(() => patch(pot.stock_item_id, { expected_version: pot.version, archived: true }), 409);
    expect(refused.error).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { entity: 'stock_item', id: pot.stock_item_id, used_by: { entity: 'menu_item', ids: [half.item_id, full.item_id].sort() } },
    });

    await archiveItem(half.item_id);
    await archiveItem(full.item_id);
    const archived = await patch(pot.stock_item_id, { expected_version: pot.version, archived: true });
    expect(archived.statusCode, archived.body).toBe(200);
    const wire = archived.json().data.stock_item;
    expect(wire.archived_at).toEqual(expect.any(Number));
    expect((await auditRows()).at(-1)).toMatchObject({ action: 'archive' });
    // the draws stay (no cascade)
    expect((await cloud.pool.query(`SELECT count(*)::int AS n FROM stock_draws WHERE stock_item_id = $1`, [pot.stock_item_id])).rows[0]).toEqual({ n: 2 });

    const restored = await patch(pot.stock_item_id, { expected_version: wire.version, archived: false, name: 'Karahi pot 2' });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().data.stock_item).toMatchObject({ archived_at: null, name: 'Karahi pot 2' });
    // C5: the state action, not update
    expect((await auditRows()).at(-1)).toMatchObject({ action: 'restore' });
  });

  it('[01c #35] list: 4 statements; branch rows only for allowed branches; drawers listed (active items only); by lower(name)', async () => {
    const [a, b] = f.branches;
    const pot = await createStockItem(cloud, f, { name: 'karahi pot', stock_unit: 'g' });
    const naan = await createStockItem(cloud, f, { name: 'Naan', stock_unit: 'piece', carries_over: true });
    const old = await createStockItem(cloud, f, { name: 'Old pot', stock_unit: 'ml' }, { archived: true });
    // the counted rows through §6.9 (one at the allowed A, one at C, outside the list's token)
    const [, , c] = f.branches;
    await cloud.pool.query(
      `INSERT INTO stations (tenant_id, branch_id, station_id, name, station_type, capacity, created_at, updated_at)
       VALUES ($1, $2, 'ST-C', 'Karahi', 'slot', 4, 0, 0)`,
      [f.tenantId, c],
    );
    const noRowVersion = (branchId: string) => stockItemBranchVersion(pot.stock_item_id, branchId, null).version;
    await putStockItemBranch(cloud, f, pot.stock_item_id, a, { expected_version: noRowVersion(a), station_id: 'ST-1', low_stock_threshold: 2000 });
    await putStockItemBranch(cloud, f, pot.stock_item_id, c, { expected_version: noRowVersion(c), station_id: 'ST-C' });
    const group = await createVariantGroup(cloud, f, { name: 'Chicken Karahi', category_id: menu.categoryIds[0] });
    const half = await item({
      name: 'Chicken Karahi Half',
      variant_group_id: group.variant_group_id,
      variant_name: 'Half',
      stock_draws: [{ stock_item_id: pot.stock_item_id, quantity_per_sale_unit: 500 }],
    });
    const gone = await item({ name: 'Chicken Karahi Full', stock_draws: [{ stock_item_id: pot.stock_item_id, quantity_per_sale_unit: 1000 }] });
    await archiveItem(gone.item_id);
    const plate = await item({ name: 'bread plate', stock_draws: [{ stock_item_id: naan.stock_item_id, quantity_per_sale_unit: 1 }] });
    const basket = await item({ name: 'Bread basket', stock_draws: [{ stock_item_id: naan.stock_item_id, quantity_per_sale_unit: 1 }] });

    const response = await list('', f.tokenFor([a, b]));
    expect(response.statusCode, response.body).toBe(200);
    expect(counter.count).toBe(4);
    const data = response.json().data;
    expect(data.can_edit_tenant).toBe(true);
    const noRow = (branchId: string) => ({ branch_id: branchId, station_id: null, low_stock_threshold: null, version: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(data.stock_items).toEqual([
      {
        ...pot,
        branches: [
          { branch_id: a, station_id: 'ST-1', low_stock_threshold: 2000, version: expect.stringMatching(/^[0-9a-f]{64}$/) },
          noRow(b),
        ].sort((x, y) => (x.branch_id < y.branch_id ? -1 : 1)),
        drawers: [{ item_id: half.item_id, name: 'Chicken Karahi Half', variant_name: 'Half', quantity_per_sale_unit: 500 }],
      },
      {
        ...naan,
        branches: [noRow(a), noRow(b)].sort((x, y) => (x.branch_id < y.branch_id ? -1 : 1)),
        drawers: [
          { item_id: basket.item_id, name: 'Bread basket', variant_name: null, quantity_per_sale_unit: 1 },
          { item_id: plate.item_id, name: 'bread plate', variant_name: null, quantity_per_sale_unit: 1 },
        ],
      },
    ]);
    // the counted row and the no-row versions differ; the no-row versions differ per branch
    const potBranches = data.stock_items[0].branches as Array<{ branch_id: string; version: string }>;
    expect(new Set(potBranches.map((x) => x.version)).size).toBe(2);
    expect(data.stock_items[0].branches.map((x: { branch_id: string }) => x.branch_id)).not.toContain(c);

    const archived = await list('?status=archived');
    expect(archived.statusCode).toBe(200);
    expect(counter.count).toBe(4);
    expect(archived.json().data.stock_items).toEqual([
      { ...old, branches: [...f.branches].sort().map((id) => noRow(id)), drawers: [] },
    ]);
    expect((await list('?status=gone')).statusCode).toBe(400);

    // an empty list is still 4 statements; can_edit_tenant from the owner row
    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [f.tenantId, f.userId, [a]]);
    await cloud.pool.query(`UPDATE stock_items SET archived_at = 5 WHERE tenant_id = $1`, [f.tenantId]);
    const empty = await list();
    expect(empty.statusCode).toBe(200);
    expect(counter.count).toBe(4);
    expect(empty.json().data).toEqual({ can_edit_tenant: false, stock_items: [] });
  });

  it('[01c §6.8] stale → 409 CONFIG_STALE stock_item (a stale no-op too); body only expected_version → 400; unknown or foreign id → 404', async () => {
    const pot = await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' });
    const renamed = await patch(pot.stock_item_id, { expected_version: pot.version, name: 'Pot' });
    expect(renamed.statusCode, renamed.body).toBe(200);
    for (const body of [
      { expected_version: pot.version, name: 'Pot 2' },
      { expected_version: pot.version, name: 'Pot' }, // would be a no-op
    ]) {
      const stale = await nothingWritten(() => patch(pot.stock_item_id, body), 409);
      expect(stale.error).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'stock_item', id: pot.stock_item_id } });
    }
    const versionOnly = await nothingWritten(() => patch(pot.stock_item_id, { expected_version: pot.version }), 400);
    expect(versionOnly.error.code).toBe('VALIDATION_FAILED');
    expect((await nothingWritten(() => patch(pot.stock_item_id, { expected_version: pot.version, stock_unit: 'kg' }), 400)).error.code).toBe(
      'VALIDATION_FAILED',
    );

    // tenant B's own stock item, through the API with B's token
    const theirs = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/stock-items',
      ...owner(f, f.other.token),
      payload: { name: 'Their pot', stock_unit: 'g' },
    });
    expect(theirs.statusCode, theirs.body).toBe(201);
    for (const id of ['NO-SUCH', theirs.json().data.stock_item.stock_item_id as string]) {
      const missing = await nothingWritten(() => patch(id, { expected_version: 'x', name: 'Mine' }), 404);
      expect(missing.error).toMatchObject({ code: 'STOCK_ITEM_NOT_FOUND', details: { stock_item_id: id } });
    }
  });

  it('[01c §6.8] no-op → 200 with the stored item, no audit, no bump; R3 name taken → 409; carries_over edit audited', async () => {
    const pot = await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' });
    await createStockItem(cloud, f, { name: 'Naan', stock_unit: 'piece' });
    const same = { expected_version: pot.version, name: 'Karahi pot', stock_unit: 'g', carries_over: false, archived: false };
    const direct = await patch(pot.stock_item_id, same);
    expect(direct.statusCode, direct.body).toBe(200);
    // tenant-wide check, lock
    expect(counter.count).toBe(2);
    const noOp = await nothingWritten(() => patch(pot.stock_item_id, same), 200);
    expect(noOp.data?.stock_item).toEqual(pot);

    const taken = await nothingWritten(() => patch(pot.stock_item_id, { expected_version: pot.version, name: 'NAAN' }), 409);
    expect(taken.error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'stock_item' } });

    const edited = await patch(pot.stock_item_id, { expected_version: pot.version, carries_over: true });
    expect(edited.statusCode, edited.body).toBe(200);
    // tenant-wide check, lock, update, audit, 2 bump (no drawers read without a unit change or an archive)
    expect(counter.count).toBe(6);
    expect(edited.json().data.stock_item).toMatchObject({ carries_over: true });
    expect((await auditRows()).at(-1)).toMatchObject({
      action: 'update',
      before: expect.objectContaining({ carries_over: false }),
      after: expect.objectContaining({ carries_over: true }),
    });
  });

  it('[01c §6 C4] an owner row missing a branch → 403 tenant_wide_write before 404, 409, 422 and the no-op; nothing written', async () => {
    const pot = await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' });
    await createStockItem(cloud, f, { name: 'Naan', stock_unit: 'piece' });
    await item({ name: 'Gravy', sale_unit: 'g', stock_draws: [{ stock_item_id: pot.stock_item_id, quantity_per_sale_unit: 1 }] });
    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      f.tenantId,
      f.userId,
      [f.branches[0]],
    ]);
    const writes = [
      () => post({ name: 'Raita', stock_unit: 'g' }),
      () => post({ name: 'naan', stock_unit: 'g' }), // else 409 name
      () => patch('NO-SUCH', { expected_version: 'x', name: 'A' }), // else 404
      () => patch(pot.stock_item_id, { expected_version: 'stale', name: 'A' }), // else 409 stale
      () => patch(pot.stock_item_id, { expected_version: pot.version, name: 'NAAN' }), // else 409 name
      () => patch(pot.stock_item_id, { expected_version: pot.version, stock_unit: 'ml' }), // else 422
      () => patch(pot.stock_item_id, { expected_version: pot.version, archived: true }), // else 409 in use
      () => patch(pot.stock_item_id, { expected_version: pot.version, name: 'Karahi pot' }), // else no-op 200
    ];
    for (const write of writes) {
      const body = await nothingWritten(write, 403);
      expect(body.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'tenant_wide_write' } });
    }
    const keys = await cloud.pool.query(`SELECT count(*)::int AS n FROM idempotency_keys WHERE route = 'POST /v1/admin/stock-items'`);
    expect(keys.rows[0]).toEqual({ n: 2 }); // only the creates above; the refused POSTs stored no key
  });
});
