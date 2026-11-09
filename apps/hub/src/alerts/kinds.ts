import { ALERT_CONSTANTS, REQUEST_DECISIONS, type AlertFamily, type Permission, type RECIPIENT_SETS } from '@pos/domain';
import { AlertDetailsBase, type AlertDetails, type AlertDisplay, type AlertStepTarget, type EventDraft, type PosEvent } from '@pos/events';
import { z } from 'zod';
import type { CommandCtx } from '../commands/registry.js';

// 01d §3.5 / §4.2: alert kinds, their steps and the startup checks. Kinds register at module load
// (each owning module's file); a failed check throws, so a bad kind stops the hub at startup.

export type RecipientSet = (typeof RECIPIENT_SETS)[number];

/** §3.5 step `at`: fixed ms after raise, or n × a raiser value (e.g. Ready to serve's walk-to window). */
export type StepAt = { ms: number } | { value: string; times: number };

export interface StepTo {
  target: AlertStepTarget;
  set: RecipientSet;
}

/** §3.5: one step; `escalation: true` is written as `EscalationStepped` instead of `AttemptSent`. */
export interface StepDef {
  at: StepAt;
  to: readonly StepTo[];
  escalation?: boolean;
}

export type ClosesOn = 'owner' | 'seen' | { after_ms: number };

/** §3.12: label keys in the client string tables. */
export interface AlertLabels {
  card: string;
  lock: string;
  short?: string;
}

/** §3.5, exactly. `answered_at` = the transaction's branchNow. */
export type AnswerFacts = {
  decision: 'approve' | 'reject' | 'accept' | 'decline';
  answerer_staff_id: string;
  method: 'session' | 'pin' | 'in_person';
  device_id: string;
  answered_at: number;
};

/** §3.5, exactly: the §3.2 fields, read inside the answer transaction. */
export type AlertRecord<V = Record<string, unknown>, D = AlertDetails> = {
  alert_id: string;
  kind: string;
  family: AlertFamily;
  subject: { stream_type: string; stream_id: string };
  dedupe_key: string;
  requester_staff_id: string | null;
  receiver_staff_id: string | null;
  raised_device_id: string;
  values: V;
  display: AlertDisplay;
  details: D | null;
  step: number;
  raised_at: number;
};

export type AlertApplyCtx<V, D> = CommandCtx & { alert: AlertRecord<V, D> };

export type AlertRight =
  | { mode: 'approval'; base_permission: Permission; range_permission?: Permission }
  | { mode: 'named' };

/** §3.5 request part. `apply` / `onWithdraw` only read and return drafts (read-only contract). */
export interface AlertRequestDef<V, D> {
  answers: readonly ['approve', 'reject'] | readonly ['accept', 'decline'];
  right: AlertRight;
  needs_pin: 'always' | 'never';
  apply(ctx: AlertApplyCtx<V, D>, answer: AnswerFacts): EventDraft[];
  onWithdraw?(ctx: AlertApplyCtx<V, D>): EventDraft[];
}

/** §3.5 / §4.2 `defineAlertKind(def)`. */
export interface AlertKindDef<V = Record<string, unknown>, D = AlertDetails> {
  /** lower_snake, unique */
  kind: string;
  family: AlertFamily;
  /** stream_type of the subject; 'request' = the subject of the request the alert is about (§3.10) */
  subject: PosEvent['stream_type'] | 'request';
  /** ordered; step 0 is sent at raise */
  steps: readonly StepDef[];
  closes_on: ClosesOn;
  /** types alert.values and the from_value / at.value keys */
  values_schema: z.ZodObject & z.ZodType<V>;
  /** a Zod object over AlertDetailsBase, or null */
  details_schema: z.ZodType<D> | null;
  lead_fallback: boolean;
  /** 01d D-3: leave the requester out of every set of every step (default false; not on a request kind) */
  skip_requester?: boolean;
  expires_at_day_close: boolean;
  silent: boolean;
  labels: AlertLabels;
  request: AlertRequestDef<V, D> | null;
}

export type AlertKind<V = Record<string, unknown>, D = AlertDetails> = Readonly<AlertKindDef<V, D>>;

const kinds = new Map<string, AlertKind>();

