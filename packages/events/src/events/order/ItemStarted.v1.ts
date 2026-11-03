import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2, F §4.7: the engine uses min(started_at, recorded_at) (v0.5 G4-1 #24).
export const ItemStartedPayload = z.object({
  order_item_id: z.string(),
  started_at: z.number().int(),
  source: z.enum(['tap', 'inferred']),
});
export type ItemStartedPayload = z.infer<typeof ItemStartedPayload>;

export const ItemStarted = defineEvent({ eventType: 'ItemStarted', version: 1, payload: ItemStartedPayload });
