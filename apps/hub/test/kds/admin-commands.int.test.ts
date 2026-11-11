import type { PosCommand } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandCtx } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { devicePoint } from '../../src/kds/contracts';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { FX, fixtureMenu, openDay, pairKds } from './fixtures';

// 03b b7: SetStationScreen (§6.9) and SetDeviceRole (§6.10), admin session, manage-devices (§3.9). Test 50.

type Admin = { device: { deviceId: string; token: string }; session: { sessionId: string; token: string } };

let n = 0;

function post(hub: TestHub, admin: Admin, name: string, commandType: string, payload: Record<string, unknown>, o: { route?: 'admin' | 'device'; commandId?: string } = {}) {
  const device = o.route === 'device';
  return hub.app.inject({
    method: 'POST',
    url: `${device ? '/commands/' : '/admin/commands/'}${name}`,
    headers: device
      ? { authorization: `Bearer ${admin.device.token}`, 'x-session-token': admin.session.token }
      : { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
    payload: {
      command_id: o.commandId ?? `cmd-${name}-${(n += 1)}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: commandType,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: 'S_OWNER',
      device_id: admin.device.deviceId,
    },
  });
}

function eventsOf(hub: TestHub, type: string): unknown[] {
  return (hub.deps.db.prepare('SELECT payload FROM events WHERE event_type = ? ORDER BY seq').pluck().all(type) as string[]).map((p) => JSON.parse(p) as unknown);
}

/** Wraps the command's handle to count its own statements (the 00 pipeline is not the handler's). */
function handlerStatements(hub: TestHub, path: string): { last: () => number } {
  const def = commandRegistry(hub.app).byPath(path)!;
  const original = def.handle.bind(def);
  const counter = statementCounter(hub.deps.db);
  let last = -1;
  def.handle = (ctx: CommandCtx, payload: unknown, cmd: PosCommand) => {
    const before = counter.count;
    const out = original(ctx, payload, cmd);
    last = counter.count - before;
    return out;
  };
  return { last: () => last };
}

describe('03b admin commands SetStationScreen, SetDeviceRole (b7)', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function open(): Promise<{ hub: TestHub; admin: Admin }> {
    const hub = await createTestHub({ provisioned: true });
    cleanups.push(() => hub.close());
    await seedDirectory(hub);
    openDay(hub);
    const device = pairDevice(hub, { type: 'tablet' });
    const session = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: device.deviceId });
    return { hub, admin: { device, session } };
  }

  it('[03b #50, §6.9] SetStationScreen: StationScreenSet { station_id, sound_volume }, kds_config row; 0 handler statements', async () => {
    const { hub, admin } = await open();
    const count = handlerStatements(hub, 'set-station-screen');
    const res = await post(hub, admin, 'set-station-screen', 'SetStationScreen', { station_id: FX.station, sound_volume: 35 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.result).toEqual({ station_id: FX.station, sound_volume: 35 });
    expect(count.last()).toBe(0);
    expect(eventsOf(hub, 'StationScreenSet')).toEqual([{ station_id: FX.station, sound_volume: 35 }]);
    expect(hub.deps.db.prepare('SELECT sound_volume FROM kds_station_settings WHERE station_id = ?').pluck().get(FX.station)).toBe(35);
  });

  it('[03b §6.9] SetStationScreen errors: unknown station → 404 STATION_NOT_FOUND; volume 101 → 400 VALIDATION_FAILED; nothing written', async () => {
    const { hub, admin } = await open();
    const missing = await post(hub, admin, 'set-station-screen', 'SetStationScreen', { station_id: 'S_NONE', sound_volume: 10 });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toMatchObject({ code: 'STATION_NOT_FOUND', details: { station_id: 'S_NONE' } });
    const loud = await post(hub, admin, 'set-station-screen', 'SetStationScreen', { station_id: FX.station, sound_volume: 101 });
    expect(loud.statusCode).toBe(400);
    expect(loud.json().error.code).toBe('VALIDATION_FAILED');
    expect(eventsOf(hub, 'StationScreenSet')).toEqual([]);
  });

  it('[03b #50] both commands via /admin/commands/ only: the device route → ROUTE_NOT_FOUND', async () => {
    const { hub } = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_OWNER', deviceId: tablet.deviceId });
    const onDevice: Admin = { device: tablet, session: staff };
    for (const [path, type, payload] of [
      ['set-station-screen', 'SetStationScreen', { station_id: FX.station, sound_volume: 10 }],
      ['set-device-role', 'SetDeviceRole', { device_id: tablet.deviceId, point_id: 'P1' }],
    ] as const) {
      const res = await post(hub, onDevice, path, type, payload, { route: 'device' });
      expect(res.statusCode, path).toBe(404);
      expect(res.json().error.code, path).toBe('ROUTE_NOT_FOUND');
    }
  });

  it('[03b §3.9] an admin without manage-devices → 403 PERMISSION_DENIED', async () => {
    const hub = await createTestHub({ provisioned: true });
    cleanups.push(() => hub.close());
    const dir = await aDirectory();
    dir.staff.find((s) => s.staff_id === 'S_OWNER')!.denied_permissions = ['manage-devices'];
    await seedDirectory(hub, dir);
    openDay(hub);
    const device = pairDevice(hub, { type: 'tablet' });
    const session = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: device.deviceId });
    for (const [path, type, payload] of [
      ['set-station-screen', 'SetStationScreen', { station_id: FX.station, sound_volume: 10 }],
      ['set-device-role', 'SetDeviceRole', { device_id: device.deviceId, point_id: 'P1' }],
    ] as const) {
      const res = await post(hub, { device, session }, path, type, payload);
      expect(res.statusCode, path).toBe(403);
      expect(res.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'manage-devices' } });
    }
  });

  it('[03b #50, §6.10] SetDeviceRole: DeviceRoleSet, devices row and devicePoint refreshed; omitted fields keep their value; 1 handler statement', async () => {
    const { hub, admin } = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const kds = pairKds(hub, { stationId: FX.station });
    const count = handlerStatements(hub, 'set-device-role');
    const set = await post(hub, admin, 'set-device-role', 'SetDeviceRole', { device_id: tablet.deviceId, point_id: 'P1' });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().data.result).toEqual({ device_id: tablet.deviceId, point_id: 'P1', lane_label: null });
    expect(count.last()).toBe(1);
    expect(devicePoint(tablet.deviceId)).toBe('P1');

    const lane = await post(hub, admin, 'set-device-role', 'SetDeviceRole', { device_id: kds.deviceId, lane_label: 'Lane A' });
    expect(lane.statusCode, lane.body).toBe(200);
    const pointToo = await post(hub, admin, 'set-device-role', 'SetDeviceRole', { device_id: kds.deviceId, point_id: 'P1' });
    expect(pointToo.json().data.result).toEqual({ device_id: kds.deviceId, point_id: 'P1', lane_label: 'Lane A' });
    const cleared = await post(hub, admin, 'set-device-role', 'SetDeviceRole', { device_id: tablet.deviceId, point_id: null });
    expect(cleared.json().data.result).toEqual({ device_id: tablet.deviceId, point_id: null, lane_label: null });
    expect(devicePoint(tablet.deviceId)).toBeNull();
    expect(eventsOf(hub, 'DeviceRoleSet')).toEqual([
      { device_id: tablet.deviceId, point_id: 'P1', lane_label: null },
      { device_id: kds.deviceId, point_id: null, lane_label: 'Lane A' },
      { device_id: kds.deviceId, point_id: 'P1', lane_label: 'Lane A' },
      { device_id: tablet.deviceId, point_id: null, lane_label: null },
    ]);
    expect(hub.deps.db.prepare('SELECT point_id, lane_label FROM devices WHERE device_id = ?').get(kds.deviceId)).toEqual({ point_id: 'P1', lane_label: 'Lane A' });
  });

  it('[03b §3.8] SetDeviceRole to an archived point → 404 POINT_NOT_FOUND; nothing written', async () => {
    const { hub, admin } = await open();
    const menu = fixtureMenu();
    const archived = { ...menu, points: [...menu.points, { point_id: 'P_OLD', name: 'Old pass', sort_order: 9, is_archived: true }] };
    swapBranchConfig({ config: archived, snapshotHash: 'd'.repeat(64), configVersion: archived.config_version, snapshotSchemaVersion: 4, appliedAt: hub.clock.branchNow() });
    const tablet = pairDevice(hub, { type: 'tablet' });
    const res = await post(hub, admin, 'set-device-role', 'SetDeviceRole', { device_id: tablet.deviceId, point_id: 'P_OLD' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: 'POINT_NOT_FOUND', details: { point_id: 'P_OLD' } });
    expect(eventsOf(hub, 'DeviceRoleSet')).toEqual([]);
  });

  it('[03b #50, §3.8] SetDeviceRole errors: lane label on a non-kds device → 400; unknown / revoked device → 404 DEVICE_NOT_FOUND; unknown point → 404 POINT_NOT_FOUND; nothing written', async () => {
    const { hub, admin } = await open();
    const tablet = pairDevice(hub, { type: 'tablet' });
    const revoked = pairDevice(hub, { type: 'tablet' });
    hub.deps.db.prepare('UPDATE devices SET revoked_at = 1 WHERE device_id = ?').run(revoked.deviceId);

    const label = await post(hub, admin, 'set-device-role', 'SetDeviceRole', { device_id: tablet.deviceId, lane_label: 'Lane A' });
    expect(label.statusCode).toBe(400);
    expect(label.json().error).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'lane_label' }] } });
    const long = await post(hub, admin, 'set-device-role', 'SetDeviceRole', { device_id: tablet.deviceId, lane_label: 'x'.repeat(21) });
    expect(long.statusCode).toBe(400);
    for (const id of ['D_NONE', revoked.deviceId]) {
      const missing = await post(hub, admin, 'set-device-role', 'SetDeviceRole', { device_id: id, point_id: 'P1' });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error).toMatchObject({ code: 'DEVICE_NOT_FOUND', details: { device_id: id } });
    }
    const point = await post(hub, admin, 'set-device-role', 'SetDeviceRole', { device_id: tablet.deviceId, point_id: 'P_NONE' });
    expect(point.statusCode).toBe(404);
    expect(point.json().error).toMatchObject({ code: 'POINT_NOT_FOUND', details: { point_id: 'P_NONE' } });
    expect(eventsOf(hub, 'DeviceRoleSet')).toEqual([]);
  });
});
