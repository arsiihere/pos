// 05 §6.3 `PrintCheckBill { bill_ref, printer_id? }`, §3.16, B17 (task 11), and the check bill both it and the
// live-only `BillRequested` fold (§6.4, billing/print/folds.ts) print. The check bill is a print, not a money event:
// the live bill through the same pure `computeBill` as the bill view (#1), at the default class (cash), laid out by
// 4a / 4b's `buildCheckBillDoc` and queued with 03c's `printDocument` (R8: a printer outage never blocks the caller).
// ⚠️ R-30 (row T-4, §6.4a): a dine-in print on a seating that is not CLOSED also appends 02a `TableMarksChanged`.
import {
  buildCheckBillDoc,
  computeBill,
  DomainError,
  spreadLineTaxes,
  type ComputeBillResult,
  type ComputePayment,
  type Doc,
  type DocLine,
  type DocTaxRow,
} from '@pos/domain';
import { CheckBillPrinted, CheckBillPrintedPayload, draftOf, TableMarksChanged, TableMarksChangedPayload, type BranchConfig, type EventDraft } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import type { WriterTx } from '../../engine-host/writer.js';
import { hubTime } from '../../lib/hub-time.js';
import type { LineView } from '../../orders/contracts.js';
import { orderLines } from '../../orders/exports.js';
import { billPrinterFor, printDocument } from '../../print/api.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { pendingVoids } from '../../voids/exports.js';
import {
  billAccess,
  billComputeBase,
  billLines,
  identifierOf,
  ONE_OPEN_SPLIT,
  ORDERS_OF_BILL,
  ordersOfBillParams,
  planOf,
  SPLITS_OF_BILL,
  toTotals,
  type BillOrder,
  type PaymentRow,
  type SplitRow,
  type Totals,
} from '../queries/bill.js';
import { billingAt, BillRef, ensureBill, type BillHead } from './ensure-bill.js';

export const PrintCheckBillPayload = z.object({ bill_ref: BillRef, printer_id: z.string().min(1).optional() }).strict();

// ------------------------------------------------------------------------------------------------ reads

const PRINTER = 'SELECT printer_id, name, paper_width_mm FROM printers WHERE printer_id = ? AND archived_at IS NULL';
interface PrinterRow {
  printer_id: string;
  name: string;
  paper_width_mm: number;
}

// ------------------------------------------------------------------------------------------------ the check bill

/** What a check bill is made of: the totals at the default class, its lines and its Doc input (no time, no width). */
export interface CheckBill {
  totals_default: Totals;
  line_count: number;
  orders: BillOrder[];
  doc: (o: { printed_at: number; width_cols: 32 | 48; utc_offset_ms: number; branch_name: string }) => Doc;
}

/**
 * The check bill of `head` (a bill row, or the projected bill), through task 12's one reading of a bill (queries/
 * bill.ts: ORDERS_OF_BILL, SPLITS_OF_BILL, billLines, billComputeBase): orders (1), `orderLines` (1), `pendingVoids`
 * (1), splits (1; none for a projected bill or one this transaction opens), then the pure `computeBill` with the bill's
 * frozen rules, service charge, discount and splits (H6-9, M-3: a removed charge is never printed back). `fresh`: the
 * bill row is opened by this transaction (no row to read yet). Refuses a bill with no open split (`BILL_NOT_OPEN`).
 */
