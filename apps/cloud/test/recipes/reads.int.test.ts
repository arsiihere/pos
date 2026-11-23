import type { CostWire, DraftSaved, RecipeCreated, RecipeDetailData, RecipeListData, RecipeSummaryWire } from '@pos/events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVariantGroup, createStockItem } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { recipeFixture, type RecipeFixture } from './fixtures';

// 08 v1.1 Part B §6.1 (Recipes page + coverage, B14) and §6.2 (detail): 9 / 11 fixed statements, plate cost per row
// through the engine on the cost context (selectPriceCandidates at now, the owner's branch, B12), rounded once.
// Publish is r2's (not merged here): published versions are made by flipping a saved draft by SQL.
describe('08b recipe reads (§6.1, §6.2)', () => {
  let cloud: TestCloud;
  let counter: ReturnType<typeof pgCounter>;
  let fx: RecipeFixture;
  const recipe: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let ownerName = '';

  const create = async (owner_type: string, owner_id: string) => {
    const response = await cloud.app.inject({ method: 'POST', url: '/v1/admin/recipes', ...owner(fx.f), payload: { owner_type, owner_id } });
    expect(response.statusCode, response.body).toBe(201);
    const data = response.json().data as RecipeCreated;
    return { recipeId: data.recipe.recipe_id!, draft: data.draft };
  };
  const saveDraft = async (recipeId: string, payload: object) => {
    const response = await cloud.app.inject({ method: 'PUT', url: `/v1/admin/recipes/${recipeId}/draft`, headers: owner(fx.f).headers, payload });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json().data as DraftSaved).draft;
  };
  // r2's publish is not merged: the draft becomes the published version by SQL (published_at = the cloud's now)
  const publishBySql = (versionId: string) =>
    cloud.pool.query(`UPDATE recipe_versions SET status = 'published', published_at = $3, published_by = $4 WHERE tenant_id = $1 AND recipe_version_id = $2`, [
      fx.f.tenantId,
      versionId,
      cloud.clock.branchNow() - 1,
      fx.f.userId,
    ]);
  const withRecipe = async (owner_type: string, owner_id: string, draft: object | null, publish = true) => {
    const created = await create(owner_type, owner_id);
    const saved = draft === null ? created.draft : await saveDraft(created.recipeId, { expected_version: created.draft.version, ...draft });
    if (publish) await publishBySql(saved.recipe_version_id);
    return created.recipeId;
  };
  const archive = (table: 'recipes' | 'menu_items' | 'stock_items', idColumn: string, id: string) =>
    cloud.pool.query(`UPDATE ${table} SET archived_at = 1 WHERE tenant_id = $1 AND ${idColumn} = $2`, [fx.f.tenantId, id]);
  const menuItem = async (name: string, extra: object = {}) => {
    const response = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/menu-items',
      ...owner(fx.f),
      payload: {
        category_id: fx.menu.categoryIds[0],
        tax_class_id: null,
        name,
        price_minor: 50_000,
        serve_mode: 'sync',
        cook_time_ms: 600_000,
        routes: [{ branch_id: fx.lakeCity, station_id: fx.menu.slotStationId }],
        ...extra,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json().data.item as { item_id: string }).item_id;
  };
  const line = (stock_item_id: string, qty: string, unit_name = 'g') => ({ stock_item_id, qty, unit_name });

  beforeAll(async () => {
    cloud = await createTestCloud({ testHooks: { handlerStart: () => counter.reset() } });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
    fx = await recipeFixture(cloud);
    ownerName = (await cloud.pool.query<{ n: string }>(`SELECT display_name AS n FROM owner_users WHERE tenant_id = $1 AND user_id = $2`, [fx.f.tenantId, fx.f.userId]))
      .rows[0]!.n;

    // makhan Rs 1 800 / kg every branch; at Lake City a newer market rate Rs 2 000 / kg (B12: the owner picks the branch)
    const rate = await cloud.app.inject({
      method: 'POST',
      url: `/v1/admin/stock-items/${fx.stock.makhan}/prices`,
      ...owner(fx.f),
      payload: { kind: 'market_rate', branch_id: fx.lakeCity, unit_name: 'kg', price_minor: 200_000 },
    });
    expect(rate.statusCode, rate.body).toBe(201);

    // variants count (B14): "Mutton karahi" Half (recipe) and Full (none)
    const group = await createVariantGroup(cloud, fx.f, { name: 'Mutton karahi', category_id: fx.menu.categoryIds[0] });
    ids.half = await menuItem('Mutton karahi Half', { variant_group_id: group.variant_group_id, variant_name: 'Half' });
    ids.full = await menuItem('Mutton karahi Full', { variant_group_id: group.variant_group_id, variant_name: 'Full' });
    ids.oldKebab = await menuItem('Old kebab');
    ids.gone = await menuItem('Gone item');

    // menu items
    recipe.tawa = await withRecipe('menu_item', fx.items.tawaPiece, { lines: [line(fx.stock.makhan, '100')] }); // 18 000 × 1.05
    recipe.karahi = await withRecipe('menu_item', fx.items.chickenKarahi, { base_qty: 1000, lines: [line(fx.stock.makhan, '1000')] });
    recipe.half = await withRecipe('menu_item', ids.half, { lines: [line(fx.stock.makhan, '50')] });
    recipe.naan = await withRecipe('menu_item', fx.items.naan, { lines: [line(fx.stock.onion, '10'), line(fx.stock.makhan, '10')] }); // onion: no price
    recipe.lassi = await withRecipe('menu_item', fx.items.lassi, null, false); // draft only
    recipe.oldKebab = await withRecipe('menu_item', ids.oldKebab, { lines: [line(fx.stock.makhan, '10')] });
    await archive('menu_items', 'item_id', ids.oldKebab); // an archived owner with a recipe is listed
    await archive('menu_items', 'item_id', ids.gone); // an archived owner without one is not
    // options: "Spicy" — empty recipe published (costed 0); "No onion" none; "Extra naan" linked (never listed)
    recipe.spicy = await withRecipe('modifier_option', fx.options.spicy, null);
    // prepared owners: PAYE-COOKED batch of 4 (Rs 800 → Rs 200 a piece, no misc as a line, B5); QEEMA-COOKED
    // archived after its recipe (n-3); BIRYANI-COOKED active without a recipe
    recipe.payeCooked = await withRecipe('stock_item', fx.stock.payeCooked, { batch_yield_qty: 4, lines: [line(fx.stock.payeRaw, '1000')] });
    ids.qeema = (await createStockItem(cloud, fx.f, { name: 'QEEMA-COOKED', stock_unit: 'g', carries_over: false })).stock_item_id;
    recipe.qeema = await withRecipe('stock_item', ids.qeema, { batch_yield_qty: 1000, lines: [line(fx.stock.beef, '1000')] });
    await archive('stock_items', 'stock_item_id', ids.qeema);
    ids.biryani = (await createStockItem(cloud, fx.f, { name: 'BIRYANI-COOKED', stock_unit: 'piece', carries_over: false })).stock_item_id;
    // Paye Half: published (1 PAYE-COOKED piece), then the recipe archived — archived recipes do not count (B14)
    recipe.payeHalf = await withRecipe('menu_item', fx.items.payeHalf, { lines: [line(fx.stock.payeCooked, '1', 'piece')] });
    await archive('recipes', 'recipe_id', recipe.payeHalf);
  });
  afterAll(async () => {
    await cloud.close();
  });

  const list = (query = '') => cloud.app.inject({ method: 'GET', url: `/v1/admin/recipes${query}`, headers: owner(fx.f).headers });
  const listed = async (query = '') => {
    const response = await list(query);
    expect(response.statusCode, response.body).toBe(200);
    expect(counter.count).toBe(9);
    return response.json().data as RecipeListData;
  };
  const rowOf = (data: RecipeListData, ownerId: string) => data.rows.find((r) => r.owner_id === ownerId);
  const costed = (minor: string) => ({ status: 'costed', minor, unknown_items: [] });
  const NO_RECIPE: CostWire = { status: 'no_recipe', minor: null, unknown_items: [] };

  it('[08b #19] §6.1 rows: active owners with or without a recipe, archived owners with one (incl. an archived prepared owner, n-3), order, plate cost per row; 9 statements; no setting field (n-10)', async () => {
    const data = await listed();
    expect(Object.keys(data).sort()).toEqual(['can_edit_tenant', 'coverage', 'rows']); // n-10: no `setting`
    expect(data.can_edit_tenant).toBe(true);

    // order: owner kind (menu items, options, stock items), then lower(name), id
    const kinds = data.rows.map((r) => r.owner_type);
    const firstOption = kinds.indexOf('modifier_option');
    const firstStock = kinds.indexOf('stock_item');
    expect(kinds).toEqual([...kinds].sort((a, b) => ['menu_item', 'modifier_option', 'stock_item'].indexOf(a) - ['menu_item', 'modifier_option', 'stock_item'].indexOf(b)));
    for (const group of [data.rows.slice(0, firstOption), data.rows.slice(firstOption, firstStock), data.rows.slice(firstStock)]) {
      const names = group.map((r) => r.owner_name.toLowerCase());
      expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    }

    // menu items: every active one (variants each), archived only with a recipe
    const activeItems = (
      await cloud.pool.query<{ item_id: string }>(`SELECT item_id FROM menu_items WHERE tenant_id = $1 AND archived_at IS NULL`, [fx.f.tenantId])
    ).rows.map((r) => r.item_id);
    expect(data.rows.filter((r) => r.owner_type === 'menu_item').map((r) => r.owner_id).sort()).toEqual([...activeItems, ids.oldKebab].sort());
    expect(rowOf(data, ids.gone)).toBeUndefined();

    // a 1-piece line: (makhan 100 g × Rs 180 / 100 g) × 1.05 = Rs 189 (every-branch price; no branch_id)
    expect(rowOf(data, fx.items.tawaPiece)).toMatchObject({
      recipe_id: recipe.tawa,
      owner_name: 'Tawa piece',
      owner_archived: false,
      archived: false,
      has_draft: false,
      published: { version_no: 1 },
      plate_cost: costed('18900'),
    });
    expect(rowOf(data, fx.items.tawaPiece)!.version).toEqual(expect.any(String));
    // per_measure: costed for base_qty in the sale unit (1 000 g): Rs 1 800 × 1.05
    expect(rowOf(data, fx.items.chickenKarahi)!.plate_cost).toEqual(costed('189000'));
    expect(rowOf(data, ids.half)!.plate_cost).toEqual(costed('9450'));
    // partial: the known part, labelled; onion named
    expect(rowOf(data, fx.items.naan)!.plate_cost).toEqual({ status: 'partial', minor: '1890', unknown_items: [fx.stock.onion] });
    // AD-16: no recipe → recipe_id / version null
    expect(rowOf(data, ids.full)).toEqual({
      recipe_id: null,
      owner_type: 'menu_item',
      owner_id: ids.full,
      owner_name: 'Mutton karahi Full',
      owner_archived: false,
      archived: false,
      has_draft: false,
      published: null,
      plate_cost: NO_RECIPE,
      version: null,
    } satisfies RecipeSummaryWire);
    // a draft only: no published version → no_recipe
    expect(rowOf(data, fx.items.lassi)).toMatchObject({ recipe_id: recipe.lassi, has_draft: true, published: null, plate_cost: NO_RECIPE });
    // an archived recipe: listed, archived, never costed (the cost context is non-archived)
    expect(rowOf(data, fx.items.payeHalf)).toMatchObject({ recipe_id: recipe.payeHalf, archived: true, published: { version_no: 1 }, plate_cost: NO_RECIPE });
    // an archived owner with a recipe
    expect(rowOf(data, ids.oldKebab)).toMatchObject({ recipe_id: recipe.oldKebab, owner_archived: true, archived: false, plate_cost: costed('1890') });

    // options: active plain ones; the linked one never
    expect(data.rows.filter((r) => r.owner_type === 'modifier_option').map((r) => r.owner_id).sort()).toEqual([fx.options.spicy, fx.options.noOnion].sort());
    expect(rowOf(data, fx.options.spicy)).toMatchObject({ recipe_id: recipe.spicy, plate_cost: costed('0') }); // empty option recipe: a known 0
    expect(rowOf(data, fx.options.noOnion)).toMatchObject({ recipe_id: null, plate_cost: NO_RECIPE });

    // stock items: active prepared ones, and the archived prepared owner with a recipe (n-3); never ingredients
    expect(data.rows.filter((r) => r.owner_type === 'stock_item').map((r) => r.owner_name)).toEqual(['BIRYANI-COOKED', 'PAYE-COOKED', 'QEEMA-COOKED']);
    // ⚠️ 08b B5 (AD-30): the batch cost, no misc: paye raw 1 000 g × Rs 80 / 100 g = Rs 800
    expect(rowOf(data, fx.stock.payeCooked)).toMatchObject({ recipe_id: recipe.payeCooked, plate_cost: costed('80000') });
    expect(rowOf(data, ids.biryani)).toMatchObject({ recipe_id: null, owner_archived: false, plate_cost: NO_RECIPE });
    // its owner is archived (not in the cost items): partial, never a value read as known-complete
    expect(rowOf(data, ids.qeema)).toMatchObject({ recipe_id: recipe.qeema, owner_name: 'QEEMA-COOKED', owner_archived: true, archived: false });
    expect(rowOf(data, ids.qeema)!.plate_cost.status).toBe('partial');
  });

  it('[08b #19] B14 coverage by count: variants count, options / stock items do not, archived recipes and draft-only recipes do not, archived items do not; pct_bp', async () => {
    const data = await listed();
    const total = (await cloud.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM menu_items WHERE tenant_id = $1 AND archived_at IS NULL`, [fx.f.tenantId])).rows[0]!
      .n;
    // Tawa piece, Chicken karahi, Mutton karahi Half, Naan (partial still has a published recipe)
    expect(data.coverage).toEqual({ items_total: total, items_with_recipe: 4, pct_bp: Math.floor((4 * 10_000) / total) });
  });

  it('[08b #19] filter missing | partial; branch_id picks the owner\'s branch prices (B12); a foreign branch → 404 BRANCH_NOT_FOUND before any SQL (C2)', async () => {
    const missing = await listed('?filter=missing');
    expect(missing.rows.length).toBeGreaterThan(0);
    expect(missing.rows.every((r) => r.plate_cost.status === 'no_recipe')).toBe(true);
    expect(missing.rows.map((r) => r.owner_id)).toEqual(expect.arrayContaining([ids.full, fx.items.lassi, fx.items.payeHalf, fx.options.noOnion, ids.biryani]));
    const all = await listed('?filter=all');
    expect(missing.coverage).toEqual(all.coverage); // coverage never depends on the filter
    const partial = await listed('?filter=partial');
    expect(partial.rows.map((r) => r.owner_id).sort()).toEqual([fx.items.naan, ids.qeema].sort());

    // Lake City: makhan's market rate Rs 2 000 / kg → Tawa (100 g) Rs 200 × 1.05
    const lake = await listed(`?branch_id=${fx.lakeCity}`);
    expect(rowOf(lake, fx.items.tawaPiece)!.plate_cost).toEqual(costed('21000'));
    const other = await listed(`?branch_id=${fx.f.branches[1]}`);
    expect(rowOf(other, fx.items.tawaPiece)!.plate_cost).toEqual(costed('18900'));

    const foreign = await list(`?branch_id=${fx.f.other.branchId}`);
    expect(foreign.statusCode, foreign.body).toBe(404);
    expect(foreign.json().error.code).toBe('BRANCH_NOT_FOUND');
    expect(counter.count).toBe(0);
    expect((await list('?filter=nope')).statusCode).toBe(400);
  });

  it('[08b #19] the count is fixed: one more menu item (with a published recipe) and one more plain option → still 9 statements', async () => {
    const before = await listed();
    const extraItem = await menuItem('Seekh kebab');
    recipe.seekh = await withRecipe('menu_item', extraItem, { lines: [line(fx.stock.makhan, '20')] });
    const group = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/modifier-groups',
      ...owner(fx.f),
      payload: { name: 'Extras', min_choices: 0, max_choices: 1, options: [{ name: 'Extra raita', price_minor: 5_000 }] },
    });
    expect(group.statusCode, group.body).toBe(201);
    const after = await listed(); // 9 statements, asserted in listed()
    expect(after.rows).toHaveLength(before.rows.length + 2);
    expect(after.coverage).toEqual({
      items_total: before.coverage.items_total + 1,
      items_with_recipe: before.coverage.items_with_recipe + 1,
      pct_bp: Math.floor(((before.coverage.items_with_recipe + 1) * 10_000) / (before.coverage.items_total + 1)),
    });
    expect(rowOf(after, extraItem)!.plate_cost).toEqual(costed('3780'));
  });

  const detail = (recipeId: string, query = '') => cloud.app.inject({ method: 'GET', url: `/v1/admin/recipes/${recipeId}${query}`, headers: owner(fx.f).headers });
  const detailed = async (recipeId: string, query = '') => {
    const response = await detail(recipeId, query);
    expect(response.statusCode, response.body).toBe(200);
    expect(counter.count).toBe(11);
    return response.json().data as RecipeDetailData;
  };

  it('[08b #20] §6.2 detail: recipe summary, published and draft versions with costs, history (newest first) with names; 11 statements; branch_id', async () => {
    // a new draft over the published v1 (B8): makhan 200 g
    const current = await detailed(recipe.tawa);
    expect(current.draft).toBeNull();
    const v2 = await saveDraft(recipe.tawa, { expected_version: null, lines: [line(fx.stock.makhan, '200')] });

    const data = await detailed(recipe.tawa);
    expect(Object.keys(data).sort()).toEqual(['can_edit_tenant', 'draft', 'history', 'published', 'recipe']);
    expect(data.can_edit_tenant).toBe(true);
    expect(data.recipe).toMatchObject({ recipe_id: recipe.tawa, owner_name: 'Tawa piece', has_draft: true, published: { version_no: 1 }, plate_cost: costed('18900') });
    expect(data.published).toMatchObject({
      version_no: 1,
      status: 'published',
      basis: 'per_unit',
      misc_allowance_bp: 500,
      cost: costed('18900'),
      created_by_name: ownerName,
      published_by_name: ownerName,
      lines: [{ line_no: 1, stock_item_id: fx.stock.makhan, stock_item_name: 'Makhan', kind: 'ingredient', unit_name: 'g', qty: '100', qty_basis: 'AP', line_cost: costed('18000') }],
    });
    expect(data.published!.published_at).toEqual(expect.any(Number));
    expect(data.draft).toMatchObject({ recipe_version_id: v2.recipe_version_id, version_no: 2, status: 'draft', cost: costed('37800'), published_by_name: null, version: v2.version });
    expect(data.history).toEqual([
      { recipe_version_id: v2.recipe_version_id, version_no: 2, status: 'draft', published_at: null, published_by_name: null },
      { recipe_version_id: data.published!.recipe_version_id, version_no: 1, status: 'published', published_at: data.published!.published_at, published_by_name: ownerName },
    ]);
    // the summary is the §6.1 row
    expect(data.recipe).toEqual(rowOf(await listed(), fx.items.tawaPiece));

    const lake = await detailed(recipe.tawa, `?branch_id=${fx.lakeCity}`);
    expect(lake.published!.cost).toEqual(costed('21000'));
    expect(lake.draft!.cost).toEqual(costed('42000'));
    expect(lake.recipe.plate_cost).toEqual(costed('21000'));

    // the count is fixed: v2 published by SQL (v1 superseded), a v3 draft → three history rows, still 11 statements
    await cloud.pool.query(`UPDATE recipe_versions SET status = 'superseded' WHERE tenant_id = $1 AND recipe_version_id = $2`, [
      fx.f.tenantId,
      data.published!.recipe_version_id,
    ]);
    await publishBySql(v2.recipe_version_id);
    const v3 = await saveDraft(recipe.tawa, { expected_version: null, lines: [line(fx.stock.makhan, '300')] });
    const three = await detailed(recipe.tawa); // 11 statements, asserted in detailed()
    expect(three.history.map((h) => [h.version_no, h.status])).toEqual([
      [3, 'draft'],
      [2, 'published'],
      [1, 'superseded'],
    ]);
    expect(three.draft!.recipe_version_id).toBe(v3.recipe_version_id);
    expect(three.published).toMatchObject({ recipe_version_id: v2.recipe_version_id, cost: costed('37800') });
  });

  it('[08b #20] §6.2 an archived recipe shows its published version (costed, sub-recipe through PAYE-COOKED) and no plate cost; a prepared owner; option', async () => {
    const paye = await detailed(recipe.payeHalf);
    expect(paye.recipe).toMatchObject({ archived: true, plate_cost: NO_RECIPE });
    expect(paye.draft).toBeNull();
    // 1 PAYE-COOKED piece = Rs 800 / 4 (batch, no misc as a line, B5) = Rs 200, × 1.05 at the top
    expect(paye.published).toMatchObject({ status: 'published', cost: costed('21000'), lines: [{ stock_item_name: 'PAYE-COOKED', kind: 'prepared', line_cost: costed('20000') }] });

    const batch = await detailed(recipe.payeCooked);
    // ⚠️ 08b B5 (AD-30): no misc on a batch, in the version wire and the row
    expect(batch.published).toMatchObject({ basis: 'per_batch', batch_yield_qty: '4', batch_stock_unit: 'piece', misc_allowance_bp: 500, cost: costed('80000') });
    expect(batch.recipe.plate_cost).toEqual(costed('80000'));

    const spicy = await detailed(recipe.spicy);
    expect(spicy.published).toMatchObject({ lines: [], cost: costed('0') });
    expect(spicy.history).toHaveLength(1);
  });

  it('[08b #20] §6.2 errors: unknown / foreign recipe → 404 RECIPE_NOT_FOUND; foreign branch → 404 BRANCH_NOT_FOUND before any SQL', async () => {
    const unknown = await detail('NO-SUCH-RECIPE');
    expect(unknown.statusCode, unknown.body).toBe(404);
    expect(unknown.json().error.code).toBe('RECIPE_NOT_FOUND');
    const foreign = await cloud.app.inject({ method: 'GET', url: `/v1/admin/recipes/${recipe.tawa}`, headers: { authorization: `Bearer ${fx.f.other.token}` } });
    expect(foreign.statusCode, foreign.body).toBe(404);
    expect(foreign.json().error.code).toBe('RECIPE_NOT_FOUND');
    const branch = await detail(recipe.tawa, `?branch_id=${fx.f.other.branchId}`);
    expect(branch.statusCode, branch.body).toBe(404);
    expect(branch.json().error.code).toBe('BRANCH_NOT_FOUND');
    expect(counter.count).toBe(0);
  });
});
