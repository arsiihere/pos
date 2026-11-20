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
