// 05 §6.4, §3.16, B17 (task 11): the live-only print folds of billing (§6.30 "live-only print folds"), 03c's job-fold
// pattern (print/tickets-projection.ts): projection `billing_prints`, forward-only (no `reset`), registered after
// `billing` and `shifts`, so it reads the bills / seating rows the earlier folds of the same event wrote. Its jobs are
// written only when mode === 'live', never in 'catchup' (D1: a replay or a rebuild never prints history). Total (R8):
// the print part runs in its own savepoint; a failure rolls back only the print, is logged with ids and never throws.
//
// 02a `BillRequested { seating_id, table_id, by_staff_id }` → the check bill of the seating's `bills` row when one
// exists (its service charge, discount, splits), else the projected bill (ensure-bill drafts are not possible in a
// fold), at `billPrinterFor({ zone_id, floor_id })` of the seating's primary table; the job in `bill_print_jobs`
// (`bill_id` = the bill, else NULL with `ref_id = seating_id`). No event, no 01d notice. No printer → logged, skipped.
//
// 05 §6.25, §3.16 (task 26b): `ZReportIssued { business_date, z_no, report }` → the Z at `billPrinterFor({ report:
// true })` (the `report` route, else `default`), rendered by 4a's `buildReportDoc` with the staff names of the report's
// ids read from `staff_names` at print (H16-5: the event holds ids only), dates in hub time at the event's
// `recorded_at`, amounts in the report's own currency. Its `bill_print_jobs` row (`doc_kind 'report'`, `bill_id`
// NULL, `ref_id` = the business date) is claimed first under the job id `<event_id>:z`, so the same event applied
// again prints nothing. Live only: a replay, refold or rebuild ('catchup') never prints a Z again.
//
// 05 §3.16, §6.13, B19 / Q-3 (E2E E-4): `InvoiceCredited` → the credit note, on the direct `ReopenBill` and the
// `reopen_bill` approve alike (the command never prints it, so it prints once). Printer: the event's device route
// (the envelope `device_id`: on an approval the answerer's, 01d `apply` drafts carry the answering command's actor)
// → default. Built by 4b's `buildCreditNoteDoc` from the event's own payload (the original's amounts and snapshot,
// H9-6), the credit's outbox state, and the buyer's type and last 4 of the original's `invoice_buyers` row (SQLite
// hands back `substr(…, -4)` only; no full ID enters this file). Its `bill_print_jobs` row (`doc_kind 'credit'`,
// `ref_id` = the credit invoice) is claimed first under `<event_id>:credit`. Live only, as the Z.
import { buildCreditNoteDoc, buildReportDoc, currencyExponent, DomainError, type DocBuyerMask } from '@pos/domain';
import type { BillRequestedPayload, InvoiceCreditedPayload, PosEvent, ZReportIssuedPayload } from '@pos/events';
import type Database from 'better-sqlite3';
import type { HubConfig } from '../../config/schema.js';
import type { WriterTx } from '../../engine-host/writer.js';
import type { Projection, ProjectionRegistry } from '../../projections/registry.js';
import { billPrinterFor, printDocument } from '../../print/api.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { hubTime } from '../../lib/hub-time.js';
import { hubBilling } from '../defaults.js';
import { openBillOf } from '../commands/ensure-bill.js';
import { activePrinter, checkBillOf, queueCheckBill, tableRouteOf } from '../commands/print-check-bill.js';
import { docFiscalState } from '../commands/print-docs.js';
import { reportStaffIds, staffNamesOf } from '../queries/reports.js';

export const BILL_PRINT_EVENT_TYPES = ['BillRequested', 'ZReportIssued', 'InvoiceCredited'] as const;

/** One skipped print (ids and a short reason only). */
export interface BillPrintSkip {
  event_id: string;
  event_type: string;
  seating_id: string | null;
  reason: string;
}

interface Slot {
  log: ((line: BillPrintSkip) => void) | null;
  pending: BillPrintSkip[];
  config: HubConfig | null;
}

// As kitchen_tickets: boot replays projections before the server exists, so the log and the hub config bind later.
const slots = new WeakMap<ProjectionRegistry, Slot>();

/** Binds the hub log (`billing.print_skipped`) and the hub config (the branch name on the slip); flushes earlier lines. */
export function bindBillPrints(projections: ProjectionRegistry, o: { log: (line: BillPrintSkip) => void; config: HubConfig }): void {
  const slot = slots.get(projections);
  if (slot === undefined) return;
  slot.log = o.log;
  slot.config = o.config;
  for (const line of slot.pending.splice(0)) o.log(line);
}

