import type { InventoryDetail, ItemPriceCreated } from '@pos/events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgCounter } from '../helpers/pg-counter';
import { owner } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { inventoryFixture, type InventoryFixture } from './fixtures';

// 08a §6.6: POST /v1/admin/stock-items/:stock_item_id/prices — validate → key → tenant-wide → stock item FOR SHARE →
// active → [branch read, C1] → units read → resolveUnit (I5) → insert with the frozen conversion (I6) → candidates
// (I7) → audit → key response → prune: 9 statements, 10 with branch_id. No bump (I11). Unit rows are seeded with
// SQL (the units POST is §6.5's).
const HOUR = 3_600_000;

describe('08a prices POST (§6.6)', () => {
  let cloud: TestCloud;
  let counter: ReturnType<typeof pgCounter>;
  let now: number;
  let seq = 0;

  beforeAll(async () => {
    cloud = await createTestCloud({ testHooks: { handlerStart: () => counter.reset() } });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
    now = cloud.clock.branchNow();
  });
  afterAll(async () => {
    await cloud.close();
  });

  const post = (fx: InventoryFixture, stockItemId: string, payload: object, token?: string) =>
    cloud.app.inject({ method: 'POST', url: `/v1/admin/stock-items/${stockItemId}/prices`, ...owner(fx.f, token), payload });
  const created = async (fx: InventoryFixture, stockItemId: string, payload: object) => {
    const response = await post(fx, stockItemId, payload);
    expect(response.statusCode, response.body).toBe(201);
    return response.json().data as ItemPriceCreated;
  };
  const detail = async (fx: InventoryFixture, stockItemId: string, query = '', token?: string) => {
    const response = await cloud.app.inject({ method: 'GET', url: `/v1/admin/stock-items/${stockItemId}/inventory${query}`, headers: owner(fx.f, token).headers });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data as InventoryDetail;
  };
  const unit = async (fx: InventoryFixture, stockItemId: string, r: { name: string; base: string; num: number; den?: number; at: number }) => {
    const unitRowId = `U${String(++seq).padStart(8, '0')}`;
    await cloud.pool.query(
      `INSERT INTO stock_item_units (tenant_id, unit_row_id, stock_item_id, unit_name, base_unit, factor_num, factor_den, note, recorded_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9)`,
      [fx.f.tenantId, unitRowId, stockItemId, r.name, r.base, r.num, r.den ?? 1, fx.f.userId, r.at],
    );
    return unitRowId;
  };
  const priceRows = async (fx: InventoryFixture) =>
    (await cloud.pool.query(`SELECT * FROM item_prices WHERE tenant_id = $1 ORDER BY created_at, price_id`, [fx.f.tenantId])).rows;
  const audits = async (fx: InventoryFixture) =>
    (
      await cloud.pool.query(`SELECT entity, entity_id, action, branch_id, actor_owner_user_id FROM config_audit WHERE tenant_id = $1 AND entity = 'item_price'`, [
        fx.f.tenantId,
      ])
    ).rows;
  const versions = async (fx: InventoryFixture) =>
    (await cloud.pool.query(`SELECT branch_id, config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`, [fx.f.tenantId])).rows;
  const ownerName = async (fx: InventoryFixture) =>
    (await cloud.pool.query<{ display_name: string }>(`SELECT display_name FROM owner_users WHERE tenant_id = $1 AND user_id = $2`, [fx.f.tenantId, fx.f.userId]))
      .rows[0]!.display_name;
  const refused = (body: string) => JSON.parse(body).error as { code: string; details?: unknown };

  it('[08a #31] manual + branch_id 400; branch_id unknown / foreign 422 not_found; market rate at a branch 201; 9 / 10 statements; audit branch_id = the price', async () => {
    const fx = await inventoryFixture(cloud);
    const beef = fx.ids.beef;

    const manualAtBranch = await post(fx, beef, { kind: 'manual', branch_id: fx.lakeCity, unit_name: 'kg', price_minor: 150_000 });
    expect(manualAtBranch.statusCode).toBe(400);
    expect(refused(manualAtBranch.body).code).toBe('VALIDATION_FAILED');

    for (const branchId of ['NO-SUCH-BRANCH', fx.f.other.branchId]) {
      const response = await post(fx, beef, { kind: 'market_rate', branch_id: branchId, unit_name: 'kg', price_minor: 150_000 });
      expect(response.statusCode, response.body).toBe(422);
      expect(refused(response.body)).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'branch_id', reason: 'not_found' } });
    }
    expect(await priceRows(fx)).toEqual([]);
    expect(await audits(fx)).toEqual([]);

    const before = await versions(fx);
    // every-branch manual: 9 statements
    const every = await post(fx, beef, { kind: 'manual', unit_name: 'kg', price_minor: 200_000 });
    expect(every.statusCode, every.body).toBe(201);
    expect(counter.count).toBe(9);
    const everyData = every.json().data as ItemPriceCreated;
    expect(everyData.menu_cost).toMatchObject({ branch_id: null, price_id: everyData.price.price_id });

    // market rate at Lake City: 10 statements (+ the branch read); menu_cost = I7 for Lake City
    const branch = await post(fx, beef, { kind: 'market_rate', branch_id: fx.lakeCity, unit_name: 'kg', price_minor: 180_000 });
    expect(branch.statusCode, branch.body).toBe(201);
    expect(counter.count).toBe(10);
    const data = branch.json().data as ItemPriceCreated;
    expect(data.price).toEqual({
      price_id: data.price.price_id,
      branch_id: fx.lakeCity,
      kind: 'market_rate',
      unit_name: 'kg',
      price_minor: 180_000,
      stock_qty_num: '1000',
      stock_qty_den: '1',
      stock_unit: 'g',
      created_at: now,
      valid_until_at: now + 24 * HOUR,
      note: null,
      recorded_by: fx.f.userId,
      recorded_by_name: await ownerName(fx),
    });
    expect(data.menu_cost).toEqual({
      branch_id: fx.lakeCity,
      price_id: data.price.price_id,
      per_stock_unit: { num: '180', den: '1' },
      display_per: { unit: 'kg', minor: '180000', below_one_minor: false },
    });
    // the every-branch view still answers the manual price (I7)
    expect((await detail(fx, beef)).menu_cost).toMatchObject({ price_id: everyData.price.price_id });
    expect((await detail(fx, beef, `?branch_id=${fx.lakeCity}`)).menu_cost).toMatchObject({ price_id: data.price.price_id });
    // §6.6 edge: the branch rate beats every-branch prices for 24 h, then Lake City falls back by itself (I7).
    // Tokens are minted at the moved clock (1 h TTL).
    const lakeCityCost = async (at: number) => {
      cloud.clock.set(at);
      return (await detail(fx, beef, `?branch_id=${fx.lakeCity}`, fx.f.tokenFor([...fx.f.branches]))).menu_cost;
    };
    try {
      expect(await lakeCityCost(now + 24 * HOUR - 1)).toMatchObject({ branch_id: fx.lakeCity, price_id: data.price.price_id });
      expect(await lakeCityCost(now + 24 * HOUR)).toMatchObject({ branch_id: null, price_id: everyData.price.price_id });
    } finally {
      cloud.clock.set(now);
    }

    // §6.0: one audit row per POST, item_price / create, branch_id = the price's; no bump (I11)
    expect(await audits(fx)).toEqual(
      expect.arrayContaining([
        { entity: 'item_price', entity_id: everyData.price.price_id, action: 'create', branch_id: null, actor_owner_user_id: fx.f.userId },
        { entity: 'item_price', entity_id: data.price.price_id, action: 'create', branch_id: fx.lakeCity, actor_owner_user_id: fx.f.userId },
      ]),
    );
    expect(await audits(fx)).toHaveLength(2);
    // the audit after = the stored row as the wire shows it + stock_item_id, without recorded_by_name (as i2's rows)
    const stored: Record<string, unknown> = { ...data.price };
    delete stored.recorded_by_name;
    const after = await cloud.pool.query(`SELECT after FROM config_audit WHERE tenant_id = $1 AND entity_id = $2`, [fx.f.tenantId, data.price.price_id]);
    expect(after.rows[0].after).toEqual({ stock_item_id: beef, ...stored });
    expect(await versions(fx)).toEqual(before);
  });

  it('[08a §6.6, I10, S7] owner not covering every branch 403; foreign / unknown item 404; replay; nothing written', async () => {
    const fx = await inventoryFixture(cloud);
    const body = { kind: 'manual', unit_name: 'kg', price_minor: 150_000 };

    // the owner row (never the JWT claim, S8) misses a branch → 403 before the item lock: an unknown item too
    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [fx.f.tenantId, fx.f.userId, [fx.lakeCity]]);
    for (const id of [fx.ids.beef, 'NO-SUCH-ITEM']) {
      const narrow = await post(fx, id, body);
      expect(narrow.statusCode, narrow.body).toBe(403);
      expect(refused(narrow.body)).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'tenant_wide_write' } });
    }
    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [fx.f.tenantId, fx.f.userId, fx.f.branches]);

    const theirs = await cloud.app.inject({ method: 'POST', url: '/v1/admin/stock-items', ...owner(fx.f, fx.f.other.token), payload: { name: 'Their beef', stock_unit: 'g' } });
    expect(theirs.statusCode, theirs.body).toBe(201);
    for (const id of [theirs.json().data.stock_item.stock_item_id as string, 'NO-SUCH-ITEM']) {
      const response = await post(fx, id, body);
      expect(response.statusCode, response.body).toBe(404);
      expect(refused(response.body).code).toBe('STOCK_ITEM_NOT_FOUND');
    }
    expect(await priceRows(fx)).toEqual([]);

    const headers = owner(fx.f).headers;
    const send = () => cloud.app.inject({ method: 'POST', url: `/v1/admin/stock-items/${fx.ids.beef}/prices`, headers, payload: body });
    const first = await send();
    expect(first.statusCode, first.body).toBe(201);
    const again = await send();
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.json()).toEqual(first.json());
    expect(await priceRows(fx)).toHaveLength(1);
  });

  it('[08a #32] frozen conversion: peti = 12 kg, Rs 3,600 / peti → stored 12 000 / 1; then peti = 10 kg → the stored price keeps 12 000 / 1; menu_cost unchanged', async () => {
    const fx = await inventoryFixture(cloud);
    const ghee = fx.ids.ghee;
    await unit(fx, ghee, { name: 'peti', base: 'g', num: 12_000, at: now - 10 * HOUR });

    const data = await created(fx, ghee, { kind: 'manual', unit_name: 'Peti', price_minor: 360_000 });
    expect(data.price).toMatchObject({ unit_name: 'peti', stock_qty_num: '12000', stock_qty_den: '1', stock_unit: 'g', valid_until_at: null });
    expect(data.menu_cost).toEqual({
      branch_id: null,
      price_id: data.price.price_id,
      per_stock_unit: { num: '30', den: '1' }, // 360 000 / 12 000 paisa per g
      display_per: { unit: 'kg', minor: '30000', below_one_minor: false },
    });

    // the owner corrects the peti to 10 kg (a newer unit row); the stored price is never recomputed (I4, I6)
    await unit(fx, ghee, { name: 'peti', base: 'g', num: 10_000, at: now - HOUR });
    const [row] = await priceRows(fx);
    expect({ num: String(row.stock_qty_num), den: String(row.stock_qty_den), stock_unit: row.stock_unit }).toEqual({ num: '12000', den: '1', stock_unit: 'g' });
    const after = await detail(fx, ghee);
    expect(after.menu_cost).toEqual(data.menu_cost);
    expect(after.prices).toEqual([data.price]);

    // a new price in peti now freezes the new factor
    cloud.clock.set(now + 1);
    try {
      const next = await created(fx, ghee, { kind: 'manual', unit_name: 'peti', price_minor: 360_000 });
      expect(next.price).toMatchObject({ stock_qty_num: '10000', stock_qty_den: '1' });
      expect(next.menu_cost).toMatchObject({ price_id: next.price.price_id, per_stock_unit: { num: '36', den: '1' } });
    } finally {
      cloud.clock.set(now);
    }
  });

  it('[08a #33] valid_for_hours: default 24 h, 72 h; 0 / 721 / with manual 400; manual valid_until_at null; kind quote 400; price_minor 0 400', async () => {
    const fx = await inventoryFixture(cloud);
    const beef = fx.ids.beef;

    const daily = await created(fx, beef, { kind: 'market_rate', unit_name: 'kg', price_minor: 150_000 });
    expect(daily.price.valid_until_at).toBe(daily.price.created_at + 86_400_000);
    const threeDays = await created(fx, beef, { kind: 'market_rate', unit_name: 'kg', price_minor: 150_000, valid_for_hours: 72 });
    expect(threeDays.price.valid_until_at).toBe(threeDays.price.created_at + 259_200_000);
    const manual = await created(fx, beef, { kind: 'manual', unit_name: 'kg', price_minor: 150_000 });
    expect(manual.price.valid_until_at).toBeNull();

    const rows = await priceRows(fx);
    expect(rows.map((row) => [row.kind, row.valid_until_at === null ? null : BigInt(String(row.valid_until_at)) - BigInt(String(row.created_at))])).toEqual(
      expect.arrayContaining([
        ['market_rate', 86_400_000n],
        ['market_rate', 259_200_000n],
        ['manual', null],
      ]),
    );

    for (const payload of [
      { kind: 'market_rate', unit_name: 'kg', price_minor: 150_000, valid_for_hours: 0 },
      { kind: 'market_rate', unit_name: 'kg', price_minor: 150_000, valid_for_hours: 721 },
      { kind: 'manual', unit_name: 'kg', price_minor: 150_000, valid_for_hours: 24 },
      { kind: 'quote', unit_name: 'kg', price_minor: 150_000 },
      { kind: 'manual', unit_name: 'kg', price_minor: 0 },
    ]) {
      const response = await post(fx, beef, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(refused(response.body).code).toBe('VALIDATION_FAILED');
    }
    expect(await priceRows(fx)).toHaveLength(3);
  });

  it('[08a §6.6 edges] beef kg Rs 1,500 → 150 per g, display kg 150000; ghee l (920 g) Rs 2,300 → 250 per g; peti without a unit 422; archived 422', async () => {
    const fx = await inventoryFixture(cloud);

    const beef = await created(fx, fx.ids.beef, { kind: 'manual', unit_name: 'kg', price_minor: 150_000 });
    expect(beef.price).toMatchObject({ stock_qty_num: '1000', stock_qty_den: '1' });
    expect(beef.menu_cost).toEqual({
      branch_id: null,
      price_id: beef.price.price_id,
      per_stock_unit: { num: '150', den: '1' },
      display_per: { unit: 'kg', minor: '150000', below_one_minor: false },
    });

    await unit(fx, fx.ids.ghee, { name: 'l', base: 'g', num: 920, at: now - HOUR });
    const ghee = await created(fx, fx.ids.ghee, { kind: 'manual', unit_name: 'l', price_minor: 230_000 });
    expect(ghee.price).toMatchObject({ unit_name: 'l', stock_qty_num: '920', stock_qty_den: '1', stock_unit: 'g' });
    expect(ghee.menu_cost).toMatchObject({ per_stock_unit: { num: '250', den: '1' } });

    const before = (await priceRows(fx)).length;
    const peti = await post(fx, fx.ids.payeRaw, { kind: 'manual', unit_name: 'peti', price_minor: 360_000 });
    expect(peti.statusCode, peti.body).toBe(422);
    expect(refused(peti.body)).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'unit_name', reason: 'not_convertible' } });
    // a built-in on another base (l on a g item without an item unit) does not resolve either (I5)
    const litre = await post(fx, fx.ids.beef, { kind: 'manual', unit_name: 'l', price_minor: 1 });
    expect(refused(litre.body)).toMatchObject({ details: { field: 'unit_name', reason: 'not_convertible' } });

    await cloud.pool.query(`UPDATE stock_items SET archived_at = $3 WHERE tenant_id = $1 AND stock_item_id = $2`, [fx.f.tenantId, fx.ids.payeRaw, now]);
    const archived = await post(fx, fx.ids.payeRaw, { kind: 'manual', unit_name: 'kg', price_minor: 150_000 });
    expect(archived.statusCode, archived.body).toBe(422);
    expect(refused(archived.body)).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'stock_item_id', reason: 'archived' } });
    expect(await priceRows(fx)).toHaveLength(before);
  });
});
