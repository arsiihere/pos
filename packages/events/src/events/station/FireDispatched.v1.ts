import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2 (station / station_id): due_at = the line's (load's) planned fire_ms at dispatch (v0.5 G4-1 #24);
// load_id = `station_id:earliest order_item_id` (§3.3), a name, not membership; 'missed' dropped (G4-1 #16).
export const FireDispatchedPayload = z.object({
  station_id: z.string(),
  order_item_ids: z.array(z.string()).min(1),
  load_id: z.string().nullable(),
  due_at: z.number().int(),
  reason: z.enum(['scheduled', 'early_fill', 'pulled']),
});
export type FireDispatchedPayload = z.infer<typeof FireDispatchedPayload>;

export const FireDispatched = defineEvent({ eventType: 'FireDispatched', version: 1, payload: FireDispatchedPayload });
