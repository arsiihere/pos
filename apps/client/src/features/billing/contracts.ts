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
