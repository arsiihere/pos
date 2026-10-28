import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;
const RUNS = 20;

interface Staff {
  staff_id: string;
  version: string;
}

describe('concurrent last-admin removal (01b B7, B11)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let managerRole: string;
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
    const roles = await cloud.pool.query<{ role_id: string; default_key: string }>(
      `SELECT role_id, default_key FROM roles WHERE tenant_id = $1 AND default_key IN ('manager', 'waiter')`,
      [f.tenantId],
    );
    managerRole = roles.rows.find((row) => row.default_key === 'manager')!.role_id;
    waiterRole = roles.rows.find((row) => row.default_key === 'waiter')!.role_id;
    // Branch C without the owner's row, so the owner's own guard does not hide the last-admin guard there.
    await cloud.pool.query(
      `DELETE FROM staff_branches s USING owner_users o
        WHERE s.tenant_id = $1 AND s.branch_id = $2 AND o.tenant_id = s.tenant_id AND o.staff_id = s.staff_id`,
      [f.tenantId, f.branches[2]],
    );
  });

  const admin = async (name: string): Promise<Staff> => {
    const created = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/staff',
      ...owner(f),
      payload: { display_name: name, role_ids: [managerRole], branch_ids: [f.branches[2]] },
    });
    expect(created.statusCode, created.body).toBe(200);
    const pin = await cloud.app.inject({
      method: 'PUT',
      url: `/v1/admin/staff/${created.json().data.staff.staff_id}/pin`,
      headers: { authorization: `Bearer ${f.token}` },
      payload: { pin: '4321' },
    });
    expect(pin.statusCode, pin.body).toBe(200);
    return pin.json().data.staff as Staff;
  };
  const demote = (person: Staff) =>
    cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/staff/${person.staff_id}`,
      headers: { authorization: `Bearer ${f.token}` },
      payload: { expected_version: person.version, role_ids: [waiterRole] },
    });

  it('[01b #11] two concurrent PATCHes each removing one of the last two qualifying admins at a branch: one 200, one 409 LAST_ADMIN_REQUIRED', async () => {
    for (let run = 0; run < RUNS; run++) {
      const a = await admin(`Imran ${run}`);
      const b = await admin(`Hamza ${run}`);

      const responses = await Promise.all([demote(a), demote(b)]);
      const codes = responses.map((r) => r.statusCode).sort();
      expect(codes, `run ${run}: ${responses.map((r) => r.body).join(' ')}`).toEqual([200, 409]);
      const refused = responses.find((r) => r.statusCode === 409)!;
      expect(refused.json().error).toMatchObject({ code: 'LAST_ADMIN_REQUIRED', details: { branch_ids: [f.branches[2]] } });

      // Next run starts with no admin at branch C (a branch with none before is not blocked, §3.4).
      await cloud.pool.query(`DELETE FROM staff_branches WHERE tenant_id = $1 AND branch_id = $2`, [f.tenantId, f.branches[2]]);
    }
  });
});
