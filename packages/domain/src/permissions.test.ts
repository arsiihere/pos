import { describe, expect, it } from 'vitest';
import { PERMISSIONS, assertKnownPermissions } from './permissions';

describe('permissions', () => {
  it('[00 §10 #74] a command declaring an unknown permission fails', () => {
    expect(() => assertKnownPermissions(['manage-devices', 'make-coffee'])).toThrow(/make-coffee/);
    expect(() => assertKnownPermissions(['manage-devices', 'access-hub-admin'])).not.toThrow();
  });

  it('[00 §3.6] catalogue has 19 unique entries', () => {
    expect(PERMISSIONS).toHaveLength(19);
    expect(new Set(PERMISSIONS).size).toBe(19);
  });
});
