import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { drawerDevice, post, signInOn as billingSignInOn, STAFF, startBilling, takeawayOrder } from '../billing/fixtures';
import { ALI, BILAL, directoryWith, withProfile } from '../helpers/device-access';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';

// 05a v1.0.2 §6.4 `SetDeviceProfile` (plan task 19; M-6, N-1, N-4, G-e): `sessionKind: 'both'`, `manage-devices`
// through the session view. §10 #9, #10, #11, #4d (end half), #13 (edit half), #27; statements per §6.4; RF-4.

const MGR = 'S_MGR'; // aDirectory's Manager: every permission but manage-roles
const OWNER = 'S_OWNER';

let h: TestHub;
const sockets: WsClient[] = [];
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  swapBranchConfig(null);
  await h?.close();
  h = undefined as unknown as TestHub;
});

async function start(): Promise<void> {
  h = await createTestHub();
  await seedDirectory(h, await directoryWith());
  const config = aBranchConfig();
  swapBranchConfig({
    config: { ...config, points: [...config.points, { point_id: 'P_OLD', name: 'Old pass', sort_order: 9, is_archived: true }] },
    snapshotHash: 'f'.repeat(64),
    configVersion: config.config_version,
    snapshotSchemaVersion: 4,
    appliedAt: h.clock.branchNow(),
  });
}

interface Seat {
  route: 'device' | 'admin';
  staffId: string;
  deviceId: string;
  deviceToken?: string;
  sessionId: string;
  sessionToken: string;
}

type Profile = Parameters<typeof withProfile>[2];

/** A device with a profile (version 1). */
function device(type: 'tablet' | 'cashier_kiosk' | 'phone', profile: Profile, name?: string): { deviceId: string; token: string } {
  return pairDevice(h, { type, profile, name: name ?? type });
}

/** A session of `staffId` bound to the device, as `/auth/pin` or `/admin/auth` writes it. */
function seat(route: 'device' | 'admin', staffId: string, d: { deviceId: string; token: string }): Seat {
  const s = openSession(h, { kind: route === 'device' ? 'staff' : 'admin', staffId, deviceId: d.deviceId, legacyProfile: false });
  return { route, staffId, deviceId: d.deviceId, deviceToken: d.token, sessionId: s.sessionId, sessionToken: s.token };
}

/** The editor: Ali's admin session on his own listed tablet E. */
function editorSeat(): Seat {
  return seat('admin', ALI, device('tablet', { access: 'listed', staff_ids: [ALI], screens: ['manager'] }, 'Ali tablet'));
}

function bootstrap(staffId = OWNER): Seat {
  const s = openSession(h, { kind: 'admin', staffId });
  return { route: 'admin', staffId, deviceId: 'hub-admin', sessionId: s.sessionId, sessionToken: s.token };
}

function headers(s: Seat): Record<string, string> {
  return {
    ...(s.deviceToken === undefined ? {} : { authorization: `Bearer ${s.deviceToken}` }),
    ...(s.route === 'device' ? { 'x-session-token': s.sessionToken } : { 'x-admin-session': s.sessionToken }),
  };
}

let seq = 0;
interface Reply {
  status: number;
  result?: { device_id: string; profile_version: number };
  error?: { code: string; details: Record<string, unknown> };
}

