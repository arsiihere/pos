// 05 §6.13 `ReopenBill` (approvable), §3.10, B14, §6.4a, kind `reopen_bill` (task 19); ⚠️ 05 v1.0.15 R-66 / G-62:
// the request's values carry `credit_invoice_ids`, minted at raise, so the kind's `apply` mints nothing (01d AD-91).
// Order (00 §3.7 pipeline, then §6.13's script): Zod `.strict()` (400) → the grant on `reopen-bill` (403;
// `requires_approval` passes, approvable) → ensure bill (`404 BILL_NOT_FOUND`) → state: CLOSED or PARTLY_PAID, else
// `409 BILL_NOT_OPEN { bill_id, state }` → no open `reopen_bill` request (`409 BILL_REOPEN_PENDING { alert_id }`) → the
// current sale invoices and the bill's order set (an all-cancelled set → `409 BILL_NOT_OPEN { state: 'cancelled' }`,
// §3.10 "whose orders are not cancelled") → a sale invoice whose outbox row is pending / acked and whose snapshot
// cannot credit (28a `canCredit`) → `409 BILL_REOPEN_NOT_SUPPORTED { invoice_id }` → the seating / key's other open
// bills and unbilled orders outside the set → the mode (§3.10) → scope last (C8; `branch` only, 01b) → `allowed`: the
// drafts; `requires_approval`: the request (dedupe `reopen:<bill_id>`).
// Drafts (§3.10, §6.13 step 4): `BillReopened { mode }` first (its fold fills bill_orders and sets reopen_mode), one
// `InvoiceCredited` per current sale invoice (credit series, MAX + 1; the original's amounts, jurisdiction, currency,
// price mode, lines, tax rows and fiscal snapshot copied, never today's rates, B5; `closed_by` = the reopen's requester;
// the outbox row behind its original is the billing fold's, 28a `outboxRowFor`), 02b `OrdersUnbilled` when the bill was
// CLOSED, 02a `SeatingReopened` for a full-edit dine-in reopen of a CLOSED bill, else 02a `TableMarksChanged` for a
// dine-in bill on a not-CLOSED seating (§6.4a, R-30). On the approval path every draft carries the request's
// `alert_id` (H2-1, R-43) and the approver is `AnswerFacts.answerer_staff_id`.
// Statements (00 envelope and 01d's raise excluded), fixed whatever the number of splits, invoices or orders: ensure
// bill (1), the open-request read (1), the current sale invoices (1), the order set (1), the other open bills /
// orders (1), the credit number (1), the note into `bill_texts` (1, with a note) — ≤ 7 (§6.13: ≤ 8). The kind's
// `apply`: openBillOf, invoices, orders, other open, number — 5, read-only. ⚠️ v1.0.17 R-72: the order-cancelled
// hook's statements count on top of 02b's and 04's cancel / void counts.
// Notes stay out of `payload_hash` (`hashOmit: ['note']`, row H-4, H16-7); the text lives in `bill_texts` only.
//
// Also here (§3.10, H7-3, H8-4, row Q-7): 05's order-cancelled hook in 02b `changeDrafts`: when the cancelled order was
// the last live order of a bill with a `bills` row and every split's balance is 0, `BillClosedEmpty` through task 17's
// `emptyCloseDrafts` (with `open: []`: 02b stamps or strips `alert_id` on every returned draft, so no AlertClosed may
// ride along; the bill's open 05 requests are refused at approve (bill CLOSED) and closed at day close, §3.10).
import { BILL_REOPEN_REASONS, computeBill, DomainError, type FiscalSnapshot } from '@pos/domain';
import {
  BillReopened,
  BillReopenedPayload,
  draftOf,
  InvoiceCredited,
  InvoiceCreditedPayload,
  OrdersUnbilled,
  OrdersUnbilledPayload,
  SeatingReopened,
  SeatingReopenedPayload,
  TableMarksChanged,
  TableMarksChangedPayload,
  type AlertDetails,
  type AlertDisplay,
  type EventDraft,
} from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AlertApplyCtx, AnswerFacts } from '../../alerts/kinds.js';
import { alerts } from '../../alerts/raise.js';
import { defineCommand, type CommandCtx } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { tableLabel } from '../../kds/details.js';
import { registerOrderCancelledHook } from '../../orders/line-change.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { canCredit } from '../fiscal/outbox.js';
import { registerBillKindApply } from '../kinds/seam.js';
import type { BillRequestDetails, ReopenBillValues } from '../kinds/values.js';
import { billComputeBase, ONE_OPEN_SPLIT, ORDERS_OF_BILL, ordersOfBillParams, planOf, SPLITS_OF_BILL, type PaymentRow, type SplitRow } from '../queries/bill.js';
import { CANCELLED_ORDERS_OF_BILL, emptyCloseDrafts } from './close-split.js';
import { billingAt, ensureBill, openBillOf, type BillHead } from './ensure-bill.js';

