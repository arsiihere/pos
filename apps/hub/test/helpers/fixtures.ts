import { hash, Algorithm, Version } from '@node-rs/argon2';
import { PERMISSIONS } from '@pos/domain';
import type { DirectoryInput } from '@pos/events';

export const PIN = { a: '1234', b: '0123', c: '999999' };

const memo = new Map<string, Promise<string>>();

export function pinHash(pin: string): Promise<string> {
  const cached = memo.get(pin);
  if (cached !== undefined) return cached;
  const pending = hash(pin, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    algorithm: Algorithm.Argon2id,
    version: Version.V0x13,
  });
  memo.set(pin, pending);
  return pending;
}

export async function aDirectory(o?: { directory_version?: number }): Promise<DirectoryInput> {
  const [owner, manager, cashier] = await Promise.all([pinHash(PIN.a), pinHash(PIN.b), pinHash(PIN.c)]);
  const allowed = PERMISSIONS.map((permission) => ({
    permission,
    grant_type: 'allowed' as const,
    approver_role_id: null,
    approver_role_ids: [],
    scope: 'branch' as const,
  }));
  return {
    directory_version: o?.directory_version ?? 1,
    roles: [
      { role_id: 'R_OWNER', name: 'Owner', session_idle_ttl_ms: 3_600_000, permissions: allowed },
      {
        role_id: 'R_MGR',
        name: 'Manager',
        session_idle_ttl_ms: 3_600_000,
        permissions: allowed.filter((permission) => permission.permission !== 'manage-roles'),
      },
      {
        role_id: 'R_CASH',
        name: 'Cashier',
        session_idle_ttl_ms: 1_800_000,
        permissions: [
          { permission: 'apply-discount', grant_type: 'requires_approval', approver_role_id: 'R_MGR', approver_role_ids: ['R_MGR'], scope: 'branch' },
          { permission: 'reprint-ticket', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'branch' },
        ],
      },
      { role_id: 'R_WAIT', name: 'Order taker', session_idle_ttl_ms: 300_000, permissions: [] },
    ],
    staff: [
      { staff_id: 'S_OWNER', display_name: 'Owner', pin_hash: owner, role_ids: ['R_OWNER'], denied_permissions: [], lead_staff_id: null, floor_ids: [] },
      { staff_id: 'S_MGR', display_name: 'Manager', pin_hash: manager, role_ids: ['R_MGR'], denied_permissions: [], lead_staff_id: null, floor_ids: [] },
      { staff_id: 'S_CASH', display_name: 'Cashier', pin_hash: cashier, role_ids: ['R_CASH'], denied_permissions: [], lead_staff_id: null, floor_ids: [] },
      { staff_id: 'S_WAIT', display_name: 'Order taker', pin_hash: owner, role_ids: ['R_WAIT'], denied_permissions: [], lead_staff_id: null, floor_ids: [] },
    ],
    responsibilities: [],
  };
}
