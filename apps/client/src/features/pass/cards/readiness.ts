import type { PointOrder } from '../contracts';

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

export function readiness(order: PointOrder): Readiness {
  const open = order.lines.filter((l) => !l.handed_over);
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
