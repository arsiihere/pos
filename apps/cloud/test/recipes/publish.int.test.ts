/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DraftSaved, RecipeCreated, RecipePublished, RecipeVersionWire } from '@pos/events';
import type { LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createModifierGroup, createStockItem } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { recipeFixture, type RecipeFixture } from './fixtures';

// 08 v1.1 Part B §6.5: POST /v1/admin/recipes/:recipe_id/publish — §10.2 tests 14 (superseded / published,
// immutability grep, 17 / 16 / 16 / 15 statements, 18 / 17 / 17 / 16 on an archived recipe), 15 (every B6 refusal,
// the empty option recipe, warnings), 16 (B-1 race: two publishes forming a cycle), 17 (bump every branch), and the
// T-1 / 18b publish parts (an archived recipe's new draft publishes and un-archives it).

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

// ------------------------------------------------------------------------------------------- source grep (#14)

// §10.2 test 14 / B8 (as 08a #34): published content is immutable. No statement in apps/cloud/src changes a
// recipe_lines row of a non-draft version, and none changes a non-draft version's fields other than `status`:
// every UPDATE / DELETE / MERGE / upsert of recipe_lines must be guarded by the version's `status = 'draft'`, and
// every UPDATE of recipe_versions must either be guarded by `status = 'draft'` or SET `status` alone.
const SRC = fileURLToPath(new URL('../../src', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|sql)$/.test(entry.name) ? [path] : [];
  });
}

