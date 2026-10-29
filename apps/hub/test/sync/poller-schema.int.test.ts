import { canonicalJson, sha256hex } from '@pos/domain/hash';
import { BranchConfigSnapshotSchemaV2 } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBranchConfig } from '../../src/projections/branch-config';
import { branchConfig } from '../../src/sync/branch-config-holder';
import type { ConfigFetch } from '../../src/sync/config-client';
import { configPoller } from '../../src/sync/config-poller';
import { stubConfigCloud, type StubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, type TestHub } from '../helpers/test-hub';

const BRANCH = 'branch-1';
const CONFIRMED = { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'key-1', confirmed_at: 1 };

function snapshot(version: number, o: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...aBranchConfig({ branch_id: BRANCH, config_version: version }), ...o };
}

// 01a §4.3: a schema-1 body (01a's item unit fields and group_label; no stock items, variant groups, modifier
// groups or deals), as a cloud not upgraded with the hub would send.
function schemaOneBody(version: number): Record<string, unknown> {
  const config = aBranchConfig({ branch_id: BRANCH, config_version: version });
  return {
    snapshot_schema_version: 1,
    config_version: config.config_version,
    branch_id: config.branch_id,
    currency_code: config.currency_code,
    tax_enabled: config.tax_enabled,
    day_stale_after_hours: config.day_stale_after_hours,
    day_min_gap_hours: config.day_min_gap_hours,
    floors: config.floors,
    stations: config.stations,
    tax_classes: config.tax_classes,
    categories: config.categories,
    items: config.items.map((item) => ({
      item_id: item.item_id,
      category_id: item.category_id,
      name: item.name,
      group_label: null,
      description: item.description,
      sort_order: item.sort_order,
      price_minor: item.price_minor,
      tax_class_id: item.tax_class_id,
      serve_mode: item.serve_mode,
      prep_buffer_ms: item.prep_buffer_ms,
      cook_time_ms: item.cook_time_ms,
      stock_time_ms: item.stock_time_ms,
      out_of_stock_behaviour: item.out_of_stock_behaviour,
      stock_unit: 'piece',
      sale_unit: item.sale_unit,
      stock_per_sale_unit: 1,
      low_stock_threshold: null,
      carries_over: false,
      availability_windows: item.availability_windows,
      station_id: item.station_id,
      program_id: item.program_id,
      stock_program_id: item.stock_program_id,
    })),
  };
}

