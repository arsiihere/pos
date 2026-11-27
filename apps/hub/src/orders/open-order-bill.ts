// ⚠️ 02b v1.0.25 §6.19 `OpenOrderBillChanged` (run 3 R3-M-8; D2, D3), L-UNPAID-3 task 1: the money changes outside
// billing — a line weight set, a removal, a void, a comp, an addition (OrderPlaced with `adds_to_order_id`) or lines
// added to an order — append one batched `OpenOrderBillChanged` in the owning transaction, before commit, with the same
// rule as billing's hook (billing/lanes/open-order-bill.ts, which owns 05's money events and LineCompRemoved): the live
// takeaway / parking orders on the touched keys (1 read), the open requests (1), their keys' fresh due (`keyBalances`,
// 1, only when one of them has an approval or an open request), the decided clears
// (an approval whose fresh due exceeds the approved amount while the order still has a live unserved line), and an
// open `hand_over_unpaid` request whose amount changed closed `obsolete`, note `due_changed` (none of these is a
// payment). Closes made earlier in the transaction (a cancellation's `order_cancelled`, a hand-over) win:
// those requests are no longer open; a cancelled order is not affected. No transaction appends both these events and
// 05's money events (05 commands append none of these; 02b and 04 commands append no bill-stream money event), so a
// transaction gets at most one OpenOrderBillChanged. 0 statements without such an event; no read per order.
import { OpenOrderBillChanged, OpenOrderBillChangedPayload, draftOf, type PosEvent } from '@pos/events';
import { alerts } from '../alerts/raise.js';
import { keyBalances } from '../billing/queries/key-balances.js';
import type { PreCommit, Writer } from '../engine-host/writer.js';
import { HAND_OVER_UNPAID_KIND } from './line-change.js';

/** 02b / 04 order-stream events that change what a key bill asks (stream id = the order id). */
const MONEY_LINE_EVENTS: ReadonlySet<string> = new Set(['ItemRemoved', 'ItemVoided', 'LineWeightSet', 'LineComped', 'OrderLinesAdded']);

/** The orders whose money the transaction changed (0 statements). A first order of a key is no change of a bill. */
export function lineMoneyTouched(appended: readonly PosEvent[]): string[] {
  const out = new Set<string>();
  for (const e of appended) {
    if (e.stream_type !== 'order') continue;
    if (MONEY_LINE_EVENTS.has(e.event_type)) out.add(e.stream_id);
    else if (e.event_type === 'OrderPlaced' && typeof e.payload['adds_to_order_id'] === 'string') out.add(e.stream_id);
  }
  return [...out];
}

// 1: the live takeaway / parking orders on the named orders' keys, with their approval and whether a live unserved
// non-deal line is left.
const AFFECTED = `
SELECT o.order_id, o.bill_key, o.unpaid_handover_approved_at AS approved_at, o.unpaid_handover_approved_due_minor AS approved_due,
       EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.order_id AND l.line_kind <> 'deal' AND l.served_at IS NULL
                 AND l.units - l.removed_units - l.voided_units > 0) AS unserved
  FROM orders o
 WHERE o.bill_key IN (SELECT bill_key FROM orders WHERE bill_key IS NOT NULL AND order_type IN ('takeaway', 'parking')
                        AND order_id IN (SELECT value FROM json_each(?)))
   AND o.order_type IN ('takeaway', 'parking') AND o.cancelled_at IS NULL AND o.billed_at IS NULL AND o.day_closed_at IS NULL
 ORDER BY o.placed_at, o.order_id`;

interface AffectedRow {
  order_id: string;
  bill_key: string;
  approved_at: number | null;
  approved_due: number | null;
  unserved: number;
}

/** The before-commit hook body. */
export function lineMoneyChanged(pre: PreCommit): void {
  const named = lineMoneyTouched(pre.appended);
  if (named.length === 0) return;
  const tx = pre.tx();
  const rows = tx.db.prepare(AFFECTED).all(JSON.stringify(named)) as AffectedRow[]; // 1
  if (rows.length === 0) return;
  const byOrder = new Map(rows.map((r) => [r.order_id, r]));
  const open = alerts.listOpen(tx.db, { kind: HAND_OVER_UNPAID_KIND }).filter((a) => byOrder.has(a.subject.stream_id)); // 1
  // the fresh due only matters to an approval or an open request: none on these keys → no due read
  const needed = open.length > 0 || rows.some((r) => r.approved_at !== null);
  const dues = needed ? keyBalances(tx.db, [...new Set(rows.map((r) => r.bill_key))]) : new Map<string, { due_minor: number }>(); // ≤ 1
  const dueOf = (r: AffectedRow): number => dues.get(r.bill_key)?.due_minor ?? 0;
  const cleared = rows.filter((r) => r.approved_at !== null && r.unserved === 1 && r.approved_due !== null && dueOf(r) > r.approved_due).map((r) => r.order_id);
  const stale = open.filter((a) => (a.values as { due_minor?: unknown }).due_minor !== dueOf(byOrder.get(a.subject.stream_id)!));

  const first = pre.appended.find((e) => e.stream_type === 'order' && named.includes(e.stream_id))!;
  const now = tx.clock.branchNow();
  const payload = OpenOrderBillChangedPayload.parse({ order_ids: rows.map((r) => r.order_id), approval_cleared_order_ids: cleared });
  tx.append([draftOf(OpenOrderBillChanged, { stream_type: 'order', stream_id: rows[0]!.order_id, payload, occurred_at: now, actor_id: first.actor_id, device_id: first.device_id })]);
  if (stale.length > 0) tx.append(alerts.closeMany(alerts.tickCtx(tx, now), stale.map((a) => ({ alert_id: a.alert_id, reason: 'obsolete' as const, note: 'due_changed' }))));
}

/** Once per server (registerOrders). */
export function registerLineMoneyChanged(writer: Pick<Writer, 'addBeforeCommit'>): void {
  writer.addBeforeCommit(lineMoneyChanged);
}
