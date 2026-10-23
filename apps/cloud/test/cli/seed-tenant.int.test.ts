import { verify } from '@node-rs/argon2';
import { PERMISSIONS } from '@pos/domain';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemContext } from '../../src/cli/system-context';
import { seedTenant } from '../../src/cli/seed-tenant';
import { createPool, migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { testIdGen } from '../../src/lib/ids';
import { truncateAll } from '../helpers/test-cloud';

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://pos:pos@127.0.0.1:5433/pos_test';
const T = 1_761_000_000_000;

describe('seed-tenant', () => {
  const pool = createPool(databaseUrl);

  beforeAll(async () => {
    await migrate(pool, migrationsDir, fixedClock(T));
    await truncateAll(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('[00 §10 #56] seed creates the roles; password and PIN hashes verify; the owner staff holds access-hub-admin and manage-devices; duplicate email refused', async () => {
    const created = await seedTenant(
      new SystemContext(pool),
      {
        name: 'Pilot',
        currency: 'PKR',
        ownerEmail: 'Owner@Example.com',
        ownerName: 'Ada',
        password: 'password-1',
        pin: '1234',
      },
      { clock: fixedClock(T), ids: testIdGen() },
    );

    expect(created).toEqual({
      tenant_id: expect.any(String),
      user_id: expect.any(String),
      staff_id: expect.any(String),
    });

    const roles = await pool.query<{ name: string; session_idle_ttl_ms: number }>(
      `SELECT name, session_idle_ttl_ms FROM roles WHERE tenant_id = $1 ORDER BY name`,
      [created.tenant_id],
    );
    expect(roles.rows).toEqual([
      { name: 'Cashier', session_idle_ttl_ms: 1_800_000 },
      { name: 'Manager', session_idle_ttl_ms: 3_600_000 },
      { name: 'Order taker', session_idle_ttl_ms: 300_000 },
      { name: 'Owner', session_idle_ttl_ms: 3_600_000 },
    ]);

    const grants = await pool.query<{
      role: string;
      permission: string | null;
      grant_type: string | null;
      approver: string | null;
    }>(
      `SELECT r.name AS role, rp.permission, rp.grant_type, approver.name AS approver
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.tenant_id = r.tenant_id AND rp.role_id = r.role_id
         LEFT JOIN roles approver ON approver.tenant_id = rp.tenant_id AND approver.role_id = rp.approver_role_id
        WHERE r.tenant_id = $1`,
      [created.tenant_id],
    );
    const byRole = new Map<string, Array<{ permission: string; grant_type: string; approver: string | null }>>();
    for (const row of grants.rows) {
      const list = byRole.get(row.role) ?? [];
      if (row.permission !== null && row.grant_type !== null) {
        list.push({ permission: row.permission, grant_type: row.grant_type, approver: row.approver });
      }
      byRole.set(row.role, list);
    }
    const ownerGrants = byRole.get('Owner') ?? [];
    expect(ownerGrants.map((grant) => grant.permission).sort()).toEqual([...PERMISSIONS].sort());
    expect(ownerGrants.every((grant) => grant.grant_type === 'allowed' && grant.approver === null)).toBe(true);
    expect(ownerGrants.some((grant) => grant.permission === 'access-hub-admin')).toBe(true);
    expect(ownerGrants.some((grant) => grant.permission === 'manage-devices')).toBe(true);
    const managerGrants = byRole.get('Manager') ?? [];
    expect(managerGrants.map((grant) => grant.permission).sort()).toEqual(
      PERMISSIONS.filter((permission) => permission !== 'manage-roles').sort(),
    );
    expect(managerGrants.every((grant) => grant.grant_type === 'allowed')).toBe(true);
    expect((byRole.get('Cashier') ?? []).slice().sort((a, b) => a.permission.localeCompare(b.permission))).toEqual([
      { permission: 'apply-discount', grant_type: 'requires_approval', approver: 'Manager' },
      { permission: 'reprint-ticket', grant_type: 'allowed', approver: null },
    ]);
    expect(byRole.get('Order taker')).toEqual([]);

    const owner = await pool.query<{ password_hash: string; allowed_branch_ids: string[] }>(
      `SELECT password_hash, allowed_branch_ids FROM owner_users WHERE tenant_id = $1 AND user_id = $2`,
      [created.tenant_id, created.user_id],
    );
    expect(await verify(owner.rows[0]!.password_hash, 'password-1')).toBe(true);
    expect(await verify(owner.rows[0]!.password_hash, 'password-2')).toBe(false);
    expect(owner.rows[0]!.allowed_branch_ids).toEqual([]);

    const staff = await pool.query<{ pin_hash: string; display_name: string }>(
      `SELECT s.pin_hash, s.display_name
         FROM staff s
         JOIN staff_roles sr ON sr.tenant_id = s.tenant_id AND sr.staff_id = s.staff_id
         JOIN roles r ON r.tenant_id = sr.tenant_id AND r.role_id = sr.role_id
        WHERE s.tenant_id = $1 AND s.staff_id = $2 AND r.name = 'Owner'`,
      [created.tenant_id, created.staff_id],
    );
    expect(staff.rows).toHaveLength(1);
    expect(staff.rows[0]!.display_name).toBe('Ada');
    expect(await verify(staff.rows[0]!.pin_hash, '1234')).toBe(true);
    expect(await verify(staff.rows[0]!.pin_hash, '123')).toBe(false);

    await expect(
      seedTenant(
        new SystemContext(pool),
        {
          name: 'Other',
          currency: 'PKR',
          ownerEmail: 'owner@example.com',
          ownerName: 'Bea',
          password: 'password-1',
          pin: '1234',
        },
        { clock: fixedClock(T), ids: testIdGen() },
      ),
    ).rejects.toThrow(/email/);
  });
});
