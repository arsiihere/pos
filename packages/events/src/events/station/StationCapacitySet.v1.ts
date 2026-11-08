import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2 (station / station_id); capacity_override 1–100 as 01a's station capacity (§6.6, v0.4 G2 #15).
const Capacity = z.number().int().min(1).max(100);

export const StationCapacitySetPayload = z.object({
  station_id: z.string(),
  capacity_override: Capacity.nullable(),
  previous: Capacity.nullable(),
  reason: z.enum(['manager', 'lane_off', 'lane_on']),
});
export type StationCapacitySetPayload = z.infer<typeof StationCapacitySetPayload>;

export const StationCapacitySet = defineEvent({
  eventType: 'StationCapacitySet',
  version: 1,
  payload: StationCapacitySetPayload,
});
