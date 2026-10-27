import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SystemContext } from '../../src/cli/system-context';
import { seedTenant } from '../../src/cli/seed-tenant';
import { testIdGen } from '../../src/lib/ids';
import { createTestCloud, truncateAll, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;
const PASSWORD = 'password-1';
const NEW_PASSWORD = 'a-much-better-passphrase';

describe('POST /v1/auth/change-password (01b §6.11)', () => {
  let cloud: TestCloud;
  let owner: { tenant_id: string; user_id: string };
  let ip = 0;

  beforeAll(async () => {
    cloud = await createTestCloud({ captureLogs: true });
    await cloud.app.ready();
  });
  afterAll(async () => {
    await truncateAll(cloud.pool);
    await cloud.close();
  });
  beforeEach(async () => {
    cloud.clock.set(T);
    await truncateAll(cloud.pool);
    owner = await seedTenant(
      new SystemContext(cloud.pool),
      { name: 'Pilot', currency: 'PKR', ownerEmail: 'owner@example.com', ownerName: 'Ada', password: PASSWORD, pin: '1234' },
      { clock: cloud.clock, ids: testIdGen() },
    );
  });

  const login = async (password = PASSWORD) => {
    const response = await cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'owner@example.com', password },
      remoteAddress: `10.2.0.${++ip % 250}`,
    });
    return response;
  };
  const change = (token: string, payload: object) =>
    cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload,
      remoteAddress: `10.3.0.${++ip % 250}`,
    });
  const ownerRow = async () =>
    (
      await cloud.pool.query(
        `SELECT credential_version, must_change_password, temp_password_expires_at, password_changed_at FROM owner_users WHERE user_id = $1`,
        [owner.user_id],
      )
    ).rows[0];

  it('[01b #37] happy path: new pair returned, every old refresh token revoked, audit row without password fields', async () => {
    const a = (await login()).json().data;
    const b = (await login()).json().data;
    cloud.clock.set(T + 60_000);
    const changed = await change(a.access_token, { current_password: PASSWORD, new_password: NEW_PASSWORD });
    expect(changed.statusCode, changed.body).toBe(200);
    const data = changed.json().data;
    expect(Object.keys(data).sort()).toEqual(['access_expires_at', 'access_token', 'refresh_expires_at', 'refresh_token']);
    expect(data.access_expires_at).toBe(T + 60_000 + 3_600_000);
    expect(cloud.app.jwt.verify(data.access_token).cv).toBe(1);
    expect(await ownerRow()).toMatchObject({ credential_version: 1, must_change_password: false, password_changed_at: String(T + 60_000) });

    const tokens = await cloud.pool.query<{ revoked_at: string | null; credential_version: number }>(
      `SELECT revoked_at, credential_version FROM owner_refresh_tokens WHERE user_id = $1 ORDER BY created_at, token_id`,
      [owner.user_id],
    );
    expect(tokens.rows.filter((row) => row.revoked_at === null)).toEqual([{ revoked_at: null, credential_version: 1 }]);
    expect(tokens.rows).toHaveLength(3);
    for (const old of [a, b]) {
      const refused = await cloud.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: old.refresh_token } });
      expect(refused.statusCode).toBe(401);
      const access = await cloud.app.inject({ method: 'GET', url: '/v1/admin/branches', headers: { authorization: `Bearer ${old.access_token}` } });
      expect(access.json().error.code).toBe('JWT_INVALID');
    }
    const fresh = await cloud.app.inject({ method: 'GET', url: '/v1/admin/branches', headers: { authorization: `Bearer ${data.access_token}` } });
    expect(fresh.statusCode).toBe(200);
    expect((await cloud.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: data.refresh_token } })).statusCode).toBe(200);

    expect((await login()).statusCode).toBe(401);
    expect((await login(NEW_PASSWORD)).statusCode).toBe(200);

    const audit = await cloud.pool.query(
      `SELECT entity, entity_id, action, actor_kind, actor_owner_user_id, before, after FROM config_audit WHERE tenant_id = $1 AND entity = 'owner_user'`,
      [owner.tenant_id],
    );
    expect(audit.rows).toEqual([
      {
        entity: 'owner_user',
        entity_id: owner.user_id,
        action: 'password_change',
        actor_kind: 'owner',
        actor_owner_user_id: owner.user_id,
        before: { credential_version: 0, password_changed_at: null },
        after: { credential_version: 1, password_changed_at: T + 60_000 },
      },
    ]);
  });

  it('[01b §3.7] a successful change clears must_change_password and the temporary password expiry', async () => {
    await cloud.pool.query(`UPDATE owner_users SET must_change_password = true, temp_password_expires_at = $2 WHERE user_id = $1`, [
      owner.user_id,
      T + 86_400_000,
    ]);
    const a = (await login()).json().data;
    const changed = await change(a.access_token, { current_password: PASSWORD, new_password: NEW_PASSWORD });
    expect(changed.statusCode).toBe(200);
    expect(await ownerRow()).toMatchObject({ must_change_password: false, temp_password_expires_at: null });
    const admin = await cloud.app.inject({
      method: 'GET',
      url: '/v1/admin/branches',
      headers: { authorization: `Bearer ${changed.json().data.access_token}` },
    });
    expect(admin.statusCode).toBe(200);
  });

  it('[01b #40] new = current → 422 PASSWORD_UNCHANGED; 9 characters → 400 VALIDATION_FAILED on new_password; nothing changed', async () => {
    const a = (await login()).json().data;
    const same = await change(a.access_token, { current_password: 'same-password-1', new_password: 'same-password-1' });
    expect(same.statusCode).toBe(422);
    expect(same.json().error.code).toBe('PASSWORD_UNCHANGED');
    const short = await change(a.access_token, { current_password: PASSWORD, new_password: '123456789' });
    expect(short.statusCode).toBe(400);
    expect(short.json().error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(short.json().error.details)).toContain('new_password');
    expect(await ownerRow()).toMatchObject({ credential_version: 0 });
  });

  it('[01b §6.11] a wrong current password → 401 PASSWORD_INVALID, nothing changed', async () => {
    const a = (await login()).json().data;
    const wrong = await change(a.access_token, { current_password: 'not-the-password', new_password: NEW_PASSWORD });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('PASSWORD_INVALID');
    expect(await ownerRow()).toMatchObject({ credential_version: 0 });
  });

  it('[01b #44] body.current_password and body.new_password are redacted in logs', async () => {
    const a = (await login()).json().data;
    expect((await change(a.access_token, { current_password: PASSWORD, new_password: NEW_PASSWORD })).statusCode).toBe(200);
    cloud.app.log.info({ body: { current_password: 'secret-current-1', new_password: 'secret-new-12345' } }, 'probe');
    const logs = cloud.logs();
    expect(logs).toContain('probe');
    expect(logs).toContain('[Redacted]');
    for (const secret of ['secret-current-1', 'secret-new-12345', NEW_PASSWORD, PASSWORD]) expect(logs).not.toContain(secret);
  });
});
