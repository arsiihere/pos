import { z } from 'zod';
import {
  ALERT_CLOSE_REASONS,
  ALERT_FAMILIES,
  ANSWER_METHODS,
  PERMISSIONS,
  RECIPIENT_SETS,
  REQUEST_DECISIONS,
} from '@pos/domain';

// 01d §5.4: alert wire shapes shared by the hub and the clients (browser-safe: zod only).
// Ids are non-empty strings, as everywhere in @pos/events (directory staff ids are not always ULIDs).

const int = z.number().int();
const Id = z.string().min(1);

export const AlertFamilySchema = z.enum(ALERT_FAMILIES);
export const RecipientSetSchema = z.enum(RECIPIENT_SETS);
export const RequestDecisionSchema = z.enum(REQUEST_DECISIONS);
export const AnswerMethodSchema = z.enum(ANSWER_METHODS);
export const AlertCloseReasonSchema = z.enum(ALERT_CLOSE_REASONS);

// ------------------------------------------------------------------------------------------------- targets

// §3.4: the raised target (and the shape every step target resolves through).
export const AlertTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('person'), staff_id: Id }),
  z.object({ kind: z.literal('permission'), permission: z.enum(PERMISSIONS), range_of: Id.optional() }),
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
export type AlertTarget = z.infer<typeof AlertTargetSchema>;

// §3.5 step `to[].target`: 'raised_target', a step kind, or a target built from the alert's values (§3.4).
const ValueKey = z.string().min(1);
export const AlertStepTargetSchema = z.union([
  z.literal('raised_target'),
  z.object({ kind: z.enum(['answerers', 'holders_informed', 'always_on', 'managers', 'requester_lead']) }),
  z.object({ kind: z.enum(['point', 'zone_order_taker']), from_value: ValueKey }),
  z.object({ kind: z.literal('table_team'), from_value: ValueKey, depth: z.enum(['owner', 'direct']).optional() }),
]);
export type AlertStepTarget = z.infer<typeof AlertStepTargetSchema>;

// ------------------------------------------------------------------------------------- display and details

// §3.12: lock-safe label parameters, never amounts, items or reasons.
const LabelParam = z.string().nullable().optional();
export const AlertDisplaySchema = z.object({
  table_code: LabelParam,
  point_code: LabelParam,
  requester_name: LabelParam,
  device_name: LabelParam,
  kind_label_key: z.string().min(1),
});
export type AlertDisplay = z.infer<typeof AlertDisplaySchema>;

// §3.12: signed-in-only approver context; a kind's details_schema picks and requires fields from it.
// The four fields of AlertRaised v1 (01d v1.1.1), kept so the v1 payload schema keeps its shape (F D46).
export const AlertDetailsBaseV1 = z.object({
  item: z.string().min(1).optional(),
  quantity: int.min(1).optional(),
  amount: int.optional(), // minor units, D47
  reason: z.string().max(200).optional(),
});
// ⚠️ Changed by 03a v1.0 (03a AD-36), 01d v1.1.2 D-1: + minutes_late and lines, for 03a's slip_warning card.
export const AlertDetailsBase = AlertDetailsBaseV1.extend({
  minutes_late: int.min(0).optional(),
  lines: z.array(z.object({ name: z.string().min(1), quantity: int.min(1), state: z.string().min(1) })).optional(),
});
export type AlertDetails = z.infer<typeof AlertDetailsBase>;

// §6 batch 3: `lock` is the display parameters with the kind's lock label key. No `details` key (§7).
export const AlertLockSchema = AlertDisplaySchema;
export type AlertLock = z.infer<typeof AlertLockSchema>;

// §6 batch 3: `card` is the full display (card label key) plus the kind's details; person staff sockets only.
export const AlertCardSchema = AlertDisplaySchema.extend({ details: AlertDetailsBase.nullable() });
export type AlertCard = z.infer<typeof AlertCardSchema>;

// AD-82: the outcome a `request_result` reports (approve / accept → approved, reject / decline → rejected, or
// the close reason). Lock-safe: never an amount, item or reason, so it may go on alert-mode frames too.
export const REQUEST_OUTCOMES = ['approved', 'rejected', 'withdrawn', 'obsolete', 'overridden'] as const;
export const RequestOutcomeSchema = z.enum(REQUEST_OUTCOMES);
export type RequestOutcome = z.infer<typeof RequestOutcomeSchema>;

