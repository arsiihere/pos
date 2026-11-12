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
        { station_id: FX.station, name: 'Karahi', lanes: { lanes_on: 1, lane_count: 1 }, dark: false },
        { station_id: FX.zoneStation, name: 'Counter', lanes: { lanes_on: 1, lane_count: 1 }, dark: false },
      ],
      orders: [
        {
          order_id: a,
          identifier: details.get('A1')!.identifier,
          placed_at: engine().orders[a]!.placed_at,
          lines: [
            { ...details.get('A1')!, stage: 'added', handed_over: false },
            { ...details.get('A2')!, stage: 'added', handed_over: false },
          ],
          ready: null,
        },
        { order_id: b, identifier: details.get('B1')!.identifier, placed_at: engine().orders[b]!.placed_at, lines: [{ ...details.get('B1')!, stage: 'added', handed_over: false }], ready: null },
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

  it('[03b #65] point_view ≤ 4 statements with 50 lines; a takeover adds its kds_station body (and no statement)', async () => {
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
    expect(counter.count).toBeLessThanOrEqual(4 + 1);
    expect(withTakeover.stations.find((s) => s.station_id === FX.station)!.dark).toBe(true);
    expect(withTakeover.takeovers).toEqual([kdsStationBody(hub.deps.db, engine(), FX.station, now())]);
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
    expect(WsPointLines.parse(frames[0])).toEqual({ type: 'point_lines', point_id: 'P1', lines: [...buildLineDetails(hub.deps.db, engine(), ['B1', 'B2']).values()] });
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
