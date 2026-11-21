import type { HubResult } from '../../api/hub-admin';
import { newUlid } from '../../app/ulid';
import type {
  AddPaymentResult,
  BillPrint,
  BillRef,
  BillView,
  CloseBusinessDayResult,
  CloseShiftResult,
  CloseSplitResult,
  CountShiftResult,
  FiscalStatusView,
  HandoverCountResult,
  OpenBillsBody,
  OpenShiftResult,
  RecordPettyCashResult,
  SettlePettyAdvanceResult,
  PrintCheckBillResult,
  SetSplitsPayload,
  SetSplitsResult,
  SheetResult,
  ShiftView,
  XReportView,
  ZReportView,
} from './contracts';

// 05 §6 (task 34 on): the billing queries and commands on the staff api's query() / command() (the shell's own
// transport, features/staff/api.ts — no second client, socket or token).

export interface BillingTransport {
  query<T>(path: string): Promise<HubResult<T>>;
  /** F §6.3 cursor pages (the Z list) */
  page<T>(path: string): Promise<HubResult<{ data: T; next_cursor: string | null }>>;
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
  closeSplit(payload: { bill_ref: BillRef; split_no: number; expected_total_minor: number; buyer?: { name: string; tax_id: { type: string; value: string } } }): Promise<HubResult<CloseSplitResult>>;
  /** §6.10 (take-payment; another's payment also close-shift-for-others): remove a payment of an open split, with its reason. */
  removePayment(payload: { payment_id: string; reason_code: 'wrong_mode' | 'wrong_amount' | 'customer_changed' | 'other'; note?: string }): Promise<HubResult<{ payment_id: string; bill_id: string; split_no: number }>>;
  /** §6.11 (approvable): close without buyer details; holds for every later split and after a reopen. */
  waiveBuyerId(payload: { bill_id: string; note?: string }): Promise<HubResult<SheetResult | { bill_id: string; changed: false; reason: 'not_required' }>>;
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
  /** §6.16: a shift (absent → the caller's open one; none → 404 SHIFT_NOT_FOUND). Blind until counted (B23). */
  shift(shift_id?: string): Promise<HubResult<ShiftView>>;
  /** §6.15: open the caller's shift with its starting cash; `as_drawer` takes this device's drawer. */
  openShift(payload: { float_minor: number; as_drawer: boolean }): Promise<HubResult<OpenShiftResult>>;
  /** §6.17: the blind count, which also closes the shift (the drawer is free at once). */
  countShift(payload: { shift_id: string; counted_minor: number; note?: string }): Promise<HubResult<CountShiftResult>>;
  /** §6.18: close without a count (`skip-blind-count`). */
  closeShift(payload: { shift_id: string; skip_count: true; note?: string }): Promise<HubResult<CloseShiftResult>>;
  /** §6.19: a drawer shift's count at handover; the shift stays open. */
  handoverCount(payload: { shift_id: string; counted_minor: number }): Promise<HubResult<HandoverCountResult>>;
  /** §6.26: the open day's X (staff ids only; names in `staff_names`). */
  xReport(): Promise<HubResult<XReportView>>;
  /** §6.26 (R-85): the Z list, newest `z_no` first, 20 a page; `cursor` from the previous page. */
  zReports(cursor: string | null): Promise<HubResult<{ data: { reports: ZReportView[] }; next_cursor: string | null }>>;
  /** §6.26 (R-85): the Z of one date, newest `z_no` first (a date closed twice has two). */
  zReportOf(business_date: string): Promise<HubResult<{ data: { reports: ZReportView[] }; next_cursor: string | null }>>;
  /** 01a §6.18b with 05's guard (§6.25): `409 DAY_CLOSE_BLOCKED { reason, <list>, count }` while something blocks. */
  closeBusinessDay(): Promise<HubResult<CloseBusinessDayResult>>;
  /** §6.24 (`close-business-day`): orders that stay open into tomorrow. */
  carryOverOrders(payload: { order_ids: string[]; reason_code: string; note?: string }): Promise<HubResult<{ business_date: string; order_ids: string[] }>>;
  /** §6.22 (R-87, `view-reports`): print the open day's X, or the Z of a date (its latest `z_no`); no printer → `printed: false`. */
  printReport(payload: { doc: 'x_report' } | { doc: 'z_report'; ref_id: string }): Promise<HubResult<{ printed: boolean; job_id: string | null; printer_name: string | null }>>;
  /** §6.27: the fiscal line's figures (never a token). */
  fiscalStatus(): Promise<HubResult<FiscalStatusView>>;
  /** §6.28 (`close-business-day`): resend the pending invoices now (a rejected one is not resent). */
  retryFiscalNow(): Promise<HubResult<{ pending_count: number }>>;
  /** §6.20 (approvable): an advance / cash out / cash in on the caller's money shift; `{ pending }` when a request was raised. */
  recordPettyCash(payload: { kind: 'advance' | 'out' | 'in'; amount_minor: number; category_id: string; paid_to?: string; advance_staff_id?: string; note?: string }): Promise<HubResult<RecordPettyCashResult>>;
  /** §6.20 (`allowed` only): spent + returned = the advance (the hub checks); the returned cash lands on the caller's shift. */
  settlePettyAdvance(payload: { entry_id: string; spent_minor: number; returned_minor: number; note?: string }): Promise<HubResult<SettlePettyAdvanceResult>>;
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
    // `buyer` too (CloseSplit `hashOmit: ['buyer']`, B19): a buyer ID is never held in this map, and a resend with a
    // corrected buyer is the same close
    // paid_to (petty cash) is free text the hub leaves out of its hash too (H-4)
    const { note: _n, reference: _r, tendered_minor: _t, buyer: _b, paid_to: _p, ...hashed } = payload as { note?: unknown; reference?: unknown; tendered_minor?: unknown; buyer?: unknown; paid_to?: unknown };
    void _p;
    void _n;
    void _r;
    void _t;
    void _b;
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
    removePayment: (payload) => command('RemovePayment', payload),
    applyDiscount: (payload) => command<SheetResult>('ApplyDiscount', payload),
    removeDiscount: (payload) => command<SheetResult>('RemoveDiscount', payload),
    removeServiceCharge: (payload) => command<SheetResult>('RemoveServiceCharge', payload),
    applyServiceCharge: (payload) => command<SheetResult>('ApplyServiceCharge', payload),
    withdrawRequest: (alert_id) => command<unknown>('WithdrawRequest', { alert_id }),
    waiveBuyerId: (payload) => command('WaiveBuyerId', payload),
    billPrinters: () => staff.query('/queries/bill-printers'),
    retargetBillPrint: (payload) => command('RetargetBillPrint', payload),
    printBillDocument: (payload) => command('PrintBillDocument', payload),
    shift: (shift_id) => staff.query<ShiftView>(shift_id === undefined ? '/queries/shift' : `/queries/shift?shift_id=${encodeURIComponent(shift_id)}`),
    openShift: (payload) => command<OpenShiftResult>('OpenShift', payload),
    countShift: (payload) => command<CountShiftResult>('CountShift', payload),
    closeShift: (payload) => command<CloseShiftResult>('CloseShift', payload),
    handoverCount: (payload) => command<HandoverCountResult>('HandoverCount', payload),
    xReport: () => staff.query<XReportView>('/queries/x-report'),
    zReports: (cursor) => staff.page<{ reports: ZReportView[] }>(`/queries/z-reports?limit=20${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`),
    zReportOf: (business_date) => staff.page<{ reports: ZReportView[] }>(`/queries/z-reports?business_date=${encodeURIComponent(business_date)}&limit=1`),
    closeBusinessDay: () => command<CloseBusinessDayResult>('CloseBusinessDay', {}),
    carryOverOrders: (payload) => command('CarryOverOrders', payload),
    printReport: (payload) => command('PrintReport', payload),
    fiscalStatus: () => staff.query<FiscalStatusView>('/queries/fiscal-status'),
    retryFiscalNow: () => command<{ pending_count: number }>('RetryFiscalNow', {}),
    recordPettyCash: (payload) => command<RecordPettyCashResult>('RecordPettyCash', payload),
    settlePettyAdvance: (payload) => command<SettlePettyAdvanceResult>('SettlePettyAdvance', payload),
    openBills: (floor_id) =>
      staff.query<OpenBillsBody>(floor_id === undefined ? '/queries/open-bills' : `/queries/open-bills?floor_id=${encodeURIComponent(floor_id)}`),
  };
}
