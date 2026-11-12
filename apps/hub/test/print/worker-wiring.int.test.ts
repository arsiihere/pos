import { WsPrintedLines } from '@pos/events';
import type { EngineState } from '@pos/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { stationPresence } from '../../src/kds/contracts';
import { kdsPresenceTick } from '../../src/kds/presence';
import { startPrintWorker } from '../../src/print/boot';
import type { SendResult } from '../../src/print/transport/lan';
import { createPrintWorker, type PrinterTransport } from '../../src/print/worker';
import { printedLinesAcked } from '../../src/ws/print-catch-up';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { createTestHub, openSession, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { FX, appendOrder, append as kdsAppend, fireLines, openDay, pairKds, signInCook } from '../kds/fixtures';
import { fakeClock, fakeLanPrinter, type FakeLanPrinter } from './fixtures';

// 03c §3.4, §3.8 (integrator ruling on #65 / #67): startPrintWorker composes c15's status hooks with c17's paper
// fallback (`pass`) and c21's printed_lines frame (`acked`). End to end through the real worker (real 1 s loop, real
// LAN fake printer on 127.0.0.1): S1's screen is down → 03b marks it dark → the fallback queues the Now ticket → the
// worker prints it → the ack sends printed_lines to the Pass socket of S1's point. Waits poll a condition; no timing
// asserts.

const OFFLINE_MS = 30_000;
let hub: TestHub;
let printer: FakeLanPrinter;
const sockets: WsClient[] = [];
const stops: Array<() => void> = [];
afterEach(async () => {
  for (const s of stops.splice(0)) s();
  for (const ws of sockets.splice(0)) ws.close();
  await printer?.close();
  swapBranchConfig(null);
  await hub?.close();
});

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 1_000; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition never held');
}

describe('[03c §3.4, §3.8] the worker started by startPrintWorker runs the paper fallback and sends printed_lines', () => {
  it('[03c #40] KDS screen down → fallback ticket printed by the real worker → printed_lines to the Pass socket', { timeout: 30_000 }, async () => {
    hub = await createTestHub({ provisioned: true });
    printer = await fakeLanPrinter();
    const cook = await signInCook(hub, { pointId: 'P1' });
    openDay(hub);
    pairKds(hub, { stationId: FX.station }); // S1 has a screen, never connected
    const branch = hub.deps.config.provisioned!.branch_id;
    kdsAppend(
      hub,
      [
        { stream_type: 'hub', stream_id: branch, event_type: 'PrinterSaved', payload: { printer_id: 'PR1', name: 'PR1', connection: 'lan', address: printer.address, paper_width_mm: 80, archived: false } },
        { stream_type: 'hub', stream_id: branch, event_type: 'StationOutputSet', payload: { station_id: FX.station, mode: 'screen', printer_id: 'PR1', show_taker: true, show_order_id: true } },
      ],
      { actor: null },
    );
    const ws = await connectWs(hub.app);
    sockets.push(ws);
    ws.send({ type: 'auth', device_token: cook.token, session_token: cook.sessionToken });
    await ws.untilCount(1);
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan, quantity: 3 }] });
    fireLines(hub, FX.station, ['A1']);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM print_jobs').pluck().get()).toBe(0); // screen: nothing at fire

    // 03b's presence tick (injected now): no screen for kds_offline_ms with a line in Now → dark
    const since = hub.clock.branchNow();
    kdsPresenceTick.due(readOnlyDb(hub.deps.db), hub.deps.state.get() as EngineState, since);
    kdsPresenceTick.due(readOnlyDb(hub.deps.db), hub.deps.state.get() as EngineState, since + OFFLINE_MS);
    expect(stationPresence().get(FX.station)?.dark).toBe(true);

    const errors: string[] = [];
    stops.push(startPrintWorker(hub.deps, { error: (_o, msg) => errors.push(msg ?? '') }));
    const ticket = hub.deps.db.prepare(`SELECT ticket_id FROM ticket_lines WHERE order_item_id = 'A1'`).pluck().get() as string;
    await until(() => hub.deps.db.prepare('SELECT acked_at FROM print_jobs WHERE job_id = ?').pluck().get(`${ticket}:kitchen`) != null);
    await until(() => printer.received().toString('latin1').includes('3 x Naan'));
    await until(() => ws.messages.some((m) => (m as { type?: string }).type === 'printed_lines'));
    const frames = ws.messages.filter((m) => (m as { type?: string }).type === 'printed_lines').map((m) => WsPrintedLines.parse(m));
    expect(frames).toEqual([{ type: 'printed_lines', station_id: FX.station, order_item_ids: ['A1'] }]);
    expect(hub.deps.db.prepare(`SELECT COUNT(*) FROM print_jobs WHERE kind = 'coming_up'`).pluck().get()).toBe(1);
    expect(errors.filter((e) => e.includes('hook'))).toEqual([]);
  });
});