export function checkBillOf(db: Database.Database, config: BranchConfig, head: BillHead, fresh: boolean): CheckBill {
  if (head.business_date === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  const business_date = head.business_date;
  const orders = db.prepare(ORDERS_OF_BILL).all({ ...ordersOfBillParams(head), bill_id: fresh ? null : head.bill_id }) as BillOrder[];
  const order_ids = orders.map((o) => o.order_id);
  const byOrder = orderLines(db, order_ids);
  const voids = pendingVoids(db, order_ids);
  const rows = head.bill_id === null || fresh ? [] : (db.prepare(SPLITS_OF_BILL).all(head.bill_id) as SplitRow[]);
  const splits = rows.length === 0 ? [ONE_OPEN_SPLIT] : rows;
  const openSplits = splits.filter((s) => s.state === 'open');
  if (openSplits.length === 0) throw new DomainError('BILL_NOT_OPEN', { bill_id: head.bill_id, state: head.state });

  const { billing, rules: atDay } = billingAt(config, business_date);
  const lines = billLines(order_ids, byOrder);
  const byId = new Map<string, LineView>(lines.map((l) => [l.order_item_id, l]));
  const { input } = billComputeBase({ head, billing, rules: atDay, lines, voids, splits });
  const payments: ComputePayment[] = openSplits.flatMap((s) =>
    (JSON.parse(s.payments_json) as PaymentRow[]).map((p) => ({ split_no: s.split_no, payment_class: p.payment_class, direction: p.direction, amount_minor: p.amount_minor, tendered_minor: p.tendered_minor })),
  );
  const result: ComputeBillResult = computeBill({ ...input, plan: planOf(head, openSplits), payments });

  const t = result.totals_default;
  const docTax = (x: { label: string; rate_bp: number; payment_class: DocTaxRow['payment_class']; tax_minor: number }): DocTaxRow => ({
    label: x.label,
    rate_bp: x.rate_bp,
    payment_class: x.payment_class,
    tax_minor: x.tax_minor,
  });
  // G-24, inclusive prices: the charge's own tax rows at the cash class, from the same open remainder (spreadLineTaxes).
  // Each is part of one of the remainder's tax rows (same profile, code, class), whose label it prints with.
  let service_charge_taxes: DocTaxRow[] = [];
  if (input.rules.prices_include_tax && t.service_charge_minor > 0) {
    const share = new Map(result.lines.map((l) => [l.order_item_id, l.discount_minor]));
    const spread = spreadLineTaxes({
      split_no: openSplits[0]!.split_no,
      business_date,
      rules: input.rules,
      tax_profiles: input.tax_profiles,
      lines: input.lines.map((l) => ({ ...l, discount_minor: share.get(l.order_item_id) ?? 0 })),
      service_charge: input.service_charge,
      payments: [],
    });
    const charge = spread.service_charge;
    if (charge !== null) {
      service_charge_taxes = charge.taxes.map((x) => {
        const row = t.taxes.find((r) => r.tax_profile_id === charge.tax_profile_id && r.tax_code === x.tax_code && r.payment_class === x.payment_class);
        if (row === undefined) throw new RangeError('check bill: a service-charge tax has no tax row');
        return docTax({ label: row.label, rate_bp: x.rate_bp, payment_class: x.payment_class, tax_minor: x.tax_minor });
      });
    }
  }
  // a deal part is priced inside its deal: the deal's line prints, its parts do not
  const docLines: DocLine[] = input.lines
    .filter((l) => l.line_kind !== 'deal_part')
    .map((l) => ({
      name: byId.get(l.order_item_id)?.name ?? l.order_item_id,
      units: l.units,
      unit_price_minor: l.unit_price_minor,
      amount_minor: l.base_minor,
      part_of: byId.get(l.order_item_id)?.part_of ?? null, // 05 v1.0.33 §3.16 (STAB-5): grouped by the Doc
    }));
  const identifier = identifierOf(head, config, orders, business_date);
  return {
    totals_default: toTotals(t),
    line_count: docLines.length,
    orders,
    doc: (o) =>
      buildCheckBillDoc(
        {
          identifier,
          printed_at: o.printed_at,
          lines: docLines,
          subtotal_minor: t.subtotal_minor,
          discount_minor: t.discount_minor,
          service_charge_minor: t.service_charge_minor,
          taxes: t.taxes.map(docTax),
          rounding_minor: t.rounding_minor,
          cash_total_minor: t.total_minor,
          digital_total_minor: result.totals_default_digital.total_minor,
          prices_include_tax: input.rules.prices_include_tax,
          service_charge_taxes,
        },
        {
          width_cols: o.width_cols,
          currency_exponent: billing.jurisdiction.currency_exponent,
          utc_offset_ms: o.utc_offset_ms,
          branch_name: o.branch_name,
          template: billing.settings.receipt,
        },
      ),
  };
}

/** §3.16, row P-1: a dine-in bill's table zone and floor (branch config in memory, 0 statements). */
export function tableRouteOf(config: BranchConfig, table_id: string): { zone_id?: string; floor_id?: string } {
  for (const f of config.floors) {
    const t = f.tables.find((x) => x.table_id === table_id);
    if (t !== undefined) return { floor_id: f.floor_id, ...(t.zone_id !== null ? { zone_id: t.zone_id } : {}) };
  }
  return {};
}

/** The active printer's name and paper width (1 statement); null when unknown or archived. */
export function activePrinter(db: Database.Database, printer_id: string): PrinterRow | null {
  return (db.prepare(PRINTER).get(printer_id) as PrinterRow | undefined) ?? null;
}

const BILL_PRINT_JOB = `INSERT OR IGNORE INTO bill_print_jobs (job_id, bill_id, doc_kind, ref_id, created_at) VALUES (?, ?, 'check', ?, ?)`;

/**
 * Queues the check bill on `printer`: 03c `printDocument` (2) + `bill_print_jobs` (1). `bill_id` null = a projected
 * bill (§6.4: `ref_id` = the seating). `job_id` (a fold's own id, `tx.ids` gives the same): the `bill_print_jobs` row
 * is claimed first with INSERT OR IGNORE, and an id already claimed is a clean skip (null), as 03c's kitchen jobs.
 */
export function queueCheckBill(
  tx: WriterTx,
  printer: PrinterRow,
  check: CheckBill,
  o: { bill_id: string | null; ref_id: string | null; branch_name: string; job_id?: string },
): { job_id: string } | null {
  const now = tx.clock.branchNow();
  if (o.job_id !== undefined && tx.db.prepare(BILL_PRINT_JOB).run(o.job_id, o.bill_id, o.ref_id, now).changes === 0) return null;
  const doc = check.doc({ printed_at: now, width_cols: printer.paper_width_mm === 58 ? 32 : 48, utc_offset_ms: hubTime(tx.clock).utc_offset_ms, branch_name: o.branch_name });
  const { job_id } = printDocument(tx, printer.printer_id, doc, { kind_label: 'Check bill' });
  if (o.job_id === undefined) tx.db.prepare(BILL_PRINT_JOB).run(job_id, o.bill_id, o.ref_id, now);
  else if (job_id !== o.job_id) throw new Error('check bill: the print job id is not the claimed one');
  return { job_id };
}

// ------------------------------------------------------------------------------------------------ the command

/**
 * §6.3. Permission `take-order` (registry, resolved before the handler: the grant first); then: ensure bill (1) →
 * not CLOSED (`409 BILL_NOT_OPEN`) → the check bill (≤ 4) → printer: payload `printer_id` (active, else `404
 * PRINTER_NOT_FOUND`; 1) else `billPrinterFor` (the table's zone → floor → default; key bills: the device → default;
 * 1) and its row (1) → scope covering the table / order (C8, last; 0) → `printDocument` (2) + `bill_print_jobs` (1)
 * → `CheckBillPrinted { …, source: 'manual' }` (+ `TableMarksChanged { seating_id }` for a dine-in bill on a seating
 * that is not CLOSED; the seating's state and primary table come with `openBillOf`'s row, +0). No printer → the
 * event with nulls, `printed: false`. Statements ≤ 10.
 */
export const printCheckBillCommand = defineCommand({
  commandType: 'PrintCheckBill',
  payloadSchema: PrintCheckBillPayload,
  sessionKind: 'device',
  permission: 'take-order',
  handle(ctx, payload) {
    const db = ctx.tx.db;
    const { head, events, created } = ensureBill(ctx, payload.bill_ref); // 1
    if (head.absorbed) throw new DomainError('BILL_NOT_OPEN', { bill_id: head.bill_id, state: 'absorbed' }); // §9, the bill view's rule 1
    if (head.state === 'closed') throw new DomainError('BILL_NOT_OPEN', { bill_id: head.bill_id, state: head.state });
    const config = branchConfig();
    if (config === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
    const check = checkBillOf(db, config, head, created); // ≤ 4

    let printer: PrinterRow | null;
    if (payload.printer_id !== undefined) {
      printer = activePrinter(db, payload.printer_id); // 1
      if (printer === null) throw new DomainError('PRINTER_NOT_FOUND', { printer_id: payload.printer_id });
    } else {
      const ask = head.scope === 'seating' ? tableRouteOf(config, head.seating?.primary_table_id ?? '') : { device_id: ctx.actor.deviceId };
      const routed = billPrinterFor(db, ask); // 1
      printer = routed === null ? null : activePrinter(db, routed); // 1
    }
    // C8: the scope of the take-order grant, last (the grant itself was resolved by the pipeline)
    billAccess(ctx.directory, config, ctx.actor.staffId, { seating: head.seating, scope: head.scope, placed_by: check.orders.map((o) => o.placed_by) }, ['take-order']);

    const bill_id = head.bill_id as string;
    const job = printer === null ? null : queueCheckBill(ctx.tx, printer, check, { bill_id, ref_id: null, branch_name: ctx.config.provisioned?.branch_name ?? '' }); // 3
    const env = { occurred_at: ctx.clock.branchNow(), actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
    const printed = CheckBillPrintedPayload.parse({
      bill_id,
      total_default_minor: check.totals_default.total_minor,
      line_count: check.line_count,
      printer_id: printer?.printer_id ?? null,
      job_id: job?.job_id ?? null,
      source: 'manual',
    });
    const drafts: EventDraft[] = [...events, draftOf(CheckBillPrinted, { stream_type: 'bill', stream_id: bill_id, payload: printed, ...env })];
    // R-30 (row T-4, §6.4a): the map re-reads the printed mark; ids only, no alert_id on this direct path (R-43)
    if (head.scope === 'seating' && head.seating !== null && head.seating.state !== 'CLOSED') {
      const marks = TableMarksChangedPayload.parse({ seating_id: head.seating.seating_id });
      drafts.push(draftOf(TableMarksChanged, { stream_type: 'table', stream_id: head.seating.primary_table_id, payload: marks, ...env }));
    }
    return {
      events: drafts,
      result: { bill_id, printed: job !== null, job_id: job?.job_id ?? null, printer_name: printer?.name ?? null, totals_default: check.totals_default },
    };
  },
});

export function registerPrintCheckBill(app: FastifyInstance): void {
  commandRegistry(app).register(printCheckBillCommand);
}
