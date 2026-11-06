/// <reference types="node" />
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normaliseCode } from '../../src/cli/codes';
import { issueRegistrationCode } from '../../src/cli/issue-registration-code';
import { seedTenant } from '../../src/cli/seed-tenant';
import { SystemContext } from '../../src/cli/system-context';
import { createPool, migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { testIdGen } from '../../src/lib/ids';
import { testSecrets } from '../../src/lib/secrets';
import { legacyToken } from '../helpers/legacy-token';
import { createTestCloud, truncateAll } from '../helpers/test-cloud';

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://pos:pos@127.0.0.1:5433/pos_test';
const T = 1_761_000_000_000;
const CODE_TTL_MS = 86_400_000;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('issue-registration-code', () => {
  const pool = createPool(databaseUrl);

  beforeAll(async () => {
    await migrate(pool, migrationsDir, fixedClock(T));
    await truncateAll(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("[00 §6.27] normaliseCode('abcd-efgh jkmn') === 'ABCDEFGHJKMN'", () => {
    expect(normaliseCode('abcd-efgh jkmn')).toBe('ABCDEFGHJKMN');
  });

  it('[01a CL-3] a new branch gets its Pass point and engine settings in the same transaction; a reissue adds none', async () => {
    await truncateAll(pool);
    const sys = new SystemContext(pool);
    const deps = { clock: fixedClock(T), ids: testIdGen(), secrets: testSecrets() };
    const seeded = await seedTenant(
      sys,
      { name: 'Pilot', currency: 'PKR', ownerEmail: 'cl3@example.com', ownerName: 'Ada', password: 'password-1', pin: '1234' },
      deps,
    );
    const issued = await issueRegistrationCode(sys, { tenantId: seeded.tenant_id, branchName: 'Gulberg' }, deps);
    const points = () =>
      pool.query(`SELECT name, sort_order, archived_at, created_at::bigint AS at FROM points WHERE tenant_id = $1 AND branch_id = $2`, [
        seeded.tenant_id,
        issued.branch_id,
      ]);
    const settings = () =>
      pool.query<{ slip_threshold_ms: number; created_at: string }>(
        `SELECT slip_threshold_ms, created_at FROM branch_engine_settings WHERE tenant_id = $1 AND branch_id = $2`,
        [seeded.tenant_id, issued.branch_id],
      );
    expect((await points()).rows).toEqual([{ name: 'Pass', sort_order: 0, archived_at: null, at: String(T) }]);
    expect((await settings()).rows).toEqual([{ slip_threshold_ms: 120_000, created_at: String(T) }]);

    await issueRegistrationCode(sys, { tenantId: seeded.tenant_id, branchId: issued.branch_id }, deps);
    expect((await points()).rows).toHaveLength(1);
    expect((await settings()).rows).toHaveLength(1);

    // A branch whose name is taken rolls everything back: no second point or settings row anywhere.
    await expect(issueRegistrationCode(sys, { tenantId: seeded.tenant_id, branchName: 'Gulberg' }, deps)).rejects.toThrow('already used');
    const all = await pool.query(`SELECT 1 FROM points WHERE tenant_id = $1 UNION ALL SELECT 1 FROM branch_engine_settings WHERE tenant_id = $1`, [
      seeded.tenant_id,
    ]);
    expect(all.rows).toHaveLength(2);
    await truncateAll(pool);
  });

  it('[00 §10 #57] new branch: Owner and Manager assigned; owners\' allowed_branch_ids include it; reissue for an unconfirmed branch expires the old code; reissue after confirm refused', async () => {
    const sys = new SystemContext(pool);
    const clock = fixedClock(T);
    const deps = { clock, ids: testIdGen(), secrets: testSecrets() };
    const seeded = await seedTenant(
      sys,
      {
        name: 'Pilot',
        currency: 'PKR',
        ownerEmail: 'owner@example.com',
        ownerName: 'Ada',
        password: 'password-1',
        pin: '1234',
      },
      deps,
    );
    const roles = await pool.query<{ role_id: string; name: string }>(
      `SELECT role_id, name FROM roles WHERE tenant_id = $1 AND name IN ('Manager', 'Cashier')`,
      [seeded.tenant_id],
    );
    const roleId = (name: string) => {
      const row = roles.rows.find((role) => role.name === name);
      if (row === undefined) throw new Error(`missing ${name}`);
      return row.role_id;
    };
    await pool.query(
      `INSERT INTO staff (tenant_id, staff_id, display_name, pin_hash, created_at, updated_at) VALUES
         ($1, 'mgr-1', 'Mo', 'hash', $2, $2),
         ($1, 'cash-1', 'Cy', 'hash', $2, $2)`,
      [seeded.tenant_id, T],
    );
    await pool.query(
      `INSERT INTO staff_roles (tenant_id, staff_id, role_id) VALUES ($1, 'mgr-1', $2), ($1, 'cash-1', $3)`,
      [seeded.tenant_id, roleId('Manager'), roleId('Cashier')],
    );
    await pool.query(
      `INSERT INTO owner_users (tenant_id, user_id, email, display_name, password_hash, allowed_branch_ids, created_at)
       VALUES ($1, 'owner-2', 'bea@example.com', 'Bea', 'hash', ARRAY[]::text[], $2)`,
      [seeded.tenant_id, T],
    );

    const issued = await issueRegistrationCode(sys, { tenantId: seeded.tenant_id, branchName: 'Gulberg' }, deps);
    expect(issued.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(issued.expires_at).toBe(T + CODE_TTL_MS);

    const branch = await pool.query<{ status: string; hub_confirmed_at: string | null; name: string }>(
      `SELECT status, hub_confirmed_at, name FROM branches WHERE tenant_id = $1 AND branch_id = $2`,
      [seeded.tenant_id, issued.branch_id],
    );
    expect(branch.rows).toEqual([{ status: 'pending_hub', hub_confirmed_at: null, name: 'Gulberg' }]);

    const assigned = await pool.query<{ staff_id: string }>(
      `SELECT staff_id FROM staff_branches WHERE tenant_id = $1 AND branch_id = $2 ORDER BY staff_id`,
      [seeded.tenant_id, issued.branch_id],
    );
    expect(assigned.rows.map((row) => row.staff_id)).toEqual(['mgr-1', seeded.staff_id].sort());

    const owners = await pool.query<{ user_id: string; allowed_branch_ids: string[] }>(
      `SELECT user_id, allowed_branch_ids FROM owner_users WHERE tenant_id = $1 ORDER BY user_id`,
      [seeded.tenant_id],
    );
    expect(owners.rows).toHaveLength(2);
    for (const owner of owners.rows) expect(owner.allowed_branch_ids).toContain(issued.branch_id);

    const stored = await pool.query<{ code_hash: string; kind: string; expires_at: string; consumed_at: string | null }>(
      `SELECT code_hash, kind, expires_at, consumed_at FROM registration_codes WHERE tenant_id = $1 AND branch_id = $2`,
      [seeded.tenant_id, issued.branch_id],
    );
    expect(stored.rows).toEqual([
      {
        code_hash: sha256(normaliseCode(issued.code)),
        kind: 'new_branch',
        expires_at: String(T + CODE_TTL_MS),
        consumed_at: null,
      },
    ]);

    const reissued = await issueRegistrationCode(
      sys,
      { tenantId: seeded.tenant_id, branchId: issued.branch_id },
      deps,
    );
    expect(reissued.code).not.toBe(issued.code);
    expect(reissued.branch_id).toBe(issued.branch_id);
    expect(reissued.expires_at).toBe(T + CODE_TTL_MS);
    const codes = await pool.query<{ code_hash: string; expires_at: string }>(
      `SELECT code_hash, expires_at FROM registration_codes WHERE tenant_id = $1 AND branch_id = $2 ORDER BY expires_at`,
      [seeded.tenant_id, issued.branch_id],
    );
    expect(codes.rows.map((row) => ({ ...row, expires_at: Number(row.expires_at) }))).toEqual([
      { code_hash: sha256(normaliseCode(issued.code)), expires_at: T },
      { code_hash: sha256(normaliseCode(reissued.code)), expires_at: T + CODE_TTL_MS },
    ]);

    const beforeRace = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM registration_codes WHERE tenant_id = $1 AND branch_id = $2`,
      [seeded.tenant_id, issued.branch_id],
    );
    const hold = await pool.connect();
    try {
      await hold.query('BEGIN');
      await hold.query(`SELECT branch_id FROM branches WHERE tenant_id = $1 AND branch_id = $2 FOR UPDATE`, [
        seeded.tenant_id,
        issued.branch_id,
      ]);
      let settled = false;
      const pending = issueRegistrationCode(
        sys,
        { tenantId: seeded.tenant_id, branchId: issued.branch_id },
        deps,
      ).finally(() => {
        settled = true;
      });
      const deadline = Date.now() + 2_000;
      let waiting = false;
      while (Date.now() < deadline) {
        if (settled) break;
        const locks = await pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
        );
        if (locks.rows[0]?.n !== '0') {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await hold.query(
        `UPDATE branches SET status = 'active', hub_confirmed_at = $3 WHERE tenant_id = $1 AND branch_id = $2`,
        [seeded.tenant_id, issued.branch_id, T],
      );
      await hold.query('COMMIT');
      await expect(pending).rejects.toThrow(/confirmed/);
      const afterRace = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM registration_codes WHERE tenant_id = $1 AND branch_id = $2`,
        [seeded.tenant_id, issued.branch_id],
      );
      expect(afterRace.rows[0]?.n).toBe(beforeRace.rows[0]?.n);
    } finally {
      await hold.query('ROLLBACK').catch(() => undefined);
      hold.release();
    }

    await pool.query(`UPDATE branches SET status = 'active', hub_confirmed_at = $2 WHERE tenant_id = $1 AND branch_id = $3`, [
      seeded.tenant_id,
      T,
      issued.branch_id,
    ]);
    await expect(
      issueRegistrationCode(sys, { tenantId: seeded.tenant_id, branchId: issued.branch_id }, deps),
    ).rejects.toThrow(/confirmed/);
    const afterRefuse = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM registration_codes WHERE tenant_id = $1 AND branch_id = $2`,
      [seeded.tenant_id, issued.branch_id],
    );
    expect(afterRefuse.rows[0]?.n).toBe('2');
  });

  // 01b §4.3 row 19, D-14: a tenant from the current seed, plus staff rows written directly.
  async function tenantWithStaff() {
    await truncateAll(pool);
    const sys = new SystemContext(pool);
    const deps = { clock: fixedClock(T), ids: testIdGen(), secrets: testSecrets() };
    const seeded = await seedTenant(
      sys,
      { name: 'Pilot', currency: 'PKR', ownerEmail: 'owner@example.com', ownerName: 'Ada', password: 'password-1', pin: '1234' },
      deps,
    );
    const tenant = seeded.tenant_id;
    // By name: seed-tenant sets default_key only from task 48.
    const named = await pool.query<{ role_id: string; name: string }>(`SELECT role_id, name FROM roles WHERE tenant_id = $1`, [
      tenant,
    ]);
    const role = (name: string) => named.rows.find((row) => row.name === name)!.role_id;
    const staff = async (
      staffId: string,
      name: string,
      roleId: string,
      o: { pin?: boolean; left?: boolean; denied?: string[] } = {},
    ) => {
      await pool.query(
        `INSERT INTO staff (tenant_id, staff_id, display_name, pin_hash, is_active, left_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [tenant, staffId, name, o.pin === false ? null : 'hash', o.left !== true, o.left === true ? T : null, T],
      );
      await pool.query(`INSERT INTO staff_roles (tenant_id, staff_id, role_id) VALUES ($1, $2, $3)`, [tenant, staffId, roleId]);
      for (const permission of o.denied ?? []) {
        await pool.query(`INSERT INTO staff_permission_denials (tenant_id, staff_id, permission) VALUES ($1, $2, $3)`, [
          tenant,
          staffId,
          permission,
        ]);
      }
    };
    const issue = (branchName: string) => issueRegistrationCode(sys, { tenantId: tenant, branchName }, deps);
    const directoryVersion = async () =>
      Number((await pool.query(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [tenant])).rows[0].directory_version);
    const assigned = async (branchId: string) =>
      (
        await pool.query<{ staff_id: string }>(
          `SELECT staff_id FROM staff_branches WHERE tenant_id = $1 AND branch_id = $2 ORDER BY staff_id`,
          [tenant, branchId],
        )
      ).rows.map((row) => row.staff_id);
    const counts = async () =>
      (
        await pool.query(
          `SELECT (SELECT count(*)::int FROM branches WHERE tenant_id = $1) AS branches,
                  (SELECT count(*)::int FROM registration_codes WHERE tenant_id = $1) AS codes,
                  (SELECT count(*)::int FROM staff_branches WHERE tenant_id = $1) AS links,
                  (SELECT directory_version FROM tenants WHERE tenant_id = $1) AS directory_version,
                  (SELECT array_agg(display_name ORDER BY staff_id) FROM staff WHERE tenant_id = $1) AS names`,
          [tenant],
        )
      ).rows[0];
    const reissue = (branchId: string) => issueRegistrationCode(sys, { tenantId: tenant, branchId }, deps);
    return { tenant, ownerUserId: seeded.user_id, owner: seeded.staff_id, role, staff, issue, reissue, directoryVersion, assigned, counts };
  }

  it('[01b #86] a new branch gets an active manager, not a leaver or one denied access-hub-admin or manage-devices; directory_version +1; waits on the tenant lock; a taken branch name (other case) → refused, nothing written', async () => {
    const t = await tenantWithStaff();
    await t.staff('m-active', 'Mo', t.role('Manager'));
    await t.staff('m-left', 'Lee', t.role('Manager'), { left: true });
    await t.staff('m-no-admin', 'Nadia', t.role('Manager'), { denied: ['access-hub-admin'] });
    await t.staff('m-no-devices', 'Dan', t.role('Manager'), { denied: ['manage-devices'] });
    const v0 = await t.directoryVersion();

    // A directory write holding the tenant lock makes the CLI wait (B11).
    const hold = await pool.connect();
    let issued: Awaited<ReturnType<typeof t.issue>>;
    try {
      await hold.query('BEGIN');
      await hold.query(`SELECT 1 FROM tenants WHERE tenant_id = $1 FOR NO KEY UPDATE`, [t.tenant]);
      let settled = false;
      const pending = t.issue('Gulberg').finally(() => {
        settled = true;
      });
      let waiting = false;
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline && !settled) {
        const locks = await pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
        );
        if (locks.rows[0]?.n !== '0') {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      expect(settled).toBe(false);
      await hold.query('COMMIT');
      issued = await pending;
    } finally {
      await hold.query('ROLLBACK').catch(() => undefined);
      hold.release();
    }

    expect(await t.assigned(issued.branch_id)).toEqual(['m-active', t.owner].sort());
    expect(await t.directoryVersion()).toBe(v0 + 1);

    const before = await t.counts();
    await expect(t.issue('gulberg')).rejects.toThrow(/branch name/);
    expect(await t.counts()).toEqual(before);
  });

  it('[01b §4.3 row 19, AD-4] reissue (--branch-id) waits on the tenant lock and bumps nothing: directory_version and the branch\'s staff unchanged', async () => {
    const t = await tenantWithStaff();
    await t.staff('m-active', 'Mo', t.role('Manager'));
    const issued = await t.issue('Gulberg');
    const v1 = await t.directoryVersion();
    const assignedBefore = await t.assigned(issued.branch_id);
    const reissue = () => t.reissue(issued.branch_id);

    const hold = await pool.connect();
    let reissued: Awaited<ReturnType<typeof reissue>>;
    try {
      await hold.query('BEGIN');
      await hold.query(`SELECT 1 FROM tenants WHERE tenant_id = $1 FOR NO KEY UPDATE`, [t.tenant]);
      let settled = false;
      const pending = reissue().finally(() => {
        settled = true;
      });
      let waiting = false;
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline && !settled) {
        const locks = await pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
        );
        if (locks.rows[0]?.n !== '0') {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      expect(settled).toBe(false);
      await hold.query('COMMIT');
      reissued = await pending;
    } finally {
      await hold.query('ROLLBACK').catch(() => undefined);
      hold.release();
    }

    expect(reissued.branch_id).toBe(issued.branch_id);
    expect(await t.directoryVersion()).toBe(v1);
    expect(await t.assigned(issued.branch_id)).toEqual(assignedBefore);
  });

  it('[01b #93] a new branch gets qualifying admins only: the owner and the first manager, not a stock counter, a manager denied manage-devices, one with no PIN or one who has left', async () => {
    const t = await tenantWithStaff();
    const counter = 'r-stock-counter';
    await pool.query(
      `INSERT INTO roles (tenant_id, role_id, name, session_idle_ttl_ms) VALUES ($1, $2, 'Stock counter', 300000)`,
      [t.tenant, counter],
    );
    await pool.query(
      `INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, approver_role_id)
       VALUES ($1, $2, 'access-hub-admin', 'allowed', NULL), ($1, $2, 'manage-stock', 'allowed', NULL)`,
      [t.tenant, counter],
    );
    await t.staff('a-manager', 'Mo', t.role('Manager'));
    await t.staff('b-counter', 'Sana', counter);
    await t.staff('c-no-devices', 'Dan', t.role('Manager'), { denied: ['manage-devices'] });
    await t.staff('d-no-pin', 'Pervez', t.role('Manager'), { pin: false });
    await t.staff('e-left', 'Lee', t.role('Manager'), { left: true });

    const issued = await t.issue('C');
    expect(await t.assigned(issued.branch_id)).toEqual(['a-manager', t.owner].sort());
    // The owner's view: GET /v1/admin/staff?branch_id=C lists the same people.
    const cloud = await createTestCloud();
    try {
      const allowed = (
        await pool.query<{ allowed_branch_ids: string[] }>(`SELECT allowed_branch_ids FROM owner_users WHERE tenant_id = $1`, [t.tenant])
      ).rows[0]!.allowed_branch_ids;
      const token = legacyToken(cloud, { sub: t.ownerUserId, tenant_id: t.tenant, allowed_branch_ids: allowed });
      const listed = await cloud.app.inject({
        method: 'GET',
        url: `/v1/admin/staff?branch_id=${issued.branch_id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().data.staff.map((row: { staff_id: string }) => row.staff_id).sort()).toEqual(['a-manager', t.owner].sort());
    } finally {
      await cloud.close();
    }
  });

  it('[01b #94] two qualifying admins named "Ali" and "ali " → refused, listing the name with both staff ids, nothing written; after a rename both are assigned; every duplicated name is listed', async () => {
    const t = await tenantWithStaff();
    await t.staff('ali-1', 'Ali', t.role('Manager'));
    await t.staff('ali-2', 'ali ', t.role('Manager'));
    const before = await t.counts();
    const refused = t.issue('C');
    await expect(refused).rejects.toThrow(/Ali/);
    await expect(refused).rejects.toThrow(/ali-1, ali-2/);
    expect(await t.counts()).toEqual(before);

    await pool.query(`UPDATE staff SET display_name = 'Ali R.' WHERE tenant_id = $1 AND staff_id = 'ali-2'`, [t.tenant]);
    const issued = await t.issue('C');
    expect(await t.assigned(issued.branch_id)).toEqual(['ali-1', 'ali-2', t.owner].sort());

    await t.staff('ali-3', 'ALI', t.role('Manager'));
    await t.staff('sara-1', 'Sara', t.role('Manager'));
    await t.staff('sara-2', ' sara', t.role('Manager'));
    const many = t.issue('D');
    await expect(many).rejects.toThrow(/Ali \(ali-1, ali-3\)/);
    await expect(many).rejects.toThrow(/sara \(sara-1, sara-2\)/i);
  });
});
