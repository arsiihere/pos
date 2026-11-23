import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { deviceProfile, listedAdminDeviceCount } from '../../src/auth/device-profile';
import { currentDirectory } from '../../src/auth/guards';
import { EN } from '../../src/lib/strings';
import { jsonResponse, runPage } from '../helpers/page-sandbox';
import { registerStationValidator } from '../../src/auth/station-validator';
import { sha256hex } from '../../src/lib/hash';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { signInOn, withProfile } from '../helpers/device-access';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 05a §6.3 (00 §6.32 changed), H-1, M-3; plan task 15. ApprovePairingRequest v2: every device type, the profile in
// the payload, `sessionKind: 'both'`; the token routes are gone.

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  registerStationValidator(() => false);
  swapBranchConfig(null);
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

type Hub = TestHub;
interface Approver {
  url: string;
  headers: Record<string, string>;
  deviceId: string;
}

async function open(directory?: Awaited<ReturnType<typeof aDirectory>>): Promise<Hub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub, directory);
  const base = aBranchConfig();
  const point = base.points[0]!;
  const config = { ...base, points: [{ ...point, point_id: 'P1', is_archived: false }, { ...point, point_id: 'P_OLD', name: 'Old pass', is_archived: true }] };
  swapBranchConfig({ config, snapshotHash: 'f'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 4, appliedAt: hub.clock.branchNow() });
  return hub;
}

/** An admin session (S_OWNER) on a listed tablet: `/admin/commands/…`. */
function adminApprover(hub: Hub): Approver {
  const device = pairDevice(hub, { type: 'tablet', profile: { access: 'listed', staff_ids: ['S_OWNER'], screens: ['manager'] } });
  const session = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: device.deviceId });
  return {
    url: '/admin/commands/approve-pairing-request',
    headers: { authorization: `Bearer ${device.token}`, 'x-admin-session': session.token },
    deviceId: device.deviceId,
  };
}

/** A staff session (S_OWNER) on a device with the given profile: `/commands/…`. */
function staffApprover(hub: Hub, profile: Parameters<typeof withProfile>[2]): Approver {
  const device = pairDevice(hub, { type: 'tablet', profile });
  const session = signInOn(hub, device.deviceId, 'S_OWNER');
  return {
    url: '/commands/approve-pairing-request',
    headers: { authorization: `Bearer ${device.token}`, 'x-session-token': session.token },
    deviceId: device.deviceId,
  };
}

let nextIp = 1;
async function request(hub: Hub, hint?: string): Promise<{ request_id: string; display_code: string; poll_secret: string }> {
  const res = await hub.app.inject({
    method: 'POST',
    url: '/pair/requests',
    remoteAddress: `10.9.0.${nextIp++}`,
    payload: { device_name: 'screen', ...(hint === undefined ? {} : { hardware_hint: hint }) },
  });
  expect(res.statusCode).toBe(200);
  return res.json().data;
}

function approve(hub: Hub, who: Approver, payload: Record<string, unknown>, commandId = `cmd-${nextIp++}`) {
  return hub.app.inject({
    method: 'POST',
    url: who.url,
    headers: who.headers,
    payload: {
      command_id: commandId,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'ApprovePairingRequest',
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: 'S_OWNER',
      device_id: who.deviceId,
    },
  });
}

const count = (hub: Hub, sql: string, ...args: unknown[]) => hub.deps.db.prepare(sql).pluck().get(...args) as number;
const events = (hub: Hub, type: string, streamId: string) =>
  hub.deps.db
    .prepare('SELECT payload, actor_id FROM events WHERE event_type = ? AND stream_id = ? ORDER BY seq')
    .all(type, streamId)
    .map((row) => {
      const r = row as { payload: string; actor_id: string | null };
      return { ...(JSON.parse(r.payload) as Record<string, unknown>), actor_id: r.actor_id };
    });

const envelope = (hub: Hub, type: string, streamId: string) =>
  hub.deps.db.prepare('SELECT stream_type, stream_id, device_id, actor_id FROM events WHERE event_type = ? AND stream_id = ?').all(type, streamId);

