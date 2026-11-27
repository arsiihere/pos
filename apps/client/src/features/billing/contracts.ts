import type { ReportDocInput } from '@pos/domain';

// 05 §6.2 `GET /queries/open-bills?floor_id?` (as the hub's apps/hub/src/billing/queries/open-bills.ts answers it;
// `state: 'projected'` is a seating / key with no bill row yet, `bill_id: null`).

export type BillOrderType = 'dine_in' | 'takeaway' | 'parking';

export interface OpenBillRow {
  bill_id: string | null;
  seating_id: string | null;
  order_id: string | null;
  identifier: string;
  order_type: BillOrderType;
  state: 'projected' | 'open' | 'partly_paid';
  total_default_minor: number;
  paid_minor: number;
  /** ⚠️ 05 v1.0.35 §6.2 (run 3 R3-B-1, D3): Σ the open splits' balance_minor (each split's total less its own payments) */
  due_minor: number;
  /** ⚠️ 05 v1.0.36 §6.2 (QA BUG-16): Σ the open splits' as-paid totals — the row's amount, as the bill page shows it */
  open_total_minor: number;
  /** ⚠️ 05 v1.0.36 §6.2 (QA BUG-16): Σ the open splits' net payments — the row's "Paid"; open_total − open_paid = due */
  open_paid_minor: number;
  check_printed_at: number | null;
  opened_at: number;
  open_minutes: number;
  flagged: boolean;
  partly_paid: boolean;
  has_open_request: boolean;
}

export interface OpenBillsBody {
  bills: OpenBillRow[];
  as_of_seq: number;
}

/** 05 §6 header: a command or the bill query names its bill by one of these. */
export type BillRef = { bill_id: string } | { seating_id: string } | { order_id: string };

// 05 §6.1 `GET /queries/bill` (as apps/hub/src/billing/queries/bill.ts answers it): the parts the client screens read.

export interface Totals {
  subtotal_minor: number;
  discount_minor: number;
  service_charge_minor: number;
  taxes: Array<{ tax_profile_id: string; tax_code: string; label: string; payment_class: 'cash' | 'digital'; rate_bp: number; base_minor: number; tax_minor: number; rate_ref: string | null }>;
  rounding_minor: number;
  total_minor: number;
}

export interface BillViewPayment {
  payment_id: string;
  mode_id: string;
  mode_name: string;
  direction: 'in' | 'out';
  amount_minor: number;
  tendered_minor: number | null;
  change_minor: number;
  has_reference: boolean;
  taken_by_name: string | null;
  /** 05 v1.0.29 (R-90): decides "own payment" for RemovePayment by id (§6.10), never by name. */
  taken_by_staff_id: string;
}

export type SplitPlan = null | { lines: Array<{ order_item_id: string; units: number }> } | { share_minor: number } | { n: number; k: number };

export interface BillViewSplit {
  split_no: number;
  state: 'open' | 'closed';
  plan: SplitPlan;
  payments: BillViewPayment[];
  totals: { cash: Totals; digital: Totals; as_paid: Totals };
  balance_minor: number;
  /** 05 v1.0.29 (R-90): `invoice_id` is the `ref_id` of PrintBillDocument { doc: 'receipt' } (§6.22). */
  invoice: { invoice_id: string; invoice_ref: string; fiscal_number: string | null; fiscal_state: string | null } | null;
}

export interface BillViewLine {
  order_item_id: string;
  order_id: string;
  name: string;
  units: number;
  base_minor: number;
  tax_profile_id: string | null;
  tags: Array<'comp' | 'pending_void' | 'weight_needed' | 'tax_unresolved'>;
  /** §6.1 (R-29): the line joined the open remainder after a split of this cycle closed */
  added_after_close: boolean;
  /** v1.0.33 §6.1 (STAB-5): the first part of a split line (02b v1.0.20); null / absent (an older hub) = not split */
  part_of?: string | null;
}

/** §6.1 `discount`: the whole bill's (B7). */
export interface BillDiscount {
  kind: 'amount' | 'percent';
  value: number;
  reason_code: string;
  frozen_minor: number | null;
  discount_minor: number;
}

export interface BillView {
  bill_id: string | null;
  state: 'projected' | 'open' | 'partly_paid' | 'closed';
  order_type: BillOrderType;
  identifier: string;
  lines: BillViewLine[];
  splits: BillViewSplit[];
  currency: { code: string; exponent: number };
  as_of_seq: number;
  service_charge: { rate_bp: number; removed: boolean };
  discount: BillDiscount | null;
  totals_default: Totals;
  open_requests: Array<{ kind: string; alert_id: string }>;
  prints: BillPrint[];
  /** §6.1 / R-29: one entry per §3.3 rule that would refuse a close now, pinned `reason`, the §9 error's `details` */
  blocks: BillBlock[];
  /** R-29: the "Reopened" chip while ≥ 1 and the bill is not CLOSED */
  reopen_count: number;
  check_printed_at: number | null;
  buyer: { required: boolean; threshold_minor: number | null; waived: boolean };
}

