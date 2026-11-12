import type { EngineState } from '@pos/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APPROVAL_TIER_STEPS, kindOf, type AlertApplyCtx, type AnswerFacts } from '../../src/alerts/kinds';
import { checkMergeGuard } from '../../src/tables/merge-guard';
import {
  pendingVoids,
  provideVoids,
  VOID_KIND,
  voidDayCloseGuard,
  voidLineGuard,
  voidMergeGuard,
} from '../../src/voids/contracts';
import { VOID_APPROVAL, VoidDetails, VoidValues } from '../../src/voids/kind';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, type TestHub } from '../helpers/test-hub';

// 04 phase 0 P0.7 (04 §4.2, §3.5, §6.6): the module skeleton. Kind `void_approval` exists from module load with every
// §3.5 setting; the §4.2 exports throw "not built" until their task; the guards are no-ops until v8, so registering
// them changes no behaviour (02a's merge / split tests run with the guard registered).

const VALUES = {
  order_id: 'O1',
  order_item_id: 'L1',
  units: 1,
  reason_code: 'customer_changed_mind',
  note: null,
  disposition: 'moved',
  disposition_note: null,
  touched_ids: ['L1', 'L1a'],
  line_dispositions: { L1: null, L1a: 'moved' },
  refund_minor: 120_000,
  comp_voided_minor: 0,
};

describe('[04 §3.5, §6.6] kind void_approval (phase 0 skeleton)', () => {
  it('[04 §6.6] is registered at module load with every §3.5 setting', () => {
    expect(VOID_KIND).toBe('void_approval');
    const kind = kindOf(VOID_KIND);
    expect(kind).toBe(VOID_APPROVAL);
    expect(kind).toMatchObject({
      kind: 'void_approval',
      family: 'urgent',
      silent: false,
      subject: 'order',
      closes_on: 'owner',
      lead_fallback: false,
      expires_at_day_close: true,
      labels: { card: 'alert.void_approval.card', lock: 'alert.void_approval.lock' },
    });
    expect(kind?.steps).toBe(APPROVAL_TIER_STEPS);
    expect(kind?.request).toMatchObject({
      answers: ['approve', 'reject'],
      right: { mode: 'approval', base_permission: 'void-item', range_permission: 'approve-void' },
      needs_pin: 'always',
    });
  });

  it('[04 §3.5] values_schema: the raise-time plan; touched_ids 1–40; dispositions per §4.4 or null per line', () => {
    expect(VoidValues.parse(VALUES)).toEqual(VALUES);
    expect(VoidValues.safeParse({ ...VALUES, touched_ids: [] }).success).toBe(false);
    expect(VoidValues.safeParse({ ...VALUES, touched_ids: Array.from({ length: 41 }, (_, i) => `L${i}`) }).success).toBe(false);
    expect(VoidValues.safeParse({ ...VALUES, touched_ids: Array.from({ length: 40 }, (_, i) => `L${i}`) }).success).toBe(true);
    expect(VoidValues.safeParse({ ...VALUES, disposition: 'resell' }).success).toBe(false);
    expect(VoidValues.safeParse({ ...VALUES, reason_code: 'bored' }).success).toBe(false);
    expect(VoidValues.safeParse({ ...VALUES, line_dispositions: { L1: 'resell' } }).success).toBe(false);
    expect(VoidValues.safeParse({ ...VALUES, units: 0 }).success).toBe(false);
    expect(VoidValues.safeParse({ ...VALUES, refund_minor: -1 }).success).toBe(false);
    expect(VoidValues.safeParse({ ...VALUES, comp_voided_minor: 1.5 }).success).toBe(false);
    expect(VoidValues.safeParse({ ...VALUES, note: 'x'.repeat(201) }).success).toBe(false);
  });

  it('[04 §3.5] details_schema (v6, G-10): item, quantity, amount, reason, identifier, disposition, lines (required, ≤ 10)', () => {
    const details = { item: 'Chicken karahi', quantity: 1, amount: 120_000, reason: 'customer_changed_mind', identifier: 'T4', disposition: 'void.disposition.wastage', lines: [{ name: 'Chicken karahi', quantity: 1, state: 'cooking' as const }] };
    expect(VoidDetails.parse(details)).toEqual(details);
    expect(VoidDetails.safeParse({ ...details, identifier: 'x'.repeat(41) }).success).toBe(false);
    expect(VoidDetails.safeParse({ ...details, lines: undefined }).success).toBe(false);
  });

  it('[04 §3.4, §6.2] request.apply throws "not built" until v7 (nothing raises one before v6); onWithdraw → []', () => {
    const ctx = {} as AlertApplyCtx<typeof VALUES, never>;
    const answer: AnswerFacts = { decision: 'approve', answerer_staff_id: 'M1', method: 'pin', device_id: 'D1', answered_at: 0 };
    expect(() => VOID_APPROVAL.request?.apply(ctx as never, answer)).toThrow(/not built \(task v7\)/);
    expect(VOID_APPROVAL.request?.onWithdraw?.(ctx as never)).toEqual([]);
  });
});

describe('[04 §4.2, §6.6] contracts and guards before their tasks', () => {
  let hub: TestHub;
  beforeEach(async () => {
    hub = await createTestHub({ provisioned: true });
  });
  afterEach(async () => {
    provideVoids({ mergeGuard: undefined });
    await hub.close();
  });

  it('[04 §4.2] pendingVoids throws "not built" until v8', () => {
    expect(() => pendingVoids(hub.deps.db, ['O1'])).toThrow(/not built \(task v8\)/);
    expect(() => pendingVoids(hub.deps.db, ['O1'], {} as EngineState)).toThrow(/not built \(task v8\)/);
  });

  it('[04 §6.6] the guards are no-ops until v8: never blocked, 0 statements', () => {
    const counter = statementCounter(hub.deps.db);
    expect(voidMergeGuard(hub.deps.db, { seating_ids: ['S1'], order_ids: ['O1'] })).toEqual({ blocked: false, order_item_ids: [] });
    expect(voidLineGuard(hub.deps.db, 'O1', ['L1'])).toBeNull();
    expect(voidDayCloseGuard(hub.deps.db, {} as EngineState)).toBeNull();
    expect(counter.count).toBe(0);
  });

  it('[04 §6.6] registerVoids registers the merge guard: the no-op leaves merges unblocked, a provided guard is asked', () => {
    const counter = statementCounter(hub.deps.db);
    expect(checkMergeGuard(hub.deps.db, { seating_ids: ['S1', 'S2'] })).toEqual({ blocked: false, order_item_ids: [] });
    expect(counter.count).toBe(0);
    const calls: unknown[] = [];
    provideVoids({
      mergeGuard: (_db, q) => {
        calls.push(q);
        return { blocked: true, order_item_ids: ['L1'] };
      },
    });
    expect(checkMergeGuard(hub.deps.db, { seating_ids: ['S1'], order_ids: ['O1'] })).toEqual({ blocked: true, order_item_ids: ['L1'] });
    expect(calls).toEqual([{ seating_ids: ['S1'], order_ids: ['O1'] }]);
  });
});
