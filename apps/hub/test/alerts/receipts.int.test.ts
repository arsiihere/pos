import type { EventDraft, PosEvent } from '@pos/events';
import { anAlertRaised, anAttemptSent } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import { createReceiptBuffer, RECEIPT_FLUSH_AT, RECEIPT_FLUSH_MS, receiptBufferFor } from '../../src/alerts/receipts';
import { buildHubServer } from '../../src/server';
import { wsHubFor } from '../../src/ws/server';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import type { FastifyInstance } from 'fastify';
import { registerFakes, resetFakes } from './fakes';

// 01d task 21: the receipt buffer (receipts.ts). §3.6 / A11: `receipt` frames and alerts.recordReceipt go into
// an in-memory buffer, deduped before buffering by (alert_id, staff_id, device_id, kind, step), flushed every
// 1 000 ms or at 100 as ONE writer.run; an empty buffer opens no transaction; the recorded set is seeded from
// alert_receipts of open alerts before sockets are accepted. §6 batch 3: unknown alert, not sent, step above the
// alert's current step → ignored. Review Focus 4: hostile receipt frames are ignored and never close the socket.

const MGR = 'S_MGR';
const CASH = 'S_CASH';

interface World {
  hub: TestHub;
  app: FastifyInstance;
  tokens: Map<string, string>;
  clients: WsClient[];
  /** receipts the WS hub has handed to its listeners so far (the buffer's listener runs first) */
  seen(): number;
}

async function world(cleanups: Array<() => Promise<void>>): Promise<World> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub);
  return withApp(hub, hub.app, new Map());
}

function withApp(hub: TestHub, app: FastifyInstance, tokens: Map<string, string>): World {
  let count = 0;
  wsHubFor(app).onReceipt(() => {
    count += 1;
  });
  return { hub, app, tokens, clients: [], seen: () => count };
}

function device(w: World, type: 'tablet' | 'kds' | 'cashier_kiosk'): string {
  const d = pairDevice(w.hub, { type, stationId: type === 'kds' ? 'station-1' : undefined });
  w.tokens.set(d.deviceId, d.token);
  return d.deviceId;
}

function token(w: World, deviceId: string): string {
  const t = w.tokens.get(deviceId);
  if (t === undefined) throw new Error(`unknown device ${deviceId}`);
  return t;
}

async function staffSocket(w: World, staffId: string, deviceId: string, sessionToken?: string): Promise<WsClient> {
  const tok = sessionToken ?? openSession(w.hub, { kind: 'staff', staffId, deviceId }).token;
  const ws = await connectWs(w.app);
  ws.send({ type: 'auth', device_token: token(w, deviceId), session_token: tok });
  await ws.untilCount(1);
  expect(ws.messages[0]).toMatchObject({ type: 'catch_up' });
  w.clients.push(ws);
  return ws;
}

async function stationSocket(w: World, deviceId: string): Promise<WsClient> {
  const response = await w.app.inject({ method: 'POST', url: '/auth/station', headers: { authorization: `Bearer ${token(w, deviceId)}` } });
  const body = response.json() as { data: { session_token: string } };
  const ws = await connectWs(w.app);
  ws.send({ type: 'auth', device_token: token(w, deviceId), session_token: body.data.session_token });
  await ws.untilCount(1);
  expect(ws.messages[0]).toMatchObject({ type: 'catch_up' });
  w.clients.push(ws);
  return ws;
}

async function alertSocket(w: World, deviceId: string): Promise<WsClient> {
  const ws = await connectWs(w.app);
  ws.send({ type: 'auth', device_token: token(w, deviceId) });
  await ws.untilCount(1);
  expect(ws.messages[0]).toMatchObject({ type: 'alerts_open' });
  w.clients.push(ws);
  return ws;
}