// The statement text from a match to the end of its string literal / SQL statement (a backtick, quote or `;`).
function statementAt(text: string, index: number): string {
  const rest = text.slice(index);
  const end = rest.search(/[`;]/);
  return end === -1 ? rest : rest.slice(0, end);
}

const DRAFT_GUARD = /\bstatus\s*=\s*'draft'/i;

export function immutabilityOffenders(text: string): string[] {
  const found: string[] = [];
  const lines = /\b(?:UPDATE\s+(?:ONLY\s+)?|DELETE\s+FROM\s+(?:ONLY\s+)?|MERGE\s+INTO\s+|TRUNCATE\s+(?:TABLE\s+)?)(?:"?public"?\.)?"?recipe_lines\b/gi;
  for (const m of text.matchAll(lines)) {
    const statement = statementAt(text, m.index);
    if (/^TRUNCATE/i.test(m[0]) || !DRAFT_GUARD.test(statement)) found.push(statement.slice(0, 80));
  }
  for (const m of text.matchAll(/\bINSERT\s+INTO\s+(?:"?public"?\.)?"?recipe_(?:lines|versions)\b/gi)) {
    const statement = statementAt(text, m.index);
    if (/\bDO\s+UPDATE\b/i.test(statement)) found.push(statement.slice(0, 80));
  }
  for (const m of text.matchAll(/\bUPDATE\s+(?:ONLY\s+)?(?:"?public"?\.)?"?recipe_versions\b/gi)) {
    const statement = statementAt(text, m.index);
    if (DRAFT_GUARD.test(statement.split(/\bWHERE\b/i)[1] ?? '')) continue; // a draft's own fields
    const set = /\bSET\b([\s\S]*?)(?:\bWHERE\b|\bFROM\b|\bRETURNING\b|$)/i.exec(statement)?.[1] ?? '';
    const columns = set.split(',').map((part) => part.split('=')[0]!.trim().toLowerCase());
    if (columns.some((column) => column !== 'status')) found.push(statement.slice(0, 80));
  }
  return found;
}

describe('08b published recipe versions are immutable (source grep, §10.2 #14, B8)', () => {
  const files = sourceFiles(SRC);

  it('[08b #14] the scan sees the recipes repository and the migration that creates recipe_versions / recipe_lines', () => {
    const rel = files.map((file) => relative(SRC, file));
    expect(rel).toEqual(expect.arrayContaining([join('modules', 'recipes', 'repository.ts'), join('db', 'migrations', '0019_recipes.sql')]));
    const all = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(all).toMatch(/\bUPDATE\s+recipe_versions\b/); // the scan has something to check
    expect(all).toMatch(/\bDELETE\s+FROM\s+recipe_lines\b/);
  });

  it('[08b #14] no statement in apps/cloud/src updates a non-draft version’s lines, or a non-draft version’s fields other than status', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const hit of immutabilityOffenders(readFileSync(file, 'utf8'))) offenders.push(`${relative(SRC, file)}: ${hit}`);
    }
    expect(offenders).toEqual([]);
  });

  it('[08b #14] the grep itself catches each form (guards the regexes)', () => {
    expect(immutabilityOffenders('`UPDATE recipe_lines SET qty_basis = $2 WHERE tenant_id = $1`')).toHaveLength(1);
    expect(immutabilityOffenders('`DELETE FROM recipe_lines WHERE tenant_id = $1 AND recipe_version_id = $2`')).toHaveLength(1);
    expect(immutabilityOffenders('`TRUNCATE recipe_lines`')).toHaveLength(1);
    expect(immutabilityOffenders("`UPDATE recipe_versions SET status = 'superseded', base_qty = 2 WHERE tenant_id = $1`")).toHaveLength(1);
    expect(immutabilityOffenders("`UPDATE recipe_versions SET misc_allowance_bp = 0 WHERE tenant_id = $1 AND status = 'published'`")).toHaveLength(1);
    expect(immutabilityOffenders('`INSERT INTO recipe_lines (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a = 2`')).toHaveLength(1);
    // allowed: a status-only change, a draft's own fields, a draft's lines
    expect(immutabilityOffenders("`UPDATE recipe_versions SET status = 'superseded' WHERE tenant_id = $1 AND status = 'published'`")).toEqual([]);
    expect(immutabilityOffenders("`UPDATE recipe_versions SET base_qty = $3 WHERE tenant_id = $1 AND status = 'draft'`")).toEqual([]);
    expect(
      immutabilityOffenders("`DELETE FROM recipe_lines l USING recipe_versions v WHERE l.tenant_id = $1 AND v.status = 'draft'`"),
    ).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ routes

type Control = { afterPublishLock?: (route: string) => Promise<void> };

describe('08b recipe publish (§6.5)', () => {
  let cloud: TestCloud;
  let counter: ReturnType<typeof pgCounter>;
  let log: ReturnType<typeof statementLog>;
  let fx: RecipeFixture;
  const hooked: string[] = [];
  const control: Control = {};

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
      },
    });
    counter = pgCounter(cloud.pool);
    log = statementLog(cloud.pool);
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
    return { recipeId: data.recipe.recipe_id!, draft: data.draft };
  };
  const saveDraft = async (recipeId: string, payload: object) => {
    const response = await cloud.app.inject({ method: 'PUT', url: `/v1/admin/recipes/${recipeId}/draft`, headers: owner(fx.f).headers, payload });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json().data as DraftSaved).draft;
  };
  // create + one draft save: the recipe id and the draft's version
  const drafted = async (owner_type: string, owner_id: string, payload: Omit<Record<string, unknown>, 'expected_version'>) => {
    const { recipeId, draft } = await create(owner_type, owner_id);
    const saved = await saveDraft(recipeId, { expected_version: draft.version, ...payload });
    return { recipeId, draft: saved };
  };
  const publish = (recipeId: string, expected_version: string, query = '') =>
    cloud.app.inject({ method: 'POST', url: `/v1/admin/recipes/${recipeId}/publish${query}`, headers: owner(fx.f).headers, payload: { expected_version } });
  const published = async (recipeId: string, expected_version: string, statements?: number) => {
    const response = await publish(recipeId, expected_version);
    expect(response.statusCode, response.body).toBe(200);
    if (statements !== undefined) expect(counter.count).toBe(statements);
    return (response.json().data as RecipePublished).published;
  };
  // create + draft + publish (no previous version: 16, or 15 for a stock-item owner)
  const live = async (owner_type: string, owner_id: string, payload: Omit<Record<string, unknown>, 'expected_version'>) => {
    const { recipeId, draft } = await drafted(owner_type, owner_id, payload);
    return { recipeId, published: await published(recipeId, draft.version, owner_type === 'stock_item' ? 15 : 16) };
  };
  const expect422 = (response: LightMyRequestResponse, field: string, reason: string) => {
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field, reason } });
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
  const prepared = async (name: string, stock_unit: 'piece' | 'g' = 'piece') => {
    const id = (await createStockItem(cloud, fx.f, { name, stock_unit, carries_over: false })).stock_item_id;
    await sql(`UPDATE stock_items SET kind = 'prepared' WHERE tenant_id = $1 AND stock_item_id = $2`, [id]);
    return id;
  };
  const archiveRecipe = (recipeId: string) => sql(`UPDATE recipes SET archived_at = 1 WHERE tenant_id = $1 AND recipe_id = $2`, [recipeId]);
  // the owner edit as raw SQL (the recipe is archived, so C-14 would allow it); S44 keeps stock_unit = sale_unit
  const setSaleUnit = (itemId: string, unit: string) =>
    sql(`UPDATE menu_items SET sale_unit = $3, stock_unit = $3, stock_per_sale_unit = 1 WHERE tenant_id = $1 AND item_id = $2`, [itemId, unit]);
  const setStock = (id: string, set: string) => sql(`UPDATE stock_items SET ${set} WHERE tenant_id = $1 AND stock_item_id = $2`, [id]);
  const versions = async (recipeId: string) =>
    (
      await sql(
        `SELECT version_no, status, published_at::text AS published_at, published_by FROM recipe_versions WHERE tenant_id = $1 AND recipe_id = $2 ORDER BY version_no`,
        [recipeId],
      )
    ).rows as Array<{ version_no: number; status: string; published_at: string | null; published_by: string | null }>;
  const configVersions = async () =>
    (await sql(`SELECT config_version::text AS v FROM branches WHERE tenant_id = $1 ORDER BY branch_id`)).rows.map((r: { v: string }) => Number(r.v));
  const auditOf = async (ids: string[]) =>
    (
      await sql(`SELECT entity, entity_id, action, before, after, branch_id FROM config_audit WHERE tenant_id = $1 AND entity_id = ANY($2) ORDER BY audit_id`, [
        ids,
      ])
    ).rows as Array<{ entity: string; entity_id: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>;
  // everything a refused publish must leave as it was
  const state = async () => ({
    versions: (await sql(`SELECT recipe_version_id, status, published_at::text FROM recipe_versions WHERE tenant_id = $1 ORDER BY recipe_version_id`)).rows,
    recipes: (await sql(`SELECT recipe_id, archived_at::text FROM recipes WHERE tenant_id = $1 ORDER BY recipe_id`)).rows,
    audit: (await sql(`SELECT count(*)::int AS n FROM config_audit WHERE tenant_id = $1`)).rows[0],
    branches: await configVersions(),
  });
  const line = (v: RecipeVersionWire, stockItemId: string) => v.lines.find((l) => l.stock_item_id === stockItemId)!;
  const piece = (stock_item_id: string, qty = '1') => ({ stock_item_id, unit_name: 'piece', qty });

  // ------------------------------------------------------------------------------------------ test 14

  it('[08b #14] first publish of a menu item (no published version): draft → published (published_at = now, published_by), 16 statements; kind 0 first, afterPublishLock right after it, recipe lock, owner FOR SHARE before the stock items, graph read, bump last; one recipe_version / publish audit row', async () => {
    const item = await menuItem('Seekh plate', 'piece');
    const { recipeId, draft } = await drafted('menu_item', item, {
      lines: [
        { stock_item_id: fx.stock.beef, unit_name: 'g', qty: '250' },
        { stock_item_id: fx.stock.tp1, unit_name: 'g', qty: '15' },
      ],
    });
    hooked.length = 0;
    const auditBefore = (await auditOf([draft.recipe_version_id, recipeId])).length;
    const v = await published(recipeId, draft.version, 16);
    const s = [...log.sql];
    expect(v).toMatchObject({ recipe_version_id: draft.recipe_version_id, version_no: 1, status: 'published', basis: 'per_unit', published_at: NOW });
    expect(v.published_by_name).toBe('Ada');
    expect(v.created_by_name).toBe('Ada');
    expect(v.version).not.toBe(draft.version);
    expect(v.lines.map((l) => [l.stock_item_id, l.qty, l.qty_basis, l.kind])).toEqual([
      [fx.stock.beef, '250', 'EP', 'ingredient'],
      [fx.stock.tp1, '15', 'AP', 'packet'],
    ]);
    // beef 52 668.54… + TP-1 450 → × 1.05 = 55 774.47… → 55 774 (rounded once)
    expect(v.cost).toEqual({ status: 'costed', minor: '55774', unknown_items: [] });
    expect(await versions(recipeId)).toEqual([{ version_no: 1, status: 'published', published_at: String(NOW), published_by: fx.f.userId }]);

    // the §6 lock order, on the statement log
    expect(s).toHaveLength(16);
    expect(s[0]).toMatch(/bool_and/); // tenant-wide
    expect(s[1]).toMatch(/pg_advisory_xact_lock\(8020, hashtext\(/); // kind 0 first
    expect(hooked).toEqual([`${PUBLISH_ROUTE}@2`]); // afterPublishLock right after the publish lock
    expect(s[2]).toMatch(/FROM recipes .*FOR UPDATE/); // kind 0.5
    expect(s[3]).toMatch(/status IN \('draft', ?'published'\)/); // draft with lines (+ the published one)
    expect(s[4]).toMatch(/FROM menu_items .*FOR SHARE/); // kind 4
    expect(s[5]).toMatch(/FROM stock_items .*FOR SHARE/); // kind 5
    expect(s[6]).toMatch(/status = 'published' AND r\.archived_at IS NULL/); // graph read
    expect(s[7]).toMatch(/UPDATE recipe_versions SET status = 'published'/);
    expect(s[8]).toMatch(/INSERT INTO config_audit/);
    expect(s[9]).toMatch(/FROM branches .*FOR UPDATE/); // kind 10, last lock
    expect(s[10]).toMatch(/UPDATE branches SET config_version/);

    const audit = (await auditOf([v.recipe_version_id, recipeId])).slice(auditBefore);
    expect(audit.map((a) => [a.entity, a.entity_id, a.action])).toEqual([['recipe_version', v.recipe_version_id, 'publish']]);
    expect(audit[0]!.before).toMatchObject({ status: 'draft', published_at: null });
    expect(audit[0]!.after).toMatchObject({ status: 'published', published_at: NOW, published_by: fx.f.userId });
  });

  it('[08b #14] republish: a new draft (expected_version null) publishes, the old version is superseded, 17 statements, 2 audit rows (publish + update of the superseded) in one insert; publishing the same version twice → 409 CONFIG_STALE; a stale expected_version → 409, nothing written', async () => {
    const item = await menuItem('Bihari boti', 'piece');
    const { recipeId, published: v1 } = await live('menu_item', item, { lines: [{ stock_item_id: fx.stock.beef, unit_name: 'g', qty: '200' }] });
    const v2draft = await saveDraft(recipeId, { expected_version: null, lines: [{ stock_item_id: fx.stock.beef, unit_name: 'g', qty: '300' }] });
    expect(v2draft.version_no).toBe(2);

    const before = await state();
    const stale = await publish(recipeId, v1.version); // the published version's, not the draft's
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().error).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'recipe_version', id: v2draft.recipe_version_id } });
    expect(await state()).toEqual(before);

    const v2 = await published(recipeId, v2draft.version, 17);
    expect(v2).toMatchObject({ recipe_version_id: v2draft.recipe_version_id, version_no: 2, status: 'published' });
    expect((await versions(recipeId)).map((r) => [r.version_no, r.status])).toEqual([
      [1, 'superseded'],
      [2, 'published'],
    ]);
    expect(log.sql[7]).toMatch(/UPDATE recipe_versions SET status = 'superseded'/); // supersede before publish (one published index)
    expect(log.sql[8]).toMatch(/UPDATE recipe_versions SET status = 'published'/);
    const audit = await auditOf([v1.recipe_version_id, v2.recipe_version_id, recipeId]);
    expect(audit.slice(-2).map((a) => [a.entity, a.entity_id, a.action])).toEqual([
      ['recipe_version', v2.recipe_version_id, 'publish'],
      ['recipe_version', v1.recipe_version_id, 'update'],
    ]);
    expect(audit.at(-1)!.before).toMatchObject({ status: 'published' });
    expect(audit.at(-1)!.after).toMatchObject({ status: 'superseded', published_at: v1.published_at });
    // the superseded version's content is untouched (B8)
    const lines = await sql(`SELECT stock_qty_num::text FROM recipe_lines WHERE tenant_id = $1 AND recipe_version_id = $2`, [v1.recipe_version_id]);
    expect(lines.rows).toEqual([{ stock_qty_num: '200' }]);

    // publish twice with the same version: no draft any more
    const again = await publish(recipeId, v2draft.version);
    expect(again.statusCode, again.body).toBe(409);
    expect(again.json().error).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'recipe', id: recipeId } });
  });

  it('[08b #14] PAYE-COOKED batch (stock-item owner): 4 peti paye raw AP, ghee, onion, adrak-lehsan, PY-1 packet, yield 160 pieces → 15 statements (owner read with the line stock items); "Paye Half" costs batch ÷ 160 per piece with no misc on the batch (B5); a republish of the batch is 16', async () => {
    await cloud.app.inject({ method: 'POST', url: `/v1/admin/stock-items/${fx.stock.payeRaw}/units`, ...owner(fx.f), payload: { unit_name: 'peti', factor_num: 10_000 } });
    const { recipeId, draft } = await drafted('stock_item', fx.stock.payeCooked, {
      batch_yield_qty: 160,
      lines: [
        { stock_item_id: fx.stock.payeRaw, unit_name: 'peti', qty: '4' },
        { stock_item_id: fx.stock.ghee, unit_name: 'kg', qty: '2' },
        { stock_item_id: fx.stock.onion, unit_name: 'kg', qty: '1' },
        { stock_item_id: fx.stock.adrak, unit_name: 'g', qty: '500' },
        { stock_item_id: fx.stock.py1, unit_name: 'g', qty: '400' },
      ],
    });
    const batch = await published(recipeId, draft.version, 15);
    expect(batch).toMatchObject({ basis: 'per_batch', batch_yield_qty: '160', batch_stock_unit: 'piece', status: 'published' });
    expect(batch.lines.every((l) => l.qty_basis === 'AP')).toBe(true); // D7
    expect(log.sql[4]).toMatch(/FROM stock_items .*FOR SHARE/); // no owner-row statement before it
    expect(log.sql[5]).toMatch(/status = 'published' AND r\.archived_at IS NULL/);

    // Paye Half = 1 piece PAYE-COOKED: known batch lines 3 200 000 + 400 000 + 20 000 = 3 620 000 ÷ 160 = 22 625
    // (onion, adrak-lehsan have no price: the batch, and so the line, is partial)
    const half = await live('menu_item', fx.items.payeHalf, { lines: [piece(fx.stock.payeCooked)] });
    expect(line(half.published, fx.stock.payeCooked).line_cost).toEqual({ status: 'partial', minor: '22625', unknown_items: [fx.stock.payeCooked] });
    expect(half.published.cost).toMatchObject({ status: 'partial', minor: '23756' }); // × 1.05 once, at the top

    const next = await saveDraft(recipeId, { expected_version: null, batch_yield_qty: 150, lines: [{ stock_item_id: fx.stock.payeRaw, unit_name: 'peti', qty: '4' }] });
    await published(recipeId, next.version, 16);
  });

  it('[08b #14 / T-1 / 18b] an archived "Karahi" (piece) with a published recipe → sale_unit g → new per_measure draft → publish 200 in 18 statements: recipe active, the per_unit version superseded, 3 audit rows (publish, update, recipe / restore) in one insert, every branch bumped', async () => {
    const item = await menuItem('Karahi (piece)', 'piece');
    const { recipeId, published: v1 } = await live('menu_item', item, { lines: [{ stock_item_id: fx.stock.beef, unit_name: 'g', qty: '1000', qty_basis: 'AP' }] });
    await archiveRecipe(recipeId);
    await setSaleUnit(item, 'g');
    const next = await saveDraft(recipeId, { expected_version: null, base_qty: 1000, lines: [{ stock_item_id: fx.stock.beef, unit_name: 'g', qty: '1000', qty_basis: 'AP' }] });
    expect(next).toMatchObject({ basis: 'per_measure', measure_unit: 'g', base_qty: 1000 });
    const bumped = await configVersions();

    const v2 = await published(recipeId, next.version, 18);
    expect(v2).toMatchObject({ status: 'published', basis: 'per_measure', measure_unit: 'g' });
    expect(log.sql[9]).toMatch(/UPDATE recipes SET archived_at = NULL/);
    expect((await sql(`SELECT archived_at FROM recipes WHERE tenant_id = $1 AND recipe_id = $2`, [recipeId])).rows).toEqual([{ archived_at: null }]);
    expect((await versions(recipeId)).map((r) => [r.version_no, r.status])).toEqual([
      [1, 'superseded'],
      [2, 'published'],
    ]);
    const audit = (await auditOf([v1.recipe_version_id, v2.recipe_version_id, recipeId])).slice(-3);
    expect(audit.map((a) => [a.entity, a.entity_id, a.action])).toEqual([
      ['recipe_version', v2.recipe_version_id, 'publish'],
      ['recipe_version', v1.recipe_version_id, 'update'],
      ['recipe', recipeId, 'restore'],
    ]);
    expect(audit[2]!.before).toMatchObject({ archived_at: 1 });
    expect(audit[2]!.after).toMatchObject({ archived_at: null });
    expect(await configVersions()).toEqual(bumped.map((n) => n + 1));
    // costed from the new version: 1 000 g beef AP at Rs 1 500 / kg = 150 000 per 1 000 g, × 1.05
    expect(v2.cost).toEqual({ status: 'costed', minor: '157500', unknown_items: [] });
  });

  it('[08b #14 / T-1] archived recipe counts: stock-item owner with a published version 17; menu item without one 17; stock-item owner without one 16 — each un-archived with one recipe / restore row', async () => {
    // stock-item owner, previous published version
    const batchA = await prepared('Arch batch A');
    const a = await live('stock_item', batchA, { batch_yield_qty: 10, lines: [{ stock_item_id: fx.stock.ghee, unit_name: 'g', qty: '100' }] });
    await archiveRecipe(a.recipeId);
    const aNext = await saveDraft(a.recipeId, { expected_version: null, batch_yield_qty: 12, lines: [{ stock_item_id: fx.stock.ghee, unit_name: 'g', qty: '120' }] });
    await published(a.recipeId, aNext.version, 17);

    // menu item, no previous published version
    const item = await menuItem('Arch plate', 'piece');
    const m = await drafted('menu_item', item, { lines: [{ stock_item_id: fx.stock.beef, unit_name: 'g', qty: '100' }] });
    await archiveRecipe(m.recipeId);
    const mv = await published(m.recipeId, m.draft.version, 17);

    // stock-item owner, no previous published version
    const batchB = await prepared('Arch batch B');
    const b = await drafted('stock_item', batchB, { batch_yield_qty: 5, lines: [{ stock_item_id: fx.stock.ghee, unit_name: 'g', qty: '50' }] });
    await archiveRecipe(b.recipeId);
    const bv = await published(b.recipeId, b.draft.version, 16);

    for (const [recipeId, versionId] of [
      [m.recipeId, mv.recipe_version_id],
      [b.recipeId, bv.recipe_version_id],
    ] as const) {
      const audit = (await auditOf([recipeId, versionId])).filter((r) => r.action !== 'create' && r.action !== 'update');
      expect(audit.map((r) => [r.entity, r.action])).toEqual([
        ['recipe_version', 'publish'],
        ['recipe', 'restore'],
      ]);
    }
    const archived = await sql(`SELECT count(*)::int AS n FROM recipes WHERE tenant_id = $1 AND recipe_id = ANY($2) AND archived_at IS NOT NULL`, [
      [a.recipeId, m.recipeId, b.recipeId],
    ]);
    expect(archived.rows[0]).toEqual({ n: 0 });
  });

  it('[08b #14] 404 RECIPE_NOT_FOUND for an unknown recipe (after the publish lock); 400 for a body without expected_version', async () => {
    const missing = await publish('NO-SUCH-RECIPE', 'x');
    expect(missing.statusCode, missing.body).toBe(404);
    expect(missing.json().error.code).toBe('RECIPE_NOT_FOUND');
    const bad = await cloud.app.inject({ method: 'POST', url: `/v1/admin/recipes/NO-SUCH-RECIPE/publish`, headers: owner(fx.f).headers, payload: {} });
    expect(bad.statusCode).toBe(400);
  });

  // ------------------------------------------------------------------------------------------ test 15

  it('[08b #15] option "Spicy" with no lines → 200, costs 0, costed (M-6); 16 statements (the option read under its group, kind 1)', async () => {
    const { recipeId, draft } = await create('modifier_option', fx.options.spicy);
    const v = await published(recipeId, draft.version, 16);
    expect(v.cost).toEqual({ status: 'costed', minor: '0', unknown_items: [] });
    expect(log.sql[4]).toMatch(/FROM modifier_options o JOIN modifier_groups g .*FOR SHARE OF g, o/);
  });

  it('[08b #15] an empty menu-item or batch recipe → 422 { field: lines, reason: empty }; nothing written', async () => {
    const item = await menuItem('Empty plate', 'piece');
    const { recipeId, draft } = await create('menu_item', item);
    const batch = await drafted('stock_item', await prepared('Empty batch'), { batch_yield_qty: 10, lines: [] });
    const before = await state();
    expect422(await publish(recipeId, draft.version), 'lines', 'empty');
    expect422(await publish(batch.recipeId, batch.draft.version), 'lines', 'empty');
    expect(await state()).toEqual(before);
  });

  it('[08b #15] per_batch without batch_yield_qty → 422 batch_yield_missing; PAYE-like owner whose stock_unit moved piece → g → 422 { field: batch_yield_qty, reason: unit_changed }', async () => {
    const noYield = await drafted('stock_item', await prepared('No yield batch'), { lines: [{ stock_item_id: fx.stock.ghee, unit_name: 'g', qty: '100' }] });
    expect422(await publish(noYield.recipeId, noYield.draft.version), 'batch_yield_qty', 'batch_yield_missing');

    const owner2 = await prepared('Unit moved batch');
    const moved = await drafted('stock_item', owner2, { batch_yield_qty: 40, lines: [{ stock_item_id: fx.stock.ghee, unit_name: 'g', qty: '100' }] });
    await setStock(owner2, `stock_unit = 'g'`);
    const before = await state();
    expect422(await publish(moved.recipeId, moved.draft.version), 'batch_yield_qty', 'unit_changed');
    expect(await state()).toEqual(before);
  });

  it('[08b #15] a line stock item archived since the save → 422 { lines.N.stock_item_id, archived }; a line stock item whose stock_unit changed since the save → 422 { lines.N.stock_item_id, unit_changed }; nothing written', async () => {
    const gone = await createStockItem(cloud, fx.f, { name: 'Gone spice', stock_unit: 'g', carries_over: false });
    const moved = await createStockItem(cloud, fx.f, { name: 'Moved spice', stock_unit: 'g', carries_over: false });
    for (const id of [gone.stock_item_id, moved.stock_item_id]) await setStock(id, `kind = 'ingredient'`);
    const item = await menuItem('Spiced plate', 'piece');
    const { recipeId, draft } = await drafted('menu_item', item, {
      lines: [
        { stock_item_id: fx.stock.beef, unit_name: 'g', qty: '100' },
        { stock_item_id: gone.stock_item_id, unit_name: 'g', qty: '5' },
        { stock_item_id: moved.stock_item_id, unit_name: 'g', qty: '5' },
      ],
    });
    await setStock(gone.stock_item_id, `archived_at = 1`);
    const before = await state();
    expect422(await publish(recipeId, draft.version), 'lines.1.stock_item_id', 'archived');
    await setStock(gone.stock_item_id, `archived_at = NULL`);
    await setStock(moved.stock_item_id, `stock_unit = 'ml'`);
    expect422(await publish(recipeId, draft.version), 'lines.2.stock_item_id', 'unit_changed');
    expect(await state()).toEqual(before);
  });

  it('[08b #15 / T-1] owner checks on the CURRENT owner (archived recipes): piece → g owner of a per_unit draft → basis_mismatch; plain option made linked → linked_option; prepared owner made ingredient → wrong_kind; nothing written', async () => {
    const item = await menuItem('Basis flip', 'piece');
    const flip = await drafted('menu_item', item, { lines: [{ stock_item_id: fx.stock.beef, unit_name: 'g', qty: '100' }] });
    await archiveRecipe(flip.recipeId);
    await setSaleUnit(item, 'g');

    const group = await createModifierGroup(cloud, fx.f, { name: 'Extras', min_choices: 0, max_choices: 1, options: [{ name: 'Lemon', price_minor: 1_000 }] });
    const lemon = group.options[0]!.option_id;
    const opt = await drafted('modifier_option', lemon, { lines: [{ stock_item_id: fx.stock.ghee, unit_name: 'g', qty: '5' }] });
    await archiveRecipe(opt.recipeId);
    await sql(`UPDATE modifier_options SET linked_item_id = $3 WHERE tenant_id = $1 AND option_id = $2`, [lemon, fx.items.naan]);

    const kindOwner = await prepared('Kind flip batch');
    const kind = await drafted('stock_item', kindOwner, { batch_yield_qty: 10, lines: [{ stock_item_id: fx.stock.ghee, unit_name: 'g', qty: '100' }] });
    await archiveRecipe(kind.recipeId);
    await setStock(kindOwner, `kind = 'ingredient'`);

    const before = await state();
    expect422(await publish(flip.recipeId, flip.draft.version), 'basis', 'basis_mismatch');
    expect422(await publish(opt.recipeId, opt.draft.version), 'owner_id', 'linked_option');
    expect422(await publish(kind.recipeId, kind.draft.version), 'owner_id', 'wrong_kind');
    expect(await state()).toEqual(before);
  });

  it('[08b #15 / T-2] a per_measure draft frozen at g after the owner moved g → ml (archived path) → 422 basis_mismatch; the draft saved again re-derives ml and publishes (17 statements: archived, no previous version)', async () => {
    const { recipeId, draft } = await drafted('menu_item', fx.items.chickenKarahi, {
      base_qty: 1000,
      lines: [{ stock_item_id: fx.stock.beef, unit_name: 'g', qty: '1000', qty_basis: 'AP' }],
    });
    expect(draft.measure_unit).toBe('g');
    await archiveRecipe(recipeId);
    await setSaleUnit(fx.items.chickenKarahi, 'ml');
    const before = await state();
    expect422(await publish(recipeId, draft.version), 'basis', 'basis_mismatch');
    expect(await state()).toEqual(before);

    const again = await saveDraft(recipeId, { expected_version: draft.version, base_qty: 1000, lines: [{ stock_item_id: fx.stock.milk, unit_name: 'ml', qty: '1000' }] });
    expect(again.measure_unit).toBe('ml');
    const v = await published(recipeId, again.version, 17);
    expect(v).toMatchObject({ status: 'published', measure_unit: 'ml' });
  });

  it('[08b #15] warnings: EP line in a batch (ep_in_batch); no_yield_defaulted_ap; EP ingredient with no yield (ep_no_yield); no menu cost (no_menu_cost); per_measure main_line_off only when the line unit = the owner sale_unit', async () => {
    const batch = await drafted('stock_item', await prepared('Warn batch'), {
      batch_yield_qty: 10,
      lines: [{ stock_item_id: fx.stock.payeRaw, unit_name: 'g', qty: '1000', qty_basis: 'EP' }],
    });
    const b = await published(batch.recipeId, batch.draft.version);
    expect(b.warnings).toEqual([{ code: 'ep_in_batch', line_no: 1 }]);

    const tawa = await drafted('menu_item', fx.items.tawaPiece, {
      lines: [
        { stock_item_id: fx.stock.beef, unit_name: 'g', qty: '250' },
        { stock_item_id: fx.stock.onion, unit_name: 'g', qty: '30' },
        { stock_item_id: fx.stock.adrak, unit_name: 'g', qty: '10', qty_basis: 'EP' },
      ],
    });
    const t = await published(tawa.recipeId, tawa.draft.version);
    expect(t.warnings).toEqual(
      expect.arrayContaining([
        { code: 'no_yield_defaulted_ap', line_no: 2 },
        { code: 'no_menu_cost', line_no: 2 },
        { code: 'ep_no_yield', line_no: 3 },
        { code: 'no_menu_cost', line_no: 3 },
      ]),
    );
    expect(t.warnings).toHaveLength(4);
    expect(t.cost.status).toBe('partial');

    const off = await drafted('menu_item', await menuItem('Karahi by weight', 'g'), {
      base_qty: 1000,
      lines: [{ stock_item_id: fx.stock.beef, unit_name: 'g', qty: '500', qty_basis: 'AP' }],
    });
    expect((await published(off.recipeId, off.draft.version)).warnings).toEqual([{ code: 'main_line_off' }]);

    // Lassi (ml) with its only AP ingredient line in g: units differ, nothing to compare, no warning
    const lassi = await drafted('menu_item', fx.items.lassi, { base_qty: 1000, lines: [{ stock_item_id: fx.stock.makhan, unit_name: 'g', qty: '100' }] });
    const l = await published(lassi.recipeId, lassi.draft.version);
    expect(l.warnings.filter((w) => w.code === 'main_line_off')).toEqual([]);
  });

  it('[08b #15] cycle: PAYE-like batch uses QEEMA-COOKED which uses it → 422 cycle; a self-loop → 422 cycle; nothing written', async () => {
    const paye = await prepared('Cycle PAYE');
    const qeema = await prepared('Cycle QEEMA');
    await live('stock_item', qeema, { batch_yield_qty: 10, lines: [piece(paye, '2')] });
    const p = await drafted('stock_item', paye, { batch_yield_qty: 10, lines: [piece(qeema, '3')] });
    const before = await state();
    expect422(await publish(p.recipeId, p.draft.version), 'lines', 'cycle');
    const self = await saveDraft(p.recipeId, { expected_version: p.draft.version, batch_yield_qty: 10, lines: [piece(paye, '1')] });
    expect422(await publish(p.recipeId, self.version), 'lines', 'cycle');
    const after = await state();
    expect(after.versions).toEqual(before.versions);
    expect(after.branches).toEqual(before.branches);
  });

  it('[08b #15] too_deep: menu item → A → B → C → D (prepared) is refused when the 4th prepared level forms (n-5: also a prepared-only chain); three levels are fine', async () => {
    const [a, b, c, d] = [await prepared('Deep A'), await prepared('Deep B'), await prepared('Deep C'), await prepared('Deep D')];
    await live('menu_item', await menuItem('Deep plate', 'piece'), { lines: [piece(a)] }); // M → A
    await live('stock_item', c, { batch_yield_qty: 10, lines: [piece(d)] }); // C → D
    await live('stock_item', b, { batch_yield_qty: 10, lines: [piece(c)] }); // B → C → D: 3 levels
    const top = await drafted('stock_item', a, { batch_yield_qty: 10, lines: [piece(b)] }); // A → B → C → D: 4
    const before = await state();
    expect422(await publish(top.recipeId, top.draft.version), 'lines', 'too_deep');
    expect(await state()).toEqual(before);
  });

  it('[08b #15] too_deep on a prepared-only chain no menu item uses (n-5): A → B → C → D, all prepared, no menu item on top → the publish forming the 4th level answers 422 too_deep, nothing written', async () => {
    const [a, b, c, d] = [await prepared('Solo A'), await prepared('Solo B'), await prepared('Solo C'), await prepared('Solo D')];
    await live('stock_item', d, { batch_yield_qty: 10, lines: [{ stock_item_id: fx.stock.ghee, unit_name: 'g', qty: '100' }] });
    await live('stock_item', c, { batch_yield_qty: 10, lines: [piece(d)] });
    await live('stock_item', b, { batch_yield_qty: 10, lines: [piece(c)] }); // B → C → D: 3 levels
    const top = await drafted('stock_item', a, { batch_yield_qty: 10, lines: [piece(b)] }); // A → B → C → D: 4
    const before = await state();
    expect422(await publish(top.recipeId, top.draft.version), 'lines', 'too_deep');
    expect(await state()).toEqual(before);
  });

  it('[08b #15 / T-1] an ARCHIVED recipe whose new draft closes a cycle → 422 cycle; the recipe stays archived, nothing written (its version is placed in the graph although archived)', async () => {
    const p = await prepared('Arch cycle P');
    const q = await prepared('Arch cycle Q');
    const pr = await live('stock_item', p, { batch_yield_qty: 10, lines: [{ stock_item_id: fx.stock.ghee, unit_name: 'g', qty: '100' }] });
    await live('stock_item', q, { batch_yield_qty: 10, lines: [piece(p)] }); // Q → P
    await archiveRecipe(pr.recipeId);
    const next = await saveDraft(pr.recipeId, { expected_version: null, batch_yield_qty: 10, lines: [piece(q)] }); // P → Q
    const before = await state();
    expect422(await publish(pr.recipeId, next.version), 'lines', 'cycle');
    expect(await state()).toEqual(before);
    expect((await sql(`SELECT archived_at::text FROM recipes WHERE tenant_id = $1 AND recipe_id = $2`, [pr.recipeId])).rows).toEqual([{ archived_at: '1' }]);
  });

  it('[08b #15] too_deep over the whole graph (M-3): publishing C (C → D) where M → A → B → C already exists → 422 too_deep', async () => {
    const [a, b, c, d] = [await prepared('Chain A'), await prepared('Chain B'), await prepared('Chain C'), await prepared('Chain D')];
    const cr = await live('stock_item', c, { batch_yield_qty: 10, lines: [{ stock_item_id: fx.stock.beef, unit_name: 'g', qty: '100' }] });
    await live('stock_item', b, { batch_yield_qty: 10, lines: [piece(c)] });
    await live('stock_item', a, { batch_yield_qty: 10, lines: [piece(b)] });
    await live('menu_item', await menuItem('Chain plate', 'piece'), { lines: [piece(a)] });
    const next = await saveDraft(cr.recipeId, { expected_version: null, batch_yield_qty: 10, lines: [piece(d)] });
    expect422(await publish(cr.recipeId, next.version), 'lines', 'too_deep');
  });

  // ------------------------------------------------------------------------------------------ test 16

  it('[08b #16] B-1 race: two publishes forming a cycle, the second started while afterPublishLock holds the first → exactly one 200, the other 422 cycle; the published graph is acyclic after both commit', async () => {
    const x = await prepared('Race X');
    const y = await prepared('Race Y');
    const rx = await drafted('stock_item', x, { batch_yield_qty: 10, lines: [piece(y)] });
    const ry = await drafted('stock_item', y, { batch_yield_qty: 10, lines: [piece(x)] });

    let reached!: () => void;
    let release!: () => void;
    const arrived = new Promise<void>((resolve) => (reached = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    control.afterPublishLock = async () => {
      if (!first) return;
      first = false;
      reached();
      await released;
    };
    try {
      const one = publish(rx.recipeId, rx.draft.version);
      await arrived;
      const two = publish(ry.recipeId, ry.draft.version);
      // request 2 waits on the publish lock (an advisory lock held by request 1)
      let waiting = false;
      for (let i = 0; i < 250 && !waiting; i += 1) {
        const r = await cloud.pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity a
            WHERE a.datname = current_database() AND a.wait_event_type = 'Lock' AND a.wait_event = 'advisory'`,
        );
        waiting = r.rows[0]!.n > 0;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting, 'request 2 waits on the publish lock').toBe(true);
      release();
      const [r1, r2] = await Promise.all([one, two]);
      expect(r1.statusCode, r1.body).toBe(200);
      expect422(r2, 'lines', 'cycle');
    } finally {
      release();
      delete control.afterPublishLock;
    }
    const live2 = await sql(
      `SELECT r.owner_id FROM recipe_versions v JOIN recipes r ON r.tenant_id = v.tenant_id AND r.recipe_id = v.recipe_id
        WHERE v.tenant_id = $1 AND v.status = 'published' AND r.owner_id = ANY($2)`,
      [[x, y]],
    );
    expect(live2.rows).toEqual([{ owner_id: x }]);
  });

  // ------------------------------------------------------------------------------------------ test 17

  it('[08b #17] publish bumps every branch +1 (B16); a refused publish bumps none', async () => {
    const item = await menuItem('Bump plate', 'piece');
    const { recipeId, draft } = await drafted('menu_item', item, { lines: [{ stock_item_id: fx.stock.ghee, unit_name: 'g', qty: '10' }] });
    const before = await configVersions();
    expect(before).toHaveLength(3);
    const stale = await publish(recipeId, 'stale');
    expect(stale.statusCode).toBe(409);
    expect(await configVersions()).toEqual(before);
    await published(recipeId, draft.version);
    expect(await configVersions()).toEqual(before.map((n) => n + 1));
  });
});
