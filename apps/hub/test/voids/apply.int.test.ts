// 04 §3.4, §6.2 (task v7), §10 tests 21–26c, 30–30c, 31: the kind's real `apply`, `onWithdraw` and `result_also_to`,
// driven through VoidItems (v6 raise) and 01d's real AnswerRequest / WithdrawRequest.
import type { EngineState } from '@pos/engine';
import { afterEach, describe, expect, it } from 'vitest';
import type { AlertApplyCtx, AnswerFacts } from '../../src/alerts/kinds';
import type { LineChangeDrafts } from '../../src/orders/contracts';
import { checkLineGuard } from '../../src/orders/line-guard';
import { lineChangeDrafts } from '../../src/orders/line-change';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { VOID_APPROVAL, voidApplyDeps, type VoidValues } from '../../src/voids/kind';
import { statementCounter } from '../helpers/statement-counter';
import { auditDirectory } from '../audit/fixtures';
import type { TestHub } from '../helpers/test-hub';
import {
  answer,
  appendOrder,
  dealX2,
  FX,
  openSeating,
  PIN,
  post,
  signIn,
  STAFF,
  stagedOrder,
  startVoids,
  strictRefold,
  optionChildOrder,
  pendingWeight,
  raiseVoid,
  toStage,
  voidsDirectory,
  VX,
  type Reply,
  type Who,
} from './fixtures';


let hub: TestHub;

