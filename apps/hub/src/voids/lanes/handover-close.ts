// ⚠️ 04 v1.0.9 §6.2 (02b run 3 R3-M-3; 02b v1.0.25 §3.7a Close (b)), L-UNPAID-3 task 2: the approved void's follow-up.
// `void_approval.apply` drafts the void effects with `stale_comps: 'keep'`, so 02b's `changeDrafts` leaves a pending
// `hand_over_unpaid` request open. After those drafts fold and before commit (a writer before-commit hook, outside
// apply), each takeaway / parking order an apply named that the transaction cancelled has its still-open request closed
// through `alerts.closeMany`: `obsolete`, note `order_cancelled`, with 01d's `request_result` to its original requester.
// The first close wins (a request already closed is not open). A partial void's changed due is 02b §6.19's
// (orders/open-order-bill.ts, note `due_changed`). Reject, withdraw and an answer with no void effects name no order.
// Reads: 1 `alerts.listOpen` (kind) only when such an order was cancelled; none for dine-in (apply knows the type).
import type { PreCommit, Writer } from '../../engine-host/writer.js';
import { alerts } from '../../alerts/raise.js';
import { HAND_OVER_UNPAID_KIND } from '../../orders/line-change.js';

// The takeaway / parking orders `apply` drafted void effects for in the running writer transaction (the writer is
// single and synchronous; the hook empties it, and only acts on an order this transaction actually cancelled).
const applied = new Set<string>();

/** Called by `void_approval.apply` (0 statements). */
export function noteVoidApply(order_id: string, order_type: string): void {
  if (order_type === 'takeaway' || order_type === 'parking') applied.add(order_id);
}

export function voidHandoverClose(pre: PreCommit): void {
  if (applied.size === 0) return;
  const named = new Set(applied);
  applied.clear();
  const cancelled = new Set(pre.appended.filter((e) => e.event_type === 'OrderCancelled' && named.has(e.stream_id)).map((e) => e.stream_id));
  if (cancelled.size === 0) return;
  const tx = pre.tx();
  const open = alerts.listOpen(tx.db, { kind: HAND_OVER_UNPAID_KIND }).filter((a) => cancelled.has(a.subject.stream_id)); // 1
  if (open.length === 0) return;
  tx.append(alerts.closeMany(alerts.tickCtx(tx, tx.clock.branchNow()), open.map((a) => ({ alert_id: a.alert_id, reason: 'obsolete' as const, note: 'order_cancelled' }))));
}

/** Once per server (registerVoids). */
export function registerVoidHandoverClose(writer: Pick<Writer, 'addBeforeCommit'>): void {
  writer.addBeforeCommit(voidHandoverClose);
}
