import type { EngineState } from '@pos/engine';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import { hasTargetResolver, resolveTargets } from '../../src/alerts/targets';
import { alertsTick } from '../../src/alerts/tick';
import { devicePoint } from '../../src/kds/contracts';
import { screenStations } from '../../src/kds/device-roles';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, endSessionNow, openSession, pairDevice as pairDeviceRow, seedDirectory, type TestHub } from '../helpers/test-hub';
import { append, COOK, cookDirectory, FX, pairDevice, pairKds, pairPassTablet } from './fixtures';

// 03b b6: projection device_roles, the memory maps devicePoint / screen stations (§3.1, §3.8) and the `point` target
// resolver (G-1, 01d §3.4). Test 50 (map refresh on role / pairing / revoke).

const BRANCH = 'branch-1';

function roleSet(device_id: string, point_id: string | null, lane_label: string | null = null) {
  return { stream_type: 'hub' as const, stream_id: BRANCH, event_type: 'DeviceRoleSet', payload: { device_id, point_id, lane_label } };
}

function paired(device_id: string, device_type: 'tablet' | 'kds', station_id: string | null) {
  return {
    stream_type: 'hub' as const,
    stream_id: device_id,
    event_type: 'DevicePaired',
    payload: { device_id, device_name: device_type, device_type, station_id, owner_staff_id: null, pairing_token_id: 'PT1', pairing_request_id: null },
  };
}

function revoke(hub: TestHub, device_id: string) {
  hub.deps.db.prepare('UPDATE devices SET revoked_at = ?, revoked_by = ? WHERE device_id = ?').run(hub.clock.branchNow(), 'S_MGR', device_id);
  return append(hub, [{ stream_type: 'hub', stream_id: device_id, event_type: 'DeviceRevoked', payload: { device_id, reason: null, cause: 'manual' } }]);
}

function deviceRow(db: Database.Database, id: string): { point_id: string | null; lane_label: string | null } {
  return db.prepare('SELECT point_id, lane_label FROM devices WHERE device_id = ?').get(id) as { point_id: string | null; lane_label: string | null };
}

