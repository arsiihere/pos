import type { Doc } from '@pos/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { printDocument } from '../../src/print/contracts';
import { documentJobsStatus, retargetDocumentJob } from '../../src/print/document-jobs';
import type { SendResult } from '../../src/print/transport/lan';
import { createPrintWorker, type PrinterTransport, type PrintWorker } from '../../src/print/worker';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { append as kdsAppend, openDay } from '../kds/fixtures';
import { fakeClock, type FakeClock } from './fixtures';

// 03c v1.0.11 §3.7 "Retarget", §4.2 (⚠️ 05 row P-2; 05 §10 #60 retarget half): retargetDocumentJob moves a `document`
// job not acked and not cancelled to another printer (attempts = 0, last_error = NULL); a job being sent is refused
// 409 PRINT_JOB_NOT_PENDING; nothing prints twice. documentJobsStatus → [{ job_id, printer_id, printer_name, state, last_error }],
// 1 statement (03c v1.0.13 R-35: printer_name LEFT JOINed from printers).

let hub: TestHub;
let timers: FakeClock;
let worker: PrintWorker | null = null;
/** printer_id → bytes it was sent; `answer` decides each send's result (a pending promise = the job is being sent) */
let sends: Map<string, Buffer[]>;
let answer: (printer_id: string) => Promise<SendResult>;

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  openDay(hub);
  timers = fakeClock();
  sends = new Map();
  answer = () => Promise.resolve({ ok: true });
});
afterEach(async () => {
  worker?.stop();
  worker = null;
  swapBranchConfig(null);
  await hub.close();
});

const branch = (): string => hub.deps.config.provisioned!.branch_id;
function printer(printer_id: string, archived = false): void {
  kdsAppend(
    hub,
    [{ stream_type: 'hub', stream_id: branch(), event_type: 'PrinterSaved', payload: { printer_id, name: `name-${printer_id}`, connection: 'lan', address: `192.168.1.${printer_id.length}:9100`, paper_width_mm: 80, archived } }],
    { actor: null },
  );
}
const DOC: Doc = { blocks: [{ text: 'RECEIPT  T4', bold: true, align: 'center' }, { text: 'Total 1,250' }, { cut: true }] };
const queue = (printer_id: string): string => hub.deps.writer.run((tx) => printDocument(tx, printer_id, DOC, { kind_label: 'Receipt' })).result.job_id;
const retarget = (job_id: string, printer_id: string) => hub.deps.writer.run((tx) => retargetDocumentJob(tx, job_id, printer_id)).result;
const row = (job_id: string) =>
  hub.deps.db.prepare('SELECT printer_id, attempts, last_error, sent_at, acked_at, cancelled_at, payload, created_at FROM print_jobs WHERE job_id = ?').get(job_id) as Record<string, unknown>;
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function startWorker(): PrintWorker {
  const transportFor = (p: { printer_id: string }): PrinterTransport => ({
    send: (bytes) => {
      const list = sends.get(p.printer_id) ?? [];
      list.push(Buffer.from(bytes));
      sends.set(p.printer_id, list);
      return answer(p.printer_id);
    },
    close: () => undefined,
  });
  worker = createPrintWorker({ db: hub.deps.db, state: hub.deps.state, clock: hub.clock, timers, transportFor });
  return worker;
}
const printedOn = (printer_id: string): number => (sends.get(printer_id) ?? []).filter((b) => b.toString('latin1').includes('Total 1,250')).length;

