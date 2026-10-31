import { afterEach, describe, expect, it } from 'vitest';
import { seedTenant } from '../src/cli/seed-tenant';
import { SystemContext } from '../src/cli/system-context';
import { testIdGen } from '../src/lib/ids';
import { createTestCloud, truncateAll } from './helpers/test-cloud';

describe('cloud log redaction', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §7.2] Authorization bearer values are redacted in request logs', async () => {
    const cloud = await createTestCloud({ captureLogs: true });
    cleanups.push(() => cloud.close());
    await truncateAll(cloud.pool);
    const ids = testIdGen();
    await seedTenant(
      new SystemContext(cloud.pool),
      {
        name: 'Pilot',
        currency: 'PKR',
        ownerEmail: 'redact@example.com',
        ownerName: 'Ada',
        password: 'password-1',
        pin: '1234',
      },
      { clock: cloud.clock, ids },
    );
    const login = await cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'redact@example.com', password: 'password-1' },
    });
    expect(login.statusCode).toBe(200);
    const accessToken = login.json().data.access_token as string;
    const refreshToken = login.json().data.refresh_token as string;
    expect(accessToken.length).toBeGreaterThan(20);
    const logout = await cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { refresh_token: refreshToken },
    });
    expect(logout.statusCode).toBe(200);
    const logs = cloud.logs();
    expect(logs).toContain('[Redacted]');
    expect(logs).not.toContain(accessToken);
    expect(logs).not.toContain(`Bearer ${accessToken}`);
  });
});
