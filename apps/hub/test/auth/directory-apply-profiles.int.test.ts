import type { DirectoryInput } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveTargets } from '../../src/alerts/targets';
import { applyStaffDirectory } from '../../src/auth/apply-directory';
import { deviceProfile } from '../../src/auth/device-profile';
import { swapDirectory } from '../../src/auth/guards';
import { devicePoint } from '../../src/kds/contracts';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { billingDirectory, drawerDevice, post, signInOn as billingSignInOn, STAFF, startBilling, takeawayOrder } from '../billing/fixtures';
import { ALI, BILAL, directoryWith, withProfile } from '../helpers/device-access';
import { createTestHub, openSession, pairDevice, seedDirectory, type DeviceProfileInput, type TestHub } from '../helpers/test-hub';

// 05a v1.0.2 §6.9 directory apply (plan task 21; M-5, N-1, N-4, N-9; 00 v1.12.3 row H-4): the removed staff's staff
// and admin sessions end `staff_removed`; then ONE `device_people` read; per affected device: a list left non-empty →
// `DeviceProfileSet { cause: 'directory' }` without them; an emptied phone → revoked `owner_removed`; any other emptied
// device → `everyone` + `needs_review`. Every directory event bumps `profile_version` (N-4). §10 #12.

const CHAND = 'S_CHAND';

let h: TestHub;
afterEach(async () => {
  swapBranchConfig(null);
  await h?.close();
  h = undefined as unknown as TestHub;
});

let directory: DirectoryInput;

async function start(): Promise<void> {
  h = await createTestHub();
  directory = await directoryWith({ Ali: ['Manager'], Bilal: ['Cashier'], Chand: ['Waiter'] });
  await seedDirectory(h, directory);
}

/** Applies the current directory without `staffIds` (next directory_version), as the poller does. */
function remove(staffIds: string[], o: { record?: string[] } = {}): void {
  directory = { ...directory, directory_version: directory.directory_version + 1, staff: directory.staff.filter((s) => !staffIds.includes(s.staff_id)) };
  const next = directory;
  h.deps.writer.run((tx) => {
    const stop = o.record === undefined ? () => undefined : recordSql(tx.db, o.record);
    try {
      applyStaffDirectory(tx, next, (dir) => swapDirectory(h.app, dir));
    } finally {
      stop();
    }
  });
}