describe('[03c §3.7, 05 row P-2] retargetDocumentJob', () => {
  it('[05 #60] a waiting job moves to the other printer; it prints there once and never on the first', async () => {
    printer('PR1');
    printer('PR22');
    const job = queue('PR1');
    const before = row(job);
    expect(retarget(job, 'PR22')).toEqual({ job_id: job, printer_id: 'PR22', printer_name: 'name-PR22', state: 'waiting', last_error: null });
    expect(row(job)).toEqual({ ...before, printer_id: 'PR22', attempts: 0, last_error: null });
    const w = startWorker();
    w.pass();
    await flush();
    timers.advance(30_000);
    w.pass();
    await flush();
    expect(printedOn('PR22')).toBe(1);
    expect(printedOn('PR1')).toBe(0);
    expect(row(job).acked_at).not.toBeNull();
  });

  it('[05 #60] a failed job moves (attempts = 0, last_error = NULL) and prints once on the new printer; the old one never retries it', async () => {
    printer('PR1');
    printer('PR22');
    const job = queue('PR1');
    answer = (p) => Promise.resolve(p === 'PR1' ? { ok: false, error: 'connect_failed', detail: null, wrote: false } : { ok: true });
    const w = startWorker();
    w.pass();
    await flush();
    expect(row(job)).toMatchObject({ attempts: 1, last_error: 'connect_failed', sent_at: null, acked_at: null });
    expect(documentJobsStatus(hub.deps.db, [job])).toEqual([{ job_id: job, printer_id: 'PR1', printer_name: 'name-PR1', state: 'failed', last_error: 'connect_failed' }]);
    expect(retarget(job, 'PR22')).toEqual({ job_id: job, printer_id: 'PR22', printer_name: 'name-PR22', state: 'waiting', last_error: null });
    expect(row(job)).toMatchObject({ printer_id: 'PR22', attempts: 0, last_error: null });
    w.pass();
    await flush();
    timers.advance(60_000); // the old printer's backoff fires: it has nothing left to retry
    await flush();
    w.pass();
    await flush();
    expect(sends.get('PR1')).toHaveLength(1);
    expect(printedOn('PR22')).toBe(1);
    expect(documentJobsStatus(hub.deps.db, [job])).toEqual([{ job_id: job, printer_id: 'PR22', printer_name: 'name-PR22', state: 'printed', last_error: null }]);
  });

  it('[05 #60, 03c §3.7] a job being sent is refused 409 PRINT_JOB_NOT_PENDING { state: printing }; it is not moved and prints once', async () => {
    printer('PR1');
    printer('PR22');
    const job = queue('PR1');
    let finish: (r: SendResult) => void = () => undefined;
    answer = () => new Promise<SendResult>((resolve) => (finish = resolve));
    const w = startWorker();
    w.pass();
    await flush();
    expect(documentJobsStatus(hub.deps.db, [job])[0]!.state).toBe('printing');
    expect(() => retarget(job, 'PR22')).toThrow(expect.objectContaining({ code: 'PRINT_JOB_NOT_PENDING', details: { job_id: job, state: 'printing' } }));
    expect(row(job).printer_id).toBe('PR1');
    finish({ ok: true });
    await flush();
    w.pass();
    await flush();
    expect(printedOn('PR1')).toBe(1);
    expect(printedOn('PR22')).toBe(0);
  });

  it('[05 #60] a printed or cancelled job → 409 PRINT_JOB_NOT_PENDING { state }; nothing changes', async () => {
    printer('PR1');
    printer('PR22');
    const printed = queue('PR1');
    const w = startWorker();
    w.pass();
    await flush();
    const cancelled = queue('PR1');
    hub.deps.db.prepare("UPDATE print_jobs SET cancelled_at = 1, last_error = 'manager' WHERE job_id = ?").run(cancelled);
    for (const [job, state] of [[printed, 'printed'], [cancelled, 'cancelled']] as const) {
      const before = row(job);
      expect(() => retarget(job, 'PR22')).toThrow(expect.objectContaining({ code: 'PRINT_JOB_NOT_PENDING', details: { job_id: job, state } }));
      expect(row(job)).toEqual(before);
    }
  });

  it('[03c §9] an unknown job, or a job that is not a document → 404 PRINT_JOB_NOT_FOUND { job_id }', () => {
    printer('PR1');
    hub.deps.db
      .prepare("INSERT INTO print_jobs (job_id, kind, printer_id, payload, created_at) VALUES ('K1', 'kitchen', 'PR1', '{}', 1)")
      .run();
    for (const job of ['NOPE', 'K1']) {
      expect(() => retarget(job, 'PR1')).toThrow(expect.objectContaining({ code: 'PRINT_JOB_NOT_FOUND', details: { job_id: job } }));
    }
    expect(row('K1').printer_id).toBe('PR1');
  });

  it('[05 §6.23] an unknown or archived target printer → 404 PRINTER_NOT_FOUND { printer_id }; the job stays', () => {
    printer('PR1');
    printer('PR333', true);
    const job = queue('PR1');
    for (const id of ['PR333', 'NOPE']) {
      expect(() => retarget(job, id)).toThrow(expect.objectContaining({ code: 'PRINTER_NOT_FOUND', details: { printer_id: id } }));
    }
    expect(row(job).printer_id).toBe('PR1');
  });

  it('[03c §4.2] statements: 1 when it moves the job (+1 to name a refusal)', () => {
    printer('PR1');
    printer('PR22');
    const job = queue('PR1');
    const counter = statementCounter(hub.deps.db);
    hub.deps.writer.run((tx) => {
      counter.reset();
      retargetDocumentJob(tx, job, 'PR22');
      expect(counter.count).toBe(1);
      counter.reset();
      expect(() => retargetDocumentJob(tx, 'NOPE', 'PR22')).toThrow();
      expect(counter.count).toBe(2);
    });
  });
});

