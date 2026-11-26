import { ALERT_CONSTANTS } from '@pos/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { AlertDetailsBase } from '@pos/events';
import { z } from 'zod';
import { registerFakes, resetFakes } from '../../test/alerts/fakes';
import {
  APPROVAL_TIER_STEPS,
  defineAlertKind,
  kindOf,
  stepAt,
  unregisterAlertKind,
  type AlertKindDef,
  type StepDef,
} from './kinds';

const defined: string[] = [];

afterEach(() => {
  for (const kind of defined.splice(0)) unregisterAlertKind(kind);
});

type Def = AlertKindDef<Record<string, unknown>, never>;

const toRaised: StepDef = { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] };

function infoDef(over: Partial<Def> = {}): Def {
  return {
    kind: 'k_info',
    family: 'info',
    subject: 'hub',
    steps: [toRaised],
    closes_on: 'owner',
    values_schema: z.object({ table_id: z.string().min(1), window_ms: z.number() }),
    details_schema: null,
    lead_fallback: true,
    expires_at_day_close: true,
    silent: false,
    labels: { card: 'alert.k_info.card', lock: 'alert.k_info.lock' },
    request: null,
    ...over,
  };
}

const approvalRequest: NonNullable<Def['request']> = {
  answers: ['approve', 'reject'],
  right: { mode: 'approval', base_permission: 'void-item', range_permission: 'approve-void' },
  needs_pin: 'always',
  apply: () => [],
};

function requestDef(over: Partial<Def> = {}): Def {
  return infoDef({
    kind: 'k_request',
    family: 'urgent',
    subject: 'order',
    steps: APPROVAL_TIER_STEPS,
    lead_fallback: false,
    request: approvalRequest,
    ...over,
  });
}

function define(def: Def) {
  const kind = defineAlertKind(def);
  defined.push(def.kind);
  return kind;
}