export function defineAlertKind<V extends Record<string, unknown>, D extends AlertDetails = never>(
  def: AlertKindDef<V, D>,
): AlertKind<V, D> {
  const fail = (why: string): never => {
    throw new Error(`defineAlertKind('${def.kind}'): ${why}`);
  };
  if (kinds.has(def.kind)) fail('duplicate kind');
  if (def.family === 'urgent' && def.request === null) fail("family 'urgent' needs a request part");
  const shape = def.values_schema.shape as Record<string, z.ZodType | undefined>;
  const valueKeys = new Set(Object.keys(shape));
  def.steps.forEach((step, index) => {
    if ('value' in step.at) {
      if (!valueKeys.has(step.at.value)) fail(`step ${index} at.value '${step.at.value}' is not in values_schema`);
      // AD-36 extended (task 28 fix): a required number, so stepAt never meets a missing or null value
      if (!(shape[step.at.value] instanceof z.ZodNumber)) {
        fail(`step ${index} at.value '${step.at.value}' must be a required number (not optional, not nullable) in values_schema`);
      }
    }
    for (const { target, set } of step.to) {
      if (typeof target === 'object' && 'from_value' in target) {
        if (!valueKeys.has(target.from_value)) fail(`step ${index} from_value '${target.from_value}' is not in values_schema`);
        // AD-36 extended (task 28 fix): a required non-empty string, as stepTargets needs
        const field = shape[target.from_value];
        if (!(field instanceof z.ZodString) || (field.minLength ?? 0) < 1) {
          fail(`step ${index} from_value '${target.from_value}' must be a required string with min length 1 in values_schema`);
        }
      }
      if (set !== 'recipient' && def.request === null) fail(`step ${index} set '${set}' needs a request part`);
    }
  });
  if (def.lead_fallback && def.request !== null) fail('lead_fallback: true on a request kind');
  if (def.skip_requester === true && def.request !== null) fail('skip_requester: true on a request kind (requests already skip the requester)');
  // AD-124: requests never expire (§3.3), so such a request would stay due forever and fill the tick's LIMIT
  if (def.request !== null && typeof def.closes_on === 'object') fail('closes_on.after_ms on a request kind (requests never expire)');
  if (!def.expires_at_day_close && def.closes_on !== 'seen') {
    fail("expires_at_day_close: false needs closes_on: 'seen'");
  }
  if (def.silent && (def.family !== 'info' || def.request !== null)) {
    fail("silent: true only on family 'info' without a request part");
  }
  if (def.request?.right.mode === 'approval' && !def.steps.some((step) => step.escalation === true)) {
    fail('an approval kind needs an escalation: true step');
  }
  const kind: AlertKind<V, D> = Object.freeze({ ...def });
  kinds.set(def.kind, kind as unknown as AlertKind);
  return kind;
}

export function kindOf(kind: string): AlertKind | undefined {
  return kinds.get(kind);
}

/** Every registered kind (the `alerts` projection's day close, §3.5). */
export function registeredAlertKinds(): AlertKind[] {
  return [...kinds.values()];
}

/** Tests only (fakes' `resetFakes`): removes one registered kind. Production never unregisters. */
export function unregisterAlertKind(kind: string): void {
  kinds.delete(kind);
}

/** §3.5: absolute due time of a step for an alert (raised_at + offset). */
export function stepAt(step: StepDef, alert: { raised_at: number; values: Record<string, unknown> }): number {
  if ('ms' in step.at) return alert.raised_at + step.at.ms;
  const value = alert.values[step.at.value];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`step at.value '${step.at.value}' is not a finite number in the alert's values`);
  }
  return alert.raised_at + step.at.times * value;
}

const answerers = { target: { kind: 'answerers' }, set: 'answerer' } as const;
const alwaysOn = { target: { kind: 'always_on' }, set: 'recipient' } as const;
const holdersInformed = { target: { kind: 'holders_informed' }, set: 'informed' } as const;

function frozenStep(step: StepDef): StepDef {
  const to = step.to.map(({ target, set }) =>
    Object.freeze({ target: typeof target === 'object' ? Object.freeze({ ...target }) : target, set }),
  );
  return Object.freeze({ ...step, at: Object.freeze({ ...step.at }), to: Object.freeze(to) });
}

/** §3.5 approval tier table (§4.2), from ALERT_CONSTANTS (A14); for every owning approval kind's `steps`. */
export const APPROVAL_TIER_STEPS: readonly StepDef[] = Object.freeze([
  frozenStep({ at: { ms: 0 }, to: [answerers] }),
  frozenStep({ at: { ms: ALERT_CONSTANTS.approval_repeat_ms }, to: [answerers, alwaysOn] }),
  frozenStep({ at: { ms: ALERT_CONSTANTS.approval_branch_ms }, escalation: true, to: [answerers, holdersInformed, alwaysOn] }),
]);

