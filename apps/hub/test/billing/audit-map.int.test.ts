import { AUDIT_ACTIONS, auditEventTypes } from '@pos/domain';
import type { EventDraft, PosEvent } from '@pos/events';
import {
  aBillClosedEmpty,
  aBillOpened,
  aBillReopened,
  aBillSplitsSet,
  aBuyerIdWaived,
  aChargeApplied,
  aChargeRemoved,
  aCheckBillPrinted,
  aDiscountApplied,
  aDiscountRemoved,
  aDrawerOpened,
  aFiscalSubmitRejected,
  aFiscalTokenSet,
  aHandoverCounted,
  anInvoiceCredited,
  anInvoiceIssued,
  aPaymentAdded,
  aPaymentRemoved,
  aPettyCashAdvanced,
  aPettyCashIn,
  aPettyCashOut,
  aPettyCashSettled,
  aShiftClosed,
  aShiftCounted,
  aShiftCountSkipped,
  aShiftOpened,
  aShiftVarianceSignedOff,
  aZReportIssued,
} from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditProjection } from '../../src/audit/projection';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { currentDirectory } from '../../src/auth/guards';
import type { BillRequestKind } from '../../src/billing/kinds/values';
import type { CommandCtx } from '../../src/commands/registry';
import { createProjectionRegistry } from '../../src/projections/registry';
import type { TestHub } from '../helpers/test-hub';
import { answer, billingDirectory, signIn, startBilling, STAFF, type Who } from './fixtures';

// 05 §6.30, row V-3, §10 test #87 (05-1 half; task 32a, plan PL-3, §11 H6-14): every 05-1 event of row V-3 maps to its
// audit action through registerAuditAction (billing/audit-map.ts, at module load); the seven request kinds map their
// AlertRaised / RequestAnswered through registerRequestAction; a rebuild of `audit` equals live; `detail_json` carries
// no buyer data, names, phones, notes, references, tokens or PINs (permanent privacy scan below). Real events through
// the hub's writer (task-5 builders, ids overridden), folded by the real `audit` projection; literal values.
// Task 32b (plan §3 row 32b, H6-14) adds the 05-2 half: shift count / close / handover / sign-off, petty cash and
// settle, drawer, carry-over and Z, through the same file (no second refold: 05-2's events have no history before it).

let hub: TestHub;
let cashier: Who;
let manager: Who;

beforeEach(async () => {
  hub = await startBilling();
  signIn(hub, 'S_OWNER');
  manager = signIn(hub, STAFF.manager);
  cashier = signIn(hub, STAFF.cashier);
});

afterEach(async () => {
  await hub.close();
});

type Draft = Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id'>;

/** A builder's event as a draft, its payload merged with `payload`. */
function d(built: PosEvent, payload: Record<string, unknown>, stream_id: string): Draft {
  return {
    stream_type: built.stream_type,
    stream_id,
    event_type: built.event_type,
    schema_version: built.schema_version,
    payload: { ...(built.payload as Record<string, unknown>), ...payload },
  };
}

function raw(stream_type: EventDraft['stream_type'], stream_id: string, event_type: string, payload: Record<string, unknown>): Draft {
  return { stream_type, stream_id, event_type, schema_version: 1, payload };
}

/** One writer transaction, envelope actor `actor` on device D_FIXTURE; returns the appended event's id. */
function append(actor: string | null, draft: Draft): string {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  const out = hub.deps.writer.run((tx) => tx.append([{ ...draft, occurred_at: now, actor_id: actor, device_id: 'D_FIXTURE' }]));
  return out.appended[0]!.event_id;
}

/** The kinds test's raise (test/billing/kinds.int.test.ts `raiseAs`): one request raised by `who` through 01d. */
function raiseAs(who: Who, input: RaiseInput): string {
  return hub.deps.writer.run((tx) => {
    const ctx = {
      tx,
      state: tx.state,
      clock: tx.clock,
      ids: tx.ids,
      secrets: hub.deps.secrets,
      actor: { kind: 'staff', staffId: who.staffId, stationId: null, sessionId: who.sessionId, deviceId: who.deviceId },
      permission: null,
      branch: { tenantId: 'tenant-a', branchId: 'branch-1' },
      directory: currentDirectory(hub.app),
      config: hub.deps.config,
    } as unknown as CommandCtx;
    const result = alerts.raise(ctx, input);
    tx.append(result.events);
    return result.alert_id;
  }).result;
}

