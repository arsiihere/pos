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
export type Scope = 'branch' | 'own_tables' | 'my_floors' | 'my_team' | 'my_stations';

export const SCOPES: readonly Scope[] = ['branch', 'own_tables', 'my_floors', 'my_team', 'my_stations'];

const WIDER_SCOPES: Partial<Record<Permission, readonly Scope[]>> = {
  'take-order-anywhere': ['branch', 'my_floors'],
  'force-release-table-lock': ['branch', 'my_floors'],
  'approve-void': ['branch', 'my_team'],
  'manage-stock': ['branch', 'my_stations'],
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
};

export const PERMISSION_CATALOGUE: readonly { key: Permission; group: PermissionGroup; scopes: readonly Scope[] }[] =
  PERMISSIONS.map((key) => ({ key, group: GROUPS[key], scopes: PERMISSION_SCOPES[key] }));

// 01b B17: stable handles of the default roles (roles.default_key).
export const DEFAULT_KEYS = ['owner', 'manager', 'cashier', 'order_taker', 'waiter', 'cook'] as const;
export type DefaultKey = (typeof DEFAULT_KEYS)[number];
