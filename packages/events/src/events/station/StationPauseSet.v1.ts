import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2 (station / station_id), D21.
export const StationPauseSetPayload = z.object({
  station_id: z.string(),
  paused: z.boolean(),
});
export type StationPauseSetPayload = z.infer<typeof StationPauseSetPayload>;

export const StationPauseSet = defineEvent({ eventType: 'StationPauseSet', version: 1, payload: StationPauseSetPayload });
