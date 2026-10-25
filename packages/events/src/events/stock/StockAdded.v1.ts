import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 01a S45: adds quantity (in unit) to on_hand.
export const StockAddedPayload = z.object({
  item_id: z.string(),
  quantity: z.number().int().min(1).max(1_000_000),
  unit: z.enum(['piece', 'g', 'ml']),
});

export const StockAdded = defineEvent({
  eventType: 'StockAdded',
  version: 1,
  payload: StockAddedPayload,
});
