import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

// 01a v2.7.5 §6.14, §6.15, §6.11 row MD-4 (STAB-7; review M-7, m-11; re-review F-1, F-2): an item's max delay on the
// menu-item write and read. Range 60 000–1 800 000; every refusal is 400 VALIDATION_FAILED at max_delay_ms; the
// combinations of §6.15 on the merged row; the no-op compares both fields.

describe('[01a v2.7.5 #203] menu item max_delay_ms / max_delay_unlimited', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let menu: SeededMenu;
  let item: string;

  beforeAll(async () => {
    cloud = await createTestCloud({ captureLogs: true });
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
    menu = await seedMenu(cloud.pool, f, { items: 1 });
    item = menu.itemIds[0]!;
  });

  const inject = (method: 'POST' | 'PATCH', url: string, payload: object) => cloud.app.inject({ method, url, ...owner(f), payload });
  const patch = (payload: object, id = item) => inject('PATCH', `/v1/admin/menu-items/${id}`, payload);
  const post = (o: object = {}) =>
    inject('POST', '/v1/admin/menu-items', {
      category_id: menu.categoryIds[0],
      tax_class_id: menu.taxClassId,
      name: 'Mutton Karahi',
      price_minor: 120000,
      serve_mode: 'sync',
      cook_time_ms: 1_200_000,
      ...o,
    });
  const versions = async () =>
    (await cloud.pool.query<{ config_version: string }>(`SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`, [f.tenantId])).rows.map((r) =>
      Number(r.config_version),
    );
  const audits = async (id = item) =>
    (await cloud.pool.query<{ action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>(
      `SELECT action, before, after FROM config_audit WHERE entity = 'menu_item' AND entity_id = $1 ORDER BY at, audit_id`,
      [id],
    )).rows;
  const stored = async (id = item) =>
    (await cloud.pool.query(`SELECT max_delay_ms, max_delay_unlimited FROM menu_items WHERE item_id = $1`, [id])).rows[0] as {
      max_delay_ms: number | null;
      max_delay_unlimited: boolean;
    };
  const readItem = async (id = item) => {
    const response = await cloud.app.inject({ method: 'GET', url: '/v1/admin/menu?limit=200', headers: owner(f).headers });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json().data.items as Array<Record<string, unknown>>).find((i) => i.item_id === id)!;
  };
  const delayOf = (row: Record<string, unknown>) => ({ max_delay_ms: row.max_delay_ms, max_delay_unlimited: row.max_delay_unlimited });
  const expectRefused = async (payload: object) => {
    const before = { row: await stored(), audit: (await audits()).length, versions: await versions() };
    const response = await patch(payload);
    expect(response.statusCode, `${JSON.stringify(payload)} ${response.body}`).toBe(400);
    expect(response.json().error).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'max_delay_ms' }] } });
    expect(await stored()).toEqual(before.row);
    expect((await audits()).length).toBe(before.audit);
    expect(await versions()).toEqual(before.versions);
  };

  it('[#203 MD-4] an existing item reads the branch default (null / false); POST takes both fields, defaulting to the same', async () => {
    expect(delayOf(await readItem())).toEqual({ max_delay_ms: null, max_delay_unlimited: false });
    const plain = await post();
    expect(plain.statusCode, plain.body).toBe(201);
    expect(delayOf(plain.json().data.item)).toEqual({ max_delay_ms: null, max_delay_unlimited: false });
    const timed = await post({ name: 'Naan', max_delay_ms: 600_000 });
    expect(timed.statusCode, timed.body).toBe(201);
    expect(delayOf(timed.json().data.item)).toEqual({ max_delay_ms: 600_000, max_delay_unlimited: false });
    const unlimited = await post({ name: 'Raita', max_delay_unlimited: true });
    expect(unlimited.statusCode, unlimited.body).toBe(201);
    expect(delayOf(unlimited.json().data.item)).toEqual({ max_delay_ms: null, max_delay_unlimited: true });
    expect((await post({ name: 'Bad', max_delay_unlimited: true, max_delay_ms: 60_000 })).statusCode).toBe(400);
    expect((await post({ name: 'Bad', max_delay_ms: 1_800_001 })).json().error).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'max_delay_ms' }] } });
  });

  it('[#203 MD-4] PATCH 600 000 → 200, the menu read shows it with false, one audit row, every branch bumped; the same value again is a no-op', async () => {
    const held = await versions();
    const response = await patch({ max_delay_ms: 600_000 });
    expect(response.statusCode, response.body).toBe(200);
    expect(delayOf(response.json().data.item)).toEqual({ max_delay_ms: 600_000, max_delay_unlimited: false });
    expect(delayOf(await readItem())).toEqual({ max_delay_ms: 600_000, max_delay_unlimited: false });
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.before).toMatchObject({ max_delay_ms: null, max_delay_unlimited: false });
    expect(rows[0]!.after).toMatchObject({ max_delay_ms: 600_000, max_delay_unlimited: false });
    expect(await versions()).toEqual(held.map((v) => v + 1));
    const again = await patch({ max_delay_ms: 600_000 });
    expect(again.statusCode, again.body).toBe(200);
    expect(await audits()).toHaveLength(1);
    expect(await versions()).toEqual(held.map((v) => v + 1));
  });

  it('[#203 MD-4; re-review F-1] 60 000, 90 000 (not whole minutes) and 1 800 000 are kept as sent', async () => {
    for (const value of [60_000, 90_000, 1_800_000]) {
      const response = await patch({ max_delay_ms: value });
      expect(response.statusCode, response.body).toBe(200);
      expect(await stored()).toEqual({ max_delay_ms: value, max_delay_unlimited: false });
    }
  });

  it.each([0, 59_999, -1, 1_800_001, 7_200_000, 1.5])('[#203 MD-4; re-review F-1, F-2] max_delay_ms %s → 400 VALIDATION_FAILED at max_delay_ms, nothing written', async (value) => {
    await expectRefused({ max_delay_ms: value });
  });

  it('[#203 MD-4; re-review F-2] max_delay_unlimited true with a number → 400 VALIDATION_FAILED at max_delay_ms, nothing written', async () => {
    await expectRefused({ max_delay_unlimited: true, max_delay_ms: 600_000 });
  });

  it('[#203 MD-4; m-11] every combination on the merged row', async () => {
    // true alone → no limit, the number cleared
    expect((await patch({ max_delay_ms: 600_000 })).statusCode).toBe(200);
    expect((await patch({ max_delay_unlimited: true })).statusCode).toBe(200);
    expect(await stored()).toEqual({ max_delay_ms: null, max_delay_unlimited: true });
    // null alone on "No limit" keeps "No limit"
    const kept = await patch({ max_delay_ms: null });
    expect(kept.statusCode, kept.body).toBe(200);
    expect(await stored()).toEqual({ max_delay_ms: null, max_delay_unlimited: true });
    // a number alone clears max_delay_unlimited
    expect((await patch({ max_delay_ms: 300_000 })).statusCode).toBe(200);
    expect(await stored()).toEqual({ max_delay_ms: 300_000, max_delay_unlimited: false });
    // null alone on a number → the branch default
    expect((await patch({ max_delay_ms: null })).statusCode).toBe(200);
    expect(await stored()).toEqual({ max_delay_ms: null, max_delay_unlimited: false });
    // false alone → the branch default
    expect((await patch({ max_delay_unlimited: true })).statusCode).toBe(200);
    expect((await patch({ max_delay_unlimited: false })).statusCode).toBe(200);
    expect(await stored()).toEqual({ max_delay_ms: null, max_delay_unlimited: false });
    // true + null → no limit; false + a number → that number; false + null → the branch default
    expect((await patch({ max_delay_unlimited: true, max_delay_ms: null })).statusCode).toBe(200);
    expect(await stored()).toEqual({ max_delay_ms: null, max_delay_unlimited: true });
    expect((await patch({ max_delay_unlimited: false, max_delay_ms: 600_000 })).statusCode).toBe(200);
    expect(await stored()).toEqual({ max_delay_ms: 600_000, max_delay_unlimited: false });
    expect((await patch({ max_delay_unlimited: false, max_delay_ms: null })).statusCode).toBe(200);
    expect(await stored()).toEqual({ max_delay_ms: null, max_delay_unlimited: false });
  });

  it('[#203 MD-4; S26] the no-op compares both fields: "No limit" again writes nothing', async () => {
    expect((await patch({ max_delay_unlimited: true })).statusCode).toBe(200);
    const held = { audit: (await audits()).length, versions: await versions() };
    expect((await patch({ max_delay_unlimited: true })).statusCode).toBe(200);
    expect((await patch({ max_delay_ms: null })).statusCode).toBe(200);
    expect((await audits()).length).toBe(held.audit);
    expect(await versions()).toEqual(held.versions);
  });
});
