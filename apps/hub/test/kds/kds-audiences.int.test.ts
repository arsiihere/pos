import type { EngineState } from '@pos/engine';
import type { BranchConfig, PosEvent } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { loadDeviceMaps } from '../../src/kds/device-roles';
import { kdsPresenceTick } from '../../src/kds/presence';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { audienceAllows } from '../../src/ws/audience';
import type { SocketCtx } from '../../src/ws/catch-up';
import { createTestHub, openSession, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { FX, append, appendOrder, fireLines, fixtureMenu, openDay, pairDevice, pairKds, pairPassTablet, signInCook } from './fixtures';

// 03b §6.17 (task b22): event audiences. Station sockets of the line's station, Pass sockets of the line's point, Pass
// sockets of the station's point while it is under takeover; Pass events to the payload's point. G-10: exact only for
// ItemStarted, ItemDone, ItemDoneUndone, FireDispatched and 03b's events (02b / 03a send the others wider).
// Config: S1 (Karahi) and S2 (Counter) on P1, S3 (Grill) on P2.

let hub: TestHub;
const sockets: WsClient[] = [];
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  swapBranchConfig(null);
  await hub?.close();
});

const engine = (): EngineState => hub.deps.state.get() as EngineState;
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

function menu(): BranchConfig {
  const base = fixtureMenu();
  const s1 = base.stations[0]!;
  return {
    ...base,
    points: [...base.points, { point_id: 'P2', name: 'Pass 2', sort_order: 1, is_archived: false }],
    stations: [...base.stations, { ...s1, station_id: 'S3', name: 'Grill', point_id: 'P2' }],
    items: [...base.items, { ...base.items.find((i) => i.item_id === FX.naan)!, item_id: 'I_GRILL', name: 'Tikka', station_id: 'S3', sort_order: 9 }],
  };
}

interface Seats {
  s1: SocketCtx;
  s2: SocketCtx;
  s3: SocketCtx;
  p1: SocketCtx;
  p2: SocketCtx;
  plain: SocketCtx;
  /** a cashier kiosk bound to P1: never a Pass (§3.1) */
  kiosk: SocketCtx;
}

async function start(): Promise<Seats> {
  hub = await createTestHub({ provisioned: true });
  await signInCook(hub, { pointId: 'P1' }); // seeds the directory
  openDay(hub, { menu: menu() });
  const station = (stationId: string): SocketCtx => ({ deviceId: pairKds(hub, { stationId }).deviceId, deviceType: 'kds', sessionId: `X_${stationId}`, kind: 'station', staffId: null, stationId, asOfSeq: 0 });
  const kioskOnP1 = (): SocketCtx => {
    const { deviceId } = pairDevice(hub, { type: 'cashier_kiosk' });
    hub.deps.db.prepare("UPDATE devices SET point_id = 'P1' WHERE device_id = ?").run(deviceId);
    loadDeviceMaps(hub.deps.db);
    return { deviceId, deviceType: 'cashier_kiosk', sessionId: 'X_KIOSK', kind: 'staff', staffId: 'S_CASH', stationId: null, asOfSeq: 0 };
  };
  const staff = (deviceId: string, sessionId: string): SocketCtx => ({ deviceId, deviceType: 'tablet', sessionId, kind: 'staff', staffId: 'S_MGR', stationId: null, asOfSeq: 0 });
  return {
    s1: station(FX.station),
    s2: station(FX.zoneStation),
    s3: station('S3'),
    p1: staff(pairPassTablet(hub, { pointId: 'P1' }).deviceId, 'X_P1'),
    p2: staff(pairPassTablet(hub, { pointId: 'P2' }).deviceId, 'X_P2'),
    plain: staff(pairDevice(hub, { type: 'tablet' }).deviceId, 'X_PLAIN'),
    kiosk: kioskOnP1(),
  };
}

let seq = 1_000;
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

/** An order with A1 on S1 (P1) and G1 on S3 (P2). */
function order(): string {
  const { order_id } = appendOrder(hub, {
    order_type: 'takeaway',
    lines: [
      { order_item_id: 'A1', item_id: FX.piece },
      { order_item_id: 'G1', item_id: 'I_GRILL' },
    ],
  });
  return order_id;
}