// ------------------------------------------------------------------------------------------------ payload

/** §6.13 / §4.4: `note` ≤ 200, required whenever the reason code is `other`. */
export const ReopenBillPayload = z
  .object({ bill_id: z.string().min(1), reason_code: z.enum(BILL_REOPEN_REASONS), note: z.string().max(200).optional() })
  .strict()
  .superRefine((p, rc) => {
    if (p.reason_code === 'other' && (p.note === undefined || p.note.trim() === '')) {
      rc.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: "note is required when reason_code is 'other'" });
    }
  });
type Payload = z.infer<typeof ReopenBillPayload>;

export type ReopenMode = 'full' | 'corrections';

/** §6.13 Result. */
export type ReopenBillResult = { reopened: { mode: ReopenMode; credits: Array<{ invoice_ref: string; total_minor: number }> } } | { pending: { alert_id: string } };

// ------------------------------------------------------------------------------------------------ reads

interface SaleRow {
  invoice_id: string;
  invoice_ref: string;
  split_no: number;
  order_type: InvoiceCreditedPayload['order_type'];
  jurisdiction_id: string;
  currency_code: string;
  prices_include_tax: number;
  subtotal_minor: number;
  discount_minor: number;
  service_charge_minor: number;
  rounding_minor: number;
  total_minor: number;
  change_minor: number;
  payment_class: InvoiceCreditedPayload['payment_class'];
  has_buyer_id: number;
  buyer_id_refused: number;
  doc_json: string;
  outbox_state: string | null;
}

/** The invoice's `doc_json` (§5, task 7's fold): what a credit copies besides the columns. */
interface InvoiceDoc {
  lines: InvoiceCreditedPayload['lines'];
  service_charge: InvoiceCreditedPayload['service_charge'];
  taxes: InvoiceCreditedPayload['taxes'];
  mixed_rule: InvoiceCreditedPayload['mixed_rule'];
  payment_ids: string[];
  fiscal: InvoiceCreditedPayload['fiscal'];
}

// The bill's current sale invoices (never credited), split order, with their outbox row's state. 1 statement.
const CURRENT_SALES = `
SELECT i.invoice_id, i.invoice_ref, i.split_no, i.order_type, i.jurisdiction_id, i.currency_code, i.prices_include_tax,
       i.subtotal_minor, i.discount_minor, i.service_charge_minor, i.rounding_minor, i.total_minor, i.change_minor,
       i.payment_class, i.has_buyer_id, i.buyer_id_refused, i.doc_json, f.state AS outbox_state
FROM invoices i LEFT JOIN fiscal_outbox f ON f.invoice_id = i.invoice_id
WHERE i.bill_id = ? AND i.series = 'sale' AND i.credited_by IS NULL
ORDER BY i.split_no, i.number`;

