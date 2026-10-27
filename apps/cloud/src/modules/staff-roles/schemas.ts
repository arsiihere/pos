import { BranchWire, ChangedVersions, ResponsibilitySetWire, RoleWire, StaffWire } from '@pos/events';
import { z } from 'zod';

// D5: request bodies and wire shapes live in @pos/events (admin/staff.ts); the query and responses stay here.

// §6.1
export const StaffQuery = z.object({
  status: z.enum(['active', 'left']).default('active'),
  branch_id: z.string().min(1).optional(),
});

export const StaffIdParams = z.object({ staff_id: z.string().min(1) });

export const StaffListResponse = z.object({ data: z.object({ staff: z.array(StaffWire) }) });
export const StaffResponse = z.object({ data: z.object({ staff: StaffWire, changed_versions: ChangedVersions }) });
export const StaffPatchResponse = z.object({
  data: z.object({
    staff: StaffWire,
    moved_reports: z.array(z.object({ staff_id: z.string(), branch_id: z.string(), lead_staff_id: z.string().nullable() })),
    changed_versions: ChangedVersions,
  }),
});

// §6.5
export const RoleIdParams = z.object({ role_id: z.string().min(1) });
export const RoleQuery = z.object({ archived: z.enum(['false', 'true']).default('false') });
export const RoleListResponse = z.object({ data: z.object({ roles: z.array(RoleWire) }) });
export const RoleResponse = z.object({ data: z.object({ role: RoleWire, changed_versions: ChangedVersions }) });

// §6.8
export const BranchIdParams = z.object({ branch_id: z.string().min(1) });
export const ResponsibilitiesResponse = z.object({ data: ResponsibilitySetWire });
export const ResponsibilitiesPutResponse = z.object({ data: ResponsibilitySetWire.extend({ changed_versions: ChangedVersions }) });

// §6.9, §6.10
export const BranchResponse = z.object({ data: z.object({ branch: BranchWire }) });
