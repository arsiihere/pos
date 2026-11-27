// ⚠️ 02b v1.0.25 §6.19 `OpenOrderBillChanged` (run 3 R3-M-2, R3-M-5, R3-M-8; D2, D3), §3.7a, L-BILL-2: the batched
// append of billing's money-changing commands. A writer before-commit hook (inside the owning transaction, after the
// money events folded): when the transaction appended a 05 money event — a payment added or removed, a split plan, a
// discount or service charge change, a comp removal, a split close, a bill reopen or empty close — it resolves the
// affected live takeaway / parking orders on those keys once, recomputes their keys' due once (`keyBalances`, D3), and
// appends one `OpenOrderBillChanged { order_ids, approval_cleared_order_ids }`. A clear is decided here (replay reads no
// billing): an effective approval ends on a reopen or an empty close of the bill, or when the fresh due exceeds the
// approved amount while the order still has a live unserved line (D2). An open `hand_over_unpaid` request whose amount
// differs from the fresh due closes `obsolete`, note `due_changed` — ⚠️ owner ruling 2026-11-27 (L-BILL-2): not on a
// payment or split close alone (PaymentAdded / PaymentRemoved / InvoiceIssued): 02b test 91 and 05 #60j keep it open until the last close
// (`bill_closed`); any other money change on its key closes it. Reasons closed earlier in the transaction (cancel,
// hand-over, last close, day close) win: those requests are no longer open. A paid (billed) or cancelled order is not
// affected (OrdersBilled / OrdersUnbilled clear their own orders in the fold). Reads: 1 affected-order read, 1
// `keyBalances`, 1 open-request read, plus 01d's close/result bound on a hit; 0 without a money event; no read per order.
import { OpenOrderBillChanged, OpenOrderBillChangedPayload, draftOf, type PosEvent } from '@pos/events';
import { alerts } from '../../alerts/raise.js';
import type { PreCommit, Writer } from '../../engine-host/writer.js';
import { keyBalances } from '../queries/key-balances.js';
import { HAND_OVER_UNPAID_KIND } from '../kinds/values.js';

/** 05 `bill`-stream events that change what a key bill asks (stream id = the bill id). */
const MONEY_BILL_EVENTS: ReadonlySet<string> = new Set([
  'PaymentAdded',
  'PaymentRemoved',
  'BillSplitsSet',
  'DiscountApplied',
  'DiscountRemoved',
  'ChargeApplied',
  'ChargeRemoved',
  'InvoiceIssued',
  'InvoiceCredited',
  'BillReopened',
  'BillClosedEmpty',
]);
/**
 * ⚠️ owner ruling 2026-11-27: a payment alone never closes a pending request `due_changed` (tests 91, #60j); nor does
 * a split close (`InvoiceIssued`: "partial split close cannot close as paid", test 91), which settles what was paid.
 */
const PAYMENTS: ReadonlySet<string> = new Set(['PaymentAdded', 'PaymentRemoved', 'InvoiceIssued']);
/** A reopen or an empty close ends every approval on the bill's key (§6.19: "if the last bill closes or a reopen occurs"). */
const CLEARS_ALL: ReadonlySet<string> = new Set(['BillReopened', 'BillClosedEmpty']);
/** 05 order-stream money events (stream id = the order id). */
const MONEY_ORDER_EVENTS: ReadonlySet<string> = new Set(['LineCompRemoved']);

export interface MoneyTouch {
  bill_ids: string[];
  forced_bill_ids: string[];
  /** bills touched by a money event other than a payment (their keys' stale requests close `due_changed`) */
  closing_bill_ids: string[];
  /** orders named by a 05 order-stream money event (a non-payment change: closing too) */
  order_ids: string[];
}

/**
 * The bills and orders whose money the transaction changed (0 statements). The rule `ChargeApplied` that opens a bill
 * with its `BillOpened` (ensure bill) is the projected charge already in the due, not a change.
 */
export function moneyTouched(appended: readonly PosEvent[]): MoneyTouch {
  const opened = new Set(appended.filter((e) => e.event_type === 'BillOpened').map((e) => e.stream_id));
  const bills = new Set<string>();
  const forced = new Set<string>();
  const closing = new Set<string>();
  const orders = new Set<string>();
  for (const e of appended) {
    if (e.stream_type === 'bill' && MONEY_BILL_EVENTS.has(e.event_type)) {
      if (e.event_type === 'ChargeApplied' && opened.has(e.stream_id)) continue;
      bills.add(e.stream_id);
      if (CLEARS_ALL.has(e.event_type)) forced.add(e.stream_id);
      if (!PAYMENTS.has(e.event_type)) closing.add(e.stream_id);
    } else if (e.stream_type === 'order' && MONEY_ORDER_EVENTS.has(e.event_type)) orders.add(e.stream_id);
  }
  return { bill_ids: [...bills], forced_bill_ids: [...forced], closing_bill_ids: [...closing], order_ids: [...orders] };
}

