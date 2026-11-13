import type { EngineState } from '@pos/engine';
import { WsPointLines, type BranchConfig } from '@pos/events';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { buildLineDetails } from '../../src/kds/contracts';
import { loadDeviceMaps } from '../../src/kds/device-roles';
import { kdsPresenceTick } from '../../src/kds/presence';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { kdsStationBody } from '../../src/ws/kds-catch-up';
import { pointViewBody, type PointViewBody } from '../../src/ws/point-catch-up';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { COOK, FX, append, appendOrder, fireLines, openDay, pairDevice, pairKds, removeLine, serveLines, signInCook, voidLine } from './fixtures';

// 03b §6.15 (`point_view` catch-up part, 4 statements + takeovers), §6.16 (`point_lines` frame, once per id); tests #65
// (point half), #29; task b21. Real submit batches and fires, real Ready / Handover events, real sockets.

let hub: TestHub;
const sockets: WsClient[] = [];
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  swapBranchConfig(null);
  await hub?.close();
});

const engine = (): EngineState => hub.deps.state.get() as EngineState;
const now = (): number => hub.clock.branchNow();
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

async function start(): Promise<{ deviceId: string; token: string; sessionToken: string }> {
  hub = await createTestHub({ provisioned: true });
  const cook = await signInCook(hub, { pointId: 'P1' });
  openDay(hub);
  return cook;
}

async function connect(device_token: string, session_token: string): Promise<WsClient> {
  const ws = await connectWs(hub.app);
  sockets.push(ws);
  ws.send({ type: 'auth', device_token, session_token });
  await ws.untilCount(1);
  return ws;
}

const catchUpState = (ws: WsClient): Record<string, unknown> => (ws.messages[0] as { state: Record<string, unknown> }).state;
const pointLines = (ws: WsClient): WsPointLines[] => ws.messages.filter((m) => (m as { type?: string }).type === 'point_lines') as WsPointLines[];
const ids = (frames: WsPointLines[]): string[][] => frames.map((f) => f.lines.map((l) => l.order_item_id));
const body = (point = 'P1'): PointViewBody => pointViewBody(hub.deps.db, engine(), point, now());
/** Q-46: the engine line's serve group and mode. */
const serve = (id: string): { group_id: string; serve_mode: 'sync' | 'immediate' } => ({ group_id: engine().lines[id]!.group_id, serve_mode: engine().lines[id]!.serve_mode });

/** Counts only buildLineDetails' two statements (its line read and 02a currentTableOf), as test/kds/kds-catch-up's. */
function detailsCounter(db: Database.Database): { readonly count: number; reset(): void } {
  let count = 0;
  const prepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    const statement = prepare(sql);
    if (sql.includes('json_group_array') || sql.includes('s.primary_table_id AS primary_table_id, st.table_id AS table_id')) {
      const all = statement.all.bind(statement);
      statement.all = ((...args: unknown[]) => {
        count += 1;
        return all(...(args as []));
      }) as typeof statement.all;
    }
    return statement;
  }) as typeof db.prepare;
  return {
    get count() {
      return count;
    },
    reset() {
      count = 0;
    },
  };
}

