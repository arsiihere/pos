// 03a P-6: the host's flags, in memory only and reset at boot (step 2). Later tasks add theirs here.
export interface HostFlags {
  configStale: boolean; // §3.11; step 6 sets it once E() exists (tasks 22, 24); the fires catch-up pass clears it
  last_pass_ms: number; // §3.6.3: the fires tick's previous due (firesDue); starts at boot time (bindFiresTick)
  checkpoint_pending: boolean; // §3.12
  day_closed: boolean; // §6.2a
  reconcile: boolean; // §6.2a, §3.10: the first fires_alerts pass after boot
  snapshot_loaded: boolean; // §3.12: step 2 loaded a current-version snapshot (read by task 21's fresh-snapshot rule)
  reserve_fallback_logged: Set<string>; // AD-6: a reserve_fallback repeats on every re-plan; logged once per line
  // §6.2a / §3.8 / §3.10 (task 22a): the fires_alerts tick's host memory, reset at boot (and at bindFiresAlertsTick).
  skipped: Set<string>; // §3.8: table keys a pass could not raise; one leaves at a commit touching one of its orders
  red_since: Map<string, number>; // §3.10, P-7: station → since when it is red, as the overload check saw it
  overload_open: Set<string>; // §3.10: stations with an open station_overload, refreshed by every pass with work
  overload_skipped: Set<string>; // §3.10: stations whose overload values failed the kind's schema (logged once)
  dropped_lines: DroppedLine[]; // AD-8: dropped-line facts from the after-commit hook, raised by the next pass
  // 03a v1.2 §3.3 Q-3, AD-E18: ids the absent-id log skips — zone lines, deal headers and the order ids of an OrderPlaced
  // with empty order_item_ids. Never engine state, never in a snapshot or checkpoint; rebuilt by boot step 3 (R-3).
  untrackedLineIds: Set<string>;
}

// AD-8 developer condition: one engine_line_dropped alert per fact. `batch`: a refused OrderPlaced / OrderLinesAdded
// (every line it listed is lost; the diagnostic names its first offending id).
export interface DroppedLine {
  order_id: string | null;
  order_item_id: string | null;
  reason: string;
  batch: boolean;
}

export const hostFlags: HostFlags = fresh();

function fresh(): HostFlags {
  return {
    configStale: false,
    last_pass_ms: 0,
    checkpoint_pending: false,
    day_closed: false,
    reconcile: false,
    snapshot_loaded: false,
    reserve_fallback_logged: new Set(),
    skipped: new Set(),
    red_since: new Map(),
    overload_open: new Set(),
    overload_skipped: new Set(),
    dropped_lines: [],
    untrackedLineIds: new Set(),
  };
}

export function resetHostFlags(): void {
  Object.assign(hostFlags, fresh());
}
