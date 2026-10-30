import type { DealBranchWire, DealWire, StockItemBranchWire, StockItemWire } from '@pos/events';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CloudTestHooks } from '../../src/server';
import { createDeal, createStockItem, createVariantGroup } from '../helpers/menu-variants';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

// 01c §10 races #98, #99, #121 (§6 "Lock order": M3, M4, N3). Two barriers force the orderings:
// - hook: request 1 stops at `beforeBump` holding every row lock it takes; request 2 starts and is shown waiting on
//   request 1's backend (pg_blocking_pids); then request 1 goes on.
// - queue: a test transaction holds the variant group FOR UPDATE; request 1 starts and is shown waiting on it, then
//   request 2 starts and is shown waiting on the holder or on request 1; then the holder rolls back, so both requests
//   take their locks back to back in the queued order (the interleaving a lock-order inversion deadlocks on).

type Response = LightMyRequestResponse;
type Call = () => Promise<Response>;
type ApiError = { error: { code: string; details: Record<string, unknown> } };
// `waited[i]`: request i + 1 was seen waiting on the lock holder it was queued behind (hook: only request 2).
type RaceResult = { responses: [Response, Response]; waited: boolean[]; deadlockLogged: boolean };

const RACE_TIMEOUT = 30_000;

describe('01c races #98, #99, #121 (§6 lock order)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let menu: SeededMenu;
  const control: { beforeBump?: () => Promise<void> } = {};

  beforeAll(async () => {
    const testHooks: CloudTestHooks = { beforeBump: () => control.beforeBump?.() ?? Promise.resolve() };
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

  async function within<T>(promise: Promise<T>, message: string, ms = 5_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)))]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Every request of a race is settled before the next test, also when a barrier throws.
  async function settle(pending: ReadonlyArray<Promise<Response>>): Promise<void> {
    await within(Promise.allSettled(pending), 'a request did not settle', 10_000).catch(() => undefined);
  }

  // Pauses the first arrival at the hook until released.
  function pause() {
    let arrived = false;
    let reachedFirst!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => (reachedFirst = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    const hook = async () => {
      if (arrived) return;
      arrived = true;
      reachedFirst();
      await released;
    };
    return { hook, reached: () => within(reached, 'request 1 never reached its hook'), release };
  }

  // The backend of the request paused at its hook: the only transaction left open in this database.
  async function pausedBackend(): Promise<number> {
    const rows = await cloud.pool.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity
        WHERE datname = current_database() AND state = 'idle in transaction' AND pid <> pg_backend_pid()`,
    );
    expect(rows.rows, 'exactly one open transaction (request 1)').toHaveLength(1);
    return rows.rows[0]!.pid;
  }

  // The backend (not in `known`) that waits on a lock held or queued for by one of `blockers`, polled and bounded.
  // Null when `settled` settles first: the request never waited (the race goes on; the caller asserts `waited`).
  async function waiterBehind(blockers: readonly number[], known: readonly number[], settled: Promise<unknown>): Promise<number | null> {
    let done = false;
    void settled.then(
      () => (done = true),
      () => (done = true),
    );
    for (let waited = 0; waited < 5_000; waited += 20) {
      if (done) return null;
      const rows = await cloud.pool.query<{ pid: number; by: number[] }>(
        `SELECT pid, pg_blocking_pids(pid) AS by FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
      );
      const waiter = rows.rows.find((row) => !known.includes(row.pid) && row.by.some((pid) => blockers.includes(pid)));
      if (waiter !== undefined) return waiter.pid;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('the request neither waited on the expected lock nor finished');
  }

  const deadlockSince = (mark: number) => cloud.logs().slice(mark).includes('40P01');

  // Hook barrier: request 1 held at beforeBump (all its row locks taken), request 2 shown waiting on it, release.
  async function hookRace(first: Call, second: Call): Promise<RaceResult> {
    const mark = cloud.logs().length;
    const gate = pause();
    control.beforeBump = gate.hook;
    const pending: Array<Promise<Response>> = [];
    try {
      const one = first();
      pending.push(one);
      await gate.reached();
      const holder = await pausedBackend();
      const two = second();
      pending.push(two);
      const waiter = await waiterBehind([holder], [holder], two);
      gate.release();
      const responses = await within(Promise.all([one, two]), 'the race did not finish (deadlock?)', 10_000);
      return { responses, waited: [waiter !== null], deadlockLogged: deadlockSince(mark) };
    } finally {
      gate.release();
      await settle(pending);
      delete control.beforeBump;
    }
  }

  // Queue barrier: a test transaction holds the variant group FOR UPDATE; request 1, then request 2, queue on it.
  async function queueRace(variantGroupId: string, first: Call, second: Call): Promise<RaceResult> {
    const mark = cloud.logs().length;
    const client = await cloud.pool.connect();
    let open = true;
    const unlock = async () => {
      if (!open) return;
      open = false;
      await client.query('ROLLBACK');
    };
    const pending: Array<Promise<Response>> = [];
    try {
      await client.query('BEGIN');
      await client.query(`SELECT 1 FROM variant_groups WHERE tenant_id = $1 AND variant_group_id = $2 FOR UPDATE`, [f.tenantId, variantGroupId]);
      const holder = (await client.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`)).rows[0]!.pid;
      const one = first();
      pending.push(one);
      const p1 = await waiterBehind([holder], [holder], one);
      const ahead = p1 === null ? [holder] : [holder, p1];
      const two = second();
      pending.push(two);
      const p2 = await waiterBehind(ahead, ahead, two);
      await unlock();
      const responses = await within(Promise.all([one, two]), 'the race did not finish (deadlock?)', 10_000);
      return { responses, waited: [p1 !== null, p2 !== null], deadlockLogged: deadlockSince(mark) };
    } finally {
      await unlock().catch(() => undefined);
      client.release();
      await settle(pending);
    }
  }

  const inject = (method: 'POST' | 'PATCH' | 'PUT', url: string, payload: object): Call => () =>
    cloud.app.inject({ method, url, ...owner(f), payload });
  const error = (response: Response) => (response.json() as ApiError).error;
  // No 40P01: neither request failed with a 500 and no deadlock was logged during the race.
  const noDeadlock = (race: RaceResult) => {
    expect(race.deadlockLogged, '40P01 logged').toBe(false);
    for (const response of race.responses) expect(response.statusCode, response.body).not.toBe(500);
  };
  const serialised = (race: RaceResult) => expect(race.waited, 'each queued request waited on the lock ahead of it').not.toContain(false);

  // A piece item in CT-1 (or `categoryId`), routed at branch A, optionally a member of a variant group.
  const item = async (name: string, o?: { variant_group_id: string; variant_name: string }) => {
    const response = await inject('POST', '/v1/admin/menu-items', {
      category_id: menu.categoryIds[0],
      tax_class_id: null,
      name,
      price_minor: 10_000,
      serve_mode: 'sync',
      cook_time_ms: 600_000,
      routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId }],
      ...o,
    })();
    expect(response.statusCode, response.body).toBe(201);
    return response.json().data.item.item_id as string;
  };
  // "Naan" in CT-1 with members Plain, Butter, Garlic; the move sends it to CT-2.
  const naan = async () => {
    const group = await createVariantGroup(cloud, f, { name: 'Naan', category_id: menu.categoryIds[0] });
    const member = (variant: string) => item(`Naan ${variant}`, { variant_group_id: group.variant_group_id, variant_name: variant });
    const members = { plain: await member('Plain'), butter: await member('Butter'), garlic: await member('Garlic') };
    const move = inject('PATCH', `/v1/admin/variant-groups/${group.variant_group_id}`, {
      expected_version: group.version,
      category_id: menu.categoryIds[1],
    });
    return { group, members, move };
  };
  const membersOf = async (variantGroupId: string) =>
    (
      await cloud.pool.query<{ item_id: string; name: string; category_id: string }>(
        `SELECT item_id, name, category_id FROM menu_items WHERE tenant_id = $1 AND variant_group_id = $2 ORDER BY name`,
        [f.tenantId, variantGroupId],
      )
    ).rows;

  // #98 and #121: both requests commit in every forced ordering. hook: request 1 holds all its locks;
  // queue: both queued on the variant group, request 1 first.
  const ORDERS = [
    { barrier: 'hook', first: 'move' },
    { barrier: 'hook', first: 'other' },
    { barrier: 'queue', first: 'move' },
    { barrier: 'queue', first: 'other' },
  ] as const;
  type Order = (typeof ORDERS)[number];
  const runOrder = async (order: Order, groupId: string, move: Call, other: Call): Promise<{ moved: Response; other: Response; race: RaceResult }> => {
    const [a, b] = order.first === 'move' ? [move, other] : [other, move];
    const race = order.barrier === 'hook' ? await hookRace(a, b) : await queueRace(groupId, a, b);
    const [r1, r2] = race.responses;
    return order.first === 'move' ? { moved: r1, other: r2, race } : { moved: r2, other: r1, race };
  };
  const label = (order: Order, other: string) => `${order.barrier} barrier, ${order.first === 'move' ? 'move' : other} first`;

  it.each(ORDERS.map((order) => [label(order, 'rename'), order] as const))(
    '[01c #98] §6.2 category move of a 3-member group ‖ §6.5 rename of a member (%s): both commit, never 40P01; every member moved, the rename kept',
    async (_, order) => {
      const { group, members, move } = await naan();
      const rename = inject('PATCH', `/v1/admin/menu-items/${members.butter}`, { name: 'Naan Makhan' });
      const result = await runOrder(order, group.variant_group_id, move, rename);
      noDeadlock(result.race);
      expect(result.moved.statusCode, result.moved.body).toBe(200);
      expect(result.other.statusCode, result.other.body).toBe(200);
      const to = menu.categoryIds[1];
      expect(await membersOf(group.variant_group_id)).toEqual([
        { item_id: members.garlic, name: 'Naan Garlic', category_id: to },
        { item_id: members.butter, name: 'Naan Makhan', category_id: to },
        { item_id: members.plain, name: 'Naan Plain', category_id: to },
      ]);
      serialised(result.race);
    },
    RACE_TIMEOUT,
  );

  it.each(ORDERS.map((order) => [label(order, 'group POST'), order] as const))(
    '[01c #121] §6.11 POST of a group linking Naan Butter and the "Naan" variant group ‖ §6.2 category move of "Naan" (%s): both commit, never 40P01; members moved and the group present',
    async (_, order) => {
      const { group, members, move } = await naan();
      const post = inject('POST', '/v1/admin/modifier-groups', {
        name: 'Extras',
        min_choices: 0,
        max_choices: 1,
        options: [{ name: 'Extra butter naan', linked_item_id: members.butter }],
        links: [{ target_kind: 'variant_group', target_id: group.variant_group_id, mode: 'attach' }],
      });
      const result = await runOrder(order, group.variant_group_id, move, post);
      noDeadlock(result.race);
      expect(result.moved.statusCode, result.moved.body).toBe(200);
      expect(result.other.statusCode, result.other.body).toBe(201);
      const modifierGroupId = result.other.json().data.modifier_group.modifier_group_id as string;
      const to = menu.categoryIds[1];
      expect((await membersOf(group.variant_group_id)).map((m) => m.category_id)).toEqual([to, to, to]);
      const stored = await cloud.pool.query(
        `SELECT g.name, o.linked_item_id, l.target_kind, l.target_id
           FROM modifier_groups g
           JOIN modifier_options o ON o.tenant_id = g.tenant_id AND o.modifier_group_id = g.modifier_group_id
           JOIN modifier_group_links l ON l.tenant_id = g.tenant_id AND l.modifier_group_id = g.modifier_group_id
          WHERE g.tenant_id = $1 AND g.modifier_group_id = $2 AND g.archived_at IS NULL`,
        [f.tenantId, modifierGroupId],
      );
      expect(stored.rows).toEqual([
        { name: 'Extras', linked_item_id: members.butter, target_kind: 'variant_group', target_id: group.variant_group_id },
      ]);
      serialised(result.race);
    },
    RACE_TIMEOUT,
  );

  it(
    '[01c #99] two §6.9 PUTs at Gulberg for a stock item with no row there, both with the "no row" version: one 200, one 409 CONFIG_STALE',
    async () => {
      const gulberg = f.branches[0];
      const pot = await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' });
      // both tabs loaded the list: Gulberg's entry is "no row"
      const listed = await cloud.app.inject({ method: 'GET', url: '/v1/admin/stock-items', headers: owner(f).headers });
      expect(listed.statusCode, listed.body).toBe(200);
      const entry = (listed.json().data.stock_items as Array<StockItemWire & { branches: StockItemBranchWire[] }>)
        .find((s) => s.stock_item_id === pot.stock_item_id)!
        .branches.find((b) => b.branch_id === gulberg)!;
      expect(entry).toMatchObject({ station_id: null, low_stock_threshold: null });
      const url = `/v1/admin/stock-items/${pot.stock_item_id}/branches/${gulberg}`;
      const race = await hookRace(
        inject('PUT', url, { expected_version: entry.version, station_id: menu.slotStationId, low_stock_threshold: 2000 }),
        inject('PUT', url, { expected_version: entry.version, station_id: menu.batchStationId, low_stock_threshold: 500 }),
      );
      noDeadlock(race);
      const [won, lost] = race.responses;
      expect(won.statusCode, won.body).toBe(200);
      expect(lost.statusCode, lost.body).toBe(409);
      expect(error(lost)).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'stock_item_branch', id: pot.stock_item_id } });
      const stored = await cloud.pool.query(
        `SELECT branch_id, station_id, low_stock_threshold FROM stock_item_branches WHERE tenant_id = $1 AND stock_item_id = $2`,
        [f.tenantId, pot.stock_item_id],
      );
      expect(stored.rows).toEqual([{ branch_id: gulberg, station_id: menu.slotStationId, low_stock_threshold: 2000 }]);
      serialised(race);
    },
    RACE_TIMEOUT,
  );

  it(
    '[01c #99] two §6.16 PUTs at Gulberg for a deal with no row there, both with the "no row" version: one 200, one 409 CONFIG_STALE',
    async () => {
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
      expect(entry).toMatchObject({ is_sold: false, price_minor_override: null });
      const url = `/v1/admin/deals/${deal.deal_id}/branches/${gulberg}`;
      const race = await hookRace(
        inject('PUT', url, { expected_version: entry.version, is_sold: true, price_minor_override: null }),
        inject('PUT', url, { expected_version: entry.version, is_sold: true, price_minor_override: 300_000 }),
      );
      noDeadlock(race);
      const [won, lost] = race.responses;
      expect(won.statusCode, won.body).toBe(200);
      expect(lost.statusCode, lost.body).toBe(409);
      expect(error(lost)).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'deal_branch', id: deal.deal_id } });
      const stored = await cloud.pool.query(
        `SELECT branch_id, price_minor_override FROM deal_branches WHERE tenant_id = $1 AND deal_id = $2`,
        [f.tenantId, deal.deal_id],
      );
      expect(stored.rows).toEqual([{ branch_id: gulberg, price_minor_override: null }]);
      serialised(race);
    },
    RACE_TIMEOUT,
  );
});
