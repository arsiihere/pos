import type {
  BillClosedEmptyPayload,
  BillOpenedPayload,
  BillReopenedPayload,
  BillSplitsSetPayload,
  BusinessDayOpenedPayloadV2,
  BuyerIdWaivedPayload,
  ChargeAppliedPayload,
  ChargeRemovedPayload,
  CheckBillPrintedPayload,
  DiscountAppliedPayload,
  DiscountFrozenPayload,
  DiscountRemovedPayload,
  FiscalNumberAssignedPayload,
  FiscalSubmitRejectedPayload,
  InvoiceCreditedPayload,
  InvoiceIssuedPayload,
  ItemRemovedPayload,
  ItemVoidedPayload,
  OrdersBilledPayload,
  OrdersCarriedOverPayload,
  PaymentAddedPayload,
  PaymentRemovedPayload,
  PosEvent,
  SeatingSplitPayload,
  TablesMergedPayload,
  ZReportIssuedPayload,
} from '@pos/events';
import type Database from 'better-sqlite3';
import { insertOutboxRow, outboxRowFor, type OutboxRow } from '../fiscal/outbox.js';
import type { Projection } from '../../projections/registry.js';

// 05 §5 (task 7): the projection `billing` (with `reset`). Events only: every fold reads the event and the projection's
// own tables, never 02a's or 02b's (a rebuild from seq 0 equals live, #88). Times are the envelope's recorded_at, except
// columns §5 / §6.29 take from the payload: invoices.issued_at (the invoice's own) and z_reports.issued_at (the Z's
// `report.issued_at`, the time printed on the report; §5 z_reports, §6.25).
// Registered in registerHubProjections after orders, tables and audit (G-20). The invoice folds write the fiscal
// outbox row through 28a's outboxRowFor / insertOutboxRow in the same transaction, so the invoice and its row commit or
// roll back together (G-10, B20). The hub-state tables (invoice_buyers, bill_texts, payment_references,
// fiscal_credentials, bill_print_jobs) are not this projection's and are never reset. Statements per event are fixed:
// set-based statements over json_each, never one per line, split or payment.

/** §5 billing list (+ 02b ItemVoided / ItemRemoved / OrdersBilled, 02a TablesMerged / SeatingSplit, 01a BusinessDayOpened). */
export const BILLING_EVENT_TYPES: readonly string[] = [
  'BillOpened',
  'ChargeApplied',
  'ChargeRemoved',
  'CheckBillPrinted',
  'BillSplitsSet',
  'DiscountApplied',
  'DiscountRemoved',
  'DiscountFrozen', // R-41 / G-38: the only writer of discount_json.frozen_minor
  'PaymentAdded',
  'PaymentRemoved',
  'BuyerIdWaived',
  'InvoiceIssued',
  'BillReopened',
  'InvoiceCredited',
  'FiscalNumberAssigned',
  'FiscalSubmitRejected',
  'FiscalTokenSet', // §6.29 "billing (audit only)": listed in §5, writes no row
  'OrdersCarriedOver',
  'ZReportIssued',
  'BillClosedEmpty',
  'OrdersBilled', // 02b; R-41 text clarification: the source of bill_orders
  'ItemVoided', // 02b; H2-15: a leaving unit off the highest open split
  'ItemRemoved',
  'TablesMerged', // 02a; §3.9 bill re-pointing
  'SeatingSplit', // 02a; §3.9 / H2-15 by order_id
  'BusinessDayOpened', // 01a; the current day key
];

/** Every table of `billing` (§5), cleared by reset. */
const BILLING_TABLES = [
  'bills',
  'bill_orders',
  'bill_splits',
  'bill_discount_lines',
  'bill_split_lines',
  'bill_payments',
  'invoices',
  'invoice_taxes',
  'fiscal_outbox', // its worker columns are reset too (§5: harmless)
  'closed_split_units',
  'carried_orders',
  'z_reports',
  'billing_day',
] as const;

/** §5: the `billing` projection. */
export function billingProjection(): Projection {
  return {
    name: 'billing',
    eventTypes: [...BILLING_EVENT_TYPES],
    apply(tx, event) {
      applyBilling(tx, event);
    },
    reset(tx) {
      for (const table of BILLING_TABLES) tx.prepare(`DELETE FROM ${table}`).run();
    },
  };
}

