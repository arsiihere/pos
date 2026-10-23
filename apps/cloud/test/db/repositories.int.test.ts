import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  branchByApiKeyHash,
  ownerByEmail,
  refreshTokenByHash,
  registrationCodeByHash,
} from '../../src/db/credential-lookup';
import { createPool, migrate } from '../../src/db/migrate';
import { TenantLevelRepository } from '../../src/db/tenant-level-repository';
import { TenantScopedRepository, type TenantContext } from '../../src/db/tenant-scoped-repository';
import { fixedClock } from '../../src/lib/clock';
import { truncateAll } from '../helpers/test-cloud';

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://pos:pos@127.0.0.1:5433/pos_test';
const T = 1_761_000_000_000;

function context(tenantId: string, branchIds: readonly string[]): TenantContext {
  return Object.freeze({ tenantId, branchIds: Object.freeze([...branchIds]) });
}

describe('cloud repositories', () => {
  const pool = createPool(databaseUrl);

  beforeAll(async () => {
    await migrate(pool, migrationsDir, fixedClock(T));
    await truncateAll(pool);
    await pool.query(
      `INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES
        ('t1', 'A', 'PKR', $1), ('t2', 'B', 'PKR', $1)`,
      [T],
    );
    await pool.query(
      `INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES
        ('t1', 'b1', 'A1', 'pending_hub', $1), ('t2', 'b2', 'B1', 'pending_hub', $1)`,
      [T],
    );
    await pool.query(
      `INSERT INTO staff (tenant_id, staff_id, display_name, pin_hash, created_at, updated_at) VALUES
        ('t1', 's1', 'Ada', 'hash', $1, $1), ('t2', 's2', 'Bea', 'hash', $1, $1)`,
      [T],
    );
    await pool.query(
      `INSERT INTO owner_users (tenant_id, user_id, email, display_name, password_hash, allowed_branch_ids, created_at)
       VALUES ('t1', 'u1', 'owner.a@example.com', 'Ada', 'pw-a', ARRAY['b1'], $1),
              ('t2', 'u2', 'owner.b@example.com', 'Bea', 'pw-b', ARRAY['b2'], $1)`,
      [T],
    );
    await pool.query(
      `INSERT INTO owner_refresh_tokens (tenant_id, token_id, user_id, token_hash, created_at, expires_at)
       VALUES ('t1', 'rt1', 'u1', 'refresh-a', $1, $1), ('t2', 'rt2', 'u2', 'refresh-b', $1, $1)`,
      [T],
    );
    await pool.query(
      `INSERT INTO branch_api_keys (tenant_id, branch_id, key_id, key_hash, created_at)
       VALUES ('t1', 'b1', 'k1', 'key-a', $1), ('t2', 'b2', 'k2', 'key-b', $1)`,
      [T],
    );
    await pool.query(
      `INSERT INTO registration_codes (code_hash, tenant_id, branch_id, kind, created_at, expires_at)
       VALUES ('code-a', 't1', 'b1', 'new_branch', $1, $1), ('code-b', 't2', 'b2', 'replace_hub', $1, $1)`,
      [T],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('[00 §10 #75] both repositories throw without a TenantContext', () => {
    const unfrozen = { tenantId: 't1', branchIds: ['b1'] };
    expect(() => new TenantScopedRepository(undefined, pool)).toThrow(new TypeError('TenantContext required'));
    expect(() => new TenantLevelRepository(undefined, pool)).toThrow(new TypeError('TenantContext required'));
    expect(() => new TenantScopedRepository(unfrozen, pool)).toThrow(new TypeError('TenantContext required'));
    expect(() => new TenantLevelRepository(unfrozen, pool)).toThrow(new TypeError('TenantContext required'));
    expect(() => new TenantScopedRepository(context('t1', ['b1']), pool)).not.toThrow();
    expect(() => new TenantLevelRepository(context('t1', ['b1']), pool)).not.toThrow();
  });

  it('[F §3.4] scoped SQL without placeholders throws', async () => {
    const scoped = new TenantScopedRepository(context('t1', ['b1']), pool);
    const level = new TenantLevelRepository(context('t1', ['b1']), pool);
    await expect(scoped.query('SELECT branch_id FROM branches')).rejects.toThrow(/\$1/);
    await expect(scoped.query('SELECT branch_id FROM branches WHERE tenant_id = $1')).rejects.toThrow(/\$2/);
    await expect(
      scoped.query('SELECT branch_id FROM branches WHERE tenant_id = $10 AND branch_id = ANY($2)'),
    ).rejects.toThrow(/\$1/);
    await expect(level.query('SELECT staff_id FROM staff')).rejects.toThrow(/tenant_id = \$1/);
    await expect(level.query('SELECT staff_id FROM staff WHERE tenant_id = $10')).rejects.toThrow(/tenant_id = \$1/);

    const branches = await scoped.query<{ branch_id: string }>(
      'SELECT branch_id FROM branches WHERE tenant_id = $1 AND branch_id = ANY($2) ORDER BY branch_id',
    );
    expect(branches.map((row) => row.branch_id)).toEqual(['b1']);
    const staff = await level.query<{ staff_id: string }>(
      'SELECT staff_id FROM staff WHERE tenant_id = $1 ORDER BY staff_id',
    );
    expect(staff.map((row) => row.staff_id)).toEqual(['s1']);
  });

  it('[00 §5.2] credential lookups work across tenants by hash/email only', async () => {
    await expect(ownerByEmail(pool, 'Owner.A@Example.com')).resolves.toMatchObject({
      tenant_id: 't1',
      user_id: 'u1',
      email: 'owner.a@example.com',
    });
    await expect(ownerByEmail(pool, 'owner.b@example.com')).resolves.toMatchObject({ tenant_id: 't2', user_id: 'u2' });
    await expect(ownerByEmail(pool, 'missing@example.com')).resolves.toBeNull();

    await expect(branchByApiKeyHash(pool, 'key-b')).resolves.toMatchObject({
      tenant_id: 't2',
      branch_id: 'b2',
      key_id: 'k2',
    });
    await expect(branchByApiKeyHash(pool, 'missing')).resolves.toBeNull();

    const holder = await pool.connect();
    const waiter = await pool.connect();
    try {
      await holder.query('BEGIN');
      await waiter.query('BEGIN');
      await expect(refreshTokenByHash(holder, 'refresh-b', true)).resolves.toMatchObject({
        tenant_id: 't2',
        token_id: 'rt2',
        user_id: 'u2',
      });
      let finished = false;
      const blocked = refreshTokenByHash(waiter, 'refresh-b', true).then((row) => {
        finished = true;
        return row;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(finished).toBe(false);
      await holder.query('COMMIT');
      await expect(blocked).resolves.toMatchObject({ tenant_id: 't2', token_id: 'rt2' });
      await waiter.query('COMMIT');
    } finally {
      holder.release();
      waiter.release();
    }

    const reader = await pool.connect();
    try {
      await reader.query('BEGIN');
      await expect(registrationCodeByHash(reader, 'code-a', false)).resolves.toMatchObject({
        tenant_id: 't1',
        branch_id: 'b1',
        kind: 'new_branch',
      });
      await expect(registrationCodeByHash(reader, 'code-b', true)).resolves.toMatchObject({
        tenant_id: 't2',
        branch_id: 'b2',
        kind: 'replace_hub',
      });
      await expect(registrationCodeByHash(reader, 'missing', false)).resolves.toBeNull();
      await reader.query('COMMIT');
    } finally {
      reader.release();
    }
  });
});