// §6 batch 3 `alert` frame body; §3.8 route `send(alert: AlertView, …)`.
// AD-23 (additive): `answers`, `needs_pin`, `silent` belong to the signed-in view only (they travel with `card`);
// lock text and alert-mode frames never carry them (G1-13 e; the hub's strict lock schemas refuse them).
// AD-82 (additive): `outcome` on a `request_result`, absent on every other kind.
// AD-165 (additive): `raised_device_id` on the signed-in view of a request only (the client compares it with its
// own device id to show "Approve here", §8.1); never on lock frames, alert-mode frames or `alerts_open`.
export const AlertViewSchema = z.object({
  alert_id: Id,
  kind: z.string().min(1),
  family: AlertFamilySchema,
  step: int.min(0),
  escalation: z.boolean(),
  set: RecipientSetSchema,
  for_staff_id: Id.nullable(),
  lock: AlertLockSchema,
  card: AlertCardSchema.optional(),
  raised_at: int,
  outcome: RequestOutcomeSchema.nullable().optional(),
  answers: z.array(RequestDecisionSchema).nullable().optional(),
  needs_pin: z.enum(['always', 'never']).nullable().optional(),
  silent: z.boolean().optional(),
  raised_device_id: Id.optional(),
});
export type AlertView = z.infer<typeof AlertViewSchema>;

// ------------------------------------------------------------------------------------------ command payloads

// §6.2. PIN pattern 01b §3 rule 4; pin required iff method ∈ pin, in_person; answerer_staff_id iff in_person.
export const AnswerRequestPayload = z
  .object({
    alert_id: Id,
    decision: RequestDecisionSchema,
    method: AnswerMethodSchema,
    answerer_staff_id: Id.optional(),
    pin: z.string().regex(/^\d{4,6}$/).optional(),
  })
  .superRefine((p, ctx) => {
    const inPerson = p.method === 'in_person';
    if (inPerson !== (p.answerer_staff_id !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['answerer_staff_id'],
        message: inPerson ? 'answerer_staff_id is required for in_person' : 'answerer_staff_id is only for in_person',
      });
    }
    const needsPin = p.method === 'pin' || inPerson;
    if (needsPin !== (p.pin !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['pin'],
        message: needsPin ? 'pin is required for this method' : 'pin is not allowed with session',
      });
    }
  });
export type AnswerRequestPayload = z.infer<typeof AnswerRequestPayload>;

// §6.3
export const WithdrawRequestPayload = z.object({ alert_id: Id });
export type WithdrawRequestPayload = z.infer<typeof WithdrawRequestPayload>;

// §6.4
export const MarkAlertsSeenPayload = z.object({ alert_ids: z.array(Id).min(1).max(50) });
export type MarkAlertsSeenPayload = z.infer<typeof MarkAlertsSeenPayload>;

// §6.5
export const SendTestAlertPayload = z.object({
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('person'), staff_id: Id }),
    z.object({ kind: z.literal('team'), lead_staff_id: Id, depth: z.enum(['direct', 'all']).default('direct') }),
    z.object({ kind: z.literal('device'), device_id: Id }),
    z.object({ kind: z.literal('point'), point_id: Id }),
  ]),
});
export type SendTestAlertPayload = z.infer<typeof SendTestAlertPayload>;

// §6.6
export const SetPresencePayload = z.object({ staff_ids: z.array(Id).min(1).max(100), present: z.boolean() });
export type SetPresencePayload = z.infer<typeof SetPresencePayload>;

// ------------------------------------------------------------------------------------------ command results

export const AnswerRequestResult = z.object({ alert_id: Id, decision: RequestDecisionSchema, answered_at: int });
export const WithdrawRequestResult = z.object({ alert_id: Id });
export const MarkAlertsSeenResult = z.object({ seen: z.array(Id) });
export const SendTestAlertResult = z.object({ alert_id: Id });
export const SetPresenceResult = z.object({ business_day_id: Id, staff_ids: z.array(Id), present: z.boolean() });