async function edit(s: Seat, payload: Record<string, unknown>): Promise<Reply> {
  seq += 1;
  const res = await h.app.inject({
    method: 'POST',
    url: `${s.route === 'device' ? '/commands' : '/admin/commands'}/set-device-profile`,
    headers: headers(s),
    payload: {
      command_id: `sdp-${seq}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'SetDeviceProfile',
      payload,
      occurred_at: h.clock.branchNow(),
      actor_id: s.staffId,
      device_id: s.deviceId,
    },
  });
  const body = res.json() as { data?: { result: Reply['result'] }; error?: Reply['error'] };
  return { status: res.statusCode, result: body.data?.result, error: body.error };
}

function session(id: string): { ended_at: number | null; end_reason: string | null; ended_by: string | null } {
  return h.deps.db.prepare('SELECT ended_at, end_reason, ended_by FROM staff_sessions WHERE session_id = ?').get(id) as {
    ended_at: number | null;
    end_reason: string | null;
    ended_by: string | null;
  };
}

function profileEvents(deviceId: string): Array<{ actor_id: string | null; device_id: string; payload: Record<string, unknown> }> {
  return (
    h.deps.db
      .prepare(`SELECT actor_id, device_id, payload FROM events WHERE event_type = 'DeviceProfileSet' AND stream_id = ? ORDER BY seq`)
      .all(deviceId) as Array<{ actor_id: string | null; device_id: string; payload: string }>
  ).map((r) => ({ ...r, payload: JSON.parse(r.payload) as Record<string, unknown> }));
}

const lastProfile = (deviceId: string) => profileEvents(deviceId).at(-1)!.payload;

function sessionEnded(): Array<Record<string, unknown>> {
  return (h.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'SessionEnded' ORDER BY seq`).all() as Array<{ payload: string }>).map(
    (r) => JSON.parse(r.payload) as Record<string, unknown>,
  );
}

async function socketOf(s: Seat): Promise<WsClient> {
  const ws = await connectWs(h.app);
  sockets.push(ws);
  ws.send({ type: 'auth', device_token: s.deviceToken, session_token: s.sessionToken });
  await ws.untilCount(1);
  return ws;
}

async function frame(ws: WsClient, type: string): Promise<unknown> {
  for (let i = 0; i < 50; i += 1) {
    const found = ws.messages.find((m) => (m as { type: string }).type === type);
    if (found !== undefined) return found;
    await ws.untilCount(ws.messages.length + 1).catch(() => undefined);
  }
  return undefined;
}

const adminDevices = (s: Seat) => h.app.inject({ method: 'GET', url: '/admin/queries/devices', headers: headers(s) });

/** The handler's own statements: the in-handler appends (00's writer) are left out. */
function countHandle(): { calls: number[] } {
  const def = commandRegistry(h.app).byPath('set-device-profile') as CommandDef;
  const counter = statementCounter(h.deps.db);
  const original = def.handle;
  const calls: number[] = [];
  def.handle = (ctx, payload, cmd) => {
    const append = ctx.tx.append;
    let skipped = 0;
    ctx.tx.append = (drafts) => {
      const before = counter.count;
      try {
        return append.call(ctx.tx, drafts);
      } finally {
        skipped += counter.count - before;
      }
    };
    counter.reset();
    try {
      const out = original.call(def, ctx, payload, cmd);
      return out;
    } finally {
      calls.push(counter.count - skipped);
      ctx.tx.append = append;
    }
  };
  return { calls };
}

describe('[05a §6.4] SetDeviceProfile', () => {
  it('[05a #9] removing the signed-in person ends their staff and admin sessions forced (ended_by = editor), closes their socket 4401 and pushes device_profile; the next /admin/queries/devices → 401', async () => {
    await start();
    const editor = editorSeat();
    const t = device('tablet', { access: 'listed', staff_ids: [ALI, MGR], screens: ['dine_in', 'manager'] }, 'Floor tablet');
    const mgrStaff = seat('device', MGR, t);
    const mgrAdmin = seat('admin', MGR, t);
    const aliAdmin = seat('admin', ALI, t);
    expect((await adminDevices(mgrAdmin)).statusCode).toBe(200);
    const mgrWs = await socketOf(mgrStaff);

    const r = await edit(editor, { device_id: t.deviceId, expected_version: 1, staff_ids: [ALI], screens: ['dine_in'] });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toEqual({ device_id: t.deviceId, profile_version: 2 });

    for (const id of [mgrStaff.sessionId, mgrAdmin.sessionId]) {
      expect(session(id)).toEqual({ ended_at: expect.any(Number), end_reason: 'forced', ended_by: ALI });
    }
    expect(session(aliAdmin.sessionId).ended_at).toBeNull();
    expect((await adminDevices(aliAdmin)).statusCode).toBe(200);
    expect(sessionEnded().map((p) => [p['session_id'], p['kind'], p['reason'], p['ended_by']]).sort()).toEqual(
      [
        [mgrStaff.sessionId, 'staff', 'forced', ALI],
        [mgrAdmin.sessionId, 'admin', 'forced', ALI],
      ].sort(),
    );

    expect(await frame(mgrWs, 'device_profile')).toEqual({ type: 'device_profile', screens: ['dine_in'], access: 'listed', point_id: null });
    expect((await mgrWs.untilClose()).code).toBe(4401);

    const late = await adminDevices(mgrAdmin);
    expect(late.statusCode).toBe(401);

    expect(lastProfile(t.deviceId)).toEqual({
      device_id: t.deviceId,
      device_name: 'Floor tablet',
      access: 'listed',
      staff_ids: [ALI],
      screens: ['dine_in'],
      point_id: null,
      profile_version: 2,
      cause: 'edited',
      needs_review: false,
    });
    expect(profileEvents(t.deviceId).at(-1)).toMatchObject({ actor_id: ALI, device_id: editor.deviceId });
  });

  it('[05a §6.4 step 6] a still-allowed signed-in person keeps the session and the socket, and gets device_profile', async () => {
    await start();
    const editor = editorSeat();
    const t = device('tablet', { access: 'listed', staff_ids: [MGR], screens: ['dine_in', 'manager'] });
    const mgr = seat('device', MGR, t);
    const ws = await socketOf(mgr);
    const r = await edit(editor, { device_id: t.deviceId, expected_version: 1, screens: ['pass', 'dine_in'], point_id: 'P1' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(await frame(ws, 'device_profile')).toEqual({ type: 'device_profile', screens: ['pass', 'dine_in'], access: 'listed', point_id: 'P1' });
    expect(session(mgr.sessionId).ended_at).toBeNull();
    expect(sessionEnded()).toEqual([]);
  });

  it('[05a #10] two admins edit one device from version 1: the second gets 409 CONFIG_STALE { device_id, profile_version }', async () => {
    await start();
    const a = editorSeat();
    const b = seat('admin', MGR, device('tablet', { access: 'listed', staff_ids: [MGR], screens: ['manager'] }));
    const t = device('cashier_kiosk', { access: 'everyone', screens: ['takeaway', 'cashier'] });
    expect((await edit(a, { device_id: t.deviceId, expected_version: 1, device_name: 'Counter 1' })).status).toBe(200);
    const stale = await edit(b, { device_id: t.deviceId, expected_version: 1, device_name: 'Counter 2' });
    expect(stale.status).toBe(409);
    expect(stale.error).toMatchObject({ code: 'CONFIG_STALE', details: { device_id: t.deviceId, profile_version: 2 } });
    expect(profileEvents(t.deviceId)).toHaveLength(2);
    expect(lastProfile(t.deviceId)).toMatchObject({ device_name: 'Counter 1', profile_version: 2 });
    expect(h.deps.db.prepare('SELECT device_name FROM devices WHERE device_id = ?').pluck().get(t.deviceId)).toBe('Counter 1');
  });

  it('[05a #11] an admin removing themself from the device they are on → 422 DEVICE_ACCESS_SELF; switching it to everyone → 422; on /commands too', async () => {
    await start();
    const e = device('tablet', { access: 'listed', staff_ids: [ALI, MGR], screens: ['manager'] });
    const admin = seat('admin', ALI, e);
    const staff = seat('device', ALI, e);
    for (const s of [admin, staff]) {
      const off = await edit(s, { device_id: e.deviceId, expected_version: 1, staff_ids: [MGR] });
      expect(off.status).toBe(422);
      expect(off.error).toMatchObject({ code: 'DEVICE_ACCESS_SELF', details: { device_id: e.deviceId } });
      const open = await edit(s, { device_id: e.deviceId, expected_version: 1, access: 'everyone' });
      expect(open.status).toBe(422);
      expect(open.error).toMatchObject({ code: 'DEVICE_ACCESS_SELF', details: { device_id: e.deviceId } });
    }
    expect(profileEvents(e.deviceId)).toHaveLength(1);
    // removing someone else, staying on the list, is not the self-guard
    expect((await edit(admin, { device_id: e.deviceId, expected_version: 1, staff_ids: [ALI] })).status).toBe(200);
  });

  it('[05a #11] [05a #4d] switching **another** device to everyone ends its admin sessions forced; its staff sessions stay; the next /admin/queries/devices → 401', async () => {
    await start();
    const editor = editorSeat();
    const t = device('tablet', { access: 'listed', staff_ids: [ALI, MGR], screens: ['dine_in', 'manager'] });
    const mgrAdmin = seat('admin', MGR, t);
    const aliAdmin = seat('admin', ALI, t);
    const mgrStaff = seat('device', MGR, t);
    const counted = countHandle();

    const r = await edit(editor, { device_id: t.deviceId, expected_version: 1, access: 'everyone' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(session(mgrAdmin.sessionId)).toMatchObject({ end_reason: 'forced', ended_by: ALI });
    expect(session(aliAdmin.sessionId)).toMatchObject({ end_reason: 'forced', ended_by: ALI });
    expect(session(mgrStaff.sessionId).ended_at).toBeNull();
    expect((await adminDevices(mgrAdmin)).statusCode).toBe(401);
    // G-e: the merge dropped staff_ids (access everyone)
    expect(lastProfile(t.deviceId)).toMatchObject({ access: 'everyone', staff_ids: [], profile_version: 2 });
    // §6.4 statements: device + profile read 1, people read 1, one session end per ended session (2)
    expect(counted.calls).toEqual([4]);
  });

  it('[05a §6.4 statements] device + profile read (1), people read (1), then the append; one statement per ended session', async () => {
    await start();
    const editor = editorSeat();
    const t = device('tablet', { access: 'listed', staff_ids: [ALI, MGR], screens: ['dine_in'] });
    const counted = countHandle();
    expect((await edit(editor, { device_id: t.deviceId, expected_version: 1, device_name: 'Renamed' })).status).toBe(200);
    seat('device', MGR, t);
    expect((await edit(editor, { device_id: t.deviceId, expected_version: 2, staff_ids: [ALI] })).status).toBe(200);
    expect(counted.calls).toEqual([2, 3]);
  });

  it('[05a #13] pass without point_id → 400 point_id; cashier on a phone → 400 screens; an archived or unknown point → 404 POINT_NOT_FOUND', async () => {
    await start();
    const editor = editorSeat();
    const tab = device('tablet', { access: 'everyone', screens: ['dine_in'] });
    const phone = device('phone', { access: 'listed', staff_ids: [BILAL], screens: ['dine_in'] });

    const noPoint = await edit(editor, { device_id: tab.deviceId, expected_version: 1, screens: ['pass', 'dine_in'] });
    expect(noPoint.status).toBe(400);
    expect(noPoint.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'point_id' } });
    const cashier = await edit(editor, { device_id: phone.deviceId, expected_version: 1, screens: ['dine_in', 'cashier'] });
    expect(cashier.status).toBe(400);
    expect(cashier.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'screens' } });
    for (const screens of [[], ['dine_in', 'dine_in']]) {
      const bad = await edit(editor, { device_id: tab.deviceId, expected_version: 1, screens });
      expect(bad.status).toBe(400);
      expect(bad.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'screens' } });
    }
    for (const point_id of ['P_OLD', 'P_NONE']) {
      const gone = await edit(editor, { device_id: tab.deviceId, expected_version: 1, screens: ['pass'], point_id });
      expect(gone.status).toBe(404);
      expect(gone.error).toMatchObject({ code: 'POINT_NOT_FOUND' });
    }
    const stranger = await edit(editor, { device_id: phone.deviceId, expected_version: 1, staff_ids: ['S_NOBODY'] });
    expect(stranger.status).toBe(404);
    expect(stranger.error).toMatchObject({ code: 'STAFF_NOT_FOUND', details: { staff_id: 'S_NOBODY' } });
    const empty = await edit(editor, { device_id: tab.deviceId, expected_version: 1, access: 'listed' });
    expect(empty.status).toBe(400);
    expect(empty.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'staff_ids' } });

    const ok = await edit(editor, { device_id: tab.deviceId, expected_version: 1, screens: ['pass', 'dine_in'], point_id: 'P1' });
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    expect(lastProfile(tab.deviceId)).toMatchObject({ screens: ['pass', 'dine_in'], point_id: 'P1' });
    expect(h.deps.db.prepare('SELECT point_id FROM devices WHERE device_id = ?').pluck().get(tab.deviceId)).toBe('P1');
    expect(profileEvents(phone.deviceId)).toHaveLength(1);
  });

  it('[05a v1.0.2 G-e] the merge drops point_id when the merged screens lack pass, and staff_ids when the merged access is everyone; a sent point_id / staff_ids against them stays 400', async () => {
    await start();
    const editor = editorSeat();
    const tab = device('tablet', { access: 'listed', staff_ids: [MGR], screens: ['pass', 'dine_in'], point_id: 'P1' });

    const sentPoint = await edit(editor, { device_id: tab.deviceId, expected_version: 1, screens: ['dine_in'], point_id: 'P1' });
    expect(sentPoint.status).toBe(400);
    expect(sentPoint.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'point_id' } });
    const sentPeople = await edit(editor, { device_id: tab.deviceId, expected_version: 1, access: 'everyone', staff_ids: [MGR] });
    expect(sentPeople.status).toBe(400);
    expect(sentPeople.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'staff_ids' } });
    expect(profileEvents(tab.deviceId)).toHaveLength(1);

    // derived clear 1: pass removed, point_id not sent → point_id null
    expect((await edit(editor, { device_id: tab.deviceId, expected_version: 1, screens: ['dine_in'] })).status).toBe(200);
    expect(lastProfile(tab.deviceId)).toMatchObject({ screens: ['dine_in'], point_id: null, access: 'listed', staff_ids: [MGR] });
    expect(h.deps.db.prepare('SELECT point_id FROM devices WHERE device_id = ?').pluck().get(tab.deviceId)).toBeNull();
    // derived clear 2: switched to everyone, staff_ids not sent → []
    expect((await edit(editor, { device_id: tab.deviceId, expected_version: 2, access: 'everyone' })).status).toBe(200);
    expect(lastProfile(tab.deviceId)).toMatchObject({ access: 'everyone', staff_ids: [], profile_version: 3 });
    // already everyone: sent staff_ids with no access field still 400
    const again = await edit(editor, { device_id: tab.deviceId, expected_version: 3, staff_ids: [MGR] });
    expect(again.status).toBe(400);
    expect(again.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'staff_ids' } });
  });

  it('[05a §6.4 step 1] a missing, revoked or kds device → 404 DEVICE_NOT_FOUND', async () => {
    await start();
    const editor = editorSeat();
    const revoked = device('tablet', { access: 'everyone', screens: ['dine_in'] });
    h.deps.db.prepare('UPDATE devices SET revoked_at = 1 WHERE device_id = ?').run(revoked.deviceId);
    const kds = pairDevice(h, { type: 'kds', stationId: 'S1' });
    for (const id of ['D_NONE', revoked.deviceId, kds.deviceId]) {
      const r = await edit(editor, { device_id: id, expected_version: 1, device_name: 'X' });
      expect(r.status).toBe(404);
      expect(r.error).toMatchObject({ code: 'DEVICE_NOT_FOUND', details: { device_id: id } });
    }
  });

  it('[05a §6.4] manage-devices through the view: an everyone device → 403 listed_device_only; the bootstrap admin session edits (no self-guard)', async () => {
    await start();
    const shared = device('tablet', { access: 'everyone', screens: ['manager'] });
    const t = device('tablet', { access: 'listed', staff_ids: [MGR], screens: ['dine_in'] });
    const masked = await edit(seat('device', ALI, shared), { device_id: t.deviceId, expected_version: 1, device_name: 'X' });
    expect(masked.status).toBe(403);
    expect(masked.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'manage-devices', reason: 'listed_device_only' } });
    const boot = await edit(bootstrap(), { device_id: t.deviceId, expected_version: 1, access: 'everyone' });
    expect(boot.status, JSON.stringify(boot.error)).toBe(200);
    expect(profileEvents(t.deviceId).at(-1)).toMatchObject({ actor_id: OWNER, device_id: 'hub-admin' });
  });

  it('[05a #27] the DeviceProfileSet writes a device_profile_set audit row with the editor as actor', async () => {
    await start();
    const editor = editorSeat();
    const t = device('tablet', { access: 'everyone', screens: ['dine_in'] });
    expect((await edit(editor, { device_id: t.deviceId, expected_version: 1, access: 'listed', staff_ids: [BILAL], device_name: 'Bilal tab' })).status).toBe(200);
    const row = h.deps.db
      .prepare(`SELECT actor_staff_id, device_id, subject_type, subject_id, detail_json FROM audit_entries WHERE action = 'device_profile_set' ORDER BY seq DESC LIMIT 1`)
      .get() as { actor_staff_id: string; device_id: string; subject_type: string; subject_id: string; detail_json: string };
    expect(row).toMatchObject({ actor_staff_id: ALI, device_id: editor.deviceId, subject_type: 'device', subject_id: t.deviceId });
    expect(JSON.parse(row.detail_json)).toEqual({ device_name: 'Bilal tab', access: 'listed', staff_ids: [BILAL], screens: ['dine_in'], point_id: null, cause: 'edited', envelope_actor_id: ALI });
  });
});

