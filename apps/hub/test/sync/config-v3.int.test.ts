import { canonicalJson, sha256hex } from '@pos/domain/hash';
import { BranchConfigSnapshotSchemaV3, SNAPSHOT_SCHEMA_VERSION } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBranchConfig } from '../../src/projections/branch-config';
import { branchConfig } from '../../src/sync/branch-config-holder';
import { configPoller } from '../../src/sync/config-poller';
import { stubConfigCloud, type StubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, type TestHub } from '../helpers/test-hub';

const BRANCH = 'branch-1';
const CONFIRMED = { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'key-1', confirmed_at: 1 };

function v3Body(version: number): Record<string, unknown> {
  return { ...aBranchConfig({ branch_id: BRANCH, config_version: version }) };
}

function omit<T extends object>(row: T, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
}

const STATION_ENGINE_KEYS = [
  'point_id',
  'policy',
  'freeze_ms',
  'min_slack_keep_ms',
  'promise_padding_ms',
  'pressure_window_ms',
  'pressure_amber_bp',
  'pressure_red_bp',
  'pressure_alert_ms',
  'pause_enabled',
  'lane_units',
  'reserve_units',
  'alternates',
  'carry_times',
];
const ITEM_KNOB_KEYS = ['weight_pct', 'max_early_ms', 'max_carry_ms', 'max_late_ms', 'adjust_time_ms'];

// The schema 2 wire: schema 3 without the engine fields, as a cloud on the old release would send.
function v2Body(version: number): Record<string, unknown> {
  const config = aBranchConfig({ branch_id: BRANCH, config_version: version });
  return {
    ...omit(config, ['points', 'engine_settings', 'goes_with']),
    snapshot_schema_version: 2,
    stations: config.stations.map((station) => omit(station, STATION_ENGINE_KEYS)),
    items: config.items.map((item) => omit(item, ITEM_KNOB_KEYS)),
  };
}

