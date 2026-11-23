import type { InventoryDetail } from '@pos/events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgCounter } from '../helpers/pg-counter';
import { owner } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { inventoryFixture, stockItem, type InventoryFixture } from './fixtures';

// 08a §6.4: GET /v1/admin/stock-items/:stock_item_id/inventory — 7 fixed statements (M-3), menu_cost from the
// separate candidate read (I7), is_current per N-1, builtin_units, recorded_by_name (§5.3). Unit, price and yield
// rows are seeded with SQL (their POSTs are §6.5–§6.7's).
const HOUR = 3_600_000;

describe('08a inventory detail (§6.4)', () => {
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

  const id = (prefix: string) => `${prefix}${String(++seq).padStart(8, '0')}`;
  const detail = (fx: InventoryFixture, stockItemId: string, query = '', token?: string) =>
    cloud.app.inject({ method: 'GET', url: `/v1/admin/stock-items/${stockItemId}/inventory${query}`, headers: owner(fx.f, token).headers });
  const ok = async (fx: InventoryFixture, stockItemId: string, query = '') => {
    const response = await detail(fx, stockItemId, query);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data as InventoryDetail;
  };
  const ownerName = async (fx: InventoryFixture) =>
    (await cloud.pool.query<{ display_name: string }>(`SELECT display_name FROM owner_users WHERE tenant_id = $1 AND user_id = $2`, [fx.f.tenantId, fx.f.userId]))
      .rows[0]!.display_name;

  const unit = async (fx: InventoryFixture, stockItemId: string, r: { name: string; base: string; num: number; den?: number; at: number }) => {
    const unitRowId = id('U');
    await cloud.pool.query(
      `INSERT INTO stock_item_units (tenant_id, unit_row_id, stock_item_id, unit_name, base_unit, factor_num, factor_den, note, recorded_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9)`,
      [fx.f.tenantId, unitRowId, stockItemId, r.name, r.base, r.num, r.den ?? 1, fx.f.userId, r.at],
    );
    return unitRowId;
  };
  const price = async (
    fx: InventoryFixture,
    stockItemId: string,
    r: { kind: 'manual' | 'market_rate'; at: number; validUntil?: number | null; branchId?: string | null; unit?: string; minor: number; num: number; den?: number; stockUnit?: string },
  ) => {
    const priceId = id('P');
    await cloud.pool.query(
      `INSERT INTO item_prices (tenant_id, price_id, stock_item_id, branch_id, kind, unit_name, price_minor, stock_qty_num, stock_qty_den, stock_unit,
                                created_at, valid_until_at, note, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, $13)`,
      [
        fx.f.tenantId,
        priceId,
        stockItemId,
        r.branchId ?? null,
        r.kind,
        r.unit ?? 'kg',
        r.minor,
        r.num,
        r.den ?? 1,
        r.stockUnit ?? 'g',
        r.at,
        r.kind === 'manual' ? null : (r.validUntil ?? r.at + 24 * HOUR),
        fx.f.userId,
      ],
    );
    return priceId;
  };
  const yieldRow = async (fx: InventoryFixture, stockItemId: string, r: { bp: number; at: number; ap?: number; ep?: number }) => {
    const yieldId = id('Y');
    await cloud.pool.query(
      `INSERT INTO yield_profiles (tenant_id, yield_profile_id, stock_item_id, yield_bp, test_ap_qty, test_ep_qty, test_unit, note, recorded_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'cut test', $8, $9)`,
      [fx.f.tenantId, yieldId, stockItemId, r.bp, r.ap ?? null, r.ep ?? null, r.ap === undefined ? null : 'g', fx.f.userId, r.at],
    );
    return yieldId;
  };

  it('[08a #30] 101 expired market rates + 1 older manual → menu_cost = the manual; history shows 100 rows; 7 statements', async () => {
    const fx = await inventoryFixture(cloud);
    const ghee = fx.ids.ghee;
    // Rs 3,600 / kg manual, older than every market rate; then 101 market rates, each expired after 1 h
    const manual = await price(fx, ghee, { kind: 'manual', at: now - 500 * HOUR, minor: 360_000, num: 1000 });
    const rates: string[] = [];
    for (let i = 0; i < 101; i += 1) {
      const at = now - 300 * HOUR + i * HOUR;
      rates.push(await price(fx, ghee, { kind: 'market_rate', at, validUntil: at + HOUR, minor: 400_000 + i, num: 1000 }));
    }

    counter.reset();
    const data = await ok(fx, ghee);
    expect(counter.count).toBe(7);

    expect(data.menu_cost).toEqual({
      branch_id: null,
      price_id: manual,
      per_stock_unit: { num: '360', den: '1' }, // 360 000 × 1 / 1 000 paisa per g
      display_per: { unit: 'kg', minor: '360000', below_one_minor: false },
    });
    expect(data.prices).toHaveLength(100);
    // newest 100 by created_at, id: the 100 latest market rates; the oldest rate and the manual are beyond the page
    expect(data.prices.map((p) => p.price_id)).toEqual(rates.slice(1).reverse());
    expect(data.prices.some((p) => p.price_id === manual)).toBe(false);
    const name = await ownerName(fx);
    expect(data.prices[0]).toEqual({
      price_id: rates[100],
      branch_id: null,
      kind: 'market_rate',
      unit_name: 'kg',
      price_minor: 400_100,
      stock_qty_num: '1000',
      stock_qty_den: '1',
      stock_unit: 'g',
      created_at: now - 200 * HOUR,
      valid_until_at: now - 199 * HOUR,
      note: null,
      recorded_by: fx.f.userId,
      recorded_by_name: name,
    });
  });

  it('[08a §6.4] branch_id: the branch market rate wins at its branch; without it the every-branch set; I7 stock unit', async () => {
    const fx = await inventoryFixture(cloud);
    const beef = fx.ids.beef;
    const every = await price(fx, beef, { kind: 'manual', at: now - 10 * HOUR, minor: 200_000, num: 1000 });
    const branch = await price(fx, beef, { kind: 'market_rate', at: now - 2 * HOUR, branchId: fx.lakeCity, minor: 180_000, num: 1000 });
    // a newer price in another stock unit ("other unit", I5 / I7) never counts
    await price(fx, beef, { kind: 'manual', at: now - HOUR, unit: 'piece', minor: 999, num: 1, stockUnit: 'piece' });
    // a price that takes effect in the future does not count yet
    await price(fx, beef, { kind: 'manual', at: now + HOUR, minor: 1, num: 1000 });

    counter.reset();
    const atLakeCity = await ok(fx, beef, `?branch_id=${fx.lakeCity}`);
    expect(counter.count).toBe(7);
    expect(atLakeCity.menu_cost).toMatchObject({ branch_id: fx.lakeCity, price_id: branch, per_stock_unit: { num: '180', den: '1' } });
    expect((await ok(fx, beef)).menu_cost).toMatchObject({ branch_id: null, price_id: every });
    expect((await ok(fx, beef, `?branch_id=${fx.f.branches[1]}`)).menu_cost).toMatchObject({ price_id: every });
    // the history shows every branch's rows, the future one included
    expect(atLakeCity.prices).toHaveLength(4);

    // no price at all → null, never 0
    expect((await ok(fx, fx.ids.payeRaw)).menu_cost).toBeNull();
  });

  it('[08a §6.4, N-1] units: every row newest first; is_current = latest of its name with base_unit = the stock unit', async () => {
    const fx = await inventoryFixture(cloud);
    const ghee = fx.ids.ghee;
    const petiA = await unit(fx, ghee, { name: 'peti', base: 'g', num: 12_000, at: now - 30 * HOUR });
    const litre = await unit(fx, ghee, { name: 'l', base: 'g', num: 920, at: now - 25 * HOUR });
    const petiB = await unit(fx, ghee, { name: 'peti', base: 'g', num: 10_000, at: now - 20 * HOUR });
    const petiPiece = await unit(fx, ghee, { name: 'peti', base: 'piece', num: 24, at: now - 10 * HOUR }); // "other unit"

    const data = await ok(fx, ghee);
    const name = await ownerName(fx);
    expect(data.units.map((u) => [u.unit_row_id, u.is_current])).toEqual([
      [petiPiece, false],
      [petiB, true],
      [litre, true],
      [petiA, false],
    ]);
    expect(data.units[1]).toEqual({
      unit_row_id: petiB,
      unit_name: 'peti',
      base_unit: 'g',
      factor_num: '10000',
      factor_den: 1,
      is_current: true,
      note: null,
      recorded_by: fx.f.userId,
      recorded_by_name: name,
      created_at: now - 20 * HOUR,
    });

    // the stock unit changes to piece (raw SQL; the PATCH is c1's): the piece row is current, the g rows are not
    await cloud.pool.query(`UPDATE stock_items SET stock_unit = 'piece' WHERE tenant_id = $1 AND stock_item_id = $2`, [fx.f.tenantId, ghee]);
    const asPiece = await ok(fx, ghee);
    expect(asPiece.units.map((u) => [u.unit_row_id, u.is_current])).toEqual([
      [petiPiece, true],
      [petiB, false],
      [litre, false],
      [petiA, false],
    ]);
    expect(asPiece.builtin_units).toEqual([{ unit_name: 'darjan', base: 'piece', num: 12, den: 1 }]);
  });

  it('[08a §6.4] builtin_units = the built-ins whose base is the stock unit; stock_item wire; can_edit_tenant', async () => {
    const fx = await inventoryFixture(cloud);
    const tp1 = await ok(fx, fx.ids.tp1);
    expect(tp1.builtin_units).toEqual([
      { unit_name: 'kg', base: 'g', num: 1000, den: 1 },
      { unit_name: 'pao', base: 'g', num: 250, den: 1 },
      { unit_name: 'maund', base: 'g', num: 40000, den: 1 },
    ]);
    // the list entry's StockItemWire fields (the list adds branches, drawers, menu_cost)
    const listed = (await stockItem(cloud, fx.f, fx.ids.tp1)) as Record<string, unknown>;
    expect(tp1.stock_item).toEqual(Object.fromEntries(Object.entries(listed).filter(([key]) => !['branches', 'drawers', 'menu_cost'].includes(key))));
    expect(tp1.stock_item).toMatchObject({ kind: 'packet', code: 'TP-1', stock_unit: 'g' });
    expect(tp1.can_edit_tenant).toBe(true);
    expect(tp1).toMatchObject({ units: [], prices: [], menu_cost: null, yields: [], active_yield: null });
    expect((await ok(fx, fx.ids.payeCooked)).builtin_units).toEqual([{ unit_name: 'darjan', base: 'piece', num: 12, den: 1 }]);

    // a narrower JWT still reads; can_edit_tenant follows the owner row (coversEveryBranch), not the JWT claim
    const response = await detail(fx, fx.ids.tp1, '', fx.f.tokenFor([fx.f.branches[0]]));
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.can_edit_tenant).toBe(true);
  });

  it('[08a §6.4] yields: newest 20; active_yield = the latest; test quantities as strings; owner names', async () => {
    const fx = await inventoryFixture(cloud);
    const beef = fx.ids.beef;
    const ids: string[] = [];
    for (let i = 0; i < 21; i += 1) ids.push(await yieldRow(fx, beef, { bp: 6000 + i, at: now - 100 * HOUR + i * HOUR }));
    const latest = await yieldRow(fx, beef, { bp: 6500, at: now - HOUR, ap: 10_000, ep: 6_500 });

    counter.reset();
    const data = await ok(fx, beef);
    expect(counter.count).toBe(7);
    expect(data.yields).toHaveLength(20);
    expect(data.yields.map((y) => y.yield_profile_id)).toEqual([latest, ...ids.slice(2).reverse()]);
    expect(data.active_yield).toEqual({
      yield_profile_id: latest,
      yield_bp: 6500,
      test_ap_qty: '10000',
      test_ep_qty: '6500',
      test_unit: 'g',
      note: 'cut test',
      recorded_by: fx.f.userId,
      recorded_by_name: await ownerName(fx),
      created_at: now - HOUR,
    });
    expect(data.yields[1]).toMatchObject({ test_ap_qty: null, test_ep_qty: null, test_unit: null });
  });

  it('[08a §6.4] 404 STOCK_ITEM_NOT_FOUND (unknown, another tenant’s); 404 BRANCH_NOT_FOUND before any SQL; 400 bad query', async () => {
    const fx = await inventoryFixture(cloud);
    const unknown = await detail(fx, 'NO-SUCH-ITEM');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toMatchObject({ code: 'STOCK_ITEM_NOT_FOUND', details: { stock_item_id: 'NO-SUCH-ITEM' } });

    const foreignId = id('S');
    await cloud.pool.query(
      `INSERT INTO stock_items (tenant_id, stock_item_id, name, stock_unit, carries_over, created_at, updated_at)
       VALUES ($1, $2, 'Foreign ghee', 'g', false, $3, $3)`,
      [fx.f.other.tenantId, foreignId, now],
    );
    const foreign = await detail(fx, foreignId);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('STOCK_ITEM_NOT_FOUND');
    expect(foreign.body).not.toContain('Foreign ghee');

    // another tenant's branch, and an own branch outside the JWT: C2 answers before any statement
    for (const [branchId, token] of [
      [fx.f.other.branchId, undefined],
      [fx.f.branches[1], fx.f.tokenFor([fx.f.branches[0]])],
    ] as const) {
      counter.reset();
      const response = await detail(fx, fx.ids.ghee, `?branch_id=${branchId}`, token);
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json().error.code).toBe('BRANCH_NOT_FOUND');
      expect(counter.count).toBe(0);
    }
    // the branch check comes first, also for an unknown item
    expect((await detail(fx, 'NO-SUCH-ITEM', `?branch_id=${fx.f.other.branchId}`)).json().error.code).toBe('BRANCH_NOT_FOUND');

    const bad = await detail(fx, fx.ids.ghee, '?branch_id=');
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_FAILED');
  });
});
