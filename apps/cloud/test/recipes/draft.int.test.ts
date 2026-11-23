import type { DraftSaved, RecipeCreated, RecipeVersionWire } from '@pos/events';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStockItem } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { recipeFixture, type RecipeFixture } from './fixtures';

// Every statement's SQL text, in order (BEGIN / COMMIT / ROLLBACK left out, as pgCounter): the §6 lock order
// ("owner read FOR SHARE before the line stock items") is asserted on it.
function statementLog(pool: pg.Pool): { readonly sql: string[]; reset(): void } {
  const sql: string[] = [];
  const wrapped = new WeakSet<pg.PoolClient>();
  pool.on('acquire', (client) => {
    if (wrapped.has(client)) return;
    wrapped.add(client);
    const original = client.query.bind(client) as (...args: unknown[]) => unknown;
    (client as { query: unknown }).query = (...args: unknown[]) => {
      const first = args[0];
      const text = typeof first === 'string' ? first : ((first as { text?: string } | undefined)?.text ?? '');
      if (!/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(text)) sql.push(text.replace(/\s+/g, ' ').trim());
      return original(...args);
    };
  });
  return {
    sql,
    reset() {
      sql.length = 0;
    },
  };
}

// 08 v1.1 Part B §6.4: PUT /v1/admin/recipes/:recipe_id/draft — §6.4 edges, M-7 AP default, frozen quantities, the
// 10^15 range, basis / measure_unit from the locked owner (B3, T-1, T-2), 17 statements (16 for a stock-item owner),
// owner FOR SHARE before the line stock items, archived recipe accepted, stale 409, afterRecipeLock.
describe('08b recipe draft save (§6.4)', () => {
  let cloud: TestCloud;
  let counter: ReturnType<typeof pgCounter>;
  let log: ReturnType<typeof statementLog>;
  let fx: RecipeFixture;
  const hooked: string[] = [];

  beforeAll(async () => {
    cloud = await createTestCloud({
      testHooks: {
        handlerStart: () => {
          counter.reset();
          log.reset();
        },
        afterRecipeLock: async (route) => {
          hooked.push(route);
          hooked.push(`after:${log.sql.length}`);
        },
      },
    });
    counter = pgCounter(cloud.pool);
    log = statementLog(cloud.pool);
    await cloud.app.ready();
    fx = await recipeFixture(cloud);
  });
  afterAll(async () => {
    await cloud.close();
  });

  const create = async (owner_type: string, owner_id: string) => {
    const response = await cloud.app.inject({ method: 'POST', url: '/v1/admin/recipes', ...owner(fx.f), payload: { owner_type, owner_id } });
    expect(response.statusCode, response.body).toBe(201);
    const data = response.json().data as RecipeCreated;
    return { recipe: { ...data.recipe, recipe_id: data.recipe.recipe_id! }, draft: data.draft };
  };
  const put = (recipeId: string, payload: object) =>
    cloud.app.inject({ method: 'PUT', url: `/v1/admin/recipes/${recipeId}/draft`, headers: owner(fx.f).headers, payload });
  const saved = async (recipeId: string, payload: object, statements = 17) => {
    const response = await put(recipeId, payload);
    expect(response.statusCode, response.body).toBe(200);
    expect(counter.count).toBe(statements);
    return (response.json().data as DraftSaved).draft;
  };
  const expect422 = (response: Awaited<ReturnType<typeof put>>, field: string, reason: string) => {
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field, reason } });
  };
  const storedLines = async (versionId: string) =>
    (
      await cloud.pool.query(
        `SELECT line_no, stock_item_id, unit_name, entered_num::text, entered_den::text, stock_qty_num::text, stock_qty_den::text, stock_unit, qty_basis
           FROM recipe_lines WHERE tenant_id = $1 AND recipe_version_id = $2 ORDER BY line_no`,
        [fx.f.tenantId, versionId],
      )
    ).rows;
  const line = (draft: RecipeVersionWire, stockItemId: string) => draft.lines.find((l) => l.stock_item_id === stockItemId)!;
  const warningsOf = (draft: RecipeVersionWire, code: string) =>
    draft.warnings
      .filter((w) => w.code === code)
      .map((w) => w.line_no)
      .sort();
  const configVersions = async () =>
    (await cloud.pool.query<{ v: string }>(`SELECT config_version::text AS v FROM branches WHERE tenant_id = $1 ORDER BY branch_id`, [fx.f.tenantId])).rows.map(
      (r) => r.v,
    );

  it('[08b #12] "Tawa piece": beef EP (yield), onion / oil / makhan AP with no_yield_defaulted_ap (M-7), TP-1 AP; 17 statements; the menu item FOR SHARE before the line stock items; afterRecipeLock right after the recipe lock; audit; no bump', async () => {
    const { recipe, draft: v1 } = await create('menu_item', fx.items.tawaPiece);
    const before = await configVersions();
    hooked.length = 0;
    const draft = await saved(recipe.recipe_id, {
      expected_version: v1.version,
      lines: [
        { stock_item_id: fx.stock.beef, unit_name: 'g', qty: '250' },
        { stock_item_id: fx.stock.tp1, unit_name: 'g', qty: '15' },
        { stock_item_id: fx.stock.oil, unit_name: 'ml', qty: '20' },
        { stock_item_id: fx.stock.onion, unit_name: 'g', qty: '30' },
        { stock_item_id: fx.stock.makhan, unit_name: 'G', qty: '10' },
      ],
    });
    expect(draft).toMatchObject({ recipe_version_id: v1.recipe_version_id, version_no: 1, status: 'draft', basis: 'per_unit', misc_allowance_bp: 500 });
    expect(draft.version).not.toBe(v1.version);
    expect(draft.lines.map((l) => [l.line_no, l.stock_item_id, l.qty, l.qty_basis])).toEqual([
      [1, fx.stock.beef, '250', 'EP'],
      [2, fx.stock.tp1, '15', 'AP'],
      [3, fx.stock.oil, '20', 'AP'],
      [4, fx.stock.onion, '30', 'AP'],
      [5, fx.stock.makhan, '10', 'AP'],
    ]);
    expect(line(draft, fx.stock.beef)).toMatchObject({ stock_item_name: 'Beef', kind: 'ingredient', unit_name: 'g' });
    expect(line(draft, fx.stock.tp1).kind).toBe('packet');
    expect(line(draft, fx.stock.makhan).unit_name).toBe('g'); // normalised (08a I3)
    // M-7 (n-4): onion, oil and makhan defaulted to AP; TP-1 is a packet (no yield applies), beef has a yield
    expect(warningsOf(draft, 'no_yield_defaulted_ap')).toEqual([3, 4, 5]);
    // onion has no price: its line is unknown, the draft partial; the known lines still cost
    expect(warningsOf(draft, 'no_menu_cost')).toEqual([4]);
    expect(line(draft, fx.stock.onion).line_cost).toEqual({ status: 'partial', minor: null, unknown_items: [fx.stock.onion] });
    // beef 250 g EP at Rs 1 500 / kg, yield 71.20 % → 250 × 150 000 / 1 000 × 10 000 / 7 120 minor = 52 668.54 → 52 669
    expect(line(draft, fx.stock.beef).line_cost).toEqual({ status: 'costed', minor: '52669', unknown_items: [] });
    // TP-1 15 g at Rs 300 / kg = 450; oil 20 ml at Rs 600 / l = 1 200; makhan 10 g at Rs 1 800 / kg = 1 800
    expect(line(draft, fx.stock.tp1).line_cost.minor).toBe('450');
    expect(line(draft, fx.stock.oil).line_cost.minor).toBe('1200');
    expect(line(draft, fx.stock.makhan).line_cost.minor).toBe('1800');
    // draft cost: (37 500 × 10 000 / 7 120 + 450 + 1 200 + 1 800) × 1.05 = 58 924.47… → 58 924 (rounded once)
    expect(draft.cost).toEqual({ status: 'partial', minor: '58924', unknown_items: [fx.stock.onion] });

    // lock order (§6 kinds 0.5 → 4 → 5): recipe FOR UPDATE, the hook, then the owner menu item FOR SHARE, then the
    // stock items in one = ANY statement
    const recipeLock = log.sql.findIndex((s) => /FROM recipes .*FOR UPDATE/.test(s));
    const ownerLock = log.sql.findIndex((s) => /FROM menu_items .*FOR SHARE/.test(s));
    const stockLock = log.sql.findIndex((s) => /FROM stock_items .*= ANY.*FOR SHARE/.test(s));
    expect(recipeLock).toBeGreaterThanOrEqual(0);
    expect(ownerLock).toBeGreaterThan(recipeLock);
    expect(stockLock).toBeGreaterThan(ownerLock);
    expect(log.sql.filter((s) => /FOR SHARE/.test(s))).toHaveLength(2);
    expect(hooked).toEqual(['PUT /v1/admin/recipes/:recipe_id/draft', `after:${recipeLock + 1}`]);

    expect(await storedLines(draft.recipe_version_id)).toEqual([
      { line_no: 1, stock_item_id: fx.stock.beef, unit_name: 'g', entered_num: '250', entered_den: '1', stock_qty_num: '250', stock_qty_den: '1', stock_unit: 'g', qty_basis: 'EP' },
      { line_no: 2, stock_item_id: fx.stock.tp1, unit_name: 'g', entered_num: '15', entered_den: '1', stock_qty_num: '15', stock_qty_den: '1', stock_unit: 'g', qty_basis: 'AP' },
      { line_no: 3, stock_item_id: fx.stock.oil, unit_name: 'ml', entered_num: '20', entered_den: '1', stock_qty_num: '20', stock_qty_den: '1', stock_unit: 'ml', qty_basis: 'AP' },
      { line_no: 4, stock_item_id: fx.stock.onion, unit_name: 'g', entered_num: '30', entered_den: '1', stock_qty_num: '30', stock_qty_den: '1', stock_unit: 'g', qty_basis: 'AP' },
      { line_no: 5, stock_item_id: fx.stock.makhan, unit_name: 'g', entered_num: '10', entered_den: '1', stock_qty_num: '10', stock_qty_den: '1', stock_unit: 'g', qty_basis: 'AP' },
    ]);
    const audit = (
      await cloud.pool.query(`SELECT action, branch_id FROM config_audit WHERE tenant_id = $1 AND entity = 'recipe_version' AND entity_id = $2 ORDER BY at, audit_id`, [
        fx.f.tenantId,
        draft.recipe_version_id,
      ])
    ).rows;
    expect(audit).toEqual([
      { action: 'create', branch_id: null },
      { action: 'update', branch_id: null },
    ]);
    // B16: no bump on a draft save
    expect(await configVersions()).toEqual(before);

    // stale tab: the old version, or null while a draft exists → 409 CONFIG_STALE; nothing written
    const stale = await put(recipe.recipe_id, { expected_version: v1.version, lines: [] });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().error).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'recipe_version', id: draft.recipe_version_id } });
    const nullStale = await put(recipe.recipe_id, { expected_version: null, lines: [] });
    expect(nullStale.statusCode).toBe(409);
    expect(nullStale.json().error.code).toBe('CONFIG_STALE');
    expect(await storedLines(draft.recipe_version_id)).toHaveLength(5);

    // the current version replaces the draft (lines deleted and re-inserted)
    const again = await saved(recipe.recipe_id, { expected_version: draft.version, lines: [{ stock_item_id: fx.stock.beef, unit_name: 'kg', qty: '0.25', qty_basis: 'AP' }] });
    expect(again.lines.map((l) => [l.qty, l.unit_name, l.qty_basis])).toEqual([['0.25', 'kg', 'AP']]);
    expect(await storedLines(draft.recipe_version_id)).toEqual([
      { line_no: 1, stock_item_id: fx.stock.beef, unit_name: 'kg', entered_num: '1', entered_den: '4', stock_qty_num: '250', stock_qty_den: '1', stock_unit: 'g', qty_basis: 'AP' },
    ]);
  });

  it('[08b #12] explicit EP on onion (no yield) → 200, warning, cost partial (D9); ghee 0.92 l with l = 920 g → frozen 4232 / 5; misc and the response cost', async () => {
    const { recipe, draft: v1 } = await create('menu_item', fx.items.naan);
    const draft = await saved(recipe.recipe_id, {
      expected_version: v1.version,
      misc_allowance_bp: 0,
      lines: [
        { stock_item_id: fx.stock.onion, unit_name: 'g', qty: '30', qty_basis: 'EP' },
        { stock_item_id: fx.stock.ghee, unit_name: 'l', qty: '0.92' },
      ],
    });
    expect(draft.misc_allowance_bp).toBe(0);
    expect(line(draft, fx.stock.onion).qty_basis).toBe('EP');
    expect(warningsOf(draft, 'ep_no_yield')).toEqual([1]);
    expect(warningsOf(draft, 'no_yield_defaulted_ap')).toEqual([2]); // ghee has no yield
    expect(line(draft, fx.stock.ghee)).toMatchObject({ unit_name: 'l', qty: '0.92', qty_basis: 'AP' });
    // 846.4 g ghee at Rs 2 000 / kg = 169 280 minor; onion unknown → partial, the known part shown
    expect(draft.cost).toEqual({ status: 'partial', minor: '169280', unknown_items: [fx.stock.onion] });
    const stored = await storedLines(draft.recipe_version_id);
    expect(stored[1]).toMatchObject({ entered_num: '23', entered_den: '25', stock_qty_num: '4232', stock_qty_den: '5', stock_unit: 'g' });
  });

  it('[08b #12] plain option "No onion": −30 g onion → 200 (17 statements, the group FOR SHARE before the stock items); a negative line on a menu item → 422 negative_not_option', async () => {
    const { recipe, draft: v1 } = await create('modifier_option', fx.options.noOnion);
    const draft = await saved(recipe.recipe_id, { expected_version: v1.version, lines: [{ stock_item_id: fx.stock.onion, unit_name: 'g', qty: '-30' }] });
    expect(draft.lines).toMatchObject([{ qty: '-30', qty_basis: 'AP' }]);
    expect((await storedLines(draft.recipe_version_id))[0]).toMatchObject({ entered_num: '-30', stock_qty_num: '-30', stock_qty_den: '1' });
    const groupLock = log.sql.findIndex((s) => /FROM modifier_options .*modifier_groups.*FOR SHARE/.test(s));
    const stockLock = log.sql.findIndex((s) => /FROM stock_items .*= ANY.*FOR SHARE/.test(s));
    expect(groupLock).toBeGreaterThan(0);
    expect(stockLock).toBeGreaterThan(groupLock);

    const karahi = await create('menu_item', fx.items.chickenKarahi);
    expect422(
      await put(karahi.recipe.recipe_id, {
        expected_version: karahi.draft.version,
        base_qty: 1000,
        lines: [
          { stock_item_id: fx.stock.beef, unit_name: 'g', qty: '900' },
          { stock_item_id: fx.stock.onion, unit_name: 'g', qty: '-30' },
        ],
      }),
      'lines.1.qty',
      'negative_not_option',
    );
  });

  it('[08b #12] basis from the locked owner: batch_yield_qty on per_unit / base_qty off per_measure / per_measure without base_qty → 422 basis_mismatch; same stock item twice → 400; unknown / archived line item → 422; not convertible; |num| > 10^15 → 422 qty_out_of_range', async () => {
    const { recipe, draft: v1 } = await create('menu_item', fx.items.lassi);
    const lines = [{ stock_item_id: fx.stock.milk, unit_name: 'l', qty: '0.8' }];
    expect422(await put(recipe.recipe_id, { expected_version: v1.version, base_qty: 1000, batch_yield_qty: 10, lines }), 'batch_yield_qty', 'basis_mismatch');
    expect422(await put(recipe.recipe_id, { expected_version: v1.version, lines }), 'base_qty', 'basis_mismatch');
    const paye = await create('menu_item', fx.items.payeHalf);
    expect422(await put(paye.recipe.recipe_id, { expected_version: paye.draft.version, base_qty: 1000, lines: [] }), 'base_qty', 'basis_mismatch');

    // same stock item twice → 400 (body shape)
    const twice = await put(recipe.recipe_id, { expected_version: v1.version, base_qty: 1000, lines: [...lines, ...lines] });
    expect(twice.statusCode).toBe(400);
    expect(twice.json().error.code).toBe('VALIDATION_FAILED');
    const zero = await put(recipe.recipe_id, { expected_version: v1.version, base_qty: 1000, lines: [{ stock_item_id: fx.stock.milk, unit_name: 'ml', qty: '0.0' }] });
    expect(zero.statusCode).toBe(400);

    expect422(
      await put(recipe.recipe_id, { expected_version: v1.version, base_qty: 1000, lines: [...lines, { stock_item_id: 'NO-SUCH-ITEM', unit_name: 'g', qty: '1' }] }),
      'lines.1.stock_item_id',
      'not_found',
    );
    const old = await createStockItem(cloud, fx.f, { name: 'Old dahi', stock_unit: 'g', carries_over: false }, { archived: true });
    expect422(
      await put(recipe.recipe_id, { expected_version: v1.version, base_qty: 1000, lines: [{ stock_item_id: old.stock_item_id, unit_name: 'g', qty: '200' }] }),
      'lines.0.stock_item_id',
      'archived',
    );
    // kg on milk (ml) does not resolve (08a I5)
    expect422(await put(recipe.recipe_id, { expected_version: v1.version, base_qty: 1000, lines: [{ stock_item_id: fx.stock.milk, unit_name: 'kg', qty: '1' }] }), 'lines.0.unit_name', 'not_convertible');

    // 999 999.9999 × (999 999 937 g per drum) → |stock_qty_num| ≈ 10^19 > 10^15
    const drum = await cloud.app.inject({ method: 'POST', url: `/v1/admin/stock-items/${fx.stock.makhan}/units`, ...owner(fx.f), payload: { unit_name: 'drum', factor_num: 999_999_937 } });
    expect(drum.statusCode, drum.body).toBe(201);
    expect422(
      await put(recipe.recipe_id, { expected_version: v1.version, base_qty: 1000, lines: [{ stock_item_id: fx.stock.makhan, unit_name: 'drum', qty: '999999.9999' }] }),
      'lines.0.qty',
      'qty_out_of_range',
    );
    // nothing written by any refusal
    expect(await storedLines(v1.recipe_version_id)).toEqual([]);

    // the valid save: per_measure, base_qty 1000, measure_unit frozen from the locked owner (T-2)
    const draft = await saved(recipe.recipe_id, { expected_version: v1.version, base_qty: 1000, lines: [...lines, { stock_item_id: fx.stock.tp1, unit_name: 'g', qty: '200' }] });
    expect(draft).toMatchObject({ basis: 'per_measure', base_qty: 1000, measure_unit: 'ml', batch_yield_qty: null, batch_stock_unit: null });
    // 800 ml milk (AP, ml = the owner's sale_unit) is within ± 20 % of base_qty 1 000 → no main_line_off
    expect(warningsOf(draft, 'main_line_off')).toEqual([]);
    const off = await saved(recipe.recipe_id, { expected_version: draft.version, base_qty: 1000, lines: [{ stock_item_id: fx.stock.milk, unit_name: 'ml', qty: '700' }] });
    expect(warningsOf(off, 'main_line_off')).toEqual([undefined]); // a recipe-level warning (no line_no)
    // only lines whose stock unit is the owner's sale_unit are checked (n-4): a g-only lassi recipe warns nothing
    const grams = await saved(recipe.recipe_id, { expected_version: off.version, base_qty: 1000, lines: [{ stock_item_id: fx.stock.makhan, unit_name: 'g', qty: '50' }] });
    expect(warningsOf(grams, 'main_line_off')).toEqual([]);
  });

  it('[08b #12] prepared owner: 16 statements (owner read with the line stock items, kind 5, one = ANY in id order); per_batch freezes batch_stock_unit with batch_yield_qty; EP in a batch → ep_in_batch', async () => {
    const { recipe, draft: v1 } = await create('stock_item', fx.stock.payeCooked);
    const draft = await saved(
      recipe.recipe_id,
      {
        expected_version: v1.version,
        batch_yield_qty: 160,
        misc_allowance_bp: 0,
        lines: [
          { stock_item_id: fx.stock.payeRaw, unit_name: 'kg', qty: '20' },
          { stock_item_id: fx.stock.ghee, unit_name: 'g', qty: '500', qty_basis: 'EP' },
        ],
      },
      16,
    );
    expect(draft).toMatchObject({ basis: 'per_batch', batch_yield_qty: '160', batch_stock_unit: 'piece', base_qty: null, measure_unit: null });
    // D7: per_batch → AP, even for paye raw with a yield
    expect(line(draft, fx.stock.payeRaw).qty_basis).toBe('AP');
    expect(warningsOf(draft, 'ep_in_batch')).toEqual([2]);
    const stockLocks = log.sql.filter((s) => /FOR SHARE/.test(s));
    expect(stockLocks).toHaveLength(1);
    expect(stockLocks[0]).toMatch(/FROM stock_items .*= ANY.*ORDER BY stock_item_id.*FOR SHARE/);

    // a per_batch draft without batch_yield_qty saves (publish needs it, B6)
    const unset = await saved(recipe.recipe_id, { expected_version: draft.version, lines: [] }, 16);
    expect(unset).toMatchObject({ batch_yield_qty: null, batch_stock_unit: null });
  });

  it('[08b #12] T-1: a draft on an ARCHIVED "Chicken karahi" whose sale_unit changed piece → g: with base_qty 1000 → 200 per_measure, measure_unit g (derived from the locked owner); without base_qty → 422 { field: base_qty, reason: basis_mismatch }; unknown recipe → 404', async () => {
    const piece = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/menu-items',
      ...owner(fx.f),
      payload: {
        category_id: fx.menu.categoryIds[0],
        tax_class_id: null,
        name: 'Chicken karahi (full)',
        price_minor: 200_000,
        sale_unit: 'piece',
        serve_mode: 'sync',
        cook_time_ms: 600_000,
        routes: [{ branch_id: fx.lakeCity, station_id: fx.menu.slotStationId }],
      },
    });
    expect(piece.statusCode, piece.body).toBe(201);
    const itemId = piece.json().data.item.item_id as string;
    const { recipe, draft: v1 } = await create('menu_item', itemId);
    expect(v1.basis).toBe('per_unit');
    // archive the recipe, then change the owner's sale_unit (nothing guards an archived recipe, B17)
    await cloud.pool.query(`UPDATE recipes SET archived_at = 1 WHERE tenant_id = $1 AND recipe_id = $2`, [fx.f.tenantId, recipe.recipe_id]);
    await cloud.pool.query(`UPDATE menu_items SET sale_unit = 'g', stock_unit = 'g' WHERE tenant_id = $1 AND item_id = $2`, [fx.f.tenantId, itemId]);

    const pieceOnly = { expected_version: v1.version, lines: [{ stock_item_id: fx.stock.beef, unit_name: 'g', qty: '1000', qty_basis: 'AP' }] };
    expect422(await put(recipe.recipe_id, pieceOnly), 'base_qty', 'basis_mismatch');
    const draft = await saved(recipe.recipe_id, { ...pieceOnly, base_qty: 1000 });
    expect(draft).toMatchObject({ basis: 'per_measure', base_qty: 1000, measure_unit: 'g' });
    const stored = (await cloud.pool.query(`SELECT basis, base_qty, measure_unit FROM recipe_versions WHERE tenant_id = $1 AND recipe_version_id = $2`, [fx.f.tenantId, draft.recipe_version_id])).rows;
    expect(stored).toEqual([{ basis: 'per_measure', base_qty: 1000, measure_unit: 'g' }]);
    // the recipe stays archived (its publish un-archives it, §6.5)
    const archived = (await cloud.pool.query(`SELECT archived_at FROM recipes WHERE tenant_id = $1 AND recipe_id = $2`, [fx.f.tenantId, recipe.recipe_id])).rows[0];
    expect(archived).toEqual({ archived_at: '1' });

    const missing = await put('NO-SUCH-RECIPE', { expected_version: null, lines: [] });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toMatchObject({ code: 'RECIPE_NOT_FOUND', details: { recipe_id: 'NO-SUCH-RECIPE' } });
  });

  it('[08b #12] expected_version null after the draft is gone creates version max + 1; a foreign branch_id → 404 before any SQL', async () => {
    const { recipe, draft: v1 } = await create('modifier_option', fx.options.spicy);
    // simulate a published v1 (publish is r2's route): the draft becomes published, no draft remains
    await cloud.pool.query(
      `UPDATE recipe_versions SET status = 'published', published_at = 1, published_by = created_by WHERE tenant_id = $1 AND recipe_version_id = $2`,
      [fx.f.tenantId, v1.recipe_version_id],
    );
    const stale = await put(recipe.recipe_id, { expected_version: v1.version, lines: [] });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.details).toEqual({ entity: 'recipe', id: recipe.recipe_id }); // no draft exists
    const v2 = await saved(recipe.recipe_id, { expected_version: null, lines: [] });
    expect(v2).toMatchObject({ version_no: 2, status: 'draft', cost: { status: 'costed', minor: '0' } });
    expect(v2.recipe_version_id).not.toBe(v1.recipe_version_id);

    const foreign = await cloud.app.inject({ method: 'PUT', url: `/v1/admin/recipes/${recipe.recipe_id}/draft?branch_id=NOT-MINE`, headers: owner(fx.f).headers, payload: { expected_version: v2.version, lines: [] } });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('BRANCH_NOT_FOUND');
    expect(counter.count).toBe(0);
  });
});