describe('03b device_roles, memory maps, point resolver (b6)', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function hub(): Promise<TestHub> {
    const h = await createTestHub({ provisioned: true });
    cleanups.push(() => h.close());
    return h;
  }

  it('[03b #50] DeviceRoleSet: devices.point_id / lane_label written by the projection; devicePoint refreshed after the commit (1 statement)', async () => {
    const h = await hub();
    const tablet = pairDeviceRow(h, { type: 'tablet' });
    const kds = pairKds(h, { stationId: FX.station });
    expect(devicePoint(tablet.deviceId)).toBeNull();
    const counter = statementCounter(h.deps.db);
    append(h, [roleSet(tablet.deviceId, 'P1')]);
    const withRefresh = counter.count;
    counter.reset();
    append(h, [{ stream_type: 'hub', stream_id: BRANCH, event_type: 'StationScreenSet', payload: { station_id: FX.station, sound_volume: 50 } }]);
    const without = counter.count;
    // same commit shape: DeviceRoleSet = device_roles UPDATE (1) + the map reload after commit (1); StationScreenSet =
    // kds_config upsert (1) and no reload (not a device event)
    expect(withRefresh - without).toBe(1);
    expect(devicePoint(tablet.deviceId)).toBe('P1');
    expect(deviceRow(h.deps.db, tablet.deviceId)).toEqual({ point_id: 'P1', lane_label: null });
    append(h, [roleSet(kds.deviceId, null, 'Lane A'), roleSet(tablet.deviceId, null)]);
    expect(deviceRow(h.deps.db, kds.deviceId)).toEqual({ point_id: null, lane_label: 'Lane A' });
    expect(devicePoint(tablet.deviceId)).toBeNull();
  });

  it('[03b #50] pairing: a DevicePaired commit refreshes the screen-station map and devicePoint', async () => {
    const h = await hub();
    // raw rows (00's helper, no event, no refresh) are not seen until a refreshing commit: the map is memory
    const kds = pairDeviceRow(h, { type: 'kds', stationId: FX.station });
    const tablet = pairDeviceRow(h, { type: 'tablet' });
    h.deps.db.prepare("UPDATE devices SET point_id = 'P1' WHERE device_id = ?").run(tablet.deviceId);
    expect(screenStations().get(FX.station)).toBeUndefined();
    expect(devicePoint(tablet.deviceId)).toBeNull();
    append(h, [paired(kds.deviceId, 'kds', FX.station)]);
    expect(screenStations().get(FX.station)).toEqual([kds.deviceId]);
    expect(devicePoint(tablet.deviceId)).toBe('P1');
  });

  it('[03b §3.8] test fixtures pairKds / pairPassTablet / pairDevice refresh the maps after their direct writes', async () => {
    const h = await hub();
    const kds = pairKds(h, { stationId: FX.station, laneLabel: 'A' });
    const tablet = pairPassTablet(h, { pointId: 'P1' });
    const plain = pairDevice(h, { type: 'kds', stationId: FX.zoneStation });
    expect(screenStations().get(FX.station)).toEqual([kds.deviceId]);
    expect(screenStations().get(FX.zoneStation)).toEqual([plain.deviceId]);
    expect(devicePoint(tablet.deviceId)).toBe('P1');
  });

  it('[03b #50] revoke: a DeviceRevoked commit drops the device from both maps', async () => {
    const h = await hub();
    const kds = pairKds(h, { stationId: FX.station });
    const kds2 = pairKds(h, { stationId: FX.station });
    const tablet = pairPassTablet(h, { pointId: 'P1' });
    append(h, [paired(kds.deviceId, 'kds', FX.station)]);
    expect(screenStations().get(FX.station)?.slice().sort()).toEqual([kds.deviceId, kds2.deviceId].sort());
    revoke(h, kds.deviceId);
    expect(screenStations().get(FX.station)).toEqual([kds2.deviceId]);
    revoke(h, kds2.deviceId);
    expect(screenStations().has(FX.station)).toBe(false);
    revoke(h, tablet.deviceId);
    expect(devicePoint(tablet.deviceId)).toBeNull();
  });

  it('[03b §3.8] the maps are built at server build from the devices table (1 statement)', async () => {
    const first = await hub();
    const kds = pairKds(first, { stationId: FX.station });
    const tablet = pairPassTablet(first, { pointId: 'P1' });
    const counter = statementCounter(first.deps.db);
    const { loadDeviceMaps } = await import('../../src/kds/device-roles');
    loadDeviceMaps(first.deps.db);
    expect(counter.count).toBe(1);
    expect(screenStations().get(FX.station)).toEqual([kds.deviceId]);
    expect(devicePoint(tablet.deviceId)).toBe('P1');
    expect(devicePoint('D_UNKNOWN')).toBeNull();
  });

  it('[03b §3.8, G-1] point resolver: registered; the point’s unrevoked tablets and the staff signed in on them, 1 statement for every point', async () => {
    const h = await hub();
    await seedDirectory(h, await cookDirectory());
    expect(hasTargetResolver('point')).toBe(true);
    const t1 = pairPassTablet(h, { pointId: 'P1', name: 'Pass 1' });
    const t2 = pairPassTablet(h, { pointId: 'P1', name: 'Pass 2' });
    const t3 = pairPassTablet(h, { pointId: 'P2', name: 'Other point' });
    const gone = pairPassTablet(h, { pointId: 'P1', name: 'Revoked' });
    pairPassTablet(h, { pointId: 'P9', name: 'Unasked point' });
    const kds = pairKds(h, { stationId: FX.station });
    h.deps.db.prepare("UPDATE devices SET point_id = 'P1' WHERE device_id = ?").run(kds.deviceId); // not a tablet
    h.deps.db.prepare('UPDATE devices SET revoked_at = 1 WHERE device_id = ?').run(gone.deviceId);
    openSession(h, { kind: 'staff', staffId: COOK.staff, deviceId: t1.deviceId });
    const ended = openSession(h, { kind: 'staff', staffId: 'S_WAIT', deviceId: t2.deviceId });
    endSessionNow(h, ended.sessionId);
    openSession(h, { kind: 'staff', staffId: 'S_MGR', deviceId: t3.deviceId });

    const counter = statementCounter(h.deps.db);
    const out = h.deps.writer.run((tx) =>
      resolveTargets(tx, [
        { kind: 'point', point_id: 'P1' },
        { kind: 'point', point_id: 'P2' },
        { kind: 'point', point_id: 'P_NONE' },
      ]),
    ).result;
    expect(counter.count).toBe(1);
    const p1 = out.get('point:P1')!;
    expect(p1.device_ids.slice().sort()).toEqual([t1.deviceId, t2.deviceId].sort());
    expect(p1.staff_ids).toEqual([COOK.staff]);
    expect(out.get('point:P2')).toEqual({ staff_ids: ['S_MGR'], device_ids: [t3.deviceId] });
    expect(out.get('point:P_NONE')).toBeUndefined();
  });

  it('[03b §6.21, G-1] ready_to_serve step 3 (2 × window_ms) reaches the point’s tablets and their staff', async () => {
    const h = await hub();
    await seedDirectory(h, await cookDirectory());
    const tablet = pairPassTablet(h, { pointId: 'P1' });
    openSession(h, { kind: 'staff', staffId: COOK.staff, deviceId: tablet.deviceId });
    const { alert_id } = h.deps.writer.run((tx) => {
      const r = alerts.raise(alerts.tickCtx(tx, h.clock.branchNow()), {
        kind: 'ready_to_serve',
        subject: { stream_type: 'order', stream_id: 'O1' },
        target: { kind: 'person', staff_id: 'S_WAIT' },
        values: { order_id: 'O1', point_id: 'P1', table_id: 'T4', window_ms: 60_000 },
        details: { identifier: 'T4' },
        dedupe_key: 'ready_to_serve:O1:P1',
        display: { kind_label_key: 'alert.ready_to_serve.lock' },
      });
      tx.append(r.events);
      return r;
    }).result;
    for (const ms of [60_000, 60_000]) {
      h.clock.advance(ms);
      const now = h.clock.branchNow();
      h.deps.writer.run((tx) => tx.append(alertsTick.intents(tx, tx.state as EngineState, now)));
    }
    const step3 = h.deps.db
      .prepare('SELECT staff_id, device_id FROM alert_recipients WHERE alert_id = ? AND step = 2')
      .all(alert_id) as Array<{ staff_id: string | null; device_id: string | null }>;
    expect(step3.some((r) => r.device_id === tablet.deviceId)).toBe(true);
    expect(step3.some((r) => r.staff_id === COOK.staff)).toBe(true);
  });
});
