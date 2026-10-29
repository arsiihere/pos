import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

describe('menu item patch', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let menu: SeededMenu;

  beforeAll(async () => {
    cloud = await createTestCloud({ captureLogs: true });
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
    menu = await seedMenu(cloud.pool, f, { items: 1, archived: true });
  });

  const inject = (method: 'POST' | 'PATCH', url: string, payload: object) =>
    cloud.app.inject({ method, url, ...owner(f), payload });
  const create = async (o: object = {}) => {
    const created = await inject('POST', '/v1/admin/menu-items', {
      category_id: menu.categoryIds[0],
      tax_class_id: menu.taxClassId,
      name: 'Mutton Karahi',
      price_minor: 120000,
      serve_mode: 'sync',
      cook_time_ms: 1_200_000,
      routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId }],
      ...o,
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json().data.item as Record<string, unknown> & { item_id: string };
  };
  const patch = (itemId: string, payload: object) => inject('PATCH', `/v1/admin/menu-items/${itemId}`, payload);
  const versions = async () =>
    (
      await cloud.pool.query<{ config_version: string }>(
        `SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`,
        [f.tenantId],
      )
    ).rows.map((row) => Number(row.config_version));
  const versionOf = async (branchId: string) =>
    Number(
      (await cloud.pool.query<{ v: string }>(`SELECT config_version AS v FROM branches WHERE branch_id = $1`, [branchId])).rows[0]!.v,
    );
  const itemAudit = async (itemId: string) =>
    (
      await cloud.pool.query<{ branch_id: string | null; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>(
        `SELECT branch_id, action, before, after FROM config_audit WHERE entity = 'menu_item' AND entity_id = $1 ORDER BY at, audit_id`,
        [itemId],
      )
    ).rows;
  const stored = async (itemId: string) =>
    (await cloud.pool.query(`SELECT * FROM menu_items WHERE item_id = $1`, [itemId])).rows[0];
  // "in the snapshot" = poll GET /v1/sync/config with branch A's key
  const snapshotItem = async (itemId: string) => {
    const response = await cloud.app.inject({
      method: 'GET',
      url: '/v1/sync/config?config_version=0&directory_version=0',
      headers: { authorization: `Bearer ${f.branchKey}` },
    });
    expect(response.statusCode).toBe(200);
    const items = response.json().data.config.snapshot.items as Array<Record<string, unknown>>;
    return items.find((i) => i.item_id === itemId);
  };
  const expectNothingWritten = async (itemId: string, call: () => Promise<{ statusCode: number; json(): { error: unknown } }>, status: number) => {
    const before = { row: await stored(itemId), audit: await itemAudit(itemId), versions: await versions() };
    const response = await call();
    expect(response.statusCode).toBe(status);
    expect(await stored(itemId)).toEqual(before.row);
    expect(await itemAudit(itemId)).toEqual(before.audit);
    expect(await versions()).toEqual(before.versions);
    return response.json();
  };

  it('[01a §10 #7] table rename at branch A bumps A only; item price change bumps A, B, C', async () => {
    const [a, b, c] = f.branches;
    const each = async () => [await versionOf(a), await versionOf(b), await versionOf(c)];
    const before = await each();
    const renamed = await inject('PATCH', `/v1/admin/branches/${a}/tables/${menu.tableIds[0]}`, { name: 'Window' });
    expect(renamed.statusCode).toBe(200);
    const afterTable = await each();
    expect(afterTable).toEqual([before[0]! + 1, before[1], before[2]]);

    const priced = await patch(menu.itemIds[0]!, { price_minor: 125000 });
    expect(priced.statusCode).toBe(200);
    expect(await each()).toEqual(afterTable.map((v) => v + 1));
  });

  it('[01a §10 #38] archive item → absent from the next snapshot; restore → back; unknown → 404 MENU_ITEM_NOT_FOUND', async () => {
    const item = await create();
    expect(await snapshotItem(item.item_id)).toBeDefined();
    const archived = await patch(item.item_id, { archived: true });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().data.item.archived_at).toBe(cloud.clock.branchNow());
    expect(await snapshotItem(item.item_id)).toBeUndefined();
    expect((await itemAudit(item.item_id)).at(-1)!.action).toBe('archive');

    const restored = await patch(item.item_id, { archived: false });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().data.item).toEqual(item);
    expect(await snapshotItem(item.item_id)).toBeDefined();
    expect((await itemAudit(item.item_id)).at(-1)!.action).toBe('restore');

    const unknown = await patch('NO-SUCH-ITEM', { name: 'X' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toMatchObject({ code: 'MENU_ITEM_NOT_FOUND', details: { item_id: 'NO-SUCH-ITEM' } });
  });

  it('[01a §10 #81] PATCH price_minor 120000 → 130000 writes one menu_item / update row with before and after prices, branch_id null', async () => {
    const item = await create({ price_minor: 120000 });
    const response = await patch(item.item_id, { price_minor: 130000 });
    expect(response.statusCode).toBe(200);
    // the item as created; the §6.15 audit row also holds the stored deprecated columns (01c §5.1) until §6.5
    const row: Record<string, unknown> = { ...item };
    delete row.routes;
    delete row.stock_draws;
    const rows = await itemAudit(item.item_id);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ branch_id: null, action: 'update', before: row, after: { ...row, price_minor: 130000 } });
    expect(rows[1]!.before!.price_minor).toBe(120000);
    expect(rows[1]!.after!.price_minor).toBe(130000);
  });

  it('[01a §10 #106] out_of_stock_behaviour: default cook_fresh; PATCH to sold_out in the snapshot and audited; "never" → 400; sold_out without stock tracking accepted', async () => {
    const item = await create({ stock_time_ms: 300_000 });
    expect(item.out_of_stock_behaviour).toBe('cook_fresh');
    const soldOut = await patch(item.item_id, { out_of_stock_behaviour: 'sold_out' });
    expect(soldOut.statusCode).toBe(200);
    expect((await snapshotItem(item.item_id))!.out_of_stock_behaviour).toBe('sold_out');
    expect((await itemAudit(item.item_id)).at(-1)).toMatchObject({
      action: 'update',
      before: { out_of_stock_behaviour: 'cook_fresh' },
      after: { out_of_stock_behaviour: 'sold_out' },
    });
    await expectNothingWritten(item.item_id, () => patch(item.item_id, { out_of_stock_behaviour: 'never' }), 400);

    const untracked = await create({ name: 'Lassi', stock_time_ms: null });
    const accepted = await patch(untracked.item_id, { out_of_stock_behaviour: 'sold_out' });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().data.item.out_of_stock_behaviour).toBe('sold_out');
  });

  it('[01a §10 #107] tax_class_id null → 201 and null in the snapshot; archiving a class with only null-tax items → allowed; archived class → 422; PATCH class → null audited and in the snapshot', async () => {
    const untaxed = await create({ name: 'Water', tax_class_id: null });
    expect(untaxed.tax_class_id).toBeNull();
    expect((await snapshotItem(untaxed.item_id))!.tax_class_id).toBeNull();

    const gst = (await inject('POST', '/v1/admin/tax-classes', { name: 'GST', rate_bp: 1600 })).json().data.tax_class;
    const archivedClass = await inject('PATCH', `/v1/admin/tax-classes/${gst.tax_class_id}`, { archived: true });
    expect(archivedClass.statusCode).toBe(200);

    const post = await inject('POST', '/v1/admin/menu-items', {
      category_id: menu.categoryIds[0],
      tax_class_id: gst.tax_class_id,
      name: 'Taxed',
      price_minor: 100,
      serve_mode: 'immediate',
      cook_time_ms: 60000,
    });
    expect(post.statusCode).toBe(422);
    expect(post.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'tax_class_id', reason: 'archived' } });
    const body = await expectNothingWritten(untaxed.item_id, () => patch(untaxed.item_id, { tax_class_id: gst.tax_class_id }), 422);
    expect(body.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'tax_class_id', reason: 'archived' } });

    const taxed = await create({ name: 'Karahi taxed' });
    const cleared = await patch(taxed.item_id, { tax_class_id: null });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().data.item.tax_class_id).toBeNull();
    expect((await itemAudit(taxed.item_id)).at(-1)).toMatchObject({
      action: 'update',
      before: { tax_class_id: menu.taxClassId },
      after: { tax_class_id: null },
    });
    expect((await snapshotItem(taxed.item_id))!.tax_class_id).toBeNull();
  });

  it('[01a §10 #121] PATCH validation on the merged row: stock_time_ms 300000, PATCH { cook_time_ms: 200000 } → 422, not 500; nothing written', async () => {
    const item = await create({ stock_time_ms: 300_000 });
    const body = await expectNothingWritten(item.item_id, () => patch(item.item_id, { cook_time_ms: 200_000 }), 422);
    expect(body.error).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'stock_time_ms', reason: 'stock_time_exceeds_cook_time' },
    });
  });

  it('[01a §10 #128] units: g / piece / 250 and the defaults in the snapshot; threshold and carries_over; the 400s; merged-row sale_unit; a unit change is audited', async () => {
    // 01c §6.4 drops the unit fields from the create body: the stored units are set by SQL (01c #23 covers create)
    const grams = await create({ name: 'Karahi by weight' });
    await cloud.pool.query(`UPDATE menu_items SET stock_unit = 'g', stock_per_sale_unit = 250 WHERE item_id = $1`, [grams.item_id]);
    expect(await snapshotItem(grams.item_id)).toMatchObject({ stock_unit: 'g', sale_unit: 'piece', stock_per_sale_unit: 250 });

    const plain = await create({ name: 'Plain' });
    expect(await snapshotItem(plain.item_id)).toMatchObject({
      stock_unit: 'piece',
      sale_unit: 'piece',
      stock_per_sale_unit: 1,
      low_stock_threshold: null,
      carries_over: false,
    });
    const flagged = await create({ name: 'Flagged' });
    await cloud.pool.query(`UPDATE menu_items SET low_stock_threshold = 1000, carries_over = true WHERE item_id = $1`, [flagged.item_id]);
    expect(await snapshotItem(flagged.item_id)).toMatchObject({ low_stock_threshold: 1000, carries_over: true });

    const body = await expectNothingWritten(plain.item_id, () => patch(plain.item_id, { sale_unit: 'g' }), 400);
    expect(body.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'sale_unit' }] } });

    const changed = await patch(plain.item_id, { stock_unit: 'ml', stock_per_sale_unit: 330 });
    expect(changed.statusCode).toBe(200);
    expect((await itemAudit(plain.item_id)).at(-1)).toMatchObject({
      action: 'update',
      before: { stock_unit: 'piece', sale_unit: 'piece', stock_per_sale_unit: 1 },
      after: { stock_unit: 'ml', sale_unit: 'piece', stock_per_sale_unit: 330 },
    });
    expect(await snapshotItem(plain.item_id)).toMatchObject({ stock_unit: 'ml', sale_unit: 'piece', stock_per_sale_unit: 330 });
  });

  it('[01a §6.15] restore re-checks the merged row: a taken name → 409; a route to a station archived meanwhile → 422; archived category → 422', async () => {
    const item = await create();
    expect((await patch(item.item_id, { archived: true })).statusCode).toBe(200);

    await create({ name: 'mutton karahi', routes: [] });
    const taken = await expectNothingWritten(item.item_id, () => patch(item.item_id, { archived: false }), 409);
    expect(taken.error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'menu_item', name: 'Mutton Karahi' } });

    // the station loses its only active route while the item is archived, then is archived itself
    const station = await inject('PATCH', `/v1/admin/branches/${f.branches[0]}/stations/${menu.slotStationId}`, { archived: true });
    expect(station.statusCode, station.body).toBe(409); // seedMenu's IT-0000 still routes there
    await cloud.pool.query(`UPDATE menu_items SET archived_at = 1 WHERE item_id = $1`, [menu.itemIds[0]]);
    expect(
      (await inject('PATCH', `/v1/admin/branches/${f.branches[0]}/stations/${menu.slotStationId}`, { archived: true })).statusCode,
    ).toBe(200);
    const onArchived = await expectNothingWritten(
      item.item_id,
      () => patch(item.item_id, { archived: false, name: 'Mutton Karahi 2' }),
      422,
    );
    expect(onArchived.error).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'routes.0.station_id', reason: 'archived' },
    });

    const other = await create({ name: 'Other', routes: [] });
    const category = await expectNothingWritten(
      other.item_id,
      () => patch(other.item_id, { category_id: menu.archived!.categoryId }),
      422,
    );
    expect(category.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'category_id', reason: 'archived' } });
  });
});
