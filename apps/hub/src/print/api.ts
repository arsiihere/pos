import { DomainError, type Doc } from '@pos/domain';
import type Database from 'better-sqlite3';
import type { WriterTx } from '../engine-host/writer.js';

// 03c §3.9, §4.2 (task c18): the print API for 05. A `document` job in the caller's transaction (bill close), so it
// commits or rolls back with it; the worker prints it later on that printer (it keeps its own printer_id, §3.2), and
// a printer outage never blocks the caller (R8). Payload `{ doc, kind_label? }` (what the worker renders at send).
// Drawer kick = a Doc with `{ drawer: true }`; preview = renderText(doc, width). Statements 2.

export function printDocument(tx: WriterTx, printer_id: string, doc: Doc, meta?: { kind_label: string }): { job_id: string } {
  const active = tx.db.prepare('SELECT 1 FROM printers WHERE printer_id = ? AND archived_at IS NULL').pluck().get(printer_id);
  if (active === undefined) throw new DomainError('PRINTER_NOT_FOUND', { printer_id });
  const job_id = tx.ids.next();
  const payload = JSON.stringify(meta === undefined ? { doc } : { doc, kind_label: meta.kind_label });
  tx.db
    .prepare(`INSERT INTO print_jobs (job_id, kind, printer_id, station_id, ticket_id, order_id, payload, created_at) VALUES (?, 'document', ?, NULL, NULL, NULL, ?, ?)`)
    .run(job_id, printer_id, payload, tx.clock.branchNow());
  return { job_id };
}

// ⚠️ Changed by v1.0.6 (owner 2026-11-12, Q-20) 03c §3.8: does a station print? Output mode `both` / `printer` with a
// printer that is not archived (a `screen` station's fallback printer does not count: the KDS shows Reprint only where
// tickets print at fire). For 03b's `kds_station` `has_printer` (03b v1.0.6 §6.14) and the `station_notice
// { kind: 'output' }` diff (print/config-hook.ts). 1 statement.
const HAS_PRINTER_SQL = `SELECT so.station_id FROM station_outputs so JOIN printers p ON p.printer_id = so.printer_id
  WHERE so.mode IN ('both', 'printer') AND p.archived_at IS NULL`;

/** §3.8: the stations of `station_ids` that print (1 statement; none asked → 0 statements). */
export function stationHasPrinter(db: Database.Database, station_ids: readonly string[]): Set<string> {
  if (station_ids.length === 0) return new Set();
  const ids = db
    .prepare(`${HAS_PRINTER_SQL} AND so.station_id IN (SELECT value FROM json_each(?))`)
    .pluck()
    .all(JSON.stringify(station_ids)) as string[];
  return new Set(ids);
}

/** Every station that prints (1 statement): the before / after sets of the `station_notice { kind: 'output' }` diff. */
export function stationsWithPrinter(db: Database.Database): Set<string> {
  return new Set(db.prepare(HAS_PRINTER_SQL).pluck().all() as string[]);
}
