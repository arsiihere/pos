import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import type { SendResult } from '../../src/print/transport/lan';
import {
  PRINTER_ALERT_MS,
  STATUS_INTERVAL_MS,
  STATUS_TIMEOUT_MS,
  createPrintStatus,
  markSuspects,
  parseStatus,
  readLanStatus,
  recoverSuspects,
  type PrintStatus,
  type PrinterStatus,
} from '../../src/print/status';
import { createPrintWorker, type PrintWorker, type PrinterTransport } from '../../src/print/worker';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { FX, appendOrder, append as kdsAppend, fireLines, openDay, removeLine } from '../kds/fixtures';
import { STATUS, fakeClock, fakeLanPrinter, type FakeClock } from './fixtures';

// 03c §3.5, §3.7, D4, §6.10 (task c15): status reads, suspect marking and recovery, printer_problem. Real tables,
// real events through the hub writer, real 01d alerts; the status read and the transport are injected where a test
// scripts them. No timing asserts: the hub clock and the fake timers are advanced by the test.
let hub: TestHub;
let clock: FakeClock;
const cleanups: Array<() => Promise<void> | void> = [];

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  openDay(hub);
  clock = fakeClock();
});
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  swapBranchConfig(null);
  await hub.close();
});

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition never held');
}
const turns = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const branch = (): string => hub.deps.config.provisioned!.branch_id;
const now = (): number => hub.clock.branchNow();
function hubEvent(event_type: 'PrinterSaved' | 'StationOutputSet', payload: Record<string, unknown>): void {
  kdsAppend(hub, [{ stream_type: 'hub', stream_id: branch(), event_type, payload }], { actor: null });
}
function printer(printer_id: string, o: { address?: string; connection?: 'lan' | 'usb'; archived?: boolean } = {}): void {
  hubEvent('PrinterSaved', {
    printer_id,
    name: `Printer ${printer_id}`,
    connection: o.connection ?? 'lan',
    address: o.address ?? (o.connection === 'usb' ? '/dev/usb/lp0' : '192.168.1.50:9100'),
    paper_width_mm: 80,
    archived: o.archived ?? false,
  });
}
function output(station_id: string, mode: 'screen' | 'both' | 'printer', printer_id: string | null): void {
  hubEvent('StationOutputSet', { station_id, mode, printer_id, show_taker: true, show_order_id: true });
}
function order(prefix: string, lines: Array<{ n: number; quantity?: number }>): string {
  return appendOrder(hub, {
    order_type: 'takeaway',
    lines: lines.map((l) => ({ order_item_id: `${prefix}${l.n}`, item_id: FX.naan, quantity: l.quantity ?? 1 })),
  }).order_id;
}
const ticketOf = (order_item_id: string) =>
  hub.deps.db.prepare('SELECT ticket_id FROM ticket_lines WHERE order_item_id = ?').pluck().get(order_item_id) as string;
/** the worker's send + ack of a job on the real row, at `at` */
function acked(job_id: string, at: number, printer_id = 'PR1'): void {
  hub.deps.db.prepare('UPDATE print_jobs SET sent_at = ?, sent_printer_id = ?, acked_at = ? WHERE job_id = ?').run(at, printer_id, at, job_id);
}
const suspects = () =>
  hub.deps.db.prepare('SELECT job_id FROM print_jobs WHERE suspect_at IS NOT NULL AND suspect_resolved_at IS NULL ORDER BY job_id').pluck().all() as string[];
const recoveries = () =>
  (hub.deps.db.prepare(`SELECT job_id, kind, ticket_id, payload, is_reprint FROM print_jobs WHERE job_id LIKE '%:recover:%' ORDER BY job_id`).all() as Array<{
    job_id: string;
    kind: string;
    ticket_id: string;
    payload: string;
    is_reprint: number;
  }>).map((r) => ({ ...r, payload: JSON.parse(r.payload) as Record<string, unknown> }));
const runtime = (printer_id = 'PR1') =>
  hub.deps.db.prepare('SELECT supports_status, last_status, last_status_at, last_clean_at, problem_alert_id FROM printer_runtime WHERE printer_id = ?').get(printer_id) as
    | { supports_status: number | null; last_status: string | null; last_status_at: number | null; last_clean_at: number | null; problem_alert_id: string | null }
    | undefined;