// ----------------------------------------------------------------------------------------- query responses

// §6.7 (F §6.1 envelope, F §6.3 paging). AD-22 (additive): the inbox lists today's closed alerts too, so each
// row carries its state and close reason.
export const AlertInboxRow = AlertViewSchema.extend({
  seen_by_me: z.boolean(),
  moved_to_name: z.string().nullable(),
  for_staff_name: z.string().nullable(),
  state: z.enum(['open', 'closed']),
  close_reason: AlertCloseReasonSchema.nullable(),
});
export const AlertsInboxResponse = z.object({
  data: z.object({ alerts: z.array(AlertInboxRow) }),
  meta: z.object({ next_cursor: z.string().nullable() }),
});

// BF-4 / AD-5 (additive): the business date of an alert raised before the current business day's `opened_at`,
// else null; the client lists such a row without a re-notify, marked "from <date>" (§8.1).
const FromBusinessDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

// §6 batch 3 `alerts` catch-up part (H-7): the socket's open alerts, each with `seen_by_me` (§8.3) and
// `from_business_day` (BF-4); `card` and the AD-23 fields only on the person's own rows on a staff socket.
export const AlertsCatchUpRow = AlertViewSchema.extend({ seen_by_me: z.boolean(), from_business_day: FromBusinessDay });
export const AlertsCatchUpPart = z.object({ alerts: z.array(AlertsCatchUpRow) });
export type AlertsCatchUpPart = z.infer<typeof AlertsCatchUpPart>;

// §6.8; request states §3.3.
export const RequestStateSchema = z.enum(['pending', 'approved', 'rejected', 'withdrawn', 'closed']);
export const MyRequestRow = z.object({
  alert_id: Id,
  kind: z.string().min(1),
  state: RequestStateSchema,
  close_reason: AlertCloseReasonSchema.nullable(),
  decision: RequestDecisionSchema.nullable(),
  answerer_name: z.string().nullable(),
  raised_at: int,
  waiting_ms: int.min(0),
  ask_in_person: z.boolean(),
  lock: AlertLockSchema,
});
export const MyRequestsResponse = z.object({ data: z.object({ requests: z.array(MyRequestRow) }) });

// §6.9: rows I may answer now (can_answer true) plus read-only inbox rows with my latest set; BF-4
// `from_business_day` (AD-5, additive).
export const RequestToAnswerRow = AlertViewSchema.extend({
  can_answer: z.boolean(),
  seen_by_me: z.boolean(),
  from_business_day: FromBusinessDay,
});
export const RequestsToAnswerResponse = z.object({ data: z.object({ requests: z.array(RequestToAnswerRow) }) });

// §6.10: per step recipients and routes; delivered / seen per person and device. `for_staff_name` and
// `no_route` on recipients are additive (task 36, proposed AD row).
const ReceiptRoute = z.string().min(1); // 'screen' | 'alert_connection' | a registered route (§3.8)
export const AlertReceiptsResponse = z.object({
  data: z.object({
    alert_id: Id,
    kind: z.string().min(1),
    steps: z.array(
      z.object({
        step: int.min(0),
        recipients: z.array(
          z.object({
            staff_id: Id.nullable(),
            staff_name: z.string().nullable(),
            device_id: Id.nullable(),
            device_name: z.string().nullable(),
            for_staff_id: Id.nullable(),
            for_staff_name: z.string().nullable(), // task 36 (additive): the "for <person>" name on a lead's row
            set: RecipientSetSchema,
            no_route: z.boolean(), // task 36 (additive): no route in this step's routes (§3.4.3 "Owner: no route")
          }),
        ),
        routes: z.array(z.object({ staff_id: Id.nullable(), route: ReceiptRoute, ref: z.string() })),
      }),
    ),
    receipts: z.array(
      z.object({
        kind: z.enum(['delivered', 'seen']),
        step: int.min(0).nullable(), // null for seen
        staff_id: z.string().nullable(), // the bound person for an alert_connection receipt
        staff_name: z.string().nullable(),
        device_id: Id,
        device_name: z.string().nullable(),
        route: ReceiptRoute,
        at: int,
      }),
    ),
  }),
});
