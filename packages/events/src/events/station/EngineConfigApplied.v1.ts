import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §3.11 (v0.2 pre-G2 #9, v0.4 G2 #24, v0.6 G4-2 #2): exactly these fields (strict at every level), the only
// config input of replay (P-8). Stream station / branch_id. Names as 01a v2.1 §5.2a.
const OrderType = z.enum(['dine_in', 'takeaway', 'delivery', 'parking']);

export const EngineStationConfig = z
  .object({
    station_id: z.string(),
    name: z.string(),
    station_type: z.enum(['slot', 'batch']),
    capacity: z.number().int(),
    freshness_window_ms: z.number().int().nullable(),
    completion_mode: z.enum(['two_tap', 'single_tap', 'auto_done']),
    policy: z.enum(['waada_guard', 'edf', 'fifo']),
    freeze_ms: z.number().int(),
    min_slack_keep_ms: z.number().int(),
    promise_padding_ms: z.number().int().nullable(),
    pressure_window_ms: z.number().int(),
    pressure_amber_bp: z.number().int(),
    pressure_red_bp: z.number().int(),
    pressure_alert_ms: z.number().int(),
    pause_enabled: z.boolean(),
    lane_units: z.number().int().nullable(),
    reserve_units: z.number().int(),
    point_id: z.string(),
    alternates: z.array(
      z
        .object({ station_id: z.string(), order_types: z.array(OrderType), home_for_order_types: z.array(OrderType) })
        .strict(),
    ),
    carry_times: z.array(z.object({ point_id: z.string(), carry_ms: z.number().int() }).strict()),
    programs: z.array(
      z.object({ program_id: z.string(), name: z.string(), cook_time_ms: z.number().int(), is_archived: z.boolean() }).strict(),
    ),
    // median cook_time_ms over the station's active routed base items (lower median when even); 0 when none.
    reference_cook_ms: z.number().int().min(0),
    is_archived: z.boolean(),
  })
  .strict();
export type EngineStationConfig = z.infer<typeof EngineStationConfig>;

export const EngineSettings = z
  .object({
    weight_dine_in_pct: z.number().int(),
    weight_takeaway_pct: z.number().int(),
    weight_delivery_pct: z.number().int(),
    weight_parking_pct: z.number().int(),
    weight_follow_up_pct: z.number().int(),
    promise_padding_dine_in_ms: z.number().int(),
    promise_padding_takeaway_ms: z.number().int(),
    promise_padding_delivery_ms: z.number().int(),
    promise_padding_parking_ms: z.number().int(),
    slip_threshold_ms: z.number().int(),
    slip_escalate_ms: z.number().int(),
    cascade_step_ms: z.number().int(),
    min_gain_ms: z.number().int(),
    returns_boost: z.boolean(),
    order_abandon_ms: z.number().int(),
  })
  .strict();
export type EngineSettings = z.infer<typeof EngineSettings>;

export const EngineConfigAppliedPayload = z
  .object({
    config_version: z.number().int(),
    stations: z.array(EngineStationConfig),
    settings: EngineSettings,
  })
  .strict()
  .superRefine((p, ctx) => {
    // sorted by station_id (strictly: a station appears once).
    for (let i = 1; i < p.stations.length; i++) {
      if (!(p.stations[i - 1]!.station_id < p.stations[i]!.station_id)) {
        ctx.addIssue({ code: 'custom', path: ['stations', i, 'station_id'], message: 'stations must be sorted by station_id' });
      }
    }
  });
export type EngineConfigAppliedPayload = z.infer<typeof EngineConfigAppliedPayload>;
export type EngineConfig = EngineConfigAppliedPayload;

export const EngineConfigApplied = defineEvent({
  eventType: 'EngineConfigApplied',
  version: 1,
  payload: EngineConfigAppliedPayload,
});
