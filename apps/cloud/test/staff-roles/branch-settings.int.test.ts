import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgCounter } from '../helpers/pg-counter';
import { restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;

// 01a v2.1 A-12 defaults: the settings wire and audit shape carry them since 01b v1.5 B-6.
const ENGINE_DEFAULTS = {
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
  queue_auto_send_max_ms: 14_400_000,
  zone_undo_ms: 300_000,
  slow_item_threshold_ms: 900_000,
  comp_reason_chips: ['Late', 'Wrong item', 'Quality', 'Guest'], // 01a v2.4.4 (Q-19): 0014 drops "Other"
  // 03b §4.5 B-2 (P0.15): on the owner wire; a row written after 0012 has served_estimate_ms null.
  served_estimate_ms: null,
  ready_window_ms: 60_000,
  kds_offline_ms: 30_000,
};

describe('GET / PATCH /v1/admin/branches/:branch_id/settings (01b §6.10, B16)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let counter: ReturnType<typeof pgCounter>;

  beforeAll(async () => {
    cloud = await createTestCloud({ testHooks: { handlerStart: () => counter.reset() } });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    cloud.clock.set(T);
    f = await restaurantFixture(cloud);
  });

  const url = (branchId: string) => `/v1/admin/branches/${branchId}/settings`;
  const getSettings = (branchId: string, token = f.token) =>
    cloud.app.inject({ method: 'GET', url: url(branchId), headers: { authorization: `Bearer ${token}` } });
  // v1.5 B-6: expected_version is required; these tests send the current one (stale versions: branch-settings-engine).
  const patchSettings = async (branchId: string, payload: object) => {
    const current = await getSettings(branchId);
    const expected_version: string = current.statusCode === 200 ? current.json().data.branch.version : 'unread';
    return cloud.app.inject({ method: 'PATCH', url: url(branchId), headers: { authorization: `Bearer ${f.token}` }, payload: { expected_version, ...payload } });
  };
  const configVersions = async () =>
    (
      await cloud.pool.query<{ branch_id: string; config_version: string }>(
        `SELECT branch_id, config_version FROM branches WHERE tenant_id = ANY($1) ORDER BY branch_id`,
        [[f.tenantId, f.other.tenantId]],
      )
    ).rows.map((row) => [row.branch_id, Number(row.config_version)]);
  const settingsAudits = async (tenantId = f.tenantId) =>
    (
      await cloud.pool.query<{ entity_id: string; branch_id: string; actor_kind: string; actor_owner_user_id: string; action: string; before: unknown; after: unknown }>(
        `SELECT entity_id, branch_id, actor_kind, actor_owner_user_id, action, before, after FROM config_audit
          WHERE tenant_id = $1 AND entity IN ('branch_settings', 'branch') ORDER BY at, audit_id`,
        [tenantId],
      )
    ).rows;

  it('[01b #45] settings PATCH writes a branch_settings audit row with actor_kind owner and bumps only that branch\'s config_version', async () => {
    const before = await configVersions();
    const response = await patchSettings(f.branches[1], { tax_enabled: true, day_stale_after_hours: 20 });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.branch).toMatchObject({
      branch_id: f.branches[1],
      name: 'Branch B',
      tax_enabled: true,
      day_stale_after_hours: 20,
      day_min_gap_hours: 4,
    });
    expect(await configVersions()).toEqual(before.map(([id, v]) => [id, id === f.branches[1] ? (v as number) + 1 : v]));
    expect(await settingsAudits()).toEqual([
      {
        entity_id: f.branches[1],
        branch_id: f.branches[1],
        actor_kind: 'owner',
        actor_owner_user_id: f.userId,
        action: 'update',
        before: { tax_enabled: false, day_stale_after_hours: 16, day_min_gap_hours: 4, ...ENGINE_DEFAULTS },
        after: { tax_enabled: true, day_stale_after_hours: 20, day_min_gap_hours: 4, ...ENGINE_DEFAULTS },
      },
    ]);

    // A no-op writes nothing.
    const again = await patchSettings(f.branches[1], { tax_enabled: true });
    expect(again.statusCode).toBe(200);
    expect(await settingsAudits()).toHaveLength(1);
    expect((await configVersions()).find(([id]) => id === f.branches[1])![1]).toBe((before.find(([id]) => id === f.branches[1])![1] as number) + 1);
  });

  it('[01b #46] day_stale_after_hours 49 or day_min_gap_hours 13 → 400; a merged row with stale ≤ gap → 400 on day_min_gap_hours; a new branch starts with tax off', async () => {
    const before = await configVersions();
    for (const payload of [{ day_stale_after_hours: 49 }, { day_min_gap_hours: 13 }, { day_stale_after_hours: 0 }, {}]) {
      const response = await patchSettings(f.branches[0], payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    }
    // Stored 16 / 4: stale 4 makes stale ≤ gap on the merged row.
    for (const payload of [{ day_stale_after_hours: 4 }, { day_min_gap_hours: 12, day_stale_after_hours: 12 }]) {
      const merged = await patchSettings(f.branches[0], payload);
      expect(merged.statusCode, merged.body).toBe(400);
      expect(merged.json().error).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'day_min_gap_hours' }] } });
    }
    expect(await configVersions()).toEqual(before);
    expect(await settingsAudits()).toEqual([]);
    expect((await patchSettings(f.branches[0], { day_stale_after_hours: 48, day_min_gap_hours: 12 })).statusCode).toBe(200);

    // Every fixture branch was created by issue-registration-code: tax off (Q15).
    for (const branchId of f.branches) {
      if (branchId === f.branches[0]) continue;
      expect((await getSettings(branchId)).json().data.branch.tax_enabled).toBe(false);
    }
  });

  it('[01b #48] PATCH …/:b and …/:b/settings with another tenant\'s branch or an unknown id → 404 BRANCH_NOT_FOUND, nothing written', async () => {
    const before = await configVersions();
    for (const branchId of [f.other.branchId, 'no-such-branch']) {
      const rename = await cloud.app.inject({
        method: 'PATCH',
        url: `/v1/admin/branches/${branchId}`,
        headers: { authorization: `Bearer ${f.token}` },
        payload: { name: 'Gulberg' },
      });
      expect(rename.statusCode, rename.body).toBe(404);
      expect(rename.json().error.code).toBe('BRANCH_NOT_FOUND');
      const settings = await patchSettings(branchId, { tax_enabled: true });
      expect(settings.statusCode, settings.body).toBe(404);
      expect(settings.json().error.code).toBe('BRANCH_NOT_FOUND');
    }
    expect(await configVersions()).toEqual(before);
    expect(await settingsAudits()).toEqual([]);
    expect(await settingsAudits(f.other.tenantId)).toEqual([]);
    const other = await cloud.pool.query(`SELECT name, tax_enabled FROM branches WHERE branch_id = $1`, [f.other.branchId]);
    expect(other.rows[0]).toEqual({ name: 'Branch X', tax_enabled: false });
  });

  it('[01b #59] GET settings returns tax_enabled and the day settings in 1 statement; a branch outside the owner\'s list → 404', async () => {
    await cloud.pool.query(`UPDATE branches SET tax_enabled = true, day_stale_after_hours = 30, day_min_gap_hours = 6 WHERE branch_id = $1`, [
      f.branches[2],
    ]);
    const response = await getSettings(f.branches[2]);
    expect(response.statusCode, response.body).toBe(200);
    expect(counter.count).toBe(1);
    expect(response.json().data.branch).toEqual({
      branch_id: f.branches[2],
      name: 'Branch C',
      status: 'pending_hub',
      hub_last_seen_at: null,
      hub_synced_at: null,
      tax_enabled: true,
      day_stale_after_hours: 30,
      day_min_gap_hours: 6,
      ...ENGINE_DEFAULTS,
      version: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    const outside = await getSettings(f.branches[2], f.tokenFor([f.branches[0], f.branches[1]]));
    expect(outside.statusCode).toBe(404);
    expect(outside.json().error.code).toBe('BRANCH_NOT_FOUND');
    expect((await getSettings(f.other.branchId)).statusCode).toBe(404);
  });

  it('[01b §6.10] owner missing a branch → PATCH 403 tenant_wide_write, nothing written; GET still 200', async () => {
    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      f.tenantId,
      f.userId,
      [f.branches[0], f.branches[1]],
    ]);
    const before = await configVersions();
    const refused = await patchSettings(f.branches[0], { tax_enabled: true });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'tenant_wide_write' } });
    expect(await configVersions()).toEqual(before);
    expect(await settingsAudits()).toEqual([]);
    expect((await getSettings(f.branches[0])).statusCode).toBe(200);
  });
});
