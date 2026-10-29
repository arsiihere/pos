import { afterEach, describe, expect, it } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { currentDirectory } from '../../src/auth/guards';
import { sha256hex } from '../../src/lib/hash';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

const cleanups: Array<() => Promise<void>> = [];

describe('access queries', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    activity.drain();
    activity.drainDevices();
  });

  it('[00 §10 #134] a token-paired tablet still reports pairing_source token after retention deletes its pairing token; an approved kds reports request', async () => {
    const hub = await open();
    const adminDevice = pairDevice(hub, { type: 'tablet' });
    const admin = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: adminDevice.deviceId });
    const tablet = pairDevice(hub, { type: 'tablet' });
    markTokenPaired(hub, tablet.deviceId);
    hub.deps.db.prepare('DELETE FROM pairing_tokens WHERE device_id = ?').run(tablet.deviceId);
    const kds = pairDevice(hub, { type: 'kds', stationId: 'STATION-1' });
    const res = await adminGet(hub, adminDevice.token, admin.token, '/admin/queries/devices');
    const listed = res.json().data.devices as Array<{ device_id: string; pairing_source: string }>;
    expect(listed.find((row) => row.device_id === tablet.deviceId)?.pairing_source).toBe('token');
    expect(listed.find((row) => row.device_id === kds.deviceId)?.pairing_source).toBe('request');
  });

  it('[00 §10 #45] lists, fixed query count (statement counter = 1) with 1 and 20 devices', async () => {
    const hub = await open();
    const counter = statementCounter(hub.deps.readDb);
    const adminDevice = pairDevice(hub, { type: 'tablet' });
    const admin = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: adminDevice.deviceId });
    counter.reset();
    const one = await adminGet(hub, adminDevice.token, admin.token, '/admin/queries/devices');
    expect(one.statusCode).toBe(200);
    expect(counter.count).toBe(1);
    expect(one.json().data.devices).toHaveLength(1);
    counter.reset();
    const oneSessions = await adminGet(hub, adminDevice.token, admin.token, '/admin/queries/sessions');
    expect(counter.count).toBe(1);
    expect(oneSessions.json().data.sessions).toHaveLength(1);

    const target = pairDevice(hub, { type: 'phone', ownerStaffId: 'S_OWNER' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: target.deviceId });
    hub.deps.db.prepare('UPDATE devices SET last_seen_at = ? WHERE device_id = ?').run(hub.clock.branchNow() - 1_000, target.deviceId);
    activity.deviceSeen(target.deviceId, hub.clock.branchNow() - 50);
    activity.touch(staff.sessionId, hub.clock.branchNow() - 25);
    markTokenPaired(hub, target.deviceId);

    counter.reset();
    const devices = await adminGet(hub, adminDevice.token, admin.token, '/admin/queries/devices');
    expect(devices.statusCode).toBe(200);
    expect(counter.count).toBe(1);
    const listedDevices = devices.json().data.devices as Array<Record<string, unknown>>;
    expect(listedDevices).toHaveLength(2);
    expect(listedDevices.find((row) => row.device_id === target.deviceId)).toEqual({
      device_id: target.deviceId,
      device_name: 'phone',
      device_type: 'phone',
      station_id: null,
      owner_staff_id: 'S_OWNER',
      owner_name: 'Owner',
      pairing_source: 'token',
      paired_at: hub.clock.branchNow(),
      paired_by_name: 'Manager',
      last_seen_at: hub.clock.branchNow() - 50,
      revoked_at: null,
      revoked_by_name: null,
      revoked_reason: null,
      active_session: { session_id: staff.sessionId, kind: 'staff', staff_id: 'S_CASH', display_name: 'Cashier' },
    });
    expect(listedDevices.find((row) => row.device_id === adminDevice.deviceId)).toMatchObject({
      pairing_source: 'token',
      last_seen_at: hub.clock.branchNow(),
      active_session: null,
    });

    const sessions = await adminGet(hub, adminDevice.token, admin.token, '/admin/queries/sessions');
    expect(sessions.statusCode).toBe(200);
    expect(counter.count).toBe(2);
    const listed = sessions.json().data.sessions as Array<Record<string, unknown>>;
    expect(listed.map((row) => row.session_id).sort()).toEqual([admin.sessionId, staff.sessionId].sort());
    expect(listed.find((row) => row.session_id === staff.sessionId)).toEqual({
      session_id: staff.sessionId,
      kind: 'staff',
      staff_id: 'S_CASH',
      display_name: 'Cashier',
      station_id: null,
      device_id: target.deviceId,
      device_name: 'phone',
      started_at: hub.clock.branchNow(),
      last_activity_at: hub.clock.branchNow() - 25,
      idle_ttl_ms: 1_800_000,
    });
    expect(listed.every((row) => !('client_ip' in row))).toBe(true);

    const extra: string[] = [];
    for (let i = 0; i < 18; i += 1) {
      const deviceId = `dev-${i}`;
      insertPlainDevice(hub, deviceId);
      insertPlainSession(hub, `sess-${i}`, deviceId);
      extra.push(deviceId);
    }
    counter.reset();
    const twenty = await adminGet(hub, adminDevice.token, admin.token, '/admin/queries/devices');
    expect(counter.count).toBe(1);
    expect(twenty.json().data.devices).toHaveLength(20);
    counter.reset();
    const twentySessions = await adminGet(hub, adminDevice.token, admin.token, '/admin/queries/sessions');
    expect(counter.count).toBe(1);
    expect(twentySessions.json().data.sessions).toHaveLength(20);

    const revoked = extra[0];
    if (revoked === undefined) throw new Error('missing device');
    hub.deps.db.prepare('UPDATE devices SET revoked_at = ?, revoked_by = ? WHERE device_id = ?').run(hub.clock.branchNow(), 'S_OWNER', revoked);
    hub.deps.db.prepare(`UPDATE staff_sessions SET ended_at = ?, end_reason = 'device_revoked' WHERE device_id = ?`).run(hub.clock.branchNow(), revoked);

    counter.reset();
    const many = await adminGet(hub, adminDevice.token, admin.token, '/admin/queries/devices');
    expect(counter.count).toBe(1);
    const ids = (many.json().data.devices as Array<{ device_id: string }>).map((row) => row.device_id);
    expect(ids).toHaveLength(19);
    expect(ids).not.toContain(revoked);
    counter.reset();
    // M87: one more statement for the removal reasons of revoked rows.
    const withRevoked = await adminGet(hub, adminDevice.token, admin.token, '/admin/queries/devices?include_revoked=true');
    expect(counter.count).toBe(2);
    expect(withRevoked.json().data.devices).toHaveLength(20);

    counter.reset();
    const manySessions = await adminGet(hub, adminDevice.token, admin.token, '/admin/queries/sessions');
    expect(counter.count).toBe(1);
    expect(manySessions.json().data.sessions).toHaveLength(19);
  });

  it('[00 §10 #46] roster with active session and locks; 2 statements with 1 and 30 staff', async () => {
    const one = await open(await oneStaff());
    const oneCounter = statementCounter(one.deps.readDb);
    const oneDevice = pairDevice(one, { type: 'tablet' });
    oneCounter.reset();
    const oneRoster = await deviceGet(one, oneDevice.token, '/queries/staff-roster');
    expect(oneRoster.statusCode).toBe(200);
    expect(oneCounter.count).toBe(2);
    expect(oneRoster.json().data).toEqual({
      staff: [{ staff_id: 'S_ONLY', display_name: 'Only', locked_until: null, responsibilities: [] }],
      active_session: null,
    });

    const hub = await open(await manyStaff(30));
    const counter = statementCounter(hub.deps.readDb);
    const device = pairDevice(hub, { type: 'cashier_kiosk' });
    const session = openSession(hub, { kind: 'staff', staffId: 'S_00', deviceId: device.deviceId });
    hub.deps.db
      .prepare(
        `INSERT INTO auth_lockouts (branch_id, subject_type, subject_id, failed_count, window_started_at, locked_until)
         VALUES ('branch-1', 'staff', 'S_01', 5, ?, ?)`,
      )
      .run(hub.clock.branchNow(), hub.clock.branchNow() + 900_000);
    counter.reset();
    const roster = await deviceGet(hub, device.token, '/queries/staff-roster', session.token);
    expect(roster.statusCode).toBe(200);
    expect(counter.count).toBe(2);
    const staff = roster.json().data.staff as Array<{ staff_id: string; display_name: string; locked_until: number | null }>;
    expect(staff).toHaveLength(30);
    expect(staff.map((row) => row.display_name)).toEqual([...staff.map((row) => row.display_name)].sort());
    expect(staff.find((row) => row.staff_id === 'S_01')?.locked_until).toBe(hub.clock.branchNow() + 900_000);
    expect(staff.find((row) => row.staff_id === 'S_00')?.locked_until).toBeNull();
    expect(roster.json().data.active_session).toEqual({ staff_id: 'S_00', display_name: 'N00' });
    expect(activity.get(session.sessionId)).toBeUndefined();

    const kds = pairDevice(hub, { type: 'kds', stationId: 'station-1' });
    const denied = await deviceGet(hub, kds.token, '/queries/staff-roster');
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('DEVICE_TYPE_NOT_ALLOWED');
  });

  it('[00 §10 #47] staff permissions map equals resolve for every catalogue entry; station → {}', async () => {
    const hub = await open();
    const counter = statementCounter(hub.deps.readDb);
    const tablet = pairDevice(hub, { type: 'tablet' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: tablet.deviceId });
    counter.reset();
    const response = await deviceGet(hub, tablet.token, '/queries/session', staff.token);
    expect(response.statusCode).toBe(200);
    expect(counter.count).toBe(0);
    const body = response.json().data;
    expect(body.staff).toEqual({ staff_id: 'S_CASH', display_name: 'Cashier', role_ids: ['R_CASH'] });
    expect(body.station_id).toBeNull();
    expect(body.idle_ttl_ms).toBe(1_800_000);
    expect(body.permissions).toEqual(currentDirectory(hub.app).permissionsOf('S_CASH'));
    expect(activity.get(staff.sessionId)).toBeUndefined();

    const kds = pairDevice(hub, { type: 'kds', stationId: 'station-1' });
    const station = openSession(hub, { kind: 'station', deviceId: kds.deviceId, stationId: 'station-1' });
    const stationResponse = await deviceGet(hub, kds.token, '/queries/session', station.token);
    expect(stationResponse.statusCode).toBe(200);
    expect(stationResponse.json().data.staff).toBeNull();
    expect(stationResponse.json().data.station_id).toBe('station-1');
    expect(stationResponse.json().data.permissions).toEqual({});
    expect(stationResponse.json().data.idle_ttl_ms).toBeNull();
  });

  it('[01b #19] session returns scope and approver_role_ids per permission; no scope on denied / not_granted', async () => {
    const directory = await aDirectory();
    const cashierRole = directory.roles.find((role) => role.role_id === 'R_CASH');
    const cashier = directory.staff.find((staff) => staff.staff_id === 'S_CASH');
    if (cashierRole === undefined || cashier === undefined) throw new Error('cashier missing');
    cashierRole.permissions.push(
      { permission: 'manage-stock', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'my_stations' },
      { permission: 'apply-refund', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'branch' },
    );
    cashier.denied_permissions = ['apply-refund'];
    const hub = await open(directory);
    const counter = statementCounter(hub.deps.readDb);
    const tablet = pairDevice(hub, { type: 'tablet' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: tablet.deviceId });
    counter.reset();
    const response = await deviceGet(hub, tablet.token, '/queries/session', staff.token);
    expect(response.statusCode).toBe(200);
    expect(counter.count).toBe(0);
    const permissions = response.json().data.permissions as Record<string, Record<string, unknown>>;
    expect(permissions['apply-discount']).toEqual({ grant: 'requires_approval', approver_role_ids: ['R_MGR'], scope: 'branch' });
    expect(permissions['reprint-ticket']).toEqual({ grant: 'allowed', scope: 'branch' });
    expect(permissions['manage-stock']).toEqual({ grant: 'allowed', scope: 'my_stations' });
    expect(permissions['apply-refund']).toEqual({ grant: 'denied' });
    expect(permissions['void-item']).toEqual({ grant: 'not_granted' });
  });

  it('[01b #36] roster lists responsibilities count_stock for a counter; 2 statements unchanged', async () => {
    const directory = await aDirectory();
    directory.responsibilities = [{ responsibility: 'count_stock', station_id: 'station-1', staff_ids: ['S_CASH'], role_ids: ['R_WAIT'] }];
    const hub = await open(directory);
    const counter = statementCounter(hub.deps.readDb);
    const device = pairDevice(hub, { type: 'tablet' });
    counter.reset();
    const roster = await deviceGet(hub, device.token, '/queries/staff-roster');
    expect(roster.statusCode).toBe(200);
    expect(counter.count).toBe(2);
    const staff = roster.json().data.staff as Array<{ staff_id: string; responsibilities: string[] }>;
    const byId = new Map(staff.map((row) => [row.staff_id, row.responsibilities]));
    expect(byId.get('S_CASH')).toEqual(['count_stock']);
    expect(byId.get('S_WAIT')).toEqual(['count_stock']);
    expect(byId.get('S_MGR')).toEqual([]);
    expect(byId.get('S_OWNER')).toEqual([]);
  });

  it('[00 §10 #82] phone roster lists only the owner', async () => {
    const hub = await open();
    const phone = pairDevice(hub, { type: 'phone', ownerStaffId: 'S_OWNER' });
    const roster = await deviceGet(hub, phone.token, '/queries/staff-roster');
    expect(roster.statusCode).toBe(200);
    expect(roster.json().data.staff).toEqual([{ staff_id: 'S_OWNER', display_name: 'Owner', locked_until: null, responsibilities: [] }]);
    expect(roster.json().data.active_session).toBeNull();
  });
});

