import { ALERT_CONSTANTS, DomainError, type ErrorCode } from '@pos/domain';
import { AlertDetailsBase, defineEvent, latestVersion, type EventDraft } from '@pos/events';
import { z } from 'zod';
import {
  APPROVAL_TIER_STEPS,
  defineAlertKind,
  unregisterAlertKind,
  type AlertApplyCtx,
  type AlertRequestDef,
  type AnswerFacts,
} from '../../src/alerts/kinds';

// 01d §4.4 test fakes (plan "Test fakes"): kinds of later modules exist here only. Never imported by src/.
// Each test file calls registerFakes() (beforeAll / beforeEach) and resetFakes() (afterAll / afterEach).
// Deferred to the tasks that build their registries: resolvers fakeTableOwner / fakePoint (task 16),
// route fakePager (task 17), tick fakeFires (task 30).

export type FakeApplyMode = 'ok' | 'throw' | 'append' | 'onCommit' | 'write' | 'no_alert_id' | 'other_alert_id';

/** Controls every fake request kind's `apply` and `onWithdraw`; `resetFakes()` restores the defaults. */
export const fakeApply: {
  mode: FakeApplyMode;
  throwCode: ErrorCode;
  calls: Array<{ fn: 'apply' | 'onWithdraw'; kind: string; alert_id: string; answer: AnswerFacts | null }>;
} = { mode: 'ok', throwCode: 'ITEM_WRONG_STAGE', calls: [] };

/** The effect event a fake `apply` returns (payload `alert_id` optional so 01d's own check is what fails). */
export const FAKE_EFFECT_EVENT = 'TestAlertEffect';

function ensureEffectEvent(): void {
  try {
    latestVersion(FAKE_EFFECT_EVENT);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('unknown event type')) throw error;
    defineEvent({ eventType: FAKE_EFFECT_EVENT, version: 1, payload: z.object({ alert_id: z.string().optional() }) });
  }
}

function effect(ctx: AlertApplyCtx<unknown, unknown>, payload: Record<string, unknown>): EventDraft {
  return {
    stream_type: ctx.alert.subject.stream_type as EventDraft['stream_type'],
    stream_id: ctx.alert.subject.stream_id,
    event_type: FAKE_EFFECT_EVENT,
    schema_version: 1,
    payload,
    occurred_at: ctx.clock.branchNow(),
    actor_id: ctx.actor.staffId,
    device_id: ctx.actor.deviceId,
  };
}

function runFake(fn: 'apply' | 'onWithdraw', ctx: AlertApplyCtx<unknown, unknown>, answer: AnswerFacts | null): EventDraft[] {
  fakeApply.calls.push({ fn, kind: ctx.alert.kind, alert_id: ctx.alert.alert_id, answer });
  const own = effect(ctx, { alert_id: ctx.alert.alert_id });
  switch (fakeApply.mode) {
    case 'ok':
      return [own];
    case 'throw':
      throw new DomainError(fakeApply.throwCode, { reason: 'fake_apply' });
    case 'append':
      ctx.tx.append([own]);
      return [own];
    case 'onCommit':
      ctx.tx.onCommit(() => {});
      return [own];
    case 'write':
      // A visible write: if the read-only view let it through, the alert's step would change.
      ctx.tx.db.prepare('UPDATE alerts SET step = step + 100 WHERE alert_id = ?').run(ctx.alert.alert_id);
      return [own];
    case 'no_alert_id':
      return [effect(ctx, {})];
    case 'other_alert_id':
      return [effect(ctx, { alert_id: `${ctx.alert.alert_id}_other` })];
  }
}

function fakeRequest<V, D>(
  part: Pick<AlertRequestDef<V, D>, 'answers' | 'right' | 'needs_pin'>,
): AlertRequestDef<V, D> {
  return {
    ...part,
    apply: (ctx, answer) => runFake('apply', ctx as AlertApplyCtx<unknown, unknown>, answer),
    onWithdraw: (ctx) => runFake('onWithdraw', ctx as AlertApplyCtx<unknown, unknown>, null),
  };
}

const labels = (kind: string) => ({ card: `alert.${kind}.card`, lock: `alert.${kind}.lock` });

const FAKE_KINDS = [
  't_approval',
  't_accept',
  't_action',
  't_info',
  't_two_step',
  't_point_like',
  't_handover_like',
] as const;
export type FakeKind = (typeof FAKE_KINDS)[number];

/** Step 1 of the fake two-step / point-like kinds and the handover-like remind (ms after raise). */
export const FAKE_STEP_1_MS = 60_000;

