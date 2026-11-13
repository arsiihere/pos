import { stationView, type EngineState } from '@pos/engine';
import { KdsStationBody, WsKdsLines, type BranchConfig } from '@pos/events';
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
import { FX, append, appendOrder, fireLines, fixtureMenu, openDay, openSeating, pairKds, removeLine, voidLine } from './fixtures';

// 03b §6.14 (`kds_station` catch-up part, 4 statements since v1.0.6 Q-20: + has_printer), §6.16 (`kds_lines` frame, once per id, 2 statements per
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
      has_printer: false,
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

  it('[03b #65, v1.0.6 Q-20] ≤ 4 statements with 50 lines; Now matches stationView after removals, voids and a move to stock', async () => {
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
    expect(counter.count).toBeLessThanOrEqual(4);
    const view = stationView(engine(), FX.station, now());
    expect(body.now.map((l) => l.order_item_id)).toEqual(view.now.map((l) => l.order_item_id));
    expect(body.now.map((l) => [l.stage, l.fired_at, l.started_at, l.mark])).toEqual(view.now.map((l) => [l.stage, l.fired_at, l.started_at, l.mark]));
    expect(body.details.map((l) => l.order_item_id)).toEqual(view.next.map((l) => l.order_item_id));
    expect(body.now.map((l) => l.order_item_id)).not.toContain('L0_0');
    expect(body.now.length + body.details.length).toBeGreaterThan(20);
  });

  it('[03b §3.3, §6.14, v1.0.5 B2-2/B2-3] an undone Done: its Now row carries done_undone true (from the engine line), a normal line false; 4 statements (v1.0.6 Q-20)', async () => {
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
    expect(counter.count).toBeLessThanOrEqual(4);
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

describe('[03b v1.0.6 §6.14, 03c v1.0.6 §3.8, Q-20] kds_station has_printer (P0.22)', () => {
  const hubEvent = (event_type: string, payload: Record<string, unknown>) =>
    append(hub, [{ stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, event_type, payload }], { actor: null });
  const printer = (printer_id: string, archived = false) =>
    hubEvent('PrinterSaved', { printer_id, name: printer_id, connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived });
  const output = (station_id: string, mode: 'screen' | 'both' | 'printer', printer_id: string | null) =>
    hubEvent('StationOutputSet', { station_id, mode, printer_id, show_taker: true, show_order_id: true });
  const hasPrinter = (station_id: string) => (kdsStationPart(hub.deps).build(hub.deps.db, engine(), stationSocket(station_id)) as KdsStationBody).has_printer;

  it('[03b §6.14] has_printer: true for both / printer with an active printer; false for no row, screen (even with a fallback printer) and an archived printer; exactly 4 statements', async () => {
    await start();
    expect(hasPrinter(FX.station)).toBe(false); // no output row
    printer('PR1');
    printer('PR2');
    output(FX.station, 'both', 'PR1');
    output(FX.zoneStation, 'printer', 'PR2');
    expect([hasPrinter(FX.station), hasPrinter(FX.zoneStation)]).toEqual([true, true]);
    output(FX.station, 'screen', 'PR1');
    expect(hasPrinter(FX.station)).toBe(false);
    printer('PR2', true); // as replayed: the archive event itself (SavePrinter refuses it while in use)
    expect(hasPrinter(FX.zoneStation)).toBe(false);
    output(FX.station, 'printer', 'PR1');
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan }] });
    fireLines(hub, FX.station, ['A1']);
    const counter = statementCounter(hub.deps.db);
    const body = KdsStationBody.strict().parse(kdsStationPart(hub.deps).build(hub.deps.db, engine(), stationSocket(FX.station)));
    expect(counter.count).toBe(4);
    expect(body.has_printer).toBe(true);
  });

  it('[03b §6.14] the catch-up a station socket receives carries has_printer', async () => {
    await start();
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    const kds = await socketOf('station');
    expect(KdsStationBody.parse(catchUpState(kds).kds_station).has_printer).toBe(true);
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

describe('[03b #68] table moves re-send the held lines (HK3, Q-47) - KDS station sockets', () => {
  const tableMenu = (): BranchConfig => {
    const m = fixtureMenu();
    const floor = m.floors[0]!;
    return { ...m, floors: [{ ...floor, tables: ['4', '5', '9', '10', '11'].map((n, i) => ({ table_id: `T${n}`, name: n, seats: 4, sort_order: i, zone_id: null })) }] };
  };
  const startTables = async (): Promise<void> => {
    hub = await createTestHub({ provisioned: true });
    await seedDirectory(hub, await aDirectory());
    openDay(hub, { menu: tableMenu() });
  };
  const tableEvent = (stream: string, event_type: string, payload: Record<string, unknown>) => append(hub, [{ stream_type: 'table', stream_id: stream, event_type, payload: { ...payload, by_staff_id: 'S_WAIT' } }]);
  const move = (seating_id: string, from_table_id: string, to_table_id: string) => tableEvent(from_table_id, 'TableMoved', { seating_id, from_table_id, to_table_id });
  const dineIn = (table_id: string, seating_id: string, line: string): string => {
    openSeating(hub, { table_id, seating_id });
    return appendOrder(hub, { order_type: 'dine_in', seating_id, lines: [{ order_item_id: line, item_id: FX.piece }] }).order_id;
  };
  const labelOf = (frames: Array<{ lines: Array<{ order_item_id: string; identifier: { kind: string; label?: string } }> }>, id: string): string | undefined =>
    frames.flatMap((f) => f.lines).filter((l) => l.order_item_id === id).map((l) => l.identifier.label).at(-1);
  const lineIds = (frames: Array<{ lines: Array<{ order_item_id: string }> }>): string[][] => frames.map((f) => f.lines.map((l) => l.order_item_id));
  /** Counts the table-event read (Q-47) only. */
  function seatingReads(db: Database.Database): { readonly count: number; reset(): void } {
    let count = 0;
    const prepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      const statement = prepare(sql);
      if (sql.includes('SELECT order_id FROM seating_orders WHERE seating_id IN')) {
        const all = statement.all.bind(statement);
        statement.all = ((...args: unknown[]) => {
          count += 1;
          return all(...(args as []));
        }) as typeof statement.all;
      }
      return statement;
    }) as typeof db.prepare;
    return { get count() { return count; }, reset() { count = 0; } };
  }

  it('[03b #68] TableMoved T4 → T9: one kds_lines and one point_lines frame re-send the held lines with identifier T9', async () => {
    await startTables();
    dineIn('T4', 'SE4', 'D1');
    dineIn('T5', 'SE5', 'D2');
    const ws = await socketOf('station');
    await settle();
    expect(kdsLines(ws)).toEqual([]);
    move('SE4', 'T4', 'T9');
    await settle();
    expect(lineIds(kdsLines(ws))).toEqual([['D1']]);
    expect(kdsLines(ws)[0]!.lines[0]!.identifier).toEqual({ kind: 'table', label: 'T9' });
  });

  it('[03b #68] TablesMerged absorbing the seating → "T9 + T10"; SeatingSplit moving an order → its lines re-sent with the new table', async () => {
    await startTables();
    dineIn('T9', 'SE9', 'D1');
    const o10 = dineIn('T10', 'SE10', 'D2');
    const ws = await socketOf('station');
    await settle();
    tableEvent('T9', 'TablesMerged', { into_seating_id: 'SE9', into_table_id: 'T9', table_ids: ['T10'], absorbed_seating_id: 'SE10', order_ids: [o10] });
    await settle();
    expect(lineIds(kdsLines(ws))).toEqual([['D1', 'D2']]);
    expect(labelOf(kdsLines(ws), 'D1')).toBe('T9 + T10');
    expect(labelOf(kdsLines(ws), 'D2')).toBe('T9 + T10');

    tableEvent('T9', 'SeatingSplit', { from_seating_id: 'SE9', new_seating_id: 'SE11', to_table_id: 'T11', order_ids: [o10] });
    await settle();
    expect(lineIds(kdsLines(ws))).toEqual([['D1', 'D2'], ['D1', 'D2']]);
    expect(labelOf(kdsLines(ws), 'D2')).toBe('T11');
    expect(labelOf(kdsLines(ws), 'D1')).toBe('T9 + T10');
  });

  it('[03b #68] lines of other seatings are not re-sent; a commit without a table event sends nothing extra', async () => {
    await startTables();
    dineIn('T4', 'SE4', 'D1');
    dineIn('T5', 'SE5', 'D2');
    const ws = await socketOf('station');
    await settle();
    move('SE4', 'T4', 'T9');
    await settle();
    expect(lineIds(kdsLines(ws))).toEqual([['D1']]);

    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'X1', item_id: FX.piece }] });
    fireLines(hub, FX.station, ['D1', 'D2']);
    await settle();
    expect(lineIds(kdsLines(ws))).toEqual([['D1'], ['X1']]);
  });

  it('[03b #68] statements ≤ 2 + 1 per hook (KDS and Pass each), only in a commit with a table event', async () => {
    await startTables();
    dineIn('T4', 'SE4', 'D1');
    const counter = statementCounter(hub.deps.db);
    const reads = seatingReads(hub.deps.db);
    // the same commit shape with no socket connected: the hooks return before any read
    counter.reset();
    move('SE4', 'T4', 'T9');
    const bare = counter.count;
    expect(reads.count, 'no socket: no read').toBe(0);

    const ws = await socketOf('station');
    await settle();
    counter.reset();
    reads.reset();
    move('SE4', 'T9', 'T4');
    const hooked = counter.count - bare;
    expect(hooked, 'buildLineDetails 2 + the seating_orders read 1').toBeLessThanOrEqual(3);
    expect(reads.count).toBe(1);
    await settle();
    expect(lineIds(kdsLines(ws))).toEqual([['D1']]);

    // a commit with no table event: no seating_orders read; the commit holding no new line reads nothing at all
    counter.reset();
    reads.reset();
    fireLines(hub, FX.station, ['D1']);
    expect(reads.count).toBe(0);
  });
});
