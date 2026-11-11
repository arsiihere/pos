import type { Doc } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import type Database from 'better-sqlite3';
import type { StateHolder } from '../engine-host/state-holder.js';
import type { Clock } from '../lib/clock.js';
import { hubTime } from '../lib/hub-time.js';
import { encodeDoc } from './escpos.js';
import { renderJob, type RenderJob } from './render/jobs.js';
import { nodeTimers, sendLan, type PrintTimers, type SendResult } from './transport/lan.js';
import { createUsbTransport } from './transport/usb.js';

// 03c §3.5, §3.7, D2–D4 (task c14): the print worker. Async, outside every writer transaction and every tick: its
// `print_jobs` / `printer_runtime` writes are plain statements between transactions (better-sqlite3 is synchronous,
// so no writer.run can interleave with one), never events, never synced.
// - One FIFO per printer in `created_at` order, advancing at ack (never waits for a status read).
// - A station job (`printer_id` NULL) follows its station's current printer at send; a job with a printer (document)
//   keeps it. Archived printers get nothing. `test` jobs bypass the FIFO (c19).
// - Send: render + `sent_at` + `sent_printer_id` in one synchronous step (a removal committed after the render sees
//   the ticket printed and queues its CANCELLED slip, #9b), then the transport (LAN socket / USB child).
// - Empty kitchen / reprint render → cancelled `empty`; empty cancel / first / coming_up → cancelled `stale`.
// - Failure before a full write: attempts + 1, last_error, is_reprint once a byte went out, sent_at NULL; that
//   printer retries after 2 s, 5 s, then every 10 s, no limit (in-memory backoff on the injected timers).
// - A head row with sent_at set and not in this process's in-flight set (a process that died before the ack) is resent with
//   REPRINT; c16's boot step does the same reset at boot.
// Idle loop: 1 statement. Status reads, suspects and printer_problem are c15's, through the hooks below.

export const PRINT_LOOP_MS = 1_000;
export const RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;

export interface PrinterTransport {
  send(bytes: Uint8Array): Promise<SendResult>;
  close(): void;
}

export interface TransportPrinter {
  printer_id: string;
  connection: 'lan' | 'usb';
  address: string;
}

/** Test seam: return a transport for a printer, or undefined for the real one (LAN socket / USB child). */
export type TransportFor = (printer: TransportPrinter) => PrinterTransport | undefined;

export interface SentJob {
  job_id: string;
  kind: string;
  printer_id: string;
  station_id: string | null;
  ticket_id: string | null;
}

/** The worker's events for c15 (status, suspects, printer_problem) and c21 (`printed_lines`); called after the write. */
export interface PrintWorkerHooks {
  acked?(job: SentJob, at: number): void;
  failed?(job: SentJob, result: Extract<SendResult, { ok: false }>, at: number): void;
  /** every loop pass, after the sends started (c15 status reads, c17 fallback) */
  pass?(now: number): void;
}

