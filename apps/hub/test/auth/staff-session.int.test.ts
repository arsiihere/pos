import { authSemaphores } from '../../src/auth/admin-session';
import { afterEach, describe, expect, it } from 'vitest';
import { PIN } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

const cleanups: Array<() => Promise<void>> = [];

describe('staff PIN session', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #31] PIN login, wrong PIN attempts_remaining, then the 5th failure locks the staff', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const ok = await pin(hub, tablet.token, 'S_CASH', PIN.c);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({
      staff_id: 'S_CASH',
      role_ids: ['R_CASH'],
      display_name: 'Cashier',
      idle_ttl_ms: 1_800_000,
    });
    const sessionId = ok.json().data.session_id as string;
    expect(typeof ok.json().data.session_token).toBe('string');
    expect(sessionRow(hub, sessionId)).toEqual({ device_id: tablet.deviceId, kind: 'staff', staff_id: 'S_CASH' });

    const wrong = await pin(hub, tablet.token, 'S_OWNER', '0000');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('PIN_INVALID');
    expect(wrong.json().error.details).toEqual({ attempts_remaining: 4 });
    for (let i = 0; i < 3; i += 1) {
      expect((await pin(hub, tablet.token, 'S_OWNER', '0000')).json().error.code).toBe('PIN_INVALID');
    }
    expect(lockEvents(hub, 'StaffPinLockedOut')).toHaveLength(0);
    const fifth = await pin(hub, tablet.token, 'S_OWNER', '0000');
    expect(fifth.statusCode).toBe(401);
    expect(fifth.json().error.details).toEqual({ attempts_remaining: 0 });
    expect(lockEvents(hub, 'StaffPinLockedOut')).toMatchObject([{ staff_id: 'S_OWNER', failed_count: 5 }]);
    const locked = await pin(hub, tablet.token, 'S_OWNER', PIN.a);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('PIN_LOCKED_OUT');
    expect(locked.headers['retry-after']).toBe('900');
  });

  it('[00 §10 #32] ten failures from one device across staff lock the device', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const plan = [
      ['S_OWNER', 4],
      ['S_MGR', 4],
      ['S_CASH', 2],
    ] as const;
    for (const [staffId, count] of plan) {
      for (let i = 0; i < count; i += 1) {
        const res = await pin(hub, tablet.token, staffId, '0000');
        expect(res.statusCode).toBe(401);
        expect(res.json().error.code).toBe('PIN_INVALID');
      }
    }
    expect(lockEvents(hub, 'DevicePinLockedOut')).toMatchObject([
      { subject_type: 'device', subject_id: tablet.deviceId, failed_count: 10 },
    ]);
    const locked = await pin(hub, tablet.token, 'S_WAIT', PIN.a);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('DEVICE_LOCKED_OUT');
  });

  it('[00 §10 #33] the same staff logging in again ends the previous session replaced', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const first = await pin(hub, tablet.token, 'S_CASH', PIN.c);
    const firstId = first.json().data.session_id as string;
    const second = await pin(hub, tablet.token, 'S_CASH', PIN.c);
    expect(second.statusCode).toBe(200);
    const secondId = second.json().data.session_id as string;
    expect(secondId).not.toBe(firstId);
    expect(endReason(hub, firstId)).toBe('replaced');
    expect(sessionEnded(hub, firstId)).toMatchObject({ reason: 'replaced', ended_by: 'S_CASH', kind: 'staff' });
    expect(endReason(hub, secondId)).toBeNull();
  });

  it('[00 §10 #34] another staff member without takeover gets 409 and nothing is written', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const holder = await pin(hub, tablet.token, 'S_CASH', PIN.c);
    const holderId = holder.json().data.session_id as string;
    const wrong = await pin(hub, tablet.token, 'S_MGR', '0000');
    expect(wrong.statusCode).toBe(401);
    expect(staffFailures(hub, 'S_MGR')).toBe(1);
    expect(deviceFailures(hub, tablet.deviceId)).toBe(1);
    const before = eventCount(hub);
    const conflict = await pin(hub, tablet.token, 'S_MGR', PIN.b);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('DEVICE_SESSION_ACTIVE');
    expect(conflict.json().error.details).toEqual({
      staff_id: 'S_CASH',
      display_name: 'Cashier',
      can_take_over: true,
    });
    expect(eventCount(hub)).toBe(before);
    expect(endReason(hub, holderId)).toBeNull();
    expect(activeStaff(hub, tablet.deviceId)).toEqual([holderId]);
    expect(staffFailures(hub, 'S_MGR')).toBe(0);
    expect(deviceFailures(hub, tablet.deviceId)).toBe(1);
  });

  it('[00 §10 #35] takeover ends the holder taken_over with ended_by the new staff', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const holder = await pin(hub, tablet.token, 'S_CASH', PIN.c);
    const holderId = holder.json().data.session_id as string;
    const taken = await pin(hub, tablet.token, 'S_MGR', PIN.b, { takeover: true });
    expect(taken.statusCode).toBe(200);
    expect(taken.json().data.staff_id).toBe('S_MGR');
    expect(sessionEnded(hub, holderId)).toMatchObject({
      reason: 'taken_over',
      ended_by: 'S_MGR',
      staff_id: 'S_CASH',
      kind: 'staff',
    });
    expect(activeStaff(hub, tablet.deviceId)).toEqual([taken.json().data.session_id]);
  });

  it('[00 §10 #36] kds, a guest IP, an old client and a bad Host are rejected', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const kds = pairDevice(hub, { type: 'kds', stationId: 'station-1' });
    const kdsRes = await pin(hub, kds.token, 'S_CASH', PIN.c);
    expect(kdsRes.statusCode).toBe(403);
    expect(kdsRes.json().error.code).toBe('DEVICE_TYPE_NOT_ALLOWED');
    expect(staffFailures(hub, 'S_CASH')).toBe(0);

    const guest = await pin(hub, tablet.token, 'S_CASH', PIN.c, {}, '192.168.20.7');
    expect(guest.statusCode).toBe(403);
    expect(guest.json().error.code).toBe('GUEST_NETWORK_FORBIDDEN');

    const old = await hub.app.inject({
      method: 'POST',
      url: '/auth/pin',
      headers: { authorization: `Bearer ${tablet.token}`, 'x-client-version': '0.9.0' },
      payload: { staff_id: 'S_CASH', pin: PIN.c },
    });
    expect(old.statusCode).toBe(426);
    expect(old.json().error.code).toBe('CLIENT_UPGRADE_REQUIRED');

    const host = await hub.app.inject({
      method: 'POST',
      url: '/auth/pin',
      headers: { host: 'evil.example:3000', authorization: `Bearer ${tablet.token}` },
      payload: { staff_id: 'S_CASH', pin: PIN.c },
    });
    expect(host.statusCode).toBe(403);
    expect(host.json().error.code).toBe('HOST_NOT_ALLOWED');
  });

  it('[00 §10 #37] a full PIN semaphore for 2 s returns 503 with retry_after_ms', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const releases = [await authSemaphores(hub.app).pin.acquire(1_000), await authSemaphores(hub.app).pin.acquire(1_000)];
    const started = Date.now();
    const full = await pin(hub, tablet.token, 'S_CASH', PIN.c);
    expect(full.statusCode).toBe(503);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_900);
    expect(full.json().error.code).toBe('SERVICE_UNAVAILABLE');
    expect(full.json().error.details).toEqual({ retry_after_ms: 1000 });
    expect(full.headers['retry-after']).toBe('1');
    for (const release of releases) release();
    expect(staffFailures(hub, 'S_CASH')).toBe(0);
  });

  it('[00 §10 #38] logout is idempotent and a station session cannot log out', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const opened = await pin(hub, tablet.token, 'S_CASH', PIN.c);
    const token = opened.json().data.session_token as string;
    const sessionId = opened.json().data.session_id as string;
    const first = await logout(hub, tablet.token, token);
    expect(first.statusCode).toBe(200);
    expect(first.json().data.already_ended).toBe(false);
    expect(first.json().data.session_id).toBe(sessionId);
    expect(typeof first.json().data.ended_at).toBe('number');
    expect(sessionEnded(hub, sessionId)).toMatchObject({ reason: 'logout', ended_by: 'S_CASH' });
    const second = await logout(hub, tablet.token, token);
    expect(second.statusCode).toBe(200);
    expect(second.json().data).toMatchObject({
      session_id: sessionId,
      ended_at: first.json().data.ended_at,
      already_ended: true,
    });
    expect(endedEvents(hub)).toBe(1);

    const kds = pairDevice(hub, { type: 'kds', stationId: 'station-1' });
    const station = openSession(hub, { kind: 'station', deviceId: kds.deviceId, stationId: 'station-1' });
    const blocked = await logout(hub, kds.token, station.token);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('STATION_LOGOUT_NOT_ALLOWED');
    expect(endReason(hub, station.sessionId)).toBeNull();
  });

  it('[00 §10 #60] two PIN logins for different staff on one device yield one 200 and one 409', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const [left, right] = await Promise.all([
      pin(hub, tablet.token, 'S_CASH', PIN.c),
      pin(hub, tablet.token, 'S_MGR', PIN.b),
    ]);
    const statuses = [left.statusCode, right.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
    const conflict = left.statusCode === 409 ? left : right;
    expect(conflict.json().error.code).toBe('DEVICE_SESSION_ACTIVE');
    expect(activeStaff(hub, tablet.deviceId)).toHaveLength(1);
  });

  it('[00 §10 #81] the phone owner logs in; another staff member is DEVICE_NOT_OWNED with no PIN check', async () => {
    const hub = await open();
    const phone = pairDevice(hub, { type: 'phone', ownerStaffId: 'S_OWNER' });
    const owner = await pin(hub, phone.token, 'S_OWNER', PIN.a);
    expect(owner.statusCode).toBe(200);
    const releases = [await authSemaphores(hub.app).pin.acquire(1_000), await authSemaphores(hub.app).pin.acquire(1_000)];
    const started = Date.now();
    const other = await pin(hub, phone.token, 'S_MGR', PIN.b);
    expect(other.statusCode).toBe(403);
    expect(other.json().error.code).toBe('DEVICE_NOT_OWNED');
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(other.json().error.details.can_take_over).toBeUndefined();
    expect(staffFailures(hub, 'S_MGR')).toBe(0);
    expect(activeStaff(hub, phone.deviceId)).toEqual([owner.json().data.session_id]);
    for (const release of releases) release();
  });

  it('[00 §6.9] STAFF_NOT_FOUND on /auth/pin', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const before = eventCount(hub);
    const missing = await pin(hub, tablet.token, 'S_MISSING', PIN.a);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('STAFF_NOT_FOUND');
    expect(staffFailures(hub, 'S_MISSING')).toBe(0);
    expect(eventCount(hub)).toBe(before);
  });

  it('[00 §3.1 M46] an idle-expired holder does not cause 409; the new login succeeds', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const holder = await pin(hub, tablet.token, 'S_CASH', PIN.c);
    const holderId = holder.json().data.session_id as string;
    const ttl = hub.deps.db.prepare('SELECT idle_ttl_ms FROM staff_sessions WHERE session_id = ?').pluck().get(holderId) as number;
    hub.clock.advance(ttl + 1);
    const next = await pin(hub, tablet.token, 'S_MGR', PIN.b);
    expect(next.statusCode).toBe(200);
    expect(next.json().data.staff_id).toBe('S_MGR');
    expect(sessionEnded(hub, holderId)).toMatchObject({ reason: 'idle_timeout', ended_by: null });
    expect(activeStaff(hub, tablet.deviceId)).toEqual([next.json().data.session_id]);
  });
});

