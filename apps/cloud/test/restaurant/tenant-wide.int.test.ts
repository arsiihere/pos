import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { issueRegistrationCode } from '../../src/cli/issue-registration-code';
import { SystemContext } from '../../src/cli/system-context';
import { ulidGen } from '../../src/lib/ids';
import { cryptoSecrets } from '../../src/lib/secrets';
import { OWNER_PASSWORD, owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

describe('tenant-wide write guard', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let menu: SeededMenu;

  beforeAll(async () => {
    cloud = await createTestCloud({ captureLogs: true });
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
    menu = await seedMenu(cloud.pool, f, { items: 1 });
  });

  const limitOwnerRow = (branchIds: string[]) =>
    cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      f.tenantId,
      f.userId,
      branchIds,
    ]);
  // Everything a tenant-wide write could leave behind.
  const state = async () => ({
    counts: (
      await cloud.pool.query(
        `SELECT (SELECT count(*) FROM config_audit) AS audit, (SELECT count(*) FROM idempotency_keys) AS keys,
                (SELECT count(*) FROM menu_items) AS items, (SELECT count(*) FROM tax_classes) AS tax_classes,
                (SELECT count(*) FROM categories) AS categories, (SELECT count(*) FROM item_routes) AS routes`,
      )
    ).rows[0],
    item: (await cloud.pool.query(`SELECT price_minor FROM menu_items WHERE item_id = $1`, [menu.itemIds[0]])).rows[0],
    category: (await cloud.pool.query(`SELECT archived_at FROM categories WHERE category_id = $1`, [menu.categoryIds[1]])).rows[0],
    versions: (
      await cloud.pool.query(`SELECT branch_id, config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`, [f.tenantId])
    ).rows,
  });
  const tenantWideWrites = (token?: string) => [
    () =>
      cloud.app.inject({
        method: 'POST',
        url: '/v1/admin/menu-items',
        ...owner(f, token),
        payload: {
          category_id: menu.categoryIds[0],
          tax_class_id: null,
          name: 'Mutton Karahi',
          price_minor: 120000,
          serve_mode: 'sync',
          cook_time_ms: 1_200_000,
          routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId }],
        },
      }),
    () =>
      cloud.app.inject({
        method: 'PATCH',
        url: `/v1/admin/menu-items/${menu.itemIds[0]}`,
        ...owner(f, token),
        payload: { price_minor: 130000 },
      }),
    () => cloud.app.inject({ method: 'POST', url: '/v1/admin/tax-classes', ...owner(f, token), payload: { name: 'GST', rate_bp: 1600 } }),
    () =>
      cloud.app.inject({
        method: 'PATCH',
        url: `/v1/admin/categories/${menu.categoryIds[1]}`,
        ...owner(f, token),
        payload: { archived: true },
      }),
  ];
  const canEditTenant = async (token: string) => {
    const response = await cloud.app.inject({ method: 'GET', url: '/v1/admin/menu', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    return response.json().data.can_edit_tenant as boolean;
  };

  it('[01a §10 #117] owner row [A] of A, B, C: tenant-wide writes → 403 tenant_wide_write, nothing written; POST …/branches/A/floors → 201', async () => {
    await limitOwnerRow([f.branches[0]]);
    const before = await state();
    // The token still lists A, B, C: the database, not the token, decides.
    for (const write of tenantWideWrites()) {
      const response = await write();
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'tenant_wide_write' } });
    }
    expect(await state()).toEqual(before);

    const floor = await cloud.app.inject({
      method: 'POST',
      url: `/v1/admin/branches/${f.branches[0]}/floors`,
      ...owner(f),
      payload: { name: 'Roof' },
    });
    expect(floor.statusCode).toBe(201);
  });

  it('[01a §10 #153] allowed branches read from the database: an old token works after D is added; a row lacking D with a token listing A–D → 403 and can_edit_tenant false', async () => {
    const login = await cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'a@example.com', password: OWNER_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const oldToken = login.json().data.access_token as string;
    const sys = new SystemContext(cloud.pool);
    const d = (
      // Real ids and secrets: the fixture's test generators already used the low values.
      await issueRegistrationCode(sys, { tenantId: f.tenantId, branchName: 'Branch D' }, { clock: cloud.clock, ids: ulidGen(cloud.clock), secrets: cryptoSecrets })
    ).branch_id;

    const created = await cloud.app.inject({ method: 'POST', url: '/v1/admin/categories', ...owner(f, oldToken), payload: { name: 'Drinks' } });
    expect(created.statusCode, created.body).toBe(201);
    expect(await canEditTenant(oldToken)).toBe(true);

    await limitOwnerRow([...f.branches]);
    const tokenAD = f.tokenFor([...f.branches, d]);
    const refused = await cloud.app.inject({ method: 'POST', url: '/v1/admin/categories', ...owner(f, tokenAD), payload: { name: 'Sweets' } });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'tenant_wide_write' } });
    expect(await canEditTenant(tokenAD)).toBe(false);
  });

  it('[01a S8] the 403 writes nothing: no audit row, no idempotency key stored, no branch bumped, for every tenant-wide write', async () => {
    await limitOwnerRow([f.branches[0], f.branches[1]]);
    for (const write of tenantWideWrites()) {
      const before = await state();
      const response = await write();
      expect(response.statusCode).toBe(403);
      expect(await state()).toEqual(before);
    }
    // The same key retried after the row is fixed is a fresh request, not a stored 403.
    const headers = owner(f);
    const payload = { name: 'GST', rate_bp: 1600 };
    expect((await cloud.app.inject({ method: 'POST', url: '/v1/admin/tax-classes', ...headers, payload })).statusCode).toBe(403);
    await limitOwnerRow([...f.branches]);
    const retried = await cloud.app.inject({ method: 'POST', url: '/v1/admin/tax-classes', ...headers, payload });
    expect(retried.statusCode).toBe(201);
    expect(retried.headers['idempotent-replay']).toBeUndefined();
  });
});
