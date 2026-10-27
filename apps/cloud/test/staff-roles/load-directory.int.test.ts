import { DirectorySchema } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DirectorySchemaV1, SyncConfigEnvelopeSchemaV1 } from '../../../../packages/events/test/fixtures/v1-schemas';
import { loadDirectory } from '../../src/modules/hub-registration/repository';
import { pgCounter } from '../helpers/pg-counter';
import { restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;

describe('loadDirectory v2 (01b §4.3.1, §7.3)', () => {
  let cloud: TestCloud;
  let counter: ReturnType<typeof pgCounter>;
  let f: RestaurantFixture;

  beforeAll(async () => {
    cloud = await createTestCloud();
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
  });

  // Test data only: the seeded roles are found by name here (test files are outside R5's scope, test 55).
  const seededRole = async (name: string) =>
    (
      await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1 AND name = $2`, [
        f.tenantId,
        name,
      ])
    ).rows[0]!.role_id;

  async function addRole(roleId: string, name: string, idleMs = 300_000) {
    await cloud.pool.query(
      `INSERT INTO roles (tenant_id, role_id, name, session_idle_ttl_ms) VALUES ($1, $2, $3, $4)`,
      [f.tenantId, roleId, name, idleMs],
    );
  }

  async function grant(
    roleId: string,
    permission: string,
    o: { approvers?: string[]; scope?: string } = {},
  ) {
    const approvers = (o.approvers ?? []).slice().sort();
    await cloud.pool.query(
      `INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, approver_role_id, scope)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, role_id, permission)
       DO UPDATE SET grant_type = EXCLUDED.grant_type, approver_role_id = EXCLUDED.approver_role_id, scope = EXCLUDED.scope`,
      [f.tenantId, roleId, permission, approvers.length > 0 ? 'requires_approval' : 'allowed', approvers[0] ?? null, o.scope ?? 'branch'],
    );
    await cloud.pool.query(`DELETE FROM role_permission_approvers WHERE tenant_id = $1 AND role_id = $2 AND permission = $3`, [
      f.tenantId,
      roleId,
      permission,
    ]);
    for (const approver of approvers) {
      await cloud.pool.query(
        `INSERT INTO role_permission_approvers (tenant_id, role_id, permission, approver_role_id) VALUES ($1, $2, $3, $4)`,
        [f.tenantId, roleId, permission, approver],
      );
    }
  }

  async function addStaff(
    staffId: string,
    branchId: string,
    roleIds: string[],
    o: { pin?: boolean; active?: boolean; name?: string } = {},
  ) {
    const active = o.active ?? true;
    await cloud.pool.query(
      `INSERT INTO staff (tenant_id, staff_id, display_name, pin_hash, pin_set_at, is_active, left_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [
        f.tenantId,
        staffId,
        o.name ?? staffId,
        o.pin === false ? null : `hash-${staffId}`,
        o.pin === false ? null : T,
        active,
        active ? null : T,
        T,
      ],
    );
    await cloud.pool.query(`INSERT INTO staff_branches (tenant_id, branch_id, staff_id) VALUES ($1, $2, $3)`, [
      f.tenantId,
      branchId,
      staffId,
    ]);
    for (const roleId of roleIds) {
      await cloud.pool.query(`INSERT INTO staff_roles (tenant_id, staff_id, role_id) VALUES ($1, $2, $3)`, [
        f.tenantId,
        staffId,
        roleId,
      ]);
    }
  }

  async function addFloor(floorId: string, branchId: string, archived = false) {
    await cloud.pool.query(
      `INSERT INTO floors (tenant_id, branch_id, floor_id, name, archived_at, created_at, updated_at)
       VALUES ($1, $2, $3, $3, $4, $5, $5)`,
      [f.tenantId, branchId, floorId, archived ? T : null, T],
    );
  }

  async function addStation(stationId: string, branchId: string, archived = false) {
    await cloud.pool.query(
      `INSERT INTO stations (tenant_id, branch_id, station_id, name, station_type, capacity, archived_at, created_at, updated_at)
       VALUES ($1, $2, $3, $3, 'slot', 4, $4, $5, $5)`,
      [f.tenantId, branchId, stationId, archived ? T : null, T],
    );
  }

  async function load(branchId: string) {
    const client = await cloud.pool.connect();
    try {
      counter.reset();
      const loaded = await loadDirectory(client, f.tenantId, branchId);
      return { directory: loaded.directory, statements: counter.count };
    } finally {
      client.release();
    }
  }

  it('[01b #21] returns the §4.3.1 shape in 8 statements, with 3 and with 30 staff', async () => {
    const branchB = f.branches[1];
    const branchC = f.branches[2];
    await addRole('r-waiter', 'Bera');
    await addRole('r-lead', 'Captain', 3_600_000);
    await grant('r-waiter', 'take-order-anywhere', { scope: 'my_floors' });
    await grant('r-waiter', 'apply-discount', { approvers: ['r-lead'] });
    await addStaff('s-hamza', branchB, ['r-lead']);
    await addStaff('s-bilal', branchB, ['r-waiter']);
    await addStaff('s-cook', branchB, ['r-waiter'], { pin: false });
    await cloud.pool.query(`INSERT INTO staff_branches (tenant_id, branch_id, staff_id) VALUES ($1, $2, 's-bilal')`, [
      f.tenantId,
      branchC,
    ]);
    await cloud.pool.query(
      `INSERT INTO staff_permission_denials (tenant_id, staff_id, permission) VALUES ($1, 's-bilal', 'reprint-ticket')`,
      [f.tenantId],
    );
    await addStaff('s-c-lead', branchC, ['r-lead']);
    await cloud.pool.query(
      `INSERT INTO staff_leads (tenant_id, branch_id, staff_id, lead_staff_id)
       VALUES ($1, $2, 's-bilal', 's-hamza'), ($1, $3, 's-bilal', 's-c-lead')`,
      [f.tenantId, branchB, branchC],
    );
    await addFloor('f-ground', branchB);
    await addFloor('f-roof', branchB, true);
    await addFloor('f-c', branchC);
    await cloud.pool.query(
      `INSERT INTO staff_floors (tenant_id, branch_id, staff_id, floor_id)
       VALUES ($1, $2, 's-bilal', 'f-ground'), ($1, $2, 's-bilal', 'f-roof'), ($1, $3, 's-bilal', 'f-c')`,
      [f.tenantId, branchB, branchC],
    );
    await addStation('st-grill', branchB);
    await addStation('st-fry', branchB, true);
    await addStation('st-c', branchC);
    await cloud.pool.query(
      `INSERT INTO responsibilities (tenant_id, branch_id, responsibility, station_id, subject_kind, subject_id)
       VALUES ($1, $2, 'count_stock', 'st-grill', 'staff', 's-bilal'),
              ($1, $2, 'count_stock', 'st-grill', 'role', 'r-lead'),
              ($1, $2, 'count_stock', 'st-grill', 'staff', 's-hamza'),
              ($1, $2, 'count_stock', 'st-fry', 'staff', 's-bilal'),
              ($1, $3, 'count_stock', 'st-c', 'staff', 's-bilal')`,
      [f.tenantId, branchB, branchC],
    );

    const { directory, statements } = await load(branchB);
    expect(statements).toBe(8);
    expect(DirectorySchema.safeParse(directory).success).toBe(true);
    const staffIds = directory.staff.map((member) => member.staff_id);
    expect(staffIds).toHaveLength(3); // owner, Hamza, Bilal; the cook without a PIN is not sent (B3)
    expect(staffIds).not.toContain('s-cook');
    const bilal = directory.staff.find((member) => member.staff_id === 's-bilal')!;
    expect(bilal).toEqual({
      staff_id: 's-bilal',
      display_name: 's-bilal',
      pin_hash: 'hash-s-bilal',
      role_ids: ['r-waiter'],
      denied_permissions: ['reprint-ticket'],
      lead_staff_id: 's-hamza',
      floor_ids: ['f-ground'],
    });
    const hamza = directory.staff.find((member) => member.staff_id === 's-hamza')!;
    expect(hamza.lead_staff_id).toBeNull();
    expect(hamza.floor_ids).toEqual([]);
    const waiter = directory.roles.find((role) => role.role_id === 'r-waiter')!;
    expect(waiter.permissions).toEqual([
      { permission: 'apply-discount', grant_type: 'requires_approval', approver_role_id: 'r-lead', approver_role_ids: ['r-lead'], scope: 'branch' },
      { permission: 'take-order-anywhere', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'my_floors' },
    ]);
    expect(directory.responsibilities).toEqual([
      { responsibility: 'count_stock', station_id: 'st-grill', staff_ids: ['s-bilal', 's-hamza'], role_ids: ['r-lead'] },
    ]);

    for (let n = 0; n < 27; n += 1) await addStaff(`s-extra-${String(n).padStart(2, '0')}`, branchB, ['r-waiter']);
    const big = await load(branchB);
    expect(big.directory.staff).toHaveLength(30);
    expect(big.statements).toBe(8);
  });

  it('[01b #24] a v1.4 hub parses the v2 poll body: first approver kept, leaver absent, scoped grant still a grant', async () => {
    const branchA = f.branches[0];
    const cashier = await seededRole('Cashier');
    const manager = await seededRole('Manager');
    const ownerRole = await seededRole('Owner');
    await grant(cashier, 'apply-discount', { approvers: [manager, ownerRole] });
    await grant(cashier, 'take-order-anywhere', { scope: 'my_floors' });
    await addStaff('s-cash', branchA, [cashier]);
    await addStaff('s-left', branchA, [cashier], { active: false });

    const response = await cloud.app.inject({
      method: 'GET',
      url: '/v1/sync/config?config_version=0&directory_version=0',
      headers: { authorization: `Bearer ${f.branchKey}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(SyncConfigEnvelopeSchemaV1.safeParse(body).success).toBe(true);
    const v1 = DirectorySchemaV1.parse(body.data.directory);
    expect(v1.staff.map((member) => member.staff_id)).toContain('s-cash');
    expect(v1.staff.map((member) => member.staff_id)).not.toContain('s-left');
    const v2 = DirectorySchema.parse(body.data.directory);
    const grants = v2.roles.flatMap((role) => role.permissions);
    const approvals = grants.filter((g) => g.grant_type === 'requires_approval');
    expect(approvals.length).toBeGreaterThan(0);
    for (const g of approvals) {
      expect(g.approver_role_ids.length).toBeGreaterThan(0);
      expect(g.approver_role_id).toBe(g.approver_role_ids.slice().sort()[0]);
    }
    const discount = v2.roles.find((role) => role.role_id === cashier)!.permissions.find((g) => g.permission === 'apply-discount')!;
    expect(discount.approver_role_ids).toEqual([manager, ownerRole].sort());
    const scoped = v1.roles.find((role) => role.role_id === cashier)!.permissions.find((g) => g.permission === 'take-order-anywhere');
    expect(scoped).toEqual({ permission: 'take-order-anywhere', grant_type: 'allowed', approver_role_id: null });
  });

  it('[01b #83] a branch with cashiers and no manager still sends the Manager role named as approver', async () => {
    const branchB = f.branches[1];
    const cashier = await seededRole('Cashier');
    const manager = await seededRole('Manager');
    await grant(cashier, 'apply-discount', { approvers: [manager] });
    await addStaff('s-cash-1', branchB, [cashier]);
    await addStaff('s-cash-2', branchB, [cashier]);

    const { directory } = await load(branchB);
    const holders = directory.staff.flatMap((member) => member.role_ids);
    expect(holders).not.toContain(manager);
    expect(directory.roles.map((role) => role.role_id)).toContain(manager);
    const discount = directory.roles.find((role) => role.role_id === cashier)!.permissions.find((g) => g.permission === 'apply-discount');
    expect(discount).toMatchObject({ grant_type: 'requires_approval', approver_role_ids: [manager], approver_role_id: manager });
  });
});
