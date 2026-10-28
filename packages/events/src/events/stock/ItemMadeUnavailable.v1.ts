import { z } from 'zod';
import { defineEvent } from '../../registry.js';

export const ItemMadeUnavailablePayload = z.object({
  item_id: z.string(),
});

export const ItemMadeUnavailable = defineEvent({
  eventType: 'ItemMadeUnavailable',
  version: 1,
  payload: ItemMadeUnavailablePayload,
});