// §3.10 "another open bill": a live bills row on the seating / key other than this one, or an order of it neither
// billed nor cancelled outside this bill's order set (a projected bill). 1 statement.
const OTHER_OPEN = `
SELECT
  (SELECT COUNT(*) FROM bills b WHERE b.bill_id <> @bill_id AND b.state <> 'closed' AND b.absorbed_into IS NULL
     AND ((@seating_id IS NOT NULL AND b.seating_id = @seating_id) OR (@bill_key IS NOT NULL AND b.table_key = @bill_key)))
  + (SELECT COUNT(*) FROM orders o WHERE o.billed_at IS NULL AND o.cancelled_at IS NULL
     AND o.order_id NOT IN (SELECT value FROM json_each(@order_ids))
     AND ((@seating_id IS NOT NULL AND o.order_id IN (SELECT order_id FROM seating_orders WHERE seating_id = @seating_id))
       OR (@bill_key IS NOT NULL AND o.bill_key = @bill_key))) AS other_open`;

const NEXT_CREDIT = `SELECT COALESCE(MAX(number), 0) + 1 FROM invoices WHERE series = 'credit'`;

interface Checked {
  head: BillHead;
  bill_id: string;
  was_closed: boolean;
  sales: SaleRow[];
  order_ids: string[];
  mode: ReopenMode;
  today: string;
}

/** §6.13: state CLOSED or PARTLY_PAID (absorbed → 'absorbed'). 0 statements. */
function requireReopenable(head: BillHead): string {
  if (head.bill_id === null || head.absorbed || (head.state !== 'closed' && head.state !== 'partly_paid')) {
    throw new DomainError('BILL_NOT_OPEN', { bill_id: head.bill_id, state: head.absorbed ? 'absorbed' : head.state });
  }
  return head.bill_id;
}

/**
 * §6.13 after the pending check, shared by the command and `apply` (4 statements): the current sale invoices, the
 * order set, `BILL_REOPEN_NOT_SUPPORTED` (J-1, J-6: from each original's snapshot), the other open bills / orders and
 * the mode (§3.10; step order H4-1: the set excluded before any draft is built).
 */