/** One valid raise per kind (kinds.int.test.ts RAISE): values ids only, details in AlertDetailsBase keys. */
const RAISE: Record<BillRequestKind, Pick<RaiseInput, 'subject' | 'values' | 'details' | 'dedupe_key'>> = {
  discount: { subject: { stream_type: 'bill', stream_id: 'B1' }, values: { bill_id: 'B1', kind: 'percent', value: 1_000, reason_code: 'regular_customer', note_id: null, has_note: false }, details: { amount: 50_000, reason: 'regular_customer', identifier: 'T4' }, dedupe_key: 'discount:B1' },
  remove_service_charge: { subject: { stream_type: 'bill', stream_id: 'B1' }, values: { bill_id: 'B1', reason_code: 'customer_request', note_id: 'N1', has_note: true }, details: { amount: 20_000, reason: 'customer_request', identifier: 'T4' }, dedupe_key: 'remove_sc:B1' },
  reopen_bill: { subject: { stream_type: 'bill', stream_id: 'B1' }, values: { bill_id: 'B1', invoice_ids: ['I1'], credit_invoice_ids: ['C1'] /* 05 v1.0.15 R-66 */, reason_code: 'wrong_payment_mode', note_id: null, has_note: false }, details: { amount: 300_000, reason: 'wrong_payment_mode', identifier: 'T4' }, dedupe_key: 'reopen:B1' },
  remove_comp: { subject: { stream_type: 'order', stream_id: 'O1' }, values: { order_id: 'O1', order_item_id: 'L1', units: 1, reason_code: 'comped_by_mistake', note_id: null, has_note: false }, details: { amount: 3_000, reason: 'comped_by_mistake', identifier: 'T4' }, dedupe_key: 'remove_comp:L1' },
  close_without_buyer_id: { subject: { stream_type: 'bill', stream_id: 'B1' }, values: { bill_id: 'B1', note_id: null, has_note: false }, details: { amount: 6_000_000, identifier: 'T4' }, dedupe_key: 'buyer_waiver:B1' },
  petty_cash: { subject: { stream_type: 'shift', stream_id: 'SH1' }, values: { entry_id: 'E1', kind: 'out', shift_id: 'SH1', amount_minor: 600_000, category_id: 'supplies', has_paid_to: true, advance_staff_id: null, has_note: true }, details: { amount: 600_000, reason: 'supplies' }, dedupe_key: 'petty:CMD1' },
  shift_variance: { subject: { stream_type: 'shift', stream_id: 'SH1' }, values: { shift_id: 'SH1', note_id: null, has_note: false }, details: { amount: -15_000 }, dedupe_key: 'variance:SH1' },
};

const APPROVAL_GRANT: Partial<Record<BillRequestKind, string>> = {
  discount: 'apply-discount',
  remove_service_charge: 'remove-service-charge',
  reopen_bill: 'reopen-bill',
  remove_comp: 'remove-comp',
  close_without_buyer_id: 'close-without-buyer-id',
};

function raiseKind(kind: BillRequestKind, who: Who = cashier): string {
  const request = APPROVAL_GRANT[kind] === undefined ? {} : { approver_role_ids: ['R_MGR'] };
  return raiseAs(who, { kind, target: { kind: 'answerers' }, display: { kind_label_key: `alert.${kind}.lock` }, requester_staff_id: who.staffId, request, ...RAISE[kind] });
}

type Row = Record<string, unknown> & { detail: Record<string, unknown> };

const COLS =
  'seq, event_id, action, actor_staff_id, approver_staff_id, method, device_id, subject_type, subject_id, order_id, table_code, table_id, reason, outcome, amount_minor, detail_json';

function rowOf(event_id: string): Omit<Row, 'seq' | 'event_id' | 'device_id'> {
  const r = hub.deps.db.prepare(`SELECT ${COLS} FROM audit_entries WHERE event_id = ?`).get(event_id) as Record<string, unknown> | undefined;
  if (r === undefined) throw new Error(`no audit row for ${event_id}`);
  const { seq: _s, event_id: _e, device_id: _d, detail_json, ...rest } = r;
  void _s;
  void _e;
  void _d;
  return { ...rest, detail: JSON.parse(detail_json as string) as Record<string, unknown> };
}

/** The AlertRaised / RequestAnswered row of one request. */
function requestRow(type: 'AlertRaised' | 'RequestAnswered', alert_id: string): Omit<Row, 'seq' | 'event_id' | 'device_id'> {
  const ids = hub.deps.db
    .prepare(`SELECT event_id FROM events WHERE event_type = ? AND json_extract(payload, '$.alert_id') = ?`)
    .pluck()
    .all(type, alert_id) as string[];
  expect(ids, `${type} ${alert_id}`).toHaveLength(1);
  return rowOf(ids[0]!);
}

const dumpAudit = () => hub.deps.db.prepare(`SELECT ${COLS} FROM audit_entries ORDER BY seq`).all();

/** Row defaults of a plain 05 action (04 §3.6 "every other action"). */
const base = { approver_staff_id: null, method: null, order_id: null, table_code: null, table_id: null, reason: null, outcome: null, amount_minor: null };

// ---------------------------------------------------------------------------------------------- registrations

/** The 05-1 events of row V-3 (§6.29 / §6.30), each with its action. */
const MAPPED_05_1: Record<string, string> = {
  BillOpened: 'bill_opened',
  CheckBillPrinted: 'check_bill_printed',
  BillRequested: 'bill_requested',
  BillSplitsSet: 'splits_set',
  DiscountApplied: 'discount_applied',
  DiscountRemoved: 'discount_removed',
  ChargeRemoved: 'service_charge_removed',
  ChargeApplied: 'service_charge_applied',
  PaymentAdded: 'payment_added',
  PaymentRemoved: 'payment_removed',
  BuyerIdWaived: 'buyer_id_waived',
  InvoiceIssued: 'invoice_issued',
  BillReopened: 'bill_reopened',
  InvoiceCredited: 'invoice_credited',
  FiscalSubmitRejected: 'fiscal_rejected',
  LineCompRemoved: 'comp_removed',
  ShiftOpened: 'shift_opened',
  BillClosedEmpty: 'bill_closed_empty',
  FiscalTokenSet: 'fiscal_token_changed',
};

/** The 05-2 events of row V-3 (§6.17–§6.21, §6.24, §6.25), each with its action (task 32b). */
const MAPPED_05_2: Record<string, string> = {
  ShiftCounted: 'shift_counted',
  ShiftCountSkipped: 'shift_count_skipped',
  HandoverCounted: 'handover_counted',
  ShiftClosed: 'shift_closed',
  ShiftVarianceSignedOff: 'shift_variance_signed_off',
  PettyCashAdvanced: 'petty_cash',
  PettyCashOut: 'petty_cash',
  PettyCashIn: 'petty_cash',
  PettyCashSettled: 'petty_cash',
  DrawerOpened: 'drawer_opened',
  OrdersCarriedOver: 'orders_carried_over',
  ZReportIssued: 'z_report_issued',
};

