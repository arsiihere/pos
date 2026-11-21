// 05 §6.22 `PrintBillDocument { doc: 'receipt' | 'credit_note', ref_id, printer_id? }` and §6.23 `RetargetBillPrint
// { job_id, printer_id }` (task 27), §3.16, B18, B19, B21, R-55, row P-5. A reprint is a print, not a money event: no
// event (§6.22: the audit of reprints is 03c's `document` job list), one 03c job + its `bill_print_jobs` row.
// The invoice is the one the hub holds: its own event (the fiscal outbox row's `ord`), never today's settings for the
// invoice's facts (H9-6); the Doc's fiscal state is the outbox row's, with the number and QR payload that
// `FiscalNumberAssigned` folded into `invoices` (4b; R-55: the builder leaves out a QR the printer cannot encode).
// B19 / Q-2 / Q-3: no full buyer ID ever enters this file. The receipt carries 4b's fill block (the mask only), which
// 03c's worker fills at send through 05's filler (close-split.ts `buyerIdFiller`) from `invoice_buyers` by the
// invoice id — so only that customer's receipt is filled; the credit note prints the original's last 4 (Q-3). SQLite
// hands back the last 4 only (`substr`), and the caller cuts it again with `slice(-4)` (4b's DocBuyerMask contract).
import {
  buildCreditNoteDoc,
  buildReceiptDoc,
  DomainError,
  type Doc,
  type DocBuyerMask,
  type DocContext,
  type DocFiscalState,
} from '@pos/domain';
import type { InvoiceCreditedPayload, InvoiceIssuedPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { hubTime } from '../../lib/hub-time.js';
import { billPrinterFor, printDocument } from '../../print/api.js';
import { retargetDocumentJob } from '../../print/document-jobs.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { hubBilling } from '../defaults.js';
import { billAccess, ORDERS_OF_BILL, ordersOfBillParams } from '../queries/bill.js';
import { openBillOf } from './ensure-bill.js';
import { activePrinter } from './print-check-bill.js';

export const PrintBillDocumentPayload = z
  .object({ doc: z.enum(['receipt', 'credit_note']), ref_id: z.string().min(1), printer_id: z.string().min(1).optional() })
  .strict();

export const RetargetBillPrintPayload = z.object({ job_id: z.string().min(1), printer_id: z.string().min(1) }).strict();

/** §6.22 Result (as `PrintCheckBill`'s print fields): no printer routed → `printed: false` and nulls (R8). */
export interface PrintBillDocumentResult {
  printed: boolean;
  job_id: string | null;
  printer_name: string | null;
}

type Log = Pick<FastifyInstance['log'], 'info'>;

// The invoice of `ref_id` in the asked series, as the hub holds it: its own event (the outbox row's `ord`, by the
// events (branch_id, seq) index), the outbox state and the folded fiscal number / QR; for a credit its original's ref;
// the buyer's type and last 4 from `invoice_buyers` (a credit: its original's row, Q-3). 1 statement.
const INVOICE = `
SELECT i.invoice_id, i.bill_id, i.series, f.state AS fiscal_state, i.fiscal_number, i.qr_payload, e.event_type, e.payload,
       b.id_type AS buyer_type, substr(b.id_value, -4) AS buyer_last4
FROM invoices i
LEFT JOIN fiscal_outbox f ON f.invoice_id = i.invoice_id
LEFT JOIN events e ON e.branch_id = @branch_id AND e.seq = f.ord
LEFT JOIN invoice_buyers b ON b.invoice_id = COALESCE(i.ref_invoice_id, i.invoice_id)
WHERE i.invoice_id = @invoice_id AND i.series = @series`;
interface InvoiceRow {
  invoice_id: string;
  bill_id: string;
  series: 'sale' | 'credit';
  fiscal_state: string | null;
  fiscal_number: string | null;
  qr_payload: string | null;
  event_type: string | null;
  payload: string | null;
  buyer_type: string | null;
  buyer_last4: string | null;
}

// The receipt's payments: the invoice's `payment_ids` joined by id, in the invoice's order, regardless of `removed_at`
// (G-6: a reopen clears `bill_payments.invoice_id`). 1 statement whatever their number.
const PAYMENTS = `
SELECT p.mode_id, p.payment_class, p.direction, p.amount_minor FROM json_each(?) j
JOIN bill_payments p ON p.payment_id = j.value ORDER BY j.key`;
interface PaymentRow {
  mode_id: string;
  payment_class: 'cash' | 'digital';
  direction: 'in' | 'out';
  amount_minor: number;
}

/** 4b: the outbox row's state as the Doc takes it; `acked` carries the folded number and QR payload. Also the credit-note fold's. */
export function docFiscalState(row: Pick<InvoiceRow, 'invoice_id' | 'fiscal_state' | 'fiscal_number' | 'qr_payload'>): DocFiscalState {
  switch (row.fiscal_state) {
    case 'not_required':
    case 'pending':
    case 'rejected':
      return { state: row.fiscal_state };
    case 'acked':
      if (row.fiscal_number === null) throw new Error(`PrintBillDocument: acked invoice ${row.invoice_id} has no fiscal number`);
      return { state: 'acked', fiscal_number: row.fiscal_number, qr_payload: row.qr_payload };
    default:
      throw new Error(`PrintBillDocument: invoice ${row.invoice_id} has no fiscal outbox row state (${String(row.fiscal_state)})`);
  }
}

const SERIES = { receipt: 'sale', credit_note: 'credit' } as const;
const DOC_KIND = { receipt: 'receipt', credit_note: 'credit' } as const;

/**
 * §6.22. Permission `take-payment` (registry, resolved before the handler: the grant first; a non-approvable command,
 * so `requires_approval` is refused by 00). Then: the invoice of that series (`404 INVOICE_NOT_FOUND`; 1) → its bill
 * (1) and orders (1) — the receipt's labels and the scope → the receipt's payments (1) → printer: payload `printer_id`
 * (active, else `404 PRINTER_NOT_FOUND`; 1) else the device's bill route → default (`billPrinterFor`, 1) and its row
 * (1) → scope covering the bill (C8, last; 0) → `printDocument` (2) + `bill_print_jobs` (1). No printer routed → the
 * reprint is skipped, logged with ids, `printed: false` (R8). Statements ≤ 9 (a routed receipt), fixed whatever the
 * number of lines or payments.
 */
function printBillDocumentCommand(log: Log) {
  return defineCommand({
    commandType: 'PrintBillDocument',
    payloadSchema: PrintBillDocumentPayload,
    sessionKind: 'device',
    permission: 'take-payment',
    handle(ctx, p): { events: []; result: PrintBillDocumentResult } {
      const db = ctx.tx.db;
      const branch_id = ctx.config.provisioned?.branch_id ?? null;
      const row = db.prepare(INVOICE).get({ invoice_id: p.ref_id, series: SERIES[p.doc], branch_id }) as InvoiceRow | undefined; // 1
      if (row === undefined) throw new DomainError('INVOICE_NOT_FOUND', { invoice_id: p.ref_id });
      const wanted = row.series === 'sale' ? 'InvoiceIssued' : 'InvoiceCredited';
      if (row.event_type !== wanted || row.payload === null) throw new Error(`PrintBillDocument: invoice ${row.invoice_id} has no ${wanted} event at its outbox ord`);
      const config = branchConfig();
      if (config === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');

      const { head } = openBillOf(db, { bill_id: row.bill_id }, ctx.state.business_day?.business_date ?? null); // 2
      const orders = db.prepare(ORDERS_OF_BILL).all(ordersOfBillParams(head)) as Array<{ placed_by: string; token: number | null }>; // 3
      const invoice = JSON.parse(row.payload) as InvoiceIssuedPayload | InvoiceCreditedPayload;
      const payments = invoice.series === 'sale' ? (db.prepare(PAYMENTS).all(JSON.stringify(invoice.payment_ids)) as PaymentRow[]) : []; // 4 (receipt)

      let printer: ReturnType<typeof activePrinter>;
      if (p.printer_id !== undefined) {
        printer = activePrinter(db, p.printer_id); // 5
        if (printer === null) throw new DomainError('PRINTER_NOT_FOUND', { printer_id: p.printer_id });
      } else {
        const routed = billPrinterFor(db, { device_id: ctx.actor.deviceId }); // 5
        printer = routed === null ? null : activePrinter(db, routed); // 6
      }
      // C8: the scope of the take-payment grant over the invoice's bill, last (the grant itself was resolved by 00)
      billAccess(ctx.directory, config, ctx.actor.staffId, { seating: head.seating, scope: head.scope, placed_by: orders.map((o) => o.placed_by) }, ['take-payment']);

      const ids = { bill_id: row.bill_id, invoice_id: row.invoice_id, doc: p.doc, command_type: 'PrintBillDocument' };
      if (printer === null) {
        log.info(ids, 'reprint skipped: no bill printer routed');
        return { events: [], result: { printed: false, job_id: null, printer_name: null } };
      }

      const billing = hubBilling(config);
      const types = (billing.jurisdiction.rules ?? []).flatMap((r) => r.buyer_id.accepted_types);
      const buyer: DocBuyerMask | null =
        row.buyer_type === null || row.buyer_last4 === null
          ? null
          : { type_label: types.find((t) => t.type === row.buyer_type)?.label ?? row.buyer_type, last4: row.buyer_last4.slice(-4) };
      const docCtx: DocContext = {
        width_cols: printer.paper_width_mm === 58 ? 32 : 48,
        currency_exponent: billing.jurisdiction.currency_exponent,
        utc_offset_ms: hubTime(ctx.clock).utc_offset_ms,
        branch_name: ctx.config.provisioned?.branch_name ?? '',
        template: billing.settings.receipt,
      };
      const fiscal = docFiscalState(row);
      const cashier_name = ctx.directory.get(invoice.closed_by)?.display_name ?? null;
      let doc: Doc;
      if (invoice.series === 'sale') {
        const modeName = new Map(billing.settings.payment_modes.map((m) => [m.mode_id, m.name]));
        const table =
          head.seating === null ? null : (config.floors.flatMap((f) => f.tables).find((t) => t.table_id === head.seating!.primary_table_id)?.name ?? head.seating.primary_table_id);
        const token = orders[0]?.token ?? null;
        doc = buildReceiptDoc(
          {
            invoice,
            payments: payments.map((x) => ({ mode_name: modeName.get(x.mode_id) ?? x.mode_id, payment_class: x.payment_class, direction: x.direction, amount_minor: x.amount_minor })),
            change_minor: invoice.change_minor,
            cashier_name,
            order_label: head.scope === 'key' && token !== null ? `#${token}` : null,
            bill_label: table,
            fiscal,
            buyer, // the fill block's mask; the worker fills the full ID at send for this invoice only (row P-5)
            is_reprint: true,
          },
          docCtx,
        );
      } else {
        doc = buildCreditNoteDoc({ invoice, buyer_id: buyer, fiscal, is_reprint: true, cashier_name }, docCtx); // Q-3: the last 4
      }

      const { job_id } = printDocument(ctx.tx, printer.printer_id, doc, { kind_label: p.doc === 'receipt' ? 'Receipt' : 'Credit note' }); // +2
      db.prepare(`INSERT INTO bill_print_jobs (job_id, bill_id, doc_kind, ref_id, created_at) VALUES (?, ?, ?, ?, ?)`).run(job_id, row.bill_id, DOC_KIND[p.doc], row.invoice_id, ctx.clock.branchNow()); // +1
      return { events: [], result: { printed: true, job_id, printer_name: printer.name } };
    },
  });
}

/**
 * §6.23, B18. Permission `take-order` (registry; `allowed` only — a non-approvable command). The job is a bill
 * document (`bill_print_jobs` row, else `404 PRINT_JOB_NOT_FOUND`; 1) → 03c `retargetDocumentJob` (1; +1 naming a
 * refusal: `409 PRINT_JOB_NOT_PENDING` printed / being sent / cancelled, `404 PRINTER_NOT_FOUND` unknown or archived).
 * Printers are branch-wide and the job names no table to scope (§6.23 lists no scope check). No event. Statements ≤ 3.
 * Result: the job's new status.
 */
export const retargetBillPrintCommand = defineCommand({
  commandType: 'RetargetBillPrint',
  payloadSchema: RetargetBillPrintPayload,
  sessionKind: 'device',
  permission: 'take-order',
  handle(ctx, p) {
    const known = ctx.tx.db.prepare('SELECT 1 FROM bill_print_jobs WHERE job_id = ?').get(p.job_id); // 1
    if (known === undefined) throw new DomainError('PRINT_JOB_NOT_FOUND', { job_id: p.job_id });
    return { events: [], result: retargetDocumentJob(ctx.tx, p.job_id, p.printer_id) }; // 1 (+1 on a refusal)
  },
});

export function registerPrintDocs(app: FastifyInstance): void {
  commandRegistry(app).register(printBillDocumentCommand(app.log));
  commandRegistry(app).register(retargetBillPrintCommand);
}
