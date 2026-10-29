import type { BranchConfigV1 } from '@pos/events';
import { aBranchConfigV1 } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { branchConfig, onBranchConfigApplied } from '../../src/sync/branch-config-holder';
import { configPoller } from '../../src/sync/config-poller';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, type TestHub } from '../helpers/test-hub';

const BRANCH = 'branch-1';
const CONFIRMED = { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'key-1', confirmed_at: 1 };

describe('onBranchConfigApplied', () => {
  const cleanups: Array<() => unknown> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[01a §10 #58] the hook runs inside the transaction with prev/next; an event it appends commits with BranchConfigApplied', async () => {
    const cloud = stubConfigCloud();
    const h: TestHub = await createTestHub({ configClient: cloud, config: { provisioned: { ...CONFIRMED } } });
    cleanups.push(() => h.close());
    const calls: Array<{ prev: number | null; next: number; inTx: boolean; swapped: BranchConfigV1 | null; rowVersion: number }> = [];
    cleanups.push(
      onBranchConfigApplied((prev, next, tx) => {
        calls.push({
          prev: prev?.config_version ?? null,
          next: next.config_version,
          inTx: tx.db.inTransaction,
          swapped: branchConfig(),
          rowVersion: tx.db.prepare('SELECT config_version FROM branch_config').pluck().get() as number,
        });
        tx.append([
          {
            stream_type: 'hub',
            stream_id: BRANCH,
            event_type: 'TestNooped',
            schema_version: 1,
            payload: { command_id: `hook-${next.config_version}` },
            occurred_at: tx.clock.branchNow(),
            actor_id: null,
            device_id: 'hub',
          },
        ]);
      }),
    );

    cloud.respondWithSnapshot(aBranchConfigV1({ branch_id: BRANCH, config_version: 3 }));
    await configPoller(h.app).pollOnce();
    cloud.respondWithSnapshot(aBranchConfigV1({ branch_id: BRANCH, config_version: 4 }));
    await configPoller(h.app).pollOnce();

    expect(calls).toEqual([
      { prev: null, next: 3, inTx: true, swapped: null, rowVersion: 3 },
      { prev: 3, next: 4, inTx: true, swapped: expect.objectContaining({ config_version: 3 }), rowVersion: 4 },
    ]);
    const batches = h.published.map((events) => events.map((e) => e.event_type));
    expect(batches).toEqual([
      ['BranchConfigApplied', 'TestNooped'],
      ['BranchConfigApplied', 'TestNooped'],
    ]);
    const seqs = h.deps.db
      .prepare(`SELECT event_type, seq FROM events WHERE event_type IN ('BranchConfigApplied', 'TestNooped') ORDER BY seq`)
      .all() as Array<{ event_type: string; seq: number }>;
    expect(seqs.map((row) => row.event_type)).toEqual(['BranchConfigApplied', 'TestNooped', 'BranchConfigApplied', 'TestNooped']);

    // unsubscribe: the next apply runs no hook
    cleanups.pop()?.();
    cloud.respondWithSnapshot(aBranchConfigV1({ branch_id: BRANCH, config_version: 5 }));
    await configPoller(h.app).pollOnce();
    expect(calls).toHaveLength(2);
  });
});
