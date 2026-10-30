import { BranchConfigSnapshotSchemaV2, type BranchConfig, type DealBranchWire, type DealWire } from '@pos/events';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildSnapshot, type SnapshotHeader } from '../../src/modules/config-sync/builder';
import type { CloudTestHooks } from '../../src/server';
import { createDeal, createModifierGroup, createStockItem } from '../helpers/menu-variants';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

// 01c §10.8 races #73–#76 (§6 lock order). Request 1 takes its locks and stops at a hook; request 2 starts and is
// shown blocked on a row lock; then request 1 goes on. Each race is forced in the orderings the spec names.

type Hook = 'beforeBump' | 'afterReferenceLock';
type ApiError = { error: { code: string; details: Record<string, unknown> } };

const HEADER: SnapshotHeader = {
  config_version: 7,
  currency_code: 'PKR',
  tax_enabled: false,
  day_stale_after_hours: 16,
  day_min_gap_hours: 4,
};
const POST_ITEM = 'POST /v1/admin/menu-items';
const RACE_TIMEOUT = 30_000;

describe('01c races #73–#76 (§6 lock order)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let menu: SeededMenu;
  const control: { beforeBump?: () => Promise<void>; afterReferenceLock?: (route: string) => Promise<void> } = {};

  beforeAll(async () => {
    const testHooks: CloudTestHooks = {
      beforeBump: () => control.beforeBump?.() ?? Promise.resolve(),
      afterReferenceLock: (route) => control.afterReferenceLock?.(route) ?? Promise.resolve(),
    };
    cloud = await createTestCloud({ captureLogs: true, testHooks });
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
    menu = await seedMenu(cloud.pool, f);
  });

  function within<T>(promise: Promise<T>, message: string, ms = 5_000): Promise<T> {
    return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
  }

  // Pauses the first arrival at the hook (for afterReferenceLock: of `route`) until released.
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
    return { hook, reached: within(reached, 'request 1 never reached its hook'), release };
  }

  // The barrier: request 2 waits on a row lock (polled, bounded); if it settles first instead, the race goes on and
  // the outcome assertions show it (that is the lock-removed failure).
  // Answers true when request 2 was seen blocked on a lock.
  async function waitForLockWaitOr(settled: Promise<unknown>): Promise<boolean> {
    let done = false;
    void settled.finally(() => (done = true));
    for (let waited = 0; waited < 5_000; waited += 20) {
      if (done) return false;
      const rows = await cloud.pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
      );
      if (Number(rows.rows[0]!.n) > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('request 2 neither waited on a lock nor finished');
  }

  // Request 1 stops at its hook holding its locks; request 2 starts; once it waits on a lock, request 1 goes on.
  // Every race asserts `blocked` after its outcome: request 2 was serialised behind request 1's lock.
  let blocked = false;
  async function race(
    first: { hook: Hook; call: () => Promise<LightMyRequestResponse> },
    second: () => Promise<LightMyRequestResponse>,
  ): Promise<[LightMyRequestResponse, LightMyRequestResponse]> {
    const gate = first.hook === 'afterReferenceLock' ? pause(POST_ITEM) : pause();
    if (first.hook === 'afterReferenceLock') control.afterReferenceLock = gate.hook;
    else control.beforeBump = () => gate.hook();
    try {
      const one = first.call();
      await gate.reached;
      const two = second();
      blocked = await waitForLockWaitOr(two);
      gate.release();
      return await within(Promise.all([one, two]), 'the race did not finish (deadlock?)', 10_000);
    } finally {
      gate.release();
      delete control.beforeBump;
      delete control.afterReferenceLock;
    }
  }

  const inject = (method: 'POST' | 'PATCH' | 'PUT', url: string, payload: object) => () =>
    cloud.app.inject({ method, url, ...owner(f), payload });
  const error = (response: LightMyRequestResponse) => (response.json() as ApiError).error;
  const noDeadlock = (responses: LightMyRequestResponse[]) => {
    for (const response of responses) expect(response.body).not.toContain('40P01');
  };
  const serialised = (label: string) => expect(blocked, `${label}: request 2 waited on request 1's lock`).toBe(true);
  // A piece item in CT-1, routed at branch A.
  const item = async (name: string) => {
    const response = await inject('POST', '/v1/admin/menu-items', {
      category_id: menu.categoryIds[0],
      tax_class_id: null,
      name,
      price_minor: 10_000,
      serve_mode: 'sync',
      cook_time_ms: 600_000,
      routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId }],
    })();
    expect(response.statusCode, response.body).toBe(201);
    return response.json().data.item.item_id as string;
  };
  const build = async (branchId: string): Promise<BranchConfig> => {
    const client = await cloud.pool.connect();
    try {
      const tenant = Object.freeze({ tenantId: f.tenantId, branchIds: Object.freeze([...f.branches]) });
      return BranchConfigSnapshotSchemaV2.parse(await buildSnapshot(client, tenant, branchId, HEADER));
    } finally {
      client.release();
    }
  };

  it(
    '[01c #73] two group PATCHes with the same expected_version: one 200, one 409 CONFIG_STALE; the winner’s name is stored',
    async () => {
      const group = await createModifierGroup(cloud, f, { name: 'Spice level', min_choices: 0, max_choices: 1, options: [{ name: 'Mild', price_minor: 0 }] });
      const url = `/v1/admin/modifier-groups/${group.modifier_group_id}`;
      const [won, lost] = await race(
        { hook: 'beforeBump', call: inject('PATCH', url, { expected_version: group.version, name: 'Spice A' }) },
        inject('PATCH', url, { expected_version: group.version, name: 'Spice B' }),
      );
      noDeadlock([won, lost]);
      expect(won.statusCode, won.body).toBe(200);
      expect(lost.statusCode, lost.body).toBe(409);
      expect(error(lost)).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'modifier_group', id: group.modifier_group_id } });
      const stored = await cloud.pool.query<{ name: string }>(`SELECT name FROM modifier_groups WHERE modifier_group_id = $1`, [
        group.modifier_group_id,
      ]);
      expect(stored.rows).toEqual([{ name: 'Spice A' }]);
      serialised('#73');
    },
    RACE_TIMEOUT,
  );

  it(
    '[01c #74] item archive and a group POST linking it, both orders: archive first → POST 422 archived; POST first → archive 409 CONFIG_IN_USE; never both succeed',
    async () => {
      for (const order of ['archive first', 'POST first'] as const) {
        f = await restaurantFixture(cloud);
        menu = await seedMenu(cloud.pool, f);
        const raita = await item('Raita');
        const archive = inject('PATCH', `/v1/admin/menu-items/${raita}`, { archived: true });
        const post = inject('POST', '/v1/admin/modifier-groups', {
          name: 'Sides',
          min_choices: 0,
          max_choices: 1,
          options: [{ name: 'Extra raita', linked_item_id: raita }],
        });
        if (order === 'archive first') {
          const [archived, posted] = await race({ hook: 'beforeBump', call: archive }, post);
          noDeadlock([archived, posted]);
          expect(archived.statusCode, archived.body).toBe(200);
          expect(posted.statusCode, posted.body).toBe(422);
          expect(error(posted)).toMatchObject({
            code: 'CONFIG_REFERENCE_INVALID',
            details: { field: 'options.0.linked_item_id', reason: 'archived' },
          });
        } else {
          const [posted, archived] = await race({ hook: 'beforeBump', call: post }, archive);
          noDeadlock([archived, posted]);
          expect(posted.statusCode, posted.body).toBe(201);
          expect(archived.statusCode, archived.body).toBe(409);
          const groupId = posted.json().data.modifier_group.modifier_group_id as string;
          expect(error(archived)).toMatchObject({
            code: 'CONFIG_IN_USE',
            details: { entity: 'menu_item', id: raita, used_by: { entity: 'modifier_group', ids: [groupId] } },
          });
        }
        // never both: no active option of an active group links an archived item
        const broken = await cloud.pool.query(
          `SELECT o.option_id FROM modifier_options o
             JOIN modifier_groups g ON g.tenant_id = o.tenant_id AND g.modifier_group_id = o.modifier_group_id
             JOIN menu_items m ON m.tenant_id = o.tenant_id AND m.item_id = o.linked_item_id
            WHERE o.tenant_id = $1 AND o.archived_at IS NULL AND g.archived_at IS NULL AND m.archived_at IS NOT NULL`,
          [f.tenantId],
        );
        expect(broken.rows, order).toEqual([]);
        serialised(order);
      }
    },
    RACE_TIMEOUT,
  );

  it(
    '[01c #75] stock_unit PATCH and an item POST drawing from it, both orders: serialised by the stock item lock; the loser sees the winner’s unit and gets unit_mismatch',
    async () => {
      for (const order of ['PATCH first', 'POST first'] as const) {
        f = await restaurantFixture(cloud);
        menu = await seedMenu(cloud.pool, f);
        // 'g' stock, a piece item drawing 200 g: valid; after stock_unit → 'piece' equal units need quantity 1 (V4)
        const pot = await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' });
        const patch = inject('PATCH', `/v1/admin/stock-items/${pot.stock_item_id}`, { expected_version: pot.version, stock_unit: 'piece' });
        const post = inject('POST', '/v1/admin/menu-items', {
          category_id: menu.categoryIds[0],
          tax_class_id: null,
          name: 'Karahi plate',
          price_minor: 10_000,
          serve_mode: 'sync',
          cook_time_ms: 600_000,
          routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId }],
          stock_draws: [{ stock_item_id: pot.stock_item_id, quantity_per_sale_unit: 200 }],
        });
        const unit = async () =>
          (await cloud.pool.query<{ stock_unit: string }>(`SELECT stock_unit FROM stock_items WHERE stock_item_id = $1`, [pot.stock_item_id])).rows[0]!
            .stock_unit;
        const draws = async () =>
          (await cloud.pool.query(`SELECT item_id FROM stock_draws WHERE stock_item_id = $1`, [pot.stock_item_id])).rows.length;
        if (order === 'PATCH first') {
          const [patched, posted] = await race({ hook: 'beforeBump', call: patch }, post);
          noDeadlock([patched, posted]);
          expect(patched.statusCode, patched.body).toBe(200);
          expect(posted.statusCode, posted.body).toBe(422);
          expect(error(posted)).toMatchObject({
            code: 'CONFIG_REFERENCE_INVALID',
            details: { field: 'stock_draws.0.stock_item_id', reason: 'unit_mismatch' },
          });
          expect(await unit()).toBe('piece');
          expect(await draws()).toBe(0);
          serialised(order);
        } else {
          const [posted, patched] = await race({ hook: 'afterReferenceLock', call: post }, patch);
          noDeadlock([patched, posted]);
          expect(posted.statusCode, posted.body).toBe(201);
          expect(patched.statusCode, patched.body).toBe(422);
          expect(error(patched)).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'stock_unit', reason: 'unit_mismatch' } });
          expect(await unit()).toBe('g');
          expect(await draws()).toBe(1);
          serialised(order);
        }
      }
    },
    RACE_TIMEOUT,
  );

  it(
    '[01c #76] deal PUT at Gulberg and deal archive, both orders: archive first → PUT is_sold 422 archived; PUT first → archive 200 and the builder drops the archived deal',
    async () => {
      for (const order of ['archive first', 'PUT first'] as const) {
        f = await restaurantFixture(cloud);
        menu = await seedMenu(cloud.pool, f);
        const gulberg = f.branches[0];
        const karahi = await item('Chicken Karahi');
        const deal: DealWire = await createDeal(cloud, f, {
          name: 'Family karahi deal',
          category_id: menu.categoryIds[0],
          tax_class_id: menu.taxClassId,
          sort_order: 1,
          price_minor: 320_000,
          parts: [{ quantity: 1, sort_order: 1, choices: [{ item_id: karahi, sort_order: 1 }] }],
        });
        const listed = await cloud.app.inject({ method: 'GET', url: '/v1/admin/deals?status=active', headers: owner(f).headers });
        expect(listed.statusCode, listed.body).toBe(200);
        const entry = (listed.json().data.deals as Array<DealWire & { branches: DealBranchWire[] }>)
          .find((d) => d.deal_id === deal.deal_id)!
          .branches.find((b) => b.branch_id === gulberg)!;
        const put = inject('PUT', `/v1/admin/deals/${deal.deal_id}/branches/${gulberg}`, {
          expected_version: entry.version,
          is_sold: true,
          price_minor_override: null,
        });
        const archive = inject('PATCH', `/v1/admin/deals/${deal.deal_id}`, { expected_version: deal.version, archived: true });
        const branchRows = async () =>
          (await cloud.pool.query(`SELECT branch_id FROM deal_branches WHERE deal_id = $1`, [deal.deal_id])).rows as Array<{ branch_id: string }>;
        if (order === 'archive first') {
          const [archived, sold] = await race({ hook: 'beforeBump', call: archive }, put);
          noDeadlock([archived, sold]);
          expect(archived.statusCode, archived.body).toBe(200);
          expect(sold.statusCode, sold.body).toBe(422);
          expect(error(sold)).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'deal_id', reason: 'archived' } });
          expect(await branchRows()).toEqual([]);
        } else {
          const [sold, archived] = await race({ hook: 'beforeBump', call: put }, archive);
          noDeadlock([archived, sold]);
          expect(sold.statusCode, sold.body).toBe(200);
          expect(archived.statusCode, archived.body).toBe(200);
          expect(await branchRows()).toEqual([{ branch_id: gulberg }]);
        }
        const snapshot = await build(gulberg);
        expect(snapshot.deals.find((d) => d.deal_id === deal.deal_id), order).toBeUndefined();
        serialised(order);
      }
    },
    RACE_TIMEOUT,
  );
});
