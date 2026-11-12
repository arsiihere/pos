import { DomainError, type Doc } from '@pos/domain';
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
