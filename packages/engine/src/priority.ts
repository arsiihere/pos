// 03a v1.2.10 §3.5.7 PR-4 "The priority order" (STAB-7; re-review R-1, final check FC-1): first come, first served among
// priority groups, by lateness onset
//   onset(g) = max(priority_at(g) − priority_delay_ms(g), arrival(g)),
// priority_at(g) = the recorded_at of g's LinePrioritized (the same on each of its priority lines), arrival(g) = the
// arrived_at of g's first listed line (§3.3 BQ-1, v5); earliest first, ties by the earlier arrival (the BQ-1 arrival key
// of the first listed line), then its order_item_id. Both terms are stored at the fold, so the order is fixed and never
// re-sorted by a re-plan. Pure.
import { byArrival } from './replan.js';
import type { EngineLine, EngineState } from './state.js';

export type PriorityRank = { group_id: string; onset: number; first: EngineLine };

// The rank of a priority group (a group with a priority line and its priority_delay_ms), or null for any other group.
// The first listed line is the first of the group's line_ids still in the state.
export function priorityRank(state: EngineState, order_id: string, group_id: string): PriorityRank | null {
  const g = state.orders[order_id]?.groups[group_id];
  if (g === undefined || g.priority_delay_ms === null) return null;
  let first: EngineLine | undefined;
  let since = Number.POSITIVE_INFINITY;
  for (const id of g.line_ids) {
    const l = state.lines[id];
    if (l === undefined) continue;
    first ??= l;
    if (l.priority_at !== null) since = Math.min(since, l.priority_at);
  }
  if (first === undefined || since === Number.POSITIVE_INFINITY) return null;
  return { group_id, onset: Math.max(since - g.priority_delay_ms, first.arrived_at), first };
}

// The comparator of the priority order (tasks 16–19): onset, then the arrival key, then order_item_id.
export function priorityCmp(state: EngineState): (a: PriorityRank, b: PriorityRank) => number {
  const arrival = byArrival(state);
  return (a, b) =>
    a.onset - b.onset ||
    arrival(a.first, b.first) ||
    (a.first.order_item_id < b.first.order_item_id ? -1 : a.first.order_item_id > b.first.order_item_id ? 1 : 0) ||
    (a.group_id < b.group_id ? -1 : a.group_id > b.group_id ? 1 : 0);
}