async function open(directory?: Awaited<ReturnType<typeof aDirectory>>): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub, directory);
  return hub;
}

async function oneStaff(): Promise<Awaited<ReturnType<typeof aDirectory>>> {
  const directory = await aDirectory();
  const only = directory.staff.find((staff) => staff.staff_id === 'S_CASH');
  if (only === undefined) throw new Error('cashier missing');
  directory.staff = [{ ...only, staff_id: 'S_ONLY', display_name: 'Only' }];
  return directory;
}

async function manyStaff(count: number): Promise<Awaited<ReturnType<typeof aDirectory>>> {
  const directory = await aDirectory();
  const hash = directory.staff[0]?.pin_hash;
  if (hash === undefined) throw new Error('pin missing');
  directory.staff = Array.from({ length: count }, (_, index) => ({
    staff_id: `S_${String(index).padStart(2, '0')}`,
    display_name: `N${String(index).padStart(2, '0')}`,
    pin_hash: hash,
    role_ids: ['R_WAIT'],
    denied_permissions: [],
    lead_staff_id: null,
    floor_ids: [],
  }));
  return directory;
}

function adminGet(hub: TestHub, deviceToken: string, adminToken: string, url: string) {
  return hub.app.inject({
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${deviceToken}`, 'x-admin-session': adminToken },
  });
}

function deviceGet(hub: TestHub, deviceToken: string, url: string, sessionToken?: string) {
  return hub.app.inject({
    method: 'GET',
    url,
    headers: {
      authorization: `Bearer ${deviceToken}`,
      ...(sessionToken === undefined ? {} : { 'x-session-token': sessionToken }),
    },
  });
}

function insertPlainDevice(hub: TestHub, deviceId: string): void {
  hub.deps.db
    .prepare(
      `INSERT INTO devices (
        device_id, branch_id, token_hash, device_name, device_type, station_id, owner_staff_id, paired_at, paired_by
      ) VALUES (?, 'branch-1', ?, 'tablet', 'tablet', NULL, NULL, ?, 'S_MGR')`,
    )
    .run(deviceId, `hash-${deviceId}`, hub.clock.branchNow());
}

function insertPlainSession(hub: TestHub, sessionId: string, deviceId: string): void {
  const now = hub.clock.branchNow();
  hub.deps.db
    .prepare(
      `INSERT INTO staff_sessions (
        session_id, branch_id, token_hash, kind, staff_id, device_id, idle_ttl_ms, started_at, last_activity_at
      ) VALUES (?, 'branch-1', ?, 'staff', 'S_WAIT', ?, 300000, ?, ?)`,
    )
    .run(sessionId, `hash-${sessionId}`, deviceId, now, now);
}

function markTokenPaired(hub: TestHub, deviceId: string): void {
  hub.deps.db
    .prepare(
      `INSERT INTO pairing_tokens (
        pairing_token_id, branch_id, token_hash, device_type, created_by, created_at, expires_at, device_id
      ) VALUES (?, 'branch-1', ?, 'tablet', 'S_MGR', ?, ?, ?)`,
    )
    .run(hub.deps.ids.next(), sha256hex(deviceId), hub.clock.branchNow(), hub.clock.branchNow() + 1, deviceId);
}
