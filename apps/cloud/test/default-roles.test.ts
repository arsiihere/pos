import { ALLOWED_ONLY_PERMISSIONS, DEFAULT_KEYS, PERMISSIONS, PERMISSION_CATALOGUE } from '@pos/domain';
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

const BILLING_APPROVABLE: string[] = ['apply-discount', 'remove-service-charge', 'reopen-bill', 'remove-comp', 'close-without-buyer-id'];
const NEW_BILLS = [
  'take-payment', 'manage-own-shift', 'close-shift-for-others', 'skip-blind-count', 'record-petty-cash', 'remove-service-charge',
  'close-business-day', 'open-cash-drawer', 'remove-comp', 'close-without-buyer-id', 'manage-fiscal-settings',
];

describe('default roles', () => {
  it('[03b #60] run-pass defaults to Owner, Manager and Cook (and Pass, 01b v1.12 B-4); Cook also gets reprint-ticket; both allowed at branch scope', () => {
    expect(holders('run-pass')).toEqual(['owner', 'manager', 'cook', 'pass']);
    expect(holders('reprint-ticket')).toEqual(['owner', 'manager', 'cashier', 'cook', 'pass']);
    const cook = DEFAULT_ROLES.find((r) => r.default_key === 'cook')!;
    expect([...cook.grants].sort((a, b) => a.permission.localeCompare(b.permission))).toEqual([
      { permission: 'reprint-ticket', grant_type: 'allowed' },
      { permission: 'run-pass', grant_type: 'allowed' },
    ]);
  });

  it('[01a S18] Owner and Manager grant manage-stock; Cashier and Order taker do not', () => {
    expect(grants('owner')).toContain('manage-stock');
    expect(grants('manager')).toContain('manage-stock');
    expect(grants('cashier')).not.toContain('manage-stock');
    expect(grants('order_taker')).not.toContain('manage-stock');
  });

  it('[01b B-1] manage-stations defaults to Owner and Manager only', () => {
    expect(holders('manage-stations')).toEqual(['owner', 'manager']);
  });

  it('[01b B-2] mark-served defaults to Owner, Manager, Cashier, Order taker and Waiter (01b v1.8.1 Q-23: Cashier; v1.12 B-4: Pass)', () => {
    expect(holders('mark-served')).toEqual(['owner', 'manager', 'cashier', 'order_taker', 'waiter', 'pass']);
  });

  it('[01b v1.8.1] Cashier gains mark-served (allowed, branch), not boost-order', () => {
    const cashier = DEFAULT_ROLES.find((r) => r.default_key === 'cashier')!;
    expect(cashier.grants.find((g) => g.permission === 'mark-served')).toEqual({ permission: 'mark-served', grant_type: 'allowed' }); // scope absent = branch
    expect(grants('cashier')).not.toContain('boost-order');
  });

  it('[01b B-5] mark-item-returned defaults to Owner, Manager and Order taker', () => {
    expect(holders('mark-item-returned')).toEqual(['owner', 'manager', 'order_taker']);
  });

  it('[02p U-3] take-order, clean-table seeded by default_key', () => {
    expect(holders('take-order')).toEqual(['owner', 'manager', 'cashier', 'order_taker']);
    expect(holders('clean-table')).toEqual(['owner', 'manager', 'cashier', 'order_taker', 'waiter']);
    expect(grants('waiter')).not.toContain('take-order');
    // 03b B-1 (01b v1.8): Cook is no longer empty (overrides M29 / B17 "Cook has no permissions"), see #60.
    expect([...grants('cook')].sort()).toEqual(['reprint-ticket', 'run-pass']);
  });

  it('[02p U-4] Cashier and Order taker defaults (01b v1.6 B-1; v1.7 B-1, B-5)', () => {
    const grant = (key: string, permission: string) => DEFAULT_ROLES.find((r) => r.default_key === key)!.grants.find((g) => g.permission === permission);
    expect([...grants('cashier')].sort()).toEqual(
      // 04 B-1 (01b v1.9): + move-item-to-stock, void-item
      // 05 B-2 (01b v1.10): + the billing grants, see #90 below
      // 01b v1.8.1 Q-23 (H10): + mark-served
      [
        'apply-comp', 'apply-discount', 'clean-table', 'close-without-buyer-id', 'manage-own-shift', 'mark-served', 'move-item-to-stock', 'open-cash-drawer',
        'record-petty-cash', 'remove-comp', 'remove-service-charge', 'reopen-bill', 'reprint-ticket', 'set-line-weight', 'take-order',
        'take-payment', 'view-customer-contact', 'void-item',
      ].sort(),
    );
    expect([...grants('order_taker')].sort()).toEqual(
      [
        'apply-comp', 'boost-order', 'clean-table', 'manage-own-shift', 'mark-item-returned', 'mark-served', 'move-item-to-stock', 'take-order',
        'take-payment', 'view-customer-contact', 'void-item',
      ].sort(),
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
        if (g.permission === 'void-item' && (role.default_key === 'cashier' || role.default_key === 'order_taker')) continue; // 04 B-1, #108
        if (g.grant_type === 'requires_approval' && role.default_key === 'cashier' && BILLING_APPROVABLE.includes(g.permission)) continue; // 05 B-2, #90
        if (g.permission === 'take-payment' && role.default_key === 'order_taker') continue; // 05 B-2: own_tables, #90
        expect(g.grant_type, `${role.default_key} ${g.permission}`).toBe('allowed');
        if (!(role.default_key === 'order_taker' && g.permission === 'view-customer-contact')) expect(g.scope ?? 'branch').toBe('branch');
      }
    }
    expect([...grants('cook')].sort()).toEqual(['reprint-ticket', 'run-pass']); // 03b B-1, #60
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

  it('[04 #32 seed half, 01b #108] Cashier and Order taker: void-item requires approval by Manager, move-item-to-stock allowed (branch)', () => {
    for (const key of ['cashier', 'order_taker']) {
      const role = DEFAULT_ROLES.find((r) => r.default_key === key)!;
      expect(role.grants.find((g) => g.permission === 'void-item'), key).toEqual({
        permission: 'void-item',
        grant_type: 'requires_approval',
        approver_key: 'manager',
      });
      expect(role.grants.find((g) => g.permission === 'move-item-to-stock'), key).toEqual({
        permission: 'move-item-to-stock',
        grant_type: 'allowed',
      });
    }
    expect(holders('void-item')).toEqual(['owner', 'manager', 'cashier', 'order_taker']);
    expect(holders('move-item-to-stock')).toEqual(['owner', 'manager', 'cashier', 'order_taker']);
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

  // 05 B-2 / 01b v1.10 §6.15, #90 (new-tenant half): the exact grant table of the new `bills` permissions per default role.
  it('[05 #90] [B-2] [H6-13] Owner holds every permission; Manager every one but manage-roles, skip-blind-count, manage-fiscal-settings', () => {
    expect(grants('owner').sort()).toEqual([...PERMISSIONS].sort());
    expect(DEFAULT_ROLES.find((r) => r.default_key === 'owner')!.grants.every((g) => g.grant_type === 'allowed')).toBe(true);
    expect(grants('manager').sort()).toEqual(PERMISSIONS.filter((p) => !['manage-roles', 'skip-blind-count', 'manage-fiscal-settings'].includes(p)).sort());
    const manager = DEFAULT_ROLES.find((r) => r.default_key === 'manager')!;
    expect(manager.grants.every((g) => g.grant_type === 'allowed')).toBe(true);
    expect(holders('skip-blind-count')).toEqual(['owner']);
    expect(holders('manage-fiscal-settings')).toEqual(['owner']);
    expect(holders('close-business-day')).toEqual(['owner', 'manager']);
    expect(holders('close-shift-for-others')).toEqual(['owner', 'manager']);
    for (const p of NEW_BILLS) expect(PERMISSION_CATALOGUE.find((c) => c.key === p)?.group, p).toBe('bills');
  });

  it('[05 #90] [B-2] Cashier and Order taker: the billing grants as the table says; Waiter and Cook get none', () => {
    const bills = (key: string) =>
      DEFAULT_ROLES.find((r) => r.default_key === key)!
        .grants.filter((g) => NEW_BILLS.includes(g.permission) || ['apply-discount', 'reopen-bill'].includes(g.permission))
        .sort((a, b) => a.permission.localeCompare(b.permission));
    expect(bills('cashier')).toEqual(
      [
        { permission: 'apply-discount', grant_type: 'requires_approval', approver_key: 'manager' },
        { permission: 'close-without-buyer-id', grant_type: 'requires_approval', approver_key: 'manager' },
        { permission: 'manage-own-shift', grant_type: 'allowed' },
        { permission: 'open-cash-drawer', grant_type: 'allowed' },
        { permission: 'record-petty-cash', grant_type: 'allowed' },
        { permission: 'remove-comp', grant_type: 'requires_approval', approver_key: 'manager' },
        { permission: 'remove-service-charge', grant_type: 'requires_approval', approver_key: 'manager' },
        { permission: 'reopen-bill', grant_type: 'requires_approval', approver_key: 'manager' },
        { permission: 'take-payment', grant_type: 'allowed' },
      ].sort((a, b) => a.permission.localeCompare(b.permission)),
    );
    expect(bills('order_taker')).toEqual([
      { permission: 'manage-own-shift', grant_type: 'allowed' },
      { permission: 'take-payment', grant_type: 'allowed', scope: 'own_tables' },
    ]);
    expect(bills('waiter')).toEqual([]);
    expect(bills('cook')).toEqual([]);
    // approvals only on approvable permissions (01b §3.3 ALLOWED_ONLY_PERMISSIONS)
    for (const role of DEFAULT_ROLES) {
      for (const g of role.grants) {
        if (g.grant_type === 'requires_approval') expect(ALLOWED_ONLY_PERMISSIONS as readonly string[], g.permission).not.toContain(g.permission);
      }
    }
  });

  it('[01b #20, #118] the Pass default role: key pass, 5 min, exactly run-pass, mark-served, reprint-ticket (allowed, branch); Cook unchanged', () => {
    const pass = DEFAULT_ROLES.find((r) => r.default_key === 'pass')!;
    expect(pass).toMatchObject({ default_key: 'pass', name: 'Pass', session_idle_ttl_ms: 300_000 });
    expect([...pass.grants].sort((a, b) => a.permission.localeCompare(b.permission))).toEqual([
      { permission: 'mark-served', grant_type: 'allowed' },
      { permission: 'reprint-ticket', grant_type: 'allowed' },
      { permission: 'run-pass', grant_type: 'allowed' },
    ]);
    expect([...grants('cook')].sort()).toEqual(['reprint-ticket', 'run-pass']);
    expect(DEFAULT_ROLES.map((r) => r.default_key)).toEqual(['owner', 'manager', 'cashier', 'order_taker', 'waiter', 'cook', 'pass']);
  });

  it('[01b #119 seed half] hand-over-unpaid defaults to Owner and Manager only, allowed at branch', () => {
    expect(holders('hand-over-unpaid')).toEqual(['owner', 'manager']);
    for (const key of ['owner', 'manager']) {
      expect(DEFAULT_ROLES.find((r) => r.default_key === key)!.grants.find((g) => g.permission === 'hand-over-unpaid')).toEqual({ permission: 'hand-over-unpaid', grant_type: 'allowed' });
    }
  });
});