describe('defineAlertKind', () => {
  it('[01d §4.2] registers a kind that kindOf returns', () => {
    const kind = define(infoDef());
    expect(kindOf('k_info')).toBe(kind);
    expect(kindOf('k_missing')).toBeUndefined();
  });

  it('[01d §3.5] duplicate kind throws', () => {
    define(infoDef());
    expect(() => defineAlertKind(infoDef())).toThrow(/duplicate kind/);
  });

  it('[01d §3.5] urgent without a request part throws', () => {
    expect(() => define(infoDef({ family: 'urgent' }))).toThrow(/urgent.*request/);
  });

  it('[01d §3.5] a from_value key not in values_schema throws', () => {
    const steps: StepDef[] = [
      toRaised,
      { at: { ms: 1000 }, to: [{ target: { kind: 'point', from_value: 'point_id' }, set: 'recipient' }] },
    ];
    expect(() => define(infoDef({ steps }))).toThrow(/from_value 'point_id'/);
    const known: StepDef[] = [
      toRaised,
      { at: { ms: 1000 }, to: [{ target: { kind: 'table_team', from_value: 'table_id' }, set: 'recipient' }] },
    ];
    expect(() => define(infoDef({ steps: known }))).not.toThrow();
  });

  it('[01d §3.5] answerer / informed set on a non-request kind throws', () => {
    for (const set of ['answerer', 'informed'] as const) {
      const steps: StepDef[] = [{ at: { ms: 0 }, to: [{ target: 'raised_target', set }] }];
      expect(() => define(infoDef({ kind: `k_set_${set}`, steps }))).toThrow(new RegExp(`set '${set}'`));
    }
  });

  it('[01d §3.5] lead_fallback: true on a request kind throws', () => {
    expect(() => define(requestDef({ lead_fallback: true }))).toThrow(/lead_fallback/);
  });

  it('[02p U-6] D-3: startup error on a request kind', () => {
    expect(() => define(requestDef({ skip_requester: true }))).toThrow(/skip_requester/);
    expect(define(infoDef({ kind: 'k_skip', skip_requester: true })).skip_requester).toBe(true);
    expect(define(infoDef({ kind: 'k_noskip' })).skip_requester).toBeUndefined();
  });

  it('[01d §3.5] expires_at_day_close: false without closes_on seen throws', () => {
    expect(() => define(infoDef({ expires_at_day_close: false, closes_on: 'owner' }))).toThrow(
      /expires_at_day_close/,
    );
    expect(() =>
      define(infoDef({ kind: 'k_after', expires_at_day_close: false, closes_on: { after_ms: 1000 } })),
    ).toThrow(/expires_at_day_close/);
    expect(() => define(infoDef({ kind: 'k_personal', expires_at_day_close: false, closes_on: 'seen' }))).not.toThrow();
  });

  it('[01d §3.5] silent: true on action and on a request kind throws', () => {
    expect(() => define(infoDef({ family: 'action', silent: true }))).toThrow(/silent/);
    expect(() => define(requestDef({ family: 'info', silent: true }))).toThrow(/silent/);
    expect(() => define(infoDef({ kind: 'k_silent_info', silent: true }))).not.toThrow();
  });

  it('[01d §3.5] approval kind with no escalation: true step throws', () => {
    const steps = APPROVAL_TIER_STEPS.map(({ at, to }) => ({ at, to }));
    expect(() => define(requestDef({ steps }))).toThrow(/escalation/);
  });

  it('[01d §3.5] a named request kind needs no escalation step', () => {
    const named = { ...approvalRequest, answers: ['accept', 'decline'] as const, right: { mode: 'named' as const }, needs_pin: 'never' as const };
    const steps: StepDef[] = [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'answerer' }] }];
    expect(() => define(requestDef({ kind: 'k_named', family: 'action', steps, request: named }))).not.toThrow();
  });

  it('[01d §3.5] a step at { value } naming a key not in values_schema throws (proposed AD)', () => {
    const steps: StepDef[] = [toRaised, { at: { value: 'walk_ms', times: 2 }, to: toRaised.to }];
    expect(() => define(infoDef({ steps }))).toThrow(/at.value 'walk_ms'/);
  });

  it('[01d §3.5] an at.value key must be a required number in values_schema (AD-36 extended)', () => {
    const steps: StepDef[] = [toRaised, { at: { value: 'walk_ms', times: 2 }, to: toRaised.to }];
    for (const walk_ms of [z.number().optional(), z.number().nullable(), z.string(), z.number().default(1)]) {
      expect(() => define(infoDef({ steps, values_schema: z.object({ walk_ms }) }))).toThrow(/at.value 'walk_ms' must be a required number/);
    }
    expect(() => define(infoDef({ steps, values_schema: z.object({ walk_ms: z.number() }) }))).not.toThrow();
  });

  it('[01d §3.5] a from_value key must be a required string with min length 1 in values_schema (AD-36 extended)', () => {
    const steps: StepDef[] = [toRaised, { at: { ms: 1000 }, to: [{ target: { kind: 'point', from_value: 'point_id' }, set: 'recipient' }] }];
    for (const point_id of [z.string(), z.string().min(1).optional(), z.string().min(1).nullable(), z.number()]) {
      expect(() => define(infoDef({ steps, values_schema: z.object({ point_id }) }))).toThrow(/from_value 'point_id' must be a required string with min length 1/);
    }
    expect(() => define(infoDef({ steps, values_schema: z.object({ point_id: z.string().min(1) }) }))).not.toThrow();
  });

  it('[01d §3.3 §3.5] closes_on.after_ms on a request kind throws: requests never expire (AD-124)', () => {
    expect(() => define(requestDef({ kind: 'k_req_after', closes_on: { after_ms: 1000 } }))).toThrow(
      /closes_on.after_ms on a request kind/,
    );
    expect(kindOf('k_req_after')).toBeUndefined();
    expect(() => define(requestDef({ kind: 'k_req_owner', closes_on: 'owner' }))).not.toThrow();
    expect(() => define(infoDef({ kind: 'k_info_after', closes_on: { after_ms: 1000 } }))).not.toThrow();
  });

  it('[01d §3.5] a failed check leaves nothing registered', () => {
    expect(() => defineAlertKind(infoDef({ family: 'urgent' }))).toThrow();
    expect(kindOf('k_info')).toBeUndefined();
  });
});