/** Records the SQL of every statement run (get / all / run) on the db until the returned stop is called. */
function recordSql(db: Database.Database, out: string[]): () => void {
  const prepare = db.prepare;
  const bound = prepare.bind(db);
  db.prepare = ((sql: string) => {
    const statement = bound(sql);
    for (const m of ['get', 'all', 'run'] as const) {
      const original = statement[m].bind(statement) as (...a: unknown[]) => unknown;
      (statement as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => {
        out.push(sql);
        return original(...a);
      };
    }
    return statement;
  }) as typeof db.prepare;
  return () => {
    db.prepare = prepare;
  };
}

function device(type: 'tablet' | 'cashier_kiosk' | 'phone', profile: DeviceProfileInput, name?: string): { deviceId: string; token: string } {
  return pairDevice(h, { type, profile, name: name ?? type });
}

interface Ev {
  event_type: string;
  actor_id: string | null;
  device_id: string;
  payload: Record<string, unknown>;
}

function eventsOf(deviceId: string, type: string): Ev[] {
  return (
    h.deps.db
      .prepare('SELECT event_type, actor_id, device_id, payload FROM events WHERE event_type = ? AND stream_id = ? ORDER BY seq')
      .all(type, deviceId) as Array<Omit<Ev, 'payload'> & { payload: string }>
  ).map((r) => ({ ...r, payload: JSON.parse(r.payload) as Record<string, unknown> }));
}

const lastProfile = (deviceId: string) => eventsOf(deviceId, 'DeviceProfileSet').at(-1);
const revokedAt = (deviceId: string) => h.deps.db.prepare('SELECT revoked_at FROM devices WHERE device_id = ?').pluck().get(deviceId);
const projected = (deviceId: string) => ({
  ...(h.deps.db.prepare('SELECT access, profile_version, needs_review FROM device_profiles WHERE device_id = ?').get(deviceId) as object),
  people: h.deps.db.prepare('SELECT staff_id FROM device_people WHERE device_id = ? ORDER BY rowid').pluck().all(deviceId),
});
const sessionOf = (id: string) =>
  h.deps.db.prepare('SELECT ended_at, end_reason FROM staff_sessions WHERE session_id = ?').get(id) as { ended_at: number | null; end_reason: string | null };

describe('[05a §6.9] directory apply over device profiles (M-5, N-1, N-4, N-9; 00 H-4)', () => {
  it('[05a #12] a list left non-empty → DeviceProfileSet { cause: directory } without the removed person, order kept, profile_version + 1, actor null, needs_review false', async () => {
    await start();
    const tab = device('tablet', { access: 'listed', staff_ids: [ALI, CHAND, BILAL], screens: ['dine_in'] }, 'Floor tablet');
    withProfile(h, tab.deviceId, { access: 'listed', staff_ids: [ALI, CHAND, BILAL], screens: ['dine_in', 'takeaway'] }); // version 2
    remove([ALI]);
    expect(lastProfile(tab.deviceId)).toEqual({
      event_type: 'DeviceProfileSet',
      actor_id: null,
      device_id: 'hub',
      payload: {
        device_id: tab.deviceId,
        device_name: 'Floor tablet',
        access: 'listed',
        staff_ids: [CHAND, BILAL],
        screens: ['dine_in', 'takeaway'],
        point_id: null,
        profile_version: 3,
        cause: 'directory',
        needs_review: false,
      },
    });
    expect(projected(tab.deviceId)).toEqual({ access: 'listed', profile_version: 3, needs_review: 0, people: [CHAND, BILAL] });
    expect(deviceProfile(tab.deviceId)?.staff_ids).toEqual(new Set([CHAND, BILAL]));
    expect(revokedAt(tab.deviceId)).toBeNull();
  });

  it('[05a #12] a two-person phone keeping one person → a directory event, not revoked', async () => {
    await start();
    const phone = device('phone', { access: 'listed', staff_ids: [ALI, BILAL], screens: ['dine_in'] });
    remove([ALI]);
    expect(revokedAt(phone.deviceId)).toBeNull();
    expect(lastProfile(phone.deviceId)?.payload).toMatchObject({ access: 'listed', staff_ids: [BILAL], profile_version: 2, cause: 'directory', needs_review: false });
    expect(eventsOf(phone.deviceId, 'DeviceRevoked')).toEqual([]);
  });

  it('[05a #12, N-1] the removed person\'s staff and admin sessions end staff_removed, also on a device that stays listed; others stay', async () => {
    await start();
    const tab = device('tablet', { access: 'listed', staff_ids: [ALI, BILAL], screens: ['manager'] });
    const other = device('tablet', { access: 'listed', staff_ids: [ALI, BILAL], screens: ['manager'] });
    const aliStaff = openSession(h, { kind: 'staff', staffId: ALI, deviceId: tab.deviceId, legacyProfile: false });
    const aliAdmin = openSession(h, { kind: 'admin', staffId: ALI, deviceId: tab.deviceId, legacyProfile: false });
    const bilalAdmin = openSession(h, { kind: 'admin', staffId: BILAL, deviceId: tab.deviceId, legacyProfile: false });
    const bilal = openSession(h, { kind: 'staff', staffId: BILAL, deviceId: other.deviceId, legacyProfile: false });
    remove([ALI]);
    expect(sessionOf(aliStaff.sessionId).end_reason).toBe('staff_removed');
    expect(sessionOf(aliAdmin.sessionId).end_reason).toBe('staff_removed');
    expect(sessionOf(bilalAdmin.sessionId).ended_at).toBeNull();
    expect(sessionOf(bilal.sessionId).ended_at).toBeNull();
    for (const d of [tab, other]) expect(lastProfile(d.deviceId)?.payload).toMatchObject({ staff_ids: [BILAL], cause: 'directory' });
  });

  it('[05a #12, M-5] a one-person phone emptied → RevokeDevice path, cause owner_removed (actor null, device hub); no profile event', async () => {
    await start();
    const phone = device('phone', { access: 'listed', staff_ids: [ALI], screens: ['dine_in'] });
    const s = openSession(h, { kind: 'staff', staffId: ALI, deviceId: phone.deviceId, legacyProfile: false });
    remove([ALI]);
    expect(revokedAt(phone.deviceId)).not.toBeNull();
    expect(eventsOf(phone.deviceId, 'DeviceRevoked')).toEqual([
      { event_type: 'DeviceRevoked', actor_id: null, device_id: 'hub', payload: { device_id: phone.deviceId, reason: null, cause: 'owner_removed' } },
    ]);
    expect(eventsOf(phone.deviceId, 'DeviceProfileSet')).toHaveLength(1); // the approve one only
    expect(sessionOf(s.sessionId).end_reason).toBe('staff_removed'); // ended first, before the revoke
    expect(deviceProfile(phone.deviceId)).toBeUndefined();
  });

  it('[05a #12, N-9] a two-person phone whose people both leave in one apply → revoked owner_removed, not opened to everyone', async () => {
    await start();
    const phone = device('phone', { access: 'listed', staff_ids: [ALI, BILAL], screens: ['dine_in'] });
    remove([ALI, BILAL]);
    expect(eventsOf(phone.deviceId, 'DeviceRevoked').map((e) => e.payload['cause'])).toEqual(['owner_removed']);
    expect(eventsOf(phone.deviceId, 'DeviceProfileSet')).toHaveLength(1);
  });

  it('[05a #12, M-5] a tablet emptied → DeviceProfileSet { directory, everyone, staff_ids [], needs_review true }, never revoked', async () => {
    await start();
    const tab = device('tablet', { access: 'listed', staff_ids: [ALI, BILAL], screens: ['dine_in'] });
    remove([ALI, BILAL]);
    expect(revokedAt(tab.deviceId)).toBeNull();
    expect(lastProfile(tab.deviceId)).toMatchObject({
      actor_id: null,
      device_id: 'hub',
      payload: { access: 'everyone', staff_ids: [], screens: ['dine_in'], profile_version: 2, cause: 'directory', needs_review: true },
    });
    expect(projected(tab.deviceId)).toEqual({ access: 'everyone', profile_version: 2, needs_review: 1, people: [] });
    expect(deviceProfile(tab.deviceId)).toMatchObject({ access: 'everyone', needs_review: true });
  });

  it('[05a #12] everyone devices, unaffected listed devices and revoked devices get no event', async () => {
    await start();
    const shared = device('tablet', { access: 'everyone', screens: ['dine_in'] });
    const other = device('tablet', { access: 'listed', staff_ids: [BILAL], screens: ['dine_in'] });
    const gone = device('tablet', { access: 'listed', staff_ids: [ALI], screens: ['dine_in'] });
    h.deps.db.prepare('UPDATE devices SET revoked_at = 1 WHERE device_id = ?').run(gone.deviceId);
    remove([ALI]);
    for (const d of [shared, other, gone]) expect(eventsOf(d.deviceId, 'DeviceProfileSet')).toHaveLength(1);
    expect(eventsOf(gone.deviceId, 'DeviceRevoked')).toEqual([]);
  });

  it('[05a §6.9 step 1] one device_people read for every removed person and every device (not one per device or person)', async () => {
    await start();
    device('tablet', { access: 'listed', staff_ids: [ALI, CHAND], screens: ['dine_in'] });
    device('phone', { access: 'listed', staff_ids: [ALI], screens: ['dine_in'] });
    device('cashier_kiosk', { access: 'listed', staff_ids: [BILAL], screens: ['cashier'] });
    device('phone', { access: 'listed', staff_ids: [BILAL, CHAND], screens: ['dine_in'] });
    const sql: string[] = [];
    remove([ALI, BILAL], { record: sql });
    const reads = sql.filter((s) => /device_people/.test(s) && /^\s*SELECT/i.test(s));
    expect(reads).toHaveLength(1);
    expect(sql.filter((s) => /owner_staff_id/.test(s))).toEqual([]); // 00 H-4: no owner_staff_id reader left
    // nobody removed → no read at all
    const none: string[] = [];
    remove([], { record: none });
    expect(none.filter((s) => /device_people/.test(s))).toEqual([]);
  });

  it('[05a #12, N-4] an edit form opened before the directory apply gets 409 CONFIG_STALE and cannot re-add the removed person', async () => {
    await start();
    const config = aBranchConfig();
    swapBranchConfig({ config, snapshotHash: 'f'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 4, appliedAt: h.clock.branchNow() });
    const tab = device('tablet', { access: 'listed', staff_ids: [ALI, BILAL], screens: ['dine_in'] });
    remove([ALI]);
    const admin = openSession(h, { kind: 'admin', staffId: 'S_OWNER' });
    const res = await h.app.inject({
      method: 'POST',
      url: '/admin/commands/set-device-profile',
      headers: { 'x-admin-session': admin.token },
      payload: {
        command_id: 'sdp-stale',
        tenant_id: 'tenant-a',
        branch_id: 'branch-1',
        command_type: 'SetDeviceProfile',
        payload: { device_id: tab.deviceId, expected_version: 1, staff_ids: [BILAL, CHAND] },
        occurred_at: h.clock.branchNow(),
        actor_id: 'S_OWNER',
        device_id: 'hub-admin',
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'CONFIG_STALE', details: { device_id: tab.deviceId, profile_version: 2 } });
  });

  it('[05a #12] a listed Pass tablet emptied → everyone, needs_review; screens, point and the Pass readers unchanged', async () => {
    await start();
    const tab = device('tablet', { access: 'listed', staff_ids: [ALI], screens: ['pass', 'dine_in'], point_id: 'P1' }, 'Pass');
    remove([ALI]);
    expect(lastProfile(tab.deviceId)?.payload).toMatchObject({ access: 'everyone', screens: ['pass', 'dine_in'], point_id: 'P1', needs_review: true, cause: 'directory' });
    expect(deviceProfile(tab.deviceId)).toMatchObject({ access: 'everyone', screens: ['pass', 'dine_in'], point_id: 'P1' });
    expect(devicePoint(tab.deviceId)).toBe('P1');
    const point = h.deps.writer.run((tx) => resolveTargets(tx, [{ kind: 'point', point_id: 'P1' }])).result;
    expect(point.get('point:P1')?.device_ids).toEqual([tab.deviceId]);
  });
});

describe('[05a #12] a one-person kiosk with an open drawer shift', () => {
  it('[05a #12, M-5] emptied → everyone, needs_review; the drawer shift stays open and payable on the kiosk', async () => {
    h = await startBilling();
    const kiosk = drawerDevice(h, 'Kiosk');
    withProfile(h, kiosk.deviceId, { access: 'listed', staff_ids: [STAFF.cashier], screens: ['takeaway', 'cashier'] });
    const cashier = billingSignInOn(h, STAFF.cashier, kiosk);
    const shift = await post(h, cashier, 'open-shift', 'OpenShift', { float_minor: 0, as_drawer: true });
    expect(shift.status, JSON.stringify(shift.error)).toBe(200);
    const shiftId = shift.result!['shift_id'];

    const base = await billingDirectory();
    const version = h.deps.db.prepare('SELECT directory_version FROM staff_directory_meta').pluck().get() as number;
    const next: DirectoryInput = { ...base, directory_version: version + 1, staff: base.staff.filter((s) => s.staff_id !== STAFF.cashier) };
    h.deps.writer.run((tx) => applyStaffDirectory(tx, next, (dir) => swapDirectory(h.app, dir)));

    expect(revokedAt(kiosk.deviceId)).toBeNull();
    expect(lastProfile(kiosk.deviceId)?.payload).toMatchObject({ access: 'everyone', staff_ids: [], needs_review: true, cause: 'directory', profile_version: 2 });
    expect(sessionOf(cashier.sessionId).end_reason).toBe('staff_removed');
    expect(h.deps.db.prepare('SELECT closed_at FROM shifts WHERE shift_id = ?').pluck().get(shiftId)).toBeNull();

    const manager = billingSignInOn(h, STAFF.manager, kiosk);
    const order = takeawayOrder(h, { prefix: 'D12' });
    const paid = await post(h, manager, 'add-payment', 'AddPayment', { bill_ref: { order_id: order.order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 1_000 });
    expect(paid.status, JSON.stringify(paid.error)).toBe(200);
    expect(paid.events.find((e) => e.event_type === 'PaymentAdded')!.payload).toMatchObject({ shift_id: shiftId });
  });
});
