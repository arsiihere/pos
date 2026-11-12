import type { EngineState } from '@pos/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { stationPresence } from '../../src/kds/contracts';
import { kdsPresenceTick } from '../../src/kds/presence';
import { createPaperFallback, type PaperFallback } from '../../src/print/fallback';
import type { SendResult } from '../../src/print/transport/lan';
import { createPrintWorker, type PrintWorker, type PrinterTransport } from '../../src/print/worker';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { FX, appendOrder, append as kdsAppend, fireLines, openDay, pairKds } from '../kds/fixtures';
import { fakeClock, type FakeClock } from './fixtures';

// 03c §3.4, P4 (task c17): paper fallback over 03b's stationPresence() (b20, real tick: a paired KDS screen of S1 with
// no socket for kds_offline_ms and a line in Now → dark), run as the print worker's `pass` hook. Tests #40–#42.
// No timing asserts: the presence tick and the fallback take an injected `now`; the worker takes a fake clock.

const OFFLINE_MS = 30_000; // 01a default kds_offline_ms

let hub: TestHub;
let clock: FakeClock;
const sockets: WsClient[] = [];
const cleanups: Array<() => void> = [];

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  openDay(hub);
  clock = fakeClock();
});
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) c();
  for (const ws of sockets.splice(0)) ws.close();
  stationTokens.clear();
  swapBranchConfig(null);
  await hub.close();
});

const branch = (): string => hub.deps.config.provisioned!.branch_id;
const engine = (): EngineState => hub.deps.state.get() as EngineState;
function hubEvent(event_type: 'PrinterSaved' | 'StationOutputSet', payload: Record<string, unknown>): void {
  kdsAppend(hub, [{ stream_type: 'hub', stream_id: branch(), event_type, payload }], { actor: null });
}
function printer(printer_id: string, archived = false): void {
  hubEvent('PrinterSaved', { printer_id, name: printer_id, connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived });
}
function output(station_id: string, mode: 'screen' | 'both' | 'printer', printer_id: string | null): void {
  hubEvent('StationOutputSet', { station_id, mode, printer_id, show_taker: true, show_order_id: true });
}
function fired(id: string): string {
  const { order_id } = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: id, item_id: FX.naan, quantity: 1 }] });
  fireLines(hub, FX.station, [id]);
  return order_id;
}
const ticketOf = (order_item_id: string): string =>
  hub.deps.db.prepare('SELECT ticket_id FROM ticket_lines WHERE order_item_id = ?').pluck().get(order_item_id) as string;
const jobs = (): Array<{ job_id: string; kind: string; station_id: string | null; printer_id: string | null }> =>
  hub.deps.db.prepare('SELECT job_id, kind, station_id, printer_id FROM print_jobs ORDER BY created_at, job_id').all() as Array<{
    job_id: string;
    kind: string;
    station_id: string | null;
    printer_id: string | null;
  }>;

/** The presence tick's due at `now` (memory + 1 read; the raise intents are not needed for `dark`). */
const presenceAt = (now: number): void => {
  kdsPresenceTick.due(readOnlyDb(hub.deps.db), engine(), now);
};
/** S1's screen paired, never connected, then kds_offline_ms later: 03b reports S1 dark (a line must be in Now). */
function goDark(): { since: number } {
  const since = hub.clock.branchNow();
  presenceAt(since);
  presenceAt(since + OFFLINE_MS);
  expect(stationPresence().get(FX.station)).toMatchObject({ dark: true, offline_since: since });
  return { since };
}
const stationTokens = new Map<string, string>();
async function screenBack(kds: { deviceId: string; token: string }, at = hub.clock.branchNow() + OFFLINE_MS + 1): Promise<WsClient> {
  let token = stationTokens.get(kds.deviceId); // a reconnect reuses the device's open station session
  if (token === undefined) {
    token = openSession(hub, { kind: 'station', deviceId: kds.deviceId, stationId: FX.station }).token;
    stationTokens.set(kds.deviceId, token);
  }
  const ws = await connectWs(hub.app);
  sockets.push(ws);
  ws.send({ type: 'auth', device_token: kds.token, session_token: token });
  await ws.untilCount(1);
  presenceAt(at);
  expect(stationPresence().get(FX.station)?.dark).toBe(false);
  return ws;
}

function fallback(): PaperFallback {
  return createPaperFallback({ db: hub.deps.db, state: hub.deps.state });
}

