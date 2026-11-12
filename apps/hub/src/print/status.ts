import { ALERT_CONSTANTS } from '@pos/domain';
import type Database from 'better-sqlite3';
import { Socket } from 'node:net';
import { alerts, type RaiseInput } from '../alerts/raise.js';
import type { Writer } from '../engine-host/writer.js';
import { stationPresence } from '../kds/contracts.js';
import type { Clock } from '../lib/clock.js';
import { PRINTER_PROBLEM_KIND } from './kinds.js';
import { nodeTimers, parseLanAddress, PRINT_WRITE_TIMEOUT_MS, type PrintTimers } from './transport/lan.js';
import { usbStatus } from './transport/usb.js';
import type { PrintWorkerHooks, SentJob } from './worker.js';

// 03c §3.5, §3.7, D4, §6.10 (task c15): status reads, suspect marking and recovery, `printer_problem`.
// - Status reads: LAN, and USB once its test print proved status (supports_status = 1; c19, through the worker's own
//   USB child, usb.ts usbStatus), at most once per
//   10 s per printer and only when there is something to learn (an ack since the last read, an open problem, a bad
//   last status), plus right after a failure. DLE EOT 1 + DLE EOT 4 on their own socket, 2 s timeout; no answer =
//   `unknown`. Never blocks the FIFO: the worker does not wait for it.
// - Bad read (paper out / offline): every job of the printer acked since its last clean status turns suspect
//   (1 statement). Clean read: last_clean_at = now − 10 s (a buffer drain), never backwards. Any clean reading with
//   unresolved suspects (or a clean test print, c19 calls recoverSuspects): one recovery job per ticket, REPRINT
//   header. Reading + marking + recovery are one transaction.
// - printer_problem (dedupe printer_problem:<printer_id>), raised inside writer.run with alerts.tickCtx(tx, now):
//   head job failing ≥ printer_alert_ms (30 s), a status error bit, an unalerted print_fold_skips row of a station
//   that prints at fire (or a screen station that is dark). Closed `done` at the next ack with clean or unknown
//   status; `obsolete` on archive, or when nothing is pending and the status is clean or unknown.
//   C3-3 (03c v1.0.5): `ticket_not_built` is one alert per fold skip (dedupe printer_problem:ticket_not_built:<event_id>)
//   and is never closed automatically; only a manager (or 01d's day close) closes it.
// Pass cost: 1 statement (+ the writes of whatever changed). The worker's writes stay its own; these are
// printer_runtime / print_jobs / print_fold_skips plain statements between transactions, and the alert events.

export const STATUS_INTERVAL_MS = 10_000;
export const STATUS_TIMEOUT_MS = 2_000;
/** 01d ALERT_CONSTANTS.printer_alert_ms (P0.2): 30 s */
export const PRINTER_ALERT_MS = ALERT_CONSTANTS.printer_alert_ms;

export type PrinterStatus = 'clean' | 'paper_out' | 'offline' | 'unknown';
const BAD = new Set<string>(['paper_out', 'offline']);

const DLE = 0x10;
const EOT = 0x04;

/** Epson DLE EOT 1 (printer: bit 3 offline) and DLE EOT 4 (roll paper: bits 5 + 6 paper end). null = no answer. */
export function parseStatus(eot1: number | null, eot4: number | null): PrinterStatus {
  if (eot1 === null || eot4 === null) return 'unknown';
  if ((eot1 & 0x08) !== 0) return 'offline';
  if ((eot4 & 0x60) !== 0) return 'paper_out';
  return 'clean';
}

/** One real-time status read over its own socket; never rejects (any failure or the 2 s timeout → unknown). */
export function readLanStatus(address: string, o: { timers?: PrintTimers; timeoutMs?: number; socket?: () => Socket } = {}): Promise<PrinterStatus> {
  const timers = o.timers ?? nodeTimers;
  return new Promise<PrinterStatus>((resolve) => {
    const socket = o.socket?.() ?? new Socket();
    const answers: number[] = [];
    let settled = false;
    const finish = (status: PrinterStatus): void => {
      if (settled) return;
      settled = true;
      timers.clearTimer(timer);
      socket.destroy();
      resolve(status);
    };
    const timer = timers.setTimer(() => finish('unknown'), o.timeoutMs ?? STATUS_TIMEOUT_MS);
    socket.on('error', () => finish('unknown'));
    socket.on('close', () => finish('unknown'));
    socket.on('data', (d: Buffer) => {
      answers.push(...d);
      if (answers.length >= 2) finish(parseStatus(answers[0]!, answers[1]!));
    });
    socket.once('connect', () => socket.write(Uint8Array.of(DLE, EOT, 1, DLE, EOT, 4)));
    if (o.socket === undefined) {
      try {
        socket.connect(parseLanAddress(address));
      } catch {
        finish('unknown');
      }
    }
  });
}

