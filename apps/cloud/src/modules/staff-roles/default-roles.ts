import { PERMISSIONS, type DefaultKey, type Permission, type Scope } from '@pos/domain';

// 01b §6.15 (v1.7), B17: the default roles and their stable default_key. The only source file allowed to hold
// default role names (§3.8); everything else finds a default role by default_key.

export interface DefaultGrant {
  permission: Permission;
  grant_type: 'allowed' | 'requires_approval';
  approver_key?: DefaultKey;
  // Absent = `branch` (the column default).
  scope?: Scope;
}

export interface DefaultRole {
  default_key: DefaultKey;
  name: 'Owner' | 'Manager' | 'Cashier' | 'Order taker' | 'Waiter' | 'Cook';
  session_idle_ttl_ms: number;
  grants: readonly DefaultGrant[];
}

function allowed(permission: Permission, scope?: Scope): DefaultGrant {
  return scope === undefined ? { permission, grant_type: 'allowed' } : { permission, grant_type: 'allowed', scope };
}

function approvedByManager(permission: Permission): DefaultGrant {
  return { permission, grant_type: 'requires_approval', approver_key: 'manager' };
}

// ⚠️ Changed by 05 (row B-2), 01b v1.10 §6.15 (H6-13): Manager is "every permission but manage-roles" and that filter now
// also excludes the two Owner-only billing permissions.
const MANAGER_EXCLUDED: readonly Permission[] = ['manage-roles', 'skip-blind-count', 'manage-fiscal-settings'];

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
    grants: PERMISSIONS.filter((permission) => !MANAGER_EXCLUDED.includes(permission)).map((permission) => allowed(permission)),
  },
  {
    default_key: 'cashier',
    name: 'Cashier',
    session_idle_ttl_ms: 900_000,
    grants: [
      approvedByManager('apply-discount'),
      allowed('reprint-ticket'),
      // 02a v1.0 B-1 (01b v1.6): the counter takes orders and clears tables.
      allowed('take-order'),
      allowed('clean-table'),
      // 02b v1.0 B-1, B-5 (01b v1.7)
      allowed('set-line-weight'),
      approvedByManager('apply-comp'),
      allowed('view-customer-contact'),
      // ⚠️ Changed by 04 (row B-1), 01b v1.9: void with the Manager's approval; move-item-to-stock is allowed-only (B-2).
      approvedByManager('void-item'),
      allowed('move-item-to-stock'),
      // ⚠️ Changed by 05 (row B-2), 01b v1.10 §6.15: take-payment (branch), shift, drawer and petty cash allowed (the petty
      // limit still applies); discount, service-charge removal, reopen, comp removal, buyer-id waiver need the Manager.
      allowed('take-payment'),
      allowed('manage-own-shift'),
      allowed('open-cash-drawer'),
      allowed('record-petty-cash'),
      approvedByManager('remove-service-charge'),
      approvedByManager('reopen-bill'),
      approvedByManager('remove-comp'),
      approvedByManager('close-without-buyer-id'),
      // ⚠️ Changed by 01b v1.8.1 (owner ruling 2026-11-12, Q-23): the kiosk serves its counter takeaways; not boost-order.
      // Existing tenants get it from 0020_cashier_mark_served.sql (Q-34).
      allowed('mark-served'),
    ],
  },
  {
    default_key: 'order_taker',
    name: 'Order taker',
    session_idle_ttl_ms: 900_000,
    grants: [
      allowed('mark-served'),
      allowed('mark-item-returned'),
      allowed('take-order'),
      allowed('clean-table'),
      allowed('boost-order'),
      allowed('view-customer-contact', 'own_tables'),
      approvedByManager('apply-comp'),
      // ⚠️ Changed by 04 (row B-1), 01b v1.9: as Cashier.
      approvedByManager('void-item'),
      allowed('move-item-to-stock'),
      // ⚠️ Changed by 05 (row B-2), 01b v1.10 §6.15
      allowed('take-payment', 'own_tables'),
      allowed('manage-own-shift'),
    ],
  },
  // 02a v1.0 B-1: clean-table, not take-order (D-12).
  { default_key: 'waiter', name: 'Waiter', session_idle_ttl_ms: 300_000, grants: [allowed('mark-served'), allowed('clean-table')] },
  // ⚠️ Changed by 03b v1.0.1 B-1 (01b v1.8): run-pass, and reprint-ticket for the Pass card reprint (03c R-6);
  // overrides M29 / B17 "Cook has no permissions". Existing tenants are re-seeded (R29, G-5: no migration).
  { default_key: 'cook', name: 'Cook', session_idle_ttl_ms: 300_000, grants: [allowed('run-pass'), allowed('reprint-ticket')] },
];
