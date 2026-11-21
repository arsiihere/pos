import { ORDER_FRAMES } from '../staff/orders/table-view/refetch';

// 05 §8 "Cashier screen": the open-bills list is read again on `event` frames of the bill, order and table streams
// (and on reconnect / focus, which the live bus publishes). ⚠️ G-26: the order frames are 02b's view list
// (table-view/refetch.ts, which holds OrdersBilled and OrdersUnbilled); 05's OrdersCarriedOver is left out (the
// order stays open and unbilled, no row changes). Table frames as tables/map/map-store.ts, minus TableLockTouched.

/** §6.29 bill stream (packages/events/src/events/bill/). */
const BILL_FRAMES = [
  'BillOpened',
  'ChargeApplied',
  'ChargeRemoved',
  'CheckBillPrinted',
  'BillSplitsSet',
  'DiscountApplied',
  'DiscountFrozen',
  'DiscountRemoved',
  'PaymentAdded',
  'PaymentRemoved',
  'BuyerIdWaived',
  'InvoiceIssued',
  'InvoiceCredited',
  'FiscalNumberAssigned',
  'FiscalSubmitRejected',
  'BillReopened',
  'BillClosedEmpty',
] as const;

const TABLE_FRAMES = [
  'TableOpened',
  'TableLocked',
  'TableLockReleased',
  'TableHolderChanged',
  'TableMoved',
  'TablesMerged',
  'SeatingSplit',
  'BillRequested',
  'TableCleaned',
  'SeatingReopened',
  'BillClosed',
  'TableMarksChanged',
] as const;

export const BILL_LIST_FRAMES: ReadonlySet<string> = new Set<string>([...BILL_FRAMES, ...ORDER_FRAMES, ...TABLE_FRAMES]);

/** 05-2 shift stream (packages/events/src/events/shift/): the shift screen reads again on these (task 40: a petty entry
 *  approved elsewhere, a settle on another device) and on reconnect. */
export const SHIFT_FRAMES: ReadonlySet<string> = new Set([
  'ShiftOpened',
  'ShiftCounted',
  'ShiftClosed',
  'ShiftCountSkipped',
  'HandoverCounted',
  'ShiftVarianceSignedOff',
  'PettyCashAdvanced',
  'PettyCashOut',
  'PettyCashIn',
  'PettyCashSettled',
  'DrawerOpened',
]);

