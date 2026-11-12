import { stationView, type EngineState } from '@pos/engine';
import { KdsStationBody, WsKdsLines } from '@pos/events';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { buildLineDetails } from '../../src/kds/contracts';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import type { SocketCtx } from '../../src/ws/catch-up';
import { kdsStationBody, kdsStationPart } from '../../src/ws/kds-catch-up';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { FX, append, appendOrder, fireLines, openDay, pairKds, removeLine, voidLine } from './fixtures';

// 03b §6.14 (`kds_station` catch-up part, 3 statements), §6.16 (`kds_lines` frame, once per id, 2 statements per
// commit that adds lines); tests #65 (kds half), #66; task b18. Real submit batches, fires, removals, voids, moves to
// stock; real sockets through the hub's /ws.

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

async function start(): Promise<void> {
  hub = await createTestHub({ provisioned: true });
  await seedDirectory(hub, await aDirectory());
  openDay(hub);
}

/** A station socket (kds device + station session) or a staff socket (tablet + S_MGR). */
async function socketOf(kind: 'station' | 'staff', stationId: string = FX.station): Promise<WsClient> {
  const device = kind === 'station' ? pairKds(hub, { stationId }) : pairDevice(hub, { type: 'tablet' });
  const session =
    kind === 'station'
      ? openSession(hub, { kind: 'station', deviceId: device.deviceId, stationId })
      : openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: device.deviceId });
  const ws = await connectWs(hub.app);
  sockets.push(ws);
  ws.send({ type: 'auth', device_token: device.token, session_token: session.token });
  await ws.untilCount(1);
  return ws;
}

const catchUpState = (ws: WsClient): Record<string, unknown> => (ws.messages[0] as { type: string; state: Record<string, unknown> }).state;
const kdsLines = (ws: WsClient): WsKdsLines[] => ws.messages.filter((m) => (m as { type?: string }).type === 'kds_lines') as WsKdsLines[];
const ids = (frames: WsKdsLines[]): string[][] => frames.map((f) => f.lines.map((l) => l.order_item_id));

/** Counts only buildLineDetails' two statements (its line read and 02a currentTableOf), whatever else a commit runs. */
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

const stationSocket = (stationId: string, sessionId = 'X'): SocketCtx => ({
  deviceId: 'D1',
  deviceType: 'kds',
  sessionId,
  kind: 'station',
  staffId: null,
  stationId,
  asOfSeq: 1,
});

