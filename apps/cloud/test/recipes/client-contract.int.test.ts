import {
  CreateRecipeResponse,
  InventoryDetailResponse,
  PatchRecipeBody,
  PatchRecipeResponse,
  PublishRecipeResponse,
  RecipeDetailResponse,
  RecipeListResponse,
  SaveDraftResponse,
  type InventoryDetail,
  type RecipeLineWire,
} from '@pos/events';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { owner } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { createCloudAdmin } from '../../../client/src/api/cloud-admin';
import { newDraftReason } from '../../../client/src/features/owner/recipes/refusals';
import { stockItem } from '../inventory/fixtures';
import { liveLineCost, livePlateCost, roundHalfAway } from '../../../client/src/features/owner/recipes/live-cost';
import { recipeFixture, type RecipeFixture } from './fixtures';

// 08b u1 (§8, §10.5): the owner app's recipe client (apps/client/src/api/cloud-admin.ts, features/owner/recipes) was
// built against the @pos/events wires with a fake fetch. This test drives the real routes list → create → draft →
// publish → detail and parses every answer with the same schemas, plus the refusal shapes the UI maps: 422
// CONFIG_REFERENCE_INVALID { field, reason } (lines.N.* with N the 0-based line index, AD-32), 409 CONFIG_STALE,
// 409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } } (create conflict → ids[0]; B17 guard). It also runs the
// browser's own live-cost module (apps/client/src/features/owner/recipes/live-cost.ts) (qty × unit × menu cost per stock unit ÷ yield, rounded once half away from zero)
// against the cloud's line_cost, and that a per_batch cost has no misc (AD-30) and an empty non-option recipe is
// partial with minor null (AD-25). §6.6 PATCH: the client's own patchRecipe call (route + body) is replayed on the real
// route; archive / no-op / stale / restore answers parse with PatchRecipeResponse (AD-17) and the restore refusal
// { field: 'archived', reason, hint: 'new_draft' } (N-1, T-1) goes through the client's newDraftReason mapping.