/** §6.1 pinned block reasons in §3.3 rule order (R-29). */
export const BLOCK_REASONS = ['bill_not_open', 'void_pending', 'weight_pending', 'tax_unresolved', 'discount_pending', 'buyer_id_required', 'balance_due', 'shares_sum'] as const;
export interface BillBlock {
  reason: (typeof BLOCK_REASONS)[number] | string;
  split_no: number | null;
  details: Record<string, unknown>;
}

/** §6.6 / §6.8 answers: applied, unchanged, or held for approval (R-59: an open request answers the same way). */
export type SheetResult = { applied: Totals } | { bill_id: string; changed: boolean } | { bill_id: string; pending: { alert_id: string } };

/** §6.1 `prints[]` (03c `documentJobsStatus`): a bill document's print job. */
export interface BillPrint {
  job_id: string;
  doc_kind: 'check' | 'receipt' | 'credit' | string;
  state: 'waiting' | 'printing' | 'printed' | 'failed' | 'cancelled' | string;
  printer_name: string | null;
  last_error: string | null;
}

/** §6.3 `PrintCheckBill` result (`printed: false` = no bill printer, the command still succeeds, §3.16). */
export interface PrintCheckBillResult {
  bill_id: string;
  printed: boolean;
  job_id: string | null;
  printer_name: string | null;
  /** ⚠️ 05 v1.0.35 §6.3 (R3-M-1): the paper's figures — gross `total_minor` and the remaining payable */
  totals_default?: Totals;
  due_minor?: number;
}

/** ⚠️ 05 v1.0.35 §6.3a (OR-5; R2-m-1, R3-M-1) `PrintCartCheckBill` result: the paper's gross and remaining payable. */
export interface PrintCartCheckBillResult {
  printed: boolean;
  job_id: string | null;
  printer_name: string | null;
  totals_default: Totals;
  due_minor: number;
}

/** §6.5 `SetSplits` payload (bill_ref + one of the four modes). */
export type SetSplitsPayload =
  | { bill_ref: BillRef; mode: 'items'; splits: Array<{ split_no: number; lines: Array<{ order_item_id: string; units: number }> }> }
  | { bill_ref: BillRef; mode: 'amount'; splits: Array<{ split_no: number; share_minor: number }> }
  | { bill_ref: BillRef; mode: 'equal'; n: number }
  | { bill_ref: BillRef; mode: 'none' };

/** §6.5 result: the bill view's `splits`, recomputed. */
export interface SetSplitsResult {
  bill_id: string;
  splits: BillViewSplit[];
}
/** §6.9 `AddPayment` result: the split recomputed with this payment (§3.5 (7) dues; change from the hub). */
export interface AddPaymentResult {
  bill_id: string;
  payment_id: string;
  split_no: number;
  totals: { as_paid: Totals };
  balance_minor: number;
  card_due_minor: number;
  cash_due_minor: number;
  card_refund_due_minor: number;
  cash_refund_due_minor: number;
  rounding_minor: number;
  change_due_minor: number;
}

/** §3.5 (7) the four due fields of a split (from the latest `AddPayment` result, or derived where the view allows). */
export interface SplitDues {
  card_due_minor: number;
  cash_due_minor: number;
  card_refund_due_minor: number;
  cash_refund_due_minor: number;
}

/** §6.12 `CloseSplit` result (an empty close: `{ bill_state: 'closed', empty: true }`). */
export type CloseSplitResult =
  | { invoice_id: string; invoice_ref: string; total_minor: number; change_minor: number; bill_state: 'open' | 'partly_paid' | 'closed'; receipt: { job_id: string | null; printer_name: string | null }; fiscal_state: 'pending' | 'not_required' }
  | { bill_state: 'closed'; empty: true };

// ---- 05-2 shifts (task 39): §6.15–§6.19 as the hub returns them (apps/hub/src/billing/queries/shift.ts,
// commands/open-shift.ts, commands/shift-close.ts). Blind rule (B23): before the count a cash row's sums are null and
// the view's expected / variance are null; only CountShift and HandoverCount answers reveal expected.

export interface ShiftTaking {
  mode_id: string;
  mode_name: string;
  payment_class: 'cash' | 'digital';
  /** null on a cash row before the count (B23) */
  in_minor: number | null;
  out_minor: number | null;
  change_minor: number | null;
  /** R-51: live payments (in and out) of this shift × mode, shown before the count too */
  payments_count: number;
  by: Array<{ taken_by_name: string | null; in_minor: number | null; payments_count: number }>;
}

