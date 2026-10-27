import type { DefaultKey } from '@pos/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadDirectory } from '../../src/modules/hub-registration/repository';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;

interface TeamNode {
  staff_id: string;
  display_name: string;
  has_pin: boolean;
  role_ids: string[];
  members: TeamNode[];
}

describe('GET /v1/admin/branches/:branch_id/team-tree (01b §6.12, E6-TEAM AC4)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let counter: ReturnType<typeof pgCounter>;
  let ownerStaffId: string;

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
    ownerStaffId = (
      await cloud.pool.query<{ staff_id: string }>(`SELECT staff_id FROM owner_users WHERE user_id = $1`, [f.userId])
    ).rows[0]!.staff_id;
  });

  const auth = (token = f.token) => ({ authorization: `Bearer ${token}` });
  const roleId = async (key: DefaultKey) =>
    (
      await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1 AND default_key = $2`, [
        f.tenantId,
        key,
      ])
    ).rows[0]!.role_id;
  const person = async (name: string, key: DefaultKey, lead?: string, o: { pin?: boolean } = {}) => {
    const branchId = f.branches[0];
    const created = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/staff',
      ...owner(f),
      payload: {
        display_name: name,
        role_ids: [await roleId(key)],
        branch_ids: [branchId],
        ...(lead === undefined ? {} : { reports_to: [{ branch_id: branchId, lead_staff_id: lead }] }),
      },
    });
    expect(created.statusCode, created.body).toBe(200);
    const staffId = created.json().data.staff.staff_id as string;
    if (o.pin !== false) {
      const pin = await cloud.app.inject({ method: 'PUT', url: `/v1/admin/staff/${staffId}/pin`, headers: auth(), payload: { pin: '4321' } });
      expect(pin.statusCode, pin.body).toBe(200);
    }
    return { staffId, version: created.json().data.staff.version as string };
  };
  const tree = (branchId: string, token?: string) =>
    cloud.app.inject({ method: 'GET', url: `/v1/admin/branches/${branchId}/team-tree`, headers: auth(token) });
  const node = (staffId: string, name: string, roleIds: string[], members: TeamNode[] = [], hasPin = true): TeamNode => ({
    staff_id: staffId,
    display_name: name,
    has_pin: hasPin,
    role_ids: roleIds,
    members,
  });

  it('[01b #61] nested teams under their leads, Cook without a PIN included, a leaver absent; 3 statements whatever the staff count; branch outside the list → 404', async () => {
    const a = f.branches[0];
    const [waiter, cook, manager] = [await roleId('waiter'), await roleId('cook'), await roleId('manager')];
    const hamza = await person('Hamza', 'manager');
    const bilal = await person('bilal', 'waiter', hamza.staffId);
    const usman = await person('Usman', 'cook', hamza.staffId, { pin: false });
    const ali = await person('Ali', 'waiter', bilal.staffId);
    const lena = await person('Lena', 'waiter', hamza.staffId);
    const left = await cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/staff/${lena.staffId}`,
      headers: auth(),
      payload: { expected_version: lena.version, is_active: false },
    });
    expect(left.statusCode, left.body).toBe(200);

    const response = await tree(a);
    expect(response.statusCode, response.body).toBe(200);
    expect(counter.count).toBe(3);
    expect(response.json().data).toEqual({
      branch_id: a,
      roots: [
        node(ownerStaffId, 'Ada', [await roleId('owner')]),
        node(hamza.staffId, 'Hamza', [manager], [
          node(bilal.staffId, 'bilal', [waiter], [node(ali.staffId, 'Ali', [waiter])]),
          node(usman.staffId, 'Usman', [cook], [], false),
        ]),
      ],
    });

    for (let i = 0; i < 6; i += 1) await person(`Extra ${i}`, 'waiter', i % 2 === 0 ? hamza.staffId : undefined);
    const bigger = await tree(a);
    expect(bigger.statusCode).toBe(200);
    expect(counter.count).toBe(3);

    const outside = await tree(f.branches[1], f.tokenFor([a]));
    expect(outside.statusCode).toBe(404);
    expect(outside.json().error.code).toBe('BRANCH_NOT_FOUND');
    const foreign = await tree(f.other.branchId);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('BRANCH_NOT_FOUND');
  });

  it('[01b #62] a Cook with no PIN is saved reporting to a lead, is in the tree, and is not in the hub directory', async () => {
    const a = f.branches[0];
    const hamza = await person('Hamza', 'manager');
    const usman = await person('Usman', 'cook', hamza.staffId, { pin: false });
    const roots = (await tree(a)).json().data.roots as TeamNode[];
    const lead = roots.find((root) => root.staff_id === hamza.staffId)!;
    expect(lead.members).toEqual([node(usman.staffId, 'Usman', [await roleId('cook')], [], false)]);

    // the shape the hub half feeds the hub: Hamza present, Usman absent
    const client = await cloud.pool.connect();
    try {
      const staff = (await loadDirectory(client, f.tenantId, a)).directory.staff.map((row) => row.staff_id);
      expect(staff).toContain(hamza.staffId);
      expect(staff).not.toContain(usman.staffId);
    } finally {
      client.release();
    }
  });
});
