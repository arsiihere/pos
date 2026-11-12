// 04 §10 test 0 — the spike (plan P0.9, spec §11 task 1, R-2). GATE: no 04 lane opens until this file is green.
//
// A throwaway `apply` for kind `void_approval`, swapped into the real kind for the duration of one test and restored in
// `finally`. It runs §3.3 steps 1–5 with real code only: 02b `planVoid` and `lineChangeDrafts`, hub `withStockEffects` /
// `openDayStockCtx` (03a `stockEffects`), and the K-1 `alert_id` stamp. It lives only here; lane V1 (v7) builds the
// real one. Stand-ins until their task lands:
//   - `orderLines` for `readOrder` (u1); so no rule 4 (billed / out of engine): `orderLines` has no head (u1 / v7);
//   - `lineChangeDrafts` in its default mode for `{ stale_comps: 'keep' }` (u2), with the K-1 `AlertClosed` assert;
//   - no line guard (u3): §10 #0's "the lock check does not refuse its own request" (H1-1) half is carried by test 21
//     in v7, because no line guard exists until u3;
//   - T-2 pre-scan (u4, G-17): pinned by the test 10c case below (an `it.fails` until u4 landed);
//   - the audit-row half runs on a2's real `audit` fold.
import { DomainError, type VoidDisposition } from '@pos/domain';
import { openDayStartMs, stockEffects, type EngineState } from '@pos/engine';
import type { EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import type { AlertApplyCtx, AnswerFacts } from '../../src/alerts/kinds';
import { openDayStockCtx, withStockEffects } from '../../src/commands/set-precooked-stock';
import { orderLines } from '../../src/orders/exports';
import { planVoid } from '../../src/orders/ledger';
import { lineChangeDrafts } from '../../src/orders/line-change';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { VOID_APPROVAL, type VoidValues } from '../../src/voids/kind';
import type { TestHub } from '../helpers/test-hub';
import {
  append,
  answer,
  appendOrder,
  dealX2,
  FX,
  openSeating,
  raiseVoid,
  signIn,
  STAFF,
  stagedOrder,
  startVoids,
  strictRefold,
  toStage,
  VX,
  waitingT4,
  type Reply,
} from './fixtures';

let hub: TestHub;

afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

const state = (): EngineState => hub.deps.state.get();

interface ApplyCall {
  decision: AnswerFacts['decision'];
  drafts: EventDraft[];
  appendRefused: boolean;
  dbWriteRefused: boolean;
  stockCtxBuilt: boolean;
}

/** §3.1: started = absent from the engine, or past `added` (an engine line). The spike's lines are all engine lines or deal headers. */
function notStarted(s: Readonly<EngineState>, id: string): boolean {
  return s.lines[id]?.stage === 'added';
}

/**
 * The throwaway §6.2 `apply`: §3.2 rules 1, 5 and the stage part of 7 on the current state, then §3.3 steps 1–5.
 * `calls` records each run (01d calls it in preRead and again in handle).
 */
function spikeApply(calls: ApplyCall[]) {
  return (ctx: AlertApplyCtx<VoidValues, never>, ans: AnswerFacts): EventDraft[] => {
    const call: ApplyCall = { decision: ans.decision, drafts: [], appendRefused: false, dbWriteRefused: false, stockCtxBuilt: false };
    calls.push(call);
    try {
      ctx.tx.append([]);
    } catch {
      call.appendRefused = true;
    }
    try {
      ctx.tx.db.prepare(`DELETE FROM events WHERE 0`).run();
    } catch {
      call.dbWriteRefused = true;
    }
    if (ans.decision !== 'approve') return [];
    const v = ctx.alert.values;
    // readOrder stand-in (u1): 02b's 1-statement orderLines (no order head, so no rule 4 here)
    const lines = orderLines(ctx.tx.db, [v.order_id]).get(v.order_id) ?? [];
    const named = lines.find((l) => l.order_item_id === v.order_item_id);
    if (named === undefined) throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'lines.0.order_item_id' }] }); // rule 1
    const childKind = named.line_kind === 'deal' ? 'deal_part' : named.line_kind === 'item' ? 'option_child' : null;
    const children = lines.filter((l) => l.parent_order_item_id === named.order_item_id && l.line_kind === childKind);
    if (v.units > named.live_units) throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'lines.0.units' }] }); // rule 5
    // §3.3 step 1
    const plan = planVoid(named, children, v.units);
    const header = (id: string) => id === named.order_item_id && named.line_kind === 'deal';
    const disposition = (id: string): VoidDisposition | null => {
      const stored = v.line_dispositions[id] ?? null;
      if (header(id)) return null;
      if (stored === null) return notStarted(ctx.state, id) ? null : 'wastage'; // OQ-F
      return stored;
    };
    // rule 7, stage part: a stored `moved` line must still be at cooking / done (OQ-D)
    for (const l of plan.lines) {
      if (disposition(l.order_item_id) !== 'moved') continue;
      const stage = ctx.state.lines[l.order_item_id]?.stage;
      if (stage !== 'cooking' && stage !== 'done') throw new DomainError('VOID_NOT_ALLOWED', { order_item_id: l.order_item_id, reason: 'not_movable_stage', hint: 'withdraw_and_reask' });
    }
    // §3.3 step 2: per entry, every moved line's ItemMovedToStock, then the entry's ItemVoided drafts
    const envelope = { occurred_at: ctx.clock.branchNow(), actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
    const order = { stream_type: 'order' as const, stream_id: v.order_id, schema_version: 1 };
    const moved = plan.lines.filter((l) => disposition(l.order_item_id) === 'moved');
    const causes: EventDraft[] = [
      ...moved.map((l) => ({ ...order, ...envelope, event_type: 'ItemMovedToStock', payload: { order_item_id: l.order_item_id, units: l.units } })),
      ...plan.lines.map((l) => ({
        ...order,
        ...envelope,
        event_type: 'ItemVoided',
        payload: {
          ...l.payload,
          disposition: disposition(l.order_item_id),
          reason_code: v.reason_code,
          note: v.note,
          disposition_note: v.disposition_note,
          requester_staff_id: ctx.alert.requester_staff_id!,
          approver_staff_id: ans.answerer_staff_id,
        },
      })),
    ];
    // risk row: day_closed BEFORE openDayStockCtx (which throws a plain Error → 500). A closed day keeps
    // `business_day` and sets `closed_at`, so the open-day test is openDayStartMs, not `business_day !== null`.
    if (moved.length > 0 && openDayStartMs(ctx.state) === null) throw new DomainError('VOID_NOT_ALLOWED', { reason: 'day_closed' });
    const stockCtx = moved.length > 0 ? openDayStockCtx(ctx.state) : undefined;
    call.stockCtxBuilt = stockCtx !== undefined;
    // §3.3 step 3: ONE withStockEffects over every cause
    const withStock = withStockEffects(ctx, causes, stockCtx);
    // §3.3 step 4: ONE lineChangeDrafts over every touched line (u2's `keep` mode not built: assert none closes a comp)
    const changes = plan.lines.map((l) => ({ order_item_id: l.order_item_id, units_out: l.units }));
    const lineChange = lineChangeDrafts(ctx, v.order_id, changes);
    if (lineChange.some((d) => d.event_type === 'AlertClosed')) throw new Error('void apply: lineChangeDrafts closed a comp request (K-1)');
    // §3.3 step 5: alert_id on every PAYLOAD, after withStockEffects (it restamps envelopes)
    call.drafts = [...withStock, ...lineChange].map((d) => ({ ...d, payload: { ...d.payload, alert_id: ctx.alert.alert_id } }));
    return call.drafts;
  };
}

