import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03b §6.22 (hub / branch_id): SetStationScreen; sound_volume 0–100 (§3.8).
const Id = z.string().min(1);

export const StationScreenSetPayload = z.object({
  station_id: Id,
  sound_volume: z.number().int().min(0).max(100),
});
export type StationScreenSetPayload = z.infer<typeof StationScreenSetPayload>;

export const StationScreenSet = defineEvent({ eventType: 'StationScreenSet', version: 1, payload: StationScreenSetPayload });
