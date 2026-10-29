import type { EventDraft } from '@pos/events';
import { aBranchConfigV1 } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, sha256hex } from '../../src/lib/hash';
import { loadBranchConfig, readBranchConfigRow } from '../../src/projections/branch-config';
import { itemAvailability } from '../../src/projections/item-availability';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, type TestHub } from '../helpers/test-hub';

const BRANCH = 'branch-1';

function configApplied(hash: string, version: number, schema = 1): EventDraft {
  return {
    stream_type: 'hub',
    stream_id: BRANCH,
    event_type: 'BranchConfigApplied',
    schema_version: 1,
    payload: { config_version: version, snapshot_schema_version: schema, snapshot_hash: hash, previous_config_version: null },
    occurred_at: 1,
    actor_id: null,
    device_id: 'hub',
  };
}

function availability(type: 'ItemMadeUnavailable' | 'ItemMadeAvailable', itemId: string): EventDraft {
  return {
    stream_type: 'stock',
    stream_id: itemId,
    event_type: type,
    schema_version: 1,
    payload: { item_id: itemId },
    occurred_at: 1,
    actor_id: 'S_MGR',
    device_id: 'hub-admin',
  };
}

function storeBody(h: TestHub, body: Record<string, unknown>): string {
  const text = canonicalJson(body);
  const hash = sha256hex(text);
  h.deps.db
    .prepare('INSERT INTO config_snapshots (snapshot_hash, config_version, body, received_at) VALUES (?, ?, ?, ?)')
    .run(hash, body.config_version, text, h.clock.branchNow());
  return hash;
}

describe('restaurant projections', () => {
  const hubs: TestHub[] = [];
  afterEach(async () => {
    for (const h of hubs.splice(0)) await h.close();
  });
  async function hub(): Promise<TestHub> {
    const h = await createTestHub();
    hubs.push(h);
    return h;
  }

  it('[01a §10 #49] UPDATE or DELETE on config_snapshots aborts (trigger)', async () => {
    const h = await hub();
    const hash = storeBody(h, aBranchConfigV1());
    expect(() => h.deps.db.prepare('UPDATE config_snapshots SET body = ? WHERE snapshot_hash = ?').run('{}', hash)).toThrow(
      /config snapshots are immutable/,
    );
    expect(() => h.deps.db.prepare('DELETE FROM config_snapshots WHERE snapshot_hash = ?').run(hash)).toThrow(
      /config snapshots are immutable/,
    );
    expect(h.deps.db.prepare('SELECT COUNT(*) FROM config_snapshots').pluck().get()).toBe(1);
  });

  it('[01a §5.1] projection times = recorded_at: live rows and a reset + replay at a later clock are identical', async () => {
    const h = await hub();
    const t1 = h.clock.branchNow();
    const { appended } = h.deps.writer.run((tx) =>
      tx.append([configApplied('a'.repeat(64), 3), availability('ItemMadeUnavailable', 'I1'), availability('ItemMadeUnavailable', 'I2')]),
    );
    h.clock.advance(5_000);
    h.deps.writer.run((tx) => tx.append([availability('ItemMadeAvailable', 'I2')]));
    const t2 = h.clock.branchNow();
    expect(appended[0]!.recorded_at).toBe(t1);
    const read = () => ({
      config: h.deps.db.prepare('SELECT * FROM branch_config').all(),
      availability: h.deps.db.prepare('SELECT * FROM item_availability ORDER BY item_id').all(),
    });
    const live = read();
    expect(live).toEqual({
      config: [{ branch_id: BRANCH, config_version: 3, snapshot_schema_version: 1, snapshot_hash: 'a'.repeat(64), applied_at: t1 }],
      availability: [
        { item_id: 'I1', is_available: 0, changed_at: t1, changed_by: 'S_MGR' },
        { item_id: 'I2', is_available: 1, changed_at: t2, changed_by: 'S_MGR' },
      ],
    });
    h.clock.advance(60_000);
    h.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection IN ('branch_config', 'item_availability')`).run();
    h.deps.db.prepare(`UPDATE branch_config SET applied_at = 0`).run();
    h.deps.projections.catchUp(h.deps.db, BRANCH);
    expect(read()).toEqual(live);
  });

  it('[01a S5] loadBranchConfig returns NONE, BODY_MISSING and APPLIED', async () => {
    const h = await hub();
    expect(loadBranchConfig(h.deps.db, BRANCH)).toEqual({ state: 'NONE' });
    expect(readBranchConfigRow(h.deps.db, BRANCH)).toBeUndefined();

    const config = aBranchConfigV1({ config_version: 4, branch_id: BRANCH });
    const missingHash = sha256hex(canonicalJson(config));
    h.deps.writer.run((tx) => tx.append([configApplied(missingHash, 4)]));
    const missing = loadBranchConfig(h.deps.db, BRANCH);
    expect(missing.state).toBe('BODY_MISSING');

    const hash = storeBody(h, config);
    expect(hash).toBe(missingHash);
    const counter = statementCounter(h.deps.db);
    const applied = loadBranchConfig(h.deps.db, BRANCH);
    expect(counter.count).toBe(2);
    const at = h.clock.branchNow();
    expect(applied).toEqual({
      state: 'APPLIED',
      row: { branch_id: BRANCH, config_version: 4, snapshot_schema_version: 1, snapshot_hash: hash, applied_at: at },
      entry: { config, snapshotHash: hash, configVersion: 4, snapshotSchemaVersion: 1, appliedAt: at },
    });

    h.deps.writer.run((tx) => tx.append([configApplied(hash, 5, 2)]));
    expect(loadBranchConfig(h.deps.db, BRANCH)).toMatchObject({ state: 'BODY_MISSING', row: { snapshot_schema_version: 2 } });

    const v2Body = { ...aBranchConfigV1({ branch_id: BRANCH }), config_version: 6, snapshot_schema_version: 2 };
    const v2Hash = storeBody(h, v2Body);
    h.deps.writer.run((tx) => tx.append([configApplied(v2Hash, 6)]));
    expect(loadBranchConfig(h.deps.db, BRANCH)).toMatchObject({ state: 'BODY_MISSING', row: { config_version: 6 } });
  });

  it('[01a §4.2] itemAvailability(db, []) → empty map, 0 statements; a missing row reads available', async () => {
    const h = await hub();
    h.deps.writer.run((tx) => tx.append([availability('ItemMadeUnavailable', 'I1')]));
    const counter = statementCounter(h.deps.db);
    expect(itemAvailability(h.deps.db, [])).toEqual(new Map());
    expect(counter.count).toBe(0);
    expect(itemAvailability(h.deps.db, ['I1', 'I2'])).toEqual(
      new Map([
        ['I1', false],
        ['I2', true],
      ]),
    );
    expect(counter.count).toBe(1);
  });
});