describe('APPROVAL_TIER_STEPS', () => {
  it('[01d §3.5] deep-equals the approval tier table, built from ALERT_CONSTANTS', () => {
    expect(APPROVAL_TIER_STEPS).toEqual([
      { at: { ms: 0 }, to: [{ target: { kind: 'answerers' }, set: 'answerer' }] },
      {
        at: { ms: 45_000 },
        to: [
          { target: { kind: 'answerers' }, set: 'answerer' },
          { target: { kind: 'always_on' }, set: 'recipient' },
        ],
      },
      {
        at: { ms: 120_000 },
        escalation: true,
        to: [
          { target: { kind: 'answerers' }, set: 'answerer' },
          { target: { kind: 'holders_informed' }, set: 'informed' },
          { target: { kind: 'always_on' }, set: 'recipient' },
        ],
      },
    ]);
    expect(APPROVAL_TIER_STEPS[1]?.at).toEqual({ ms: ALERT_CONSTANTS.approval_repeat_ms });
    expect(APPROVAL_TIER_STEPS[2]?.at).toEqual({ ms: ALERT_CONSTANTS.approval_branch_ms });
  });

  it('[01d §3.5] is frozen, so an owning kind cannot change the tier', () => {
    expect(Object.isFrozen(APPROVAL_TIER_STEPS)).toBe(true);
    expect(Object.isFrozen(APPROVAL_TIER_STEPS[2])).toBe(true);
    expect(Object.isFrozen(APPROVAL_TIER_STEPS[2]?.to)).toBe(true);
  });
});

describe('stepAt', () => {
  const alert = { raised_at: 1_000_000, values: { window_ms: 20_000 } };

  it('[01d §3.5] { ms } → raised_at + ms', () => {
    expect(stepAt({ at: { ms: 0 }, to: toRaised.to }, alert)).toBe(1_000_000);
    expect(stepAt({ at: { ms: 45_000 }, to: toRaised.to }, alert)).toBe(1_045_000);
  });

  it("[01d §3.5] { value: 'window_ms', times: 2 } → raised_at + 2 × values.window_ms", () => {
    expect(stepAt({ at: { value: 'window_ms', times: 2 }, to: toRaised.to }, alert)).toBe(1_040_000);
  });

  it('[01d §3.5] a { value } that is not a finite number in values throws', () => {
    expect(() => stepAt({ at: { value: 'window_ms', times: 2 }, to: toRaised.to }, { raised_at: 0, values: {} })).toThrow(
      /window_ms/,
    );
  });
});

describe('test fakes', () => {
  const FAKES = ['t_approval', 't_accept', 't_action', 't_info', 't_two_step', 't_point_like', 't_handover_like'];

  it('[01d §4.4] registerFakes defines every fake kind; resetFakes removes them', () => {
    registerFakes();
    try {
      for (const kind of FAKES) expect(kindOf(kind), kind).toBeDefined();
      expect(kindOf('t_approval')?.steps).toBe(APPROVAL_TIER_STEPS);
      expect(kindOf('t_approval')?.request?.needs_pin).toBe(ALERT_CONSTANTS.needs_pin.money);
      expect(kindOf('t_accept')?.request?.right).toEqual({ mode: 'named' });
    } finally {
      resetFakes();
    }
    for (const kind of FAKES) expect(kindOf(kind), kind).toBeUndefined();
    registerFakes();
    resetFakes();
  });
});

