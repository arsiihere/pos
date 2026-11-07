import { PERMISSIONS } from "@pos/domain";
import { z } from "zod";
import { ScopeSchema } from "../directory.js";

// 01b §5.3, §6 (01a D5): the owner staff, roles, responsibilities and branch shapes, shared by the cloud
// routes and apps/client (browser-safe: zod and @pos/domain only).

const PermissionSchema = z.enum(PERMISSIONS);
// §3.2, B12: staff and role names 1–40 characters after trimming; branch names 1–60 (m9).
const StaffName = z.string().trim().min(1).max(40);
const RoleName = z.string().trim().min(1).max(40);
const BranchName = z.string().trim().min(1).max(60);
const Id = z.string().min(1);
// B23: a version is sha256 hex; the client sends back the one it read.
const Version = z.string().min(1);
const GrantType = z.enum(["allowed", "requires_approval"]);
const ReportsTo = z.array(z.object({ branch_id: Id, lead_staff_id: Id }));
const Floors = z.array(z.object({ branch_id: Id, floor_ids: z.array(Id) }));

export const StaffWire = z.object({
  staff_id: z.string(),
  display_name: z.string(),
  role_ids: z.array(z.string()),
  branch_ids: z.array(z.string()),
  denied_permissions: z.array(PermissionSchema),
  has_pin: z.boolean(),
  pin_set_at: z.number().nullable(),
  is_active: z.boolean(),
  left_at: z.number().nullable(),
  reports_to: z.array(
    z.object({ branch_id: z.string(), lead_staff_id: z.string() }),
  ),
  floors: z.array(
    z.object({ branch_id: z.string(), floor_ids: z.array(z.string()) }),
  ),
  version: z.string(),
});
export type StaffWire = z.infer<typeof StaffWire>;

export const GrantWire = z.object({
  permission: PermissionSchema,
  grant_type: GrantType,
  approver_role_ids: z.array(z.string()),
  scope: ScopeSchema,
});
export type GrantWire = z.infer<typeof GrantWire>;

export const RoleWire = z.object({
  role_id: z.string(),
  name: z.string(),
  is_default: z.boolean(),
  archived_at: z.number().nullable(),
  idle_minutes: z.number().int(),
  staff_count: z.number().int(),
  grants: z.array(GrantWire),
  version: z.string(),
});
export type RoleWire = z.infer<typeof RoleWire>;

export const ResponsibilityWire = z.object({
  responsibility: z.literal("count_stock"),
  station_id: z.string(),
  staff_ids: z.array(z.string()),
  role_ids: z.array(z.string()),
});
export type ResponsibilityWire = z.infer<typeof ResponsibilityWire>;

// §6.8: a branch's responsibility set (active stations only) and its version.
export const ResponsibilitySetWire = z.object({
  responsibilities: z.array(ResponsibilityWire),
  version: z.string(),
});
export type ResponsibilitySetWire = z.infer<typeof ResponsibilitySetWire>;

// 01a v2.1 §5.2a A-12 (01b v1.5 B-6): ranges equal the CHECKs of cloud 0007; the names are engine_settings of
// BranchConfigSnapshotSchemaV3.
const WeightPct = z.number().int().min(10).max(1000);
const PromisePaddingMs = z.number().int().min(0).max(1_800_000);
export const BranchEngineSettings = z.object({
  weight_dine_in_pct: WeightPct,
  weight_takeaway_pct: WeightPct,
  weight_delivery_pct: WeightPct,
  weight_parking_pct: WeightPct,
  weight_follow_up_pct: WeightPct,
  promise_padding_dine_in_ms: PromisePaddingMs,
  promise_padding_takeaway_ms: PromisePaddingMs,
  promise_padding_delivery_ms: PromisePaddingMs,
  promise_padding_parking_ms: PromisePaddingMs,
  slip_threshold_ms: z.number().int().min(60_000).max(1_800_000),
  slip_escalate_ms: z.number().int().min(30_000).max(1_800_000),
  cascade_step_ms: z.number().int().min(15_000).max(300_000),
  min_gain_ms: z.number().int().min(0).max(600_000),
  table_lock_ttl_ms: z.number().int().min(60_000).max(3_600_000),
  returns_boost: z.boolean(),
  order_abandon_ms: z.number().int().min(3_600_000).max(86_400_000),
});
export type BranchEngineSettings = z.infer<typeof BranchEngineSettings>;
export const BRANCH_ENGINE_SETTING_KEYS = Object.keys(BranchEngineSettings.shape) as (keyof BranchEngineSettings)[];