describe('[03b §6.14] kds_station catch-up part (b18)', () => {
  it('[03b #65] a station socket gets its own station body (Now with details and stage, Next details, defaults); a staff socket gets none', async () => {
    await start();
    const { order_id } = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'A1', item_id: FX.piece },
        { order_item_id: 'A2', item_id: FX.naan },
      ],
    });
    fireLines(hub, FX.station, ['A1']);
    const kds = await socketOf('station');
    const staff = await socketOf('staff');
    expect(catchUpState(staff).kds_station).toBeUndefined();
    const body = KdsStationBody.parse(catchUpState(kds).kds_station);
    const view = stationView(engine(), FX.station, now());
    const details = buildLineDetails(hub.deps.db, engine(), ['A1', ...view.next.map((l) => l.order_item_id)]);
    expect(body).toEqual({
      station_id: FX.station,
      day_open: true,
      sound_volume: 70,
      lanes: { lanes_on: 1, lane_count: 1 },
      now: [{ ...details.get('A1')!, stage: 'added', fired_at: engine().lines.A1!.fired_at, started_at: null, mark: engine().lines.A1!.mark, done_undone: false }],
      details: view.next.map((l) => details.get(l.order_item_id)!),
    });
    expect(body.now[0]!.order_id).toBe(order_id);
  });

  it('[03b §6.14] sound volume and lanes from kds_config rows; without a lanes row, lane_count = labelled unrevoked kds devices, all on; day not open → day_open false', async () => {
    hub = await createTestHub({ provisioned: true });
    const part = kdsStationPart(hub.deps);
    expect(part.build(hub.deps.db, engine(), stationSocket(FX.station))).toMatchObject({ day_open: false, now: [], details: [] });
    openDay(hub);
    pairKds(hub, { stationId: FX.station, laneLabel: 'Left' });
    pairKds(hub, { stationId: FX.station, laneLabel: 'Right' });
    const revoked = pairKds(hub, { stationId: FX.station, laneLabel: 'Third' });
    hub.deps.db.prepare('UPDATE devices SET revoked_at = 1 WHERE device_id = ?').run(revoked.deviceId);
    pairKds(hub, { stationId: FX.station });
    expect(kdsStationBody(hub.deps.db, engine(), FX.station, now())).toMatchObject({ day_open: true, sound_volume: 70, lanes: { lanes_on: 2, lane_count: 2 } });
    // kds_config's tables (b5's projection folds them; written here as that fold would).
    hub.deps.db.prepare('INSERT INTO kds_station_settings (station_id, sound_volume) VALUES (?, ?)').run(FX.station, 35);
    hub.deps.db.prepare('INSERT INTO station_lanes (station_id, lanes_on, lane_count) VALUES (?, ?, ?)').run(FX.station, null, 2);
    expect(kdsStationBody(hub.deps.db, engine(), FX.station, now())).toMatchObject({ sound_volume: 35, lanes: { lanes_on: null, lane_count: 2 } });
  });

  it('[03b #65] ≤ 3 statements with 50 lines; Now matches stationView after removals, voids and a move to stock', async () => {
    await start();
    const orders: string[] = [];
    const all: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const lines = Array.from({ length: 10 }, (_, n) => ({ order_item_id: `L${i}_${n}`, item_id: FX.naan }));
      orders.push(appendOrder(hub, { order_type: 'takeaway', lines }).order_id);
      all.push(...lines.map((l) => l.order_item_id));
    }
    fireLines(hub, FX.station, all.slice(0, 30));
    removeLine(hub, orders[0]!, 'L0_0');
    voidLine(hub, orders[0]!, 'L0_1', 1);
    // 04's ItemMovedToStock straight through the writer (its stock effects need 04's stock_ctx; the engine fold is what Now reads).
    hub.clock.advance(1_000);
    hub.deps.writer.run((tx) =>
      tx.append([
        {
          stream_type: 'order',
          stream_id: orders[0]!,
          event_type: 'ItemMovedToStock',
          schema_version: 1,
          payload: { order_item_id: 'L0_2', units: 1 },
          occurred_at: now(),
          actor_id: 'S_MGR',
          device_id: 'D_FIXTURE',
        },
      ]),
    );
    const part = kdsStationPart(hub.deps);
    const counter = statementCounter(hub.deps.db);
    const body = KdsStationBody.parse(part.build(hub.deps.db, engine(), stationSocket(FX.station)));
    expect(counter.count).toBeLessThanOrEqual(3);
    const view = stationView(engine(), FX.station, now());
    expect(body.now.map((l) => l.order_item_id)).toEqual(view.now.map((l) => l.order_item_id));
    expect(body.now.map((l) => [l.stage, l.fired_at, l.started_at, l.mark])).toEqual(view.now.map((l) => [l.stage, l.fired_at, l.started_at, l.mark]));
    expect(body.details.map((l) => l.order_item_id)).toEqual(view.next.map((l) => l.order_item_id));
    expect(body.now.map((l) => l.order_item_id)).not.toContain('L0_0');
    expect(body.now.length + body.details.length).toBeGreaterThan(20);
  });

  it('[03b §3.3, §6.14, v1.0.5 B2-2/B2-3] an undone Done: its Now row carries done_undone true (from the engine line), a normal line false; still 3 statements', async () => {
    await start();
    const { order_id } = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'A1', item_id: FX.naan },
        { order_item_id: 'A2', item_id: FX.naan },
      ],
    });
    fireLines(hub, FX.station, ['A1', 'A2']);
    // The auto_done path as 03a v1.2.2 folds it: an inferred Done, then its Undo (ItemDoneUndone sets done_undone).
    append(hub, [{ stream_type: 'order', stream_id: order_id, event_type: 'ItemStarted', payload: { order_item_id: 'A1', started_at: now() + 1_000, source: 'tap' } }]);
    append(hub, [{ stream_type: 'order', stream_id: order_id, event_type: 'ItemDone', payload: { order_item_id: 'A1', done_at: now() + 1_000, source: 'inferred' } }], { actor: null, device: 'hub' });
    append(hub, [{ stream_type: 'order', stream_id: order_id, event_type: 'ItemDoneUndone', payload: { order_item_id: 'A1' } }]);
    expect(engine().lines.A1).toMatchObject({ stage: 'cooking', done_undone: true });
    expect(engine().lines.A2).toMatchObject({ done_undone: false });
    const part = kdsStationPart(hub.deps);
    const counter = statementCounter(hub.deps.db);
    const body = KdsStationBody.strict().parse(part.build(hub.deps.db, engine(), stationSocket(FX.station)));
    expect(counter.count).toBeLessThanOrEqual(3);
    expect(body.now.map((l) => [l.order_item_id, l.stage, l.done_undone])).toEqual([
      ['A1', 'cooking', true],
      ['A2', 'added', false],
    ]);
  });

  it('[03b #65] an abandoned order leaves Now with stationView', async () => {
    await start();
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan }] });
    fireLines(hub, FX.station, ['A1']);
    const part = kdsStationPart(hub.deps);
    expect((part.build(hub.deps.db, engine(), stationSocket(FX.station)) as KdsStationBody).now.map((l) => l.order_item_id)).toEqual(['A1']);
    hub.clock.advance(25 * 3_600_000); // past any order_abandon_ms (≤ 24 h, 01a)
    expect(stationView(engine(), FX.station, now()).now).toEqual([]);
    expect((part.build(hub.deps.db, engine(), stationSocket(FX.station)) as KdsStationBody).now).toEqual([]);
  });
});

