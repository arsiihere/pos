import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CloudTestHooks } from '../../src/server';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

type LockHook = 'afterTargetLock' | 'afterReferenceLock';

const PUT_ROUTE = 'PUT /v1/admin/menu-items/:item_id/routes/:branch_id';
const PATCH_STATION = 'PATCH /v1/admin/branches/:branch_id/stations/:station_id';
const POST_ITEM = 'POST /v1/admin/menu-items';
const PATCH_PROGRAM = 'PATCH /v1/admin/branches/:branch_id/stations/:station_id/programs/:program_id';

describe('config write lock order', () => {
  let cloud: TestCloud;
  const control: Partial<Record<LockHook, (route: string) => Promise<void>>> = {};

  beforeAll(async () => {
    const testHooks: CloudTestHooks = {
      afterTargetLock: (route) => control.afterTargetLock?.(route) ?? Promise.resolve(),
      afterReferenceLock: (route) => control.afterReferenceLock?.(route) ?? Promise.resolve(),
    };
    cloud = await createTestCloud({ captureLogs: true, testHooks });
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });

  // Pauses the first `count` requests of `route` at the hook until released.
  function pause(route: string, count = 1) {
    let arrived = 0;
    let reachedAll!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => (reachedAll = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    const hook = async (r: string) => {
      if (r !== route || arrived >= count) return;
      arrived += 1;
      if (arrived === count) reachedAll();
      await released;
    };
    return { hook, reached: within(reached, `${route} never reached its lock hook`), release };
  }

  function within(promise: Promise<void>, message: string, ms = 2_000): Promise<void> {
    return Promise.race([promise, new Promise<void>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
  }

  // The barrier: the second request is blocked on a row lock (polled up to 2 000 ms).
  async function waitForLockWait(): Promise<void> {
    for (let waited = 0; waited < 2_000; waited += 20) {
      const rows = await cloud.pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
      );
      if (Number(rows.rows[0]!.n) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('the second request never waited on a lock');
  }

  // Request 1 takes its lock and stops at `hook`; request 2 starts and blocks on it; then request 1 goes on.
  async function race(
    first: { hook: LockHook; route: string; call: () => Promise<LightMyRequestResponse> },
    second: () => Promise<LightMyRequestResponse>,
  ): Promise<[LightMyRequestResponse, LightMyRequestResponse]> {
    const gate = pause(first.route);
    control[first.hook] = gate.hook;
    try {
      const one = first.call();
      await gate.reached;
      const two = second();
      await waitForLockWait();
      gate.release();
      return await Promise.all([one, two]);
    } finally {
      gate.release();
      delete control[first.hook];
    }
  }

  async function setup(): Promise<{ f: RestaurantFixture; menu: SeededMenu }> {
    const f = await restaurantFixture(cloud);
    const menu = await seedMenu(cloud.pool, f, { items: 1 });
    // A slot station of branch A that no route uses yet.
    await cloud.pool.query(
      `INSERT INTO stations (tenant_id, branch_id, station_id, point_id, name, station_type, capacity, created_at, updated_at)
       VALUES ($1, $2, 'ST-R', (SELECT point_id FROM points WHERE tenant_id = $1 AND branch_id = $2 AND name = 'Pass'), 'Grill', 'slot', 2, 0, 0)`,
      [f.tenantId, f.branches[0]],
    );
    return { f, menu };
  }

  const activeRoutesOnArchived = async () =>
    (
      await cloud.pool.query(
        `SELECT r.item_id FROM item_routes r
           JOIN menu_items m ON m.tenant_id = r.tenant_id AND m.item_id = r.item_id AND m.archived_at IS NULL
           JOIN stations s ON s.tenant_id = r.tenant_id AND s.branch_id = r.branch_id AND s.station_id = r.station_id
           LEFT JOIN batch_programs p ON p.tenant_id = r.tenant_id AND p.branch_id = r.branch_id
                                     AND p.program_id IN (r.program_id, r.stock_program_id)
          WHERE s.archived_at IS NOT NULL OR p.archived_at IS NOT NULL`,
      )
    ).rows;

  it('[01a §10 #86] PUT route to S and archive S concurrently, both orders: one wins, the other 409 / 422; never an active route on an archived station; no deadlock', async () => {
    for (const order of ['route first', 'archive first'] as const) {
      const { f, menu } = await setup();
      const [a] = f.branches;
      const putRoute = () =>
        cloud.app.inject({
          method: 'PUT',
          url: `/v1/admin/menu-items/${menu.itemIds[0]}/routes/${a}`,
          headers: { authorization: `Bearer ${f.token}` },
          payload: { station_id: 'ST-R' },
        });
      const archive = () =>
        cloud.app.inject({ method: 'PATCH', url: `/v1/admin/branches/${a}/stations/ST-R`, ...owner(f), payload: { archived: true } });

      if (order === 'route first') {
        const [route, archived] = await race({ hook: 'afterReferenceLock', route: PUT_ROUTE, call: putRoute }, archive);
        expect(route.statusCode, route.body).toBe(200);
        expect(archived.statusCode, archived.body).toBe(409);
        expect(archived.json().error).toMatchObject({
          code: 'CONFIG_IN_USE',
          details: { entity: 'station', id: 'ST-R', used_by: { entity: 'menu_item', ids: [menu.itemIds[0]] } },
        });
      } else {
        const [archived, route] = await race({ hook: 'afterTargetLock', route: PATCH_STATION, call: archive }, putRoute);
        expect(archived.statusCode, archived.body).toBe(200);
        expect(route.statusCode, route.body).toBe(422);
        expect(route.json().error).toMatchObject({
          code: 'CONFIG_REFERENCE_INVALID',
          details: { field: 'station_id', reason: 'archived' },
        });
      }
      expect(await activeRoutesOnArchived(), order).toEqual([]);
    }
  });

  it('[01a §10 #87] item create using program G as stock_program_id and archive G concurrently, both orders; two concurrent item creates both commit; no deadlock', async () => {
    for (const order of ['create first', 'archive first'] as const) {
      const { f, menu } = await setup();
      const [a] = f.branches;
      const [programId, stockProgramId] = menu.programIds;
      const create = () =>
        cloud.app.inject({
          method: 'POST',
          url: '/v1/admin/menu-items',
          ...owner(f),
          payload: {
            category_id: menu.categoryIds[0],
            tax_class_id: null,
            name: 'Fries',
            price_minor: 30000,
            serve_mode: 'immediate',
            cook_time_ms: 360000,
            routes: [{ branch_id: a, station_id: menu.batchStationId, program_id: programId, stock_program_id: stockProgramId }],
          },
        });
      const archive = () =>
        cloud.app.inject({
          method: 'PATCH',
          url: `/v1/admin/branches/${a}/stations/${menu.batchStationId}/programs/${stockProgramId}`,
          ...owner(f),
          payload: { archived: true },
        });

      if (order === 'create first') {
        const [created, archived] = await race({ hook: 'afterReferenceLock', route: POST_ITEM, call: create }, archive);
        expect(created.statusCode, created.body).toBe(201);
        expect(archived.statusCode, archived.body).toBe(409);
        expect(archived.json().error).toMatchObject({
          code: 'CONFIG_IN_USE',
          details: { entity: 'batch_program', id: stockProgramId, used_by: { entity: 'menu_item', ids: [created.json().data.item.item_id] } },
        });
      } else {
        const [archived, created] = await race({ hook: 'afterTargetLock', route: PATCH_PROGRAM, call: archive }, create);
        expect(archived.statusCode, archived.body).toBe(200);
        expect(created.statusCode, created.body).toBe(422);
        expect(created.json().error).toMatchObject({
          code: 'CONFIG_REFERENCE_INVALID',
          details: { field: 'routes.0.stock_program_id', reason: 'archived' },
        });
      }
      expect(await activeRoutesOnArchived(), order).toEqual([]);
    }

    // Two tenant-wide writes that both hold their reference locks, then race for the branch rows.
    const { f, menu } = await setup();
    const before = (await cloud.pool.query<{ v: string }>(`SELECT config_version AS v FROM branches WHERE branch_id = $1`, [f.branches[0]]))
      .rows[0]!.v;
    const gate = pause(POST_ITEM, 2);
    control.afterReferenceLock = gate.hook;
    try {
      const creates = ['Mutton Karahi', 'Chicken Karahi'].map((name) =>
        cloud.app.inject({
          method: 'POST',
          url: '/v1/admin/menu-items',
          ...owner(f),
          payload: {
            category_id: menu.categoryIds[0],
            tax_class_id: menu.taxClassId,
            name,
            price_minor: 120000,
            serve_mode: 'sync',
            cook_time_ms: 1_200_000,
            routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId }],
          },
        }),
      );
      await gate.reached;
      gate.release();
      const results = await Promise.all(creates);
      expect(results.map((r) => r.statusCode)).toEqual([201, 201]);
    } finally {
      gate.release();
      delete control.afterReferenceLock;
    }
    const after = (await cloud.pool.query<{ v: string }>(`SELECT config_version AS v FROM branches WHERE branch_id = $1`, [f.branches[0]]))
      .rows[0]!.v;
    expect(Number(after)).toBe(Number(before) + 2);
  });
});