describe('config poller: schema version and stored body', () => {
  const hubs: TestHub[] = [];
  afterEach(async () => {
    for (const h of hubs.splice(0)) await h.close();
  });
  async function hub(beforeCommit?: () => void): Promise<{ h: TestHub; cloud: StubConfigCloud }> {
    const cloud = stubConfigCloud();
    const h = await createTestHub({
      configClient: cloud,
      config: { provisioned: { ...CONFIRMED } },
      ...(beforeCommit !== undefined ? { testHooks: { beforeCommit } } : {}),
    });
    hubs.push(h);
    return { h, cloud };
  }
  const count = (h: TestHub, sql: string) => h.deps.db.prepare(sql).pluck().get() as number;

  it('[01a §10 #46] forced COMMIT failure during apply → branchConfig() unchanged, no snapshot row', async () => {
    let fail = false;
    const { h, cloud } = await hub(() => {
      if (fail) throw new Error('disk full');
    });
    cloud.respondWithSnapshot(snapshot(3));
    await configPoller(h.app).pollOnce();
    const old = branchConfig();
    expect(old?.config_version).toBe(3);
    const events = count(h, 'SELECT COUNT(*) FROM events');
    fail = true;
    cloud.respondWithSnapshot(snapshot(4));
    const result = await configPoller(h.app).pollOnce();
    expect(result.outcome).toBe('rejected');
    expect(branchConfig()).toBe(old);
    expect(count(h, 'SELECT COUNT(*) FROM config_snapshots')).toBe(1);
    expect(count(h, 'SELECT COUNT(*) FROM config_snapshots WHERE config_version = 4')).toBe(0);
    expect(count(h, 'SELECT COUNT(*) FROM events')).toBe(events);
    expect(count(h, 'SELECT config_version FROM branch_config')).toBe(3);
  });

  it('[01a §10 #94] unknown fields accepted: hash over the raw JSON, dropped from branchConfig(), kept in the stored body; restart parses the body to the same config', async () => {
    const { h, cloud } = await hub();
    const base = snapshot(3) as ReturnType<typeof aBranchConfig>;
    const raw = {
      ...base,
      promo: {},
      items: base.items.map((item, i) => (i === 0 ? { ...item, spice_level: 2 } : item)),
    };
    cloud.respondWithSnapshot(raw);
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('applied');
    const config = branchConfig() as Record<string, unknown> & { items: Array<Record<string, unknown>> };
    expect(config).not.toHaveProperty('promo');
    expect(config.items[0]).not.toHaveProperty('spice_level');
    const stored = h.deps.db.prepare('SELECT snapshot_hash, body FROM config_snapshots').get() as { snapshot_hash: string; body: string };
    const body = JSON.parse(stored.body) as { promo?: unknown; items: Array<{ spice_level?: number }> };
    expect(body.promo).toEqual({});
    expect(body.items[0]!.spice_level).toBe(2);
    expect(sha256hex(stored.body)).toBe(stored.snapshot_hash);
    expect(stored.snapshot_hash).toBe(sha256hex(canonicalJson(raw)));
    const loaded = loadBranchConfig(h.deps.db, BRANCH);
    expect(loaded.state).toBe('APPLIED');
    expect(loaded.state === 'APPLIED' ? loaded.entry.config : null).toEqual(branchConfig());
  });

  it('[01c #61] a hub on schema 2 receiving a schema-1 body → schema_unsupported, last config kept, nothing persisted', async () => {
    const { h, cloud } = await hub();
    cloud.respondWithSnapshot(snapshot(3));
    await configPoller(h.app).pollOnce();
    const old = branchConfig();
    const oldRow = h.deps.db.prepare('SELECT * FROM branch_config').get();
    const events = count(h, 'SELECT COUNT(*) FROM events');
    cloud.respondWithSnapshot(schemaOneBody(4));
    const result = await configPoller(h.app).pollOnce();
    expect(result).toMatchObject({ outcome: 'rejected', reason: 'schema_unsupported' });
    expect(configPoller(h.app).lastProblem()).toMatchObject({ outcome: 'rejected', reason: 'schema_unsupported' });
    expect(count(h, 'SELECT COUNT(*) FROM events')).toBe(events);
    expect(count(h, 'SELECT COUNT(*) FROM config_snapshots')).toBe(1);
    expect(h.deps.db.prepare('SELECT * FROM branch_config').get()).toEqual(oldRow);
    expect(branchConfig()).toBe(old);
    expect(branchConfig()?.config_version).toBe(3);
  });

  it('[01a S28 b] a branch_config row with version 1 → the poll sends config_version=0 and applies once', async () => {
    const { h, cloud } = await hub();
    const old = schemaOneBody(5);
    const oldHash = sha256hex(canonicalJson(old));
    h.deps.db
      .prepare('INSERT INTO config_snapshots (snapshot_hash, config_version, body, received_at) VALUES (?, ?, ?, ?)')
      .run(oldHash, 5, canonicalJson(old), 1);
    h.deps.writer.run((tx) =>
      tx.append([
        {
          stream_type: 'hub',
          stream_id: BRANCH,
          event_type: 'BranchConfigApplied',
          schema_version: 1,
          payload: { config_version: 5, snapshot_schema_version: 1, snapshot_hash: oldHash, previous_config_version: null },
          occurred_at: 1,
          actor_id: null,
          device_id: 'hub',
        },
      ]),
    );
    const current = snapshot(5);
    const respond: ConfigFetch = {
      kind: 'ok',
      text: JSON.stringify({ data: { config: { snapshot_hash: sha256hex(canonicalJson(current)), snapshot: current }, directory: null } }),
    };
    cloud.next = async (q) => (q.config_version === 0 ? respond : { kind: 'not_modified' });
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('applied');
    expect(cloud.calls[0]).toEqual({ config_version: 0, directory_version: 0 });
    expect(branchConfig()).toEqual(BranchConfigSnapshotSchemaV2.parse(current));
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('unchanged');
    expect(cloud.calls[1]).toEqual({ config_version: 5, directory_version: 0 });
    expect(count(h, `SELECT COUNT(*) FROM events WHERE event_type = 'BranchConfigApplied'`)).toBe(2);
  });
});
