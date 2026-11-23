import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceProfileSetPayload, EventDraft } from '@pos/events';
import { LISTED_ONLY_PERMISSIONS, MONEY_PERMISSIONS, type Permission } from '@pos/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceProfile } from '../../src/auth/device-profile';
import { upgradeDevices } from '../../src/auth/device-upgrade';
import { boot, type BootHandle } from '../../src/lib/boot';
import { ALI, directoryWith } from '../helpers/device-access';
import { PIN } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 05a §5.3, §6.10 (plan task 28): the upgrade boot step — after the projection catch-up, before listen; 1 read, one
// writer.run appending one DeviceProfileSet { cause: 'upgrade', needs_review: true, profile_version: 1 } per unrevoked
// non-kds device with no profile; pass first when the device has a point; actor_id null, device_id 'hub'; idempotent.
// Tests 05a #15 (hub half), #14b (upgrade half), RF-1.

const BRANCH = 'branch-1';

type Upgraded = { payload: DeviceProfileSetPayload; actor_id: string | null; device_id: string };

function upgradeEvents(db: TestHub['deps']['db']): Upgraded[] {
  const rows = db
    .prepare(`SELECT payload, actor_id, device_id FROM events WHERE event_type = 'DeviceProfileSet' AND json_extract(payload, '$.cause') = 'upgrade' ORDER BY seq`)
    .all() as Array<{ payload: string; actor_id: string | null; device_id: string }>;
  return rows.map((r) => ({ payload: JSON.parse(r.payload) as DeviceProfileSetPayload, actor_id: r.actor_id, device_id: r.device_id }));
}

/** RF-1: unrevoked non-kds devices with no device_profiles row. */
function unprofiled(db: TestHub['deps']['db']): string[] {
  return (
    db
      .prepare(`SELECT d.device_id FROM devices d LEFT JOIN device_profiles p ON p.device_id = d.device_id WHERE d.revoked_at IS NULL AND d.device_type <> 'kds' AND p.device_id IS NULL`)
      .all() as Array<{ device_id: string }>
  ).map((r) => r.device_id);
}

