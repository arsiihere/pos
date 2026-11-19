// 05 §3.15, §5, B20, H6-8, H9-6: the fiscal outbox row an invoice event folds into, the one statement
// that writes it, the credit rule and the row transition each adapter answer gives. Pure except
// insertOutboxRow. The core never branches on an adapter key (only `none`, which §3.15 defines as
// "never called, rows not_required").
import type Database from 'better-sqlite3';
import {
  FISCAL_ROW_STATES,
  type FiscalCreditInvoiceFields,
  type FiscalSaleInvoiceFields,
  type FiscalSnapshot,
  isFiscalized,
} from '@pos/domain';
import type { FiscalAnswer } from './port.js';

export type FiscalRowState = (typeof FISCAL_ROW_STATES)[number];

/** The fold-written columns of `fiscal_outbox` (§5); the worker columns keep their defaults on insert. */
export type OutboxRow = {
  invoice_id: string;
  ord: number;
  ref_invoice_id: string | null;
  jurisdiction_id: string;
  adapter_key: string;
  pos_id: string | null;
  state: FiscalRowState;
  queued_at: number;
};

type RowFields = 'invoice_id' | 'issued_at' | 'jurisdiction_id' | 'fiscal';
/** What outboxRowFor reads from `InvoiceIssued` / `InvoiceCredited` (5a types). */
export type OutboxInvoice =
  | Pick<FiscalSaleInvoiceFields, RowFields | 'series'>
  | Pick<FiscalCreditInvoiceFields, RowFields | 'series' | 'ref_invoice_id'>;

/**
 * The outbox row for an invoice event at `ord` (the event's seq, §3.15 send order).
 * - Sale: `not_required` when its snapshot is not fiscalized (`isFiscalized`, §3.1: `fiscal.required` false —
 *   an order type with `fiscalize: false`, an invoice issued before `switched_at`, the close decides it, H8-3 —
 *   or adapter `none`); else `pending` under the snapshot's jurisdiction, adapter and pos_id.
 * - Credit: follows its original's row (H6-8): `not_required` ↔ `not_required`, otherwise fiscalized
 *   (`pending`), with the original's jurisdiction, adapter and pos_id, whatever the branch uses now. A credit
 *   of a `rejected` original is queued `pending` and the worker rejects it after its original (§3.15 Order).
 * A snapshot naming adapter `none` is `not_required` whatever its `required` says (§3.15: `none` is never
 * called). A fiscalized sale must carry a pos_id (task 17's close guarantees it; a missing one throws).
 * A credit's own jurisdiction / snapshot are copies of its original's (§6.13, H9-6); the row is built
 * from the original's row regardless.
 * queued_at = the invoice's issued_at, so a rebuild gives the same row.
 */
export function outboxRowFor(invoice: OutboxInvoice, ord: number, original?: OutboxRow): OutboxRow {
  if (invoice.series === 'credit') {
    if (original === undefined) throw new Error(`credit ${invoice.invoice_id}: original outbox row missing`);
    if (original.invoice_id !== invoice.ref_invoice_id) {
      throw new Error(`credit ${invoice.invoice_id}: original row is ${original.invoice_id}, not ${invoice.ref_invoice_id}`);
    }
    return {
      invoice_id: invoice.invoice_id,
      ord,
      ref_invoice_id: invoice.ref_invoice_id,
      jurisdiction_id: original.jurisdiction_id,
      adapter_key: original.adapter_key,
      pos_id: original.pos_id,
      state: original.state === 'not_required' ? 'not_required' : 'pending',
      queued_at: invoice.issued_at,
    };
  }
  if (original !== undefined) throw new Error(`sale ${invoice.invoice_id}: a sale has no original`);
  const fiscalized = isFiscalized(invoice.fiscal);
  if (fiscalized && invoice.fiscal.pos_id === null) {
    throw new Error(`sale ${invoice.invoice_id}: a fiscalized invoice needs a pos_id`);
  }
  return {
    invoice_id: invoice.invoice_id,
    ord,
    ref_invoice_id: null,
    jurisdiction_id: invoice.jurisdiction_id,
    adapter_key: invoice.fiscal.adapter_key,
    pos_id: invoice.fiscal.pos_id,
    state: fiscalized ? 'pending' : 'not_required',
    queued_at: invoice.issued_at,
  };
}