describe('[03c §3.7, §4.2, 05 row P-2] documentJobsStatus', () => {
  it('[05 row P-2] waiting / printing / printed / failed / cancelled with printer_id and last_error, in the asked order; unknown and non-document ids left out; 1 statement', async () => {
    printer('PR1');
    printer('PR22');
    const printed = queue('PR1'); // PR1's head: acked
    const failed = queue('PR22'); // PR22's head: fails
    answer = (p) => Promise.resolve(p === 'PR22' ? { ok: false, error: 'write_timeout', detail: null, wrote: true } : { ok: true });
    const w = startWorker();
    w.pass();
    await flush();
    let finish: (r: SendResult) => void = () => undefined;
    answer = () => new Promise<SendResult>((resolve) => (finish = resolve));
    const printing = queue('PR1');
    w.pass();
    await flush();
    const waiting = queue('PR1'); // behind the job being sent
    const cancelled = queue('PR1');
    hub.deps.db.prepare("UPDATE print_jobs SET cancelled_at = 1, last_error = 'manager' WHERE job_id = ?").run(cancelled);
    hub.deps.db.prepare("INSERT INTO print_jobs (job_id, kind, printer_id, payload, created_at) VALUES ('K1', 'kitchen', 'PR1', '{}', 1)").run();

    const counter = statementCounter(hub.deps.db);
    counter.reset();
    const status = documentJobsStatus(hub.deps.db, [cancelled, 'NOPE', waiting, printing, 'K1', failed, printed]);
    expect(counter.count).toBe(1);
    expect(status).toEqual([
      { job_id: cancelled, printer_id: 'PR1', printer_name: 'name-PR1', state: 'cancelled', last_error: 'manager' },
      { job_id: waiting, printer_id: 'PR1', printer_name: 'name-PR1', state: 'waiting', last_error: null },
      { job_id: printing, printer_id: 'PR1', printer_name: 'name-PR1', state: 'printing', last_error: null },
      { job_id: failed, printer_id: 'PR22', printer_name: 'name-PR22', state: 'failed', last_error: 'write_timeout' },
      { job_id: printed, printer_id: 'PR1', printer_name: 'name-PR1', state: 'printed', last_error: null },
    ]);
    counter.reset();
    expect(documentJobsStatus(hub.deps.db, [])).toEqual([]);
    expect(counter.count).toBe(0);
    finish({ ok: true });
    await flush();
  });

  it('[03c v1.0.13 §3.7, R-35] printer_name by the job\'s current printer: renamed and archived printers give their name, a missing printer row → null; still 1 statement', () => {
    printer('PR1');
    printer('PR22');
    const onArchived = queue('PR1');
    const moved = queue('PR1');
    retarget(moved, 'PR22');
    kdsAppend(
      hub,
      [{ stream_type: 'hub', stream_id: branch(), event_type: 'PrinterSaved', payload: { printer_id: 'PR1', name: 'Old counter', connection: 'lan', address: '192.168.1.3:9100', paper_width_mm: 80, archived: true } }],
      { actor: null },
    );
    hub.deps.db.prepare("INSERT INTO print_jobs (job_id, kind, printer_id, payload, created_at) VALUES ('GHOST', 'document', 'NOPE', '{}', 1)").run();
    const counter = statementCounter(hub.deps.db);
    counter.reset();
    expect(documentJobsStatus(hub.deps.db, [onArchived, moved, 'GHOST'])).toEqual([
      { job_id: onArchived, printer_id: 'PR1', printer_name: 'Old counter', state: 'waiting', last_error: null },
      { job_id: moved, printer_id: 'PR22', printer_name: 'name-PR22', state: 'waiting', last_error: null },
      { job_id: 'GHOST', printer_id: 'NOPE', printer_name: null, state: 'waiting', last_error: null },
    ]);
    expect(counter.count).toBe(1);
  });

  it('[03c §3.7] a repeated id gives a repeated row, in the order asked (no de-duplication)', () => {
    printer('PR1');
    const a = queue('PR1');
    const b = queue('PR1');
    const row = { printer_id: 'PR1', printer_name: 'name-PR1', state: 'waiting', last_error: null };
    expect(documentJobsStatus(hub.deps.db, [a, b, a])).toEqual([{ job_id: a, ...row }, { job_id: b, ...row }, { job_id: a, ...row }]);
  });
});

describe('[03c §3.6, §3.9, R-26] a bad QR block is refused at send, not at printDocument', () => {
  it('[05 §3.16 R8] printDocument queues it (the caller\'s transaction commits); the worker cancels it render_failed and the next job prints', async () => {
    printer('PR1');
    const bad = hub.deps.writer.run((tx) => printDocument(tx, 'PR1', { blocks: [{ text: 'X' }, { qr: '' }] }, { kind_label: 'Receipt' })).result.job_id;
    const big = hub.deps.writer.run((tx) => printDocument(tx, 'PR1', { blocks: [{ qr: 'é'.repeat(401) }] }, { kind_label: 'Receipt' })).result.job_id;
    const good = queue('PR1');
    const w = startWorker();
    for (let i = 0; i < 3; i += 1) {
      w.pass();
      await flush();
    }
    expect(documentJobsStatus(hub.deps.db, [bad, big, good])).toEqual([
      { job_id: bad, printer_id: 'PR1', printer_name: 'name-PR1', state: 'cancelled', last_error: 'render_failed' },
      { job_id: big, printer_id: 'PR1', printer_name: 'name-PR1', state: 'cancelled', last_error: 'render_failed' },
      { job_id: good, printer_id: 'PR1', printer_name: 'name-PR1', state: 'printed', last_error: null },
    ]);
    expect(printedOn('PR1')).toBe(1);
  });
});