describe('hub config: snapshot schema 3 only (01a §4.3, S28 b)', () => {
  const hubs: TestHub[] = [];
  afterEach(async () => {
    for (const h of hubs.splice(0)) await h.close();
  });
  async function hub(): Promise<{ h: TestHub; cloud: StubConfigCloud }> {
    const cloud = stubConfigCloud();
    const h = await createTestHub({ configClient: cloud, config: { provisioned: { ...CONFIRMED } } });
    hubs.push(h);
    return { h, cloud };
  }
  const count = (h: TestHub, sql: string) => h.deps.db.prepare(sql).pluck().get() as number;
  const storeBody = (h: TestHub, body: Record<string, unknown>): string => {
    const hash = sha256hex(canonicalJson(body));
    h.deps.db
      .prepare('INSERT INTO config_snapshots (snapshot_hash, config_version, body, received_at) VALUES (?, ?, ?, ?)')
      .run(hash, body.config_version, canonicalJson(body), 1);
    return hash;
  };
  const appendApplied = (h: TestHub, hash: string, version: number, schema: number) =>
    h.deps.writer.run((tx) =>
      tx.append([
        {
          stream_type: 'hub',
          stream_id: BRANCH,
          event_type: 'BranchConfigApplied',
          schema_version: 1,
          payload: { config_version: version, snapshot_schema_version: schema, snapshot_hash: hash, previous_config_version: null },
          occurred_at: 1,
          actor_id: null,
          device_id: 'hub',
        },
      ]),
    );

  it('[01a §4.3 V3] SNAPSHOT_SCHEMA_VERSION is 3; a schema 3 body is applied with its engine fields, and restart parses the stored body to the same config', async () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(3);
    const { h, cloud } = await hub();
    const body = v3Body(3);
    cloud.respondWithSnapshot(body);
    expect(await configPoller(h.app).pollOnce()).toMatchObject({ outcome: 'applied', config_version: 3 });
    const config = branchConfig()!;
    expect(config).toEqual(BranchConfigSnapshotSchemaV3.parse(body));
    expect(config.snapshot_schema_version).toBe(3);
    expect(config.points).toEqual([{ point_id: 'P1', name: 'Pass', sort_order: 0, is_archived: false }]);
    expect(config.stations[0]).toMatchObject({ point_id: 'P1', policy: 'waada_guard', alternates: [], carry_times: [] });
    expect(config.items[0]).toMatchObject({ weight_pct: 100, adjust_time_ms: 180_000 });
    expect(config.engine_settings).toMatchObject({ returns_boost: true, table_lock_ttl_ms: 600_000 });
    expect(config.goes_with).toEqual([]);
    expect(h.deps.db.prepare('SELECT config_version, snapshot_schema_version FROM branch_config').get()).toEqual({
      config_version: 3,
      snapshot_schema_version: 3,
    });
    const loaded = loadBranchConfig(h.deps.db, BRANCH);
    expect(loaded.state).toBe('APPLIED');
    expect(loaded.state === 'APPLIED' ? loaded.entry.config : null).toEqual(config);
  });

  it('[01a §4.3 V3] a schema 3 body missing an engine field → schema_invalid, nothing applied', async () => {
    const { h, cloud } = await hub();
    cloud.respondWithSnapshot(omit(v3Body(3), ['engine_settings']));
    expect(await configPoller(h.app).pollOnce()).toMatchObject({ outcome: 'rejected', reason: 'schema_invalid' });
    expect(branchConfig()).toBeNull();
  });

  it('[01a S28 b] a schema 2 body → schema_unsupported, logged, nothing appended, last config kept; the next poll asks again and applies the upgraded cloud', async () => {
    const { h, cloud } = await hub();
    cloud.respondWithSnapshot(v3Body(3));
    await configPoller(h.app).pollOnce();
    const old = branchConfig();
    const oldRow = h.deps.db.prepare('SELECT * FROM branch_config').get();
    const events = count(h, 'SELECT COUNT(*) FROM events');

    cloud.respondWithSnapshot(v2Body(4));
    const result = await configPoller(h.app).pollOnce();
    expect(result).toMatchObject({ outcome: 'rejected', reason: 'schema_unsupported' });
    expect(configPoller(h.app).lastProblem()).toMatchObject({ outcome: 'rejected', reason: 'schema_unsupported' });
    const logged = h
      .logs()
      .split('\n')
      .filter((line) => line.includes('config poll'))
      .map((line) => JSON.parse(line) as { level: number; reason?: string });
    expect(logged.at(-1)).toMatchObject({ level: 50, reason: 'schema_unsupported' });
    expect(branchConfig()).toBe(old);
    expect(count(h, 'SELECT COUNT(*) FROM events')).toBe(events);
    expect(count(h, 'SELECT COUNT(*) FROM config_snapshots')).toBe(1);
    expect(h.deps.db.prepare('SELECT * FROM branch_config').get()).toEqual(oldRow);

    // Polls again, with the version it still holds.
    cloud.respondWithSnapshot(v3Body(4));
    expect(await configPoller(h.app).pollOnce()).toMatchObject({ outcome: 'applied', config_version: 4 });
    expect(cloud.calls.at(-1)).toMatchObject({ config_version: 3 });
    expect(branchConfig()?.config_version).toBe(4);
    expect(configPoller(h.app).lastProblem()).toBeNull();
  });

  it('[01a S28 b] a stored body of schema 2 is BODY_MISSING, by its row or by the body alone; the poll sends config_version 0 and applies schema 3 once', async () => {
    const { h, cloud } = await hub();
    // The row and the body both say 2: what a hub upgraded from schema 2 holds.
    const hash = storeBody(h, v2Body(5));
    appendApplied(h, hash, 5, 2);
    expect(loadBranchConfig(h.deps.db, BRANCH)).toMatchObject({ state: 'BODY_MISSING', row: { snapshot_schema_version: 2 } });

    // The row says 3 but the body says 2.
    appendApplied(h, hash, 5, 3);
    expect(loadBranchConfig(h.deps.db, BRANCH)).toMatchObject({ state: 'BODY_MISSING', row: { snapshot_schema_version: 3 } });

    appendApplied(h, hash, 5, 2);
    cloud.respondWithSnapshot(v3Body(5));
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('applied');
    expect(cloud.calls[0]).toMatchObject({ config_version: 0 });
    expect(branchConfig()?.snapshot_schema_version).toBe(3);
    expect(loadBranchConfig(h.deps.db, BRANCH).state).toBe('APPLIED');
  });
});
