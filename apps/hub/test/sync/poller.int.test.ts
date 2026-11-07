import { canonicalJson, sha256hex } from '@pos/domain/hash';
import { BranchConfigSnapshotSchemaV3 } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { currentDirectory } from '../../src/auth/guards';
import { branchConfig } from '../../src/sync/branch-config-holder';
import type { ConfigFetch } from '../../src/sync/config-client';
import { configPoller } from '../../src/sync/config-poller';
import { aDirectory } from '../helpers/fixtures';
import { stubConfigCloud, type StubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, type TestHub } from '../helpers/test-hub';

const BRANCH = 'branch-1';
const CONFIRMED = { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'key-1', confirmed_at: 1 };

function snapshot(version: number, o: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...aBranchConfig({ branch_id: BRANCH, config_version: version }), ...o };
}

function okText(config: { snapshot_hash: string; snapshot: unknown } | null, directory: unknown = null): ConfigFetch {
  return { kind: 'ok', text: JSON.stringify({ data: { config, directory } }) };
}

describe('config poller', () => {
  const hubs: TestHub[] = [];
  afterEach(async () => {
    for (const h of hubs.splice(0)) await h.close();
  });
  async function hub(o: { confirmed?: boolean; beforeCommit?: () => void } = {}): Promise<{ h: TestHub; cloud: StubConfigCloud }> {
    const cloud = stubConfigCloud();
    const h = await createTestHub({
      configClient: cloud,
      ...(o.confirmed === false ? {} : { config: { provisioned: { ...CONFIRMED } } }),
      ...(o.beforeCommit !== undefined ? { testHooks: { beforeCommit: o.beforeCommit } } : {}),
    });
    hubs.push(h);
    return { h, cloud };
  }
  const count = (h: TestHub, sql: string) => h.deps.db.prepare(sql).pluck().get() as number;
  const eventCount = (h: TestHub) => count(h, 'SELECT COUNT(*) FROM events');
  const writes = (h: TestHub) => ({
    events: eventCount(h),
    snapshots: count(h, 'SELECT COUNT(*) FROM config_snapshots'),
    rows: h.deps.db.prepare('SELECT * FROM branch_config').all(),
  });

  it('[01a §10 #42] poll 200 with config → one BranchConfigApplied, body in config_snapshots, branch_config row, branchConfig() swapped after COMMIT', async () => {
    let insideTx: unknown = 'not reached';
    const { h, cloud } = await hub({
      beforeCommit: () => {
        insideTx = branchConfig();
      },
    });
    const raw = snapshot(3);
    const directory = await aDirectory({ directory_version: 2 });
    cloud.respondWithSnapshot(raw, { directory });
    expect(branchConfig()).toBeNull();
    const result = await configPoller(h.app).pollOnce();
    expect(result).toMatchObject({ outcome: 'applied', config_version: 3, directory_version: 2 });
    expect(cloud.calls).toEqual([{ config_version: 0, directory_version: 0 }]);
    expect(insideTx).toBeNull();
    const hash = sha256hex(canonicalJson(raw));
    const applied = h.deps.db
      .prepare(`SELECT payload, actor_id, device_id, recorded_at FROM events WHERE event_type = 'BranchConfigApplied'`)
      .all() as Array<{ payload: string; actor_id: string | null; device_id: string; recorded_at: number }>;
    expect(applied).toHaveLength(1);
    expect(JSON.parse(applied[0]!.payload)).toEqual({
      config_version: 3,
      snapshot_schema_version: 3,
      snapshot_hash: hash,
      previous_config_version: null,
    });
    expect(applied[0]).toMatchObject({ actor_id: null, device_id: 'hub' });
    expect(h.deps.db.prepare('SELECT snapshot_hash, config_version, body FROM config_snapshots').all()).toEqual([
      { snapshot_hash: hash, config_version: 3, body: canonicalJson(raw) },
    ]);
    expect(h.deps.db.prepare('SELECT * FROM branch_config').all()).toEqual([
      { branch_id: BRANCH, config_version: 3, snapshot_schema_version: 3, snapshot_hash: hash, applied_at: applied[0]!.recorded_at },
    ]);
    expect(branchConfig()).toEqual(BranchConfigSnapshotSchemaV3.parse(raw));
    // the directory part rides the same transaction (S6): one published batch holds both events
    const batch = h.published.find((events) => events.some((e) => e.event_type === 'BranchConfigApplied'));
    expect(batch?.map((e) => e.event_type).sort()).toEqual(['BranchConfigApplied', 'StaffDirectoryApplied']);
    expect(currentDirectory(h.app).ttlFor('S_MGR')).toBe(3_600_000);
    expect(configPoller(h.app).lastPoll()).toEqual({ outcome: 'applied', at: h.clock.branchNow() });
    expect(configPoller(h.app).lastProblem()).toBeNull();

    cloud.respondWithSnapshot(snapshot(4));
    await configPoller(h.app).pollOnce();
    expect(cloud.calls[1]).toEqual({ config_version: 3, directory_version: 2 });
    const second = h.deps.db
      .prepare(`SELECT payload FROM events WHERE event_type = 'BranchConfigApplied' ORDER BY seq DESC LIMIT 1`)
      .pluck()
      .get() as string;
    expect(JSON.parse(second).previous_config_version).toBe(3);
  });

  it('[01a §10 #43] poll 304 → no event, no write, outcome unchanged', async () => {
    const { h, cloud } = await hub();
    cloud.next = { kind: 'not_modified' };
    const before = writes(h);
    const result = await configPoller(h.app).pollOnce();
    expect(result.outcome).toBe('unchanged');
    expect(writes(h)).toEqual(before);
    expect(configPoller(h.app).lastPoll()?.outcome).toBe('unchanged');
  });

  it('[01a §10 #44] snapshot hash mismatch → nothing written, last_problem { rejected, hash_mismatch }, old config kept', async () => {
    const { h, cloud } = await hub();
    cloud.respondWithSnapshot(snapshot(3));
    await configPoller(h.app).pollOnce();
    const old = branchConfig();
    const before = writes(h);
    cloud.respondWithSnapshot(snapshot(4), { snapshotHash: 'f'.repeat(64) });
    const result = await configPoller(h.app).pollOnce();
    expect(result.outcome).toBe('rejected');
    expect(writes(h)).toEqual(before);
    expect(configPoller(h.app).lastProblem()).toEqual({ outcome: 'rejected', reason: 'hash_mismatch', at: h.clock.branchNow() });
    expect(branchConfig()).toBe(old);
    cloud.next = { kind: 'not_modified' };
    await configPoller(h.app).pollOnce();
    expect(configPoller(h.app).lastProblem()).toBeNull();
  });

  it('[01a §10 #45] config_version ≤ current → config part ignored (forward only)', async () => {
    const { h, cloud } = await hub();
    cloud.respondWithSnapshot(snapshot(3));
    await configPoller(h.app).pollOnce();
    const old = branchConfig();
    for (const version of [3, 2]) {
      const before = writes(h);
      cloud.respondWithSnapshot(snapshot(version, { currency_code: 'USD' }));
      const result = await configPoller(h.app).pollOnce();
      expect(result.outcome).toBe('unchanged');
      expect(writes(h)).toEqual(before);
      expect(branchConfig()).toBe(old);
    }
    expect(cloud.calls.slice(1)).toEqual([
      { config_version: 3, directory_version: 0 },
      { config_version: 3, directory_version: 0 },
    ]);
    expect(configPoller(h.app).lastProblem()).toBeNull();
  });

  it('[01a §10 #53] network error / cloud 401 → outcome offline / last_problem.outcome unauthorized, nothing written, next tick retries', async () => {
    const { h, cloud } = await hub();
    const before = writes(h);
    cloud.next = { kind: 'offline' };
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('offline');
    expect(configPoller(h.app).lastProblem()).toBeNull();
    cloud.next = { kind: 'error', status: 401, code: 'UNAUTHENTICATED', details: {} };
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('unauthorized');
    expect(configPoller(h.app).lastProblem()).toMatchObject({ outcome: 'unauthorized', at: h.clock.branchNow() });
    expect(writes(h)).toEqual(before);
    cloud.respondWithSnapshot(snapshot(3));
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('applied');
    expect(cloud.calls).toHaveLength(3);
    expect(configPoller(h.app).lastProblem()).toBeNull();
  });

  it('[01a §10 #54] two concurrent pollOnce() → one HTTP request; both callers get its result', async () => {
    const { h, cloud } = await hub();
    let release: (value: ConfigFetch) => void = () => undefined;
    cloud.next = () =>
      new Promise<ConfigFetch>((resolve) => {
        release = resolve;
      });
    const poller = configPoller(h.app);
    const first = poller.pollOnce();
    const second = poller.pollOnce();
    await Promise.resolve();
    release({ kind: 'not_modified' });
    const [a, b] = await Promise.all([first, second]);
    expect(cloud.calls).toHaveLength(1);
    expect(a).toBe(b);
    expect(a.outcome).toBe('unchanged');
    cloud.next = { kind: 'not_modified' };
    await poller.pollOnce();
    expect(cloud.calls).toHaveLength(2);
  });

  it('[01a §10 #95] hash before parse: a raw hash mismatch whose Zod-stripped form would match is rejected (hash_mismatch)', async () => {
    const { h, cloud } = await hub();
    const raw = snapshot(3, { promo: {} });
    const strippedHash = sha256hex(canonicalJson(BranchConfigSnapshotSchemaV3.parse(raw)));
    expect(strippedHash).not.toBe(sha256hex(canonicalJson(raw)));
    cloud.next = okText({ snapshot_hash: strippedHash, snapshot: raw });
    const before = writes(h);
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('rejected');
    expect(configPoller(h.app).lastProblem()).toMatchObject({ outcome: 'rejected', reason: 'hash_mismatch' });
    expect(writes(h)).toEqual(before);
    expect(branchConfig()).toBeNull();
  });

  it('[01a §10 #126] a 200 whose envelope fails Zod → last_problem { rejected, malformed }; logs carry the issue path, no pin_hash value, no $argon2id$', async () => {
    const { h, cloud } = await hub();
    const valid = await aDirectory({ directory_version: 2 });
    // A deliberately invalid directory (pin_hash a number): plain records, passed where okText takes unknown.
    const directory = { ...valid, staff: valid.staff.map((staff): Record<string, unknown> => ({ ...staff })) };
    directory.staff[0]!.pin_hash = 918273645;
    expect(String(directory.staff[1]!.pin_hash)).toContain('$argon2id$');
    const raw = snapshot(3);
    cloud.next = okText({ snapshot_hash: sha256hex(canonicalJson(raw)), snapshot: raw }, directory);
    const before = writes(h);
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('rejected');
    expect(configPoller(h.app).lastProblem()).toMatchObject({ outcome: 'rejected', reason: 'malformed' });
    expect(writes(h)).toEqual(before);
    cloud.next = { kind: 'ok', text: '{"data":' };
    await configPoller(h.app).pollOnce();
    expect(configPoller(h.app).lastProblem()).toMatchObject({ outcome: 'rejected', reason: 'malformed' });
    const logs = h.logs();
    expect(logs).toContain('data.directory.staff.0.pin_hash');
    expect(logs).not.toContain('918273645');
    expect(logs).not.toContain('$argon2id$');
    expect(logs).not.toContain('Chicken Karahi');
  });

  it('[01a §3.4, S40 N4] an unconfirmed hub makes no HTTP call and records not_ready', async () => {
    const { h, cloud } = await hub({ confirmed: false });
    cloud.respondWithSnapshot(snapshot(3));
    const result = await configPoller(h.app).pollOnce();
    expect(result.outcome).toBe('not_ready');
    expect(cloud.calls).toEqual([]);
    expect(configPoller(h.app).lastPoll()).toEqual({ outcome: 'not_ready', at: h.clock.branchNow() });
    expect(eventCount(h)).toBe(0);
  });

  it('[01a S42] versions far above the hub\'s (after restore-bump) are applied', async () => {
    const { h, cloud } = await hub();
    cloud.respondWithSnapshot(snapshot(40), { directory: await aDirectory({ directory_version: 30 }) });
    await configPoller(h.app).pollOnce();
    const now = 1_761_000_000_000;
    cloud.respondWithSnapshot(snapshot(now), { directory: await aDirectory({ directory_version: now }) });
    const result = await configPoller(h.app).pollOnce();
    expect(result).toMatchObject({ outcome: 'applied', config_version: now, directory_version: now });
    expect(branchConfig()?.config_version).toBe(now);
    expect(h.deps.db.prepare('SELECT directory_version FROM staff_directory_meta').pluck().get()).toBe(now);
  });

  it('[01a §7.3] log levels and no snapshot body in the logs', async () => {
    const { h, cloud } = await hub();
    const lines = () =>
      h
        .logs()
        .split('\n')
        .filter((line) => line.includes('config poll'))
        .map((line) => JSON.parse(line) as { level: number; outcome: string; reason?: string });
    cloud.respondWithSnapshot(snapshot(3), { directory: await aDirectory({ directory_version: 2 }) });
    await configPoller(h.app).pollOnce();
    cloud.next = { kind: 'not_modified' };
    await configPoller(h.app).pollOnce();
    cloud.next = { kind: 'offline' };
    await configPoller(h.app).pollOnce();
    cloud.respondWithSnapshot(snapshot(4), { snapshotHash: 'f'.repeat(64) });
    await configPoller(h.app).pollOnce();
    cloud.next = { kind: 'error', status: 401, code: 'UNAUTHENTICATED', details: {} };
    await configPoller(h.app).pollOnce();
    expect(lines().map((line) => [line.outcome, line.level])).toEqual([
      ['applied', 30],
      ['offline', 30],
      ['rejected', 50],
      ['unauthorized', 50],
    ]);
    // a rejected config part beside a newer directory part is still logged at error
    const seen = lines().length;
    cloud.respondWithSnapshot(snapshot(5), { snapshotHash: 'f'.repeat(64), directory: await aDirectory({ directory_version: 3 }) });
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('applied');
    expect(lines().slice(seen).map((line) => [line.outcome, line.level, line.reason])).toEqual([
      ['rejected', 50, 'hash_mismatch'],
      ['applied', 30, undefined],
    ]);
    const logs = h.logs();
    expect(logs).not.toContain('Chicken Karahi');
    expect(logs).not.toContain('$argon2id$');
    expect(logs).not.toContain('Karahi');
  });

  it('[01a §12.4] a 1 001-item snapshot logs one warn', async () => {
    const { h, cloud } = await hub();
    const base = aBranchConfig({ branch_id: BRANCH, config_version: 3 });
    const template = base.items[1]!;
    const items = Array.from({ length: 1_001 }, (_, i) => ({ ...template, item_id: `IT-${i}`, name: `Item ${i}`, sort_order: i }));
    cloud.respondWithSnapshot({ ...base, items });
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('applied');
    const warns = () =>
      h
        .logs()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as { level: number; items?: number })
        .filter((line) => line.level === 40);
    expect(warns()).toEqual([expect.objectContaining({ level: 40, items: 1_001 })]);
    cloud.respondWithSnapshot({ ...base, items: items.slice(0, 1_000), config_version: 4 });
    await configPoller(h.app).pollOnce();
    expect(warns()).toHaveLength(1);
  });
});
