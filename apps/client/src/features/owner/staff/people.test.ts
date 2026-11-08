import { describe, expect, it } from 'vitest';
import { role } from './fixtures';
import { resolve } from './people';

const grant = (scope: 'branch' | 'my_zones' | 'own_tables') =>
  [{ permission: 'manage-zone-stock' as const, grant_type: 'allowed' as const, approver_role_ids: [], scope }];

describe('people.resolve WIDTH', () => {
  it('[02p U-4] my_zones ranks with my_floors in SCOPE_RANK and WIDTH', () => {
    const z = role({ role_id: 'RZ', name: 'Z', grants: grant('my_zones') });
    const b = role({ role_id: 'RB', name: 'B', grants: grant('branch') });
    const o = role({ role_id: 'RO', name: 'O', grants: grant('own_tables') });
    expect(resolve([z, b], [], 'manage-zone-stock')).toMatchObject({ scope: 'branch' });
    expect(resolve([o, z], [], 'manage-zone-stock')).toMatchObject({ scope: 'my_zones' });
    expect(resolve([z, o], [], 'manage-zone-stock')).toMatchObject({ scope: 'my_zones' });
  });
});
