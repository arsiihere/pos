import { describe, expect, it } from 'vitest';
import { applyChangedVersions, heldVersions } from './versions';

describe('held versions (01b §8, B23, review 2 N4)', () => {
  it('[01b §8] applyChangedVersions replaces each held version named in changed_versions and keeps the others', () => {
    const held = heldVersions();
    held.staff.set('S1', 'old-s1');
    held.staff.set('S2', 'keep-s2');
    held.roles.set('R1', 'old-r1');
    held.responsibilities.set('B1', 'old-b1');
    const next = applyChangedVersions(held, {
      staff: [{ staff_id: 'S1', version: 'new-s1' }, { staff_id: 'S3', version: 'new-s3' }],
      roles: [{ role_id: 'R1', version: 'new-r1' }],
      responsibilities: [{ branch_id: 'B1', version: 'new-b1' }],
    });
    expect(Object.fromEntries(next.staff)).toEqual({ S1: 'new-s1', S2: 'keep-s2', S3: 'new-s3' });
    expect(Object.fromEntries(next.roles)).toEqual({ R1: 'new-r1' });
    expect(Object.fromEntries(next.responsibilities)).toEqual({ B1: 'new-b1' });
    expect(held.staff.get('S1')).toBe('old-s1'); // a new store; the old one is unchanged (React state)
  });
});