afterEach(async () => {
  voidApplyDeps.lineChangeDrafts = lineChangeDrafts;
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

const state = (): EngineState => hub.deps.state.get();
const events = (): number => hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number;
const ofType = (r: Reply, t: string) => r.events.filter((e) => e.event_type === t);
const ALERT_SIDE = new Set(['RequestAnswered', 'AlertRaised', 'AttemptSent', 'StepSkipped', 'AlertClosed', 'RequestWithdrawn']);
const kindEvents = (r: Reply) => r.events.filter((e) => !ALERT_SIDE.has(e.event_type));
const lineRow = (id: string) =>
  hub.deps.db.prepare('SELECT units, voided_units, refund_minor, comp_voided_minor, refundable_minor FROM order_lines WHERE order_item_id = ?').get(id) as {
    units: number;
    voided_units: number;
    refund_minor: number;
    comp_voided_minor: number;
    refundable_minor: number;
  };
const alertState = (id: string) => hub.deps.db.prepare('SELECT state FROM alerts WHERE alert_id = ?').pluck().get(id) as string;

type Line = { order_item_id: string; units?: number; disposition: 'moved' | 'wastage' | 'staff_meal' | 'other' };
/** VoidItems by `who` (the Cashier: requires approval by Manager); the one request's alert_id. */
async function ask(who: Who, order_id: string, lines: Line[]): Promise<{ reply: Reply; alert_ids: string[] }> {
  const reply = await post(hub, who, 'void-items', 'VoidItems', { order_id, reason_code: 'customer_changed_mind', note: null, disposition_note: null, lines });
  if (reply.status !== 200) throw new Error(`ask: ${reply.status} ${JSON.stringify(reply.error)}`);
  return { reply, alert_ids: (reply.result as { pending: Array<{ alert_id: string }> }).pending.map((p) => p.alert_id) };
}

describe('[04 §3.4, §6.2] approve', () => {
  // v8: the line guard is live (registerVoids → lanes/V2.ts at boot), so these run against the real guard.
  it('[04 #21/#27] comp on a locked line → VOID_PENDING, also by cascade: comp of the item whose option child is locked, comp of the deal whose part is locked', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const comp = (order_item_id: string) => post(hub, manager, 'comp-line', 'CompLine', { order_item_id, units: 1, reason_code: 'guest' });
    const oc = optionChildOrder(hub);
    toStage(hub, oc.order_id, [oc.child], 'cooking');
    const child = await ask(cashier, oc.order_id, [{ order_item_id: oc.child, disposition: 'wastage' }]);
    expect((await comp(oc.child)).error).toEqual({ code: 'VOID_PENDING', details: { alert_id: child.alert_ids[0], order_item_id: oc.child } });
    expect((await comp(oc.item)).error).toEqual({ code: 'VOID_PENDING', details: { alert_id: child.alert_ids[0], order_item_id: oc.child } });
    const d = dealX2(hub);
    toStage(hub, d.order_id, [d.karahiPart], 'cooking');
    const part = await ask(cashier, d.order_id, [{ order_item_id: d.karahiPart, units: 1, disposition: 'wastage' }]);
    expect((await comp(d.deal)).error).toEqual({ code: 'VOID_PENDING', details: { alert_id: part.alert_ids[0], order_item_id: d.karahiPart } });
    expect(hub.deps.db.prepare("SELECT COUNT(*) FROM events WHERE event_type = 'LineComped'").pluck().get()).toBe(0);
    // the lock lifts with the request: the same comp then goes through
    expect((await answer(hub, cashier, part.alert_ids[0]!, 'withdraw')).status).toBe(200);
    const after = await comp(d.deal);
    expect(after.status, JSON.stringify(after.error)).toBe(200);
  });

  it('[04 #21/#27] comp raise (requires_approval) on a locked line → VOID_PENDING; applyComp asks the guard too: a comp request whose planned lines meet a void lock (fixture) → the comp approve is refused VOID_PENDING (H1-7)', async () => {
    hub = await startVoids({ directory: await auditDirectory() });
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const locked = await ask(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }]);
    const raise = await post(hub, cashier, 'comp-line', 'CompLine', { order_item_id: s.cooking, units: 1, reason_code: 'guest' });
    expect(raise.error).toEqual({ code: 'VOID_PENDING', details: { alert_id: locked.alert_ids[0], order_item_id: s.cooking } });
    // a state rule 6 (c) prevents in normal use: the comp request first, then a void request on its line (raiseVoid skips rule 6)
    const asked = await post(hub, cashier, 'comp-line', 'CompLine', { order_item_id: s.done, units: 1, reason_code: 'guest' });
    expect(asked.status, JSON.stringify(asked.error)).toBe(200);
    const compId = asked.result!.alert_id as string;
    const lock = raiseVoid(hub, { requester: cashier, order_id: s.order_id, order_item_id: s.done });
    const approve = await answer(hub, manager, compId, 'approve');
    expect(approve.error).toEqual({ code: 'VOID_PENDING', details: { alert_id: lock.alert_id, order_item_id: s.done } });
    expect(alertState(compId)).toBe('open');
    expect(lineRow(s.done)).toMatchObject({ voided_units: 0 });
    expect(hub.deps.db.prepare('SELECT comped_units FROM order_lines WHERE order_item_id = ?').pluck().get(s.done)).toBe(0);
    expect(hub.deps.db.prepare("SELECT COUNT(*) FROM events WHERE event_type = 'LineComped'").pluck().get()).toBe(0);
  });

  it('[04 #21/#27] RemoveItems of a locked deal\'s stage-1 part → VOID_PENDING; SetLineWeight on a locked line → VOID_PENDING; after the withdraw both go through', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const d = dealX2(hub);
    toStage(hub, d.order_id, [d.karahiPart], 'cooking');
    const deal = await ask(cashier, d.order_id, [{ order_item_id: d.deal, units: 1, disposition: 'wastage' }]);
    const remove = () => post(hub, manager, 'remove-items', 'RemoveItems', { order_id: d.order_id, lines: [{ order_item_id: d.naanPart, units: 1 }] });
    expect((await remove()).error).toEqual({ code: 'VOID_PENDING', details: { alert_id: deal.alert_ids[0], order_item_id: d.naanPart } });
    const w = pendingWeight(hub);
    const weighed = await ask(cashier, w.order_id, [{ order_item_id: w.line, disposition: 'wastage' }]);
    const weigh = () => post(hub, manager, 'set-line-weight', 'SetLineWeight', { order_item_id: w.line, quantity: 500 });
    expect((await weigh()).error).toEqual({ code: 'VOID_PENDING', details: { alert_id: weighed.alert_ids[0], order_item_id: w.line } });
    expect((await answer(hub, cashier, deal.alert_ids[0]!, 'withdraw')).status).toBe(200);
    expect((await answer(hub, cashier, weighed.alert_ids[0]!, 'withdraw')).status).toBe(200);
    const removed = await remove();
    expect(removed.status, JSON.stringify(removed.error)).toBe(200);
    const set = await weigh();
    expect(set.status, JSON.stringify(set.error)).toBe(200);
  });

  it('[04 H1-1] approve never asks the line guard on its own request: with the guard live (it locks every touched line) the approve applies', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const d = dealX2(hub);
    toStage(hub, d.order_id, [d.karahiPart], 'cooking');
    const { alert_ids } = await ask(cashier, d.order_id, [{ order_item_id: d.deal, units: 1, disposition: 'wastage' }]);
    for (const id of [d.deal, d.karahiPart, d.naanPart]) expect(checkLineGuard(hub.deps.db, d.order_id, [id])).toEqual({ alert_id: alert_ids[0], order_item_id: id });
    const r = await answer(hub, manager, alert_ids[0]!, 'approve');
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(ofType(r, 'ItemVoided').map((e) => e.payload.order_item_id)).toEqual([d.deal, d.karahiPart, d.naanPart]);
    expect(checkLineGuard(hub.deps.db, d.order_id, [d.deal, d.karahiPart, d.naanPart])).toBeNull();
  });

  it('[04 #47] with the guard live the approved refund = the raise-time refund (details.amount = Σ applied refund_minor); a comp tried in between is refused, so the plan cannot drift', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const d = dealX2(hub);
    toStage(hub, d.order_id, [d.karahiPart], 'cooking');
    const { alert_ids } = await ask(cashier, d.order_id, [{ order_item_id: d.deal, units: 1, disposition: 'wastage' }]);
    const details = JSON.parse(hub.deps.db.prepare('SELECT details_json FROM alerts WHERE alert_id = ?').pluck().get(alert_ids[0]) as string) as { amount: number };
    expect(details.amount).toBeGreaterThan(0);
    expect((await post(hub, manager, 'comp-line', 'CompLine', { order_item_id: d.deal, units: 1, reason_code: 'guest' })).error?.code).toBe('VOID_PENDING');
    expect((await post(hub, manager, 'remove-items', 'RemoveItems', { order_id: d.order_id, lines: [{ order_item_id: d.naanPart, units: 1 }] })).error?.code).toBe('VOID_PENDING');
    const r = await answer(hub, manager, alert_ids[0]!, 'approve');
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(ofType(r, 'ItemVoided').reduce((sum, e) => sum + (e.payload.refund_minor as number), 0)).toBe(details.amount);
  });

  it('[04 #21] approve → applied: alert_id on every draft (checkAlertIds passes), approver = answerer, requester = raiser; moved karahi re-reserved for T4; audit rows; strict refold', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    openSeating(hub, { table_id: VX.tables.T4, seating_id: 'SEAT_T4' });
    const t4 = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT_T4', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'T4_K', item_id: FX.piece }, { order_item_id: 'T4_HOLD', item_id: VX.slow }] });
    const { alert_ids } = await ask(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'moved' }]);
    const r = await answer(hub, manager, alert_ids[0]!, 'approve');
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(kindEvents(r).map((e) => e.event_type)).toEqual(['ItemMovedToStock', 'StockAdded', 'StockReserved', 'ItemVoided']);
    for (const e of kindEvents(r)) expect(e.payload.alert_id, e.event_type).toBe(alert_ids[0]);
    expect(ofType(r, 'ItemVoided')[0]!.payload).toMatchObject({ disposition: 'moved', requester_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager, reason_code: 'customer_changed_mind' });
    expect(ofType(r, 'StockReserved')[0]!.payload).toMatchObject({ order_item_id: 'T4_K' });
    expect(t4.order_id).toBeDefined();
    expect(lineRow(s.cooking)).toMatchObject({ voided_units: 1 });
    expect(alertState(alert_ids[0]!)).not.toBe('open');
    // §3.6 (a2 merged): the audit rows — the requester is the actor, the answerer the approver
    const audit = hub.deps.db.prepare(`SELECT action, actor_staff_id, approver_staff_id FROM audit_entries WHERE order_id = ? AND action IN ('item_voided', 'item_moved_to_stock') ORDER BY seq`).all(s.order_id);
    expect(audit).toEqual([
      { action: 'item_moved_to_stock', actor_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager },
      { action: 'item_voided', actor_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager },
    ]);
    expect(strictRefold(hub)).toEqual(state());
  });

  it('[04 V5, K-1] approve of a §6.8 deal variant that is the order\'s only food: StockReleased of the unstarted part and the line-change event carry the alert_id too', async () => {
    hub = await startVoids({ stock: { [FX.stock]: 0, [VX.naanStock]: 4 } });
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const deal = (p: string, extra: Array<{ order_item_id: string; item_id: string }>) =>
      appendOrder(hub, {
        order_type: 'takeaway',
        placed_by: STAFF.orderTaker,
        lines: [
          { order_item_id: p, deal_id: FX.deal, quantity: 1 },
          { order_item_id: `${p}_P1`, deal_id: FX.deal, deal_part_id: FX.dealParts[0], item_id: FX.piece, parent_order_item_id: p },
          { order_item_id: `${p}_P2`, deal_id: FX.deal, deal_part_id: FX.dealParts[1], item_id: VX.stockNaan, parent_order_item_id: p },
          ...extra,
        ],
      }).order_id;
    const check = async (order_id: string, p: string, lineChange: string) => {
      toStage(hub, order_id, [`${p}_P1`], 'cooking');
      expect(state().lines[`${p}_P2`]!.draws[0]!.reserved).toBeGreaterThan(0);
      const { alert_ids } = await ask(cashier, order_id, [{ order_item_id: p, disposition: 'moved' }]);
      const r = await answer(hub, manager, alert_ids[0]!, 'approve');
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      const kinds = kindEvents(r).map((e) => e.event_type);
      expect(kinds).toContain('StockReleased');
      expect(kinds).toContain(lineChange);
      for (const e of kindEvents(r)) expect(e.payload.alert_id, e.event_type).toBe(alert_ids[0]);
    };
    // the deal is all the order has → OrderCancelled
    await check(deal('SD', []), 'SD', 'OrderCancelled');
    // a served drink stays live → OrderFoodCleared
    const withDrink = deal('SF', [{ order_item_id: 'SF_N', item_id: FX.naan }]);
    toStage(hub, withDrink, ['SF_N'], 'served');
    await check(withDrink, 'SF', 'OrderFoodCleared');
    expect(strictRefold(hub)).toEqual(state());
  });

  it('[04 #22] approve in_person on the requester\'s device → approver = named answerer, actor_id = the requester device\'s session', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const s = stagedOrder(hub);
    const { alert_ids } = await ask(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }]);
    const r = await post(hub, cashier, 'answer-request', 'AnswerRequest', { alert_id: alert_ids[0], decision: 'approve', method: 'in_person', answerer_staff_id: STAFF.manager, pin: PIN.b });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const v = ofType(r, 'ItemVoided')[0]!;
    expect(v.payload).toMatchObject({ approver_staff_id: STAFF.manager, requester_staff_id: STAFF.cashier, alert_id: alert_ids[0] });
    expect(v.actor_id).toBe(STAFF.cashier);
    expect(v.device_id).toBe(cashier.deviceId);
  });

  it('[04 #25] approve after the order was billed → refused in preRead before any PIN check (a wrong PIN gives ORDER_BILLED, no RequestPinFailed); request stays open', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const { alert_ids } = await ask(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }]);
    hub.deps.db.prepare('UPDATE orders SET billed_at = ? WHERE order_id = ?').run(hub.clock.branchNow(), s.order_id); // 05's bill: fixture
    const n = events();
    const wrongPin = PIN.b === '9999' ? '8888' : '9999';
    const r = await answer(hub, manager, alert_ids[0]!, 'approve', wrongPin);
    expect(r.error).toEqual({ code: 'ORDER_BILLED', details: { order_id: s.order_id } });
    expect(events()).toBe(n); // no RequestPinFailed: the PIN was never checked
    expect((await answer(hub, manager, alert_ids[0]!, 'approve')).error?.code).toBe('ORDER_BILLED');
    expect(alertState(alert_ids[0]!)).toBe('open');
  });

  it('[04 #26b] moved line served meanwhile → approve refused VOID_NOT_ALLOWED { not_movable_stage, hint }; withdraw + re-ask as wastage → approved', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const { alert_ids } = await ask(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'moved' }]);
    toStage(hub, s.order_id, [s.cooking], 'served');
    const r = await answer(hub, manager, alert_ids[0]!, 'approve');
    expect(r.error).toEqual({ code: 'VOID_NOT_ALLOWED', details: { order_item_id: s.cooking, reason: 'not_movable_stage', hint: 'withdraw_and_reask' } });
    expect(alertState(alert_ids[0]!)).toBe('open');
    expect((await answer(hub, cashier, alert_ids[0]!, 'withdraw')).status).toBe(200);
    const again = await ask(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }]);
    const ok = await answer(hub, manager, again.alert_ids[0]!, 'approve');
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    expect(ofType(ok, 'ItemVoided')[0]!.payload).toMatchObject({ disposition: 'wastage' });
  });

  it('[04 #26c] deal part P2 at added at raise, started before the approve → ItemVoided{P2, wastage}, {D, null}; also on a partial portion (1 of 2)', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const d = dealX2(hub);
    toStage(hub, d.order_id, [d.karahiPart], 'cooking');
    const { reply, alert_ids } = await ask(cashier, d.order_id, [{ order_item_id: d.deal, units: 1, disposition: 'wastage' }]);
    const values = ofType(reply, 'AlertRaised')[0]!.payload.values as VoidValues;
    expect(values.line_dispositions).toEqual({ [d.deal]: null, [d.karahiPart]: 'wastage', [d.naanPart]: null });
    toStage(hub, d.order_id, [d.naanPart], 'cooking');
    const r = await answer(hub, manager, alert_ids[0]!, 'approve');
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(ofType(r, 'ItemVoided').map((e) => [e.payload.order_item_id, e.payload.units, e.payload.disposition])).toEqual([
      [d.deal, 1, null],
      [d.karahiPart, 1, 'wastage'],
      [d.naanPart, 2, 'wastage'],
    ]);
    // test 47's half: the applied refund equals the raise-time plan
    expect(ofType(r, 'ItemVoided').reduce((sum, e) => sum + (e.payload.refund_minor as number), 0)).toBe(values.refund_minor);
  });
});

