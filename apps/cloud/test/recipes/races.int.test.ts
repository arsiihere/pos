import type { DraftSaved, RecipeCreated } from '@pos/events';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CloudTestHooks } from '../../src/server';
import { createStockItem } from '../helpers/menu-variants';
import { owner } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { stockItem } from '../inventory/fixtures';
import { recipeFixture, type RecipeFixture } from './fixtures';

// 08 v1.1 Part B §10.4 races 34, 35, 36 (M-14, the §6 lock order 0 → 0.5 → 1 / 4 → 5 → 10; B17 / C-11; T-1, f-1).
// Written by a session that did not write the R / G code under test (plan row t1). Each race is two real requests
// through `cloud.app.inject`, each on its own pool connection (the app's), against the real tables. Request 1 is held
// with its locks taken — at a test hook (`afterRecipeLock`, `afterPublishLock`, `beforeBump`), or by a "gate": a raw
// transaction of the test holding a row request 1 writes later FOR UPDATE, so request 1 waits there after its own
// locks. Request 2 starts and is shown waiting on a lock (pg_stat_activity, bounded poll); then request 1 goes on.
// Every race runs in both orders and ends with SQL checks of the guarantee on the DB state.

type Hook = 'afterRecipeLock' | 'afterPublishLock' | 'afterStockItemLock' | 'beforeBump';
type ApiError = { error: { code: string; details: Record<string, unknown> } };

const PUBLISH_ROUTE = 'POST /v1/admin/recipes/:recipe_id/publish';
const PATCH_ROUTE = 'PATCH /v1/admin/recipes/:recipe_id';
const RACE_TIMEOUT = 60_000;