/**
 * §3.5 the only suspect rule: every job of the printer acked since its last clean status and not yet suspect.
 * 1 statement; returns the number marked.
 */
export function markSuspects(db: Database.Database, printer_id: string, now: number): number {
  return db
    .prepare(
      `UPDATE print_jobs SET suspect_at = @now
       WHERE sent_printer_id = @printer_id AND suspect_at IS NULL AND acked_at IS NOT NULL
         AND acked_at > COALESCE((SELECT last_clean_at FROM printer_runtime WHERE printer_id = @printer_id), 0)`,
    )
    .run({ now, printer_id }).changes;
}

/**
 * §3.5 suspect recovery (any clean reading with unresolved suspects, or a clean test print — c19): per ticket with unresolved suspects of
 * this printer, one recovery job `ticket_id:recover:<last_clean_at>` (INSERT OR IGNORE, REPRINT header):
 * `reprint` when a kitchen / reprint job of the ticket is suspect and the ticket has a live, not-done line, plus its
 * latest suspect FIRST slip again (`ticket_id:recover:first:<last_clean_at>`, C3-2) while a FIRST line is not done; otherwise the latest suspect slip again (`cancel` → `cancel`, `first` → `first`) while its line is not done.
 * Then every suspect of the printer is resolved. 3 statements.
 */
export function recoverSuspects(db: Database.Database, printer_id: string, now: number): { queued: number; resolved: number } {
  const rows = db
    .prepare(
      `WITH s AS (
         SELECT j.job_id, j.kind, j.ticket_id, j.station_id, j.order_id, j.payload,
                ROW_NUMBER() OVER (PARTITION BY j.ticket_id ORDER BY j.acked_at DESC, j.job_id DESC) AS rn,
                ROW_NUMBER() OVER (PARTITION BY j.ticket_id, j.kind = 'first' ORDER BY j.acked_at DESC, j.job_id DESC) AS rn_kind,
                MAX(j.kind IN ('kitchen', 'reprint')) OVER (PARTITION BY j.ticket_id) AS has_ticket
         FROM print_jobs j
         WHERE j.sent_printer_id = @printer_id AND j.suspect_at IS NOT NULL AND j.suspect_resolved_at IS NULL
           AND j.ticket_id IS NOT NULL
       ),
       pick AS (
         -- the ticket's recovery: reprint when a kitchen / reprint job is suspect, else its latest slip (C3-2)
         SELECT s.ticket_id, s.station_id, s.order_id, '' AS tag,
                CASE WHEN s.has_ticket THEN 'reprint' ELSE s.kind END AS kind,
                CASE WHEN s.has_ticket THEN json_object('ticket_id', s.ticket_id) ELSE s.payload END AS payload
         FROM s WHERE s.rn = 1
         UNION ALL
         -- C3-2 (owner 2026-11-12): with that reprint, the ticket's latest suspect FIRST slip goes again too
         SELECT s.ticket_id, s.station_id, s.order_id, 'first:' AS tag, 'first' AS kind, s.payload
         FROM s WHERE s.has_ticket AND s.kind = 'first' AND s.rn_kind = 1
       )
       SELECT pick.ticket_id, pick.station_id, pick.order_id, pick.tag, pick.kind, pick.payload,
              CASE WHEN pick.kind = 'reprint' THEN EXISTS (
                     SELECT 1 FROM ticket_lines tl JOIN order_lines l ON l.order_item_id = tl.order_item_id
                     WHERE tl.ticket_id = pick.ticket_id AND tl.done_at IS NULL
                       AND l.units - l.removed_units - l.voided_units > 0)
                   WHEN pick.kind = 'cancel' THEN EXISTS (
                     SELECT 1 FROM ticket_lines tl WHERE tl.ticket_id = pick.ticket_id AND tl.done_at IS NULL
                       AND tl.order_item_id = json_extract(pick.payload, '$.order_item_id'))
                   WHEN pick.kind = 'first' THEN EXISTS (
                     SELECT 1 FROM ticket_lines tl WHERE tl.ticket_id = pick.ticket_id AND tl.done_at IS NULL
                       AND tl.order_item_id IN (SELECT value FROM json_each(pick.payload, '$.order_item_ids')))
                   ELSE 0 END AS live,
              (SELECT last_clean_at FROM printer_runtime WHERE printer_id = @printer_id) AS clean_at
       FROM pick`,
    )
    .all({ printer_id }) as Array<{ ticket_id: string; station_id: string | null; order_id: string | null; tag: string; kind: string; payload: string; live: number; clean_at: number | null }>;
  const queue = rows
    .filter((r) => r.live === 1 && (r.kind === 'reprint' || r.kind === 'cancel' || r.kind === 'first'))
    .map((r) => ({ job_id: `${r.ticket_id}:recover:${r.tag}${r.clean_at ?? now}`, kind: r.kind, station_id: r.station_id, ticket_id: r.ticket_id, order_id: r.order_id, payload: r.payload }));
  let queued = 0;
  if (queue.length > 0) {
    queued = db
      .prepare(
        `INSERT OR IGNORE INTO print_jobs (job_id, kind, printer_id, station_id, ticket_id, order_id, payload, created_at, is_reprint)
         SELECT json_extract(value, '$.job_id'), json_extract(value, '$.kind'), NULL, json_extract(value, '$.station_id'),
                json_extract(value, '$.ticket_id'), json_extract(value, '$.order_id'), json_extract(value, '$.payload'), @now, 1
         FROM json_each(@queue)`,
      )
      .run({ queue: JSON.stringify(queue), now }).changes;
  }
  const resolved = db
    .prepare(
      `UPDATE print_jobs SET suspect_resolved_at = ?
       WHERE sent_printer_id = ? AND suspect_at IS NOT NULL AND suspect_resolved_at IS NULL`,
    )
    .run(now, printer_id).changes;
  return { queued, resolved };
}

