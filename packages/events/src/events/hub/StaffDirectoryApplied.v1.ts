import { z } from 'zod';
import { defineEvent } from '../../registry.js';

export const StaffDirectoryAppliedPayload = z.object({
  directory_version: z.number().int().positive(),
  staff_count: z.number().int(),
  role_count: z.number().int(),
  removed_staff_ids: z.array(z.string()),
  credentials_changed_staff_ids: z.array(z.string()),
  skipped: z.array(
    z.object({
      kind: z.enum(['staff', 'role_assignment', 'permission', 'approver']),
      id: z.string(),
      reason: z.string(),
    }),
  ),
});

export const StaffDirectoryApplied = defineEvent({
  eventType: 'StaffDirectoryApplied',
  version: 1,
  payload: StaffDirectoryAppliedPayload,
});
