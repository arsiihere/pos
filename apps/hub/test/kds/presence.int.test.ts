import type { EngineState } from '@pos/engine';
import { KdsStationBody, type WsStationTakeover } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { registeredTicks } from '../../src/alerts/tick';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { devicePoint, stationPresence } from '../../src/kds/contracts';
import { loadDeviceMaps } from '../../src/kds/device-roles';
import { KDS_BACK_MS, kdsPresenceTick, takeoverStations } from '../../src/kds/presence';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { kdsStationBody } from '../../src/ws/kds-catch-up';
import { wsHubFor } from '../../src/ws/server';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { FX, appendOrder, fireLines, openDay, pairDevice, pairKds, pairPassTablet, removeLine, signInCook } from './fixtures';

// 03b §3.6, §6.20 (task b20): tick `kds_presence`, `stationPresence()`, takeover frames; tests #40–#44. The tick's due /
// intents are called with an injected `now` (G-13: the loop starts only after listen; no timing asserts). Real sockets
// through the hub's /ws: a station session socket on a kds device of S1 (point P1), a Cook on a Pass tablet of P1.

const OFFLINE_MS = 30_000; // 01a default kds_offline_ms (fixtureMenu keeps the default)

let hub: TestHub;
const sockets: WsClient[] = [];
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  stationTokens.clear();
  swapBranchConfig(null);
  await hub?.close();
});

const engine = (): EngineState => hub.deps.state.get() as EngineState;
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

async function start(): Promise<{ kds: { deviceId: string; token: string }; pass: WsClient; t0: number }> {
  hub = await createTestHub({ provisioned: true });
  const cook = await signInCook(hub, { pointId: 'P1' }); // seeds cookDirectory (Owner, Manager, …, Cook)
  openDay(hub);
  const kds = pairKds(hub, { stationId: FX.station });
  const pass = await connect(cook.token, cook.sessionToken);
  return { kds, pass, t0: hub.clock.branchNow() };
}

async function connect(device_token: string, session_token: string): Promise<WsClient> {
  const ws = await connectWs(hub.app);
  sockets.push(ws);
  ws.send({ type: 'auth', device_token, session_token });
  await ws.untilCount(1);
  return ws;
}

/** A station session socket on `kds` (the screen is "back"); a reconnect reuses the device's open session. */
const stationTokens = new Map<string, string>();
async function screenOn(kds: { deviceId: string; token: string }): Promise<WsClient> {
  let token = stationTokens.get(kds.deviceId);
  if (token === undefined) {
    token = openSession(hub, { kind: 'station', deviceId: kds.deviceId, stationId: FX.station }).token;
    stationTokens.set(kds.deviceId, token);
  }
  return connect(kds.token, token);
}

async function screenOff(ws: WsClient): Promise<void> {
  ws.close();
  await settle();
}

/** One tick pass at `now`: due, and when due the tick's own writer.run (as the loop does). */
function pass(now: number): { due: boolean; appended: Array<{ event_type: string; payload: Record<string, unknown> }> } {
  const due = kdsPresenceTick.due(readOnlyDb(hub.deps.db), engine(), now);
  if (!due) return { due, appended: [] };
  const { appended } = hub.deps.writer.run((tx) => tx.append(kdsPresenceTick.intents(tx, tx.state as EngineState, now)));
  return { due, appended: appended.map((e) => ({ event_type: e.event_type, payload: e.payload as Record<string, unknown> })) };
}

const takeovers = (ws: WsClient): WsStationTakeover[] => ws.messages.filter((m) => (m as { type?: string }).type === 'station_takeover') as WsStationTakeover[];

function alertRows(): Array<{ alert_id: string; state: string; close_reason: string | null; details_json: string | null }> {
  return hub.deps.db.prepare(`SELECT alert_id, state, close_reason, details_json FROM alerts WHERE kind = 'kds_offline' ORDER BY raised_at`).all() as Array<{
    alert_id: string;
    state: string;
    close_reason: string | null;
    details_json: string | null;
  }>;
}

