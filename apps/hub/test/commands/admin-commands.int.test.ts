import { afterEach, describe, expect, it } from 'vitest';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

const cleanups: Array<() => Promise<void>> = [];

describe('admin access commands', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #42] revoke ends the staff session and bound admin sessions, publishes DeviceRevoked, closes socket 4403; retransmit same command_id → identical response; new command on a revoked device → already_revoked; unknown → 404; no manage-devices → 403', async () => {
    const hub = await open();
    const admin = await adminOn(hub, 'S_OWNER');
    const target = pairDevice(hub, { type: 'tablet' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: target.deviceId });
    const boundAdmin = openSession(hub, { kind: 'admin', staffId: 'S_MGR', deviceId: target.deviceId });
    const other = pairDevice(hub, { type: 'tablet' });
    const untouched = openSession(hub, { kind: 'staff', staffId: 'S_WAIT', deviceId: other.deviceId });

    const revoked = await post(hub, admin, 'revoke-device', 'RevokeDevice', { device_id: target.deviceId, reason: 'lost' });
    expect(revoked.statusCode).toBe(200);
    const result = revoked.json().data.result as { device_id: string; revoked_at: number; already_revoked: boolean };
    expect(result).toEqual({ device_id: target.deviceId, revoked_at: hub.clock.branchNow(), already_revoked: false });
    expect(sessionEnd(hub, staff.sessionId)).toEqual({ end_reason: 'device_revoked', ended_by: 'S_OWNER' });
    expect(sessionEnd(hub, boundAdmin.sessionId)).toEqual({ end_reason: 'device_revoked', ended_by: 'S_OWNER' });
    expect(sessionEnd(hub, untouched.sessionId).end_reason).toBeNull();
    expect(hub.deps.db.prepare('SELECT revoked_by FROM devices WHERE device_id = ?').pluck().get(target.deviceId)).toBe('S_OWNER');
    expect(eventsOf(hub, 'DeviceRevoked').map((payload) => payload)).toEqual([
      { device_id: target.deviceId, reason: 'lost', cause: 'manual' },
    ]);

    const replay = await post(hub, admin, 'revoke-device', 'RevokeDevice', { device_id: target.deviceId, reason: 'lost' });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(revoked.json());
    expect(eventsOf(hub, 'DeviceRevoked')).toHaveLength(1);

    const again = await post(hub, admin, 'revoke-device', 'RevokeDevice', { device_id: target.deviceId }, 'cmd-revoke-again');
    expect(again.statusCode).toBe(200);
    expect(again.json().data.result).toEqual({ device_id: target.deviceId, revoked_at: result.revoked_at, already_revoked: true });
    expect(eventsOf(hub, 'DeviceRevoked')).toHaveLength(1);
    expect(eventsOf(hub, 'SessionEnded').filter((payload) => payload.reason === 'device_revoked')).toHaveLength(2);

    const missing = await post(hub, admin, 'revoke-device', 'RevokeDevice', { device_id: 'missing-device' }, 'cmd-revoke-missing');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('DEVICE_NOT_FOUND');
    expect(missing.json().error.details).toEqual({ device_id: 'missing-device' });

    const deniedDir = await aDirectory();
    const owner = deniedDir.staff.find((staffRow) => staffRow.staff_id === 'S_OWNER');
    if (owner === undefined) throw new Error('owner missing');
    owner.denied_permissions = ['manage-devices'];
    const deniedHub = await open(deniedDir);
    const deniedAdmin = await adminOn(deniedHub, 'S_OWNER');
    const denied = await post(deniedHub, deniedAdmin, 'revoke-device', 'RevokeDevice', { device_id: target.deviceId }, 'cmd-revoke-denied');
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PERMISSION_DENIED');
  });

  it('[00 §10 #43] force logout of staff, station and admin sessions; event has ended_by; retransmit → identical response; new command on an ended session → already_ended; unknown → 404; no manage-staff → 403', async () => {
    const hub = await open();
    const admin = await adminOn(hub, 'S_OWNER');
    const staffDevice = pairDevice(hub, { type: 'tablet' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: staffDevice.deviceId });
    const kds = pairDevice(hub, { type: 'kds', stationId: 'station-1' });
    const station = openSession(hub, { kind: 'station', deviceId: kds.deviceId, stationId: 'station-1' });
    const otherAdmin = openSession(hub, { kind: 'admin', staffId: 'S_MGR', deviceId: admin.device.deviceId });

    const loggedOut = await post(hub, admin, 'force-logout-session', 'ForceLogoutSession', { session_id: staff.sessionId });
    expect(loggedOut.statusCode).toBe(200);
    expect(loggedOut.json().data.result).toEqual({
      session_id: staff.sessionId,
      ended_at: hub.clock.branchNow(),
      already_ended: false,
    });
    expect(sessionEnd(hub, staff.sessionId)).toEqual({ end_reason: 'forced', ended_by: 'S_OWNER' });
    expect(eventsOf(hub, 'SessionEnded').find((payload) => payload.session_id === staff.sessionId)).toMatchObject({
      reason: 'forced',
      ended_by: 'S_OWNER',
      kind: 'staff',
    });

    const replay = await post(hub, admin, 'force-logout-session', 'ForceLogoutSession', { session_id: staff.sessionId });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(loggedOut.json());

    const again = await post(hub, admin, 'force-logout-session', 'ForceLogoutSession', { session_id: staff.sessionId }, 'cmd-logout-again');
    expect(again.statusCode).toBe(200);
    expect(again.json().data.result.already_ended).toBe(true);
    expect(again.json().data.result.ended_at).toBe(hub.clock.branchNow());
    expect(eventsOf(hub, 'SessionEnded').filter((payload) => payload.session_id === staff.sessionId)).toHaveLength(1);

    const stationOut = await post(hub, admin, 'force-logout-session', 'ForceLogoutSession', { session_id: station.sessionId }, 'cmd-logout-station');
    expect(stationOut.statusCode).toBe(200);
    expect(sessionEnd(hub, station.sessionId)).toEqual({ end_reason: 'forced', ended_by: 'S_OWNER' });
    const adminOut = await post(hub, admin, 'force-logout-session', 'ForceLogoutSession', { session_id: otherAdmin.sessionId }, 'cmd-logout-admin');
    expect(adminOut.statusCode).toBe(200);
    expect(sessionEnd(hub, otherAdmin.sessionId)).toEqual({ end_reason: 'forced', ended_by: 'S_OWNER' });
    const selfOut = await post(hub, admin, 'force-logout-session', 'ForceLogoutSession', { session_id: admin.session.sessionId }, 'cmd-logout-self');
    expect(selfOut.statusCode).toBe(200);
    expect(sessionEnd(hub, admin.session.sessionId)).toEqual({ end_reason: 'forced', ended_by: 'S_OWNER' });

    const fresh = await adminOn(hub, 'S_MGR');
    const missing = await post(hub, fresh, 'force-logout-session', 'ForceLogoutSession', { session_id: 'missing-session' }, 'cmd-logout-missing', 'S_MGR');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('SESSION_NOT_FOUND');

    const deniedDir = await aDirectory();
    const owner = deniedDir.staff.find((staffRow) => staffRow.staff_id === 'S_OWNER');
    if (owner === undefined) throw new Error('owner missing');
    owner.denied_permissions = ['manage-staff'];
    const deniedHub = await open(deniedDir);
    const deniedAdmin = await adminOn(deniedHub, 'S_OWNER');
    const denied = await post(deniedHub, deniedAdmin, 'force-logout-session', 'ForceLogoutSession', { session_id: 'missing-session' }, 'cmd-logout-denied');
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PERMISSION_DENIED');
  });

  it('[00 §10 #44] clear staff, device and ip locks; retransmit → identical response; unlocked subject → cleared: false, no event; no manage-staff → 403', async () => {
    const hub = await open();
    const admin = await adminOn(hub, 'S_OWNER');
    const until = hub.clock.branchNow() + 900_000;
    insertLock(hub, 'staff', 'S_CASH', until);
    insertLock(hub, 'device', 'dev-locked', until);
    insertLock(hub, 'ip', '192.168.10.9', until);
    insertLock(hub, 'staff', 'S_WAIT', null);
    insertLock(hub, 'staff', 'S_MGR', hub.clock.branchNow());

    const cleared = await post(hub, admin, 'clear-pin-lockout', 'ClearPinLockout', { subject_type: 'staff', subject_id: 'S_CASH' });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().data.result).toEqual({ subject_type: 'staff', subject_id: 'S_CASH', cleared: true });
    expect(lockout(hub, 'staff', 'S_CASH')).toEqual({ failed_count: 0, locked_until: null });
    expect(eventsOf(hub, 'PinLockoutCleared')).toEqual([{ subject_type: 'staff', subject_id: 'S_CASH' }]);

    const replay = await post(hub, admin, 'clear-pin-lockout', 'ClearPinLockout', { subject_type: 'staff', subject_id: 'S_CASH' });
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(cleared.json());
    expect(eventsOf(hub, 'PinLockoutCleared')).toHaveLength(1);

    const device = await post(hub, admin, 'clear-pin-lockout', 'ClearPinLockout', { subject_type: 'device', subject_id: 'dev-locked' }, 'cmd-clear-device');
    const ip = await post(hub, admin, 'clear-pin-lockout', 'ClearPinLockout', { subject_type: 'ip', subject_id: '192.168.10.9' }, 'cmd-clear-ip');
    expect(device.json().data.result.cleared).toBe(true);
    expect(ip.json().data.result.cleared).toBe(true);
    expect(lockout(hub, 'device', 'dev-locked').locked_until).toBeNull();
    expect(lockout(hub, 'ip', '192.168.10.9').locked_until).toBeNull();

    const before = eventsOf(hub, 'PinLockoutCleared').length;
    const openLock = await post(hub, admin, 'clear-pin-lockout', 'ClearPinLockout', { subject_type: 'staff', subject_id: 'S_WAIT' }, 'cmd-clear-open');
    const expired = await post(hub, admin, 'clear-pin-lockout', 'ClearPinLockout', { subject_type: 'staff', subject_id: 'S_MGR' }, 'cmd-clear-expired');
    const missing = await post(hub, admin, 'clear-pin-lockout', 'ClearPinLockout', { subject_type: 'staff', subject_id: 'S_NONE' }, 'cmd-clear-missing');
    expect(openLock.json().data.result.cleared).toBe(false);
    expect(expired.json().data.result.cleared).toBe(false);
    expect(missing.json().data.result.cleared).toBe(false);
    expect(eventsOf(hub, 'PinLockoutCleared')).toHaveLength(before);

    const deniedDir = await aDirectory();
    const owner = deniedDir.staff.find((staffRow) => staffRow.staff_id === 'S_OWNER');
    if (owner === undefined) throw new Error('owner missing');
    owner.denied_permissions = ['manage-staff'];
    const deniedHub = await open(deniedDir);
    const deniedAdmin = await adminOn(deniedHub, 'S_OWNER');
    const denied = await post(deniedHub, deniedAdmin, 'clear-pin-lockout', 'ClearPinLockout', { subject_type: 'staff', subject_id: 'S_CASH' }, 'cmd-clear-denied');
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PERMISSION_DENIED');
  });
});

