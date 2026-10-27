import { DEFAULT_KEYS } from '@pos/domain';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLES } from '../src/modules/staff-roles/default-roles';

// 01b §3.8, B17: default roles are found by default_key, never by name.
function grants(key: string): string[] {
  const role = DEFAULT_ROLES.find((r) => r.default_key === key);
  if (role === undefined) throw new Error(`no role ${key}`);
  return role.grants.map((g) => g.permission);
}

describe('default roles', () => {
  it('[01a S18] Owner and Manager grant manage-stock; Cashier and Order taker do not', () => {
    expect(grants('owner')).toContain('manage-stock');
    expect(grants('manager')).toContain('manage-stock');
    expect(grants('cashier')).not.toContain('manage-stock');
    expect(grants('order_taker')).not.toContain('manage-stock');
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