const problems = () =>
  (hub.deps.db.prepare(`SELECT alert_id, state, close_reason, values_json, details_json, dedupe_key FROM alerts WHERE kind = 'printer_problem' ORDER BY raised_at, alert_id`).all() as Array<{
    alert_id: string;
    state: string;
    close_reason: string | null;
    values_json: string;
    details_json: string;
    dedupe_key: string;
  }>).map((a) => ({ ...a, values: JSON.parse(a.values_json) as unknown, details: JSON.parse(a.details_json) as unknown }));

function statusOf(o: { readStatus?: (p: { printer_id: string }) => Promise<PrinterStatus> } = {}): PrintStatus {
  const s = createPrintStatus({ db: hub.deps.db, writer: hub.deps.writer, clock: hub.clock, branch_id: branch(), timers: clock, readStatus: o.readStatus });
  cleanups.push(() => s.stop());
  return s;
}

/** three printed tickets at FX.station (output both, PR1); returns their kitchen job ids */
function threeTickets(): string[] {
  printer('PR1');
  output(FX.station, 'both', 'PR1');
  const ids: string[] = [];
  for (const p of ['A', 'B', 'C']) {
    order(p, [{ n: 1 }]);
    fireLines(hub, FX.station, [`${p}1`]);
    ids.push(`${ticketOf(`${p}1`)}:kitchen`);
  }
  return ids;
}

describe('[03c §3.7] status reads', () => {
  it('[03c §3.6] DLE EOT 1 bit 3 → offline; DLE EOT 4 bits 5/6 → paper_out; no answer → unknown', () => {
    expect(parseStatus(STATUS.online, STATUS.online)).toBe('clean');
    expect(parseStatus(STATUS.offline, STATUS.online)).toBe('offline');
    expect(parseStatus(STATUS.online, STATUS.paperOut)).toBe('paper_out');
    expect(parseStatus(STATUS.online, 0x12 | 0x0c)).toBe('clean'); // near end is not an error
    expect(parseStatus(null, STATUS.online)).toBe('unknown');
  });

  it('[03c §3.7] LAN read over its own socket: the fake printer answers; a silent printer → unknown at the 2 s timeout', async () => {
    const p = await fakeLanPrinter();
    cleanups.push(() => p.close());
    expect(await readLanStatus(p.address, { timers: clock })).toBe('clean');
    expect([...p.received()]).toEqual([0x10, 0x04, 0x01, 0x10, 0x04, 0x04]);
    p.setStatus(STATUS.paperOut);
    expect(await readLanStatus(p.address, { timers: clock })).toBe('paper_out');
    p.setStatus(null);
    let result: PrinterStatus | undefined;
    const silent = readLanStatus(p.address, { timers: clock }).then((r) => (result = r));
    await until(() => p.receivedLength() >= 18);
    clock.advance(STATUS_TIMEOUT_MS - 1);
    await turns();
    expect(result).toBeUndefined();
    clock.advance(1);
    await silent;
    expect(result).toBe('unknown');
    expect(clock.pending()).toBe(0);
  });
});

