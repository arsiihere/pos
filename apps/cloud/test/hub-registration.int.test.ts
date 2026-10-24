/// <reference types="node" />
import { createHash } from 'node:crypto';
import { DirectorySchema } from '@pos/events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueRegistrationCode } from '../src/cli/issue-registration-code';
import { seedTenant } from '../src/cli/seed-tenant';
import { SystemContext } from '../src/cli/system-context';
import { testIdGen } from '../src/lib/ids';
import { testSecrets } from '../src/lib/secrets';
import { createTestCloud, truncateAll, type TestCloud } from './helpers/test-cloud';

const T = 1_761_000_000_000;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function ulid(ids: ReturnType<typeof testIdGen>): string {
  return ids.next();
}

describe('POST /v1/hubs/register', () => {
  const ids = testIdGen();
  const secrets = testSecrets();
  let cloud: TestCloud;
  const sys = () => new SystemContext(cloud.pool);

  beforeAll(async () => {
    cloud = await createTestCloud();
    await truncateAll(cloud.pool);
  });

  afterAll(async () => {
    await cloud.close();
  });

  async function branch(name: string, email: string) {
    const seeded = await seedTenant(
      sys(),
      { name: 'Pilot', currency: 'PKR', ownerEmail: email, ownerName: 'Ada', password: 'password-1', pin: '1234' },
      { clock: cloud.clock, ids, secrets },
    );
    const issued = await issueRegistrationCode(sys(), { tenantId: seeded.tenant_id, branchName: name }, { clock: cloud.clock, ids, secrets });
    await cloud.pool.query(
      `INSERT INTO staff (tenant_id, staff_id, display_name, pin_hash, is_active, created_at, updated_at)
       VALUES ($1, $2, 'Cashier', 'hash', true, $4, $4),
              ($1, $3, 'Gone', 'hash', false, $4, $4)`,
      [seeded.tenant_id, `cash-${email}`, `gone-${email}`, T],
    );
    await cloud.pool.query(
      `INSERT INTO staff_branches (tenant_id, branch_id, staff_id) VALUES ($1, $2, $3)`,
      [seeded.tenant_id, issued.branch_id, `gone-${email}`],
    );
    return { seeded, issued };
  }

  function register(code: string, idempotencyKey: string, accepted: Array<'new_branch' | 'replace_hub'> = ['new_branch']) {
    return cloud.app.inject({
      method: 'POST',
      url: '/v1/hubs/register',
      headers: { 'idempotency-key': idempotencyKey, 'content-type': 'application/json' },
      payload: { registration_code: code, hub_version: '1.2.3', accepted_kinds: accepted },
    });
  }

  it('[00 §10 #22] register consumes the code, leaves the branch pending_hub, and returns only that branch\'s active staff', async () => {
    const { seeded, issued } = await branch('Gulberg', 'ada@example.com');
    const otherBranch = await issueRegistrationCode(
      sys(),
      { tenantId: seeded.tenant_id, branchName: 'Other' },
      { clock: cloud.clock, ids, secrets },
    );
    const otherStaffId = 'other-branch-only';
    const otherRoleId = 'role-other-only';
    await cloud.pool.query(
      `INSERT INTO staff (tenant_id, staff_id, display_name, pin_hash, is_active, created_at, updated_at)
       VALUES ($1, $2, 'Other Cashier', 'hash', true, $3, $3)`,
      [seeded.tenant_id, otherStaffId, T],
    );
    await cloud.pool.query(`INSERT INTO staff_branches (tenant_id, branch_id, staff_id) VALUES ($1, $2, $3)`, [
      seeded.tenant_id,
      otherBranch.branch_id,
      otherStaffId,
    ]);
    await cloud.pool.query(
      `INSERT INTO roles (tenant_id, role_id, name, session_idle_ttl_ms) VALUES ($1, $2, 'OtherOnly', 900000)`,
      [seeded.tenant_id, otherRoleId],
    );
    await cloud.pool.query(`INSERT INTO staff_roles (tenant_id, staff_id, role_id) VALUES ($1, $2, $3)`, [
      seeded.tenant_id,
      otherStaffId,
      otherRoleId,
    ]);
    const idempotencyKey = ulid(ids);
    const response = await register(issued.code, idempotencyKey);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.tenant_id).toBe(seeded.tenant_id);
    expect(body.data.branch_id).toBe(issued.branch_id);
    expect(body.data.branch_name).toBe('Gulberg');
    expect(body.data.currency_code).toBe('PKR');
    expect(body.data.kind).toBe('new_branch');
    expect(DirectorySchema.safeParse(body.data.directory).success).toBe(true);
    expect(body.data.directory.staff.map((staff: { staff_id: string }) => staff.staff_id)).toEqual([seeded.staff_id]);
    expect(body.data.directory.staff.map((staff: { staff_id: string }) => staff.staff_id)).not.toContain(otherStaffId);
    expect(body.data.directory.roles.map((role: { name: string }) => role.name)).toEqual(['Owner']);
    expect(body.data.directory.roles.map((role: { name: string }) => role.name)).not.toContain('OtherOnly');
    const owner = body.data.directory.roles.find((role: { name: string }) => role.name === 'Owner');
    expect(owner.permissions).toEqual(
      expect.arrayContaining([{ permission: 'access-hub-admin', grant_type: 'allowed', approver_role_id: null }]),
    );

    const row = await cloud.pool.query<{
      status: string;
      hub_confirmed_at: string | null;
      consumed_at: string;
      consumed_attempt_id: string;
    }>(
      `SELECT b.status, b.hub_confirmed_at, c.consumed_at, c.consumed_attempt_id
         FROM branches b
         JOIN registration_codes c ON c.branch_id = b.branch_id
        WHERE b.branch_id = $1 AND c.code_hash = $2`,
      [issued.branch_id, sha256(issued.code.replace(/-/g, ''))],
    );
    expect(row.rows[0]).toMatchObject({
      status: 'pending_hub',
      hub_confirmed_at: null,
      consumed_at: String(T),
      consumed_attempt_id: idempotencyKey,
    });
    const keys = await cloud.pool.query<{ key_hash: string; revoked_at: string | null }>(
      `SELECT key_hash, revoked_at FROM branch_api_keys WHERE branch_id = $1`,
      [issued.branch_id],
    );
    expect(keys.rows).toEqual([{ key_hash: sha256(body.data.branch_api_key), revoked_at: null }]);
  });

  it('[00 §10 #23] the same Idempotency-Key within 1 h returns a new key and revokes the previous one', async () => {
    const { issued } = await branch('DHA', 'bea@example.com');
    const key = ulid(ids);
    const first = await register(issued.code, key);
    const second = await register(issued.code, key);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.branch_api_key).not.toBe(first.json().data.branch_api_key);
    const keys = await cloud.pool.query<{ key_hash: string; revoked_at: string | null }>(
      `SELECT key_hash, revoked_at FROM branch_api_keys WHERE branch_id = $1 ORDER BY revoked_at NULLS LAST`,
      [issued.branch_id],
    );
    expect(keys.rows).toHaveLength(2);
    expect(keys.rows.filter((row) => row.revoked_at === null).map((row) => row.key_hash)).toEqual([
      sha256(second.json().data.branch_api_key),
    ]);
    expect(keys.rows.some((row) => row.key_hash === sha256(first.json().data.branch_api_key) && row.revoked_at !== null)).toBe(
      true,
    );
  });

  it('[00 §10 #24] another key after consumption, an expired code, and an unknown code are the same 401', async () => {
    const { seeded, issued } = await branch('Clifton', 'cy@example.com');
    const ok = await register(issued.code, ulid(ids));
    expect(ok.statusCode).toBe(200);
    const otherKey = await register(issued.code, ulid(ids));
    const expiredCode = await issueRegistrationCode(
      sys(),
      { tenantId: seeded.tenant_id, branchName: 'Expired' },
      { clock: cloud.clock, ids, secrets },
    );
    await cloud.pool.query(`UPDATE registration_codes SET expires_at = $2 WHERE code_hash = $1`, [
      sha256(expiredCode.code.replace(/-/g, '')),
      T,
    ]);
    const expired = await register(expiredCode.code, ulid(ids));
    const unknown = await register('AAAA-BBBB-CCCC', ulid(ids));
    const bodies = [otherKey, expired, unknown].map((response) => ({
      status: response.statusCode,
      code: response.json().error.code,
      message: response.json().error.message,
      details: response.json().error.details,
    }));
    expect(bodies).toEqual([
      { status: 401, code: 'REGISTRATION_CODE_INVALID', message: 'REGISTRATION_CODE_INVALID', details: {} },
      { status: 401, code: 'REGISTRATION_CODE_INVALID', message: 'REGISTRATION_CODE_INVALID', details: {} },
      { status: 401, code: 'REGISTRATION_CODE_INVALID', message: 'REGISTRATION_CODE_INVALID', details: {} },
    ]);
  });

  it('[00 §10 #25] a replace_hub code with accepted_kinds new_branch is 422 and stays unconsumed', async () => {
    const { issued } = await branch('Saddar', 'dee@example.com');
    await cloud.pool.query(`UPDATE registration_codes SET kind = 'replace_hub' WHERE code_hash = $1`, [
      sha256(issued.code.replace(/-/g, '')),
    ]);
    const response = await register(issued.code, ulid(ids), ['new_branch']);
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('REGISTRATION_CODE_KIND_UNSUPPORTED');
    expect(response.json().error.details).toEqual({ kind: 'replace_hub', accepted_kinds: ['new_branch'] });
    const row = await cloud.pool.query<{ consumed_at: string | null }>(
      `SELECT consumed_at FROM registration_codes WHERE code_hash = $1`,
      [sha256(issued.code.replace(/-/g, ''))],
    );
    expect(row.rows[0]?.consumed_at).toBeNull();
  });

  it('[00 §6.5] a same-attempt retry and a reissued code both return 200 and leave one live key', async () => {
    const { seeded, issued } = await branch('Model', 'fay@example.com');
    const idempotencyKey = ulid(ids);
    const first = await register(issued.code, idempotencyKey);
    expect(first.statusCode).toBe(200);
    const reissued = await issueRegistrationCode(
      sys(),
      { tenantId: seeded.tenant_id, branchId: issued.branch_id },
      { clock: cloud.clock, ids, secrets },
    );

    const hold = await cloud.pool.connect();
    try {
      await hold.query('BEGIN');
      await hold.query('SELECT branch_id FROM branches WHERE branch_id = $1 FOR UPDATE', [issued.branch_id]);
      let settled = false;
      const pending = register(reissued.code, ulid(ids)).finally(() => {
        settled = true;
      });
      const deadline = Date.now() + 2_000;
      let waiting = false;
      while (Date.now() < deadline) {
        if (settled) break;
        const locks = await cloud.pool.query<{ n: string }>(
          `SELECT count(*)::text AS n
             FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
        );
        if (locks.rows[0]?.n !== '0') {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await hold.query(`SET LOCAL statement_timeout = '750ms'`);
      await hold.query(
        `UPDATE registration_codes SET expires_at = expires_at
          WHERE tenant_id = $1 AND branch_id = $2 AND consumed_at IS NULL`,
        [seeded.tenant_id, issued.branch_id],
      );

      await hold.query(
        `UPDATE branch_api_keys SET revoked_at = $3
          WHERE tenant_id = $1 AND branch_id = $2 AND revoked_at IS NULL`,
        [seeded.tenant_id, issued.branch_id, T],
      );
      await hold.query(
        `INSERT INTO branch_api_keys (tenant_id, branch_id, key_id, key_hash, created_at)
         VALUES ($1, $2, 'planted-key', $3, $4)`,
        [seeded.tenant_id, issued.branch_id, sha256('planted-key'), T],
      );
      await hold.query('COMMIT');

      const response = await pending;
      expect(response.statusCode).toBe(200);
      const retry = await register(issued.code, idempotencyKey);
      expect(retry.statusCode).toBe(200);
      const keys = await cloud.pool.query<{ key_hash: string; revoked_at: string | null }>(
        `SELECT key_hash, revoked_at FROM branch_api_keys WHERE branch_id = $1 AND revoked_at IS NULL`,
        [issued.branch_id],
      );
      expect(keys.rows).toEqual([{ key_hash: sha256(retry.json().data.branch_api_key), revoked_at: null }]);
    } finally {
      await hold.query('ROLLBACK').catch(() => undefined);
      hold.release();
    }
  });

  it('[00 §10 #61] two registers of one code with different keys: one 200 and one 401', async () => {
    const { issued } = await branch('Bahria', 'eve@example.com');
    const [left, right] = await Promise.all([register(issued.code, ulid(ids)), register(issued.code, ulid(ids))]);
    expect([left.statusCode, right.statusCode].sort()).toEqual([200, 401]);
    const failed = left.statusCode === 401 ? left : right;
    expect(failed.json().error.code).toBe('REGISTRATION_CODE_INVALID');
    const live = await cloud.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM branch_api_keys WHERE branch_id = $1 AND revoked_at IS NULL`,
      [issued.branch_id],
    );
    expect(live.rows[0]?.n).toBe('1');
  });
});
