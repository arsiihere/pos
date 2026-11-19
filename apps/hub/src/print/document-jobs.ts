import { DomainError } from '@pos/domain';
import type Database from 'better-sqlite3';
import type { WriterTx } from '../engine-host/writer.js';

// 03c v1.0.11 §3.7 "Retarget", §4.2 (⚠️ Changed by 05 (row P-2); v1.0.13 R-35 printer_name): 05's "Print to" (B18) and the bill view's job status.
// The worker is driven by the rows (worker.ts passOnce reads every pending job with its printer each pass), so moving
// `printer_id` is the whole retarget: the next pass sends it on the new printer's FIFO in its `created_at` place.
// "Nothing prints twice": a job being sent (`sent_at` set, not acked) is refused, so the worker's in-flight send and
// its guarded ack / failure write always name the printer it was sent to; a failed send has already cleared `sent_at`.
//
// State of a `document` job (one derivation for both exports):
//   cancelled_at set → 'cancelled'; acked_at set → 'printed'; sent_at set → 'printing';
//   attempts > 0 → 'failed' (a send failed and the retry waits; the worker's failure path sets attempts + 1 and
//   last_error); else 'waiting'. A retarget resets attempts and last_error, so the moved job is 'waiting'.

export type DocumentJobState = 'waiting' | 'printing' | 'printed' | 'failed' | 'cancelled';

export interface DocumentJobStatus {
  job_id: string;
  printer_id: string;
  /** 03c v1.0.13 §3.7 (R-35): the current printer's name (archived printers keep theirs); null when no `printers` row. */
  printer_name: string | null;
  state: DocumentJobState;
  last_error: string | null;
}

const STATE_SQL = `CASE WHEN j.cancelled_at IS NOT NULL THEN 'cancelled' WHEN j.acked_at IS NOT NULL THEN 'printed'
  WHEN j.sent_at IS NOT NULL THEN 'printing' WHEN j.attempts > 0 THEN 'failed' ELSE 'waiting' END`;

/**
 * §3.7: a `document` job not acked, not cancelled and not being sent moves to `printer_id` (`attempts = 0`,
 * `last_error = NULL`); the result is its new status. 1 statement (+1 to name a refusal). Errors (in this order):
 * unknown job or not a `document` job → 404 PRINT_JOB_NOT_FOUND { job_id }; printed / being sent / cancelled →
 * 409 PRINT_JOB_NOT_PENDING { job_id, state }; unknown or archived printer → 404 PRINTER_NOT_FOUND { printer_id }.
 */
export function retargetDocumentJob(tx: WriterTx, job_id: string, printer_id: string): DocumentJobStatus {
  const moved = tx.db
    .prepare(
      `UPDATE print_jobs SET printer_id = ?, attempts = 0, last_error = NULL
       WHERE job_id = ? AND kind = 'document' AND acked_at IS NULL AND cancelled_at IS NULL AND sent_at IS NULL
         AND EXISTS (SELECT 1 FROM printers WHERE printer_id = ? AND archived_at IS NULL)
       RETURNING job_id, printer_id, (SELECT name FROM printers WHERE printers.printer_id = print_jobs.printer_id) AS printer_name`,
    )
    .get(printer_id, job_id, printer_id) as { job_id: string; printer_id: string; printer_name: string } | undefined;
  if (moved !== undefined) return { ...moved, state: 'waiting', last_error: null };
  const why = tx.db
    .prepare(
      `SELECT (SELECT ${STATE_SQL} FROM print_jobs j WHERE j.job_id = ? AND j.kind = 'document') AS state,
              EXISTS (SELECT 1 FROM printers WHERE printer_id = ? AND archived_at IS NULL) AS printer_ok`,
    )
    .get(job_id, printer_id) as { state: DocumentJobState | null; printer_ok: 0 | 1 };
  if (why.state === null) throw new DomainError('PRINT_JOB_NOT_FOUND', { job_id });
  if (why.state === 'printed' || why.state === 'printing' || why.state === 'cancelled') {
    throw new DomainError('PRINT_JOB_NOT_PENDING', { job_id, state: why.state });
  }
  throw new DomainError('PRINTER_NOT_FOUND', { printer_id });
}

/**
 * §3.7, §4.2: the status of each known `document` job of `job_ids`, in the order asked; unknown and non-document ids
 * left out. A repeated id gives a repeated row (no de-duplication: one row per id asked, so the caller can zip).
 * `printer_name` (03c v1.0.13 R-35) is LEFT JOINed from `printers` by the job's current printer_id. 1 statement
 * (none asked → 0).
 */
export function documentJobsStatus(db: Database.Database, job_ids: readonly string[]): DocumentJobStatus[] {
  if (job_ids.length === 0) return [];
  return db
    .prepare(
      `SELECT j.job_id, j.printer_id, p.name AS printer_name, ${STATE_SQL} AS state, j.last_error
       FROM json_each(?) e JOIN print_jobs j ON j.job_id = e.value AND j.kind = 'document'
       LEFT JOIN printers p ON p.printer_id = j.printer_id
       ORDER BY e.key`,
    )
    .all(JSON.stringify(job_ids)) as DocumentJobStatus[];
}