async function open(): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub);
  return hub;
}

function pin(
  hub: TestHub,
  token: string,
  staffId: string,
  pinValue: string,
  extra: { takeover?: boolean } = {},
  remoteAddress?: string,
) {
  return hub.app.inject({
    method: 'POST',
    url: '/auth/pin',
    headers: { authorization: `Bearer ${token}` },
    payload: { staff_id: staffId, pin: pinValue, ...extra },
    remoteAddress,
  });
}

function logout(hub: TestHub, deviceToken: string, sessionToken: string) {
  return hub.app.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: { authorization: `Bearer ${deviceToken}`, 'x-session-token': sessionToken },
    payload: {},
  });
}

function sessionRow(hub: TestHub, sessionId: string): { device_id: string; kind: string; staff_id: string } {
  return hub.deps.db.prepare('SELECT device_id, kind, staff_id FROM staff_sessions WHERE session_id = ?').get(sessionId) as {
    device_id: string;
    kind: string;
    staff_id: string;
  };
}

function endReason(hub: TestHub, sessionId: string): string | null {
  return hub.deps.db.prepare('SELECT end_reason FROM staff_sessions WHERE session_id = ?').pluck().get(sessionId) as string | null;
}

function activeStaff(hub: TestHub, deviceId: string): string[] {
  return hub.deps.db
    .prepare(`SELECT session_id FROM staff_sessions WHERE device_id = ? AND kind = 'staff' AND ended_at IS NULL ORDER BY session_id`)
    .pluck()
    .all(deviceId) as string[];
}

