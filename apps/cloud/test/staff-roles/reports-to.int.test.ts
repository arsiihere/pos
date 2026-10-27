import type { DefaultKey } from '@pos/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;

interface Staff {
  staff_id: string;
  reports_to: { branch_id: string; lead_staff_id: string }[];
  version: string;
}

describe('reports to (01b §3.2 rule 5, §3.5)', () => {
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

  const roleId = async (key: DefaultKey) =>
    (
      await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1 AND default_key = $2`, [
        f.tenantId,
        key,
      ])
    ).rows[0]!.role_id;
  const create = (payload: object) => cloud.app.inject({ method: 'POST', url: '/v1/admin/staff', ...owner(f), payload });
  const waiter = async (name: string, branchIds: string[], extra: object = {}): Promise<Staff> => {
    const response = await create({ display_name: name, role_ids: [await roleId('waiter')], branch_ids: branchIds, ...extra });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.staff as Staff;
  };
  const patch = (staffId: string, payload: object) =>
    cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/staff/${staffId}`,
      headers: { authorization: `Bearer ${f.token}` },
      payload,
    });
  const reportTo = async (person: Staff, lead: Staff, branchId: string): Promise<Staff> => {
    const response = await patch(person.staff_id, {
      expected_version: person.version,
      reports_to: [{ branch_id: branchId, lead_staff_id: lead.staff_id }],
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.staff as Staff;
  };
  const directoryVersion = async () =>
    Number(
      (await cloud.pool.query(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [f.tenantId])).rows[0].directory_version,
    );
  const leadRows = async () =>
    (await cloud.pool.query(`SELECT branch_id, staff_id, lead_staff_id FROM staff_leads WHERE tenant_id = $1 ORDER BY 1, 2`, [f.tenantId]))
      .rows;

  it('[01b #26] a lead must be active and work at that branch → 422 not_at_branch', async () => {
    const leadAtB = await waiter('Hamza', [f.branches[1]]);
    const leaver = await waiter('Imran', [f.branches[0]]);
    await cloud.pool.query(`UPDATE staff SET is_active = false, left_at = $3 WHERE tenant_id = $1 AND staff_id = $2`, [
      f.tenantId,
      leaver.staff_id,
      T,
    ]);
    const person = await waiter('Bilal', [f.branches[0]]);
    const v = await directoryVersion();
    for (const lead of [leadAtB, leaver]) {
      const reports_to = [{ branch_id: f.branches[0], lead_staff_id: lead.staff_id }];
      for (const response of [
        await create({ display_name: 'Usman', role_ids: [await roleId('waiter')], branch_ids: [f.branches[0]], reports_to }),
        await patch(person.staff_id, { expected_version: person.version, reports_to }),
      ]) {
        expect(response.statusCode, response.body).toBe(422);
        expect(response.json().error).toMatchObject({
          code: 'CONFIG_REFERENCE_INVALID',
          details: { field: 'reports_to.0.lead_staff_id', reason: 'not_at_branch' },
        });
      }
    }
    expect(await directoryVersion()).toBe(v);
    expect(await leadRows()).toEqual([]);
  });

  it('[01b #27] A → B → A at a branch → 422 loop (also a person as their own lead); a chain of 5 is accepted', async () => {
    const a = await waiter('Hamza', [f.branches[0]]);
    const b = await waiter('Bilal', [f.branches[0]], { reports_to: [{ branch_id: f.branches[0], lead_staff_id: a.staff_id }] });
    const v = await directoryVersion();
    for (const lead of [b, a]) {
      const response = await patch(a.staff_id, {
        expected_version: a.version,
        reports_to: [{ branch_id: f.branches[0], lead_staff_id: lead.staff_id }],
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error).toMatchObject({
        code: 'CONFIG_REFERENCE_INVALID',
        details: { field: 'reports_to.0.lead_staff_id', reason: 'loop' },
      });
    }
    expect(await directoryVersion()).toBe(v);

    // A line at another branch is not a loop: B leads A at branch B while A leads B at branch A.
    const both = await patch(b.staff_id, { expected_version: b.version, branch_ids: [f.branches[0], f.branches[1]] });
    expect(both.statusCode, both.body).toBe(200);
    const aAtB = await patch(a.staff_id, { expected_version: a.version, branch_ids: [f.branches[0], f.branches[1]] });
    expect(aAtB.statusCode, aAtB.body).toBe(200);
    await reportTo(aAtB.json().data.staff as Staff, b, f.branches[1]);

    // Chain of 5 at branch C, built upward by PATCH: P2 → P1, P3 → P2, P4 → P3, P5 → P4; then P1 → P5 is a loop.
    const chain: Staff[] = [];
    for (const name of ['P1', 'P2', 'P3', 'P4', 'P5']) chain.push(await waiter(name, [f.branches[2]]));
    for (let i = 1; i < chain.length; i++) chain[i] = await reportTo(chain[i]!, chain[i - 1]!, f.branches[2]);
    expect(chain[4]!.reports_to).toEqual([{ branch_id: f.branches[2], lead_staff_id: chain[3]!.staff_id }]);
    const closing = await patch(chain[0]!.staff_id, {
      expected_version: chain[0]!.version,
      reports_to: [{ branch_id: f.branches[2], lead_staff_id: chain[4]!.staff_id }],
    });
    expect(closing.statusCode, closing.body).toBe(422);
    expect(closing.json().error.details).toMatchObject({ reason: 'loop' });
  });

  it('[01b #57] reports_to with two entries for one branch → 422 one_lead_per_branch, nothing written', async () => {
    const lead1 = await waiter('Hamza', [f.branches[0]]);
    const lead2 = await waiter('Imran', [f.branches[0]]);
    const person = await waiter('Bilal', [f.branches[0]]);
    const v = await directoryVersion();
    const reports_to = [
      { branch_id: f.branches[0], lead_staff_id: lead1.staff_id },
      { branch_id: f.branches[0], lead_staff_id: lead2.staff_id },
    ];
    for (const response of [
      await create({ display_name: 'Usman', role_ids: [await roleId('waiter')], branch_ids: [f.branches[0]], reports_to }),
      await patch(person.staff_id, { expected_version: person.version, reports_to }),
    ]) {
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error).toMatchObject({
        code: 'CONFIG_REFERENCE_INVALID',
        details: { field: 'reports_to', reason: 'one_lead_per_branch' },
      });
    }
    expect(await directoryVersion()).toBe(v);
    expect(await leadRows()).toEqual([]);
    const staffCount = await cloud.pool.query(`SELECT count(*) AS n FROM staff WHERE tenant_id = $1 AND display_name = 'Usman'`, [
      f.tenantId,
    ]);
    expect(Number(staffCount.rows[0].n)).toBe(0);
  });
});
