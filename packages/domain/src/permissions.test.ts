import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYS,
  PERMISSIONS,
  PERMISSION_CATALOGUE,
  PERMISSION_SCOPES,
  SCOPES,
  assertKnownPermissions,
} from './permissions';

const FIVE = ['take-order', 'clean-table', 'set-line-weight', 'manage-zone-stock', 'view-customer-contact'];
const WIDENED = ['boost-order', 'mark-item-returned'];

describe('permissions', () => {
  it('[00 §10 #74] a command declaring an unknown permission fails', () => {
    expect(() => assertKnownPermissions(['manage-devices', 'make-coffee'])).toThrow(/make-coffee/);
    expect(() => assertKnownPermissions(['nope', 'also-nope'])).toThrow(/Unknown permission: nope/);
    expect(() => assertKnownPermissions(['nope', 'also-nope'])).not.toThrow(/also-nope/);
    expect(() => assertKnownPermissions(['manage-devices', 'access-hub-admin'])).not.toThrow();
  });

  it('[00 §3.6, 01a S18, 01b B-1, B-2] catalogue has 27 unique entries', () => {
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
      'manage-stations',
      'mark-served',
      'take-order',
      'clean-table',
      'set-line-weight',
      'manage-zone-stock',
      'view-customer-contact',
    ]);
    expect(new Set(PERMISSIONS).size).toBe(27);
  });

  it('[01b §3.3] PERMISSION_SCOPES', () => {
    expect(SCOPES).toEqual(['branch', 'own_tables', 'my_floors', 'my_team', 'my_stations', 'my_zones']);
    expect(PERMISSION_SCOPES['take-order-anywhere']).toEqual(['branch', 'my_floors']);
    expect(PERMISSION_SCOPES['force-release-table-lock']).toEqual(['branch', 'my_floors']);
    expect(PERMISSION_SCOPES['approve-void']).toEqual(['branch', 'my_team']);
    expect(PERMISSION_SCOPES['manage-stock']).toEqual(['branch', 'my_stations']);
    expect(PERMISSION_SCOPES['manage-stations']).toEqual(['branch', 'my_stations']);
    expect(PERMISSION_SCOPES['mark-served']).toEqual(['branch', 'own_tables', 'my_floors']);
    const special = ['take-order-anywhere', 'force-release-table-lock', 'approve-void', 'manage-stock', 'manage-stations', 'mark-served'];
    for (const permission of PERMISSIONS) {
      if (!special.includes(permission) && !FIVE.includes(permission) && !WIDENED.includes(permission))
        expect(PERMISSION_SCOPES[permission]).toEqual(['branch']);
    }
    expect(Object.keys(PERMISSION_SCOPES).sort()).toEqual([...PERMISSIONS].sort());
  });

  it('[02p U-4] PERMISSION_CATALOGUE has the five keys in group orders', () => {
    for (const key of FIVE) {
      expect(PERMISSIONS, key).toContain(key);
      expect(PERMISSION_CATALOGUE.find((row) => row.key === key)?.group, key).toBe('orders');
    }
  });

  it('[02p U-4] PERMISSION_SCOPES equals 01b v1.7 §3.3', () => {
    expect(PERMISSION_SCOPES['take-order']).toEqual(['branch', 'my_floors', 'own_tables']);
    expect(PERMISSION_SCOPES['clean-table']).toEqual(['branch']);
    expect(PERMISSION_SCOPES['mark-served']).toEqual(['branch', 'own_tables', 'my_floors']);
    expect(PERMISSION_SCOPES['boost-order']).toEqual(['branch', 'own_tables', 'my_floors']);
    expect(PERMISSION_SCOPES['mark-item-returned']).toEqual(['branch', 'own_tables', 'my_floors']);
    expect(PERMISSION_SCOPES['set-line-weight']).toEqual(['branch']);
    expect(PERMISSION_SCOPES['manage-zone-stock']).toEqual(['branch', 'my_zones']);
    expect(PERMISSION_SCOPES['view-customer-contact']).toEqual(['branch', 'my_floors', 'own_tables']);
    expect(SCOPES).toContain('my_zones');
  });

  it('[02p U-4] own_tables is offered by exactly take-order, mark-served, boost-order, mark-item-returned, view-customer-contact', () => {
    const offering = PERMISSIONS.filter((p) => PERMISSION_SCOPES[p].includes('own_tables')).sort();
    expect(offering).toEqual(['boost-order', 'mark-item-returned', 'mark-served', 'take-order', 'view-customer-contact']);
    const zones = PERMISSIONS.filter((p) => PERMISSION_SCOPES[p].includes('my_zones'));
    expect(zones).toEqual(['manage-zone-stock']);
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

  it('[01b B-1, B-2] manage-stations and mark-served are in PERMISSIONS and the catalogue with their groups and scopes', () => {
    expect(PERMISSIONS).toContain('manage-stations');
    expect(PERMISSIONS).toContain('mark-served');
    expect(PERMISSION_CATALOGUE.find((row) => row.key === 'manage-stations')).toEqual({
      key: 'manage-stations',
      group: 'kitchen',
      scopes: ['branch', 'my_stations'],
    });
    expect(PERMISSION_CATALOGUE.find((row) => row.key === 'mark-served')).toEqual({
      key: 'mark-served',
      group: 'orders',
      scopes: ['branch', 'own_tables', 'my_floors'],
    });
  });

  it('[01b B17] DEFAULT_KEYS is the six keys in order', () => {
    expect([...DEFAULT_KEYS]).toEqual(['owner', 'manager', 'cashier', 'order_taker', 'waiter', 'cook']);
  });
});