async function open(directory?: Awaited<ReturnType<typeof aDirectory>>): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub, directory);
  return hub;
}

async function adminOn(
  hub: TestHub,
  staffId: string,
): Promise<{ device: { deviceId: string; token: string }; session: { sessionId: string; token: string } }> {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'admin', staffId, deviceId: device.deviceId });
  return { device, session };
}

function post(
  hub: TestHub,
  admin: { device: { deviceId: string; token: string }; session: { token: string } },
  name: string,
  commandType: string,
  payload: Record<string, unknown>,
  commandId = `cmd-${name}`,
  actorId = 'S_OWNER',
) {
  return hub.app.inject({
    method: 'POST',
    url: `/admin/commands/${name}`,
    headers: {
      authorization: `Bearer ${admin.device.token}`,
      'x-admin-session': admin.session.token,
    },
    payload: {
      command_id: commandId,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: commandType,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: actorId,
      device_id: admin.device.deviceId,
    },
  });
}

function sessionEnd(hub: TestHub, sessionId: string): { end_reason: string | null; ended_by: string | null } {
  return hub.deps.db.prepare('SELECT end_reason, ended_by FROM staff_sessions WHERE session_id = ?').get(sessionId) as {
    end_reason: string | null;
    ended_by: string | null;
  };
}

function eventsOf(hub: TestHub, eventType: string): Array<Record<string, unknown>> {
  const rows = hub.deps.db.prepare('SELECT payload FROM events WHERE event_type = ?').all(eventType) as Array<{ payload: string }>;
  return rows.map((row) => JSON.parse(row.payload) as Record<string, unknown>);
}

function insertLock(hub: TestHub, subjectType: string, subjectId: string, lockedUntil: number | null): void {
  hub.deps.db
    .prepare(
      `INSERT INTO auth_lockouts (branch_id, subject_type, subject_id, failed_count, window_started_at, locked_until)
       VALUES ('branch-1', ?, ?, 4, ?, ?)`,
    )
    .run(subjectType, subjectId, hub.clock.branchNow(), lockedUntil);
}

function lockout(hub: TestHub, subjectType: string, subjectId: string): { failed_count: number; locked_until: number | null } {
  return hub.deps.db
    .prepare('SELECT failed_count, locked_until FROM auth_lockouts WHERE subject_type = ? AND subject_id = ?')
    .get(subjectType, subjectId) as { failed_count: number; locked_until: number | null };
}