function raisedCount(): number {
  return (hub.deps.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_type = 'AlertRaised' AND json_extract(payload, '$.kind') = 'kds_offline'`).get() as { n: number }).n;
}

/** A takeaway order with one Karahi line on S1, fired (Now). */
function lineInNow(id = 'A1'): string {
  const { order_id } = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: id, item_id: FX.piece }] });
  fireLines(hub, FX.station, [id]);
  return order_id;
}

describe('[03b §3.6, §6.20] kds_presence tick (b20)', () => {
  it('[03b §6.20] the tick is registered once per process; due runs 1 statement (open kds_offline alerts), the rest memory', async () => {
    const { t0 } = await start();
    lineInNow();
    expect(registeredTicks().filter((t) => t.name === 'kds_presence')).toHaveLength(1);
    const counter = statementCounter(hub.deps.db);
    kdsPresenceTick.due(readOnlyDb(hub.deps.db), engine(), t0);
    expect(counter.count).toBe(1);
    counter.reset();
    kdsPresenceTick.due(readOnlyDb(hub.deps.db), engine(), t0 + OFFLINE_MS);
    expect(counter.count).toBe(1);
  });

  it('[03b #40] screen closed with lines in Now: nothing before kds_offline_ms, then kds_offline to managers once and, after the commit, station_takeover { active, view } to the point Pass', async () => {
    const { pass: passWs, t0 } = await start();
    lineInNow();
    expect(pass(t0).due).toBe(false); // the first pass starts the grace
    expect(pass(t0 + OFFLINE_MS - 1).due).toBe(false);
    expect(alertRows()).toEqual([]);
    expect(takeovers(passWs)).toEqual([]);

    const p = pass(t0 + OFFLINE_MS);
    expect(p.due).toBe(true);
    const raised = p.appended.filter((e) => e.event_type === 'AlertRaised');
    expect(raised).toHaveLength(1);
    expect(raised[0]!.payload).toMatchObject({
      kind: 'kds_offline',
      subject_stream_type: 'hub',
      dedupe_key: `kds_offline:${FX.station}`,
      target: { kind: 'managers' },
      values: { station_id: FX.station },
      details: { station_name: 'Karahi' },
    });
    // details station_name survives the append (stored on the alert)
    expect(JSON.parse(alertRows()[0]!.details_json!)).toEqual({ station_name: 'Karahi' });
    await settle();
    const frames = takeovers(passWs);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ type: 'station_takeover', station_id: FX.station, active: true });
    expect(KdsStationBody.parse(frames[0]!.view)).toEqual(kdsStationBody(hub.deps.db, engine(), FX.station, t0 + OFFLINE_MS));
    expect(frames[0]!.view!.now.map((l) => l.order_item_id)).toEqual(['A1']);
    expect([...takeoverStations(hub.deps.db).keys()]).toEqual([FX.station]);

    // once: later passes raise nothing and send no second start
    expect(pass(t0 + OFFLINE_MS + 5_000).due).toBe(false);
    await settle();
    expect(raisedCount()).toBe(1);
    expect(takeovers(passWs)).toHaveLength(1);
  });

  it('[03b #40] an intents failure (the pass rolls back) sends no takeover frame and leaves the station out of the set', async () => {
    const { pass: passWs, t0 } = await start();
    lineInNow();
    pass(t0);
    const now = t0 + OFFLINE_MS;
    expect(kdsPresenceTick.due(readOnlyDb(hub.deps.db), engine(), now)).toBe(true);
    expect(() =>
      hub.deps.writer.run((tx) => {
        tx.append(kdsPresenceTick.intents(tx, tx.state as EngineState, now));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    await settle();
    expect(takeovers(passWs)).toEqual([]);
    expect(takeoverStations(hub.deps.db).size).toBe(0);
    expect(alertRows()).toEqual([]);
    // the next pass does it
    expect(pass(now + 500).due).toBe(true);
    await settle();
    expect(takeovers(passWs)).toHaveLength(1);
    expect(alertRows()).toHaveLength(1);
  });

  it('[03b §3.1] a device with a point that is not a tablet (cashier kiosk on P1) is no Pass: devicePoint null, no takeover frame', async () => {
    const { pass: passWs, t0 } = await start();
    const kiosk = pairDevice(hub, { type: 'cashier_kiosk' });
    hub.deps.db.prepare("UPDATE devices SET point_id = 'P1' WHERE device_id = ?").run(kiosk.deviceId);
    loadDeviceMaps(hub.deps.db);
    expect(devicePoint(kiosk.deviceId)).toBeNull();
    const kioskWs = await connect(kiosk.token, openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: kiosk.deviceId }).token);
    lineInNow();
    pass(t0);
    expect(pass(t0 + OFFLINE_MS).due).toBe(true);
    await settle();
    expect(takeovers(passWs)).toHaveLength(1);
    expect(takeovers(kioskWs)).toEqual([]);
  });

  it('[03b §6.17] a config apply moves a dark station to another point: its takeover ends at the old point and starts at the new one', async () => {
    const { pass: p1, t0 } = await start();
    const tablet2 = pairPassTablet(hub, { pointId: 'P2' });
    const p2 = await connect(tablet2.token, openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: tablet2.deviceId }).token);
    lineInNow();
    pass(t0);
    pass(t0 + OFFLINE_MS);
    const config = branchConfig()!;
    swapBranchConfig({
      config: {
        ...config,
        points: [...config.points, { point_id: 'P2', name: 'Pass 2', sort_order: 1, is_archived: false }],
        stations: config.stations.map((s) => (s.station_id === FX.station ? { ...s, point_id: 'P2' } : s)),
      },
      snapshotHash: 'e'.repeat(64),
      configVersion: config.config_version,
      snapshotSchemaVersion: 4,
      appliedAt: hub.clock.branchNow(),
    });
    const p = pass(t0 + OFFLINE_MS + 500);
    expect(p.due).toBe(true);
    expect(p.appended).toEqual([]); // the alert stays (deduped); only the frames move
    await settle();
    expect(takeovers(p1).map((f) => f.active)).toEqual([true, false]);
    expect(takeovers(p2).map((f) => [f.station_id, f.active])).toEqual([[FX.station, true]]);
    expect(takeoverStations(hub.deps.db).get(FX.station)).toBe('P2');
  });

  it('[03b §3.6] a takeover start frame that throws never breaks the commit: writer.run returns, later after-commit hooks run, the station stays taken over', async () => {
    const { t0 } = await start();
    lineInNow();
    const ws = wsHubFor(hub.app);
    const send = ws.sendToSessions.bind(ws);
    ws.sendToSessions = (ids, frame) => {
      if (frame.type === 'station_takeover') throw new Error('socket gone');
      send(ids, frame);
    };
    const later: string[][] = [];
    hub.deps.writer.addAfterCommit((appended) => later.push(appended.map((e) => e.event_type)));
    pass(t0);
    const p = pass(t0 + OFFLINE_MS); // returns: the throw is caught in the onCommit callback
    expect(p.appended.map((e) => e.event_type)).toContain('AlertRaised');
    expect(later.at(-1)).toContain('AlertRaised'); // the after-commit hooks after the tick's ran
    expect([...takeoverStations(hub.deps.db).keys()]).toEqual([FX.station]);
    expect(alertRows().map((a) => a.state)).toEqual(['open']);
  });

  it('[03b #41] screen reconnects → takeover ends at once (no write); the alert closes done after 60 s connected; blips while back → one alert', async () => {
    const { kds, pass: passWs, t0 } = await start();
    lineInNow();
    pass(t0);
    pass(t0 + OFFLINE_MS);
    await settle();
    expect(takeovers(passWs)).toHaveLength(1);

    let screen = await screenOn(kds);
    const back = t0 + OFFLINE_MS + 1_000;
    const events = (): number => (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
    const before = events();
    expect(pass(back).due).toBe(false); // the end writes nothing
    await settle();
    expect(events()).toBe(before);
    expect(takeovers(passWs).at(-1)).toEqual({ type: 'station_takeover', station_id: FX.station, active: false });
    expect(takeoverStations(hub.deps.db).size).toBe(0);
    expect(alertRows()[0]!.state).toBe('open');

    // blip: off 10 s and on, twice — the alert stays open, no second alert, the 60 s restarts each time
    await screenOff(screen);
    expect(pass(back + 10_000).due).toBe(false);
    screen = await screenOn(kds);
    expect(pass(back + 20_000).due).toBe(false);
    await screenOff(screen);
    expect(pass(back + 30_000).due).toBe(false);
    screen = await screenOn(kds);
    const lastBack = back + 40_000;
    expect(pass(lastBack).due).toBe(false);
    expect(pass(lastBack + KDS_BACK_MS - 1).due).toBe(false);
    expect(raisedCount()).toBe(1);

    const p = pass(lastBack + KDS_BACK_MS);
    expect(p.due).toBe(true);
    expect(p.appended.map((e) => [e.event_type, e.payload.reason])).toEqual([['AlertClosed', 'done']]);
    expect(alertRows().map((a) => [a.state, a.close_reason])).toEqual([['closed', 'done']]);
    expect(pass(lastBack + KDS_BACK_MS + 500).due).toBe(false);
    void screen;
  });

  it('[03b #42] a dark station whose last kds device is revoked → takeover ends, the alert closes obsolete (next tick, through intents)', async () => {
    const { kds, pass: passWs, t0 } = await start();
    lineInNow();
    pass(t0);
    pass(t0 + OFFLINE_MS);
    hub.deps.db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').run(hub.clock.branchNow(), kds.deviceId);
    loadDeviceMaps(hub.deps.db);
    const p = pass(t0 + OFFLINE_MS + 500);
    expect(p.due).toBe(true);
    expect(p.appended.map((e) => [e.event_type, e.payload.reason])).toEqual([['AlertClosed', 'obsolete']]);
    await settle();
    expect(takeovers(passWs).map((f) => f.active)).toEqual([true, false]);
    expect(stationPresence().get(FX.station)).toEqual({ screenless: true, connected: false, offline_since: null, dark: false });
  });

  it('[03b #42] an idle screen station never goes dark; a dark station whose lines all go ends its takeover and keeps its alert', async () => {
    const { pass: passWs, t0 } = await start();
    pass(t0);
    expect(pass(t0 + 10 * 60_000).due).toBe(false); // idle, 10 min offline
    expect(alertRows()).toEqual([]);
    expect(stationPresence().get(FX.station)!.dark).toBe(false);

    const order_id = lineInNow(); // offline long enough already: dark at once
    expect(pass(t0 + 10 * 60_000 + 500).due).toBe(true);
    removeLine(hub, order_id, 'A1');
    expect(pass(t0 + 10 * 60_000 + 1_000).due).toBe(false);
    await settle();
    expect(takeovers(passWs).map((f) => f.active)).toEqual([true, false]);
    expect(alertRows().map((a) => a.state)).toEqual(['open']);
  });

  it('[03b #42] a screenless station with lines in Now for 10 min → no alert, no takeover frame, stationPresence().screenless', async () => {
    hub = await createTestHub({ provisioned: true });
    const cook = await signInCook(hub, { pointId: 'P1' });
    openDay(hub);
    const passWs = await connect(cook.token, cook.sessionToken);
    const t0 = hub.clock.branchNow();
    lineInNow(); // S1 has no kds device
    pass(t0);
    expect(pass(t0 + 10 * 60_000).due).toBe(false);
    await settle();
    expect(alertRows()).toEqual([]);
    expect(takeovers(passWs)).toEqual([]);
    expect(stationPresence().get(FX.station)).toEqual({ screenless: true, connected: false, offline_since: null, dark: false });
  });

  it('[03b #43] the grace starts at the first kds_presence pass: lines older than it do not make the station dark at once; a screen back inside it → no alert, no takeover', async () => {
    const { kds, pass: passWs } = await start();
    lineInNow();
    const first = hub.clock.branchNow() + 10 * 60_000; // the loop's first pass, long after the lines fired
    expect(pass(first).due).toBe(false);
    expect(stationPresence().get(FX.station)!.offline_since).toBe(first);
    const screen = await screenOn(kds);
    expect(pass(first + 20_000).due).toBe(false);
    expect(pass(first + OFFLINE_MS + 10_000).due).toBe(false);
    await settle();
    expect(alertRows()).toEqual([]);
    expect(takeovers(passWs)).toEqual([]);
    void screen;
  });

  it('[03b #44] stationPresence() matches the tick view (screen / screenless, connected, offline_since, dark)', async () => {
    const { kds, t0 } = await start();
    lineInNow();
    expect(stationPresence().size).toBe(0); // before the first pass
    pass(t0);
    expect(stationPresence()).toEqual(
      new Map([
        [FX.station, { screenless: false, connected: false, offline_since: t0, dark: false }],
        [FX.zoneStation, { screenless: true, connected: false, offline_since: null, dark: false }],
      ]),
    );
    pass(t0 + OFFLINE_MS);
    expect(stationPresence().get(FX.station)).toEqual({ screenless: false, connected: false, offline_since: t0, dark: true });
    expect(takeoverStations(hub.deps.db).has(FX.station)).toBe(true);
    const screen = await screenOn(kds);
    pass(t0 + OFFLINE_MS + 500);
    expect(stationPresence().get(FX.station)).toEqual({ screenless: false, connected: true, offline_since: null, dark: false });
    void screen;
  });
});
