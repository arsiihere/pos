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
}

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
}

export type SplitPlan = null | { lines: Array<{ order_item_id: string; units: number }> } | { share_minor: number } | { n: number; k: number };

export interface BillViewSplit {
  split_no: number;
  state: 'open' | 'closed';
  plan: SplitPlan;
  payments: BillViewPayment[];
  totals: { cash: Totals; digital: Totals; as_paid: Totals };
  balance_minor: number;
  invoice: { invoice_ref: string; fiscal_number: string | null; fiscal_state: string | null } | null;
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
