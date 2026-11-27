import { registerAuditAction, registerRequestAction, type AuditEvent, type AuditLookups, type AuditMapped } from '@pos/domain';
import { BILL_REQUEST_KINDS } from './kinds/values.js';

// 05 §6.30, row V-3 (04 v1.0.7 §3.6), task 32a (plan PL-3, §11 H6-14): the audit maps of 05-1's events and the seven
// request kinds, registered at this module's load (billing/index.ts imports it statically), before the `audit`
// projection is built and sealed. They ship with 0023's `audit` checkpoint delete, so a hub refolds `audit` from
// seq 0 with them (02a `BillRequested` has history). Task 32b (plan §3 row 32b) adds 05-2's events (shift count /
// close / handover / sign-off, petty cash, drawer, carry-over, Z) to the same table, with no second refold (H6-14: they
// have no history before 05-2). `DiscountFrozen` has no action of its own (§6.29: the close audits `invoice_issued`).
//
// §6.30 map: actor = the requester on approvable acts (the envelope actor of an `apply` is the answerer), approver
// from the event; subject `bill` / `shift` / `order` (and 02a's `table`, 01a's `hub`); `amount_minor`; `reason` = the
// reason code (events carry no text, H3-5). Detail ≤ 2 KB, ids, codes and counts only: **no buyer field, no
// reference, no `paid_to`, no note beyond `has_note` / `note_id`, no names, no bill key** (a parking plate, H2-21).

function str(p: Record<string, unknown>, key: string): string | null {
  const v = p[key];
  return typeof v === 'string' ? v : null;
}

function num(p: Record<string, unknown>, key: string): number | null {
  const v = p[key];
  return typeof v === 'number' ? v : null;
}

function bool(p: Record<string, unknown>, key: string): boolean | null {
  const v = p[key];
  return typeof v === 'boolean' ? v : null;
}

const bill = (e: AuditEvent): { subject_type: string; subject_id: string } => ({
  subject_type: 'bill',
  subject_id: str(e.payload, 'bill_id') ?? e.stream_id,
});

/** Approvable acts whose event names both people (`requester_staff_id`, `approver_staff_id`, `alert_id`). */
function approved(e: AuditEvent): Pick<AuditMapped, 'actor_staff_id' | 'approver_staff_id'> {
  return { actor_staff_id: str(e.payload, 'requester_staff_id') ?? e.actor_id, approver_staff_id: str(e.payload, 'approver_staff_id') };
}

const note = (p: Record<string, unknown>): { has_note: boolean | null; note_id: string | null } => ({
  has_note: bool(p, 'has_note'),
  note_id: str(p, 'note_id'),
});

const shift = (e: AuditEvent): { subject_type: string; subject_id: string } => ({
  subject_type: 'shift',
  subject_id: str(e.payload, 'shift_id') ?? e.stream_id,
});

/** A day act on the `hub` stream: subject `day` = the stream id, as 04's `day_opened` (business date in the detail). */
const day = (e: AuditEvent): { subject_type: string; subject_id: string } => ({ subject_type: 'day', subject_id: e.stream_id });

/** §6.17 / §6.19 count facts (the count reveals expected, B23); the counter is the act's person. */
function count(e: AuditEvent): Pick<AuditMapped, 'actor_staff_id' | 'amount_minor'> & { detail: Record<string, unknown> } {
  return {
    actor_staff_id: str(e.payload, 'by_staff_id') ?? e.actor_id,
    amount_minor: num(e.payload, 'counted_minor'),
    detail: { counted_minor: num(e.payload, 'counted_minor'), expected_minor: num(e.payload, 'expected_minor'), variance_minor: num(e.payload, 'variance_minor') },
  };
}

/** §6.20: kind, amount, category, ids; never `paid_to` (nor `has_paid_to`, as `has_reference`, H1-20) or a name. */
function pettyEntry(kind: 'advance' | 'out' | 'in'): (e: AuditEvent) => AuditMapped {
  return (e) => ({
    action: 'petty_cash',
    ...shift(e),
    ...approved(e),
    amount_minor: num(e.payload, 'amount_minor'),
    detail: {
      kind,
      entry_id: str(e.payload, 'entry_id'),
      shift_id: str(e.payload, 'shift_id'),
      category_id: str(e.payload, 'category_id'),
      advance_staff_id: str(e.payload, 'advance_staff_id'),
      has_note: bool(e.payload, 'has_note'),
      alert_id: str(e.payload, 'alert_id'),
    },
  });
}

