import type { EngineState } from '@pos/engine';
import { WsPrintedLines } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SendResult } from '../../src/print/transport/lan';
import { createPrintWorker, type PrintWorker, type PrinterTransport } from '../../src/print/worker';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { printedLinesAcked, printedNowIds } from '../../src/ws/print-catch-up';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { FX, appendOrder, append as kdsAppend, fireLines, openDay, pairDevice, pairKds, signInCook } from '../kds/fixtures';
import { fakeClock } from './fixtures';

// 03c §3.8, §6.9 (task c21): catch-up part `kds_printed` (station sockets: their station; Pass sockets: their point's
// stations; 1 statement) and frame `printed_lines` after each ack of a kitchen / reprint job (worker `acked` hook).
// Real sockets through the hub's /ws; S1 is on point P1 (fixtureMenu); the Cook's Pass tablet is bound to P1.

let hub: TestHub;
const sockets: WsClient[] = [];
const stops: Array<() => void> = [];
beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
});
afterEach(async () => {
  for (const s of stops.splice(0)) s();
  for (const ws of sockets.splice(0)) ws.close();
  swapBranchConfig(null);
  await hub.close();
});

const branch = (): string => hub.deps.config.provisioned!.branch_id;
const engine = (): EngineState => hub.deps.state.get() as EngineState;
function hubEvent(event_type: 'PrinterSaved' | 'StationOutputSet', payload: Record<string, unknown>): void {
  kdsAppend(hub, [{ stream_type: 'hub', stream_id: branch(), event_type, payload }], { actor: null });
}
function bothStation(): void {
  hubEvent('PrinterSaved', { printer_id: 'PR1', name: 'PR1', connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived: false });
  hubEvent('StationOutputSet', { station_id: FX.station, mode: 'both', printer_id: 'PR1', show_taker: true, show_order_id: true });
}
function fired(ids: string[]): string {
  const { order_id } = appendOrder(hub, { order_type: 'takeaway', lines: ids.map((id) => ({ order_item_id: id, item_id: FX.naan, quantity: 1 })) });
  fireLines(hub, FX.station, ids);
  return order_id;
}
const ticketOf = (id: string): string => hub.deps.db.prepare('SELECT ticket_id FROM ticket_lines WHERE order_item_id = ?').pluck().get(id) as string;

async function connect(device_token: string, session_token: string): Promise<WsClient> {
  const ws = await connectWs(hub.app);
  sockets.push(ws);
  ws.send({ type: 'auth', device_token, session_token });
  await ws.untilCount(1);
  return ws;
}
async function kdsSocket(): Promise<WsClient> {
  const kds = pairKds(hub, { stationId: FX.station });
  return connect(kds.token, openSession(hub, { kind: 'station', deviceId: kds.deviceId, stationId: FX.station }).token);
}
const stateOf = (ws: WsClient): Record<string, unknown> => (ws.messages[0] as { state: Record<string, unknown> }).state;
const printedFrames = (ws: WsClient): WsPrintedLines[] =>
  ws.messages.filter((m) => (m as { type?: string }).type === 'printed_lines').map((m) => WsPrintedLines.parse(m));
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

/** The worker with c21's acked hook; each send acks at once. */
function worker(): PrintWorker {
  const t: PrinterTransport = { send: () => Promise.resolve<SendResult>({ ok: true }), close: () => undefined };
  const w = createPrintWorker({ db: hub.deps.db, state: hub.deps.state, clock: hub.clock, timers: fakeClock(), transportFor: () => t, hooks: { acked: printedLinesAcked(hub.deps.db) } });
  stops.push(() => w.stop());
  return w;
}

