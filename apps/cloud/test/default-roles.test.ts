import { DEFAULT_KEYS } from '@pos/domain';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLES } from '../src/modules/staff-roles/default-roles';

// 01b §3.8, B17: default roles are found by default_key, never by name.
function grants(key: string): string[] {
  const role = DEFAULT_ROLES.find((r) => r.default_key === key);
  if (role === undefined) throw new Error(`no role ${key}`);
  return role.grants.map((g) => g.permission);
}

function holders(permission: string): string[] {
  return DEFAULT_ROLES.filter((role) => role.grants.some((g) => g.permission === permission)).map((role) => role.default_key);
}

describe('default roles', () => {
  it('[01a S18] Owner and Manager grant manage-stock; Cashier and Order taker do not', () => {
    expect(grants('owner')).toContain('manage-stock');
    expect(grants('manager')).toContain('manage-stock');
    expect(grants('cashier')).not.toContain('manage-stock');
    expect(grants('order_taker')).not.toContain('manage-stock');
  });

  it('[01b B-1] manage-stations defaults to Owner and Manager only', () => {
    expect(holders('manage-stations')).toEqual(['owner', 'manager']);
  });

  it('[01b B-2] mark-served defaults to Owner, Manager, Order taker and Waiter', () => {
    expect(holders('mark-served')).toEqual(['owner', 'manager', 'order_taker', 'waiter']);
  });

  it('[01b B-5] mark-item-returned defaults to Owner, Manager and Order taker', () => {
    expect(holders('mark-item-returned')).toEqual(['owner', 'manager', 'order_taker']);
  });

  it('[02p U-3] take-order, clean-table seeded by default_key', () => {
    expect(holders('take-order')).toEqual(['owner', 'manager', 'cashier', 'order_taker']);
    expect(holders('clean-table')).toEqual(['owner', 'manager', 'cashier', 'order_taker', 'waiter']);
    expect(grants('waiter')).not.toContain('take-order');
    expect(grants('cook')).toEqual([]);
  });

  it('[02p U-4] Cashier and Order taker defaults (01b v1.6 B-1; v1.7 B-1, B-5)', () => {
    const grant = (key: string, permission: string) => DEFAULT_ROLES.find((r) => r.default_key === key)!.grants.find((g) => g.permission === permission);
    expect([...grants('cashier')].sort()).toEqual(
      ['apply-comp', 'apply-discount', 'clean-table', 'reprint-ticket', 'set-line-weight', 'take-order', 'view-customer-contact'].sort(),
    );
    expect([...grants('order_taker')].sort()).toEqual(
      ['apply-comp', 'boost-order', 'clean-table', 'mark-item-returned', 'mark-served', 'take-order', 'view-customer-contact'].sort(),
    );
    expect(grants('waiter').sort()).toEqual(['clean-table', 'mark-served']);
    expect(grant('cashier', 'apply-comp')).toMatchObject({ grant_type: 'requires_approval', approver_key: 'manager' });
    expect(grant('order_taker', 'apply-comp')).toMatchObject({ grant_type: 'requires_approval', approver_key: 'manager' });
    expect(grant('cashier', 'apply-discount')).toMatchObject({ grant_type: 'requires_approval', approver_key: 'manager' });
    expect(grant('cashier', 'view-customer-contact')?.scope ?? 'branch').toBe('branch');
    expect(grant('order_taker', 'view-customer-contact')).toMatchObject({ grant_type: 'allowed', scope: 'own_tables' });
    expect(grant('order_taker', 'boost-order')?.scope ?? 'branch').toBe('branch');
    // everything else is allowed at branch scope
    for (const role of DEFAULT_ROLES) {
      for (const g of role.grants) {
        if (g.permission === 'apply-comp' || g.permission === 'apply-discount') continue;
        expect(g.grant_type, `${role.default_key} ${g.permission}`).toBe('allowed');
        if (!(role.default_key === 'order_taker' && g.permission === 'view-customer-contact')) expect(g.scope ?? 'branch').toBe('branch');
      }
    }
    expect(grants('cook')).toEqual([]);
  });

  it('[02p U-4] manage-zone-stock only Owner, Manager; mark-served stays branch (03a AD-32); boost-order gains Order taker', () => {
    expect(holders('manage-zone-stock')).toEqual(['owner', 'manager']);
    expect(holders('set-line-weight')).toEqual(['owner', 'manager', 'cashier']);
    expect(holders('view-customer-contact')).toEqual(['owner', 'manager', 'cashier', 'order_taker']);
    expect(holders('boost-order')).toEqual(['owner', 'manager', 'order_taker']);
    for (const role of DEFAULT_ROLES) {
      expect(role.grants.find((g) => g.permission === 'mark-served')?.scope ?? 'branch').toBe('branch');
    }
  });

  it('[01b §6.15] one role per default_key; every approver is named by key and exists', () => {
    expect(DEFAULT_ROLES.map((role) => role.default_key).sort()).toEqual([...DEFAULT_KEYS].sort());
    for (const role of DEFAULT_ROLES) {
      for (const grant of role.grants) {
        expect(grant.grant_type === 'requires_approval').toBe(grant.approver_key !== undefined);
        if (grant.approver_key !== undefined) expect(DEFAULT_KEYS).toContain(grant.approver_key);
      }
    }
  });
});