/** The invoice facts both series share (§6.12: number, total, class; never lines, names or buyer fields). */
const invoice = (p: Record<string, unknown>): Record<string, unknown> => ({
  invoice_id: str(p, 'invoice_id'),
  invoice_ref: str(p, 'invoice_ref'),
  number: num(p, 'number'),
  split_no: num(p, 'split_no'),
});

/** The audit map of every 05 event (exported for tests that rebuild a registry after resetAuditActions, task 33). */
export const MAPS: Readonly<Record<string, (e: AuditEvent, l: AuditLookups) => AuditMapped>> = {
  // 02a's event (table stream, §6.4): no bill may exist yet, so the subject is the table
  BillRequested: (e) => {
    const table_id = str(e.payload, 'table_id') ?? e.stream_id;
    return { action: 'bill_requested', subject_type: 'table', subject_id: table_id, table_id, detail: { seating_id: str(e.payload, 'seating_id') } };
  },

  BillOpened: (e) => ({
    action: 'bill_opened',
    ...bill(e),
    detail: { scope: str(e.payload, 'scope'), seating_id: str(e.payload, 'seating_id'), order_type: str(e.payload, 'order_type') },
  }),

  CheckBillPrinted: (e) => ({
    action: 'check_bill_printed',
    ...bill(e),
    amount_minor: num(e.payload, 'total_default_minor'),
    detail: {
      line_count: num(e.payload, 'line_count'),
      printer_id: str(e.payload, 'printer_id'),
      job_id: str(e.payload, 'job_id'),
      source: str(e.payload, 'source'),
    },
  }),

  // §6.5: counts only
  BillSplitsSet: (e) => ({
    action: 'splits_set',
    ...bill(e),
    detail: { mode: str(e.payload, 'mode'), split_count: Array.isArray(e.payload['splits']) ? e.payload['splits'].length : null },
  }),

  DiscountApplied: (e) => ({
    action: 'discount_applied',
    ...bill(e),
    ...approved(e),
    reason: str(e.payload, 'reason_code'),
    amount_minor: num(e.payload, 'amount_minor'),
    detail: {
      kind: str(e.payload, 'kind'),
      value: num(e.payload, 'value'),
      replaces: bool(e.payload, 'replaces'),
      alert_id: str(e.payload, 'alert_id'),
      ...note(e.payload),
    },
  }),

  // §6.29: not approvable (no requester, approver or alert)
  DiscountRemoved: (e) => ({ action: 'discount_removed', ...bill(e), reason: str(e.payload, 'reason_code'), detail: note(e.payload) }),

  ChargeRemoved: (e) => ({
    action: 'service_charge_removed',
    ...bill(e),
    ...approved(e),
    reason: str(e.payload, 'reason_code'),
    detail: { charge: str(e.payload, 'charge'), alert_id: str(e.payload, 'alert_id'), ...note(e.payload) },
  }),

  ChargeApplied: (e) => ({
    action: 'service_charge_applied',
    ...bill(e),
    detail: { charge: str(e.payload, 'charge'), rate_bp: num(e.payload, 'rate_bp'), source: str(e.payload, 'source'), ...note(e.payload) },
  }),

  // §6.9: mode, amount, shift; no names, no reference (H1-20: `has_reference` is not copied either)
  PaymentAdded: (e) => ({
    action: 'payment_added',
    ...bill(e),
    amount_minor: num(e.payload, 'amount_minor'),
    detail: {
      payment_id: str(e.payload, 'payment_id'),
      split_no: num(e.payload, 'split_no'),
      mode_id: str(e.payload, 'mode_id'),
      payment_class: str(e.payload, 'payment_class'),
      direction: str(e.payload, 'direction'),
      tendered_minor: num(e.payload, 'tendered_minor'),
      change_minor: num(e.payload, 'change_minor'),
      shift_id: str(e.payload, 'shift_id'),
      taken_by_staff_id: str(e.payload, 'taken_by_staff_id'),
    },
  }),

  PaymentRemoved: (e) => ({
    action: 'payment_removed',
    ...bill(e),
    reason: str(e.payload, 'reason_code'),
    amount_minor: num(e.payload, 'amount_minor'),
    detail: {
      payment_id: str(e.payload, 'payment_id'),
      split_no: num(e.payload, 'split_no'),
      mode_id: str(e.payload, 'mode_id'),
      payment_class: str(e.payload, 'payment_class'),
      direction: str(e.payload, 'direction'),
      change_minor: num(e.payload, 'change_minor'),
      shift_id: str(e.payload, 'shift_id'),
      taken_by_staff_id: str(e.payload, 'taken_by_staff_id'),
      has_note: bool(e.payload, 'has_note'),
    },
  }),

  BuyerIdWaived: (e) => ({
    action: 'buyer_id_waived',
    ...bill(e),
    ...approved(e),
    detail: { alert_id: str(e.payload, 'alert_id'), ...note(e.payload) },
  }),

  // §6.12: number, total, class, has_buyer_id only
  InvoiceIssued: (e) => ({
    action: 'invoice_issued',
    ...bill(e),
    amount_minor: num(e.payload, 'total_minor'),
    detail: { ...invoice(e.payload), payment_class: str(e.payload, 'payment_class'), has_buyer_id: bool(e.payload, 'has_buyer_id') },
  }),

  // §6.13 (R-40 / G-37): with the mode, read from the event
  BillReopened: (e) => ({
    action: 'bill_reopened',
    ...bill(e),
    ...approved(e),
    reason: str(e.payload, 'reason_code'),
    outcome: str(e.payload, 'mode'),
    detail: {
      order_ids: Array.isArray(e.payload['order_ids']) ? e.payload['order_ids'] : [],
      alert_id: str(e.payload, 'alert_id'),
      ...note(e.payload),
    },
  }),

  // §6.13: `closed_by` = the reopen's requester (the act's person); the event names no approver
  InvoiceCredited: (e) => ({
    action: 'invoice_credited',
    ...bill(e),
    actor_staff_id: str(e.payload, 'closed_by') ?? e.actor_id,
    amount_minor: num(e.payload, 'total_minor'),
    detail: {
      ...invoice(e.payload),
      ref_invoice_id: str(e.payload, 'ref_invoice_id'),
      ref_invoice_ref: str(e.payload, 'ref_invoice_ref'),
      payment_class: str(e.payload, 'payment_class'),
      alert_id: str(e.payload, 'alert_id'),
    },
  }),

  // the fiscal worker's answer (§3.15): no request body, the short error code only
  FiscalSubmitRejected: (e) => ({
    action: 'fiscal_rejected',
    subject_type: 'bill',
    subject_id: e.stream_id,
    detail: {
      invoice_id: str(e.payload, 'invoice_id'),
      adapter_key: str(e.payload, 'adapter_key'),
      error_code: str(e.payload, 'error_code'),
      http_status: num(e.payload, 'http_status'),
    },
  }),

  // 02b's event (order stream, row Q-4), written by 05's RemoveComp
  LineCompRemoved: (e) => ({
    action: 'comp_removed',
    subject_type: 'order',
    subject_id: e.stream_id,
    ...approved(e),
    reason: str(e.payload, 'reason_code'),
    amount_minor: num(e.payload, 'comp_minor'),
    detail: {
      order_item_id: str(e.payload, 'order_item_id'),
      units: num(e.payload, 'units'),
      alert_id: str(e.payload, 'alert_id'),
      ...note(e.payload),
    },
  }),

  ShiftOpened: (e) => ({
    action: 'shift_opened',
    subject_type: 'shift',
    subject_id: str(e.payload, 'shift_id') ?? e.stream_id,
    amount_minor: num(e.payload, 'float_minor'),
    detail: {
      staff_id: str(e.payload, 'staff_id'),
      drawer_device_id: str(e.payload, 'drawer_device_id'),
      business_date: str(e.payload, 'business_date'),
    },
  }),

  // B14: `alert_id` only inside an approval `apply` (the order-cancelled hook); then the act is the requester's
  BillClosedEmpty: (e, l) => {
    const alert_id = str(e.payload, 'alert_id');
    const req = alert_id === null ? null : l.requestOf(alert_id);
    return {
      action: 'bill_closed_empty',
      ...bill(e),
      ...(req !== null ? { actor_staff_id: req.requester_staff_id, approver_staff_id: req.answerer_staff_id } : {}),
      detail: {
        seating_id: str(e.payload, 'seating_id'),
        credit_invoice_ids: Array.isArray(e.payload['credit_invoice_ids']) ? e.payload['credit_invoice_ids'] : [],
        alert_id,
      },
    };
  },

  // §6.28a: ids and time only (never the token, nor the credential's name)
  FiscalTokenSet: (e) => ({
    action: 'fiscal_token_changed',
    subject_type: 'hub',
    subject_id: e.stream_id,
    actor_staff_id: str(e.payload, 'set_by_staff_id') ?? e.actor_id,
    detail: { pos_id: str(e.payload, 'pos_id'), set_at: num(e.payload, 'set_at') },
  }),

  // ------------------------------------------------------------------------------------ 05-2 (task 32b)

  ShiftCounted: (e) => {
    const c = count(e);
    return { action: 'shift_counted', ...shift(e), ...c, detail: { ...c.detail, variance_alert_id: str(e.payload, 'variance_alert_id') } };
  },

  // §6.18: the shift id alone; ShiftClosed carries who closed it and the note
  ShiftCountSkipped: (e) => ({ action: 'shift_count_skipped', ...shift(e) }),

  HandoverCounted: (e) => ({ action: 'handover_counted', ...shift(e), ...count(e) }),

  ShiftClosed: (e) => ({
    action: 'shift_closed',
    ...shift(e),
    actor_staff_id: str(e.payload, 'closed_by') ?? e.actor_id,
    approver_staff_id: str(e.payload, 'approver_staff_id'),
    detail: { alert_id: str(e.payload, 'alert_id'), ...note(e.payload) },
  }),

  // written only by the `shift_variance` apply: the act is the request's (the counter, R-78), the approver the answerer
  ShiftVarianceSignedOff: (e, l) => {
    const alert_id = str(e.payload, 'alert_id');
    const req = alert_id === null ? null : l.requestOf(alert_id);
    return {
      action: 'shift_variance_signed_off',
      ...shift(e),
      // miss fallback: a sign-off always comes from a raised request, so actor = approver here is unreachable in practice
      actor_staff_id: req?.requester_staff_id ?? e.actor_id,
      approver_staff_id: str(e.payload, 'approver_staff_id'),
      outcome: str(e.payload, 'outcome'),
      detail: { alert_id, business_date: str(e.payload, 'business_date') },
    };
  },

  PettyCashAdvanced: pettyEntry('advance'),
  PettyCashOut: pettyEntry('out'),
  PettyCashIn: pettyEntry('in'),

  // §6.20 settle: amount = spent + returned (the advance's amount, PETTY_SETTLE_MISMATCH guards it)
  PettyCashSettled: (e) => {
    const spent = num(e.payload, 'spent_minor');
    const returned = num(e.payload, 'returned_minor');
    return {
      action: 'petty_cash',
      ...shift(e),
      amount_minor: spent !== null && returned !== null ? spent + returned : null,
      detail: {
        kind: 'settle',
        entry_id: str(e.payload, 'entry_id'),
        shift_id: str(e.payload, 'shift_id'),
        spent_minor: spent,
        returned_minor: returned,
        ...note(e.payload),
      },
    };
  },

  // §6.21: `device_id` is the drawer's (the envelope's device may differ)
  DrawerOpened: (e) => ({
    action: 'drawer_opened',
    ...shift(e),
    reason: str(e.payload, 'reason_code'),
    detail: { device_id: str(e.payload, 'device_id'), ...note(e.payload) },
  }),

  // §6.24: ≤ 40 order ids (well under 2 KB)
  OrdersCarriedOver: (e) => ({
    action: 'orders_carried_over',
    ...day(e),
    reason: str(e.payload, 'reason_code'),
    detail: {
      business_date: str(e.payload, 'business_date'),
      order_ids: Array.isArray(e.payload['order_ids']) ? e.payload['order_ids'] : [],
      ...note(e.payload),
    },
  }),

  // §6.25: the Z number and day only; never `report` (staff ids, mode / category names, carried labels; > 2 KB)
  ZReportIssued: (e) => ({
    action: 'z_report_issued',
    ...day(e),
    detail: { business_date: str(e.payload, 'business_date'), z_no: num(e.payload, 'z_no') },
  }),

  // ⚠️ 05 v1.0.35 §6.3a Audit, row V-4 (R2-M-4; run 3 R3-M-7): subject the hub (the branch), ids and counts only
  CartCheckBillPrinted: (e) => ({
    action: 'cart_check_bill_printed',
    subject_type: 'hub',
    subject_id: e.stream_id,
    amount_minor: num(e.payload, 'total_default_minor'),
    detail: {
      job_id: str(e.payload, 'job_id'),
      printer_id: str(e.payload, 'printer_id'),
      line_count: num(e.payload, 'line_count'),
      total_default_minor: num(e.payload, 'total_default_minor'),
      device_id: str(e.payload, 'device_id'),
    },
  }),
};

for (const [event_type, map] of Object.entries(MAPS)) registerAuditAction(event_type, map);

// row V-3 (H1-8): `discount` → discount_requested / discount_answered; the other six → money_request_raised /
// money_request_answered (the kind is in the answered row's detail, 04's RequestAnswered map)
for (const kind of BILL_REQUEST_KINDS) {
  registerRequestAction(
    kind,
    kind === 'discount'
      ? { requested: 'discount_requested', answered: 'discount_answered' }
      : { requested: 'money_request_raised', answered: 'money_request_answered' },
  );
}
