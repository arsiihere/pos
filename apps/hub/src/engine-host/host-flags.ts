// 03a P-6: the host's flags, in memory only and reset at boot (step 2). Later tasks add theirs here.
export interface HostFlags {
  configStale: boolean; // §3.11; step 6 sets it once E() exists (tasks 22, 24); the fires catch-up pass clears it
  last_pass_ms: number; // §3.6.3: the fires tick's previous due (firesDue); starts at boot time (bindFiresTick)
  checkpoint_pending: boolean; // §3.12
  day_closed: boolean; // §6.2a
  reconcile: boolean; // §6.2a, §3.10: the first fires_alerts pass after boot
  snapshot_loaded: boolean; // §3.12: step 2 loaded a current-version snapshot (read by task 21's fresh-snapshot rule)
  reserve_fallback_logged: Set<string>; // AD-6: a reserve_fallback repeats on every re-plan; logged once per line
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
  };
}

export function resetHostFlags(): void {
  Object.assign(hostFlags, fresh());
}
