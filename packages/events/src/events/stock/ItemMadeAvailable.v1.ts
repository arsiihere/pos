import { z } from 'zod';
import { defineEvent } from '../../registry.js';

export const ItemMadeAvailablePayload = z.object({
  item_id: z.string(),
});

export const ItemMadeAvailable = defineEvent({
  eventType: 'ItemMadeAvailable',
  version: 1,
  payload: ItemMadeAvailablePayload,
});