describe('[03c §3.8, §3.7] acked hooks only for a row the ack really acked', () => {
  it('[03c §3.8] a manager cancel during the send: the job stays cancelled, no acked hook, no printed_lines frame', async () => {
    hub = await createTestHub({ provisioned: true });
    openDay(hub);
    const kds = pairKds(hub, { stationId: FX.station });
    const branch = hub.deps.config.provisioned!.branch_id;
    kdsAppend(
      hub,
      [
        { stream_type: 'hub', stream_id: branch, event_type: 'PrinterSaved', payload: { printer_id: 'PR1', name: 'PR1', connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived: false } },
        { stream_type: 'hub', stream_id: branch, event_type: 'StationOutputSet', payload: { station_id: FX.station, mode: 'both', printer_id: 'PR1', show_taker: true, show_order_id: true } },
      ],
      { actor: null },
    );
    const ws = await connectWs(hub.app);
    sockets.push(ws);
    ws.send({ type: 'auth', device_token: kds.token, session_token: openSession(hub, { kind: 'station', deviceId: kds.deviceId, stationId: FX.station }).token });
    await ws.untilCount(1);
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan, quantity: 1 }] });
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'B1', item_id: FX.naan, quantity: 1 }] });
    fireLines(hub, FX.station, ['A1']);
    fireLines(hub, FX.station, ['B1']);
    const waiting: Array<(r: SendResult) => void> = [];
    const t: PrinterTransport = { send: () => new Promise<SendResult>((resolve) => waiting.push(resolve)), close: () => undefined };
    const acks: string[] = [];
    const printed = printedLinesAcked(hub.deps.db);
    const w = createPrintWorker({
      db: hub.deps.db,
      state: hub.deps.state,
      clock: hub.clock,
      timers: fakeClock(),
      transportFor: () => t,
      hooks: { acked: (job, at) => (acks.push(job.job_id), printed(job, at)) },
    });
    stops.push(() => w.stop());
    const ticketOf = (id: string): string => hub.deps.db.prepare('SELECT ticket_id FROM ticket_lines WHERE order_item_id = ?').pluck().get(id) as string;
    const a = `${ticketOf('A1')}:kitchen`;
    const b = `${ticketOf('B1')}:kitchen`;
    w.pass();
    expect(waiting).toHaveLength(1);
    hub.deps.db.prepare('UPDATE print_jobs SET cancelled_at = ? WHERE job_id = ?').run(hub.clock.branchNow(), a); // manager cancel (c19)
    waiting.shift()!({ ok: true });
    await until(() => waiting.length === 1); // B goes next
    expect(hub.deps.db.prepare('SELECT acked_at, cancelled_at IS NOT NULL AS cancelled FROM print_jobs WHERE job_id = ?').get(a)).toEqual({ acked_at: null, cancelled: 1 });
    expect(acks).toEqual([]);
    waiting.shift()!({ ok: true });
    await until(() => acks.length === 1);
    expect(acks).toEqual([b]);
    await until(() => ws.messages.some((m) => (m as { type?: string }).type === 'printed_lines'));
    const frames = ws.messages.filter((m) => (m as { type?: string }).type === 'printed_lines').map((m) => WsPrintedLines.parse(m));
    expect(frames).toEqual([{ type: 'printed_lines', station_id: FX.station, order_item_ids: ['B1'] }]);
  });
});
