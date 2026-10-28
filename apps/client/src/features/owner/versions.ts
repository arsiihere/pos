import type { ChangedVersions } from '@pos/events';

// 01b §8, B23 (review 2 N4): the versions an edit form holds, sent back as `expected_version`. After every
// write the target's version and each entry of `changed_versions` replace the held ones, so the owner's own
// PIN reset or a cascade never makes the next save stale.
export interface HeldVersions {
  staff: ReadonlyMap<string, string>;
  roles: ReadonlyMap<string, string>;
  responsibilities: ReadonlyMap<string, string>; // by branch_id
}

export function heldVersions(): { staff: Map<string, string>; roles: Map<string, string>; responsibilities: Map<string, string> } {
  return { staff: new Map(), roles: new Map(), responsibilities: new Map() };
}

// Returns a new store (React state); the one passed in is not changed.
export function applyChangedVersions(store: HeldVersions, changed: ChangedVersions): HeldVersions {
  const staff = new Map(store.staff);
  const roles = new Map(store.roles);
  const responsibilities = new Map(store.responsibilities);
  for (const entry of changed.staff) staff.set(entry.staff_id, entry.version);
  for (const entry of changed.roles) roles.set(entry.role_id, entry.version);
  for (const entry of changed.responsibilities) responsibilities.set(entry.branch_id, entry.version);
  return { staff, roles, responsibilities };
}
