import type { LocalFlags } from './contracts';

// 02a Q-16 (§3.13 v1.1.6): "Call sent · n min" from this device's own CallWaiter, in memory only — lost on reload,
// never shown on another device (the map carries no call field).

export function createLocalFlags(): LocalFlags {
  const calls = new Map<string, number>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of [...listeners]) l();
  };
  return {
    callSentAt: (table_id) => calls.get(table_id) ?? null,
    markCallSent(table_id, at_ms) {
      calls.set(table_id, at_ms);
      changed();
    },
    clearCallSent(table_id) {
      if (calls.delete(table_id)) changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
