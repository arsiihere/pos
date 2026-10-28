import { DomainError } from '@pos/domain';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { issueRegistrationCode } from '../../src/cli/issue-registration-code';
import { seedTenant } from '../../src/cli/seed-tenant';
import { SystemContext } from '../../src/cli/system-context';
import { testIdGen } from '../../src/lib/ids';
import { sendIdempotent, withIdempotency } from '../../src/lib/idempotency';
import { testSecrets } from '../../src/lib/secrets';
import { createTestCloud, truncateAll, type TestCloud } from '../helpers/test-cloud';

const PASSWORD = 'password-1';
const DAY_MS = 86_400_000;

describe('withIdempotency', () => {
  let cloud: TestCloud;
  const hooks: { beforePrune?(): Promise<void> } = {};
  let fnGate: Promise<void> | undefined;
  const floorIds = testIdGen();
  const keys = testIdGen();
  let tenantId: string;
  let branchA: string;
  let branchB: string;
  let token: string;

  beforeAll(async () => {
    cloud = await createTestCloud({ captureLogs: true });
    cloud.app.withTypeProvider<ZodTypeProvider>().post(
      '/v1/test/floors/:branch_id',
      {
        config: { tenantScope: 'jwt' },
        schema: { params: z.object({ branch_id: z.string() }), body: z.object({ name: z.string() }) },
      },
      async (request, reply) => {
        const header = request.headers['idempotency-key'];
        const result = await withIdempotency(
          { pool: cloud.pool, clock: cloud.clock, tenant: request.tenant!, log: request.log, testHooks: hooks },
          {
            key: typeof header === 'string' ? header : undefined,
            method: request.method,
            path: request.url.split('?')[0]!,
            body: request.body,
          },
          async (client) => {
            const floorId = floorIds.next();
            const now = cloud.clock.branchNow();
            try {
              await client.query(
                `INSERT INTO floors (tenant_id, branch_id, floor_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
                [request.tenant!.tenantId, request.params.branch_id, floorId, request.body.name, now],
              );
            } catch (error) {
              if ((error as { code?: string }).code === '23505') {
                throw new DomainError('CONFIG_NAME_TAKEN', { entity: 'floor', name: request.body.name });
              }
              throw error;
            }
            if (fnGate !== undefined) await fnGate;
            return { status: 201, body: { floor_id: floorId, name: request.body.name } };
          },
        );
        return sendIdempotent(reply, result);
      },
    );
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });

  beforeEach(async () => {
    delete hooks.beforePrune;
    fnGate = undefined;
    await truncateAll(cloud.pool);
    const sys = new SystemContext(cloud.pool);
    const deps = { clock: cloud.clock, ids: testIdGen(), secrets: testSecrets() };
    const seeded = await seedTenant(
      sys,
      { name: 'Tenant A', currency: 'PKR', ownerEmail: 'a@example.com', ownerName: 'Ada', password: PASSWORD, pin: '1234' },
      deps,
    );
    tenantId = seeded.tenant_id;
    branchA = (await issueRegistrationCode(sys, { tenantId, branchName: 'Branch A' }, deps)).branch_id;
    branchB = (await issueRegistrationCode(sys, { tenantId, branchName: 'Branch B' }, deps)).branch_id;
    const login = await cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'a@example.com', password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    token = login.json().data.access_token as string;
  });

  function post(branchId: string, name: string, key: string | undefined) {
    return cloud.app.inject({
      method: 'POST',
      url: `/v1/test/floors/${branchId}`,
      headers: { authorization: `Bearer ${token}`, ...(key !== undefined ? { 'idempotency-key': key } : {}) },
      payload: { name },
    });
  }

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const rows = await cloud.pool.query<{ n: string }>(sql, params);
    return Number(rows.rows[0]!.n);
  }

  async function insertOldKeys(tenant: string, n: number, createdAt: number): Promise<void> {
    await cloud.pool.query(
      `INSERT INTO idempotency_keys (tenant_id, idempotency_key, route, request_hash, response_status, response_body, created_at)
       SELECT $1, $1 || '-old-' || g, 'POST /old', 'h', 201, '{}', $3 FROM generate_series(1, $2) AS g`,
      [tenant, n, createdAt],
    );
  }

  it('[01a §10 #9] a creating POST without a ULID Idempotency-Key is 400 VALIDATION_FAILED on headers.idempotency-key', async () => {
    for (const key of [undefined, 'not-a-ulid']) {
      const res = await post(branchA, 'Ground', key);
      expect(res.statusCode).toBe(400);
      const error = res.json().error;
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details.issues).toEqual([expect.objectContaining({ path: 'headers.idempotency-key' })]);
    }
    expect(await count(`SELECT count(*) AS n FROM floors`)).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM idempotency_keys`)).toBe(0);
  });

  it('[01a §10 #10] same key and body twice gives the same status and body, the second with Idempotent-Replay, one row', async () => {
    const key = keys.next();
    const first = await post(branchA, 'Ground', key);
    const second = await post(branchA, 'Ground', key);
    expect(first.statusCode).toBe(201);
    expect(first.headers['idempotent-replay']).toBeUndefined();
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(first.json().data.name).toBe('Ground');
    expect(await count(`SELECT count(*) AS n FROM floors`)).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM idempotency_keys WHERE response_status = 201`)).toBe(1);
  });

  it('[01a §10 #11] same key with a different body is 422 IDEMPOTENCY_KEY_MISMATCH', async () => {
    const key = keys.next();
    expect((await post(branchA, 'Ground', key)).statusCode).toBe(201);
    const res = await post(branchA, 'Roof', key);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'IDEMPOTENCY_KEY_MISMATCH', details: { idempotency_key: key } });
    expect(await count(`SELECT count(*) AS n FROM floors`)).toBe(1);
  });

  it('[01a §10 #12] two concurrent requests with one key create once; the other gets the replay', async () => {
    const key = keys.next();
    let release!: () => void;
    fnGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = post(branchA, 'Ground', key);
    // wait until the first holds its key row, then start the second, which blocks on the primary key
    await waitFor(async () => (await lockHolders()) > 0);
    const second = post(branchA, 'Ground', key);
    await waitFor(async () => (await lockWaiters()) > 0);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(a.headers['idempotent-replay']).toBeUndefined();
    expect(b.headers['idempotent-replay']).toBe('true');
    expect(b.json()).toEqual(a.json());
    expect(await count(`SELECT count(*) AS n FROM floors`)).toBe(1);
  });

  it('[01a §10 #13] a failed create (409) stores no key; a corrected retry with the same key succeeds', async () => {
    expect((await post(branchA, 'dup', keys.next())).statusCode).toBe(201);
    const key = keys.next();
    const failed = await post(branchA, 'dup', key);
    expect(failed.statusCode).toBe(409);
    expect(failed.json().error.code).toBe('CONFIG_NAME_TAKEN');
    expect(await count(`SELECT count(*) AS n FROM idempotency_keys WHERE idempotency_key = $1`, [key])).toBe(0);
    const retry = await post(branchA, 'Ground', key);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replay']).toBeUndefined();
    expect(await count(`SELECT count(*) AS n FROM floors`)).toBe(2);
  });

  it("[01a §10 #14] keys older than 24 h for the tenant are pruned on the next insert, at most 100, other tenants' rows untouched", async () => {
    const now = cloud.clock.branchNow();
    await insertOldKeys(tenantId, 150, now - DAY_MS - 1);
    await insertOldKeys('other-tenant', 5, now - DAY_MS - 1);
    await cloud.pool.query(
      `INSERT INTO idempotency_keys (tenant_id, idempotency_key, route, request_hash, created_at) VALUES ($1, 'edge', 'POST /old', 'h', $2)`,
      [tenantId, now - DAY_MS],
    );
    expect((await post(branchA, 'Ground', keys.next())).statusCode).toBe(201);
    expect(await count(`SELECT count(*) AS n FROM idempotency_keys WHERE tenant_id = $1 AND route = 'POST /old'`, [tenantId])).toBe(51);
    expect(await count(`SELECT count(*) AS n FROM idempotency_keys WHERE idempotency_key = 'edge'`)).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM idempotency_keys WHERE tenant_id = 'other-tenant'`)).toBe(5);
    expect((await post(branchA, 'Roof', keys.next())).statusCode).toBe(201);
    expect(await count(`SELECT count(*) AS n FROM idempotency_keys WHERE tenant_id = $1 AND route = 'POST /old'`, [tenantId])).toBe(1);
  });

  it('[01a §10 #122] the same key on another branch path is a mismatch; creates with old keys do not deadlock; prune runs after COMMIT and a prune failure still returns 201', async () => {
    const key = keys.next();
    expect((await post(branchA, 'Ground', key)).statusCode).toBe(201);
    const other = await post(branchB, 'Ground', key);
    expect(other.statusCode).toBe(422);
    expect(other.json().error.code).toBe('IDEMPOTENCY_KEY_MISMATCH');

    const now = cloud.clock.branchNow();
    await insertOldKeys(tenantId, 100, now - DAY_MS - 1);
    const [a, b] = await Promise.all([post(branchA, 'Upper', keys.next()), post(branchB, 'Upper', keys.next())]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(await count(`SELECT count(*) AS n FROM idempotency_keys WHERE route = 'POST /old'`)).toBe(0);

    await insertOldKeys(tenantId, 3, now - DAY_MS - 1);
    const seen: Array<{ floor: number; old: number }> = [];
    hooks.beforePrune = async () => {
      seen.push({
        floor: await count(`SELECT count(*) AS n FROM floors WHERE name = 'Terrace'`),
        old: await count(`SELECT count(*) AS n FROM idempotency_keys WHERE route = 'POST /old'`),
      });
    };
    expect((await post(branchA, 'Terrace', keys.next())).statusCode).toBe(201);
    expect(seen).toEqual([{ floor: 1, old: 3 }]);
    expect(await count(`SELECT count(*) AS n FROM idempotency_keys WHERE route = 'POST /old'`)).toBe(0);

    await insertOldKeys(tenantId, 3, now - DAY_MS - 1);
    hooks.beforePrune = async () => {
      throw new Error('forced prune failure');
    };
    const res = await post(branchA, 'Garden', keys.next());
    expect(res.statusCode).toBe(201);
    expect(res.json().data.name).toBe('Garden');
    expect(await count(`SELECT count(*) AS n FROM idempotency_keys WHERE route = 'POST /old'`)).toBe(3);
    const errors = cloud
      .logs()
      .split('\n')
      .filter((line) => line.includes('"level":50') && line.includes('forced prune failure'));
    expect(errors).toHaveLength(1);
  });

  async function lockHolders(): Promise<number> {
    return count(
      `SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction' AND pid <> pg_backend_pid()`,
    );
  }
  async function lockWaiters(): Promise<number> {
    return count(
      `SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
    );
  }
});

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const start = performance.now();
  while (!(await check())) {
    if (performance.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
