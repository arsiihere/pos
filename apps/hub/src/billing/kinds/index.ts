import type { Permission } from '@pos/domain';
import { APPROVAL_TIER_STEPS, defineAlertKind, type AlertRight } from '../../alerts/kinds.js';
import { seamApply } from './seam.js';
import {
  BillRequestDetails,
  CloseWithoutBuyerIdValues,
  DiscountValues,
  FiscalOutboxStuckDetails,
  FiscalOutboxStuckValues,
  PettyCashValues,
  RemoveCompValues,
  RemoveServiceChargeValues,
  ReopenBillValues,
  ShiftVarianceDetails,
  ShiftVarianceValues,
  type BillRequestKind,
  type BillRequestKindTypes,
} from './values.js';

export { BILL_KINDS, BILL_REQUEST_KINDS, type BillKind, type BillRequestKind } from './values.js';

// 05 §3.14, §3.15, row D-1 (task 9): the eight 05 alert kinds, defined at the top level of this module.
// billing/index.ts imports it statically (server.ts -> billing/index.ts), so the kinds exist before boot replays the
// `alerts` projection (01d §3.5 / P-8; test #89). No `link` (01d D-1: "05 kinds register no link"). Every `apply`
// goes through the seam (seam.ts); `onWithdraw` = as if never asked (§3.14).

const approval = (base_permission: Permission): AlertRight => ({ mode: 'approval', base_permission });
// §3.14, H1-1 (owner R1): holders of close-shift-for-others, whatever the requester's grant
const holders: AlertRight = { mode: 'holders', permission: 'close-shift-for-others' };

function requestKind<K extends BillRequestKind>(def: {
  kind: K;
  subject: 'bill' | 'order' | 'shift';
  right: AlertRight;
  values_schema: typeof DiscountValues | typeof RemoveServiceChargeValues | typeof ReopenBillValues | typeof RemoveCompValues | typeof CloseWithoutBuyerIdValues | typeof PettyCashValues | typeof ShiftVarianceValues;
  details_schema: typeof BillRequestDetails | typeof ShiftVarianceDetails;
}) {
  return defineAlertKind<BillRequestKindTypes[K]['values'], BillRequestKindTypes[K]['details']>({
    kind: def.kind,
    family: 'urgent', // ⚠️ 05 v1.0.9 §3.14 (owner R-49): every 05 request kind is family urgent (04 void_approval)
    subject: def.subject,
    steps: APPROVAL_TIER_STEPS,
    closes_on: 'owner', // the request closes on its answer, withdraw or the owner's obsolete close
    values_schema: def.values_schema as never,
    details_schema: def.details_schema as never,
    lead_fallback: false,
    expires_at_day_close: true, // no effect on a request kind (02b comp, 04 void precedent); 05's appender closes them
    silent: false,
    labels: { card: `alert.${def.kind}.card`, lock: `alert.${def.kind}.lock` },
    request: {
      answers: ['approve', 'reject'],
      right: def.right,
      needs_pin: 'always', // §3.14: money; 01d approval_receipt
      apply: seamApply(def.kind),
      onWithdraw: () => [], // §3.14: withdraw = never asked
    },
  });
}

/** §6.6: `ApplyDiscount` with grant `requires_approval`; dedupe `discount:<bill_id>`. */
export const DISCOUNT = requestKind({ kind: 'discount', subject: 'bill', right: approval('apply-discount'), values_schema: DiscountValues, details_schema: BillRequestDetails });

/** §6.8: `RemoveServiceCharge`; dedupe `remove_sc:<bill_id>`. */
export const REMOVE_SERVICE_CHARGE = requestKind({ kind: 'remove_service_charge', subject: 'bill', right: approval('remove-service-charge'), values_schema: RemoveServiceChargeValues, details_schema: BillRequestDetails });

/** §6.13: `ReopenBill`; dedupe `reopen:<bill_id>`. */
export const REOPEN_BILL = requestKind({ kind: 'reopen_bill', subject: 'bill', right: approval('reopen-bill'), values_schema: ReopenBillValues, details_schema: BillRequestDetails });

/** §6.14: `RemoveComp`; dedupe `remove_comp:<order_item_id>`; subject the line's order. */
export const REMOVE_COMP = requestKind({ kind: 'remove_comp', subject: 'order', right: approval('remove-comp'), values_schema: RemoveCompValues, details_schema: BillRequestDetails });

/** §6.11: `WaiveBuyerId`; dedupe `buyer_waiver:<bill_id>`. */
export const CLOSE_WITHOUT_BUYER_ID = requestKind({ kind: 'close_without_buyer_id', subject: 'bill', right: approval('close-without-buyer-id'), values_schema: CloseWithoutBuyerIdValues, details_schema: BillRequestDetails });

/** §6.20: `RecordPettyCash` (requires_approval, or over the limit); dedupe `petty:<command_id>`. */
export const PETTY_CASH = requestKind({ kind: 'petty_cash', subject: 'shift', right: holders, values_schema: PettyCashValues, details_schema: BillRequestDetails });

/** §6.17: `CountShift` over the threshold; dedupe `variance:<shift_id>`; a sign-off (approve / dispute). */
export const SHIFT_VARIANCE = requestKind({ kind: 'shift_variance', subject: 'shift', right: holders, values_schema: ShiftVarianceValues, details_schema: ShiftVarianceDetails });

/**
 * §3.15, H1-18, row D-1: the action alert to the managers while a fiscal outbox row is stuck; raised and re-raised by
 * task 31's tick (dedupe `fiscal_stuck:<branch_id>`), closed `done` when clear, expired at day close.
 */
export const FISCAL_OUTBOX_STUCK = defineAlertKind<FiscalOutboxStuckValues, FiscalOutboxStuckDetails>({
  kind: 'fiscal_outbox_stuck',
  family: 'action',
  subject: 'hub',
  steps: [{ at: { ms: 0 }, to: [{ target: { kind: 'managers' }, set: 'recipient' }] }],
  closes_on: 'owner',
  values_schema: FiscalOutboxStuckValues,
  details_schema: FiscalOutboxStuckDetails,
  lead_fallback: false,
  expires_at_day_close: true,
  silent: false,
  labels: { card: 'alert.fiscal_outbox_stuck.card', lock: 'alert.fiscal_outbox_stuck.lock' },
  request: null,
});
