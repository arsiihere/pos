import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { StaffDirectoryAppliedPayload } from './StaffDirectoryApplied.v1.js';

// 01b B18 d: skipped.kind adds 'lead' and 'responsibility'; every v1 payload is a valid v2 payload.
export const StaffDirectoryAppliedPayloadV2 = StaffDirectoryAppliedPayload.extend({
  skipped: z.array(
    z.object({
      kind: z.enum(['staff', 'role_assignment', 'permission', 'approver', 'lead', 'responsibility']),
      id: z.string(),
      reason: z.string(),
    }),
  ),
});

export const StaffDirectoryAppliedV2 = defineEvent({
  eventType: 'StaffDirectoryApplied',
  version: 2,
  payload: StaffDirectoryAppliedPayloadV2,
  upcastFromPrevious: (prev) => prev as z.infer<typeof StaffDirectoryAppliedPayloadV2>,
});
