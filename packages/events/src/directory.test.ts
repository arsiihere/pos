import { describe, expect, it } from 'vitest';
import { DirectorySchema } from './directory';

describe('directory', () => {
  it('[00 §4.2] DirectorySchema accepts a minimal directory and rejects session_idle_ttl_ms 0', () => {
    const minimal = { directory_version: 1, staff: [], roles: [] };
    expect(DirectorySchema.safeParse(minimal).success).toBe(true);
    expect(
      DirectorySchema.safeParse({
        ...minimal,
        roles: [{ role_id: 'r', name: 'n', session_idle_ttl_ms: 0, permissions: [] }],
      }).success,
    ).toBe(false);
  });
});