export const BranchWire = z.object({
  branch_id: z.string(),
  name: z.string(),
  status: z.enum(["pending_hub", "active"]),
  hub_last_seen_at: z.number().nullable(),
  hub_synced_at: z.number().nullable(),
  tax_enabled: z.boolean(),
  day_stale_after_hours: z.number().int(),
  day_min_gap_hours: z.number().int(),
  ...BranchEngineSettings.shape,
  version: Version,
});
export type BranchWire = z.infer<typeof BranchWire>;

export interface TeamNode {
  staff_id: string;
  display_name: string;
  has_pin: boolean;
  role_ids: string[];
  members: TeamNode[];
}
export const TeamNode: z.ZodType<TeamNode> = z.lazy(() =>
  z.object({
    staff_id: z.string(),
    display_name: z.string(),
    has_pin: z.boolean(),
    role_ids: z.array(z.string()),
    members: z.array(TeamNode),
  }),
);

// §6, J-5: every directory write answers with the other entities whose version it changed.
export const ChangedVersions = z.object({
  staff: z.array(z.object({ staff_id: z.string(), version: z.string() })),
  roles: z.array(z.object({ role_id: z.string(), version: z.string() })),
  responsibilities: z.array(
    z.object({ branch_id: z.string(), version: z.string() }),
  ),
});
export type ChangedVersions = z.infer<typeof ChangedVersions>;

// §6.2
export const StaffCreateBody = z.object({
  display_name: StaffName,
  role_ids: z.array(Id).min(1),
  branch_ids: z.array(Id).min(1),
  denied_permissions: z.array(PermissionSchema).optional(),
  reports_to: ReportsTo.optional(),
  floors: Floors.optional(),
});

// §6.4: expected_version is required; each list is sent whole. A version-only body is a no-op (200, or 409 when stale).
export const StaffPatchBody = z.object({
  expected_version: Version,
  display_name: StaffName.optional(),
  role_ids: z.array(Id).min(1).optional(),
  branch_ids: z.array(Id).min(1).optional(),
  denied_permissions: z.array(PermissionSchema).optional(),
  reports_to: ReportsTo.optional(),
  floors: Floors.optional(),
  is_active: z.boolean().optional(),
});

// §6.3, 00 M27: ASCII digits only (an Urdu keyboard's digits are refused), duplicates allowed.
export const PinBody = z.object({ pin: z.string().regex(/^[0-9]{4,6}$/) });

// §6.6: scope defaults to 'branch'.
const GrantBody = z.object({
  permission: PermissionSchema,
  grant_type: GrantType,
  approver_role_ids: z.array(Id),
  scope: ScopeSchema.default("branch"),
});
const IdleMinutes = z.number().int().min(1).max(240);

export const RoleCreateBody = z.object({
  name: RoleName,
  idle_minutes: IdleMinutes,
  grants: z.array(GrantBody),
});

// §6.7: grants replace the whole list. A version-only body is a no-op (200, or 409 when stale).
export const RolePatchBody = z.object({
  expected_version: Version,
  name: RoleName.optional(),
  idle_minutes: IdleMinutes.optional(),
  grants: z.array(GrantBody).optional(),
  archived: z.boolean().optional(),
});

// §6.8: the whole set of the branch.
export const ResponsibilitiesPutBody = z.object({
  expected_version: Version,
  responsibilities: z.array(ResponsibilityWire),
});

// §6.9
export const BranchRenameBody = z.object({ name: BranchName });

// §6.10, B16: ranges 1–48 and 0–12; stale > gap is checked on the merged row by the route. v1.5 B-6: the A-12
// fields, each optional; expected_version as B23. At least one field besides the version.
export const BranchSettingsPatchBody = z
  .object({
    expected_version: Version,
    tax_enabled: z.boolean().optional(),
    day_stale_after_hours: z.number().int().min(1).max(48).optional(),
    day_min_gap_hours: z.number().int().min(0).max(12).optional(),
    ...BranchEngineSettings.partial().shape,
  })
  .refine((body) => Object.keys(body).length > 1, {
    message: "at least one field is required",
  });

// §6.11
export const ChangePasswordBody = z.object({
  current_password: z.string().min(1).max(200),
  new_password: z.string().min(10).max(200),
});

// D5: request types for the owner app (01b §8).
export type StaffCreateRequest = z.input<typeof StaffCreateBody>;
export type StaffPatchRequest = z.input<typeof StaffPatchBody>;
export type RoleCreateRequest = z.input<typeof RoleCreateBody>;
export type RolePatchRequest = z.input<typeof RolePatchBody>;
export type ResponsibilitiesPutRequest = z.input<typeof ResponsibilitiesPutBody>;
export type BranchRenameRequest = z.input<typeof BranchRenameBody>;
export type BranchSettingsPatchRequest = z.input<typeof BranchSettingsPatchBody>;
export type ChangePasswordRequest = z.input<typeof ChangePasswordBody>;
