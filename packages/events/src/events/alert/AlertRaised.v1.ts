import { z } from 'zod';
import { ALERT_CONSTANTS, PERMISSIONS } from '@pos/domain';
import { AlertDetailsBase, AlertDisplaySchema, AlertFamilySchema, AlertTargetSchema, RequestDecisionSchema } from '../../alerts.js';
import { StreamTypeSchema } from '../../envelope.js';
import { defineEvent } from '../../registry.js';

// 01d §4.2: on the subject's stream. `details` is the kind's signed-in-only context (§3.12).
const NeedsPin = z.enum([ALERT_CONSTANTS.needs_pin.money, ALERT_CONSTANTS.needs_pin.accept]);

export const AlertRaisedPayload = z.object({
  alert_id: z.string(),
  kind: z.string().min(1),
  family: AlertFamilySchema,
  subject_stream_type: StreamTypeSchema,
  subject_stream_id: z.string(),
  dedupe_key: z.string(),
  requester_staff_id: z.string().nullable(),
  target: AlertTargetSchema,
  values: z.record(z.string(), z.unknown()),
  display: AlertDisplaySchema,
  details: AlertDetailsBase.nullable(),
  hidden_from: z.object({ session_id: z.string(), device_id: z.string() }).nullable(),
  request: z
    .object({
      answers: z.array(RequestDecisionSchema).min(1),
      right_mode: z.enum(['approval', 'named']),
      base_permission: z.enum(PERMISSIONS).nullable(),
      range_permission: z.enum(PERMISSIONS).nullable(),
      approver_role_ids: z.array(z.string()),
      receiver_staff_id: z.string().nullable(),
      needs_pin: NeedsPin,
    })
    .nullable(),
});
export type AlertRaisedPayload = z.infer<typeof AlertRaisedPayload>;

export const AlertRaised = defineEvent({
  eventType: 'AlertRaised',
  version: 1,
  payload: AlertRaisedPayload,
});