describe('[04 §3.4] reject, withdraw, result_also_to (D-2)', () => {
  it('[04 #23] reject → [], line still billed; request_result to the requester and to the table holder (table_team, owner)', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    signIn(hub, STAFF.orderTaker);
    openSeating(hub, { table_id: VX.tables.T6, seating_id: 'SEAT_T6', holder_staff_id: STAFF.orderTaker });
    const s = stagedOrder(hub, { seating_id: 'SEAT_T6' });
    const { alert_ids } = await ask(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }]);
    const r = await answer(hub, manager, alert_ids[0]!, 'reject');
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(kindEvents(r)).toEqual([]);
    expect(lineRow(s.cooking)).toMatchObject({ voided_units: 0 });
    const results = ofType(r, 'AlertRaised').filter((e) => e.payload.kind === 'request_result');
    expect(results.map((e) => e.payload.dedupe_key)).toEqual([`request_result:${alert_ids[0]}`, `request_result:${alert_ids[0]}:also`]);
    expect(results[1]!.payload.target).toEqual({ kind: 'table_team', table_id: VX.tables.T6, depth: 'owner' });
    // the reject released the lock: the same line can be asked again
    const again = await post(hub, cashier, 'void-items', 'VoidItems', { order_id: s.order_id, reason_code: 'customer_changed_mind', note: null, disposition_note: null, lines: [{ order_item_id: s.cooking, disposition: 'wastage' }] });
    expect(again.status, JSON.stringify(again.error)).toBe(200);
  });

  it('[04 #23] takeaway → requester only; holder = requester → one result', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const t = stagedOrder(hub);
    const a = await ask(cashier, t.order_id, [{ order_item_id: t.cooking, disposition: 'wastage' }]);
    const r1 = await answer(hub, manager, a.alert_ids[0]!, 'reject');
    expect(ofType(r1, 'AlertRaised').filter((e) => e.payload.kind === 'request_result')).toHaveLength(1);
    openSeating(hub, { table_id: VX.tables.T7, seating_id: 'SEAT_T7', holder_staff_id: STAFF.cashier });
    const s = stagedOrder(hub, { seating_id: 'SEAT_T7', prefix: 'HS' });
    const b = await ask(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }]);
    const r2 = await answer(hub, manager, b.alert_ids[0]!, 'reject');
    expect(r2.status, JSON.stringify(r2.error)).toBe(200);
    expect(ofType(r2, 'AlertRaised').filter((e) => e.payload.kind === 'request_result')).toHaveLength(1);
  });

  it('[04 #24] withdraw → [], lock lifted; a new request with a different disposition (moved → wastage) allowed and approved', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const a = await ask(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'moved' }]);
    const w = await answer(hub, cashier, a.alert_ids[0]!, 'withdraw');
    expect(w.status, JSON.stringify(w.error)).toBe(200);
    expect(kindEvents(w)).toEqual([]);
    const b = await ask(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }]);
    const ok = await answer(hub, manager, b.alert_ids[0]!, 'approve');
    expect(ok.status).toBe(200);
    expect(ofType(ok, 'ItemVoided')[0]!.payload).toMatchObject({ disposition: 'wastage', alert_id: b.alert_ids[0] });
  });

  it('[04 §3.5] result_also_to: dine-in → table_team of the primary table (depth owner); takeaway / no open seating → null', async () => {
    hub = await startVoids();
    openSeating(hub, { table_id: VX.tables.T8, seating_id: 'SEAT_T8' });
    const dine = stagedOrder(hub, { seating_id: 'SEAT_T8', prefix: 'DN' });
    const take = stagedOrder(hub, { prefix: 'TK' });
    const hook = VOID_APPROVAL.request!.result_also_to!;
    const ctxFor = (order_id: string) => ({ tx: { db: hub.deps.db }, alert: { values: { order_id } } }) as unknown as AlertApplyCtx<VoidValues, never>;
    expect(hook(ctxFor(dine.order_id))).toEqual({ kind: 'table_team', table_id: VX.tables.T8, depth: 'owner' });
    expect(hook(ctxFor(take.order_id))).toBeNull();
    const counter = statementCounter(hub.deps.db);
    hook(ctxFor(dine.order_id));
    expect(counter.count).toBe(1);
  });

  it('[04 §6.2] onWithdraw → []', () => {
    expect(VOID_APPROVAL.request!.onWithdraw!({} as AlertApplyCtx<VoidValues, never>)).toEqual([]);
  });
});

