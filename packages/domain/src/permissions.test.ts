import { describe, expect, it } from 'vitest';
import { PERMISSIONS, assertKnownPermissions } from './permissions';

describe('permissions', () => {
  it('[00 §10 #74] a command declaring an unknown permission fails', () => {
    expect(() => assertKnownPermissions(['manage-devices', 'make-coffee'])).toThrow(/make-coffee/);
    expect(() => assertKnownPermissions(['nope', 'also-nope'])).toThrow(/Unknown permission: nope/);
    expect(() => assertKnownPermissions(['nope', 'also-nope'])).not.toThrow(/also-nope/);
    expect(() => assertKnownPermissions(['manage-devices', 'access-hub-admin'])).not.toThrow();
  });

  it('[00 §3.6] catalogue has 19 unique entries', () => {
    expect([...PERMISSIONS]).toEqual([
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
    ]);
  });
});
