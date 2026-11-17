import type { BranchConfig } from '@pos/events';
import type { HubResult } from '../../../api/hub-admin';
import type { LiveBus } from './live';

// 02a §8 Banners (table_lock_ttl_ms), 02b §8 (W0.6): the branch settings the 02 screens read, from
// `GET /queries/branch-config` (snapshot.engine_settings), read again on `BranchConfigApplied` and on a reconnect
// (a frame may have been missed). Never a hard-coded default: until the first read, `config()` is null.

export interface StaffSettings {
  zone_undo_ms: number;
  slow_item_threshold_ms: number;
  comp_reason_chips: string[];
  queue_auto_send_max_ms: number;
  table_lock_ttl_ms: number;
  order_abandon_ms: number;
}

export interface BranchConfigReply {
  config_version: number;
  snapshot_hash: string;
  snapshot: BranchConfig;
  hub_time: { now_ms: number; utc_offset_ms: number };
}

export interface ShellConfig {
  config(): StaffSettings | null;
  /** the whole snapshot (menu, windows, stations, floors) for the screens that need more */
  snapshot(): BranchConfig | null;
  refresh(): Promise<void>;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

const NUMBERS = ['zone_undo_ms', 'slow_item_threshold_ms', 'queue_auto_send_max_ms', 'table_lock_ttl_ms', 'order_abandon_ms'] as const;

/** The six settings, or null when the snapshot does not carry them all (no snapshot yet, an older schema). */
function settingsOf(snapshot: BranchConfig | null): StaffSettings | null {
  const s = (snapshot?.engine_settings ?? null) as Partial<Record<string, unknown>> | null;
  if (s === null) return null;
  if (!NUMBERS.every((k) => typeof s[k] === 'number')) return null;
  const chips = s['comp_reason_chips'];
  if (!Array.isArray(chips) || !chips.every((c) => typeof c === 'string')) return null;
  const n = (k: (typeof NUMBERS)[number]) => s[k] as number;
  return {
    zone_undo_ms: n('zone_undo_ms'),
    slow_item_threshold_ms: n('slow_item_threshold_ms'),
    comp_reason_chips: [...(chips as string[])],
    queue_auto_send_max_ms: n('queue_auto_send_max_ms'),
    table_lock_ttl_ms: n('table_lock_ttl_ms'),
    order_abandon_ms: n('order_abandon_ms'),
  };
}

export function createShellConfig(o: { load: () => Promise<HubResult<BranchConfigReply | null>>; live: LiveBus }): ShellConfig {
  let snapshot: BranchConfig | null = null;
  let settings: StaffSettings | null = null;
  let generation = 0;
  const listeners = new Set<() => void>();
  const refresh = async () => {
    const gen = ++generation;
    const answer = await o.load();
    // an older read that answers late never replaces a newer one
    if (gen !== generation || !answer.ok || answer.data === null) return;
    snapshot = answer.data.snapshot ?? null;
    settings = settingsOf(snapshot);
    for (const l of [...listeners]) l();
  };
  const off = o.live.subscribe((m) => {
    if ((m.kind === 'event' && m.event.event_type === 'BranchConfigApplied') || m.kind === 'reconnect') void refresh();
  });
  return {
    config: () => settings,
    snapshot: () => snapshot,
    refresh,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose: off,
  };
}
