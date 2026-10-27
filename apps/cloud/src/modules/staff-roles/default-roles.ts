import { PERMISSIONS, type DefaultKey, type Permission } from '@pos/domain';

// 01b §6.15, B17: the default roles and their stable default_key. The only source file allowed to hold
// default role names (§3.8); everything else finds a default role by default_key.

export interface DefaultGrant {
  permission: Permission;
  grant_type: 'allowed' | 'requires_approval';
  approver_key?: DefaultKey;
}

export interface DefaultRole {
  default_key: DefaultKey;
  name: 'Owner' | 'Manager' | 'Cashier' | 'Order taker' | 'Waiter' | 'Cook';
  session_idle_ttl_ms: number;
  grants: readonly DefaultGrant[];
}

function allowed(permission: Permission): DefaultGrant {
  return { permission, grant_type: 'allowed' };
}

export const DEFAULT_ROLES: readonly DefaultRole[] = [
  {
    default_key: 'owner',
    name: 'Owner',
    session_idle_ttl_ms: 3_600_000,
    grants: PERMISSIONS.map((permission) => allowed(permission)),
  },
  {
    default_key: 'manager',
    name: 'Manager',
    session_idle_ttl_ms: 3_600_000,
    grants: PERMISSIONS.filter((permission) => permission !== 'manage-roles').map((permission) => allowed(permission)),
  },
  {
    default_key: 'cashier',
    name: 'Cashier',
    session_idle_ttl_ms: 900_000,
    grants: [
      { permission: 'apply-discount', grant_type: 'requires_approval', approver_key: 'manager' },
      allowed('reprint-ticket'),
    ],
  },
  { default_key: 'order_taker', name: 'Order taker', session_idle_ttl_ms: 900_000, grants: [] },
  { default_key: 'waiter', name: 'Waiter', session_idle_ttl_ms: 300_000, grants: [] },
  { default_key: 'cook', name: 'Cook', session_idle_ttl_ms: 300_000, grants: [] },
];
