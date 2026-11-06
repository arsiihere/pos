import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

type MenuItem = { item_id: string; name: string; routes: Array<{ branch_id: string }>; [k: string]: unknown };
type MenuPage = {
  can_edit_tenant: boolean;
  tax_classes: unknown[];
  categories: unknown[];
  items: MenuItem[];
  next_cursor: string | null;
};

describe('owner menu read', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let counter: ReturnType<typeof pgCounter>;

  beforeAll(async () => {
    cloud = await createTestCloud({ captureLogs: true, testHooks: { handlerStart: () => counter.reset() } });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
    const [a, b] = f.branches;
    const q = (sql: string, params: unknown[] = []) => cloud.pool.query(sql, [f.tenantId, ...params]);
    await q(
      `INSERT INTO tax_classes (tenant_id, tax_class_id, name, rate_bp, archived_at, created_at, updated_at)
       VALUES ($1, 'TX-1', 'Standard', 1600, NULL, 0, 0), ($1, 'TX-0', 'Old', 500, 7, 0, 0)`,
    );
    await q(
      `INSERT INTO categories (tenant_id, category_id, name, sort_order, archived_at, created_at, updated_at)
       VALUES ($1, 'CT-1', 'Mains', 1, NULL, 0, 0), ($1, 'CT-2', 'Breakfast', 2, NULL, 0, 0), ($1, 'CT-0', 'Old', 0, 9, 0, 0)`,
    );
    await q(
      `INSERT INTO availability_windows (tenant_id, window_id, category_id, start_ms, end_ms)
       VALUES ($1, 'WN-2', 'CT-2', 25200000, 46800000), ($1, 'WN-1', 'CT-2', 3600000, 7200000)`,
    );
    await q(
      `INSERT INTO stations (tenant_id, branch_id, station_id, point_id, name, station_type, capacity, created_at, updated_at)
       VALUES ($1, $2, 'ST-A', (SELECT point_id FROM points WHERE tenant_id = $1 AND branch_id = $2 AND name = 'Pass'), 'Karahi', 'slot', 2, 0, 0), ($1, $3, 'ST-B', (SELECT point_id FROM points WHERE tenant_id = $1 AND branch_id = $3 AND name = 'Pass'), 'Karahi', 'slot', 2, 0, 0)`,
      [a, b],
    );
  });

  const get = (query: string, token?: string) =>
    cloud.app.inject({ method: 'GET', url: `/v1/admin/menu${query}`, headers: owner(f, token).headers });
  const page = async (query: string, token?: string): Promise<MenuPage> => {
    const response = await get(query, token);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data as MenuPage;
  };
  // n items in CT-1 named name(i), ids chosen so that id order differs from name order.
  // group: the id of a variant group (01c §6.3: q matches its name); the member's variant_name is its name.
  const addItems = async (rows: Array<{ id: string; name: string; group?: string; category?: string; archived?: boolean }>) => {
    await cloud.pool.query(
      `INSERT INTO menu_items (tenant_id, item_id, category_id, tax_class_id, name, variant_group_id, variant_name,
                               price_minor, serve_mode, cook_time_ms, archived_at, created_at, updated_at)
       SELECT $1, u.id, u.category, 'TX-1', u.name, u.grp, CASE WHEN u.grp IS NOT NULL THEN u.name END, 100, 'immediate',
              60000, u.archived, 0, 0
         FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::bigint[]) AS u (id, name, grp, category, archived)`,
      [
        f.tenantId,
        rows.map((r) => r.id),
        rows.map((r) => r.name),
        rows.map((r) => r.group ?? null),
        rows.map((r) => r.category ?? 'CT-1'),
        rows.map((r) => (r.archived === true ? 5 : null)),
      ],
    );
  };
  const route = (branchId: string, itemId: string, stationId: string) =>
    cloud.pool.query(
      `INSERT INTO item_routes (tenant_id, branch_id, item_id, station_id, updated_at) VALUES ($1, $2, $3, $4, 0)`,
      [f.tenantId, branchId, itemId, stationId],
    );
  const pad = (i: number) => String(i).padStart(3, '0');
  const PREFIX = ['zinger', 'Apple', 'MANGO'];
  const nameOf = (i: number) => `${PREFIX[i % 3]}${pad(i)}`;
  const byKey = (x: { name: string; item_id: string }, y: { name: string; item_id: string }) => {
    const [a, b] = [x.name.toLowerCase(), y.name.toLowerCase()];
    return a < b ? -1 : a > b ? 1 : x.item_id < y.item_id ? -1 : 1;
  };

  it('[01a §10 #40] menu list: 8 statements for 1 and 50 items on the page; routes only for allowed branches', async () => {
    const [a, b] = f.branches;
    await addItems(Array.from({ length: 60 }, (_, i) => ({ id: `MI-${pad(i)}`, name: nameOf(i) })));
    await route(a, 'MI-000', 'ST-A');
    await route(b, 'MI-000', 'ST-B');

    const one = await page('?limit=1');
    expect(counter.count).toBe(8);
    expect(one.items).toHaveLength(1);
    const fifty = await page('?limit=50');
    expect(counter.count).toBe(8);
    expect(fifty.items).toHaveLength(50);

    const all = await page('?limit=200');
    expect(all.items.find((i) => i.item_id === 'MI-000')!.routes).toEqual([
      { branch_id: a, station_id: 'ST-A', program_id: null, stock_program_id: null, price_minor_override: null },
      { branch_id: b, station_id: 'ST-B', program_id: null, stock_program_id: null, price_minor_override: null },
    ].sort((x, y) => (x.branch_id < y.branch_id ? -1 : 1)));
    const onlyA = await page('?limit=200', f.tokenFor([a]));
    expect(onlyA.items.find((i) => i.item_id === 'MI-000')!.routes).toEqual([
      { branch_id: a, station_id: 'ST-A', program_id: null, stock_program_id: null, price_minor_override: null },
    ]);
    expect(onlyA.items).toHaveLength(60);

    // the whole item, its windows, and the tenant-level lists, archived included
    await cloud.pool.query(
      `INSERT INTO availability_windows (tenant_id, window_id, item_id, start_ms, end_ms)
       VALUES ($1, 'WN-9', 'MI-000', 3600000, 7200000), ($1, 'WN-8', 'MI-000', 3600000, 5400000)`,
      [f.tenantId],
    );
    const first = await page('?q=zinger000');
    expect(first.items).toEqual([
      {
        item_id: 'MI-000',
        category_id: 'CT-1',
        tax_class_id: 'TX-1',
        name: 'zinger000',
        variant_group_id: null,
        variant_name: null,
        description: null,
        sort_order: 0,
        price_minor: 100,
        serve_mode: 'immediate',
        prep_buffer_ms: 0,
        cook_time_ms: 60000,
        stock_time_ms: null,
        out_of_stock_behaviour: 'cook_fresh',
        sale_unit: 'piece',
        requires_weighing: false,
        stock_draws: [],
        availability_windows: [
          { start_ms: 3600000, end_ms: 5400000 },
          { start_ms: 3600000, end_ms: 7200000 },
        ],
        weight_pct: 100,
        max_early_ms: 60000,
        max_carry_ms: null,
        max_late_ms: null,
        adjust_time_ms: 180000,
        goes_with: [],
        archived_at: null,
        routes: all.items.find((i) => i.item_id === 'MI-000')!.routes,
      },
    ]);
    expect(first.tax_classes).toEqual([
      { tax_class_id: 'TX-0', name: 'Old', rate_bp: 500, archived_at: 7 },
      { tax_class_id: 'TX-1', name: 'Standard', rate_bp: 1600, archived_at: null },
    ]);
    expect(first.categories).toEqual([
      { category_id: 'CT-0', name: 'Old', sort_order: 0, archived_at: 9, availability_windows: [], goes_with: [] },
      { category_id: 'CT-1', name: 'Mains', sort_order: 1, archived_at: null, availability_windows: [], goes_with: [] },
      {
        category_id: 'CT-2',
        name: 'Breakfast',
        sort_order: 2,
        archived_at: null,
        availability_windows: [
          { start_ms: 3600000, end_ms: 7200000 },
          { start_ms: 25200000, end_ms: 46800000 },
        ],
        goes_with: [],
      },
    ]);
  });

  it('[01a §10 #138] menu pages: keyset order, inserts and renames between pages, search, filters, 400s, 8 statements', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ id: `MI-${pad(119 - i)}`, name: nameOf(i) }));
    await addItems(rows);
    const expected = rows.map((r) => ({ item_id: r.id, name: r.name })).sort(byKey);

    // three pages of 50, 50, 20; each exactly once, in (lower(name), item_id) order
    const seen: MenuItem[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const p: MenuPage = await page(`?limit=50${cursor !== null ? `&cursor=${cursor}` : ''}`);
      expect(counter.count).toBe(8);
      sizes.push(p.items.length);
      seen.push(...p.items);
      cursor = p.next_cursor;
    } while (cursor !== null);
    expect(sizes).toEqual([50, 50, 20]);
    expect(seen.map((i) => i.item_id)).toEqual(expected.map((i) => i.item_id));

    // an item created between pages with a name before the cursor never appears later; no item repeats
    const p1 = await page('?limit=50');
    await addItems([{ id: 'MI-NEW', name: 'aaa000' }]);
    const p2 = await page(`?limit=50&cursor=${p1.next_cursor}`);
    const p3 = await page(`?limit=50&cursor=${p2.next_cursor}`);
    const later = [...p2.items, ...p3.items].map((i) => i.item_id);
    expect(later).not.toContain('MI-NEW');
    expect(new Set([...p1.items, ...p2.items, ...p3.items].map((i) => i.item_id)).size).toBe(120);
    expect(p3.next_cursor).toBeNull();
    await cloud.pool.query(`DELETE FROM menu_items WHERE item_id = 'MI-NEW'`);

    // a rename across the cursor may repeat a row; the page de-duplicates by item_id (review 2 nit 3)
    const q1 = await page('?limit=50');
    const moved = q1.items[0]!.item_id;
    await cloud.pool.query(`UPDATE menu_items SET name = 'zzz999' WHERE item_id = $1`, [moved]);
    const rest: MenuItem[] = [];
    cursor = q1.next_cursor;
    while (cursor !== null) {
      const p: MenuPage = await page(`?limit=50&cursor=${cursor}`);
      rest.push(...p.items);
      cursor = p.next_cursor;
    }
    const ids = [...q1.items, ...rest].map((i) => i.item_id);
    expect(ids.filter((id) => id === moved)).toHaveLength(2);
    expect(new Set(ids).size).toBe(120);

    // search: name and the variant group's name (01c §6.3), case-insensitive; %, _ and \ match themselves
    await cloud.pool.query(
      `INSERT INTO variant_groups (tenant_id, variant_group_id, category_id, name, created_at, updated_at)
       VALUES ($1, 'VG-K', 'CT-2', 'KARAHI', 0, 0)`,
      [f.tenantId],
    );
    await addItems([
      { id: 'K-1', name: 'Chicken Karahi Half', category: 'CT-2' },
      { id: 'K-2', name: 'Mutton Full', group: 'VG-K', category: 'CT-2' },
      { id: 'P-1', name: 'Deal 50% off' },
      { id: 'P-2', name: 'Deal 500 off' },
      { id: 'U-1', name: 'a_b' },
      { id: 'U-2', name: 'axb' },
      { id: 'S-1', name: 'back\\slash' },
      { id: 'X-1', name: 'Old karahi', archived: true },
    ]);
    const search = async (query: string) => (await page(query)).items.map((i) => i.item_id).sort();
    expect(await search('?q=karahi')).toEqual(['K-1', 'K-2']);
    expect(counter.count).toBe(8);
    expect(await search(`?q=${encodeURIComponent('50%')}`)).toEqual(['P-1']);
    expect(await search(`?q=${encodeURIComponent('a_b')}`)).toEqual(['U-1']);
    expect(await search(`?q=${encodeURIComponent('k\\s')}`)).toEqual(['S-1']);
    expect(await search('?status=archived')).toEqual(['X-1']);
    expect(await search('?status=archived&q=karahi')).toEqual(['X-1']);
    expect(await search('?category_id=CT-2')).toEqual(['K-1', 'K-2']);

    for (const query of ['?limit=201', '?limit=0', '?status=deleted', '?cursor=garbage!!', `?cursor=${Buffer.from('[1]').toString('base64url')}`]) {
      const bad = await get(query);
      expect(bad.statusCode, query).toBe(400);
      expect(bad.json().error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('[01a §10 #139] can_edit_tenant: owner with every branch → true; owner row limited to A → false', async () => {
    const [a] = f.branches;
    expect((await page('')).can_edit_tenant).toBe(true);
    // the database row decides, not the token
    expect((await page('', f.tokenFor([a]))).can_edit_tenant).toBe(true);
    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      f.tenantId,
      f.userId,
      [a],
    ]);
    expect((await page('', f.tokenFor([a]))).can_edit_tenant).toBe(false);
    expect((await page('')).can_edit_tenant).toBe(false);
  });
});
