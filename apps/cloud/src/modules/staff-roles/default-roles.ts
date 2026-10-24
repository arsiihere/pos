import { PERMISSIONS, type Permission } from '@pos/domain';

export interface DefaultGrant {
  permission: Permission;
  grant_type: 'allowed' | 'requires_approval';
  approver_role?: 'Manager';
}

export interface DefaultRole {
  name: 'Owner' | 'Manager' | 'Cashier' | 'Order taker';
  session_idle_ttl_ms: number;
  grants: readonly DefaultGrant[];
}

function allowed(permission: Permission): DefaultGrant {
  return { permission, grant_type: 'allowed' };
}

export const DEFAULT_ROLES: readonly DefaultRole[] = [
  {
    name: 'Owner',
    session_idle_ttl_ms: 3_600_000,
    grants: PERMISSIONS.map((permission) => allowed(permission)),
  },
  {
    name: 'Manager',
    session_idle_ttl_ms: 3_600_000,
    grants: PERMISSIONS.filter((permission) => permission !== 'manage-roles').map((permission) => allowed(permission)),
  },
  {
    name: 'Cashier',
    session_idle_ttl_ms: 1_800_000,
    grants: [
      { permission: 'apply-discount', grant_type: 'requires_approval', approver_role: 'Manager' },
      allowed('reprint-ticket'),
    ],
  },
  {
    name: 'Order taker',
    session_idle_ttl_ms: 300_000,
    grants: [],
  },
];
