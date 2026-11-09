import { PERMISSIONS } from '@pos/domain';
import type { BranchConfig, DirectoryInput } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { currentDirectory } from '../../src/auth/guards';
import { StaffDirectory } from '../../src/auth/staff-directory';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { PIN, pinHash } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';

type Grant = DirectoryInput['roles'][number]['permissions'][number];
type Staff = DirectoryInput['staff'][number];

describe('StaffDirectory v2 lookups (01b §3.5, §3.6)', () => {
  const hubs: TestHub[] = [];
  afterEach(async () => {
    for (const h of hubs.splice(0)) await h.close();
    swapBranchConfig(null);
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

  it('[01b B-4] run_station is carried beside count_stock with no new statement; stationsOf(staff, run_station) returns the stations', async () => {
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
        { responsibility: 'count_stock', station_id: 'ST_GRILL', staff_ids: ['S_G1'], role_ids: [] },
        { responsibility: 'run_station', station_id: 'ST_GRILL', staff_ids: [], role_ids: ['R_GRILL'] },
        { responsibility: 'run_station', station_id: 'ST_BAR', staff_ids: ['S_C'], role_ids: [] },
        { responsibility: 'run_station', station_id: 'ST_TANDOOR', staff_ids: ['S_G2'], role_ids: [] },
      ],
    });
    for (const directory of [applied, reloaded]) {
      expect(directory.stationsOf('S_G1', 'run_station')).toEqual(['ST_GRILL']);
      expect(directory.stationsOf('S_G2', 'run_station')).toEqual(['ST_GRILL', 'ST_TANDOOR']);
      expect(directory.stationsOf('S_C', 'run_station')).toEqual(['ST_BAR']);
      expect(directory.stationsOf('S_MISSING', 'run_station')).toEqual([]);
      expect(directory.responsibilityHolders('ST_GRILL', 'run_station')).toEqual(['S_G1', 'S_G2']);
      // count_stock is unchanged by the run_station rows at the same station.
      expect(directory.stationsOf('S_G1', 'count_stock')).toEqual(['ST_GRILL']);
      expect(directory.stationsOf('S_G2', 'count_stock')).toEqual([]);
      expect(directory.responsibilityHolders('ST_GRILL', 'count_stock')).toEqual(['S_G1']);
      expect(directory.responsibilitiesOf('S_G1')).toEqual(['count_stock', 'run_station']);
      expect(directory.responsibilitiesOf('S_C')).toEqual(['run_station']);
    }
    const h = hubs.at(-1)!;
    const counter = statementCounter(h.deps.db);
    StaffDirectory.load(h.deps.db);
    expect(counter.count).toBe(11); // 01b §5.2: the rows ride the existing responsibilities read (11 with B-2's assignments, AD-27)
  });

  // 02a §3.6, 01b v1.6 B-2 (AD-24, AD-25): the table's assignee, else its zone's, else none; only take-order holders.
  it('[02p U-3] assignedOrderTaker: table → zone → null', async () => {
    const hash = await pinHash(PIN.a);
    const { applied, reloaded } = await hubWith(assignmentDirectory(hash));
    // the applied directory reads the zone through the branch config holder (AD-25)
    swapBranchConfig(configWith([['T1', 'Z1'], ['T2', 'Z1'], ['T3', null], ['T4', 'Z2']]));
    const injected = StaffDirectory.load(hubs.at(-1)!.deps.db, { zoneOfTable: (tableId) => (tableId === 'T3' ? 'Z1' : null) });
    for (const directory of [applied, reloaded]) {
      expect(directory.assignedOrderTaker('T1')).toBe('S_TABLE'); // the table's assignee wins over the zone's
      expect(directory.assignedOrderTaker('T2')).toBe('S_ZONE');
      expect(directory.assignedOrderTaker('T3')).toBeNull(); // no zone
      expect(directory.assignedOrderTaker('T4')).toBeNull(); // a zone nobody is assigned
      expect(directory.assignedOrderTaker('T_UNKNOWN')).toBeNull();
    }
    // the reader is current after a config apply: T2 leaves the zone
    swapBranchConfig(configWith([['T1', 'Z1'], ['T2', null]]));
    expect(applied.assignedOrderTaker('T2')).toBeNull();
    swapBranchConfig(null); // no config yet: only table assignments count
    expect(applied.assignedOrderTaker('T1')).toBe('S_TABLE');
    expect(applied.assignedOrderTaker('T2')).toBeNull();
    // an injected reader
    expect(injected.assignedOrderTaker('T3')).toBe('S_ZONE');
    expect(injected.assignedOrderTaker('T2')).toBeNull();
    expect(injected.assignedOrderTaker('T1')).toBe('S_TABLE');
  });

  it('[02p U-3] an assignee without take-order is stored; assignedOrderTaker ignores them', async () => {
    const hash = await pinHash(PIN.a);
    const d = assignmentDirectory(hash);
    // a waiter (no take-order) holds table T2; an order taker with take-order denied holds zone Z2
    d.staff.push({ ...person('S_WAITER', 'Waiter', hash, ['R_W']), assigned_zone_ids: [], assigned_table_ids: ['T2'] });
    d.staff.push({ ...person('S_DENIED', 'Denied', hash, ['R_OT']), denied_permissions: ['take-order'], assigned_zone_ids: ['Z2'], assigned_table_ids: [] });
    const { applied, reloaded } = await hubWith(d);
    const db = hubs.at(-1)!.deps.db;
    expect(db.prepare('SELECT staff_id, subject_kind, subject_id FROM staff_assignments ORDER BY subject_kind, subject_id').all()).toEqual([
      { staff_id: 'S_TABLE', subject_kind: 'table', subject_id: 'T1' },
      { staff_id: 'S_WAITER', subject_kind: 'table', subject_id: 'T2' },
      { staff_id: 'S_ZONE', subject_kind: 'zone', subject_id: 'Z1' },
      { staff_id: 'S_DENIED', subject_kind: 'zone', subject_id: 'Z2' },
    ]);
    swapBranchConfig(configWith([['T2', 'Z1'], ['T4', 'Z2']]));
    for (const directory of [applied, reloaded]) {
      expect(directory.assignedOrderTaker('T2')).toBe('S_ZONE'); // the waiter's table assignment does not count
      expect(directory.assignedOrderTaker('T4')).toBeNull(); // nor the denied person's zone
    }
  });

  it('[01b AD-30] assignedOrderTaker counts only an allowed take-order grant, not requires_approval', async () => {
    const hash = await pinHash(PIN.a);
    const d = assignmentDirectory(hash);
    const approval: Grant = { permission: 'take-order', grant_type: 'requires_approval', approver_role_id: 'R_OT', approver_role_ids: ['R_OT'], scope: 'branch' };
    d.roles.push(role('R_TRAINEE', 'Trainee', 300_000, [approval]));
    d.staff.push({ ...person('S_TRAINEE', 'Trainee', hash, ['R_TRAINEE']), assigned_zone_ids: ['Z2'], assigned_table_ids: ['T5'] });
    const { applied, reloaded } = await hubWith(d);
    swapBranchConfig(configWith([['T5', 'Z1'], ['T6', 'Z2']]));
    for (const directory of [applied, reloaded]) {
      expect(directory.resolve('S_TRAINEE', 'take-order').grant).toBe('requires_approval');
      expect(directory.assignedOrderTaker('T5')).toBe('S_ZONE'); // the trainee's table does not count; the zone's allowed holder does
      expect(directory.assignedOrderTaker('T6')).toBeNull(); // the trainee's zone does not count
    }
  });

  it('[02p U-3] directory v3 carries the lists to the hub: stored, reloaded in 11 statements [01b AD-27]; a v2 directory applies with none', async () => {
    const hash = await pinHash(PIN.a);
    const { applied, reloaded } = await hubWith(assignmentDirectory(hash));
    expect(reloaded).toEqual(applied);
    const counter = statementCounter(hubs.at(-1)!.deps.db);
    StaffDirectory.load(hubs.at(-1)!.deps.db);
    expect(counter.count).toBe(11);
    // from an older cloud: no assignment keys at all
    const v2 = assignmentDirectory(hash);
    for (const row of v2.staff) {
      delete row.assigned_zone_ids;
      delete row.assigned_table_ids;
    }
    const old = await hubWith(v2);
    swapBranchConfig(configWith([['T1', 'Z1'], ['T2', 'Z1']]));
    expect(old.applied.assignedOrderTaker('T1')).toBeNull();
    expect(old.reloaded.assignedOrderTaker('T2')).toBeNull();
    expect(hubs.at(-1)!.deps.db.prepare('SELECT count(*) AS n FROM staff_assignments').get()).toEqual({ n: 0 });
  });

  it('[01b B18] a zone or table listed for two people (never sent by the cloud, unique index) keeps the first, the rest applies', async () => {
    const hash = await pinHash(PIN.a);
    const d = assignmentDirectory(hash);
    d.staff.push({ ...person('S_TWICE', 'Twice', hash, ['R_OT']), assigned_zone_ids: ['Z1', 'Z9', 'Z9'], assigned_table_ids: ['T1'] });
    const { applied, reloaded } = await hubWith(d);
    const db = hubs.at(-1)!.deps.db;
    expect(db.prepare('SELECT staff_id, subject_kind, subject_id FROM staff_assignments ORDER BY subject_kind, subject_id').all()).toEqual([
      { staff_id: 'S_TABLE', subject_kind: 'table', subject_id: 'T1' },
      { staff_id: 'S_ZONE', subject_kind: 'zone', subject_id: 'Z1' },
      { staff_id: 'S_TWICE', subject_kind: 'zone', subject_id: 'Z9' },
    ]);
    for (const directory of [applied, reloaded]) {
      swapBranchConfig(configWith([['T9', 'Z9'], ['T2', 'Z1']]));
      expect(directory.assignedOrderTaker('T9')).toBe('S_TWICE');
      expect(directory.assignedOrderTaker('T2')).toBe('S_ZONE');
      expect(directory.assignedOrderTaker('T1')).toBe('S_TABLE');
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

function assignmentDirectory(hash: string): DirectoryInput {
  const takeOrder: Grant = { permission: 'take-order', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'branch' };
  return {
    directory_version: 1,
    roles: [role('R_OT', 'Order taker', 900_000, [takeOrder]), role('R_W', 'Waiter', 300_000, [])],
    staff: [
      { ...person('S_ZONE', 'Zone', hash, ['R_OT']), assigned_zone_ids: ['Z1'], assigned_table_ids: [] },
      { ...person('S_TABLE', 'Table', hash, ['R_OT']), assigned_zone_ids: [], assigned_table_ids: ['T1'] },
    ],
    responsibilities: [],
  };
}

// Only what the zone reader looks at (floors[].tables[].zone_id, snapshot V4).
function configWith(tables: [string, string | null][]) {
  const config = { floors: [{ floor_id: 'F1', tables: tables.map(([table_id, zone_id]) => ({ table_id, zone_id })) }] } as unknown as BranchConfig;
  return { config, snapshotHash: 'h', configVersion: 1, snapshotSchemaVersion: 4, appliedAt: 0 };
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
