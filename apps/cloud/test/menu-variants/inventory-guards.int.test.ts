import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { patchStockItem, putStockItemBranch } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { inventoryFixture, stockItem, type InventoryFixture } from '../inventory/fixtures';

// 08a I9 at the 01c writes: the sent draw (C-3, 01c §6.4 / §6.5), the stored draw R9b (C-9, 01c §6.5) and the
// branch-row set (C-4, 01c §6.9) all need a `prepared` stock item, read in the existing FOR SHARE / FOR UPDATE
// statement (+0 statements).
type Reply = { statusCode: number; body: string; json(): unknown };
type ErrorBody = { error: { code: string; details?: unknown } };
// 01c §6.5: a name + sent prepared draw PATCH of an item with routes (unchanged by C-3 / C-9).
const PATCH_PREPARED_DRAW = 13;

describe('08a I9 guards on 01c writes (C-3, C-4, C-9)', () => {
  let cloud: TestCloud;
  let fx: InventoryFixture;
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
    fx = await inventoryFixture(cloud);
  });

  const wrongKind = (field: string) => ({ code: 'CONFIG_REFERENCE_INVALID', details: { field, reason: 'wrong_kind' } });
  const drawField = 'stock_draws.0.stock_item_id';
  const postItem = (name: string, stockItemId: string) =>
    cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/menu-items',
      ...owner(fx.f),
      payload: {
        category_id: fx.menu.categoryIds[0],
        tax_class_id: null,
        name,
        price_minor: 50000,
        serve_mode: 'sync',
        cook_time_ms: 600_000,
        routes: [{ branch_id: fx.lakeCity, station_id: fx.menu.slotStationId }],
        stock_draws: [{ stock_item_id: stockItemId, quantity_per_sale_unit: 1 }],
      },
    });
  const patchItem = (itemId: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/menu-items/${itemId}`, ...owner(fx.f), payload });
  const putBranch = (stockItemId: string, payload: object) =>
    cloud.app.inject({ method: 'PUT', url: `/v1/admin/stock-items/${stockItemId}/branches/${fx.lakeCity}`, ...owner(fx.f), payload });
  const branchVersion = async (stockItemId: string) => {
    const wire = await stockItem(cloud, fx.f, stockItemId);
    const row = (wire as unknown as { branches: Array<{ branch_id: string; version: string }> }).branches.find(
      (b) => b.branch_id === fx.lakeCity,
    );
    if (row === undefined) throw new Error('no branch entry');
    return row.version;
  };
  const archiveStockItem = async (stockItemId: string) => {
    const wire = await stockItem(cloud, fx.f, stockItemId);
    await patchStockItem(cloud, fx.f, stockItemId, { expected_version: wire.version, archived: true });
  };

  const snapshot = async () => {
    const q = async (sql: string) => (await cloud.pool.query(sql, [fx.f.tenantId])).rows;
    return {
      items: await q(`SELECT * FROM menu_items WHERE tenant_id = $1 ORDER BY item_id`),
      draws: await q(`SELECT * FROM stock_draws WHERE tenant_id = $1 ORDER BY item_id, stock_item_id`),
      stock: await q(`SELECT * FROM stock_items WHERE tenant_id = $1 ORDER BY stock_item_id`),
      branchRows: await q(`SELECT * FROM stock_item_branches WHERE tenant_id = $1 ORDER BY branch_id, stock_item_id`),
      audit: await q(`SELECT audit_id FROM config_audit WHERE tenant_id = $1 ORDER BY audit_id`),
      versions: await q(`SELECT branch_id, config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`),
    };
  };
  // The call answers `status` and writes nothing; returns the error body and the call's own statement count.
  const nothingWritten = async (call: () => Promise<Reply>, status: number) => {
    const before = await snapshot();
    const response = await call();
    const statements = counter.count;
    expect(response.statusCode, response.body).toBe(status);
    expect(await snapshot()).toEqual(before);
    return { error: (response.json() as ErrorBody).error, statements };
  };
  const ok = async (call: () => Promise<Reply>, status = 200) => {
    const response = await call();
    const statements = counter.count;
    expect(response.statusCode, response.body).toBe(status);
    return statements;
  };
  // 19 setup: PAYE-COOKED loses its Lake City row, Paye Half is archived, then PAYE-COOKED becomes an ingredient.
  const payeCookedToIngredient = async () => {
    await putStockItemBranch(cloud, fx.f, fx.ids.payeCooked, fx.lakeCity, {
      expected_version: await branchVersion(fx.ids.payeCooked),
      station_id: null,
    });
    await ok(() => patchItem(fx.payeHalfItemId, { archived: true }));
    const wire = await stockItem(cloud, fx.f, fx.ids.payeCooked);
    const changed = await patchStockItem(cloud, fx.f, fx.ids.payeCooked, {
      expected_version: wire.version,
      kind: 'ingredient',
      carries_over: false,
    });
    expect(changed.kind).toBe('ingredient');
  };

  it('[08a #15] item POST with a sent draw onto an ingredient or packet → 422 wrong_kind, nothing written; statements as the draw’s not_found', async () => {
    const prepared = await ok(() => postItem('Paye Full', fx.ids.payeCooked), 201);
    expect(prepared).toBe(14); // 01c §6.4: 12 plain + stock item FOR SHARE + draw insert (unchanged by C-3)
    const missing = await nothingWritten(() => postItem('Beef plate', 'NO-SUCH'), 422);
    expect(missing.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: drawField, reason: 'not_found' } });
    for (const stockItemId of [fx.ids.beef, fx.ids.tp1]) {
      const refused = await nothingWritten(() => postItem('Beef plate', stockItemId), 422);
      expect(refused.error).toMatchObject(wrongKind(drawField));
      expect(refused.statements).toBe(missing.statements);
    }
    // a POST is always active: an archived ingredient answers archived first (P-1)
    await archiveStockItem(fx.ids.ghee);
    const archived = await nothingWritten(() => postItem('Ghee plate', fx.ids.ghee), 422);
    expect(archived.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: drawField, reason: 'archived' } });
  });

  it('[08a #15] item PATCH with a sent draw onto an ingredient → 422 wrong_kind, nothing written; statements as the draw’s not_found', async () => {
    const send = (stockItemId: string) => () =>
      patchItem(fx.payeHalfItemId, { name: 'Paye Half plate', stock_draws: [{ stock_item_id: stockItemId, quantity_per_sale_unit: 1 }] });
    const missing = await nothingWritten(send('NO-SUCH'), 422);
    expect(missing.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: drawField, reason: 'not_found' } });
    const refused = await nothingWritten(send(fx.ids.beef), 422);
    expect(refused.error).toMatchObject(wrongKind(drawField));
    expect(refused.statements).toBe(missing.statements);
    const prepared = await ok(send(fx.ids.payeCooked));
    expect(prepared).toBe(PATCH_PREPARED_DRAW);
  });

  it('[08a #15 (a)] an archived item’s PATCH sending a draw onto an ingredient → wrong_kind; onto an archived ingredient → wrong_kind', async () => {
    await ok(() => patchItem(fx.payeHalfItemId, { archived: true }));
    const send = (stockItemId: string) => () =>
      patchItem(fx.payeHalfItemId, { stock_draws: [{ stock_item_id: stockItemId, quantity_per_sale_unit: 1 }] });
    expect((await nothingWritten(send(fx.ids.beef), 422)).error).toMatchObject(wrongKind(drawField));
    await archiveStockItem(fx.ids.ghee);
    expect((await nothingWritten(send(fx.ids.ghee), 422)).error).toMatchObject(wrongKind(drawField));
  });

  it('[08a #15 (b)] an active item whose stored draw points at an ingredient (raw SQL) → PATCH name only → 422 wrong_kind, nothing written (R9b)', async () => {
    await cloud.pool.query(`UPDATE stock_draws SET stock_item_id = $3 WHERE tenant_id = $1 AND item_id = $2`, [
      fx.f.tenantId,
      fx.payeHalfItemId,
      fx.ids.beef,
    ]);
    const refused = await nothingWritten(() => patchItem(fx.payeHalfItemId, { name: 'Paye Half plate' }), 422);
    expect(refused.error).toMatchObject(wrongKind(drawField));

    // +0 statements: R9b refuses after the same statements as R2 (unit_mismatch) on the same name-only PATCH; no rule
    // between R2 and R9b reads on this path (R9 is restore-only, so an archived prepared stored draw would answer 200).
    const setDraw = (stockItemId: string, quantity: number) =>
      cloud.pool.query(
        `UPDATE stock_draws SET stock_item_id = $3, quantity_per_sale_unit = $4 WHERE tenant_id = $1 AND item_id = $2`,
        [fx.f.tenantId, fx.payeHalfItemId, stockItemId, quantity],
      );
    await setDraw(fx.ids.payeCooked, 2); // piece → piece needs 1 (01c V4)
    const r2 = await nothingWritten(() => patchItem(fx.payeHalfItemId, { name: 'Paye Half plate' }), 422);
    expect(r2.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: drawField, reason: 'unit_mismatch' } });
    expect(refused.statements).toBe(r2.statements);

    // R9b does not run when stock_draws is sent: clearing the wrong-kind draw answers 200 and removes it
    await setDraw(fx.ids.beef, 1);
    await ok(() => patchItem(fx.payeHalfItemId, { stock_draws: [] }));
    const left = await cloud.pool.query(`SELECT 1 FROM stock_draws WHERE tenant_id = $1 AND item_id = $2`, [fx.f.tenantId, fx.payeHalfItemId]);
    expect(left.rowCount).toBe(0);
  });

  it('[08a #16] branch PUT set on a packet or an ingredient → 422 wrong_kind (after archived); remove on any kind → 200', async () => {
    const set = { expected_version: '', station_id: fx.menu.slotStationId, low_stock_threshold: null };
    const fresh = (id: string) => branchVersion(id);
    const archivedCheck = await (async () => {
      await archiveStockItem(fx.ids.ghee);
      const r = await nothingWritten(async () => putBranch(fx.ids.ghee, { ...set, expected_version: await fresh(fx.ids.ghee) }), 422);
      expect(r.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'stock_item_id', reason: 'archived' } });
      return r.statements;
    })();
    for (const id of [fx.ids.tp1, fx.ids.beef]) {
      const version = await fresh(id);
      const refused = await nothingWritten(() => putBranch(id, { ...set, expected_version: version }), 422);
      expect(refused.error).toMatchObject(wrongKind('stock_item_id'));
      expect(refused.statements).toBe(archivedCheck);
    }
    // remove with no row on a packet → 200 { branch: null }
    const none = await fresh(fx.ids.tp1);
    const removeNone = await putBranch(fx.ids.tp1, { expected_version: none, station_id: null });
    expect(removeNone.statusCode, removeNone.body).toBe(200);
    expect((removeNone.json() as { data: { branch: unknown } }).data.branch).toBeNull();
    // a raw-SQL row on a packet (constraint bypass) can always be removed
    await cloud.pool.query(
      `INSERT INTO stock_item_branches (tenant_id, branch_id, stock_item_id, station_id, low_stock_threshold, updated_at)
       VALUES ($1, $2, $3, $4, NULL, 0)`,
      [fx.f.tenantId, fx.lakeCity, fx.ids.tp1, fx.menu.slotStationId],
    );
    const version = await fresh(fx.ids.tp1);
    const removed = await ok(() => putBranch(fx.ids.tp1, { expected_version: version, station_id: null }));
    expect(removed).toBe(6); // 01c #33 remove count, unchanged
    const left = await cloud.pool.query(`SELECT 1 FROM stock_item_branches WHERE tenant_id = $1 AND stock_item_id = $2`, [
      fx.f.tenantId,
      fx.ids.tp1,
    ]);
    expect(left.rowCount).toBe(0);
    // a set on a prepared item still answers 200 in 7 statements (01c #31)
    await putStockItemBranch(cloud, fx.f, fx.ids.payeCooked, fx.lakeCity, { expected_version: await fresh(fx.ids.payeCooked), station_id: null });
    const setCount = await ok(async () => putBranch(fx.ids.payeCooked, { ...set, expected_version: await fresh(fx.ids.payeCooked) }));
    expect(setCount).toBe(7);
  });

  it('[08a #19] archived Paye Half draws from PAYE-COOKED (no branch row) → kind ingredient 200 → restore → 422 wrong_kind, nothing written; archived + ingredient → archived first (R9 before R9b), same statements', async () => {
    await payeCookedToIngredient();
    const kind = await nothingWritten(() => patchItem(fx.payeHalfItemId, { archived: false }), 422);
    expect(kind.error).toMatchObject(wrongKind(drawField));
    await archiveStockItem(fx.ids.payeCooked);
    const archived = await nothingWritten(() => patchItem(fx.payeHalfItemId, { archived: false }), 422);
    expect(archived.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: drawField, reason: 'archived' } });
    // R9b reads kind from the row R9 reads (the existing FOR SHARE): +0 statements
    expect(kind.statements).toBe(archived.statements);
  });
});
