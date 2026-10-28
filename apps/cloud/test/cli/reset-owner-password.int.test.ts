import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runResetOwnerPassword } from '../../src/cli/reset-owner-password';
import { seedTenant } from '../../src/cli/seed-tenant';
import { SystemContext } from '../../src/cli/system-context';
import { testIdGen, ulidGen } from '../../src/lib/ids';
import { cryptoSecrets } from '../../src/lib/secrets';
import { createTestCloud, truncateAll, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;
const DAY = 86_400_000;
const PASSWORD = 'password-1';
const NEW_PASSWORD = 'a-much-better-passphrase';

describe('reset-owner-password CLI (01b §6.14, B5)', () => {
  let cloud: TestCloud;
  let owner: { tenant_id: string; user_id: string };
  let out: string[];
  let errors: string[];
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
    out = [];
    errors = [];
  });

  const reset = (...argv: string[]) =>
    runResetOwnerPassword(argv, {
      sys: new SystemContext(cloud.pool),
      clock: cloud.clock,
      ids: ulidGen(cloud.clock),
      secrets: cryptoSecrets,
      out: (line) => out.push(line),
      err: (line) => errors.push(line),
    });
  const login = (password: string, from = `10.4.0.${++ip % 250}`) =>
    cloud.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'owner@example.com', password }, remoteAddress: from });
  const ownerRow = async () =>
    (
      await cloud.pool.query(
        `SELECT must_change_password, temp_password_expires_at, credential_version, password_changed_at, failed_login_count, login_locked_until, lock_notice_at
           FROM owner_users WHERE user_id = $1`,
        [owner.user_id],
      )
    ).rows[0];
  const temporaryPassword = () => {
    const printed = out.join('\n').match(/\b[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}\b/g);
    expect(printed).toHaveLength(1);
    return printed![0]!;
  };

  it('[01b #41] prints a 19-character temporary password and its expiry once, sets must_change_password and the 24 h expiry, revokes tokens; login → must_change_password, no pwc; admin routes 403 until the change; the old token then 401, the new 200', async () => {
    const before = (await login(PASSWORD)).json().data;
    // A lock and a notice from earlier failures are cleared by the reset.
    await cloud.pool.query(`UPDATE owner_users SET failed_login_count = 10, login_locked_until = $2, lock_notice_at = $3 WHERE user_id = $1`, [
      owner.user_id,
      T + 900_000,
      T,
    ]);
    cloud.clock.set(T + 1_000);
    expect(await reset('--email', 'OWNER@example.com')).toBe(0);
    expect(errors).toEqual([]);
    const temp = temporaryPassword();
    expect(temp).toHaveLength(19);
    expect(out.join('\n')).toContain(new Date(T + 1_000 + DAY).toISOString());
    expect(await ownerRow()).toMatchObject({
      must_change_password: true,
      temp_password_expires_at: String(T + 1_000 + DAY),
      credential_version: 1,
      password_changed_at: String(T + 1_000),
      failed_login_count: 0,
      login_locked_until: null,
      lock_notice_at: null,
    });
    const live = await cloud.pool.query(`SELECT COUNT(*)::int AS n FROM owner_refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, [owner.user_id]);
    expect(live.rows[0].n).toBe(0);
    expect((await cloud.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: before.refresh_token } })).statusCode).toBe(401);
    const audit = await cloud.pool.query(`SELECT actor_kind, entity, entity_id, action, before, after FROM config_audit WHERE entity = 'owner_user'`);
    expect(audit.rows).toEqual([
      {
        actor_kind: 'cli',
        entity: 'owner_user',
        entity_id: owner.user_id,
        action: 'password_reset',
        before: { credential_version: 0, password_changed_at: null, temp_password_expires_at: null },
        after: { credential_version: 1, password_changed_at: T + 1_000, temp_password_expires_at: T + 1_000 + DAY },
      },
    ]);

    // The old password no longer works; the temporary one does, with must_change_password and no pwc claim.
    expect((await login(PASSWORD)).statusCode).toBe(401);
    const signedIn = await login(temp);
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    const tokens = signedIn.json().data;
    expect(tokens.user.must_change_password).toBe(true);
    const claims = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString('utf8'));
    expect(claims).not.toHaveProperty('pwc');
    expect(claims.cv).toBe(1);
    const auth = (token: string) => ({ authorization: `Bearer ${token}` });
    const staff = await cloud.app.inject({ method: 'GET', url: '/v1/admin/staff', headers: auth(tokens.access_token) });
    expect(staff.statusCode).toBe(403);
    expect(staff.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    // The change clears both fields; the token from before it → 401, the change's token → 200.
    const changed = await cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: auth(tokens.access_token),
      payload: { current_password: temp, new_password: NEW_PASSWORD },
      remoteAddress: '10.5.0.1',
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(await ownerRow()).toMatchObject({ must_change_password: false, temp_password_expires_at: null });
    const stale = await cloud.app.inject({ method: 'GET', url: '/v1/admin/staff', headers: auth(tokens.access_token) });
    expect(stale.statusCode).toBe(401);
    expect(stale.json().error.code).toBe('JWT_INVALID');
    const fresh = await cloud.app.inject({ method: 'GET', url: '/v1/admin/staff', headers: auth(changed.json().data.access_token) });
    expect(fresh.statusCode, fresh.body).toBe(200);

    // The application never logs the temporary password.
    expect(cloud.logs()).not.toContain(temp);
  });

  it('[01b §6.14] an unknown email → exit 1, nothing written, nothing printed', async () => {
    expect(await reset('--email', 'nobody@example.com')).toBe(1);
    expect(out).toEqual([]);
    expect(errors.join('\n')).toMatch(/unknown/i);
    expect(await ownerRow()).toMatchObject({ must_change_password: false, credential_version: 0 });
    expect(await reset()).toBe(1);
    expect(await reset('--email')).toBe(1);
  });

  it('[01b #75] the temporary password works until +24 h − 1 ms; at +24 h → 401 LOGIN_INVALID, counted for the account and the IP; the CHECK refuses an expiry without must_change_password; a change sets the expiry to null', async () => {
    expect(await reset('--email', 'owner@example.com')).toBe(0);
    const temp = temporaryPassword();
    cloud.clock.set(T + DAY - 1);
    expect((await login(temp)).statusCode).toBe(200);

    cloud.clock.set(T + DAY);
    const from = '10.6.0.1';
    const expired = await login(temp, from);
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe('LOGIN_INVALID');
    expect(await ownerRow()).toMatchObject({ failed_login_count: 1 });
    // Counted for the IP: 29 more failures from it, then 429.
    for (let i = 0; i < 29; i += 1) expect((await login('wrong-password', from)).statusCode).toBe(401);
    expect((await login(temp, from)).statusCode).toBe(429);

    await expect(
      cloud.pool.query(`UPDATE owner_users SET must_change_password = false WHERE user_id = $1`, [owner.user_id]),
    ).rejects.toMatchObject({ code: '23514', constraint: 'owner_users_temp_password' });

    // A fresh reset, then a change: the expiry is cleared.
    cloud.clock.set(T + DAY + 1_000);
    out = [];
    expect(await reset('--email', 'owner@example.com')).toBe(0);
    const second = temporaryPassword();
    const tokens = (await login(second)).json().data;
    const changed = await cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: { authorization: `Bearer ${tokens.access_token}` },
      payload: { current_password: second, new_password: NEW_PASSWORD },
      remoteAddress: '10.6.0.2',
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(await ownerRow()).toMatchObject({ must_change_password: false, temp_password_expires_at: null });
  });
});
