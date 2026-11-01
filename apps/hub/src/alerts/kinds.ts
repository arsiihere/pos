import { ALERT_CONSTANTS, type AlertFamily, type Permission, type RECIPIENT_SETS } from '@pos/domain';
import type { AlertDetails, AlertDisplay, AlertStepTarget, EventDraft, PosEvent } from '@pos/events';
import type { z } from 'zod';
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
  /** stream_type of the subject */
  subject: PosEvent['stream_type'];
  /** ordered; step 0 is sent at raise */
  steps: readonly StepDef[];
  closes_on: ClosesOn;
  /** types alert.values and the from_value / at.value keys */
  values_schema: z.ZodObject & z.ZodType<V>;
  /** a Zod object over AlertDetailsBase, or null */
  details_schema: z.ZodType<D> | null;
  lead_fallback: boolean;
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
  const valueKeys = new Set(Object.keys(def.values_schema.shape));
  def.steps.forEach((step, index) => {
    if ('value' in step.at && !valueKeys.has(step.at.value)) {
      fail(`step ${index} at.value '${step.at.value}' is not in values_schema`);
    }
    for (const { target, set } of step.to) {
      if (typeof target === 'object' && 'from_value' in target && !valueKeys.has(target.from_value)) {
        fail(`step ${index} from_value '${target.from_value}' is not in values_schema`);
      }
      if (set !== 'recipient' && def.request === null) fail(`step ${index} set '${set}' needs a request part`);
    }
  });
  if (def.lead_fallback && def.request !== null) fail('lead_fallback: true on a request kind');
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