export interface PrintWorkerLog {
  info?(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface PrintWorkerOptions {
  db: Database.Database;
  state: StateHolder<EngineState>;
  clock: Clock;
  timers?: PrintTimers;
  transportFor?: TransportFor;
  hooks?: PrintWorkerHooks;
  log?: PrintWorkerLog;
}

export interface PrintWorker {
  /** arms the 1 s loop (started after listen, c16) */
  start(): void;
  /** one loop pass now: every idle, not-backing-off printer starts its head job */
  pass(): void;
  /** clears the loop and the backoffs, closes the transports; a send settling later writes nothing (c16 re-sends) */
  stop(): void;
}

interface HeadRow {
  job_id: string;
  kind: RenderJob['kind'] | 'document';
  station_id: string | null;
  ticket_id: string | null;
  payload: string;
  created_at: number;
  sent_at: number | null;
  is_reprint: number;
  printer_id: string;
  connection: 'lan' | 'usb';
  address: string;
  paper_width_mm: number;
}

interface PrinterState {
  transport: PrinterTransport | null;
  key: string;
  busy: boolean;
  backoff: unknown;
}

const STALE_KINDS = new Set(['cancel', 'first', 'coming_up']);

/** The job as renderJob takes it; `document` jobs carry their Doc (§3.9 payload `{ doc, kind_label? }`, c18). */
function docOf(row: HeadRow, render: (job: RenderJob) => Doc | null): Doc | null {
  const p = JSON.parse(row.payload) as Record<string, unknown>;
  const is_reprint = row.is_reprint === 1;
  switch (row.kind) {
    case 'document': {
      const doc = p.doc as Doc | undefined;
      if (doc === undefined || doc === null) return null;
      // §3.5: the REPRINT header goes on every re-send, documents too
      return is_reprint ? { ...doc, blocks: [{ text: '** REPRINT **', bold: true, align: 'center' }, ...doc.blocks] } : doc;
    }
    case 'kitchen':
    case 'reprint':
      return render({ kind: row.kind, ticket_id: p.ticket_id as string, is_reprint });
    case 'cancel':
      return render({
        kind: 'cancel',
        job_id: row.job_id,
        created_at: row.created_at,
        ticket_id: p.ticket_id as string,
        order_item_id: p.order_item_id as string,
        units: (p.units as number | null | undefined) ?? null,
        is_reprint,
      });
    case 'first':
      return render({
        kind: 'first',
        ticket_id: p.ticket_id as string,
        order_item_ids: p.order_item_ids as string[],
        reason: p.reason as 'boost' | 'expedite',
        is_reprint,
      });
    case 'coming_up':
      return render({ kind: 'coming_up', station_id: (p.station_id as string | undefined) ?? row.station_id!, created_at: row.created_at, is_reprint });
  }
}

export function createPrintWorker(o: PrintWorkerOptions): PrintWorker {
  const timers = o.timers ?? nodeTimers;
  const printers = new Map<string, PrinterState>();
  /** job_id → the printer it is being sent to, for sends started by this process */
  const inFlight = new Map<string, string>();
  let loop: unknown = null;
  let running = false;
  let stopped = false;

  const now = (): number => o.clock.branchNow();
  // c15 (review of c14, approved edit): info goes through the same guard; a throwing logger never wedges a printer
  const logInfo = (obj: Record<string, unknown>, msg: string): void => {
    try {
      o.log?.info?.(obj, msg);
    } catch {
      // a broken logger never stops printing
    }
  };
  const logError = (obj: Record<string, unknown>, msg: string): void => {
    try {
      o.log?.error(obj, msg);
    } catch {
      // a broken logger never stops printing
    }
  };
  /** a hook that throws is logged and never stops the worker */
  const hook = (name: string, fn: () => void): void => {
    try {
      fn();
    } catch (error) {
      logError({ hook: name, err: (error as Error).message }, 'print.hook_failed');
    }
  };

  const transportOf = (row: HeadRow, st: PrinterState): PrinterTransport => {
    const key = `${row.connection}|${row.address}`;
    if (st.transport !== null && st.key === key) return st.transport;
    st.transport?.close();
    const p: TransportPrinter = { printer_id: row.printer_id, connection: row.connection, address: row.address };
    st.transport =
      o.transportFor?.(p) ??
      (row.connection === 'lan'
        ? { send: (bytes) => sendLan(row.address, bytes, { timers }), close: () => undefined }
        : createUsbTransport(row.address, { timers }));
    st.key = key;
    return st.transport;
  };

  const stateOf = (printer_id: string): PrinterState => {
    let st = printers.get(printer_id);
    if (st === undefined) {
      st = { transport: null, key: '', busy: false, backoff: null };
      printers.set(printer_id, st);
    }
    return st;
  };

  /** the transport's answer: one guarded row write, then the hook, then the next head or the backoff */
  const settle = (sent: SentJob, sentAt: number, st: PrinterState, result: SendResult): void => {
    inFlight.delete(sent.job_id);
    st.busy = false;
    // after stop the DB may be closed (SIGTERM): nothing is written; c16's boot reset re-sends with REPRINT
    if (stopped) return;
    let backoff: number | null = null;
    try {
      const at = now();
      if (result.ok) {
        // guarded: a manager cancel meanwhile wins; sent_at / sent_printer_id name this send (suspect marking, PRINTED)
        o.db
          .prepare(
            `UPDATE print_jobs SET acked_at = ?, sent_at = ?, sent_printer_id = ?, last_error = NULL
             WHERE job_id = ? AND acked_at IS NULL AND cancelled_at IS NULL`,
          )
          .run(at, sentAt, sent.printer_id, sent.job_id);
        o.db
          .prepare(
            `INSERT INTO printer_runtime (printer_id, last_ack_at) VALUES (?, ?)
             ON CONFLICT (printer_id) DO UPDATE SET last_ack_at = excluded.last_ack_at, last_error = NULL`,
          )
          .run(sent.printer_id, at);
        logInfo({ job_id: sent.job_id, printer_id: sent.printer_id }, 'print.acked');
        hook('acked', () => o.hooks?.acked?.(sent, at));
      } else {
        const error = result.detail === null ? result.error : `${result.error}:${result.detail}`;
        const attempts = o.db
          .prepare(
            `UPDATE print_jobs SET attempts = attempts + 1, last_error = ?, sent_at = NULL,
                    is_reprint = CASE WHEN ? = 1 THEN 1 ELSE is_reprint END
             WHERE job_id = ? AND acked_at IS NULL AND cancelled_at IS NULL RETURNING attempts`,
          )
          .pluck()
          .get(error, result.wrote ? 1 : 0, sent.job_id) as number | undefined;
        o.db
          .prepare(
            `INSERT INTO printer_runtime (printer_id, last_error) VALUES (?, ?)
             ON CONFLICT (printer_id) DO UPDATE SET last_error = excluded.last_error`,
          )
          .run(sent.printer_id, error);
        logInfo({ job_id: sent.job_id, printer_id: sent.printer_id, attempts: attempts ?? 0, error: result.error }, 'print.failed');
        backoff = RETRY_DELAYS_MS[Math.min(Math.max((attempts ?? 1) - 1, 0), RETRY_DELAYS_MS.length - 1)]!;
        hook('failed', () => o.hooks?.failed?.(sent, result, at));
      }
    } catch (error) {
      logError({ job_id: sent.job_id, printer_id: sent.printer_id, err: (error as Error).message }, 'print.settle_failed');
      if (!result.ok) backoff ??= RETRY_DELAYS_MS[0];
    } finally {
      if (!stopped) {
        if (backoff !== null) {
          st.backoff = timers.setTimer(() => {
            st.backoff = null;
            pass();
          }, backoff);
        } else {
          pass();
        }
      }
    }
  };

  /** §3.7 send: render + encode + sent_at + sent_printer_id, synchronously; then the transport. false = cancelled. */
  const start = (row: HeadRow, st: PrinterState, at: number): boolean => {
    const width_cols = row.paper_width_mm === 58 ? 32 : 48;
    // sent_at set but not in flight here: the process that sent it died before the ack → REPRINT
    const resend = row.sent_at !== null;
    const job = resend ? { ...row, is_reprint: 1 } : row;
    let bytes: Buffer | null = null;
    let failed = false;
    try {
      const ctx = { db: o.db, state: o.state.get() as EngineState, now: at, utc_offset_ms: hubTime(o.clock).utc_offset_ms, width_cols } as const;
      const doc = docOf(job, (j) => renderJob(ctx, j));
      bytes = doc === null ? null : encodeDoc(doc, width_cols);
    } catch (error) {
      // a corrupt payload or Doc must not wedge the printer's FIFO; the row keeps the reason for the print-queue page
      logError({ job_id: row.job_id, err: (error as Error).message }, 'print.render_failed');
      failed = true;
    }
    if (bytes === null) {
      const reason = failed ? 'render_failed' : STALE_KINDS.has(row.kind) ? 'stale' : 'empty';
      o.db.prepare('UPDATE print_jobs SET cancelled_at = ?, sent_at = NULL, last_error = ? WHERE job_id = ?').run(at, reason, row.job_id);
      return false;
    }
    o.db
      .prepare(`UPDATE print_jobs SET sent_at = ?, sent_printer_id = ?, is_reprint = CASE WHEN ? = 1 THEN 1 ELSE is_reprint END WHERE job_id = ?`)
      .run(at, row.printer_id, resend ? 1 : 0, row.job_id);
    st.busy = true;
    inFlight.set(row.job_id, row.printer_id);
    logInfo({ job_id: row.job_id, printer_id: row.printer_id, bytes: bytes.length }, 'print.sent');
    const sent: SentJob = { job_id: row.job_id, kind: row.kind, printer_id: row.printer_id, station_id: row.station_id, ticket_id: row.ticket_id };
    let sending: Promise<SendResult>;
    try {
      sending = transportOf(row, st).send(bytes);
    } catch (error) {
      logError({ printer_id: row.printer_id, err: (error as Error).message }, 'print.transport_failed');
      sending = Promise.resolve({ ok: false, error: 'connect_failed', detail: 'transport', wrote: false });
    }
    sending
      .catch((): SendResult => ({ ok: false, error: 'write_failed', detail: null, wrote: false }))
      .then((result) => settle(sent, at, st, result))
      .catch((error: unknown) => logError({ job_id: row.job_id, err: (error as Error).message }, 'print.settle_failed'));
    return true;
  };

  const passOnce = (): void => {
    const at = now();
    // 1 statement: every pending job with the printer it goes to now, FIFO order
    const rows = o.db
      .prepare(
        `SELECT j.job_id, j.kind, j.station_id, j.ticket_id, j.payload, j.created_at, j.sent_at, j.is_reprint,
                p.printer_id, p.connection, p.address, p.paper_width_mm
         FROM print_jobs j
         LEFT JOIN station_outputs so ON j.printer_id IS NULL AND so.station_id = j.station_id
         JOIN printers p ON p.printer_id = COALESCE(j.printer_id, so.printer_id) AND p.archived_at IS NULL
         WHERE j.acked_at IS NULL AND j.cancelled_at IS NULL AND j.kind <> 'test'
         ORDER BY j.created_at, j.job_id`,
      )
      .all() as HeadRow[];
    const done = new Set<string>();
    for (const row of rows) {
      // in flight from this process (its station may have moved to another printer since): never sent twice
      if (inFlight.has(row.job_id) || done.has(row.printer_id)) continue;
      const st = stateOf(row.printer_id);
      if (st.busy || st.backoff !== null) {
        done.add(row.printer_id);
        continue;
      }
      try {
        // a cancelled head (empty / stale) lets the next job of the same printer go in the same pass
        if (start(row, st, at)) done.add(row.printer_id);
      } catch (error) {
        // one printer's broken row never blocks the others; it is retried next pass
        logError({ job_id: row.job_id, printer_id: row.printer_id, err: (error as Error).message }, 'print.send_failed');
        done.add(row.printer_id);
      }
    }
    hook('pass', () => o.hooks?.pass?.(at));
  };

  const pass = (): void => {
    if (stopped || running) return;
    running = true;
    try {
      passOnce();
    } catch (error) {
      logError({ err: (error as Error).message }, 'print.pass_failed');
    } finally {
      running = false;
    }
  };

  const arm = (): void => {
    loop = timers.setTimer(() => {
      loop = null;
      try {
        pass();
      } finally {
        if (!stopped) arm();
      }
    }, PRINT_LOOP_MS);
  };

  return {
    start() {
      if (stopped || loop !== null) return;
      arm();
    },
    pass,
    stop() {
      stopped = true;
      if (loop !== null) timers.clearTimer(loop);
      loop = null;
      for (const st of printers.values()) {
        if (st.backoff !== null) timers.clearTimer(st.backoff);
        st.backoff = null;
        st.transport?.close();
        st.transport = null;
      }
    },
  };
}
