export const PERMISSIONS = [
  'void-item',
  'move-item-to-stock',
  'mark-item-returned',
  'apply-discount',
  'apply-refund',
  'apply-comp',
  'reopen-bill',
  'edit-menu',
  'view-reports',
  'take-order-anywhere',
  'boost-order',
  'approve-void',
  'force-release-table-lock',
  'reprint-ticket',
  'view-audit-log',
  'manage-roles',
  'manage-staff',
  'manage-devices',
  'access-hub-admin',
  'manage-stock',
  'manage-stations',
  'mark-served',
  'take-order',
  'clean-table',
  'set-line-weight',
  'manage-zone-stock',
  'view-customer-contact',
  // ⚠️ Changed by 03b v1.0.1 B-1 (01b v1.8): run the Pass (kitchen group, scope branch; defaults Owner, Manager, Cook).
  'run-pass',
  // ⚠️ Changed by 05 (row B-1), 01b v1.10 §3.3, §4.2: eleven permissions in group `bills` (05 Billing).
  'take-payment',
  'manage-own-shift',
  'close-shift-for-others',
  'skip-blind-count',
  'record-petty-cash',
  'remove-service-charge',
  'close-business-day',
  'open-cash-drawer',
  'remove-comp',
  'close-without-buyer-id',
  'manage-fiscal-settings',
  // ⚠️ Changed by 01b v1.12 B-5 (OR-7; 02b v1.0.25 §3.7a): approve handing over an unpaid takeaway / parking order
  // (02b's `hand_over_unpaid` holders right; group orders, scope branch, allowed-only, listed-only). Persisted alert
  // permission enums carry it from AlertRaised v6 on (01d v1.3.7 §5.4; v1–v5 are frozen without it).
  'hand-over-unpaid',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(x: string): x is Permission {
  return (PERMISSIONS as readonly string[]).includes(x);
}

export function assertKnownPermissions(declared: Iterable<string>): void {
  for (const name of declared) {
    if (!isPermission(name)) throw new Error(`Unknown permission: ${name}`);
  }
}

// 01b §3.3 (B2): scopes a grant may carry, and which scopes each permission accepts.
export type Scope = 'branch' | 'own_tables' | 'my_floors' | 'my_team' | 'my_stations' | 'my_zones';

export const SCOPES: readonly Scope[] = ['branch', 'own_tables', 'my_floors', 'my_team', 'my_stations', 'my_zones'];

const WIDER_SCOPES: Partial<Record<Permission, readonly Scope[]>> = {
  'take-order-anywhere': ['branch', 'my_floors'],
  'force-release-table-lock': ['branch', 'my_floors'],
  'approve-void': ['branch', 'my_team'],
  'manage-stock': ['branch', 'my_stations'],
  'manage-stations': ['branch', 'my_stations'],
  'mark-served': ['branch', 'own_tables', 'my_floors'],
  // 01b v1.7 §3.3 (B-1..B-5; 02a v1.0 B-1; 02b v1.0 B-1..B-5)
  'take-order': ['branch', 'my_floors', 'own_tables'],
  'boost-order': ['branch', 'own_tables', 'my_floors'],
  'mark-item-returned': ['branch', 'own_tables', 'my_floors'],
  'manage-zone-stock': ['branch', 'my_zones'],
  'view-customer-contact': ['branch', 'my_floors', 'own_tables'],
  // ⚠️ Changed by 05 (row B-1), 01b v1.10 §3.3: the other ten bills permissions take `branch` only.
  'take-payment': ['branch', 'my_floors', 'own_tables'],
};

export const PERMISSION_SCOPES: Record<Permission, readonly Scope[]> = Object.fromEntries(
  PERMISSIONS.map((permission) => [permission, WIDER_SCOPES[permission] ?? ['branch']]),
) as Record<Permission, readonly Scope[]>;

// 01b §4.2: browser-safe catalogue for the roles editor; labels are client strings `perm.<key>`.
export type PermissionGroup = 'orders' | 'kitchen' | 'bills' | 'menu_stock' | 'people' | 'reports';

const GROUPS: Record<Permission, PermissionGroup> = {
  'void-item': 'orders',
  'move-item-to-stock': 'kitchen',
  'mark-item-returned': 'kitchen',
  'apply-discount': 'bills',
  'apply-refund': 'bills',
  'apply-comp': 'bills',
  'reopen-bill': 'bills',
  'edit-menu': 'menu_stock',
  'view-reports': 'reports',
  'take-order-anywhere': 'orders',
  'boost-order': 'orders',
  'approve-void': 'orders',
  'force-release-table-lock': 'orders',
  'reprint-ticket': 'kitchen',
  'view-audit-log': 'reports',
  'manage-roles': 'people',
  'manage-staff': 'people',
  'manage-devices': 'people',
  'access-hub-admin': 'people',
  'manage-stock': 'menu_stock',
  'manage-stations': 'kitchen',
  'mark-served': 'orders',
  'take-order': 'orders',
  'clean-table': 'orders',
  'set-line-weight': 'orders',
  'manage-zone-stock': 'orders',
  'view-customer-contact': 'orders',
  'run-pass': 'kitchen',
  // ⚠️ Changed by 05 (row B-1), 01b v1.10 §4.2
  'take-payment': 'bills',
  'manage-own-shift': 'bills',
  'close-shift-for-others': 'bills',
  'skip-blind-count': 'bills',
  'record-petty-cash': 'bills',
  'remove-service-charge': 'bills',
  'close-business-day': 'bills',
  'open-cash-drawer': 'bills',
  'remove-comp': 'bills',
  'close-without-buyer-id': 'bills',
  'manage-fiscal-settings': 'bills',
  // ⚠️ Changed by 01b v1.12 B-5 (§4.2): scope `branch` only (the default)
  'hand-over-unpaid': 'orders',
};

export const PERMISSION_CATALOGUE: readonly { key: Permission; group: PermissionGroup; scopes: readonly Scope[] }[] =
  PERMISSIONS.map((key) => ({ key, group: GROUPS[key], scopes: PERMISSION_SCOPES[key] }));

// ⚠️ Changed by 04 (row B-2), 01b v1.9 §3.3: permissions that can only be `allowed`, never `requires_approval`
// (owner OQ-A). The roles API refuses the grant (422) and the roles editor does not offer it.
// ⚠️ Changed by 05 (row B-1), 01b v1.10 §3.3: + seven bills permissions. The approvable bills permissions are
// apply-discount, remove-service-charge, reopen-bill, remove-comp, close-without-buyer-id, record-petty-cash
// (apply-refund stays, unused in the pilot): every permission not listed here may be `requires_approval`.
export const ALLOWED_ONLY_PERMISSIONS = [
  'move-item-to-stock',
  'take-payment',
  'manage-own-shift',
  'close-shift-for-others',
  'skip-blind-count',
  'close-business-day',
  'open-cash-drawer',
  'manage-fiscal-settings',
  // ⚠️ Changed by 01b v1.12 B-5 (§3.3, R2-M-3): an answer right; `requires_approval` makes no sense
  'hand-over-unpaid',
] as const satisfies readonly Permission[];

// 01b B17: stable handles of the default roles (roles.default_key).
export const DEFAULT_KEYS = ['owner', 'manager', 'cashier', 'order_taker', 'waiter', 'cook'] as const;
export type DefaultKey = (typeof DEFAULT_KEYS)[number];

// 05a §3.3: permissions usable only on a device whose access is `listed`, and money permissions an `everyone` device downgrades.
export const LISTED_ONLY_PERMISSIONS: readonly Permission[] = [
  'access-hub-admin',
  'manage-devices',
  'manage-staff',
  'manage-roles',
  'manage-fiscal-settings',
  'approve-void',
  'view-audit-log',
  // ⚠️ Changed by 05a v1.0.7 L-1 (OR-7; 02b TK-13): approving an unpaid hand-over is done on the manager's own listed device
  'hand-over-unpaid',
];

export const MONEY_PERMISSIONS: readonly Permission[] = [
  'void-item',
  'apply-discount',
  'apply-comp',
  'apply-refund',
  'reopen-bill',
];
