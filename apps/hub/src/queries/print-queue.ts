import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Resolution } from '../auth/staff-directory.js';
import { defineQuery, queryRegistry, type QueryCtx } from './registry.js';

// 03c §6.7, §3.10 (task c20): GET /admin/queries/print-queue — admin session, `manage-devices` checked inside handle.
// `{ printers: [{ printer_id, name, status, waiting, suspect, head_error, last_ack_at }], jobs: [...pending, newest 100] }`.
// Statements 2. A station job goes to its station's current printer (§3.2), as the worker sends it. `status` is the
// last reading (`unknown` before any). `head_error` = the FIFO head's last_error. Printers: every active one, plus an
// archived one that still has pending jobs or unresolved suspects. `no_printer` (review of c20): pending jobs whose station
// has no printer now (output removed or set to screen without one) — they wait and never print; each such job is
// flagged `no_printer: true` (counted in the jobs statement, a window over all pending rows before the LIMIT).

export const PRINT_QUEUE_JOBS_LIMIT = 100;

const PENDING = `SELECT j.*, COALESCE(j.printer_id, so.printer_id) AS to_printer
  FROM print_jobs j LEFT JOIN station_outputs so ON j.printer_id IS NULL AND so.station_id = j.station_id
 WHERE j.acked_at IS NULL AND j.cancelled_at IS NULL AND j.kind <> 'test'`;

const PRINTERS_SQL = `
WITH pending AS (${PENDING}),
     heads AS (SELECT to_printer, last_error, ROW_NUMBER() OVER (PARTITION BY to_printer ORDER BY created_at, job_id) AS rn FROM pending)
SELECT p.printer_id, p.name, COALESCE(r.last_status, 'unknown') AS status,
       (SELECT COUNT(*) FROM pending q WHERE q.to_printer = p.printer_id) AS waiting,
       (SELECT COUNT(*) FROM print_jobs s WHERE s.sent_printer_id = p.printer_id
          AND s.suspect_at IS NOT NULL AND s.suspect_resolved_at IS NULL) AS suspect,
       (SELECT h.last_error FROM heads h WHERE h.to_printer = p.printer_id AND h.rn = 1) AS head_error,
       r.last_ack_at
  FROM printers p LEFT JOIN printer_runtime r ON r.printer_id = p.printer_id
 WHERE p.archived_at IS NULL
    OR EXISTS (SELECT 1 FROM pending q WHERE q.to_printer = p.printer_id)
    OR EXISTS (SELECT 1 FROM print_jobs s WHERE s.sent_printer_id = p.printer_id AND s.suspect_at IS NOT NULL AND s.suspect_resolved_at IS NULL)
 ORDER BY p.name, p.printer_id`;

const JOBS_SQL = `
SELECT job_id, kind, to_printer AS printer_id, station_id, ticket_id, order_id, created_at, sent_at, attempts, last_error,
       is_reprint, suspect_at, COUNT(*) FILTER (WHERE to_printer IS NULL) OVER () AS no_printer_total
  FROM (${PENDING}) ORDER BY created_at DESC, job_id DESC LIMIT ${PRINT_QUEUE_JOBS_LIMIT}`;

function requireManageDevices(ctx: QueryCtx): void {
  const staffId = ctx.session?.staff_id ?? null;
  const resolution: Resolution = staffId === null ? { grant: 'not_granted' } : ctx.directory.resolve(staffId, 'manage-devices');
  if (resolution.grant !== 'allowed') throw new DomainError('PERMISSION_DENIED', { permission: 'manage-devices', grant: resolution.grant });
}

export function registerPrintQueueQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'print-queue',
      sessionKind: 'admin',
      session: 'none',
      countsAsActivity: false,
      querySchema: z.object({}),
      handle(ctx) {
        requireManageDevices(ctx);
        const printers = ctx.db.prepare(PRINTERS_SQL).all();
        const rows = ctx.db.prepare(JOBS_SQL).all() as Array<Record<string, unknown>>;
        // pending jobs that go to no printer now (their station's output lost its printer): counted over all pending
        const no_printer = (rows[0]?.no_printer_total as number | undefined) ?? 0;
        const jobs = rows.map((r) => {
          const { no_printer_total, ...j } = r;
          void no_printer_total;
          return { ...j, is_reprint: j.is_reprint === 1, no_printer: j.printer_id === null };
        });
        return { data: { printers, jobs, no_printer } };
      },
    }),
  );
}
