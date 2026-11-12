import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SendResult } from '../../src/print/transport/lan';
import { RETRY_DELAYS_MS, createPrintWorker, type PrintWorker, type PrinterTransport } from '../../src/print/worker';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { FX, appendOrder, append as kdsAppend, fireLines, openDay, removeLine } from '../kds/fixtures';
import { fakeClock, fakeLanPrinter, type FakeClock, type FakeLanPrinter } from './fixtures';

// 03c §3.5, §3.7 (task c14): the print worker over real tables and real events. One FIFO per printer advancing at
// ack; render + sent_at + sent_printer_id in one synchronous step; failure path and retry 2 s / 5 s / 10 s on the
// injected timers; empty / stale renders cancelled, not sent; station jobs follow the station's current printer,
// document jobs keep theirs. No timing asserts: tests advance the fake clock and poll for conditions.
let hub: TestHub;
let clock: FakeClock;
const cleanups: Array<() => Promise<void> | void> = [];

beforeEach(async () => {
  errors.length = 0;
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
function hubEvent(event_type: 'PrinterSaved' | 'StationOutputSet', payload: Record<string, unknown>): void {
  kdsAppend(hub, [{ stream_type: 'hub', stream_id: branch(), event_type, payload }], { actor: null });
}
function printer(printer_id: string, address = '192.168.1.50:9100', paper_width_mm: 58 | 80 = 80): void {
  hubEvent('PrinterSaved', { printer_id, name: printer_id, connection: 'lan', address, paper_width_mm, archived: false });
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
interface JobRow {
  job_id: string;
  kind: string;
  sent_at: number | null;
  sent_printer_id: string | null;
  acked_at: number | null;
  cancelled_at: number | null;
  attempts: number;
  last_error: string | null;
  is_reprint: number;
}
const job = (job_id: string) =>
  hub.deps.db
    .prepare('SELECT job_id, kind, sent_at, sent_printer_id, acked_at, cancelled_at, attempts, last_error, is_reprint FROM print_jobs WHERE job_id = ?')
    .get(job_id) as JobRow;
const jobsOf = (kind: string) => hub.deps.db.prepare('SELECT job_id FROM print_jobs WHERE kind = ? ORDER BY created_at, job_id').pluck().all(kind) as string[];

/** A transport the test settles by hand; every send is recorded with its bytes as text. */
function scripted(): PrinterTransport & { sends: string[]; settle(r: SendResult): void; pending(): number; closed: boolean } {
  const waiting: Array<(r: SendResult) => void> = [];
  const t = {
    sends: [] as string[],
    closed: false,
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
    close() {
      t.closed = true;
    },
  };
  return t;
}

type Options = Parameters<typeof createPrintWorker>[0];
const errors: string[] = [];
function worker(transportFor?: Options['transportFor'], hooks?: Options['hooks']): PrintWorker {
  const log = { error: (_obj: Record<string, unknown>, msg?: string) => errors.push(msg ?? '') };
  const w = createPrintWorker({ db: hub.deps.db, state: hub.deps.state, clock: hub.clock, timers: clock, transportFor, hooks, log });
  cleanups.push(() => w.stop());
  return w;
}

async function lanPrinter(o: { status?: number | null } = {}): Promise<FakeLanPrinter> {
  const p = await fakeLanPrinter(o);
  cleanups.push(() => p.close());
  return p;
}

const OK: SendResult = { ok: true };
const DOWN: SendResult = { ok: false, error: 'connect_failed', detail: 'ECONNREFUSED', wrote: false };

describe('[03c §3.7] print worker', () => {
  it('[03c #20] LAN fake printer: written + flushed → acked; FIFO advances at ack without waiting for a status read', async () => {
    const p = await lanPrinter({ status: null }); // never answers DLE EOT: the FIFO must not wait for it
    printer('PR1', p.address);
    output(FX.station, 'both', 'PR1');
    order('A', [{ n: 1, quantity: 4 }]);
    order('B', [{ n: 1, quantity: 2 }]);
    fireLines(hub, FX.station, ['A1']);
    fireLines(hub, FX.station, ['B1']);
    const a = `${ticketOf('A1')}:kitchen`;
    const b = `${ticketOf('B1')}:kitchen`;
    const w = worker();
    w.pass();
    expect(job(a)).toMatchObject({ sent_at: hub.clock.branchNow(), sent_printer_id: 'PR1', acked_at: null });
    expect(job(b).sent_at).toBeNull(); // one FIFO per printer: B waits for A's ack
    await until(() => job(b).acked_at !== null);
    expect(job(a)).toMatchObject({ acked_at: hub.clock.branchNow(), attempts: 0, last_error: null, cancelled_at: null });
    await until(() => p.received().toString('latin1').includes('2 x Naan')); // acked = in the kernel; the printer reads it after
    const text = p.received().toString('latin1');
    expect(text.indexOf('4 x Naan')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('2 x Naan')).toBeGreaterThan(text.indexOf('4 x Naan'));
    expect(text).not.toContain('REPRINT');
    expect(hub.deps.db.prepare(`SELECT last_ack_at FROM printer_runtime WHERE printer_id = 'PR1'`).pluck().get()).toBe(hub.clock.branchNow());
    await until(() => clock.pending() === 0); // no transport timer left once the printer closed both sockets
  });

  it('[03c #9b] render vs removal: a removal committed after the render sees the ticket printed and queues the CANCELLED slip', async () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    const a = order('A', [{ n: 1, quantity: 4 }]);
    fireLines(hub, FX.station, ['A1']);
    const t = scripted(); // connect delayed: the send has not settled
    const w = worker(() => t);
    w.pass();
    expect(t.sends).toHaveLength(1);
    expect(t.sends[0]).toContain('4 x Naan');
    const [removed] = removeLine(hub, a, 'A1', 1);
    expect(jobsOf('cancel')).toEqual([`${removed!.event_id}:cancel:1`]);
    t.settle(OK);
    await turns();
    expect(t.sends).toHaveLength(2);
    expect(t.sends[1]).toContain('CANCELLED');
    expect(t.sends[1]).toContain('- 1 x Naan  3 left');
    t.settle(OK);
    await turns();
    expect(job(`${removed!.event_id}:cancel:1`).acked_at).not.toBeNull();
  });

  it('[03c §3.7] failure before a full write: attempts + 1, last_error, sent_at NULL, is_reprint when bytes went out; retry 2 s, 5 s, then every 10 s', async () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    order('A', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    const id = `${ticketOf('A1')}:kitchen`;
    const t = scripted();
    const w = worker(() => t);
    w.pass();
    t.settle(DOWN);
    await turns();
    expect(job(id)).toMatchObject({ sent_at: null, acked_at: null, attempts: 1, last_error: 'connect_failed:ECONNREFUSED', is_reprint: 0 });
    expect(hub.deps.db.prepare(`SELECT last_error FROM printer_runtime WHERE printer_id = 'PR1'`).pluck().get()).toBe('connect_failed:ECONNREFUSED');
    expect(RETRY_DELAYS_MS).toEqual([2_000, 5_000, 10_000]);
    const waits: number[] = [];
    for (const [i, result] of ([
      { ok: false, error: 'write_timeout', detail: null, wrote: true },
      DOWN,
      DOWN,
      DOWN,
    ] as SendResult[]).entries()) {
      const delay = RETRY_DELAYS_MS[Math.min(i, RETRY_DELAYS_MS.length - 1)]!;
      w.pass(); // the loop runs, but the printer is backing off
      clock.advance(delay - 1);
      await turns();
      expect(t.pending()).toBe(0);
      clock.advance(1);
      await turns();
      expect(t.pending()).toBe(1);
      waits.push(delay);
      t.settle(result);
      await turns();
    }
    expect(waits).toEqual([2_000, 5_000, 10_000, 10_000]);
    expect(job(id)).toMatchObject({ attempts: 5, sent_at: null, is_reprint: 1 }); // a byte went out once: stays a reprint
    clock.advance(RETRY_DELAYS_MS[2]!);
    await turns();
    expect(t.sends.at(-1)).toContain('REPRINT');
    t.settle(OK);
    await turns();
    expect(job(id)).toMatchObject({ acked_at: hub.clock.branchNow(), attempts: 5, last_error: null });
  });

  it('[03c #23] two printers: one down never delays the other', async () => {
    const good = await lanPrinter();
    printer('PR1');
    printer('PR2', good.address);
    output(FX.station, 'both', 'PR1');
    output(FX.zoneStation, 'printer', 'PR2');
    order('A', [{ n: 1 }, { n: 2 }]);
    order('B', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    fireLines(hub, FX.zoneStation, ['A2']);
    fireLines(hub, FX.zoneStation, ['B1']);
    const stuck = scripted(); // PR1 never settles
    const w = worker((p) => (p.printer_id === 'PR1' ? stuck : undefined));
    w.pass();
    await until(() => job(`${ticketOf('B1')}:kitchen`).acked_at !== null);
    expect(job(`${ticketOf('A2')}:kitchen`).acked_at).not.toBeNull();
    expect(job(`${ticketOf('A1')}:kitchen`)).toMatchObject({ acked_at: null, sent_printer_id: 'PR1' });
    expect(stuck.pending()).toBe(1);
  });

  it('[03c #24] restart: a sent-not-acked row (no send in flight in this process) is resent once with REPRINT', async () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    order('A', [{ n: 1 }]);
    order('B', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    fireLines(hub, FX.station, ['B1']);
    const a = `${ticketOf('A1')}:kitchen`;
    const b = `${ticketOf('B1')}:kitchen`;
    // the previous process sent A and died before the ack; B was reset by the boot step (c16) already
    hub.deps.db.prepare(`UPDATE print_jobs SET sent_at = 1, sent_printer_id = 'PR1' WHERE job_id = ?`).run(a);
    hub.deps.db.prepare(`UPDATE print_jobs SET is_reprint = 1 WHERE job_id = ?`).run(b);
    const t = scripted();
    const w = worker(() => t);
    w.pass();
    w.pass(); // a second loop while A is in flight sends nothing more
    expect(t.sends).toHaveLength(1);
    expect(t.sends[0]).toContain('REPRINT');
    expect(job(a)).toMatchObject({ is_reprint: 1, sent_at: hub.clock.branchNow() });
    t.settle(OK);
    await turns();
    expect(t.sends).toHaveLength(2);
    expect(t.sends[1]).toContain('REPRINT');
    t.settle(OK);
    await turns();
    expect([job(a).acked_at, job(b).acked_at].every((x) => x !== null)).toBe(true);
    expect(t.sends).toHaveLength(2);
  });

  it('[03c #28, #6] printer back: stale cancel / first / coming_up and an empty kitchen job are cancelled, not sent', async () => {
    printer('PR1');
    output(FX.station, 'printer', 'PR1');
    const a = order('A', [{ n: 1, quantity: 2 }]);
    const b = order('B', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    const t = scripted();
    const w = worker(() => t);
    w.pass();
    t.settle(OK); // A printed
    await turns();
    const down = t.sends.length;
    fireLines(hub, FX.station, ['B1']);
    const [removed] = removeLine(hub, a, 'A1', 1);
    const [boost] = kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'OrderBoosted', payload: { order_id: a } }], { actor: 'S_MGR' });
    const cancelId = `${removed!.event_id}:cancel:1`;
    const firstId = `${boost!.event_id}:first:1`;
    expect(jobsOf('first')).toEqual([firstId]);
    // the printer goes down on B's kitchen job (the head); meanwhile the cook finishes A1 and B1 by hand
    w.pass();
    expect(t.sends).toHaveLength(down + 1);
    t.settle(DOWN);
    await turns();
    const at = hub.clock.branchNow();
    kdsAppend(hub, [
      { stream_type: 'order', stream_id: a, event_type: 'ItemDone', payload: { order_item_id: 'A1', done_at: at, source: 'tap' } },
      { stream_type: 'order', stream_id: b, event_type: 'ItemDone', payload: { order_item_id: 'B1', done_at: at, source: 'tap' } },
    ]);
    hub.deps.db
      .prepare(`INSERT INTO print_jobs (job_id, kind, printer_id, station_id, payload, created_at) VALUES ('CU', 'coming_up', NULL, ?, ?, ?)`)
      .run(FX.station, JSON.stringify({ station_id: FX.station }), hub.clock.branchNow() - 600_001);
    clock.advance(RETRY_DELAYS_MS[0]!); // printer back
    await turns();
    for (let i = 0; i < 4; i += 1) w.pass();
    expect(t.sends).toHaveLength(down + 1);
    const now = hub.clock.branchNow();
    expect(job(`${ticketOf('B1')}:kitchen`)).toMatchObject({ cancelled_at: now, last_error: 'empty', sent_at: null });
    expect(job(cancelId)).toMatchObject({ cancelled_at: now, last_error: 'stale', sent_at: null });
    expect(job(firstId)).toMatchObject({ cancelled_at: now, last_error: 'stale', sent_at: null });
    expect(job('CU')).toMatchObject({ cancelled_at: now, last_error: 'stale', sent_at: null });
  });

  it('[03c #29] station output changed → pending station jobs follow the new printer; a document job stays on its printer', async () => {
    printer('PR1');
    printer('PR2');
    output(FX.station, 'both', 'PR1');
    order('A', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    const kitchen = `${ticketOf('A1')}:kitchen`;
    hub.deps.db
      .prepare(`INSERT INTO print_jobs (job_id, kind, printer_id, station_id, payload, created_at) VALUES ('DOC', 'document', 'PR1', NULL, ?, ?)`)
      .run(JSON.stringify({ doc: { blocks: [{ text: 'BILL 42' }, { cut: true }] }, kind_label: 'bill' }), hub.clock.branchNow());
    output(FX.station, 'both', 'PR2');
    const t1 = scripted();
    const t2 = scripted();
    const w = worker((p) => (p.printer_id === 'PR1' ? t1 : t2));
    w.pass();
    expect(t2.sends).toHaveLength(1);
    expect(t2.sends[0]).toContain('1 x Naan');
    expect(job(kitchen).sent_printer_id).toBe('PR2');
    expect(t1.sends).toHaveLength(1);
    expect(t1.sends[0]).toContain('BILL 42');
    expect(job('DOC').sent_printer_id).toBe('PR1');
    t1.settle(DOWN);
    t2.settle(OK);
    await turns();
    // a failed document job waits on its printer (a manager cancels it), it never moves
    expect(job('DOC')).toMatchObject({ cancelled_at: null, acked_at: null, attempts: 1 });
    expect(job(kitchen).acked_at).not.toBeNull();
  });

  it('[03c #29] a printer change rebuilds its transport; an archived printer gets nothing; stop closes transports', async () => {
    printer('PR1', '192.168.1.50:9100');
    output(FX.station, 'both', 'PR1');
    order('A', [{ n: 1 }]);
    order('B', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    const made: Array<{ address: string; t: ReturnType<typeof scripted> }> = [];
    const w = worker((p) => {
      const t = scripted();
      made.push({ address: p.address, t });
      return t;
    });
    w.pass();
    made[0]!.t.settle(OK);
    await turns();
    printer('PR1', '192.168.1.51:9100');
    fireLines(hub, FX.station, ['B1']);
    w.pass();
    expect(made.map((m) => m.address)).toEqual(['192.168.1.50:9100', '192.168.1.51:9100']);
    expect(made[0]!.t.closed).toBe(true);
    made[1]!.t.settle(OK);
    await turns();
    hubEvent('PrinterSaved', { printer_id: 'PR1', name: 'PR1', connection: 'lan', address: '192.168.1.51:9100', paper_width_mm: 80, archived: true });
    order('C', [{ n: 1 }]);
    fireLines(hub, FX.station, ['C1']);
    w.pass();
    expect(made).toHaveLength(2);
    expect(made[1]!.t.sends).toHaveLength(1);
    w.stop();
    expect(made[1]!.t.closed).toBe(true);
  });

  it('[03c §3.7] a job that cannot render (corrupt payload) is cancelled render_failed; the next job still prints', async () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    order('A', [{ n: 1 }]);
    hub.deps.db
      .prepare(`INSERT INTO print_jobs (job_id, kind, printer_id, station_id, payload, created_at) VALUES ('BAD', 'cancel', NULL, ?, 'not json', 1)`)
      .run(FX.station);
    fireLines(hub, FX.station, ['A1']);
    const t = scripted();
    const w = worker(() => t);
    w.pass();
    expect(job('BAD')).toMatchObject({ cancelled_at: hub.clock.branchNow(), last_error: 'render_failed', sent_at: null });
    expect(t.sends).toHaveLength(1);
    expect(t.sends[0]).toContain('1 x Naan');
  });

  it('[03c §3.7, review] the station moves to another printer mid-send: the job is never sent twice; the ack names the printer that printed it', async () => {
    printer('PR1');
    printer('PR2');
    output(FX.station, 'both', 'PR1');
    const a = order('A', [{ n: 1, quantity: 4 }]);
    order('B', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    const id = `${ticketOf('A1')}:kitchen`;
    const t1 = scripted();
    const t2 = scripted();
    const w = worker((p) => (p.printer_id === 'PR1' ? t1 : t2));
    w.pass();
    expect(t1.sends).toHaveLength(1);
    const sentAt = job(id).sent_at;
    output(FX.station, 'both', 'PR2');
    fireLines(hub, FX.station, ['B1']);
    w.pass();
    w.pass();
    expect(t2.sends).toHaveLength(1); // B's ticket only: A is in flight on PR1
    expect(t2.sends[0]).toContain('1 x Naan');
    expect(t2.sends[0]).not.toContain('4 x Naan');
    t2.settle(DOWN); // PR2 fails B: A's row is untouched
    t1.settle(OK);
    await turns();
    expect(job(id)).toMatchObject({ sent_at: sentAt, sent_printer_id: 'PR1', last_error: null });
    expect(job(id).acked_at).not.toBeNull();
    expect(t1.sends).toHaveLength(1);
    // printed → a later removal still queues the CANCELLED slip
    removeLine(hub, a, 'A1', 1);
    expect(jobsOf('cancel')).toHaveLength(1);
  });

  it('[03c §3.7, review] a failed in-flight job whose station moved is sent to the new printer next pass, once', async () => {
    printer('PR1');
    printer('PR2');
    output(FX.station, 'both', 'PR1');
    order('A', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    const id = `${ticketOf('A1')}:kitchen`;
    const t1 = scripted();
    const t2 = scripted();
    const w = worker((p) => (p.printer_id === 'PR1' ? t1 : t2));
    w.pass();
    output(FX.station, 'both', 'PR2');
    w.pass();
    expect(t2.sends).toHaveLength(0);
    t1.settle(DOWN);
    await turns();
    w.pass();
    expect(t2.sends).toHaveLength(1);
    expect(job(id)).toMatchObject({ sent_printer_id: 'PR2', attempts: 1 });
    t2.settle(OK);
    await turns();
    expect(job(id)).toMatchObject({ sent_printer_id: 'PR2', last_error: null });
  });

  it('[03c §3.7, review] a manager cancel while in flight wins over the late ack', async () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    order('A', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    const id = `${ticketOf('A1')}:kitchen`;
    const t = scripted();
    const w = worker(() => t);
    w.pass();
    hub.deps.db.prepare('UPDATE print_jobs SET cancelled_at = 5 WHERE job_id = ?').run(id);
    t.settle(OK);
    await turns();
    expect(job(id)).toMatchObject({ cancelled_at: 5, acked_at: null });
  });

  it('[03c §3.6, review] a malformed document ({ doc: {} }, bad blocks) is cancelled render_failed; the loop re-arms; other printers still print', () => {
    printer('PR1');
    printer('PR2');
    output(FX.station, 'both', 'PR2');
    order('A', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    const insert = hub.deps.db.prepare(`INSERT INTO print_jobs (job_id, kind, printer_id, station_id, payload, created_at) VALUES (?, 'document', 'PR1', NULL, ?, 1)`);
    insert.run('D1', JSON.stringify({ doc: {} }));
    insert.run('D2', JSON.stringify({ doc: { blocks: [42, null] } }));
    const t1 = scripted();
    const t2 = scripted();
    const w = worker((p) => (p.printer_id === 'PR1' ? t1 : t2));
    w.start();
    expect(() => clock.advance(1_000)).not.toThrow();
    expect(job('D1')).toMatchObject({ cancelled_at: hub.clock.branchNow(), last_error: 'render_failed' });
    expect(job('D2')).toMatchObject({ cancelled_at: hub.clock.branchNow(), last_error: 'render_failed' });
    expect(t1.sends).toHaveLength(0);
    expect(t2.sends).toHaveLength(1);
    expect(clock.pending()).toBe(1); // the loop timer, re-armed
  });

  it('[03c §3.5, review] a document job re-sent (is_reprint) carries the REPRINT header', () => {
    printer('PR1');
    hub.deps.db
      .prepare(`INSERT INTO print_jobs (job_id, kind, printer_id, station_id, payload, created_at, is_reprint) VALUES ('DOC', 'document', 'PR1', NULL, ?, 1, 1)`)
      .run(JSON.stringify({ doc: { blocks: [{ text: 'BILL 42' }] } }));
    const t = scripted();
    worker(() => t).pass();
    expect(t.sends[0]).toContain('REPRINT');
    expect(t.sends[0]!.indexOf('REPRINT')).toBeLessThan(t.sends[0]!.indexOf('BILL 42'));
  });

  it('[03c §3.7, review] a send that settles after stop writes nothing (c16 re-sends it with REPRINT)', async () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    order('A', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    const id = `${ticketOf('A1')}:kitchen`;
    const t = scripted();
    const w = worker(() => t);
    w.pass();
    w.stop();
    hub.deps.db.prepare('UPDATE print_jobs SET last_error = ? WHERE job_id = ?').run('marker', id);
    t.settle(OK);
    await turns();
    expect(job(id)).toMatchObject({ acked_at: null, last_error: 'marker' });
    expect(clock.pending()).toBe(0);
  });

  it('[03c §3.7, review] hooks that throw are logged; the next head, the backoff and the loop go on', async () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    order('A', [{ n: 1 }]);
    order('B', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    fireLines(hub, FX.station, ['B1']);
    const t = scripted();
    const boom = (): never => {
      throw new Error('hook says no');
    };
    const w = worker(() => t, { acked: boom, failed: boom, pass: boom });
    w.start();
    w.pass();
    t.settle(OK); // acked hook throws → B still starts
    await turns();
    expect(t.sends).toHaveLength(2);
    t.settle(DOWN); // failed hook throws → the backoff is still armed
    await turns();
    clock.advance(RETRY_DELAYS_MS[0]!);
    await turns();
    expect(t.sends).toHaveLength(3);
    expect(errors.filter((e) => e === 'print.hook_failed').length).toBeGreaterThanOrEqual(3);
    expect(clock.pending()).toBe(1); // the loop survived its pass hook throwing
  });

  it('[03c §3.7, review] an ack clears printer_runtime.last_error', async () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    order('A', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    const t = scripted();
    const w = worker(() => t);
    w.pass();
    t.settle(DOWN);
    await turns();
    expect(hub.deps.db.prepare(`SELECT last_error FROM printer_runtime WHERE printer_id = 'PR1'`).pluck().get()).toBe('connect_failed:ECONNREFUSED');
    clock.advance(RETRY_DELAYS_MS[0]!);
    await turns();
    t.settle(OK);
    await turns();
    expect(hub.deps.db.prepare(`SELECT last_error FROM printer_runtime WHERE printer_id = 'PR1'`).pluck().get()).toBeNull();
  });

  it('[03c §3.7, c14 review] a logger whose info throws never wedges a printer (sent, acked, next head)', async () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    order('A', [{ n: 1 }]);
    order('B', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    fireLines(hub, FX.station, ['B1']);
    const t = scripted();
    const boom = (): never => {
      throw new Error('log says no');
    };
    const w = createPrintWorker({ db: hub.deps.db, state: hub.deps.state, clock: hub.clock, timers: clock, transportFor: () => t, log: { info: boom, error: boom } });
    cleanups.push(() => w.stop());
    w.pass();
    expect(t.sends).toHaveLength(1);
    t.settle(OK);
    await turns();
    expect(job(`${ticketOf('A1')}:kitchen`).acked_at).not.toBeNull();
    expect(t.sends).toHaveLength(2);
  });

  it('[03c §3.7] idle loop: 1 statement; the loop re-arms on the injected timers; stop clears it', () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    const w = worker(() => scripted());
    w.start();
    const counter = statementCounter(hub.deps.db);
    w.pass();
    expect(counter.count).toBe(1);
    counter.reset();
    clock.advance(1_000);
    expect(counter.count).toBe(1);
    w.stop();
    expect(clock.pending()).toBe(0);
  });
});
