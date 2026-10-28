import { canonicalJson, sha256hex } from '@pos/domain/hash';
import { describe, expect, it } from 'vitest';
import {
  responsibilitySetVersion,
  roleVersion,
  staffVersion,
  toResponsibilitySet,
  toRoleWire,
  toStaffWire,
  withVersion,
  type ResponsibilityRow,
  type RoleRow,
  type StaffRow,
} from './versions';

function aStaffRow(o: Partial<StaffRow> = {}): StaffRow {
  return {
    staff_id: 'S1',
    display_name: 'Bilal',
    role_ids: ['R2', 'R1'],
    branch_ids: ['B2', 'B1'],
    denied_permissions: ['void-item', 'apply-discount'],
    has_pin: true,
    pin_set_at: 1_000,
    is_active: true,
    left_at: null,
    reports_to: [
      { branch_id: 'B2', lead_staff_id: 'S9' },
      { branch_id: 'B1', lead_staff_id: 'S8' },
    ],
    floors: [
      { branch_id: 'B2', floor_ids: ['F3'] },
      { branch_id: 'B1', floor_ids: ['F2', 'F1'] },
    ],
    ...o,
  };
}

function aRoleRow(o: Partial<RoleRow> = {}): RoleRow {
  return {
    role_id: 'R1',
    name: 'Waiter',
    default_key: 'waiter',
    archived_at: null,
    session_idle_ttl_ms: 300_000,
    staff_count: 3,
    grants: [
      { permission: 'take-order-anywhere', grant_type: 'allowed', approver_role_ids: [], scope: 'my_floors' },
      { permission: 'apply-discount', grant_type: 'requires_approval', approver_role_ids: ['R9', 'R3'], scope: 'branch' },
    ],
    ...o,
  };
}

