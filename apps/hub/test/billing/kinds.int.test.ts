import type { Permission } from '@pos/domain';
import type { EventDraft, PosEvent } from '@pos/events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APPROVAL_TIER_STEPS, kindOf, type AlertApplyCtx, type AnswerFacts } from '../../src/alerts/kinds';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { currentDirectory } from '../../src/auth/guards';
import {
  BILL_KINDS,
  CLOSE_WITHOUT_BUYER_ID,
  DISCOUNT,
  FISCAL_OUTBOX_STUCK,
  PETTY_CASH,
  REMOVE_COMP,
  REMOVE_SERVICE_CHARGE,
  REOPEN_BILL,
  SHIFT_VARIANCE,
} from '../../src/billing/kinds/index';
import { applyDiscountRequest } from '../../src/billing/commands/discount';
import { applyPettyCash } from '../../src/billing/commands/petty-cash';
import { applyRemoveComp } from '../../src/billing/commands/remove-comp';
import { applyReopenBill } from '../../src/billing/commands/reopen-bill';
import { applyRemoveServiceCharge } from '../../src/billing/commands/service-charge';
import { applyShiftVariance } from '../../src/billing/commands/shift-close';
import { applyCloseWithoutBuyerId } from '../../src/billing/commands/waive-buyer-id';
import { registerBillKindApply, resetBillKindApplies } from '../../src/billing/kinds/seam';
import type { BillRequestKind } from '../../src/billing/kinds/values';
import type { CommandCtx } from '../../src/commands/registry';
import { signIn, startBilling, STAFF, type Who } from './fixtures';
import type { TestHub } from '../helpers/test-hub';

// 05 §3.14, §3.15, row D-1 (task 9; integrator ruling on the task-9 STOP, option (c)): the seven request kinds and
// `fiscal_outbox_stuck`, registered at module load; holders right per kind; approvals routed to the row B-2 approver
// roles (the cloud DEFAULT_ROLES directory); the `apply` seam (registerBillKindApply) throws `not built` until the
// command task registers its own `apply` — since task 19 every request kind is built.

const OWNER = 'S_OWNER';

// Every 05 kind's real apply (its command file registers it at module load). The seam tests reset the seam and fake
// one; afterEach puts the real ones back, so later tests (and this file's routing tests) see the seam as boot leaves it.
const REAL_APPLIES = {
  discount: applyDiscountRequest,
  remove_service_charge: applyRemoveServiceCharge,
  reopen_bill: applyReopenBill,
  remove_comp: applyRemoveComp,
  close_without_buyer_id: applyCloseWithoutBuyerId,
  petty_cash: applyPettyCash,
  shift_variance: applyShiftVariance,
} as const;

afterEach(() => {
  resetBillKindApplies();
  for (const [kind, apply] of Object.entries(REAL_APPLIES)) registerBillKindApply(kind as BillRequestKind, { apply: apply as never });
});

const APPROVAL: Array<[BillRequestKind, Permission, string]> = [
  ['discount', 'apply-discount', 'bill'],
  ['remove_service_charge', 'remove-service-charge', 'bill'],
  ['reopen_bill', 'reopen-bill', 'bill'],
  ['remove_comp', 'remove-comp', 'order'],
  ['close_without_buyer_id', 'close-without-buyer-id', 'bill'],
];
const HOLDERS: BillRequestKind[] = ['petty_cash', 'shift_variance'];

const BY_NAME = {
  discount: DISCOUNT,
  remove_service_charge: REMOVE_SERVICE_CHARGE,
  reopen_bill: REOPEN_BILL,
  remove_comp: REMOVE_COMP,
  close_without_buyer_id: CLOSE_WITHOUT_BUYER_ID,
  petty_cash: PETTY_CASH,
  shift_variance: SHIFT_VARIANCE,
  fiscal_outbox_stuck: FISCAL_OUTBOX_STUCK,
} as const;

