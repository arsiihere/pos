import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLES } from '../src/modules/staff-roles/default-roles';

function grants(name: string): string[] {
  const role = DEFAULT_ROLES.find((r) => r.name === name);
  if (role === undefined) throw new Error(`no role ${name}`);
  return role.grants.map((g) => g.permission);
}

describe('default roles', () => {
  it('[01a S18] Owner and Manager grant manage-stock; Cashier and Order taker do not', () => {
    expect(grants('Owner')).toContain('manage-stock');
    expect(grants('Manager')).toContain('manage-stock');
    expect(grants('Cashier')).not.toContain('manage-stock');
    expect(grants('Order taker')).not.toContain('manage-stock');
  });
});
