import { z } from 'zod';
import { AlertCloseReasonSchema, AlertViewSchema, RequestDecisionSchema } from './alerts.js';

const Id = z.string().min(1);

// 01d §6 batch 3 (device -> hub): a delivery fact, not a command; `seen` needs MarkAlertsSeen (§6.4).
export const WsReceipt = z.object({
  type: z.literal('receipt'),
  alert_id: Id,
  kind: z.literal('delivered'),
  step: z.number().int().min(0),
});
export type WsReceipt = z.infer<typeof WsReceipt>;

export const WsClientMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('auth'),
    device_token: z.string(),
    // 00 v1.6 H-2: without it the socket is in alert mode (H-1).
    session_token: z.string().optional(),
  }),
  z.object({
    type: z.literal('ack'),
    last_seq: z.number().int(),
  }),
  WsReceipt,
]);
export type WsClientMessage = z.infer<typeof WsClientMessage>;

// 01d §6 batch 3: `alerts_open` never carries `card` or `details`, nor the signed-in AD-23 fields `answers`,
// `needs_pin`, `silent`, nor AD-165's `raised_device_id` (strict). The spec example row has no `escalation`, `set` or `for_staff_id`, so they are
// optional here. `outcome` (AD-82) is lock-safe; `seen_by_me` (§8.3) is the bound person's seen, false for a
// device-target row with no person (optional: the spec example row has none).
export const WsAlertsOpenRow = AlertViewSchema.omit({ card: true, answers: true, needs_pin: true, silent: true, raised_device_id: true })
  .partial({ escalation: true, set: true, for_staff_id: true })
  .extend({ seen_by_me: z.boolean().optional() })
  .strict();
export type WsAlertsOpenRow = z.infer<typeof WsAlertsOpenRow>;

// 01d §6 batch 3 + BF-5 (plan P-6): the bound-tablet route deadline, null when there is none.
export const WsAlertsOpen = z.object({
  type: z.literal('alerts_open'),
  alerts: z.array(WsAlertsOpenRow),
  binding_route_until: z.number().int().nullable(),
});
export type WsAlertsOpen = z.infer<typeof WsAlertsOpen>;

export const WsAlert = z.object({ type: z.literal('alert'), alert: AlertViewSchema });
export type WsAlert = z.infer<typeof WsAlert>;

export const WsAlertSeen = z.object({ type: z.literal('alert_seen'), alert_id: Id });
export type WsAlertSeen = z.infer<typeof WsAlertSeen>;

// decision / by_name are null for a close that is not an answer (e.g. `expired`).
export const WsAlertClosed = z.object({
  type: z.literal('alert_closed'),
  alert_id: Id,
  reason: AlertCloseReasonSchema,
  decision: RequestDecisionSchema.nullable(),
  by_name: z.string().nullable(),
});
export type WsAlertClosed = z.infer<typeof WsAlertClosed>;

// 01d BF-5 (plan P-6, proposed AD row extending H-2): sent when the binding route deadline changes.
export const WsBindingRoute = z.object({ type: z.literal('binding_route'), until: z.number().int().nullable() });
export type WsBindingRoute = z.infer<typeof WsBindingRoute>;

// 03a §3.6.3 (v0.2 pre-G2 #12): one station's plan — every unfired line, from `stationPlan(state, station_id, now)`.
// The catch-up part `station_plan` carries the same body per station. mark as in the §3.3 Line; fire_ms narrowed from it
// to a number (task 16b): a line is listed once placed, and a placed line always has a planned fire.
export const StationPlanLine = z.object({
  order_item_id: Id,
  order_id: Id,
  fire_ms: z.number().int(),
  deadline_ms: z.number().int(),
  mark: z.enum(['expedite', 'boost', 'pulled', 'return', 'moved']).nullable(),
  frozen: z.boolean(),
});
export type StationPlanLine = z.infer<typeof StationPlanLine>;

export const StationPlanBody = z.object({
  station_id: Id,
  as_of_seq: z.number().int(),
  lines: z.array(StationPlanLine),
});
export type StationPlanBody = z.infer<typeof StationPlanBody>;

export const WsStationPlan = StationPlanBody.extend({ type: z.literal('station_plan') });
export type WsStationPlan = z.infer<typeof WsStationPlan>;