describe('[04 §3.3 step 4, K-1, Q-4] keep mode', () => {
  it('[04 #30] apply with a stray AlertClosed from an injected lineChangeDrafts stub → throws; the answer is refused, nothing written', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const { alert_ids } = await ask(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }]);
    const stub: LineChangeDrafts = (ctx, order_id, changes, opts) => [
      ...lineChangeDrafts(ctx, order_id, changes, opts),
      { stream_type: 'order', stream_id: order_id, event_type: 'AlertClosed', schema_version: 1, payload: { alert_id: 'A_COMP', reason: 'obsolete', by_staff_id: null, note: null }, occurred_at: ctx.clock.branchNow(), actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId },
    ];
    voidApplyDeps.lineChangeDrafts = stub;
    const n = events();
    const r = await answer(hub, manager, alert_ids[0]!, 'approve');
    expect(r.status).toBe(500);
    expect(events()).toBe(n);
    expect(alertState(alert_ids[0]!)).toBe('open');
  });

  /** An item I with option child C and a cooking naan K; C has an open comp request made stale by the approved comp request on I (spec #30b). */
  async function staleCompFixture() {
    // test-local: the Cashier may ask for a comp, approved by the Manager (aDirectory gives the Cashier no apply-comp)
    const base = await voidsDirectory();
    const askComp = { permission: 'apply-comp' as const, grant_type: 'requires_approval' as const, approver_role_id: VX.managerRole, approver_role_ids: [VX.managerRole], scope: 'branch' as const };
    hub = await startVoids({ directory: { ...base, roles: base.roles.map((r) => (r.role_id === 'R_CASH' ? { ...r, permissions: [...r.permissions, askComp] } : r)) } });
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const { order_id } = appendOrder(hub, {
      order_type: 'takeaway',
      placed_by: STAFF.orderTaker,
      lines: [
        { order_item_id: 'I', item_id: FX.piece },
        { order_item_id: 'C', option_id: FX.option, parent_order_item_id: 'I' },
        { order_item_id: 'K', item_id: FX.naan },
      ],
    });
    toStage(hub, order_id, ['I', 'K'], 'cooking');
    const compLine = async (order_item_id: string) => {
      const r = await post(hub, cashier, 'comp-line', 'CompLine', { order_item_id, units: 1, reason_code: 'quality' });
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      return ofType(r, 'AlertRaised')[0]!.payload.alert_id as string;
    };
    const compC = await compLine('C');
    const compI = await compLine('I');
    const comp = await answer(hub, manager, compI, 'approve'); // applyComp cascades into C and closes no foreign request (K-1)
    expect(comp.status, JSON.stringify(comp.error)).toBe(200);
    const c = hub.deps.db.prepare('SELECT units - removed_units - voided_units - comped_units AS free FROM order_lines WHERE order_item_id = ?').pluck().get('C');
    expect(c).toBe(0); // C's request (1 unit) no longer fits
    expect(alertState(compC)).toBe('open');
    return { cashier, manager, order_id, compC };
  }

  it('[04 #30b] an already-stale comp request elsewhere on the order → a void request on another line approves, no AlertClosed', async () => {
    const f = await staleCompFixture();
    const { alert_ids } = await ask(f.cashier, f.order_id, [{ order_item_id: 'K', disposition: 'wastage' }]);
    const r = await answer(hub, f.manager, alert_ids[0]!, 'approve');
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(ofType(r, 'AlertClosed').filter((e) => e.payload.alert_id === f.compC)).toEqual([]);
    expect(alertState(f.compC)).toBe('open');
  });

  it('[04 #30c] a void request on I (touching C) is not blocked by C\'s stale comp (H3-7); its approve succeeds without AlertClosed; C\'s comp approve is then refused', async () => {
    const f = await staleCompFixture();
    const { alert_ids } = await ask(f.cashier, f.order_id, [{ order_item_id: 'I', disposition: 'wastage' }]);
    const r = await answer(hub, f.manager, alert_ids[0]!, 'approve');
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(ofType(r, 'AlertClosed').filter((e) => e.payload.alert_id === f.compC)).toEqual([]);
    expect(alertState(f.compC)).toBe('open');
    const c = await answer(hub, f.manager, f.compC, 'approve');
    expect(c.status).not.toBe(200);
    expect(alertState(f.compC)).toBe('open');
  });
});

describe('[04 §6.2 Statements, #31]', () => {
  it('[04 #31] apply = 1 + 1 statements (readOrder, lineChangeDrafts in keep mode); the reject bound is 01d test 67\'s', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const { alert_ids } = await ask(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }]);
    const request = VOID_APPROVAL.request!;
    const original = request.apply;
    const counter = statementCounter(hub.deps.db);
    const counts: number[] = [];
    request.apply = (ctx, ans: AnswerFacts) => {
      const before = counter.count;
      try {
        return original(ctx, ans);
      } finally {
        counts.push(counter.count - before);
      }
    };
    try {
      const r = await answer(hub, manager, alert_ids[0]!, 'approve');
      expect(r.status, JSON.stringify(r.error)).toBe(200);
    } finally {
      request.apply = original;
    }
    expect(counts).toEqual([2, 2]); // preRead and handle
  });
});