describe('[08b u1] owner-app recipe client contract against the real routes', () => {
  let cloud: TestCloud;
  let fx: RecipeFixture;
  let auth: Record<string, string>;

  beforeAll(async () => {
    cloud = await createTestCloud();
    await cloud.app.ready();
    fx = await recipeFixture(cloud);
    auth = { authorization: owner(fx.f).headers.authorization! };
  });

  afterAll(async () => {
    await cloud.close();
  });

  const inject = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object, key = false) =>
    cloud.app.inject({ method, url, headers: key ? owner(fx.f).headers : auth, ...(payload === undefined ? {} : { payload }) });
  const refusal = (response: LightMyRequestResponse) => response.json().error as { code: string; details: Record<string, unknown> };

  // the owner app's own live-cost code (apps/client, pure and i18n-free), run on the real routes' inputs
  const liveMinor = (detail: InventoryDetail, qty: string, unitName: string, basis: 'AP' | 'EP'): bigint | null => {
    const live = liveLineCost(detail, { qty, unit_name: unitName, basis });
    return live.known ? roundHalfAway(live.value) : null;
  };
  const inventory = async (id: string) => {
    const response = await inject('GET', `/v1/admin/stock-items/${id}/inventory?branch_id=${fx.lakeCity}`);
    expect(response.statusCode, response.body).toBe(200);
    return InventoryDetailResponse.parse(response.json()).data;
  };

  it('list → create (409 ids[0] on a second) → draft (422 lines.N, 409 stale) → publish (no key; 409 stale) → detail; B17 409', async () => {
    // §6.1 list: an owner without a recipe has recipe_id / version null (AD-16) and plate cost no_recipe
    const list = await inject('GET', `/v1/admin/recipes?branch_id=${fx.lakeCity}`);
    expect(list.statusCode, list.body).toBe(200);
    const rows = RecipeListResponse.parse(list.json()).data.rows;
    const tawaRow = rows.find((r) => r.owner_id === fx.items.tawaPiece)!;
    expect(tawaRow).toMatchObject({ recipe_id: null, version: null, owner_type: 'menu_item', plate_cost: { status: 'no_recipe', minor: null } });
    const missing = await inject('GET', '/v1/admin/recipes?filter=missing');
    expect(RecipeListResponse.parse(missing.json()).data.rows.some((r) => r.owner_id === fx.items.tawaPiece)).toBe(true);

    // §6.3 create (Idempotency-Key) → 201; a second create → 409 CONFIG_IN_USE, the client opens ids[0]
    const created = await inject('POST', '/v1/admin/recipes', { owner_type: 'menu_item', owner_id: fx.items.tawaPiece }, true);
    expect(created.statusCode, created.body).toBe(201);
    const { recipe, draft } = CreateRecipeResponse.parse(created.json()).data;
    const recipeId = recipe.recipe_id!;
    const again = await inject('POST', '/v1/admin/recipes', { owner_type: 'menu_item', owner_id: fx.items.tawaPiece }, true);
    expect(again.statusCode).toBe(409);
    expect(refusal(again)).toMatchObject({ code: 'CONFIG_IN_USE', details: { used_by: { entity: 'recipe', ids: [recipeId] } } });

    // §6.4 422: field lines.N.* with N the index of the sent line
    const bad = await inject('PUT', `/v1/admin/recipes/${recipeId}/draft?branch_id=${fx.lakeCity}`, {
      expected_version: draft.version,
      lines: [
        { stock_item_id: fx.ids.beef, unit_name: 'g', qty: '250' },
        { stock_item_id: fx.ids.tp1, unit_name: 'l', qty: '1' },
      ],
    });
    expect(bad.statusCode, bad.body).toBe(422);
    expect(refusal(bad)).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'lines.1.unit_name', reason: 'not_convertible' } });

    // §6.4 200 with branch_id?: beef derived EP (yield), TP-1 AP, onion AP + no menu cost → partial
    const sent = [
      { stock_item_id: fx.ids.beef, unit_name: 'kg', qty: '0.25' },
      { stock_item_id: fx.ids.tp1, unit_name: 'g', qty: '15' },
      { stock_item_id: fx.stock.onion, unit_name: 'g', qty: '30' },
    ];
    const saved = await inject('PUT', `/v1/admin/recipes/${recipeId}/draft?branch_id=${fx.lakeCity}`, { expected_version: draft.version, misc_allowance_bp: 500, lines: sent });
    expect(saved.statusCode, saved.body).toBe(200);
    const savedDraft = SaveDraftResponse.parse(saved.json()).data.draft;
    const byItem = new Map<string, RecipeLineWire>(savedDraft.lines.map((l) => [l.stock_item_id, l]));
    expect(savedDraft.lines.map((l) => l.stock_item_id)).toEqual(sent.map((l) => l.stock_item_id)); // line_no order = sent order
    expect(byItem.get(fx.ids.beef)?.qty_basis).toBe('EP');
    expect(byItem.get(fx.stock.onion)?.qty_basis).toBe('AP');
    expect(savedDraft.cost.status).toBe('partial');
    expect(savedDraft.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['no_yield_defaulted_ap', 'no_menu_cost']));
    // the browser's live line cost = the cloud's line_cost (same inputs, rounded once)
    for (const l of sent) {
      const wire = byItem.get(l.stock_item_id)!;
      const live = liveMinor(await inventory(l.stock_item_id), l.qty, l.unit_name, wire.qty_basis);
      expect(wire.line_cost.minor, l.stock_item_id).toBe(live === null ? null : live.toString());
    }

    // a fully costed draft: the browser's live plate cost (Σ lines × misc, rounded once) = the cloud's cost.minor
    const costedLines = sent.slice(0, 2);
    const full = await inject('PUT', `/v1/admin/recipes/${recipeId}/draft?branch_id=${fx.lakeCity}`, {
      expected_version: savedDraft.version,
      misc_allowance_bp: 500,
      lines: costedLines,
    });
    expect(full.statusCode, full.body).toBe(200);
    const fullDraft = SaveDraftResponse.parse(full.json()).data.draft;
    expect(fullDraft.cost.status).toBe('costed');
    const lives = [];
    for (const [i, l] of costedLines.entries()) lives.push(liveLineCost(await inventory(l.stock_item_id), { qty: l.qty, unit_name: l.unit_name, basis: fullDraft.lines[i]!.qty_basis }));
    expect(livePlateCost(lives, 500, true, false)).toEqual(fullDraft.cost);
    const fullVersion = fullDraft.version;

    // §6.4 stale tab → 409 CONFIG_STALE
    const staleSave = await inject('PUT', `/v1/admin/recipes/${recipeId}/draft`, { expected_version: draft.version, lines: sent });
    expect(staleSave.statusCode).toBe(409);
    expect(refusal(staleSave).code).toBe('CONFIG_STALE');

    // §6.5 publish: no Idempotency-Key, branch_id? query
    const published = await inject('POST', `/v1/admin/recipes/${recipeId}/publish?branch_id=${fx.lakeCity}`, { expected_version: fullVersion });
    expect(published.statusCode, published.body).toBe(200);
    expect(PublishRecipeResponse.parse(published.json()).data.published.status).toBe('published');
    const twice = await inject('POST', `/v1/admin/recipes/${recipeId}/publish`, { expected_version: fullVersion });
    expect(twice.statusCode).toBe(409);
    expect(refusal(twice).code).toBe('CONFIG_STALE');

    // §6.2 detail
    const detail = await inject('GET', `/v1/admin/recipes/${recipeId}?branch_id=${fx.lakeCity}`);
    expect(detail.statusCode, detail.body).toBe(200);
    const data = RecipeDetailResponse.parse(detail.json()).data;
    expect(data.draft).toBeNull();
    expect(data.published?.version_no).toBe(1);
    expect(data.recipe.version).not.toBeNull();
    expect(data.history.map((h) => h.status)).toEqual(['published']);
    const after = RecipeListResponse.parse((await inject('GET', '/v1/admin/recipes')).json()).data.rows.find((r) => r.owner_id === fx.items.tawaPiece)!;
    expect(after.recipe_id).toBe(recipeId);
    expect(after.published).not.toBeNull();

    // B17 (C-11): archiving a line's stock item → 409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } }
    const { version } = await stockItem(cloud, fx.f, fx.ids.tp1);
    const archive = await inject('PATCH', `/v1/admin/stock-items/${fx.ids.tp1}`, { expected_version: version, archived: true });
    expect(archive.statusCode, archive.body).toBe(409);
    expect(refusal(archive)).toMatchObject({ code: 'CONFIG_IN_USE', details: { used_by: { entity: 'recipe', ids: [recipeId] } } });
  });

  it('empty non-option recipe: partial, minor null (AD-25); publish 422 field lines reason empty; per_batch cost has no misc (AD-30); batch_yield_qty field', async () => {
    const naan = await inject('POST', '/v1/admin/recipes', { owner_type: 'menu_item', owner_id: fx.items.naan }, true);
    const naanData = CreateRecipeResponse.parse(naan.json()).data;
    expect(naanData.draft.cost).toMatchObject({ status: 'partial', minor: null });
    const empty = await inject('POST', `/v1/admin/recipes/${naanData.recipe.recipe_id}/publish`, { expected_version: naanData.draft.version });
    expect(empty.statusCode, empty.body).toBe(422);
    expect(refusal(empty)).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'lines', reason: 'empty' } });

    const paye = await inject('POST', '/v1/admin/recipes', { owner_type: 'stock_item', owner_id: fx.ids.payeCooked }, true);
    const payeData = CreateRecipeResponse.parse(paye.json()).data;
    expect(payeData.draft.basis).toBe('per_batch');
    const noYield = await inject('POST', `/v1/admin/recipes/${payeData.recipe.recipe_id}/publish`, { expected_version: payeData.draft.version });
    expect(refusal(noYield).details).toMatchObject({ field: 'batch_yield_qty' });
    const batch = await inject('PUT', `/v1/admin/recipes/${payeData.recipe.recipe_id}/draft`, {
      expected_version: payeData.draft.version,
      batch_yield_qty: 160,
      misc_allowance_bp: 500,
      lines: [{ stock_item_id: fx.ids.payeRaw, unit_name: 'kg', qty: '40' }],
    });
    expect(batch.statusCode, batch.body).toBe(200);
    const batchDraft = SaveDraftResponse.parse(batch.json()).data.draft;
    expect(batchDraft).toMatchObject({ batch_yield_qty: '160', batch_stock_unit: 'piece' }); // "makes 160 piece"
    // a per_batch version's cost is Σ lines, no misc (B5, AD-30): the UI's "Batch cost (menu cost)"
    expect(batchDraft.cost.status).toBe('costed');
    expect(batchDraft.cost.minor).toBe(batchDraft.lines[0]!.line_cost.minor);
  });
  it('§6.6 through the client\'s own patchRecipe: archive 200 (AD-17; list row archived, no_recipe) → no-op → stale 409 → restore 200 → sale_unit change while archived → restore 422 { archived, basis_mismatch, hint: new_draft } mapped by newDraftReason', async () => {
    // the owner app's cloud-admin client, its fetch bridged to the real routes; every request it sends is kept
    const sentByClient: Array<{ method: string; path: string; body: unknown }> = [];
    const store = new Map<string, string>([['owner_access_token', auth.authorization!.replace(/^Bearer /, '')]]);
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage;
    const api = createCloudAdmin({
      storage,
      onLoggedOut: () => undefined,
      fetch: async (path, init) => {
        const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
        sentByClient.push({ method: String(init?.method), path, body });
        const reply = await cloud.app.inject({
          method: init?.method as 'PATCH',
          url: path,
          headers: init?.headers as Record<string, string>,
          ...(body === undefined ? {} : { payload: body }),
        });
        return new Response(reply.body, { status: reply.statusCode, headers: { 'content-type': 'application/json' } });
      },
    });

    const made = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/menu-items',
      ...owner(fx.f),
      payload: {
        category_id: fx.menu.categoryIds[0],
        tax_class_id: null,
        name: 'Karahi (contract)',
        price_minor: 50_000,
        sale_unit: 'piece',
        serve_mode: 'sync',
        cook_time_ms: 600_000,
        routes: [{ branch_id: fx.lakeCity, station_id: fx.menu.slotStationId }],
      },
    });
    expect(made.statusCode, made.body).toBe(201);
    const itemId = (made.json().data.item as { item_id: string }).item_id;
    const created = CreateRecipeResponse.parse((await inject('POST', '/v1/admin/recipes', { owner_type: 'menu_item', owner_id: itemId }, true)).json()).data;
    const recipeId = created.recipe.recipe_id!;
    const saved = await inject('PUT', `/v1/admin/recipes/${recipeId}/draft`, { expected_version: created.draft.version, lines: [{ stock_item_id: fx.ids.tp1, unit_name: 'g', qty: '15' }] });
    expect(saved.statusCode, saved.body).toBe(200);
    const published = await inject('POST', `/v1/admin/recipes/${recipeId}/publish`, { expected_version: SaveDraftResponse.parse(saved.json()).data.draft.version });
    expect(published.statusCode, published.body).toBe(200);
    const rowOf = async () =>
      RecipeListResponse.parse((await inject('GET', '/v1/admin/recipes')).json()).data.rows.find((r) => r.owner_id === itemId)!;
    const active = await rowOf();
    expect(active).toMatchObject({ recipe_id: recipeId, archived: false });

    // the client's PATCH, as it would send it from the list / editor (expected_version = the row's recipe version)
    const patch = async (expected_version: string, archived: boolean) => {
      const before = sentByClient.length;
      const result = await api.patchRecipe(recipeId, { expected_version, archived });
      const sent = sentByClient.slice(before);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ method: 'PATCH', path: `/v1/admin/recipes/${recipeId}` });
      expect(PatchRecipeBody.strict().parse(sent[0]!.body)).toEqual({ expected_version, archived }); // exactly the route's body
      return result;
    };
    const ok = (result: Awaited<ReturnType<typeof patch>>) => {
      expect(result.ok, JSON.stringify(result)).toBe(true);
      return PatchRecipeResponse.parse({ data: (result as { data: unknown }).data }).data.recipe;
    };

    // archive 200 (AD-17): id, archived, new recipe version; the list row shows it archived and no_recipe (B14)
    const archived = ok(await patch(active.version!, true));
    expect(archived).toMatchObject({ recipe_id: recipeId, archived: true });
    expect(archived.version).not.toBe(active.version);
    const archivedRow = await rowOf();
    expect(archivedRow).toMatchObject({ archived: true, version: archived.version, plate_cost: { status: 'no_recipe', minor: null } });

    // no-op: same answer, same version
    expect(ok(await patch(archived.version, true))).toEqual(archived);

    // stale tab → 409 CONFIG_STALE (the list reloads)
    const stale = await patch(active.version!, false);
    expect(stale).toMatchObject({ ok: false, error: { kind: 'api', status: 409, code: 'CONFIG_STALE' } });
    if (!stale.ok) expect(newDraftReason(stale.error)).toBeNull();

    // restore 200
    const restored = ok(await patch(archived.version, false));
    expect(restored).toMatchObject({ recipe_id: recipeId, archived: false });
    expect((await rowOf()).archived).toBe(false);

    // archive again, sale_unit piece → g while archived (C-14), restore → 422 { field: 'archived', reason, hint }
    const again = ok(await patch(restored.version, true));
    const changed = await cloud.app.inject({ method: 'PATCH', url: `/v1/admin/menu-items/${itemId}`, ...owner(fx.f), payload: { sale_unit: 'g' } });
    expect(changed.statusCode, changed.body).toBe(200);
    const refused = await patch(again.version, false);
    expect(refused).toMatchObject({
      ok: false,
      error: { kind: 'api', status: 422, code: 'CONFIG_REFERENCE_INVALID', details: { field: 'archived', reason: 'basis_mismatch', hint: 'new_draft' } },
    });
    if (refused.ok) throw new Error('restore was not refused');
    expect(newDraftReason(refused.error)).toBe('basis_mismatch'); // the client's T-1 mapping: "Make a new recipe version"
    expect((await rowOf()).archived).toBe(true); // nothing written
  });
});