describe('[05 §6.30, row V-3] audit registrations at module load (tasks 32a, 32b)', () => {
  it('[05 #87] every 05 event of row V-3 is a mapped audit event type; DiscountFrozen, FiscalNumberAssigned, OrdersBilled and OrdersUnbilled are not', () => {
    const types = auditEventTypes();
    for (const t of [...Object.keys(MAPPED_05_1), ...Object.keys(MAPPED_05_2)]) expect(types, t).toContain(t);
    for (const action of [...Object.values(MAPPED_05_1), ...Object.values(MAPPED_05_2)]) expect(AUDIT_ACTIONS as readonly string[], action).toContain(action);
    // §6.29: DiscountFrozen has no audit action of its own (the close audits invoice_issued); FiscalNumberAssigned,
    // OrdersBilled and OrdersUnbilled are not in row V-3
    for (const t of ['DiscountFrozen', 'FiscalNumberAssigned', 'OrdersBilled', 'OrdersUnbilled']) expect(types, t).not.toContain(t);
  });
});

// ---------------------------------------------------------------------------------------------- #87 rows

/** Values the map must never copy (B19, B30, H2-21, J-4): a parking plate (`bill_key`), a menu name on a line. */
const PLATE = 'LEB 1234';
const LINE_NAME = 'Chicken Karahi — Half';

/** A scripted 05-1 bill life: every mapped 05-1 event once (twice where the approval path differs). */
function scriptedBills(): Record<string, string> {
  const ev: Record<string, string> = {};
  ev.billRequested = append('S_WAIT', raw('table', 'T4', 'BillRequested', { seating_id: 'SEAT1', table_id: 'T4', by_staff_id: 'S_WAIT' }));
  ev.opened = append('S_CASH', d(aBillOpened(), { bill_id: 'B1', seating_id: 'SEAT1' }, 'B1'));
  ev.openedKey = append(
    'S_CASH',
    d(aBillOpened(), { bill_id: 'B2', scope: 'key', seating_id: null, bill_key: PLATE, order_type: 'parking', prices_include_tax: true }, 'B2'),
  );
  ev.chargeApplied = append('S_CASH', d(aChargeApplied(), { bill_id: 'B1' }, 'B1'));
  ev.checkPrinted = append('S_CASH', d(aCheckBillPrinted(), { bill_id: 'B1', printer_id: 'PR1', job_id: 'J1' }, 'B1'));
  ev.splits = append(
    'S_CASH',
    d(aBillSplitsSet(), { bill_id: 'B1', mode: 'equal', splits: [1, 2].map((split_no) => ({ split_no, lines: null, share_minor: null })) }, 'B1'),
  );
  // approval path: the envelope actor is the answering Manager; the act is the Cashier's
  ev.discountApplied = append(
    'S_MGR',
    d(aDiscountApplied(), { bill_id: 'B1', requester_staff_id: 'S_CASH', approver_staff_id: 'S_MGR', alert_id: 'AL_D', has_note: true, note_id: 'N1' }, 'B1'),
  );
  ev.discountRemoved = append('S_CASH', d(aDiscountRemoved(), { bill_id: 'B1', note_id: 'N2' }, 'B1'));
  ev.chargeRemoved = append(
    'S_MGR',
    d(aChargeRemoved(), { bill_id: 'B1', note_id: 'N3', requester_staff_id: 'S_CASH', approver_staff_id: 'S_MGR', alert_id: 'AL_SC' }, 'B1'),
  );
  ev.shiftOpened = append('S_CASH', d(aShiftOpened(), { shift_id: 'SH1', staff_id: 'S_CASH', drawer_device_id: 'D_KIOSK' }, 'SH1'));
  ev.paymentAdded = append(
    'S_CASH',
    d(aPaymentAdded(), { payment_id: 'P1', bill_id: 'B1', split_no: 1, has_reference: true, taken_by_staff_id: 'S_CASH', shift_id: 'SH1' }, 'B1'),
  );
  ev.paymentRemoved = append(
    'S_CASH',
    d(aPaymentRemoved(), { payment_id: 'P1', bill_id: 'B1', split_no: 1, taken_by_staff_id: 'S_CASH', shift_id: 'SH1' }, 'B1'),
  );
  ev.buyerWaived = append(
    'S_MGR',
    d(aBuyerIdWaived(), { bill_id: 'B1', has_note: true, note_id: 'N4', requester_staff_id: 'S_CASH', approver_staff_id: 'S_MGR', alert_id: 'AL_W' }, 'B1'),
  );
  const sale = anInvoiceIssued().payload as Record<string, unknown>;
  ev.invoiceIssued = append(
    'S_CASH',
    d(anInvoiceIssued(), { invoice_id: 'I1', bill_id: 'B1', payment_ids: ['P1'], has_buyer_id: true, closed_by: 'S_CASH', discount_line_ids: ['L1'] }, 'B1'),
  );
  ev.fiscalRejected = append(null, d(aFiscalSubmitRejected(), { invoice_id: 'I1', http_status: 422 }, 'B1'));
  ev.reopened = append(
    'S_MGR',
    d(aBillReopened(), { bill_id: 'B1', mode: 'corrections', order_ids: ['O1', 'O2'], has_note: true, note_id: 'N5', requester_staff_id: 'S_CASH', approver_staff_id: 'S_MGR', alert_id: 'AL_R' }, 'B1'),
  );
  ev.credited = append(
    'S_MGR',
    d(
      anInvoiceCredited(),
      { invoice_id: 'C1', bill_id: 'B1', payment_ids: ['P1'], has_buyer_id: true, ref_invoice_id: 'I1', ref_invoice_ref: sale['invoice_ref'], closed_by: 'S_CASH', alert_id: 'AL_R' },
      'B1',
    ),
  );
  ev.closedEmpty = append('S_CASH', d(aBillClosedEmpty(), { bill_id: 'B2', seating_id: null, credit_invoice_ids: ['C1'], alert_id: undefined }, 'B2'));
  ev.compRemoved = append(
    'S_MGR',
    raw('order', 'O1', 'LineCompRemoved', {
      order_item_id: 'L1',
      units: 1,
      comp_minor: 3_000,
      reason_code: 'comped_by_mistake',
      has_note: true,
      note_id: 'N6',
      requester_staff_id: 'S_CASH',
      approver_staff_id: 'S_MGR',
      alert_id: 'AL_C',
    }),
  );
  ev.tokenSet = append('S_OWNER', d(aFiscalTokenSet(), { pos_id: 'POS-1', set_at: 1_761_000_000_000, set_by_staff_id: 'S_OWNER' }, 'branch-1'));
  return ev;
}