function staffFailures(hub: TestHub, staffId: string): number {
  return failures(hub, 'staff', staffId);
}

function deviceFailures(hub: TestHub, deviceId: string): number {
  return failures(hub, 'device', deviceId);
}

function failures(hub: TestHub, subjectType: string, subjectId: string): number {
  const row = hub.deps.db
    .prepare(`SELECT failed_count FROM auth_lockouts WHERE subject_type = ? AND subject_id = ?`)
    .get(subjectType, subjectId) as { failed_count: number } | undefined;
  return row?.failed_count ?? 0;
}

function eventCount(hub: TestHub): number {
  const row = hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number };
  return row.n;
}

function endedEvents(hub: TestHub): number {
  const row = hub.deps.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_type = 'SessionEnded'`).get() as { n: number };
  return row.n;
}

function lockEvents(hub: TestHub, eventType: string): Array<Record<string, unknown>> {
  const rows = hub.deps.db.prepare('SELECT payload FROM events WHERE event_type = ?').all(eventType) as Array<{ payload: string }>;
  return rows.map((row) => JSON.parse(row.payload) as Record<string, unknown>);
}

function sessionEnded(hub: TestHub, sessionId: string): Record<string, unknown> | undefined {
  const rows = hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'SessionEnded'`).all() as Array<{ payload: string }>;
  return rows
    .map((row) => JSON.parse(row.payload) as Record<string, unknown>)
    .find((payload) => payload.session_id === sessionId);
}
