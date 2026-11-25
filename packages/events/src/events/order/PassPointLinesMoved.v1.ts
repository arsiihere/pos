import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { OrderLinePayload } from './OrderPlaced.v1.js';

const recordedMove = z.strictObject({
  order_item_id: z.string(),
  from_point_id: z.string(),
  from_point_name: z.string(),
  to_point_id: z.string(),
  carry_ms: OrderLinePayload.shape.carry_ms,
  alternates: OrderLinePayload.shape.alternates,
});

export const PassPointLinesMoved = defineEvent({
  eventType: 'PassPointLinesMoved',
  version: 1,
  payload: z.strictObject({ order_id: z.string(), moves: z.array(recordedMove) }),
});