describe('versions (01b B23, §5.3)', () => {
  it('[01b §5.3] staffVersion hashes exactly the eight input keys; pin_set_at and left_at do not change it', () => {
    const wire = toStaffWire(aStaffRow());
    expect(staffVersion(wire)).toBe(
      sha256hex(
        canonicalJson({
          staff_id: 'S1',
          display_name: 'Bilal',
          role_ids: ['R1', 'R2'],
          branch_ids: ['B1', 'B2'],
          denied_permissions: ['apply-discount', 'void-item'],
          reports_to: [
            { branch_id: 'B1', lead_staff_id: 'S8' },
            { branch_id: 'B2', lead_staff_id: 'S9' },
          ],
          floors: [
            { branch_id: 'B1', floor_ids: ['F1', 'F2'] },
            { branch_id: 'B2', floor_ids: ['F3'] },
          ],
          is_active: true,
        }),
      ),
    );
    expect(staffVersion(toStaffWire(aStaffRow({ pin_set_at: 2_000, has_pin: false })))).toBe(staffVersion(wire));
    expect(staffVersion(toStaffWire(aStaffRow({ left_at: 5_000 })))).toBe(staffVersion(wire));
    expect(staffVersion(toStaffWire(aStaffRow({ is_active: false })))).not.toBe(staffVersion(wire));
    expect(staffVersion(toStaffWire(aStaffRow({ display_name: 'Bilal K' })))).not.toBe(staffVersion(wire));
  });

  it('[01b §5.3] arrays in reverse order and BIGINT strings give the same wire and version', () => {
    const row = aStaffRow();
    const reversed = aStaffRow({
      role_ids: [...row.role_ids].reverse(),
      branch_ids: [...row.branch_ids].reverse(),
      denied_permissions: [...row.denied_permissions].reverse(),
      reports_to: [...row.reports_to].reverse(),
      floors: row.floors.map((entry) => ({ ...entry, floor_ids: [...entry.floor_ids].reverse() })).reverse(),
      pin_set_at: '1000' as unknown as number,
    });
    expect(toStaffWire(reversed)).toEqual(toStaffWire(row));
    expect(staffVersion(toStaffWire(reversed))).toBe(staffVersion(toStaffWire(row)));
    expect(toStaffWire(row).role_ids).toEqual(['R1', 'R2']);

    const role = aRoleRow();
    const roleFromStrings = aRoleRow({
      grants: [...role.grants].reverse().map((grant) => ({ ...grant, approver_role_ids: [...grant.approver_role_ids].reverse() })),
      session_idle_ttl_ms: '300000' as unknown as number,
      staff_count: '3' as unknown as number,
    });
    expect(toRoleWire(roleFromStrings)).toEqual(toRoleWire(role));
    expect(roleVersion(toRoleWire(roleFromStrings))).toBe(roleVersion(toRoleWire(role)));
    expect(toRoleWire(role).grants.map((grant) => grant.permission)).toEqual(['apply-discount', 'take-order-anywhere']);
    expect(toRoleWire(role).grants[0]!.approver_role_ids).toEqual(['R3', 'R9']);
  });

  it('[01b §5.3] an undefined value throws instead of hashing differently', () => {
    const wire = toStaffWire(aStaffRow());
    expect(() => staffVersion({ ...wire, display_name: undefined as unknown as string })).toThrow();
    const role = toRoleWire(aRoleRow());
    expect(() => roleVersion({ ...role, archived_at: undefined as unknown as null })).toThrow();
  });

  it('[01b §5.3] roleVersion ignores staff_count and is_default; archived is a boolean', () => {
    const wire = toRoleWire(aRoleRow());
    expect(wire).toMatchObject({ is_default: true, idle_minutes: 5, staff_count: 3, archived_at: null });
    expect(roleVersion(wire)).toBe(
      sha256hex(
        canonicalJson({
          role_id: 'R1',
          name: 'Waiter',
          idle_minutes: 5,
          archived: false,
          grants: [
            { permission: 'apply-discount', grant_type: 'requires_approval', approver_role_ids: ['R3', 'R9'], scope: 'branch' },
            { permission: 'take-order-anywhere', grant_type: 'allowed', approver_role_ids: [], scope: 'my_floors' },
          ],
        }),
      ),
    );
    expect(roleVersion(toRoleWire(aRoleRow({ staff_count: 9, default_key: null })))).toBe(roleVersion(wire));
    const archivedEarly = roleVersion(toRoleWire(aRoleRow({ archived_at: 1_000 })));
    const archivedLate = roleVersion(toRoleWire(aRoleRow({ archived_at: 2_000 })));
    expect(archivedEarly).toBe(archivedLate);
    expect(archivedEarly).not.toBe(roleVersion(wire));
  });

  it('[01b §5.3] responsibilitySetVersion sorts by station_id, then responsibility; archived stations are left out', () => {
    const rows: ResponsibilityRow[] = [
      { responsibility: 'count_stock', station_id: 'ST_B', subject_kind: 'staff', subject_id: 'S2', station_archived_at: null },
      { responsibility: 'count_stock', station_id: 'ST_A', subject_kind: 'role', subject_id: 'R2', station_archived_at: null },
      { responsibility: 'count_stock', station_id: 'ST_A', subject_kind: 'staff', subject_id: 'S9', station_archived_at: null },
      { responsibility: 'count_stock', station_id: 'ST_A', subject_kind: 'staff', subject_id: 'S1', station_archived_at: null },
      { responsibility: 'count_stock', station_id: 'ST_A', subject_kind: 'role', subject_id: 'R1', station_archived_at: null },
      { responsibility: 'count_stock', station_id: 'ST_OLD', subject_kind: 'staff', subject_id: 'S1', station_archived_at: 5 },
    ];
    const set = toResponsibilitySet('B1', rows);
    expect(set).toEqual([
      { responsibility: 'count_stock', station_id: 'ST_A', staff_ids: ['S1', 'S9'], role_ids: ['R1', 'R2'] },
      { responsibility: 'count_stock', station_id: 'ST_B', staff_ids: ['S2'], role_ids: [] },
    ]);
    expect(responsibilitySetVersion('B1', set)).toBe(sha256hex(canonicalJson({ branch_id: 'B1', responsibilities: set })));
    expect(responsibilitySetVersion('B1', toResponsibilitySet('B1', [...rows].reverse()))).toBe(responsibilitySetVersion('B1', set));
    expect(responsibilitySetVersion('B2', set)).not.toBe(responsibilitySetVersion('B1', set));
    expect(toResponsibilitySet('B1', [])).toEqual([]);
  });

  it('[01b §5.3] withVersion adds the version key', () => {
    const wire = toRoleWire(aRoleRow());
    expect(withVersion(wire, 'abc')).toEqual({ ...wire, version: 'abc' });
  });
});