describe('[05 #87 (05-1 events), §6.30, row V-3] each 05-1 event → its audit row', () => {
  it('[05 #87] the scripted bill: one row per event, the §6.30 columns (actor = requester on approved acts, approver from the event), ids and counts in the detail', () => {
    const ev = scriptedBills();
    const env = (actor: string | null) => ({ envelope_actor_id: actor });

    expect(rowOf(ev.billRequested)).toEqual({
      ...base,
      action: 'bill_requested',
      actor_staff_id: 'S_WAIT',
      subject_type: 'table',
      subject_id: 'T4',
      table_id: 'T4',
      detail: { seating_id: 'SEAT1', ...env('S_WAIT') },
    });
    expect(rowOf(ev.opened)).toEqual({
      ...base,
      action: 'bill_opened',
      actor_staff_id: 'S_CASH',
      subject_type: 'bill',
      subject_id: 'B1',
      detail: { scope: 'seating', seating_id: 'SEAT1', order_type: 'dine_in', ...env('S_CASH') },
    });
    expect(rowOf(ev.openedKey), 'the bill key (a parking plate, H2-21) is not copied').toEqual({
      ...base,
      action: 'bill_opened',
      actor_staff_id: 'S_CASH',
      subject_type: 'bill',
      subject_id: 'B2',
      detail: { scope: 'key', seating_id: null, order_type: 'parking', ...env('S_CASH') },
    });
    expect(rowOf(ev.chargeApplied)).toEqual({
      ...base,
      action: 'service_charge_applied',
      actor_staff_id: 'S_CASH',
      subject_type: 'bill',
      subject_id: 'B1',
      detail: { charge: 'service', rate_bp: 500, source: 'rule', has_note: false, note_id: null, ...env('S_CASH') },
    });
    expect(rowOf(ev.checkPrinted)).toEqual({
      ...base,
      action: 'check_bill_printed',
      actor_staff_id: 'S_CASH',
      subject_type: 'bill',
      subject_id: 'B1',
      amount_minor: 695_500,
      detail: { line_count: 1, printer_id: 'PR1', job_id: 'J1', source: 'manual', ...env('S_CASH') },
    });
    expect(rowOf(ev.splits), '§6.5: counts only').toEqual({
      ...base,
      action: 'splits_set',
      actor_staff_id: 'S_CASH',
      subject_type: 'bill',
      subject_id: 'B1',
      detail: { mode: 'equal', split_count: 2, ...env('S_CASH') },
    });
    expect(rowOf(ev.discountApplied)).toEqual({
      ...base,
      action: 'discount_applied',
      actor_staff_id: 'S_CASH',
      approver_staff_id: 'S_MGR',
      subject_type: 'bill',
      subject_id: 'B1',
      reason: 'regular_customer',
      amount_minor: 57_100,
      detail: { kind: 'percent', value: 1_000, replaces: false, alert_id: 'AL_D', has_note: true, note_id: 'N1', ...env('S_MGR') },
    });
    expect(rowOf(ev.discountRemoved)).toEqual({
      ...base,
      action: 'discount_removed',
      actor_staff_id: 'S_CASH',
      subject_type: 'bill',
      subject_id: 'B1',
      reason: 'other',
      detail: { has_note: true, note_id: 'N2', ...env('S_CASH') },
    });
    expect(rowOf(ev.chargeRemoved)).toEqual({
      ...base,
      action: 'service_charge_removed',
      actor_staff_id: 'S_CASH',
      approver_staff_id: 'S_MGR',
      subject_type: 'bill',
      subject_id: 'B1',
      reason: 'customer_request',
      detail: { charge: 'service', alert_id: 'AL_SC', has_note: true, note_id: 'N3', ...env('S_MGR') },
    });
    expect(rowOf(ev.shiftOpened)).toEqual({
      ...base,
      action: 'shift_opened',
      actor_staff_id: 'S_CASH',
      subject_type: 'shift',
      subject_id: 'SH1',
      amount_minor: 500_000,
      detail: { staff_id: 'S_CASH', drawer_device_id: 'D_KIOSK', business_date: '2025-10-20', ...env('S_CASH') },
    });
    expect(rowOf(ev.paymentAdded), '§6.9: mode, amount, shift; no reference').toEqual({
      ...base,
      action: 'payment_added',
      actor_staff_id: 'S_CASH',
      subject_type: 'bill',
      subject_id: 'B1',
      amount_minor: 695_500,
      detail: {
        payment_id: 'P1',
        split_no: 1,
        mode_id: 'cash',
        payment_class: 'cash',
        direction: 'in',
        tendered_minor: 700_000,
        change_minor: 4_500,
        shift_id: 'SH1',
        taken_by_staff_id: 'S_CASH',
        ...env('S_CASH'),
      },
    });
    expect(rowOf(ev.paymentRemoved)).toEqual({
      ...base,
      action: 'payment_removed',
      actor_staff_id: 'S_CASH',
      subject_type: 'bill',
      subject_id: 'B1',
      reason: 'wrong_mode',
      amount_minor: 695_500,
      detail: {
        payment_id: 'P1',
        split_no: 1,
        mode_id: 'cash',
        payment_class: 'cash',
        direction: 'in',
        change_minor: 4_500,
        shift_id: 'SH1',
        taken_by_staff_id: 'S_CASH',
        has_note: false,
        ...env('S_CASH'),
      },
    });
    expect(rowOf(ev.buyerWaived)).toEqual({
      ...base,
      action: 'buyer_id_waived',
      actor_staff_id: 'S_CASH',
      approver_staff_id: 'S_MGR',
      subject_type: 'bill',
      subject_id: 'B1',
      detail: { alert_id: 'AL_W', has_note: true, note_id: 'N4', ...env('S_MGR') },
    });
    expect(rowOf(ev.invoiceIssued), '§6.12: number, total, class, has_buyer_id only').toEqual({
      ...base,
      action: 'invoice_issued',
      actor_staff_id: 'S_CASH',
      subject_type: 'bill',
      subject_id: 'B1',
      amount_minor: 695_500,
      detail: { invoice_id: 'I1', invoice_ref: 'AC1-S000123', number: 123, split_no: 1, payment_class: 'cash', has_buyer_id: true, ...env('S_CASH') },
    });
    expect(rowOf(ev.fiscalRejected), 'the worker appends it (no actor)').toEqual({
      ...base,
      action: 'fiscal_rejected',
      actor_staff_id: null,
      subject_type: 'bill',
      subject_id: 'B1',
      detail: { invoice_id: 'I1', adapter_key: 'PRA', error_code: 'mode_unmapped', http_status: 422, ...env(null) },
    });
    expect(rowOf(ev.reopened), '§6.13: with the mode, read from BillReopened.mode (R-40)').toEqual({
      ...base,
      action: 'bill_reopened',
      actor_staff_id: 'S_CASH',
      approver_staff_id: 'S_MGR',
      subject_type: 'bill',
      subject_id: 'B1',
      reason: 'wrong_item_billed',
      outcome: 'corrections',
      detail: { order_ids: ['O1', 'O2'], alert_id: 'AL_R', has_note: true, note_id: 'N5', ...env('S_MGR') },
    });
    expect(rowOf(ev.credited), 'actor = the reopen requester (closed_by, §6.13)').toEqual({
      ...base,
      action: 'invoice_credited',
      actor_staff_id: 'S_CASH',
      subject_type: 'bill',
      subject_id: 'B1',
      amount_minor: 695_500,
      detail: {
        invoice_id: 'C1',
        invoice_ref: 'AC1-C000007',
        number: 7,
        split_no: 1,
        ref_invoice_id: 'I1',
        ref_invoice_ref: 'AC1-S000123',
        payment_class: 'cash',
        alert_id: 'AL_R',
        ...env('S_MGR'),
      },
    });
    expect(rowOf(ev.closedEmpty)).toEqual({
      ...base,
      action: 'bill_closed_empty',
      actor_staff_id: 'S_CASH',
      subject_type: 'bill',
      subject_id: 'B2',
      detail: { seating_id: null, credit_invoice_ids: ['C1'], alert_id: null, ...env('S_CASH') },
    });
    expect(rowOf(ev.compRemoved), 'an order-stream event: order_id = the stream').toEqual({
      ...base,
      action: 'comp_removed',
      actor_staff_id: 'S_CASH',
      approver_staff_id: 'S_MGR',
      subject_type: 'order',
      subject_id: 'O1',
      order_id: 'O1',
      reason: 'comped_by_mistake',
      amount_minor: 3_000,
      detail: { order_item_id: 'L1', units: 1, alert_id: 'AL_C', has_note: true, note_id: 'N6', ...env('S_MGR') },
    });
    expect(rowOf(ev.tokenSet), '§6.28a: ids and time only').toEqual({
      ...base,
      action: 'fiscal_token_changed',
      actor_staff_id: 'S_OWNER',
      subject_type: 'hub',
      subject_id: 'branch-1',
      detail: { pos_id: 'POS-1', set_at: 1_761_000_000_000, ...env('S_OWNER') },
    });
  });

  it('[05 #87, §6.30] an answered BillClosedEmpty (alert_id, from an approval apply): actor = the request\'s requester, approver = its answerer', async () => {
    const alert_id = raiseKind('discount');
    // the answer folds audit_requests.answerer_staff_id (a reject is enough; the discount apply writes nothing)
    expect((await answer(hub, manager, alert_id, 'reject')).status).toBe(200);
    const id = append('S_MGR', d(aBillClosedEmpty(), { bill_id: 'B2', seating_id: 'SEAT2', credit_invoice_ids: [], alert_id }, 'B2'));
    expect(rowOf(id)).toEqual({
      ...base,
      action: 'bill_closed_empty',
      actor_staff_id: 'S_CASH',
      approver_staff_id: 'S_MGR',
      subject_type: 'bill',
      subject_id: 'B2',
      detail: { seating_id: 'SEAT2', credit_invoice_ids: [], alert_id, envelope_actor_id: 'S_MGR' },
    });
  });
});