// ------------------------------------------------------------------------------------ kinds 01d ships (§3.10)
// Defined at the top level of this module, which boot reaches statically (boot → projections/alerts →
// alerts/kinds), so the kind exists before boot replays projections (step 4); otherwise a replayed alert
// of the kind would take the P-8 unknown-kind path (next_due_at NULL, an `unknown_kind` line).

/** §3.10 / §3.5: a `test_alert` closes `expired` this long after its raise (fixed by the spec, A14). */
export const TEST_ALERT_AFTER_MS = 600_000;

/**
 * §3.10 `test_alert`: a manager (`manage-devices`) sends a test to a person, a team, a device or a point
 * (point stubbed until 01a, §4.4) and watches the receipts (`SendTestAlert`, §6.5). Subject hub / branch_id;
 * step 0 to the raised target; closed `expired` by the tick at raised_at + TEST_ALERT_AFTER_MS (§3.5 M1).
 * The §3.5 example: lead fallback on (a person with no route is told through their lead), day close expires it.
 */
export const TEST_ALERT = defineAlertKind<Record<string, never>>({
  kind: 'test_alert',
  family: 'info',
  subject: 'hub',
  steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
  closes_on: { after_ms: TEST_ALERT_AFTER_MS },
  values_schema: z.object({}),
  details_schema: null,
  lead_fallback: true,
  expires_at_day_close: true,
  silent: false,
  labels: { card: 'alert.test_alert.card', lock: 'alert.test_alert.lock' },
  request: null,
});

/** §3.10 `request_result` values: decision and answerer, or closer and reason (G1-21.2). */
export const RequestResultValues = z.object({
  request_alert_id: z.string().min(1),
  request_kind: z.string().min(1),
  close_reason: z.enum(['answered', 'obsolete', 'overridden']),
  decision: z.enum(REQUEST_DECISIONS).nullable(),
  by_staff_id: z.string().min(1).nullable(),
});
export type RequestResultValues = z.infer<typeof RequestResultValues>;

/** §3.12: the closer's note is signed-in-only context, never lock text; nothing else of the request's details. */
export const RequestResultDetails = z.object({ reason: AlertDetailsBase.shape.reason }).strict();
export type RequestResultDetails = z.infer<typeof RequestResultDetails>;

/** §3.10 `request_result`: to the requester, raised in the answer / close transaction; closes on their seen. */
export const REQUEST_RESULT = defineAlertKind<RequestResultValues, RequestResultDetails>({
  kind: 'request_result',
  family: 'info',
  subject: 'request',
  steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
  closes_on: 'seen',
  values_schema: RequestResultValues,
  details_schema: RequestResultDetails,
  lead_fallback: false, // N5: answer notices never fall back to a lead
  expires_at_day_close: true, // not a personal notice (§3.10): day close expires it like any info alert
  silent: false,
  labels: { card: 'alert.request_result.card', lock: 'alert.request_result.lock' },
  request: null,
});

/** §3.10 `pin_use_failed` values: which request, why the answer failed, from which device (no PIN, never). */
export const PinUseFailedValues = z.object({
  request_alert_id: z.string().min(1),
  request_kind: z.string().min(1),
  error_code: z.string().min(1),
  device_id: z.string().min(1),
});
export type PinUseFailedValues = z.infer<typeof PinUseFailedValues>;

/**
 * §3.10 `pin_use_failed` (personal notice): to the PIN owner when their PIN matched and the answer then
 * failed (§3.3 rule 4 (d)), raised in the counting transaction. Personal: own routes only, kept over day
 * close, closed only by the owner's own seen; hidden from the seat that sent the PIN (`hidden_from`).
 */
export const PIN_USE_FAILED = defineAlertKind<PinUseFailedValues>({
  kind: 'pin_use_failed',
  family: 'info',
  subject: 'request',
  steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }], // { person: PIN owner }
  closes_on: 'seen',
  values_schema: PinUseFailedValues,
  details_schema: null,
  lead_fallback: false,
  expires_at_day_close: false,
  silent: false,
  labels: { card: 'alert.pin_use_failed.card', lock: 'alert.pin_use_failed.lock' },
  request: null,
});

/**
 * §3.10 `approval_receipt` values: which request, the decision, the answering device, and whether that was
 * the requester's device (the card's "at the requester's device" mark). The time is the alert's raised_at.
 */
