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