class Skip extends Error {}

export function billPrintsProjection(projections: ProjectionRegistry): Projection {
  const slot: Slot = { log: null, pending: [], config: null };
  slots.set(projections, slot);
  const emit = (line: BillPrintSkip): void => {
    if (slot.log === null) slot.pending.push(line);
    else slot.log(line);
  };
  return {
    name: 'billing_prints',
    eventTypes: [...BILL_PRINT_EVENT_TYPES],
    apply(tx, event, mode) {
      if (mode !== 'live') return;
      const seating_id = event.event_type === 'BillRequested' ? ((event.payload as Partial<BillRequestedPayload>).seating_id ?? null) : null;
      try {
        if (event.event_type === 'ZReportIssued') tx.transaction(() => printZReport(tx, event))();
        else if (event.event_type === 'InvoiceCredited') tx.transaction(() => printCreditNote(tx, event, slot.config))();
        else tx.transaction(() => printRequestedBill(tx, event, slot.config))();
      } catch (error) {
        emit({ event_id: event.event_id, event_type: event.event_type, seating_id, reason: error instanceof Skip ? error.message : error instanceof DomainError ? error.code : 'fold_error' });
      }
    },
  };
}

/**
 * §6.4: openBillOf (1) → the check bill (≤ 4) → billPrinterFor (1) + the printer row (1) → printDocument (2) +
 * bill_print_jobs (1). The job id is the event's (`<event_id>:check`), its time the event's `recorded_at`; the same
 * event applied again finds its `bill_print_jobs` row claimed and skips cleanly (no second job, no log line).
 */
function printRequestedBill(db: Database.Database, event: PosEvent, hub: HubConfig | null): void {
  const p = event.payload as Partial<BillRequestedPayload>;
  if (typeof p.seating_id !== 'string' || p.seating_id.length === 0) throw new Skip('bad_payload');
  const config = branchConfig();
  if (config === null) throw new Skip('no_config');
  const { head } = openBillOf(db, { seating_id: p.seating_id }, null);
  if (head.state === 'closed' || head.absorbed || head.seating === null || head.seating.state === 'CLOSED') throw new Skip('bill_not_open');
  const check = checkBillOf(db, config, head, false);
  const routed = billPrinterFor(db, tableRouteOf(config, head.seating.primary_table_id));
  const printer = routed === null ? null : activePrinter(db, routed);
  if (printer === null) throw new Skip('no_printer');
  const job_id = `${event.event_id}:check`;
  queueCheckBill(foldTx(db, event, job_id), printer, check, {
    job_id,
    bill_id: head.bill_id,
    ref_id: head.bill_id === null ? p.seating_id : null,
    branch_name: hub?.provisioned?.branch_name ?? '',
  });
}

const Z_JOB = `INSERT OR IGNORE INTO bill_print_jobs (job_id, bill_id, doc_kind, ref_id, created_at) VALUES (?, NULL, 'report', ?, ?)`;

/**
 * §6.25, §3.16: billPrinterFor (1) + the printer row (1) → claim the `bill_print_jobs` row (1) → the report's staff
 * names (1) → printDocument (2). 6 statements, whatever the report's size. No printer → Skip (logged, ids only).
 */
function printZReport(db: Database.Database, event: PosEvent): void {
  const p = event.payload as Partial<ZReportIssuedPayload>;
  const report = p.report;
  if (report === undefined || typeof p.business_date !== 'string') throw new Skip('bad_payload');
  const routed = billPrinterFor(db, { report: true });
  const printer = routed === null ? null : activePrinter(db, routed);
  if (printer === null) throw new Skip('no_printer');
  const job_id = `${event.event_id}:z`;
  if (db.prepare(Z_JOB).run(job_id, p.business_date, event.recorded_at).changes === 0) return; // already printed
  const doc = buildReportDoc(report, staffNamesOf(db, reportStaffIds(report)), {
    width_cols: printer.paper_width_mm === 58 ? 32 : 48,
    currency_exponent: currencyExponent(report.currency_code),
    utc_offset_ms: hubTime({ branchNow: () => event.recorded_at }).utc_offset_ms,
  });
  const { job_id: printed } = printDocument(foldTx(db, event, job_id), printer.printer_id, doc, { kind_label: 'Z report' });
  if (printed !== job_id) throw new Error('Z report: the print job id is not the claimed one');
}

