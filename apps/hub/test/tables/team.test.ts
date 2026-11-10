import { describe, expect, it } from 'vitest';
import { StaffDirectory } from '../../src/auth/staff-directory';
import { waiterTeam } from '../../src/tables/team';

// 02a §3.5, T4, T16: W = the assignee's direct reports with a live staff session, else the holder's, else ∅;
// waiter alerts go to W ∪ {holder}. Unit tests on an in-memory directory (no hub).

const ASSIGNEE = 'S_ASSIGNEE';
const HOLDER = 'S_HOLDER';
const A1 = 'S_A1';
const A2 = 'S_A2';
const H1 = 'S_H1';
const leads: Record<string, string | null> = { [ASSIGNEE]: null, [HOLDER]: null, [A1]: ASSIGNEE, [A2]: ASSIGNEE, [H1]: HOLDER };

const directory = StaffDirectory.fromInput({
  directory_version: 1,
  roles: [{ role_id: 'R1', name: 'r', session_idle_ttl_ms: 300_000, permissions: [] }],
  staff: Object.entries(leads).map(([staff_id, lead_staff_id]) => ({
    staff_id,
    display_name: staff_id,
    pin_hash: 'h',
    role_ids: ['R1'],
    denied_permissions: [],
    lead_staff_id,
    floor_ids: [],
  })),
  responsibilities: [],
});

const seating = { assignee: ASSIGNEE, holder_staff_id: HOLDER };
const sorted = (ids: string[]) => [...ids].sort();

describe('02a waiterTeam (§3.5)', () => {
  it("[02a #18] the assignee's working reports + holder", () => {
    const team = waiterTeam(seating, new Set([A1, H1, HOLDER]), directory);
    expect(sorted(team)).toEqual(sorted([A1, HOLDER]));
  });

  it("[02a #19] the assignee's reports all off → the holder's working reports + holder", () => {
    const team = waiterTeam(seating, new Set([H1]), directory);
    expect(sorted(team)).toEqual(sorted([H1, HOLDER]));
  });

  it('[02a #19] no assignee → the holder\'s working reports + holder', () => {
    const team = waiterTeam({ assignee: null, holder_staff_id: HOLDER }, new Set([A1, A2, H1]), directory);
    expect(sorted(team)).toEqual(sorted([H1, HOLDER]));
  });

  it('[02a #20] nobody working → [holder]', () => {
    expect(waiterTeam(seating, new Set(), directory)).toEqual([HOLDER]);
  });

  it('[02a §3.5] the holder is listed once when the holder is also in W', () => {
    // the holder reports to the assignee and is working: W = {A1, HOLDER}; W ∪ {holder} has no duplicate
    const dir = StaffDirectory.fromInput({
      directory_version: 1,
      roles: [{ role_id: 'R1', name: 'r', session_idle_ttl_ms: 300_000, permissions: [] }],
      staff: [ASSIGNEE, HOLDER, A1].map((staff_id) => ({
        staff_id,
        display_name: staff_id,
        pin_hash: 'h',
        role_ids: ['R1'],
        denied_permissions: [],
        lead_staff_id: staff_id === ASSIGNEE ? null : ASSIGNEE,
        floor_ids: [],
      })),
      responsibilities: [],
    });
    const team = waiterTeam(seating, new Set([A1, HOLDER]), dir);
    expect(sorted(team)).toEqual(sorted([A1, HOLDER]));
    expect(team).toHaveLength(2);
  });
});
