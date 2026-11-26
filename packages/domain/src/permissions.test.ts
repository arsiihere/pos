import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ONLY_PERMISSIONS,
  DEFAULT_KEYS,
  PERMISSIONS,
  PERMISSION_CATALOGUE,
  PERMISSION_SCOPES,
  SCOPES,
  assertKnownPermissions,
} from './permissions';

const FIVE = ['take-order', 'clean-table', 'set-line-weight', 'manage-zone-stock', 'view-customer-contact'];
const WIDENED = ['boost-order', 'mark-item-returned'];
// ⚠️ Changed by 05 (row B-1), 01b v1.10 §3.3, §4.2: the eleven new permissions of group `bills`, in the row's order.
const BILLS = [
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
];

describe('permissions', () => {
  it('[00 §10 #74] a command declaring an unknown permission fails', () => {
    expect(() => assertKnownPermissions(['manage-devices', 'make-coffee'])).toThrow(/make-coffee/);
    expect(() => assertKnownPermissions(['nope', 'also-nope'])).toThrow(/Unknown permission: nope/);
    expect(() => assertKnownPermissions(['nope', 'also-nope'])).not.toThrow(/also-nope/);
    expect(() => assertKnownPermissions(['manage-devices', 'access-hub-admin'])).not.toThrow();
  });

  it('[00 §3.6, 01a S18, 01b B-1, B-2] catalogue has 40 unique entries (03b B-1: + run-pass; 05 row B-1: + 11 bills; 01b v1.12 B-5: + hand-over-unpaid)', () => {
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
      'run-pass',
      ...BILLS,
      'hand-over-unpaid',
    ]);
    expect(new Set(PERMISSIONS).size).toBe(40);
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
      if (!special.includes(permission) && !FIVE.includes(permission) && !WIDENED.includes(permission) && permission !== 'take-payment')
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
    // ⚠️ Changed by 05 (row B-1): + take-payment (01b v1.10 §3.3)
    expect(offering).toEqual(['boost-order', 'mark-item-returned', 'mark-served', 'take-order', 'take-payment', 'view-customer-contact']);
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

  it('[05 row B-1, 01b v1.10 §3.3, §4.2] the eleven bills permissions: group bills; take-payment branch / my_floors / own_tables, the rest branch', () => {
    for (const key of BILLS) {
      expect(PERMISSIONS, key).toContain(key);
      expect(PERMISSION_CATALOGUE.find((row) => row.key === key)?.group, key).toBe('bills');
      expect(PERMISSION_SCOPES[key as (typeof PERMISSIONS)[number]], key).toEqual(key === 'take-payment' ? ['branch', 'my_floors', 'own_tables'] : ['branch']);
    }
    // 01b v1.10 §4.2: bills = apply-discount, apply-refund, apply-comp, reopen-bill + the eleven
    expect(PERMISSION_CATALOGUE.filter((row) => row.group === 'bills').map((row) => row.key)).toEqual([
      'apply-discount',
      'apply-refund',
      'apply-comp',
      'reopen-bill',
      ...BILLS,
    ]);
  });

  it('[05 row B-1, 01b v1.10 §3.3] ALLOWED_ONLY_PERMISSIONS = move-item-to-stock + seven bills permissions; the approvable bills permissions are not in it', () => {
    expect([...ALLOWED_ONLY_PERMISSIONS]).toEqual([
      'move-item-to-stock',
      'take-payment',
      'manage-own-shift',
      'close-shift-for-others',
      'skip-blind-count',
      'close-business-day',
      'open-cash-drawer',
      'manage-fiscal-settings',
      'hand-over-unpaid',
    ]);
    const allowedOnly: readonly string[] = ALLOWED_ONLY_PERMISSIONS;
    for (const key of ['apply-discount', 'remove-service-charge', 'reopen-bill', 'remove-comp', 'close-without-buyer-id', 'record-petty-cash', 'apply-refund']) {
      expect(allowedOnly, key).not.toContain(key);
    }
  });

  it('[01b v1.12 B-5, #119] hand-over-unpaid: group orders, scope branch only, allowed-only (an answer right)', () => {
    expect(PERMISSION_CATALOGUE.find((row) => row.key === 'hand-over-unpaid')).toEqual({ key: 'hand-over-unpaid', group: 'orders', scopes: ['branch'] });
    expect(PERMISSION_SCOPES['hand-over-unpaid']).toEqual(['branch']);
    const allowedOnly: readonly string[] = ALLOWED_ONLY_PERMISSIONS;
    expect(allowedOnly).toContain('hand-over-unpaid');
  });

  it('[01b B17, v1.12 B-4] DEFAULT_KEYS is the seven keys in order (+ pass)', () => {
    expect([...DEFAULT_KEYS]).toEqual(['owner', 'manager', 'cashier', 'order_taker', 'waiter', 'cook', 'pass']);
  });
});
