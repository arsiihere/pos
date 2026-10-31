import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createStockItem, seedDealPartRows, seedModifierGroupRows } from '../helpers/menu-variants';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

// 01c §6.5 R4, R10, R6, R8 (V16, P1, D-3, V18) and the rule precedence (v0.6 Q2, §12.7 T4). Modifier groups and deals are
// seeded by SQL before their writers exist (P-4).
describe('01c item PATCH: in-use rules and precedence (§6.5 R4, R10, R6, R8)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let menu: SeededMenu;

  beforeAll(async () => {
    cloud = await createTestCloud();
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
    menu = await seedMenu(cloud.pool, f, { items: 1 });
  });

  const inject = (method: 'POST' | 'PATCH', url: string, payload: object) => cloud.app.inject({ method, url, ...owner(f), payload });
  const patch = (itemId: string, payload: object) => inject('PATCH', `/v1/admin/menu-items/${itemId}`, payload);
  const create = async (name: string, o: object = {}) => {
    const response = await inject('POST', '/v1/admin/menu-items', {
      category_id: menu.categoryIds[0],
      tax_class_id: null,
      name,
      price_minor: 5000,
      serve_mode: 'immediate',
      cook_time_ms: 300_000,
      routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId }],
      ...o,
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json().data.item as { item_id: string }).item_id;
  };
  const bread = (naan: string, o: { archived?: boolean; optionArchived?: boolean } = {}) =>
    seedModifierGroupRows(cloud, f, {
      modifierGroupId: 'MG-BREAD',
      name: 'Bread',
      ...(o.archived !== undefined ? { archived: o.archived } : {}),
      options: [{ optionId: 'OP-NAAN', name: 'Naan', linkedItemId: naan, ...(o.optionArchived !== undefined ? { archived: o.optionArchived } : {}) }],
    });
  const deal = (choices: string[], o: { partArchived?: boolean } = {}) =>
    seedDealPartRows(cloud, f, {
      dealId: 'DL-1',
      name: 'Karahi deal',
      categoryId: menu.categoryIds[0],
      parts: [{ dealPartId: 'DP-BREAD', choices, ...(o.partArchived !== undefined ? { archived: o.partArchived } : {}) }],
    });
  const setOption = (archived: boolean) =>
    cloud.pool.query(`UPDATE modifier_options SET archived_at = $2 WHERE tenant_id = $1 AND option_id = 'OP-NAAN'`, [
      f.tenantId,
      archived ? 1 : null,
    ]);
  const setPart = (archived: boolean) =>
    cloud.pool.query(`UPDATE deal_parts SET archived_at = $2 WHERE tenant_id = $1 AND deal_part_id = 'DP-BREAD'`, [
      f.tenantId,
      archived ? 1 : null,
    ]);
  const stored = async (itemId: string) =>
    (await cloud.pool.query(`SELECT * FROM menu_items WHERE item_id = $1`, [itemId])).rows[0] as Record<string, unknown>;
  const drawsOf = async (itemId: string) =>
    (await cloud.pool.query(`SELECT stock_item_id, quantity_per_sale_unit FROM stock_draws WHERE item_id = $1 ORDER BY stock_item_id`, [itemId]))
      .rows;
  const auditCount = async () => Number((await cloud.pool.query(`SELECT count(*) AS n FROM config_audit`)).rows[0].n);
  const versions = async () =>
    (
      await cloud.pool.query<{ config_version: string }>(`SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`, [
        f.tenantId,
      ])
    ).rows.map((row) => Number(row.config_version));
  // The response is the error; the row, its draws, every audit row and every branch version are unchanged.
  const nothingWritten = async (itemId: string, payload: object, status: number) => {
    const before = { row: await stored(itemId), draws: await drawsOf(itemId), audit: await auditCount(), versions: await versions() };
    const response = await patch(itemId, payload);
    expect(response.statusCode, response.body).toBe(status);
    expect(await stored(itemId)).toEqual(before.row);
    expect(await drawsOf(itemId)).toEqual(before.draws);
    expect(await auditCount()).toBe(before.audit);
    expect(await versions()).toEqual(before.versions);
    return response.json() as { error: { code: string; details: Record<string, unknown> } };
  };
  const ok = async (itemId: string, payload: object) => {
    const response = await patch(itemId, payload);
    expect(response.statusCode, response.body).toBe(200);
  };
  const inUse = (itemId: string, entity: 'modifier_group' | 'deal', ids: string[]) => ({
    code: 'CONFIG_IN_USE',
    details: { entity: 'menu_item', id: itemId, used_by: { entity, ids } },
  });

  it('[01c #25] archive an item linked by an active option → 409 { used_by: modifier_group }; offered by a deal choice → 409 { used_by: deal }; both → modifier groups first; nothing written', async () => {
    const naan = await create('Naan');
    const roghni = await create('Roghni naan');
    await bread(naan);
    await deal([naan, roghni]);
    expect((await nothingWritten(naan, { archived: true }, 409)).error).toMatchObject(inUse(naan, 'modifier_group', ['MG-BREAD']));
    expect((await nothingWritten(roghni, { archived: true }, 409)).error).toMatchObject(inUse(roghni, 'deal', ['DL-1']));
    // the deal part archived → Roghni archives; the option archived → Naan archives
    await setPart(true);
    await ok(roghni, { archived: true });
    expect((await nothingWritten(naan, { archived: true }, 409)).error).toMatchObject(inUse(naan, 'modifier_group', ['MG-BREAD']));
    await setOption(true);
    await ok(naan, { archived: true });
  });

  it('[01c §6.5 R4] archive counts active options of active groups and active parts only: an archived group or part → 200', async () => {
    const naan = await create('Naan');
    await bread(naan, { archived: true });
    await deal([naan], { partArchived: true });
    await ok(naan, { archived: true });
  });

  it('[01c #83] Naan and Roghni naan (piece) in one deal part: PATCH Naan sale_unit g → 409 { used_by: deal }, nothing written; the only choice of a part → 200', async () => {
    const naan = await create('Naan');
    const roghni = await create('Roghni naan');
    await deal([naan, roghni]);
    expect((await nothingWritten(naan, { sale_unit: 'g' }, 409)).error).toMatchObject(inUse(naan, 'deal', ['DL-1']));
    const solo = await create('Sheermal');
    await seedDealPartRows(cloud, f, { dealId: 'DL-2', name: 'Solo deal', categoryId: menu.categoryIds[0], parts: [{ dealPartId: 'DP-SOLO', choices: [solo] }] });
    await ok(solo, { sale_unit: 'g' });
    expect(await stored(solo)).toMatchObject({ sale_unit: 'g' });
  });

  it('[01c §6.5 R10] sale_unit g or requires_weighing on a linked Naan counts active options of active groups only: option archived → 200; group archived → 200', async () => {
    const naan = await create('Naan');
    await bread(naan, { optionArchived: true });
    await ok(naan, { sale_unit: 'g', requires_weighing: true });
    const kulcha = await create('Kulcha');
    await seedModifierGroupRows(cloud, f, {
      modifierGroupId: 'MG-SIDES',
      name: 'Sides',
      archived: true,
      options: [{ optionId: 'OP-KULCHA', linkedItemId: kulcha }],
    });
    await ok(kulcha, { sale_unit: 'g' });
  });

  it('[01c §6.5 AD-11] a part of an archived deal does not block: archive → 200, sale_unit → 200; the deal active → the 409s', async () => {
    const naan = await create('Naan');
    const roghni = await create('Roghni naan');
    await seedDealPartRows(cloud, f, {
      dealId: 'DL-1',
      name: 'Karahi deal',
      categoryId: menu.categoryIds[0],
      archived: true,
      parts: [{ dealPartId: 'DP-BREAD', choices: [naan, roghni] }],
    });
    await ok(naan, { sale_unit: 'g' });
    await ok(naan, { sale_unit: 'piece' });
    await ok(naan, { archived: true });
    await ok(naan, { archived: false });
    await cloud.pool.query(`UPDATE deals SET archived_at = NULL WHERE tenant_id = $1 AND deal_id = 'DL-1'`, [f.tenantId]);
    expect((await nothingWritten(naan, { sale_unit: 'g' }, 409)).error).toMatchObject(inUse(naan, 'deal', ['DL-1']));
    expect((await nothingWritten(naan, { archived: true }, 409)).error).toMatchObject(inUse(naan, 'deal', ['DL-1']));
  });

  it('[01c #128] precedence: R10 before R6, R8 and R2; R7 400 first; R4 as before; T4: R10 before 01a stock_time_exceeds_cook_time', async () => {
    const naan = await create('Naan', { stock_time_ms: 120_000 });
    const roghni = await create('Roghni naan');
    await bread(naan);
    await deal([naan, roghni]);
    const bothFail = (await nothingWritten(naan, { sale_unit: 'g' }, 409)).error;
    expect(bothFail).toMatchObject(inUse(naan, 'modifier_group', ['MG-BREAD'])); // R10 before R6
    await setOption(true);
    expect((await nothingWritten(naan, { sale_unit: 'g' }, 409)).error).toMatchObject(inUse(naan, 'deal', ['DL-1'])); // R6
    await setOption(false);
    // R10 before R8's 422 (weighed item in a deal)
    expect((await nothingWritten(naan, { sale_unit: 'g', requires_weighing: true }, 409)).error).toMatchObject(
      inUse(naan, 'modifier_group', ['MG-BREAD']),
    );
    // control (task 15 review): R10 and R6 out of the way (the option archived; Naan the only choice of an active part
    // of an active deal) → R8's 422, so the step above proves R10 before R8
    await setOption(true);
    await setPart(true);
    await seedDealPartRows(cloud, f, { dealId: 'DL-SOLO', name: 'Solo deal', categoryId: menu.categoryIds[0], parts: [{ dealPartId: 'DP-SOLO', choices: [naan] }] });
    expect((await nothingWritten(naan, { sale_unit: 'g', requires_weighing: true }, 422)).error).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'requires_weighing', reason: 'weighed_item_in_deal' },
    });
    await cloud.pool.query(`UPDATE deals SET archived_at = 1 WHERE tenant_id = $1 AND deal_id = 'DL-SOLO'`, [f.tenantId]);
    await setPart(false);
    await setOption(false);
    // R7's 400 first
    expect((await nothingWritten(naan, { requires_weighing: true }, 400)).error.code).toBe('VALIDATION_FAILED');
    // R4 as before
    expect((await nothingWritten(naan, { archived: true }, 409)).error).toMatchObject(inUse(naan, 'modifier_group', ['MG-BREAD']));
    // T4: the 409 before 01a's stock_time_exceeds_cook_time 422
    expect((await nothingWritten(naan, { sale_unit: 'g', cook_time_ms: 120_000 - 1 }, 409)).error).toMatchObject(
      inUse(naan, 'modifier_group', ['MG-BREAD']),
    );
    // a draw to a piece stock item: R10 before R2's 422 unit_mismatch
    const pieces = (await createStockItem(cloud, f, { name: 'Naan', stock_unit: 'piece' })).stock_item_id;
    await ok(naan, { stock_draws: [{ stock_item_id: pieces, quantity_per_sale_unit: 1 }] });
    expect((await nothingWritten(naan, { sale_unit: 'g' }, 409)).error).toMatchObject(inUse(naan, 'modifier_group', ['MG-BREAD']));
    // the Bread option and the deal part archived → R2
    await setOption(true);
    await setPart(true);
    expect((await nothingWritten(naan, { sale_unit: 'g' }, 422)).error).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'stock_draws.0.stock_item_id', reason: 'unit_mismatch' },
    });
  });
});
