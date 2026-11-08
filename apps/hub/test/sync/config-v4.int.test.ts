import { canonicalJson, sha256hex } from '@pos/domain/hash';
import { BranchConfigSnapshotSchemaV4, SNAPSHOT_SCHEMA_VERSION } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBranchConfig } from '../../src/projections/branch-config';
import { branchConfig } from '../../src/sync/branch-config-holder';
import { configPoller } from '../../src/sync/config-poller';
import { stubConfigCloud, type StubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, type TestHub } from '../helpers/test-hub';

const BRANCH = 'branch-1';
const CONFIRMED = { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'key-1', confirmed_at: 1 };

// 01a §4.3 V4 (02a A-1, 02b A-1): a floor with an active zone (lists filled) and an archived one (AD-11), a table in the
// zone and one without, a ready item.
const FLOORS = [
  {
    floor_id: 'F1',
    name: 'Ground',
    sort_order: 1,
    zones: [
      {
        zone_id: 'Z1',
        name: 'Patio',
        sort_order: 1,
        is_archived: false,
        routes: [{ item_id: 'I1', station_id: 'S1' }],
        stock_items: [{ item_id: 'I2', threshold: 3 }],
      },
      { zone_id: 'Z2', name: 'Old hall', sort_order: 2, is_archived: true, routes: [], stock_items: [] },
    ],
    tables: [
      { table_id: 'T1', name: 'T1', seats: 4, sort_order: 1, zone_id: 'Z1' },
      { table_id: 'T2', name: 'T2', seats: null, sort_order: 2, zone_id: null },
    ],
  },
];
const V4_SETTING_KEYS = ['queue_auto_send_max_ms', 'zone_undo_ms', 'slow_item_threshold_ms', 'served_estimate_ms', 'comp_reason_chips'];

function v4Body(version: number): Record<string, unknown> {
  const config = aBranchConfig({ branch_id: BRANCH, config_version: version, floors: FLOORS });
  return { ...config, items: config.items.map((item) => (item.item_id === 'I2' ? { ...item, is_ready_item: true } : item)) };
}

function omit<T extends object>(row: T, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
}

// The schema 3 wire: schema 4 without the zone, ready-item and 02b settings fields, as a cloud on the old release sends.
function v3Body(version: number): Record<string, unknown> {
  const config = aBranchConfig({ branch_id: BRANCH, config_version: version, floors: FLOORS });
  return {
    ...config,
    snapshot_schema_version: 3,
    floors: config.floors.map((floor) => ({ ...omit(floor, ['zones']), tables: floor.tables.map((table) => omit(table, ['zone_id'])) })),
    items: config.items.map((item) => omit(item, ['is_ready_item'])),
    engine_settings: omit(config.engine_settings, V4_SETTING_KEYS),
  };
}

