import { ChangedVersions, StaffWire } from '@pos/events';
import { z } from 'zod';

// D5: request bodies and wire shapes live in @pos/events (admin/staff.ts); the query and responses stay here.

// §6.1
export const StaffQuery = z.object({
  status: z.enum(['active', 'left']).default('active'),
  branch_id: z.string().min(1).optional(),
});

export const StaffListResponse = z.object({ data: z.object({ staff: z.array(StaffWire) }) });
export const StaffResponse = z.object({ data: z.object({ staff: StaffWire, changed_versions: ChangedVersions }) });
