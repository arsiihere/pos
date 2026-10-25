import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 01a S44: on_hand is an integer in unit (pieces, g, ml).
export const StockSetPayload = z.object({
  item_id: z.string(),
  on_hand: z.number().int().min(0).max(1_000_000),
  unit: z.enum(['piece', 'g', 'ml']),
});

export const StockSet = defineEvent({
  eventType: 'StockSet',
  version: 1,
  payload: StockSetPayload,
});