describe('[03b §6.15] point_view catch-up part (b21)', () => {
  it('[03b #65] a Pass socket gets its point body (stations, orders oldest first with stage / handed_over / ready); other sockets get none', async () => {
    const cook = await start();
    const a = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.piece }, { order_item_id: 'A2', item_id: FX.naan }] }).order_id;
    const b = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'B1', item_id: FX.piece }] }).order_id;
    fireLines(hub, FX.station, ['A1']);
    const pass = await connect(cook.token, cook.sessionToken);
    const view = catchUpState(pass).point_view as PointViewBody;
    const details = buildLineDetails(hub.deps.db, engine(), ['A1', 'A2', 'B1']);
    expect(view).toEqual({
      point_id: 'P1',
      stations: [
        { station_id: FX.station, name: 'Karahi', lanes: { lanes_on: 1, lane_count: 1 }, dark: false, screenless: true },
        { station_id: FX.zoneStation, name: 'Counter', lanes: { lanes_on: 1, lane_count: 1 }, dark: false, screenless: true },
      ],
      orders: [
        {
          order_id: a,
          identifier: details.get('A1')!.identifier,
          placed_at: engine().orders[a]!.placed_at,
          lines: [
            { ...details.get('A1')!, ...serve('A1'), stage: 'added', handed_over: false },
            { ...details.get('A2')!, ...serve('A2'), stage: 'added', handed_over: false },
          ],
          ready: null,
        },
        { order_id: b, identifier: details.get('B1')!.identifier, placed_at: engine().orders[b]!.placed_at, lines: [{ ...details.get('B1')!, ...serve('B1'), stage: 'added', handed_over: false }], ready: null },
      ],
      takeovers: [],
    });

    // a tablet with no point, and a station socket: no point_view
    const plain = pairDevice(hub, { type: 'tablet' });
    const other = await connect(plain.token, openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: plain.deviceId }).token);
    expect(catchUpState(other).point_view).toBeUndefined();
    const kds = pairKds(hub, { stationId: FX.station });
    const station = await connect(kds.token, openSession(hub, { kind: 'station', deviceId: kds.deviceId, stationId: FX.station }).token);
    expect(catchUpState(station).point_view).toBeUndefined();
  });

  it('[03b §6.15] Ready { at, by } and handed_over from the pass tables; served / removed lines drop off; a card drops off when none is left', async () => {
    await start();
    const { order_id } = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'L1', item_id: FX.piece },
        { order_item_id: 'L2', item_id: FX.naan },
        { order_item_id: 'L3', item_id: FX.naan },
      ],
    });
    const on = (event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, payload });
    const [ready] = append(hub, [on('ReadyToServe', { order_id, point_id: 'P1', order_item_ids: ['L1', 'L2', 'L3'], table_id: null, alert_id: null })], { actor: COOK.staff });
    append(hub, [on('Handover', { handover_id: 'H1', order_id, point_id: 'P1', receiver_staff_id: 'S_WAIT', order_item_ids: ['L2'], alert_id: 'A_CARD', ready_alert_closed: null })]);
    let card = body().orders[0]!;
    expect(card.ready).toEqual({ at: ready!.recorded_at, by: COOK.staff });
    expect(card.lines.map((l) => [l.order_item_id, l.handed_over])).toEqual([
      ['L1', false],
      ['L2', true],
      ['L3', false],
    ]);
    serveLines(hub, order_id, ['L2']);
    removeLine(hub, order_id, 'L3');
    card = body().orders[0]!;
    expect(card.lines.map((l) => l.order_item_id)).toEqual(['L1']);
    removeLine(hub, order_id, 'L1');
    expect(body().orders).toEqual([]);
  });

  it('[03b #29] point membership: a line whose station moved to another point stays on its home point (EngineLine.point_id)', async () => {
    await start();
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'H1', item_id: FX.piece }] });
    // S1 now belongs to P2 (the line was planned with S1 on P1: its engine point stays P1)
    const config = branchConfig()!;
    const moved: BranchConfig = {
      ...config,
      points: [...config.points, { point_id: 'P2', name: 'Pass 2', sort_order: 1, is_archived: false }],
      stations: config.stations.map((s) => (s.station_id === FX.station ? { ...s, point_id: 'P2' } : s)),
    };
    swapBranchConfig({ config: moved, snapshotHash: 'e'.repeat(64), configVersion: moved.config_version, snapshotSchemaVersion: 4, appliedAt: now() });
    expect(engine().lines.H1!.point_id).toBe('P1');
    expect(body('P1').orders.flatMap((o) => o.lines.map((l) => l.order_item_id))).toEqual(['H1']);
    expect(body('P2').orders).toEqual([]);
    expect(body('P2').stations.map((s) => s.station_id)).toEqual([FX.station]);
  });

  it('[03b #67] point_view.stations[]: a station with a paired kds device screenless false, one without true; refreshed at the next catch-up after a DeviceRevoked', async () => {
    const cook = await start();
    const flags = (): Array<[string, boolean]> => body().stations.map((s) => [s.station_id, s.screenless]);
    expect(flags()).toEqual([[FX.station, true], [FX.zoneStation, true]]);
    const kds = pairKds(hub, { stationId: FX.station });
    expect(flags()).toEqual([[FX.station, false], [FX.zoneStation, true]]);
    const pass = await connect(cook.token, cook.sessionToken);
    expect((catchUpState(pass).point_view as PointViewBody).stations.map((s) => s.screenless)).toEqual([false, true]);

    const branch = hub.deps.config.provisioned!.branch_id;
    hub.deps.db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').run(now(), kds.deviceId);
    append(hub, [{ stream_type: 'hub', stream_id: branch, event_type: 'DeviceRevoked', payload: { device_id: kds.deviceId, reason: null, cause: 'manual' } }], { actor: null });
    const again = await connect(cook.token, cook.sessionToken);
    expect((catchUpState(again).point_view as PointViewBody).stations.map((s) => s.screenless)).toEqual([true, true]);
  });

  it('[03b #67] every point_view line and every point_lines line carries group_id and serve_mode equal to the engine line; a return line and a released line are immediate', async () => {
    const cook = await start();
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'N1', item_id: FX.naan }, { order_item_id: 'G1', item_id: FX.piece }, { order_item_id: 'G2', item_id: FX.piece }] });
    const station_id = engine().lines.N1!.station_id;
    const on = (event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, payload });
    append(hub, [{ stream_type: 'station', stream_id: station_id, event_type: 'FireDispatched', payload: { station_id, order_item_ids: ['N1'], load_id: null, due_at: now(), reason: 'pulled' } }]);
    append(hub, [on('ItemStarted', { order_item_id: 'N1', started_at: now(), source: 'tap' })]);
    append(hub, [on('ItemDone', { order_item_id: 'N1', done_at: now(), source: 'tap' })]);
    append(hub, [on('ItemServed', { order_item_ids: ['N1'], source: 'tap' })]);
    append(hub, [on('ItemsReleased', { order_id, alert_id: null, released: ['G1'], expedite: [] })]);
    expect(engine().lines.G1!.serve_mode).toBe('immediate');
    expect(engine().lines.G2!.serve_mode).toBe('sync');

    const pass = await connect(cook.token, cook.sessionToken);
    const view = catchUpState(pass).point_view as PointViewBody;
    const viewLines = view.orders.flatMap((o) => o.lines);
    expect(viewLines.map((l) => l.order_item_id).sort()).toEqual(['G1', 'G2']);
    for (const l of viewLines) expect({ group_id: l.group_id, serve_mode: l.serve_mode }, l.order_item_id).toEqual(serve(l.order_item_id));
    expect(viewLines.find((l) => l.order_item_id === 'G1')!.serve_mode).toBe('immediate');

    const device = pairDevice(hub, { type: 'tablet' });
    const session = openSession(hub, { kind: 'staff', staffId: 'S_OWNER', deviceId: device.deviceId });
    const res = await hub.app.inject({
      method: 'POST',
      url: '/commands/return-to-kitchen',
      headers: { authorization: `Bearer ${device.token}`, 'x-session-token': session.token },
      payload: {
        command_id: 'cmd-return-1',
        tenant_id: 'tenant-a',
        branch_id: 'branch-1',
        command_type: 'ReturnToKitchen',
        payload: { order_item_id: 'N1', return_order_item_id: 'R1', mode: 'remake' },
        occurred_at: now(),
        actor_id: 'S_OWNER',
        device_id: device.deviceId,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'C1', item_id: FX.piece }] });
    await settle();
    const framed = pointLines(pass).flatMap((f) => f.lines);
    expect(framed.map((l) => l.order_item_id).sort()).toEqual(['C1', 'R1']);
    for (const l of framed) expect({ group_id: l.group_id, serve_mode: l.serve_mode }, l.order_item_id).toEqual(serve(l.order_item_id));
    expect(framed.find((l) => l.order_item_id === 'R1')!.serve_mode).toBe('immediate');
    expect(framed.find((l) => l.order_item_id === 'C1')!.serve_mode).toBe('sync');
    for (const f of pointLines(pass)) WsPointLines.parse(f);
  });

  it('[03b #67] statements unchanged: point_view 4 (+1 per takeover), point_lines hook 2', async () => {
    const cook = await start();
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.piece }] });
    const counter = statementCounter(hub.deps.db);
    body();
    expect(counter.count).toBe(4);
    await connect(cook.token, cook.sessionToken);
    const detail = detailsCounter(hub.deps.db);
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'B1', item_id: FX.piece }, { order_item_id: 'B2', item_id: FX.naan }] });
    expect(detail.count, 'the point_lines hook: one buildLineDetails').toBe(2);
  });

  it('[03b #65, v1.0.6 Q-20] point_view ≤ 4 statements with 50 lines; a takeover adds its kds_station body and exactly 1 statement (has_printer) → 5', async () => {
    await start();
    for (let o = 0; o < 10; o += 1) {
      appendOrder(hub, { order_type: 'takeaway', lines: Array.from({ length: 5 }, (_, i) => ({ order_item_id: `O${o}L${i}`, item_id: i % 2 === 0 ? FX.piece : FX.naan })) });
    }
    fireLines(hub, FX.station, ['O0L0', 'O1L0']);
    const counter = statementCounter(hub.deps.db);
    const plain = body();
    expect(counter.count).toBeLessThanOrEqual(4);
    expect(plain.orders.flatMap((o) => o.lines)).toHaveLength(50);

    // S1 dark: a kds screen paired, never connected, past kds_offline_ms
    pairKds(hub, { stationId: FX.station });
    const t0 = now();
    kdsPresenceTick.due(readOnlyDb(hub.deps.db), engine(), t0);
    expect(kdsPresenceTick.due(readOnlyDb(hub.deps.db), engine(), t0 + 30_000)).toBe(true);
    hub.deps.writer.run((tx) => tx.append(kdsPresenceTick.intents(tx, tx.state as EngineState, t0 + 30_000)));
    counter.reset();
    const withTakeover = body();
    expect(counter.count, '4 + stationHasPrinter for the takeover stations (03b v1.0.6 §6.14, §6.15 "+1")').toBe(5);
    expect(withTakeover.stations.find((s) => s.station_id === FX.station)!.dark).toBe(true);
    expect(withTakeover.takeovers).toEqual([kdsStationBody(hub.deps.db, engine(), FX.station, now())]);
  });

  it('[03b v1.0.7 §6.15, Q-P22b] a takeover body carries the station\'s current has_printer (true with a printing output, false after screen)', async () => {
    await start();
    const branch = hub.deps.config.provisioned!.branch_id;
    const setOutput = (mode: 'screen' | 'both', printer_id: string | null) =>
      append(hub, [{ stream_type: 'hub', stream_id: branch, event_type: 'StationOutputSet', payload: { station_id: FX.station, mode, printer_id, show_taker: true, show_order_id: true } }], { actor: null });
    append(hub, [{ stream_type: 'hub', stream_id: branch, event_type: 'PrinterSaved', payload: { printer_id: 'PR1', name: 'Printer PR1', connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived: false } }], { actor: null });
    setOutput('both', 'PR1');
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.piece }] });
    fireLines(hub, FX.station, ['A1']);
    pairKds(hub, { stationId: FX.station });
    const t0 = now();
    kdsPresenceTick.due(readOnlyDb(hub.deps.db), engine(), t0);
    expect(kdsPresenceTick.due(readOnlyDb(hub.deps.db), engine(), t0 + 30_000)).toBe(true);
    hub.deps.writer.run((tx) => tx.append(kdsPresenceTick.intents(tx, tx.state as EngineState, t0 + 30_000)));
    expect(body().takeovers.map((t) => [t.station_id, t.has_printer])).toEqual([[FX.station, true]]);
    setOutput('screen', null);
    expect(body().takeovers.map((t) => [t.station_id, t.has_printer])).toEqual([[FX.station, false]]);
  });
});

