import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03b §6.22 (station / station_id): SetLaneState, after its StationCapacitySet in the same commit (G1-7).
const Id = z.string().min(1);

export const LanesSetPayload = z.object({
  station_id: Id,
  lanes_on: z.number().int().min(1),
  lane_count: z.number().int().min(1),
});
export type LanesSetPayload = z.infer<typeof LanesSetPayload>;

export const LanesSet = defineEvent({ eventType: 'LanesSet', version: 1, payload: LanesSetPayload });
