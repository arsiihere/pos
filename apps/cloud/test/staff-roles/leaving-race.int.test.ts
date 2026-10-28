import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;
const RUNS = 20;

interface Staff {
  staff_id: string;
  version: string;
}

describe('concurrent leavers (01b B11, B15)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let waiterRole: string;

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
    waiterRole = (
      await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1 AND default_key = 'waiter'`, [f.tenantId])
    ).rows[0]!.role_id;
  });

  const waiter = async (name: string, leadId?: string): Promise<Staff> => {
    const b = f.branches[0];
    const response = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/staff',
      ...owner(f),
      payload: {
        display_name: name,
        role_ids: [waiterRole],
        branch_ids: [b],
        ...(leadId === undefined ? {} : { reports_to: [{ branch_id: b, lead_staff_id: leadId }] }),
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.staff as Staff;
  };
  const leave = (person: Staff) =>
    cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/staff/${person.staff_id}`,
      headers: { authorization: `Bearer ${f.token}` },
      payload: { expected_version: person.version, is_active: false },
    });

  it('[01b B15] a lead and their report marked as left in two concurrent PATCHes: no lead line ends at a person who has left', async () => {
    for (let run = 0; run < RUNS; run++) {
      // top ← lead ← report ← below: lead and report leave together.
      const top = await waiter(`Top ${run}`);
      const lead = await waiter(`Lead ${run}`, top.staff_id);
      const report = await waiter(`Report ${run}`, lead.staff_id);
      const below = await waiter(`Below ${run}`, report.staff_id);

      const [a, b] = await Promise.all([leave(lead), leave(report)]);
      expect(a.statusCode, a.body).toBe(200);
      if (b.statusCode !== 200) {
        // The lead's move committed first and changed the report's version (B23): the client retries with
        // the version the lead's response listed in changed_versions.
        expect(b.json().error).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'staff', id: report.staff_id } });
        const fresh = (a.json().data.changed_versions.staff as Staff[]).find((row) => row.staff_id === report.staff_id)!;
        const retried = await leave(fresh);
        expect(retried.statusCode, retried.body).toBe(200);
      }

      const dangling = await cloud.pool.query(
        `SELECT l.staff_id, l.lead_staff_id
           FROM staff_leads l JOIN staff s ON s.tenant_id = l.tenant_id AND s.staff_id = l.lead_staff_id
          WHERE l.tenant_id = $1 AND NOT s.is_active`,
        [f.tenantId],
      );
      expect(dangling.rows, `run ${run}`).toEqual([]);
      const belowLead = await cloud.pool.query(`SELECT lead_staff_id FROM staff_leads WHERE tenant_id = $1 AND staff_id = $2`, [
        f.tenantId,
        below.staff_id,
      ]);
      expect(belowLead.rows, `run ${run}`).toEqual([{ lead_staff_id: top.staff_id }]);
    }
  });
});
