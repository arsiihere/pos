import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03b §6.22 (order / order_id): MarkReadyToServe, Handover. The engine's replay filter does not list it.
const Id = z.string().min(1);

export const ReadyToServePayload = z.object({
  order_id: Id,
  point_id: Id,
  order_item_ids: z.array(Id).min(1),
  table_id: Id.nullable(),
  alert_id: Id.nullable(),
});
export type ReadyToServePayload = z.infer<typeof ReadyToServePayload>;

export const ReadyToServe = defineEvent({ eventType: 'ReadyToServe', version: 1, payload: ReadyToServePayload });
