import type { DraftSaved, RecipeCreated, RecipePatched, RecipePublished, RecipeVersionWire } from '@pos/events';
import type { LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listTenantScopes } from '../../src/plugins/tenant-scope';
import { createStockItem } from '../helpers/menu-variants';
import { owner } from '../helpers/restaurant';
import { ROUTE_CASES, type BIds } from '../helpers/route-cases';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { recipeFixture, type RecipeFixture } from './fixtures';

// 08 v1.1 Part B §6.0 (audit column), B1 (m-9: one config_audit row per entity changed, every row of a write in ONE
// insert), 01a v2.9 S26 (actor = JWT sub, branch_id null for tenant-level data, before null on create, before / after
// without tenant_id, insert-only, nothing on a replay or a no-op), C7 (cross-tenant: 404 RECIPE_NOT_FOUND, no B id
// leaked) — §10.2 test 21. The generic every-route sweep is cross-tenant.int.test.ts / route-inventory.int.test.ts;
// this file pins the recipe-specific half (AD-2).

const RECIPE_ROUTES = [
  'GET /v1/admin/recipes',
  'GET /v1/admin/recipes/:recipe_id',
  'POST /v1/admin/recipes',
  'PUT /v1/admin/recipes/:recipe_id/draft',
  'POST /v1/admin/recipes/:recipe_id/publish',
  'PATCH /v1/admin/recipes/:recipe_id',
];
const NOW = 1_761_000_000_000; // createTestCloud's fixed clock

// The audit INSERTs of one request (B1: exactly one per write).
function auditInserts(pool: pg.Pool): { readonly count: number; reset(): void } {
  let count = 0;
  const wrapped = new WeakSet<pg.PoolClient>();
  pool.on('acquire', (client) => {
    if (wrapped.has(client)) return;
    wrapped.add(client);
    const original = client.query.bind(client) as (...args: unknown[]) => unknown;
    (client as { query: unknown }).query = (...args: unknown[]) => {
      const first = args[0];
      const text = typeof first === 'string' ? first : ((first as { text?: string } | undefined)?.text ?? '');
      if (/^\s*INSERT INTO config_audit\b/i.test(text)) count += 1;
      return original(...args);
    };
  });
  return {
    get count() {
      return count;
    },
    reset() {
      count = 0;
    },
  };
}

type AuditRow = {
  audit_id: string;
  entity: string;
  entity_id: string;
  action: string;
  actor_kind: string;
  actor_owner_user_id: string | null;
  branch_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
};