const CREDIT_JOB = `INSERT OR IGNORE INTO bill_print_jobs (job_id, bill_id, doc_kind, ref_id, created_at) VALUES (?, ?, 'credit', ?, ?)`;

// The credit's outbox state and folded number / QR (the billing fold wrote both earlier in this event), the buyer's
// type and last 4 of its original's `invoice_buyers` row (Q-3: no copy for a credit), the closer's name. 1 statement.
const CREDIT = `
SELECT i.invoice_id, f.state AS fiscal_state, i.fiscal_number, i.qr_payload,
       b.id_type AS buyer_type, substr(b.id_value, -4) AS buyer_last4, n.display_name AS cashier_name
FROM invoices i
LEFT JOIN fiscal_outbox f ON f.invoice_id = i.invoice_id
LEFT JOIN invoice_buyers b ON b.invoice_id = i.ref_invoice_id
LEFT JOIN staff_names n ON n.staff_id = i.closed_by
WHERE i.invoice_id = ? AND i.series = 'credit'`;
interface CreditRow {
  invoice_id: string;
  fiscal_state: string | null;
  fiscal_number: string | null;
  qr_payload: string | null;
  buyer_type: string | null;
  buyer_last4: string | null;
  cashier_name: string | null;
}

/**
 * §3.16, §6.13: billPrinterFor (the event's device → default, 1) + the printer row (1) → claim the `bill_print_jobs`
 * row (1) → the credit row (1) → printDocument (2). 6 statements, whatever the number of lines. No printer → Skip
 * (logged, ids only).
 */
function printCreditNote(db: Database.Database, event: PosEvent, hub: HubConfig | null): void {
  const p = event.payload as Partial<InvoiceCreditedPayload>;
  if (typeof p.invoice_id !== 'string' || typeof p.bill_id !== 'string' || p.series !== 'credit') throw new Skip('bad_payload');
  const invoice = p as InvoiceCreditedPayload;
  const config = branchConfig();
  if (config === null) throw new Skip('no_config');
  const routed = billPrinterFor(db, { device_id: event.device_id });
  const printer = routed === null ? null : activePrinter(db, routed);
  if (printer === null) throw new Skip('no_printer');
  const job_id = `${event.event_id}:credit`;
  if (db.prepare(CREDIT_JOB).run(job_id, invoice.bill_id, invoice.invoice_id, event.recorded_at).changes === 0) return; // already printed
  const row = db.prepare(CREDIT).get(invoice.invoice_id) as CreditRow | undefined;
  if (row === undefined) throw new Skip('invoice_missing');
  const billing = hubBilling(config);
  const types = (billing.jurisdiction.rules ?? []).flatMap((r) => r.buyer_id.accepted_types);
  const buyer: DocBuyerMask | null =
    row.buyer_type === null || row.buyer_last4 === null
      ? null
      : { type_label: types.find((t) => t.type === row.buyer_type)?.label ?? row.buyer_type, last4: row.buyer_last4.slice(-4) };
  const doc = buildCreditNoteDoc(
    { invoice, buyer_id: buyer, fiscal: docFiscalState(row), is_reprint: false, cashier_name: row.cashier_name }, // Q-3: the last 4
    {
      width_cols: printer.paper_width_mm === 58 ? 32 : 48,
      currency_exponent: currencyExponent(invoice.currency_code),
      utc_offset_ms: hubTime({ branchNow: () => event.recorded_at }).utc_offset_ms,
      branch_name: hub?.provisioned?.branch_name ?? '',
      template: billing.settings.receipt,
    },
  );
  const { job_id: printed } = printDocument(foldTx(db, event, job_id), printer.printer_id, doc, { kind_label: 'Credit note' });
  if (printed !== job_id) throw new Error('credit note: the print job id is not the claimed one');
}

/** printDocument's transaction view inside a fold: the fold's connection, the event's time and a job id of its own. */
function foldTx(db: Database.Database, event: PosEvent, job_id: string): WriterTx {
  const refuse = (): never => {
    throw new Error('a print fold appends no event');
  };
  return {
    db,
    state: {},
    clock: { branchNow: () => event.recorded_at },
    ids: { next: () => job_id },
    branchId: event.branch_id,
    append: refuse,
    onCommit: refuse,
  };
}