/**
 * A scripted 05-2 day (task 32b): every mapped 05-2 event once, raw appended through the writer (task-5 builders, ids
 * overridden). `variance_alert_id` = a raised `shift_variance` request, so the sign-off's requester comes from
 * audit_requests (requestOf). The Z carries a carried-over label (a parking plate) that must never reach the row.
 */
function scriptedShifts(variance_alert_id: string): Record<string, string> {
  const ev: Record<string, string> = {};
  ev.drawerOpened = append('S_CASH', d(aDrawerOpened(), { shift_id: 'SH1', device_id: 'D_KIOSK', reason_code: 'check_cash', has_note: true, note_id: 'N10' }, 'SH1'));
  ev.pettyOut = append('S_CASH', d(aPettyCashOut(), { entry_id: 'E1', shift_id: 'SH1', requester_staff_id: 'S_CASH' }, 'SH1'));
  ev.pettyIn = append('S_CASH', d(aPettyCashIn(), { entry_id: 'E2', shift_id: 'SH1', requester_staff_id: 'S_CASH' }, 'SH1'));
  // an over-limit advance, answered: the envelope actor is the Manager, the act is the Cashier's
  ev.pettyAdvanced = append(
    'S_MGR',
    d(
      aPettyCashAdvanced(),
      { entry_id: 'E3', shift_id: 'SH1', advance_staff_id: 'S_WAIT', has_note: true, requester_staff_id: 'S_CASH', approver_staff_id: 'S_MGR', alert_id: 'AL_P' },
      'SH1',
    ),
  );
  ev.pettySettled = append('S_CASH', d(aPettyCashSettled(), { entry_id: 'E3', shift_id: 'SH1', has_note: true, note_id: 'N11' }, 'SH1'));
  ev.handover = append('S_CASH', d(aHandoverCounted(), { shift_id: 'SH1', by_staff_id: 'S_CASH' }, 'SH1'));
  // a Manager counts the Cashier's shift (close-shift-for-others): the counter is the act's person
  ev.counted = append('S_MGR', d(aShiftCounted(), { shift_id: 'SH1', by_staff_id: 'S_MGR', variance_alert_id }, 'SH1'));
  ev.closed = append('S_MGR', d(aShiftClosed(), { shift_id: 'SH1', closed_by: 'S_MGR', has_note: true, note_id: 'N12' }, 'SH1'));
  ev.skipped = append('S_MGR', d(aShiftCountSkipped(), { shift_id: 'SH2' }, 'SH2'));
  ev.closedSkip = append('S_MGR', d(aShiftClosed(), { shift_id: 'SH2', closed_by: 'S_MGR' }, 'SH2'));
  ev.signedOff = append('S_OWNER', d(aShiftVarianceSignedOff(), { shift_id: 'SH1', outcome: 'disputed', alert_id: variance_alert_id, approver_staff_id: 'S_OWNER' }, 'SH1'));
  ev.carried = append(
    'S_MGR',
    raw('hub', 'branch-1', 'OrdersCarriedOver', {
      order_ids: ['O7', 'O8'],
      business_date: '2025-10-20',
      reason_code: 'table_still_seated',
      has_note: true,
      note_id: 'N13',
    }),
  );
  const z = aZReportIssued();
  const report = { ...((z.payload as Record<string, unknown>)['report'] as Record<string, unknown>), carried_over: [{ label: PLATE, carried_in: false }] };
  ev.z = append('S_MGR', d(z, { report }, 'branch-1'));
  return ev;
}

