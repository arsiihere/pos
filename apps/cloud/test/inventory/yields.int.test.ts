import type { InventoryDetail, YieldProfileWire } from '@pos/events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStockItem } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { inventoryFixture, type InventoryFixture } from './fixtures';

// 08a §6.7: POST /v1/admin/stock-items/:stock_item_id/yields — one form (yield_bp, or AP / EP in the item's stock
// unit), ingredient only (422 wrong_kind), test_unit = the locked stock unit, 9 fixed statements (⚠️ 08b P-1: was 7),
// bumps every branch (08b B16; was I11's no bump),
// audit yield_profile / create.
describe('08a yield profiles POST (§6.7)', () => {
  let cloud: TestCloud;
  let counter: ReturnType<typeof pgCounter>;

  beforeAll(async () => {
    cloud = await createTestCloud({ testHooks: { handlerStart: () => counter.reset() } });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });

  const post = (fx: InventoryFixture, stockItemId: string, payload: object, headers = owner(fx.f).headers) =>
    cloud.app.inject({ method: 'POST', url: `/v1/admin/stock-items/${stockItemId}/yields`, headers, payload });
  const created = async (fx: InventoryFixture, stockItemId: string, payload: object) => {
    const response = await post(fx, stockItemId, payload);
    expect(response.statusCode, response.body).toBe(201);
    return response.json().data.yield as YieldProfileWire;
  };
  const expect400 = (response: Awaited<ReturnType<typeof post>>) => {
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  };
  const yieldRows = async (fx: InventoryFixture) =>
    (await cloud.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM yield_profiles WHERE tenant_id = $1`, [fx.f.tenantId])).rows[0]!.n;

  it('[08a #35] both forms 400; neither 400; 6 000 % 400; out-of-range yield_bp 400', async () => {
    const fx = await inventoryFixture(cloud);
    expect400(await post(fx, fx.ids.beef, { yield_bp: 7120, test_ap_qty: 10_000, test_ep_qty: 7120 }));
    expect400(await post(fx, fx.ids.beef, {}));
    expect400(await post(fx, fx.ids.beef, { note: 'only a note' }));
    expect400(await post(fx, fx.ids.beef, { test_ap_qty: 10_000 }));
    expect400(await post(fx, fx.ids.beef, { test_ap_qty: 1000, test_ep_qty: 6000 })); // 60 000 bp > 50 000
    expect400(await post(fx, fx.ids.beef, { yield_bp: 0 }));
    expect400(await post(fx, fx.ids.beef, { yield_bp: 50_001 }));
    expect(await yieldRows(fx)).toBe(0);
  });

  it('[08a #35] on prepared (PAYE-COOKED) or packet (TP-1) 422 wrong_kind; archived 422 archived; unknown / foreign 404', async () => {
    const fx = await inventoryFixture(cloud);
    for (const id of [fx.ids.payeCooked, fx.ids.tp1]) {
      const response = await post(fx, id, { yield_bp: 7000 });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'stock_item_id', reason: 'wrong_kind' } });
    }
    const archived = await createStockItem(cloud, fx.f, { name: 'Old beef', stock_unit: 'g' }, { archived: true });
    await cloud.pool.query(`UPDATE stock_items SET kind = 'ingredient' WHERE tenant_id = $1 AND stock_item_id = $2`, [fx.f.tenantId, archived.stock_item_id]);
    const gone = await post(fx, archived.stock_item_id, { yield_bp: 7000 });
    expect(gone.statusCode, gone.body).toBe(422);
    expect(gone.json().error.details).toEqual({ field: 'stock_item_id', reason: 'archived' });

    await cloud.pool.query(
      `INSERT INTO stock_items (tenant_id, stock_item_id, name, stock_unit, carries_over, kind, created_at, updated_at)
       VALUES ($1, 'S-FOREIGN', 'Foreign beef', 'g', false, 'ingredient', 0, 0)`,
      [fx.f.other.tenantId],
    );
    for (const id of ['S-FOREIGN', 'NO-SUCH-ITEM']) {
      const response = await post(fx, id, { yield_bp: 7000 });
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json().error.code).toBe('STOCK_ITEM_NOT_FOUND');
    }
    // the owner's row decides (S8), not the JWT claim
    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [fx.f.tenantId, fx.f.userId, [fx.lakeCity]]);
    const narrow = await post(fx, fx.ids.beef, { yield_bp: 7000 });
    expect(narrow.statusCode, narrow.body).toBe(403);
    expect(narrow.json().error.details).toEqual({ reason: 'tenant_wide_write' });
    expect(await yieldRows(fx)).toBe(0);
  });

  it('[08a #35 ⚠️ 08b P-1] AP / EP stored with test_unit = the stock unit; 9 statements; audit yield_profile / create; bumps every branch; replay', async () => {
    const fx = await inventoryFixture(cloud);
    const versions = async () =>
      (await cloud.pool.query(`SELECT branch_id, config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`, [fx.f.tenantId])).rows;
    const before = await versions();
    const name = (
      await cloud.pool.query<{ display_name: string }>(`SELECT display_name FROM owner_users WHERE tenant_id = $1 AND user_id = $2`, [
        fx.f.tenantId,
        fx.f.userId,
      ])
    ).rows[0]!.display_name;

    // raw beef test: AP 10 000 g, EP 7 120 g → 7 120 bp
    const headers = owner(fx.f).headers;
    counter.reset();
    const response = await post(fx, fx.ids.beef, { test_ap_qty: 10_000, test_ep_qty: 7120, note: ' drill 1 ' }, headers);
    expect(counter.count).toBe(9); // ⚠️ 08b P-1: + 2 bump statements
    expect(response.statusCode, response.body).toBe(201);
    const y = response.json().data.yield as YieldProfileWire;
    expect(y).toEqual({
      yield_profile_id: y.yield_profile_id,
      yield_bp: 7120,
      test_ap_qty: '10000',
      test_ep_qty: '7120',
      test_unit: 'g',
      note: 'drill 1',
      recorded_by: fx.f.userId,
      recorded_by_name: name,
      created_at: cloud.clock.branchNow(),
    });
    const row = (await cloud.pool.query(`SELECT * FROM yield_profiles WHERE tenant_id = $1`, [fx.f.tenantId])).rows;
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({ stock_item_id: fx.ids.beef, yield_bp: 7120, test_unit: 'g', note: 'drill 1', recorded_by: fx.f.userId });
    expect([BigInt(String(row[0].test_ap_qty)), BigInt(String(row[0].test_ep_qty))]).toEqual([10_000n, 7120n]);
    const audit = await cloud.pool.query(
      `SELECT entity, entity_id, action, branch_id, actor_owner_user_id FROM config_audit WHERE tenant_id = $1 AND entity = 'yield_profile'`,
      [fx.f.tenantId],
    );
    expect(audit.rows).toEqual([{ entity: 'yield_profile', entity_id: y.yield_profile_id, action: 'create', branch_id: null, actor_owner_user_id: fx.f.userId }]);
    expect(await versions()).toEqual(before.map((row: { branch_id: string; config_version: string }) => ({ ...row, config_version: String(Number(row.config_version) + 1) }))); // ⚠️ 08b P-1 (B16): every branch

    const replay = await post(fx, fx.ids.beef, { test_ap_qty: 10_000, test_ep_qty: 7120, note: ' drill 1 ' }, headers);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json().data.yield).toEqual(y);
    expect(await yieldRows(fx)).toBe(1);
  });

  it('[08a #35] AP / EP on an ingredient stocked in piece: test_unit piece; AP 3, EP 2 → 6 667 bp (round half up)', async () => {
    const fx = await inventoryFixture(cloud);
    const anday = await createStockItem(cloud, fx.f, { name: 'Anday', stock_unit: 'piece' });
    await cloud.pool.query(`UPDATE stock_items SET kind = 'ingredient' WHERE tenant_id = $1 AND stock_item_id = $2`, [fx.f.tenantId, anday.stock_item_id]);
    const y = await created(fx, anday.stock_item_id, { test_ap_qty: 3, test_ep_qty: 2 });
    expect(y).toMatchObject({ yield_bp: 6667, test_ap_qty: '3', test_ep_qty: '2', test_unit: 'piece' });
    const row = await cloud.pool.query(`SELECT yield_bp, test_unit FROM yield_profiles WHERE tenant_id = $1 AND yield_profile_id = $2`, [
      fx.f.tenantId,
      y.yield_profile_id,
    ]);
    expect(row.rows).toEqual([{ yield_bp: 6667, test_unit: 'piece' }]);
  });

  it('[08a #35] yield_bp form: no test quantities; chanay 1 000 → 2 400 = 24 000 bp; the latest is active', async () => {
    const fx = await inventoryFixture(cloud);
    const direct = await created(fx, fx.ids.payeRaw, { yield_bp: 6500 });
    expect(direct).toMatchObject({ yield_bp: 6500, test_ap_qty: null, test_ep_qty: null, test_unit: null, note: null });
    const chanay = await created(fx, fx.ids.payeRaw, { test_ap_qty: 1000, test_ep_qty: 2400 });
    expect(chanay.yield_bp).toBe(24_000);
    const response = await cloud.app.inject({ method: 'GET', url: `/v1/admin/stock-items/${fx.ids.payeRaw}/inventory`, headers: owner(fx.f).headers });
    const data = response.json().data as InventoryDetail;
    expect(data.active_yield?.yield_profile_id).toBe(chanay.yield_profile_id);
    expect(data.yields.map((row) => row.yield_profile_id)).toEqual([chanay.yield_profile_id, direct.yield_profile_id]);
  });
});
