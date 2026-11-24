import { resolveUnit, type ItemUnitRow } from '@pos/domain';
import type { InventoryDetail, ItemUnitWire } from '@pos/events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStockItem, patchStockItem } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { inventoryFixture, stockItem, type InventoryFixture } from './fixtures';

// 08a §6.5: POST /v1/admin/stock-items/:stock_item_id/units — I4 name rules against the locked stock unit, gcd
// reduction, base_unit = the locked stock unit, 9 fixed statements (m-2; ⚠️ 08b P-1: was 7), bumps every branch (08b B16;
// was I11's no bump), audit stock_item_unit /
// create; is_current per N-1 after stock_unit changes (test 29).
describe('08a item units POST (§6.5)', () => {
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
    cloud.app.inject({ method: 'POST', url: `/v1/admin/stock-items/${stockItemId}/units`, headers, payload });
  const created = async (fx: InventoryFixture, stockItemId: string, payload: object) => {
    const response = await post(fx, stockItemId, payload);
    expect(response.statusCode, response.body).toBe(201);
    return response.json().data.unit as ItemUnitWire;
  };
  const detail = async (fx: InventoryFixture, stockItemId: string) => {
    const response = await cloud.app.inject({ method: 'GET', url: `/v1/admin/stock-items/${stockItemId}/inventory`, headers: owner(fx.f).headers });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data as InventoryDetail;
  };
  const asRows = (units: readonly ItemUnitWire[]): ItemUnitRow[] =>
    units.map((u) => ({
      unit_row_id: u.unit_row_id,
      unit_name: u.unit_name,
      base_unit: u.base_unit,
      factor_num: BigInt(u.factor_num),
      factor_den: BigInt(u.factor_den),
      created_at: u.created_at,
    }));
  const expect400 = (response: Awaited<ReturnType<typeof post>>) => {
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  };
  const unitRows = async (fx: InventoryFixture) =>
    (await cloud.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM stock_item_units WHERE tenant_id = $1`, [fx.f.tenantId])).rows[0]!.n;
  const setStockUnit = async (fx: InventoryFixture, stockItemId: string, unit: 'piece' | 'g') => {
    const wire = await stockItem(cloud, fx.f, stockItemId);
    await patchStockItem(cloud, fx.f, stockItemId, { expected_version: wire.version, stock_unit: unit });
  };

  it('[08a #28] I4 name rules on the locked stock unit: kg on a g item 400, own stock unit 400; piece on g, l on ghee, kg on a piece item 201', async () => {
    const fx = await inventoryFixture(cloud);
    const anday = await createStockItem(cloud, fx.f, { name: 'Anday', stock_unit: 'piece' });
    const murgi = await createStockItem(cloud, fx.f, { name: 'Murgi', stock_unit: 'piece' });

    // a built-in whose base is the item's stock unit already resolves (I3); case-insensitive
    expect400(await post(fx, fx.ids.beef, { unit_name: 'KG', factor_num: 1000 }));
    expect400(await post(fx, fx.ids.beef, { unit_name: 'pao', factor_num: 250 }));
    // its own stock unit
    expect400(await post(fx, anday.stock_item_id, { unit_name: 'piece', factor_num: 1 }));
    expect400(await post(fx, fx.ids.beef, { unit_name: ' G ', factor_num: 1 }));
    // shape and ranges (zod)
    expect400(await post(fx, fx.ids.beef, { unit_name: 'peti!', factor_num: 1 }));
    expect400(await post(fx, fx.ids.beef, { unit_name: 'peti', factor_num: 0 }));
    expect400(await post(fx, fx.ids.beef, { unit_name: 'peti', factor_num: 1, factor_den: 1_000_001 }));
    expect(await unitRows(fx)).toBe(0);

    // piece on raw paye (g): 1 piece = 182.5 g sent as 1825 / 10, stored reduced 365 / 2
    const piece = await created(fx, fx.ids.payeRaw, { unit_name: 'piece', factor_num: 1825, factor_den: 10, note: '  avg of 20  ' });
    expect(piece).toMatchObject({ unit_name: 'piece', base_unit: 'g', factor_num: '365', factor_den: 2, is_current: true, note: 'avg of 20' });
    // l on ghee (g), 920 / 1 (M-4: a built-in on another base is allowed)
    const litre = await created(fx, fx.ids.ghee, { unit_name: 'L', factor_num: 920 });
    expect(litre).toMatchObject({ unit_name: 'l', base_unit: 'g', factor_num: '920', factor_den: 1, note: null });
    const ghee = await detail(fx, fx.ids.ghee);
    expect(resolveUnit(ghee.stock_item, 'l', asRows(ghee.units))).toEqual({ num: 920n, den: 1n });
    // kg on murgi (piece), 5 / 7
    expect(await created(fx, murgi.stock_item_id, { unit_name: 'kg', factor_num: 5, factor_den: 7 })).toMatchObject({
      base_unit: 'piece',
      factor_num: '5',
      factor_den: 7,
    });
  });

  it('[08a #28 ⚠️ 08b P-1] 201 wire, row, audit stock_item_unit / create, bumps every branch; 9 statements; replay → stored 201', async () => {
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

    const headers = owner(fx.f).headers;
    counter.reset();
    const response = await post(fx, fx.ids.beef, { unit_name: 'Peti', factor_num: 12_000 }, headers);
    expect(counter.count).toBe(9); // ⚠️ 08b P-1: + 2 bump statements
    expect(response.statusCode, response.body).toBe(201);
    const unit = response.json().data.unit as ItemUnitWire;
    expect(unit).toEqual({
      unit_row_id: unit.unit_row_id,
      unit_name: 'peti',
      base_unit: 'g',
      factor_num: '12000',
      factor_den: 1,
      is_current: true,
      note: null,
      recorded_by: fx.f.userId,
      recorded_by_name: name,
      created_at: cloud.clock.branchNow(),
    });
    const rows = await cloud.pool.query(`SELECT * FROM stock_item_units WHERE tenant_id = $1`, [fx.f.tenantId]);
    expect(rows.rows).toEqual([
      expect.objectContaining({ unit_row_id: unit.unit_row_id, stock_item_id: fx.ids.beef, unit_name: 'peti', base_unit: 'g', factor_den: 1 }),
    ]);
    expect(BigInt(String(rows.rows[0].factor_num))).toBe(12_000n);
    const audit = await cloud.pool.query(
      `SELECT entity, entity_id, action, branch_id, actor_owner_user_id FROM config_audit WHERE tenant_id = $1 AND entity = 'stock_item_unit'`,
      [fx.f.tenantId],
    );
    expect(audit.rows).toEqual([{ entity: 'stock_item_unit', entity_id: unit.unit_row_id, action: 'create', branch_id: null, actor_owner_user_id: fx.f.userId }]);
    expect(await versions()).toEqual(before.map((row: { branch_id: string; config_version: string }) => ({ ...row, config_version: String(Number(row.config_version) + 1) }))); // ⚠️ 08b P-1 (B16): every branch

    // retry with the same key: the stored 201, nothing new written
    const replay = await post(fx, fx.ids.beef, { unit_name: 'Peti', factor_num: 12_000 }, headers);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json().data.unit).toEqual(unit);
    expect(await unitRows(fx)).toBe(1);
  });

  it('[08a #28] archived item 422 { stock_item_id, archived }; unknown / foreign item 404 STOCK_ITEM_NOT_FOUND; owner not covering every branch 403', async () => {
    const fx = await inventoryFixture(cloud);
    const archived = await createStockItem(cloud, fx.f, { name: 'Old ghee', stock_unit: 'g' }, { archived: true });
    const gone = await post(fx, archived.stock_item_id, { unit_name: 'peti', factor_num: 12_000 });
    expect(gone.statusCode, gone.body).toBe(422);
    expect(gone.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'stock_item_id', reason: 'archived' } });

    const foreignId = 'S-FOREIGN';
    await cloud.pool.query(
      `INSERT INTO stock_items (tenant_id, stock_item_id, name, stock_unit, carries_over, created_at, updated_at)
       VALUES ($1, $2, 'Foreign ghee', 'g', false, 0, 0)`,
      [fx.f.other.tenantId, foreignId],
    );
    for (const id of [foreignId, 'NO-SUCH-ITEM']) {
      const response = await post(fx, id, { unit_name: 'peti', factor_num: 12_000 });
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json().error.code).toBe('STOCK_ITEM_NOT_FOUND');
    }

    // the owner's row decides (S8), not the JWT claim
    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [fx.f.tenantId, fx.f.userId, [fx.lakeCity]]);
    const narrow = await post(fx, fx.ids.beef, { unit_name: 'peti', factor_num: 12_000 });
    expect(narrow.statusCode, narrow.body).toBe(403);
    expect(narrow.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'tenant_wide_write' } });
    expect(await unitRows(fx)).toBe(0);
    const audit = await cloud.pool.query(`SELECT count(*)::int AS n FROM config_audit WHERE tenant_id = $1 AND entity = 'stock_item_unit'`, [fx.f.tenantId]);
    expect(audit.rows[0].n).toBe(0);
  });

  it('[08a #28] a second peti row with another factor: the new row is current, the old stays in history (I4)', async () => {
    const fx = await inventoryFixture(cloud);
    const first = await created(fx, fx.ids.beef, { unit_name: 'peti', factor_num: 12_000 });
    const second = await created(fx, fx.ids.beef, { unit_name: 'peti', factor_num: 10_000 });
    const data = await detail(fx, fx.ids.beef);
    expect(data.units.map((u) => [u.unit_row_id, u.is_current])).toEqual([
      [second.unit_row_id, true],
      [first.unit_row_id, false],
    ]);
    expect(resolveUnit(data.stock_item, 'peti', asRows(data.units))).toEqual({ num: 10_000n, den: 1n });
  });

  it('[08a §6.5] two tabs add peti at once (same clock tick, different keys): both 201; the higher unit_row_id is current', async () => {
    const fx = await inventoryFixture(cloud);
    const [one, two] = await Promise.all([
      post(fx, fx.ids.beef, { unit_name: 'peti', factor_num: 12_000 }),
      post(fx, fx.ids.beef, { unit_name: 'peti', factor_num: 10_000 }),
    ]);
    expect([one.statusCode, two.statusCode]).toEqual([201, 201]);
    const ids = [one, two].map((r) => (r.json().data.unit as ItemUnitWire).unit_row_id).sort();
    const data = await detail(fx, fx.ids.beef);
    expect(new Set(data.units.map((u) => u.created_at))).toEqual(new Set([cloud.clock.branchNow()]));
    expect(data.units.map((u) => [u.unit_row_id, u.is_current])).toEqual([
      [ids[1], true],
      [ids[0], false],
    ]);
  });

  it('[08a #29] unit then PATCH stock_unit → the old row is_current false, still in history', async () => {
    const fx = await inventoryFixture(cloud);
    const peti = await created(fx, fx.ids.beef, { unit_name: 'peti', factor_num: 12_000 });
    await setStockUnit(fx, fx.ids.beef, 'piece');
    const data = await detail(fx, fx.ids.beef);
    expect(data.stock_item.stock_unit).toBe('piece');
    expect(data.units).toEqual([expect.objectContaining({ unit_row_id: peti.unit_row_id, base_unit: 'g', is_current: false })]);
    expect(resolveUnit(data.stock_item, 'peti', asRows(data.units))).toBeNull();
  });

  it('[08a #29] N-1: ghee peti A (g, 12 kg) → stock_unit piece → peti B (piece) → stock_unit g: A current, B not; resolveUnit(ghee, peti) = 12 000 g', async () => {
    const fx = await inventoryFixture(cloud);
    const a = await created(fx, fx.ids.ghee, { unit_name: 'peti', factor_num: 12_000 });
    await setStockUnit(fx, fx.ids.ghee, 'piece');
    const b = await created(fx, fx.ids.ghee, { unit_name: 'peti', factor_num: 16 });
    expect(b).toMatchObject({ base_unit: 'piece', is_current: true });
    await setStockUnit(fx, fx.ids.ghee, 'g');

    const data = await detail(fx, fx.ids.ghee);
    expect(data.units.map((u) => [u.unit_row_id, u.base_unit, u.is_current])).toEqual([
      [b.unit_row_id, 'piece', false],
      [a.unit_row_id, 'g', true],
    ]);
    expect(resolveUnit(data.stock_item, 'peti', asRows(data.units))).toEqual({ num: 12_000n, den: 1n });
  });
});
