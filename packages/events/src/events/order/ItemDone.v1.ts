import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2; source per F §4.7 ('tap' | 'inferred', D60). The engine uses min(done_at, recorded_at).
export const ItemDonePayload = z.object({
  order_item_id: z.string(),
  done_at: z.number().int(),
  source: z.enum(['tap', 'inferred']),
});
export type ItemDonePayload = z.infer<typeof ItemDonePayload>;

export const ItemDone = defineEvent({ eventType: 'ItemDone', version: 1, payload: ItemDonePayload });