/** Waits (setImmediate turns, never a timer) until the hub has handed `n` receipts to its listeners. */
async function untilSeen(w: World, n: number): Promise<void> {
  for (let i = 0; i < 2_000 && w.seen() < n; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
  expect(w.seen()).toBe(n);
}

function asDraft(event: PosEvent): EventDraft {
  return {
    stream_type: event.stream_type,
    stream_id: event.stream_id,
    event_type: event.event_type,
    schema_version: event.schema_version,
    payload: event.payload,
    occurred_at: event.occurred_at,
    actor_id: event.actor_id,
    device_id: event.device_id,
  };
}

type Row = { staff_id: string | null; device_id: string | null; for_staff_id: string | null; set: 'answerer' | 'informed' | 'recipient' };
const personRow = (staff_id: string): Row => ({ staff_id, device_id: null, for_staff_id: null, set: 'recipient' });
const deviceRow = (device_id: string): Row => ({ staff_id: null, device_id, for_staff_id: null, set: 'recipient' });

/** Alerts of the fake `t_two_step` kind on the order stream, each with its step 0 (one transaction). */
function seedAlerts(w: World, items: Array<{ id: string; rows: Row[] }>): void {
  w.hub.deps.writer.run((tx) => {
    tx.append(
      items.flatMap((o) => [
        asDraft(
          anAlertRaised({
            stream_type: 'order',
            stream_id: `O-${o.id}`,
            payload: { alert_id: o.id, kind: 't_two_step', subject_stream_type: 'order', subject_stream_id: `O-${o.id}`, dedupe_key: `seed:${o.id}` },
          }),
        ),
        asDraft(anAttemptSent({ stream_type: 'order', stream_id: `O-${o.id}`, payload: { alert_id: o.id, step: 0, recipients: o.rows, routes: [] } })),
      ]),
    );
  });
}

function step(w: World, id: string, n: number, rows: Row[]): void {
  w.hub.deps.writer.run((tx) => {
    tx.append([asDraft(anAttemptSent({ stream_type: 'order', stream_id: `O-${id}`, payload: { alert_id: id, step: n, recipients: rows, routes: [] } }))]);
  });
}

interface Stored {
  stream_type: string;
  stream_id: string;
  event_type: string;
  actor_id: string | null;
  device_id: string;
  payload: Record<string, unknown>;
}

function receiptEvents(w: World): Stored[] {
  return (
    w.hub.deps.db
      .prepare(
        `SELECT stream_type, stream_id, event_type, actor_id, device_id, payload FROM events
         WHERE event_type IN ('AlertDelivered', 'AlertSeen') ORDER BY seq`,
      )
      .all() as Array<Omit<Stored, 'payload'> & { payload: string }>
  ).map((r) => ({ ...r, payload: JSON.parse(r.payload) as Record<string, unknown> }));
}

function receiptRows(w: World): Array<{ alert_id: string; staff_id: string; device_id: string; kind: string; step: number }> {
  return w.hub.deps.db
    .prepare('SELECT alert_id, staff_id, device_id, kind, step FROM alert_receipts ORDER BY alert_id, device_id, kind, step')
    .all() as Array<{ alert_id: string; staff_id: string; device_id: string; kind: string; step: number }>;
}

const receipt = (alert_id: string, s = 0): Record<string, unknown> => ({ type: 'receipt', alert_id, kind: 'delivered', step: s });
const ids = (n: number, prefix = 'A'): string[] => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(4, '0')}`);

describe('01d receipt buffer (task 21)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  beforeEach(() => registerFakes());
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const cleanup of cleanups.splice(0)) await cleanup();
    resetFakes();
  });

  it('[01d #23] 150 distinct receipt frames → 2 flushes (at 100, then at 1 000 ms), one writer.run each; AlertDelivered on audit with subject fields and step; an empty buffer opens no transaction', async () => {
    expect(RECEIPT_FLUSH_MS).toBe(1_000);
    expect(RECEIPT_FLUSH_AT).toBe(100);
    const w = await world(cleanups);
    const tab = device(w, 'tablet');
    const all = ids(150);
    seedAlerts(w, all.map((id) => ({ id, rows: [personRow(MGR)] })));
    const ws = await staffSocket(w, MGR, tab);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const run = vi.spyOn(w.hub.deps.writer, 'run');

    for (const id of all.slice(0, 99)) ws.send(receipt(id));
    await untilSeen(w, 99);
    expect(run).not.toHaveBeenCalled();
    ws.send(receipt(all[99] ?? ''));
    await untilSeen(w, 100);
    expect(run).toHaveBeenCalledTimes(1); // the 100th receipt flushes at once
    expect(receiptEvents(w)).toHaveLength(100);

    for (const id of all.slice(100)) ws.send(receipt(id));
    await untilSeen(w, 150);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RECEIPT_FLUSH_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);

    const events = receiptEvents(w);
    expect(events).toHaveLength(150);
    expect(events[0]).toEqual({
      stream_type: 'audit',
      stream_id: all[0],
      event_type: 'AlertDelivered',
      actor_id: null,
      device_id: 'hub',
      payload: {
        alert_id: all[0],
        subject_stream_type: 'order',
        subject_stream_id: `O-${all[0] ?? ''}`,
        staff_id: MGR,
        device_id: tab,
        route: 'screen',
        step: 0,
      },
    });
    expect(receiptRows(w)).toHaveLength(150);

    // empty buffer: no transaction, however long the hub idles
    vi.advanceTimersByTime(RECEIPT_FLUSH_MS * 10);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('[01d #23] repeats are dropped before buffering (no duplicate AlertDelivered); the same device step 1 and step 2 → two AlertDelivered', async () => {
    const w = await world(cleanups);
    const tab = device(w, 'tablet');
    seedAlerts(w, [{ id: 'R1', rows: [personRow(MGR)] }]);
    step(w, 'R1', 1, [personRow(MGR)]);
    step(w, 'R1', 2, [personRow(MGR)]);
    const ws = await staffSocket(w, MGR, tab);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const buffer = receiptBufferFor(w.app);

    ws.send(receipt('R1', 1));
    ws.send(receipt('R1', 1)); // repeat while buffered
    await untilSeen(w, 2);
    expect(buffer.size()).toBe(1);
    vi.advanceTimersByTime(RECEIPT_FLUSH_MS);
    ws.send(receipt('R1', 1)); // repeat after the flush: in the recorded set
    ws.send(receipt('R1', 2));
    await untilSeen(w, 4);
    expect(buffer.size()).toBe(1);
    vi.advanceTimersByTime(RECEIPT_FLUSH_MS);

    expect(receiptEvents(w).map((e) => [e.event_type, e.payload.step])).toEqual([
      ['AlertDelivered', 1],
      ['AlertDelivered', 2],
    ]);
  });

  it('[01d #23] restart: receipts flushed, hub restarted, the recorded set is seeded from alert_receipts of open alerts before sockets are accepted; the same receipt re-sent is recorded once', async () => {
    const w = await world(cleanups);
    const tab = device(w, 'tablet');
    seedAlerts(w, [{ id: 'S1', rows: [personRow(MGR)] }]);
    const session = openSession(w.hub, { kind: 'staff', staffId: MGR, deviceId: tab });
    const ws = await staffSocket(w, MGR, tab, session.token);
    ws.send(receipt('S1'));
    await untilSeen(w, 1);
    receiptBufferFor(w.app).flush();
    expect(receiptEvents(w)).toHaveLength(1);
    await w.app.close();

    // the restarted hub: same database, a new server; registerAlerts seeds before any socket is accepted
    const app2 = buildHubServer(w.hub.deps, { testCommands: true });
    cleanups.unshift(() => app2.close());
    const w2 = withApp(w.hub, app2, w.tokens);
    const ws2 = await staffSocket(w2, MGR, tab, session.token);
    ws2.send(receipt('S1'));
    await untilSeen(w2, 1);
    expect(receiptBufferFor(app2).size()).toBe(0); // dropped before buffering: the seeded recorded set
    receiptBufferFor(app2).flush();
    expect(receiptEvents(w)).toHaveLength(1);
  });

  it('[01d #23] seen from a command is buffered on commit: a rolled-back transaction buffers no AlertSeen; a committed one does (step -1, route screen)', async () => {
    const w = await world(cleanups);
    const tab = device(w, 'tablet');
    seedAlerts(w, [{ id: 'V1', rows: [personRow(MGR)] }]);
    const buffer = receiptBufferFor(w.app);
    expect(() =>
      w.hub.deps.writer.run((tx) => {
        tx.onCommit(() => alerts.recordReceipt({ alert_id: 'V1', staff_id: MGR, device_id: tab, kind: 'seen' }));
        throw new Error('handler failed');
      }),
    ).toThrow('handler failed');
    expect(buffer.size()).toBe(0);

    w.hub.deps.writer.run((tx) => {
      tx.onCommit(() => alerts.recordReceipt({ alert_id: 'V1', staff_id: MGR, device_id: tab, kind: 'seen', step: 3 }));
    });
    expect(buffer.size()).toBe(1);
    buffer.flush();
    const events = receiptEvents(w);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ stream_type: 'audit', stream_id: 'V1', event_type: 'AlertSeen' });
    expect(events[0]?.payload).toEqual({
      alert_id: 'V1',
      subject_stream_type: 'order',
      subject_stream_id: 'O-V1',
      staff_id: MGR,
      device_id: tab,
      route: 'screen',
    });
    expect(receiptRows(w)).toEqual([{ alert_id: 'V1', staff_id: MGR, device_id: tab, kind: 'seen', step: -1 }]);
  });

  it('[01d #23] alerts.recordReceipt with kind delivered and no step → error; at 100 buffered it flushes after the caller returns, never inside its commit', async () => {
    const w = await world(cleanups);
    const tab = device(w, 'tablet');
    expect(() => alerts.recordReceipt({ alert_id: 'X1', staff_id: null, device_id: tab, kind: 'delivered' })).toThrow(/step/);
    expect(() => alerts.recordReceipt({ alert_id: 'X1', staff_id: null, device_id: tab, kind: 'delivered', step: -1 })).toThrow(/step/);
    expect(receiptBufferFor(w.app).size()).toBe(0);

    const all = ids(100, 'M');
    seedAlerts(w, all.map((id) => ({ id, rows: [personRow(MGR)] })));
    const run = vi.spyOn(w.hub.deps.writer, 'run');
    w.hub.deps.writer.run((tx) => {
      tx.onCommit(() => {
        for (const id of all) alerts.recordReceipt({ alert_id: id, staff_id: MGR, device_id: tab, kind: 'seen' });
      });
    });
    expect(run).toHaveBeenCalledTimes(1); // only the caller's own transaction so far
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(2);
    expect(receiptEvents(w)).toHaveLength(100);
    // a 01e route's delivered receipt carries its route name
    alerts.recordReceipt({ alert_id: all[0] ?? '', staff_id: MGR, device_id: tab, kind: 'delivered', step: 0, route: 'pager' });
    receiptBufferFor(w.app).flush();
    expect(receiptEvents(w).at(-1)?.payload).toMatchObject({ route: 'pager', step: 0 });
  });

  it('[01d #30] a receipt for an alert this device was not sent, or an unknown alert → ignored; a KDS station socket that got a device-target alert → recorded with staff_id = ""', async () => {
    const w = await world(cleanups);
    const kds = device(w, 'kds');
    const tab = device(w, 'tablet');
    seedAlerts(w, [
      { id: 'K1', rows: [deviceRow(kds)] },
      { id: 'P1', rows: [personRow(CASH)] }, // sent to Cashier, not to the KDS or to Manager
    ]);
    const station = await stationSocket(w, kds);
    const mgr = await staffSocket(w, MGR, tab);
    station.send(receipt('P1'));
    station.send(receipt('NOPE'));
    mgr.send(receipt('P1'));
    mgr.send(receipt('K1')); // a device-target alert of another device
    station.send(receipt('K1'));
    await untilSeen(w, 5);
    receiptBufferFor(w.app).flush();

    expect(receiptRows(w)).toEqual([{ alert_id: 'K1', staff_id: '', device_id: kds, kind: 'delivered', step: 0 }]);
    const events = receiptEvents(w);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ alert_id: 'K1', staff_id: null, device_id: kds, route: 'screen', step: 0 });
  });

  it('[01d §3.6] a receipt with a step above the alert\'s current step → ignored; an alert-mode receipt records the bound person and route alert_connection', async () => {
    const w = await world(cleanups);
    const tab = device(w, 'tablet');
    const mgrTab = device(w, 'tablet');
    openSession(w.hub, { kind: 'staff', staffId: MGR, deviceId: tab }); // binds the tablet to MGR (§3.7)
    seedAlerts(w, [{ id: 'T1', rows: [personRow(MGR)] }]);
    const mode = await alertSocket(w, tab);
    const mgr = await staffSocket(w, MGR, mgrTab);
    mgr.send(receipt('T1', 1));
    mode.send(receipt('T1', 1));
    mode.send(receipt('T1', 0));
    await untilSeen(w, 3);
    receiptBufferFor(w.app).flush();
    expect(receiptEvents(w).map((e) => e.payload)).toEqual([
      { alert_id: 'T1', subject_stream_type: 'order', subject_stream_id: 'O-T1', staff_id: MGR, device_id: tab, route: 'alert_connection', step: 0 },
    ]);

    step(w, 'T1', 1, [personRow(MGR)]);
    mgr.send(receipt('T1', 1));
    await untilSeen(w, 4);
    receiptBufferFor(w.app).flush();
    expect(receiptEvents(w).at(-1)?.payload).toMatchObject({ staff_id: MGR, device_id: mgrTab, route: 'screen', step: 1 });
  });

  it('[01d §3.6] "sent" includes a device that got the alert only through alerts_open / catch-up (recordSent)', async () => {
    const w = await world(cleanups);
    const tab = device(w, 'tablet');
    seedAlerts(w, [{ id: 'C1', rows: [personRow(CASH)] }]); // Manager is in no step
    const mgr = await staffSocket(w, MGR, tab);
    mgr.send(receipt('C1'));
    await untilSeen(w, 1);
    expect(receiptBufferFor(w.app).size()).toBe(0);

    receiptBufferFor(w.app).recordSent(tab, 'C1'); // as the catch-up part (task 34) will
    mgr.send(receipt('C1'));
    await untilSeen(w, 2);
    receiptBufferFor(w.app).flush();
    expect(receiptRows(w)).toEqual([{ alert_id: 'C1', staff_id: MGR, device_id: tab, kind: 'delivered', step: 0 }]);
  });

  it('[01d RF-4] hostile receipt frames on a staff-session socket (invalid JSON, step -5, step 1e9, a 5 000-char alert_id, kind seen) → ignored, no event, the socket stays open', async () => {
    const w = await world(cleanups);
    const tab = device(w, 'tablet');
    seedAlerts(w, [{ id: 'H1', rows: [personRow(MGR)] }]);
    const ws = await staffSocket(w, MGR, tab);
    ws.raw.send('{not json');
    ws.send({ type: 'receipt', alert_id: 'H1', kind: 'delivered', step: -5 });
    ws.send({ type: 'receipt', alert_id: 'H1', kind: 'delivered', step: 1e9 });
    ws.send({ type: 'receipt', alert_id: 'H'.repeat(5_000), kind: 'delivered', step: 0 });
    ws.send({ type: 'receipt', alert_id: 'H1', kind: 'seen', step: 0 });
    ws.send(receipt('H1')); // the socket is still open and still served
    await untilSeen(w, 3); // step 1e9, the long id, the valid one: schema-valid; the rest never reach listeners
    receiptBufferFor(w.app).flush();
    expect(receiptEvents(w).map((e) => [e.payload.alert_id, e.payload.step])).toEqual([['H1', 0]]);
    await expect(ws.untilClose(100)).rejects.toThrow(/timed out/);
  });

  it('[01d RF-4] the same valid-shaped garbage on an alert-mode socket → ignored, the socket stays open (only non-receipt frames close 4401)', async () => {
    const w = await world(cleanups);
    const tab = device(w, 'tablet');
    openSession(w.hub, { kind: 'staff', staffId: MGR, deviceId: tab });
    seedAlerts(w, [{ id: 'H2', rows: [personRow(MGR)] }]);
    const mode = await alertSocket(w, tab);
    mode.send({ type: 'receipt', alert_id: 'H2', kind: 'delivered', step: -5 });
    mode.send({ type: 'receipt', alert_id: 'H2', kind: 'delivered', step: 1e9 });
    mode.send({ type: 'receipt', alert_id: 'H'.repeat(5_000), kind: 'delivered', step: 0 });
    mode.send({ type: 'receipt', alert_id: 'H2', kind: 'seen', step: 0 });
    mode.send(receipt('H2'));
    await untilSeen(w, 3);
    receiptBufferFor(w.app).flush();
    expect(receiptEvents(w).map((e) => [e.payload.alert_id, e.payload.staff_id, e.payload.step])).toEqual([['H2', MGR, 0]]);
    await expect(mode.untilClose(100)).rejects.toThrow(/timed out/);
  });

  it('[01d §3.6] statements: a receipt frame 1 read (none for a malformed one); a flush 1 read + the writer append, whatever the batch; the boot seed 1', async () => {
    const w = await world(cleanups);
    const tab = device(w, 'tablet');
    const all = ids(40, 'Q');
    seedAlerts(w, all.map((id) => ({ id, rows: [personRow(MGR)] })));
    const ws = await staffSocket(w, MGR, tab);
    const counter = statementCounter(w.hub.deps.db);
    ws.send({ type: 'receipt', alert_id: 'Q0000', kind: 'seen', step: 0 });
    ws.send(receipt(all[0] ?? ''));
    await untilSeen(w, 1);
    expect(counter.count).toBe(1);

    const flushCost = (n: number): number => {
      for (const id of all.slice(0, n)) {
        alerts.recordReceipt({ alert_id: id, staff_id: MGR, device_id: tab, kind: 'seen' });
      }
      counter.reset();
      receiptBufferFor(w.app).flush();
      return counter.count;
    };
    const checkpoints = (w.hub.deps.db.prepare('SELECT COUNT(*) AS n FROM projection_checkpoints').get() as { n: number }).n;
    const one = flushCost(1); // the delivered one plus one seen
    const many = flushCost(all.length); // 39 more seen (the first is a repeat)
    // flush: 1 subject read; the writer's own append cost: 1 seq read, 1 checkpoint upsert per projection,
    // and per event 1 events insert + 1 alert_receipts insert
    expect(one).toBe(1 + 1 + checkpoints + 2 * 2);
    expect(many).toBe(1 + 1 + checkpoints + 2 * (all.length - 1));
    expect(receiptEvents(w)).toHaveLength(1 + all.length);

    // the boot seed: 1 statement however many receipts are recorded
    counter.reset();
    createReceiptBuffer({ db: w.hub.deps.db, writer: w.hub.deps.writer, clock: w.hub.clock, log: { error: () => undefined } }).seed();
    expect(counter.count).toBe(1);
  });
});
