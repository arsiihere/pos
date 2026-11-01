import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 01d §4.2, §3.11: on `staff` / branch_id.
export const PresenceSetPayload = z.object({
  business_day_id: z.string(),
  staff_ids: z.array(z.string()),
  present: z.boolean(),
  set_by: z.string(),
});
export type PresenceSetPayload = z.infer<typeof PresenceSetPayload>;

export const PresenceSet = defineEvent({
  eventType: 'PresenceSet',
  version: 1,
  payload: PresenceSetPayload,
});