describe('[05 #87 (05-2 events), §6.30, row V-3] each 05-2 event → its audit row (task 32b)', () => {
  it('[05 #87] the scripted day: one row per event; counts, ids and codes only (no paid_to, no report body)', () => {
    const variance_alert_id = raiseKind('shift_variance');
    const ev = scriptedShifts(variance_alert_id);
    const env = (actor: string | null) => ({ envelope_actor_id: actor });
    const shift = (id = 'SH1') => ({ subject_type: 'shift', subject_id: id });

    expect(rowOf(ev.drawerOpened)).toEqual({
      ...base,
      action: 'drawer_opened',
      actor_staff_id: 'S_CASH',
      ...shift(),
      reason: 'check_cash',
      detail: { device_id: 'D_KIOSK', has_note: true, note_id: 'N10', ...env('S_CASH') },
    });
    const petty = { entry_id: 'E1', shift_id: 'SH1', category_id: 'supplies', advance_staff_id: null, has_note: false, alert_id: null };
    expect(rowOf(ev.pettyOut), '§6.20: kind, amount, category; never paid_to (nor has_paid_to, H1-20 pattern)').toEqual({
      ...base,
      action: 'petty_cash',
      actor_staff_id: 'S_CASH',
      ...shift(),
      amount_minor: 20_000,
      detail: { kind: 'out', ...petty, ...env('S_CASH') },
    });
    expect(rowOf(ev.pettyIn)).toEqual({
      ...base,
      action: 'petty_cash',
      actor_staff_id: 'S_CASH',
      ...shift(),
      amount_minor: 20_000,
      detail: { kind: 'in', ...petty, entry_id: 'E2', category_id: 'other', ...env('S_CASH') },
    });
    expect(rowOf(ev.pettyAdvanced), 'approved: actor = requester, approver from the event').toEqual({
      ...base,
      action: 'petty_cash',
      actor_staff_id: 'S_CASH',
      approver_staff_id: 'S_MGR',
      ...shift(),
      amount_minor: 20_000,
      detail: { kind: 'advance', ...petty, entry_id: 'E3', category_id: 'staff_advance', advance_staff_id: 'S_WAIT', has_note: true, alert_id: 'AL_P', ...env('S_MGR') },
    });
    expect(rowOf(ev.pettySettled), 'settle: amount = spent + returned (the advance)').toEqual({
      ...base,
      action: 'petty_cash',
      actor_staff_id: 'S_CASH',
      ...shift(),
      amount_minor: 20_000,
      detail: { kind: 'settle', entry_id: 'E3', shift_id: 'SH1', spent_minor: 15_000, returned_minor: 5_000, has_note: true, note_id: 'N11', ...env('S_CASH') },
    });
    const count = { counted_minor: 1_195_000, expected_minor: 1_195_500, variance_minor: -500 };
    expect(rowOf(ev.handover)).toEqual({
      ...base,
      action: 'handover_counted',
      actor_staff_id: 'S_CASH',
      ...shift(),
      amount_minor: 1_195_000,
      detail: { ...count, ...env('S_CASH') },
    });
    expect(rowOf(ev.counted), 'actor = the counter (by_staff_id)').toEqual({
      ...base,
      action: 'shift_counted',
      actor_staff_id: 'S_MGR',
      ...shift(),
      amount_minor: 1_195_000,
      detail: { ...count, variance_alert_id, ...env('S_MGR') },
    });
    expect(rowOf(ev.closed)).toEqual({
      ...base,
      action: 'shift_closed',
      actor_staff_id: 'S_MGR',
      ...shift(),
      detail: { alert_id: null, has_note: true, note_id: 'N12', ...env('S_MGR') },
    });
    expect(rowOf(ev.skipped)).toEqual({ ...base, action: 'shift_count_skipped', actor_staff_id: 'S_MGR', ...shift('SH2'), detail: env('S_MGR') });
    expect(rowOf(ev.closedSkip)).toEqual({
      ...base,
      action: 'shift_closed',
      actor_staff_id: 'S_MGR',
      ...shift('SH2'),
      detail: { alert_id: null, has_note: false, note_id: null, ...env('S_MGR') },
    });
    expect(rowOf(ev.signedOff), 'actor = the request\'s requester (requestOf), approver and outcome from the event').toEqual({
      ...base,
      action: 'shift_variance_signed_off',
      actor_staff_id: 'S_CASH',
      approver_staff_id: 'S_OWNER',
      ...shift(),
      outcome: 'disputed',
      detail: { alert_id: variance_alert_id, business_date: '2025-10-21', ...env('S_OWNER') },
    });
    expect(rowOf(ev.carried), 'a day act: subject `day` = the hub stream (04 day_opened), ids only').toEqual({
      ...base,
      action: 'orders_carried_over',
      actor_staff_id: 'S_MGR',
      subject_type: 'day',
      subject_id: 'branch-1',
      reason: 'table_still_seated',
      detail: { business_date: '2025-10-20', order_ids: ['O7', 'O8'], has_note: true, note_id: 'N13', ...env('S_MGR') },
    });
    expect(rowOf(ev.z), 'the Z number and day only; never the report body').toEqual({
      ...base,
      action: 'z_report_issued',
      actor_staff_id: 'S_MGR',
      subject_type: 'day',
      subject_id: 'branch-1',
      detail: { business_date: '2025-10-20', z_no: 1, ...env('S_MGR') },
    });
  });

  it('[05 #87, §6.30] a sign-off whose request is unknown to the fold: actor falls back to the envelope actor', () => {
    const id = append('S_OWNER', d(aShiftVarianceSignedOff(), { shift_id: 'SH9', alert_id: 'AL_UNKNOWN', approver_staff_id: 'S_OWNER' }, 'SH9'));
    expect(rowOf(id)).toMatchObject({ action: 'shift_variance_signed_off', actor_staff_id: 'S_OWNER', approver_staff_id: 'S_OWNER', outcome: 'approved' });
  });
});