describe('[05a RF-4] screens are a view boundary (M-4)', () => {
  it('[05a RF-4] removing `cashier` from a kiosk with an open drawer shift: the shift stays open and the bill is payable from another `cashier` device', async () => {
    h = await startBilling();
    const kioskA = drawerDevice(h, 'Kiosk A');
    const kioskB = drawerDevice(h, 'Kiosk B');
    for (const k of [kioskA, kioskB]) withProfile(h, k.deviceId, { access: 'everyone', screens: ['takeaway', 'cashier'] });
    const a = billingSignInOn(h, STAFF.cashier, kioskA);
    const b = billingSignInOn(h, STAFF.manager, kioskB);
    const shiftA = await post(h, a, 'open-shift', 'OpenShift', { float_minor: 0, as_drawer: true });
    expect(shiftA.status, JSON.stringify(shiftA.error)).toBe(200);
    const shiftB = await post(h, b, 'open-shift', 'OpenShift', { float_minor: 0, as_drawer: true });
    expect(shiftB.status, JSON.stringify(shiftB.error)).toBe(200);

    const r = await edit(bootstrap(), { device_id: kioskA.deviceId, expected_version: 1, screens: ['takeaway'] });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(lastProfile(kioskA.deviceId)).toMatchObject({ screens: ['takeaway'] });

    const open = (id: unknown) => h.deps.db.prepare('SELECT closed_at FROM shifts WHERE shift_id = ?').pluck().get(id);
    expect(open(shiftA.result!['shift_id'])).toBeNull();
    expect(session(a.sessionId).ended_at).toBeNull();
    const order = takeawayOrder(h, { prefix: 'RF4' });
    const paid = await post(h, b, 'add-payment', 'AddPayment', { bill_ref: { order_id: order.order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 1_000 });
    expect(paid.status, JSON.stringify(paid.error)).toBe(200);
    // the hub maps no command to a screen: kiosk A's own drawer shift still takes a payment too
    const onA = await post(h, a, 'add-payment', 'AddPayment', { bill_ref: { order_id: order.order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 500 });
    expect(onA.status, JSON.stringify(onA.error)).toBe(200);
    expect(onA.events.find((e) => e.event_type === 'PaymentAdded')!.payload).toMatchObject({ shift_id: shiftA.result!['shift_id'] });
    expect(open(shiftA.result!['shift_id'])).toBeNull();
  });
});
