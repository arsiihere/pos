import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03b §6.22 (order / order_id): UndoReadyToServe, UndoDone.
const Id = z.string().min(1);

export const ReadyToServeUndonePayload = z.object({
  order_id: Id,
  point_id: Id,
  alert_id: Id.nullable(),
});
export type ReadyToServeUndonePayload = z.infer<typeof ReadyToServeUndonePayload>;

export const ReadyToServeUndone = defineEvent({ eventType: 'ReadyToServeUndone', version: 1, payload: ReadyToServeUndonePayload });