describe('[05 #87, row V-3, H1-8] the seven request kinds (registerRequestAction)', () => {
  it('[05 #87] discount → discount_requested / discount_answered; the six others → money_request_raised / money_request_answered (kind in the answered detail)', async () => {
    const KINDS: BillRequestKind[] = ['discount', 'remove_service_charge', 'reopen_bill', 'remove_comp', 'close_without_buyer_id', 'petty_cash', 'shift_variance'];
    const raised = Object.fromEntries(KINDS.map((k) => [k, raiseKind(k)])) as Record<BillRequestKind, string>;
    for (const k of KINDS) {
      const r = requestRow('AlertRaised', raised[k]);
      expect(r, k).toMatchObject({
        action: k === 'discount' ? 'discount_requested' : 'money_request_raised',
        actor_staff_id: 'S_CASH',
        subject_type: RAISE[k].subject!.stream_type,
        subject_id: RAISE[k].subject!.stream_id,
        amount_minor: (RAISE[k].details as { amount: number }).amount,
        reason: (RAISE[k].details as { reason?: string }).reason ?? null,
      });
      expect(r.detail, k).toMatchObject({ alert_id: raised[k] });
    }
    // remove_comp's subject is the line's order (04's request columns)
    expect(requestRow('AlertRaised', raised.remove_comp)).toMatchObject({ order_id: 'O1' });

    // answered: the Manager rejects (built applies: a reject writes nothing, §3.14)
    expect((await answer(hub, manager, raised.discount, 'reject')).status).toBe(200);
    expect((await answer(hub, manager, raised.remove_service_charge, 'reject')).status).toBe(200);
    expect(requestRow('RequestAnswered', raised.discount)).toEqual({
      ...base,
      action: 'discount_answered',
      actor_staff_id: 'S_CASH',
      approver_staff_id: 'S_MGR',
      method: 'pin',
      subject_type: 'bill',
      subject_id: 'B1',
      outcome: 'rejected',
      detail: { alert_id: raised.discount, kind: 'discount', on_requester_device: false, envelope_actor_id: 'S_MGR' },
    });
    expect(requestRow('RequestAnswered', raised.remove_service_charge)).toEqual({
      ...base,
      action: 'money_request_answered',
      actor_staff_id: 'S_CASH',
      approver_staff_id: 'S_MGR',
      method: 'pin',
      subject_type: 'bill',
      subject_id: 'B1',
      outcome: 'rejected',
      detail: { alert_id: raised.remove_service_charge, kind: 'remove_service_charge', on_requester_device: false, envelope_actor_id: 'S_MGR' },
    });
  });
});

