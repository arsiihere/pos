import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03c §6.11 (hub / branch_id): SetStationOutput and the config-apply hook (v1.0.6 Q-18); mode screen | both | printer (§3.2).
const Id = z.string().min(1);

export const StationOutputSetPayload = z.object({
  station_id: Id,
  mode: z.enum(['screen', 'both', 'printer']),
  printer_id: Id.nullable(),
  show_taker: z.boolean(),
  show_order_id: z.boolean(),
  // 03c v1.0.6 §3.2, §6.11 (Q-18): who wrote it; absent = 'admin' (SetStationOutput). 'config' = the config-apply hook
  // that releases an archived / removed station's printer. Optional, so additive at v1.
  source: z.enum(['admin', 'config']).optional(),
});
export type StationOutputSetPayload = z.infer<typeof StationOutputSetPayload>;

export const StationOutputSet = defineEvent({ eventType: 'StationOutputSet', version: 1, payload: StationOutputSetPayload });