export const ApprovalReceiptValues = z.object({
  request_alert_id: z.string().min(1),
  request_kind: z.string().min(1),
  decision: z.enum(REQUEST_DECISIONS),
  device_id: z.string().min(1),
  on_requester_device: z.boolean(),
});
export type ApprovalReceiptValues = z.infer<typeof ApprovalReceiptValues>;

/**
 * §3.10 `approval_receipt` (personal notice, v1.0 #2, R2): to the answerer of every money answer
 * (`needs_pin: 'always'`), any method, any device, raised in the answer transaction. Silent: an inbox row and
 * a badge only (§8.1). Its `details` are the request's, copied: signed-in `card` only, never `lock` (§3.12).
 * Personal: own routes only, kept over day close, closed only by the answerer's own seen; hidden from the
 * answering seat (`hidden_from`).
 */
export const APPROVAL_RECEIPT = defineAlertKind<ApprovalReceiptValues, AlertDetails>({
  kind: 'approval_receipt',
  family: 'info',
  subject: 'request',
  steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }], // { person: answerer }
  closes_on: 'seen',
  values_schema: ApprovalReceiptValues,
  details_schema: AlertDetailsBase, // any of the request kind's details fields, as stored on the request
  lead_fallback: false,
  expires_at_day_close: false,
  silent: true,
  labels: { card: 'alert.approval_receipt.card', lock: 'alert.approval_receipt.lock' },
  request: null,
});

/** §3.10 `answered_on_requester_device` values: which request, the decision, the requester's device. */
export const AnsweredOnRequesterDeviceValues = z.object({
  request_alert_id: z.string().min(1),
  request_kind: z.string().min(1),
  decision: z.enum(REQUEST_DECISIONS),
  device_id: z.string().min(1),
});
export type AnsweredOnRequesterDeviceValues = z.infer<typeof AnsweredOnRequesterDeviceValues>;

/**
 * §3.10 `answered_on_requester_device` (personal notice, v0.5 #2, N2): to the answerer when the answer came
 * from the device the request was raised on, any method (every `in_person` answer). Info chime (audible).
 * Personal: own routes only, kept over day close, closed only by the answerer's own seen; hidden from the
 * answering seat (`hidden_from`).
 */
export const ANSWERED_ON_REQUESTER_DEVICE = defineAlertKind<AnsweredOnRequesterDeviceValues>({
  kind: 'answered_on_requester_device',
  family: 'info',
  subject: 'request',
  steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }], // { person: answerer }
  closes_on: 'seen',
  values_schema: AnsweredOnRequesterDeviceValues,
  details_schema: null,
  lead_fallback: false,
  expires_at_day_close: false,
  silent: false,
  labels: { card: 'alert.answered_on_requester_device.card', lock: 'alert.answered_on_requester_device.lock' },
  request: null,
});

/** §3.9 `no_approver` values: the permission no one signed in can approve (dedupe_key 'no_approver:' + it). */
export const NoApproverValues = z.object({ permission: z.string().min(1) });
export type NoApproverValues = z.infer<typeof NoApproverValues>;

/**
 * §3.10 `no_approver` (§3.9, pilot form of Q-N5): open while the business day is open and no one who could
 * answer the permission branch-wide is signed in anywhere; raised and closed only by the tick's flag pass.
 * Step 0 to the always-on screens and the managers; no lead fallback (N5); closed `done` by the tick when an
 * eligible approver signs in, `expired` at day close.
 */
export const NO_APPROVER = defineAlertKind<NoApproverValues>({
  kind: 'no_approver',
  family: 'info',
  subject: 'hub',
  steps: [
    {
      at: { ms: 0 },
      to: [
        { target: { kind: 'always_on' }, set: 'recipient' },
        { target: { kind: 'managers' }, set: 'recipient' },
      ],
    },
  ],
  closes_on: 'owner',
  values_schema: NoApproverValues,
  details_schema: null,
  lead_fallback: false,
  expires_at_day_close: true,
  silent: false,
  labels: { card: 'alert.no_approver.card', lock: 'alert.no_approver.lock' },
  request: null,
});

/** §3.10 personal notices (v0.5 #2, v1.0 #2): closed `obsolete` by the tick's flag pass when their person leaves `staff` (BF-7). */
export const PERSONAL_NOTICE_KINDS: readonly string[] = Object.freeze([
  APPROVAL_RECEIPT.kind,
  ANSWERED_ON_REQUESTER_DEVICE.kind,
  PIN_USE_FAILED.kind,
]);
