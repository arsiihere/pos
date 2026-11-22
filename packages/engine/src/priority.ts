// 03a v1.2.10 §3.5.7 PR-4 "The priority order" (STAB-7; re-review R-1, final check FC-1): first come, first served among
// priority groups, by lateness onset
//   onset(g) = max(priority_at(g) − priority_delay_ms(g), arrival(g)),
// priority_at(g) = the recorded_at of g's LinePrioritized (the same on each of its priority lines), arrival(g) = the
// arrived_at of g's first listed line (§3.3 BQ-1, v5); earliest first, ties by the earlier arrival (the BQ-1 arrival key
// of the first listed line), then its order_item_id. Both terms are stored at the fold, so the order is fixed and never
// re-sorted by a re-plan. Pure.
import { occupancy } from './profile.js';
import type { EngineLine, EngineState } from './state.js';

// §3.3 BQ-1 arrival key: (arrived_at, order_id, index of the line in its order's line_ids), then order_item_id.
export function byArrival(state: EngineState): (a: EngineLine, b: EngineLine) => number {
  const index = (l: EngineLine): number => state.orders[l.order_id]?.line_ids.indexOf(l.order_item_id) ?? -1;
  return (a, b) =>
    a.arrived_at - b.arrived_at ||
    (a.order_id < b.order_id ? -1 : a.order_id > b.order_id ? 1 : 0) ||
    index(a) - index(b) ||
    (a.order_item_id < b.order_item_id ? -1 : a.order_item_id > b.order_item_id ? 1 : 0);
}

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

// §3.5.7 PR-4, PR-5: a priority line's working deadline d_p(L) = priority_land_ms − carry − cook − prep (cook = the AD-4
// occupancy at cap), or null when the line is not priority or its group has no priority_land_ms yet.
export function priorityDeadline(state: EngineState, line: EngineLine, cap: number): number | null {
  if (line.priority_at === null) return null;
  const P = state.orders[line.order_id]?.groups[line.group_id]?.priority_land_ms ?? null;
  if (P === null) return null;
  return P - line.carry_ms - occupancy(line.units, Math.max(1, cap), line.cook_ms).cook_ms - line.prep_ms;
}

// The deadline a re-plan reads (BQ-2 J7, the fire's pull-in): d_p for a priority line (PR-4 "Sticky": never from the old
// d(L)), else its deadline_ms.
export function deadlineFor(state: EngineState, line: EngineLine, cap: number): number {
  return priorityDeadline(state, line, cap) ?? line.deadline_ms;
}

// §3.10 BQ-5 (review M-6), §3.6.1 item 1 (review M-12), PR-4 batch: the members of a batch station in keep order — the
// priority members first, in the priority order, then the rest by the BQ-1 arrival key. A line of a group with no rank
// (not priority) is not a priority member.
export function memberOrder(state: EngineState): (a: EngineLine, b: EngineLine) => number {
  const arrival = byArrival(state);
  const cmp = priorityCmp(state);
  const memo = new Map<string, PriorityRank | null>();
  const rank = (l: EngineLine): PriorityRank | null => {
    if (l.priority_at === null) return null;
    const k = l.group_id;
    if (!memo.has(k)) memo.set(k, priorityRank(state, l.order_id, k));
    return memo.get(k)!;
  };
  return (a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== null && rb !== null) return cmp(ra, rb) || arrival(a, b);
    if (ra !== null) return -1;
    if (rb !== null) return 1;
    return arrival(a, b);
  };
}
