import type { DefaultKey } from '@pos/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runLinkOwnerStaff, type LinkHooks } from '../../src/cli/link-owner-staff';
import { seedTenant } from '../../src/cli/seed-tenant';
import { SystemContext } from '../../src/cli/system-context';
import { ulidGen } from '../../src/lib/ids';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;

interface Staff {
  staff_id: string;
  display_name: string;
  role_ids: string[];
  version: string;
}

describe('link-owner-staff CLI (01b §6.15a, B7, review 2 N3)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let seededStaffId: string;
  let out: string[];
  let errors: string[];
  // Set by a test to pause the next directory write right after its tenant lock (#99 a).
  let barrier: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    cloud = await createTestCloud({ testHooks: { afterTenantLock: async () => barrier?.() } });
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    barrier = undefined;
    cloud.clock.set(T);
    f = await restaurantFixture(cloud);
    seededStaffId = (await linkedStaff())!;
    out = [];
    errors = [];
  });

  const auth = () => ({ authorization: `Bearer ${f.token}` });
  const linkedStaff = async (userId = f.userId) =>
    (await cloud.pool.query<{ staff_id: string | null }>(`SELECT staff_id FROM owner_users WHERE user_id = $1`, [userId])).rows[0]
      ?.staff_id;
  const unlink = () => cloud.pool.query(`UPDATE owner_users SET staff_id = NULL WHERE user_id = $1`, [f.userId]);
  const roleId = async (key: DefaultKey) =>
    (
      await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1 AND default_key = $2`, [
        f.tenantId,
        key,
      ])
    ).rows[0]!.role_id;
  const person = async (name: string, key: DefaultKey, branchIds: string[], o: { pin?: boolean } = {}): Promise<Staff> => {
    const created = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/staff',
      ...owner(f),
      payload: { display_name: name, role_ids: [await roleId(key)], branch_ids: branchIds },
    });
    expect(created.statusCode, created.body).toBe(200);
    const staff = created.json().data.staff as Staff;
    if (o.pin === false) return staff;
    const pin = await cloud.app.inject({
      method: 'PUT',
      url: `/v1/admin/staff/${staff.staff_id}/pin`,
      headers: auth(),
      payload: { pin: '4321' },
    });
    expect(pin.statusCode, pin.body).toBe(200);
    return pin.json().data.staff as Staff;
  };
  const audits = async () =>
    (
      await cloud.pool.query(
        `SELECT entity, entity_id, action, actor_kind, actor_owner_user_id, before, after FROM config_audit
          WHERE tenant_id = $1 AND entity = 'owner_user' ORDER BY at, audit_id`,
        [f.tenantId],
      )
    ).rows;
  const directoryVersion = async () =>
    Number((await cloud.pool.query(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [f.tenantId])).rows[0].directory_version);
  const link = (staffId: string, confirmName?: string, ownerUserId = f.userId, hooks?: LinkHooks) =>
    runLinkOwnerStaff(
      ['--owner', ownerUserId, '--staff', staffId, ...(confirmName === undefined ? [] : ['--confirm-name', confirmName])],
      {
        sys: new SystemContext(cloud.pool),
        clock: cloud.clock,
        ids: ulidGen(cloud.clock),
        out: (line) => out.push(line),
        err: (line) => errors.push(line),
      },
      hooks,
    );
  // Every exit 1 path: link unchanged, no audit row, no directory bump.
  const expectRefused = async (staffId: string, confirmName: string | undefined, message: RegExp, ownerUserId = f.userId) => {
    const [before, n, v] = [await linkedStaff(ownerUserId), (await audits()).length, await directoryVersion()];
    errors = [];
    expect(await link(staffId, confirmName, ownerUserId)).toBe(1);
    expect(errors.join('\n')).toMatch(message);
    expect(await linkedStaff(ownerUserId)).toBe(before);
    expect((await audits()).length).toBe(n);
    expect(await directoryVersion()).toBe(v);
  };

  it('[01b #72] first link, non-admin targets, refusals and the no-op', async () => {
    const y = await person('Yusuf', 'owner', [...f.branches]);
    await unlink();

    // first link to a non-admin: a Cook with no PIN, a Cashier with a PIN
    const cook = await person('Cook One', 'cook', [...f.branches], { pin: false });
    await expectRefused(cook.staff_id, 'Cook One', /not a qualifying admin/);
    const cashier = await person('Cash One', 'cashier', [...f.branches]);
    await expectRefused(cashier.staff_id, 'Cash One', /not a qualifying admin/);

    // unknown owner, another tenant's staff, a leaver, a row linked to another owner
    await expectRefused(y.staff_id, 'Yusuf', /unknown owner/, 'no-such-owner');
    const otherStaff = (await linkedStaff(f.other.userId))!;
    await expectRefused(otherStaff, 'Bea', /staff not in this owner's tenant/);
    const leaver = await person('Lena', 'cook', [...f.branches]);
    const left = await cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/staff/${leaver.staff_id}`,
      headers: auth(),
      payload: { expected_version: leaver.version, is_active: false },
    });
    expect(left.statusCode, left.body).toBe(200);
    await expectRefused(leaver.staff_id, 'Lena', /staff has left/);
    await cloud.pool.query(
      `INSERT INTO owner_users (tenant_id, user_id, email, display_name, password_hash, allowed_branch_ids, created_at, staff_id)
       SELECT tenant_id, 'second-owner', 'second@example.com', 'Second', password_hash, allowed_branch_ids, created_at, $2
         FROM owner_users WHERE user_id = $1`,
      [f.userId, seededStaffId],
    );
    await expectRefused(seededStaffId, 'Ada', /already linked to second-owner/);

    // the link
    expect(await link(y.staff_id, 'Yusuf'), errors.join('\n')).toBe(0);
    expect(await linkedStaff()).toBe(y.staff_id);
    expect(await audits()).toEqual([
      {
        entity: 'owner_user',
        entity_id: f.userId,
        action: 'update',
        actor_kind: 'cli',
        actor_owner_user_id: null,
        before: { staff_id: null },
        after: { staff_id: y.staff_id },
      },
    ]);
    expect(out.join('\n')).toContain('a@example.com');

    // test 69's write now meets the normal own-admin guard (no owner_not_linked)
    const stripped = await cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/staff/${y.staff_id}`,
      headers: auth(),
      payload: { expected_version: y.version, role_ids: [await roleId('cashier')] },
    });
    expect(stripped.statusCode, stripped.body).toBe(409);
    expect(stripped.json().error.code).toBe('OWN_ADMIN_ACCESS');
    expect(stripped.json().error.details.reason).toBeUndefined();

    // the same link again: exit 0, nothing written
    out = [];
    expect(await link(y.staff_id, 'Yusuf')).toBe(0);
    expect(out.join('\n')).toMatch(/already linked/);
    expect(await audits()).toHaveLength(1);

    // a tenant with no branch
    const bare = await seedTenant(
      new SystemContext(cloud.pool),
      { name: 'Bare', currency: 'PKR', ownerEmail: 'bare@example.com', ownerName: 'Cy', password: 'password-1', pin: '1234' },
      { clock: cloud.clock, ids: ulidGen(cloud.clock) },
    );
    await cloud.pool.query(`UPDATE owner_users SET staff_id = NULL WHERE user_id = $1`, [bare.user_id]);
    await expectRefused(bare.staff_id, 'Cy', /the tenant has no branch yet/, bare.user_id);
  });

  it('[01b #97] the target must be a qualifying admin at every branch; the message lists each other branch by name and id', async () => {
    const [a, b, c] = f.branches;
    // Y qualifies at A only. Denials are per person (no branch column), so B and C are branches Y is not assigned to (AD-25).
    const y = await person('Yara', 'owner', [a]);
    const message = new RegExp(`Yara is not a qualifying admin at Branch B \\(${b}\\), Branch C \\(${c}\\)$`);
    await unlink();
    await expectRefused(y.staff_id, 'Yara', message); // first link
    expect(errors.join('\n')).not.toContain(a);
    await cloud.pool.query(`UPDATE owner_users SET staff_id = $2 WHERE user_id = $1`, [f.userId, seededStaffId]);
    await expectRefused(y.staff_id, 'Yara', message); // re-link

    const moved = await cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/staff/${y.staff_id}`,
      headers: auth(),
      payload: { expected_version: y.version, branch_ids: [a, b, c] },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(await link(y.staff_id, 'Yara'), errors.join('\n')).toBe(0);
    expect(await linkedStaff()).toBe(y.staff_id);
    expect((await audits()).map((row) => [row.before, row.after])).toEqual([[{ staff_id: seededStaffId }, { staff_id: y.staff_id }]]);
  });

  it('[01b #100] --confirm-name must equal the display name byte for byte; the target is printed first', async () => {
    const y = await person('Ali Raza', 'owner', [...f.branches]);
    await unlink();
    for (const wrong of [undefined, 'ali raza', 'Ali  Raza', 'Ali Raza ']) {
      out = [];
      await expectRefused(y.staff_id, wrong, /confirm-name does not match/);
      const printed = out.join('\n');
      expect(printed).toContain('Ali Raza');
      expect(printed).toContain('Owner');
      for (const name of ['Branch A', 'Branch B', 'Branch C']) expect(printed).toContain(name);
    }
    expect(await link(y.staff_id, 'Ali Raza'), errors.join('\n')).toBe(0);
    expect(await linkedStaff()).toBe(y.staff_id);
  });

  const patchStaff = (staffId: string, payload: Record<string, unknown>) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/staff/${staffId}`, headers: auth(), payload });
  const deny = async (staff: Staff, permission: string) => {
    const denied = await patchStaff(staff.staff_id, { expected_version: staff.version, denied_permissions: [permission] });
    expect(denied.statusCode, denied.body).toBe(200);
  };
  // Pauses at `hook`; `held` resolves once it is reached, `release()` lets it go on.
  const gate = () => {
    let reached!: () => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (reached = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    const hook = async () => {
      reached();
      await released;
    };
    return { held, release, hook };
  };
  // True once some backend waits on a lock.
  const lockWaiter = async (timeoutMs = 5_000) => {
    for (let waited = 0; waited < timeoutMs; waited += 25) {
      const rows = await cloud.pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if (Number(rows.rows[0]!.n) > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  };

  it('[01b #95] corrective re-link from X to Y, both qualifying admins at every branch', async () => {
    const y = await person('Yusuf', 'owner', [...f.branches]);
    expect(await link(y.staff_id, 'Yusuf'), errors.join('\n')).toBe(0);
    expect(await linkedStaff()).toBe(y.staff_id);
    expect(await audits()).toEqual([
      {
        entity: 'owner_user',
        entity_id: f.userId,
        action: 'update',
        actor_kind: 'cli',
        actor_owner_user_id: null,
        before: { staff_id: seededStaffId },
        after: { staff_id: y.staff_id },
      },
    ]);
    expect(out.join('\n')).toContain(`link: ${seededStaffId} → ${y.staff_id}`);

    const stripped = await patchStaff(y.staff_id, { expected_version: y.version, role_ids: [await roleId('cashier')] });
    expect(stripped.statusCode, stripped.body).toBe(409);
    expect(stripped.json().error.code).toBe('OWN_ADMIN_ACCESS');
  });

  it('[01b #95] re-link from a row that qualifies nowhere to a non-admin → exit 1 (no vacuous pass)', async () => {
    // X loses its admin access by hand-edited data
    await cloud.pool.query(`DELETE FROM staff_roles WHERE tenant_id = $1 AND staff_id = $2`, [f.tenantId, seededStaffId]);
    const cook = await person('Cook One', 'cook', [...f.branches], { pin: false });
    await expectRefused(cook.staff_id, 'Cook One', /Cook One is not a qualifying admin at Branch A/);
    expect(await linkedStaff()).toBe(seededStaffId);
  });

  it('[01b #95] re-link to a row with no PIN, without manage-devices, with a denial of access-hub-admin, or that has left → exit 1', async () => {
    const noPin = await person('Nadia', 'owner', [...f.branches], { pin: false });
    await expectRefused(noPin.staff_id, 'Nadia', /Nadia is not a qualifying admin at/);

    const noDevices = await person('Danish', 'owner', [...f.branches]);
    await deny(noDevices, 'manage-devices');
    await expectRefused(noDevices.staff_id, 'Danish', /Danish is not a qualifying admin at/);

    const noHubAdmin = await person('Hina', 'owner', [...f.branches]);
    await deny(noHubAdmin, 'access-hub-admin');
    await expectRefused(noHubAdmin.staff_id, 'Hina', /Hina is not a qualifying admin at/);

    const leaver = await person('Lena', 'owner', [...f.branches]);
    const left = await patchStaff(leaver.staff_id, { expected_version: leaver.version, is_active: false });
    expect(left.statusCode, left.body).toBe(200);
    await expectRefused(leaver.staff_id, 'Lena', /staff has left/);
    expect(await linkedStaff()).toBe(seededStaffId);
  });

  it('[01b #99 a] a staff PATCH removing Y\'s manage-devices holds the tenant lock: the CLI waits, then exits 1 listing the branches', async () => {
    const y = await person('Yusuf', 'owner', [...f.branches]);
    const pause = gate();
    barrier = () => {
      barrier = undefined;
      return pause.hook();
    };
    const patching = patchStaff(y.staff_id, { expected_version: y.version, denied_permissions: ['manage-devices'] });
    await pause.held;
    const linking = link(y.staff_id, 'Yusuf');
    expect(await lockWaiter(), 'the CLI waits on the tenant row').toBe(true);
    pause.release();

    const patched = await patching;
    expect(patched.statusCode, patched.body).toBe(200);
    expect(await linking).toBe(1);
    expect(errors.join('\n')).toMatch(/Yusuf is not a qualifying admin at Branch A \(.+\), Branch B \(.+\), Branch C \(.+\)$/);
    expect(await linkedStaff()).toBe(seededStaffId);
    expect(await audits()).toHaveLength(0);
  });

  it('[01b #99 b] the CLI holds the tenant lock: the same PATCH waits, then → 409 OWN_ADMIN_ACCESS', async () => {
    const y = await person('Yusuf', 'owner', [...f.branches]);
    const pause = gate();
    const linking = link(y.staff_id, 'Yusuf', f.userId, { afterTenantLock: pause.hook });
    await pause.held;
    const patching = patchStaff(y.staff_id, { expected_version: y.version, denied_permissions: ['manage-devices'] });
    expect(await lockWaiter(), 'the PATCH waits on the tenant row').toBe(true);
    pause.release();

    expect(await linking, errors.join('\n')).toBe(0);
    expect(await linkedStaff()).toBe(y.staff_id);
    const patched = await patching;
    expect(patched.statusCode, patched.body).toBe(409);
    expect(patched.json().error.code).toBe('OWN_ADMIN_ACCESS');
  });

  it('[01b §6.15a] usage: --owner and --staff are required', async () => {
    expect(await link('')).toBe(1);
    errors = [];
    expect(await runLinkOwnerStaff(['--owner', f.userId], { sys: new SystemContext(cloud.pool), clock: cloud.clock, ids: ulidGen(cloud.clock), out: () => {}, err: (line) => errors.push(line) })).toBe(1);
    expect(errors.join('\n')).toMatch(/usage/);
  });
});
