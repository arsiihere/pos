import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { currentDirectory, swapDirectory } from '../../src/auth/guards';
import { branchConfig, onBranchConfigApplied } from '../../src/sync/branch-config-holder';
import { configPoller, createConfigPoller, type ConfigPoller } from '../../src/sync/config-poller';
import { aDirectory } from '../helpers/fixtures';
import { stubConfigCloud, type StubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, type TestHub } from '../helpers/test-hub';

const BRANCH = 'branch-1';
const CONFIRMED = { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'key-1', confirmed_at: 1 };

function snapshot(version: number): Record<string, unknown> {
  return aBranchConfig({ branch_id: BRANCH, config_version: version });
}

describe('config poller: apply failure (S43)', () => {
  const cleanups: Array<() => unknown> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });
  async function hub(): Promise<{ h: TestHub; cloud: StubConfigCloud }> {
    const cloud = stubConfigCloud();
    const h = await createTestHub({ configClient: cloud, config: { provisioned: { ...CONFIRMED } } });
    cleanups.push(() => h.close());
    return { h, cloud };
  }
  const count = (h: TestHub, sql: string) => h.deps.db.prepare(sql).pluck().get() as number;
  const batches = (h: TestHub) => h.published.map((events) => events.map((e) => e.event_type).sort());
  const directoryVersion = (h: TestHub) => count(h, 'SELECT COALESCE(MAX(directory_version), 0) FROM staff_directory_meta');
  function throwingHook(state: { fail: boolean }): void {
    cleanups.push(
      onBranchConfigApplied(() => {
        if (state.fail) throw new Error('hook refused config');
      }),
    );
  }

  it('[01a §10 #50] config and directory in one transaction; a failing part leaves the other applied alone', async () => {
    // both parts in one transaction
    const { h, cloud } = await hub();
    cloud.respondWithSnapshot(snapshot(3), { directory: await aDirectory({ directory_version: 2 }) });
    expect(await configPoller(h.app).pollOnce()).toMatchObject({ outcome: 'applied', config_version: 3, directory_version: 2 });
    expect(batches(h)).toEqual([['BranchConfigApplied', 'StaffDirectoryApplied']]);

    // forced failure in the config part → the directory applied alone, the config not applied
    const hook = { fail: true };
    throwingHook(hook);
    cloud.respondWithSnapshot(snapshot(4), { directory: await aDirectory({ directory_version: 3 }) });
    const failed = await configPoller(h.app).pollOnce();
    expect(failed).toMatchObject({ outcome: 'rejected', reason: 'apply_failed' });
    expect(configPoller(h.app).lastProblem()).toEqual({ outcome: 'rejected', reason: 'apply_failed', at: h.clock.branchNow() });
    expect(batches(h).slice(1)).toEqual([['StaffDirectoryApplied']]);
    expect(directoryVersion(h)).toBe(3);
    expect(branchConfig()?.config_version).toBe(3);
    expect(count(h, 'SELECT config_version FROM branch_config')).toBe(3);
    expect(count(h, 'SELECT COUNT(*) FROM config_snapshots WHERE config_version = 4')).toBe(0);

    // forced failure in the directory part → the config applied alone, the directory not applied
    hook.fail = false;
    const { h: h2, cloud: cloud2 } = await hub();
    const poller: ConfigPoller = createConfigPoller({
      config: h2.deps.config,
      db: h2.deps.db,
      writer: h2.deps.writer,
      clock: h2.deps.clock,
      client: cloud2,
      setDirectory: (d) => {
        swapDirectory(h2.app, d);
      },
      log: h2.app.log,
      applyDirectory: () => {
        throw new Error('directory row refused');
      },
    });
    cloud2.respondWithSnapshot(snapshot(5), { directory: await aDirectory({ directory_version: 2 }) });
    const second = await poller.pollOnce();
    expect(second).toMatchObject({ outcome: 'rejected', reason: 'apply_failed', config_version: 5, directory_version: 0 });
    expect(batches(h2)).toEqual([['BranchConfigApplied']]);
    expect(branchConfig()?.config_version).toBe(5);
    expect(count(h2, 'SELECT config_version FROM branch_config')).toBe(5);
    expect(directoryVersion(h2)).toBe(0);
    expect(poller.lastProblem()).toMatchObject({ outcome: 'rejected', reason: 'apply_failed' });
  });

  it('[01a §10 #115] a throwing onBranchConfigApplied hook → nothing from the config commits, the problem is visible, the directory applies alone, the retry applies once the hook stops throwing', async () => {
    const { h, cloud } = await hub();
    cloud.respondWithSnapshot(snapshot(3));
    await configPoller(h.app).pollOnce();
    const old = branchConfig();
    expect(old?.config_version).toBe(3);

    const hook = { fail: true };
    cleanups.push(
      onBranchConfigApplied((_prev, next, tx) => {
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
        if (hook.fail) throw new Error('hook refused config');
      }),
    );
    const applied = () => count(h, `SELECT COUNT(*) FROM events WHERE event_type = 'BranchConfigApplied'`);
    const nooped = () => count(h, `SELECT COUNT(*) FROM events WHERE event_type = 'TestNooped'`);
    const directory = await aDirectory({ directory_version: 2 });
    cloud.respondWithSnapshot(snapshot(4), { directory });
    const result = await configPoller(h.app).pollOnce();

    expect(result).toMatchObject({ outcome: 'rejected', reason: 'apply_failed' });
    expect(applied()).toBe(1);
    expect(nooped()).toBe(0);
    expect(branchConfig()).toBe(old);
    expect(configPoller(h.app).lastProblem()).toEqual({ outcome: 'rejected', reason: 'apply_failed', at: h.clock.branchNow() });
    // the directory in the same response is applied alone
    expect(directoryVersion(h)).toBe(2);
    expect(currentDirectory(h.app).ttlFor('S_MGR')).toBe(3_600_000);
    // logged at error with the message, never the body or the directory
    const lines = h
      .logs()
      .split('\n')
      .filter((line) => line.includes('hook refused config'))
      .map((line) => JSON.parse(line) as { level: number });
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.level).toBe(50);
    expect(h.logs()).not.toContain('$argon2id$');
    expect(h.logs()).not.toContain('"items"');
    expect(h.logs()).not.toContain(String((snapshot(4) as { items: Array<{ name: string }> }).items[0]!.name));

    // the next poll retries the config (the directory is current) and still fails
    cloud.respondWithSnapshot(snapshot(4), { directory });
    expect(await configPoller(h.app).pollOnce()).toMatchObject({ outcome: 'rejected', reason: 'apply_failed' });
    expect(cloud.calls.at(-1)).toEqual({ config_version: 3, directory_version: 2 });
    expect(applied()).toBe(1);

    // once the hook stops throwing the config applies and last_problem clears
    hook.fail = false;
    expect(await configPoller(h.app).pollOnce()).toMatchObject({ outcome: 'applied', config_version: 4 });
    expect(applied()).toBe(2);
    expect(nooped()).toBe(1);
    expect(branchConfig()?.config_version).toBe(4);
    expect(configPoller(h.app).lastProblem()).toBeNull();
  });
});