describe('[03b §6.17] event audiences (b22)', () => {
  it('[03b §6.17] ItemStarted / ItemDone / ItemDoneUndone / FireDispatched reach exactly the line station socket and its point Pass', async () => {
    const seats = await start();
    const o = order();
    for (const type of ['ItemStarted', 'ItemDone', 'ItemDoneUndone']) {
      const payload = { order_item_id: 'A1', started_at: 0, done_at: 0, source: 'tap' };
      expect(who(seats, ev(type, 'order', o, payload)), type).toEqual(['p1', 's1']);
      expect(who(seats, ev(type, 'order', o, { ...payload, order_item_id: 'G1' })), type).toEqual(['p2', 's3']);
    }
    expect(who(seats, ev('FireDispatched', 'station', FX.station, { station_id: FX.station, order_item_ids: ['A1'], load_id: null, due_at: 0, reason: 'pulled' }))).toEqual(['p1', 's1']);
    // an unknown line: nobody
    expect(who(seats, ev('ItemStarted', 'order', o, { order_item_id: 'NOPE', started_at: 0, source: 'tap' }))).toEqual([]);
  });

  it('[03b §6.17] every listed line event reaches the line station socket and its point Pass (02b / 03a may add more, G-10)', async () => {
    const seats = await start();
    const o = order();
    const events = [
      ev('ItemRemoved', 'order', o, { order_item_id: 'G1' }),
      ev('ItemVoided', 'order', o, { order_item_id: 'G1', units: 1 }),
      ev('ItemServed', 'order', o, { order_item_ids: ['G1'], source: 'tap' }),
      ev('OrderBoosted', 'order', o, { order_id: o }),
      ev('ItemsReleased', 'order', o, { order_id: o, alert_id: null, released: ['G1'], expedite: [] }),
      ev('StationCapacitySet', 'station', 'S3', { station_id: 'S3', capacity_override: null, previous: null, reason: 'manager' }),
    ];
    for (const e of events) {
      const got = who(seats, e);
      expect(got, e.event_type).toEqual(expect.arrayContaining(['p2', 's3']));
      expect(got.filter((k) => k.startsWith('s')), e.event_type).toEqual(e.event_type === 'StationCapacitySet' ? ['s1', 's2', 's3'] : e.event_type === 'OrderBoosted' ? ['s1', 's3'] : ['s3']);
    }
  });

  it('[03b §6.17] ReadyToServe, ReadyToServeUndone, Handover, ReadyRetargeted reach exactly the Pass sockets of their point', async () => {
    const seats = await start();
    const o = order();
    const events = [
      ev('ReadyToServe', 'order', o, { order_id: o, point_id: 'P1', order_item_ids: ['A1'], table_id: null, alert_id: null }),
      ev('ReadyToServeUndone', 'order', o, { order_id: o, point_id: 'P1', alert_id: null }),
      ev('Handover', 'order', o, { handover_id: 'H1', order_id: o, point_id: 'P1', receiver_staff_id: 'S_WAIT', order_item_ids: ['A1'], alert_id: 'A', ready_alert_closed: null }),
      ev('ReadyRetargeted', 'order', o, { order_id: o, point_id: 'P1', table_id: 'T2', alert_id: 'A2', previous_alert_id: 'A1' }),
    ];
    for (const e of events) expect(who(seats, e), e.event_type).toEqual(['p1']);
  });

  it('[03b §6.17, §3.6] a line event of a station under takeover also reaches the Pass sockets of the station point', async () => {
    const seats = await start();
    const o = order();
    // S1 moves to P2 after A1 was planned on P1: A1's point stays P1, the station's point is now P2
    const config = branchConfig()!;
    swapBranchConfig({
      config: { ...config, stations: config.stations.map((s) => (s.station_id === FX.station ? { ...s, point_id: 'P2' } : s)) },
      snapshotHash: 'e'.repeat(64),
      configVersion: config.config_version,
      snapshotSchemaVersion: 4,
      appliedAt: hub.clock.branchNow(),
    });
    fireLines(hub, FX.station, ['A1']);
    const started = ev('ItemStarted', 'order', o, { order_item_id: 'A1', started_at: 0, source: 'tap' });
    expect(who(seats, started)).toEqual(['p1', 's1']);
    const t0 = hub.clock.branchNow();
    kdsPresenceTick.due(readOnlyDb(hub.deps.db), engine(), t0);
    expect(kdsPresenceTick.due(readOnlyDb(hub.deps.db), engine(), t0 + 30_000)).toBe(true);
    hub.deps.writer.run((tx) => tx.append(kdsPresenceTick.intents(tx, tx.state as EngineState, t0 + 30_000)));
    expect(who(seats, ev('ItemStarted', 'order', o, { order_item_id: 'A1', started_at: 0, source: 'tap' }))).toEqual(['p1', 'p2', 's1']);
  });

  it('[03b §6.17] end to end: a real Pass socket and station socket get the published ItemStarted / FireDispatched; a point-less tablet does not', async () => {
    // its own hub: test secrets repeat after 8 tokens, so start()'s six devices leave no room for sessions
    hub = await createTestHub({ provisioned: true });
    const cook = await signInCook(hub, { pointId: 'P1' });
    openDay(hub, { menu: menu() });
    const connect = async (device_token: string, session_token: string): Promise<WsClient> => {
      const ws = await connectWs(hub.app);
      sockets.push(ws);
      ws.send({ type: 'auth', device_token, session_token });
      await ws.untilCount(1);
      return ws;
    };
    const pass = await connect(cook.token, cook.sessionToken);
    const plainDevice = pairDevice(hub, { type: 'tablet' });
    const plain = await connect(plainDevice.token, openSession(hub, { kind: 'staff', staffId: 'S_OWNER', deviceId: plainDevice.deviceId }).token);
    const kds = pairKds(hub, { stationId: FX.station });
    const station = await connect(kds.token, openSession(hub, { kind: 'station', deviceId: kds.deviceId, stationId: FX.station }).token);
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'Z1', item_id: FX.piece }] });
    fireLines(hub, FX.station, ['Z1']);
    append(hub, [{ stream_type: 'order', stream_id: order_id, event_type: 'ItemStarted', payload: { order_item_id: 'Z1', started_at: hub.clock.branchNow(), source: 'tap' } }]);
    await settle();
    const types = (ws: WsClient): string[] => ws.messages.flatMap((m) => {
      const t = (m as { event?: { event_type?: string } }).event?.event_type;
      return t === undefined ? [] : [t];
    });
    expect(types(station)).toEqual(expect.arrayContaining(['FireDispatched', 'ItemStarted']));
    expect(types(pass)).toEqual(expect.arrayContaining(['FireDispatched', 'ItemStarted']));
    expect(types(plain).filter((t) => t === 'FireDispatched' || t === 'ItemStarted')).toEqual([]);
  });
});
