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
