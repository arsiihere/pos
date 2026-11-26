import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stockItemBranchVersion } from '../../src/modules/menu-variants/versions';
import type { CloudTestHooks } from '../../src/server';
import { createStockItem } from '../helpers/menu-variants';
import { owner } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { inventoryFixture, stockItem, type InventoryFixture } from './fixtures';

// 08a §10.3 races 17, 18, 19b, 20, 21, 22 (I9, §6 lock order; 01c §6 lock order kind 5) and §10.4 test 26.
// Each race is two real requests through `cloud.app.inject`, each on its own pool connection (the app's). Request 1
// stops at a test hook holding its locks; request 2 starts and is shown waiting on a row lock (pg_stat_activity
// poll, bounded); then request 1 is released. Every race runs in both orders and ends with a DB-state check of the
// guarantee. Written by a session that did not write the code under test (plan row t1).

type Hook = 'afterStockItemLock' | 'afterReferenceLock' | 'beforeBump';
type ApiError = { error: { code: string; details: Record<string, unknown> } };

const STOCK_PATCH = 'PATCH /v1/admin/stock-items/:stock_item_id';
const UNITS_POST = 'POST /v1/admin/stock-items/:stock_item_id/units';
const PRICES_POST = 'POST /v1/admin/stock-items/:stock_item_id/prices';
const YIELDS_POST = 'POST /v1/admin/stock-items/:stock_item_id/yields';
const ITEM_POST = 'POST /v1/admin/menu-items';
const DRAW = 'stock_draws.0.stock_item_id';
const RACE_TIMEOUT = 60_000;

