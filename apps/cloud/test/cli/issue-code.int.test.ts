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
import { truncateAll } from '../helpers/test-cloud';

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
});
