import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;

describe('PATCH /v1/admin/branches/:branch_id — rename (01b §6.9)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;

  beforeAll(async () => {
    cloud = await createTestCloud();
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    cloud.clock.set(T);
    f = await restaurantFixture(cloud);
  });

  const rename = (branchId: string, name: string) =>
    cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/branches/${branchId}`,
      headers: { authorization: `Bearer ${f.token}` },
      payload: { name },
    });
  const versions = async () => {
    const tenant = await cloud.pool.query(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [f.tenantId]);
    const branches = await cloud.pool.query(`SELECT branch_id, config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`, [f.tenantId]);
    return { directory: Number(tenant.rows[0].directory_version), config: branches.rows.map((row) => Number(row.config_version)) };
  };
  const branchAudits = async () =>
    (
      await cloud.pool.query<{ entity_id: string; branch_id: string; action: string; actor_kind: string; before: unknown; after: unknown }>(
        `SELECT entity_id, branch_id, action, actor_kind, before, after FROM config_audit WHERE tenant_id = $1 AND entity = 'branch' ORDER BY at, audit_id`,
        [f.tenantId],
      )
    ).rows;
  const listed = async () =>
    (
      await cloud.app.inject({ method: 'GET', url: '/v1/admin/branches', headers: { authorization: `Bearer ${f.token}` } })
    ).json().data.branches as Array<{ branch_id: string; name: string }>;

  it('[01b #47] rename: the new name in GET /v1/admin/branches; unique among the tenant\'s branches only; no version bump', async () => {
    const before = await versions();
    const response = await rename(f.branches[0], '  Gulberg  ');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.branch).toMatchObject({
      branch_id: f.branches[0],
      name: 'Gulberg',
      status: 'pending_hub',
      hub_last_seen_at: null,
      hub_synced_at: null,
      tax_enabled: false,
      day_stale_after_hours: 16,
      day_min_gap_hours: 4,
    });
    expect((await listed()).find((row) => row.branch_id === f.branches[0])!.name).toBe('Gulberg');
    expect(await versions()).toEqual(before);

    // Another tenant's branch name is free; this tenant's is taken.
    expect((await rename(f.branches[1], 'Branch X')).statusCode).toBe(200);
    const taken = await rename(f.branches[2], 'Branch X');
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'branch', name: 'Branch X' } });
  });

  it('[01b #88] two concurrent renames to one name: one 200, one 409; no version bump; one branch/update audit row; "gulberg" after "Gulberg" → 409', async () => {
    const before = await versions();
    for (let run = 0; run < 10; run++) {
      const name = `Gulberg ${run}`;
      const answers = await Promise.all([rename(f.branches[0], name), rename(f.branches[1], name)]);
      expect(answers.map((r) => r.statusCode).sort(), answers.map((r) => r.body).join('\n')).toEqual([200, 409]);
      const refused = answers.find((r) => r.statusCode === 409)!;
      expect(refused.json().error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'branch', name } });
    }
    expect(await versions()).toEqual(before);
    const audits = await branchAudits();
    expect(audits).toHaveLength(10);
    expect(audits[0]).toMatchObject({ action: 'update', actor_kind: 'owner', before: { name: expect.any(String) }, after: { name: 'Gulberg 0' } });
    expect(audits[0]!.branch_id).toBe(audits[0]!.entity_id);

    const lower = await rename(f.branches[2], 'gulberg 9');
    expect(lower.statusCode).toBe(409);
    expect(lower.json().error.details).toEqual({ entity: 'branch', name: 'gulberg 9' });
  });

  it('[01b §6.9] same name → 200 with no audit row; a case change of its own name → 200; 61 characters → 400; owner missing a branch → 403 tenant_wide_write, nothing written', async () => {
    const same = await rename(f.branches[0], 'Branch A');
    expect(same.statusCode, same.body).toBe(200);
    expect(await branchAudits()).toHaveLength(0);
    expect((await rename(f.branches[0], 'BRANCH A')).statusCode).toBe(200);
    expect(await branchAudits()).toHaveLength(1);
    expect((await rename(f.branches[0], 'x'.repeat(61))).statusCode).toBe(400);
    expect((await rename(f.branches[0], 'x'.repeat(60))).statusCode).toBe(200);

    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      f.tenantId,
      f.userId,
      [f.branches[0], f.branches[1]],
    ]);
    const refused = await rename(f.branches[1], 'Johar Town');
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'tenant_wide_write' } });
    expect((await listed()).find((row) => row.branch_id === f.branches[1])!.name).toBe('Branch B');
    expect(await branchAudits()).toHaveLength(2);
  });
});
