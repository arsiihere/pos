import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { ReadyToServePayload } from './ReadyToServe.v1.js';

// 03b v1.0.10 §6.22 (STAB-2, F D46): + added_ids (the lines this press added; Handover's Ready: its order_item_ids)
// and forced_ids (the lines this press marked Done; Handover's Ready: []). UndoReadyToServe reads both.
const Id = z.string().min(1);

export const ReadyToServePayloadV2 = ReadyToServePayload.extend({
  added_ids: z.array(Id),
  forced_ids: z.array(Id),
});
export type ReadyToServePayloadV2 = z.infer<typeof ReadyToServePayloadV2>;

// A stored v1 Ready added all its lines and forced none.
export const ReadyToServeV2 = defineEvent({
  eventType: 'ReadyToServe',
  version: 2,
  payload: ReadyToServePayloadV2,
  upcastFromPrevious: (prev) => {
    const p = prev as ReadyToServePayload;
    return { ...p, added_ids: [...p.order_item_ids], forced_ids: [] };
  },
});
