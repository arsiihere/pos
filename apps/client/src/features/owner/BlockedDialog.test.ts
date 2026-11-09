import { describe, expect, it } from 'vitest';
import { createCloudAdmin, type CloudError } from '../../api/cloud-admin';
import { usedEntity, zoneNames } from './BlockedDialog';

describe('[01a AD-6, AD-15] a CONFIG_IN_USE naming zones', () => {
  it('is read as zones and named from the floors list of each branch', async () => {
    const error: CloudError = { kind: 'api', status: 409, code: 'CONFIG_IN_USE', details: { used_by: { entity: 'zone', ids: ['Z1', 'Z9'] } } };
    expect(usedEntity(error)).toBe('zone');
    const api = createCloudAdmin({
      onLoggedOut: () => {},
      fetch: async () =>
        new Response(
          JSON.stringify({ data: { floors: [{ floor_id: 'F1', name: 'G', sort_order: 0, archived_at: null, tables: [], zones: [{ zone_id: 'Z1', name: 'Garden', sort_order: 0, archived_at: null }] }] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });
    expect(await zoneNames(api, ['B1'], ['Z1', 'Z9'])).toEqual({ ids: ['Z1', 'Z9'], names: ['Garden'], by: 'zone' });
  });
});
