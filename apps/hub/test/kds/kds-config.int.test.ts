import type { EngineState } from '@pos/engine';
import type { BranchConfig, WsStationNotice } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { kdsConfigHook } from '../../src/kds/config-hook';
import { loadDeviceMaps } from '../../src/kds/device-roles';
import { kdsPresenceTick } from '../../src/kds/presence';
import { branchConfig, runBranchConfigHooks, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { kdsStationBody } from '../../src/ws/kds-catch-up';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { FX, appendOrder, cookDirectory, fireLines, openDay, pairDevice, pairKds, pairPassTablet, removeLine, signInCook } from './fixtures';

// 03b §3.10 (archived station: config hook + station_notice), §6.12 (GET /admin/queries/kds-config, manage-devices,
// 3 statements + memory); tests #51, #52; task b23. Test secrets repeat after 8 tokens per hub: each test pairs at most 8
// devices + sessions.

let hub: TestHub;
const sockets: WsClient[] = [];
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  swapBranchConfig(null);
  await hub?.close();
});

const engine = (): EngineState => hub.deps.state.get() as EngineState;
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

async function connect(device_token: string, session_token?: string): Promise<WsClient> {
  const ws = await connectWs(hub.app);
  sockets.push(ws);
  ws.send(session_token === undefined ? { type: 'auth', device_token } : { type: 'auth', device_token, session_token });
  await ws.untilCount(1);
  return ws;
}

type Admin = { token: string; session: string };
function admin(staffId = 'S_OWNER'): Admin {
  const device = pairDevice(hub, { type: 'tablet', name: 'Admin tab' });
  return { token: device.token, session: openSession(hub, { kind: 'admin', staffId, deviceId: device.deviceId }).token };
}

async function kdsConfig(a: Admin): Promise<{ status: number; data?: Record<string, unknown>; error?: { code: string; details: Record<string, unknown> } }> {
  const res = await hub.app.inject({ method: 'GET', url: '/admin/queries/kds-config', headers: { authorization: `Bearer ${a.token}`, 'x-admin-session': a.session } });
  const body = res.json() as { data?: Record<string, unknown>; error?: { code: string; details: Record<string, unknown> } };
  return { status: res.statusCode, ...body };
}

function archive(stationId: string): BranchConfig {
  const config = branchConfig()!;
  const next: BranchConfig = { ...config, config_version: config.config_version + 1, stations: config.stations.map((s) => (s.station_id === stationId ? { ...s, is_archived: true } : s)) };
  hub.deps.writer.run((tx) => runBranchConfigHooks(config, next, tx));
  swapBranchConfig({ config: next, snapshotHash: 'd'.repeat(64), configVersion: next.config_version, snapshotSchemaVersion: 4, appliedAt: hub.clock.branchNow() });
  return next;
}

const notices = (ws: WsClient): WsStationNotice[] => ws.messages.filter((m) => (m as { type?: string }).type === 'station_notice') as WsStationNotice[];