/** Runs `body` with the throwaway apply in the real kind; the kind's own apply is restored whatever happens. */
async function withSpikeApply<T>(body: (calls: ApplyCall[]) => Promise<T>): Promise<T> {
  const request = VOID_APPROVAL.request!;
  const original = request.apply;
  const calls: ApplyCall[] = [];
  request.apply = spikeApply(calls);
  try {
    return await body(calls);
  } finally {
    request.apply = original;
  }
}

const seq = (r: Reply) =>
  r.events.map((e) => {
    const p = e.payload as { order_item_id?: string; stock_item_id?: string; quantity?: number; units?: number; reason?: string; kind?: string };
    return [e.event_type, p.order_item_id ?? p.stock_item_id ?? p.kind ?? null, p.units ?? p.quantity ?? null, p.reason ?? null].filter((x) => x !== null).join(' ');
  });
const ofType = (r: Reply, t: string) => r.events.filter((e) => e.event_type === t);
const lineRow = (id: string) =>
  hub.deps.db.prepare('SELECT units, voided_units, refund_minor, comp_voided_minor FROM order_lines WHERE order_item_id = ?').get(id) as {
    units: number;
    voided_units: number;
    refund_minor: number;
    comp_voided_minor: number;
  };
/** 01d's own tail of an approve (§6.2 (8)–(9)): request_result to the requester, approval_receipt to the answerer. */
const NOTICES = ['AlertRaised request_result', 'AttemptSent', 'AlertRaised approval_receipt', 'AttemptSent'];
/** 01d's events in the answer; the kind's drafts are every other event. */
const ALERT_SIDE = new Set(['RequestAnswered', 'AlertRaised', 'AttemptSent']);
const kindEvents = (r: Reply) => r.events.filter((e) => !ALERT_SIDE.has(e.event_type));

