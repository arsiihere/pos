import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2, §3.8: slip_warning.apply, 02 ReleaseItems.
export const ItemsReleasedPayload = z.object({
  order_id: z.string(),
  alert_id: z.string().nullable(),
  released: z.array(z.string()),
  expedite: z.array(z.string()),
});
export type ItemsReleasedPayload = z.infer<typeof ItemsReleasedPayload>;

export const ItemsReleased = defineEvent({ eventType: 'ItemsReleased', version: 1, payload: ItemsReleasedPayload });