/** One valid raise per kind: values ids only, details in AlertDetailsBase keys. */
const RAISE: Record<BillRequestKind, Pick<RaiseInput, 'subject' | 'values' | 'details' | 'dedupe_key'>> = {
  discount: { subject: { stream_type: 'bill', stream_id: 'B1' }, values: { bill_id: 'B1', kind: 'percent', value: 1_000, reason_code: 'regular_customer', note_id: null, has_note: false }, details: { amount: 50_000, reason: 'regular_customer', identifier: 'T4' }, dedupe_key: 'discount:B1' },
  remove_service_charge: { subject: { stream_type: 'bill', stream_id: 'B1' }, values: { bill_id: 'B1', reason_code: 'customer_request', note_id: 'N1', has_note: true }, details: { amount: 20_000, reason: 'customer_request', identifier: 'T4' }, dedupe_key: 'remove_sc:B1' },
  reopen_bill: { subject: { stream_type: 'bill', stream_id: 'B1' }, values: { bill_id: 'B1', invoice_ids: ['I1'], credit_invoice_ids: ['C1'], reason_code: 'wrong_payment_mode', note_id: null, has_note: false }, details: { amount: 300_000, reason: 'wrong_payment_mode', identifier: 'T4' }, dedupe_key: 'reopen:B1' },
  remove_comp: { subject: { stream_type: 'order', stream_id: 'O1' }, values: { order_id: 'O1', order_item_id: 'L1', units: 1, reason_code: 'comped_by_mistake', note_id: null, has_note: false }, details: { amount: 3_000, reason: 'comped_by_mistake', identifier: 'T4' }, dedupe_key: 'remove_comp:L1' },
  close_without_buyer_id: { subject: { stream_type: 'bill', stream_id: 'B1' }, values: { bill_id: 'B1', note_id: null, has_note: false }, details: { amount: 6_000_000, identifier: 'T4' }, dedupe_key: 'buyer_waiver:B1' },
  petty_cash: { subject: { stream_type: 'shift', stream_id: 'SH1' }, values: { entry_id: 'E1', kind: 'out', shift_id: 'SH1', amount_minor: 600_000, category_id: 'supplies', has_paid_to: true, advance_staff_id: null, has_note: true }, details: { amount: 600_000, reason: 'supplies' }, dedupe_key: 'petty:CMD1' },
  shift_variance: { subject: { stream_type: 'shift', stream_id: 'SH1' }, values: { shift_id: 'SH1', note_id: null, has_note: false }, details: { amount: -15_000 }, dedupe_key: 'variance:SH1' },
};

