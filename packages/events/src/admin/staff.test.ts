import { describe, expect, it } from "vitest";
import {
  ResponsibilitySetWire,
  RoleWire,
  StaffWire,
  StaffCreateBody,
  StaffPatchBody,
  RolePatchBody,
  PinBody,
  BranchSettingsPatchBody,
  ResponsibilitiesPutBody,
  ResponsibilityWire,
} from "./staff";

const STAFF = {
  staff_id: "S1",
  display_name: "Bilal",
  role_ids: ["R1"],
  branch_ids: ["B1"],
  denied_permissions: [],
  has_pin: true,
  pin_set_at: 1,
  is_active: true,
  left_at: null,
  reports_to: [{ branch_id: "B1", lead_staff_id: "S2" }],
  floors: [{ branch_id: "B1", floor_ids: ["F1"] }],
  version: "a".repeat(64),
};
const ROLE = {
  role_id: "R1",
  name: "Waiter",
  is_default: true,
  archived_at: null,
  idle_minutes: 5,
  staff_count: 3,
  grants: [
    {
      permission: "take-order-anywhere",
      grant_type: "allowed",
      approver_role_ids: [],
      scope: "my_floors",
    },
  ],
  version: "b".repeat(64),
};
const SET = {
  responsibilities: [
    {
      responsibility: "count_stock",
      station_id: "ST1",
      staff_ids: ["S1"],
      role_ids: [],
    },
  ],
  version: "c".repeat(64),
};

const without = (o: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

describe("[01b §5.3] admin staff wire shapes", () => {
  it("[01b §5.3] StaffWire, RoleWire and the responsibilities response reject a missing version", () => {
    expect(StaffWire.safeParse(STAFF).success).toBe(true);
    expect(RoleWire.safeParse(ROLE).success).toBe(true);
    expect(ResponsibilitySetWire.safeParse(SET).success).toBe(true);
    expect(StaffWire.safeParse(without(STAFF, "version")).success).toBe(false);
    expect(RoleWire.safeParse(without(ROLE, "version")).success).toBe(false);
    expect(
      ResponsibilitySetWire.safeParse(without(SET, "version")).success,
    ).toBe(false);
  });

  it("[01b §6.2, §6.3, §6.10] request bodies: names trimmed 1–40, PIN ASCII 4–6 digits, day ranges 1–48 and 0–12", () => {
    const create = {
      display_name: "  Ali ",
      role_ids: ["R1"],
      branch_ids: ["B1"],
    };
    expect(StaffCreateBody.parse(create).display_name).toBe("Ali");
    expect(
      StaffCreateBody.safeParse({ ...create, display_name: "ع".repeat(40) })
        .success,
    ).toBe(true);
    expect(
      StaffCreateBody.safeParse({ ...create, display_name: "ع".repeat(41) })
        .success,
    ).toBe(false);
    expect(StaffCreateBody.safeParse({ ...create, role_ids: [] }).success).toBe(
      false,
    );
    expect(PinBody.safeParse({ pin: "0123" }).success).toBe(true);
    for (const pin of ["123", "1234567", "١٢٣٤", "12 34"])
      expect(PinBody.safeParse({ pin }).success, pin).toBe(false);
    expect(
      BranchSettingsPatchBody.safeParse({
        expected_version: "v1",
        day_stale_after_hours: 48,
        day_min_gap_hours: 12,
      }).success,
    ).toBe(true);
    expect(
      BranchSettingsPatchBody.safeParse({
        expected_version: "v1",
        day_stale_after_hours: 49,
      }).success,
    ).toBe(false);
    expect(
      BranchSettingsPatchBody.safeParse({
        expected_version: "v1",
        day_min_gap_hours: 13,
      }).success,
    ).toBe(false);
    expect(BranchSettingsPatchBody.safeParse({}).success).toBe(false);
    // v1.5 B-6: the version is required, and is not itself a change.
    expect(
      BranchSettingsPatchBody.safeParse({ day_min_gap_hours: 4 }).success,
    ).toBe(false);
    expect(
      BranchSettingsPatchBody.safeParse({ expected_version: "v1" }).success,
    ).toBe(false);
  });

  it("[01b #80, §6.4, §6.7] a version-only PATCH body parses, so the no-op rule answers it (200, or 409 when stale)", () => {
    expect(StaffPatchBody.safeParse({ expected_version: "v1" }).success).toBe(
      true,
    );
    expect(RolePatchBody.safeParse({ expected_version: "v1" }).success).toBe(
      true,
    );
    expect(StaffPatchBody.safeParse({}).success).toBe(false);
    expect(RolePatchBody.safeParse({}).success).toBe(false);
  });

  it("[01b B-4] ResponsibilityWire accepts count_stock and run_station and refuses any other kind", () => {
    const entry = { station_id: "ST1", staff_ids: ["S1"], role_ids: [] };
    expect(ResponsibilityWire.safeParse({ ...entry, responsibility: "count_stock" }).success).toBe(true);
    expect(ResponsibilityWire.safeParse({ ...entry, responsibility: "run_station" }).success).toBe(true);
    expect(ResponsibilityWire.safeParse({ ...entry, responsibility: "cook" }).success).toBe(false);
    const body = {
      expected_version: "c".repeat(64),
      responsibilities: [
        { ...entry, responsibility: "count_stock" },
        { ...entry, responsibility: "run_station" },
      ],
    };
    expect(ResponsibilitiesPutBody.safeParse(body).success).toBe(true);
  });
});
