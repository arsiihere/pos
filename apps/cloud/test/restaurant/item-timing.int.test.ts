import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

type Link = { source_kind: string; source_id: string; target_kind: string; target_id: string; excluded: boolean };

const KNOB_DEFAULTS = { weight_pct: 100, max_early_ms: 60_000, max_carry_ms: null, max_late_ms: null, adjust_time_ms: 180_000 };

describe('item timing knobs and goes-with links', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let menu: SeededMenu;
  let archived: NonNullable<SeededMenu['archived']>;
  let counter: ReturnType<typeof pgCounter>;
  let item: string;
  let otherItem: string;
  let category: string;
  let otherCategory: string;

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
    menu = await seedMenu(cloud.pool, f, { items: 6, archived: true });
    archived = menu.archived!;
    [item, otherItem] = menu.itemIds as [string, string];
    [category, otherCategory] = menu.categoryIds;
    await cloud.pool.query(
      `INSERT INTO categories (tenant_id, category_id, name, created_at, updated_at) VALUES ($1, 'CT-THEIRS', 'Theirs', 0, 0)`,
      [f.other.tenantId],
    );
    await cloud.pool.query(
      `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, created_at, updated_at)
       VALUES ($1, 'IT-THEIRS', 'CT-THEIRS', 'Theirs', 1000, 'immediate', 60000, 0, 0)`,
      [f.other.tenantId],
    );
  });

  const inject = (method: 'POST' | 'PATCH', url: string, payload: object) =>
    cloud.app.inject({ method, url, ...owner(f), payload });
  const patchItem = (id: string, payload: object) => inject('PATCH', `/v1/admin/menu-items/${id}`, payload);
  const patchCategory = (id: string, payload: object) => inject('PATCH', `/v1/admin/categories/${id}`, payload);
  const postItem = (o: object = {}) =>
    inject('POST', '/v1/admin/menu-items', {
      category_id: category,
      tax_class_id: menu.taxClassId,
      name: 'Mutton Karahi',
      price_minor: 120000,
      serve_mode: 'sync',
      cook_time_ms: 1_200_000,
      ...o,
    });
  const readMenu = async (query = '?limit=200') => {
    const response = await cloud.app.inject({ method: 'GET', url: `/v1/admin/menu${query}`, headers: owner(f).headers });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data as {
      categories: Array<{ category_id: string; goes_with: Link[]; availability_windows: unknown[] }>;
      items: Array<Record<string, unknown> & { item_id: string; goes_with: Link[] }>;
    };
  };
  const versions = async () =>
    (
      await cloud.pool.query<{ config_version: string }>(`SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`, [f.tenantId])
    ).rows.map((row) => Number(row.config_version));
  const audit = async (entity: 'menu_item' | 'category', id: string) =>
    (
      await cloud.pool.query<{ action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>(
        `SELECT action, before, after FROM config_audit WHERE entity = $1 AND entity_id = $2 ORDER BY at, audit_id`,
        [entity, id],
      )
    ).rows;
  const links = async (kind: 'category' | 'item', id: string) =>
    (
      await cloud.pool.query<Link & { link_id: string }>(
        `SELECT link_id, source_kind, source_id, target_kind, target_id, excluded FROM goes_with_links
          WHERE tenant_id = $1 AND source_kind = $2 AND source_id = $3 ORDER BY target_kind, target_id`,
        [f.tenantId, kind, id],
      )
    ).rows;
  const storedItem = async (id: string) => (await cloud.pool.query(`SELECT * FROM menu_items WHERE item_id = $1`, [id])).rows[0] as Record<string, unknown>;
  const link = (source_kind: string, source_id: string, target_kind: string, target_id: string, excluded = false): Link => ({
    source_kind,
    source_id,
    target_kind,
    target_id,
    excluded,
  });
  const noRow = ({ link_id: _id, ...row }: Link & { link_id: string }): Link => row;

  describe('[01a §6.15 A-11] the five knobs', () => {
    it('[01a §6.15 A-11] POST defaults the five knobs and returns them; the menu read and the row agree', async () => {
      const created = await postItem();
      expect(created.statusCode, created.body).toBe(201);
      const wire = created.json().data.item as Record<string, unknown> & { item_id: string };
      expect(wire).toMatchObject(KNOB_DEFAULTS);
      expect(wire.goes_with).toEqual([]);
      expect(await storedItem(wire.item_id)).toMatchObject(KNOB_DEFAULTS);
      expect((await readMenu()).items.find((i) => i.item_id === wire.item_id)).toMatchObject(KNOB_DEFAULTS);
      expect((await audit('menu_item', wire.item_id))[0]!.after).toMatchObject({ ...KNOB_DEFAULTS, goes_with: [] });
    });

    it('[01a §6.15 A-11] POST accepts all five knobs; out of range → 400', async () => {
      const knobs = { weight_pct: 250, max_early_ms: 0, max_carry_ms: 90_000, max_late_ms: 600_000, adjust_time_ms: 240_000 };
      const created = await postItem(knobs);
      expect(created.statusCode, created.body).toBe(201);
      expect(created.json().data.item).toMatchObject(knobs);
      expect(await storedItem(created.json().data.item.item_id)).toMatchObject(knobs);
      const bad = await postItem({ name: 'Too heavy', weight_pct: 1001 });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.code).toBe('VALIDATION_FAILED');
    });

    it.each([
      ['weight_pct', 10, 1000, 9, 1001],
      ['max_early_ms', 0, 3_600_000, -1, 3_600_001],
      ['max_carry_ms', 0, 600_000, -1, 600_001],
      ['max_late_ms', 0, 7_200_000, -1, 7_200_001],
      ['adjust_time_ms', 0, 3_600_000, -1, 3_600_001],
    ] as const)('[01a §6.15 A-11] PATCH %s: both range ends store, past either end → 400', async (knob, low, high, under, over) => {
      for (const value of [low, high]) {
        const ok = await patchItem(item, { [knob]: value });
        expect(ok.statusCode, ok.body).toBe(200);
        expect(ok.json().data.item[knob]).toBe(value);
        expect((await storedItem(item))[knob]).toBe(value);
      }
      const row = await storedItem(item);
      const v0 = await versions();
      for (const value of [under, over, 1.5, '100']) {
        const bad = await patchItem(item, { [knob]: value });
        expect(bad.statusCode, String(value)).toBe(400);
        expect(bad.json().error.code).toBe('VALIDATION_FAILED');
      }
      expect(await storedItem(item)).toEqual(row);
      expect(await versions()).toEqual(v0);
    });

    it('[01a §6.15 A-11] max_carry_ms and max_late_ms take null; the other three do not', async () => {
      const set = await patchItem(item, { max_carry_ms: 1000, max_late_ms: 2000 });
      expect(set.json().data.item).toMatchObject({ max_carry_ms: 1000, max_late_ms: 2000 });
      const cleared = await patchItem(item, { max_carry_ms: null, max_late_ms: null });
      expect(cleared.statusCode, cleared.body).toBe(200);
      expect(cleared.json().data.item).toMatchObject({ max_carry_ms: null, max_late_ms: null });
      for (const knob of ['weight_pct', 'max_early_ms', 'adjust_time_ms']) {
        expect((await patchItem(item, { [knob]: null })).statusCode, knob).toBe(400);
      }
    });

    it('[01a §6.15 A-11] last write wins, no expected_version (S23): each write audited and bumped; a same-value PATCH is a no-op', async () => {
      const v0 = await versions();
      const first = await patchItem(item, { weight_pct: 150, expected_version: 'stale' });
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json().data.item).not.toHaveProperty('version');
      const second = await patchItem(item, { weight_pct: 200, expected_version: 'stale' });
      expect(second.statusCode, second.body).toBe(200);
      expect((await storedItem(item)).weight_pct).toBe(200);
      expect(await versions()).toEqual(v0.map((v) => v + 2));
      const rows = await audit('menu_item', item);
      expect(rows.map((r) => r.action)).toEqual(['update', 'update']);
      expect(rows[1]!.before).toMatchObject({ weight_pct: 150 });
      expect(rows[1]!.after).toMatchObject({ weight_pct: 200 });

      const same = await patchItem(item, { weight_pct: 200 });
      expect(same.statusCode).toBe(200);
      expect(await audit('menu_item', item)).toHaveLength(2);
      expect(await versions()).toEqual(v0.map((v) => v + 2));
    });
  });

  describe('[01a §6.13 A-13] goes-with links', () => {
    it('[01a §6.13 A-13] category goes_with is a replace-list: one audit row with the list, every branch bumped once', async () => {
      const v0 = await versions();
      const set = await patchCategory(category, {
        goes_with: [
          { target_kind: 'item', target_id: otherItem },
          { target_kind: 'category', target_id: otherCategory, excluded: false },
        ],
      });
      expect(set.statusCode, set.body).toBe(200);
      const first = [link('category', category, 'category', otherCategory), link('category', category, 'item', otherItem)];
      expect(set.json().data.category.goes_with).toEqual(first);
      expect((await links('category', category)).map(noRow)).toEqual(first);
      expect(await versions()).toEqual(v0.map((v) => v + 1));
      const rows = await audit('category', category);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: 'update', before: { goes_with: [] }, after: { goes_with: first } });

      // replaced whole
      const replaced = await patchCategory(category, { goes_with: [{ target_kind: 'item', target_id: item }] });
      const second = [link('category', category, 'item', item)];
      expect(replaced.json().data.category.goes_with).toEqual(second);
      expect((await links('category', category)).map(noRow)).toEqual(second);
      const after = await audit('category', category);
      expect(after).toHaveLength(2);
      expect(after[1]).toMatchObject({ before: { goes_with: first }, after: { goes_with: second } });

      // [] clears; a PATCH without the field leaves the list
      await patchCategory(category, { goes_with: [{ target_kind: 'item', target_id: otherItem }] });
      const renamed = await patchCategory(category, { name: 'Karahi renamed' });
      expect(renamed.json().data.category.goes_with).toEqual([link('category', category, 'item', otherItem)]);
      const cleared = await patchCategory(category, { goes_with: [] });
      expect(cleared.json().data.category.goes_with).toEqual([]);
      expect(await links('category', category)).toEqual([]);
    });

    it('[01a §6.13 A-13] a list and a field in one PATCH: one transaction, one audit row, one bump', async () => {
      const v0 = await versions();
      const response = await patchItem(item, { weight_pct: 300, goes_with: [{ target_kind: 'item', target_id: otherItem }] });
      expect(response.statusCode, response.body).toBe(200);
      const rows = await audit('menu_item', item);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        before: { weight_pct: 100, goes_with: [] },
        after: { weight_pct: 300, goes_with: [link('item', item, 'item', otherItem)] },
      });
      expect(await versions()).toEqual(v0.map((v) => v + 1));
    });

    it('[01a §6.13 A-13] an unchanged list, in any order, is a no-op: no audit, no bump, the rows untouched', async () => {
      const list = [
        { target_kind: 'category', target_id: otherCategory },
        { target_kind: 'item', target_id: otherItem },
      ];
      await patchCategory(category, { goes_with: list });
      await patchItem(item, { goes_with: [...list, { target_kind: 'category', target_id: category, excluded: true }] });
      const v0 = await versions();
      const [c0, i0] = [await links('category', category), await links('item', item)];
      const [ac0, ai0] = [await audit('category', category), await audit('menu_item', item)];

      const sameCategory = await patchCategory(category, { goes_with: [...list].reverse() });
      expect(sameCategory.statusCode).toBe(200);
      expect(sameCategory.json().data.category.goes_with).toEqual(c0.map(noRow));
      const sameItem = await patchItem(item, {
        goes_with: [{ target_kind: 'category', target_id: category, excluded: true }, ...[...list].reverse()],
      });
      expect(sameItem.statusCode).toBe(200);
      expect(sameItem.json().data.item.goes_with).toEqual(i0.map(noRow));

      expect(await links('category', category)).toEqual(c0);
      expect(await links('item', item)).toEqual(i0);
      expect(await audit('category', category)).toEqual(ac0);
      expect(await audit('menu_item', item)).toEqual(ai0);
      expect(await versions()).toEqual(v0);

      // flipping excluded alone is a change
      const flipped = await patchItem(item, {
        goes_with: [...list, { target_kind: 'category', target_id: category, excluded: false }],
      });
      expect(flipped.json().data.item.goes_with).toContainEqual(link('item', item, 'category', category));
      expect(await versions()).toEqual(v0.map((v) => v + 1));
    });

    it('[01a §6.15 A-13] an item adds and excludes; excluded defaults to false; source comes from the path', async () => {
      const response = await patchItem(item, {
        goes_with: [
          { target_kind: 'item', target_id: otherItem, source_kind: 'category', source_id: 'IGNORED' },
          { target_kind: 'category', target_id: otherCategory, excluded: true },
        ],
      });
      expect(response.statusCode, response.body).toBe(200);
      const expected = [link('item', item, 'category', otherCategory, true), link('item', item, 'item', otherItem)];
      expect(response.json().data.item.goes_with).toEqual(expected);
      expect((await links('item', item)).map(noRow)).toEqual(expected);
      // an item may name its own category (an override of that category's default); only itself is refused
      const own = await patchItem(item, { goes_with: [{ target_kind: 'category', target_id: category, excluded: true }] });
      expect(own.statusCode, own.body).toBe(200);
    });

    it('[01a §6.13 A-13] excluded on a category, a repeated target and a self link → 400; nothing written', async () => {
      const v0 = await versions();
      const refused = async (call: Promise<{ statusCode: number; json(): { error: { code: string } } }>) => {
        const response = await call;
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe('VALIDATION_FAILED');
      };
      await refused(patchCategory(category, { goes_with: [{ target_kind: 'item', target_id: item, excluded: true }] }));
      const twice = [
        { target_kind: 'item', target_id: otherItem },
        { target_kind: 'item', target_id: otherItem, excluded: true },
      ];
      await refused(patchCategory(category, { goes_with: [twice[0]!, twice[0]!] }));
      await refused(patchItem(item, { goes_with: twice }));
      await refused(patchCategory(category, { goes_with: [{ target_kind: 'category', target_id: category }] }));
      await refused(patchItem(item, { goes_with: [{ target_kind: 'item', target_id: item }] }));
      await refused(patchItem(item, { goes_with: [{ target_kind: 'deal', target_id: otherItem }] }));
      await refused(patchItem(item, { goes_with: [{ target_kind: 'item' }] }));
      expect(await links('category', category)).toEqual([]);
      expect(await links('item', item)).toEqual([]);
      expect(await audit('category', category)).toEqual([]);
      expect(await audit('menu_item', item)).toEqual([]);
      expect(await versions()).toEqual(v0);
    });

    it('[01a §6.13 A-13] an id that is both an item and a category is two targets, not a repeat', async () => {
      await cloud.pool.query(
        `INSERT INTO categories (tenant_id, category_id, name, created_at, updated_at) VALUES ($1, $2, 'Same id', 0, 0)`,
        [f.tenantId, otherItem],
      );
      const response = await patchItem(item, {
        goes_with: [
          { target_kind: 'item', target_id: otherItem },
          { target_kind: 'category', target_id: otherItem },
        ],
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().data.item.goes_with).toHaveLength(2);
    });

    it.each([
      ['unknown item', 'item', (): string => 'IT-NOPE', 'not_found'],
      ['unknown category', 'category', (): string => 'CT-NOPE', 'not_found'],
      ['archived item', 'item', (): string => archived.itemId, 'archived'],
      ['archived category', 'category', (): string => archived.categoryId, 'archived'],
      ["another tenant's item", 'item', (): string => 'IT-THEIRS', 'not_found'],
      ["another tenant's category", 'category', (): string => 'CT-THEIRS', 'not_found'],
      ['a category id sent as an item', 'item', (): string => otherCategory, 'not_found'],
    ] as const)('[01a §6.13 A-13] target: %s → 422 at goes_with; nothing written', async (_name, kind, id, reason) => {
      const v0 = await versions();
      const row = await storedItem(item);
      const good = { target_kind: 'item', target_id: otherItem };
      const bad = { target_kind: kind, target_id: id() };
      const onItem = await patchItem(item, { price_minor: 5, goes_with: [good, bad] });
      expect(onItem.statusCode, onItem.body).toBe(422);
      expect(onItem.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'goes_with', reason } });
      const onCategory = await patchCategory(category, { name: 'Renamed', goes_with: [good, bad] });
      expect(onCategory.statusCode, onCategory.body).toBe(422);
      expect(onCategory.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'goes_with', reason } });
      expect(await storedItem(item)).toEqual(row);
      expect(await links('item', item)).toEqual([]);
      expect(await links('category', category)).toEqual([]);
      expect(await audit('menu_item', item)).toEqual([]);
      expect(await audit('category', category)).toEqual([]);
      expect(await versions()).toEqual(v0);
    });

    it('[01a §6.13 A-13] one row per source and target: the table refuses a repeat', async () => {
      await patchItem(item, { goes_with: [{ target_kind: 'item', target_id: otherItem }] });
      await expect(
        cloud.pool.query(
          `INSERT INTO goes_with_links (tenant_id, link_id, source_kind, source_id, target_kind, target_id, created_at, updated_at)
           VALUES ($1, 'LK-DUP', 'item', $2, 'item', $3, 0, 0)`,
          [f.tenantId, item, otherItem],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('[01a §6.14 A-13] POST takes no goes_with (PATCH only); POST and PATCH of a category answer the list', async () => {
      const created = await postItem({ goes_with: [{ target_kind: 'item', target_id: otherItem }] });
      expect(created.statusCode, created.body).toBe(201);
      expect(created.json().data.item.goes_with).toEqual([]);
      expect(await links('item', created.json().data.item.item_id)).toEqual([]);
      const category2 = await inject('POST', '/v1/admin/categories', { name: 'Drinks', goes_with: [{ target_kind: 'item', target_id: otherItem }] });
      expect(category2.statusCode, category2.body).toBe(201);
      expect(category2.json().data.category.goes_with).toEqual([]);
      expect(await links('category', category2.json().data.category.category_id)).toEqual([]);
    });

    it('[01a §6.11 A-13] the menu read returns both lists at 8 statements, for 1 and 6 linked items', async () => {
      await patchCategory(category, { goes_with: [{ target_kind: 'category', target_id: otherCategory }] });
      for (const source of menu.itemIds.slice(0, 5)) {
        await patchItem(source, {
          goes_with: [
            { target_kind: 'item', target_id: menu.itemIds[5]! },
            { target_kind: 'category', target_id: otherCategory, excluded: true },
          ],
        });
      }
      const one = await readMenu('?limit=1');
      expect(counter.count).toBe(8);
      expect(one.items).toHaveLength(1);
      const all = await readMenu();
      expect(counter.count).toBe(8);
      expect(all.items.find((i) => i.item_id === item)!.goes_with).toEqual([
        link('item', item, 'category', otherCategory, true),
        link('item', item, 'item', menu.itemIds[5]!),
      ]);
      expect(all.items.find((i) => i.item_id === menu.itemIds[5])!.goes_with).toEqual([]);
      expect(all.categories.find((c) => c.category_id === category)!.goes_with).toEqual([
        link('category', category, 'category', otherCategory),
      ]);
      expect(all.categories.find((c) => c.category_id === otherCategory)!.goes_with).toEqual([]);
      expect(all.items.find((i) => i.item_id === item)).toMatchObject(KNOB_DEFAULTS);
    });

    it('[01a §6.11 A-13] a category with windows and links answers each once; another tenant never sees the rows', async () => {
      // CT-2 is seeded with windows: the join's row count must not repeat a link
      await patchCategory(otherCategory, {
        availability_windows: [
          { start_ms: 3_600_000, end_ms: 7_200_000 },
          { start_ms: 25_200_000, end_ms: 46_800_000 },
        ],
        goes_with: [{ target_kind: 'item', target_id: item }],
      });
      const read = (await readMenu()).categories.find((c) => c.category_id === otherCategory)!;
      expect(read.availability_windows).toHaveLength(2);
      expect(read.goes_with).toEqual([link('category', otherCategory, 'item', item)]);
      const theirs = await cloud.app.inject({
        method: 'GET',
        url: '/v1/admin/menu',
        headers: { authorization: `Bearer ${f.other.token}` },
      });
      expect(theirs.statusCode).toBe(200);
      expect(theirs.body).not.toContain(item);
    });

    it('[01a §6.15 A-13] archiving a linked item or category leaves the rows (the builder drops them later)', async () => {
      await patchCategory(otherCategory, { goes_with: [{ target_kind: 'item', target_id: otherItem }] });
      await patchItem(item, { goes_with: [{ target_kind: 'item', target_id: otherItem }] });
      const archivedTarget = await patchItem(otherItem, { archived: true });
      expect(archivedTarget.statusCode, archivedTarget.body).toBe(200);
      const archivedSource = await patchItem(item, { archived: true });
      expect(archivedSource.statusCode, archivedSource.body).toBe(200);
      expect(archivedSource.json().data.item.goes_with).toEqual([link('item', item, 'item', otherItem)]);
      expect((await links('item', item)).map(noRow)).toEqual([link('item', item, 'item', otherItem)]);
      expect((await links('category', otherCategory)).map(noRow)).toEqual([link('category', otherCategory, 'item', otherItem)]);
      const read = await readMenu('?status=archived&limit=200');
      expect(read.items.find((i) => i.item_id === item)!.goes_with).toEqual([link('item', item, 'item', otherItem)]);
    });

    it('[01a §6.15 A-13] the PATCH statement count does not grow with the list', async () => {
      await patchItem(item, { goes_with: [{ target_kind: 'item', target_id: menu.itemIds[1]! }] });
      counter.reset();
      expect((await patchItem(item, { goes_with: [{ target_kind: 'item', target_id: menu.itemIds[2]! }] })).statusCode).toBe(200);
      const small = counter.count;
      counter.reset();
      const many = await patchItem(item, {
        goes_with: [
          ...menu.itemIds.slice(2, 5).map((id) => ({ target_kind: 'item', target_id: id })),
          { target_kind: 'category', target_id: otherCategory },
        ],
      });
      expect(many.statusCode, many.body).toBe(200);
      expect(counter.count).toBe(small);
    });
  });
});
