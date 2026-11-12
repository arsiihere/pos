import type { BranchConfig, PosCommand } from '@pos/events';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandCtx } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { cookDirectory, FX, fixtureMenu, openDay, pairKds, signInCook } from './fixtures';

// 03b b10: SetLaneState (§3.7, §6.5). Tests 11, 12, 13 (command half, append order). G-4: own-station check inline.

type Caller = { deviceToken: string; sessionToken: string; deviceId: string; staffId?: string };

let n = 0;

function menuWith(s1: { capacity: number; lane_units: number | null }): BranchConfig {
  const menu = fixtureMenu();
  return { ...menu, stations: menu.stations.map((s) => (s.station_id === FX.station ? { ...s, ...s1 } : s)) };
}

function send(hub: TestHub, c: Caller, payload: Record<string, unknown>) {
  return hub.app.inject({
    method: 'POST',
    url: '/commands/set-lane-state',
    headers: { authorization: `Bearer ${c.deviceToken}`, 'x-session-token': c.sessionToken },
    payload: {
      command_id: `cmd-lane-${(n += 1)}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'SetLaneState',
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: c.staffId ?? null,
      device_id: c.deviceId,
    },
  });
}

function stationEvents(db: Database.Database): Array<{ type: string; payload: unknown }> {
  return (
    db
      .prepare("SELECT event_type, payload FROM events WHERE event_type IN ('StationCapacitySet', 'LanesSet') ORDER BY seq")
      .all() as Array<{ event_type: string; payload: string }>
  ).map((r) => ({ type: r.event_type, payload: JSON.parse(r.payload) as unknown }));
}

function lanes(db: Database.Database): unknown {
  return db.prepare('SELECT lanes_on, lane_count FROM station_lanes WHERE station_id = ?').get(FX.station);
}

describe('03b SetLaneState (b10)', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  /** A hub with S1 = `s1`, `labels` lane screens on S1 and a station session on the first one. */
  async function open(s1: { capacity: number; lane_units: number | null }, labels: string[] = ['A', 'B']): Promise<{ hub: TestHub; kds: Caller }> {
    const hub = await createTestHub({ provisioned: true });
    cleanups.push(() => hub.close());
    await seedDirectory(hub, await cookDirectory());
    openDay(hub, { menu: menuWith(s1) });
    const devices = labels.map((label) => pairKds(hub, { stationId: FX.station, laneLabel: label }));
    const screen = devices[0] ?? pairKds(hub, { stationId: FX.station });
    const session = openSession(hub, { kind: 'station', stationId: FX.station, deviceId: screen.deviceId });
    return { hub, kds: { deviceToken: screen.token, sessionToken: session.token, deviceId: screen.deviceId } };
  }

  it('[03b #11, #13] 2 → 1 of 2: StationCapacitySet { lane_off, capacityForLanes } then LanesSet (order asserted); same value → no-op; 1 handler statement', async () => {
    const { hub, kds } = await open({ capacity: 4, lane_units: null });
    const def = commandRegistry(hub.app).byPath('set-lane-state')!;
    const original = def.handle.bind(def);
    const counter = statementCounter(hub.deps.db);
    let handled = -1;
    def.handle = (ctx: CommandCtx, payload: unknown, cmd: PosCommand) => {
      const before = counter.count;
      const out = original(ctx, payload, cmd);
      handled = counter.count - before;
      return out;
    };
    const off = await send(hub, kds, { station_id: FX.station, lanes_on: 1 });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json().data.result).toEqual({ lanes_on: 1, lane_count: 2, capacity: 2 });
    expect(handled).toBe(1);
    expect(stationEvents(hub.deps.db)).toEqual([
      { type: 'StationCapacitySet', payload: { station_id: FX.station, capacity_override: 2, previous: null, reason: 'lane_off' } },
      { type: 'LanesSet', payload: { station_id: FX.station, lanes_on: 1, lane_count: 2 } },
    ]);
    expect(lanes(hub.deps.db)).toEqual({ lanes_on: 1, lane_count: 2 });

    const same = await send(hub, kds, { station_id: FX.station, lanes_on: 1 });
    expect(same.statusCode).toBe(200);
    expect(same.json().data.result).toEqual({ lanes_on: 1, lane_count: 2, capacity: 2 });
    expect(stationEvents(hub.deps.db)).toHaveLength(2);

    const on = await send(hub, kds, { station_id: FX.station, lanes_on: 2 });
    expect(on.json().data.result).toEqual({ lanes_on: 2, lane_count: 2, capacity: 4 });
    expect(stationEvents(hub.deps.db).slice(2)).toEqual([
      { type: 'StationCapacitySet', payload: { station_id: FX.station, capacity_override: null, previous: 2, reason: 'lane_on' } },
      { type: 'LanesSet', payload: { station_id: FX.station, lanes_on: 2, lane_count: 2 } },
    ]);
  });

  it('[03b #11] 3 of 2 and 0 → 400 VALIDATION_FAILED; nothing written', async () => {
    const { hub, kds } = await open({ capacity: 4, lane_units: null });
    for (const lanes_on of [3, 0]) {
      const res = await send(hub, kds, { station_id: FX.station, lanes_on });
      expect(res.statusCode, String(lanes_on)).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
    expect(stationEvents(hub.deps.db)).toEqual([]);
  });

  it('[03b #11, G-4] a station session on another station → 403 PERMISSION_DENIED; unknown station → 404 STATION_NOT_FOUND', async () => {
    const { hub, kds } = await open({ capacity: 4, lane_units: null });
    const other = await send(hub, kds, { station_id: FX.zoneStation, lanes_on: 1 });
    expect(other.statusCode).toBe(403);
    expect(other.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', station_id: FX.zoneStation } });
    const missing = await send(hub, kds, { station_id: 'S_NONE', lanes_on: 1 });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('STATION_NOT_FOUND');
    expect(stationEvents(hub.deps.db)).toEqual([]);
  });

  it('[03b #11] station-session cap check: an override above the engine capacity (config pending) → 400 VALIDATION_FAILED', async () => {
    const { hub, kds } = await open({ capacity: 4, lane_units: null });
    // the holder already shows capacity 8 / lane_units 8 while the engine still has 4 (a pending apply)
    const bigger = menuWith({ capacity: 8, lane_units: 8 });
    swapBranchConfig({ config: bigger, snapshotHash: 'e'.repeat(64), configVersion: bigger.config_version, snapshotSchemaVersion: 4, appliedAt: hub.clock.branchNow() });
    const res = await send(hub, kds, { station_id: FX.station, lanes_on: 1 });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'capacity_override' } });
    expect(stationEvents(hub.deps.db)).toEqual([]);
  });

  it('[03b #12] lane_count from labelled, unrevoked kds devices; none → 1 (1 of 1 is all on: no-op; 2 → 400)', async () => {
    const { hub, kds } = await open({ capacity: 4, lane_units: null }, []);
    pairKds(hub, { stationId: FX.zoneStation, laneLabel: 'A' }); // another station's lane
    const one = await send(hub, kds, { station_id: FX.station, lanes_on: 1 });
    expect(one.statusCode, one.body).toBe(200);
    expect(one.json().data.result).toEqual({ lanes_on: 1, lane_count: 1, capacity: 4 });
    expect(stationEvents(hub.deps.db)).toEqual([]);
    expect((await send(hub, kds, { station_id: FX.station, lanes_on: 2 })).statusCode).toBe(400);
    // a revoked labelled screen does not count
    const { hub: h2, kds: k2 } = await open({ capacity: 4, lane_units: null }, ['A', 'B', 'C']);
    const third = h2.deps.db.prepare("SELECT device_id FROM devices WHERE lane_label = 'C'").pluck().get() as string;
    h2.deps.db.prepare('UPDATE devices SET revoked_at = 1 WHERE device_id = ?').run(third);
    const res = await send(h2, k2, { station_id: FX.station, lanes_on: 3 });
    expect(res.statusCode).toBe(400);
    expect((await send(h2, k2, { station_id: FX.station, lanes_on: 1 })).json().data.result).toEqual({ lanes_on: 1, lane_count: 2, capacity: 2 });
  });

  it('[03b #13] capacity 4, lane_units 4, 2 lanes (clamped tie): SetLaneState(1) → LanesSet stores 1 exactly; the next Lane On is accepted', async () => {
    const { hub, kds } = await open({ capacity: 4, lane_units: 4 });
    const off = await send(hub, kds, { station_id: FX.station, lanes_on: 1 });
    expect(off.json().data.result).toEqual({ lanes_on: 1, lane_count: 2, capacity: 4 });
    expect(stationEvents(hub.deps.db)[0]).toEqual({
      type: 'StationCapacitySet',
      payload: { station_id: FX.station, capacity_override: 4, previous: null, reason: 'lane_off' },
    });
    expect(lanes(hub.deps.db)).toEqual({ lanes_on: 1, lane_count: 2 });
    const on = await send(hub, kds, { station_id: FX.station, lanes_on: 2 });
    expect(on.statusCode, on.body).toBe(200);
    expect(on.json().data.result).toEqual({ lanes_on: 2, lane_count: 2, capacity: 4 });
    expect(lanes(hub.deps.db)).toEqual({ lanes_on: 2, lane_count: 2 });
  });

  it('[03b §3.7] no-op only when lanes_on AND lane_count match: a screen labelled since → SetLaneState(2) writes capacityForLanes(2, 3)', async () => {
    const { hub, kds } = await open({ capacity: 6, lane_units: null });
    await send(hub, kds, { station_id: FX.station, lanes_on: 1 });
    await send(hub, kds, { station_id: FX.station, lanes_on: 2 });
    expect(lanes(hub.deps.db)).toEqual({ lanes_on: 2, lane_count: 2 });
    const written = stationEvents(hub.deps.db).length;
    pairKds(hub, { stationId: FX.station, laneLabel: 'C' });
    const res = await send(hub, kds, { station_id: FX.station, lanes_on: 2 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.result).toEqual({ lanes_on: 2, lane_count: 3, capacity: 4 });
    expect(stationEvents(hub.deps.db).slice(written)).toEqual([
      { type: 'StationCapacitySet', payload: { station_id: FX.station, capacity_override: 4, previous: null, reason: 'lane_off' } },
      { type: 'LanesSet', payload: { station_id: FX.station, lanes_on: 2, lane_count: 3 } },
    ]);
    expect(lanes(hub.deps.db)).toEqual({ lanes_on: 2, lane_count: 3 });
  });

  it('[03b §3.7] 3 of 3 stored, a screen revoked, SetLaneState(2) = all on: LanesSet only, no no-op StationCapacitySet', async () => {
    const { hub, kds } = await open({ capacity: 6, lane_units: null }, ['A', 'B', 'C']);
    await send(hub, kds, { station_id: FX.station, lanes_on: 2 });
    await send(hub, kds, { station_id: FX.station, lanes_on: 3 });
    expect(lanes(hub.deps.db)).toEqual({ lanes_on: 3, lane_count: 3 });
    const written = stationEvents(hub.deps.db).length;
    const third = hub.deps.db.prepare("SELECT device_id FROM devices WHERE lane_label = 'C'").pluck().get() as string;
    hub.deps.db.prepare('UPDATE devices SET revoked_at = 1 WHERE device_id = ?').run(third);
    const res = await send(hub, kds, { station_id: FX.station, lanes_on: 2 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.result).toEqual({ lanes_on: 2, lane_count: 2, capacity: 6 });
    expect(stationEvents(hub.deps.db).slice(written)).toEqual([{ type: 'LanesSet', payload: { station_id: FX.station, lanes_on: 2, lane_count: 2 } }]);
    expect(lanes(hub.deps.db)).toEqual({ lanes_on: 2, lane_count: 2 });
  });

  it('[03b §3.9] run-pass staff (the Cook on a Pass tablet) may set lanes; staff without run-pass → 403', async () => {
    const { hub } = await open({ capacity: 4, lane_units: null });
    const cook = await signInCook(hub);
    const res = await send(hub, { deviceToken: cook.token, sessionToken: cook.sessionToken, deviceId: cook.deviceId, staffId: 'S_COOK' }, { station_id: FX.station, lanes_on: 1 });
    expect(res.statusCode, res.body).toBe(200);
    expect(stationEvents(hub.deps.db).map((e) => e.type)).toEqual(['StationCapacitySet', 'LanesSet']);
    const tablet = pairDevice(hub, { type: 'tablet' });
    const cash = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: tablet.deviceId });
    const denied = await send(hub, { deviceToken: tablet.token, sessionToken: cash.token, deviceId: tablet.deviceId, staffId: 'S_CASH' }, { station_id: FX.station, lanes_on: 2 });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'run-pass' } });
  });
});