describe('[03c #25] suspect window', () => {
  it('[03c #25] clean read → 3 jobs acked → paper-end read → all 3 suspect (1 statement)', () => {
    const ids = threeTickets();
    const s = statusOf();
    const t0 = now();
    s.applyStatus('PR1', 'clean', t0);
    expect(runtime()).toMatchObject({ last_status: 'clean', last_clean_at: t0 - 10_000, supports_status: 1 });
    ids.forEach((id, i) => acked(id, t0 + 20_000 + i));
    s.applyStatus('PR1', 'paper_out', t0 + 40_000);
    expect(suspects()).toEqual([...ids].sort());
    // the rule itself is one statement
    hub.deps.db.prepare('UPDATE print_jobs SET suspect_at = NULL').run();
    const counter = statementCounter(hub.deps.db);
    expect(markSuspects(hub.deps.db, 'PR1', t0 + 41_000)).toBe(3);
    expect(counter.count).toBe(1);
  });

  it('[03c #25] no clean read yet (new printer) → jobs acked → paper-end read → all suspect', () => {
    const ids = threeTickets();
    ids.forEach((id, i) => acked(id, now() + i));
    statusOf().applyStatus('PR1', 'paper_out', now() + 10);
    expect(suspects()).toEqual([...ids].sort());
  });

  it('[03c #25] clean read 2 s after an ack keeps that job in the window; paper-end 5 s later → suspect; clean never moves last_clean_at back', () => {
    const [a, b] = threeTickets();
    const s = statusOf();
    const t = now();
    acked(a!, t - 60_000);
    s.applyStatus('PR1', 'clean', t - 30_000); // clears a (acked 20 s before the clean point)
    acked(b!, t);
    s.applyStatus('PR1', 'clean', t + 2_000);
    expect(runtime()!.last_clean_at).toBe(t - 8_000);
    s.applyStatus('PR1', 'clean', t - 50_000); // an older reading arriving late: never backwards
    expect(runtime()!.last_clean_at).toBe(t - 8_000);
    s.applyStatus('PR1', 'paper_out', t + 7_000);
    expect(suspects()).toEqual([b]);
  });

  it('[03c #25] clean again → one REPRINT per ticket with a live line; done ticket skipped; lost CANCELLED comes back as CANCELLED; two suspects on one ticket → one job', () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    const a = order('A', [{ n: 1, quantity: 4 }]);
    const b = order('B', [{ n: 1 }]);
    const c = order('C', [{ n: 1, quantity: 2 }, { n: 2 }]);
    fireLines(hub, FX.station, ['A1']);
    fireLines(hub, FX.station, ['B1']);
    fireLines(hub, FX.station, ['C1', 'C2']);
    const [ta, tb, tc] = [ticketOf('A1'), ticketOf('B1'), ticketOf('C1')];
    const s = statusOf();
    s.applyStatus('PR1', 'clean', now() - 100_000);
    acked(`${ta}:kitchen`, now());
    acked(`${tb}:kitchen`, now());
    acked(`${tc}:kitchen`, now());
    // C: the kitchen ticket and a later CANCELLED slip for C1 are both suspect → one REPRINT (it shows the units left)
    const [removed] = removeLine(hub, a, 'A1', 1); // A's slip
    const aSlip = `${removed!.event_id}:cancel:1`;
    // A's ticket: only its cancel slip is suspect (the kitchen ticket printed before the last clean read)
    hub.deps.db.prepare('UPDATE print_jobs SET acked_at = ? WHERE job_id = ?').run(now() - 200_000, `${ta}:kitchen`);
    acked(aSlip, now());
    const [removedC] = removeLine(hub, c, 'C1', 1);
    acked(`${removedC!.event_id}:cancel:1`, now() + 1);
    // B's line done: its ticket is not reprinted
    kdsAppend(hub, [{ stream_type: 'order', stream_id: b, event_type: 'ItemDone', payload: { order_item_id: 'B1', done_at: now(), source: 'tap' } }]);
    s.applyStatus('PR1', 'paper_out', now() + 2);
    expect(suspects().sort()).toEqual([aSlip, `${removedC!.event_id}:cancel:1`, `${tb}:kitchen`, `${tc}:kitchen`].sort());
    s.applyStatus('PR1', 'clean', now() + 3);
    const clean = runtime()!.last_clean_at!;
    expect(recoveries()).toEqual(
      [
        { job_id: `${ta}:recover:${clean}`, kind: 'cancel', ticket_id: ta, payload: { ticket_id: ta, order_item_id: 'A1', units: 1 }, is_reprint: 1 },
        { job_id: `${tc}:recover:${clean}`, kind: 'reprint', ticket_id: tc, payload: { ticket_id: tc }, is_reprint: 1 },
      ].sort((x, y) => x.job_id.localeCompare(y.job_id)),
    );
    expect(suspects()).toEqual([]);
    // INSERT OR IGNORE: the same recovery twice → still one job per ticket
    expect(recoverSuspects(hub.deps.db, 'PR1', now() + 4)).toEqual({ queued: 0, resolved: 0 });
  });

  it('[03c #25, #4b] a lost MOVED TO STOCK slip comes back as a MOVED TO STOCK slip with the REPRINT header (the recovery copies the payload, 04 Q-15)', async () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    const a = order('A', [{ n: 1, quantity: 4 }]);
    fireLines(hub, FX.station, ['A1']);
    const ta = ticketOf('A1');
    const s = statusOf();
    hub.deps.db.prepare('UPDATE print_jobs SET sent_at = ?, sent_printer_id = ?, acked_at = ? WHERE job_id = ?').run(now() - 200_000, 'PR1', now() - 200_000, `${ta}:kitchen`);
    s.applyStatus('PR1', 'clean', now() - 100_000);
    const [v] = kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'ItemVoided', payload: { order_item_id: 'A1', units: 2, disposition: 'moved' } }], { actor: 'S_MGR' });
    const slip = `${v!.event_id}:cancel:1`;
    acked(slip, now());
    s.applyStatus('PR1', 'paper_out', now() + 1);
    expect(suspects()).toEqual([slip]);
    s.applyStatus('PR1', 'clean', now() + 2);
    const clean = runtime()!.last_clean_at!;
    expect(recoveries()).toEqual([
      { job_id: `${ta}:recover:${clean}`, kind: 'cancel', ticket_id: ta, payload: { ticket_id: ta, order_item_id: 'A1', units: 2, slip: 'moved' }, is_reprint: 1 },
    ]);
    // the real worker sends the recovery job: REPRINT header + the MOVED TO STOCK slip, not CANCELLED
    const sent: string[] = [];
    workerWith(s, { send: (bytes) => (sent.push(Buffer.from(bytes).toString('latin1')), Promise.resolve({ ok: true })), close: () => undefined }).pass();
    await turns();
    expect(sent).toHaveLength(1);
    const printedLines = sent[0]!.split('\n');
    expect(printedLines.some((l) => l.endsWith('** REPRINT **'))).toBe(true);
    expect(printedLines.some((l) => l.endsWith('MOVED TO STOCK - FINISH & KEEP'))).toBe(true);
    expect(printedLines.some((l) => l.endsWith('#1  - 2 x Naan  2 left'))).toBe(true);
    expect(sent[0]).not.toContain('CANCELLED');
    expect(hub.deps.db.prepare('SELECT acked_at FROM print_jobs WHERE job_id = ?').pluck().get(`${ta}:recover:${clean}`)).not.toBeNull();
  });

  it('[03c #25, review] recovery does not depend on the reading before: bad → unknown → clean recovers all 3', () => {
    const ids = threeTickets();
    const s = statusOf();
    ids.forEach((id) => acked(id, now()));
    s.applyStatus('PR1', 'paper_out', now() + 1);
    expect(suspects()).toHaveLength(3);
    s.applyStatus('PR1', 'unknown', now() + 2);
    expect(recoveries()).toEqual([]);
    s.applyStatus('PR1', 'clean', now() + 3);
    expect(recoveries().map((r) => r.kind)).toEqual(['reprint', 'reprint', 'reprint']);
    expect(suspects()).toEqual([]);
  });

  it('[03c #25, review] reading, marking and recovery are one transaction: a crash inside leaves the old status and the suspects; the next clean reading recovers them', () => {
    const ids = threeTickets();
    const s = statusOf();
    ids.forEach((id) => acked(id, now()));
    s.applyStatus('PR1', 'paper_out', now() + 1);
    hub.deps.db.exec(`CREATE TRIGGER crash BEFORE INSERT ON print_jobs WHEN NEW.job_id LIKE '%:recover:%' BEGIN SELECT RAISE(ABORT, 'power cut'); END`);
    expect(() => s.applyStatus('PR1', 'clean', now() + 2)).toThrow(/power cut/);
    expect(runtime()).toMatchObject({ last_status: 'paper_out' });
    expect(suspects()).toHaveLength(3);
    hub.deps.db.exec('DROP TRIGGER crash');
    s.applyStatus('PR1', 'clean', now() + 3);
    expect(recoveries()).toHaveLength(3);
    expect(suspects()).toEqual([]);
    expect(runtime()).toMatchObject({ last_status: 'clean' });
  });

  it('[03c #25, C3-2] a suspect kitchen ticket + a suspect FIRST slip → one REPRINT and the FIRST slip again; a FIRST whose lines are done → REPRINT only', () => {
    printer('PR1');
    output(FX.station, 'printer', 'PR1');
    const a = order('A', [{ n: 1 }, { n: 2 }]);
    const b = order('B', [{ n: 1 }, { n: 2 }]);
    fireLines(hub, FX.station, ['A1', 'A2']);
    fireLines(hub, FX.station, ['B1', 'B2']);
    const [ta, tb] = [ticketOf('A1'), ticketOf('B1')];
    acked(`${ta}:kitchen`, now());
    acked(`${tb}:kitchen`, now());
    const [boostA] = kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'OrderBoosted', payload: { order_id: a } }], { actor: 'S_MGR' });
    // B: only B1 is expedited (its FIRST names B1); B1 is done before the paper comes back, B2 is not
    const [expB] = kdsAppend(hub, [{ stream_type: 'order', stream_id: b, event_type: 'ItemsReleased', payload: { order_id: b, alert_id: null, released: [], expedite: ['B1'] } }], { actor: 'S_MGR' });
    acked(`${boostA!.event_id}:first:1`, now());
    acked(`${expB!.event_id}:first:1`, now());
    kdsAppend(hub, [{ stream_type: 'order', stream_id: b, event_type: 'ItemDone', payload: { order_item_id: 'B1', done_at: now(), source: 'tap' } }]);
    const s = statusOf();
    s.applyStatus('PR1', 'paper_out', now() + 1);
    s.applyStatus('PR1', 'clean', now() + 2);
    const clean = runtime()!.last_clean_at!;
    expect(recoveries().map((r) => [r.job_id, r.kind, r.payload])).toEqual(
      [
        [`${ta}:recover:${clean}`, 'reprint', { ticket_id: ta }],
        [`${ta}:recover:first:${clean}`, 'first', { ticket_id: ta, order_item_ids: ['A1', 'A2'], reason: 'boost' }],
        [`${tb}:recover:${clean}`, 'reprint', { ticket_id: tb }],
      ].sort((x, y) => (x[0] as string).localeCompare(y[0] as string)),
    );
    expect(suspects()).toEqual([]);
  });

  it('[03c #26] unknown-status printer: never suspect; supports_status stays unknown', () => {
    const ids = threeTickets();
    ids.forEach((id) => acked(id, now()));
    statusOf().applyStatus('PR1', 'unknown', now() + 1);
    expect(suspects()).toEqual([]);
    expect(runtime()).toMatchObject({ supports_status: null, last_status: 'unknown' });
  });
});