describe('08b races (§10.4 #34–#36, §6 lock order)', () => {
  let cloud: TestCloud;
  let fx: RecipeFixture;
  const control: { [K in Hook]?: (route?: string) => Promise<void> } = {};

  beforeAll(async () => {
    const testHooks: CloudTestHooks = {
      afterRecipeLock: (route) => control.afterRecipeLock?.(route) ?? Promise.resolve(),
      afterPublishLock: (route) => control.afterPublishLock?.(route) ?? Promise.resolve(),
      afterStockItemLock: (route) => control.afterStockItemLock?.(route) ?? Promise.resolve(),
      beforeBump: () => control.beforeBump?.() ?? Promise.resolve(),
    };
    cloud = await createTestCloud({ testHooks });
    // review MINOR: the backends of this test's own pool (requests + gates), so lockWaiters never counts a stranger
    cloud.pool.on('acquire', (client) => {
      const pid = (client as unknown as { processID?: number }).processID;
      if (pid !== undefined) ours.add(pid);
    });
    await cloud.app.ready();
    fx = await recipeFixture(cloud);
  }, 60_000);
  afterAll(async () => {
    await cloud.close();
  });

  // ------------------------------------------------------------------------------------------ helpers

  const ours = new Set<number>();
  const sql = (text: string, params: unknown[] = []) => cloud.pool.query(text, [fx.f.tenantId, ...params]);

  function within<T>(promise: Promise<T>, message: string, ms = 30_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)));
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // Holds the first arrival at `hook` (of `route`, when the hook passes one) until release().
  function hold(hook: Hook, route?: string) {
    let first = true;
    let reachedFirst!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => (reachedFirst = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    control[hook] = async (r?: string) => {
      if (!first || (route !== undefined && r !== route)) return;
      first = false;
      reachedFirst();
      await released;
    };
    return {
      reached: within(reached, `request 1 never reached ${hook} (${route ?? '-'})`, 20_000),
      release: () => {
        release();
        delete control[hook];
      },
    };
  }

  // A gate: a raw transaction of the test holds `table`'s row FOR UPDATE, so request 1 waits on it when it writes
  // that row — after every lock it took before (its own §6 kinds). open() commits the raw transaction.
  async function gate(table: 'recipe_versions', key: string) {
    const client = await cloud.pool.connect();
    await client.query('BEGIN');
    await client.query(`SELECT 1 FROM ${table} WHERE tenant_id = $1 AND recipe_version_id = $2 FOR UPDATE`, [fx.f.tenantId, key]);
    let opened = false;
    return async () => {
      if (opened) return;
      opened = true;
      await client.query('COMMIT');
      client.release();
    };
  }

  // Waits until `n` backends of this database wait on a lock (a row lock, a tuple lock or the advisory kind 0) —
  // or rejects when `settled` (request 2) finishes first: it never waited, so the interleaving was not the one meant.
  async function lockWaiters(n: number, settled?: Promise<unknown>): Promise<void> {
    let done = false;
    void settled?.then(
      () => (done = true),
      () => (done = true),
    );
    for (let i = 0; i < 1000; i += 1) { // ≥ 20 s budget: a slow CI runner, never a timing assert
      if (done) throw new Error('request 2 finished without waiting on a lock');
      const r = await cloud.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()
            AND pid = ANY($1::int[]) AND cardinality(pg_blocking_pids(pid)) > 0`,
        [[...ours]],
      );
      if (r.rows[0]!.n >= n) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`fewer than ${n} backends wait on a lock`);
  }

  const json = (method: 'POST' | 'PUT' | 'PATCH', url: string, payload: object) => cloud.app.inject({ method, url, ...owner(fx.f), payload });
  const error = (response: LightMyRequestResponse) => (response.json() as ApiError).error;
  const ok = (response: LightMyRequestResponse) => expect(response.statusCode, response.body).toBe(200);
  const noDeadlock = (...responses: LightMyRequestResponse[]) => {
    for (const response of responses) {
      expect(response.statusCode, response.body).toBeLessThan(500);
      expect(response.body).not.toMatch(/40P01|deadlock/i);
    }
  };

  const ingredient = async (name: string, stock_unit: 'g' | 'ml' = 'g') => {
    const id = (
      await createStockItem(cloud, fx.f, {
        name,
        stock_unit,
        carries_over: false,
      })
    ).stock_item_id;
    await sql(`UPDATE stock_items SET kind = 'ingredient' WHERE tenant_id = $1 AND stock_item_id = $2`, [id]);
    return id;
  };
  const menuItem = async (name: string) => {
    const response = await json('POST', '/v1/admin/menu-items', {
      category_id: fx.menu.categoryIds[0],
      tax_class_id: null,
      name,
      price_minor: 50_000,
      sale_unit: 'piece',
      serve_mode: 'sync',
      cook_time_ms: 600_000,
      routes: [{ branch_id: fx.lakeCity, station_id: fx.menu.slotStationId }],
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json().data.item as { item_id: string }).item_id;
  };
  const create = async (itemId: string) => {
    const response = await json('POST', '/v1/admin/recipes', {
      owner_type: 'menu_item',
      owner_id: itemId,
    });
    expect(response.statusCode, response.body).toBe(201);
    const data = response.json().data as RecipeCreated;
    return {
      recipeId: data.recipe.recipe_id!,
      recipeVersion: data.recipe.version!,
      draft: data.draft,
    };
  };
  const grams = (stock_item_id: string, qty = '100') => ({
    stock_item_id,
    unit_name: 'g',
    qty,
  });
  const draftPut = (recipeId: string, expected_version: string | null, lines: object[]) =>
    json('PUT', `/v1/admin/recipes/${recipeId}/draft`, {
      expected_version,
      lines,
    });
  const savedDraft = async (recipeId: string, expected_version: string | null, lines: object[]) => {
    const response = await draftPut(recipeId, expected_version, lines);
    ok(response);
    return (response.json().data as DraftSaved).draft;
  };
  const publish = (recipeId: string, expected_version: string) => json('POST', `/v1/admin/recipes/${recipeId}/publish`, { expected_version });
  const patchRecipe = (recipeId: string, expected_version: string, archived: boolean) =>
    json('PATCH', `/v1/admin/recipes/${recipeId}`, {
      expected_version,
      archived,
    });
  const patchStock = async (stockItemId: string, payload: object) => {
    const { version } = await stockItem(cloud, fx.f, stockItemId);
    return () =>
      json('PATCH', `/v1/admin/stock-items/${stockItemId}`, {
        expected_version: version,
        ...payload,
      });
  };
  const inUseByRecipe = (response: LightMyRequestResponse, recipeId: string) => {
    expect(response.statusCode, response.body).toBe(409);
    expect(error(response)).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { used_by: { entity: 'recipe', ids: [recipeId] } },
    });
  };
  const refused = (response: LightMyRequestResponse, field: string, reason: string) => {
    expect(response.statusCode, response.body).toBe(422);
    expect(error(response)).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field, reason },
    });
  };
  const configVersions = async () =>
    (await sql(`SELECT config_version::text AS v FROM branches WHERE tenant_id = $1 ORDER BY branch_id`)).rows.map((r: { v: string }) => BigInt(r.v));
  const bumpedBy = (before: bigint[], after: bigint[]) => after.map((v, i) => v - before[i]!);
  const recipeAudit = async (recipeId: string) =>
    (await sql(`SELECT action FROM config_audit WHERE tenant_id = $1 AND entity = 'recipe' AND entity_id = $2 ORDER BY audit_id`, [recipeId])).rows.map(
      (r: { action: string }) => r.action,
    );
  const archivedAt = async (recipeId: string) =>
    (await sql(`SELECT archived_at::text AS a FROM recipes WHERE tenant_id = $1 AND recipe_id = $2`, [recipeId])).rows[0]!.a as string | null;
  const versionStatuses = async (recipeId: string) =>
    (await sql(`SELECT status FROM recipe_versions WHERE tenant_id = $1 AND recipe_id = $2 ORDER BY version_no`, [recipeId])).rows.map(
      (r: { status: string }) => r.status,
    );

  // B17 / C-11 invariant: no draft or published line of a non-archived recipe names an archived stock item
  const archivedLines = async () =>
    (
      await sql(
        `SELECT r.recipe_id, v.status, l.stock_item_id
           FROM recipes r
           JOIN recipe_versions v ON v.tenant_id = r.tenant_id AND v.recipe_id = r.recipe_id AND v.status IN ('draft', 'published')
           JOIN recipe_lines l ON l.tenant_id = v.tenant_id AND l.recipe_version_id = v.recipe_version_id
           JOIN stock_items s ON s.tenant_id = l.tenant_id AND s.stock_item_id = l.stock_item_id
          WHERE r.tenant_id = $1 AND r.archived_at IS NULL AND s.archived_at IS NOT NULL`,
      )
    ).rows;
  // B17 / N-1 invariant: no published line of a non-archived recipe freezes a stock unit its item no longer has
  const staleFrozenLines = async () =>
    (
      await sql(
        `SELECT r.recipe_id, l.stock_item_id, l.stock_unit AS frozen, s.stock_unit AS current
           FROM recipes r
           JOIN recipe_versions v ON v.tenant_id = r.tenant_id AND v.recipe_id = r.recipe_id AND v.status = 'published'
           JOIN recipe_lines l ON l.tenant_id = v.tenant_id AND l.recipe_version_id = v.recipe_version_id
           JOIN stock_items s ON s.tenant_id = l.tenant_id AND s.stock_item_id = l.stock_item_id
          WHERE r.tenant_id = $1 AND r.archived_at IS NULL AND l.stock_unit <> s.stock_unit`,
      )
    ).rows;

  // ---------------------------------------------------------------------------------------- test 34

  it(
    '[08b #34] draft save ∥ stock-item archive of a line item, both orders → the archive 409 { used_by: { entity: recipe } } or the draft save 422 archived, never both committed',
    async () => {
      for (const order of ['draft first', 'archive first'] as const) {
        const base = await ingredient(`R34 base ${order}`);
        const line = await ingredient(`R34 line ${order}`);
        const item = await menuItem(`R34 plate ${order}`);
        const r = await create(item);
        const draft = await savedDraft(r.recipeId, r.draft.version, [grams(base)]); // the item is not a line yet
        const archive = await patchStock(line, { archived: true });
        const save = () => draftPut(r.recipeId, draft.version, [grams(base), grams(line)]);

        let saved: LightMyRequestResponse;
        let archived: LightMyRequestResponse;
        if (order === 'draft first') {
          // the draft save takes the recipe (0.5), the menu item (4) and both line items FOR SHARE (5), then waits on
          // the gate at its draft upsert; the archive's stock item FOR UPDATE waits behind its FOR SHARE
          const open = await gate('recipe_versions', draft.recipe_version_id);
          try {
            const one = save();
            await lockWaiters(1, one);
            const two = archive();
            await lockWaiters(2, two);
            await open();
            [saved, archived] = await within(Promise.all([one, two]), 'race 34 did not finish (deadlock?)');
          } finally {
            await open();
          }
          noDeadlock(saved, archived);
          ok(saved);
          inUseByRecipe(archived, r.recipeId);
          expect((await stockItem(cloud, fx.f, line)).archived_at).toBeNull();
        } else {
          // the archive has run its C-11 recipes read (no recipe uses the item yet) and written archived_at; it is held
          // before its bump with the stock item FOR UPDATE; the draft save waits on its kind-5 FOR SHARE
          const h = hold('beforeBump');
          try {
            const one = archive();
            await h.reached;
            const two = save();
            await lockWaiters(1, two);
            h.release();
            [archived, saved] = await within(Promise.all([one, two]), 'race 34 did not finish (deadlock?)');
          } finally {
            h.release();
          }
          noDeadlock(saved, archived);
          ok(archived);
          refused(saved, 'lines.1.stock_item_id', 'archived');
          expect((await stockItem(cloud, fx.f, line)).archived_at).not.toBeNull();
        }
        expect(await archivedLines()).toEqual([]);
      }
    },
    RACE_TIMEOUT,
  );

  // ---------------------------------------------------------------------------------------- test 35

  it(
    '[08b #35] publish ∥ stock_unit change of a line item, both orders → the publish 422 unit_changed or the PATCH 409 CONFIG_IN_USE, never a published line with a stale frozen unit',
    async () => {
      for (const order of ['publish first', 'unit change first'] as const) {
        const line = await ingredient(`R35 line ${order}`);
        const item = await menuItem(`R35 plate ${order}`);
        const r = await create(item);
        const draft = await savedDraft(r.recipeId, r.draft.version, [grams(line, '250')]); // frozen in g
        const change = await patchStock(line, { stock_unit: 'ml' }); // a draft line never blocks it (C-11: published only)
        const pub = () => publish(r.recipeId, draft.version);

        let published: LightMyRequestResponse;
        let changed: LightMyRequestResponse;
        if (order === 'publish first') {
          // the publish holds kind 0, the recipe, the menu item and the line item FOR SHARE, and waits on the gate at
          // its draft → published update; the PATCH's stock item FOR UPDATE waits behind its FOR SHARE
          const open = await gate('recipe_versions', draft.recipe_version_id);
          try {
            const one = pub();
            await lockWaiters(1, one);
            const two = change();
            await lockWaiters(2, two);
            await open();
            [published, changed] = await within(Promise.all([one, two]), 'race 35 did not finish (deadlock?)');
          } finally {
            await open();
          }
          noDeadlock(published, changed);
          ok(published);
          inUseByRecipe(changed, r.recipeId);
          expect((await stockItem(cloud, fx.f, line)).stock_unit).toBe('g');
          expect(await versionStatuses(r.recipeId)).toEqual(['published']);
        } else {
          // the PATCH has run its C-11 recipes read (no published line yet) and written ml; it is held before its bump
          // with the stock item FOR UPDATE; the publish waits on its kind-5 FOR SHARE
          const h = hold('beforeBump');
          try {
            const one = change();
            await h.reached;
            const two = pub();
            await lockWaiters(1, two);
            h.release();
            [changed, published] = await within(Promise.all([one, two]), 'race 35 did not finish (deadlock?)');
          } finally {
            h.release();
          }
          noDeadlock(published, changed);
          ok(changed);
          refused(published, 'lines.0.stock_item_id', 'unit_changed');
          expect((await stockItem(cloud, fx.f, line)).stock_unit).toBe('ml');
          expect(await versionStatuses(r.recipeId)).toEqual(['draft']);
        }
        expect(await staleFrozenLines()).toEqual([]);
      }
    },
    RACE_TIMEOUT,
  );

  // ---------------------------------------------------------------------------------------- test 36

  // each order with a first publish (no published version yet) and with a republish (v1 published, v2 draft)
  const RACE_36 = (['first publish', 'republish'] as const).flatMap((setup) =>
    (['publish first', 'archive first (held at the recipe lock)', 'archive first (publish held at kind 0)'] as const).map((order) => ({ setup, order })),
  );
  for (const [n, { setup, order }] of RACE_36.entries()) {
    it(
      `[08b #36] publish ∥ §6.6 archive of the same recipe (${setup}; ${order}) → serialised on recipes: published-then-archived, or archived-then-published (the recipe active again, one recipe / restore audit row, f-1); B16 bumps`,
      async () => {
        const line = await ingredient(`R36 line ${n}`);
        const item = await menuItem(`R36 plate ${n}`);
        const r = await create(item);
        let draft = await savedDraft(r.recipeId, r.draft.version, [grams(line, '200')]);
        if (setup === 'republish') {
          ok(await publish(r.recipeId, draft.version));
          draft = await savedDraft(r.recipeId, null, [grams(line, '300')]);
        }
        const before = await configVersions();
        const pub = () => publish(r.recipeId, draft.version);
        const archive = () => patchRecipe(r.recipeId, r.recipeVersion, true);

        let published: LightMyRequestResponse;
        let archived: LightMyRequestResponse;
        if (order === 'publish first') {
          // the publish holds kind 0 and the recipe FOR UPDATE (0.5) and waits on the gate at its draft → published
          // update; the archive's recipe FOR UPDATE waits behind it
          const open = await gate('recipe_versions', draft.recipe_version_id);
          try {
            const one = pub();
            await lockWaiters(1, one);
            const two = archive();
            await lockWaiters(2, two);
            await open();
            [published, archived] = await within(Promise.all([one, two]), 'race 36 did not finish (deadlock?)');
          } finally {
            await open();
          }
        } else if (order === 'archive first (held at the recipe lock)') {
          // the archive holds the recipe FOR UPDATE at afterRecipeLock; the publish takes kind 0 and waits at 0.5
          const h = hold('afterRecipeLock', PATCH_ROUTE);
          try {
            const one = archive();
            await h.reached;
            const two = pub();
            await lockWaiters(1, two);
            h.release();
            [archived, published] = await within(Promise.all([one, two]), 'race 36 did not finish (deadlock?)');
          } finally {
            h.release();
          }
        } else {
          // the publish holds kind 0 only (afterPublishLock, before the recipe lock); the archive takes no kind 0
          // (§6.6) and commits; then the publish locks the archived recipe
          const h = hold('afterPublishLock', PUBLISH_ROUTE);
          try {
            const one = pub();
            await h.reached;
            archived = await within(archive(), 'the archive waited on the publish lock');
            h.release();
            published = await within(one, 'race 36 publish did not finish');
          } finally {
            h.release();
          }
        }
        noDeadlock(published, archived);
        ok(published);
        ok(archived);
        const after = await configVersions();
        const statuses = await versionStatuses(r.recipeId);
        expect(statuses).toEqual(setup === 'republish' ? ['superseded', 'published'] : ['published']);
        if (order === 'publish first') {
          // published-then-archived: the archive saw the published version (B16: it bumps every branch)
          expect((archived.json() as { data: { recipe: { archived: boolean } } }).data.recipe.archived).toBe(true);
          expect(await archivedAt(r.recipeId)).not.toBeNull();
          expect(await recipeAudit(r.recipeId)).toEqual(['create', 'archive']);
        } else {
          // archived-then-published (T-1, f-1): the publish un-archived the recipe, one recipe / restore audit row
          expect(await archivedAt(r.recipeId)).toBeNull();
          expect(await recipeAudit(r.recipeId)).toEqual(['create', 'archive', 'restore']);
        }
        // never a published version on a recipe the publish thought active while the archive won (or the reverse):
        // the last writer's state is the recipe's state
        const state = (
          await sql(
            `SELECT r.archived_at IS NOT NULL AS archived, count(*) FILTER (WHERE v.status = 'published')::int AS live,
                      count(*) FILTER (WHERE v.status = 'draft')::int AS drafts
                 FROM recipes r JOIN recipe_versions v ON v.tenant_id = r.tenant_id AND v.recipe_id = r.recipe_id
                WHERE r.tenant_id = $1 AND r.recipe_id = $2 GROUP BY r.archived_at`,
            [r.recipeId],
          )
        ).rows[0] as { archived: boolean; live: number; drafts: number };
        expect(state).toEqual({ archived: order === 'publish first', live: 1, drafts: 0 });
        // B16: a publish bumps every branch; an archive bumps every branch when the recipe has a published version.
        // In 'publish first' the archive commits after the publish, so it archives a recipe with a published version.
        const bumps = order === 'publish first' || setup === 'republish' ? 2n : 1n;
        expect(bumpedBy(before, after)).toEqual(after.map(() => bumps));
      },
      RACE_TIMEOUT,
    );
  }
});