describe('hub config: snapshot schema 4 only (01a §4.3, S28 b)', () => {
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

  it('[01a §4.3 V4] SNAPSHOT_SCHEMA_VERSION is 4; a schema 4 body is applied with its zone fields, and restart parses the stored body to the same config', async () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(4);
    const { h, cloud } = await hub();
    const body = v4Body(3);
    cloud.respondWithSnapshot(body);
    expect(await configPoller(h.app).pollOnce()).toMatchObject({ outcome: 'applied', config_version: 3 });
    const config = branchConfig()!;
    expect(config).toEqual(BranchConfigSnapshotSchemaV4.parse(body));
    expect(config.snapshot_schema_version).toBe(4);
    expect(h.deps.db.prepare('SELECT config_version, snapshot_schema_version FROM branch_config').get()).toEqual({
      config_version: 3,
      snapshot_schema_version: 4,
    });
    const loaded = loadBranchConfig(h.deps.db, BRANCH);
    expect(loaded.state).toBe('APPLIED');
    expect(loaded.state === 'APPLIED' ? loaded.entry.config : null).toEqual(config);
  });

  it('[01a #192] Snapshot V4 carries `zones[].routes[]`, `zones[].stock_items[]`, `items[].is_ready_item` (hub: in branchConfig())', async () => {
    const { h, cloud } = await hub();
    cloud.respondWithSnapshot(v4Body(3));
    await configPoller(h.app).pollOnce();
    const config = branchConfig()!;
    expect(config.floors[0]!.zones).toEqual(FLOORS[0]!.zones);
    expect(config.floors[0]!.tables.map((table) => table.zone_id)).toEqual(['Z1', null]);
    expect(config.items.map((item) => [item.item_id, item.is_ready_item])).toEqual([
      ['I1', false],
      ['I2', true],
      ['I3', false],
    ]);
  });

  it('[01a #193] Settings: `queue_auto_send_max_ms`, `zone_undo_ms`, `slow_item_threshold_ms`, `comp_reason_chips` … delivered (hub: the defaults in branchConfig().engine_settings, AD-10)', async () => {
    const { h, cloud } = await hub();
    cloud.respondWithSnapshot(v4Body(3));
    await configPoller(h.app).pollOnce();
    expect(branchConfig()!.engine_settings).toMatchObject({
      queue_auto_send_max_ms: 14_400_000,
      zone_undo_ms: 300_000,
      slow_item_threshold_ms: 900_000,
      served_estimate_ms: null,
      comp_reason_chips: ['Late', 'Wrong item', 'Quality', 'Guest', 'Other'],
    });
  });

  it('[01a §4.3 V4] a schema 4 body missing a V4 field → schema_invalid, nothing applied', async () => {
    for (const body of [
      { ...v4Body(3), floors: [omit(FLOORS[0]!, ['zones'])] },
      { ...v4Body(3), engine_settings: omit(aBranchConfig().engine_settings, ['zone_undo_ms']) },
    ]) {
      const { h, cloud } = await hub();
      cloud.respondWithSnapshot(body);
      expect(await configPoller(h.app).pollOnce()).toMatchObject({ outcome: 'rejected', reason: 'schema_invalid' });
      expect(branchConfig()).toBeNull();
    }
  });

  it('[01a S28 b] a schema 3 body → schema_unsupported, logged, nothing appended, last config kept; the next poll asks again and applies the upgraded cloud', async () => {
    const { h, cloud } = await hub();
    cloud.respondWithSnapshot(v4Body(3));
    await configPoller(h.app).pollOnce();
    const old = branchConfig();
    const oldRow = h.deps.db.prepare('SELECT * FROM branch_config').get();
    const events = count(h, 'SELECT COUNT(*) FROM events');

    cloud.respondWithSnapshot(v3Body(4));
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
    cloud.respondWithSnapshot(v4Body(4));
    expect(await configPoller(h.app).pollOnce()).toMatchObject({ outcome: 'applied', config_version: 4 });
    expect(cloud.calls.at(-1)).toMatchObject({ config_version: 3 });
    expect(branchConfig()?.config_version).toBe(4);
    expect(configPoller(h.app).lastProblem()).toBeNull();
  });

  it('[01a #188] Hub with snapshot 3 stored, cloud on 4 → body treated as missing, full snapshot applied (S28 b)', async () => {
    const { h, cloud } = await hub();
    // The row and the body both say 3: what a hub upgraded from schema 3 holds.
    const hash = storeBody(h, v3Body(5));
    appendApplied(h, hash, 5, 3);
    expect(loadBranchConfig(h.deps.db, BRANCH)).toMatchObject({ state: 'BODY_MISSING', row: { snapshot_schema_version: 3 } });

    // The row says 4 but the body says 3.
    appendApplied(h, hash, 5, 4);
    expect(loadBranchConfig(h.deps.db, BRANCH)).toMatchObject({ state: 'BODY_MISSING', row: { snapshot_schema_version: 4 } });

    appendApplied(h, hash, 5, 3);
    const full = v4Body(5);
    cloud.respondWithSnapshot(full);
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('applied');
    expect(cloud.calls[0]).toMatchObject({ config_version: 0 });
    expect(branchConfig()).toEqual(BranchConfigSnapshotSchemaV4.parse(full));
    expect(branchConfig()?.snapshot_schema_version).toBe(4);
    expect(loadBranchConfig(h.deps.db, BRANCH).state).toBe('APPLIED');
  });
});