export function registerFakes(): void {
  ensureEffectEvent();

  // 04-like void approval: approval tier, money PIN, details for the approver.
  defineAlertKind({
    kind: 't_approval',
    family: 'urgent',
    subject: 'order',
    steps: APPROVAL_TIER_STEPS,
    closes_on: 'owner',
    values_schema: z.object({ order_id: z.string() }),
    details_schema: AlertDetailsBase.required({ item: true, quantity: true, amount: true, reason: true }),
    lead_fallback: false,
    expires_at_day_close: true,
    silent: false,
    labels: labels('t_approval'),
    request: fakeRequest({
      answers: ['approve', 'reject'],
      right: { mode: 'approval', base_permission: 'void-item', range_permission: 'approve-void' },
      needs_pin: ALERT_CONSTANTS.needs_pin.money,
    }),
  });

  // Named accept kind, no PIN (pilot accept kinds).
  defineAlertKind({
    kind: 't_accept',
    family: 'action',
    subject: 'table',
    steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'answerer' }] }],
    closes_on: 'owner',
    values_schema: z.object({}),
    details_schema: null,
    lead_fallback: false,
    expires_at_day_close: true,
    silent: false,
    labels: labels('t_accept'),
    request: fakeRequest({ answers: ['accept', 'decline'], right: { mode: 'named' }, needs_pin: ALERT_CONSTANTS.needs_pin.accept }),
  });

  defineAlertKind({
    kind: 't_action',
    family: 'action',
    subject: 'table',
    steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
    closes_on: 'owner',
    values_schema: z.object({}),
    details_schema: null,
    lead_fallback: true,
    expires_at_day_close: true,
    silent: false,
    labels: labels('t_action'),
    request: null,
  });

  defineAlertKind({
    kind: 't_info',
    family: 'info',
    subject: 'hub',
    steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
    closes_on: 'owner',
    values_schema: z.object({}),
    details_schema: null,
    lead_fallback: true,
    expires_at_day_close: true,
    silent: false,
    labels: labels('t_info'),
    request: null,
  });

  // test_alert-like over two steps (test 46).
  defineAlertKind({
    kind: 't_two_step',
    family: 'info',
    subject: 'hub',
    steps: [
      { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] },
      { at: { ms: FAKE_STEP_1_MS }, to: [{ target: 'raised_target', set: 'recipient' }] },
    ],
    closes_on: 'owner',
    values_schema: z.object({}),
    details_schema: null,
    lead_fallback: true,
    expires_at_day_close: true,
    silent: false,
    labels: labels('t_two_step'),
    request: null,
  });

  // 03a-like (test 50): step 1 targets built from the alert's values.
  defineAlertKind({
    kind: 't_point_like',
    family: 'action',
    subject: 'order',
    steps: [
      { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] },
      {
        at: { ms: FAKE_STEP_1_MS },
        to: [
          { target: { kind: 'point', from_value: 'point_id' }, set: 'recipient' },
          { target: { kind: 'managers' }, set: 'recipient' },
        ],
      },
    ],
    closes_on: 'owner',
    values_schema: z.object({ point_id: z.string(), table_id: z.string() }),
    details_schema: null,
    lead_fallback: true,
    expires_at_day_close: true,
    silent: false,
    labels: labels('t_point_like'),
    request: null,
  });

  // 02 handover-like accept (test 50): remind, and the requester's lead at step 1.
  defineAlertKind({
    kind: 't_handover_like',
    family: 'action',
    subject: 'table',
    steps: [
      { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'answerer' }] },
      {
        at: { ms: FAKE_STEP_1_MS },
        to: [
          { target: 'raised_target', set: 'answerer' },
          { target: { kind: 'requester_lead' }, set: 'informed' },
        ],
      },
    ],
    closes_on: 'owner',
    values_schema: z.object({ table_id: z.string() }),
    details_schema: null,
    lead_fallback: false,
    expires_at_day_close: true,
    silent: false,
    labels: labels('t_handover_like'),
    request: fakeRequest({ answers: ['accept', 'decline'], right: { mode: 'named' }, needs_pin: ALERT_CONSTANTS.needs_pin.accept }),
  });
}

export function resetFakes(): void {
  for (const kind of FAKE_KINDS) unregisterAlertKind(kind);
  fakeApply.mode = 'ok';
  fakeApply.throwCode = 'ITEM_WRONG_STAGE';
  fakeApply.calls.length = 0;
}