function writeConfig(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-device-upgrade-'));
  const dataDir = join(dir, 'data');
  const backupDir = join(dir, 'backup');
  mkdirSync(dataDir);
  mkdirSync(backupDir);
  const path = join(dir, 'config.json');
  writeFileSync(
    path,
    JSON.stringify({
      cloud_base_url: 'https://cloud.example',
      http_port: 3000,
      data_dir: dataDir,
      backup_dir: backupDir,
      min_client_version: '1.0.0',
      backup_encryption_key: Buffer.alloc(32, 7).toString('base64'),
      advertised_host: '192.168.10.2',
      provisioned: { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'test-branch-api-key' },
    }),
  );
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function asHub(booted: BootHandle): TestHub {
  return { app: booted.app, deps: booted.deps, clock: booted.deps.clock } as unknown as TestHub;
}

function devicePaired(h: TestHub, device_id: string, device_type: 'phone' | 'tablet', owner_staff_id: string | null): void {
  h.deps.writer.run((tx) =>
    tx.append([
      {
        stream_type: 'hub',
        stream_id: device_id,
        event_type: 'DevicePaired',
        schema_version: 1,
        payload: { device_id, device_name: device_type, device_type, station_id: null, owner_staff_id, pairing_token_id: 'PT1', pairing_request_id: null },
        occurred_at: h.clock.branchNow(),
        actor_id: 'S_MGR',
        device_id: 'hub-admin',
      } as EventDraft,
    ]),
  );
}

describe('[05a §5.3, §6.10] upgrade boot step', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('[05a #15] [05a RF-1] boot upgrades every unrevoked non-kds device with no profile per the §5.3 table, pass first with a point; actor_id null, device_id hub; a second boot appends nothing', async () => {
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const start = (): Promise<BootHandle> =>
      boot({ configPath: cfg.path, wallNow: () => 1_761_000_000_000, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud() });

    // boot 1: devices paired before 05a (rows with no profile), as the old pairing paths left them
    const first = await start();
    const h1 = asHub(first);
    const kiosk = pairDevice(h1, { type: 'cashier_kiosk', name: 'Counter' }).deviceId;
    const kioskPass = pairDevice(h1, { type: 'cashier_kiosk', name: 'Counter pass' }).deviceId;
    const tablet = pairDevice(h1, { type: 'tablet', name: 'Floor' }).deviceId;
    const tabletPass = pairDevice(h1, { type: 'tablet', name: 'Pass' }).deviceId;
    const phone = pairDevice(h1, { type: 'phone', ownerStaffId: 'S_MGR', name: 'Manager phone' }).deviceId;
    const phonePass = pairDevice(h1, { type: 'phone', ownerStaffId: 'S_CASH', name: 'Cash phone' }).deviceId;
    const kds = pairDevice(h1, { type: 'kds', stationId: 'ST_GRILL' }).deviceId;
    const revoked = pairDevice(h1, { type: 'tablet', name: 'Gone' }).deviceId;
    const profiled = pairDevice(h1, { type: 'tablet', name: 'Set', profile: { access: 'listed', staff_ids: ['S_OWNER'], screens: ['manager'] } }).deviceId;
    first.deps.db.prepare(`UPDATE devices SET point_id = 'P1' WHERE device_id IN (?, ?, ?)`).run(kioskPass, tabletPass, phonePass);
    first.deps.db.prepare('UPDATE devices SET revoked_at = 1, revoked_by = ? WHERE device_id = ?').run('S_MGR', revoked);
    // boot 1 ran the step before these rows existed: nothing to upgrade then
    expect(upgradeEvents(first.deps.db)).toEqual([]);
    await first.stop();

    // boot 2: the step upgrades them
    const second = await start();
    cleanups.push(() => second.stop());
    const events = upgradeEvents(second.deps.db);
    const byDevice = new Map(events.map((e) => [e.payload.device_id, e]));
    expect([...byDevice.keys()].sort()).toEqual([kiosk, kioskPass, tablet, tabletPass, phone, phonePass].sort());
    expect(events).toHaveLength(6);
    const base = { cause: 'upgrade', needs_review: true, profile_version: 1 };
    expect(byDevice.get(kiosk)!.payload).toEqual({ ...base, device_id: kiosk, device_name: 'Counter', access: 'everyone', staff_ids: [], point_id: null, screens: ['takeaway', 'parking', 'dine_in', 'cashier', 'manager'] });
    expect(byDevice.get(kioskPass)!.payload).toEqual({ ...base, device_id: kioskPass, device_name: 'Counter pass', access: 'everyone', staff_ids: [], point_id: 'P1', screens: ['pass', 'takeaway', 'parking', 'dine_in', 'cashier', 'manager'] });
    expect(byDevice.get(tablet)!.payload).toEqual({ ...base, device_id: tablet, device_name: 'Floor', access: 'everyone', staff_ids: [], point_id: null, screens: ['dine_in', 'takeaway', 'parking', 'cashier', 'manager'] });
    expect(byDevice.get(tabletPass)!.payload).toEqual({ ...base, device_id: tabletPass, device_name: 'Pass', access: 'everyone', staff_ids: [], point_id: 'P1', screens: ['pass', 'dine_in', 'takeaway', 'parking', 'cashier', 'manager'] });
    expect(byDevice.get(phone)!.payload).toEqual({ ...base, device_id: phone, device_name: 'Manager phone', access: 'listed', staff_ids: ['S_MGR'], point_id: null, screens: ['dine_in', 'takeaway', 'parking', 'manager'] });
    expect(byDevice.get(phonePass)!.payload).toEqual({ ...base, device_id: phonePass, device_name: 'Cash phone', access: 'listed', staff_ids: ['S_CASH'], point_id: 'P1', screens: ['pass', 'dine_in', 'takeaway', 'parking', 'manager'] });
    for (const e of events) expect({ actor_id: e.actor_id, device_id: e.device_id }).toEqual({ actor_id: null, device_id: 'hub' });
    // the point stays (the fold rewrites the same value); the map and the projection see the profiles before listen
    expect(second.deps.db.prepare(`SELECT device_id FROM devices WHERE point_id = 'P1' ORDER BY device_id`).all()).toEqual([kioskPass, tabletPass, phonePass].sort().map((device_id) => ({ device_id })));
    expect(deviceProfile(phonePass)).toEqual({ access: 'listed', staff_ids: new Set(['S_CASH']), screens: ['pass', 'dine_in', 'takeaway', 'parking', 'manager'], point_id: 'P1', needs_review: true });
    expect(deviceProfile(tablet)?.screens).toContain('manager');
    expect(deviceProfile(kds)).toBeUndefined();
    expect(deviceProfile(profiled)).toEqual({ access: 'listed', staff_ids: new Set(['S_OWNER']), screens: ['manager'], point_id: null, needs_review: false });
    // RF-1: no unrevoked non-kds device is left without a profile; kds and revoked devices get none
    expect(unprofiled(second.deps.db)).toEqual([]);
    expect(second.deps.db.prepare('SELECT device_id FROM device_profiles WHERE device_id IN (?, ?)').all(kds, revoked)).toEqual([]);
    await second.stop();
    cleanups.pop();

    // boot 3: idempotent
    const third = await start();
    cleanups.push(() => third.stop());
    expect(upgradeEvents(third.deps.db)).toHaveLength(6);
    expect((third.deps.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_type = 'DeviceProfileSet'`).get() as { n: number }).n).toBe(7);
  });

  it('[05a §6.10] the step runs after catchUp: with device_profiles wiped, the catch-up refolds every profile first and the step appends nothing', async () => {
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const start = (): Promise<BootHandle> =>
      boot({ configPath: cfg.path, wallNow: () => 1_761_000_000_000, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud() });
    const first = await start();
    const h1 = asHub(first);
    const kiosk = pairDevice(h1, { type: 'cashier_kiosk', name: 'Counter' }).deviceId;
    const profiled = pairDevice(h1, { type: 'tablet', name: 'Set', profile: { access: 'listed', staff_ids: ['S_OWNER'], screens: ['manager'] } }).deviceId;
    await first.stop();
    const second = await start(); // upgrades the kiosk
    expect(upgradeEvents(second.deps.db).map((e) => e.payload.device_id)).toEqual([kiosk]);
    second.deps.db.exec(`DELETE FROM device_people; DELETE FROM device_profiles; DELETE FROM projection_checkpoints WHERE projection = 'device_profiles'`);
    await second.stop();

    const third = await start();
    cleanups.push(() => third.stop());
    expect(upgradeEvents(third.deps.db)).toHaveLength(1);
    expect(deviceProfile(profiled)).toEqual({ access: 'listed', staff_ids: new Set(['S_OWNER']), screens: ['manager'], point_id: null, needs_review: false });
    expect(deviceProfile(kiosk)).toMatchObject({ access: 'everyone', needs_review: true });
    expect(unprofiled(third.deps.db)).toEqual([]);
  });

  it('[05a §6.10] 1 read and one writer.run for every device; nothing to upgrade → the read only, no writer.run', async () => {
    const h = await createTestHub({ provisioned: true });
    cleanups.push(() => h.close());
    const run = vi.spyOn(h.deps.writer, 'run');
    const counter = statementCounter(h.deps.db);
    expect(upgradeDevices(h.deps)).toBe(0);
    expect(counter.count).toBe(1);
    expect(run).not.toHaveBeenCalled();
    pairDevice(h, { type: 'tablet' });
    pairDevice(h, { type: 'cashier_kiosk' });
    pairDevice(h, { type: 'phone', ownerStaffId: 'S_MGR' });
    run.mockClear();
    expect(upgradeDevices(h.deps)).toBe(3);
    expect(run).toHaveBeenCalledTimes(1);
    expect(upgradeEvents(h.deps.db)).toHaveLength(3);
    run.mockClear();
    expect(upgradeDevices(h.deps)).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it('[05a #14b] upgrade half: an old phone bound to DevicePaired.owner_staff_id gets listed [that owner], so its profile names the same person', async () => {
    const h = await createTestHub({ provisioned: true });
    cleanups.push(() => h.close());
    const phone = pairDevice(h, { type: 'phone', ownerStaffId: 'S_MGR' }).deviceId;
    devicePaired(h, phone, 'phone', 'S_MGR');
    const binding = (): unknown => h.deps.db.prepare('SELECT staff_id, session_id FROM device_bindings WHERE device_id = ?').get(phone);
    expect(binding()).toEqual({ staff_id: 'S_MGR', session_id: null });
    upgradeDevices(h.deps);
    expect(upgradeEvents(h.deps.db).map((e) => [e.payload.access, e.payload.staff_ids])).toEqual([['listed', ['S_MGR']]]);
    expect(deviceProfile(phone)?.staff_ids).toEqual(new Set(['S_MGR']));
    expect(binding()).toEqual({ staff_id: 'S_MGR', session_id: null });
  });

  it('[05a §5.2, §5.3] [05a row D-6] a phone with no owner_staff_id is skipped: no event, left unprofiled, reported for a warning', async () => {
    const h = await createTestHub({ provisioned: true });
    cleanups.push(() => h.close());
    const tablet = pairDevice(h, { type: 'tablet' }).deviceId;
    const ownerless = pairDevice(h, { type: 'phone', ownerStaffId: 'S_MGR' }).deviceId;
    h.deps.db.prepare('UPDATE devices SET owner_staff_id = NULL WHERE device_id = ?').run(ownerless); // raw SQL only
    const warned: string[][] = [];
    expect(upgradeDevices(h.deps, (ids) => warned.push(ids))).toBe(1);
    expect(warned).toEqual([[ownerless]]);
    expect(upgradeEvents(h.deps.db).map((e) => e.payload.device_id)).toEqual([tablet]);
    expect(deviceProfile(ownerless)).toBeUndefined();
    expect(unprofiled(h.deps.db)).toEqual([ownerless]);
  });

  it('[05a #15] [05a §5.3 N-2] on an upgraded kiosk and tablet Test alert, printer setup and Kitchen screens setup are refused; they work from the upgraded (listed) phone; every other action stays, money ones as "Confirm on your phone"', async () => {
    const h = await createTestHub();
    cleanups.push(() => h.close());
    await seedDirectory(h, await directoryWith()); // Ali = Manager (PIN.b): manage-devices, access-hub-admin, view-reports
    const kiosk = pairDevice(h, { type: 'cashier_kiosk', name: 'Counter' });
    const tablet = pairDevice(h, { type: 'tablet', name: 'Floor' });
    const phone = pairDevice(h, { type: 'phone', ownerStaffId: ALI, name: 'Ali phone' });
    // an admin session left on the kiosk from before the upgrade (as /admin/auth wrote it then)
    const leftover = openSession(h, { kind: 'admin', staffId: ALI, deviceId: kiosk.deviceId, legacyProfile: false });
    expect(upgradeDevices(h.deps)).toBe(3);
    for (const d of [kiosk, tablet]) expect(deviceProfile(d.deviceId)).toMatchObject({ access: 'everyone', needs_review: true });
    expect(deviceProfile(phone.deviceId)).toMatchObject({ access: 'listed', staff_ids: new Set([ALI]) });

    type Device = typeof kiosk;
    let n = 0;
    const pin = async (d: Device): Promise<string> => {
      const res = await h.app.inject({ method: 'POST', url: '/auth/pin', headers: { authorization: `Bearer ${d.token}` }, payload: { staff_id: ALI, pin: PIN.b } });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().data.session_token as string;
    };
    const command = (d: Device, session: string, name: string, command_type: string, payload: Record<string, unknown>) =>
      h.app.inject({
        method: 'POST',
        url: `/commands/${name}`,
        headers: { authorization: `Bearer ${d.token}`, 'x-session-token': session },
        payload: { command_id: `up-${(n += 1)}`, tenant_id: 'tenant-a', branch_id: BRANCH, command_type, payload, occurred_at: h.clock.branchNow(), actor_id: ALI, device_id: d.deviceId },
      });
    const adminAuth = (d: Device) => h.app.inject({ method: 'POST', url: '/admin/auth', headers: { authorization: `Bearer ${d.token}` }, payload: { staff_id: ALI, pin: PIN.b } });
    const admin = (d: Device, session: string) => ({ authorization: `Bearer ${d.token}`, 'x-admin-session': session });
    const printTest = (d: Device, session: string) => h.app.inject({ method: 'POST', url: '/admin/print/test', headers: admin(d, session), payload: { printer_id: 'no-such-printer' } });
    const kdsConfig = (d: Device, session: string) => h.app.inject({ method: 'GET', url: '/admin/queries/kds-config', headers: admin(d, session) });
    const stationScreen = (d: Device, session: string) =>
      h.app.inject({
        method: 'POST',
        url: '/admin/commands/set-station-screen',
        headers: admin(d, session),
        payload: { command_id: `up-${(n += 1)}`, tenant_id: 'tenant-a', branch_id: BRANCH, command_type: 'SetStationScreen', payload: { station_id: 'S_NONE', sound_volume: 10 }, occurred_at: h.clock.branchNow(), actor_id: ALI, device_id: d.deviceId },
      });
    const testAlert = (d: Device, session: string) => command(d, session, 'send-test-alert', 'SendTestAlert', { target: { kind: 'person', staff_id: ALI } });
    const report = (d: Device, session: string) => command(d, session, 'print-report', 'PrintReport', { doc: 'z_report' });
    const permissions = async (d: Device, session: string): Promise<Record<Permission, Record<string, unknown>>> => {
      const res = await h.app.inject({ method: 'GET', url: '/queries/session', headers: { authorization: `Bearer ${d.token}`, 'x-session-token': session } });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().data.permissions as Record<Permission, Record<string, unknown>>;
    };

    // the listed phone: everything works (the permission step passes; the handlers answer with their own results)
    const onPhone = await pin(phone);
    const sent = await testAlert(phone, onPhone);
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json().data.result.alert_id).toEqual(expect.any(String));
    const phoneAdmin = await adminAuth(phone);
    expect(phoneAdmin.statusCode, phoneAdmin.body).toBe(200);
    const phoneAdminToken = phoneAdmin.json().data.admin_session_token as string;
    expect((await printTest(phone, phoneAdminToken)).json().error.code).toBe('PRINTER_NOT_FOUND');
    expect((await kdsConfig(phone, phoneAdminToken)).statusCode).toBe(200);
    expect((await stationScreen(phone, phoneAdminToken)).json().error.code).toBe('STATION_NOT_FOUND');
    expect((await report(phone, onPhone)).json().error.code).toBe('Z_REPORT_NOT_FOUND');
    const unmasked = await permissions(phone, onPhone);

    for (const d of [kiosk, tablet]) {
      const label = d === kiosk ? 'kiosk' : 'tablet';
      const session = await pin(d); // any directory staff signs in on an `everyone` device
      // Test alert: the pipeline's authorize adds the reason (N-6)
      const refused = await testAlert(d, session);
      expect(refused.statusCode, label).toBe(403);
      expect(refused.json().error, label).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'manage-devices', grant: 'not_granted', reason: 'listed_device_only' } });
      // printer and Kitchen screens setup are admin screens: /admin/auth is refused (§3.5, H-2)
      const signIn = await adminAuth(d);
      expect(signIn.statusCode, label).toBe(403);
      expect(signIn.json().error, label).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'access-hub-admin', reason: 'listed_device_only' } });
      // what stays: Reports (and every counter action) reach their handler as on the phone
      expect((await report(d, session)).json().error.code, label).toBe('Z_REPORT_NOT_FOUND');
      // the session view: the listed-only grants are hidden, the money ones downgraded, everything else as on the phone
      const masked = await permissions(d, session);
      for (const p of Object.keys(unmasked) as Permission[]) {
        const before = unmasked[p];
        if (before.grant === 'allowed' && LISTED_ONLY_PERMISSIONS.includes(p)) expect(masked[p], `${label} ${p}`).toMatchObject({ grant: 'not_granted', masked: 'listed_only' });
        else if (before.grant === 'allowed' && MONEY_PERMISSIONS.includes(p)) expect(masked[p], `${label} ${p}`).toMatchObject({ grant: 'requires_approval', masked: 'downgraded' });
        else expect(masked[p], `${label} ${p}`).toEqual(before);
      }
    }

    // an admin session left on the upgraded kiosk: the admin guard refuses printer and Kitchen screens setup (details unchanged, N-6)
    for (const res of [await printTest(kiosk, leftover.token), await kdsConfig(kiosk, leftover.token), await stationScreen(kiosk, leftover.token)]) {
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'access-hub-admin' } });
    }
  });
});