describe('08b recipe audit rows and the cross-tenant sweep (§6.0, B1, S26, C7)', () => {
  let cloud: TestCloud;
  let inserts: ReturnType<typeof auditInserts>;
  let fx: RecipeFixture;

  beforeAll(async () => {
    cloud = await createTestCloud({ testHooks: { handlerStart: () => inserts.reset() } });
    inserts = auditInserts(cloud.pool);
    await cloud.app.ready();
    fx = await recipeFixture(cloud);
  }, 60_000);
  afterAll(async () => {
    await cloud.close();
  });

  // ------------------------------------------------------------------------------------------ helpers

  const sql = (text: string, params: unknown[] = []) => cloud.pool.query(text, [fx.f.tenantId, ...params]);
  const auditCount = async (tenantId = fx.f.tenantId) =>
    (await cloud.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM config_audit WHERE tenant_id = $1`, [tenantId])).rows[0]!.n;
  // the rows written since `since` (audit count before the write), in insert order
  const auditSince = async (since: number) =>
    (
      await sql(
        `SELECT audit_id, entity, entity_id, action, actor_kind, actor_owner_user_id, branch_id, before, after, at::text
           FROM config_audit WHERE tenant_id = $1 ORDER BY at, audit_id OFFSET $2`,
        [since],
      )
    ).rows as AuditRow[];
  const menuItem = async (name: string) => {
    const response = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/menu-items',
      ...owner(fx.f),
      payload: {
        category_id: fx.menu.categoryIds[0],
        tax_class_id: null,
        name,
        price_minor: 50_000,
        sale_unit: 'piece',
        serve_mode: 'sync',
        cook_time_ms: 600_000,
        routes: [{ branch_id: fx.lakeCity, station_id: fx.menu.slotStationId }],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json().data.item as { item_id: string }).item_id;
  };
  const grams = (stock_item_id: string, qty = '100') => ({ stock_item_id, unit_name: 'g', qty });
  const createReq = (owner_id: string, headers = owner(fx.f).headers, owner_type = 'menu_item') =>
    cloud.app.inject({ method: 'POST', url: '/v1/admin/recipes', headers, payload: { owner_type, owner_id } });
  const create = async (owner_id: string) => {
    const response = await createReq(owner_id);
    expect(response.statusCode, response.body).toBe(201);
    const data = response.json().data as RecipeCreated;
    return { recipeId: data.recipe.recipe_id!, version: data.recipe.version!, draft: data.draft };
  };
  const draftReq = (recipeId: string, payload: object) =>
    cloud.app.inject({ method: 'PUT', url: `/v1/admin/recipes/${recipeId}/draft`, headers: owner(fx.f).headers, payload });
  const saveDraft = async (recipeId: string, payload: object) => {
    const response = await draftReq(recipeId, payload);
    expect(response.statusCode, response.body).toBe(200);
    return (response.json().data as DraftSaved).draft;
  };
  const publishReq = (recipeId: string, expected_version: string) =>
    cloud.app.inject({ method: 'POST', url: `/v1/admin/recipes/${recipeId}/publish`, headers: owner(fx.f).headers, payload: { expected_version } });
  const publish = async (recipeId: string, expected_version: string) => {
    const response = await publishReq(recipeId, expected_version);
    expect(response.statusCode, response.body).toBe(200);
    return (response.json().data as RecipePublished).published;
  };
  const patchReq = (recipeId: string, expected_version: string, archived: boolean) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/recipes/${recipeId}`, headers: owner(fx.f).headers, payload: { expected_version, archived } });
  const patch = async (recipeId: string, expected_version: string, archived: boolean) => {
    const response = await patchReq(recipeId, expected_version, archived);
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: RecipePatched }).data.recipe;
  };
  // create + a draft with lines + publish
  const live = async (name: string, lines = [grams(fx.stock.beef)]) => {
    const c = await create(await menuItem(name));
    const d = await saveDraft(c.recipeId, { expected_version: c.draft.version, lines });
    const p = await publish(c.recipeId, d.version);
    return { recipeId: c.recipeId, version: c.version, published: p };
  };
  const refusedWith = (response: LightMyRequestResponse, status: number, code: string) => {
    expect(response.statusCode, response.body).toBe(status);
    expect(response.json().error.code, response.body).toBe(code);
  };
  // S26 common columns: owner actor = the JWT sub, tenant-level (branch_id null), no tenant_id inside before / after
  const expectCommon = (rows: AuditRow[]) => {
    for (const row of rows) {
      expect(row, `${row.entity} ${row.action}`).toMatchObject({ actor_kind: 'owner', actor_owner_user_id: fx.f.userId, branch_id: null });
      expect(JSON.stringify([row.before, row.after]), `${row.entity} ${row.action}`).not.toContain('tenant_id');
      expect(JSON.stringify([row.before, row.after]), `${row.entity} ${row.action}`).not.toContain(fx.f.tenantId);
    }
    expect(new Set(rows.map((r) => r.at)).size, 'one insert: one `at`').toBeLessThanOrEqual(1);
  };
  // the stored fields of a version wire as the audit's before / after carries them (the derived cost, warnings,
  // display names and V13 `version` are not stored, so not audited — 08a #36's "stored row" precedent)
  const storedOf = (wire: RecipeVersionWire) => ({
    recipe_version_id: wire.recipe_version_id,
    version_no: wire.version_no,
    status: wire.status,
    basis: wire.basis,
    base_qty: wire.base_qty,
    measure_unit: wire.measure_unit,
    batch_yield_qty: wire.batch_yield_qty,
    batch_stock_unit: wire.batch_stock_unit,
    misc_allowance_bp: wire.misc_allowance_bp,
    published_at: wire.published_at,
    lines: wire.lines.map((l) => expect.objectContaining({ line_no: l.line_no, stock_item_id: l.stock_item_id, unit_name: l.unit_name, qty: l.qty, qty_basis: l.qty_basis })),
  });

  // ------------------------------------------------------------------------------------------ §6.3 create

  it('[08b #21] create: recipe / create + recipe_version / create in ONE insert; before null; after the stored row; actor = JWT sub; branch_id null', async () => {
    const item = await menuItem('Audit create');
    const since = await auditCount();
    const headers = owner(fx.f).headers;
    const response = await createReq(item, headers);
    expect(response.statusCode, response.body).toBe(201);
    expect(inserts.count).toBe(1);
    const data = response.json().data as RecipeCreated;
    const rows = await auditSince(since);
    expect(rows.map((r) => [r.entity, r.entity_id, r.action])).toEqual([
      ['recipe', data.recipe.recipe_id, 'create'],
      ['recipe_version', data.draft.recipe_version_id, 'create'],
    ]);
    expectCommon(rows);
    expect(Number(rows[0]!.at)).toBe(NOW);
    expect(rows.map((r) => r.before)).toEqual([null, null]);
    expect(rows[0]!.after).toEqual({ recipe_id: data.recipe.recipe_id, owner_type: 'menu_item', owner_id: item, archived_at: null });
    expect(rows[1]!.after).toMatchObject({ ...storedOf(data.draft), recipe_id: data.recipe.recipe_id, created_by: fx.f.userId, published_by: null });
    expect(rows[1]!.after).toMatchObject({ status: 'draft', version_no: 1, lines: [] });
    for (const key of ['cost', 'warnings', 'version', 'created_by_name']) expect(rows[1]!.after, key).not.toHaveProperty(key);

    // replay (same key, same body): the stored response, no audit row
    const replay = await createReq(item, headers);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(response.json());
    expect(inserts.count).toBe(0);
    // conflict (a new key, the same owner): 409 CONFIG_IN_USE, no audit row (t-2)
    refusedWith(await createReq(item), 409, 'CONFIG_IN_USE');
    expect(inserts.count).toBe(0);
    // 422 refusals: a linked option (B2), a stock item that is not prepared (R7), an unknown owner
    refusedWith(await createReq(fx.options.extraNaan, owner(fx.f).headers, 'modifier_option'), 422, 'CONFIG_REFERENCE_INVALID');
    refusedWith(await createReq(fx.stock.beef, owner(fx.f).headers, 'stock_item'), 422, 'CONFIG_REFERENCE_INVALID');
    refusedWith(await createReq('NO-SUCH-ITEM'), 422, 'CONFIG_REFERENCE_INVALID');
    expect(await auditCount()).toBe(since + 2);
  });

  // ------------------------------------------------------------------------------------------ §6.4 draft save

  it('[08b #21] draft save: recipe_version / update (before = the stored draft) or / create after a publish (before null); refusals write nothing', async () => {
    const c = await create(await menuItem('Audit draft'));
    let since = await auditCount();
    const first = await saveDraft(c.recipeId, { expected_version: c.draft.version, lines: [grams(fx.stock.beef, '150')] });
    expect(inserts.count).toBe(1);
    let rows = await auditSince(since);
    expect(rows.map((r) => [r.entity, r.entity_id, r.action])).toEqual([['recipe_version', c.draft.recipe_version_id, 'update']]);
    expectCommon(rows);
    expect(rows[0]!.before).toMatchObject({ ...storedOf(c.draft), lines: [] });
    expect(rows[0]!.after).toMatchObject(storedOf(first));
    expect(rows[0]!.after).toMatchObject({ lines: [expect.objectContaining({ stock_item_id: fx.stock.beef, qty: '150', stock_qty_num: '150', stock_qty_den: '1' })] });

    // refusals: stale expected_version (409), an unconvertible unit (422), a basis mismatch (422), unknown (404): nothing
    since = await auditCount();
    refusedWith(await draftReq(c.recipeId, { expected_version: c.draft.version, lines: [] }), 409, 'CONFIG_STALE');
    refusedWith(await draftReq(c.recipeId, { expected_version: null, lines: [] }), 409, 'CONFIG_STALE');
    refusedWith(
      await draftReq(c.recipeId, { expected_version: first.version, lines: [{ stock_item_id: fx.stock.beef, unit_name: 'peti', qty: '1' }] }),
      422,
      'CONFIG_REFERENCE_INVALID',
    );
    refusedWith(await draftReq(c.recipeId, { expected_version: first.version, base_qty: 500, lines: [] }), 422, 'CONFIG_REFERENCE_INVALID');
    refusedWith(await draftReq('NO-SUCH-RECIPE', { expected_version: null, lines: [] }), 404, 'RECIPE_NOT_FOUND');
    expect(await auditCount()).toBe(since);

    // after a publish there is no draft: expected_version null creates version 2 → recipe_version / create, before null
    const p = await publish(c.recipeId, first.version);
    since = await auditCount();
    const second = await saveDraft(c.recipeId, { expected_version: null, lines: [grams(fx.stock.ghee, '20')] });
    expect(inserts.count).toBe(1);
    rows = await auditSince(since);
    expect(rows.map((r) => [r.entity, r.entity_id, r.action])).toEqual([['recipe_version', second.recipe_version_id, 'create']]);
    expect(second.recipe_version_id).not.toBe(p.recipe_version_id);
    expectCommon(rows);
    expect(rows[0]!.before).toBeNull();
    expect(rows[0]!.after).toMatchObject({ ...storedOf(second), status: 'draft', version_no: 2 });
  });

  // ------------------------------------------------------------------------------------------ §6.5 publish

  it('[08b #21] publish: recipe_version / publish; + recipe_version / update (superseded) when one was published; + recipe / restore when archived — one insert', async () => {
    const c = await create(await menuItem('Audit publish'));
    const d1 = await saveDraft(c.recipeId, { expected_version: c.draft.version, lines: [grams(fx.stock.beef)] });

    // first publish: no previous, active → one row
    let since = await auditCount();
    const p1 = await publish(c.recipeId, d1.version);
    expect(inserts.count).toBe(1);
    let rows = await auditSince(since);
    expect(rows.map((r) => [r.entity, r.entity_id, r.action])).toEqual([['recipe_version', p1.recipe_version_id, 'publish']]);
    expectCommon(rows);
    expect(rows[0]!.before).toMatchObject({ ...storedOf(d1), status: 'draft', published_by: null, published_at: null });
    expect(rows[0]!.after).toMatchObject({ ...storedOf(p1), status: 'published', published_by: fx.f.userId, published_at: NOW });

    // second publish over a published version: publish + update (the superseded one), one insert
    const d2 = await saveDraft(c.recipeId, { expected_version: null, lines: [grams(fx.stock.beef, '120')] });
    since = await auditCount();
    const p2 = await publish(c.recipeId, d2.version);
    expect(inserts.count).toBe(1);
    rows = await auditSince(since);
    expect(rows.map((r) => [r.entity, r.entity_id, r.action]).sort()).toEqual(
      [
        ['recipe_version', p2.recipe_version_id, 'publish'],
        ['recipe_version', p1.recipe_version_id, 'update'],
      ].sort(),
    );
    expectCommon(rows);
    expect(rows).toHaveLength(2);
    const superseded = rows.find((r) => r.action === 'update')!;
    expect(superseded.before).toMatchObject({ ...storedOf(p1), status: 'published' });
    expect(superseded.after).toEqual({ ...superseded.before, status: 'superseded' }); // AD-32: status only

    // archived recipe with a draft: publish + update + recipe / restore (T-1), one insert
    const d3 = await saveDraft(c.recipeId, { expected_version: null, lines: [grams(fx.stock.beef, '130')] });
    const archived = await patch(c.recipeId, c.version, true);
    since = await auditCount();
    const p3 = await publish(c.recipeId, d3.version);
    expect(inserts.count).toBe(1);
    rows = await auditSince(since);
    expect(rows.map((r) => [r.entity, r.entity_id, r.action]).sort()).toEqual(
      [
        ['recipe', c.recipeId, 'restore'],
        ['recipe_version', p3.recipe_version_id, 'publish'],
        ['recipe_version', p2.recipe_version_id, 'update'],
      ].sort(),
    );
    expectCommon(rows);
    const restore = rows.find((r) => r.entity === 'recipe')!;
    expect(restore.before).toMatchObject({ recipe_id: c.recipeId, archived_at: NOW });
    expect(restore.after).toEqual({ ...restore.before, archived_at: null });
    expect(archived.archived).toBe(true);

    // refusals: stale (409), no draft (409), an empty draft (422 empty), unknown recipe (404) — nothing written
    const d4 = await saveDraft(c.recipeId, { expected_version: null, lines: [] });
    const noDraft = await live('Audit publish no draft');
    since = await auditCount();
    refusedWith(await publishReq(c.recipeId, d3.version), 409, 'CONFIG_STALE');
    refusedWith(await publishReq(c.recipeId, d4.version), 422, 'CONFIG_REFERENCE_INVALID');
    refusedWith(await publishReq('NO-SUCH-RECIPE', d4.version), 404, 'RECIPE_NOT_FOUND');
    refusedWith(await publishReq(noDraft.recipeId, noDraft.published.version), 409, 'CONFIG_STALE');
    expect(await auditCount()).toBe(since);
  });

  // ------------------------------------------------------------------------------------------ §6.6 archive / restore

  it('[08b #21] PATCH: recipe / archive and recipe / restore (before / after archived_at); no row on a no-op, a stale version or a 422 refusal', async () => {
    const r = await live('Audit patch');
    let since = await auditCount();
    const a = await patch(r.recipeId, r.version, true);
    expect(inserts.count).toBe(1);
    let rows = await auditSince(since);
    expect(rows.map((x) => [x.entity, x.entity_id, x.action])).toEqual([['recipe', r.recipeId, 'archive']]);
    expectCommon(rows);
    expect(rows[0]!.before).toMatchObject({ recipe_id: r.recipeId, owner_type: 'menu_item', archived_at: null });
    expect(rows[0]!.after).toEqual({ ...rows[0]!.before, archived_at: NOW });

    // no-op archive (already archived) and a stale version: nothing
    since = await auditCount();
    expect((await patch(r.recipeId, a.version, true)).archived).toBe(true);
    expect(inserts.count).toBe(0);
    refusedWith(await patchReq(r.recipeId, r.version, false), 409, 'CONFIG_STALE');
    expect(await auditCount()).toBe(since);

    const restored = await patch(r.recipeId, a.version, false);
    expect(inserts.count).toBe(1);
    rows = await auditSince(since);
    expect(rows.map((x) => [x.entity, x.entity_id, x.action])).toEqual([['recipe', r.recipeId, 'restore']]);
    expectCommon(rows);
    expect(rows[0]!.before).toMatchObject({ recipe_id: r.recipeId, archived_at: NOW });
    expect(rows[0]!.after).toEqual({ ...rows[0]!.before, archived_at: null });

    // no-op restore (already active): nothing
    since = await auditCount();
    expect((await patch(r.recipeId, restored.version, false)).archived).toBe(false);
    expect(inserts.count).toBe(0);
    expect(await auditCount()).toBe(since);

    // a 422 restore refusal (B6 on restore: a line stock item archived while the recipe was archived): nothing
    const onion = (await createStockItem(cloud, fx.f, { name: 'Audit onion', stock_unit: 'g', carries_over: false })).stock_item_id;
    await sql(`UPDATE stock_items SET kind = 'ingredient' WHERE tenant_id = $1 AND stock_item_id = $2`, [onion]);
    const s = await live('Audit patch refusal', [grams(onion)]);
    const sa = await patch(s.recipeId, s.version, true);
    await sql(`UPDATE stock_items SET archived_at = 1 WHERE tenant_id = $1 AND stock_item_id = $2`, [onion]);
    since = await auditCount();
    const refused = await patchReq(s.recipeId, sa.version, false);
    refusedWith(refused, 422, 'CONFIG_REFERENCE_INVALID');
    expect(refused.json().error.details).toMatchObject({ field: 'archived', hint: 'new_draft' });
    refusedWith(await patchReq('NO-SUCH-RECIPE', sa.version, true), 404, 'RECIPE_NOT_FOUND');
    expect(await auditCount()).toBe(since);
  });

  it('[08b #21] recipe audit rows are insert-only (the S26 triggers)', async () => {
    const r = await live('Audit insert-only');
    const row = (await sql(`SELECT audit_id FROM config_audit WHERE tenant_id = $1 AND entity = 'recipe' AND entity_id = $2`, [r.recipeId])).rows[0] as {
      audit_id: string;
    };
    await expect(sql(`UPDATE config_audit SET action = 'archive' WHERE tenant_id = $1 AND audit_id = $2`, [row.audit_id])).rejects.toThrow(/insert-only/);
    await expect(sql(`DELETE FROM config_audit WHERE tenant_id = $1 AND entity = 'recipe_version'`)).rejects.toThrow(/insert-only/);
  });

  // ------------------------------------------------------------------------------------------ C7

  it("[08b #21, C7] tenant A's JWT on tenant B's recipe: 404 RECIPE_NOT_FOUND on every recipe-id route, no B id leaked, nothing written; every recipe route in ROUTE_CASES", async () => {
    // AD-2: the six recipe routes are registered (JWT) and each has its ROUTE_CASES entry
    const registered = listTenantScopes(cloud.app)
      .filter((route) => route.method !== 'HEAD' && route.url.startsWith('/v1/admin/recipes'))
      .map((route) => ({ key: `${route.method} ${route.url}`, scope: route.tenantScope }));
    expect(registered.map((r) => r.key).sort()).toEqual([...RECIPE_ROUTES].sort());
    for (const r of registered) expect(r.scope, r.key).toBe('jwt');
    expect(Object.keys(ROUTE_CASES)).toEqual(expect.arrayContaining(RECIPE_ROUTES));

    // Tenant B's own live recipe (published, with a draft), made through B's own routes, so every rule but the
    // tenant would pass with B's real versions.
    const b = owner(fx.f, fx.f.other.token).headers;
    const bInject = async (method: 'POST' | 'PUT' | 'GET', url: string, payload?: object) => {
      const response = await cloud.app.inject({ method, url, headers: owner(fx.f, fx.f.other.token).headers, ...(payload ? { payload } : {}) });
      expect(response.statusCode, `${method} ${url} ${response.body}`).toBeLessThan(300);
      return response.json().data as Record<string, unknown>;
    };
    const bIngredient = ((await bInject('POST', '/v1/admin/stock-items', { name: 'B ghee', stock_unit: 'g', kind: 'ingredient' })).stock_item as { stock_item_id: string })
      .stock_item_id;
    const bBatch = ((await bInject('POST', '/v1/admin/stock-items', { name: 'B batch', stock_unit: 'piece', kind: 'prepared' })).stock_item as { stock_item_id: string })
      .stock_item_id;
    const bCreated = (await cloud.app.inject({ method: 'POST', url: '/v1/admin/recipes', headers: b, payload: { owner_type: 'stock_item', owner_id: bBatch } })).json()
      .data as RecipeCreated;
    const bRecipeId = bCreated.recipe.recipe_id!;
    const bDraft = (await bInject('PUT', `/v1/admin/recipes/${bRecipeId}/draft`, {
      expected_version: bCreated.draft.version,
      batch_yield_qty: 10,
      lines: [grams(bIngredient)],
    })) as unknown as DraftSaved;
    const bPublished = (await bInject('POST', `/v1/admin/recipes/${bRecipeId}/publish`, { expected_version: bDraft.draft.version })) as unknown as RecipePublished;
    const bNext = (await bInject('PUT', `/v1/admin/recipes/${bRecipeId}/draft`, { expected_version: null, batch_yield_qty: 10, lines: [grams(bIngredient, '50')] })) as unknown as DraftSaved;
    const bRead = await bInject('GET', `/v1/admin/recipes/${bRecipeId}`); // B's own owner reads it: A's 404 below is the tenant
    expect((bRead.recipe as { recipe_id: string }).recipe_id).toBe(bRecipeId);

    const bIds = [fx.f.other.tenantId, fx.f.other.userId, fx.f.other.branchId, bRecipeId, bIngredient, bBatch, bPublished.published.recipe_version_id, bNext.draft.recipe_version_id];
    const bState = async () =>
      (
        await cloud.pool.query(
          `SELECT (SELECT json_agg(json_build_object('id', recipe_id, 'archived_at', archived_at, 'updated_at', updated_at)) FROM recipes WHERE tenant_id = $1) AS recipes,
                  (SELECT json_agg(json_build_object('id', recipe_version_id, 'status', status) ORDER BY recipe_version_id) FROM recipe_versions WHERE tenant_id = $1) AS versions,
                  (SELECT count(*)::int FROM recipe_lines WHERE tenant_id = $1) AS lines,
                  (SELECT count(*)::int FROM config_audit WHERE tenant_id = $1) AS audit,
                  (SELECT json_agg(config_version::text) FROM branches WHERE tenant_id = $1) AS versions_b`,
          [fx.f.other.tenantId],
        )
      ).rows[0];
    const beforeB = await bState();
    const beforeA = await auditCount();
    const bRecipeVersion = (bRead.recipe as { version: string }).version;

    // every recipe-id route, with B's REAL versions (so only the tenant can refuse), and ROUTE_CASES' own requests
    const real: Array<{ key: string; method: 'GET' | 'PUT' | 'POST' | 'PATCH'; url: string; payload?: object }> = [
      { key: 'GET /v1/admin/recipes/:recipe_id', method: 'GET', url: `/v1/admin/recipes/${bRecipeId}` },
      {
        key: 'PUT /v1/admin/recipes/:recipe_id/draft',
        method: 'PUT',
        url: `/v1/admin/recipes/${bRecipeId}/draft`,
        payload: { expected_version: bNext.draft.version, batch_yield_qty: 10, lines: [] },
      },
      { key: 'POST /v1/admin/recipes/:recipe_id/publish', method: 'POST', url: `/v1/admin/recipes/${bRecipeId}/publish`, payload: { expected_version: bNext.draft.version } },
      { key: 'PATCH /v1/admin/recipes/:recipe_id', method: 'PATCH', url: `/v1/admin/recipes/${bRecipeId}`, payload: { expected_version: bRecipeVersion, archived: true } },
    ];
    const ids = { recipeId: bRecipeId, itemId: bBatch, branchId: fx.f.other.branchId } as BIds;
    const fromCases = real.map((r) => {
      const request = ROUTE_CASES[r.key]!(ids);
      expect(request.url, r.key).toBe(r.url);
      return { ...r, payload: request.payload as object | undefined };
    });
    for (const r of [...real, ...fromCases]) {
      const response = await cloud.app.inject({ method: r.method, url: r.url, headers: owner(fx.f).headers, ...(r.payload ? { payload: r.payload } : {}) });
      expect(response.statusCode, `${r.key} ${response.body}`).toBe(404);
      expect(response.json().error, r.key).toMatchObject({ code: 'RECIPE_NOT_FOUND', details: { recipe_id: bRecipeId } });
      // only the id A sent comes back
      const body = JSON.stringify(response.json());
      for (const id of bIds.filter((x) => x !== bRecipeId)) expect(body, `${r.key} leaks ${id}`).not.toContain(id);
    }
    // §6.3 on B's owner: the owner read is tenant-scoped → 422 owner_id not_found, never a 409 naming B's recipe
    const foreignOwner = await createReq(bBatch, owner(fx.f).headers, 'stock_item');
    refusedWith(foreignOwner, 422, 'CONFIG_REFERENCE_INVALID');
    expect(foreignOwner.json().error.details).toMatchObject({ field: 'owner_id', reason: 'not_found' });
    for (const id of bIds.filter((x) => x !== bBatch)) expect(foreignOwner.body).not.toContain(id);
    // review MINOR: the menu-item and option owner paths (the option is read under its group lock) are tenant-scoped too
    const tb = fx.f.other.tenantId;
    await cloud.pool.query(`INSERT INTO categories (tenant_id, category_id, name, created_at, updated_at) VALUES ($1, 'B-CAT-08B', 'B mains', 0, 0)`, [tb]);
    await cloud.pool.query(
      `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, created_at, updated_at)
       VALUES ($1, 'B-ITEM-08B', 'B-CAT-08B', 'B karahi', 500, 'immediate', 600000, 0, 0)`,
      [tb],
    );
    await cloud.pool.query(
      `INSERT INTO modifier_groups (tenant_id, modifier_group_id, name, min_choices, max_choices, created_at, updated_at) VALUES ($1, 'B-GROUP-08B', 'B choices', 0, 1, 0, 0)`,
      [tb],
    );
    await cloud.pool.query(
      `INSERT INTO modifier_options (tenant_id, option_id, modifier_group_id, name, price_minor, sort_order) VALUES ($1, 'B-OPTION-08B', 'B-GROUP-08B', 'B spicy', 0, 0)`,
      [tb],
    );
    for (const [ownerId, ownerType] of [['B-ITEM-08B', 'menu_item'], ['B-OPTION-08B', 'modifier_option']] as const) {
      const foreign = await createReq(ownerId, owner(fx.f).headers, ownerType);
      refusedWith(foreign, 422, 'CONFIG_REFERENCE_INVALID');
      expect(foreign.json().error.details, ownerType).toMatchObject({ field: 'owner_id', reason: 'not_found' });
    }
    // review MINOR: publish with another tenant's branch_id → 404 BRANCH_NOT_FOUND (C2, before any SQL)
    const foreignBranch = await cloud.app.inject({
      method: 'POST',
      url: `/v1/admin/recipes/${bRecipeId}/publish?branch_id=${fx.f.other.branchId}`,
      headers: owner(fx.f).headers,
      payload: { expected_version: bNext.draft.version },
    });
    refusedWith(foreignBranch, 404, 'BRANCH_NOT_FOUND');
    // §6.1: A's list names nothing of B's
    const list = await cloud.app.inject({ method: 'GET', url: '/v1/admin/recipes', headers: owner(fx.f).headers });
    expect(list.statusCode, list.body).toBe(200);
    for (const id of bIds) expect(list.body).not.toContain(id);
    // never a 403 for another tenant's recipe; nothing written in either tenant
    expect(await bState()).toEqual(beforeB);
    expect(await auditCount()).toBe(beforeA);
  });
});
