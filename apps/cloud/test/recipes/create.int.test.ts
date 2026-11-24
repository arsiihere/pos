import type { RecipeCreated } from '@pos/events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createModifierGroup, createStockItem } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { recipeFixture, type RecipeFixture } from './fixtures';

// 08 v1.1 Part B §6.3: POST /v1/admin/recipes (Idempotency-Key) — owner kinds (B2, B3), 8 statements, the conflict
// path 7 (t-2: ON CONFLICT DO NOTHING, then the existing id is read; stored 409; no draft insert, no audit), 2 audit
// rows in one insert, replay, no bump (B16).
describe('08b recipe create (§6.3)', () => {
  let cloud: TestCloud;
  let counter: ReturnType<typeof pgCounter>;
  let fx: RecipeFixture;

  beforeAll(async () => {
    cloud = await createTestCloud({ testHooks: { handlerStart: () => counter.reset() } });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
    fx = await recipeFixture(cloud);
  });
  afterAll(async () => {
    await cloud.close();
  });

  const post = (payload: object, headers = owner(fx.f).headers) => cloud.app.inject({ method: 'POST', url: '/v1/admin/recipes', headers, payload });
  const created = async (owner_type: string, owner_id: string) => {
    const response = await post({ owner_type, owner_id });
    expect(response.statusCode, response.body).toBe(201);
    expect(counter.count).toBe(8);
    return response.json().data as RecipeCreated;
  };
  const audit = async () =>
    (
      await cloud.pool.query<{ entity: string; entity_id: string; action: string; branch_id: string | null }>(
        `SELECT entity, entity_id, action, branch_id FROM config_audit WHERE tenant_id = $1 AND entity IN ('recipe', 'recipe_version') ORDER BY entity`,
        [fx.f.tenantId],
      )
    ).rows;
  const counts = async () =>
    (
      await cloud.pool.query<{ recipes: number; versions: number; audit: number }>(
        `SELECT (SELECT count(*)::int FROM recipes WHERE tenant_id = $1) AS recipes,
                (SELECT count(*)::int FROM recipe_versions WHERE tenant_id = $1) AS versions,
                (SELECT count(*)::int FROM config_audit WHERE tenant_id = $1 AND entity IN ('recipe', 'recipe_version')) AS audit`,
        [fx.f.tenantId],
      )
    ).rows[0]!;
  const configVersions = async () =>
    (await cloud.pool.query<{ v: string }>(`SELECT config_version::text AS v FROM branches WHERE tenant_id = $1 ORDER BY branch_id`, [fx.f.tenantId])).rows.map(
      (r) => r.v,
    );
  const expect422 = (response: Awaited<ReturnType<typeof post>>, reason: string) => {
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'owner_id', reason } });
  };

  it('[08b #13] owner kinds: piece → per_unit; g → per_measure 1000 g; ml → per_measure 1000 ml (f-4); prepared → per_batch (yield null); 8 statements; 2 audit rows; no bump', async () => {
    // "BIRYANI-COOKED" (prepared, piece = plate); created first (a stock-item POST bumps, B16)
    const biryani = await createStockItem(cloud, fx.f, { name: 'BIRYANI-COOKED', stock_unit: 'piece', carries_over: false });
    const before = await configVersions();

    const paye = await created('menu_item', fx.items.payeHalf);
    expect(paye.recipe).toMatchObject({
      owner_type: 'menu_item',
      owner_id: fx.items.payeHalf,
      owner_name: 'Paye Half',
      owner_archived: false,
      archived: false,
      has_draft: true,
      published: null,
      plate_cost: { status: 'no_recipe', minor: null, unknown_items: [] },
    });
    expect(paye.recipe.recipe_id).toEqual(expect.any(String));
    expect(paye.recipe.version).toEqual(expect.any(String));
    expect(paye.draft).toMatchObject({
      version_no: 1,
      status: 'draft',
      basis: 'per_unit',
      base_qty: null,
      measure_unit: null,
      batch_yield_qty: null,
      batch_stock_unit: null,
      misc_allowance_bp: 500,
      lines: [],
      published_by_name: null,
      published_at: null,
    });
    expect(paye.draft.created_by_name).toEqual(expect.any(String));
    // D9 / §3.2: an empty menu-item draft has no cost yet (never "costed 0")
    expect(paye.draft.cost).toEqual({ status: 'partial', minor: null, unknown_items: [] });
    expect(paye.draft.version).toEqual(expect.any(String));
    // §6.0: recipe / create + recipe_version / create, tenant-wide (branch_id null)
    expect(await audit()).toEqual([
      { entity: 'recipe', entity_id: paye.recipe.recipe_id, action: 'create', branch_id: null },
      { entity: 'recipe_version', entity_id: paye.draft.recipe_version_id, action: 'create', branch_id: null },
    ]);

    const karahi = await created('menu_item', fx.items.chickenKarahi);
    expect(karahi.draft).toMatchObject({ basis: 'per_measure', base_qty: 1000, measure_unit: 'g', batch_yield_qty: null });
    const lassi = await created('menu_item', fx.items.lassi);
    expect(lassi.draft).toMatchObject({ basis: 'per_measure', base_qty: 1000, measure_unit: 'ml' });

    // BIRYANI-COOKED and PAYE-COOKED: per_batch, batch_yield_qty null until set
    const biryaniRecipe = await created('stock_item', biryani.stock_item_id);
    expect(biryaniRecipe.recipe).toMatchObject({ owner_type: 'stock_item', owner_name: 'BIRYANI-COOKED' });
    expect(biryaniRecipe.draft).toMatchObject({ basis: 'per_batch', base_qty: null, measure_unit: null, batch_yield_qty: null, batch_stock_unit: null });
    expect(biryaniRecipe.draft.cost).toEqual({ status: 'partial', minor: null, unknown_items: [] });
    const payeCooked = await created('stock_item', fx.stock.payeCooked);
    expect(payeCooked.draft).toMatchObject({ basis: 'per_batch', batch_yield_qty: null });

    // a plain option → per_unit; an empty option recipe costs 0 and is known (t-6)
    const spicy = await created('modifier_option', fx.options.spicy);
    expect(spicy.recipe).toMatchObject({ owner_type: 'modifier_option', owner_name: 'Spicy' });
    expect(spicy.draft).toMatchObject({ basis: 'per_unit', cost: { status: 'costed', minor: '0', unknown_items: [] } });

    const rows = (
      await cloud.pool.query(
        `SELECT r.owner_id, v.version_no, v.status, v.basis, v.base_qty, v.measure_unit, v.batch_yield_qty, v.batch_stock_unit, v.misc_allowance_bp
           FROM recipes r JOIN recipe_versions v ON v.tenant_id = r.tenant_id AND v.recipe_id = r.recipe_id
          WHERE r.tenant_id = $1 AND r.owner_id = $2`,
        [fx.f.tenantId, fx.items.lassi],
      )
    ).rows;
    expect(rows).toEqual([
      { owner_id: fx.items.lassi, version_no: 1, status: 'draft', basis: 'per_measure', base_qty: 1000, measure_unit: 'ml', batch_yield_qty: null, batch_stock_unit: null, misc_allowance_bp: 500 },
    ]);
    expect(await counts()).toEqual({ recipes: 6, versions: 6, audit: 12 });
    // B16: recipe create bumps nothing
    expect(await configVersions()).toEqual(before);
  });

  it('[08b #13] refusals: packet TP-1 and raw beef → 422 wrong_kind; linked "Extra naan" → 422 linked_option; unknown owner → 422 not_found; nothing written', async () => {
    const before = await counts();
    expect422(await post({ owner_type: 'stock_item', owner_id: fx.stock.tp1 }), 'wrong_kind');
    expect422(await post({ owner_type: 'stock_item', owner_id: fx.stock.beef }), 'wrong_kind');
    expect422(await post({ owner_type: 'modifier_option', owner_id: fx.options.extraNaan }), 'linked_option');
    expect422(await post({ owner_type: 'menu_item', owner_id: 'NO-SUCH-ITEM' }), 'not_found');
    expect422(await post({ owner_type: 'modifier_option', owner_id: fx.items.naan }), 'not_found');
    expect422(await post({ owner_type: 'stock_item', owner_id: fx.items.naan }), 'not_found');
    // body shape → 400
    const bad = await post({ owner_type: 'deal', owner_id: fx.deal.dealId });
    expect(bad.statusCode).toBe(400);
    expect(await counts()).toEqual(before);
  });

  it('[08b #13] second recipe for the same owner → 409 CONFIG_IN_USE { used_by: { entity: recipe, ids: [existing] } } in 7 statements (t-2), no draft, no audit; the stored 409 replays; archived recipes count (one per owner, ever)', async () => {
    const first = await created('menu_item', fx.items.tawaPiece);
    const before = await counts();

    const headers = owner(fx.f).headers;
    const conflict = await post({ owner_type: 'menu_item', owner_id: fx.items.tawaPiece }, headers);
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(counter.count).toBe(7);
    expect(conflict.json().error).toMatchObject({ code: 'CONFIG_IN_USE', details: { used_by: { entity: 'recipe', ids: [first.recipe.recipe_id] } } });
    expect(await counts()).toEqual(before);

    // the stored key response: the same key replays the 409
    const replay = await post({ owner_type: 'menu_item', owner_id: fx.items.tawaPiece }, headers);
    expect(replay.statusCode).toBe(409);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(counter.count).toBe(2); // key insert (0 rows) + stored response read
    expect(replay.json().error).toMatchObject({ code: 'CONFIG_IN_USE', details: { used_by: { entity: 'recipe', ids: [first.recipe.recipe_id] } } });

    // an archived recipe still owns its owner
    await cloud.pool.query(`UPDATE recipes SET archived_at = 1 WHERE tenant_id = $1 AND recipe_id = $2`, [fx.f.tenantId, first.recipe.recipe_id]);
    const archived = await post({ owner_type: 'menu_item', owner_id: fx.items.tawaPiece });
    expect(archived.statusCode).toBe(409);
    expect(archived.json().error.details).toEqual({ used_by: { entity: 'recipe', ids: [first.recipe.recipe_id] } });
    expect(await counts()).toEqual(before);
  });

  it('[08b #13] retry with the same key → the stored 201 replayed, nothing written twice', async () => {
    const headers = owner(fx.f).headers;
    const payload = { owner_type: 'modifier_option', owner_id: fx.options.noOnion };
    const first = await post(payload, headers);
    expect(first.statusCode, first.body).toBe(201);
    const before = await counts();
    const again = await post(payload, headers);
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(counter.count).toBe(2); // key insert (0 rows) + stored response read
    expect(again.json()).toEqual(first.json());
    expect(await counts()).toEqual(before);
  });

  it('[08b #13] race: a §6.12 link committed while the create waits on the group lock → 422 linked_option (the option row is re-read under the lock, FOR SHARE OF g, o)', async () => {
    const group = await createModifierGroup(cloud, fx.f, { name: 'Sides', min_choices: 0, max_choices: 1, options: [{ name: 'Raita', price_minor: 5_000 }] });
    const raita = group.options[0]!.option_id;
    const writer = await cloud.pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query(`SELECT 1 FROM modifier_groups WHERE tenant_id = $1 AND modifier_group_id = $2 FOR UPDATE`, [fx.f.tenantId, group.modifier_group_id]);
      await writer.query(`UPDATE modifier_options SET linked_item_id = $3 WHERE tenant_id = $1 AND option_id = $2`, [fx.f.tenantId, raita, fx.items.naan]);
      const pending = post({ owner_type: 'modifier_option', owner_id: raita });
      // wait until the create blocks on the lock
      for (let i = 0; i < 200; i += 1) {
        const waiting = await cloud.pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        );
        if (waiting.rows[0]!.n > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await writer.query('COMMIT');
      expect422(await pending, 'linked_option');
    } finally {
      writer.release();
    }
    const recipes = await cloud.pool.query(`SELECT 1 FROM recipes WHERE tenant_id = $1 AND owner_id = $2`, [fx.f.tenantId, raita]);
    expect(recipes.rows).toHaveLength(0);
  });
});
