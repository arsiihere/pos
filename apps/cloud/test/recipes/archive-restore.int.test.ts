import { buildCostInputs, plateCost, roundMinor } from '@pos/domain';
import type { DraftSaved, ModifierGroupWire, RecipeCreated, RecipePatched, RecipePublished } from '@pos/events';
import type { LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantLevelRepository } from '../../src/db/tenant-level-repository';
import { selectCostContext } from '../../src/modules/recipes/repository';
import { createModifierGroup, createStockItem } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { stockItem } from '../inventory/fixtures';
import { recipeFixture, type RecipeFixture } from './fixtures';

// 08 v1.1 Part B §6.6: PATCH /v1/admin/recipes/:recipe_id { expected_version, archived } — §10.2 test 18 (archive
// 6 / 4 / no-op 2; restore: kind 0 first on every `archived: false`, no-op 3, without a published version 5, with
// one 10 / 9; every §6.6 edge row, each refusal `422 { field: 'archived', reason, hint: 'new_draft' }` with nothing
// written), the restore-then-422 half of test 22 (each B17 owner / line edit allowed after the archive, then the
// restore refused), test 18b (the way forward: new draft + publish), §10.4 tests 37 and 38 (races), and AD-29's
// three [08b #26] no-bump cases (create, draft save, archive of a never-published recipe).

const PATCH_ROUTE = 'PATCH /v1/admin/recipes/:recipe_id';
const PUBLISH_ROUTE = 'POST /v1/admin/recipes/:recipe_id/publish';
const NOW = 1_761_000_000_000; // createTestCloud's fixed clock

// Every statement's SQL text, in order (BEGIN / COMMIT / ROLLBACK left out, as pgCounter): the §6 lock order.
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

type Control = { afterPublishLock?: (route: string) => Promise<void>; afterRecipeLock?: (route: string) => Promise<void> };

