import { describe, expect, it } from 'vitest';
import type { HubResult } from '../../../api/hub-admin';
import { createShellConfig, type BranchConfigReply } from './config';
import { createLiveBus } from './live';

const settings = (zone_undo_ms: number) => ({
  zone_undo_ms,
  slow_item_threshold_ms: 1_500_000,
  comp_reason_chips: ['Late', 'Quality'],
  queue_auto_send_max_ms: 14_400_000,
  table_lock_ttl_ms: 900_000,
  order_abandon_ms: 7_200_000,
  served_estimate_ms: null,
  slip_threshold_ms: 1,
});
const replyOf = (zone_undo_ms: number): HubResult<BranchConfigReply | null> => ({
  ok: true,
  data: { config_version: 1, snapshot_hash: 'h', snapshot: { engine_settings: settings(zone_undo_ms) } as never, hub_time: { now_ms: 1, utc_offset_ms: 0 } },
});

describe('[02 W0.6] branch settings', () => {
  it('[02 W0.6] config(): engine_settings (zone_undo_ms, slow_item_threshold_ms, comp_reason_chips, queue_auto_send_max_ms, table_lock_ttl_ms, order_abandon_ms) from branch-config, refreshed on BranchConfigApplied', async () => {
    const live = createLiveBus();
    const answers = [replyOf(300_000), replyOf(120_000)];
    let reads = 0;
    const config = createShellConfig({ load: async () => answers[reads++] ?? replyOf(60_000), live });
    expect(config.config()).toBeNull(); // never a guessed default
    let changes = 0;
    config.subscribe(() => (changes += 1));
    await config.refresh();
    expect(config.config()).toEqual({
      zone_undo_ms: 300_000,
      slow_item_threshold_ms: 1_500_000,
      comp_reason_chips: ['Late', 'Quality'],
      queue_auto_send_max_ms: 14_400_000,
      table_lock_ttl_ms: 900_000,
      order_abandon_ms: 7_200_000,
    });
    // another event reads nothing; BranchConfigApplied reads again
    live.frame({ type: 'event', seq: 1, event: { event_id: 'E1', event_type: 'TableOpened', schema_version: 1, payload: {} } });
    expect(reads).toBe(1);
    live.frame({ type: 'event', seq: 2, event: { event_id: 'E2', event_type: 'BranchConfigApplied', schema_version: 1, payload: {} } });
    await Promise.resolve();
    await Promise.resolve();
    expect(reads).toBe(2);
    expect(config.config()?.zone_undo_ms).toBe(120_000);
    expect(changes).toBe(2);
    config.dispose();
  });

  it('[02 W0.6] no snapshot or a failed read keeps what it had; a late older reply never wins', async () => {
    const live = createLiveBus();
    let release: (v: HubResult<BranchConfigReply | null>) => void = () => {};
    const slow = new Promise<HubResult<BranchConfigReply | null>>((r) => (release = r));
    const queue: Array<() => Promise<HubResult<BranchConfigReply | null>>> = [
      async () => ({ ok: true, data: null }),
      () => slow,
      async () => replyOf(5),
      async () => ({ ok: false, error: { kind: 'network' } }),
    ];
    const config = createShellConfig({ load: () => queue.shift()!(), live });
    await config.refresh();
    expect(config.config()).toBeNull();
    const first = config.refresh();
    await config.refresh();
    release(replyOf(999));
    await first;
    expect(config.config()?.zone_undo_ms).toBe(5);
    await config.refresh();
    expect(config.config()?.zone_undo_ms).toBe(5);
  });
});