describe('[03b §6.16] point_lines frame (b21)', () => {
  it('[03b §6.16] details for line ids a commit adds at the point, once per id per Pass socket', async () => {
    const cook = await start();
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.piece }] });
    const pass = await connect(cook.token, cook.sessionToken);
    expect(pointLines(pass)).toEqual([]);

    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'B1', item_id: FX.piece }, { order_item_id: 'B2', item_id: FX.naan }] });
    fireLines(hub, FX.station, ['A1', 'B1']); // no new ids
    await settle();
    const frames = pointLines(pass);
    expect(ids(frames)).toEqual([['B1', 'B2']]);
    expect(WsPointLines.parse(frames[0])).toEqual({ type: 'point_lines', point_id: 'P1', lines: [...buildLineDetails(hub.deps.db, engine(), ['B1', 'B2']).values()].map((d) => ({ ...d, ...serve(d.order_item_id) })) });
  });

  it('[03b v1.0.4 §6.16] a held line whose live units change (partial remove / void) is re-sent; one buildLineDetails per commit (B3-3)', async () => {
    const cook = await start();
    const pass = await connect(cook.token, cook.sessionToken);
    const plain = (name: string, quantity: number) => ({ option_id: `O_${name}`, modifier_group_id: 'G_PLAIN', name, price_minor: 0, quantity, charge_minor: 0 });
    const { order_id } = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'K1', item_id: FX.piece, quantity: 3, item: { options: [plain('No onion', 1)] } },
        { order_item_id: 'N1', item_id: FX.naan, quantity: 4 },
      ],
    });
    await settle();
    const lastOf = (id: string) => pointLines(pass).flatMap((f) => f.lines).filter((l) => l.order_item_id === id).at(-1);
    expect(lastOf('K1')).toMatchObject({ units: 3, options: ['3 x No onion'] });
    const frames = pointLines(pass).length;

    const counter = detailsCounter(hub.deps.db);
    removeLine(hub, order_id, 'K1', 1);
    expect(counter.count, 'one buildLineDetails (2 statements) for the re-sent line').toBe(2);
    await settle();
    expect(ids(pointLines(pass).slice(frames))).toEqual([['K1']]);
    expect(lastOf('K1')).toMatchObject({ units: 2, options: ['2 x No onion'] });

    counter.reset();
    voidLine(hub, order_id, 'N1', 1);
    expect(counter.count).toBe(2);
    await settle();
    expect(ids(pointLines(pass).slice(frames))).toEqual([['K1'], ['N1']]);
    expect(lastOf('N1')).toMatchObject({ units: 3 });

    // a commit that changes no units and adds no line reads nothing
    counter.reset();
    fireLines(hub, FX.station, ['K1']);
    expect(counter.count).toBe(0);
  });

  it('[03b §3.1] a cashier kiosk bound to a point is no Pass: no point_view part, no point_lines frame', async () => {
    const cook = await start();
    void cook;
    const kiosk = pairDevice(hub, { type: 'cashier_kiosk' });
    hub.deps.db.prepare("UPDATE devices SET point_id = 'P1' WHERE device_id = ?").run(kiosk.deviceId);
    loadDeviceMaps(hub.deps.db);
    const ws = await connect(kiosk.token, openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: kiosk.deviceId }).token);
    expect(catchUpState(ws).point_view).toBeUndefined();
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'Q1', item_id: FX.piece }] });
    await settle();
    expect(pointLines(ws)).toEqual([]);
  });

  it('[03b §6.16] a takeover start view is not resent as point_lines; lines that reach a dark station later are', async () => {
    const cook = await start();
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.piece }] });
    fireLines(hub, FX.station, ['A1']);
    const pass = await connect(cook.token, cook.sessionToken);
    pairKds(hub, { stationId: FX.station });
    const t0 = now();
    kdsPresenceTick.due(readOnlyDb(hub.deps.db), engine(), t0);
    expect(kdsPresenceTick.due(readOnlyDb(hub.deps.db), engine(), t0 + 30_000)).toBe(true);
    hub.deps.writer.run((tx) => tx.append(kdsPresenceTick.intents(tx, tx.state as EngineState, t0 + 30_000)));
    await settle();
    expect(pass.messages.filter((m) => (m as { type?: string }).type === 'station_takeover')).toHaveLength(1);
    expect(pointLines(pass)).toEqual([]);
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'C1', item_id: FX.piece }] });
    await settle();
    expect(ids(pointLines(pass))).toEqual([['C1']]);
  });
});
