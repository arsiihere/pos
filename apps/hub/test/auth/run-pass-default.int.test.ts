import { PERMISSION_CATALOGUE, PERMISSION_SCOPES, PERMISSIONS } from '@pos/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ROLES } from '../../../cloud/src/modules/staff-roles/default-roles';
import { currentDirectory } from '../../src/auth/guards';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';

// 03b §4.5 B-1 (01b v1.8), test 60: run-pass (kitchen, branch) and the Cook defaults reach the hub through a
// directory apply (hub grants come only from directory sync, G-5).

let hub: TestHub | null = null;
afterEach(async () => {
  await hub?.close();
  hub = null;
});

describe('[03b #60] run-pass on the hub', () => {
  it('[03b #60] run-pass is a kitchen permission with scope branch only', () => {
    expect(PERMISSIONS).toContain('run-pass');
    expect(PERMISSION_SCOPES['run-pass']).toEqual(['branch']);
    expect(PERMISSION_CATALOGUE.find((p) => p.key === 'run-pass')).toEqual({ key: 'run-pass', group: 'kitchen', scopes: ['branch'] });
  });

  it('[03b #60] a directory apply with the default Cook grants: Cook resolves run-pass and reprint-ticket, Owner and Manager run-pass', async () => {
    hub = await createTestHub({ provisioned: true });
    const base = await aDirectory();
    // The Cook role as the cloud seeds it (01b §6.15 DEFAULT_ROLES, default_key 'cook'), not hand-written grants.
    const cook = DEFAULT_ROLES.find((r) => r.default_key === 'cook')!;
    const permissions = cook.grants.map((g) => ({
      permission: g.permission,
      grant_type: g.grant_type,
      approver_role_id: null,
      approver_role_ids: [],
      scope: g.scope ?? ('branch' as const),
    }));
    await seedDirectory(hub, {
      ...base,
      roles: [...base.roles, { role_id: 'R_COOK', name: cook.name, session_idle_ttl_ms: cook.session_idle_ttl_ms, permissions }],
      staff: [
        ...base.staff,
        { staff_id: 'S_COOK', display_name: 'Cook', pin_hash: base.staff[0]!.pin_hash, role_ids: ['R_COOK'], denied_permissions: [], lead_staff_id: null, floor_ids: [] },
      ],
    });
    const directory = currentDirectory(hub.app);
    expect(directory.resolve('S_COOK', 'run-pass')).toEqual({ grant: 'allowed', scope: 'branch' });
    expect(directory.resolve('S_COOK', 'reprint-ticket')).toEqual({ grant: 'allowed', scope: 'branch' });
    expect(directory.resolve('S_COOK', 'mark-served')).toEqual({ grant: 'not_granted' });
    expect(directory.resolve('S_OWNER', 'run-pass')).toEqual({ grant: 'allowed', scope: 'branch' });
    expect(directory.resolve('S_MGR', 'run-pass')).toEqual({ grant: 'allowed', scope: 'branch' });
    expect(directory.resolve('S_CASH', 'run-pass')).toEqual({ grant: 'not_granted' });
  });
});

// ⚠️ 01b v1.12 B-4 (OR-2; owner correction 2026-11-24), test 118 (hub part): the Pass default role (run-pass,
// mark-served, reprint-ticket) reaches the hub through a directory apply; Cook still has no mark-served. L-CLOSE-1.
describe('[01b #118 hub] the Pass default role on the hub', () => {
  it('[01b #118] a hub directory apply resolves mark-served allowed / branch for a Pass person and not_granted for a Cook', async () => {
    hub = await createTestHub({ provisioned: true });
    const base = await aDirectory();
    const roleOf = (default_key: 'cook' | 'pass', role_id: string) => {
      const r = DEFAULT_ROLES.find((d) => d.default_key === default_key)!;
      return {
        role_id,
        name: r.name,
        session_idle_ttl_ms: r.session_idle_ttl_ms,
        permissions: r.grants.map((g) => ({ permission: g.permission, grant_type: g.grant_type, approver_role_id: null, approver_role_ids: [], scope: g.scope ?? ('branch' as const) })),
      };
    };
    const person = (staff_id: string, role_id: string) => ({ staff_id, display_name: staff_id, pin_hash: base.staff[0]!.pin_hash, role_ids: [role_id], denied_permissions: [], lead_staff_id: null, floor_ids: [] });
    await seedDirectory(hub, {
      ...base,
      roles: [...base.roles, roleOf('cook', 'R_COOK'), roleOf('pass', 'R_PASS')],
      staff: [...base.staff, person('S_COOK', 'R_COOK'), person('S_PASS', 'R_PASS')],
    });
    const directory = currentDirectory(hub.app);
    expect(directory.resolve('S_PASS', 'mark-served')).toEqual({ grant: 'allowed', scope: 'branch' });
    expect(directory.resolve('S_PASS', 'run-pass')).toEqual({ grant: 'allowed', scope: 'branch' });
    expect(directory.resolve('S_PASS', 'reprint-ticket')).toEqual({ grant: 'allowed', scope: 'branch' });
    expect(directory.resolve('S_COOK', 'mark-served')).toEqual({ grant: 'not_granted' });
  });
});

// ⚠️ 01b v1.12 test 119 (R3-M-2, hub part; L-CLOSE-2): a hub that does not know a grant's permission (an older build
// receiving a newer directory) skips that grant and applies the rest of the role.
describe('[01b #119 R3-M-2 hub] an unknown grant is skipped, the rest applies', () => {
  it('a role with a future permission next to take-order: the apply succeeds, take-order resolves, the unknown key resolves not_granted', async () => {
    hub = await createTestHub({ provisioned: true });
    const base = await aDirectory();
    await seedDirectory(hub, {
      ...base,
      roles: [
        ...base.roles,
        {
          role_id: 'R_NEW',
          name: 'New',
          session_idle_ttl_ms: 300_000,
          permissions: [
            { permission: 'take-order', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'branch' },
            { permission: 'a-permission-from-the-future' as never, grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'branch' },
          ],
        },
      ],
      staff: [...base.staff, { staff_id: 'S_NEW', display_name: 'New', pin_hash: base.staff[0]!.pin_hash, role_ids: ['R_NEW'], denied_permissions: [], lead_staff_id: null, floor_ids: [] }],
    });
    const directory = currentDirectory(hub.app);
    expect(directory.resolve('S_NEW', 'take-order')).toEqual({ grant: 'allowed', scope: 'branch' });
    expect(directory.resolve('S_NEW', 'a-permission-from-the-future' as never)).toEqual({ grant: 'not_granted' });
  });
});
