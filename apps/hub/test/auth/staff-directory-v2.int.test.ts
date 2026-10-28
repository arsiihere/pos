import { PERMISSIONS } from '@pos/domain';
import type { DirectoryInput } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { currentDirectory } from '../../src/auth/guards';
import { StaffDirectory } from '../../src/auth/staff-directory';
import { PIN, pinHash } from '../helpers/fixtures';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';

type Grant = DirectoryInput['roles'][number]['permissions'][number];
type Staff = DirectoryInput['staff'][number];

describe('StaffDirectory v2 lookups (01b §3.5, §3.6)', () => {
  const hubs: TestHub[] = [];
  afterEach(async () => {
    for (const h of hubs.splice(0)) await h.close();
  });

  async function hubWith(d: DirectoryInput): Promise<{ applied: StaffDirectory; reloaded: StaffDirectory }> {
    const h = await createTestHub();
    hubs.push(h);
    await seedDirectory(h, d);
    return { applied: currentDirectory(h.app), reloaded: StaffDirectory.load(h.deps.db) };
  }

  it('[01b #31] leadOf / teamOf return the branch line; a reporting line changes no resolve result', async () => {
    const hash = await pinHash(PIN.a);
    const lined = await hubWith(teamDirectory(hash, true));
    const unlined = await hubWith(teamDirectory(hash, false));
    for (const directory of [lined.applied, lined.reloaded]) {
      expect(directory.leadOf('S_W1')).toBe('S_LEAD');
      expect(directory.leadOf('S_W2')).toBe('S_LEAD');
      expect(directory.leadOf('S_LEAD')).toBeNull();
      expect(directory.teamOf('S_LEAD')).toEqual(['S_W1', 'S_W2']);
      expect(directory.teamOf('S_W1')).toEqual([]);
      expect(directory.leadOf('S_MISSING')).toBeNull();
      expect(directory.teamOf('S_MISSING')).toEqual([]);
    }
    for (const staffId of ['S_LEAD', 'S_W1', 'S_W2']) {
      expect(lined.applied.permissionsOf(staffId)).toEqual(unlined.applied.permissionsOf(staffId));
      expect(lined.reloaded.permissionsOf(staffId)).toEqual(unlined.applied.permissionsOf(staffId));
    }
  });

  it('[01b #33] a role listed on a station gives every holder at the branch the station (stationsOf)', async () => {
    const hash = await pinHash(PIN.a);
    const { applied, reloaded } = await hubWith({
      directory_version: 1,
      roles: [role('R_GRILL', 'Grill cook', 300_000, []), role('R_CASH', 'Cashier', 900_000, [])],
      staff: [
        person('S_G1', 'Grill one', hash, ['R_GRILL']),
        person('S_G2', 'Grill two', hash, ['R_GRILL']),
        person('S_C', 'Counter', hash, ['R_CASH']),
      ],
      responsibilities: [
        { responsibility: 'count_stock', station_id: 'ST_GRILL', staff_ids: [], role_ids: ['R_GRILL'] },
        { responsibility: 'count_stock', station_id: 'ST_BAR', staff_ids: ['S_C'], role_ids: [] },
        { responsibility: 'count_stock', station_id: 'ST_TANDOOR', staff_ids: ['S_G2'], role_ids: [] },
      ],
    });
    for (const directory of [applied, reloaded]) {
      expect(directory.stationsOf('S_G1', 'count_stock')).toEqual(['ST_GRILL']);
      expect(directory.stationsOf('S_G2', 'count_stock')).toEqual(['ST_GRILL', 'ST_TANDOOR']);
      expect(directory.stationsOf('S_C', 'count_stock')).toEqual(['ST_BAR']);
      expect(directory.stationsOf('S_MISSING', 'count_stock')).toEqual([]);
      expect(directory.responsibilityHolders('ST_GRILL', 'count_stock')).toEqual(['S_G1', 'S_G2']);
      expect(directory.responsibilityHolders('ST_TANDOOR', 'count_stock')).toEqual(['S_G2']);
      expect(directory.responsibilityHolders('ST_NONE', 'count_stock')).toEqual([]);
      expect(directory.responsibilitiesOf('S_G1')).toEqual(['count_stock']);
      expect(directory.responsibilitiesOf('S_MISSING')).toEqual([]);
    }
  });

  it('[01b §3.2 rule 6] floorsOf returns the stored floors, sorted', async () => {
    const hash = await pinHash(PIN.a);
    const { applied, reloaded } = await hubWith({
      directory_version: 1,
      roles: [role('R_W', 'Waiter', 300_000, [])],
      staff: [{ ...person('S_W', 'Waiter', hash, ['R_W']), floor_ids: ['F_ROOF', 'F_GROUND'] }],
      responsibilities: [],
    });
    for (const directory of [applied, reloaded]) {
      expect(directory.floorsOf('S_W')).toEqual(['F_GROUND', 'F_ROOF']);
      expect(directory.floorsOf('S_MISSING')).toEqual([]);
    }
  });

  it('[01b #18 hub half] a person with Waiter (5) and Manager (60) gets ttlFor 3 600 000', async () => {
    const hash = await pinHash(PIN.a);
    const { applied, reloaded } = await hubWith({
      directory_version: 1,
      roles: [role('R_WAIT', 'Waiter', 300_000, []), role('R_MGR', 'Manager', 3_600_000, allowedAll())],
      staff: [person('S_BOTH', 'Both', hash, ['R_WAIT', 'R_MGR'])],
      responsibilities: [],
    });
    expect(applied.ttlFor('S_BOTH')).toBe(3_600_000);
    expect(reloaded.ttlFor('S_BOTH')).toBe(3_600_000);
  });
});

function teamDirectory(hash: string, withLine: boolean): DirectoryInput {
  const lead = withLine ? 'S_LEAD' : null;
  return {
    directory_version: 1,
    roles: [
      role('R_MGR', 'Manager', 3_600_000, allowedAll()),
      role('R_W', 'Waiter', 300_000, [{ permission: 'approve-void', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'my_team' }]),
    ],
    staff: [
      person('S_LEAD', 'Lead', hash, ['R_MGR']),
      { ...person('S_W2', 'Waiter two', hash, ['R_W']), lead_staff_id: lead },
      { ...person('S_W1', 'Waiter one', hash, ['R_W']), lead_staff_id: lead },
    ],
    responsibilities: [],
  };
}

function allowedAll(): Grant[] {
  return PERMISSIONS.map((permission) => ({
    permission,
    grant_type: 'allowed' as const,
    approver_role_id: null,
    approver_role_ids: [],
    scope: 'branch' as const,
  }));
}

function role(role_id: string, name: string, session_idle_ttl_ms: number, permissions: Grant[]): DirectoryInput['roles'][number] {
  return { role_id, name, session_idle_ttl_ms, permissions };
}

function person(staff_id: string, display_name: string, pin_hash: string, role_ids: string[]): Staff {
  return { staff_id, display_name, pin_hash, role_ids, denied_permissions: [], lead_staff_id: null, floor_ids: [] };
}
