import { z } from 'zod';
import { ALERT_CONSTANTS } from '@pos/domain';
import { AlertDetailsBaseV1, AlertDisplaySchema, AlertFamilySchema, RequestDecisionSchema } from '../../alerts.js';
import { StreamTypeSchema } from '../../envelope.js';
import { defineEvent } from '../../registry.js';

// ⚠️ Changed by run 3 (R3-B-1; 01d v1.3.7 §5.4, F D46): the persisted permission enum of v1–v5, frozen as stored
// (the @pos/domain PERMISSIONS list before 01b v1.12 B-5). A permission added later widens AlertRaised v6, never these.
export const ALERT_RAISED_PERMISSIONS_V1_V5 = [
  'void-item',
  'move-item-to-stock',
  'mark-item-returned',
  'apply-discount',
  'apply-refund',
  'apply-comp',
  'reopen-bill',
  'edit-menu',
  'view-reports',
  'take-order-anywhere',
  'boost-order',
  'approve-void',
  'force-release-table-lock',
  'reprint-ticket',
  'view-audit-log',
  'manage-roles',
  'manage-staff',
  'manage-devices',
  'access-hub-admin',
  'manage-stock',
  'manage-stations',
  'mark-served',
  'take-order',
  'clean-table',
  'set-line-weight',
  'manage-zone-stock',
  'view-customer-contact',
  'run-pass',
  'take-payment',
  'manage-own-shift',
  'close-shift-for-others',
  'skip-blind-count',
  'record-petty-cash',
  'remove-service-charge',
  'close-business-day',
  'open-cash-drawer',
  'remove-comp',
  'close-without-buyer-id',
  'manage-fiscal-settings',
] as const;
const PermissionV1 = z.enum(ALERT_RAISED_PERMISSIONS_V1_V5);
const Id = z.string().min(1);

// The §3.4 target as stored by v1–v5: alerts.ts AlertTargetSchema with its permission arm on the frozen enum.
export const AlertTargetSchemaV1 = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('person'), staff_id: Id }),
  z.object({ kind: z.literal('permission'), permission: PermissionV1, range_of: Id.optional() }),
  z.object({ kind: z.literal('team'), lead_staff_id: Id, depth: z.enum(['direct', 'all']) }),
  z.object({ kind: z.literal('answerers') }),
  z.object({ kind: z.literal('holders_informed') }),
  z.object({ kind: z.literal('managers') }),
  z.object({ kind: z.literal('requester_lead') }),
  z.object({ kind: z.literal('always_on') }),
  z.object({ kind: z.literal('point'), point_id: Id }),
  z.object({ kind: z.literal('table_team'), table_id: Id, depth: z.enum(['owner', 'direct']).optional() }),
  z.object({ kind: z.literal('zone_order_taker'), table_id: Id }),
  z.object({ kind: z.literal('device'), device_id: Id }),
]);

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
  target: AlertTargetSchemaV1,
  values: z.record(z.string(), z.unknown()),
  display: AlertDisplaySchema,
  // 01d v1.1.2 D-2: v1 keeps the four-field details shape it was stored with; v2 carries the widened base.
  details: AlertDetailsBaseV1.nullable(),
  hidden_from: z.object({ session_id: z.string(), device_id: z.string() }).nullable(),
  request: z
    .object({
      answers: z.array(RequestDecisionSchema).min(1),
      right_mode: z.enum(['approval', 'named']),
      base_permission: PermissionV1.nullable(),
      range_permission: PermissionV1.nullable(),
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
