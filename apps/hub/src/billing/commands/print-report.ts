// 05 §6.22 `PrintReport { doc: 'x_report' | 'z_report', ref_id?, printer_id? }` (task 27b, a plan gap: task 27 built
// only PrintBillDocument), §3.16, H6-7, R-75, R-85 (1), 05 v1.0.26 R-87 (owner 2026-11-20). A print, not a money event:
// no event; one 03c `document` job + its `bill_print_jobs` row (R-75: a report is a bill-document job), written as the
// ZReportIssued fold writes it (`doc_kind 'report'`, `bill_id` NULL, `ref_id` = the business date) under printDocument's
// own job id (the writer's id, never the fold's `<event_id>:z`).
// R-87 readings: (1) `ref_id` is the Z's business date; a date closed twice prints its latest `z_no` (R-85 (1));
// (2) no `ref_id` = the latest Z; none → `404 Z_REPORT_NOT_FOUND { business_date: null }`; (3) an X with a `ref_id` →
// 400; (4) an X with no open day (or no branch config) → `409 BUSINESS_DAY_NOT_OPEN`; (5) printer = payload `printer_id`
// (active, else `404 PRINTER_NOT_FOUND`) → `report` route → default → skipped (`printed: false`, logged with ids only,
// R8); (6) the job id as above. Statements: X ≤ 13 (12 with `printer_id`), Z ≤ 9 (actual 7, 6 with `printer_id`).
// H16-5: staff names are read from `staff_names` at render only; they reach the Doc (print_jobs), never a log line, an
// event or the result.
import { buildReport, buildReportDoc, currencyExponent, DomainError, type ReportDocInput } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { hubTime } from '../../lib/hub-time.js';
import { billPrinterFor, printDocument } from '../../print/api.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { loadReportInput, reportStaffIds, staffNamesOf } from '../queries/reports.js';
import { activePrinter } from './print-check-bill.js';

export const PrintReportPayload = z
  .object({ doc: z.enum(['x_report', 'z_report']), ref_id: z.string().min(1).optional(), printer_id: z.string().min(1).optional() })
  .strict()
  .superRefine((p, issues) => {
    // R-87 (3): the X is the open day's, it takes no ref
    if (p.doc === 'x_report' && p.ref_id !== undefined) issues.addIssue({ code: 'custom', path: ['ref_id'], message: 'an X report takes no ref_id' });
  });

/** As PrintBillDocument's result: no printer routed → `printed: false` and nulls (R8). */
export interface PrintReportResult {
  printed: boolean;
  job_id: string | null;
  printer_name: string | null;
}

type Log = Pick<FastifyInstance['log'], 'info' | 'warn'>;

// R-85 (1), R-87 (1), (2): the latest Z of the date, or the latest Z (z_reports_day / the z_no key). 1 statement.
const Z_REPORT = `
SELECT business_date, z_no, issued_at, report_json FROM z_reports
WHERE @business_date IS NULL OR business_date = @business_date ORDER BY z_no DESC LIMIT 1`;
interface ZRow {
  business_date: string;
  z_no: number;
  issued_at: number;
  report_json: string;
}

const REPORT_JOB = `INSERT INTO bill_print_jobs (job_id, bill_id, doc_kind, ref_id, created_at) VALUES (?, NULL, 'report', ?, ?)`;

/**
 * §6.22. Permission `view-reports` (registry, resolved before the handler; a non-approvable command). X: the open day
 * (0) → printer (payload 1, else route 1 + row 1) → `loadReportInput` (7) + `buildReport` → names (1) →
 * `printDocument` (2) + `bill_print_jobs` (1) = 13 (12). Z: the stored Z (1) → printer (1 / 2) → names (1) →
 * `printDocument` (2) + `bill_print_jobs` (1) = 7 (6). The printer is resolved before the build, so a refused or a
 * skipped print builds nothing. Fixed whatever the number of shifts, invoices or payments.
 */
function printReportCommand(log: Log) {
  return defineCommand({
    commandType: 'PrintReport',
    payloadSchema: PrintReportPayload,
    sessionKind: 'device',
    // H6-7: one registry permission; PrintReport is non-approvable, so a `requires_approval` grant of view-reports is
    // refused (403 PERMISSION_DENIED) by 00 before the handler, as `allowed` is the only grant that runs it
    permission: 'view-reports',
    handle(ctx, p): { events: []; result: PrintReportResult } {
      const db = ctx.tx.db;
      let z: ZRow | null = null;
      if (p.doc === 'z_report') {
        z = (db.prepare(Z_REPORT).get({ business_date: p.ref_id ?? null }) as ZRow | undefined) ?? null; // 1
        if (z === null) throw new DomainError('Z_REPORT_NOT_FOUND', { business_date: p.ref_id ?? null });
      }
      const day = ctx.state.business_day ?? null;
      const config = branchConfig();
      if (p.doc === 'x_report' && (day === null || day.closed_at !== null || config === null)) throw new DomainError('BUSINESS_DAY_NOT_OPEN');

      let printer: ReturnType<typeof activePrinter>;
      if (p.printer_id !== undefined) {
        printer = activePrinter(db, p.printer_id); // +1
        if (printer === null) throw new DomainError('PRINTER_NOT_FOUND', { printer_id: p.printer_id });
      } else {
        const routed = billPrinterFor(db, { report: true }); // +1: the report route, else default (§3.16)
        printer = routed === null ? null : activePrinter(db, routed); // +1
      }
      const business_date = z?.business_date ?? day!.business_date;
      const ids = { doc: p.doc, business_date, z_no: z?.z_no ?? null, command_type: 'PrintReport' };
      if (printer === null) {
        log.info(ids, 'report print skipped: no printer routed');
        return { events: [], result: { printed: false, job_id: null, printer_name: null } };
      }

      let report: ReportDocInput;
      let at: number;
      if (z !== null) {
        report = JSON.parse(z.report_json) as ReportDocInput;
        at = z.issued_at;
      } else {
        at = ctx.clock.branchNow();
        const input = loadReportInput(db, config!, { kind: 'x', z_no: null, business_date, opened_at: day!.opened_at, issued_at: at }); // +7
        // R-84 (2): ids only, never a name or an amount
        report = buildReport(input, { warn: (w) => log.warn({ code: w.code, reopen_id: w.reopen_id, credit_invoice_id: w.credit_invoice_id }, 'billing.report_warning') });
      }
      const doc = buildReportDoc(report, staffNamesOf(db, reportStaffIds(report)), {
        // +1
        width_cols: printer.paper_width_mm === 58 ? 32 : 48,
        currency_exponent: currencyExponent(report.currency_code),
        utc_offset_ms: hubTime({ branchNow: () => at }).utc_offset_ms,
      });
      const { job_id } = printDocument(ctx.tx, printer.printer_id, doc, { kind_label: p.doc === 'x_report' ? 'X report' : 'Z report' }); // +2
      db.prepare(REPORT_JOB).run(job_id, business_date, ctx.clock.branchNow()); // +1
      return { events: [], result: { printed: true, job_id, printer_name: printer.name } };
    },
  });
}

export function registerPrintReport(app: FastifyInstance): void {
  commandRegistry(app).register(printReportCommand(app.log));
}
