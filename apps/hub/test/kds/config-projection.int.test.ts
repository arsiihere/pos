import { canonicalJson, sha256hex } from '@pos/domain/hash';
import type { BranchConfig } from '@pos/events';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { kdsConfigProjection, laneCount, registerKdsConfigProjection } from '../../src/kds/config-projection';
import { createProjectionRegistry } from '../../src/projections/registry';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { append, FX, fixtureMenu, openDay, pairKds } from './fixtures';

// 03b b5: projection kds_config (§3.7 mirror, §3.8 sound, §5 reset). Test 13 (mirror half) and rebuild = live.

const BRANCH = 'branch-1';

/** fixtureMenu() with S1's capacity / lane_units replaced. */
function menuWith(s1: { capacity: number; lane_units: number | null }): BranchConfig {
  const menu = fixtureMenu();
  return { ...menu, stations: menu.stations.map((s) => (s.station_id === FX.station ? { ...s, ...s1 } : s)) };
}

type Reason = 'manager' | 'lane_off' | 'lane_on';

function capacitySet(station_id: string, capacity_override: number | null, reason: Reason, previous: number | null = null) {
  return { stream_type: 'station' as const, stream_id: station_id, event_type: 'StationCapacitySet', payload: { station_id, capacity_override, previous, reason } };
}

function lanesSet(station_id: string, lanes_on: number, lane_count: number) {
  return { stream_type: 'station' as const, stream_id: station_id, event_type: 'LanesSet', payload: { station_id, lanes_on, lane_count } };
}

function screenSet(station_id: string, sound_volume: number) {
  return { stream_type: 'hub' as const, stream_id: BRANCH, event_type: 'StationScreenSet', payload: { station_id, sound_volume } };
}

function lanes(db: Database.Database, station_id: string): { lanes_on: number | null; lane_count: number } | undefined {
  return db.prepare('SELECT lanes_on, lane_count FROM station_lanes WHERE station_id = ?').get(station_id) as
    | { lanes_on: number | null; lane_count: number }
    | undefined;
}

function dump(db: Database.Database): Record<string, unknown[]> {
  return {
    kds_station_settings: db.prepare('SELECT * FROM kds_station_settings ORDER BY station_id').all(),
    station_lanes: db.prepare('SELECT * FROM station_lanes ORDER BY station_id').all(),
  };
}

