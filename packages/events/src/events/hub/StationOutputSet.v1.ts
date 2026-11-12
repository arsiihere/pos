import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03c §6.11 (hub / branch_id): SetStationOutput; mode screen | both | printer (§3.2).
const Id = z.string().min(1);

export const StationOutputSetPayload = z.object({
  station_id: Id,
  mode: z.enum(['screen', 'both', 'printer']),
  printer_id: Id.nullable(),
  show_taker: z.boolean(),
  show_order_id: z.boolean(),
});
export type StationOutputSetPayload = z.infer<typeof StationOutputSetPayload>;

export const StationOutputSet = defineEvent({ eventType: 'StationOutputSet', version: 1, payload: StationOutputSetPayload });
