import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2: within 30 s of Done (D16).
export const ItemDoneUndonePayload = z.object({
  order_item_id: z.string(),
});
export type ItemDoneUndonePayload = z.infer<typeof ItemDoneUndonePayload>;

export const ItemDoneUndone = defineEvent({ eventType: 'ItemDoneUndone', version: 1, payload: ItemDoneUndonePayload });
