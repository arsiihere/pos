import type { Role, Staff } from '../../../api/cloud-admin';

// Test-only data for the staff views (tasks 51, 53).
export const BRANCHES = [
  { branch_id: 'B1', name: 'Gulberg', status: 'active', hub_last_seen_at: 1, hub_synced_at: 1 },
  { branch_id: 'B2', name: 'Johar Town', status: 'active', hub_last_seen_at: 1, hub_synced_at: 1 },
] as const;

export function role(o: Partial<Role> & Pick<Role, 'role_id' | 'name'>): Role {
  return { is_default: false, archived_at: null, idle_minutes: 10, staff_count: 0, grants: [], version: `v-${o.role_id}`, ...o };
}

export const ROLES: Role[] = [
  role({
    role_id: 'R_OWNER',
    name: 'Malik',
    is_default: true,
    grants: [
      { permission: 'access-hub-admin', grant_type: 'allowed', approver_role_ids: [], scope: 'branch' },
      { permission: 'manage-devices', grant_type: 'allowed', approver_role_ids: [], scope: 'branch' },
    ],
  }),
  role({
    role_id: 'R_WAITER',
    name: 'Bera',
    is_default: true,
    grants: [{ permission: 'void-item', grant_type: 'requires_approval', approver_role_ids: ['R_OWNER'], scope: 'branch' }],
  }),
  role({
    role_id: 'R_LEAD',
    name: 'Shift lead',
    grants: [
      { permission: 'take-order-anywhere', grant_type: 'allowed', approver_role_ids: [], scope: 'my_floors' },
      { permission: 'approve-void', grant_type: 'allowed', approver_role_ids: [], scope: 'my_team' },
    ],
  }),
];

export function person(o: Partial<Staff> & Pick<Staff, 'staff_id' | 'display_name'>): Staff {
  return {
    role_ids: ['R_WAITER'],
    branch_ids: ['B1'],
    denied_permissions: [],
    has_pin: true,
    pin_set_at: Date.UTC(2026, 9, 3),
    is_active: true,
    left_at: null,
    reports_to: [],
    floors: [],
    version: `v-${o.staff_id}`,
    ...o,
  };
}

export const STAFF: Staff[] = [
  person({ staff_id: 'S1', display_name: 'Arif', role_ids: ['R_OWNER'], branch_ids: ['B1', 'B2'] }),
  person({ staff_id: 'S2', display_name: 'Bilal', reports_to: [{ branch_id: 'B1', lead_staff_id: 'S3' }] }),
  person({ staff_id: 'S3', display_name: 'Hamza', role_ids: ['R_LEAD'], branch_ids: ['B1', 'B2'] }),
  person({ staff_id: 'S4', display_name: 'Usman', has_pin: false, pin_set_at: null }),
];
