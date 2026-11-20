import type { HubResult } from '../../api/hub-admin';
import { newUlid } from '../../app/ulid';
import type { AddPaymentResult, BillPrint, BillRef, BillView, CloseSplitResult, OpenBillsBody, PrintCheckBillResult, SetSplitsPayload, SetSplitsResult, SheetResult } from './contracts';

// 05 §6 (task 34 on): the billing queries and commands on the staff api's query() / command() (the shell's own
// transport, features/staff/api.ts — no second client, socket or token).

export interface BillingTransport {
  query<T>(path: string): Promise<HubResult<T>>;
  command<T>(commandType: string, payload: unknown, opts?: { commandId?: string }): Promise<HubResult<T>>;
}

/** §6.1 query string of a bill ref (`bill_id`, else `seating_id`, else `order_id`). */
export function billQuery(ref: BillRef): string {
  const [k, v] = Object.entries(ref)[0] as [string, string];
  return `${k}=${encodeURIComponent(v)}`;
}

export interface BillingApi {
  /** §6.2: every bill that still needs money, in server order; `floor_id` narrows it to one floor. */
  openBills(floor_id?: string): Promise<HubResult<OpenBillsBody>>;
  /** §6.3: the check bill on the bill printer of the zone / floor (or `printer_id`). */
  printCheckBill(payload: { bill_ref: BillRef; printer_id?: string }): Promise<HubResult<PrintCheckBillResult>>;
  /** §6.5: re-plan the open splits. A retry after a lost reply resends the same command_id (00 M47, handbook §10). */
  setSplits(payload: SetSplitsPayload): Promise<HubResult<SetSplitsResult>>;
  /** §6.1: the bill view (totals from the hub only). */
  bill(ref: BillRef): Promise<HubResult<BillView>>;
  /** §6.9: one payment on a split (dues, rounding and change come back). */
  addPayment(payload: { bill_ref: BillRef; split_no: number; mode_id: string; direction: 'in' | 'out'; amount_minor: number; tendered_minor?: number; reference?: string }): Promise<HubResult<AddPaymentResult>>;
  /** §6.12: close a split; `expected_total_minor` = the total the screen showed (rule 7). */
  closeSplit(payload: { bill_ref: BillRef; split_no: number; expected_total_minor: number }): Promise<HubResult<CloseSplitResult>>;
  /** §6.6 (approvable) / §6.7: the whole bill's discount. */
  applyDiscount(payload: { bill_ref: BillRef; kind: 'amount' | 'percent'; value: number; reason_code: string; note?: string }): Promise<HubResult<SheetResult>>;
  removeDiscount(payload: { bill_id: string; reason_code: string; note?: string }): Promise<HubResult<SheetResult>>;
  /** §6.8 (Remove approvable; Apply = the re-add, `allowed` only). */
  removeServiceCharge(payload: { bill_ref: BillRef; reason_code: string; note?: string }): Promise<HubResult<SheetResult>>;
  applyServiceCharge(payload: { bill_ref: BillRef; note?: string }): Promise<HubResult<SheetResult>>;
  /** 01d: the requester takes back an open request. */
  withdrawRequest(alert_id: string): Promise<HubResult<unknown>>;
  /** §6.23a: the branch's active printers by name (the Print to picker; read when it opens). */
  billPrinters(): Promise<HubResult<{ printers: Array<{ printer_id: string; name: string }> }>>;
  /** §6.23 (B18): move a waiting / failed bill-document job to another printer; the job's new status comes back. */
  retargetBillPrint(payload: { job_id: string; printer_id: string }): Promise<HubResult<Omit<BillPrint, 'doc_kind'> & { printer_id: string }>>;
  /** §6.22: reprint a receipt / credit note (REPRINT; the full buyer ID only on that customer's receipt). */
  printBillDocument(payload: { doc: 'receipt' | 'credit_note'; ref_id: string; printer_id?: string }): Promise<HubResult<{ printed: boolean; job_id: string | null; printer_name: string | null }>>;
}

// One map for every billing api instance of the page (each screen builds its own over the shell's transport): a resend
// after a lost reply keeps its command_id even if the button that sent it was mounted again (a reprint prints once).
const pending = new Map<string, string>();

export function billingApi(staff: BillingTransport, newCommandId: () => string = () => newUlid()): BillingApi {
  // a command's id is kept per command type + payload until the hub answers (a network error keeps it), as the KDS
  // api does (features/kds/actions/actions.ts): a resend after a lost reply is the same command, applied once
  async function command<T>(type: string, payload: object): Promise<HubResult<T>> {
    // `note`, `reference` and `tendered_minor` are left out of the key: the hub leaves `note` / `reference` out of the
    // payload hash (hashOmit, row H-4, H16-7), and a payment's reference is never kept on the client (B30, H1-20).
    // A resend after a lost reply with only those edited is the same command — never a second payment; a changed
    // tendered then meets the hub's same-id check instead of minting a new payment
    const { note: _n, reference: _r, tendered_minor: _t, ...hashed } = payload as { note?: unknown; reference?: unknown; tendered_minor?: unknown };
    void _n;
    void _r;
    void _t;
    const key = `${type} ${JSON.stringify(hashed)}`;
    let commandId = pending.get(key);
    if (commandId === undefined) pending.set(key, (commandId = newCommandId()));
    const answer = await staff.command<T>(type, payload, { commandId });
    if (answer.ok || answer.error.kind !== 'network') pending.delete(key);
    return answer;
  }
  return {
    printCheckBill: (payload) => command<PrintCheckBillResult>('PrintCheckBill', payload),
    setSplits: (payload) => command<SetSplitsResult>('SetSplits', payload),
    bill: (ref) => staff.query<BillView>(`/queries/bill?${billQuery(ref)}`),
    addPayment: (payload) => command<AddPaymentResult>('AddPayment', payload),
    closeSplit: (payload) => command<CloseSplitResult>('CloseSplit', payload),
    applyDiscount: (payload) => command<SheetResult>('ApplyDiscount', payload),
    removeDiscount: (payload) => command<SheetResult>('RemoveDiscount', payload),
    removeServiceCharge: (payload) => command<SheetResult>('RemoveServiceCharge', payload),
    applyServiceCharge: (payload) => command<SheetResult>('ApplyServiceCharge', payload),
    withdrawRequest: (alert_id) => command<unknown>('WithdrawRequest', { alert_id }),
    billPrinters: () => staff.query('/queries/bill-printers'),
    retargetBillPrint: (payload) => command('RetargetBillPrint', payload),
    printBillDocument: (payload) => command('PrintBillDocument', payload),
    openBills: (floor_id) =>
      staff.query<OpenBillsBody>(floor_id === undefined ? '/queries/open-bills' : `/queries/open-bills?floor_id=${encodeURIComponent(floor_id)}`),
  };
}