const STAFF_CASES = [
  { device_type: 'phone', access: 'listed', staff_ids: ['S_WAIT'], screens: ['dine_in'] },
  { device_type: 'tablet', access: 'everyone', screens: ['dine_in', 'manager'] },
  { device_type: 'cashier_kiosk', access: 'everyone', screens: ['takeaway', 'cashier', 'manager'] },
  { device_type: 'tablet', access: 'listed', staff_ids: ['S_MGR', 'S_CASH'], screens: ['pass', 'dine_in'], point_id: 'P1' },
] as const;

describe('ApprovePairingRequest v2 (05a §6.3)', () => {
  it('[05a #1] phone, tablet, kiosk and kds pair through /pair/requests + approve: device with no owner, DevicePaired + DeviceProfileSet { approved, v1, needs_review false }, poll token works, result per §6.3; the token routes answer 404 ROUTE_NOT_FOUND', async () => {
    const hub = await open();
    registerStationValidator((_tx, id) => id === 'STATION-1');
    const admin = adminApprover(hub);
    for (const c of STAFF_CASES) {
      const req = await request(hub, c.device_type);
      const { device_type, ...profile } = c;
      const res = await approve(hub, admin, { request_id: req.request_id, display_code: req.display_code, device_type, device_name: `My ${device_type}`, ...profile });
      expect(res.statusCode, device_type).toBe(200);
      const result = res.json().data.result as Record<string, unknown>;
      expect(result).toEqual({ device_id: result.device_id, device_type, station_id: null, screens: c.screens, access: c.access });
      const id = result.device_id as string;
      expect(hub.deps.db.prepare('SELECT device_type, device_name, owner_staff_id, paired_by, point_id FROM devices WHERE device_id = ?').get(id)).toEqual({
        device_type,
        device_name: `My ${device_type}`,
        owner_staff_id: null,
        paired_by: 'S_OWNER',
        point_id: 'point_id' in c ? c.point_id : null,
      });
      expect(events(hub, 'DevicePaired', id)).toEqual([
        { device_id: id, device_name: `My ${device_type}`, device_type, station_id: null, owner_staff_id: null, pairing_token_id: null, pairing_request_id: req.request_id, actor_id: 'S_OWNER' },
      ]);
      expect(events(hub, 'DeviceProfileSet', id)).toEqual([
        {
          device_id: id,
          device_name: `My ${device_type}`,
          access: c.access,
          staff_ids: 'staff_ids' in c ? c.staff_ids : [],
          screens: c.screens,
          point_id: 'point_id' in c ? c.point_id : null,
          profile_version: 1,
          cause: 'approved',
          needs_review: false,
          actor_id: 'S_OWNER',
        },
      ]);
      // the envelopes: stream hub / device_id; DevicePaired names the new device (00 §6.32), DeviceProfileSet the approver's
      expect(envelope(hub, 'DevicePaired', id)).toEqual([{ stream_type: 'hub', stream_id: id, device_id: id, actor_id: 'S_OWNER' }]);
      expect(envelope(hub, 'DeviceProfileSet', id)).toEqual([{ stream_type: 'hub', stream_id: id, device_id: admin.deviceId, actor_id: 'S_OWNER' }]);
      // §6.3 step 5: the deviceProfile map is refreshed by the time the response is out.
      expect(deviceProfile(id)).toMatchObject({ access: c.access, screens: c.screens, needs_review: false });
      expect([...deviceProfile(id)!.staff_ids].sort()).toEqual('staff_ids' in c ? [...c.staff_ids].sort() : []);
      const polled = await hub.app.inject({ method: 'GET', url: `/pair/requests/${req.request_id}`, headers: { 'x-poll-secret': req.poll_secret } });
      expect(polled.json().data).toMatchObject({ status: 'approved', device_id: id, device_type, screens: c.screens });
      const token = polled.json().data.device_token as string;
      expect(sha256hex(token)).toBe(hub.deps.db.prepare('SELECT token_hash FROM devices WHERE device_id = ?').pluck().get(id));
      expect(JSON.stringify(res.json())).not.toContain(token);
    }

    const kdsReq = await request(hub, 'kds');
    const kds = await approve(hub, admin, { request_id: kdsReq.request_id, display_code: kdsReq.display_code, device_type: 'kds', device_name: 'Tandoor', station_id: 'STATION-1' });
    expect(kds.statusCode).toBe(200);
    const kdsId = kds.json().data.result.device_id as string;
    expect(kds.json().data.result).toEqual({ device_id: kdsId, device_type: 'kds', station_id: 'STATION-1', screens: [], access: null });
    expect(events(hub, 'DeviceProfileSet', kdsId)).toEqual([]);
    expect(count(hub, 'SELECT COUNT(*) FROM device_profiles WHERE device_id = ?', kdsId)).toBe(0);

    // H-1: the token routes are gone.
    const pair = await hub.app.inject({ method: 'POST', url: '/devices/pair', payload: { pairing_token: 'x', pair_request_id: 'y', device_name: 'z', device_type: 'tablet' } });
    expect(pair.statusCode).toBe(404);
    expect(pair.json().error.code).toBe('ROUTE_NOT_FOUND');
    const generate = await hub.app.inject({
      method: 'POST',
      url: '/admin/commands/generate-device-pairing-token',
      headers: admin.headers,
      payload: { command_id: 'cmd-gen', tenant_id: 'tenant-a', branch_id: 'branch-1', command_type: 'GenerateDevicePairingToken', payload: { device_type: 'tablet' }, occurred_at: hub.clock.branchNow(), actor_id: 'S_OWNER', device_id: admin.deviceId },
    });
    expect(generate.statusCode).toBe(404);
    expect(generate.json().error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('[05a RF-1] every non-kds device approved has a profile; none is left without one', async () => {
    const hub = await open();
    const admin = adminApprover(hub);
    for (const c of STAFF_CASES) {
      const req = await request(hub);
      const { device_type, ...profile } = c;
      expect((await approve(hub, admin, { display_code: req.display_code, request_id: req.request_id, device_type, device_name: 'D', ...profile })).statusCode).toBe(200);
    }
    const approved = hub.deps.db.prepare('SELECT device_id FROM pair_requests WHERE device_id IS NOT NULL').pluck().all() as string[];
    expect(approved).toHaveLength(STAFF_CASES.length);
    expect(
      count(
        hub,
        `SELECT COUNT(*) FROM devices d LEFT JOIN device_profiles p ON p.device_id = d.device_id
          WHERE d.device_type <> 'kds' AND p.device_id IS NULL AND d.device_id IN (SELECT device_id FROM pair_requests WHERE device_id IS NOT NULL)`,
      ),
    ).toBe(0);
    for (const id of approved) expect(deviceProfile(id), id).toBeDefined();
  });

  it('[05a #2] a wrong display code → 404 PAIRING_REQUEST_NOT_FOUND and nothing written; a request id from the QR with no code → 400', async () => {
    const hub = await open();
    const admin = adminApprover(hub);
    const req = await request(hub);
    const before = { devices: count(hub, 'SELECT COUNT(*) FROM devices'), events: count(hub, 'SELECT COUNT(*) FROM events') };
    const wrong = await approve(hub, admin, { request_id: req.request_id, display_code: 'ZZZZZZ', device_type: 'tablet', device_name: 'T', access: 'everyone', screens: ['dine_in'] });
    expect(wrong.statusCode).toBe(404);
    expect(wrong.json().error.code).toBe('PAIRING_REQUEST_NOT_FOUND');
    const noCode = await approve(hub, admin, { request_id: req.request_id, device_type: 'tablet', device_name: 'T', access: 'everyone', screens: ['dine_in'] });
    expect(noCode.statusCode).toBe(400);
    expect(noCode.json().error.code).toBe('VALIDATION_FAILED');
    expect({ devices: count(hub, 'SELECT COUNT(*) FROM devices'), events: count(hub, 'SELECT COUNT(*) FROM events') }).toEqual(before);
    expect(count(hub, 'SELECT COUNT(*) FROM pair_requests WHERE approved_at IS NOT NULL')).toBe(0);
  });

  it('[05a #13 approve half] [05a §6.3 step 3] pass without point_id → 400 point_id; cashier on a phone → 400 screens; unknown person → 404 STAFF_NOT_FOUND; archived or unknown point → 404 POINT_NOT_FOUND; payload shape → 400; nothing written', async () => {
    const hub = await open();
    registerStationValidator((_tx, id) => id === 'STATION-1');
    const admin = adminApprover(hub);
    const req = await request(hub);
    const base = { request_id: req.request_id, display_code: req.display_code, device_name: 'D' };
    const before = { devices: count(hub, 'SELECT COUNT(*) FROM devices'), events: count(hub, 'SELECT COUNT(*) FROM events') };
    const cases: Array<[Record<string, unknown>, number, string, Record<string, unknown> | null]> = [
      [{ device_type: 'tablet', access: 'everyone', screens: ['pass', 'dine_in'] }, 400, 'VALIDATION_FAILED', { field: 'point_id' }],
      [{ device_type: 'tablet', access: 'everyone', screens: ['dine_in'], point_id: 'P1' }, 400, 'VALIDATION_FAILED', { field: 'point_id' }],
      [{ device_type: 'phone', access: 'listed', staff_ids: ['S_WAIT'], screens: ['cashier'] }, 400, 'VALIDATION_FAILED', { field: 'screens' }],
      [{ device_type: 'phone', access: 'listed', staff_ids: ['S_NOBODY'], screens: ['dine_in'] }, 404, 'STAFF_NOT_FOUND', { staff_id: 'S_NOBODY' }],
      [{ device_type: 'tablet', access: 'everyone', screens: ['pass'], point_id: 'P_OLD' }, 404, 'POINT_NOT_FOUND', { point_id: 'P_OLD' }],
      [{ device_type: 'tablet', access: 'everyone', screens: ['pass'], point_id: 'P_NONE' }, 404, 'POINT_NOT_FOUND', { point_id: 'P_NONE' }],
      // payload shape (Zod): kds ⇒ station, nothing of a profile; staff ⇒ access + screens; listed ⇔ staff_ids
      [{ device_type: 'tablet', access: 'listed', screens: ['dine_in'] }, 400, 'VALIDATION_FAILED', null],
      [{ device_type: 'tablet', access: 'everyone', staff_ids: ['S_MGR'], screens: ['dine_in'] }, 400, 'VALIDATION_FAILED', null],
      [{ device_type: 'tablet', access: 'listed', staff_ids: ['S_MGR', 'S_MGR'], screens: ['dine_in'] }, 400, 'VALIDATION_FAILED', null],
      [{ device_type: 'tablet', access: 'everyone', screens: ['dine_in', 'dine_in'] }, 400, 'VALIDATION_FAILED', null],
      [{ device_type: 'tablet', access: 'everyone', screens: [] }, 400, 'VALIDATION_FAILED', null],
      [{ device_type: 'tablet', screens: ['dine_in'] }, 400, 'VALIDATION_FAILED', null],
      [{ device_type: 'tablet', access: 'everyone' }, 400, 'VALIDATION_FAILED', null],
      [{ device_type: 'tablet', access: 'everyone', screens: ['dine_in'], station_id: 'STATION-1' }, 400, 'VALIDATION_FAILED', null],
      [{ device_type: 'kds', station_id: 'STATION-1', access: 'everyone', screens: ['dine_in'] }, 400, 'VALIDATION_FAILED', null],
      [{ device_type: 'kds' }, 400, 'VALIDATION_FAILED', null],
      [{ device_type: 'tablet', access: 'everyone', screens: ['dine_in'], device_name: '' }, 400, 'VALIDATION_FAILED', null],
      [{ device_type: 'tablet', access: 'everyone', screens: ['dine_in'], device_name: 'x'.repeat(41) }, 400, 'VALIDATION_FAILED', null],
    ];
    for (const [payload, status, code, details] of cases) {
      const res = await approve(hub, admin, { ...base, ...payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(status);
      expect(res.json().error.code, JSON.stringify(payload)).toBe(code);
      if (details !== null) expect(res.json().error.details, JSON.stringify(payload)).toMatchObject(details);
    }
    expect({ devices: count(hub, 'SELECT COUNT(*) FROM devices'), events: count(hub, 'SELECT COUNT(*) FROM events') }).toEqual(before);
    // the same request is still approvable once the profile is right
    expect((await approve(hub, admin, { ...base, device_type: 'tablet', access: 'everyone', screens: ['pass'], point_id: 'P1' })).statusCode).toBe(200);
  });

  it('[05a #24] on /commands from a listed staff session with manage-devices and no access-hub-admin → 200; the bootstrap admin session approves on /admin/commands', async () => {
    const directory = await aDirectory();
    directory.staff.find((s) => s.staff_id === 'S_OWNER')!.denied_permissions = ['access-hub-admin'];
    const hub = await open(directory);
    const staff = staffApprover(hub, { access: 'listed', staff_ids: ['S_OWNER'], screens: ['manager'] });
    const req = await request(hub);
    const res = await approve(hub, staff, { request_id: req.request_id, display_code: req.display_code, device_type: 'phone', device_name: 'Ali phone', access: 'listed', staff_ids: ['S_WAIT'], screens: ['dine_in'] });
    expect(res.statusCode).toBe(200);
    expect(count(hub, 'SELECT COUNT(*) FROM device_people WHERE device_id = ?', res.json().data.result.device_id)).toBe(1);

    const hub2 = await open();
    const bootstrap = openSession(hub2, { kind: 'admin', staffId: 'S_OWNER' });
    const who: Approver = { url: '/admin/commands/approve-pairing-request', headers: { 'x-admin-session': bootstrap.token }, deviceId: 'hub-admin' };
    const req2 = await request(hub2);
    const viaBootstrap = await approve(hub2, who, { request_id: req2.request_id, display_code: req2.display_code, device_type: 'cashier_kiosk', device_name: 'Counter 1', access: 'everyone', screens: ['takeaway', 'cashier', 'manager'] });
    expect(viaBootstrap.statusCode).toBe(200);
    expect(viaBootstrap.json().data.result).toMatchObject({ device_type: 'cashier_kiosk', access: 'everyone' });
    const bootId = viaBootstrap.json().data.result.device_id as string;
    expect(envelope(hub2, 'DeviceProfileSet', bootId)).toEqual([{ stream_type: 'hub', stream_id: bootId, device_id: 'hub-admin', actor_id: 'S_OWNER' }]);
  });

  it('[05a #4a] ApprovePairingRequest on /commands from a listed device works; from an everyone device → 403 listed_device_only, nothing written', async () => {
    const hub = await open();
    const listed = staffApprover(hub, { access: 'listed', staff_ids: ['S_OWNER'], screens: ['manager'] });
    const everyone = staffApprover(hub, { access: 'everyone', screens: ['manager'] });
    const req = await request(hub);
    const payload = { request_id: req.request_id, display_code: req.display_code, device_type: 'tablet', device_name: 'T', access: 'everyone', screens: ['dine_in'] };
    const before = count(hub, 'SELECT COUNT(*) FROM events');
    const denied = await approve(hub, everyone, payload);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'manage-devices', reason: 'listed_device_only' } });
    expect(count(hub, 'SELECT COUNT(*) FROM events')).toBe(before);
    expect(count(hub, 'SELECT COUNT(*) FROM pair_requests WHERE approved_at IS NOT NULL')).toBe(0);
    expect((await approve(hub, listed, payload)).statusCode).toBe(200);
  });

  it('[05a RF-3] a double approve of one request: the same command_id → D32 replay; a second command (the other route) → 404; exactly one devices row and one DeviceProfileSet', async () => {
    const hub = await open();
    const admin = adminApprover(hub);
    const staff = staffApprover(hub, { access: 'listed', staff_ids: ['S_OWNER'], screens: ['manager'] });
    const req = await request(hub);
    const payload = { request_id: req.request_id, display_code: req.display_code, device_type: 'tablet', device_name: 'T', access: 'everyone', screens: ['dine_in'] };
    const devicesBefore = count(hub, 'SELECT COUNT(*) FROM devices');
    const first = await approve(hub, staff, payload, 'cmd-double');
    expect(first.statusCode).toBe(200);
    const replay = await approve(hub, staff, payload, 'cmd-double');
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    const second = await approve(hub, admin, payload, 'cmd-double-admin');
    expect(second.statusCode).toBe(404);
    expect(second.json().error.code).toBe('PAIRING_REQUEST_NOT_FOUND');
    const byCode = await approve(hub, admin, { ...payload, request_id: undefined }, 'cmd-double-code');
    expect(byCode.statusCode).toBe(404);
    expect(count(hub, 'SELECT COUNT(*) FROM devices')).toBe(devicesBefore + 1);
    const id = first.json().data.result.device_id as string;
    expect(count(hub, `SELECT COUNT(*) FROM events WHERE event_type = 'DevicePaired' AND stream_id = ?`, id)).toBe(1);
    expect(count(hub, `SELECT COUNT(*) FROM events WHERE event_type = 'DeviceProfileSet' AND stream_id = ?`, id)).toBe(1);
    expect(count(hub, 'SELECT COUNT(*) FROM device_profiles WHERE device_id = ?', id)).toBe(1);
  });

  it('[05a §6.3 Statements] request read (1), INSERT devices, UPDATE pair_requests, appends (2 for a staff device, 1 for kds); no statement for the step 3 checks', async () => {
    const hub = await open();
    registerStationValidator((_tx, id) => id === 'STATION-1');
    const admin = adminApprover(hub);
    const record = (): { sql: string[]; stop(): void } => {
      const sql: string[] = [];
      const db = hub.deps.db;
      const prepare = db.prepare.bind(db);
      db.prepare = ((text: string) => {
        const statement = prepare(text);
        for (const method of ['get', 'all', 'run'] as const) {
          const original = (statement[method] as (...a: unknown[]) => unknown).bind(statement);
          (statement as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
            sql.push(text.replace(/\s+/g, ' ').trim());
            return original(...args);
          };
        }
        return statement;
      }) as typeof db.prepare;
      return { sql, stop: () => void (db.prepare = prepare) };
    };
    const own = (sql: string[]) => ({
      requestReads: sql.filter((s) => /^SELECT .* FROM pair_requests WHERE/.test(s)).length,
      deviceInserts: sql.filter((s) => s.startsWith('INSERT INTO devices ')).length,
      requestUpdates: sql.filter((s) => s.startsWith('UPDATE pair_requests SET approved_at')).length,
      appends: sql.filter((s) => s.startsWith('INSERT INTO events')).length,
      // the step 3 checks read the directory and the 01a config from memory
      staffOrPointReads: sql.filter((s) => /FROM (staff|staff_roles|points|branch_config|config_\w+)\b(?! *WHERE token_hash)/.test(s) && !s.includes('FROM staff_sessions')).length,
    });
    for (const [payload, appends] of [
      [{ device_type: 'phone', access: 'listed', staff_ids: ['S_WAIT', 'S_MGR'], screens: ['pass', 'dine_in'], point_id: 'P1' }, 2],
      [{ device_type: 'kds', station_id: 'STATION-1' }, 1],
    ] as const) {
      const req = await request(hub);
      const rec = record();
      const res = await approve(hub, admin, { request_id: req.request_id, display_code: req.display_code, device_name: 'D', ...payload });
      rec.stop();
      expect(res.statusCode).toBe(200);
      expect(own(rec.sql), payload.device_type).toEqual({ requestReads: 1, deviceInserts: 1, requestUpdates: 1, appends, staffOrPointReads: 0 });
    }
  });
});

describe('/admin/approve interim kinds (05a §6.3, D-3; plan task 15 review)', () => {
  /** The page's fetch, answered by the real hub (bootstrap admin: no device token). */
  const realFetch = (hub: Hub) => async (url: string, init?: unknown) => {
    const req = (init ?? {}) as { method?: string; headers?: Record<string, string>; body?: string };
    const res = await hub.app.inject({
      method: (req.method ?? 'GET') as 'GET' | 'POST',
      url,
      headers: req.headers ?? {},
      ...(req.body === undefined ? {} : { payload: JSON.parse(req.body) as Record<string, unknown> }),
    });
    return jsonResponse(res.statusCode, res.json());
  };

  it('[05a §6.3] [05a D-3] a fresh hub\'s bootstrap admin pairs a tablet (everyone; dine_in, manager) and their own phone (listed [them]; dine_in) through the page\'s payload; the phone counts as a listed admin device; the kind defaults from the request\'s hint', async () => {
    const hub = await open();
    expect(listedAdminDeviceCount(currentDirectory(hub.app))).toBe(0);
    const bootstrap = openSession(hub, { kind: 'admin', staffId: 'S_OWNER' });
    const session = { admin_session_token: bootstrap.token, admin_staff_id: 'S_OWNER', admin_bootstrap: '1', admin_name: 'Owner' };
    const html = (await hub.app.inject({ method: 'GET', url: '/admin/approve' })).body;

    for (const [index, type] of [[1, 'tablet'], [2, 'phone']] as const) {
      const req = await request(hub);
      const page = await runPage(html, { session, fetch: realFetch(hub) });
      const form = page.findAll((el) => el.tagName === 'form')[0]!;
      page.find('display_code')!.value = req.display_code;
      await page.click(page.find('device_type')!.children[index]!);
      await page.submit(form);
      await page.settle();
      expect(page.screen.children.length, type).toBeGreaterThan(0);
      const id = hub.deps.db.prepare('SELECT device_id FROM pair_requests WHERE request_id = ?').pluck().get(req.request_id) as string | null;
      expect(id, type).not.toBeNull();
      expect(hub.deps.db.prepare('SELECT device_type, device_name FROM devices WHERE device_id = ?').get(id), type).toEqual({
        device_type: type,
        device_name: EN[type === 'tablet' ? 'approve.kind_tablet' : 'approve.kind_phone'],
      });
      const profile = deviceProfile(id!)!;
      if (type === 'tablet') {
        expect({ access: profile.access, screens: profile.screens, staff: [...profile.staff_ids] }).toEqual({ access: 'everyone', screens: ['dine_in', 'manager'], staff: [] });
        expect(listedAdminDeviceCount(currentDirectory(hub.app))).toBe(0);
      } else {
        expect({ access: profile.access, screens: profile.screens, staff: [...profile.staff_ids] }).toEqual({ access: 'listed', screens: ['dine_in'], staff: ['S_OWNER'] });
        expect(listedAdminDeviceCount(currentDirectory(hub.app))).toBe(1);
      }
    }

    // M-2: a scanned ?r= of a request hinted `phone` opens with Phone picked; no hint → nothing picked.
    const hinted = await request(hub, 'phone');
    const fromQr = await runPage((await hub.app.inject({ method: 'GET', url: `/admin/approve?r=${hinted.request_id}` })).body, { session, search: `?r=${hinted.request_id}`, fetch: realFetch(hub) });
    const pressed = (p: typeof fromQr) => p.find('device_type')!.children.map((el) => el.getAttribute('aria-pressed'));
    expect(pressed(fromQr)).toEqual(['false', 'false', 'true', 'false']);
    const plain = await request(hub);
    const noHint = await runPage((await hub.app.inject({ method: 'GET', url: `/admin/approve?r=${plain.request_id}` })).body, { session, search: `?r=${plain.request_id}`, fetch: realFetch(hub) });
    expect(pressed(noHint)).toEqual(['false', 'false', 'false', 'false']);
  });
});