export interface ShiftPetty {
  entry_id: string;
  kind: 'advance' | 'out' | 'in';
  amount_minor: number;
  category_name: string | null;
  paid_to: string | null;
  advance_staff_name: string | null;
  settled: boolean;
}

export interface ShiftHandover {
  at: number;
  counted_minor: number;
  expected_minor: number;
  variance_minor: number;
  by_staff_name: string | null;
}

/** §6.16 `GET /queries/shift?shift_id?` (absent → the caller's open shift; none → 404 SHIFT_NOT_FOUND). */
export interface ShiftView {
  shift_id: string;
  staff_name: string | null;
  state: 'open' | 'closed';
  is_drawer: boolean;
  opened_at: number;
  float_minor: number;
  takings: ShiftTaking[];
  petty: ShiftPetty[];
  open_advances_minor: number;
  handovers: ShiftHandover[];
  counted_minor: number | null;
  expected_minor: number | null;
  variance_minor: number | null;
}

/** §6.15 */
export interface OpenShiftResult {
  shift_id: string;
  opened_at: number;
}

/** §6.17 (counts and closes; the first reveal of expected; R-78 `closed_requests`) */
export interface CountShiftResult {
  shift_id: string;
  closed: true;
  expected_minor: number;
  variance_minor: number;
  sign_off: { alert_id: string } | null;
  closed_requests: string[];
}

/** §6.18 (R-78: `closed_requests`, `open_advances`; never blocking, no `pending`) */
export interface CloseShiftResult {
  closed: { shift_id: string };
  closed_requests: string[];
  open_advances: Array<{ entry_id: string; advance_staff_id: string; amount_minor: number }>;
}

/** §6.19 (the shift stays open; this count's expected only) */
export interface HandoverCountResult {
  shift_id: string;
  counted_minor: number;
  expected_minor: number;
  variance_minor: number;
}

/** §6.20 RecordPettyCash: `pending` when the entry waits for a `petty_cash` request (no event yet; the approval writes it). */
export interface RecordPettyCashResult {
  entry_id: string;
  pending?: { alert_id: string };
}

/** §6.20 SettlePettyAdvance */
export interface SettlePettyAdvanceResult {
  entry_id: string;
  shift_id: string;
}

// ---- 05-2 reports (task 42): §6.26 / §6.27 as the hub returns them (apps/hub/src/billing/queries/reports.ts,
// fiscal/status.ts). The report is @pos/domain's ReportDocInput (staff ids only, H16-5); names come in `staff_names`.

/** §6.26 `GET /queries/x-report` */
export interface XReportView {
  report: ReportDocInput;
  staff_names: Record<string, string>;
}

/** 05 v1.0.32 §6.26 (R-93): a Z's latest print job state (03c document-job states + 'expired': swept after 7 days) */
export type ZPrintState = 'waiting' | 'printing' | 'printed' | 'failed' | 'cancelled' | 'expired';

/** 05 v1.0.32 §6.26 (R-93): the Z's latest print job; ids, state and printer name only */
export interface ZPrintView {
  job_id: string;
  state: ZPrintState;
  /** null when 'expired' or the printer row is gone */
  printer_name: string | null;
}

/** §6.26 `GET /queries/z-reports` row (R-85: keyed by `z_no`; a date can have several) */
export interface ZReportView {
  business_date: string;
  z_no: number;
  report: ReportDocInput;
  staff_names: Record<string, string>;
  /** 05 v1.0.32 §6.26 (R-93): null = no Z print job was written (not printed) */
  print: ZPrintView | null;
}

/** §6.27 `GET /queries/fiscal-status` (never a token, never a buyer) */
export interface FiscalStatusView {
  jurisdiction_id: string;
  adapter_key: string;
  environment: 'sandbox' | 'production';
  adapter_health: 'ok' | 'failing' | 'unknown';
  last_success_at: number | null;
  pending_count: number;
  oldest_pending_age_ms: number | null;
  rejected_count: number;
  catch_up_window_ms: number | null;
  stuck: boolean;
  token_missing: Array<{ pos_id: string; name: string }>;
  tokens: Array<{ pos_id: string; name: string; set_at: number }>;
}

/** 01a §6.18b `CloseBusinessDay` result: `changed: false` with a `reason` when nothing was closed. */
export interface CloseBusinessDayResult {
  business_date: string | null;
  opened_at: number | null;
  closed_at: number | null;
  changed: boolean;
  reason?: 'not_open' | 'opened_recently';
}

/** §6.13 ReopenBill result: the mode the hub decided (§3.10) and the credit notes it issued, or the request raised. */
export type ReopenResult = { reopened: { mode: 'full' | 'corrections'; credits: Array<{ invoice_ref: string; total_minor: number }> } } | { pending: { alert_id: string } };
