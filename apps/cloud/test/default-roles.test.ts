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

  it('[01b §6.15 v1.5] Order taker and Waiter hold only their v1.5 grants, allowed; Cook holds none; boost-order is unchanged (B-7)', () => {
    expect(grants('order_taker')).toEqual(['mark-served', 'mark-item-returned']);
    expect(grants('waiter')).toEqual(['mark-served']);
    expect(grants('cook')).toEqual([]);
    for (const key of ['order_taker', 'waiter']) {
      for (const grant of DEFAULT_ROLES.find((role) => role.default_key === key)!.grants) expect(grant.grant_type).toBe('allowed');
    }
    expect(holders('boost-order')).toEqual(['owner', 'manager']);
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
