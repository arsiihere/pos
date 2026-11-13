import type { PosEvent } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { audienceAllows } from '../../src/ws/audience';
import type { SocketCtx } from '../../src/ws/catch-up';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { FX, openDay, pairDevice, pairKds, signInCook } from './fixtures';

// 03b v1.0.8 §6.17 (Q-44, HK1 / HK1b): config frames to station sockets. LanesSet → every staff and station socket;
// StationScreenSet → the station sockets of its station; BusinessDayOpened / BusinessDayClosed → also station sockets
// (owner ruling Q-62 = a), additive to 01a's staff audience; DeviceRoleSet → nobody. Memory only.

let hub: TestHub;
afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
});

interface Seats {
  /** two lane KDS screens of S1 */
  lane1: SocketCtx;
  lane2: SocketCtx;
  /** a KDS of another station */
  other: SocketCtx;
  /** a point-less staff tablet */
  tablet: SocketCtx;
}

async function start(): Promise<Seats> {
  hub = await createTestHub({ provisioned: true });
  await signInCook(hub, { pointId: 'P1' });
  openDay(hub);
  const station = (stationId: string): SocketCtx => ({ deviceId: pairKds(hub, { stationId }).deviceId, deviceType: 'kds', sessionId: `X_${stationId}_${Math.random()}`, kind: 'station', staffId: null, stationId, asOfSeq: 0 });
  return {
    lane1: station(FX.station),
    lane2: station(FX.station),
    other: station(FX.zoneStation),
    tablet: { deviceId: pairDevice(hub, { type: 'tablet' }).deviceId, deviceType: 'tablet', sessionId: 'X_TABLET', kind: 'staff', staffId: 'S_MGR', stationId: null, asOfSeq: 0 },
  };
}

let seq = 5_000;
function ev(event_type: string, stream_type: PosEvent['stream_type'], stream_id: string, payload: Record<string, unknown>): PosEvent {
  seq += 1;
  return {
    event_id: `E${seq}`,
    tenant_id: 'tenant-a',
    branch_id: 'branch-1',
    seq,
    stream_type,
    stream_id,
    event_type,
    schema_version: 1,
    payload,
    occurred_at: 0,
    recorded_at: 0,
    actor_id: null,
    device_id: 'hub',
  } as PosEvent;
}

const who = (seats: Seats, event: PosEvent): string[] =>
  (Object.entries(seats) as Array<[string, SocketCtx]>).filter(([, s]) => audienceAllows(event, s)).map(([k]) => k).sort();

const lanesSet = (): PosEvent => ev('LanesSet', 'station', FX.station, { station_id: FX.station, lanes_on: 1, lane_count: 2 });
const screenSet = (): PosEvent => ev('StationScreenSet', 'station', FX.station, { station_id: FX.station, sound_volume: 40 });

describe('[03b §6.17] config frames to station sockets (HK1)', () => {
  it('[03b #54] SetLaneState → LanesSet reaches a second lane KDS of the station, a KDS of another station and a point-less staff tablet', async () => {
    const seats = await start();
    expect(who(seats, lanesSet())).toEqual(['lane1', 'lane2', 'other', 'tablet']);
  });

  it("[03b #54] StationScreenSet reaches that station's KDS only, not another station's KDS nor a staff socket", async () => {
    const seats = await start();
    expect(who(seats, screenSet())).toEqual(['lane1', 'lane2']);
  });

  it('[03b #54] BusinessDayOpened / BusinessDayClosed reach station sockets and still every staff socket', async () => {
    const seats = await start();
    for (const type of ['BusinessDayOpened', 'BusinessDayClosed']) {
      expect(who(seats, ev(type, 'hub', 'D1', {})), type).toEqual(['lane1', 'lane2', 'other', 'tablet']);
    }
  });

  it('[03b #54] DeviceRoleSet reaches no socket', async () => {
    const seats = await start();
    const e = ev('DeviceRoleSet', 'hub', 'D1', { device_id: 'D1', point_id: 'P1', lane_label: null });
    expect(who(seats, e)).toEqual([]);
  });

  it('[03b #54] 0 statements for the audience checks', async () => {
    const seats = await start();
    const counter = statementCounter(hub.deps.db);
    counter.reset();
    for (const e of [lanesSet(), screenSet(), ev('BusinessDayOpened', 'hub', 'D1', {}), ev('BusinessDayClosed', 'hub', 'D1', {})]) who(seats, e);
    expect(counter.count).toBe(0);
  });
});
