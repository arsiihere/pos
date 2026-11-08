import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stockItemBranchVersion } from '../../src/modules/menu-variants/versions';
import { createStockItem, patchStockItem, putStockItemBranch } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

// 01c §6.9: a stock item counted at a branch (PUT, versioned, that branch bumped); V16: a station is in use while
// an active stock item is counted there (P-10).
describe('01c stock item branch rows (§6.9, V16)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
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
    await seedMenu(cloud.pool, f, { items: 1 });
    // a station at branch A that no item routes to (ST-1 has routes), and an archived one
    await cloud.pool.query(
      `INSERT INTO stations (tenant_id, branch_id, station_id, point_id, name, station_type, capacity, archived_at, created_at, updated_at)
       VALUES ($1, $2, 'ST-K', (SELECT point_id FROM points WHERE tenant_id = $1 AND branch_id = $2 AND name = 'Pass'), 'Karahi pots', 'slot', 4, NULL, 0, 0), ($1, $2, 'ST-X', (SELECT point_id FROM points WHERE tenant_id = $1 AND branch_id = $2 AND name = 'Pass'), 'Old grill', 'slot', 4, 7, 0, 0)`,
      [f.tenantId, f.branches[0]],
    );
  });

  const put = (stockItemId: string, branchId: string, payload: object, token?: string) =>
    cloud.app.inject({ method: 'PUT', url: `/v1/admin/stock-items/${stockItemId}/branches/${branchId}`, ...owner(f, token), payload });
  const archiveStation = (stationId: string) =>
    cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/branches/${f.branches[0]}/stations/${stationId}`,
      ...owner(f),
      payload: { archived: true },
    });
  const noRow = (stockItemId: string, branchId: string) => stockItemBranchVersion(stockItemId, branchId, null).version;
  const versions = async () =>
    (
      await cloud.pool.query<{ config_version: string }>(`SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`, [
        f.tenantId,
      ])
    ).rows.map((row) => Number(row.config_version));
  // f.branches in branch_id order, to read versions() by branch
  const bumpedOnly = (before: number[], branchId: string) => {
    const order = [...f.branches].sort();
    return before.map((v, i) => (order[i] === branchId ? v + 1 : v));
  };
  const auditRows = async () =>
    (
      await cloud.pool.query<{ entity: string; entity_id: string; branch_id: string | null; action: string; before: unknown; after: unknown }>(
        `SELECT entity, entity_id, branch_id, action, before, after FROM config_audit WHERE tenant_id = $1 ORDER BY at, audit_id`,
        [f.tenantId],
      )
    ).rows;
  const storedRows = async () =>
    (
      await cloud.pool.query(
        `SELECT branch_id, stock_item_id, station_id, low_stock_threshold FROM stock_item_branches ORDER BY branch_id, stock_item_id`,
      )
    ).rows;
  // Asserts the call answers `status` and changes no branch row, audit row or config version. `statements` is the
  // call's own statement count (taken before the after-reads).
  let statements = 0;
  const nothingWritten = async (call: () => Promise<{ statusCode: number; body: string; json(): unknown }>, status: number) => {
    const before = { rows: await storedRows(), audit: await auditRows(), versions: await versions() };
    const response = await call();
    statements = counter.count;
    expect(response.statusCode, response.body).toBe(status);
    expect({ rows: await storedRows(), audit: await auditRows(), versions: await versions() }).toEqual(before);
    return response.json() as { data?: { branch: unknown }; error: { code: string; details?: unknown } };
  };

  it('[01c #31] PUT counted at A, station Karahi → row, audit branch_set with branch_id, only A bumped', async () => {
    const [a] = f.branches;
    const pot = await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' });
    const before = await versions();
    const auditBefore = (await auditRows()).length;
    const response = await put(pot.stock_item_id, a, { expected_version: noRow(pot.stock_item_id, a), station_id: 'ST-K', low_stock_threshold: 2000 });
    expect(response.statusCode, response.body).toBe(200);
    // stock item lock, branch read, stored row read, station FOR SHARE, upsert, audit, bump
    expect(counter.count).toBe(7);
    const branch = response.json().data.branch;
    expect(branch).toEqual({ branch_id: a, station_id: 'ST-K', low_stock_threshold: 2000, version: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(branch.version).not.toBe(noRow(pot.stock_item_id, a));
    expect(await storedRows()).toEqual([{ branch_id: a, stock_item_id: pot.stock_item_id, station_id: 'ST-K', low_stock_threshold: 2000 }]);
    expect(await versions()).toEqual(bumpedOnly(before, a));
    const audit = (await auditRows()).slice(auditBefore);
    expect(audit).toEqual([
      {
        entity: 'stock_item_branch',
        entity_id: pot.stock_item_id,
        branch_id: a,
        action: 'branch_set',
        before: null,
        after: { station_id: 'ST-K', low_stock_threshold: 2000 },
      },
    ]);

    // the list shows the same entry and version
    const list = await cloud.app.inject({ method: 'GET', url: '/v1/admin/stock-items', ...owner(f) });
    expect(list.json().data.stock_items[0].branches.find((b: { branch_id: string }) => b.branch_id === a)).toEqual(branch);

    // a change with the returned version: branch_set again, before / after
    const changed = await put(pot.stock_item_id, a, { expected_version: branch.version, station_id: 'ST-K' });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().data.branch).toMatchObject({ station_id: 'ST-K', low_stock_threshold: null });
    expect((await auditRows()).at(-1)).toMatchObject({
      action: 'branch_set',
      branch_id: a,
      before: { station_id: 'ST-K', low_stock_threshold: 2000 },
      after: { station_id: 'ST-K', low_stock_threshold: null },
    });
    expect(await versions()).toEqual(bumpedOnly(bumpedOnly(before, a), a));
  });

  it('[01c #32] a branch outside allowed_branch_ids / another tenant’s → 404 BRANCH_NOT_FOUND; station of another branch → 422 wrong_branch', async () => {
    const [a, b, c] = f.branches;
    const pot = await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' });
    // C2: tenant A's own stock item, a branch of tenant A outside the token's allowed branches
    for (const [branchId, token] of [
      [c, f.tokenFor([a, b])],
      [f.other.branchId, undefined],
      ['NO-SUCH', undefined],
    ] as const) {
      const missing = await nothingWritten(
        () => put(pot.stock_item_id, branchId, { expected_version: noRow(pot.stock_item_id, branchId), station_id: 'ST-K' }, token),
        404,
      );
      expect(missing.error).toMatchObject({ code: 'BRANCH_NOT_FOUND', details: { branch_id: branchId } });
    }
    // a removal is checked too
    expect(
      (await nothingWritten(() => put(pot.stock_item_id, c, { expected_version: noRow(pot.stock_item_id, c), station_id: null }, f.tokenFor([a])), 404))
        .error.code,
    ).toBe('BRANCH_NOT_FOUND');

    const wrong = await nothingWritten(() => put(pot.stock_item_id, a, { expected_version: noRow(pot.stock_item_id, a), station_id: 'ST-B' }), 422);
    expect(wrong.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'station_id', reason: 'wrong_branch' } });
    for (const [stationId, reason] of [
      ['NO-SUCH', 'not_found'],
      ['ST-X', 'archived'],
    ] as const) {
      const refused = await nothingWritten(() => put(pot.stock_item_id, a, { expected_version: noRow(pot.stock_item_id, a), station_id: stationId }), 422);
      expect(refused.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'station_id', reason } });
    }
  });

  it('[01c #33] station_id null removes (audit branch_removed); removing a missing row → 200 { branch: null }, no audit, no bump', async () => {
    const [a, b] = f.branches;
    const pot = await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' });
    const counted = await putStockItemBranch(cloud, f, pot.stock_item_id, a, {
      expected_version: noRow(pot.stock_item_id, a),
      station_id: 'ST-K',
      low_stock_threshold: 500,
    });
    const before = await versions();
    const removed = await put(pot.stock_item_id, a, { expected_version: counted!.version, station_id: null });
    expect(removed.statusCode, removed.body).toBe(200);
    // stock item lock, branch read, stored row read, delete, audit, bump
    expect(counter.count).toBe(6);
    expect(removed.json()).toEqual({ data: { branch: null } });
    expect(await storedRows()).toEqual([]);
    expect(await versions()).toEqual(bumpedOnly(before, a));
    expect((await auditRows()).at(-1)).toEqual({
      entity: 'stock_item_branch',
      entity_id: pot.stock_item_id,
      branch_id: a,
      action: 'branch_removed',
      before: { station_id: 'ST-K', low_stock_threshold: 500 },
      after: null,
    });

    // the row is gone: the no-row version is current again
    for (const branchId of [a, b]) {
      const missing = await nothingWritten(() => put(pot.stock_item_id, branchId, { expected_version: noRow(pot.stock_item_id, branchId), station_id: null }), 200);
      expect(missing).toEqual({ data: { branch: null } });
      // stock item lock, branch read, stored row read
      expect(statements).toBe(3);
    }
  });

  it('[01c #34] archive station Karahi with a counted stock item → 409 CONFIG_IN_USE stock_item; row removed → 200', async () => {
    const [a] = f.branches;
    const pot = await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' });
    const naan = await createStockItem(cloud, f, { name: 'Naan dough', stock_unit: 'piece' });
    const potRow = await putStockItemBranch(cloud, f, pot.stock_item_id, a, { expected_version: noRow(pot.stock_item_id, a), station_id: 'ST-K' });
    await putStockItemBranch(cloud, f, naan.stock_item_id, a, { expected_version: noRow(naan.stock_item_id, a), station_id: 'ST-K' });
    const refused = await nothingWritten(() => archiveStation('ST-K'), 409);
    expect(refused.error).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { entity: 'station', id: 'ST-K', used_by: { entity: 'stock_item', ids: [pot.stock_item_id, naan.stock_item_id].sort() } },
    });

    await putStockItemBranch(cloud, f, pot.stock_item_id, a, { expected_version: potRow!.version, station_id: null });
    const still = await nothingWritten(() => archiveStation('ST-K'), 409);
    expect(still.error).toMatchObject({ details: { used_by: { entity: 'stock_item', ids: [naan.stock_item_id] } } });
    await putStockItemBranch(cloud, f, naan.stock_item_id, a, {
      expected_version: stockItemBranchVersion(naan.stock_item_id, a, { station_id: 'ST-K', low_stock_threshold: null }).version,
      station_id: null,
    });
    const archived = await archiveStation('ST-K');
    expect(archived.statusCode, archived.body).toBe(200);
  });

  it('[01c V16 P-10] station archive with only a row of an archived stock item → 200; with the stock item active → 409', async () => {
    const [a] = f.branches;
    const pot = await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' });
    await putStockItemBranch(cloud, f, pot.stock_item_id, a, { expected_version: noRow(pot.stock_item_id, a), station_id: 'ST-K' });
    const refused = await nothingWritten(() => archiveStation('ST-K'), 409);
    expect(refused.error).toMatchObject({ code: 'CONFIG_IN_USE', details: { used_by: { entity: 'stock_item', ids: [pot.stock_item_id] } } });

    await patchStockItem(cloud, f, pot.stock_item_id, { expected_version: pot.version, archived: true });
    const archived = await archiveStation('ST-K');
    expect(archived.statusCode, archived.body).toBe(200);
    // the row stays (no cascade)
    expect(await storedRows()).toEqual([{ branch_id: a, stock_item_id: pot.stock_item_id, station_id: 'ST-K', low_stock_threshold: null }]);
  });

  it('[01c §6.9] a threshold with station_id null → 400; an archived stock item on a set → 422; stale → 409 stock_item_branch; unknown → 404; no-op → 200', async () => {
    const [a] = f.branches;
    const pot = await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' });
    const version = noRow(pot.stock_item_id, a);
    for (const body of [
      { expected_version: version, station_id: null, low_stock_threshold: 5 },
      { expected_version: version, station_id: 'ST-K', low_stock_threshold: -1 },
      { expected_version: version, station_id: 'ST-K', low_stock_threshold: 1_000_001 },
      { expected_version: version },
      { station_id: 'ST-K' },
    ]) {
      expect((await nothingWritten(() => put(pot.stock_item_id, a, body), 400)).error.code, JSON.stringify(body)).toBe('VALIDATION_FAILED');
    }

    const missing = await nothingWritten(() => put('NO-SUCH', a, { expected_version: version, station_id: 'ST-K' }), 404);
    expect(missing.error).toMatchObject({ code: 'STOCK_ITEM_NOT_FOUND', details: { stock_item_id: 'NO-SUCH' } });

    const stale = await nothingWritten(() => put(pot.stock_item_id, a, { expected_version: 'x'.repeat(64), station_id: 'ST-K' }), 409);
    expect(stale.error).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'stock_item_branch', id: pot.stock_item_id } });

    const counted = await putStockItemBranch(cloud, f, pot.stock_item_id, a, { expected_version: version, station_id: 'ST-K', low_stock_threshold: 10 });
    // stale before the no-op: the old no-row version re-sending the stored row
    const staleNoOp = await nothingWritten(() => put(pot.stock_item_id, a, { expected_version: version, station_id: 'ST-K', low_stock_threshold: 10 }), 409);
    expect(staleNoOp.error.code).toBe('CONFIG_STALE');
    const noOp = await nothingWritten(() => put(pot.stock_item_id, a, { expected_version: counted!.version, station_id: 'ST-K', low_stock_threshold: 10 }), 200);
    expect(noOp.data?.branch).toEqual(counted);
    // stock item lock, branch read, stored row read, station FOR SHARE
    expect(statements).toBe(4);

    // archived stock item: a set → 422; a removal is still allowed
    const archivedPot = await patchStockItem(cloud, f, pot.stock_item_id, { expected_version: pot.version, archived: true });
    const refused = await nothingWritten(() => put(pot.stock_item_id, a, { expected_version: counted!.version, station_id: 'ST-K', low_stock_threshold: 11 }), 422);
    expect(refused.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'stock_item_id', reason: 'archived' } });
    expect(archivedPot.archived_at).not.toBeNull();
    const removed = await put(pot.stock_item_id, a, { expected_version: counted!.version, station_id: null });
    expect(removed.statusCode, removed.body).toBe(200);
  });

  it('[01c §6.9 M4] two first-time PUTs from tabs that both loaded "no row" → one 200, one 409 CONFIG_STALE', async () => {
    const [a] = f.branches;
    const pot = await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' });
    const version = noRow(pot.stock_item_id, a);
    const before = await versions();
    const results = await Promise.all([
      put(pot.stock_item_id, a, { expected_version: version, station_id: 'ST-K', low_stock_threshold: 1 }),
      put(pot.stock_item_id, a, { expected_version: version, station_id: 'ST-1', low_stock_threshold: 2 }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().error).toMatchObject({
      code: 'CONFIG_STALE',
      details: { entity: 'stock_item_branch', id: pot.stock_item_id },
    });
    const won = results.find((r) => r.statusCode === 200)!.json().data.branch;
    expect(await storedRows()).toEqual([
      { branch_id: a, stock_item_id: pot.stock_item_id, station_id: won.station_id, low_stock_threshold: won.low_stock_threshold },
    ]);
    expect(await versions()).toEqual(bumpedOnly(before, a));
  });
});
