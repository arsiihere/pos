import { issueAdminBootstrap } from '../../src/auth/bootstrap-tokens';
import { authSemaphores } from '../../src/auth/admin-session';
import { checkPin } from '../../src/auth/pin';
import { currentDirectory } from '../../src/auth/guards';
import { afterEach, describe, expect, it } from 'vitest';
import { PIN } from '../helpers/fixtures';
import { createTestHub, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

const cleanups: Array<() => Promise<void>> = [];

describe('admin session', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #26] tablet admin login binds the session and a non-admin PIN resets the staff counter', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const ok = await login(hub, tablet.token, 'S_OWNER', PIN.a);
    expect(ok.statusCode).toBe(200);
    const body = ok.json().data;
    expect(body.staff_id).toBe('S_OWNER');
    expect(body.display_name).toBe('Owner');
    expect(body.idle_ttl_ms).toBe(3_600_000);
    const row = hub.deps.db.prepare('SELECT device_id, kind FROM staff_sessions WHERE session_id = ?').get(body.session_id) as {
      device_id: string;
      kind: string;
    };
    expect(row).toEqual({ device_id: tablet.deviceId, kind: 'admin' });

    expect((await login(hub, tablet.token, 'S_CASH', '0000')).statusCode).toBe(401);
    const denied = await login(hub, tablet.token, 'S_CASH', PIN.c);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PERMISSION_DENIED');
    expect(staffFailures(hub, 'S_CASH')).toBe(0);
  });

  it('[00 §10 #27] ten failures from one device across staff lock the device', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const plan = [
      ['S_OWNER', 3],
      ['S_MGR', 3],
      ['S_CASH', 3],
      ['S_WAIT', 1],
    ] as const;
    for (const [staffId, count] of plan) {
      for (let i = 0; i < count; i += 1) {
        const res = await login(hub, tablet.token, staffId, '0000');
        expect(res.statusCode).toBe(401);
        expect(res.json().error.code).toBe('PIN_INVALID');
      }
    }
    const locked = await login(hub, tablet.token, 'S_OWNER', PIN.a);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('DEVICE_LOCKED_OUT');
  });

  it('[00 §10 #40] admin logout is idempotent', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const opened = await login(hub, tablet.token, 'S_OWNER', PIN.a);
    const token = opened.json().data.admin_session_token as string;
    const first = await logout(hub, tablet.token, token);
    expect(first.statusCode).toBe(200);
    expect(first.json().data.already_ended).toBe(false);
    const second = await logout(hub, tablet.token, token);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.already_ended).toBe(true);
    expect(second.json().data.session_id).toBe(first.json().data.session_id);
    expect(endedEvents(hub)).toBe(1);
  });

  it('[00 §10 #41] the login roster lists admin staff for a tablet or a live bootstrap token', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const until = hub.clock.branchNow() + 900_000;
    hub.deps.db
      .prepare(
        `INSERT INTO auth_lockouts (branch_id, subject_type, subject_id, failed_count, window_started_at, locked_until)
         VALUES ('branch-1', 'staff', 'S_OWNER', 5, ?, ?)`,
      )
      .run(hub.clock.branchNow(), until);
    const withDevice = await roster(hub, { authorization: `Bearer ${tablet.token}` });
    expect(withDevice.statusCode).toBe(200);
    expect(withDevice.json().data.staff).toEqual([
      { staff_id: 'S_MGR', display_name: 'Manager', locked_until: null },
      { staff_id: 'S_OWNER', display_name: 'Owner', locked_until: until },
    ]);
    const issued = hub.deps.writer.run((tx) =>
      issueAdminBootstrap(tx, 'setup', { clock: hub.deps.clock, ids: hub.deps.ids, secrets: hub.deps.secrets }),
    ).result;
    const withBootstrap = await roster(hub, { 'x-admin-bootstrap': issued.token });
    expect(withBootstrap.statusCode).toBe(200);
    expect(withBootstrap.json().data.staff).toEqual(withDevice.json().data.staff);
    const neither = await roster(hub, {});
    expect(neither.statusCode).toBe(401);
    const ownerPhone = pairDevice(hub, { type: 'phone', ownerStaffId: 'S_OWNER' });
    const ownerRoster = await roster(hub, { authorization: `Bearer ${ownerPhone.token}` });
    expect(ownerRoster.statusCode).toBe(200);
    expect(ownerRoster.json().data.staff).toEqual([{ staff_id: 'S_OWNER', display_name: 'Owner', locked_until: until }]);
    const waiterPhone = pairDevice(hub, { type: 'phone', ownerStaffId: 'S_WAIT' });
    const waiterRoster = await roster(hub, { authorization: `Bearer ${waiterPhone.token}` });
    expect(waiterRoster.statusCode).toBe(200);
    expect(waiterRoster.json().data.staff).toEqual([]);
  });

  it('[00 §10 #91] admin login requires an allowed device and the session stays on that device', async () => {
    const hub = await open();
    expect((await login(hub, undefined, 'S_OWNER', PIN.a)).statusCode).toBe(401);
    const kds = pairDevice(hub, { type: 'kds', stationId: 'station-1' });
    const kdsRes = await login(hub, kds.token, 'S_OWNER', PIN.a);
    expect(kdsRes.statusCode).toBe(403);
    expect(kdsRes.json().error.code).toBe('DEVICE_TYPE_NOT_ALLOWED');

    const phone = pairDevice(hub, { type: 'phone', ownerStaffId: 'S_OWNER' });
    const other = await login(hub, phone.token, 'S_MGR', PIN.b);
    expect(other.statusCode).toBe(403);
    expect(other.json().error.code).toBe('DEVICE_NOT_OWNED');
    expect(staffFailures(hub, 'S_MGR')).toBe(0);
    const owner = await login(hub, phone.token, 'S_OWNER', PIN.a);
    expect(owner.statusCode).toBe(200);

    const tabletA = pairDevice(hub, { type: 'tablet' });
    const tabletB = pairDevice(hub, { type: 'tablet' });
    const session = (await login(hub, tabletA.token, 'S_OWNER', PIN.a)).json().data.admin_session_token as string;
    const crossed = await logout(hub, tabletB.token, session);
    expect(crossed.statusCode).toBe(401);
    expect(crossed.json().error.code).toBe('ADMIN_SESSION_REQUIRED');
  });

  it('[00 §10 #93] a full PIN semaphore does not delay admin login and a full admin semaphore does not delay PIN verify', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const semaphores = authSemaphores(hub.app);
    const pinReleases = [await semaphores.pin.acquire(1_000), await semaphores.pin.acquire(1_000)];
    const adminLogin = await login(hub, tablet.token, 'S_OWNER', PIN.a);
    expect(adminLogin.statusCode).toBe(200);
    for (const release of pinReleases) release();

    const adminRelease = await semaphores.admin.acquire(1_000);
    const directory = currentDirectory(hub.app);
    await expect(
      checkPin(
        {
          db: hub.deps.db,
          writer: hub.deps.writer,
          directory: () => directory,
          clock: hub.deps.clock,
          config: hub.deps.config,
          semaphore: semaphores.pin,
          verify: async () => true,
        },
        { staffId: 'S_MGR', pin: PIN.b, subject: { type: 'device', id: tablet.deviceId }, eventDeviceId: tablet.deviceId },
        () => 'ok',
      ),
    ).resolves.toBe('ok');
    adminRelease();
  });

  it('[00 §10 #114] unknown staff is STAFF_NOT_FOUND and a locked staff is PIN_LOCKED_OUT on admin login', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const missing = await login(hub, tablet.token, 'S_MISSING', PIN.a);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('STAFF_NOT_FOUND');
    for (let i = 0; i < 5; i += 1) {
      expect((await login(hub, tablet.token, 'S_OWNER', '0000')).json().error.code).toBe('PIN_INVALID');
    }
    const locked = await login(hub, tablet.token, 'S_OWNER', PIN.a);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('PIN_LOCKED_OUT');
  });
});

async function open(): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub);
  return hub;
}

function login(hub: TestHub, token: string | undefined, staffId: string, pin: string) {
  return hub.app.inject({
    method: 'POST',
    url: '/admin/auth',
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    payload: { staff_id: staffId, pin },
  });
}

function logout(hub: TestHub, deviceToken: string, sessionToken: string) {
  return hub.app.inject({
    method: 'POST',
    url: '/admin/auth/logout',
    headers: { authorization: `Bearer ${deviceToken}`, 'x-admin-session': sessionToken },
    payload: {},
  });
}

function roster(hub: TestHub, headers: Record<string, string>) {
  return hub.app.inject({ method: 'GET', url: '/admin/login-roster', headers });
}

function staffFailures(hub: TestHub, staffId: string): number {
  const row = hub.deps.db
    .prepare(`SELECT failed_count FROM auth_lockouts WHERE subject_type = 'staff' AND subject_id = ?`)
    .get(staffId) as { failed_count: number } | undefined;
  return row?.failed_count ?? 0;
}

function endedEvents(hub: TestHub): number {
  const row = hub.deps.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_type = 'SessionEnded'`).get() as { n: number };
  return row.n;
}