// 03b §4.4 LineDetail on the wire (the @pos/domain type, as a schema); §6.16 frames.
const IdentifierSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('table'), label: z.string() }),
  z.object({ kind: z.literal('token'), token: z.number().int(), date: z.string().nullable() }),
  z.object({ kind: z.literal('parking'), car_number: z.string(), car_type: z.enum(['sedan', 'mini', 'large']) }),
]);
export const LineDetailSchema = z.object({
  order_item_id: Id,
  order_id: Id,
  station_id: Id,
  point_id: Id,
  identifier: IdentifierSchema,
  order_type: z.enum(['dine_in', 'takeaway', 'parking']),
  item_name: z.string(),
  units: z.number().int(),
  line_kind: z.enum(['item', 'option_child', 'deal_part']),
  for_parent: z.string().nullable(),
  deal_name: z.string().nullable(),
  options: z.array(z.string()),
  kitchen_note: z.string().nullable(),
  order_note: z.string().nullable(),
  return_of: z
    .object({ order_item_id: Id, mode: z.enum(['fix', 'remake']), item_name: z.string(), identifier: IdentifierSchema })
    .nullable(),
  cook_ms: z.number().int(),
  prep_ms: z.number().int(),
  from_stock: z.boolean(),
  placed_by_name: z.string().nullable(),
});

// 03b §6.16: details for the line ids a commit gained, per station socket set / per point (Pass) socket set.
export const WsKdsLines = z.object({ type: z.literal('kds_lines'), station_id: Id, lines: z.array(LineDetailSchema) });
export type WsKdsLines = z.infer<typeof WsKdsLines>;
export const WsPointLines = z.object({ type: z.literal('point_lines'), point_id: Id, lines: z.array(LineDetailSchema) });
export type WsPointLines = z.infer<typeof WsPointLines>;

// 03b §6.14: the `kds_station` catch-up body; the takeover frame's `view` (§3.6) is the same body.
export const KdsStationBody = z.object({
  station_id: Id,
  day_open: z.boolean(),
  sound_volume: z.number().int().min(0).max(100),
  lanes: z.object({ lanes_on: z.number().int().min(1).nullable(), lane_count: z.number().int().min(1) }), // null = custom (§5)
  now: z.array(
    LineDetailSchema.extend({
      stage: z.enum(['added', 'cooking', 'done', 'served', 'removed', 'voided', 'returned']),
      fired_at: z.number().int().nullable(),
      started_at: z.number().int().nullable(),
      mark: z.enum(['expedite', 'boost', 'pulled', 'return', 'moved']).nullable(),
      // ⚠️ Changed by v1.0.5 (owner 2026-11-12, B2-3): from the engine line (03a v1.2.2); the KDS shows "tap Done" (§3.3).
      done_undone: z.boolean(),
    }),
  ),
  details: z.array(LineDetailSchema),
});
export type KdsStationBody = z.infer<typeof KdsStationBody>;
export const WsStationTakeover = z.object({
  type: z.literal('station_takeover'),
  station_id: Id,
  active: z.boolean(),
  view: KdsStationBody.optional(),
});
export type WsStationTakeover = z.infer<typeof WsStationTakeover>;

// 03b §3.10: an archived station that still has lines in Now / Next.
export const WsStationNotice = z.object({
  type: z.literal('station_notice'),
  station_id: Id,
  kind: z.literal('archived'),
  open_lines: z.number().int().min(0),
});
export type WsStationNotice = z.infer<typeof WsStationNotice>;

// 03c §3.8: after each ack of a kitchen / reprint job.
export const WsPrintedLines = z.object({ type: z.literal('printed_lines'), station_id: Id, order_item_ids: z.array(Id) });
export type WsPrintedLines = z.infer<typeof WsPrintedLines>;

export const WsServerMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('catch_up'),
    as_of_seq: z.number().int(),
    state: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('event'),
    seq: z.number().int(),
    event: z.object({
      event_id: z.string(),
      event_type: z.string(),
      schema_version: z.number().int().positive(),
      payload: z.record(z.string(), z.unknown()),
    }),
  }),
  z.object({
    type: z.literal('error'),
    error: z.object({
      code: z.string(),
      message: z.string(),
    }),
  }),
  WsAlertsOpen,
  WsAlert,
  WsAlertSeen,
  WsAlertClosed,
  WsBindingRoute,
  WsStationPlan,
  WsKdsLines,
  WsPointLines,
  WsStationTakeover,
  WsStationNotice,
  WsPrintedLines,
]);
export type WsServerMessage = z.infer<typeof WsServerMessage>;

export const WS_CLOSE = {
  CREDENTIALS: 4401,
  FORBIDDEN: 4403,
  UPGRADE: 4426,
  RESTARTING: 1012,
} as const;
