import { BranchConfigSnapshotSchemaV4 } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgCounter } from '../helpers/pg-counter';
import { restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;

// 01a v2.1 §5.2a A-12: defaults and ranges, written out here so a change to either fails.
const DEFAULTS = {
  weight_dine_in_pct: 100,
  weight_takeaway_pct: 200,
  weight_delivery_pct: 200,
  weight_parking_pct: 200,
  weight_follow_up_pct: 300,
  promise_padding_dine_in_ms: 180_000,
  promise_padding_takeaway_ms: 180_000,
  promise_padding_delivery_ms: 180_000,
  promise_padding_parking_ms: 180_000,
  slip_threshold_ms: 120_000,
  slip_escalate_ms: 120_000,
  cascade_step_ms: 60_000,
  min_gain_ms: 60_000,
  table_lock_ttl_ms: 600_000,
  returns_boost: true,
  order_abandon_ms: 14_400_000,
};
const RANGES: Array<[string, number, number]> = [
  ['weight_dine_in_pct', 10, 1000],
  ['weight_takeaway_pct', 10, 1000],
  ['weight_delivery_pct', 10, 1000],
  ['weight_parking_pct', 10, 1000],
  ['weight_follow_up_pct', 10, 1000],
  ['promise_padding_dine_in_ms', 0, 1_800_000],
  ['promise_padding_takeaway_ms', 0, 1_800_000],
  ['promise_padding_delivery_ms', 0, 1_800_000],
  ['promise_padding_parking_ms', 0, 1_800_000],
  ['slip_threshold_ms', 60_000, 1_800_000],
  ['slip_escalate_ms', 30_000, 1_800_000],
  ['cascade_step_ms', 15_000, 300_000],
  ['min_gain_ms', 0, 600_000],
  ['table_lock_ttl_ms', 60_000, 3_600_000],
  ['order_abandon_ms', 3_600_000, 86_400_000],
];
const BRANCH_SETTINGS = { tax_enabled: false, day_stale_after_hours: 16, day_min_gap_hours: 4 };
// 01a v2.3 §5.2a (02b A-1): delivered in engine_settings since snapshot V4 (AD-10, 02p task 4), at their defaults;
// this endpoint writes them from 02p task 9.
const V4_DEFAULTS = {
  queue_auto_send_max_ms: 14_400_000,
  zone_undo_ms: 300_000,
  slow_item_threshold_ms: 900_000,
  served_estimate_ms: null,
  comp_reason_chips: ['Late', 'Wrong item', 'Quality', 'Guest', 'Other'],
};

describe('GET / PATCH /v1/admin/branches/:branch_id/settings: engine fields (01b v1.5 §6.10, B-6; 01a v2.1 A-12)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let counter: ReturnType<typeof pgCounter>;
  // Set by a race test: the first writer's PATCH waits here with its row writes done and its transaction open.
  let holdBeforeBump: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    cloud = await createTestCloud({ testHooks: { handlerStart: () => counter.reset(), beforeBump: async () => holdBeforeBump?.() } });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    cloud.clock.set(T);
    holdBeforeBump = undefined;
    f = await restaurantFixture(cloud);
  });

  const url = (branchId: string) => `/v1/admin/branches/${branchId}/settings`;
  const auth = () => ({ authorization: `Bearer ${f.token}` });
  const getSettings = (branchId = f.branches[0]) => cloud.app.inject({ method: 'GET', url: url(branchId), headers: auth() });
  const patchSettings = (payload: object, branchId = f.branches[0]) =>
    cloud.app.inject({ method: 'PATCH', url: url(branchId), headers: auth(), payload });
  const branchOf = async (branchId = f.branches[0]) => (await getSettings(branchId)).json().data.branch as Record<string, unknown> & { version: string };
  const patchCurrent = async (changes: object, branchId = f.branches[0]) =>
    patchSettings({ expected_version: (await branchOf(branchId)).version, ...changes }, branchId);
  const configVersion = async (branchId = f.branches[0]) =>
    Number((await cloud.pool.query(`SELECT config_version FROM branches WHERE branch_id = $1`, [branchId])).rows[0].config_version);
  const audits = async () =>
    (
      await cloud.pool.query<{ entity_id: string; action: string; before: Record<string, unknown>; after: Record<string, unknown> }>(
        `SELECT entity_id, action, before, after FROM config_audit WHERE tenant_id = $1 AND entity = 'branch_settings' ORDER BY at, audit_id`,
        [f.tenantId],
      )
    ).rows;
  const engineRow = async (branchId = f.branches[0]) =>
    (await cloud.pool.query(`SELECT * FROM branch_engine_settings WHERE branch_id = $1`, [branchId])).rows[0] as Record<string, unknown>;

  it('[01b B-6] GET returns every A-12 field with its default and a version, in 1 statement', async () => {
    const response = await getSettings();
    expect(response.statusCode, response.body).toBe(200);
    expect(counter.count).toBe(1);
    const branch = response.json().data.branch;
    expect(branch).toMatchObject({ ...BRANCH_SETTINGS, ...DEFAULTS });
    expect(branch.version).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(branch).sort()).toEqual(
      ['branch_id', 'name', 'status', 'hub_last_seen_at', 'hub_synced_at', 'version', ...Object.keys(BRANCH_SETTINGS), ...Object.keys(DEFAULTS)].sort(),
    );
  });

  it('[01b B-6] the fields are exactly engine_settings of BranchConfigSnapshotSchemaV4, less the five V4 settings (task 9)', () => {
    expect([...Object.keys(DEFAULTS), ...Object.keys(V4_DEFAULTS)].sort()).toEqual(
      Object.keys(BranchConfigSnapshotSchemaV4.shape.engine_settings.shape).sort(),
    );
  });

  it('[01b B-6] a missing settings row on read is an error, not a default', async () => {
    await cloud.pool.query(`DELETE FROM branch_engine_settings WHERE branch_id = $1`, [f.branches[0]]);
    expect((await getSettings()).statusCode).toBe(500);
    expect((await patchSettings({ expected_version: 'any', weight_dine_in_pct: 150 })).statusCode).toBe(500);
    expect(await audits()).toEqual([]);
  });

  it.each(RANGES)('[01b B-6] %s: both range ends are accepted, one past either end is 400', async (field, min, max) => {
    for (const value of [min, max]) {
      const accepted = await patchCurrent({ [field]: value });
      expect(accepted.statusCode, accepted.body).toBe(200);
      expect(accepted.json().data.branch[field]).toBe(value);
      expect((await engineRow())[field]).toBe(value);
    }
    const auditCount = (await audits()).length;
    const config = await configVersion();
    for (const value of [min - 1, max + 1, min + 0.5]) {
      const refused = await patchCurrent({ [field]: value });
      expect(refused.statusCode, `${field}=${value}`).toBe(400);
      expect(refused.json().error.code).toBe('VALIDATION_FAILED');
    }
    expect((await audits()).length).toBe(auditCount);
    expect(await configVersion()).toBe(config);
  });

  it('[01b B-6] returns_boost takes a boolean only', async () => {
    const accepted = await patchCurrent({ returns_boost: false });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().data.branch.returns_boost).toBe(false);
    expect((await patchCurrent({ returns_boost: 'no' })).statusCode).toBe(400);
  });

  it('[01b B-6] one PATCH of branch and engine fields is one audit row and one bump of this branch only, in 7 statements (5 before B-6: + the A-12 UPDATE, + the read split from the lock); the others stay', async () => {
    const before = await branchOf();
    const [config, otherConfig] = [await configVersion(), await configVersion(f.branches[1])];
    cloud.clock.set(T + 5000);
    const response = await patchSettings({ expected_version: before.version, tax_enabled: true, weight_takeaway_pct: 250, returns_boost: false });
    expect(response.statusCode, response.body).toBe(200);
    expect(counter.count).toBe(7);
    const branch = response.json().data.branch;
    expect(branch).toMatchObject({ ...DEFAULTS, ...BRANCH_SETTINGS, tax_enabled: true, weight_takeaway_pct: 250, returns_boost: false });
    expect(branch).toEqual(await branchOf());

    const settings = { ...BRANCH_SETTINGS, ...DEFAULTS };
    expect(await audits()).toEqual([
      {
        entity_id: f.branches[0],
        action: 'update',
        before: settings,
        after: { ...settings, tax_enabled: true, weight_takeaway_pct: 250, returns_boost: false },
      },
    ]);
    expect(await configVersion()).toBe(config + 1);
    expect(await configVersion(f.branches[1])).toBe(otherConfig);
    expect(await engineRow()).toMatchObject({ weight_takeaway_pct: 250, returns_boost: false, updated_at: String(T + 5000) });
    expect(await engineRow(f.branches[1])).toMatchObject(DEFAULTS);
  });

  it('[01b B-6] a failure after the engine write rolls the branch fields back too (same transaction)', async () => {
    const before = await branchOf();
    await cloud.pool.query(`ALTER TABLE branch_engine_settings ADD CONSTRAINT c7_refuse CHECK (weight_dine_in_pct <> 777) NOT VALID`);
    try {
      const failed = await patchSettings({ expected_version: before.version, tax_enabled: true, weight_dine_in_pct: 777 });
      expect(failed.statusCode).toBe(500);
    } finally {
      await cloud.pool.query(`ALTER TABLE branch_engine_settings DROP CONSTRAINT c7_refuse`);
    }
    expect((await branchOf()).tax_enabled).toBe(false);
    expect(await audits()).toEqual([]);
  });

  it('[01b B-6, B23] a stale or missing expected_version: 409 CONFIG_STALE / 400, nothing written; the version check runs before the merged-row rule, and a stale no-op is still 409', async () => {
    const stale = await branchOf();
    expect((await patchSettings({ expected_version: stale.version, min_gain_ms: 90_000 })).statusCode).toBe(200);
    const config = await configVersion();
    const auditCount = (await audits()).length;

    for (const payload of [{ min_gain_ms: 120_000 }, { min_gain_ms: 90_000 }, { day_stale_after_hours: 4 }]) {
      const response = await patchSettings({ expected_version: stale.version, ...payload });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'branch_settings', id: f.branches[0] } });
    }
    expect((await patchSettings({ min_gain_ms: 120_000 })).statusCode).toBe(400);
    expect((await patchSettings({ expected_version: (await branchOf()).version })).statusCode).toBe(400);

    expect(await configVersion()).toBe(config);
    expect(await audits()).toHaveLength(auditCount);
    expect((await engineRow()).min_gain_ms).toBe(90_000);
  });

  it.each([...RANGES.map(([field, min]) => [field, min] as [string, number]), ['returns_boost', false] as [string, boolean], ['tax_enabled', true] as [string, boolean], ['day_stale_after_hours', 20] as [string, number], ['day_min_gap_hours', 5] as [string, number]])(
    '[01b B-6, B23] a change to %s changes the version and the old version goes stale',
    async (field, value) => {
      const before = await branchOf();
      const changed = await patchSettings({ expected_version: before.version, [field]: value });
      expect(changed.statusCode, changed.body).toBe(200);
      expect(changed.json().data.branch.version).not.toBe(before.version);
      expect((await branchOf()).version).toBe(changed.json().data.branch.version);
      expect((await patchSettings({ expected_version: before.version, [field]: value })).statusCode).toBe(409);
    },
  );

  it('[01b B23] the version covers only what this write replaces: a rename keeps it, and answers the engine fields', async () => {
    const before = await branchOf();
    const renamed = await cloud.app.inject({ method: 'PATCH', url: `/v1/admin/branches/${f.branches[0]}`, headers: auth(), payload: { name: 'Gulberg' } });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json().data.branch).toEqual({ ...before, name: 'Gulberg' });
    expect((await branchOf()).version).toBe(before.version);
  });

  it('[01b B-6, S26] an unchanged PATCH is a no-op: 200 with the stored branch, 3 statements, no audit, no bump, no row write', async () => {
    const before = await branchOf();
    const config = await configVersion();
    const response = await patchSettings({ expected_version: before.version, weight_dine_in_pct: 100, returns_boost: true, tax_enabled: false });
    expect(response.statusCode, response.body).toBe(200);
    expect(counter.count).toBe(3);
    expect(response.json().data.branch).toEqual(before);
    expect(await audits()).toEqual([]);
    expect(await configVersion()).toBe(config);
    expect((await engineRow()).updated_at).toBe((await engineRow()).created_at);
  });

  it('[01b B-6, 01a §4.3 V3] the next GET /v1/sync/config delivers the new value in engine_settings: a hub up to date gets 304 before the PATCH, the new snapshot after', async () => {
    const held = await configVersion();
    const directory = Number((await cloud.pool.query(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [f.tenantId])).rows[0].directory_version);
    const poll = () =>
      cloud.app.inject({
        method: 'GET',
        url: `/v1/sync/config?config_version=${held}&directory_version=${directory}`,
        headers: { authorization: `Bearer ${f.branchKey}` },
      });
    expect((await poll()).statusCode).toBe(304);

    const patched = await patchCurrent({ order_abandon_ms: 7_200_000, table_lock_ttl_ms: 120_000, returns_boost: false });
    expect(patched.statusCode, patched.body).toBe(200);

    const next = await poll();
    expect(next.statusCode, next.body).toBe(200);
    const snapshot = BranchConfigSnapshotSchemaV4.parse(next.json().data.config.snapshot);
    expect(snapshot.config_version).toBe(held + 1);
    expect(snapshot.engine_settings).toEqual({
      ...DEFAULTS,
      ...V4_DEFAULTS,
      order_abandon_ms: 7_200_000,
      table_lock_ttl_ms: 120_000,
      returns_boost: false,
    });
  });

  // A first writer through the real route, stopped inside its transaction after writing only an A-12 field; `second`
  // is sent once it is held, and the first commits only when Postgres reports the second blocked on the branch row.
  const raceAgainstEngineWrite = async (second: (heldVersion: string) => ReturnType<typeof patchSettings>) => {
    const held = await branchOf();
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const reachedHold = new Promise<void>((resolve) => (reached = resolve));
    holdBeforeBump = () => {
      holdBeforeBump = undefined; // the second request must not stop here
      reached();
      return released;
    };
    const first = patchSettings({ expected_version: held.version, weight_dine_in_pct: 150 });
    await reachedHold;
    const secondResponse = second(held.version);
    try {
      await blockedOnBranchRow();
    } finally {
      release();
    }
    const firstResponse = await first;
    expect(firstResponse.statusCode, firstResponse.body).toBe(200);
    return { held, first: firstResponse, second: await secondResponse };
  };
  const blockedOnBranchRow = async () => {
    for (let i = 0; i < 500; i += 1) {
      const blocked = await cloud.pool.query(
        `SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0 AND query LIKE '%FROM branches%FOR UPDATE%'`,
      );
      if (blocked.rows.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the second request never blocked on the branch row');
  };

  it('[01b B23, B-6] race: a PATCH with the old version, blocked on the branch lock while another save commits an engine field, gets 409 CONFIG_STALE and keeps that value', async () => {
    const race = await raceAgainstEngineWrite((heldVersion) => patchSettings({ expected_version: heldVersion, weight_takeaway_pct: 300 }));
    expect(race.second.statusCode, race.second.body).toBe(409);
    expect(race.second.json().error).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'branch_settings', id: f.branches[0] } });
    expect(await engineRow()).toMatchObject({ weight_dine_in_pct: 150, weight_takeaway_pct: 200 });
    expect(await audits()).toHaveLength(1);
    expect((await branchOf()).version).toBe(race.first.json().data.branch.version);
  });

  it('[01b §6.9, B-6] race: a rename blocked on the branch lock while a save commits an engine field answers the committed values and version', async () => {
    const race = await raceAgainstEngineWrite(() =>
      cloud.app.inject({ method: 'PATCH', url: `/v1/admin/branches/${f.branches[0]}`, headers: auth(), payload: { name: 'Gulberg' } }),
    );
    expect(race.second.statusCode, race.second.body).toBe(200);
    expect(race.second.json().data.branch).toEqual(await branchOf());
    expect(race.second.json().data.branch).toMatchObject({ name: 'Gulberg', weight_dine_in_pct: 150, version: race.first.json().data.branch.version });
  });
});
