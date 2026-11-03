import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2, F §4.7 (station / station_id).
export const ReservationsShiftedPayload = z.object({
  station_id: z.string(),
  cause: z.enum(['overrun', 'late_start']),
  shifts: z.array(z.object({ order_item_id: z.string(), by_ms: z.number().int() })),
});
export type ReservationsShiftedPayload = z.infer<typeof ReservationsShiftedPayload>;

export const ReservationsShifted = defineEvent({
  eventType: 'ReservationsShifted',
  version: 1,
  payload: ReservationsShiftedPayload,
});