describe('[03b §6.16] kds_lines frame (b18)', () => {
  it('[03b #66] kds_lines once per new id per socket; 2 statements per commit that adds lines, 0 otherwise; only its station', async () => {
    await start();
    const counter = detailsCounter(hub.deps.db);
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan }] });
    const kds = await socketOf('station');
    const other = await socketOf('station', FX.zoneStation);
    const staff = await socketOf('staff');
    await settle();
    expect(kdsLines(kds), 'A1 came with the catch-up').toEqual([]);

    counter.reset();
    appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'B1', item_id: FX.naan },
        { order_item_id: 'B2', item_id: FX.piece },
      ],
    });
    expect(counter.count).toBe(2);
    await settle();
    expect(ids(kdsLines(kds))).toEqual([['B1', 'B2']]);
    expect(kdsLines(kds)[0]).toEqual(WsKdsLines.parse(kdsLines(kds)[0]));
    expect(kdsLines(kds)[0]!.station_id).toBe(FX.station);
    expect(kdsLines(kds)[0]!.lines).toEqual(['B1', 'B2'].map((id) => buildLineDetails(hub.deps.db, engine(), [id]).get(id)));

    // A commit that adds no line of the station: nothing sent, no statement.
    counter.reset();
    fireLines(hub, FX.station, ['A1', 'B1']);
    removeLine(hub, engine().lines.B2!.order_id, 'B2', undefined);
    expect(counter.count).toBe(0);
    await settle();
    expect(ids(kdsLines(kds))).toEqual([['B1', 'B2']]);

    // A late socket gets its catch-up, then only new ids — as the first socket does.
    const late = await socketOf('station');
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'C1', item_id: FX.naan }] });
    await settle();
    expect(ids(kdsLines(kds))).toEqual([['B1', 'B2'], ['C1']]);
    expect(ids(kdsLines(late))).toEqual([['C1']]);
    expect(kdsLines(other)).toEqual([]);
    expect(kdsLines(staff)).toEqual([]);
  });

  it('[03b #66] a reconnect on the same session token: the new socket gets every line it shows, from its catch-up or a later kds_lines', async () => {
    await start();
    const device = pairKds(hub, { stationId: FX.station });
    const session = openSession(hub, { kind: 'station', deviceId: device.deviceId, stationId: FX.station });
    const connect = async (): Promise<WsClient> => {
      const ws = await connectWs(hub.app);
      sockets.push(ws);
      ws.send({ type: 'auth', device_token: device.token, session_token: session.token });
      await ws.untilCount(1);
      return ws;
    };
    const first = await connect();
    const lines = Array.from({ length: 30 }, (_, n) => ({ order_item_id: `L${n}`, item_id: FX.naan }));
    appendOrder(hub, { order_type: 'takeaway', lines });
    await settle();
    expect(ids(kdsLines(first)).flat().sort()).toEqual(lines.map((l) => l.order_item_id).sort());
    expect(stationView(engine(), FX.station, now()).later_count).toBeGreaterThan(0);

    first.close();
    await settle();
    const second = await connect();
    const body = KdsStationBody.parse(catchUpState(second).kds_station);
    const fromCatchUp = [...body.now, ...body.details].map((l) => l.order_item_id);
    expect(fromCatchUp.length).toBeLessThan(30);
    fireLines(hub, FX.station, lines.map((l) => l.order_item_id).filter((id) => !fromCatchUp.includes(id)));
    await settle();
    const got = new Set([...fromCatchUp, ...ids(kdsLines(second)).flat()]);
    expect([...got].sort()).toEqual(lines.map((l) => l.order_item_id).sort());
  });

  it('[03b v1.0.4 §6.16] a line whose live units change (partial ItemRemoved / ItemVoided, LineWeightSet) is re-sent to sockets that hold it; 2 statements per commit (B3-3)', async () => {
    await start();
    const plain = (name: string, quantity: number) => ({ option_id: `O_${name}`, modifier_group_id: 'G_PLAIN', name, price_minor: 0, quantity, charge_minor: 0 });
    const kds = await socketOf('station');
    const other = await socketOf('station', FX.zoneStation);
    const { order_id } = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'K1', item_id: FX.piece, quantity: 3, item: { options: [plain('No onion', 1)] } },
        { order_item_id: 'N1', item_id: FX.naan, quantity: 4 },
        { order_item_id: 'F1', item_id: FX.gram },
      ],
    });
    await settle();
    const lastOf = (id: string) => kdsLines(kds).flatMap((f) => f.lines).filter((l) => l.order_item_id === id).at(-1);
    expect(lastOf('K1')).toMatchObject({ units: 3, options: ['3 x No onion'] });
    const frames = kdsLines(kds).length;

    const counter = detailsCounter(hub.deps.db);
    removeLine(hub, order_id, 'K1', 1);
    expect(counter.count, 'one buildLineDetails for the re-sent line').toBe(2);
    await settle();
    expect(ids(kdsLines(kds).slice(frames))).toEqual([['K1']]);
    expect(lastOf('K1')).toMatchObject({ units: 2, options: ['2 x No onion'] });

    counter.reset();
    voidLine(hub, order_id, 'N1', 1);
    expect(counter.count).toBe(2);
    await settle();
    expect(ids(kdsLines(kds).slice(frames))).toEqual([['K1'], ['N1']]);
    expect(lastOf('N1')).toMatchObject({ units: 3 });

    counter.reset();
    append(hub, [{ stream_type: 'order', stream_id: order_id, event_type: 'LineWeightSet', payload: { order_item_id: 'F1', quantity: 750, line_total_minor: 300_000 } }]);
    expect(counter.count).toBe(2);
    await settle();
    expect(ids(kdsLines(kds).slice(frames))).toEqual([['K1'], ['N1'], ['F1']]);

    // A whole-line removal takes the line off the station: nothing re-sent, no read; the other station never gets it.
    counter.reset();
    removeLine(hub, order_id, 'N1');
    expect(counter.count).toBe(0);
    await settle();
    expect(ids(kdsLines(kds).slice(frames))).toEqual([['K1'], ['N1'], ['F1']]);
    expect(kdsLines(other)).toEqual([]);
  });

  it('[03b #66] no station socket connected → no read at all', async () => {
    await start();
    await socketOf('staff');
    const counter = detailsCounter(hub.deps.db);
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan }] });
    expect(counter.count).toBe(0);
  });
});