/** A transport the test settles by hand. */
function scripted(): PrinterTransport & { sends: string[]; settle(r: SendResult): void; pending(): number } {
  const waiting: Array<(r: SendResult) => void> = [];
  const t = {
    sends: [] as string[],
    send(bytes: Uint8Array) {
      t.sends.push(Buffer.from(bytes).toString('latin1'));
      return new Promise<SendResult>((resolve) => waiting.push(resolve));
    },
    settle(r: SendResult) {
      const next = waiting.shift();
      if (next === undefined) throw new Error('nothing in flight');
      next(r);
    },
    pending: () => waiting.length,
    close: () => undefined,
  };
  return t;
}
function worker(t: PrinterTransport, fb: PaperFallback): PrintWorker {
  // the fallback runs as the worker's `pass` hook with the worker's `now` (hub clock)
  const w = createPrintWorker({ db: hub.deps.db, state: hub.deps.state, clock: hub.clock, timers: clock, transportFor: () => t, hooks: { pass: (now) => fb.pass(now) } });
  cleanups.push(() => w.stop());
  return w;
}
const turns = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};
const OK: SendResult = { ok: true };

describe('[03c §3.4] paper fallback (c17)', () => {
  it('[03c #40] screen + printer, 03b marks dark: Now tickets + one COMING UP; new fires print; screen back → stop, nothing cancelled', async () => {
    const kds = pairKds(hub, { stationId: FX.station });
    printer('PR1');
    output(FX.station, 'screen', 'PR1');
    fired('A1');
    fired('B1');
    expect(jobs()).toEqual([]); // screen: nothing at fire
    const { since } = goDark();
    const fb = fallback();
    fb.pass(since + OFFLINE_MS);
    const a = `${ticketOf('A1')}:kitchen`;
    const b = `${ticketOf('B1')}:kitchen`;
    const cu = `${FX.station}:coming_up:${since}`;
    // station jobs (printer_id NULL): they follow the station's current printer at send (§3.2); COMING UP last
    expect(jobs()).toEqual([
      { job_id: a, kind: 'kitchen', station_id: FX.station, printer_id: null },
      { job_id: b, kind: 'kitchen', station_id: FX.station, printer_id: null },
      { job_id: cu, kind: 'coming_up', station_id: FX.station, printer_id: null },
    ]);
    // the next loops of the same outage add nothing: one COMING UP per outage, one live kitchen job per ticket
    fb.pass(since + OFFLINE_MS + 1_000);
    fb.pass(since + OFFLINE_MS + 2_000);
    expect(jobs()).toHaveLength(3);
    // a new fire while dark prints at the next loop
    fired('C1');
    presenceAt(since + OFFLINE_MS + 5_000);
    fb.pass(since + OFFLINE_MS + 5_000);
    expect(jobs().map((j) => j.job_id)).toContain(`${ticketOf('C1')}:kitchen`);
    expect(jobs()).toHaveLength(4);
    // the worker prints them on the station's printer
    const t = scripted();
    const w = worker(t, fb);
    w.pass();
    expect(t.sends[0]).toContain('1 x Naan');
    t.settle(OK);
    await turns();
    expect(hub.deps.db.prepare('SELECT sent_printer_id FROM print_jobs WHERE job_id = ?').pluck().get(a)).toBe('PR1');
    // screen back: stop; nothing printed or pending is cancelled
    await screenBack(kds);
    expect(fb.active().has(FX.station)).toBe(true);
    fired('D1');
    fb.pass(hub.clock.branchNow());
    expect(fb.active().has(FX.station)).toBe(false); // print.fallback.end
    expect(jobs().map((j) => j.job_id)).not.toContain(`${ticketOf('D1')}:kitchen`);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM print_jobs WHERE cancelled_at IS NOT NULL').pluck().get()).toBe(0);
  });

  it('[03c #40] a new outage prints a new COMING UP; tickets already printed are not printed again', () => {
    pairKds(hub, { stationId: FX.station });
    printer('PR1');
    output(FX.station, 'screen', 'PR1');
    fired('A1');
    const first = goDark();
    const fb = fallback();
    fb.pass(first.since + OFFLINE_MS);
    hub.deps.db.prepare('UPDATE print_jobs SET sent_at = ?, acked_at = ?').run(first.since, first.since); // printed
    // a later outage (offline_since moves): one more COMING UP, no second kitchen job for the printed ticket
    fb.pass(first.since + OFFLINE_MS + 1);
    const later = first.since + 600_000; // more than 5 min after the first COMING UP (C4-1)
    createPaperFallback({ db: hub.deps.db, state: hub.deps.state, presence: () => new Map([[FX.station, { screenless: false, connected: false, offline_since: later, dark: true }]]) }).pass(later + OFFLINE_MS);
    expect(jobs().map((j) => j.job_id)).toEqual([`${ticketOf('A1')}:kitchen`, `${FX.station}:coming_up:${first.since}`, `${FX.station}:coming_up:${later}`]);
  });

  it('[03c §3.4, C4-1] drop, back, drop within 5 min → one COMING UP; a drop after 5 min → a second', async () => {
    const kds = pairKds(hub, { stationId: FX.station });
    printer('PR1');
    output(FX.station, 'screen', 'PR1');
    fired('A1');
    const { since } = goDark();
    const fb = fallback();
    fb.pass(since + OFFLINE_MS);
    const comingUp = (): string[] => jobs().filter((j) => j.kind === 'coming_up').map((j) => j.job_id);
    expect(comingUp()).toEqual([`${FX.station}:coming_up:${since}`]);
    /** the screen comes back at `back`, drops at `drop`; dark kds_offline_ms later; one fallback pass then */
    const outage = async (back: number, drop: number): Promise<void> => {
      const ws = await screenBack(kds, back);
      fb.pass(back);
      ws.close();
      await new Promise((resolve) => setTimeout(resolve, 30));
      presenceAt(drop);
      presenceAt(drop + OFFLINE_MS);
      expect(stationPresence().get(FX.station)).toMatchObject({ dark: true, offline_since: drop });
      fb.pass(drop + OFFLINE_MS);
    };
    await outage(since + 60_000, since + 90_000); // second outage 1.5 min later: no COMING UP
    expect(comingUp()).toEqual([`${FX.station}:coming_up:${since}`]);
    await outage(since + 400_000, since + 420_000); // third outage ~7 min after the first COMING UP: a second one
    expect(comingUp()).toEqual([`${FX.station}:coming_up:${since}`, `${FX.station}:coming_up:${since + 420_000}`]);
  });

  it('[03c #6, §3.3, §3.4] Done before send → empty cancel; held (no row per loop) until UndoDone → ticket_id:kitchen:2, once', () => {
    pairKds(hub, { stationId: FX.station });
    printer('PR1');
    output(FX.station, 'screen', 'PR1');
    const a = fired('A1');
    const { since } = goDark();
    const fb = fallback();
    fb.pass(since + OFFLINE_MS);
    const ticket = ticketOf('A1');
    const kitchen = (): string[] => jobs().filter((j) => j.kind === 'kitchen').map((j) => j.job_id).sort();
    const emptyCancel = (job_id: string): void => {
      hub.deps.db.prepare(`UPDATE print_jobs SET cancelled_at = ?, last_error = 'empty' WHERE job_id = ?`).run(hub.clock.branchNow(), job_id);
    };
    kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'ItemDone', payload: { order_item_id: 'A1', done_at: hub.clock.branchNow(), source: 'tap' } }]);
    emptyCancel(`${ticket}:kitchen`); // the worker's empty render at send (the line is done)
    fb.pass(hub.clock.branchNow());
    expect(kitchen()).toEqual([`${ticket}:kitchen`]);
    kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'ItemDoneUndone', payload: { order_item_id: 'A1' } }]);
    fb.pass(hub.clock.branchNow());
    expect(kitchen()).toEqual([`${ticket}:kitchen`, `${ticket}:kitchen:2`]);
    // the re-created one renders empty again (no change since): held, never a new row per loop
    hub.clock.advance(1_000);
    emptyCancel(`${ticket}:kitchen:2`);
    for (let i = 1; i <= 5; i += 1) fb.pass(hub.clock.branchNow() + i * 1_000);
    expect(kitchen()).toEqual([`${ticket}:kitchen`, `${ticket}:kitchen:2`]);
  });

  it('[03c §3.3, §3.4] render_failed is held the same way; a manager-cancelled kitchen job is re-created at once', () => {
    pairKds(hub, { stationId: FX.station });
    printer('PR1');
    output(FX.station, 'screen', 'PR1');
    fired('A1');
    const { since } = goDark();
    const fb = fallback();
    fb.pass(since + OFFLINE_MS);
    const ticket = ticketOf('A1');
    hub.clock.advance(1_000);
    hub.deps.db.prepare(`UPDATE print_jobs SET cancelled_at = ?, last_error = 'render_failed' WHERE job_id = ?`).run(hub.clock.branchNow(), `${ticket}:kitchen`);
    fb.pass(since + OFFLINE_MS + 1_000);
    fb.pass(since + OFFLINE_MS + 2_000);
    expect(jobs().filter((j) => j.kind === 'kitchen')).toHaveLength(1);
    hub.deps.db.prepare(`UPDATE print_jobs SET last_error = NULL WHERE job_id = ?`).run(`${ticket}:kitchen`); // a manager cancel (c19)
    fb.pass(since + OFFLINE_MS + 3_000);
    expect(jobs().filter((j) => j.kind === 'kitchen').map((j) => j.job_id)).toEqual([`${ticket}:kitchen`, `${ticket}:kitchen:2`]);
  });

  it('[03c §3.3] the re-created id takes MAX(existing suffix) + 1, not a count (a missing :kitchen:2 never makes it collide)', () => {
    pairKds(hub, { stationId: FX.station });
    printer('PR1');
    output(FX.station, 'screen', 'PR1');
    fired('A1');
    const ticket = ticketOf('A1');
    const ins = hub.deps.db.prepare(
      `INSERT INTO print_jobs (job_id, kind, station_id, ticket_id, payload, created_at, cancelled_at) VALUES (?, 'kitchen', ?, ?, '{}', 1, 1)`,
    );
    ins.run(`${ticket}:kitchen`, FX.station, ticket);
    ins.run(`${ticket}:kitchen:3`, FX.station, ticket); // :kitchen:2 is gone (count = 2 → would collide with :kitchen:3)
    const { since } = goDark();
    fallback().pass(since + OFFLINE_MS);
    expect(jobs().filter((j) => j.kind === 'kitchen').map((j) => j.job_id)).toEqual([`${ticket}:kitchen`, `${ticket}:kitchen:3`, `${ticket}:kitchen:4`]);
  });

  it('[03c §3.4 steps 1, 4] no paper unless mode screen with an active printer: no printer, an archived one, or both / printer', () => {
    pairKds(hub, { stationId: FX.station });
    fired('A1');
    const { since } = goDark();
    const fb = fallback();
    fb.pass(since + OFFLINE_MS); // no output row: screen without a printer → 03b's takeover only
    expect(jobs()).toEqual([]);
    printer('PR1');
    output(FX.station, 'both', 'PR1'); // prints at fire (c7), the fallback adds nothing
    fb.pass(since + OFFLINE_MS + 1);
    expect(jobs()).toEqual([]);
    output(FX.station, 'screen', 'PR1');
    printer('PR1', true); // archived
    fb.pass(since + OFFLINE_MS + 2);
    expect(jobs()).toEqual([]);
    expect(fb.active().size).toBe(0);
  });

  it('[03c #41] slow printer (5 s per job) during 10 s dark → one kitchen job per ticket', async () => {
    pairKds(hub, { stationId: FX.station });
    printer('PR1');
    output(FX.station, 'screen', 'PR1');
    fired('A1');
    fired('B1');
    const { since } = goDark();
    const fb = fallback();
    const t = scripted();
    const w = worker(t, fb);
    // the worker's loop for 10 s; each send takes 5 s (settled by hand after 5 loops)
    let now = since + OFFLINE_MS;
    for (let s = 0; s < 10; s += 1) {
      fb.pass(now);
      w.pass();
      if (s % 5 === 4 && t.pending() > 0) {
        t.settle(OK);
        await turns();
      }
      now += 1_000;
    }
    const kitchen = jobs().filter((j) => j.kind === 'kitchen');
    expect(kitchen.map((j) => j.job_id).sort()).toEqual([`${ticketOf('A1')}:kitchen`, `${ticketOf('B1')}:kitchen`].sort());
    expect(jobs().filter((j) => j.kind === 'coming_up')).toHaveLength(1);
  });

  it('[03c #42] idle loop statements ≤ 2 + 1 per dark station (worker 1 + fallback 0 idle, 1 per dark station)', () => {
    pairKds(hub, { stationId: FX.station });
    printer('PR1');
    output(FX.station, 'screen', 'PR1');
    const fb = fallback();
    const w = worker(scripted(), fb);
    const counter = statementCounter(hub.deps.db);
    w.pass(); // nothing dark, nothing pending
    expect(counter.count).toBeLessThanOrEqual(2);
    const idle = counter.count;
    fired('A1');
    const { since } = goDark();
    fb.pass(since + OFFLINE_MS); // first loop of the outage queues the jobs
    hub.deps.db.prepare('UPDATE print_jobs SET sent_at = 1, acked_at = 1').run(); // all printed: nothing pending, nothing to add
    counter.reset();
    w.pass(); // one dark station, nothing new to insert
    expect(counter.count).toBe(idle + 1);
    expect(counter.count).toBeLessThanOrEqual(2 + 1);
  });
});