describe('03b kds_config projection (b5)', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function hubWith(s1: { capacity: number; lane_units: number | null }, laneLabels = ['A', 'B']): Promise<TestHub> {
    const hub = await createTestHub({ provisioned: true });
    cleanups.push(() => hub.close());
    for (const label of laneLabels) pairKds(hub, { stationId: FX.station, laneLabel: label });
    openDay(hub, { menu: menuWith(s1) });
    return hub;
  }

  it('[03b #13] StationCapacitySet then LanesSet in one commit: LanesSet stores lanes_on exactly (clamped tie k = 1 / k = 2)', async () => {
    const hub = await hubWith({ capacity: 4, lane_units: 4 });
    append(hub, [capacitySet(FX.station, 4, 'lane_off'), lanesSet(FX.station, 1, 2)]);
    expect(lanes(hub.deps.db, FX.station)).toEqual({ lanes_on: 1, lane_count: 2 });
    // the next Lane On (03a's SetStationCapacity clears the override) folds to all on
    append(hub, [capacitySet(FX.station, null, 'lane_on', 4), lanesSet(FX.station, 2, 2)]);
    expect(lanes(hub.deps.db, FX.station)).toEqual({ lanes_on: 2, lane_count: 2 });
  });

  it('[03b #13] a KDS calling SetStationCapacity { lane_off } directly: tie → smallest k; { lane_on } tie → largest k', async () => {
    const hub = await hubWith({ capacity: 4, lane_units: 4 });
    append(hub, [capacitySet(FX.station, 4, 'lane_off')]);
    expect(lanes(hub.deps.db, FX.station)).toEqual({ lanes_on: 1, lane_count: 2 });
    append(hub, [capacitySet(FX.station, 4, 'lane_on')]);
    expect(lanes(hub.deps.db, FX.station)).toEqual({ lanes_on: 2, lane_count: 2 });
  });

  it('[03b #13] inverse without a tie (lane_units null → capacity ÷ lane_count); no k matches → custom', async () => {
    const hub = await hubWith({ capacity: 6, lane_units: null }, ['A', 'B', 'C']);
    append(hub, [capacitySet(FX.station, 4, 'lane_off')]);
    expect(lanes(hub.deps.db, FX.station)).toEqual({ lanes_on: 2, lane_count: 3 });
    append(hub, [capacitySet(FX.station, 5, 'lane_on')]);
    expect(lanes(hub.deps.db, FX.station)).toEqual({ lanes_on: null, lane_count: 3 });
  });

  it('[03b #13] manager override → custom; a null override (any reason) → all on', async () => {
    const hub = await hubWith({ capacity: 4, lane_units: 2 });
    append(hub, [capacitySet(FX.station, 2, 'manager')], { actor: 'S_MGR' });
    expect(lanes(hub.deps.db, FX.station)).toEqual({ lanes_on: null, lane_count: 2 });
    append(hub, [capacitySet(FX.station, null, 'manager', 2)], { actor: 'S_MGR' });
    expect(lanes(hub.deps.db, FX.station)).toEqual({ lanes_on: 2, lane_count: 2 });
  });

  it('[03b #13] lane Off at night → BusinessDayOpened → all on (every station_lanes row deleted; sound kept)', async () => {
    const hub = await hubWith({ capacity: 4, lane_units: 2 });
    append(hub, [screenSet(FX.station, 40), capacitySet(FX.station, 2, 'lane_off'), lanesSet(FX.station, 1, 2)]);
    expect(lanes(hub.deps.db, FX.station)).toEqual({ lanes_on: 1, lane_count: 2 });
    hub.clock.advance(12 * 3_600_000);
    openDay(hub, { menu: menuWith({ capacity: 4, lane_units: 2 }) });
    expect(dump(hub.deps.db)).toEqual({ kds_station_settings: [{ station_id: FX.station, sound_volume: 40 }], station_lanes: [] });
  });

  it('[03b §3.8] StationScreenSet upserts sound_volume (last write wins)', async () => {
    const hub = await hubWith({ capacity: 4, lane_units: null });
    append(hub, [screenSet(FX.station, 0)]);
    append(hub, [screenSet(FX.station, 100), screenSet(FX.zoneStation, 55)]);
    expect(dump(hub.deps.db).kds_station_settings).toEqual([
      { station_id: FX.station, sound_volume: 100 },
      { station_id: FX.zoneStation, sound_volume: 55 },
    ]);
  });

  it('[03b §3.7] the fold is total: a station not in branchConfig() → custom, never throws', async () => {
    const hub = await hubWith({ capacity: 4, lane_units: null });
    append(hub, [capacitySet('S_GONE', 3, 'lane_off')]);
    expect(lanes(hub.deps.db, 'S_GONE')).toEqual({ lanes_on: null, lane_count: 1 });
  });

  it('[03b #12] laneCount: labelled, unrevoked kds devices of the station (1 statement); none → 1', async () => {
    const hub = await hubWith({ capacity: 4, lane_units: null }, []);
    const db = hub.deps.db;
    const counter = statementCounter(db);
    expect(laneCount(db, FX.station)).toBe(1);
    expect(counter.count).toBe(1);
    pairKds(hub, { stationId: FX.station }); // no label: not a lane
    const a = pairKds(hub, { stationId: FX.station, laneLabel: 'A' });
    pairKds(hub, { stationId: FX.station, laneLabel: 'B' });
    pairKds(hub, { stationId: FX.zoneStation, laneLabel: 'A' }); // other station
    expect(laneCount(db, FX.station)).toBe(2);
    db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').run(hub.clock.branchNow(), a.deviceId);
    expect(laneCount(db, FX.station)).toBe(1);
  });

  it('[03b §5] rebuild = live: reset + catch-up gives the same kds_config tables', async () => {
    const hub = await hubWith({ capacity: 4, lane_units: 4 });
    const db = hub.deps.db;
    append(hub, [screenSet(FX.station, 30), capacitySet(FX.station, 4, 'lane_off'), lanesSet(FX.station, 1, 2)]);
    append(hub, [capacitySet(FX.station, 4, 'lane_on')]);
    append(hub, [capacitySet(FX.zoneStation, 3, 'manager')], { actor: 'S_MGR' });
    hub.clock.advance(12 * 3_600_000);
    openDay(hub, { menu: menuWith({ capacity: 4, lane_units: 4 }) });
    append(hub, [screenSet(FX.station, 80), capacitySet(FX.station, 4, 'lane_off')]);
    const live = dump(db);
    expect(live.station_lanes).toEqual([{ station_id: FX.station, lanes_on: 1, lane_count: 2 }]);

    // reset must clear rows the replay does not write
    db.prepare("INSERT INTO kds_station_settings (station_id, sound_volume) VALUES ('JUNK', 1)").run();
    db.prepare("INSERT INTO station_lanes (station_id, lanes_on, lane_count) VALUES ('JUNK', 1, 1)").run();
    db.prepare("DELETE FROM projection_checkpoints WHERE projection = 'kds_config'").run();
    const fresh = createProjectionRegistry();
    registerKdsConfigProjection(fresh);
    expect(fresh.catchUp(db, BRANCH).replayed.kds_config).toBe(9);
    expect(dump(db)).toEqual(live);
  });

  it('[03b §3.7, §5] boot rebuild = live: catch-up with no config in memory (step 4 before step 5) reads the stored applied config', async () => {
    const hub = await hubWith({ capacity: 4, lane_units: 4 });
    const db = hub.deps.db;
    // store the applied config as the poller does (snapshot body + BranchConfigApplied → branch_config row)
    const body = menuWith({ capacity: 4, lane_units: 4 });
    const hash = sha256hex(canonicalJson(body));
    db.prepare('INSERT INTO config_snapshots (snapshot_hash, config_version, body, received_at) VALUES (?, ?, ?, ?)').run(hash, body.config_version, canonicalJson(body), 1);
    append(hub, [
      {
        stream_type: 'hub',
        stream_id: BRANCH,
        event_type: 'BranchConfigApplied',
        payload: { config_version: body.config_version, snapshot_schema_version: 4, snapshot_hash: hash, previous_config_version: null },
      },
    ]);
    // direct lane writers (03a SetStationCapacity from a KDS, 01e), no LanesSet: the inverse decides
    append(hub, [capacitySet(FX.station, 4, 'lane_off')]);
    append(hub, [capacitySet(FX.zoneStation, 4, 'lane_on')]);
    const live = dump(db);
    expect(live.station_lanes).toEqual([
      { station_id: FX.station, lanes_on: 1, lane_count: 2 },
      { station_id: FX.zoneStation, lanes_on: 1, lane_count: 1 },
    ]);

    const held = branchConfig();
    swapBranchConfig(null);
    try {
      db.prepare("DELETE FROM projection_checkpoints WHERE projection = 'kds_config'").run();
      const fresh = createProjectionRegistry();
      registerKdsConfigProjection(fresh);
      fresh.catchUp(db, BRANCH);
      expect(dump(db)).toEqual(live);
    } finally {
      swapBranchConfig(held === null ? null : { config: held, snapshotHash: hash, configVersion: held.config_version, snapshotSchemaVersion: 4, appliedAt: 1 });
    }
  });

  it('[03b §5] statements per fold: StationCapacitySet 2 (any reason), LanesSet 1, StationScreenSet 1, BusinessDayOpened 1', async () => {
    const hub = await hubWith({ capacity: 4, lane_units: 2 });
    const db = hub.deps.db;
    const events = [
      ...append(hub, [capacitySet(FX.station, 2, 'lane_off')]),
      ...append(hub, [capacitySet(FX.station, null, 'lane_on', 2)]),
      ...append(hub, [capacitySet(FX.station, 3, 'manager')], { actor: 'S_MGR' }),
      ...append(hub, [lanesSet(FX.station, 1, 2)]),
      ...append(hub, [screenSet(FX.station, 60)]),
    ];
    const projection = kdsConfigProjection();
    const counter = statementCounter(db);
    const counts: Array<[string, number]> = [];
    for (const event of events) {
      counter.reset();
      db.transaction(() => projection.apply(db, event, 'live'))();
      counts.push([event.event_type, counter.count]);
    }
    expect(counts).toEqual([
      ['StationCapacitySet', 2],
      ['StationCapacitySet', 2],
      ['StationCapacitySet', 2],
      ['LanesSet', 1],
      ['StationScreenSet', 1],
    ]);
    const day = { ...events[0]!, event_type: 'BusinessDayOpened' } as (typeof events)[number];
    counter.reset();
    db.transaction(() => projection.apply(db, day, 'live'))();
    expect(counter.count).toBe(1);
  });

  it('[03b §5] wiring: the test hub (as boot createDeps) registers kds_config after 02b orders', async () => {
    const hub = await createTestHub({ provisioned: true });
    cleanups.push(() => hub.close());
    const order = Object.keys(hub.deps.projections.catchUp(hub.deps.db, BRANCH).replayed);
    expect(order.indexOf('kds_config')).toBeGreaterThan(order.indexOf('orders'));
  });
});