describe('08b recipe archive / restore (§6.6)', () => {
  let cloud: TestCloud;
  let counter: ReturnType<typeof pgCounter>;
  let log: ReturnType<typeof statementLog>;
  let fx: RecipeFixture;
  const hooked: string[] = [];
  const control: Control = {};
  const pids = new Set<number>();

  beforeAll(async () => {
    cloud = await createTestCloud({
      testHooks: {
        handlerStart: () => {
          counter.reset();
          log.reset();
        },
        afterPublishLock: async (route) => {
          hooked.push(`${route}@${log.sql.length}`);
          await control.afterPublishLock?.(route);
        },
        afterRecipeLock: async (route) => {
          await control.afterRecipeLock?.(route);
        },
      },
    });
    counter = pgCounter(cloud.pool);
    log = statementLog(cloud.pool);
    // this test's own backends (the app's pool): the race helpers count only their lock waits
    cloud.pool.on('acquire', (client) => {
      const pid = (client as unknown as { processID?: number }).processID;
      if (typeof pid === 'number') pids.add(pid);
    });
    await cloud.app.ready();
    fx = await recipeFixture(cloud);
  }, 60_000);
  afterAll(async () => {
    await cloud.close();
  });

  // ------------------------------------------------------------------------------------------ helpers

  const sql = (text: string, params: unknown[] = []) => cloud.pool.query(text, [fx.f.tenantId, ...params]);
  const create = async (owner_type: string, owner_id: string) => {
    const response = await cloud.app.inject({ method: 'POST', url: '/v1/admin/recipes', ...owner(fx.f), payload: { owner_type, owner_id } });
    expect(response.statusCode, response.body).toBe(201);
    const data = response.json().data as RecipeCreated;
    return { recipeId: data.recipe.recipe_id!, version: data.recipe.version!, draft: data.draft };
  };
  const saveDraft = async (recipeId: string, payload: object) => {
    const response = await cloud.app.inject({ method: 'PUT', url: `/v1/admin/recipes/${recipeId}/draft`, headers: owner(fx.f).headers, payload });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json().data as DraftSaved).draft;
  };
  const drafted = async (owner_type: string, owner_id: string, payload: Record<string, unknown>) => {
    const created = await create(owner_type, owner_id);
    const draft = await saveDraft(created.recipeId, { expected_version: created.draft.version, ...payload });
    return { ...created, draft };
  };
  const publish = (recipeId: string, expected_version: string) =>
    cloud.app.inject({ method: 'POST', url: `/v1/admin/recipes/${recipeId}/publish`, headers: owner(fx.f).headers, payload: { expected_version } });
  const published = async (recipeId: string, expected_version: string) => {
    const response = await publish(recipeId, expected_version);
    expect(response.statusCode, response.body).toBe(200);
    return (response.json().data as RecipePublished).published;
  };
  // create + draft + publish: the recipe id, its recipe-level version (active) and the published version
  const live = async (owner_type: string, owner_id: string, payload: Record<string, unknown>) => {
    const d = await drafted(owner_type, owner_id, payload);
    return { recipeId: d.recipeId, version: d.version, published: await published(d.recipeId, d.draft.version) };
  };
  const patch = (recipeId: string, expected_version: string, archived: boolean) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/recipes/${recipeId}`, headers: owner(fx.f).headers, payload: { expected_version, archived } });
  const patched = async (recipeId: string, expected_version: string, archived: boolean, statements?: number) => {
    const response = await patch(recipeId, expected_version, archived);
    expect(response.statusCode, response.body).toBe(200);
    if (statements !== undefined) expect(counter.count).toBe(statements);
    const recipe = (response.json() as { data: RecipePatched }).data.recipe;
    expect(Object.keys(response.json().data)).toEqual(['recipe']); // AD-17
    expect(Object.keys(recipe).sort()).toEqual(['archived', 'recipe_id', 'version']);
    expect(recipe).toMatchObject({ recipe_id: recipeId, archived });
    return recipe;
  };
  // archive through the route (the recipe-level version back)
  const archived = async (recipeId: string, version: string) => (await patched(recipeId, version, true)).version;
  const expectRestoreRefused = (response: LightMyRequestResponse, reason: string) => {
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'archived', reason, hint: 'new_draft' } });
  };
  const menuItem = async (name: string, sale_unit: 'piece' | 'g' | 'ml') => {
    const response = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/menu-items',
      ...owner(fx.f),
      payload: {
        category_id: fx.menu.categoryIds[0],
        tax_class_id: null,
        name,
        price_minor: 50_000,
        sale_unit,
        serve_mode: 'sync',
        cook_time_ms: 600_000,
        routes: [{ branch_id: fx.lakeCity, station_id: fx.menu.slotStationId }],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json().data.item as { item_id: string }).item_id;
  };
  const setStock = (id: string, set: string) => sql(`UPDATE stock_items SET ${set} WHERE tenant_id = $1 AND stock_item_id = $2`, [id]);
  const ingredient = async (name: string, stock_unit: 'piece' | 'g' | 'ml' = 'g') => {
    const id = (await createStockItem(cloud, fx.f, { name, stock_unit, carries_over: false })).stock_item_id;
    await setStock(id, `kind = 'ingredient'`);
    return id;
  };
  const prepared = async (name: string, stock_unit: 'piece' | 'g' = 'piece') => {
    const id = (await createStockItem(cloud, fx.f, { name, stock_unit, carries_over: false })).stock_item_id;
    await setStock(id, `kind = 'prepared'`);
    return id;
  };
  // the 01c / 08a owner and line edits through their real routes (B17 guards: 409 while the recipe is active)
  const patchItem = (itemId: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/menu-items/${itemId}`, ...owner(fx.f), payload });
  const patchStock = async (stockItemId: string, payload: object) => {
    const { version } = await stockItem(cloud, fx.f, stockItemId);
    return cloud.app.inject({ method: 'PATCH', url: `/v1/admin/stock-items/${stockItemId}`, ...owner(fx.f), payload: { expected_version: version, ...payload } });
  };
  const linkOption = async (groupId: string, optionId: string, linkedItemId: string) => {
    const response = await cloud.app.inject({ method: 'GET', url: '/v1/admin/modifier-groups', ...owner(fx.f) });
    const group = (response.json().data.modifier_groups as ModifierGroupWire[]).find((g) => g.modifier_group_id === groupId)!;
    const options = group.options.map(({ option_id, name, price_minor, max_quantity, is_default, linked_item_id, sort_order }) => ({
      option_id,
      name,
      price_minor,
      max_quantity,
      is_default,
      linked_item_id: option_id === optionId ? linkedItemId : linked_item_id,
      sort_order,
    }));
    return cloud.app.inject({ method: 'PATCH', url: `/v1/admin/modifier-groups/${groupId}`, ...owner(fx.f), payload: { expected_version: group.version, options } });
  };
  const ok = (response: LightMyRequestResponse) => expect(response.statusCode, response.body).toBe(200);
  const inUse = (response: LightMyRequestResponse) => {
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error).toMatchObject({ code: 'CONFIG_IN_USE', details: { used_by: { entity: 'recipe' } } });
  };
  const configVersions = async () =>
    (await sql(`SELECT config_version::text AS v FROM branches WHERE tenant_id = $1 ORDER BY branch_id`)).rows.map((r: { v: string }) => Number(r.v));
  const auditOf = async (ids: string[]) =>
    (
      await sql(`SELECT entity, entity_id, action, before, after, branch_id FROM config_audit WHERE tenant_id = $1 AND entity_id = ANY($2) ORDER BY audit_id`, [
        ids,
      ])
    ).rows as Array<{ entity: string; entity_id: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; branch_id: string | null }>;
  const archivedAt = async (recipeId: string) =>
    (await sql(`SELECT archived_at::text AS a FROM recipes WHERE tenant_id = $1 AND recipe_id = $2`, [recipeId])).rows[0]!.a as string | null;
  // everything a refused or no-op PATCH must leave as it was
  const state = async () => ({
    versions: (await sql(`SELECT recipe_version_id, status, published_at::text FROM recipe_versions WHERE tenant_id = $1 ORDER BY recipe_version_id`)).rows,
    recipes: (await sql(`SELECT recipe_id, archived_at::text, updated_at::text FROM recipes WHERE tenant_id = $1 ORDER BY recipe_id`)).rows,
    audit: (await sql(`SELECT count(*)::int AS n FROM config_audit WHERE tenant_id = $1`)).rows[0],
    branches: await configVersions(),
  });
  const piece = (stock_item_id: string, qty = '1') => ({ stock_item_id, unit_name: 'piece', qty });
  const grams = (stock_item_id: string, qty = '100') => ({ stock_item_id, unit_name: 'g', qty });

  // races: wait until `n` of this test's own backends wait on a lock (advisory: kind 0; Lock: any row or advisory lock)
  const waiting = async (n: number, advisoryOnly = false) => {
    for (let i = 0; i < 250; i += 1) {
      const r = await cloud.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity a
          WHERE a.pid = ANY($2::int[]) AND a.wait_event_type = 'Lock' AND ($1::boolean = false OR a.wait_event = 'advisory')`,
        [advisoryOnly, [...pids]],
      );
      if (r.rows[0]!.n >= n) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`fewer than ${n} requests wait on a lock`);
  };
  // hold the first afterPublishLock of `route` until release()
  const holdPublishLock = (route: string) => {
    let reached!: () => void;
    let release!: () => void;
    const arrived = new Promise<void>((resolve) => (reached = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    control.afterPublishLock = async (r) => {
      if (!first || r !== route) return;
      first = false;
      reached();
      await released;
    };
    return { arrived, release };
  };
  // hold the first afterRecipeLock of `route` (right after its recipe lock, kind 0.5) until release()
  const holdRecipeLock = (route: string) => {
    let reached!: () => void;
    let release!: () => void;
    const arrived = new Promise<void>((resolve) => (reached = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    control.afterRecipeLock = async (r) => {
      if (!first || r !== route) return;
      first = false;
      reached();
      await released;
    };
    return { arrived, release };
  };
  // a gate on a stock item row: a raw transaction holds it FOR UPDATE, so a write that reaches its kind-5 FOR SHARE
  // waits there — after its owner row lock (kinds 1 / 4) — until open()
  const gate = async (stockItemId: string) => {
    const client = await cloud.pool.connect();
    await client.query('BEGIN');
    await client.query(`SELECT 1 FROM stock_items WHERE tenant_id = $1 AND stock_item_id = $2 FOR UPDATE`, [fx.f.tenantId, stockItemId]);
    let opened = false;
    return async () => {
      if (opened) return;
      opened = true;
      await client.query('COMMIT');
      client.release();
    };
  };
  const publishedOwners = async (ownerIds: string[]) =>
    (
      await sql(
        `SELECT r.owner_id, v.measure_unit, v.basis FROM recipe_versions v JOIN recipes r ON r.tenant_id = v.tenant_id AND r.recipe_id = v.recipe_id
          WHERE v.tenant_id = $1 AND v.status = 'published' AND r.archived_at IS NULL AND r.owner_id = ANY($2) ORDER BY r.owner_id`,
        [ownerIds],
      )
    ).rows as Array<{ owner_id: string; measure_unit: string | null; basis: string }>;

  // --------------------------------------------------------------------------------------- archive (#18)

  it('[08b #18] archive of a recipe with a published version: 6 statements (tenant-wide, recipe FOR UPDATE, write, audit, bump 2; no publish lock); recipe / archive audit row; every branch bumped; the new recipe-level version back', async () => {
    const item = await menuItem('Archive plate', 'piece');
    const r = await live('menu_item', item, { lines: [grams(fx.stock.beef, '200')] });
    const before = await configVersions();
    hooked.length = 0;
    const recipe = await patched(r.recipeId, r.version, true, 6);
    expect(recipe.version).not.toBe(r.version);
    const s = [...log.sql];
    expect(s[0]).toMatch(/bool_and/); // tenant-wide
    expect(s[1]).toMatch(/FROM recipes .*FOR UPDATE/); // kind 0.5
    expect(s.some((q) => /pg_advisory_xact_lock/.test(q))).toBe(false); // archive never breaks the graph: no kind 0
    expect(hooked).toEqual([]);
    expect(s[2]).toMatch(/UPDATE recipes r SET archived_at/);
    expect(s[3]).toMatch(/INSERT INTO config_audit/);
    expect(s[4]).toMatch(/FROM branches .*FOR UPDATE/); // kind 10, last
    expect(s[5]).toMatch(/UPDATE branches SET config_version/);
    expect(await archivedAt(r.recipeId)).toBe(String(NOW));
    expect(await configVersions()).toEqual(before.map((n) => n + 1));
    const audit = await auditOf([r.recipeId]);
    expect(audit.at(-1)).toMatchObject({ entity: 'recipe', entity_id: r.recipeId, action: 'archive', branch_id: null });
    expect(audit.at(-1)!.before).toMatchObject({ archived_at: null });
    expect(audit.at(-1)!.after).toMatchObject({ archived_at: NOW });
    // the published version stays as it was (old orders, 08c)
    expect((await sql(`SELECT status FROM recipe_versions WHERE tenant_id = $1 AND recipe_version_id = $2`, [r.published.recipe_version_id])).rows).toEqual([
      { status: 'published' },
    ]);
  });

  it('[08b #18] archive of an already archived recipe → no-op 200 in 2 statements, no audit, no bump; a stale expected_version → 409 CONFIG_STALE, nothing written; unknown recipe → 404 RECIPE_NOT_FOUND; a body without archived → 400', async () => {
    const item = await menuItem('Twice archived', 'piece');
    const r = await live('menu_item', item, { lines: [grams(fx.stock.beef)] });
    const v = await archived(r.recipeId, r.version);
    const before = await state();
    const again = await patched(r.recipeId, v, true, 2);
    expect(again.version).toBe(v);
    expect(await state()).toEqual(before);

    const stale = await patch(r.recipeId, r.version, true); // the active state's version
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().error).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'recipe', id: r.recipeId } });
    expect(await state()).toEqual(before);

    const missing = await patch('NO-SUCH-RECIPE', v, true);
    expect(missing.statusCode, missing.body).toBe(404);
    expect(missing.json().error.code).toBe('RECIPE_NOT_FOUND');
    const bad = await cloud.app.inject({ method: 'PATCH', url: `/v1/admin/recipes/${r.recipeId}`, headers: owner(fx.f).headers, payload: { expected_version: v } });
    expect(bad.statusCode).toBe(400);
  });

  it('[08b #18] archive of a never-published recipe: 4 statements (no bump); [08b #26] (AD-29) it bumps no branch', async () => {
    const item = await menuItem('Draft only plate', 'piece');
    const { recipeId, version } = await drafted('menu_item', item, { lines: [grams(fx.stock.beef)] });
    const before = await configVersions();
    await patched(recipeId, version, true, 4);
    expect(log.sql.some((q) => /FROM branches .*FOR UPDATE|UPDATE branches/.test(q))).toBe(false);
    expect(await configVersions()).toEqual(before);
    expect((await auditOf([recipeId])).at(-1)).toMatchObject({ entity: 'recipe', action: 'archive' });
  });

  it('[08b #26] (AD-29) recipe create bumps no branch (B16: draft only)', async () => {
    const item = await menuItem('No bump create', 'piece');
    const before = await configVersions();
    await create('menu_item', item);
    expect(await configVersions()).toEqual(before);
  });

  it('[08b #26] (AD-29) draft save bumps no branch (B16)', async () => {
    const { recipeId, draft } = await create('menu_item', await menuItem('No bump draft', 'piece'));
    const before = await configVersions();
    await saveDraft(recipeId, { expected_version: draft.version, lines: [grams(fx.stock.beef)] });
    expect(log.sql.some((q) => /\bbranches\b/.test(q) && /UPDATE|FOR UPDATE/.test(q))).toBe(false);
    expect(await configVersions()).toEqual(before);
  });

  it('[08b #26] (AD-29) archive of a never-published recipe bumps no branch; its restore bumps none either', async () => {
    const { recipeId, version } = await create('menu_item', await menuItem('No bump archive', 'piece'));
    const before = await configVersions();
    const v = await archived(recipeId, version);
    expect(await configVersions()).toEqual(before);
    await patched(recipeId, v, false, 5);
    expect(await configVersions()).toEqual(before);
  });

  // --------------------------------------------------------------------------------------- restore (#18)

  it('[08b #18] restore of an active recipe → no-op 200 in 3 statements: tenant-wide, kind 0 FIRST, recipe FOR UPDATE; afterPublishLock right after kind 0; no audit, no bump', async () => {
    const item = await menuItem('Already active', 'piece');
    const r = await live('menu_item', item, { lines: [grams(fx.stock.beef)] });
    const before = await state();
    hooked.length = 0;
    const recipe = await patched(r.recipeId, r.version, false, 3);
    expect(recipe.version).toBe(r.version);
    expect(log.sql[0]).toMatch(/bool_and/);
    expect(log.sql[1]).toMatch(/pg_advisory_xact_lock\(8020, hashtext\(/);
    expect(hooked).toEqual([`${PATCH_ROUTE}@2`]);
    expect(log.sql[2]).toMatch(/FROM recipes .*FOR UPDATE/);
    expect(await state()).toEqual(before);
  });

  it('[08b #18] restore of a recipe without a published version: 5 statements (tenant-wide, kind 0, recipe, write, audit), recipe / restore audit row, no bump', async () => {
    const { recipeId, version } = await drafted('menu_item', await menuItem('Restore draft only', 'piece'), { lines: [grams(fx.stock.beef)] });
    const v = await archived(recipeId, version);
    const before = await configVersions();
    hooked.length = 0;
    const recipe = await patched(recipeId, v, false, 5);
    expect(recipe.version).toBe(version); // back to the active state
    expect(log.sql[1]).toMatch(/pg_advisory_xact_lock\(8020/);
    expect(hooked).toEqual([`${PATCH_ROUTE}@2`]);
    expect(log.sql[2]).toMatch(/FROM recipes .*FOR UPDATE/);
    expect(log.sql[3]).toMatch(/UPDATE recipes r SET archived_at/);
    expect(log.sql[4]).toMatch(/INSERT INTO config_audit/);
    expect(await archivedAt(recipeId)).toBeNull();
    expect(await configVersions()).toEqual(before);
    const audit = await auditOf([recipeId]);
    expect(audit.at(-1)).toMatchObject({ entity: 'recipe', action: 'restore' });
    expect(audit.at(-1)!.before).toMatchObject({ archived_at: NOW });
    expect(audit.at(-1)!.after).toMatchObject({ archived_at: null });
  });

  it('[08b #18] restore of a menu-item recipe with a published version: 10 statements in the §6 lock order (tenant-wide, kind 0, recipe, graph read with the recipe back, menu item FOR SHARE, stock items FOR SHARE, write, audit, bump 2); every branch bumped; recipe / restore audit row', async () => {
    const item = await menuItem('Restore plate', 'piece');
    const r = await live('menu_item', item, { lines: [grams(fx.stock.beef, '200'), grams(fx.stock.tp1, '15')] });
    const v = await archived(r.recipeId, r.version);
    const before = await configVersions();
    hooked.length = 0;
    const recipe = await patched(r.recipeId, v, false, 10);
    expect(recipe.version).toBe(r.version);
    const s = [...log.sql];
    expect(s[0]).toMatch(/bool_and/);
    expect(s[1]).toMatch(/pg_advisory_xact_lock\(8020, hashtext\(/); // kind 0 first
    expect(hooked).toEqual([`${PATCH_ROUTE}@2`]);
    expect(s[2]).toMatch(/FROM recipes .*FOR UPDATE/); // kind 0.5
    expect(s[3]).toMatch(/status = 'published' AND \(r\.archived_at IS NULL OR r\.recipe_id = \$2\)/); // graph + this recipe, one statement
    expect(s[4]).toMatch(/FROM menu_items .*FOR SHARE/); // kind 4
    expect(s[5]).toMatch(/FROM stock_items .*FOR SHARE/); // kind 5
    expect(s[6]).toMatch(/UPDATE recipes r SET archived_at/);
    expect(s[7]).toMatch(/INSERT INTO config_audit/);
    expect(s[8]).toMatch(/FROM branches .*FOR UPDATE/); // kind 10, last
    expect(s[9]).toMatch(/UPDATE branches SET config_version/);
    expect(await archivedAt(r.recipeId)).toBeNull();
    expect(await configVersions()).toEqual(before.map((n) => n + 1));
    expect((await auditOf([r.recipeId])).at(-1)).toMatchObject({ entity: 'recipe', action: 'restore' });
    expect(await publishedOwners([item])).toEqual([{ owner_id: item, measure_unit: null, basis: 'per_unit' }]);
  });

  it('[08b #18] restore with a published version: stock-item owner 9 statements (owner read with the line stock items, kind 5); option owner 10 (read under its group, kind 1, FOR SHARE OF g, o)', async () => {
    const batch = await prepared('Restore batch');
    const b = await live('stock_item', batch, { batch_yield_qty: 10, lines: [grams(fx.stock.ghee)] });
    const bv = await archived(b.recipeId, b.version);
    await patched(b.recipeId, bv, false, 9);
    expect(log.sql[3]).toMatch(/r\.recipe_id = \$2/);
    expect(log.sql[4]).toMatch(/FROM stock_items .*FOR SHARE/);
    expect(log.sql[5]).toMatch(/UPDATE recipes r SET archived_at/);

    const group = await createModifierGroup(cloud, fx.f, { name: 'Restore extras', min_choices: 0, max_choices: 1, options: [{ name: 'Lemon', price_minor: 0 }] });
    const lemon = group.options[0]!.option_id;
    const o = await live('modifier_option', lemon, { lines: [grams(fx.stock.ghee, '5')] });
    const ov = await archived(o.recipeId, o.version);
    await patched(o.recipeId, ov, false, 10);
    expect(log.sql[4]).toMatch(/FROM modifier_options o JOIN modifier_groups g .*FOR SHARE OF g, o/);
    expect(log.sql[5]).toMatch(/FROM stock_items .*FOR SHARE/);
  });

  it('[08b #18] restore of an unknown recipe → 404 RECIPE_NOT_FOUND and a stale expected_version → 409 CONFIG_STALE, each after kind 0 (taken first on every archived: false); nothing written', async () => {
    const missing = await patch('NO-SUCH-RECIPE', 'x', false);
    expect(missing.statusCode, missing.body).toBe(404);
    expect(missing.json().error.code).toBe('RECIPE_NOT_FOUND');
    expect(log.sql[1]).toMatch(/pg_advisory_xact_lock\(8020/);
    expect(log.sql[2]).toMatch(/FROM recipes .*FOR UPDATE/);

    const item = await menuItem('Stale restore', 'piece');
    const r = await live('menu_item', item, { lines: [grams(fx.stock.beef)] });
    await archived(r.recipeId, r.version);
    const mid = await state();
    const stale = await patch(r.recipeId, r.version, false); // the active state's version
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().error).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'recipe', id: r.recipeId } });
    expect(log.sql[1]).toMatch(/pg_advisory_xact_lock\(8020/);
    expect(await state()).toEqual(mid);
  });

  it('[08b #18] an owner-archived recipe may be restored (the owner stays archived; its checks run against the owner row)', async () => {
    const item = await menuItem('Owner gone plate', 'piece');
    const r = await live('menu_item', item, { lines: [grams(fx.stock.beef)] });
    const v = await archived(r.recipeId, r.version);
    ok(await patchItem(item, { archived: true }));
    await patched(r.recipeId, v, false, 10);
    expect(await archivedAt(r.recipeId)).toBeNull();
    expect((await sql(`SELECT archived_at IS NOT NULL AS a FROM menu_items WHERE tenant_id = $1 AND item_id = $2`, [item])).rows).toEqual([{ a: true }]);
  });

  // ------------------------------------------------ §6.6 edge rows; restore half of test 22 (real B17 routes)

  it('[08b #18 / #22] "Lassi" per_measure at g archived → sale_unit g → ml (C-14: 409 while active, 200 after the archive) → restore 422 { archived, basis_mismatch, hint: new_draft } (T-2); nothing written', async () => {
    const lassi = await menuItem('Lassi by weight', 'g');
    const r = await live('menu_item', lassi, { base_qty: 1000, lines: [{ stock_item_id: fx.stock.milk, unit_name: 'ml', qty: '1000' }] });
    expect(r.published.measure_unit).toBe('g');
    inUse(await patchItem(lassi, { sale_unit: 'ml' }));
    const v = await archived(r.recipeId, r.version);
    ok(await patchItem(lassi, { sale_unit: 'ml' }));
    const before = await state();
    expectRestoreRefused(await patch(r.recipeId, v, false), 'basis_mismatch');
    expect(await state()).toEqual(before);
  });

  it('[08b #18 / #22] plain option archived → made linked (C-15: 409 while active, 200 after) → restore 422 linked_option; nothing written', async () => {
    const group = await createModifierGroup(cloud, fx.f, { name: 'Link later', min_choices: 0, max_choices: 1, options: [{ name: 'Hot', price_minor: 0 }] });
    const hot = group.options[0]!.option_id;
    const r = await live('modifier_option', hot, { lines: [grams(fx.stock.ghee, '5')] });
    inUse(await linkOption(group.modifier_group_id, hot, fx.items.naan));
    const v = await archived(r.recipeId, r.version);
    ok(await linkOption(group.modifier_group_id, hot, fx.items.naan));
    const before = await state();
    expectRestoreRefused(await patch(r.recipeId, v, false), 'linked_option');
    expect(await state()).toEqual(before);
  });

  it('[08b #18 / #22] "Tawa piece"-like recipe archived → a line item’s stock_unit g → ml (C-11: 409 while active, 200 after) → restore 422 unit_changed (N-1 c); nothing written', async () => {
    const spice = await ingredient('Restore ghee');
    const r = await live('menu_item', await menuItem('Tawa unit plate', 'piece'), { lines: [grams(fx.stock.beef), grams(spice, '20')] });
    inUse(await patchStock(spice, { stock_unit: 'ml' }));
    const v = await archived(r.recipeId, r.version);
    ok(await patchStock(spice, { stock_unit: 'ml' }));
    const before = await state();
    expectRestoreRefused(await patch(r.recipeId, v, false), 'unit_changed');
    expect(await state()).toEqual(before);
  });

  it('[08b #18 / #22] PAYE-like batch archived → its own stock_unit piece → g (C-11 N-1 b: 409 while active, 200 after) → restore 422 unit_changed (frozen batch_stock_unit); nothing written', async () => {
    const batch = await prepared('Restore PAYE');
    const r = await live('stock_item', batch, { batch_yield_qty: 160, lines: [grams(fx.stock.payeRaw, '4000')] });
    inUse(await patchStock(batch, { stock_unit: 'g' }));
    const v = await archived(r.recipeId, r.version);
    ok(await patchStock(batch, { stock_unit: 'g' }));
    const before = await state();
    expectRestoreRefused(await patch(r.recipeId, v, false), 'unit_changed');
    expect(await state()).toEqual(before);
  });

  it('[08b #18 / #22] a line stock item archived (C-11: 409 while active, 200 after the recipe archive) → restore 422 archived; nothing written', async () => {
    const herb = await ingredient('Restore herb');
    const r = await live('menu_item', await menuItem('Herb plate', 'piece'), { lines: [grams(fx.stock.beef), grams(herb, '5')] });
    inUse(await patchStock(herb, { archived: true }));
    const v = await archived(r.recipeId, r.version);
    ok(await patchStock(herb, { archived: true }));
    const before = await state();
    expectRestoreRefused(await patch(r.recipeId, v, false), 'archived');
    expect(await state()).toEqual(before);
  });

  it('[08b #18 / #22] a prepared owner archived → kind prepared → ingredient (P-2: 409 while active, 200 after) → restore 422 wrong_kind; nothing written', async () => {
    const gravy = await prepared('Restore gravy', 'g');
    const r = await live('stock_item', gravy, { batch_yield_qty: 1000, lines: [{ stock_item_id: fx.stock.oil, unit_name: 'ml', qty: '100' }] });
    inUse(await patchStock(gravy, { kind: 'ingredient' }));
    const v = await archived(r.recipeId, r.version);
    ok(await patchStock(gravy, { kind: 'ingredient' }));
    const before = await state();
    expectRestoreRefused(await patch(r.recipeId, v, false), 'wrong_kind');
    expect(await state()).toEqual(before);
  });

  it('[08b #18] cycle (M-3 scenario b): A (A → B) archived, B (B → A) published while A is archived → restore of A 422 cycle; too_deep: A (A → B) archived, B → C → D published → restore of A 422 too_deep; nothing written', async () => {
    const [a, b] = [await prepared('Restore cycle A'), await prepared('Restore cycle B')];
    const ra = await live('stock_item', a, { batch_yield_qty: 10, lines: [piece(b)] });
    const va = await archived(ra.recipeId, ra.version);
    await live('stock_item', b, { batch_yield_qty: 10, lines: [piece(a)] }); // A is out of the graph: no cycle yet
    const before = await state();
    expectRestoreRefused(await patch(ra.recipeId, va, false), 'cycle');
    expect(await state()).toEqual(before);

    const [p, q, r, s] = [await prepared('Restore deep A'), await prepared('Restore deep B'), await prepared('Restore deep C'), await prepared('Restore deep D')];
    const rp = await live('stock_item', p, { batch_yield_qty: 10, lines: [piece(q)] }); // A → B
    const vp = await archived(rp.recipeId, rp.version);
    await live('stock_item', r, { batch_yield_qty: 10, lines: [piece(s)] }); // C → D
    await live('stock_item', q, { batch_yield_qty: 10, lines: [piece(r)] }); // B → C → D: 3 levels
    const mid = await state();
    expectRestoreRefused(await patch(rp.recipeId, vp, false), 'too_deep'); // A → B → C → D: 4
    expect(await state()).toEqual(mid);
  });

  // ---------------------------------------------------------------------------------------- test 18b

  it('[08b #18b] the way forward: "Chicken karahi" (piece) with a published recipe → archive → sale_unit → g 200 → restore 422 new_draft → PUT draft per_measure base_qty 1000 → publish 200: recipe active, the per_unit version superseded, one recipe / restore audit row, every branch bumped; a 1 250 g karahi line costs × 5/4 from the new version (engine)', async () => {
    const karahi = await menuItem('Chicken karahi (piece)', 'piece');
    const r = await live('menu_item', karahi, { lines: [{ stock_item_id: fx.stock.beef, unit_name: 'g', qty: '1000', qty_basis: 'AP' }] });
    inUse(await patchItem(karahi, { sale_unit: 'g' }));
    const v = await archived(r.recipeId, r.version);
    ok(await patchItem(karahi, { sale_unit: 'g' }));
    const before = await state();
    expectRestoreRefused(await patch(r.recipeId, v, false), 'basis_mismatch');
    expect(await state()).toEqual(before);

    // no draft after the publish: expected_version null creates version 2, derived from the locked owner (now g)
    const next = await saveDraft(r.recipeId, { expected_version: null, base_qty: 1000, lines: [{ stock_item_id: fx.stock.beef, unit_name: 'g', qty: '1000', qty_basis: 'AP' }] });
    expect(next).toMatchObject({ version_no: 2, basis: 'per_measure', measure_unit: 'g', base_qty: 1000 });
    const bumped = await configVersions();
    const v2 = await published(r.recipeId, next.version);
    expect(v2).toMatchObject({ status: 'published', basis: 'per_measure', measure_unit: 'g' });
    expect(await archivedAt(r.recipeId)).toBeNull();
    expect(
      (await sql(`SELECT version_no, status FROM recipe_versions WHERE tenant_id = $1 AND recipe_id = $2 ORDER BY version_no`, [r.recipeId])).rows,
    ).toEqual([
      { version_no: 1, status: 'superseded' },
      { version_no: 2, status: 'published' },
    ]);
    const restores = (await auditOf([r.recipeId])).filter((a) => a.entity === 'recipe' && a.action === 'restore');
    expect(restores).toHaveLength(1);
    expect(await configVersions()).toEqual(bumped.map((n) => n + 1));

    // the engine on the cost context: 1 000 g beef AP at Rs 1 500 / kg = 150 000 per 1 000 g, × 1.05 = 157 500;
    // a 1 250 g line → × 5/4 = 196 875
    const client = await cloud.pool.connect();
    try {
      const context = await selectCostContext(new TenantLevelRepository(Object.freeze({ tenantId: fx.f.tenantId, branchIds: [] }), client), null, NOW);
      const inputs = buildCostInputs(context.rows);
      const cost = plateCost(inputs, { kind: 'item', item_id: karahi, quantity: 1250n, sale_unit: 'g', options: [] }, null, NOW);
      expect(cost.status).toBe('costed');
      expect(cost.recipe_version_ids.item).toBe(v2.recipe_version_id);
      expect(roundMinor(cost.value)).toBe(196_875n);
    } finally {
      client.release();
    }
  });

  it('[08b #18b] race: publish of an archived recipe’s per_measure g draft ∥ C-14 sale_unit g → ml of its owner, both orders → one serialises on the menu item; never a published version whose measure_unit ≠ the committed sale_unit', async () => {
    for (const order of ['publish waits', 'edit waits'] as const) {
      const line = await ingredient(`Race karahi beef ${order}`);
      const item = await menuItem(`Race karahi ${order}`, 'piece');
      const r = await live('menu_item', item, { lines: [grams(line, '1000')] });
      await archived(r.recipeId, r.version);
      ok(await patchItem(item, { sale_unit: 'g' }));
      const next = await saveDraft(r.recipeId, { expected_version: null, base_qty: 1000, lines: [grams(line, '1000')] });

      let pub: LightMyRequestResponse;
      let edit: LightMyRequestResponse;
      if (order === 'publish waits') {
        // the publish holds kind 0 (before any row lock); the owner edit commits first
        const hold = holdPublishLock(PUBLISH_ROUTE);
        try {
          const p = publish(r.recipeId, next.version);
          await hold.arrived;
          edit = await patchItem(item, { sale_unit: 'ml' });
          hold.release();
          pub = await p;
        } finally {
          hold.release();
          delete control.afterPublishLock;
        }
        ok(edit);
        expect(pub.statusCode, pub.body).toBe(422);
        expect(pub.json().error.details).toMatchObject({ reason: 'basis_mismatch' });
      } else {
        // the publish holds the menu item FOR SHARE (kind 4) and waits at kind 5; the owner edit waits on the item
        const open = await gate(line);
        try {
          const p = publish(r.recipeId, next.version);
          await waiting(1);
          const e = patchItem(item, { sale_unit: 'ml' });
          await waiting(2);
          await open();
          [pub, edit] = await Promise.all([p, e]);
        } finally {
          await open();
        }
        ok(pub);
        inUse(edit);
      }
      const sale = (await sql(`SELECT sale_unit FROM menu_items WHERE tenant_id = $1 AND item_id = $2`, [item])).rows[0]!.sale_unit as string;
      for (const row of await publishedOwners([item])) expect(row.measure_unit).toBe(sale);
    }
  });

  // -------------------------------------------------------------------------------------- test 37 races

  it('[08b #37] restore ∥ publish of the same recipe, both orders (afterPublishLock holds the first) → serial on kind 0, never 40P01: restore first → both 200; publish first (un-archives) → restore 409 CONFIG_STALE', async () => {
    for (const first of [PATCH_ROUTE, PUBLISH_ROUTE]) {
      const item = await menuItem(`Race restore ${first.slice(0, 5)}`, 'piece');
      const r = await live('menu_item', item, { lines: [grams(fx.stock.beef, '200')] });
      const v = await archived(r.recipeId, r.version);
      const next = await saveDraft(r.recipeId, { expected_version: null, lines: [grams(fx.stock.beef, '250')] });
      const hold = holdPublishLock(first);
      let restore: LightMyRequestResponse;
      let pub: LightMyRequestResponse;
      try {
        if (first === PATCH_ROUTE) {
          const p1 = patch(r.recipeId, v, false);
          await hold.arrived;
          const p2 = publish(r.recipeId, next.version);
          await waiting(1, true); // the publish waits on kind 0
          hold.release();
          [restore, pub] = await Promise.all([p1, p2]);
          ok(restore);
          ok(pub);
        } else {
          const p1 = publish(r.recipeId, next.version);
          await hold.arrived;
          const p2 = patch(r.recipeId, v, false);
          await waiting(1, true); // the restore waits on kind 0
          hold.release();
          [pub, restore] = await Promise.all([p1, p2]);
          ok(pub);
          expect(restore.statusCode, restore.body).toBe(409);
          expect(restore.json().error.code).toBe('CONFIG_STALE');
        }
      } finally {
        hold.release();
        delete control.afterPublishLock;
      }
      for (const res of [restore, pub]) expect(res.body).not.toMatch(/40P01|deadlock/i);
      expect(await archivedAt(r.recipeId)).toBeNull();
      expect((await publishedOwners([item])).map((row) => row.owner_id)).toEqual([item]);
      expect((await auditOf([r.recipeId])).filter((a) => a.action === 'restore')).toHaveLength(1);
    }

    // the restore held AFTER its recipe lock (kinds 0 + 0.5 both held): the publish waits on kind 0, never on the
    // recipe row first — no lock cycle, never 40P01
    const item = await menuItem('Race restore held row', 'piece');
    const r = await live('menu_item', item, { lines: [grams(fx.stock.beef, '200')] });
    const v = await archived(r.recipeId, r.version);
    const next = await saveDraft(r.recipeId, { expected_version: null, lines: [grams(fx.stock.beef, '260')] });
    const hold = holdRecipeLock(PATCH_ROUTE);
    try {
      const p1 = patch(r.recipeId, v, false);
      await hold.arrived;
      const p2 = publish(r.recipeId, next.version);
      await waiting(1, true); // the publish waits on kind 0
      hold.release();
      const [restore, pub] = await Promise.all([p1, p2]);
      ok(restore);
      ok(pub);
    } finally {
      hold.release();
      delete control.afterRecipeLock;
    }
    expect(await archivedAt(r.recipeId)).toBeNull();
    expect((await publishedOwners([item])).map((row) => row.owner_id)).toEqual([item]);
  });

  it('[08b #18 / B16] archive waiting behind the FIRST publish of the same recipe (publish holds the recipe row) → the archive sees the publish and bumps: every branch +2 (publish + archive); audit rows publish then archive', async () => {
    const line = await ingredient('Race first publish spice');
    const item = await menuItem('Race first publish', 'piece');
    const d = await drafted('menu_item', item, { lines: [grams(line, '50')] }); // never published
    const before = await configVersions();
    const open = await gate(line);
    let pub: LightMyRequestResponse;
    let arch: LightMyRequestResponse;
    try {
      const p = publish(d.recipeId, d.draft.version);
      await waiting(1); // the publish holds kind 0 + the recipe row, waits at kind 5
      const a = patch(d.recipeId, d.version, true);
      await waiting(2); // the archive waits on the recipe row (no kind 0)
      await open();
      [pub, arch] = await Promise.all([p, a]);
    } finally {
      await open();
    }
    ok(pub);
    ok(arch);
    expect(arch.json().data.recipe).toMatchObject({ recipe_id: d.recipeId, archived: true });
    expect(await configVersions()).toEqual(before.map((n) => n + 2));
    const audit = (await auditOf([d.recipeId, d.draft.recipe_version_id])).filter((a) => a.action !== 'create' && a.action !== 'update');
    expect(audit.map((a) => [a.entity, a.action])).toEqual([
      ['recipe_version', 'publish'],
      ['recipe', 'archive'],
    ]);
    expect(await archivedAt(d.recipeId)).not.toBeNull();
  });

  it('[08b #37] restore ∥ a C-14 sale_unit change of its owner, both orders → the restore 422 basis_mismatch or the owner edit 409 CONFIG_IN_USE; never a restored recipe with a flipped basis', async () => {
    for (const order of ['restore waits', 'edit waits'] as const) {
      const line = await ingredient(`Race restore beef ${order}`);
      const item = await menuItem(`Race restore item ${order}`, 'piece');
      const r = await live('menu_item', item, { lines: [grams(line, '300')] });
      const v = await archived(r.recipeId, r.version);
      let restore: LightMyRequestResponse;
      let edit: LightMyRequestResponse;
      if (order === 'restore waits') {
        const hold = holdPublishLock(PATCH_ROUTE);
        try {
          const p = patch(r.recipeId, v, false);
          await hold.arrived;
          edit = await patchItem(item, { sale_unit: 'g' }); // the recipe is still archived: allowed
          hold.release();
          restore = await p;
        } finally {
          hold.release();
          delete control.afterPublishLock;
        }
        ok(edit);
        expectRestoreRefused(restore, 'basis_mismatch');
        expect(await archivedAt(r.recipeId)).not.toBeNull();
      } else {
        const open = await gate(line);
        try {
          const p = patch(r.recipeId, v, false);
          await waiting(1); // the restore holds the menu item FOR SHARE, waits at kind 5
          const e = patchItem(item, { sale_unit: 'g' });
          await waiting(2); // the owner edit waits on the menu item
          await open();
          [restore, edit] = await Promise.all([p, e]);
        } finally {
          await open();
        }
        ok(restore);
        inUse(edit);
        expect(await archivedAt(r.recipeId)).toBeNull();
      }
      const sale = (await sql(`SELECT sale_unit FROM menu_items WHERE tenant_id = $1 AND item_id = $2`, [item])).rows[0]!.sale_unit as string;
      for (const row of await publishedOwners([item])) expect(row.basis).toBe(sale === 'piece' ? 'per_unit' : 'per_measure');
    }
  });

  // -------------------------------------------------------------------------------------- test 38 race

  it('[08b #38] restore of A (A → B) ∥ publish of B (B → A), both orders → exactly one 422 cycle; the published graph is acyclic after both commit', async () => {
    for (const first of [PATCH_ROUTE, PUBLISH_ROUTE]) {
      const [a, b] = [await prepared(`Race cyc A ${first.slice(0, 5)}`), await prepared(`Race cyc B ${first.slice(0, 5)}`)];
      const ra = await live('stock_item', a, { batch_yield_qty: 10, lines: [piece(b)] });
      const va = await archived(ra.recipeId, ra.version);
      const rb = await drafted('stock_item', b, { batch_yield_qty: 10, lines: [piece(a)] });
      const hold = holdPublishLock(first);
      let restore: LightMyRequestResponse;
      let pub: LightMyRequestResponse;
      try {
        const p1 = first === PATCH_ROUTE ? patch(ra.recipeId, va, false) : publish(rb.recipeId, rb.draft.version);
        await hold.arrived;
        const p2 = first === PATCH_ROUTE ? publish(rb.recipeId, rb.draft.version) : patch(ra.recipeId, va, false);
        await waiting(1, true);
        hold.release();
        const [x, y] = await Promise.all([p1, p2]);
        [restore, pub] = first === PATCH_ROUTE ? [x, y] : [y, x];
      } finally {
        hold.release();
        delete control.afterPublishLock;
      }
      if (first === PATCH_ROUTE) {
        ok(restore);
        expect(pub.statusCode, pub.body).toBe(422);
        expect(pub.json().error.details).toMatchObject({ field: 'lines', reason: 'cycle' });
      } else {
        ok(pub);
        expectRestoreRefused(restore, 'cycle');
      }
      // exactly one of A, B is live: acyclic
      expect(await publishedOwners([a, b])).toHaveLength(1);
    }
  });
});
