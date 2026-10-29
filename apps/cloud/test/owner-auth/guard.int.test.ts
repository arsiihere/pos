/// <reference types="node" />
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listTenantScopes } from '../../src/plugins/tenant-scope';
import { pgCounter } from '../helpers/pg-counter';
import { OWNER_PASSWORD, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { ROUTE_CASES, type BIds } from '../helpers/route-cases';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

// 01b B5, §6.13, 00 §6.24a: the JWT guard reads the owner row once per request. Until change-password
// (task 38) and reset-owner-password (task 41) exist, "a change" is a credential_version bump by SQL.
describe('JWT guard: credential version and forced change', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let counter: ReturnType<typeof pgCounter>;
  let failGuardRead = false;

  beforeAll(async () => {
    cloud = await createTestCloud({
      testHooks: {
        guardRead: async () => {
          if (failGuardRead) throw new Error('connection refused');
        },
      },
    });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    failGuardRead = false;
    f = await restaurantFixture(cloud);
  });

  const login = async () => {
    const response = await cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'a@example.com', password: OWNER_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    return response.json().data as { access_token: string; refresh_token: string };
  };
  const get = (token: string, url = '/v1/admin/branches') =>
    cloud.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  const logout = (token: string, refreshToken: string) =>
    cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { authorization: `Bearer ${token}` },
      payload: { refresh_token: refreshToken },
    });
  const refresh = (refreshToken: string) =>
    cloud.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: refreshToken } });
  const bump = () =>
    cloud.pool.query(`UPDATE owner_users SET credential_version = credential_version + 1 WHERE tenant_id = $1 AND user_id = $2`, [
      f.tenantId,
      f.userId,
    ]);
  const claimsOf = (token: string) =>
    JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;
  const credentialVersion = async () =>
    Number(
      (
        await cloud.pool.query<{ credential_version: number }>(
          `SELECT credential_version FROM owner_users WHERE tenant_id = $1 AND user_id = $2`,
          [f.tenantId, f.userId],
        )
      ).rows[0]!.credential_version,
    );
  const refreshRowVersion = async (refreshToken: string) => {
    const hash = (await import('node:crypto')).createHash('sha256').update(refreshToken).digest('hex');
    return Number(
      (
        await cloud.pool.query<{ credential_version: number }>(
          `SELECT credential_version FROM owner_refresh_tokens WHERE token_hash = $1`,
          [hash],
        )
      ).rows[0]!.credential_version,
    );
  };

  it('[01b #65] must_change_password: every /v1/admin/* route answers 403; refresh and logout answer normally', async () => {
    const before = await login();
    await cloud.pool.query(`UPDATE owner_users SET must_change_password = true WHERE tenant_id = $1 AND user_id = $2`, [
      f.tenantId,
      f.userId,
    ]);
    const after = await login(); // issued after the reset: the guard reads the row, not a claim
    const ids: BIds = {
      tenantId: f.tenantId,
      userId: f.userId,
      branchId: f.branches[0],
      auditId: 'X',
      floorId: 'X',
      tableId: 'X',
      stationId: 'X',
      programId: 'X',
      taxClassId: 'X',
      categoryId: 'X',
      itemId: 'X',
      variantGroupId: 'X',
      stockItemId: 'X',
      roleId: 'X',
      staffId: 'X',
      refreshToken: 'X',
    };
    const admin = listTenantScopes(cloud.app).filter(
      (route) => route.tenantScope === 'jwt' && route.method !== 'HEAD' && route.url.startsWith('/v1/admin/'),
    );
    expect(admin.length).toBeGreaterThanOrEqual(19);
    for (const token of [before.access_token, after.access_token]) {
      for (const route of admin) {
        const request = ROUTE_CASES[`${route.method} ${route.url}`]!(ids);
        const response = await cloud.app.inject({
          method: route.method as 'POST',
          url: request.url,
          headers: { authorization: `Bearer ${token}`, 'idempotency-key': `k-${route.method}-${route.url}` },
          ...(request.payload !== undefined ? { payload: request.payload as object } : {}),
        });
        expect(response.statusCode, `${route.method} ${route.url}`).toBe(403);
        expect(response.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      }
    }
    const refreshed = await refresh(after.refresh_token);
    expect(refreshed.statusCode).toBe(200);
    const out = await logout(after.access_token, refreshed.json().data.refresh_token as string);
    expect(out.statusCode).toBe(200);
    expect(out.json().data.revoked).toBe(true);
    // change-password stays open while the flag is set, and clears it (§3.7)
    const forced = await login();
    const changed = await cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: { authorization: `Bearer ${forced.access_token}` },
      payload: { current_password: OWNER_PASSWORD, new_password: 'a-new-password-1' },
    });
    expect(changed.statusCode).toBe(200);
    expect((await get(changed.json().data.access_token as string)).statusCode).toBe(200);
  });

  it('[01b #73] a token from before a credential change is 401 JWT_INVALID; the new one works; the guard adds one statement', async () => {
    const old = await login();
    await bump(); // "change-password on another device" / reset
    for (const response of [
      await get(old.access_token),
      await get(old.access_token, '/v1/admin/staff'),
      await cloud.app.inject({
        method: 'PATCH',
        url: '/v1/admin/staff/any-staff-id',
        headers: { authorization: `Bearer ${old.access_token}` },
        payload: { expected_version: 'a'.repeat(64) },
      }),
      await logout(old.access_token, old.refresh_token),
    ]) {
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('JWT_INVALID');
    }
    const fresh = await login();
    expect((await get(fresh.access_token)).statusCode).toBe(200);
    expect((await get(fresh.access_token, '/v1/admin/staff')).statusCode).toBe(200);

    const ghost = cloud.app.jwt.sign({ sub: 'no-such-owner', tenant_id: f.tenantId, allowed_branch_ids: [...f.branches], cv: 0 });
    const missing = await get(ghost);
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe('JWT_INVALID');

    counter.reset();
    expect((await get(fresh.access_token)).statusCode).toBe(200);
    expect(counter.count).toBe(2); // 1 route statement + 1 guard statement
  });

  it('[01b #91] credential_version: cv claim, refresh-token row, refusals after a change, a token with no cv', async () => {
    expect(await credentialVersion()).toBe(0);
    const first = await login();
    expect(claimsOf(first.access_token).cv).toBe(0);
    expect(await refreshRowVersion(first.refresh_token)).toBe(0);

    const noCv = f.token; // signed without a cv claim, as before the release
    expect(claimsOf(noCv).cv).toBeUndefined();
    expect((await get(noCv)).statusCode).toBe(200);

    await bump();
    expect(await credentialVersion()).toBe(1);
    const second = await login();
    expect(claimsOf(second.access_token).cv).toBe(1);
    expect(await refreshRowVersion(second.refresh_token)).toBe(1);
    expect((await get(second.access_token)).statusCode).toBe(200);

    expect((await get(first.access_token)).json().error.code).toBe('JWT_INVALID');
    expect((await get(noCv)).json().error.code).toBe('JWT_INVALID');
    const stale = await refresh(first.refresh_token);
    expect(stale.statusCode).toBe(401);
    expect(stale.json().error.code).toBe('REFRESH_TOKEN_INVALID');
    const revoked = await cloud.pool.query(`SELECT 1 FROM owner_refresh_tokens WHERE user_id = $1 AND revoked_at IS NOT NULL`, [f.userId]);
    expect(revoked.rowCount).toBe(0); // nothing revoked

    const rotated = await refresh(second.refresh_token);
    expect(rotated.statusCode).toBe(200);
    expect(claimsOf(rotated.json().data.access_token as string).cv).toBe(1);
    expect(await refreshRowVersion(rotated.json().data.refresh_token as string)).toBe(1);

    // two changes in the same millisecond still give two versions (a counter, no clock)
    await bump();
    await bump();
    expect(await credentialVersion()).toBe(3);
    expect((await get(second.access_token)).json().error.code).toBe('JWT_INVALID');
  });

  it('[01b #107] a failed guard read is 503 SERVICE_UNAVAILABLE, never 401; the handler is not called; the same token works after', async () => {
    const tokens = await login();
    failGuardRead = true;
    counter.reset();
    const branches = await get(tokens.access_token);
    expect(branches.statusCode).toBe(503);
    expect(branches.json().error.code).toBe('SERVICE_UNAVAILABLE');
    expect(counter.count).toBe(0); // no route statement ran
    const out = await logout(tokens.access_token, tokens.refresh_token);
    expect(out.statusCode).toBe(503);
    expect(out.json().error.code).toBe('SERVICE_UNAVAILABLE');
    const live = await cloud.pool.query(`SELECT 1 FROM owner_refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, [f.userId]);
    expect(live.rowCount).toBe(1);

    failGuardRead = false;
    expect((await get(tokens.access_token)).statusCode).toBe(200);
  });

  it('[01b §6.13] a JWT signed with the right secret but a forged cv still has to match the row', async () => {
    const tokens = await login();
    const [header, payload] = tokens.access_token.split('.') as [string, string];
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>;
    const forgedPayload = Buffer.from(JSON.stringify({ ...claims, cv: 7 })).toString('base64url');
    const data = `${header}.${forgedPayload}`;
    const forged = `${data}.${createHmac('sha256', cloud.env.JWT_SECRET).update(data).digest('base64url')}`;
    expect((await get(forged)).json().error.code).toBe('JWT_INVALID');
  });
});
