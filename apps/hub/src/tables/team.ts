import type { WaiterTeam } from './contracts.js';

// 02a §3.5 (T4, T16): the waiter team W of a seating at `now`, A = the seating's assignee (T10).
// W = A's direct reports with a live staff session, else the holder's, else ∅. Waiter alerts go to W ∪ {holder}
// (owner Q2), so the result always holds the holder, once. In memory, no statement.
export const waiterTeam: WaiterTeam = (seating, liveStaffIds, directory) => {
  const working = (lead: string) => directory.teamOf(lead).filter((id) => id !== lead && liveStaffIds.has(id));
  let team = seating.assignee === null ? [] : working(seating.assignee);
  if (team.length === 0) team = working(seating.holder_staff_id);
  return [...new Set([...team, seating.holder_staff_id])];
};