describe('[03b §6.12] GET /admin/queries/kds-config (b23)', () => {
  it('[03b #51] stations with screens (connected / signed_out / offline), lanes and sound volume; Pass tablets incl. a signed-out one (alert mode)', async () => {
    hub = await createTestHub({ provisioned: true });
    const cook = await signInCook(hub, { pointId: 'P1' }); // Pass tablet P1, signed in (2 tokens)
    openDay(hub);
    const a = admin(); // 2 tokens
    const kdsOn = pairKds(hub, { stationId: FX.station, name: 'KDS 1', laneLabel: 'Left' });
    const kdsOff = pairKds(hub, { stationId: FX.station, name: 'KDS 2' });
    const signedOut = pairPassTablet(hub, { pointId: 'P1', name: 'Pass 2' });
    await connect(cook.token, cook.sessionToken);
    await connect(kdsOn.token, openSession(hub, { kind: 'station', deviceId: kdsOn.deviceId, stationId: FX.station }).token);
    await connect(signedOut.token); // alert mode (00 H-1)

    const reply = await kdsConfig(a);
    expect(reply.status).toBe(200);
    expect(reply.data).toEqual({
      stations: [
        {
          station_id: FX.station,
          name: 'Karahi',
          point_id: 'P1',
          sound_volume: 70,
          lanes: { lanes_on: 1, lane_count: 1 },
          screens: [
            { device_id: kdsOn.deviceId, name: 'KDS 1', lane_label: 'Left', state: 'connected' },
            { device_id: kdsOff.deviceId, name: 'KDS 2', lane_label: null, state: 'offline' },
          ],
          dark: false,
        },
        { station_id: FX.zoneStation, name: 'Counter', point_id: 'P1', sound_volume: 70, lanes: { lanes_on: 1, lane_count: 1 }, screens: [], dark: false },
      ],
      pass_tablets: [
        { device_id: cook.deviceId, name: 'tablet', point_id: 'P1', state: 'connected' },
        { device_id: signedOut.deviceId, name: 'Pass 2', point_id: 'P1', state: 'signed_out' },
      ],
      points: branchConfig()!.points.map((pt) => ({ point_id: pt.point_id, name: pt.name, is_archived: pt.is_archived })),
      warnings: [],
    });
  });

  it('[03b #55] kds-config lists points with name and is_archived, an archived point included', async () => {
    hub = await createTestHub({ provisioned: true });
    await seedDirectory(hub, await cookDirectory());
    openDay(hub);
    const a = admin();
    const config = branchConfig()!;
    swapBranchConfig({
      config: { ...config, points: [...config.points, { point_id: 'P_OLD', name: 'Old pass', sort_order: 9, is_archived: true }] },
      snapshotHash: 'c'.repeat(64),
      configVersion: config.config_version,
      snapshotSchemaVersion: 4,
      appliedAt: hub.clock.branchNow(),
    });
    const points = (await kdsConfig(a)).data!.points;
    expect(points).toEqual([...config.points.map((pt) => ({ point_id: pt.point_id, name: pt.name, is_archived: pt.is_archived })), { point_id: 'P_OLD', name: 'Old pass', is_archived: true }]);
    expect(config.points.length).toBeGreaterThan(0);
  });

  it('[03b #55] a dark warning carries the station name; the handler runs exactly 3 statements; a dark station is flagged', async () => {
    hub = await createTestHub({ provisioned: true });
    await seedDirectory(hub, await cookDirectory());
    openDay(hub);
    const a = admin();
    pairKds(hub, { stationId: FX.station });
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.piece }] });
    fireLines(hub, FX.station, ['A1']);
    const t0 = hub.clock.branchNow();
    kdsPresenceTick.due(readOnlyDb(hub.deps.db), engine(), t0);
    expect(kdsPresenceTick.due(readOnlyDb(hub.deps.db), engine(), t0 + 30_000)).toBe(true);
    hub.deps.writer.run((tx) => tx.append(kdsPresenceTick.intents(tx, tx.state as EngineState, t0 + 30_000)));

    // count the query handler alone: wrap the registered definition's handle
    const { queryRegistry } = await import('../../src/queries/registry');
    const def = queryRegistry(hub.app).byResource('kds-config')!;
    const original = def.handle.bind(def);
    const counter = statementCounter(hub.deps.readDb); // queries read on the hub's read connection
    let handlerStatements = -1;
    def.handle = (ctx, q) => {
      const before = counter.count;
      const out = original(ctx, q);
      handlerStatements = counter.count - before;
      return out;
    };
    const reply = await kdsConfig(a);
    expect(handlerStatements).toBe(3);
    const data = reply.data as { stations: Array<{ station_id: string; dark: boolean }>; warnings: unknown[] };
    expect(data.stations.find((s) => s.station_id === FX.station)!.dark).toBe(true);
    expect(data.warnings).toEqual([{ station_id: FX.station, kind: 'dark', name: 'Karahi' }]);
  });

  it('[03b §3.9] without manage-devices → 403 PERMISSION_DENIED { permission: manage-devices }', async () => {
    hub = await createTestHub({ provisioned: true });
    const d = await cookDirectory();
    await seedDirectory(hub, { ...d, staff: d.staff.map((s) => (s.staff_id === 'S_MGR' ? { ...s, denied_permissions: ['manage-devices'] } : s)) });
    openDay(hub);
    const reply = await kdsConfig(admin('S_MGR'));
    expect(reply.status).toBe(403);
    expect(reply.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'manage-devices' } });
  });
});