function checkReopen(ctx: CommandCtx, head: BillHead, bill_id: string): Checked {
  const db = ctx.tx.db;
  const today = ctx.state.business_day?.business_date ?? null;
  if (today === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  const sales = db.prepare(CURRENT_SALES).all(bill_id) as SaleRow[]; // 1
  const orders = db.prepare(ORDERS_OF_BILL).all(ordersOfBillParams(head)) as Array<{ order_id: string; business_date: string }>; // 1
  if (orders.length === 0 || sales.length === 0) throw new DomainError('BILL_NOT_OPEN', { bill_id, state: 'cancelled' });
  for (const s of sales) {
    const fiscal = (JSON.parse(s.doc_json) as InvoiceDoc).fiscal as FiscalSnapshot;
    if ((s.outbox_state === 'pending' || s.outbox_state === 'acked') && !canCredit(fiscal)) {
      throw new DomainError('BILL_REOPEN_NOT_SUPPORTED', { invoice_id: s.invoice_id });
    }
  }
  const order_ids = orders.map((o) => o.order_id);
  const seating_id = head.scope === 'seating' ? head.seating_id : null;
  const bill_key = head.scope === 'key' ? head.bill_key : null;
  const other = db.prepare(OTHER_OPEN).get({ bill_id, seating_id, bill_key, order_ids: JSON.stringify(order_ids) }) as { other_open: number }; // 1
  let mode: ReopenMode;
  if (head.scope === 'seating') {
    // dine-in: not cleaned and no other open bill → full edit; cleaned (CLOSED) or another open bill → corrections
    mode = head.seating !== null && head.seating.state !== 'CLOSED' && other.other_open === 0 ? 'full' : 'corrections';
  } else {
    // takeaway / parking: another open bill on the key (Q-5) or an order of an earlier business day (Q-3) → corrections
    mode = other.other_open === 0 && orders.every((o) => o.business_date >= today) ? 'full' : 'corrections';
  }
  return { head, bill_id, was_closed: head.state === 'closed', sales, order_ids, mode, today };
}

/** C8, last: `reopen-bill` takes `branch` only (01b PERMISSION_SCOPES). 0 statements. */
function requireScope(ctx: CommandCtx, head: BillHead): void {
  const scope = ctx.permission !== null && 'scope' in ctx.permission ? ctx.permission.scope : null;
  if (ctx.actor.staffId === null || scope !== 'branch') {
    throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', ...(head.seating === null ? {} : { table_ids: [head.seating.primary_table_id] }) });
  }
}

function noteOf(ctx: CommandCtx, note: string | undefined): { note_id: string | null; has_note: boolean; text: string | null } {
  if (note === undefined || note.trim() === '') return { note_id: null, has_note: false, text: null };
  return { note_id: ctx.ids.next(), has_note: true, text: note };
}

/** 1 statement (hub state, never synced): `bill_texts (subject_id = note_id, field 'note')`. */
function writeNote(ctx: CommandCtx, n: { note_id: string | null; text: string | null }): void {
  if (n.note_id === null || n.text === null) return;
  ctx.tx.db.prepare(`INSERT INTO bill_texts (subject_id, field, text) VALUES (?, 'note', ?)`).run(n.note_id, n.text);
}

function tableCodeOf(head: BillHead): string | null {
  const table = head.seating?.primary_table_id;
  if (table === undefined || head.scope !== 'seating') return null;
  const name = branchConfig()?.floors.flatMap((f) => f.tables).find((t) => t.table_id === table)?.name ?? table;
  return tableLabel(name).slice(0, 40);
}

// ------------------------------------------------------------------------------------------------ drafts

interface Meta {
  reason_code: Payload['reason_code'];
  has_note: boolean;
  note_id: string | null;
  requester_staff_id: string;
  approver_staff_id: string | null;
  /** the request's id inside `apply`, else null (no `alert_id` key on the optional-key events) */
  alert_id: string | null;
  /** one credit id per `c.sales` entry, in order */
  credit_ids: readonly string[];
}

/** §3.10 / §6.13 step 4 drafts (1 statement: the credit number). */
function reopenDrafts(ctx: CommandCtx, c: Checked, m: Meta): { events: EventDraft[]; credits: Array<{ invoice_ref: string; total_minor: number }> } {
  const config = branchConfig();
  if (config === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  const { billing } = billingAt(config, c.today);
  const prefix = billing.settings.receipt.invoice_prefix;
  const first = ctx.tx.db.prepare(NEXT_CREDIT).pluck().get() as number; // 1
  const now = ctx.clock.branchNow();
  const env = { occurred_at: now, actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
  const optionalAlert = m.alert_id === null ? {} : { alert_id: m.alert_id };
  const reopened = BillReopenedPayload.parse({
    bill_id: c.bill_id,
    order_ids: c.order_ids,
    mode: c.mode,
    reason_code: m.reason_code,
    has_note: m.has_note,
    note_id: m.note_id,
    requester_staff_id: m.requester_staff_id,
    approver_staff_id: m.approver_staff_id,
    alert_id: m.alert_id,
  });
  const events: EventDraft[] = [draftOf(BillReopened, { stream_type: 'bill', stream_id: c.bill_id, payload: reopened, ...env })];
  const credits: Array<{ invoice_ref: string; total_minor: number }> = [];
  c.sales.forEach((s, i) => {
    const doc = JSON.parse(s.doc_json) as InvoiceDoc;
    const number = first + i;
    const invoice_ref = `${prefix}C${String(number).padStart(6, '0')}`;
    const credit = InvoiceCreditedPayload.parse({
      invoice_id: m.credit_ids[i],
      series: 'credit',
      number,
      invoice_ref,
      bill_id: c.bill_id,
      split_no: s.split_no,
      business_date: c.today,
      issued_at: now,
      // the original's (B5, H9-6): never re-read from today's rates or jurisdiction
      order_type: s.order_type,
      jurisdiction_id: s.jurisdiction_id,
      currency_code: s.currency_code,
      prices_include_tax: s.prices_include_tax === 1,
      lines: doc.lines,
      service_charge: doc.service_charge,
      subtotal_minor: s.subtotal_minor,
      discount_minor: s.discount_minor,
      service_charge_minor: s.service_charge_minor,
      taxes: doc.taxes,
      rounding_minor: s.rounding_minor,
      total_minor: s.total_minor,
      payment_class: s.payment_class,
      mixed_rule: doc.mixed_rule,
      payment_ids: doc.payment_ids,
      change_minor: s.change_minor,
      fiscal: doc.fiscal,
      has_buyer_id: s.has_buyer_id === 1,
      buyer_id_refused: s.buyer_id_refused === 1,
      // §6.13 (task 5 / integrator, #91c): the reopen's requester, never the original's closer
      closed_by: m.requester_staff_id,
      ref_invoice_id: s.invoice_id,
      ref_invoice_ref: s.invoice_ref,
      alert_id: m.alert_id,
    });
    events.push(draftOf(InvoiceCredited, { stream_type: 'bill', stream_id: c.bill_id, payload: credit, ...env }));
    credits.push({ invoice_ref, total_minor: s.total_minor });
  });
  if (c.was_closed) {
    const unbilled = OrdersUnbilledPayload.parse({ order_ids: c.order_ids, bill_id: c.bill_id, ...optionalAlert });
    events.push(draftOf(OrdersUnbilled, { stream_type: 'order', stream_id: c.order_ids[0]!, payload: unbilled, ...env }));
  }
  const seating = c.head.scope === 'seating' ? c.head.seating : null;
  if (seating !== null && seating.state !== 'CLOSED') {
    if (c.mode === 'full' && c.was_closed) {
      const payload = SeatingReopenedPayload.parse({ seating_id: seating.seating_id, bill_id: c.bill_id, ...optionalAlert });
      events.push(draftOf(SeatingReopened, { stream_type: 'table', stream_id: seating.primary_table_id, payload, ...env }));
    } else {
      // §6.4a (R-30): one table frame per transaction; ⚠️ R-43: the request's alert_id inside `apply`
      const payload = TableMarksChangedPayload.parse({ seating_id: seating.seating_id, ...optionalAlert });
      events.push(draftOf(TableMarksChanged, { stream_type: 'table', stream_id: seating.primary_table_id, payload, ...env }));
    }
  }
  return { events, credits };
}

// ------------------------------------------------------------------------------------------------ ReopenBill

function reopenBill(ctx: CommandCtx, p: Payload): { events: EventDraft[]; result: ReopenBillResult } {
  const { head } = ensureBill(ctx, { bill_id: p.bill_id }); // 1 (a bill_id ref never opens a bill)
  const bill_id = requireReopenable(head);
  const open = alerts.byDedupeKey(ctx.tx.db, 'reopen_bill', `reopen:${bill_id}`); // 1
  if (open !== null) throw new DomainError('BILL_REOPEN_PENDING', { alert_id: open });
  const c = checkReopen(ctx, head, bill_id); // 3
  requireScope(ctx, head);
  const requester = ctx.actor.staffId as string; // requireScope refused a session with no staff
  const note = noteOf(ctx, p.note);

  if (ctx.permission !== null && ctx.permission.grant === 'requires_approval') {
    // §3.14 values (H4-4, R-47, ⚠️ R-66): ids and codes only; the credit ids minted now, one per invoice, same order
    const values: ReopenBillValues = {
      bill_id,
      invoice_ids: c.sales.map((s) => s.invoice_id),
      credit_invoice_ids: c.sales.map(() => ctx.ids.next()),
      reason_code: p.reason_code,
      note_id: note.note_id,
      has_note: note.has_note,
    };
    const table_code = tableCodeOf(head);
    const details: BillRequestDetails = { amount: c.sales.reduce((a, s) => a + s.total_minor, 0), reason: p.reason_code, ...(table_code === null ? {} : { identifier: table_code }) };
    const display: AlertDisplay = { kind_label_key: 'alert.reopen_bill.lock', table_code, point_code: null, requester_name: ctx.directory.get(requester)?.display_name ?? null, device_name: null };
    const raised = alerts.raise(ctx, {
      kind: 'reopen_bill',
      subject: { stream_type: 'bill', stream_id: bill_id },
      target: { kind: 'answerers' },
      values,
      details: details as AlertDetails,
      display,
      dedupe_key: `reopen:${bill_id}`,
      requester_staff_id: requester,
      request: { approver_role_ids: ctx.permission.approver_role_ids },
    });
    if (!raised.deduped) writeNote(ctx, note); // the text is written at raise (H3-5)
    return { events: raised.events, result: { pending: { alert_id: raised.alert_id } } };
  }

  writeNote(ctx, note); // 1
  const { events, credits } = reopenDrafts(ctx, c, {
    reason_code: p.reason_code,
    has_note: note.has_note,
    note_id: note.note_id,
    requester_staff_id: requester,
    approver_staff_id: null,
    alert_id: null,
    credit_ids: c.sales.map(() => ctx.ids.next()),
  }); // 1
  return { events, result: { reopened: { mode: c.mode, credits } } };
}

/**
 * §3.14 `apply` (approve only, H8-9): re-checks §6.13 read-only at answer time — CLOSED / PARTLY_PAID, the current
 * sale invoices still exactly the request's `invoice_ids` (else the answer is refused, H2-17), `BILL_REOPEN_NOT_SUPPORTED`
 * (J-1) — and decides the mode now (§3.10 races, R-40); then the same drafts with the request's reason, note and
 * requester, this alert's id and the answerer as approver (01d: never `actor_id`). ⚠️ R-66 / G-62: the credit for
 * `invoice_ids[i]` takes `credit_invoice_ids[i]`; nothing is minted (01d AD-91). Reject → [] (0 statements).
 */
export function applyReopenBill(ctx: AlertApplyCtx<ReopenBillValues, BillRequestDetails>, answer: AnswerFacts): EventDraft[] {
  if (answer.decision !== 'approve') return [];
  const v = ctx.alert.values;
  const requester = ctx.alert.requester_staff_id;
  if (requester === null) throw new Error(`reopen_bill ${ctx.alert.alert_id}: a request always has a requester`);
  const { head, missing } = openBillOf(ctx.tx.db, { bill_id: v.bill_id }, ctx.state.business_day?.business_date ?? null); // 1
  if (missing) throw new DomainError('BILL_NOT_FOUND', { bill_id: v.bill_id });
  const bill_id = requireReopenable(head);
  const c = checkReopen(ctx, head, bill_id); // 3
  const now = c.sales.map((s) => s.invoice_id);
  // H2-17 / R-66: a credit id is only ever used for the invoice it was minted for; ⚠️ v1.0.17 R-74: a stale request →
  // 409 BILL_NOT_OPEN { bill_id, state }. The credit-id length check is redundant with the values schema's refine (one
  // id per invoice id) and kept on purpose: `alert.values` comes from the stored row, and a short list would hand
  // `reopenDrafts` an undefined invoice_id (a 500 at InvoiceCreditedPayload.parse instead of a refusal).
  if (now.length !== v.invoice_ids.length || now.some((id, i) => id !== v.invoice_ids[i]) || v.credit_invoice_ids.length !== now.length) {
    throw new DomainError('BILL_NOT_OPEN', { bill_id, state: head.state });
  }
  return reopenDrafts(ctx, c, {
    reason_code: v.reason_code,
    has_note: v.has_note,
    note_id: v.note_id,
    requester_staff_id: requester,
    approver_staff_id: answer.answerer_staff_id,
    alert_id: ctx.alert.alert_id,
    credit_ids: v.credit_invoice_ids,
  }).events; // 1
}

// 05 §3.14, PL-5 seam (task 9 reviewers' rule): module top level, a module-level function, never a closure.
registerBillKindApply('reopen_bill', { apply: applyReopenBill });

export const ReopenBill = defineCommand({
  commandType: 'ReopenBill',
  payloadSchema: ReopenBillPayload,
  sessionKind: 'device',
  permission: 'reopen-bill',
  approvable: true,
  hashOmit: ['note'], // row H-4, H16-7: the note never reaches payload_hash
  handle: (ctx, p) => reopenBill(ctx, p),
});

// ------------------------------------------------------------------------------------------------ empty close

/**
 * §3.10 (H7-3, H8-4): every split's balance with no live line left (payments in and out cancel). Pure; the config in
 * memory. Exported for AddPayment's `out` path (§6.9).
 */
export function everySplitSettled(head: BillHead, splits: readonly SplitRow[], extra: ReadonlyArray<{ split_no: number; payment_class: PaymentRow['payment_class']; direction: 'in' | 'out'; amount_minor: number; tendered_minor: number | null }> = []): boolean {
  const config = branchConfig();
  if (config === null || head.business_date === null) return false;
  const { billing, rules } = billingAt(config, head.business_date);
  const { input } = billComputeBase({ head, billing, rules, lines: [], voids: new Map(), splits });
  const openRows = splits.filter((s) => s.state === 'open');
  const payments = openRows.flatMap((s) =>
    (JSON.parse(s.payments_json) as PaymentRow[]).map((x) => ({ split_no: s.split_no, payment_class: x.payment_class, direction: x.direction, amount_minor: x.amount_minor, tendered_minor: x.tendered_minor })),
  );
  const r = computeBill({ ...input, plan: planOf(head, openRows), payments: [...payments, ...extra] });
  return r.splits.every((s) => s.balance_minor === 0);
}

/**
 * Row Q-7 order-cancelled hook (02b v1.0.17 §3.5): `order_id` is being cancelled in this command (not folded yet).
 * Its bill (a `bills` row, not closed, not absorbed) with no other live order and every split balance 0 →
 * `BillClosedEmpty` (task 17's drafts, `open: []`). Read-only, mints nothing. Statements: openBillOf (1), the order
 * set (1), the splits (1); on an empty close the cancelled orders (1), credits (1), the seating's other open bills (1).
 */
export function reopenedBillEmptied(ctx: CommandCtx, order_id: string): EventDraft[] {
  const db = ctx.tx.db;
  const { head } = openBillOf(db, { order_id }, ctx.state.business_day?.business_date ?? null); // 1
  if (head.bill_id === null || head.state === 'closed' || head.absorbed) return [];
  const bill_id = head.bill_id;
  const live = db.prepare(ORDERS_OF_BILL).pluck().all(ordersOfBillParams(head)) as string[]; // 1
  if (live.some((id) => id !== order_id)) return [];
  const rows = db.prepare(SPLITS_OF_BILL).all(bill_id) as SplitRow[]; // 1
  if (!everySplitSettled(head, rows.length === 0 ? [ONE_OPEN_SPLIT] : rows)) return [];
  const cancelled = db.prepare(CANCELLED_ORDERS_OF_BILL).pluck().all({ bill_id, seating_id: head.seating_id, bill_key: head.bill_key }) as string[]; // 1
  const order_ids = cancelled.includes(order_id) ? cancelled : [...cancelled, order_id];
  return emptyCloseDrafts(ctx, { bill_id, seating: head.seating, order_ids, open: [] });
}

/** The hook's module-level function (02b ignores a repeated registration). */
function orderCancelledHook(ctx: CommandCtx, order_id: string): EventDraft[] {
  return reopenedBillEmptied(ctx, order_id);
}

export function registerReopenBill(app: FastifyInstance): void {
  commandRegistry(app).register(ReopenBill);
  registerOrderCancelledHook(orderCancelledHook);
}
