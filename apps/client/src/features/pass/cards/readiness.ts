import type { PointOrder } from '../contracts';
import { orderTypeOf } from '../order-filter';

// 03b v1.0.8 §3.4 (Q-46, #74; P2): the card's readiness, computed on the Pass from the stages it holds — the engine's
// groupReadiness rule (packages/engine/src/view.ts) over this point's lines: per group its sync lines only; done =
// `done`, waiting = `added` / `cooking`; a group with both holds its done lines (HOLD AT PASS, a hint, never a block);
// the order is Ready when no sync line here waits. An immediate line (a return, a released / expedited line, or any
// line before HK2 sends group_id / serve_mode) never waits for anything and is never held.
// Card states: `sent` = a Ready is open (the band shows it); `none` = every line handed over (no pill);
// `hold` / `ready` / `cooking` otherwise. Ready also needs one done line to hand over, so a card of only waiting
// immediate lines reads Cooking.

export type ReadinessState = 'ready' | 'hold' | 'cooking' | 'sent' | 'none';

export interface Readiness {
  state: ReadinessState;
  /** the done sync lines waiting for a sibling of their group (HOLD AT PASS) */
  held: ReadonlySet<string>;
}

/**
 * ⚠️ 03b v1.0.16 §3.4 "Readiness" (run 3 R3-M-5): a pickup card (the order has a pickup time) uses the hub's
 * whole-order summary: every engine line of the order, at any point, done or served, and the station-less hold
 * (`station_less_hold_until`, the pickup time; null when boosted or none is left) reached on hub time. A known pickup
 * without `pickup_readiness` (an older hub) is never ready by itself.
 */
export const isPickup = (order: PointOrder): boolean => order.pickup_at_ms != null;
export function pickupReady(order: PointOrder, nowMs: number): boolean {
  const r = order.pickup_readiness;
  if (r == null) return false;
  return r.all_engine_lines_done && (r.station_less_hold_until === null || nowMs >= r.station_less_hold_until);
}

export function readiness(order: PointOrder, nowMs = Number.NEGATIVE_INFINITY): Readiness {
  const open = order.lines.filter((l) => !l.handed_over);
  if (isPickup(order)) {
    // a pickup card has no HOLD hint (a held immediate group included); Ready follows the whole order
    const none = new Set<string>();
    if (order.ready !== null) return { state: 'sent', held: none };
    if (open.length === 0) return { state: 'none', held: none };
    return { state: pickupReady(order, nowMs) && open.some((l) => l.stage === 'done') ? 'ready' : 'cooking', held: none };
  }
  const groups = new Map<string, { done: string[]; waiting: number }>();
  for (const l of open) {
    if (l.serve_mode !== 'sync' || l.group_id === undefined) continue;
    const g = groups.get(l.group_id) ?? { done: [], waiting: 0 };
    if (l.stage === 'done') g.done.push(l.order_item_id);
    else g.waiting += 1;
    groups.set(l.group_id, g);
  }
  const held = new Set<string>();
  let waiting = false;
  for (const g of groups.values()) {
    if (g.waiting === 0) continue;
    waiting = true;
    for (const id of g.done) held.add(id);
  }
  if (order.ready !== null) return { state: 'sent', held };
  if (open.length === 0) return { state: 'none', held };
  if (held.size > 0) return { state: 'hold', held };
  if (!waiting && open.some((l) => l.stage === 'done')) return { state: 'ready', held };
  return { state: 'cooking', held };
}

/**
 * 02b-TK L-CLIENT-1 item 2 (03b v1.0.16 §3.4 "Not collected" (R3-M-9), §3.5 R8, D8): a takeaway / parking card is
 * amber from hub now ≥ `bag_ready_since` + `bag_ready_window_ms` (the order's R8 epoch, shared by every point); the
 * minutes since the bag was ready, else null. The hub clears the pair when the bag is incomplete again or collected.
 */
export function notCollectedMin(order: PointOrder, nowMs: number): number | null {
  const since = order.bag_ready_since ?? null;
  const win = order.bag_ready_window_ms ?? null;
  if (since === null || win === null || orderTypeOf(order) === 'dine_in' || nowMs < since + win) return null;
  return Math.floor((nowMs - since) / 60_000);
}
