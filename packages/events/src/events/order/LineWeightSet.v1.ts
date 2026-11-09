import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02b v1.0.2 §6.19 (stream order, id order_id); folded by 02a (P-1d), 02a SG-2. quantity in sale_unit (g), as ItemAdded.quantity.
export const LineWeightSetPayload = z
  .object({
    order_item_id: z.string(),
    quantity: z.number().int(),
    line_total_minor: z.number().int(),
  })
  .strict();
export type LineWeightSetPayload = z.infer<typeof LineWeightSetPayload>;

export const LineWeightSet = defineEvent({ eventType: 'LineWeightSet', version: 1, payload: LineWeightSetPayload });
