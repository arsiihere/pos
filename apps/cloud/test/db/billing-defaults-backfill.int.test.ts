import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedTenant } from '../../src/cli/seed-tenant';
import { SystemContext } from '../../src/cli/system-context';
import { fixedClock } from '../../src/lib/clock';
import { testIdGen } from '../../src/lib/ids';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 05 §4.5 B-2 / 01b v1.10 §5.1b, §6.15 (gaps G-13 / R-6, G-27), plan P0.8, test #90 (backfill half): cloud migration
// 0015 gives tenants seeded before 05 the default grants of the new `bills` permissions. A scratch database of its own,
// so 0015 is never applied to the shared test database by this file. `seeded` removes the B-2 grants again, which is
// the state of a tenant seeded before 05 (apply-discount stays on Cashier: it exists before 05, G-27).

const backfill = fileURLToPath(new URL('../../src/db/migrations/0015_billing_defaults_backfill.sql', import.meta.url));
const NEW_BILLS = [
  'take-payment', 'manage-own-shift', 'close-shift-for-others', 'skip-blind-count', 'record-petty-cash', 'remove-service-charge',
  'close-business-day', 'open-cash-drawer', 'remove-comp', 'close-without-buyer-id', 'manage-fiscal-settings',
];
const PERMS = [...NEW_BILLS, 'apply-discount', 'reopen-bill'];

const OWNER = NEW_BILLS.map((p) => `owner:${p}:allowed:branch:-`);
const MANAGER = NEW_BILLS.filter((p) => p !== 'skip-blind-count' && p !== 'manage-fiscal-settings').map((p) => `manager:${p}:allowed:branch:-`);
const CASHIER = [
  'cashier:take-payment:allowed:branch:-',
  'cashier:manage-own-shift:allowed:branch:-',
  'cashier:open-cash-drawer:allowed:branch:-',
  'cashier:record-petty-cash:allowed:branch:-',
  'cashier:remove-service-charge:requires_approval:branch:manager',
  'cashier:reopen-bill:requires_approval:branch:manager',
  'cashier:remove-comp:requires_approval:branch:manager',
  'cashier:close-without-buyer-id:requires_approval:branch:manager',
];
const ORDER_TAKER = ['order_taker:take-payment:allowed:own_tables:-', 'order_taker:manage-own-shift:allowed:branch:-'];
// Owner and Manager already held reopen-bill and apply-discount before 05; Cashier's apply-discount likewise.
const PRE_05 = [
  'owner:reopen-bill:allowed:branch:-',
  'owner:apply-discount:allowed:branch:-',
  'manager:reopen-bill:allowed:branch:-',
  'manager:apply-discount:allowed:branch:-',
  'cashier:apply-discount:requires_approval:branch:manager',
];
const TABLE = [...OWNER, ...MANAGER, ...CASHIER, ...ORDER_TAKER, ...PRE_05].sort();
const APPROVERS = [
  'cashier:apply-discount:manager',
  'cashier:close-without-buyer-id:manager',
  'cashier:remove-comp:manager',
  'cashier:remove-service-charge:manager',
  'cashier:reopen-bill:manager',
];

