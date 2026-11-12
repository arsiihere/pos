import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedTenant } from '../../src/cli/seed-tenant';
import { SystemContext } from '../../src/cli/system-context';
import { testIdGen } from '../../src/lib/ids';
import { createTestCloud, truncateAll, type TestCloud } from '../helpers/test-cloud';

// 04 §4.5 B-1 / 01b v1.9 §5.1a (gap G-20): cloud migration 0013 adds the 04 void defaults to tenants seeded before 04.
// `seeded` is a tenant seeded before 04: its cashier / order_taker roles hold neither void-item nor move-item-to-stock.

const backfill = fileURLToPath(new URL('../../src/db/migrations/0013_void_defaults_backfill.sql', import.meta.url));
const VOID_PERMS = ['move-item-to-stock', 'void-item'];

describe('[01b #109 / 04 #32 backfill half] cloud migration 0013_void_defaults_backfill.sql', () => {
  const ids = testIdGen();
  let cloud: TestCloud;
  let sql: string;

  beforeAll(async () => {
    cloud = await createTestCloud();
    sql = readFileSync(backfill, 'utf8');
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    await truncateAll(cloud.pool);
  });

  async function seeded(email: string): Promise<string> {
    const { tenant_id } = await seedTenant(
      new SystemContext(cloud.pool),
      { name: 'Pilot', currency: 'PKR', ownerEmail: email, ownerName: 'Ada', password: 'password-1', pin: '1234' },
      { clock: cloud.clock, ids },
    );
    // A tenant seeded before 04: once u9 seeds the B-1 defaults, remove them again (approver rows cascade).
    await cloud.pool.query(
      `DELETE FROM role_permissions rp USING roles r
        WHERE r.tenant_id = rp.tenant_id AND r.role_id = rp.role_id AND rp.tenant_id = $1
          AND r.default_key IN ('cashier', 'order_taker') AND rp.permission = ANY($2)`,
      [tenant_id, VOID_PERMS],
    );
    return tenant_id;
  }

  async function roleId(tenantId: string, key: string): Promise<string> {
    const { rows } = await cloud.pool.query<{ role_id: string }>(
      `SELECT role_id FROM roles WHERE tenant_id = $1 AND default_key = $2`,
      [tenantId, key],
    );
    return rows[0]!.role_id;
  }

  async function archive(tenantId: string, key: string): Promise<void> {
    await cloud.pool.query(`UPDATE roles SET archived_at = 1 WHERE tenant_id = $1 AND default_key = $2`, [tenantId, key]);
  }

  /** Void grants as `<grantee key or role_id>:<permission>:<grant_type>:<scope>:<approver key>`, sorted. Owner and
   *  Manager are left out unless asked: the seed already grants them both permissions, and B-1 leaves them unchanged. */
  async function grants(tenantId: string, withOwnerManager = false): Promise<string[]> {
    const { rows } = await cloud.pool.query<{ line: string }>(
      `SELECT concat_ws(':', coalesce(r.default_key, r.role_id), rp.permission, rp.grant_type, rp.scope,
                        coalesce(a.default_key, '-')) AS line
         FROM role_permissions rp
         JOIN roles r ON r.tenant_id = rp.tenant_id AND r.role_id = rp.role_id
         LEFT JOIN roles a ON a.tenant_id = rp.tenant_id AND a.role_id = rp.approver_role_id
        WHERE rp.tenant_id = $1 AND rp.permission = ANY($2)
          AND ($3 OR r.default_key IS NULL OR r.default_key NOT IN ('owner', 'manager'))
        ORDER BY 1`,
      [tenantId, VOID_PERMS, withOwnerManager],
    );
    return rows.map((row) => row.line);
  }

  /** Approver rows of the void grants as `<grantee>:<permission>:<approver key>`, sorted. */
  async function approvers(tenantId: string): Promise<string[]> {
    const { rows } = await cloud.pool.query<{ line: string }>(
      `SELECT concat_ws(':', coalesce(r.default_key, r.role_id), x.permission, coalesce(a.default_key, a.role_id)) AS line
         FROM role_permission_approvers x
         JOIN roles r ON r.tenant_id = x.tenant_id AND r.role_id = x.role_id
         JOIN roles a ON a.tenant_id = x.tenant_id AND a.role_id = x.approver_role_id
        WHERE x.tenant_id = $1 AND x.permission = ANY($2)
        ORDER BY 1`,
      [tenantId, VOID_PERMS],
    );
    return rows.map((row) => row.line);
  }

  async function directoryVersion(tenantId: string): Promise<number> {
    const { rows } = await cloud.pool.query<{ directory_version: string }>(
      `SELECT directory_version FROM tenants WHERE tenant_id = $1`,
      [tenantId],
    );
    return Number(rows[0]!.directory_version);
  }

  async function grant(tenantId: string, roleKey: string, permission: string, approverKeys: string[]): Promise<void> {
    const role = await roleId(tenantId, roleKey);
    const approverIds = await Promise.all(approverKeys.map((key) => roleId(tenantId, key)));
    await cloud.pool.query(
      `INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, approver_role_id, scope)
       VALUES ($1, $2, $3, $4, $5, 'branch')`,
      [tenantId, role, permission, approverIds.length > 0 ? 'requires_approval' : 'allowed', approverIds[0] ?? null],
    );
    for (const approver of approverIds) {
      await cloud.pool.query(
        `INSERT INTO role_permission_approvers (tenant_id, role_id, permission, approver_role_id) VALUES ($1, $2, $3, $4)`,
        [tenantId, role, permission, approver],
      );
    }
  }

  const DEFAULTS = [
    'cashier:move-item-to-stock:allowed:branch:-',
    'cashier:void-item:requires_approval:branch:manager',
    'order_taker:move-item-to-stock:allowed:branch:-',
    'order_taker:void-item:requires_approval:branch:manager',
  ];
  const DEFAULT_APPROVERS = ['cashier:void-item:manager', 'order_taker:void-item:manager'];

  it('[01b #109] [04 #32] inserts the B-1 defaults with Manager approver rows, bumps directory_version once, and a second run changes nothing', async () => {
    const tenant = await seeded('old@example.com');
    const before = await directoryVersion(tenant);
    const ownerManager = (await grants(tenant, true)).filter((line) => /^(owner|manager):/.test(line));
    expect(ownerManager).toEqual([
      'manager:move-item-to-stock:allowed:branch:-',
      'manager:void-item:allowed:branch:-',
      'owner:move-item-to-stock:allowed:branch:-',
      'owner:void-item:allowed:branch:-',
    ]);
    const others = await cloud.pool.query(`SELECT count(*)::int AS n FROM role_permissions WHERE tenant_id = $1`, [tenant]);

    await cloud.pool.query(sql);
    expect(await grants(tenant)).toEqual(DEFAULTS);
    expect(await approvers(tenant)).toEqual(DEFAULT_APPROVERS);
    expect(await directoryVersion(tenant)).toBe(before + 1);
    expect((await grants(tenant, true)).filter((line) => /^(owner|manager):/.test(line))).toEqual(ownerManager);
    const after = await cloud.pool.query(`SELECT count(*)::int AS n FROM role_permissions WHERE tenant_id = $1`, [tenant]);
    expect(after.rows[0].n).toBe(others.rows[0].n + 4);

    await cloud.pool.query(sql);
    expect(await grants(tenant)).toEqual(DEFAULTS);
    expect(await approvers(tenant)).toEqual(DEFAULT_APPROVERS);
    expect(await directoryVersion(tenant)).toBe(before + 1);
  });

  it('[01b #109] [G-20] an archived cashier role gets nothing; order_taker still gets its defaults', async () => {
    const tenant = await seeded('archived-cashier@example.com');
    await archive(tenant, 'cashier');
    const before = await directoryVersion(tenant);

    await cloud.pool.query(sql);
    expect(await grants(tenant)).toEqual(DEFAULTS.filter((line) => line.startsWith('order_taker:')));
    expect(await approvers(tenant)).toEqual(['order_taker:void-item:manager']);
    expect(await directoryVersion(tenant)).toBe(before + 1);
  });

  it('[01b #109] [01b §5.1a] [G-20] with the manager role archived no void-item row is written (move-item-to-stock allowed still is)', async () => {
    const tenant = await seeded('archived-manager@example.com');
    await archive(tenant, 'manager');
    const before = await directoryVersion(tenant);

    await cloud.pool.query(sql);
    expect(await grants(tenant)).toEqual([
      'cashier:move-item-to-stock:allowed:branch:-',
      'order_taker:move-item-to-stock:allowed:branch:-',
    ]);
    expect(await approvers(tenant)).toEqual([]);
    expect(await directoryVersion(tenant)).toBe(before + 1);
  });

  it('[01b #109] [04 #32] [B-2] an existing move-item-to-stock requires_approval grant becomes allowed with approver_role_id NULL and no approver rows (any role, archived too); one bump', async () => {
    const tenant = await seeded('stray@example.com');
    await grant(tenant, 'cashier', 'move-item-to-stock', ['manager', 'owner']);
    await grant(tenant, 'waiter', 'move-item-to-stock', ['manager']);
    await archive(tenant, 'waiter');
    const before = await directoryVersion(tenant);

    await cloud.pool.query(sql);
    expect(await grants(tenant)).toEqual([...DEFAULTS, 'waiter:move-item-to-stock:allowed:branch:-'].sort());
    expect(await approvers(tenant)).toEqual(DEFAULT_APPROVERS);
    const stray = await cloud.pool.query(
      `SELECT count(*)::int AS n FROM role_permissions
        WHERE tenant_id = $1 AND permission = 'move-item-to-stock' AND (grant_type <> 'allowed' OR approver_role_id IS NOT NULL)`,
      [tenant],
    );
    expect(stray.rows[0].n).toBe(0);
    expect(await directoryVersion(tenant)).toBe(before + 1);

    await cloud.pool.query(sql);
    expect(await directoryVersion(tenant)).toBe(before + 1);
  });

  it('[01b §5.1a] a grant the owner already set is kept (ON CONFLICT DO NOTHING) and gets no approver row; a tenant where nothing changes is not bumped', async () => {
    const changed = await seeded('kept@example.com');
    await grant(changed, 'cashier', 'void-item', []);
    // A tenant that already holds all four B-1 rows: the first run changes nothing on it and does not bump it.
    const done = await seeded('done@example.com');
    await grant(done, 'cashier', 'void-item', ['manager']);
    await grant(done, 'cashier', 'move-item-to-stock', []);
    await grant(done, 'order_taker', 'void-item', ['manager']);
    await grant(done, 'order_taker', 'move-item-to-stock', []);
    const doneVersion = await directoryVersion(done);
    const doneApprovers = await approvers(done);
    expect(doneApprovers).toEqual(DEFAULT_APPROVERS);
    await cloud.pool.query(sql);
    expect(await directoryVersion(done)).toBe(doneVersion);
    expect(await approvers(done)).toEqual(doneApprovers);
    expect(await grants(done)).toEqual(DEFAULTS);
    const changedVersion = await directoryVersion(changed);

    expect(await grants(changed)).toEqual(
      DEFAULTS.map((line) => (line === 'cashier:void-item:requires_approval:branch:manager' ? 'cashier:void-item:allowed:branch:-' : line)),
    );
    expect(await approvers(changed)).toEqual(['order_taker:void-item:manager']);

    await cloud.pool.query(sql);
    expect(await directoryVersion(done)).toBe(doneVersion);
    expect(await directoryVersion(changed)).toBe(changedVersion);
  });

  it('[04 §4.5 B-1] the migrator has applied 0013', async () => {
    const { rows } = await cloud.pool.query<{ name: string }>(`SELECT name FROM schema_migrations ORDER BY version`);
    expect(rows.map((row) => row.name)).toContain('0013_void_defaults_backfill.sql');
  });
});
