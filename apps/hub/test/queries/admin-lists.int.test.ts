import { aBranchConfig } from '@pos/events/testing';
import type { BranchConfig } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

let commands = 0;

// 00 v1.3 M88: the admin list queries behind the hub admin pages (§6.18a–c).
const cleanups: Array<() => Promise<void>> = [];

async function open(): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub, await aDirectory());
  return hub;
}

function adminOn(hub: TestHub, staffId: string) {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'admin', staffId, deviceId: device.deviceId });
  return { device, session };
}

function get(hub: TestHub, admin: ReturnType<typeof adminOn>, resource: string) {
  return hub.app.inject({
    method: 'GET',
    url: `/admin/queries/${resource}`,
    headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
  });
}

function get2(hub: TestHub, admin: ReturnType<typeof adminOn>, url: string) {
  return hub.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token } });
}

function revoke(hub: TestHub, admin: ReturnType<typeof adminOn>, staffId: string, deviceId: string, reason?: string) {
  commands += 1;
  return hub.app.inject({
    method: 'POST',
    url: '/admin/commands/revoke-device',
    headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
    payload: {
      command_id: `cmd-revoke-${commands}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'RevokeDevice',
      payload: reason === undefined ? { device_id: deviceId } : { device_id: deviceId, reason },
      occurred_at: hub.clock.branchNow(),
      actor_id: staffId,
      device_id: admin.device.deviceId,
    },
  });
}

function lock(hub: TestHub, subjectType: string, subjectId: string, lockedUntil: number | null): void {
  hub.deps.db
    .prepare('INSERT INTO auth_lockouts (branch_id, subject_type, subject_id, failed_count, window_started_at, locked_until) VALUES (?, ?, ?, 5, 0, ?)')
    .run('branch-1', subjectType, subjectId, lockedUntil);
}

function withConfig(config: BranchConfig): void {
  swapBranchConfig({ config, snapshotHash: 'h'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 2, appliedAt: 0 });
}

describe('admin list queries (§6.18a–c, M88)', () => {
  afterEach(async () => {
    swapBranchConfig(null);
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #145] stations: archived left out; at most 3 category names in category order, only categories with an item on the station; no config → empty; no queries', async () => {
    const hub = await open();
    const admin = adminOn(hub, 'S_MGR');
    expect((await get(hub, admin, 'stations')).json().data).toEqual({ stations: [] });

    const base = aBranchConfig();
    const station = base.stations[0]!;
    const cats = ['Naan', 'Roti', 'Kulcha', 'Paratha', 'Empty'].map((name, i) => ({ category_id: `C${i}`, name, sort_order: 5 - i, availability_windows: [] }));
    const item = base.items[0]!;
    withConfig({
      ...base,
      stations: [
        { ...station, station_id: 'T', name: 'Tandoor', location_label: 'Back wall' },
        { ...station, station_id: 'K', name: 'Karahi' },
        { ...station, station_id: 'OLD', name: 'Old grill', is_archived: true },
      ],
      categories: cats,
      items: [
        { ...item, item_id: 'a', station_id: 'T', category_id: 'C0' },
        { ...item, item_id: 'b', station_id: 'T', category_id: 'C1' },
        { ...item, item_id: 'c', station_id: 'T', category_id: 'C2' },
        { ...item, item_id: 'd', station_id: 'T', category_id: 'C3' },
        { ...item, item_id: 'e', station_id: 'K', category_id: 'C0' },
      ],
    });
    const counter = statementCounter(hub.deps.readDb);
    const res = await get(hub, admin, 'stations');
    expect(res.statusCode).toBe(200);
    expect(counter.count).toBe(0);
    expect(res.json().data).toEqual({
      stations: [
        { station_id: 'T', name: 'Tandoor', location_label: 'Back wall', category_names: ['Paratha', 'Kulcha', 'Roti'] },
        { station_id: 'K', name: 'Karahi', location_label: null, category_names: ['Naan'] },
      ],
    });
  });

  it('[00 §10 #143] M87: devices with include_revoked carry revoked_reason (latest DeviceRevoked), revoked_by_name and owner_name; 1 query without revoked, 2 with', async () => {
    const hub = await open();
    const admin = adminOn(hub, 'S_MGR');
    const phone = pairDevice(hub, { type: 'phone', ownerStaffId: 'S_CASH' });
    const kiosk = pairDevice(hub, { type: 'cashier_kiosk' });
    expect((await revoke(hub, admin, 'S_MGR', phone.deviceId, 'Lost in the car park')).statusCode).toBe(200);
    expect((await revoke(hub, admin, 'S_MGR', kiosk.deviceId)).statusCode).toBe(200);

    const counter = statementCounter(hub.deps.readDb);
    const live = await get2(hub, admin, '/admin/queries/devices');
    expect(counter.count).toBe(1);
    expect(live.json().data.devices.map((d: { device_id: string }) => d.device_id)).toEqual([admin.device.deviceId]);
    expect(live.json().data.devices[0]).toMatchObject({ owner_name: null, revoked_by_name: null, revoked_reason: null });

    const all = await get2(hub, admin, '/admin/queries/devices?include_revoked=true');
    expect(counter.count).toBe(3);
    const byId = new Map(all.json().data.devices.map((d: { device_id: string }) => [d.device_id, d]));
    expect(byId.get(phone.deviceId)).toMatchObject({ owner_staff_id: 'S_CASH', owner_name: 'Cashier', revoked_by_name: 'Manager', revoked_reason: 'Lost in the car park' });
    expect(byId.get(kiosk.deviceId)).toMatchObject({ owner_name: null, revoked_by_name: 'Manager', revoked_reason: null });
  });

  it('[00 §10 #144] M88 lockouts: locked staff, device and ip with names; expired and unlocked rows left out; one query; no access-hub-admin → 403', async () => {
    const hub = await open();
    const admin = adminOn(hub, 'S_MGR');
    const now = hub.clock.branchNow();
    const kiosk = pairDevice(hub, { type: 'cashier_kiosk', name: 'Counter 2' });
    lock(hub, 'staff', 'S_CASH', now + 840_000);
    lock(hub, 'staff', 'S_WAIT', now - 1);
    lock(hub, 'staff', 'S_OWNER', null);
    lock(hub, 'device', kiosk.deviceId, now + 540_000);
    lock(hub, 'ip', '192.168.0.50', now + 60_000);
    const counter = statementCounter(hub.deps.readDb);
    const res = await get(hub, admin, 'lockouts');
    expect(res.statusCode).toBe(200);
    expect(counter.count).toBe(1);
    expect(res.json().data).toEqual({
      staff: [{ staff_id: 'S_CASH', display_name: 'Cashier', locked_until: now + 840_000 }],
      devices: [{ device_id: kiosk.deviceId, device_name: 'Counter 2', locked_until: now + 540_000 }],
      ips: [{ ip: '192.168.0.50', locked_until: now + 60_000 }],
    });
    const waiterDevice = pairDevice(hub, { type: 'tablet' });
    const waiter = { device: waiterDevice, session: openSession(hub, { kind: 'admin', staffId: 'S_WAIT', deviceId: waiterDevice.deviceId }) };
    expect((await get(hub, waiter, 'lockouts')).statusCode).toBe(403);
  });

  it('[00 §10 #146] M88 staff: every directory staff member with role names and non-revoked phone count; one query', async () => {
    const hub = await open();
    const admin = adminOn(hub, 'S_MGR');
    pairDevice(hub, { type: 'phone', ownerStaffId: 'S_CASH' });
    const old = pairDevice(hub, { type: 'phone', ownerStaffId: 'S_CASH' });
    pairDevice(hub, { type: 'phone', ownerStaffId: 'S_CASH' });
    await revoke(hub, admin, 'S_MGR', old.deviceId);
    const counter = statementCounter(hub.deps.readDb);
    const res = await get(hub, admin, 'staff');
    expect(counter.count).toBe(1);
    expect(res.json().data.staff).toEqual([
      { staff_id: 'S_CASH', display_name: 'Cashier', role_names: ['Cashier'], phone_count: 2 },
      { staff_id: 'S_MGR', display_name: 'Manager', role_names: ['Manager'], phone_count: 0 },
      { staff_id: 'S_WAIT', display_name: 'Order taker', role_names: ['Order taker'], phone_count: 0 },
      { staff_id: 'S_OWNER', display_name: 'Owner', role_names: ['Owner'], phone_count: 0 },
    ]);
  });
});