describe('[03c §3.8] kds_printed catch-up + printed_lines frame (c21)', () => {
  it('[03c §3.8] after ack the KDS socket and the Pass socket of the station\'s point get printed_lines with the ticket\'s ids', async () => {
    const cook = await signInCook(hub, { pointId: 'P1' });
    openDay(hub);
    bothStation();
    const kds = await kdsSocket();
    const pass = await connect(cook.token, cook.sessionToken);
    const other = pairDevice(hub, { type: 'tablet' }); // a staff socket with no point: no frame
    const plain = await connect(other.token, openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: other.deviceId }).token);
    fired(['A1', 'A2']);
    worker().pass();
    await settle();
    const expected = { type: 'printed_lines', station_id: FX.station, order_item_ids: ['A1', 'A2'] };
    expect(printedFrames(kds)).toEqual([expected]);
    expect(printedFrames(pass)).toEqual([expected]);
    expect(printedFrames(plain)).toEqual([]);
  });

  it('[03c §3.8] only kitchen / reprint acks send it (not a slip, not a document); one statement per frame', async () => {
    openDay(hub);
    bothStation();
    const kds = await kdsSocket();
    fired(['A1']);
    const ticket = ticketOf('A1');
    const counter = statementCounter(hub.deps.db);
    const acked = printedLinesAcked(hub.deps.db);
    for (const kind of ['cancel', 'first', 'coming_up', 'document']) acked({ job_id: 'J', kind, printer_id: 'PR1', station_id: FX.station, ticket_id: kind === 'document' ? null : ticket }, 0);
    expect(counter.count).toBe(0);
    acked({ job_id: 'R', kind: 'reprint', printer_id: 'PR1', station_id: FX.station, ticket_id: ticket }, 0);
    expect(counter.count).toBe(1);
    await settle();
    expect(printedFrames(kds).map((f) => f.order_item_ids)).toEqual([['A1']]);
  });

  it('[03c §3.8] catch-up kds_printed lists every line of a printed ticket with a Now line, done lines too (a reconnecting Pass keeps the tag)', async () => {
    const cook = await signInCook(hub, { pointId: 'P1' });
    openDay(hub);
    bothStation();
    const a = fired(['A1', 'A2']);
    const w = worker();
    w.pass();
    await settle();
    w.stop();
    kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'ItemDone', payload: { order_item_id: 'A2', done_at: hub.clock.branchNow(), source: 'tap' } }]);
    const pass = await connect(cook.token, cook.sessionToken);
    expect(stateOf(pass).kds_printed).toEqual({ order_item_ids: ['A1', 'A2'] });
    const counter = statementCounter(hub.deps.db);
    expect(printedNowIds(hub.deps.db, engine(), [FX.station], hub.clock.branchNow())).toEqual(['A1', 'A2']);
    expect(counter.count).toBe(1);
  });

  it('[03c §3.8] catch-up kds_printed: a station socket gets its printed Now lines; a Pass socket its point\'s; 1 statement', async () => {
    const cook = await signInCook(hub, { pointId: 'P1' });
    openDay(hub);
    bothStation();
    fired(['A1']);
    const w = worker();
    w.pass(); // A's ticket printed
    await settle();
    w.stop();
    fired(['B1']); // B's kitchen job waits unsent: not printed
    expect(ticketOf('B1')).toBeDefined();
    const kds = await kdsSocket();
    const pass = await connect(cook.token, cook.sessionToken);
    expect(stateOf(kds).kds_printed).toEqual({ order_item_ids: ['A1'] });
    expect(stateOf(pass).kds_printed).toEqual({ order_item_ids: ['A1'] });
    const other = pairDevice(hub, { type: 'tablet' });
    const plain = await connect(other.token, openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: other.deviceId }).token);
    expect(stateOf(plain).kds_printed).toBeUndefined();
    const counter = statementCounter(hub.deps.db);
    expect(printedNowIds(hub.deps.db, engine(), [FX.station], hub.clock.branchNow())).toEqual(['A1']);
    expect(counter.count).toBe(1);
    counter.reset();
    expect(printedNowIds(hub.deps.db, engine(), ['S_EMPTY'], hub.clock.branchNow())).toEqual([]);
    expect(counter.count).toBe(0);
  });
});
