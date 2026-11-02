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
]);
export type WsServerMessage = z.infer<typeof WsServerMessage>;

export const WS_CLOSE = {
  CREDENTIALS: 4401,
  FORBIDDEN: 4403,
  UPGRADE: 4426,
  RESTARTING: 1012,
} as const;