describe('08a races (§10.3 #17–#22, I9, §6 lock order) and the engine invariant (§10.4 #26)', () => {
  let cloud: TestCloud;
  let fx: InventoryFixture;
  const control: { [K in Hook]?: (route?: string) => Promise<void> } = {};

  beforeAll(async () => {
    const testHooks: CloudTestHooks = {
      afterStockItemLock: (route) => control.afterStockItemLock?.(route) ?? Promise.resolve(),
      afterReferenceLock: (route) => control.afterReferenceLock?.(route) ?? Promise.resolve(),
      beforeBump: () => control.beforeBump?.() ?? Promise.resolve(),
    };
    cloud = await createTestCloud({ captureLogs: true, testHooks });
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });

  // `promise`, or a rejection after `ms`; the timer is cleared once either settles.
  function within<T>(promise: Promise<T>, message: string, ms = 5_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)));
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // Pauses the first arrival at the hook (of `route`, when the hook passes one) until released.
  function pause(route?: string) {
    let arrived = false;
    let reachedFirst!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => (reachedFirst = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    const hook = async (r?: string) => {
      if (arrived || (route !== undefined && r !== route)) return;
      arrived = true;
      reachedFirst();
      await released;
    };
    return { hook, reached: within(reached, `request 1 never reached its hook (${route ?? 'beforeBump'})`), release };
  }

  // The backend of the request paused at its hook: the only transaction left open in this database.
  async function pausedBackend(): Promise<number> {
    const result = await cloud.pool.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity
        WHERE datname = current_database() AND state = 'idle in transaction' AND pid <> pg_backend_pid()`,
    );
    expect(result.rows, 'exactly one open transaction (request 1)').toHaveLength(1);
    return result.rows[0]!.pid;
  }

  // Request 2 waits on a stock_items row lock held by request 1 (`blocker`): a backend that waits on a lock, is
  // blocked by `blocker` (pg_blocking_pids) and holds or waits for a tuple lock on stock_items (a row-lock wait takes
  // the tuple lock, then waits on the holder's transaction). Polled, bounded at 5 s of wall time. False when
  // request 2 settles first: it never waited (the race goes on and `serialised` reports it).
  async function waitForStockItemWaitOr(blocker: number, settled: Promise<unknown>): Promise<boolean> {
    let done = false;
    void settled.then(
      () => {
        done = true;
      },
      () => {
        done = true;
      },
    );
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (done) return false;
      const result = await cloud.pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM pg_stat_activity a
          WHERE a.datname = current_database() AND a.wait_event_type = 'Lock' AND a.pid <> pg_backend_pid()
            AND $1 = ANY (pg_blocking_pids(a.pid))
            AND EXISTS (SELECT 1 FROM pg_locks l
                         WHERE l.pid = a.pid AND l.locktype = 'tuple' AND l.relation = 'stock_items'::regclass)`,
        [blocker],
      );
      if (Number(result.rows[0]!.n) > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('request 2 neither waited on request 1\'s stock_items row lock nor finished');
  }

  let blocked = false;
  // Request 1 stops at `hook` (for afterStockItemLock / afterReferenceLock: of `route`) holding its locks; request 2
  // starts; once it waits on request 1's stock_items row lock, request 1 goes on. Answers [request 1, request 2].
  async function race(
    first: { hook: Hook; route?: string; call: () => Promise<LightMyRequestResponse> },
    second: () => Promise<LightMyRequestResponse>,
  ): Promise<[LightMyRequestResponse, LightMyRequestResponse]> {
    const gate = pause(first.hook === 'beforeBump' ? undefined : first.route);
    control[first.hook] = gate.hook;
    blocked = false;
    try {
      const one = first.call();
      await gate.reached;
      const blocker = await pausedBackend();
      const two = second();
      blocked = await waitForStockItemWaitOr(blocker, two);
      gate.release();
      return await within(Promise.all([one, two]), 'the race did not finish (deadlock?)', 10_000);
    } finally {
      gate.release();
      delete control[first.hook];
    }
  }

  const inject = (method: 'POST' | 'PATCH' | 'PUT', url: string, payload: object) => () =>
    cloud.app.inject({ method, url, ...owner(fx.f), payload });
  const error = (response: LightMyRequestResponse) => (response.json() as ApiError).error;
  const noDeadlock = (responses: LightMyRequestResponse[]) => {
    for (const response of responses) expect(response.body).not.toContain('40P01');
  };
  const serialised = (label: string) => expect(blocked, `${label}: request 2 waited on request 1's lock`).toBe(true);
  const rows = async <T extends object = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await cloud.pool.query<T>(sql, [fx.f.tenantId, ...params])).rows;
  const stockPatch = async (stockItemId: string, body: object) => {
    const wire = await stockItem(cloud, fx.f, stockItemId);
    return inject('PATCH', `/v1/admin/stock-items/${stockItemId}`, { expected_version: wire.version, ...body });
  };
  const kindOf = async (stockItemId: string) =>
    (await rows<{ kind: string }>(`SELECT kind FROM stock_items WHERE tenant_id = $1 AND stock_item_id = $2`, [stockItemId]))[0]!.kind;
  const itemBody = (name: string, stockItemId?: string) => ({
    category_id: fx.menu.categoryIds[0],
    tax_class_id: null,
    name,
    price_minor: 50_000,
    serve_mode: 'sync',
    cook_time_ms: 600_000,
    routes: [{ branch_id: fx.lakeCity, station_id: fx.menu.slotStationId }],
    ...(stockItemId === undefined ? {} : { stock_draws: [{ stock_item_id: stockItemId, quantity_per_sale_unit: 1 }] }),
  });
  // A fresh prepared piece stock item with no branch row and no drawer (17, 18).
  const preparedItem = async (name: string) => {
    const created = await createStockItem(cloud, fx.f, { name, stock_unit: 'piece', carries_over: false });
    expect(created.kind).toBe('prepared');
    return created.stock_item_id;
  };

  // I9, the two DB-state halves: never a branch row on a non-prepared item; never an active item drawing from one.
  const branchRowsOnNonPrepared = () =>
    rows(
      `SELECT b.branch_id, b.stock_item_id, s.kind FROM stock_item_branches b
         JOIN stock_items s ON s.tenant_id = b.tenant_id AND s.stock_item_id = b.stock_item_id
        WHERE b.tenant_id = $1 AND s.kind <> 'prepared'`,
    );
  const activeDrawsOnNonPrepared = () =>
    rows(
      `SELECT d.item_id, d.stock_item_id, s.kind FROM stock_draws d
         JOIN menu_items m ON m.tenant_id = d.tenant_id AND m.item_id = d.item_id
         JOIN stock_items s ON s.tenant_id = d.tenant_id AND s.stock_item_id = d.stock_item_id
        WHERE d.tenant_id = $1 AND m.archived_at IS NULL AND s.kind <> 'prepared'`,
    );

  it(
    '[08a #17] kind → ingredient PATCH vs branch PUT set, both orders: PATCH first → PUT 422 wrong_kind; PUT first → PATCH 409 CONFIG_IN_USE stock_item_branch; never a branch row on a non-prepared item',
    async () => {
      for (const order of ['PATCH first', 'PUT first'] as const) {
        fx = await inventoryFixture(cloud);
        const pot = await preparedItem('Haleem pot');
        const patch = await stockPatch(pot, { kind: 'ingredient' });
        const put = inject('PUT', `/v1/admin/stock-items/${pot}/branches/${fx.lakeCity}`, {
          expected_version: stockItemBranchVersion(pot, fx.lakeCity, null).version,
          station_id: fx.menu.slotStationId,
          low_stock_threshold: null,
        });
        if (order === 'PATCH first') {
          const [patched, set] = await race({ hook: 'afterStockItemLock', route: STOCK_PATCH, call: patch }, put);
          noDeadlock([patched, set]);
          serialised(`#17 ${order}`);
          expect(patched.statusCode, patched.body).toBe(200);
          expect(set.statusCode, set.body).toBe(422);
          expect(error(set)).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'stock_item_id', reason: 'wrong_kind' } });
          expect(await kindOf(pot)).toBe('ingredient');
          expect(await rows(`SELECT branch_id FROM stock_item_branches WHERE tenant_id = $1 AND stock_item_id = $2`, [pot])).toEqual([]);
        } else {
          const [set, patched] = await race({ hook: 'beforeBump', call: put }, patch);
          noDeadlock([patched, set]);
          serialised(`#17 ${order}`);
          expect(set.statusCode, set.body).toBe(200);
          expect(patched.statusCode, patched.body).toBe(409);
          expect(error(patched)).toMatchObject({
            code: 'CONFIG_IN_USE',
            details: { entity: 'stock_item', id: pot, used_by: { entity: 'stock_item_branch', ids: [fx.lakeCity] } },
          });
          expect(await kindOf(pot)).toBe('prepared');
        }
        expect(await branchRowsOnNonPrepared(), order).toEqual([]);
      }
    },
    RACE_TIMEOUT,
  );

  // The Lake City branch entry's version of a stock item (from the §6.1 list), null when the list has no entry.
  async function branchVersion(stockItemId: string): Promise<string | null> {
    const wire = (await stockItem(cloud, fx.f, stockItemId)) as unknown as { branches?: Array<{ branch_id: string; version: string }> };
    return wire.branches?.find((b) => b.branch_id === fx.lakeCity)?.version ?? null;
  }

  it(
    '[08a #18] kind → ingredient PATCH vs an item draw write (menu item POST and PATCH with stock_draws), both orders: kind first → 422 wrong_kind; draw first → 409 CONFIG_IN_USE menu_item; never an active item drawing a non-prepared item',
    async () => {
      for (const write of ['item POST', 'item PATCH'] as const) {
        for (const order of ['kind first', 'draw first'] as const) {
          const label = `${write}, ${order}`;
          fx = await inventoryFixture(cloud);
          const pot = await preparedItem('Nihari pot');
          const patch = await stockPatch(pot, { kind: 'ingredient' });
          let itemId: string | undefined;
          let draw: () => Promise<LightMyRequestResponse>;
          if (write === 'item POST') {
            draw = inject('POST', '/v1/admin/menu-items', itemBody('Nihari plate', pot));
          } else {
            const created = await inject('POST', '/v1/admin/menu-items', itemBody('Nihari plate'))();
            expect(created.statusCode, created.body).toBe(201);
            itemId = created.json().data.item.item_id as string;
            draw = inject('PATCH', `/v1/admin/menu-items/${itemId}`, { stock_draws: [{ stock_item_id: pot, quantity_per_sale_unit: 1 }] });
          }
          if (order === 'kind first') {
            const [patched, drawn] = await race({ hook: 'afterStockItemLock', route: STOCK_PATCH, call: patch }, draw);
            noDeadlock([patched, drawn]);
            serialised(`#18 ${label}`);
            expect(patched.statusCode, patched.body).toBe(200);
            expect(drawn.statusCode, drawn.body).toBe(422);
            expect(error(drawn)).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: DRAW, reason: 'wrong_kind' } });
            expect(await kindOf(pot)).toBe('ingredient');
            expect(await rows(`SELECT item_id FROM stock_draws WHERE tenant_id = $1 AND stock_item_id = $2`, [pot])).toEqual([]);
          } else {
            // the POST holds right after its reference FOR SHARE (before the draw insert); the PATCH holds at beforeBump
            const first =
              write === 'item POST'
                ? { hook: 'afterReferenceLock' as const, route: ITEM_POST, call: draw }
                : { hook: 'beforeBump' as const, call: draw };
            const [drawn, patched] = await race(first, patch);
            noDeadlock([patched, drawn]);
            serialised(`#18 ${label}`);
            expect(drawn.statusCode, drawn.body).toBe(write === 'item POST' ? 201 : 200);
            const drawerId = itemId ?? (drawn.json().data.item.item_id as string);
            expect(patched.statusCode, patched.body).toBe(409);
            expect(error(patched)).toMatchObject({
              code: 'CONFIG_IN_USE',
              details: { entity: 'stock_item', id: pot, used_by: { entity: 'menu_item', ids: [drawerId] } },
            });
            expect(await kindOf(pot)).toBe('prepared');
          }
          expect(await activeDrawsOnNonPrepared(), label).toEqual([]);
          expect(await branchRowsOnNonPrepared(), label).toEqual([]);
        }
      }
    },
    RACE_TIMEOUT,
  );

  it(
    '[08a #19b] restore of archived Paye Half vs kind → ingredient PATCH on PAYE-COOKED: order A (PATCH holds at afterStockItemLock) → restore 422 wrong_kind; order B (restore holds at beforeBump) → PATCH 409 CONFIG_IN_USE menu_item; never an active item drawing an ingredient',
    async () => {
      for (const order of ['A', 'B'] as const) {
        fx = await inventoryFixture(cloud);
        const paye = fx.ids.payeCooked;
        // 19 / 19b setup (fixture note): remove the Lake City branch row, archive the only drawer
        const removed = await inject('PUT', `/v1/admin/stock-items/${paye}/branches/${fx.lakeCity}`, {
          expected_version: await branchVersion(paye),
          station_id: null,
        })();
        expect(removed.statusCode, removed.body).toBe(200);
        const archived = await inject('PATCH', `/v1/admin/menu-items/${fx.payeHalfItemId}`, { archived: true })();
        expect(archived.statusCode, archived.body).toBe(200);
        // carries_over must go with the kind (R6, 400 otherwise)
        const patch = await stockPatch(paye, { kind: 'ingredient', carries_over: false });
        const restore = inject('PATCH', `/v1/admin/menu-items/${fx.payeHalfItemId}`, { archived: false });
        const payeHalfArchived = async () =>
          (await rows<{ archived_at: string | null }>(`SELECT archived_at FROM menu_items WHERE tenant_id = $1 AND item_id = $2`, [fx.payeHalfItemId]))[0]!
            .archived_at !== null;
        if (order === 'A') {
          const [patched, restored] = await race({ hook: 'afterStockItemLock', route: STOCK_PATCH, call: patch }, restore);
          noDeadlock([patched, restored]);
          serialised(`#19b order ${order}`);
          expect(patched.statusCode, patched.body).toBe(200);
          expect(restored.statusCode, restored.body).toBe(422);
          expect(error(restored)).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: DRAW, reason: 'wrong_kind' } });
          expect(await kindOf(paye)).toBe('ingredient');
          expect(await payeHalfArchived()).toBe(true);
        } else {
          const [restored, patched] = await race({ hook: 'beforeBump', call: restore }, patch);
          noDeadlock([patched, restored]);
          serialised(`#19b order ${order}`);
          expect(restored.statusCode, restored.body).toBe(200);
          expect(patched.statusCode, patched.body).toBe(409);
          expect(error(patched)).toMatchObject({
            code: 'CONFIG_IN_USE',
            details: { entity: 'stock_item', id: paye, used_by: { entity: 'menu_item', ids: [fx.payeHalfItemId] } },
          });
          expect(await kindOf(paye)).toBe('prepared');
          expect(await payeHalfArchived()).toBe(false);
        }
        expect(await activeDrawsOnNonPrepared(), `order ${order}`).toEqual([]);
      }
    },
    RACE_TIMEOUT,
  );

  it(
    '[08a #20] price POST vs stock_unit g → piece PATCH, both orders (afterStockItemLock on either side): the price’s frozen stock_unit is always the item’s stock_unit at the POST’s lock',
    async () => {
      for (const unitName of ['kg', 'piece'] as const) {
        for (const order of ['POST first', 'PATCH first'] as const) {
          const label = `${unitName}, ${order}`;
          fx = await inventoryFixture(cloud);
          const beef = fx.ids.beef;
          // an item unit "1 piece = 250 g" (base g): in g a piece resolves through it, in piece it is the stock unit
          const piece = await inject('POST', `/v1/admin/stock-items/${beef}/units`, { unit_name: 'piece', factor_num: 250 })();
          expect(piece.statusCode, piece.body).toBe(201);
          const patch = await stockPatch(beef, { stock_unit: 'piece' });
          const post = inject('POST', `/v1/admin/stock-items/${beef}/prices`, { kind: 'manual', unit_name: unitName, price_minor: 150_000 });
          const prices = () =>
            rows<{ stock_unit: string; stock_qty_num: string; stock_qty_den: string }>(
              `SELECT stock_unit, stock_qty_num::text, stock_qty_den::text FROM item_prices WHERE tenant_id = $1 AND stock_item_id = $2`,
              [beef],
            );
          let unitAtLock: 'g' | 'piece';
          if (order === 'POST first') {
            const [posted, patched] = await race({ hook: 'afterStockItemLock', route: PRICES_POST, call: post }, patch);
            noDeadlock([posted, patched]);
            serialised(`#20 ${label}`);
            unitAtLock = 'g';
            expect(posted.statusCode, posted.body).toBe(201);
            expect(patched.statusCode, patched.body).toBe(200);
            // in g: kg = 1000 g (built-in), piece = 250 g (item unit); the price is "other unit" after the PATCH (I5)
            expect(await prices()).toEqual([{ stock_unit: 'g', stock_qty_num: unitName === 'kg' ? '1000' : '250', stock_qty_den: '1' }]);
          } else {
            const [patched, posted] = await race({ hook: 'afterStockItemLock', route: STOCK_PATCH, call: patch }, post);
            noDeadlock([posted, patched]);
            serialised(`#20 ${label}`);
            unitAtLock = 'piece';
            expect(patched.statusCode, patched.body).toBe(200);
            if (unitName === 'kg') {
              // kg is a built-in of g, not of piece, and the item has no kg unit
              expect(posted.statusCode, posted.body).toBe(422);
              expect(error(posted)).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'unit_name', reason: 'not_convertible' } });
              expect(await prices()).toEqual([]);
            } else {
              // piece is now the stock unit itself: stored in the new unit, 1 / 1
              expect(posted.statusCode, posted.body).toBe(201);
              expect(await prices()).toEqual([{ stock_unit: 'piece', stock_qty_num: '1', stock_qty_den: '1' }]);
            }
          }
          for (const price of await prices()) expect(price.stock_unit, label).toBe(unitAtLock);
          expect((await rows<{ stock_unit: string }>(`SELECT stock_unit FROM stock_items WHERE tenant_id = $1 AND stock_item_id = $2`, [beef]))[0]!.stock_unit).toBe(
            'piece',
          );
        }
      }
    },
    RACE_TIMEOUT,
  );

  it(
    '[08a #21] yield POST vs kind → packet PATCH, both orders (afterStockItemLock): PATCH first → POST 422 wrong_kind, no yield row; POST first → both succeed; never a yield inserted on a packet',
    async () => {
      for (const order of ['POST first', 'PATCH first'] as const) {
        fx = await inventoryFixture(cloud);
        const beef = fx.ids.beef; // ingredient in g, so kind → packet passes R5
        const patch = await stockPatch(beef, { kind: 'packet' });
        const post = inject('POST', `/v1/admin/stock-items/${beef}/yields`, { yield_bp: 7_120 });
        const yields = () => rows(`SELECT yield_bp FROM yield_profiles WHERE tenant_id = $1 AND stock_item_id = $2`, [beef]);
        if (order === 'POST first') {
          const [posted, patched] = await race({ hook: 'afterStockItemLock', route: YIELDS_POST, call: post }, patch);
          noDeadlock([posted, patched]);
          serialised(`#21 ${order}`);
          expect(posted.statusCode, posted.body).toBe(201);
          expect(patched.statusCode, patched.body).toBe(200);
          // inserted while the item was an ingredient (the PATCH waited on the POST's FOR SHARE)
          expect(await yields()).toEqual([{ yield_bp: 7_120 }]);
        } else {
          const [patched, posted] = await race({ hook: 'afterStockItemLock', route: STOCK_PATCH, call: patch }, post);
          noDeadlock([posted, patched]);
          serialised(`#21 ${order}`);
          expect(patched.statusCode, patched.body).toBe(200);
          expect(posted.statusCode, posted.body).toBe(422);
          expect(error(posted)).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'stock_item_id', reason: 'wrong_kind' } });
          expect(await yields(), order).toEqual([]);
        }
        expect(await kindOf(beef)).toBe('packet');
      }
    },
    RACE_TIMEOUT,
  );

  it(
    '[08a #22] unit POST vs archive PATCH, both orders (afterStockItemLock): PATCH first → POST 422 archived, no unit row; POST first → both succeed; no unit row inserted after the archive committed',
    async () => {
      for (const order of ['POST first', 'PATCH first'] as const) {
        fx = await inventoryFixture(cloud);
        const ghee = fx.ids.ghee; // ingredient in g, no drawer: the archive passes R2
        const patch = await stockPatch(ghee, { archived: true });
        const post = inject('POST', `/v1/admin/stock-items/${ghee}/units`, { unit_name: 'l', factor_num: 920 });
        const units = () => rows(`SELECT unit_name FROM stock_item_units WHERE tenant_id = $1 AND stock_item_id = $2`, [ghee]);
        if (order === 'POST first') {
          const [posted, patched] = await race({ hook: 'afterStockItemLock', route: UNITS_POST, call: post }, patch);
          noDeadlock([posted, patched]);
          serialised(`#22 ${order}`);
          expect(posted.statusCode, posted.body).toBe(201);
          expect(patched.statusCode, patched.body).toBe(200);
          // inserted before the archive (the PATCH waited on the POST's FOR SHARE)
          expect(await units()).toEqual([{ unit_name: 'l' }]);
        } else {
          const [patched, posted] = await race({ hook: 'afterStockItemLock', route: STOCK_PATCH, call: patch }, post);
          noDeadlock([posted, patched]);
          serialised(`#22 ${order}`);
          expect(patched.statusCode, patched.body).toBe(200);
          expect(posted.statusCode, posted.body).toBe(422);
          expect(error(posted)).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'stock_item_id', reason: 'archived' } });
          expect(await units(), order).toEqual([]);
        }
        expect(
          (await rows<{ archived_at: string | null }>(`SELECT archived_at FROM stock_items WHERE tenant_id = $1 AND stock_item_id = $2`, [ghee]))[0]!.archived_at,
        ).not.toBeNull();
      }
    },
    RACE_TIMEOUT,
  );

  // §10.4 #26 (I9: "no engine or hub code changes"): no file under the hub app (its tests include 02b's) or the
  // engine package differs from main. Needs the main ref (a full clone); the gate's shallow checkout has none, and
  // there the gate's hub and engine jobs passing on unedited files are the check.
  const GUARDED_BRANCH = 'module-08a';
  const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const mainRef = (() => {
    for (const ref of ['origin/main', 'main']) {
      try {
        git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
        return ref;
      } catch {
        // try the next ref
      }
    }
    return null;
  })();
  // ⚠️ §10.4 #26 is the 08a branch's scope guard: other modules (02b-TK's hub and engine lanes) change these trees by
  // design, so it runs only on module-08a (local branch, or the GitHub ref / PR base) or with POS_SCOPE_GUARD_08A=1.
  const branch = (() => {
    try {
      return git('rev-parse', '--abbrev-ref', 'HEAD');
    } catch {
      return null;
    }
  })();
  const on08a =
    process.env.POS_SCOPE_GUARD_08A === '1' ||
    [branch, process.env.GITHUB_HEAD_REF, process.env.GITHUB_BASE_REF, process.env.GITHUB_REF_NAME].includes(GUARDED_BRANCH);
  it.skipIf(mainRef === null || !on08a)('[08a #26] no hub, engine or 02b test file (nor any hub / engine file) changed against main', () => {
    const base = git('merge-base', mainRef!, 'HEAD');
    // committed and working-tree changes since the merge base, plus untracked files, in the two guarded trees
    const changed = git('diff', '--name-only', base, '--', 'apps/hub', 'packages/engine');
    const untracked = git('ls-files', '--others', '--exclude-standard', '--', 'apps/hub', 'packages/engine');
    expect([changed, untracked].filter((s) => s !== '')).toEqual([]);
  });
});
