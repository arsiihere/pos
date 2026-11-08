import { describe, expect, it } from 'vitest';
import { DirectorySchemaV1, SyncConfigEnvelopeSchemaV1 } from '../test/fixtures/v1-schemas';
import { DirectorySchemaV2 } from '../test/fixtures/v2-schemas';
import { DirectorySchema } from './directory';

// 01b §4.3.1: the directory v2 example from the spec.
const V2_EXAMPLE = {
  directory_version: 42,
  staff: [
    {
      staff_id: 'S-bilal',
      display_name: 'Bilal',
      pin_hash: '$argon2id$v=19$m=19456,t=2,p=1$abc',
      role_ids: ['R-waiter'],
      denied_permissions: [],
      lead_staff_id: 'S-hamza',
      floor_ids: ['F-ground'],
    },
  ],
  roles: [
    {
      role_id: 'R-waiter',
      name: 'Waiter',
      session_idle_ttl_ms: 300000,
      permissions: [
        { permission: 'take-order-anywhere', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'my_floors' },
        {
          permission: 'apply-discount',
          grant_type: 'requires_approval',
          approver_role_id: 'R-manager',
          approver_role_ids: ['R-manager', 'R-owner'],
          scope: 'branch',
        },
      ],
    },
  ],
  responsibilities: [{ responsibility: 'count_stock', station_id: 'ST-grill', staff_ids: ['S-usman'], role_ids: [] }],
};

describe('directory', () => {
  it('[00 §4.2] DirectorySchema accepts a minimal directory and rejects session_idle_ttl_ms 0', () => {
    const minimal = { directory_version: 1, staff: [], roles: [], responsibilities: [] };
    expect(DirectorySchema.safeParse(minimal).success).toBe(true);
    expect(
      DirectorySchema.safeParse({
        ...minimal,
        roles: [{ role_id: 'r', name: 'n', session_idle_ttl_ms: 0, permissions: [] }],
      }).success,
    ).toBe(false);
  });

  it('[01b §4.3.1] DirectorySchema parses the §4.3.1 example with every v2 field; an unknown scope is refused', () => {
    const parsed = DirectorySchema.parse(V2_EXAMPLE);
    expect(parsed).toEqual(V2_EXAMPLE);
    const bad = structuredClone(V2_EXAMPLE);
    bad.roles[0]!.permissions[0]!.scope = 'everywhere';
    expect(DirectorySchema.safeParse(bad).success).toBe(false);
    const noLead = structuredClone(V2_EXAMPLE) as { staff: Record<string, unknown>[] };
    delete noLead.staff[0]!.lead_staff_id;
    expect(DirectorySchema.safeParse(noLead).success).toBe(false);
  });

  it('[01b B18 a] the §4.3.1 example also parses with the v1.4 schemas, keeping approver_role_id', () => {
    const parsed = DirectorySchemaV1.parse(V2_EXAMPLE);
    expect(parsed.roles[0]!.permissions.map((p) => p.approver_role_id)).toEqual([null, 'R-manager']);
    expect(parsed.staff[0]).toEqual({
      staff_id: 'S-bilal',
      display_name: 'Bilal',
      pin_hash: '$argon2id$v=19$m=19456,t=2,p=1$abc',
      role_ids: ['R-waiter'],
      denied_permissions: [],
    });
    const envelope = { data: { config: null, directory: V2_EXAMPLE } };
    expect(SyncConfigEnvelopeSchemaV1.safeParse(envelope).success).toBe(true);
  });

  it('[01b B-4] DirectorySchema carries run_station rows beside count_stock; any other kind is refused', () => {
    const both = {
      ...V2_EXAMPLE,
      responsibilities: [
        ...V2_EXAMPLE.responsibilities,
        { responsibility: 'run_station', station_id: 'ST-grill', staff_ids: [], role_ids: ['R-waiter'] },
      ],
    };
    expect(DirectorySchema.parse(both)).toEqual(both);
    const bad = structuredClone(V2_EXAMPLE);
    bad.responsibilities[0]!.responsibility = 'cook';
    expect(DirectorySchema.safeParse(bad).success).toBe(false);
  });

  it('[02p U-3] directory v3 carries the lists; a v2 reader still parses it', () => {
    // 01b §4.3.1 (v1.6 B-2, AD-21): assigned_zone_ids and assigned_table_ids per staff entry, additive (M6).
    const v3 = structuredClone(V2_EXAMPLE) as typeof V2_EXAMPLE & { staff: Record<string, unknown>[] };
    Object.assign(v3.staff[0]!, { assigned_zone_ids: ['Z-ground-left'], assigned_table_ids: ['T-4'] });
    expect(DirectorySchema.parse(v3).staff[0]).toMatchObject({ assigned_zone_ids: ['Z-ground-left'], assigned_table_ids: ['T-4'] });
    // a v2 hub drops the new keys and keeps the v2 meaning of every other field
    const old = DirectorySchemaV2.parse(v3);
    expect(old.staff[0]).toEqual(V2_EXAMPLE.staff[0]);
    expect(DirectorySchemaV1.safeParse(v3).success).toBe(true);
    // an older cloud omits them: still a valid v3 directory (read as no assignment)
    expect(DirectorySchema.parse(V2_EXAMPLE).staff[0]).not.toHaveProperty('assigned_zone_ids');
    const bad = structuredClone(v3);
    Object.assign(bad.staff[0]!, { assigned_table_ids: 'T-4' });
    expect(DirectorySchema.safeParse(bad).success).toBe(false);
  });
});
