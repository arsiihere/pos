import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYS,
  PERMISSIONS,
  PERMISSION_CATALOGUE,
  PERMISSION_SCOPES,
  SCOPES,
  assertKnownPermissions,
} from './permissions';

describe('permissions', () => {
  it('[00 §10 #74] a command declaring an unknown permission fails', () => {
    expect(() => assertKnownPermissions(['manage-devices', 'make-coffee'])).toThrow(/make-coffee/);
    expect(() => assertKnownPermissions(['nope', 'also-nope'])).toThrow(/Unknown permission: nope/);
    expect(() => assertKnownPermissions(['nope', 'also-nope'])).not.toThrow(/also-nope/);
    expect(() => assertKnownPermissions(['manage-devices', 'access-hub-admin'])).not.toThrow();
  });

  it('[00 §3.6, 01a S18] catalogue has 20 unique entries', () => {
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
      'manage-stock',
    ]);
    expect(new Set(PERMISSIONS).size).toBe(20);
  });

  it('[01b §3.3] PERMISSION_SCOPES', () => {
    expect(SCOPES).toEqual(['branch', 'own_tables', 'my_floors', 'my_team', 'my_stations']);
    expect(PERMISSION_SCOPES['take-order-anywhere']).toEqual(['branch', 'my_floors']);
    expect(PERMISSION_SCOPES['force-release-table-lock']).toEqual(['branch', 'my_floors']);
    expect(PERMISSION_SCOPES['approve-void']).toEqual(['branch', 'my_team']);
    expect(PERMISSION_SCOPES['manage-stock']).toEqual(['branch', 'my_stations']);
    const special = ['take-order-anywhere', 'force-release-table-lock', 'approve-void', 'manage-stock'];
    for (const permission of PERMISSIONS) {
      if (!special.includes(permission)) expect(PERMISSION_SCOPES[permission]).toEqual(['branch']);
      expect(PERMISSION_SCOPES[permission]).not.toContain('own_tables');
    }
    expect(Object.keys(PERMISSION_SCOPES).sort()).toEqual([...PERMISSIONS].sort());
  });

  it('[01b §4.2] PERMISSION_CATALOGUE has one row per permission, each in one of the six groups', () => {
    expect(PERMISSION_CATALOGUE.map((row) => row.key)).toEqual([...PERMISSIONS]);
    const groups = ['orders', 'kitchen', 'bills', 'menu_stock', 'people', 'reports'];
    for (const row of PERMISSION_CATALOGUE) {
      expect(groups).toContain(row.group);
      expect(row.scopes).toEqual(PERMISSION_SCOPES[row.key]);
    }
    expect(new Set(PERMISSION_CATALOGUE.map((row) => row.group))).toEqual(new Set(groups));
  });

  it('[01b B17] DEFAULT_KEYS is the six keys in order', () => {
    expect([...DEFAULT_KEYS]).toEqual(['owner', 'manager', 'cashier', 'order_taker', 'waiter', 'cook']);
  });
});