describe('[05 §3.14, §3.15, row D-1] the eight 05 kinds (definitions)', () => {
  it('[05 §4.2] BILL_KINDS = the seven §3.14 kinds + fiscal_outbox_stuck; each is registered at module load', () => {
    expect([...BILL_KINDS]).toEqual(['discount', 'remove_service_charge', 'reopen_bill', 'remove_comp', 'close_without_buyer_id', 'petty_cash', 'shift_variance', 'fiscal_outbox_stuck']);
    for (const name of BILL_KINDS) expect(kindOf(name), name).toBe(BY_NAME[name]);
  });

  it('[05 §3.14] approval kinds: right approval on their base permission, approval tier steps, PIN always, closes on owner', () => {
    for (const [name, permission, subject] of APPROVAL) {
      const kind = kindOf(name)!;
      expect(kind, name).toMatchObject({ kind: name, family: 'urgent', subject, closes_on: 'owner', lead_fallback: false, expires_at_day_close: true, silent: false, labels: { card: `alert.${name}.card`, lock: `alert.${name}.lock` } });
      expect(kind.steps, name).toBe(APPROVAL_TIER_STEPS);
      expect(kind.request, name).toMatchObject({ answers: ['approve', 'reject'], right: { mode: 'approval', base_permission: permission }, needs_pin: 'always' });
      expect(kind.request!.right, name).not.toHaveProperty('range_permission');
      expect(kind.link, `${name}: 05 kinds register no link (01d D-1)`).toBeUndefined();
    }
  });

  it('[05 §3.14, H1-1] petty_cash and shift_variance: right holders of close-shift-for-others, whatever the grant', () => {
    for (const name of HOLDERS) {
      const kind = kindOf(name)!;
      expect(kind, name).toMatchObject({ kind: name, family: 'urgent', subject: 'shift', closes_on: 'owner', lead_fallback: false, expires_at_day_close: true, silent: false });
      expect(kind.steps, name).toBe(APPROVAL_TIER_STEPS);
      expect(kind.request, name).toMatchObject({ answers: ['approve', 'reject'], right: { mode: 'holders', permission: 'close-shift-for-others' }, needs_pin: 'always' });
      expect(kind.link, name).toBeUndefined();
    }
  });

  it('[05 §3.15, H1-18, row D-1] fiscal_outbox_stuck: action, no request, managers at step 0, closes_on owner, expires at day close', () => {
    const kind = kindOf('fiscal_outbox_stuck')!;
    expect(kind).toMatchObject({ family: 'action', subject: 'hub', closes_on: 'owner', expires_at_day_close: true, lead_fallback: false, silent: false, request: null, labels: { card: 'alert.fiscal_outbox_stuck.card', lock: 'alert.fiscal_outbox_stuck.lock' } });
    expect(kind.steps).toEqual([{ at: { ms: 0 }, to: [{ target: { kind: 'managers' }, set: 'recipient' }] }]);
    expect(kind.link).toBeUndefined();
    expect(kind.details_schema!.parse({ quantity: 3, minutes_late: 42 })).toEqual({ quantity: 3, minutes_late: 42 });
    expect(kind.details_schema!.parse({ quantity: 3, amount: 1, reason: 'x' })).toEqual({ quantity: 3 }); // existing keys only (H2-6)
  });

  it('[05 §3.14, H3-5, H4-4] values: ids, codes, amounts and note_id / has_note only; text keys are dropped; details keep AlertDetailsBase keys', () => {
    for (const name of [...APPROVAL.map(([n]) => n), ...HOLDERS]) {
      const kind = kindOf(name)!;
      const values = RAISE[name].values!;
      expect(kind.values_schema.parse(values), name).toEqual(values);
      const withText = kind.values_schema.parse({ ...values, note: 'secret', paid_to: 'Ali', name: 'Buyer' }) as Record<string, unknown>;
      expect(Object.keys(withText).sort(), name).toEqual(Object.keys(values).sort());
      expect(kind.details_schema!.parse({ ...RAISE[name].details, item: 'x', lines: [] }), name).toEqual(RAISE[name].details);
    }
    expect(kindOf('reopen_bill')!.values_schema.safeParse({ ...RAISE.reopen_bill.values, invoice_ids: [] }).success).toBe(false);
    // ⚠️ 05 v1.0.15 R-66 / G-62: one distinct credit id per invoice id, minted at raise
    expect(kindOf('reopen_bill')!.values_schema.safeParse({ ...RAISE.reopen_bill.values, credit_invoice_ids: undefined }).success).toBe(false);
    expect(kindOf('reopen_bill')!.values_schema.safeParse({ ...RAISE.reopen_bill.values, credit_invoice_ids: ['C1', 'C2'] }).success).toBe(false);
    expect(kindOf('reopen_bill')!.values_schema.safeParse({ ...RAISE.reopen_bill.values, invoice_ids: ['I1', 'I2'], credit_invoice_ids: ['C1', 'C1'] }).success).toBe(false);
    expect(kindOf('reopen_bill')!.values_schema.safeParse({ ...RAISE.reopen_bill.values, invoice_ids: ['I1', 'I2'], credit_invoice_ids: ['C1', 'C2'] }).success).toBe(true);
    expect(kindOf('remove_comp')!.values_schema.safeParse({ ...RAISE.remove_comp.values, units: 0 }).success).toBe(false);
    expect(kindOf('petty_cash')!.values_schema.safeParse({ ...RAISE.petty_cash.values, kind: 'loan' }).success).toBe(false);
    // as the petty events: advance_staff_id on an advance only
    expect(kindOf('petty_cash')!.values_schema.safeParse({ ...RAISE.petty_cash.values, advance_staff_id: 'S_WAIT' }).success).toBe(false);
    expect(kindOf('petty_cash')!.values_schema.safeParse({ ...RAISE.petty_cash.values, kind: 'advance' }).success).toBe(false);
    expect(kindOf('petty_cash')!.values_schema.safeParse({ ...RAISE.petty_cash.values, kind: 'advance', advance_staff_id: 'S_WAIT' }).success).toBe(true);
    expect(kindOf('discount')!.values_schema.safeParse({ ...RAISE.discount.values, kind: 'free' }).success).toBe(false);
  });
});