// 01d v1.3.7 §3.5 (03b v1.0.16 D-7; hostile run 1 M-3, m-2), test 107: the `screen_devices` entry and `counter_card`.
describe('[01d v1.3.7 #107] screen_devices and counter_card startup checks', () => {
  const counterValues = z.object({ order_id: z.string().min(1), counter_screen: z.enum(['takeaway', 'parking']).optional() });
  const toCounter: StepDef = {
    at: { ms: 0 },
    to: [{ target: 'raised_target', set: 'recipient' }, { target: { kind: 'screen_devices', screen_from_value: 'counter_screen' }, set: 'recipient' }],
  };
  const counterDef = (over: Partial<Def> = {}): Def =>
    infoDef({
      kind: 'k_counter',
      steps: [toCounter],
      values_schema: counterValues,
      details_schema: AlertDetailsBase.pick({ identifier: true, lines: true }) as unknown as Def['details_schema'],
      lead_fallback: false,
      counter_card: true,
      ...over,
    });

  it('accepts a counter kind (optional enum gate, recipient set, allowed details)', () => {
    expect(() => define(counterDef())).not.toThrow();
    expect(kindOf('k_counter')?.counter_card).toBe(true);
  });

  it('refuses a screen_from_value key that is undeclared, required, or an enum with pass or board', () => {
    const steps = (key: string): StepDef[] => [{ at: { ms: 0 }, to: [{ target: { kind: 'screen_devices', screen_from_value: key }, set: 'recipient' }] }];
    expect(() => define(counterDef({ kind: 'k_c1', steps: steps('screen') }))).toThrow(/screen_from_value 'screen' is not in values_schema/);
    const required = z.object({ order_id: z.string().min(1), counter_screen: z.enum(['takeaway', 'parking']) });
    expect(() => define(counterDef({ kind: 'k_c2', values_schema: required }))).toThrow(/screen_from_value 'counter_screen' must be an optional enum/);
    const withPass = z.object({ order_id: z.string().min(1), counter_screen: z.enum(['takeaway', 'pass']).optional() });
    expect(() => define(counterDef({ kind: 'k_c3', values_schema: withPass }))).toThrow(/screen_from_value 'counter_screen' must be an optional enum/);
    const withBoard = z.object({ order_id: z.string().min(1), counter_screen: z.enum(['takeaway', 'board']).optional() });
    expect(() => define(counterDef({ kind: 'k_c4', values_schema: withBoard }))).toThrow(/screen_from_value 'counter_screen' must be an optional enum/);
    const notScreen = z.object({ order_id: z.string().min(1), counter_screen: z.enum(['takeaway', 'kitchen']).optional() });
    expect(() => define(counterDef({ kind: 'k_c5', values_schema: notScreen }))).toThrow(/screen_from_value 'counter_screen' must be an optional enum/);
    const str = z.object({ order_id: z.string().min(1), counter_screen: z.string().optional() });
    expect(() => define(counterDef({ kind: 'k_c6', values_schema: str }))).toThrow(/screen_from_value 'counter_screen' must be an optional enum/);
  });

  it("refuses a screen_devices entry with set 'informed' (on a request kind too)", () => {
    const informed: StepDef = { at: { ms: 0 }, to: [{ target: { kind: 'screen_devices', screen_from_value: 'counter_screen' }, set: 'informed' }] };
    expect(() =>
      define(requestDef({ kind: 'k_c7', values_schema: counterValues, steps: [{ ...APPROVAL_TIER_STEPS[0]!, to: [...APPROVAL_TIER_STEPS[0]!.to, ...informed.to] }, ...APPROVAL_TIER_STEPS.slice(1)] })),
    ).toThrow(/screen_devices.*set 'informed'/);
  });

  it('refuses counter_card on a request kind, without a screen_devices entry, or with details outside the allow-list', () => {
    expect(() => define(requestDef({ kind: 'k_c8', counter_card: true }))).toThrow(/counter_card: true on a request kind/);
    expect(() => define(counterDef({ kind: 'k_c9', steps: [toRaised] }))).toThrow(/counter_card: true needs a screen_devices entry/);
    const amount = AlertDetailsBase.pick({ identifier: true, amount: true }) as unknown as Def['details_schema'];
    expect(() => define(counterDef({ kind: 'k_c10', details_schema: amount }))).toThrow(/counter_card: true with details key 'amount'/);
    const allowed = AlertDetailsBase.pick({ identifier: true, lines: true, item: true, quantity: true, station_name: true, minutes_late: true });
    expect(() => define(counterDef({ kind: 'k_c11', details_schema: allowed as unknown as Def['details_schema'] }))).not.toThrow();
    expect(() => define(counterDef({ kind: 'k_c12', details_schema: null }))).not.toThrow();
  });

  it('a screen_devices entry without counter_card is allowed (lock only)', () => {
    expect(() => define(counterDef({ kind: 'k_c13', counter_card: false }))).not.toThrow();
  });
});
