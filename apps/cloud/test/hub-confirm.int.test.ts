import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueRegistrationCode } from '../src/cli/issue-registration-code';
import { seedTenant } from '../src/cli/seed-tenant';
import { SystemContext } from '../src/cli/system-context';
import { testIdGen } from '../src/lib/ids';
import { testSecrets } from '../src/lib/secrets';
import { createTestCloud, truncateAll, type TestCloud } from './helpers/test-cloud';

const T = 1_761_000_000_000;
const HOUR = 3_600_000;

describe('POST /v1/hubs/confirm', () => {
  const ids = testIdGen();
  const secrets = testSecrets();
  let cloud: TestCloud;

  beforeAll(async () => {
    cloud = await createTestCloud();
    await truncateAll(cloud.pool);
  });

  afterAll(async () => {
    await cloud.close();
  });

  async function registered(email: string, branchName: string) {
    const sys = new SystemContext(cloud.pool);
    const deps = { clock: cloud.clock, ids, secrets };
    const seeded = await seedTenant(
      sys,
      { name: 'Pilot', currency: 'PKR', ownerEmail: email, ownerName: 'Ada', password: 'password-1', pin: '1234' },
      deps,
    );
    const issued = await issueRegistrationCode(sys, { tenantId: seeded.tenant_id, branchName }, deps);
    const key = ids.next();
    const response = await cloud.app.inject({
      method: 'POST',
      url: '/v1/hubs/register',
      headers: { 'idempotency-key': key, 'content-type': 'application/json' },
      payload: { registration_code: issued.code, hub_version: '1.2.3', accepted_kinds: ['new_branch'] },
    });
    expect(response.statusCode).toBe(200);
    return { seeded, issued, idempotencyKey: key, apiKey: response.json().data.branch_api_key as string };
  }

  function confirm(apiKey: string) {
    return cloud.app.inject({
      method: 'POST',
      url: '/v1/hubs/confirm',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      payload: { hub_version: '1.2.3' },
    });
  }

  it('[00 §10 #89] no confirm: after 1 h the same code → 401; reissue for the unconfirmed branch → new code → register works', async () => {
    const { seeded, issued, idempotencyKey } = await registered('ada-confirm@example.com', 'Gulberg');
    cloud.clock.set(T + HOUR);
    const again = await cloud.app.inject({
      method: 'POST',
      url: '/v1/hubs/register',
      headers: { 'idempotency-key': idempotencyKey, 'content-type': 'application/json' },
      payload: { registration_code: issued.code, hub_version: '1.2.3', accepted_kinds: ['new_branch'] },
    });
    expect(again.statusCode).toBe(401);
    expect(again.json().error.code).toBe('REGISTRATION_CODE_INVALID');

    const reissued = await issueRegistrationCode(
      new SystemContext(cloud.pool),
      { tenantId: seeded.tenant_id, branchId: issued.branch_id },
      { clock: cloud.clock, ids, secrets },
    );
    const registeredAgain = await cloud.app.inject({
      method: 'POST',
      url: '/v1/hubs/register',
      headers: { 'idempotency-key': ids.next(), 'content-type': 'application/json' },
      payload: { registration_code: reissued.code, hub_version: '1.2.3', accepted_kinds: ['new_branch'] },
    });
    expect(registeredAgain.statusCode).toBe(200);
    expect(registeredAgain.json().data.branch_id).toBe(issued.branch_id);
    cloud.clock.set(T);
  });

  it('[00 §6.28] confirm after the presented key is revoked is 401 and leaves the branch pending_hub', async () => {
    cloud.clock.set(T);
    const { issued, apiKey } = await registered('cy-confirm@example.com', 'Clifton');
    const hold = await cloud.pool.connect();
    try {
      await hold.query('BEGIN');
      await hold.query('SELECT branch_id FROM branches WHERE branch_id = $1 FOR UPDATE', [issued.branch_id]);
      let settled = false;
      const pending = confirm(apiKey).finally(() => {
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
      await hold.query(
        `UPDATE branch_api_keys SET revoked_at = $2 WHERE branch_id = $1 AND revoked_at IS NULL`,
        [issued.branch_id, T],
      );
      await hold.query('COMMIT');
      const response = await pending;
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('BRANCH_API_KEY_INVALID');
      const row = await cloud.pool.query<{ status: string; hub_confirmed_at: string | null }>(
        `SELECT status, hub_confirmed_at FROM branches WHERE branch_id = $1`,
        [issued.branch_id],
      );
      expect(row.rows[0]).toEqual({ status: 'pending_hub', hub_confirmed_at: null });
    } finally {
      await hold.query('ROLLBACK').catch(() => undefined);
      hold.release();
    }
  });

  it('[00 §10 #90] confirm sets active + hub_confirmed_at; repeat returns the same value; bad key → 401', async () => {
    cloud.clock.set(T);
    const { seeded, issued, apiKey } = await registered('bea-confirm@example.com', 'DHA');
    await issueRegistrationCode(
      new SystemContext(cloud.pool),
      { tenantId: seeded.tenant_id, branchId: issued.branch_id },
      { clock: cloud.clock, ids, secrets },
    );
    const first = await confirm(apiKey);
    expect(first.statusCode).toBe(200);
    const confirmedAt = first.json().data.hub_confirmed_at as number;
    expect(first.json().data.branch_id).toBe(issued.branch_id);
    expect(confirmedAt).toBe(T);
    const row = await cloud.pool.query<{ status: string; hub_confirmed_at: string }>(
      `SELECT status, hub_confirmed_at FROM branches WHERE branch_id = $1`,
      [issued.branch_id],
    );
    expect(row.rows[0]?.status).toBe('active');
    expect(Number(row.rows[0]?.hub_confirmed_at)).toBe(confirmedAt);
    const codes = await cloud.pool.query<{ expires_at: string; consumed_at: string | null }>(
      `SELECT expires_at, consumed_at FROM registration_codes WHERE branch_id = $1`,
      [issued.branch_id],
    );
    expect(codes.rows.some((code) => code.consumed_at === null && Number(code.expires_at) <= T)).toBe(true);

    cloud.clock.set(T + HOUR);
    const second = await confirm(apiKey);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.hub_confirmed_at).toBe(confirmedAt);

    const bad = await confirm('not-a-key');
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('BRANCH_API_KEY_INVALID');
    cloud.clock.set(T);
  });
});