// 1: the live takeaway / parking orders on the touched keys (a bill's own key, or a named order's key), with their
// approval columns, whether the key was reopened / emptied here, and whether they still have a live unserved line.
const AFFECTED = `
WITH
touched AS (
  SELECT table_key AS bill_key, MAX(bill_id IN (SELECT value FROM json_each(@forced))) AS forced,
         MAX(bill_id IN (SELECT value FROM json_each(@closing))) AS closing
    FROM bills WHERE scope = 'key' AND table_key IS NOT NULL AND bill_id IN (SELECT value FROM json_each(@bills))
   GROUP BY table_key
  UNION ALL
  SELECT bill_key, 0, 1 FROM orders WHERE bill_key IS NOT NULL AND order_id IN (SELECT value FROM json_each(@orders))
)
SELECT o.order_id, o.bill_key, o.unpaid_handover_approved_at AS approved_at, o.unpaid_handover_approved_due_minor AS approved_due,
       (SELECT MAX(t.forced) FROM touched t WHERE t.bill_key = o.bill_key) AS forced,
       (SELECT MAX(t.closing) FROM touched t WHERE t.bill_key = o.bill_key) AS closing,
       EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.order_id AND l.line_kind <> 'deal' AND l.served_at IS NULL
                 AND l.units - l.removed_units - l.voided_units > 0) AS unserved
  FROM orders o
 WHERE o.bill_key IN (SELECT bill_key FROM touched) AND o.order_type IN ('takeaway', 'parking')
   AND o.cancelled_at IS NULL AND o.billed_at IS NULL AND o.day_closed_at IS NULL
 ORDER BY o.placed_at, o.order_id`;

interface AffectedRow {
  order_id: string;
  bill_key: string;
  approved_at: number | null;
  approved_due: number | null;
  forced: number;
  closing: number;
  unserved: number;
}

/** The before-commit hook body. */
export function openOrderBillChanged(pre: PreCommit): void {
  const touch = moneyTouched(pre.appended);
  if (touch.bill_ids.length === 0 && touch.order_ids.length === 0) return;
  const tx = pre.tx();
  const rows = tx.db
    .prepare(AFFECTED)
    .all({ bills: JSON.stringify(touch.bill_ids), forced: JSON.stringify(touch.forced_bill_ids), closing: JSON.stringify(touch.closing_bill_ids), orders: JSON.stringify(touch.order_ids) }) as AffectedRow[]; // 1
  if (rows.length === 0) return;
  const dues = keyBalances(tx.db, [...new Set(rows.map((r) => r.bill_key))]); // 1
  const dueOf = (r: AffectedRow): number => dues.get(r.bill_key)?.due_minor ?? 0;
  const cleared = rows
    .filter((r) => r.approved_at !== null && (r.forced === 1 || (r.unserved === 1 && r.approved_due !== null && dueOf(r) > r.approved_due)))
    .map((r) => r.order_id);

  const first = pre.appended.find((e) => (e.stream_type === 'bill' && MONEY_BILL_EVENTS.has(e.event_type)) || (e.stream_type === 'order' && MONEY_ORDER_EVENTS.has(e.event_type)))!;
  const now = tx.clock.branchNow();
  const payload = OpenOrderBillChangedPayload.parse({ order_ids: rows.map((r) => r.order_id), approval_cleared_order_ids: cleared });
  const drafts = [draftOf(OpenOrderBillChanged, { stream_type: 'order', stream_id: rows[0]!.order_id, payload, occurred_at: now, actor_id: first.actor_id, device_id: first.device_id })];

  // §6.19: an open request whose amount changed closes obsolete (due_changed); a same-amount one stays; a key touched
  // only by payments reads no request (owner ruling 2026-11-27)
  const byOrder = new Map(rows.filter((r) => r.closing === 1).map((r) => [r.order_id, r]));
  const stale =
    byOrder.size === 0
      ? []
      : alerts
          .listOpen(tx.db, { kind: HAND_OVER_UNPAID_KIND }) // 1
          .filter((a) => {
            const r = byOrder.get(a.subject.stream_id);
            return r !== undefined && (a.values as { due_minor?: unknown }).due_minor !== dueOf(r);
          });
  tx.append(drafts);
  if (stale.length > 0) tx.append(alerts.closeMany(alerts.tickCtx(tx, now), stale.map((a) => ({ alert_id: a.alert_id, reason: 'obsolete' as const, note: 'due_changed' }))));
}

/** Once per server (registerBilling). */
export function registerOpenOrderBillChanged(writer: Pick<Writer, 'addBeforeCommit'>): void {
  writer.addBeforeCommit(openOrderBillChanged);
}