describe('[05 #90] [B-2] cloud migration 0015_billing_defaults_backfill.sql', () => {
  const ids = testIdGen();
  let pool: pg.Pool;
  let sql: string;
  let n = 0;

  beforeAll(async () => {
    ({ pool } = await scratchDatabaseAt(15));
    sql = readFileSync(backfill, 'utf8');
  });
  afterAll(async () => {
    await dropScratchDatabases();
  });

  async function seed(email: string): Promise<string> {
    n += 1;
    const { tenant_id } = await seedTenant(
      new SystemContext(pool),
      { name: `Pilot ${n}`, currency: 'PKR', ownerEmail: email, ownerName: 'Ada', password: 'password-1', pin: '1234' },
      { clock: fixedClock(1_761_000_000_000), ids },
    );
    return tenant_id;
  }

  async function seeded(email: string): Promise<string> {
    const tenant = await seed(email);
    await pool.query(
      `DELETE FROM role_permissions rp USING roles r
        WHERE r.tenant_id = rp.tenant_id AND r.role_id = rp.role_id AND rp.tenant_id = $1 AND (
              rp.permission = ANY($2) AND rp.permission NOT IN ('apply-discount', 'reopen-bill')
           OR (r.default_key = 'cashier' AND rp.permission = 'reopen-bill'))`,
      [tenant, PERMS],
    );
    return tenant;
  }

  async function roleId(tenantId: string, key: string): Promise<string> {
    const { rows } = await pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1 AND default_key = $2`, [tenantId, key]);
    return rows[0]!.role_id;
  }

  async function archive(tenantId: string, key: string): Promise<void> {
    await pool.query(`UPDATE roles SET archived_at = 1 WHERE tenant_id = $1 AND default_key = $2`, [tenantId, key]);
  }

  /** Grants of the B-2 permissions as `<key>:<permission>:<grant_type>:<scope>:<approver key>`, sorted. */
  async function grants(tenantId: string): Promise<string[]> {
    const { rows } = await pool.query<{ line: string }>(
      `SELECT concat_ws(':', coalesce(r.default_key, r.role_id), rp.permission, rp.grant_type, rp.scope, coalesce(a.default_key, '-')) AS line
         FROM role_permissions rp
         JOIN roles r ON r.tenant_id = rp.tenant_id AND r.role_id = rp.role_id
         LEFT JOIN roles a ON a.tenant_id = rp.tenant_id AND a.role_id = rp.approver_role_id
        WHERE rp.tenant_id = $1 AND rp.permission = ANY($2) ORDER BY 1`,
      [tenantId, PERMS],
    );
    return rows.map((row) => row.line).sort();
  }

  async function approvers(tenantId: string): Promise<string[]> {
    const { rows } = await pool.query<{ line: string }>(
      `SELECT concat_ws(':', r.default_key, x.permission, a.default_key) AS line
         FROM role_permission_approvers x
         JOIN roles r ON r.tenant_id = x.tenant_id AND r.role_id = x.role_id
         JOIN roles a ON a.tenant_id = x.tenant_id AND a.role_id = x.approver_role_id
        WHERE x.tenant_id = $1 AND x.permission = ANY($2) ORDER BY 1`,
      [tenantId, PERMS],
    );
    return rows.map((row) => row.line).sort();
  }

  async function snapshot(tenantId: string): Promise<string> {
    const { rows } = await pool.query<{ s: string }>(
      `SELECT coalesce(string_agg(concat_ws('|', role_id, permission, grant_type, approver_role_id, scope), ';' ORDER BY role_id, permission), '') AS s
         FROM role_permissions WHERE tenant_id = $1`,
      [tenantId],
    );
    const ap = await pool.query<{ s: string }>(
      `SELECT coalesce(string_agg(concat_ws('|', role_id, permission, approver_role_id), ';' ORDER BY role_id, permission, approver_role_id), '') AS s
         FROM role_permission_approvers WHERE tenant_id = $1`,
      [tenantId],
    );
    return `${rows[0]!.s}#${ap.rows[0]!.s}`;
  }

  async function directoryVersion(tenantId: string): Promise<number> {
    const { rows } = await pool.query<{ directory_version: string }>(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [tenantId]);
    return Number(rows[0]!.directory_version);
  }

  it('[05 #90] seed-tenant writes exactly the B-2 table (the new-tenant half agrees with the backfill)', async () => {
    const tenant = await seed('fresh@example.com');
    expect(await grants(tenant)).toEqual(TABLE);
    expect(await approvers(tenant)).toEqual(APPROVERS);
  });

  it('[05 #90] writes the B-2 table by default_key with Manager approver rows, bumps directory_version by 1, and a second run changes nothing', async () => {
    const tenant = await seeded('old@example.com');
    expect(await grants(tenant)).toEqual([...PRE_05].sort());
    expect(await approvers(tenant)).toEqual(['cashier:apply-discount:manager']);
    const before = await directoryVersion(tenant);

    await pool.query(sql);
    expect(await grants(tenant)).toEqual(TABLE);
    expect(await approvers(tenant)).toEqual(APPROVERS);
    expect(await directoryVersion(tenant)).toBe(before + 1);
    // Manager holds neither Owner-only permission (H6-13); Waiter and Cook get nothing
    const manager = await pool.query(
      `SELECT count(*)::int AS n FROM role_permissions rp JOIN roles r USING (tenant_id, role_id)
        WHERE rp.tenant_id = $1 AND r.default_key = 'manager' AND rp.permission IN ('skip-blind-count', 'manage-fiscal-settings')`,
      [tenant],
    );
    expect(manager.rows[0].n).toBe(0);
    const none = await pool.query(
      `SELECT count(*)::int AS n FROM role_permissions rp JOIN roles r USING (tenant_id, role_id)
        WHERE rp.tenant_id = $1 AND r.default_key IN ('waiter', 'cook') AND rp.permission = ANY($2)`,
      [tenant, PERMS],
    );
    expect(none.rows[0].n).toBe(0);

    // G-27: idempotent, every row and every approver row identical, no second bump
    const state = await snapshot(tenant);
    await pool.query(sql);
    expect(await snapshot(tenant)).toBe(state);
    expect(await directoryVersion(tenant)).toBe(before + 1);
  });

  it('[05 #90] [G-27] Cashier apply-discount exists: it is kept untouched and gets no second approver row', async () => {
    const tenant = await seeded('discount@example.com');
    const row = () =>
      pool.query(
        `SELECT rp.grant_type, rp.approver_role_id, rp.scope,
                (SELECT count(*)::int FROM role_permission_approvers x WHERE x.tenant_id = rp.tenant_id AND x.role_id = rp.role_id AND x.permission = rp.permission) AS approvers
           FROM role_permissions rp JOIN roles r USING (tenant_id, role_id)
          WHERE rp.tenant_id = $1 AND r.default_key = 'cashier' AND rp.permission = 'apply-discount'`,
        [tenant],
      );
    const before = (await row()).rows;
    await pool.query(sql);
    expect((await row()).rows).toEqual(before);
    expect(before[0].approvers).toBe(1);
  });

  it('[05 #90] a grant the owner already set is kept (cashier remove-comp allowed), without an approver row', async () => {
    const tenant = await seeded('kept@example.com');
    const cashier = await roleId(tenant, 'cashier');
    await pool.query(
      `INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, scope) VALUES ($1, $2, 'remove-comp', 'allowed', 'branch')`,
      [tenant, cashier],
    );
    await pool.query(sql);
    expect(await grants(tenant)).toEqual(
      TABLE.map((line) => (line === 'cashier:remove-comp:requires_approval:branch:manager' ? 'cashier:remove-comp:allowed:branch:-' : line)).sort(),
    );
    expect(await approvers(tenant)).toEqual(APPROVERS.filter((line) => line !== 'cashier:remove-comp:manager'));
  });

  it('[05 #90] an archived cashier role gets nothing; the other roles still get their defaults', async () => {
    const tenant = await seeded('archived-cashier@example.com');
    await archive(tenant, 'cashier');
    const before = await directoryVersion(tenant);
    await pool.query(sql);
    const expected = [...OWNER, ...MANAGER, ...ORDER_TAKER, ...PRE_05].sort();
    expect(await grants(tenant)).toEqual(expected);
    expect(await approvers(tenant)).toEqual(['cashier:apply-discount:manager']);
    expect(await directoryVersion(tenant)).toBe(before + 1);
  });

  it('[05 #90] [G-20 pattern] with the manager role archived no requires_approval row is written; allowed rows still are', async () => {
    const tenant = await seeded('archived-manager@example.com');
    await archive(tenant, 'manager');
    const before = await directoryVersion(tenant);
    await pool.query(sql);
    const expected = [
      ...OWNER,
      ...CASHIER.filter((line) => line.includes(':allowed:')),
      ...ORDER_TAKER,
      'owner:reopen-bill:allowed:branch:-',
      'owner:apply-discount:allowed:branch:-',
      'manager:reopen-bill:allowed:branch:-',
      'manager:apply-discount:allowed:branch:-',
      'cashier:apply-discount:requires_approval:branch:manager',
    ].sort();
    expect(await grants(tenant)).toEqual(expected);
    expect(await approvers(tenant)).toEqual(['cashier:apply-discount:manager']);
    expect(await directoryVersion(tenant)).toBe(before + 1);
  });

  it('[05 #90] a tenant that already holds the whole table is not changed and not bumped', async () => {
    const tenant = await seed('done@example.com');
    const before = await directoryVersion(tenant);
    const state = await snapshot(tenant);
    await pool.query(sql);
    expect(await snapshot(tenant)).toBe(state);
    expect(await directoryVersion(tenant)).toBe(before);
  });

  it('[05 §4.5 B-2] the migrator has applied 0015 after 0014', async () => {
    const { rows } = await pool.query<{ name: string }>(`SELECT name FROM schema_migrations ORDER BY version`);
    const names = rows.map((row) => row.name);
    expect(names.indexOf('0015_billing_defaults_backfill.sql')).toBe(names.indexOf('0014_billing_settings.sql') + 1);
  });
});