describe('[05 #87, V-3, PL-3] rebuild = live; no buyer data in detail_json (permanent privacy scan)', () => {
  /** Keys that may never appear in a 05 row's detail (B19, B30, H2-22, H3-5, J-4, §7 Privacy / Secrets, §6.30). */
  const FORBIDDEN_KEY = /(^|_)(name|names|phone|phones|note|notes|text|reference|paid_to|token|tokens|pin|pins|secret|last4|tax_id|id_value|id_type|buyer|buyer_id|bill_key|lines)$/;
  const ALLOWED_KEYS = new Set(['has_note', 'has_buyer_id']);

  function keysOf(v: unknown, out: string[] = []): string[] {
    if (Array.isArray(v)) for (const x of v) keysOf(x, out);
    else if (typeof v === 'object' && v !== null) {
      for (const [k, x] of Object.entries(v)) {
        out.push(k);
        keysOf(x, out);
      }
    }
    return out;
  }

  it('[05 #87] the scripted bill + every request: rebuild of `audit` from seq 0 equals live, row for row', async () => {
    scriptedBills();
    const ids = (['discount', 'remove_service_charge', 'reopen_bill', 'remove_comp', 'close_without_buyer_id', 'petty_cash', 'shift_variance'] as const).map((k) => raiseKind(k));
    expect((await answer(hub, manager, ids[0]!, 'reject')).status).toBe(200);
    // the requestOf path: an empty close inside an answered request (actor / approver from audit_requests)
    append('S_MGR', d(aBillClosedEmpty(), { bill_id: 'B3', seating_id: 'SEAT3', credit_invoice_ids: [], alert_id: ids[0]! }, 'B3'));
    // 05-2 (task 32b): the sign-off's requester via requestOf on the raised shift_variance request
    scriptedShifts(ids[6]!);
    const live = dumpAudit();
    expect(live.length).toBeGreaterThan(40);
    expect(live, 'the sign-off row reads its requester').toContainEqual(
      expect.objectContaining({ action: 'shift_variance_signed_off', actor_staff_id: 'S_CASH', approver_staff_id: 'S_OWNER' }),
    );

    expect(live, 'the answered empty close is in the live log').toContainEqual(
      expect.objectContaining({ action: 'bill_closed_empty', subject_id: 'B3', actor_staff_id: 'S_CASH', approver_staff_id: 'S_MGR' }),
    );

    hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'audit'`).run();
    const registry = createProjectionRegistry();
    registry.register(auditProjection());
    registry.catchUp(hub.deps.db, hub.deps.config.provisioned!.branch_id);
    expect(dumpAudit()).toEqual(live);
  });

  it('[05 #87, PL-3] every 05 row (05-1 and 05-2): no buyer, name, phone, note, reference, paid_to, token or PIN key; no plate or menu name; no Z report body; detail ≤ 2 KB', async () => {
    scriptedBills();
    const ids = (['discount', 'remove_service_charge', 'reopen_bill', 'remove_comp', 'close_without_buyer_id', 'petty_cash', 'shift_variance'] as const).map((k) => raiseKind(k));
    expect((await answer(hub, manager, ids[0]!, 'reject')).status).toBe(200);
    expect((await answer(hub, manager, ids[1]!, 'reject')).status).toBe(200);
    scriptedShifts(ids[6]!);
    // the directory's staff names (the one startBilling binds): no row may carry one under any key, neutral ones too
    const STAFF_NAMES = (await billingDirectory()).staff.map((s) => s.display_name);
    expect(STAFF_NAMES.length).toBeGreaterThan(0);
    const FROM_05 = new Set([...Object.values(MAPPED_05_1), ...Object.values(MAPPED_05_2), 'discount_requested', 'discount_answered', 'money_request_raised', 'money_request_answered']);
    const rows = (hub.deps.db.prepare('SELECT action, reason, outcome, detail_json FROM audit_entries ORDER BY seq').all() as Array<Record<string, string | null>>).filter((r) =>
      FROM_05.has(r['action']!),
    );
    expect(new Set(rows.map((r) => r['action'])), 'every 05 action and request action is scanned').toEqual(FROM_05);
    for (const r of rows) {
      const json = r['detail_json']!;
      expect(Buffer.byteLength(json, 'utf8'), r['action']!).toBeLessThanOrEqual(2_048);
      const bad = keysOf(JSON.parse(json)).filter((k) => !ALLOWED_KEYS.has(k) && FORBIDDEN_KEY.test(k));
      expect(bad, `${r['action']}: ${json}`).toEqual([]);
      for (const poison of [PLATE, LINE_NAME, ...STAFF_NAMES]) expect(JSON.stringify(r), `${r['action']}: ${poison}`).not.toContain(poison);
      // task 32b: never a Z report body (staff ids, mode / category names, carried labels) nor a petty paid_to flag
      for (const k of ['report', 'has_paid_to', 'mode_name', 'category_name', 'label']) expect(keysOf(JSON.parse(json)), `${r['action']}: ${k}`).not.toContain(k);
    }
  });
});