describe('[05 §3.14, PL-5 (integrator ruling, option (c))] the apply seam', () => {
  const answer: AnswerFacts = { decision: 'approve', answerer_staff_id: 'S_MGR', method: 'pin', device_id: 'D1', answered_at: 0 };
  const ctx = { alert: { alert_id: 'A1' } } as unknown as AlertApplyCtx<never, never>;

  it('[05 §3.14] every request kind is built: each registered apply is the command file\'s own (task 19 built the last, reopen_bill); onWithdraw → [] (as if never asked)', () => {
    // tasks 13 discount, 14 remove_service_charge, 18 close_without_buyer_id, 19 reopen_bill, 20 remove_comp, 21 shift_variance, 22 petty_cash
    const BUILT: BillRequestKind[] = ['discount', 'remove_service_charge', 'reopen_bill', 'remove_comp', 'close_without_buyer_id', 'petty_cash', 'shift_variance'];
    expect([...BUILT].sort()).toEqual([...APPROVAL.map(([n]) => n), ...HOLDERS].sort());
    for (const [kind, apply] of Object.entries(REAL_APPLIES) as Array<[BillRequestKind, (...a: never[]) => EventDraft[]]>) {
      // the same function again is ignored: proof the real one is the registered one
      expect(() => registerBillKindApply(kind, { apply: apply as never }), kind).not.toThrow();
      expect(() => registerBillKindApply(kind, { apply: (() => []) as never }), kind).toThrow(new RegExp(kind));
    }
    for (const name of BUILT) {
      const request = kindOf(name)!.request!;
      expect(request.onWithdraw?.(ctx as never), name).toEqual([]);
    }
  });

  it('[05 §3.14] after resetBillKindApplies a kind is not built (approve and reject alike); a registered apply is called with the alert ctx and the answer, and its drafts are returned', () => {
    resetBillKindApplies();
    expect(() => REOPEN_BILL.request!.apply(ctx as never, answer)).toThrow(/not built/);
    expect(() => REOPEN_BILL.request!.apply(ctx as never, { ...answer, decision: 'reject' })).toThrow(/not built/);
    const drafts = [{ event_type: 'BillReopened' }] as unknown as EventDraft[];
    const apply = vi.fn(() => drafts);
    registerBillKindApply('reopen_bill', { apply });
    expect(REOPEN_BILL.request!.apply(ctx as never, answer)).toBe(drafts);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(ctx, answer);
  });

  it('[05 §3.14] re-registering the same function is ignored (guard-list rule); a different function for the same kind throws', () => {
    resetBillKindApplies();
    const apply = vi.fn(() => []);
    registerBillKindApply('reopen_bill', { apply });
    expect(() => registerBillKindApply('reopen_bill', { apply })).not.toThrow();
    REOPEN_BILL.request!.apply(ctx as never, answer);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(() => registerBillKindApply('reopen_bill', { apply: () => [] })).toThrow(/reopen_bill/);
    resetBillKindApplies();
    expect(() => REOPEN_BILL.request!.apply(ctx as never, answer)).toThrow(/not built/);
  });
});

// ------------------------------------------------------------------------------------------- routing (row B-2)

function raiseAs(hub: TestHub, who: Who, input: RaiseInput): string {
  return hub.deps.writer.run((tx) => {
    const ctx = {
      tx,
      state: tx.state,
      clock: tx.clock,
      ids: tx.ids,
      secrets: hub.deps.secrets,
      actor: { kind: 'staff', staffId: who.staffId, stationId: null, sessionId: who.sessionId, deviceId: who.deviceId },
      permission: null,
      branch: { tenantId: 'tenant-a', branchId: 'branch-1' },
      directory: currentDirectory(hub.app),
      config: hub.deps.config,
    } as unknown as CommandCtx;
    const result = alerts.raise(ctx, input);
    tx.append(result.events);
    return result.alert_id;
  }).result;
}

