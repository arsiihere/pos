import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

type Window = { start_ms: number; end_ms: number };

describe('availability windows', () => {
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
    menu = await seedMenu(cloud.pool, f, { items: 1 });
  });

  const inject = (method: 'POST' | 'PATCH', url: string, payload: object) =>
    cloud.app.inject({ method, url, ...owner(f), payload });
  const itemBody = (o: object = {}) => ({
    category_id: menu.categoryIds[0],
    tax_class_id: null,
    name: 'Halwa Puri',
    price_minor: 30000,
    serve_mode: 'immediate',
    cook_time_ms: 300000,
    routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId }],
    ...o,
  });
  const snapshot = async () => {
    const response = await cloud.app.inject({
      method: 'GET',
      url: '/v1/sync/config?config_version=0&directory_version=0',
      headers: { authorization: `Bearer ${f.branchKey}` },
    });
    expect(response.statusCode).toBe(200);
    return response.json().data.config.snapshot as {
      items: Array<{ item_id: string; availability_windows: Window[] }>;
      categories: Array<{ category_id: string; availability_windows: Window[] }>;
    };
  };
  const audit = async (entity: string, entityId: string) =>
    (
      await cloud.pool.query<{ action: string; before: { availability_windows?: Window[] } | null; after: { availability_windows?: Window[] } | null }>(
        `SELECT action, before, after FROM config_audit WHERE entity = $1 AND entity_id = $2 ORDER BY at, audit_id`,
        [entity, entityId],
      )
    ).rows;
  const storedWindows = async (column: 'item_id' | 'category_id', id: string) =>
    (
      await cloud.pool.query<{ window_id: string; start_ms: number; end_ms: number }>(
        `SELECT window_id, start_ms, end_ms FROM availability_windows WHERE ${column} = $1 ORDER BY window_id`,
        [id],
      )
    ).rows;

  it('[01a §10 #135] windows on items and categories: stored, sorted in the snapshot, audited, replaced by PATCH; bad windows → 400', async () => {
    // item: 07:00–13:00
    const created = await inject('POST', '/v1/admin/menu-items', itemBody({ availability_windows: [{ start_ms: 25200000, end_ms: 46800000 }] }));
    expect(created.statusCode).toBe(201);
    const item = created.json().data.item;
    expect(item.availability_windows).toEqual([{ start_ms: 25200000, end_ms: 46800000 }]);
    expect((await audit('menu_item', item.item_id))[0]!.after!.availability_windows).toEqual([{ start_ms: 25200000, end_ms: 46800000 }]);

    // category: 22:00–02:00 wraps past midnight; POST → 201, PATCH → 200
    const category = await inject('POST', '/v1/admin/categories', { name: 'Late night', availability_windows: [{ start_ms: 79200000, end_ms: 7200000 }] });
    expect(category.statusCode).toBe(201);
    const late = category.json().data.category;
    expect(late.availability_windows).toEqual([{ start_ms: 79200000, end_ms: 7200000 }]);
    expect((await audit('category', late.category_id))[0]!.after!.availability_windows).toEqual([{ start_ms: 79200000, end_ms: 7200000 }]);
    const breakfast = (await inject('POST', '/v1/admin/categories', { name: 'Brunch' })).json().data.category;
    expect(breakfast.availability_windows).toEqual([]);
    const patchedCategory = await inject('PATCH', `/v1/admin/categories/${breakfast.category_id}`, {
      availability_windows: [{ start_ms: 79200000, end_ms: 7200000 }],
    });
    expect(patchedCategory.statusCode).toBe(200);
    expect(patchedCategory.json().data.category.availability_windows).toEqual([{ start_ms: 79200000, end_ms: 7200000 }]);
    // review-06 nit 2: a PATCH carrying only windows changes the stored windows and the audit row (S47)
    expect((await storedWindows('category_id', breakfast.category_id)).map(({ start_ms, end_ms }) => ({ start_ms, end_ms }))).toEqual([
      { start_ms: 79200000, end_ms: 7200000 },
    ]);
    expect((await audit('category', breakfast.category_id)).at(-1)).toMatchObject({
      action: 'update',
      before: { availability_windows: [] },
      after: { availability_windows: [{ start_ms: 79200000, end_ms: 7200000 }] },
    });

    // a PATCH replaces the set: old rows gone; two windows with the same start sort by end
    const oldRows = await storedWindows('item_id', item.item_id);
    const replaced = await inject('PATCH', `/v1/admin/menu-items/${item.item_id}`, {
      availability_windows: [
        { start_ms: 25200000, end_ms: 46800000 },
        { start_ms: 3600000, end_ms: 7200000 },
        { start_ms: 3600000, end_ms: 5400000 },
      ],
    });
    expect(replaced.statusCode).toBe(200);
    const sorted = [
      { start_ms: 3600000, end_ms: 5400000 },
      { start_ms: 3600000, end_ms: 7200000 },
      { start_ms: 25200000, end_ms: 46800000 },
    ];
    expect(replaced.json().data.item.availability_windows).toEqual(sorted);
    const newRows = await storedWindows('item_id', item.item_id);
    expect(newRows).toHaveLength(3);
    for (const row of oldRows) expect(newRows.map((r) => r.window_id)).not.toContain(row.window_id);
    expect((await audit('menu_item', item.item_id)).at(-1)).toMatchObject({
      action: 'update',
      before: { availability_windows: [{ start_ms: 25200000, end_ms: 46800000 }] },
      after: { availability_windows: sorted },
    });
    // a PATCH without the field keeps the set
    expect((await inject('PATCH', `/v1/admin/menu-items/${item.item_id}`, { price_minor: 31000 })).statusCode).toBe(200);
    expect(await storedWindows('item_id', item.item_id)).toEqual(newRows);

    const snap = await snapshot();
    expect(snap.items.find((i) => i.item_id === item.item_id)!.availability_windows).toEqual(sorted);
    expect(snap.categories.find((c) => c.category_id === late.category_id)!.availability_windows).toEqual([
      { start_ms: 79200000, end_ms: 7200000 },
    ]);

    // start = end, not a minute, 5 windows, 86 400 000 → 400 on all four writes; nothing written
    const w = (start_ms: number, end_ms: number) => ({ start_ms, end_ms });
    const bad = [
      [w(25200000, 25200000)],
      [w(25200001, 46800000)],
      [w(0, 60000), w(60000, 120000), w(120000, 180000), w(180000, 240000), w(240000, 300000)],
      [w(0, 86400000)],
    ];
    const count = async () => Number((await cloud.pool.query(`SELECT count(*) FROM availability_windows`)).rows[0].count);
    const before = await count();
    for (const windows of bad) {
      for (const [method, url, payload] of [
        ['POST', '/v1/admin/menu-items', itemBody({ name: 'Bad window', availability_windows: windows })],
        ['PATCH', `/v1/admin/menu-items/${item.item_id}`, { availability_windows: windows }],
        ['POST', '/v1/admin/categories', { name: 'Bad window', availability_windows: windows }],
        ['PATCH', `/v1/admin/categories/${late.category_id}`, { availability_windows: windows }],
      ] as const) {
        const response = await inject(method, url, payload);
        expect(response.statusCode, `${method} ${url} ${JSON.stringify(windows)}`).toBe(400);
        expect(response.json().error.code).toBe('VALIDATION_FAILED');
      }
    }
    expect(await count()).toBe(before);
  });
});