export interface StatusPrinter {
  printer_id: string;
  connection: 'lan' | 'usb';
  address: string;
}

export interface PrintStatusLog {
  info?(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface PrintStatusOptions {
  db: Database.Database;
  writer: Writer;
  clock: Clock;
  branch_id: string;
  timers?: PrintTimers;
  /** test seam: the status read (default: LAN DLE EOT over its own socket) */
  readStatus?: (printer: StatusPrinter) => Promise<PrinterStatus>;
  log?: PrintStatusLog;
}

export interface PrintStatus {
  /** for createPrintWorker({ hooks }) (c16 wires them) */
  hooks: Required<PrintWorkerHooks>;
  /** one status reading of a printer (a read, or c19's test print); synchronous writes + alerts */
  applyStatus(printer_id: string, status: PrinterStatus, at: number): void;
  stop(): void;
}

interface PassRow {
  printer_id: string;
  name: string;
  connection: 'lan' | 'usb';
  address: string;
  archived: number;
  supports_status: number | null;
  last_status: string | null;
  last_status_at: number | null;
  last_ack_at: number | null;
  problem_alert_id: string | null;
  open_problem: string | null;
  waiting: number;
  skips: string;
  failing_live: number;
}

export function createPrintStatus(o: PrintStatusOptions): PrintStatus {
  const timers = o.timers ?? nodeTimers;
  const reading = new Set<string>();
  const urgent = new Set<string>();
  /** printer → the head job failing and since when (cleared at an ack) */
  const failing = new Map<string, { job_id: string; since: number }>();
  const names = new Map<string, string>();
  let stopped = false;

  const guard = (what: string, fn: () => void): void => {
    try {
      fn();
    } catch (error) {
      try {
        o.log?.error({ what, err: (error as Error).message }, 'print.status_failed');
      } catch {
        // never throws into the worker
      }
    }
  };

  const raise = (printer_id: string, problem: 'paper_out' | 'offline' | 'not_printing', waiting: number, at: number): void => {
    const input: RaiseInput = {
      kind: PRINTER_PROBLEM_KIND,
      subject: { stream_type: 'hub', stream_id: o.branch_id },
      target: { kind: 'managers' },
      values: { printer_id, waiting },
      display: { kind_label_key: 'alert.printer_problem.card' },
      details: { printer_name: (names.get(printer_id) ?? printer_id).slice(0, 40), problem },
      dedupe_key: `printer_problem:${printer_id}`,
    };
    o.writer.run((tx) => {
      const r = alerts.raise(alerts.tickCtx(tx, at), input);
      if (r.events.length > 0) tx.append(r.events);
      tx.db
        .prepare(
          `INSERT INTO printer_runtime (printer_id, problem_alert_id) VALUES (?, ?)
           ON CONFLICT (printer_id) DO UPDATE SET problem_alert_id = excluded.problem_alert_id`,
        )
        .run(printer_id, r.alert_id);
    });
    o.log?.info?.({ printer_id, problem, waiting }, 'print.problem_raised');
  };

  /**
   * §3.7, C3-3 (03c v1.0.5): one `ticket_not_built` alert per fold skip (dedupe printer_problem:ticket_not_built:<event_id>),
   * never auto-closed, never absorbed into another open problem; all due skips of a pass in one raiseMany (fixed
   * statements) with their `alerted_at` in the same transaction. Not tracked in problem_alert_id.
   */
  const raiseSkips = (due: Array<{ printer_id: string; event_id: string; waiting: number }>, at: number): void => {
    if (due.length === 0) return;
    const inputs: RaiseInput[] = due.map((d) => ({
      kind: PRINTER_PROBLEM_KIND,
      subject: { stream_type: 'hub', stream_id: o.branch_id },
      target: { kind: 'managers' },
      values: { printer_id: d.printer_id, waiting: d.waiting },
      display: { kind_label_key: 'alert.printer_problem.card' },
      details: { printer_name: (names.get(d.printer_id) ?? d.printer_id).slice(0, 40), problem: 'ticket_not_built' },
      dedupe_key: `printer_problem:ticket_not_built:${d.event_id}`,
    }));
    o.writer.run((tx) => {
      const drafts = alerts.raiseMany(alerts.tickCtx(tx, at), inputs).flatMap((r) => r.events);
      if (drafts.length > 0) tx.append(drafts);
      tx.db
        .prepare(`UPDATE print_fold_skips SET alerted_at = ? WHERE event_id IN (SELECT value FROM json_each(?)) AND alerted_at IS NULL`)
        .run(at, JSON.stringify(due.map((d) => d.event_id)));
    });
    o.log?.info?.({ skips: due.length }, 'print.problem_raised');
  };

  const close = (printer_id: string, alert_id: string, reason: 'done' | 'obsolete', at: number): void => {
    o.writer.run((tx) => {
      const drafts = alerts.closeMany(alerts.tickCtx(tx, at), [{ alert_id, reason }]);
      if (drafts.length > 0) tx.append(drafts);
      tx.db.prepare('UPDATE printer_runtime SET problem_alert_id = NULL WHERE printer_id = ? AND problem_alert_id = ?').run(printer_id, alert_id);
    });
  };

  const applyStatus = (printer_id: string, status: PrinterStatus, at: number): void => {
    const prev = o.db
      .prepare(
        `SELECT r.last_status, r.problem_alert_id,
                (SELECT COUNT(*) FROM print_jobs s WHERE s.sent_printer_id = @printer_id
                  AND s.suspect_at IS NOT NULL AND s.suspect_resolved_at IS NULL) AS suspects,
                (SELECT COUNT(*) FROM print_jobs j LEFT JOIN station_outputs so ON j.printer_id IS NULL AND so.station_id = j.station_id
                  WHERE j.acked_at IS NULL AND j.cancelled_at IS NULL AND j.kind <> 'test'
                    AND COALESCE(j.printer_id, so.printer_id) = @printer_id) AS waiting
         FROM (SELECT 1) LEFT JOIN printer_runtime r ON r.printer_id = @printer_id`,
      )
      .get({ printer_id }) as { last_status: string | null; waiting: number; suspects: number };
    // One transaction: the reading, its suspect marking and any recovery land together or not at all (a crash in
    // between leaves the suspects unresolved and the old status; the next clean reading recovers them).
    const { marked, recovered } = o.db.transaction(() => {
      // a bad read marks against the last clean status as it stands (before this reading)
      const m = BAD.has(status) ? markSuspects(o.db, printer_id, at) : 0;
      o.db
        .prepare(
          `INSERT INTO printer_runtime (printer_id, supports_status, last_status, last_status_at, last_clean_at)
           VALUES (@printer_id, @supports, @status, @at, CASE WHEN @status = 'clean' THEN @clean ELSE NULL END)
           ON CONFLICT (printer_id) DO UPDATE SET
             supports_status = COALESCE(@supports, supports_status),
             last_status = @status, last_status_at = @at,
             last_clean_at = CASE WHEN @status = 'clean' THEN MAX(COALESCE(last_clean_at, @clean), @clean) ELSE last_clean_at END`,
        )
        .run({ printer_id, supports: status === 'unknown' ? null : 1, status, at, clean: at - PRINT_WRITE_TIMEOUT_MS });
      // §3.5: any clean reading recovers what is still suspect, whatever the reading before it was (bad → unknown → clean)
      const r = status === 'clean' && prev.suspects > 0 ? recoverSuspects(o.db, printer_id, at) : null;
      return { marked: m, recovered: r };
    })();
    if (marked > 0) o.log?.info?.({ printer_id, suspects: marked }, 'print.suspect');
    if (recovered !== null) o.log?.info?.({ printer_id, queued: recovered.queued, resolved: recovered.resolved }, 'print.suspect_recovered');
    if (BAD.has(status)) raise(printer_id, status as 'paper_out' | 'offline', prev.waiting, at);
  };

  const read = (p: PassRow): void => {
    reading.add(p.printer_id);
    urgent.delete(p.printer_id);
    // c19 (integrator ruling (b) on #72): a USB printer is read through the worker's own child (usbStatus, no second open)
    const reader =
      o.readStatus ??
      ((x: StatusPrinter) =>
        x.connection === 'usb' ? usbStatus(x.address).then((a) => (a === null ? 'unknown' : parseStatus(a.eot1, a.eot4))) : readLanStatus(x.address, { timers }));
    let pending: Promise<PrinterStatus>;
    try {
      pending = reader({ printer_id: p.printer_id, connection: p.connection, address: p.address });
    } catch {
      pending = Promise.resolve('unknown');
    }
    pending
      .catch((): PrinterStatus => 'unknown')
      .then((status) => {
        reading.delete(p.printer_id);
        if (!stopped) guard('apply', () => applyStatus(p.printer_id, status, o.clock.branchNow()));
      })
      .catch(() => undefined);
  };

  const darkStations = (): Set<string> => {
    try {
      return new Set([...stationPresence()].filter(([, s]) => s.dark).map(([id]) => id));
    } catch {
      // 03b b20 not built yet: no station is dark
      return new Set();
    }
  };

  const pass = (now: number): void => {
    if (stopped) return;
    // 1 statement: active printers (and archived ones still holding an alert) with what the rules need
    const rows = o.db
      .prepare(
        `SELECT p.printer_id, p.name, p.connection, p.address, p.archived_at IS NOT NULL AS archived,
                r.supports_status, r.last_status, r.last_status_at, r.last_ack_at, r.problem_alert_id,
                (SELECT json_extract(a.details_json, '$.problem') FROM alerts a
                  WHERE a.alert_id = r.problem_alert_id AND a.state = 'open') AS open_problem,
                (SELECT COUNT(*) FROM print_jobs j LEFT JOIN station_outputs so ON j.printer_id IS NULL AND so.station_id = j.station_id
                  WHERE j.acked_at IS NULL AND j.cancelled_at IS NULL AND j.kind <> 'test'
                    AND COALESCE(j.printer_id, so.printer_id) = p.printer_id) AS waiting,
                (SELECT json_group_array(json_object('event_id', k.event_id, 'station_id', k.station_id, 'mode', so2.mode))
                   FROM print_fold_skips k JOIN station_outputs so2 ON so2.station_id = k.station_id
                  WHERE so2.printer_id = p.printer_id AND k.alerted_at IS NULL) AS skips,
                EXISTS (SELECT 1 FROM json_each(@failing) f JOIN print_jobs fj ON fj.job_id = f.value
                         WHERE f.key = p.printer_id AND fj.acked_at IS NULL AND fj.cancelled_at IS NULL) AS failing_live
         FROM printers p LEFT JOIN printer_runtime r ON r.printer_id = p.printer_id
         WHERE p.archived_at IS NULL OR r.problem_alert_id IS NOT NULL`,
      )
      .all({ failing: JSON.stringify(Object.fromEntries([...failing].map(([id, f]) => [id, f.job_id]))) }) as PassRow[];
    let dark: Set<string> | null = null;
    const dueSkips: Array<{ printer_id: string; event_id: string; waiting: number }> = [];
    for (const p of rows) {
      names.set(p.printer_id, p.name);
      guard('pass', () => {
        const open = p.problem_alert_id !== null && p.open_problem !== null;
        if (p.archived === 1) {
          if (p.problem_alert_id !== null) close(p.printer_id, p.problem_alert_id, 'obsolete', now);
          return;
        }
        // skips of stations that print at fire, or of a screen station while it is dark
        const skips = JSON.parse(p.skips) as Array<{ event_id: string; station_id: string; mode: string }>;
        const due = skips.filter((s) => s.mode !== 'screen' || (dark ??= darkStations()).has(s.station_id));
        for (const d of due) dueSkips.push({ printer_id: p.printer_id, event_id: d.event_id, waiting: p.waiting });
        // the failing timer stops when nothing waits or its job is no longer pending (cancelled stale / empty / manager)
        if (failing.has(p.printer_id) && (p.waiting === 0 || p.failing_live !== 1)) failing.delete(p.printer_id);
        if (p.problem_alert_id !== null && !open) {
          // closed by a manager or day close: forget it; a still failing head re-raises only after another 30 s
          o.db.prepare('UPDATE printer_runtime SET problem_alert_id = NULL WHERE printer_id = ?').run(p.printer_id);
          const still = failing.get(p.printer_id);
          if (still !== undefined) failing.set(p.printer_id, { ...still, since: now });
        }
        const f = failing.get(p.printer_id);
        if (f !== undefined && p.waiting > 0 && now - f.since >= PRINTER_ALERT_MS && !open) {
          raise(p.printer_id, 'not_printing', p.waiting, now);
          return;
        }
        const quiet = p.last_status === null || !BAD.has(p.last_status);
        if (open && p.waiting === 0 && quiet && f === undefined) close(p.printer_id, p.problem_alert_id!, 'obsolete', now);
        // status reads: LAN, and USB once its test print proved status (§3.7; c19, C3-1: through the worker's child)
        const capable = p.connection === 'lan' || p.supports_status === 1;
        if (!capable || reading.has(p.printer_id)) return;
        const interval = p.last_status_at === null || now - p.last_status_at >= STATUS_INTERVAL_MS;
        const something = (p.last_ack_at !== null && (p.last_status_at === null || p.last_ack_at > p.last_status_at)) || open || !quiet;
        if (urgent.has(p.printer_id) || (interval && something)) read(p);
      });
    }
    guard('skips', () => raiseSkips(dueSkips, now));
  };

  const acked = (job: SentJob, at: number): void => {
    // the worker calls this after its guarded UPDATE: a job a manager cancelled meanwhile is not an ack here
    const row = o.db
      .prepare(
        `SELECT j.acked_at, r.last_status, r.problem_alert_id,
                (SELECT 1 FROM alerts a WHERE a.alert_id = r.problem_alert_id AND a.state = 'open') AS open
         FROM print_jobs j LEFT JOIN printer_runtime r ON r.printer_id = j.sent_printer_id
         WHERE j.job_id = ? AND j.sent_printer_id = ?`,
      )
      .get(job.job_id, job.printer_id) as { acked_at: number | null; last_status: string | null; problem_alert_id: string | null; open: number | null } | undefined;
    if (row === undefined || row.acked_at === null) return;
    failing.delete(job.printer_id);
    if (row.open === 1 && (row.last_status === null || !BAD.has(row.last_status))) close(job.printer_id, row.problem_alert_id!, 'done', at);
  };

  const failed = (job: SentJob, _result: unknown, at: number): void => {
    const f = failing.get(job.printer_id);
    if (f === undefined || f.job_id !== job.job_id) failing.set(job.printer_id, { job_id: job.job_id, since: at });
    urgent.add(job.printer_id);
  };

  return {
    hooks: {
      acked: (job, at) => guard('acked', () => acked(job, at)),
      failed: (job, result, at) => guard('failed', () => failed(job, result, at)),
      pass: (now) => guard('pass', () => pass(now)),
    },
    applyStatus,
    stop() {
      stopped = true;
    },
  };
}