/** A transport the test settles by hand. */
function scripted(): PrinterTransport & { settle(r: SendResult): void; pending(): number } {
  const waiting: Array<(r: SendResult) => void> = [];
  return {
    send: () => new Promise<SendResult>((resolve) => waiting.push(resolve)),
    settle(r) {
      waiting.shift()!(r);
    },
    pending: () => waiting.length,
    close: () => undefined,
  };
}
const TIMEOUT: SendResult = { ok: false, error: 'write_timeout', detail: null, wrote: false };

function workerWith(s: PrintStatus, t: PrinterTransport): PrintWorker {
  const w = createPrintWorker({ db: hub.deps.db, state: hub.deps.state, clock: hub.clock, timers: clock, transportFor: () => t, hooks: s.hooks });
  cleanups.push(() => w.stop());
  return w;
}

describe('[03c §3.7, §6.10] printer_problem', () => {
  it('[03c #21] head job failing: retries, printer_problem not_printing once it has failed for 30 s; closed done at the next ack (status unknown)', async () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    order('A', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    const reads: string[] = [];
    const s = statusOf({ readStatus: async (p) => (reads.push(p.printer_id), 'unknown') });
    const t = scripted();
    const w = workerWith(s, t);
    w.pass();
    hub.clock.advance(10_000); // the hard write timer
    t.settle(TIMEOUT);
    await turns();
    expect(reads).toEqual([]);
    w.pass(); // the next loop pass (≤ 1 s): a read right after the failure, though nothing was acked
    await turns();
    expect(reads).toEqual(['PR1']);
    let failedFor = 0;
    while (failedFor < PRINTER_ALERT_MS - 1_000) {
      hub.clock.advance(1_000);
      failedFor += 1_000;
      clock.advance(10_000); // retries (2 s, 5 s, then every 10 s)
      await turns();
      if (t.pending() > 0) {
        t.settle(TIMEOUT);
        await turns();
      }
      w.pass();
    }
    expect(problems()).toEqual([]);
    hub.clock.advance(1_000);
    w.pass();
    expect(problems()).toMatchObject([
      { state: 'open', dedupe_key: 'printer_problem:PR1', values: { printer_id: 'PR1', waiting: 1 }, details: { printer_name: 'Printer PR1', problem: 'not_printing' } },
    ]);
    expect(runtime()!.problem_alert_id).toBe(problems()[0]!.alert_id);
    clock.advance(10_000);
    await turns();
    t.settle({ ok: true });
    await turns();
    expect(problems()).toMatchObject([{ state: 'closed', close_reason: 'done' }]);
    expect(runtime()!.problem_alert_id).toBeNull();
  });

  it('[03c §3.7, review] the failing timer stops when its job is no longer pending or nothing waits; no not_printing then, nor after a manager close with nothing waiting', async () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    order('A', [{ n: 1 }]);
    order('B', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    const a = `${ticketOf('A1')}:kitchen`;
    const s = statusOf({ readStatus: async () => 'unknown' });
    const job = (job_id: string) => ({ job_id, kind: 'kitchen', printer_id: 'PR1', station_id: FX.station, ticket_id: null });
    s.hooks.failed(job(a), TIMEOUT, now());
    // a manager cancels the failing job; B is still waiting behind it
    hub.deps.db.prepare('UPDATE print_jobs SET cancelled_at = ? WHERE job_id = ?').run(now(), a);
    fireLines(hub, FX.station, ['B1']);
    s.hooks.pass(now() + 1); // the timer for A stops here
    s.hooks.pass(now() + PRINTER_ALERT_MS + 1);
    await turns();
    expect(problems()).toEqual([]);
    // B fails for 30 s → raised; a manager closes it; B is cancelled too: nothing waits → never raised again
    const b = `${ticketOf('B1')}:kitchen`;
    s.hooks.failed(job(b), TIMEOUT, now());
    s.hooks.pass(now() + PRINTER_ALERT_MS);
    expect(problems()).toMatchObject([{ state: 'open', details: { problem: 'not_printing' } }]);
    hub.deps.writer.run((tx) => {
      tx.append(alerts.closeMany(alerts.tickCtx(tx, now()), [{ alert_id: problems()[0]!.alert_id, reason: 'done' }]));
    });
    hub.deps.db.prepare('UPDATE print_jobs SET cancelled_at = ? WHERE job_id = ?').run(now(), b);
    s.hooks.pass(now() + PRINTER_ALERT_MS + 1);
    s.hooks.pass(now() + 2 * PRINTER_ALERT_MS);
    await turns();
    expect(problems()).toMatchObject([{ state: 'closed' }]);
  });

  it('[03c §3.7] a status error bit → printer_problem paper_out at once; stays open while bad; obsolete once clean and nothing is pending', async () => {
    printer('PR1');
    const s = statusOf();
    s.applyStatus('PR1', 'paper_out', now());
    expect(problems()).toMatchObject([{ state: 'open', details: { problem: 'paper_out' }, values: { waiting: 0 } }]);
    s.hooks.pass(now());
    expect(problems()).toMatchObject([{ state: 'open' }]);
    s.applyStatus('PR1', 'clean', now() + 1);
    s.hooks.pass(now() + 2);
    expect(problems()).toMatchObject([{ state: 'closed', close_reason: 'obsolete' }]);
  });

  it('[03c §3.7] a pending job keeps the problem open after a clean read until its ack; archive → obsolete', () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    order('A', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    const s = statusOf();
    s.applyStatus('PR1', 'offline', now());
    s.applyStatus('PR1', 'clean', now() + 1);
    s.hooks.pass(now() + 2);
    expect(problems()).toMatchObject([{ state: 'open', details: { problem: 'offline' } }]);
    output(FX.station, 'screen', null);
    printer('PR1', { archived: true });
    s.hooks.pass(now() + 3);
    expect(problems()).toMatchObject([{ state: 'closed', close_reason: 'obsolete' }]);
  });

  it('[03c §3.3, #8] an unalerted fold skip of a both station → ticket_not_built at once (once); a screen station that is not dark → none', () => {
    printer('PR1');
    printer('PR2');
    output(FX.station, 'both', 'PR1');
    output(FX.zoneStation, 'screen', 'PR2');
    const ins = hub.deps.db.prepare('INSERT INTO print_fold_skips (event_id, station_id, order_ids, reason, at) VALUES (?, ?, ?, ?, ?)');
    ins.run('E1', FX.station, '[]', 'bad_output', now());
    ins.run('E2', FX.zoneStation, '[]', 'bad_output', now());
    const s = statusOf();
    s.hooks.pass(now());
    s.hooks.pass(now() + 1);
    expect(problems()).toMatchObject([{ state: 'open', values: { printer_id: 'PR1' }, details: { problem: 'ticket_not_built' } }]);
    expect(hub.deps.db.prepare('SELECT event_id FROM print_fold_skips WHERE alerted_at IS NOT NULL').pluck().all()).toEqual(['E1']);
    // nothing pending and clean: a skip alert is not closed obsolete (the ticket was never built)
    s.applyStatus('PR1', 'clean', now() + 2);
    s.hooks.pass(now() + 3);
    expect(problems()).toMatchObject([{ state: 'open' }]);
  });

  it('[03c §3.3, C3-3] ticket_not_built is its own alert beside another open problem; never closed by an ack, obsolete or archive', () => {
    const [a] = threeTickets();
    const s = statusOf();
    s.applyStatus('PR1', 'paper_out', now());
    hub.deps.db.prepare('INSERT INTO print_fold_skips (event_id, station_id, order_ids, reason, at) VALUES (?, ?, ?, ?, ?)').run('E1', FX.station, '[]', 'bad_output', now());
    s.hooks.pass(now() + 1);
    expect(problems().map((p) => [p.dedupe_key, p.state, (p.details as { problem: string }).problem])).toEqual([
      ['printer_problem:PR1', 'open', 'paper_out'],
      ['printer_problem:ticket_not_built:E1', 'open', 'ticket_not_built'],
    ]);
    // paper back, the next ack closes the paper problem only
    s.applyStatus('PR1', 'clean', now() + 2);
    acked(a!, now() + 3);
    s.hooks.acked({ job_id: a!, kind: 'kitchen', printer_id: 'PR1', station_id: FX.station, ticket_id: null }, now() + 3);
    expect(problems().map((p) => [p.dedupe_key, p.state, p.close_reason])).toEqual([
      ['printer_problem:PR1', 'closed', 'done'],
      ['printer_problem:ticket_not_built:E1', 'open', null],
    ]);
    // nothing pending + clean, then archive: still open (only a manager closes it)
    hub.deps.db.prepare('UPDATE print_jobs SET cancelled_at = 1 WHERE acked_at IS NULL').run();
    s.hooks.pass(now() + 4);
    output(FX.station, 'screen', null);
    printer('PR1', { archived: true });
    s.hooks.pass(now() + 5);
    expect(problems().find((p) => p.dedupe_key === 'printer_problem:ticket_not_built:E1')).toMatchObject({ state: 'open' });
  });

  it('[03c §3.7, C3-3] one ticket_not_built alert per fold skip: two skips → two alerts; more skips over later passes → one alert each; one transaction (raiseMany) per pass', () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    const ins = hub.deps.db.prepare('INSERT INTO print_fold_skips (event_id, station_id, order_ids, reason, at) VALUES (?, ?, ?, ?, ?)');
    const s = statusOf();
    const skipKeys = () => problems().filter((p) => (p.details as { problem: string }).problem === 'ticket_not_built').map((p) => [p.dedupe_key, p.state]);
    ins.run('E1', FX.station, '[]', 'bad_output', now());
    ins.run('E2', FX.station, '[]', 'line_missing', now());
    s.hooks.pass(now());
    expect(skipKeys()).toEqual([
      ['printer_problem:ticket_not_built:E1', 'open'],
      ['printer_problem:ticket_not_built:E2', 'open'],
    ]);
    // all due skips of a pass go in one writer transaction (one raiseMany), however many there are
    const realRun = hub.deps.writer.run.bind(hub.deps.writer);
    let runs = 0;
    hub.deps.writer.run = ((fn: Parameters<typeof realRun>[0]) => {
      runs += 1;
      return realRun(fn);
    }) as typeof realRun;
    ins.run('E3', FX.station, '[]', 'bad_output', now());
    s.hooks.pass(now() + 1);
    expect(runs).toBe(1);
    ins.run('E4', FX.station, '[]', 'bad_output', now());
    ins.run('E5', FX.station, '[]', 'bad_output', now());
    ins.run('E6', FX.station, '[]', 'bad_output', now());
    s.hooks.pass(now() + 2);
    expect(runs).toBe(2);
    hub.deps.writer.run = realRun;
    s.hooks.pass(now() + 3); // nothing new
    expect(skipKeys().map(([k]) => k)).toEqual(['E1', 'E2', 'E3', 'E4', 'E5', 'E6'].map((e) => `printer_problem:ticket_not_built:${e}`));
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM print_fold_skips WHERE alerted_at IS NULL').pluck().get()).toBe(0);
  });

  it('[03c §3.7, review] after a manager closes not_printing while the head still fails, it re-raises only after another 30 s', () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    order('A', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    const a = `${ticketOf('A1')}:kitchen`;
    const s = statusOf({ readStatus: async () => 'unknown' });
    s.hooks.failed({ job_id: a, kind: 'kitchen', printer_id: 'PR1', station_id: FX.station, ticket_id: null }, TIMEOUT, now());
    s.hooks.pass(now() + PRINTER_ALERT_MS);
    expect(problems()).toMatchObject([{ state: 'open' }]);
    hub.deps.writer.run((tx) => {
      tx.append(alerts.closeMany(alerts.tickCtx(tx, now()), [{ alert_id: problems()[0]!.alert_id, reason: 'done' }]));
    });
    const closedAt = now() + PRINTER_ALERT_MS + 1;
    s.hooks.pass(closedAt); // the close is seen here: the timer restarts
    s.hooks.pass(closedAt + PRINTER_ALERT_MS - 1);
    expect(problems()).toHaveLength(1);
    s.hooks.pass(closedAt + PRINTER_ALERT_MS);
    expect(problems().map((p) => p.state)).toEqual(['closed', 'open']);
  });

  it('[03c §3.7] the acked hook ignores a job a manager cancelled (the guarded UPDATE matched nothing)', () => {
    const [a] = threeTickets();
    const s = statusOf();
    s.applyStatus('PR1', 'offline', now());
    hub.deps.db.prepare('UPDATE print_jobs SET cancelled_at = 1, sent_printer_id = ? WHERE job_id = ?').run('PR1', a);
    s.applyStatus('PR1', 'clean', now() + 1);
    s.hooks.acked({ job_id: a!, kind: 'kitchen', printer_id: 'PR1', station_id: FX.station, ticket_id: null }, now() + 2);
    expect(problems()).toMatchObject([{ state: 'open' }]);
  });
});

