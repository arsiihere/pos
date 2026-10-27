import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetOwnerPassword } from '../../src/cli/reset-owner-password';
import { SystemContext } from '../../src/cli/system-context';
import { seedTenant } from '../../src/cli/seed-tenant';
import { testIdGen, ulidGen } from '../../src/lib/ids';
import { cryptoSecrets } from '../../src/lib/secrets';
import { createTestCloud, truncateAll, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;
const PASSWORD = 'password-1';
const NEW_PASSWORD = 'a-much-better-passphrase';
// §6.11 step 5, m11: each race test runs this many times (task 40: 20 runs without a failure).
const RUNS = 20;

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
  const fresh = async () => {
    cloud.clock.set(T);
    await truncateAll(cloud.pool);
    owner = await seedTenant(
      new SystemContext(cloud.pool),
      { name: 'Pilot', currency: 'PKR', ownerEmail: 'owner@example.com', ownerName: 'Ada', password: PASSWORD, pin: '1234' },
      { clock: cloud.clock, ids: testIdGen() },
    );
  };
  beforeEach(fresh);

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

  const counters = async () =>
    (
      await cloud.pool.query<{ failed_login_count: number; login_locked_until: string | null; lock_notice_at: string | null }>(
        `SELECT failed_login_count, login_locked_until, lock_notice_at FROM owner_users WHERE user_id = $1`,
        [owner.user_id],
      )
    ).rows[0]!;
  const changeFrom = (from: string, token: string, payload: object) =>
    cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload,
      remoteAddress: from,
    });
  const loginFrom = (from: string, password: string) =>
    cloud.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'owner@example.com', password }, remoteAddress: from });

  it('[01b #38] wrong current → 401 PASSWORD_INVALID, account counter +1 and per-IP failure counted; the 10th sets the lock and lock_notice_at', async () => {
    const a = (await login()).json().data;
    const from = '10.9.0.1';
    for (let i = 1; i <= 9; i += 1) {
      cloud.clock.set(T + i);
      const wrong = await changeFrom(from, a.access_token, { current_password: `wrong-${i}`, new_password: NEW_PASSWORD });
      expect(wrong.statusCode).toBe(401);
      expect(wrong.json().error.code).toBe('PASSWORD_INVALID');
      expect(await counters()).toMatchObject({ failed_login_count: i, login_locked_until: null, lock_notice_at: null });
    }
    cloud.clock.set(T + 10);
    const tenth = await changeFrom(from, a.access_token, { current_password: 'wrong-10', new_password: NEW_PASSWORD });
    expect(tenth.json().error.code).toBe('PASSWORD_INVALID');
    expect(await counters()).toMatchObject({ failed_login_count: 10, login_locked_until: String(T + 10 + 900_000), lock_notice_at: String(T + 10) });
    expect(await ownerRow()).toMatchObject({ credential_version: 0 });

    // The per-IP limiter is login's: 10 change failures + 20 login failures from one IP → the 31st request is 429.
    for (let i = 0; i < 20; i += 1) expect((await loginFrom(from, 'wrong-login')).statusCode).toBe(401);
    const limited = await loginFrom(from, PASSWORD);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('IP_LOCKED_OUT');
    const limitedChange = await changeFrom(from, a.access_token, { current_password: PASSWORD, new_password: NEW_PASSWORD });
    expect(limitedChange.statusCode).toBe(429);
  });

  it('[01b #39] locked account → 401 PASSWORD_INVALID even with the right password, account counter unchanged, per-IP failure counted', async () => {
    const a = (await login()).json().data;
    const lockedUntil = T + 900_000;
    await cloud.pool.query(`UPDATE owner_users SET failed_login_count = 10, login_locked_until = $2 WHERE user_id = $1`, [owner.user_id, lockedUntil]);
    const from = '10.9.0.2';
    for (let i = 0; i < 30; i += 1) {
      const refused = await changeFrom(from, a.access_token, { current_password: PASSWORD, new_password: NEW_PASSWORD });
      expect(refused.statusCode).toBe(401);
      expect(refused.json().error.code).toBe('PASSWORD_INVALID');
    }
    expect(await counters()).toMatchObject({ failed_login_count: 10, login_locked_until: String(lockedUntil), lock_notice_at: null });
    expect(await ownerRow()).toMatchObject({ credential_version: 0 });
    // Each of the 30 counted for the IP.
    expect((await changeFrom(from, a.access_token, { current_password: PASSWORD, new_password: NEW_PASSWORD })).statusCode).toBe(429);

    // Once the lock has passed, the right password changes it.
    cloud.clock.set(lockedUntil);
    const changed = await changeFrom('10.9.0.3', a.access_token, { current_password: PASSWORD, new_password: NEW_PASSWORD });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(await counters()).toMatchObject({ failed_login_count: 0, login_locked_until: null });
  });

  // Holds the owner row FOR NO KEY UPDATE on its own connection, so requests queue behind it in a known order.
  const holdOwnerRow = async () => {
    const client = await cloud.pool.connect();
    await client.query('BEGIN');
    await client.query(`SELECT 1 FROM owner_users WHERE user_id = $1 FOR NO KEY UPDATE`, [owner.user_id]);
    return {
      release: async () => {
        await client.query('COMMIT');
        client.release();
      },
    };
  };
  const lockWaiters = async (n: number) => {
    for (let i = 0; i < 500; i += 1) {
      const waiting = await cloud.pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if (waiting.rows[0]!.n >= n) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`expected ${n} lock waiters`);
  };
  const auditRows = async () =>
    (await cloud.pool.query<{ action: string }>(`SELECT action FROM config_audit WHERE entity = 'owner_user' ORDER BY at, audit_id`)).rows.map(
      (row) => row.action,
    );

  it('[01b #43] change-password and a login with the old password: a login that verified before the change committed and locks after it → 401 LOGIN_INVALID, nothing counted', async () => {
    for (let run = 0; run < RUNS; run += 1) {
      if (run > 0) await fresh();
      const a = (await login()).json().data;
      const held = await holdOwnerRow();
      const changing = changeFrom('10.8.0.1', a.access_token, { current_password: PASSWORD, new_password: NEW_PASSWORD });
      await lockWaiters(1);
      // The login reads the old hash and verifies it while the change waits; it then queues behind the change.
      const signingIn = loginFrom('10.8.0.2', PASSWORD);
      await lockWaiters(2);
      await held.release();
      const [changed, signedIn] = await Promise.all([changing, signingIn]);
      expect(changed.statusCode, changed.body).toBe(200);
      expect(signedIn.statusCode).toBe(401);
      expect(signedIn.json().error.code).toBe('LOGIN_INVALID');
      expect(await counters()).toMatchObject({ failed_login_count: 0, login_locked_until: null });
      const live = await cloud.pool.query(`SELECT COUNT(*)::int AS n FROM owner_refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, [owner.user_id]);
      expect(live.rows[0].n).toBe(1);
      // A login after the commit with the old password fails too; the new one works.
      expect((await loginFrom('10.8.0.3', PASSWORD)).statusCode).toBe(401);
      expect((await loginFrom('10.8.0.4', NEW_PASSWORD)).statusCode).toBe(200);
    }
  }, 120_000);

  it('[01b #90] two identical change-password requests released together: one 200, one 401 PASSWORD_INVALID, one audit row; a change that verified before a reset committed → 401, the temporary password still works', async () => {
    for (let run = 0; run < RUNS; run += 1) {
      if (run > 0) await fresh();
      const a = (await login()).json().data;
      const held = await holdOwnerRow();
      const body = { current_password: PASSWORD, new_password: NEW_PASSWORD };
      const first = changeFrom('10.8.1.1', a.access_token, body);
      const second = changeFrom('10.8.1.2', a.access_token, body);
      await lockWaiters(2);
      await held.release();
      const answers = await Promise.all([first, second]);
      expect(answers.map((response) => response.statusCode).sort()).toEqual([200, 401]);
      const won = answers.find((response) => response.statusCode === 200)!;
      const lost = answers.find((response) => response.statusCode === 401)!;
      expect(lost.json().error.code).toBe('PASSWORD_INVALID');
      // Not a guess: the loser is not counted.
      expect(await counters()).toMatchObject({ failed_login_count: 0 });
      const tokens = won.json().data;
      expect((await cloud.app.inject({ method: 'GET', url: '/v1/admin/branches', headers: { authorization: `Bearer ${tokens.access_token}` } })).statusCode).toBe(200);
      expect((await cloud.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: tokens.refresh_token } })).statusCode).toBe(200);
      expect((await loginFrom('10.8.1.3', NEW_PASSWORD)).statusCode).toBe(200);
      expect(await auditRows()).toEqual(['password_change']);

      // A change that verified the current password while a reset held the row: the reset commits first.
      const b = (await loginFrom('10.8.1.4', NEW_PASSWORD)).json().data;
      let releaseReset: () => void = () => undefined;
      let resetLocked: () => void = () => undefined;
      const locked = new Promise<void>((resolve) => {
        resetLocked = resolve;
      });
      const resetting = resetOwnerPassword(
        new SystemContext(cloud.pool),
        { email: 'owner@example.com' },
        { clock: cloud.clock, ids: ulidGen(cloud.clock), secrets: cryptoSecrets },
        {
          afterOwnerRowLock: () => {
            resetLocked();
            return new Promise<void>((resolve) => {
              releaseReset = resolve;
            });
          },
        },
      );
      await locked;
      const late = changeFrom('10.8.1.5', b.access_token, { current_password: NEW_PASSWORD, new_password: 'yet-another-passphrase' });
      await lockWaiters(1);
      releaseReset();
      const { temporaryPassword } = await resetting;
      const refused = await late;
      expect(refused.statusCode).toBe(401);
      expect(refused.json().error.code).toBe('PASSWORD_INVALID');
      expect(await ownerRow()).toMatchObject({ must_change_password: true, credential_version: 2 });
      const temp = await loginFrom('10.8.1.6', temporaryPassword);
      expect(temp.statusCode, temp.body).toBe(200);
      expect(temp.json().data.user.must_change_password).toBe(true);
      expect(await auditRows()).toEqual(['password_change', 'password_reset']);
    }
  }, 120_000);

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