/**
 * The one statement the billing fold (task 7) calls per invoice event, live and on rebuild:
 * `INSERT OR IGNORE` (§5), so a replay never duplicates or overwrites a row. Returns whether a row was
 * written. `OR IGNORE` would also swallow a CHECK / NOT NULL failure — an invoice with no outbox row, a
 * legal fault (B20) — so the row is checked first and a bad row throws (the fold's transaction rolls back).
 */
export function insertOutboxRow(db: Database.Database, row: OutboxRow): boolean {
  assertOutboxRow(row);
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO fiscal_outbox (invoice_id, ord, ref_invoice_id, jurisdiction_id, adapter_key, pos_id, state, queued_at)
       VALUES (@invoice_id, @ord, @ref_invoice_id, @jurisdiction_id, @adapter_key, @pos_id, @state, @queued_at)`,
    )
    .run(row);
  return info.changes === 1;
}

function assertOutboxRow(row: OutboxRow): void {
  const text = (v: unknown): boolean => typeof v === 'string' && v.length > 0;
  const int = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  const ok =
    text(row.invoice_id) &&
    int(row.ord) &&
    (row.ref_invoice_id === null || text(row.ref_invoice_id)) &&
    text(row.jurisdiction_id) &&
    text(row.adapter_key) &&
    (row.pos_id === null || text(row.pos_id)) &&
    (FISCAL_ROW_STATES as readonly string[]).includes(row.state) &&
    int(row.queued_at);
  if (!ok) throw new Error(`invalid fiscal_outbox row for invoice ${String(row.invoice_id)}`);
}

/**
 * §3.15 Credit support (J-1, J-6, H9-6): a fiscalized original (row `pending` / `acked`) can be credited only
 * when its adapter could credit **and** its jurisdiction has `credit_support = 'credit_invoice'`, both read from
 * the original invoice's snapshot, never today's. The caller (ReopenBill, task 19) applies this only to a
 * `pending` / `acked` original; a `not_required` invoice is always creditable (local credit series).
 */
export function canCredit(originalSnapshot: Pick<FiscalSnapshot, 'capabilities' | 'credit_support'>): boolean {
  return originalSnapshot.capabilities.credit && originalSnapshot.credit_support === 'credit_invoice';
}

/** What an adapter answer does to its row (§3.15 diagram). */
export type FiscalRowTransition =
  /** writer tx: `FiscalNumberAssigned` → row `acked` */
  | { to: 'acked'; fiscal_number: string; qr_payload: string | null }
  /** row stays `pending`: attempts + 1, next_try_at = back-off, last_error = the short code */
  | { to: 'retry'; error_code: string }
  /** `FiscalSubmitRejected`, row `rejected`, alert; never auto-resent */
  | { to: 'rejected'; error_code: string; http_status: number | null };

/** The §3.15 answer mapping; `duplicate` is `ok` when the number is returned, else `rejected`. */
export function answerTransition(answer: FiscalAnswer): FiscalRowTransition {
  switch (answer.outcome) {
    case 'ok':
      return { to: 'acked', fiscal_number: answer.fiscal_number, qr_payload: answer.qr_payload };
    case 'retry':
      return { to: 'retry', error_code: answer.error_code };
    case 'rejected':
      return { to: 'rejected', error_code: answer.error_code, http_status: answer.http_status };
    case 'duplicate':
      return answer.fiscal_number === null
        ? { to: 'rejected', error_code: DUPLICATE_WITHOUT_NUMBER, http_status: null }
        : { to: 'acked', fiscal_number: answer.fiscal_number, qr_payload: null };
  }
}

/** Short code for a `duplicate` answer without a number (§3.15 "else 'rejected'"; the spec names no code). */
export const DUPLICATE_WITHOUT_NUMBER = 'duplicate_no_number';
