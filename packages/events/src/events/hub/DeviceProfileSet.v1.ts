import { SCREEN_KEYS } from '@pos/domain';
import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 05a §4.2 (N-4, M-12): the whole device profile each time; replay = last event per device wins.
// `staff_ids` is empty for `everyone`; `profile_version` = the previous one + 1 (1 for the first).
export const DeviceProfileSetPayload = z
  .object({
    device_id: z.string(),
    device_name: z.string().min(1).max(40),
    access: z.enum(['everyone', 'listed']),
    staff_ids: z.array(z.string()),
    screens: z.array(z.enum(SCREEN_KEYS)),
    point_id: z.string().nullable(),
    profile_version: z.number().int().min(1),
    cause: z.enum(['approved', 'edited', 'directory', 'upgrade']),
    needs_review: z.boolean(),
  })
  .strict();
export type DeviceProfileSetPayload = z.infer<typeof DeviceProfileSetPayload>;

export const DeviceProfileSet = defineEvent({
  eventType: 'DeviceProfileSet',
  version: 1,
  payload: DeviceProfileSetPayload,
});