/** A bill that is not absorbed, not closed and not a corrections reopen (the `bills_live_*` predicate, §5). */
const LIVE = `absorbed_into IS NULL AND state <> 'closed' AND reopen_mode IS NOT 'corrections'`;
const LIVE_B = `b.absorbed_into IS NULL AND b.state <> 'closed' AND b.reopen_mode IS NOT 'corrections'`;

function applyBilling(tx: Database.Database, event: PosEvent): void {
  const at = event.recorded_at;
  switch (event.event_type) {
    case 'BillOpened': {
      // H9-9, H16-2: price mode and rounding rule frozen at open. Split 1 is the bill's one split until a BillSplitsSet.
      const p = event.payload as BillOpenedPayload;
      tx.prepare(
        `INSERT INTO bills (bill_id, scope, seating_id, table_key, order_type, state, opened_at, prices_include_tax, rounding_json)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      ).run(p.bill_id, p.scope, p.seating_id, p.bill_key, p.order_type, at, p.prices_include_tax ? 1 : 0, JSON.stringify(p.rounding));
      tx.prepare(`INSERT INTO bill_splits (bill_id, split_no, plan_json, state, invoice_id) VALUES (?, 1, NULL, 'open', NULL)`).run(p.bill_id);
      return;
    }
    case 'ChargeApplied': {
      // B8: sets the rate and clears sc_removed whatever the source. A `rule` charge is appended only at BillOpened (sc_removed
      // is still 0 there); a `manual` re-add (§6.8 ApplyServiceCharge) lifts a removal. Only ChargeApplied / ChargeRemoved
      // move sc_removed; no read, print, split, merge or reopen does (M-3).
      const p = event.payload as ChargeAppliedPayload;
      tx.prepare('UPDATE bills SET sc_bp = ?, sc_removed = 0 WHERE bill_id = ?').run(p.rate_bp, p.bill_id);
      return;
    }
    case 'ChargeRemoved': {
      const p = event.payload as ChargeRemovedPayload;
      tx.prepare('UPDATE bills SET sc_bp = 0, sc_removed = 1 WHERE bill_id = ?').run(p.bill_id);
      return;
    }
    case 'CheckBillPrinted': {
      const p = event.payload as CheckBillPrintedPayload;
      tx.prepare('UPDATE bills SET check_printed_at = ? WHERE bill_id = ?').run(at, p.bill_id);
      return;
    }
    case 'BillSplitsSet':
      return applySplitsSet(tx, event.payload as BillSplitsSetPayload);
    case 'DiscountApplied': {
      // §5 discount_json { kind, value, reason_code, alert_id, frozen_minor }; frozen only by DiscountFrozen (R-41).
      const p = event.payload as DiscountAppliedPayload;
      tx.prepare(
        `UPDATE bills SET discount_json = json_object('kind', ?, 'value', ?, 'reason_code', ?, 'alert_id', ?, 'frozen_minor', NULL)
         WHERE bill_id = ?`,
      ).run(p.kind, p.value, p.reason_code, p.alert_id, p.bill_id);
      return;
    }
    case 'DiscountRemoved': {
      const p = event.payload as DiscountRemovedPayload;
      tx.prepare('UPDATE bills SET discount_json = NULL WHERE bill_id = ?').run(p.bill_id);
      return;
    }
    case 'DiscountFrozen': {
      // R-41 / G-38: the only writer of frozen_minor; a bill with no discount keeps NULL. line_ids = the
      // InvoiceIssued.discount_line_ids that already filled bill_discount_lines.
      const p = event.payload as DiscountFrozenPayload;
      tx.prepare(`UPDATE bills SET discount_json = json_set(discount_json, '$.frozen_minor', ?) WHERE bill_id = ? AND discount_json IS NOT NULL`).run(
        p.frozen_minor,
        p.bill_id,
      );
      return;
    }
    case 'PaymentAdded': {
      const p = event.payload as PaymentAddedPayload;
      tx.prepare(
        `INSERT INTO bill_payments (payment_id, bill_id, split_no, mode_id, payment_class, direction, amount_minor, tendered_minor,
           has_reference, taken_by_staff_id, shift_id, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        p.payment_id,
        p.bill_id,
        p.split_no,
        p.mode_id,
        p.payment_class,
        p.direction,
        p.amount_minor,
        p.tendered_minor,
        p.has_reference ? 1 : 0,
        p.taken_by_staff_id,
        p.shift_id,
        at,
      );
      return;
    }
    case 'PaymentRemoved': {
      const p = event.payload as PaymentRemovedPayload;
      tx.prepare('UPDATE bill_payments SET removed_at = ? WHERE payment_id = ? AND removed_at IS NULL').run(at, p.payment_id);
      return;
    }
    case 'BuyerIdWaived': {
      const p = event.payload as BuyerIdWaivedPayload;
      tx.prepare('UPDATE bills SET buyer_waived = 1 WHERE bill_id = ?').run(p.bill_id);
      return;
    }
    case 'InvoiceIssued':
      return applyInvoiceIssued(tx, event.payload as InvoiceIssuedPayload, event.seq, at);
    case 'BillReopened':
      return applyReopened(tx, event.payload as BillReopenedPayload);
    case 'InvoiceCredited':
      return applyInvoiceCredited(tx, event.payload as InvoiceCreditedPayload, event.seq);
    case 'FiscalNumberAssigned': {
      // §3.15: the worker's answer transaction; the row leaves `pending`.
      const p = event.payload as FiscalNumberAssignedPayload;
      tx.prepare('UPDATE invoices SET fiscal_number = ?, qr_payload = ? WHERE invoice_id = ?').run(p.fiscal_number, p.qr_payload, p.invoice_id);
      tx.prepare(`UPDATE fiscal_outbox SET state = 'acked', acked_at = ? WHERE invoice_id = ?`).run(at, p.invoice_id);
      return;
    }
    case 'FiscalSubmitRejected': {
      const p = event.payload as FiscalSubmitRejectedPayload;
      tx.prepare(`UPDATE fiscal_outbox SET state = 'rejected' WHERE invoice_id = ?`).run(p.invoice_id);
      return;
    }
    case 'FiscalTokenSet':
      return; // §6.29: audit only (the token itself is never in an event)
    case 'OrdersCarriedOver': {
      // H6-10: the day-close guard's carried set.
      const p = event.payload as OrdersCarriedOverPayload;
      tx.prepare(
        `INSERT OR IGNORE INTO carried_orders (order_id, business_date, reason_code) SELECT value, ?, ? FROM json_each(?)`,
      ).run(p.business_date, p.reason_code, JSON.stringify(p.order_ids));
      return;
    }
    case 'ZReportIssued': {
      const p = event.payload as ZReportIssuedPayload;
      tx.prepare('INSERT INTO z_reports (business_date, z_no, issued_at, report_json) VALUES (?, ?, ?, ?)').run(
        p.business_date,
        p.z_no,
        p.report.issued_at,
        JSON.stringify(p.report),
      );
      return;
    }
    case 'BillClosedEmpty': {
      // H8-10: CLOSED, every split closed with no invoice; payments untouched (their sum is 0).
      const p = event.payload as BillClosedEmptyPayload;
      tx.prepare(`UPDATE bills SET state = 'closed', closed_at = ? WHERE bill_id = ?`).run(at, p.bill_id);
      tx.prepare(`UPDATE bill_splits SET state = 'closed', invoice_id = NULL WHERE bill_id = ?`).run(p.bill_id);
      return;
    }
    case 'OrdersBilled': {
      // R-41 text clarification (#88b): one row per order, a repeat changes nothing.
      const p = event.payload as OrdersBilledPayload;
      tx.prepare('INSERT OR IGNORE INTO bill_orders (bill_id, order_id) SELECT ?, value FROM json_each(?)').run(
        p.bill_id,
        JSON.stringify(p.order_ids),
      );
      return;
    }
    case 'ItemVoided': {
      const p = event.payload as ItemVoidedPayload;
      return takeUnits(tx, p.order_item_id, p.units);
    }
    case 'ItemRemoved': {
      // 02b: no `units` = every live unit of the line.
      const p = event.payload as ItemRemovedPayload;
      return takeUnits(tx, p.order_item_id, p.units ?? Number.MAX_SAFE_INTEGER);
    }
    case 'TablesMerged':
      return applyMerged(tx, event.payload as TablesMergedPayload);
    case 'SeatingSplit': {
      // §3.9: an item plan entry naming a moved order's line is dropped (open splits only).
      const p = event.payload as SeatingSplitPayload;
      tx.prepare(
        `DELETE FROM bill_split_lines
         WHERE order_id IN (SELECT value FROM json_each(?))
           AND EXISTS (SELECT 1 FROM bill_splits s WHERE s.bill_id = bill_split_lines.bill_id
                         AND s.split_no = bill_split_lines.split_no AND s.state = 'open')`,
      ).run(JSON.stringify(p.order_ids));
      return;
    }
    case 'BusinessDayOpened': {
      // v1 and v2 both carry business_date (the registry upcasts on replay).
      const p = event.payload as Pick<BusinessDayOpenedPayloadV2, 'business_date'>;
      tx.prepare(
        `INSERT INTO billing_day (k, business_date, opened_at) VALUES (1, ?, ?)
         ON CONFLICT (k) DO UPDATE SET business_date = excluded.business_date, opened_at = excluded.opened_at`,
      ).run(p.business_date, at);
      return;
    }
  }
}

/**
 * §3.8: SetSplits replaces the plan of the open splits; closed splits are never touched. `none` → split_mode NULL and
 * one open split. Plans (§5 plan_json): amount `{ share_minor }`; equal `{ n, k }` (n = the open splits listed, k = the
 * split's rank by split_no among them, whatever the array order, so the last open split takes the remainder); items → rows in bill_split_lines (plan_json NULL). 5 statements whatever the split count.
 */
function applySplitsSet(tx: Database.Database, p: BillSplitsSetPayload): void {
  const splits = JSON.stringify(p.splits);
  tx.prepare(
    `DELETE FROM bill_split_lines WHERE bill_id = ?
       AND split_no IN (SELECT split_no FROM bill_splits WHERE bill_id = ? AND state = 'open')`,
  ).run(p.bill_id, p.bill_id);
  tx.prepare(`DELETE FROM bill_splits WHERE bill_id = ? AND state = 'open'`).run(p.bill_id);
  tx.prepare(
    `INSERT INTO bill_splits (bill_id, split_no, plan_json, state, invoice_id)
     SELECT @bill_id, json_extract(j.value, '$.split_no'),
            CASE @mode WHEN 'amount' THEN json_object('share_minor', json_extract(j.value, '$.share_minor'))
                    WHEN 'equal' THEN json_object('n', json_array_length(@splits), 'k',
                      (SELECT COUNT(*) FROM json_each(@splits) o
                       WHERE json_extract(o.value, '$.split_no') <= json_extract(j.value, '$.split_no')))
                    ELSE NULL END,
            'open', NULL
     FROM json_each(@splits) j`,
  ).run({ bill_id: p.bill_id, mode: p.mode, splits });
  tx.prepare(
    `INSERT INTO bill_split_lines (bill_id, split_no, order_item_id, order_id, units)
     SELECT ?, json_extract(s.value, '$.split_no'), json_extract(l.value, '$.order_item_id'),
            json_extract(l.value, '$.order_id'), json_extract(l.value, '$.units')
     FROM json_each(?) s, json_each(s.value, '$.lines') l
     WHERE json_type(s.value, '$.lines') = 'array'`,
  ).run(p.bill_id, splits);
  tx.prepare('UPDATE bills SET split_mode = ? WHERE bill_id = ?').run(p.mode === 'none' ? null : p.mode, p.bill_id);
}

/**
 * §3.8 (H1-6, H2-15): `units` leave the line's item-plan rows from the highest-numbered open split down (a running
 * sum over the open rows of non-absorbed bills); rows left at 0 are deleted. Closed splits are never touched (the line
 * guard refuses such a call, row Q-3). A line in no item plan (amount / equal / one split) has no row: nothing to do.
 * 2 statements.
 */
function takeUnits(tx: Database.Database, order_item_id: string, units: number): void {
  tx.prepare(
    `UPDATE bill_split_lines AS l
     SET units = l.units - MIN(l.units, MAX(0, @units - (r.upto - l.units)))
     FROM (SELECT x.bill_id, x.split_no, SUM(x.units) OVER (PARTITION BY x.bill_id ORDER BY x.split_no DESC) AS upto
           FROM bill_split_lines x
           JOIN bill_splits s ON s.bill_id = x.bill_id AND s.split_no = x.split_no AND s.state = 'open'
           JOIN bills b ON b.bill_id = x.bill_id AND b.absorbed_into IS NULL
           WHERE x.order_item_id = @id) AS r
     WHERE l.order_item_id = @id AND l.bill_id = r.bill_id AND l.split_no = r.split_no`,
  ).run({ units, id: order_item_id });
  tx.prepare('DELETE FROM bill_split_lines WHERE order_item_id = ? AND units <= 0').run(order_item_id);
}

/**
 * §3.9: S2 merged into S. S has a live bill → S2's live bill is marked absorbed_into it; else S2's live bill is
 * re-pointed to S. The merge guard (row T-1) has refused a bill with payments, a discount, a closed split or an invoice.
 * 2 statements.
 */
function applyMerged(tx: Database.Database, p: TablesMergedPayload): void {
  if (p.absorbed_seating_id === null) return;
  tx.prepare(
    `UPDATE bills SET absorbed_into = (SELECT b.bill_id FROM bills b WHERE b.seating_id = @into AND ${LIVE_B})
     WHERE seating_id = @from AND ${LIVE}
       AND EXISTS (SELECT 1 FROM bills b WHERE b.seating_id = @into AND ${LIVE_B})`,
  ).run({ into: p.into_seating_id, from: p.absorbed_seating_id });
  tx.prepare(`UPDATE bills SET seating_id = ? WHERE seating_id = ? AND ${LIVE}`).run(p.into_seating_id, p.absorbed_seating_id);
}

/** The invoice row and its tax rows (§5), shared by both series. 2 statements. */
function insertInvoice(tx: Database.Database, p: InvoiceIssuedPayload | InvoiceCreditedPayload, ref_invoice_id: string | null): void {
  // doc_json (§5): lines + tax rows for reprints and the Z, the service charge, the payment ids (joined by id, G-6) and
  // the jurisdiction snapshot in force at issue (H9-6).
  const doc = { lines: p.lines, service_charge: p.service_charge, taxes: p.taxes, mixed_rule: p.mixed_rule, payment_ids: p.payment_ids, fiscal: p.fiscal };
  tx.prepare(
    `INSERT INTO invoices (invoice_id, series, number, invoice_ref, bill_id, split_no, ref_invoice_id, business_date, issued_at,
       order_type, jurisdiction_id, adapter_key, currency_code, prices_include_tax, subtotal_minor, discount_minor,
       service_charge_minor, tax_minor, rounding_minor, total_minor, change_minor, payment_class, has_buyer_id,
       buyer_id_refused, closed_by, doc_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    p.invoice_id,
    p.series,
    p.number,
    p.invoice_ref,
    p.bill_id,
    p.split_no,
    ref_invoice_id,
    p.business_date,
    p.issued_at,
    p.order_type,
    p.jurisdiction_id,
    p.fiscal.adapter_key,
    p.currency_code,
    p.prices_include_tax ? 1 : 0,
    p.subtotal_minor,
    p.discount_minor,
    p.service_charge_minor,
    p.taxes.reduce((sum, t) => sum + t.tax_minor, 0),
    p.rounding_minor,
    p.total_minor,
    p.change_minor,
    p.payment_class,
    p.has_buyer_id ? 1 : 0,
    p.buyer_id_refused ? 1 : 0,
    p.closed_by,
    JSON.stringify(doc),
  );
  tx.prepare(
    `INSERT INTO invoice_taxes (invoice_id, tax_profile_id, tax_code, payment_class, seq, compound, label, rate_bp, base_minor, tax_minor, rate_ref)
     SELECT ?, json_extract(value, '$.tax_profile_id'), json_extract(value, '$.tax_code'), json_extract(value, '$.payment_class'),
            json_extract(value, '$.seq'), json_extract(value, '$.compound'), json_extract(value, '$.label'),
            json_extract(value, '$.rate_bp'), json_extract(value, '$.base_minor'), json_extract(value, '$.tax_minor'),
            json_extract(value, '$.rate_ref')
     FROM json_each(?)`,
  ).run(p.invoice_id, JSON.stringify(p.taxes));
}

/**
 * §6.12 step 6–7: the sale invoice closes its split (B15 closed_split_units from its lines: units and base share,
 * H1-27), its payments carry its id, the first close of the cycle fills bill_discount_lines (R-29), the bill goes
 * PARTLY_PAID or CLOSED, and its outbox row is written in this transaction (G-10). ord = the event's seq (§3.15).
 */
function applyInvoiceIssued(tx: Database.Database, p: InvoiceIssuedPayload, seq: number, at: number): void {
  insertInvoice(tx, p, null);
  tx.prepare(
    `INSERT INTO closed_split_units (bill_id, split_no, order_item_id, units, share_minor)
     SELECT ?, ?, json_extract(value, '$.order_item_id'), json_extract(value, '$.units'), json_extract(value, '$.base_minor')
     FROM json_each(?)`,
  ).run(p.bill_id, p.split_no, JSON.stringify(p.lines));
  tx.prepare(
    `INSERT INTO bill_splits (bill_id, split_no, plan_json, state, invoice_id) VALUES (?, ?, NULL, 'closed', ?)
     ON CONFLICT (bill_id, split_no) DO UPDATE SET state = 'closed', invoice_id = excluded.invoice_id`,
  ).run(p.bill_id, p.split_no, p.invoice_id);
  tx.prepare('UPDATE bill_payments SET invoice_id = ? WHERE payment_id IN (SELECT value FROM json_each(?))').run(
    p.invoice_id,
    JSON.stringify(p.payment_ids),
  );
  if (p.discount_line_ids !== null) {
    tx.prepare('INSERT OR IGNORE INTO bill_discount_lines (bill_id, order_item_id) SELECT ?, value FROM json_each(?)').run(
      p.bill_id,
      JSON.stringify(p.discount_line_ids),
    );
  }
  tx.prepare(
    `UPDATE bills SET
       state = CASE WHEN EXISTS (SELECT 1 FROM bill_splits WHERE bill_id = @bill_id AND state = 'open') THEN 'partly_paid' ELSE 'closed' END,
       closed_at = CASE WHEN EXISTS (SELECT 1 FROM bill_splits WHERE bill_id = @bill_id AND state = 'open') THEN NULL ELSE @at END
     WHERE bill_id = @bill_id`,
  ).run({ bill_id: p.bill_id, at });
  insertOutboxRow(tx, outboxRowFor(p, seq));
}

/**
 * §3.10, §6.13: OPEN again with history. reopen_mode from the event alone (R-40, no seating / key read), every split
 * open with its payments (their invoice id cleared, carried to the next close), the plan kept, the closed units and the
 * discount freeze cleared (H2-19, R-41), the order set added to bill_orders (H3-2). The bills_live_* indexes read the
 * new mode in this transaction.
 */
function applyReopened(tx: Database.Database, p: BillReopenedPayload): void {
  tx.prepare(
    `UPDATE bills SET state = 'open', closed_at = NULL, reopen_count = reopen_count + 1, reopen_mode = ?,
       discount_json = CASE WHEN discount_json IS NULL THEN NULL ELSE json_set(discount_json, '$.frozen_minor', NULL) END
     WHERE bill_id = ?`,
  ).run(p.mode, p.bill_id);
  tx.prepare(`UPDATE bill_splits SET state = 'open', invoice_id = NULL WHERE bill_id = ?`).run(p.bill_id);
  tx.prepare('UPDATE bill_payments SET invoice_id = NULL WHERE bill_id = ?').run(p.bill_id);
  tx.prepare('DELETE FROM closed_split_units WHERE bill_id = ?').run(p.bill_id);
  tx.prepare('DELETE FROM bill_discount_lines WHERE bill_id = ?').run(p.bill_id);
  tx.prepare('INSERT OR IGNORE INTO bill_orders (bill_id, order_id) SELECT ?, value FROM json_each(?)').run(p.bill_id, JSON.stringify(p.order_ids));
}

/** §6.13: the credit invoice, the original marked credited, the credit's outbox row behind its original's (H6-8). */
function applyInvoiceCredited(tx: Database.Database, p: InvoiceCreditedPayload, seq: number): void {
  insertInvoice(tx, p, p.ref_invoice_id);
  tx.prepare('UPDATE invoices SET credited_by = ? WHERE invoice_id = ?').run(p.invoice_id, p.ref_invoice_id);
  const original = tx
    .prepare('SELECT invoice_id, ord, ref_invoice_id, jurisdiction_id, adapter_key, pos_id, state, queued_at FROM fiscal_outbox WHERE invoice_id = ?')
    .get(p.ref_invoice_id) as OutboxRow | undefined;
  insertOutboxRow(tx, outboxRowFor(p, seq, original));
}