/** One envelope on every draft the kind returns (withStockEffects restamps from drafts[0]; lineChangeDrafts uses ctx's). */
function oneEnvelope(drafts: EventDraft[]): void {
  const env = (d: EventDraft) => ({ occurred_at: d.occurred_at, actor_id: d.actor_id, device_id: d.device_id });
  for (const d of drafts) expect(env(d), d.event_type).toEqual(env(drafts[0]!));
}

/** A tracked naan ×4 that reserved 4 K_NAAN at submit; `stage` reached through a real Start (which consumes them, 03a P-5). */
function stockNaan(stage: 'cooking' | 'done'): string {
  const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'N4', item_id: VX.stockNaan, quantity: 4 }] });
  expect(state().lines.N4).toMatchObject({ units: 4, from_stock: true, draws: [{ stock_item_id: VX.naanStock, quantity: 4, reserved: 4 }] });
  toStage(hub, order_id, ['N4'], stage);
  return order_id;
}

describe('[04 #0] spike: raise → approve → move + void, end to end (throwaway apply)', () => {
  it.each(['cooking', 'done'] as const)(
    '[04 #0] 2 of 4 %s stock naan moved: ItemMovedToStock, StockAdded 2, ItemVoided folded (refund 6 000), engine line 4 → 2, no StockReleased, alert_id on every draft',
    async (stage) => {
      // K_NAAN counted 4: the naan line reserves 4 at submit; its Start consumes them (03a P-5) → reserved 0 at cooking / done
      hub = await startVoids({ stock: { [FX.stock]: 0, [VX.naanStock]: 4 } });
      const cashier = signIn(hub, STAFF.cashier);
      const manager = signIn(hub, STAFF.manager);
      const order_id = stockNaan(stage);
      expect(state().lines.N4).toMatchObject({ stage, draws: [{ quantity: 4, reserved: 0 }] });
      expect(state().stock[VX.naanStock]).toMatchObject({ on_hand: 0, reserved: 0 });

      // 1. raise
      const req = raiseVoid(hub, { requester: cashier, order_id, order_item_id: 'N4', units: 2, disposition: 'moved' });
      expect(req.values).toMatchObject({ touched_ids: ['N4'], line_dispositions: { N4: 'moved' }, units: 2, refund_minor: 6_000, comp_voided_minor: 0 }); // 2 × 3 000

      await withSpikeApply(async (calls) => {
        // 2. approve with Manager
        const r = await answer(hub, manager, req.alert_id, 'approve');
        expect(r.status, JSON.stringify(r.error)).toBe(200);
        // 3. the approve's sequence: answer, cause + its stock effect, the void, then 01d's notices
        expect(seq(r)).toEqual(['RequestAnswered', 'ItemMovedToStock N4 2', `StockAdded ${VX.naanStock} 2 moved`, 'ItemVoided N4 2', ...NOTICES]);
        const drafts = calls.at(-1)!.drafts;
        expect(drafts.map((d) => d.event_type)).toEqual(['ItemMovedToStock', 'StockAdded', 'ItemVoided']);
        oneEnvelope(drafts);
        // 6. no StockReleased at all (the moved share had reserved 0; H1-25)
        expect(ofType(r, 'StockReleased')).toEqual([]);
        // 7. K-1: every draft the kind returned carries the alert_id, and 01d's checkAlertIds let them through
        for (const d of drafts) expect(d.payload.alert_id, d.event_type).toBe(req.alert_id);
        for (const e of kindEvents(r)) expect(e.payload.alert_id, e.event_type).toBe(req.alert_id);
        expect(ofType(r, 'ItemVoided')[0]!.payload).toMatchObject({ units: 2, disposition: 'moved', refund_minor: 6_000, comp_voided_minor: 0 });
      });

      // 4. ItemVoided folded by 02b's ledger
      expect(lineRow('N4')).toEqual({ units: 4, voided_units: 2, refund_minor: 6_000, comp_voided_minor: 0 });
      // 5. the engine line shrank (BF-12) and the moved portions sit in stock
      expect(state().lines.N4).toMatchObject({ units: 2, stage, draws: [{ quantity: 2, reserved: 0 }] });
      expect(state().stock[VX.naanStock]).toMatchObject({ on_hand: 2, reserved: 0 });
      // strict re-fold of the whole log = live (no stock_reserved_past_added, no breach)
      expect(strictRefold(hub)).toEqual(state());
    },
  );

  it('[04 #0] §6.8 deal variant (OQ-C): deal ×2, karahi part cooking, 1 unit moved → { D: null, P1: moved, P2: null }; T4 reserved; refunds 0 / 114 285 / 5 714; §3.6 payload fields', async () => {
    // K1 counted 1 000 g: the deal's karahi part reserves its 1 000 g at submit, its Start consumes them; T4 comes after
    // (K1 unavailable then) and waits, hidden, unreserved
    hub = await startVoids({ stock: { [FX.stock]: 1_000, [VX.naanStock]: 0 } });
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const d = dealX2(hub);
    expect(state().lines[d.karahiPart]).toMatchObject({ from_stock: true, draws: [{ stock_item_id: FX.stock, quantity: 1_000, reserved: 1_000 }] });
    toStage(hub, d.order_id, [d.karahiPart], 'cooking');
    expect(state().lines[d.karahiPart]).toMatchObject({ stage: 'cooking', draws: [{ reserved: 0 }] });
    const t4 = waitingT4(hub);
    expect(state().lines[d.naanPart]).toMatchObject({ stage: 'added', units: 4, draws: [] });

    // 1. raise: a deal with 4 naan, its karahi part cooking. Money (01c V11 c): deal 2 × 120 000 = 240 000 split by
    // weights karahi 2 × 120 000 and naan 4 × 3 000 → P1 228 571, P2 11 429; 1 of 2 deal units → P1 114 285 (the
    // remainder stays on the last unit), P2 2 of 4 → 5 714, header 0; Σ 119 999.
    const req = raiseVoid(hub, { requester: cashier, order_id: d.order_id, order_item_id: d.deal, units: 1, disposition: 'moved' });
    expect(req.values).toMatchObject({ line_dispositions: { [d.deal]: null, [d.karahiPart]: 'moved', [d.naanPart]: null }, refund_minor: 119_999, comp_voided_minor: 0 });

    await withSpikeApply(async (calls) => {
      // 2. approve
      const r = await answer(hub, manager, req.alert_id, 'approve');
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      // 3. the §6.8 sequence: the move, its add, the waiting T4 line's reserve, then the deal's three voids, then 01d's notices
      expect(seq(r)).toEqual([
        'RequestAnswered',
        `ItemMovedToStock ${d.karahiPart} 1`,
        `StockAdded ${FX.stock} 500 moved`,
        `StockReserved ${t4.line} 500`,
        `ItemVoided ${d.deal} 1`,
        `ItemVoided ${d.karahiPart} 1`,
        `ItemVoided ${d.naanPart} 2`,
        ...NOTICES,
      ]);
      // 6. no StockReleased: P1's moved share held 0 (consumed at Start), P2 has no draw
      expect(ofType(r, 'StockReleased')).toEqual([]);
      // 7. K-1: every draft of the kind, stockEffects' StockReserved included, carries the alert_id
      const drafts = calls.at(-1)!.drafts;
      expect(drafts.length).toBe(6);
      oneEnvelope(drafts);
      for (const e of kindEvents(r)) expect(e.payload.alert_id, e.event_type).toBe(req.alert_id);
      // V3 per line; the header and the never-started part stay null; the refunds per line
      expect(ofType(r, 'ItemVoided').map((e) => [e.payload.order_item_id, e.payload.disposition, e.payload.refund_minor, e.payload.comp_voided_minor])).toEqual([
        [d.deal, null, 0, 0],
        [d.karahiPart, 'moved', 114_285, 0],
        [d.naanPart, null, 5_714, 0],
      ]);
      // §6.2 / §6.8: the applied refund equals the raise-time plan (test 47's half)
      expect(ofType(r, 'ItemVoided').reduce((s, e) => s + (e.payload.refund_minor as number), 0)).toBe(119_999);
      // 8. §3.6 "columns per action", the half that can exist now: the payload / envelope fields a2's fold reads
      for (const e of ofType(r, 'ItemVoided')) {
        expect(e.payload).toMatchObject({ requester_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager, reason_code: 'customer_changed_mind', note: null, disposition_note: null });
        expect(e.actor_id).toBe(STAFF.manager); // envelope actor = the answering session (§3.6 H3-1)
      }
      expect(ofType(r, 'ItemMovedToStock')[0]!.actor_id).toBe(STAFF.manager);
      expect(ofType(r, 'RequestAnswered')[0]!.payload).toMatchObject({ alert_id: req.alert_id, decision: 'approve', answerer_staff_id: STAFF.manager, method: 'pin' });
      const raised = hub.deps.db.prepare(`SELECT requester_staff_id FROM alerts WHERE alert_id = ?`).get(req.alert_id);
      expect(raised).toEqual({ requester_staff_id: STAFF.cashier }); // audit_requests.requester_staff_id source
    });

    // 4. folded by 02b
    expect(lineRow(d.deal)).toEqual({ units: 2, voided_units: 1, refund_minor: 0, comp_voided_minor: 0 });
    expect(lineRow(d.karahiPart)).toEqual({ units: 2, voided_units: 1, refund_minor: 114_285, comp_voided_minor: 0 });
    expect(lineRow(d.naanPart)).toEqual({ units: 4, voided_units: 2, refund_minor: 5_714, comp_voided_minor: 0 });
    // 5. engine lines shrank; T4 now holds the moved 500 g
    expect(state().lines[d.karahiPart]).toMatchObject({ units: 1, stage: 'cooking', draws: [{ quantity: 500, reserved: 0 }] });
    expect(state().lines[d.naanPart]).toMatchObject({ units: 2, stage: 'added' });
    expect(state().lines[t4.line]!.draws[0]!.reserved).toBe(500);
    expect(state().stock[FX.stock]).toMatchObject({ on_hand: 500, reserved: 500 });
    // the request is closed by 01d's answer
    expect(hub.deps.db.prepare('SELECT state FROM alerts WHERE alert_id = ?').pluck().get(req.alert_id)).not.toBe('open');
    // strict re-fold of the whole log = live
    expect(strictRefold(hub)).toEqual(state());
  });

  it('[04 #0] risk row: a moved approve on a closed day → 409 VOID_NOT_ALLOWED day_closed (never openDayStockCtx\'s 500), nothing written', async () => {
    hub = await startVoids({ stock: { [FX.stock]: 0, [VX.naanStock]: 4 } });
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const order_id = stockNaan('cooking');
    const req = raiseVoid(hub, { requester: cashier, order_id, order_item_id: 'N4', units: 2, disposition: 'moved' });
    // A-1's day-close guard (u8) is not built, so the day is closed with a real BusinessDayClosed while the request is
    // pending (the state A-1 will make unreachable). The order keeps an unserved line, so it stays in the engine.
    append(hub, [{ stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, event_type: 'BusinessDayClosed', payload: {} }], { actor: STAFF.manager });
    expect(state().business_day).toMatchObject({ closed_at: expect.any(Number) as number });
    expect(state().lines.N4!.stage).toBe('cooking');
    const events = () => hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number;
    const before = events();
    await withSpikeApply(async () => {
      const r = await answer(hub, manager, req.alert_id, 'approve');
      expect(r.status).toBe(409);
      expect(r.error).toEqual({ code: 'VOID_NOT_ALLOWED', details: { reason: 'day_closed' } });
    });
    expect(events()).toBe(before);
    expect(lineRow('N4')).toMatchObject({ voided_units: 0 });
    expect(hub.deps.db.prepare('SELECT state FROM alerts WHERE alert_id = ?').pluck().get(req.alert_id)).toBe('open');
  });

  it('[04 #0] audit rows: item_voided (actor = requester, approver = answerer), item_moved_to_stock (from audit_requests), void_requested, void_answered', async () => {
    hub = await startVoids({ stock: { [FX.stock]: 0, [VX.naanStock]: 4 } });
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const order_id = stockNaan('cooking');
    const req = raiseVoid(hub, { requester: cashier, order_id, order_item_id: 'N4', units: 2, disposition: 'moved' });
    await withSpikeApply(async () => {
      expect((await answer(hub, manager, req.alert_id, 'approve')).status).toBe(200);
    });
    // a2 (§3.6 columns per action): every envelope actor of the approve is the Manager's session; the rows say who did it
    const audit = hub.deps.db
      .prepare(
        `SELECT action, actor_staff_id, approver_staff_id, method, order_id, outcome, amount_minor, json_extract(detail_json, '$.envelope_actor_id') AS envelope
           FROM audit_entries WHERE action IN ('void_requested', 'void_answered', 'item_moved_to_stock', 'item_voided') ORDER BY seq`,
      )
      .all();
    expect(audit).toEqual([
      { action: 'void_requested', actor_staff_id: STAFF.cashier, approver_staff_id: null, method: null, order_id, outcome: 'moved', amount_minor: 6_000, envelope: STAFF.cashier },
      { action: 'void_answered', actor_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager, method: 'pin', order_id, outcome: 'approved', amount_minor: null, envelope: STAFF.manager },
      { action: 'item_moved_to_stock', actor_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager, method: null, order_id, outcome: null, amount_minor: null, envelope: STAFF.manager },
      { action: 'item_voided', actor_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager, method: null, order_id, outcome: 'moved', amount_minor: 6_000, envelope: STAFF.manager },
    ]);
    // the moved portion's StockAdded { reason: 'moved' } is covered by item_moved_to_stock, never a stock_added row
    expect(hub.deps.db.prepare(`SELECT COUNT(*) FROM audit_entries WHERE action = 'stock_added'`).pluck().get()).toBe(0);
  });
});