function eventsOf(hub: TestHub, type: string, alert_id: string): PosEvent[] {
  return (hub.deps.db.prepare('SELECT * FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<Record<string, unknown>>)
    .map((row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent)
    .filter((e) => (e.payload as { alert_id: string }).alert_id === alert_id);
}

/**
 * The recipients of the raise's sent step: AttemptSent(0), or, for an approval kind whose answerers have no route
 * (test sessions hold no socket), 01d's G1-9d shortcut EscalationStepped (same answerers, widened sets).
 */
function step0(hub: TestHub, alert_id: string, set: string): string[] {
  const sent = [...eventsOf(hub, 'AttemptSent', alert_id), ...eventsOf(hub, 'EscalationStepped', alert_id)][0]!;
  return (sent.payload as { recipients: Array<{ staff_id: string | null; set: string }> }).recipients
    .filter((r) => r.set === set && r.staff_id !== null)
    .map((r) => r.staff_id!)
    .sort();
}

describe('[05 §3.14, rows B-2 / D-1] approvals route to the B-2 approver roles', () => {
  const hubs: TestHub[] = [];
  afterEach(async () => {
    for (const hub of hubs.splice(0)) await hub.close();
  });

  async function seated(): Promise<{ hub: TestHub; cashier: Who }> {
    const hub = await startBilling();
    hubs.push(hub);
    signIn(hub, OWNER);
    signIn(hub, STAFF.manager);
    signIn(hub, STAFF.orderTaker);
    return { hub, cashier: signIn(hub, STAFF.cashier) };
  }

  it('[05 §3.14, B-2] the five approval kinds: the Cashier grant is requires_approval by the Manager role; step 0 reaches the Manager, never the requester', async () => {
    const { hub, cashier } = await seated();
    const directory = currentDirectory(hub.app);
    for (const [name, permission] of APPROVAL) {
      const grant = directory.resolve(STAFF.cashier, permission);
      expect(grant, name).toMatchObject({ grant: 'requires_approval', approver_role_ids: ['R_MGR'] });
      if (grant.grant !== 'requires_approval') throw new Error('unreachable');
      const id = raiseAs(hub, cashier, { kind: name, target: { kind: 'answerers' }, display: { kind_label_key: `alert.${name}.lock` }, requester_staff_id: STAFF.cashier, request: { approver_role_ids: grant.approver_role_ids }, ...RAISE[name] });
      const raised = eventsOf(hub, 'AlertRaised', id)[0]!;
      expect(raised.schema_version, name).toBe(5);
      expect((raised.payload as { request: unknown }).request, name).toMatchObject({ right_mode: 'approval', base_permission: permission, approver_role_ids: ['R_MGR'], needs_pin: 'always' });
      expect(step0(hub, id, 'answerer'), name).toEqual([STAFF.manager]);
    }
  });

  it('[05 §3.14, H1-1, B-2] petty_cash and shift_variance: step 0 = holders of close-shift-for-others (Owner, Manager), never the requester', async () => {
    const { hub, cashier } = await seated();
    for (const name of HOLDERS) {
      const id = raiseAs(hub, cashier, { kind: name, target: { kind: 'answerers' }, display: { kind_label_key: `alert.${name}.lock` }, requester_staff_id: STAFF.cashier, request: {}, ...RAISE[name] });
      const raised = eventsOf(hub, 'AlertRaised', id)[0]!;
      expect((raised.payload as { request: unknown }).request, name).toMatchObject({ right_mode: 'holders', base_permission: 'close-shift-for-others', approver_role_ids: [] });
      expect(step0(hub, id, 'answerer'), name).toEqual([STAFF.manager, OWNER].sort());
    }
  });

  it('[05 §3.14, H1-1] a Manager\'s own petty_cash request reaches the Owner only: the requester never answers their own', async () => {
    const hub = await startBilling();
    hubs.push(hub);
    signIn(hub, OWNER);
    signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const id = raiseAs(hub, manager, { kind: 'petty_cash', target: { kind: 'answerers' }, display: { kind_label_key: 'alert.petty_cash.lock' }, requester_staff_id: STAFF.manager, request: {}, ...RAISE.petty_cash });
    expect(step0(hub, id, 'answerer')).toEqual([OWNER]);
  });

  it('[05 §3.15] fiscal_outbox_stuck goes to the managers, details counts only', async () => {
    const { hub, cashier } = await seated();
    const id = raiseAs(hub, cashier, {
      kind: 'fiscal_outbox_stuck',
      subject: { stream_type: 'hub', stream_id: 'branch-1' },
      target: { kind: 'managers' },
      display: { kind_label_key: 'alert.fiscal_outbox_stuck.lock' },
      details: { quantity: 2, minutes_late: 45 },
      dedupe_key: 'fiscal_stuck:branch-1',
      requester_staff_id: null,
    });
    const recipients = step0(hub, id, 'recipient');
    expect(recipients).toContain(STAFF.manager);
    expect(recipients).not.toContain(STAFF.cashier);
    expect((eventsOf(hub, 'AlertRaised', id)[0]!.payload as { details: unknown }).details).toEqual({ quantity: 2, minutes_late: 45 });
  });
});
