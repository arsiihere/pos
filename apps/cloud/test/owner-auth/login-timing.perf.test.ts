import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { SystemContext } from '../../src/cli/system-context';
import { seedTenant } from '../../src/cli/seed-tenant';
import { testIdGen } from '../../src/lib/ids';
import { createTestCloud, truncateAll, type TestCloud } from '../helpers/test-cloud';

// 00 §10 #53, timing half. AD-32 (owner ruling 2026-11-20): wall-clock asserts live only in `pnpm test:perf`
// (tools/test-perf.sh, project perf-cloud), on a quiet machine; the normal gate checks the behaviour instead
// (login.int.test.ts: one argon2 verify on each path).
const PASSWORD = 'password-1';
const cleanups: Array<() => Promise<void>> = [];

describe('[00 §10 #53] login timing (perf)', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #53] wrong password and unknown email both answer 401 within 2× of each other', async () => {
    const cloud = await open();
    await seedTenant(
      new SystemContext(cloud.pool),
      { name: 'Ada', currency: 'PKR', ownerEmail: 'owner@example.com', ownerName: 'Ada', password: PASSWORD, pin: '1234' },
      { clock: cloud.clock, ids: testIdGen() },
    );
    const wrong = await elapsed(cloud.app, 'owner@example.com', 'wrong-password');
    const unknown = await elapsed(cloud.app, 'missing@example.com', PASSWORD);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const slower = Math.max(wrong.ms, unknown.ms);
    const faster = Math.max(1, Math.min(wrong.ms, unknown.ms));
    expect(slower).toBeLessThanOrEqual(faster * 2);
  });
});

async function open(): Promise<TestCloud> {
  const cloud = await createTestCloud();
  cleanups.push(async () => {
    await truncateAll(cloud.pool);
    await cloud.close();
  });
  await truncateAll(cloud.pool);
  return cloud;
}

async function elapsed(app: FastifyInstance, email: string, password: string) {
  const start = Date.now();
  const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });
  return { ms: Date.now() - start, status: res.statusCode };
}