describe('[04 R-2] a read-only apply builds engine + stock drafts', () => {
  it('[04 R-2] apply runs in preRead and in handle on a read-only tx (append and db writes refused), builds a stock ctx from engine state, and 01d folds what it returns', async () => {
    hub = await startVoids({ stock: { [FX.stock]: 0, [VX.naanStock]: 4 } });
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const order_id = stockNaan('cooking');
    const req = raiseVoid(hub, { requester: cashier, order_id, order_item_id: 'N4', units: 2, disposition: 'moved' });
    const before = state();
    await withSpikeApply(async (calls) => {
      const r = await answer(hub, manager, req.alert_id, 'approve');
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      // 01d: once in preRead (drafts discarded, before the PIN), once in handle (drafts appended)
      expect(calls.length).toBe(2);
      for (const c of calls) expect(c).toMatchObject({ decision: 'approve', appendRefused: true, dbWriteRefused: true, stockCtxBuilt: true });
      // both runs plan the same drafts from the same pre-answer state
      const strip = (ds: EventDraft[]) => ds.map((x) => [x.event_type, x.payload]);
      expect(strip(calls[0]!.drafts)).toEqual(strip(calls[1]!.drafts));
      // only handle's drafts were written: preRead's were discarded
      expect(kindEvents(r).length).toBe(calls[1]!.drafts.length);
    });
    // the writer folded the returned engine events: the state moved on from the apply's read-only snapshot
    expect(before.lines.N4!.units).toBe(4);
    expect(state().lines.N4!.units).toBe(2);
    expect(state()).not.toBe(before);
    // the kind's own apply is back (v7 built it: a non-approve answer returns [] without reading)
    expect(VOID_APPROVAL.request!.apply({} as never, { decision: 'reject' } as never)).toEqual([]);
  });

  // T-2 (03a v1.2.4, G-17): the moved portion is never reserved by a line the array ends. Before u4, waitingReserve
  // excluded only the moved line, and the scratch `book` ignores ItemVoided, so the hidden waiting line AW_K (same stock
  // item, same deadline, first by order_item_id) — voided later in the same array — takes the 500 g and T4 gets nothing
  // (observed: StockReserved [AW_K]). Pure stockEffects form: VoidItems / apply cannot name a waiting line at `added`
  // (rule 4), as test 10g. Green since u4 added the array pre-scan (was `it.fails`).
  it('[04 R-2 → u4, test 10c] a part the array ends is never reserved; another order\'s waiting line is', async () => {
    hub = await startVoids();
    const s = stagedOrder(hub); // SO_K: a cooking karahi with a 500 g K1 draw, reserved 0 (K1 counted 0)
    openSeating(hub, { table_id: VX.tables.T5, seating_id: 'SEAT_AW' });
    const wh = waitingT4(hub, { prefix: 'AW', seating_id: 'SEAT_AW' }); // AW_K: a hidden waiting karahi on K1 at T5, ended by the array below
    const t4 = waitingT4(hub); // another order's hidden waiting karahi at T4: stays live
    const now = hub.clock.branchNow();
    const env = { occurred_at: now, actor_id: STAFF.manager, device_id: 'D_SPIKE' };
    const on = (order_id: string, event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, schema_version: 1, payload, ...env });
    const out = stockEffects(
      state(),
      [on(s.order_id, 'ItemMovedToStock', { order_item_id: s.cooking, units: 1 }), on(s.order_id, 'ItemVoided', { order_item_id: s.cooking, units: 1 }), on(wh.order_id, 'ItemVoided', { order_item_id: wh.line, units: 1 })],
      openDayStockCtx(state()),
    );
    const reserved = out.filter((x) => x.event_type === 'StockReserved').map((x) => (x.payload as { order_item_id: string }).order_item_id);
    expect(reserved).not.toContain(wh.line);
    expect(reserved).toEqual([t4.line]);
  });
});