describe('[03c §3.7] when reads happen', () => {
  it('[03c §3.7] LAN, and USB only once its status is proven (c19); at most once per 10 s; only after an ack, a failure, or while a problem / bad status stands; idle pass = 1 statement', async () => {
    printer('PR1');
    printer('PRU', { connection: 'usb' });
    const reads: string[] = [];
    let answer: PrinterStatus = 'clean';
    const s = statusOf({ readStatus: async (p) => (reads.push(p.printer_id), answer) });
    const counter = statementCounter(hub.deps.db);
    s.hooks.pass(now());
    expect(counter.count).toBe(1);
    expect(reads).toEqual([]); // nothing to learn
    hub.deps.db.prepare(`INSERT INTO printer_runtime (printer_id, last_ack_at) VALUES ('PR1', ?), ('PRU', ?)`).run(now(), now());
    s.hooks.pass(now());
    await turns();
    expect(reads).toEqual(['PR1']); // USB without proven status: never
    hub.deps.db.prepare(`UPDATE printer_runtime SET last_ack_at = ? WHERE printer_id = 'PR1'`).run(now() + 5_000);
    s.hooks.pass(now() + 5_000);
    await turns();
    expect(reads).toEqual(['PR1']); // within 10 s
    answer = 'paper_out';
    s.hooks.pass(now() + STATUS_INTERVAL_MS);
    await turns();
    expect(reads).toEqual(['PR1', 'PR1']);
    s.hooks.pass(now() + 2 * STATUS_INTERVAL_MS); // bad status / open problem: keeps reading every 10 s
    await turns();
    expect(reads).toEqual(['PR1', 'PR1', 'PR1']);
    hub.deps.db.prepare(`UPDATE printer_runtime SET supports_status = 1 WHERE printer_id = 'PRU'`).run();
    s.hooks.pass(now() + 2 * STATUS_INTERVAL_MS + 1);
    await turns();
    expect(reads.filter((r) => r === 'PRU')).toEqual(['PRU']); // c19 (ruling (b) on #72): USB with proven status is read
  });

  it('[03c §3.7] end to end on a LAN fake printer: paper out after acks → suspects → paper back → REPRINT jobs printed', async () => {
    const p = await fakeLanPrinter();
    cleanups.push(() => p.close());
    printer('PR1', { address: p.address });
    output(FX.station, 'both', 'PR1');
    order('A', [{ n: 1, quantity: 3 }]);
    fireLines(hub, FX.station, ['A1']);
    const s = statusOf({ readStatus: (x) => readLanStatus(p.address, { timers: clock }).then((r) => (void x, r)) });
    const w = createPrintWorker({ db: hub.deps.db, state: hub.deps.state, clock: hub.clock, timers: clock, hooks: s.hooks });
    cleanups.push(() => w.stop());
    w.pass();
    p.setStatus(STATUS.paperOut); // the paper runs out while the ticket goes into the buffer
    const kitchen = `${ticketOf('A1')}:kitchen`;
    // the ack starts the next pass at once: the ack since the last read makes a read due
    await until(() => runtime()?.last_status === 'paper_out');
    expect(suspects()).toEqual([kitchen]);
    expect(problems()).toMatchObject([{ state: 'open', details: { problem: 'paper_out' } }]);
    p.setStatus(STATUS.online);
    hub.clock.advance(STATUS_INTERVAL_MS);
    w.pass();
    await until(() => runtime()?.last_status === 'clean');
    const [rec] = recoveries();
    expect(rec).toMatchObject({ kind: 'reprint', is_reprint: 1 });
    w.pass();
    await until(() => (hub.deps.db.prepare('SELECT acked_at FROM print_jobs WHERE job_id = ?').pluck().get(rec!.job_id) as number | null) !== null);
    await until(() => p.received().toString('latin1').includes('REPRINT'));
    expect(problems()).toMatchObject([{ state: 'closed', close_reason: 'done' }]);
  });
});
