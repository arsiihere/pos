import type { DefaultKey } from '@pos/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

describe('lock modes (01b B11, 01a S8)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let menu: SeededMenu;
  // Set by a test to pause the next directory write right after its tenant lock.
  let barrier: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    cloud = await createTestCloud({ testHooks: { afterTenantLock: async () => barrier?.() } });
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    barrier = undefined;
    f = await restaurantFixture(cloud);
    menu = await seedMenu(cloud.pool, f);
  });

  const roleId = async (key: DefaultKey) =>
    (
      await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1 AND default_key = $2`, [
        f.tenantId,
        key,
      ])
    ).rows[0]!.role_id;

  it('[01b #85] a directory write holding tenants FOR NO KEY UPDATE does not block a menu-item create (commits within 1 s)', async () => {
    let reached!: () => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (reached = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    barrier = () => {
      barrier = undefined;
      reached();
      return released;
    };
    const waiterRole = await roleId('waiter');

    const staff = cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/staff',
      ...owner(f),
      payload: { display_name: 'Bilal', role_ids: [waiterRole], branch_ids: [f.branches[0]] },
    });
    await held;
    const holders = await cloud.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
        WHERE c.relname = 'tenants' AND l.mode = 'RowShareLock' AND l.granted`,
    );
    expect(Number(holders.rows[0]!.n)).toBeGreaterThan(0);

    const menuCreate = cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/menu-items',
      ...owner(f),
      payload: {
        category_id: menu.categoryIds[0],
        tax_class_id: menu.taxClassId,
        name: 'Seekh kabab',
        price_minor: 100,
        serve_mode: 'sync',
        cook_time_ms: 60_000,
      },
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), 1_000)));
    const first = await Promise.race([menuCreate, timeout]);
    clearTimeout(timer);
    release();
    const created = await staff;
    const menuResponse = await menuCreate;

    expect(first, 'menu create waited on the tenant row').not.toBe('timeout');
    expect(menuResponse.statusCode, menuResponse.body).toBe(201);
    expect(created.statusCode, created.body).toBe(200);
  });
});