describe('[03b §3.10] archived station config reaction (b23)', () => {
  it('[03b #52] [03b #55] archived with open lines: station_notice to its sockets and its Pass; lines still render; the archived_open_lines warning carries the archived station name (not in stations[]) and clears when the lines are gone', async () => {
    hub = await createTestHub({ provisioned: true });
    const cook = await signInCook(hub, { pointId: 'P1' });
    openDay(hub);
    const a = admin();
    const kds = pairKds(hub, { stationId: FX.station });
    const pass = await connect(cook.token, cook.sessionToken);
    const station = await connect(kds.token, openSession(hub, { kind: 'station', deviceId: kds.deviceId, stationId: FX.station }).token);
    // a cashier kiosk bound to P1 is no Pass tablet (§3.1): it gets no notice (8 tokens: the test secrets' limit)
    const kiosk = pairDevice(hub, { type: 'cashier_kiosk' });
    hub.deps.db.prepare("UPDATE devices SET point_id = 'P1' WHERE device_id = ?").run(kiosk.deviceId);
    loadDeviceMaps(hub.deps.db);
    const kioskWs = await connect(kiosk.token, openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: kiosk.deviceId }).token);
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.piece }, { order_item_id: 'A2', item_id: FX.piece }] });
    fireLines(hub, FX.station, ['A1']);

    archive(FX.station);
    await settle();
    const notice = { type: 'station_notice', station_id: FX.station, kind: 'archived', open_lines: 2 };
    expect(notices(station)).toEqual([notice]);
    expect(notices(pass)).toEqual([notice]);
    expect(notices(kioskWs)).toEqual([]);
    // the KDS still renders its lines
    expect(kdsStationBody(hub.deps.db, engine(), FX.station, hub.clock.branchNow()).now.map((l) => l.order_item_id)).toEqual(['A1']);
    expect((await kdsConfig(a)).data!.warnings).toEqual([{ station_id: FX.station, kind: 'archived_open_lines', name: 'Karahi' }]);
    // archived stations are not listed as active stations
    expect(((await kdsConfig(a)).data!.stations as Array<{ station_id: string }>).map((s) => s.station_id)).toEqual([FX.zoneStation]);

    removeLine(hub, order_id, 'A1');
    removeLine(hub, order_id, 'A2');
    expect((await kdsConfig(a)).data!.warnings).toEqual([]);
  });

  it('[03b #52] no notice without open lines; the hook never throws on an odd config', async () => {
    hub = await createTestHub({ provisioned: true });
    const cook = await signInCook(hub, { pointId: 'P1' });
    openDay(hub);
    const pass = await connect(cook.token, cook.sessionToken);
    archive(FX.zoneStation);
    await settle();
    expect(notices(pass)).toEqual([]);
    const odd = { stations: [null, { station_id: 7, is_archived: true }, { is_archived: true }] } as unknown as BranchConfig;
    const hook = kdsConfigHook(hub.app); // this module's hook alone (other modules' hooks need a real config)
    for (const next of [odd, { stations: 'nope' }, null, { stations: [{ station_id: FX.station, is_archived: true, point_id: 5 }] }] as unknown as BranchConfig[]) {
      expect(() => hub.deps.writer.run((tx) => hook(branchConfig(), next, tx))).not.toThrow();
    }
    await settle();
    expect(notices(pass)).toEqual([]);
  });
});
