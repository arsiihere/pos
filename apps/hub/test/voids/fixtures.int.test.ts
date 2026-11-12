import { isHiddenUnfired, type EngineState } from '@pos/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { openDayStockCtx, withStockEffects } from '../../src/commands/set-precooked-stock';
import type { CommandCtx } from '../../src/commands/registry';
import { currentDirectory } from '../../src/auth/guards';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { currentTableOf } from '../../src/tables/reads';
import { VOID_KIND } from '../../src/voids/contracts';
import type { TestHub } from '../helpers/test-hub';
import {
  answer,
  closedSeating,
  earlierDayTakeaway,
  dealX2,
  FX,
  longLabelSeating,
  mergedSeating,
  noCurrentTable,
  openVoidsDay,
  optionChildOrder,
  parkingOrder,
  pendingWeight,
  raiseVoid,
  remakeLine,
  servedColdDrink,
  signIn,
  stagedOrder,
  strictRefold,
  startVoids,
  STAFF,
  takeawayOrder,
  tieMerge,
  toStage,
  VX,
  waitingT4,
} from './fixtures';

// 04 §10 fixtures self-test (plan row P0.8): every fixture builds through real events and the hub's real writer, and
// its rows and engine state are what 04 §3.1 / §3.5 / §10 need. No 04 code is exercised (VoidItems does not exist yet).

let hub: TestHub;

afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

const state = (): EngineState => hub.deps.state.get();
const row = (id: string) =>
  hub.deps.db.prepare('SELECT line_kind, quantity, units, served_at, return_of, parent_order_item_id FROM order_lines WHERE order_item_id = ?').get(id) as {
    line_kind: string;
    quantity: number | null;
    units: number;
    served_at: number | null;
    return_of: string | null;
    parent_order_item_id: string | null;
  };
const stockAdded = (stock_item_id: string, quantity: number, unit: string) =>
  hub.deps.writer.run((tx) => {
    const now = tx.clock.branchNow();
    const ctx = { tx, state: tx.state, clock: tx.clock, ids: tx.ids } as unknown as CommandCtx;
    const draft = { stream_type: 'stock' as const, stream_id: stock_item_id, event_type: 'StockAdded', schema_version: 2, payload: { stock_item_id, quantity, unit }, occurred_at: now, actor_id: 'S_MGR', device_id: 'D_FIXTURE' };
    return tx.append(withStockEffects(ctx, [draft], openDayStockCtx(tx.state as EngineState)));
  }).appended;

describe('[04 §10 fixtures] orders and engine state', () => {
  it('[04 §10 fixtures] stagedOrder: a cooking stock-tracked karahi with a draw, a done and a served line (§3.1 engine lines)', async () => {
    hub = await startVoids();
    const o = stagedOrder(hub);
    const s = state();
    expect(s.lines[o.cooking]).toMatchObject({ stage: 'cooking', draws: [{ stock_item_id: FX.stock, quantity: 500 }] });
    expect(s.lines[o.done]!.stage).toBe('done');
    expect(s.lines[o.served]!.stage).toBe('served');
    expect(row(o.served).served_at).not.toBeNull();
    expect(row(o.cooking).served_at).toBeNull();
  });

  it('[04 §10 fixtures] waitingT4: the T4 karahi is hidden, not fired, not from stock, unreserved; a StockAdded reserves it (10c–10h)', async () => {
    hub = await startVoids();
    const t4 = waitingT4(hub);
    const line = state().lines[t4.line]!;
    expect(line).toMatchObject({ stage: 'added', fired_at: null, from_stock: false, draws: [{ stock_item_id: FX.stock, quantity: 500, reserved: 0 }] });
    expect(isHiddenUnfired(state(), line, hub.clock.branchNow())).toBe(true);
    expect(currentTableOf(hub.deps.db, [t4.order_id]).get(t4.order_id)?.table_ids).toEqual([VX.tables.T4]);
    const added = stockAdded(FX.stock, 500, 'g');
    expect(added.map((e) => [e.event_type, (e.payload as { order_item_id?: string }).order_item_id])).toEqual([
      ['StockAdded', undefined],
      ['StockReserved', t4.line],
    ]);
    expect(state().lines[t4.line]!.draws[0]!.reserved).toBe(500);
  });

  it('[04 §10 fixtures] dealX2: deal ×2 header off the engine; karahi part 2 with a 1000 g draw, naan part 4 (§3.1 header)', async () => {
    hub = await startVoids();
    const d = dealX2(hub);
    expect(row(d.deal)).toMatchObject({ line_kind: 'deal', quantity: 2 });
    expect(row(d.karahiPart)).toMatchObject({ line_kind: 'deal_part', quantity: 2, parent_order_item_id: d.deal });
    expect(row(d.naanPart)).toMatchObject({ line_kind: 'deal_part', quantity: 4, parent_order_item_id: d.deal });
    const s = state();
    expect(s.lines[d.deal]).toBeUndefined();
    expect(s.lines[d.karahiPart]).toMatchObject({ stage: 'added', draws: [{ stock_item_id: FX.stock, quantity: 1_000 }] });
    expect(s.lines[d.naanPart]!.stage).toBe('added');
  });

  it('[04 §10 fixtures] dealX2 { hold }: its karahi part is a hidden waiting line (10h)', async () => {
    hub = await startVoids();
    const d = dealX2(hub, { hold: true });
    expect(isHiddenUnfired(state(), state().lines[d.karahiPart]!, hub.clock.branchNow())).toBe(true);
  });

  it('[04 §10 fixtures] optionChildOrder: an item with an option child on its own station (4c, 4d)', async () => {
    hub = await startVoids();
    const o = optionChildOrder(hub);
    expect(row(o.child)).toMatchObject({ line_kind: 'option_child', parent_order_item_id: o.item });
    const s = state();
    expect(s.lines[o.item]).toMatchObject({ stage: 'added', station_id: FX.station });
    expect(s.lines[o.child]).toMatchObject({ stage: 'added', station_id: FX.station });
  });

  it('[04 §10 fixtures] servedColdDrink: a served drink and its option child, neither an engine line (4b, 4e, 4f)', async () => {
    hub = await startVoids();
    const d = servedColdDrink(hub);
    expect(row(d.drink)).toMatchObject({ line_kind: 'item' });
    expect(row(d.option)).toMatchObject({ line_kind: 'option_child', parent_order_item_id: d.drink });
    expect(row(d.drink).served_at).not.toBeNull();
    expect(row(d.option).served_at).not.toBeNull();
    const s = state();
    expect(s.lines[d.drink]).toBeUndefined();
    expect(s.lines[d.option]).toBeUndefined();
    const unserved = servedColdDrink(hub, { prefix: 'DU', served: false });
    expect(row(unserved.drink).served_at).toBeNull();
  });

  it('[04 §10 fixtures] remakeLine: the real ReturnToKitchen remake; the return line has return_of and is an engine line at added (5, 45)', async () => {
    hub = await startVoids();
    const r = await remakeLine(hub);
    expect(row(r.served)).toMatchObject({ served_at: expect.any(Number) as number });
    expect(row(r.remake)).toMatchObject({ return_of: r.served });
    expect(state().lines[r.remake]).toMatchObject({ stage: 'added', return_of: { order_item_id: r.served, mode: 'remake' } });
  });

  it('[04 §10 fixtures] pendingWeight: a weighed fish line with quantity NULL, past stage 1 (6)', async () => {
    hub = await startVoids();
    const p = pendingWeight(hub);
    expect(row(p.line).quantity).toBeNull();
    expect(state().lines[p.line]!.stage).toBe('cooking');
  });

  it('[04 §10 fixtures] takeawayOrder / parkingOrder: token of the day, car number and type (20, 20c)', async () => {
    hub = await startVoids();
    const t1 = takeawayOrder(hub);
    const t2 = takeawayOrder(hub, { prefix: 'TW2' });
    expect([t1.token, t2.token]).toEqual([1, 2]);
    const p = parkingOrder(hub);
    const head = hub.deps.db.prepare('SELECT order_type, car_number, car_type FROM orders WHERE order_id = ?').get(p.order_id);
    expect(head).toEqual({ order_type: 'parking', car_number: 'LEB 1234', car_type: 'sedan' });
    expect(currentTableOf(hub.deps.db, [t1.order_id, p.order_id]).size).toBe(0);
  });
});

describe('[04 §10 fixtures] seatings (§3.5 identifier, test 20c)', () => {
  it('[04 §10 fixtures] mergedSeating: T5 absorbed into T4; both orders now T4 + T5, primary first', async () => {
    hub = await startVoids();
    const m = mergedSeating(hub);
    const cur = currentTableOf(hub.deps.db, m.order_ids);
    for (const id of m.order_ids) expect(cur.get(id)).toEqual({ seating_id: m.seating_id, primary_table_id: VX.tables.T4, table_ids: [VX.tables.T4, VX.tables.T5] });
  });

  it('[04 §10 fixtures] tieMerge: T7 and T8 joined in one merge share joined_at; the order reads T6, T7, T8', async () => {
    hub = await startVoids();
    const m = tieMerge(hub);
    const joined = hub.deps.db.prepare('SELECT table_id, joined_at FROM seating_tables WHERE seating_id = ? ORDER BY table_id').all(m.seating_id) as Array<{ table_id: string; joined_at: number }>;
    expect(joined.map((j) => j.table_id)).toEqual([VX.tables.T6, VX.tables.T7, VX.tables.T8]);
    expect(joined[1]!.joined_at).toBe(joined[2]!.joined_at);
    expect(joined[0]!.joined_at).toBeLessThan(joined[1]!.joined_at);
    expect(currentTableOf(hub.deps.db, [m.order_id]).get(m.order_id)?.table_ids).toEqual([VX.tables.T6, VX.tables.T7, VX.tables.T8]);
  });

  it('[04 §10 fixtures] longLabelSeating: three table names whose " + " label is over 40 chars', async () => {
    hub = await startVoids();
    const m = longLabelSeating(hub);
    expect(m.label.length).toBeGreaterThan(40);
    expect(currentTableOf(hub.deps.db, [m.order_id]).get(m.order_id)?.table_ids).toEqual(VX.longTables);
  });

  it('[04 §10 fixtures] closedSeating (G-14): no currentTableOf entry, seatings row keeps a non-null primary_table_id', async () => {
    hub = await startVoids();
    const c = closedSeating(hub);
    expect(currentTableOf(hub.deps.db, [c.order_id]).has(c.order_id)).toBe(false);
    const seat = hub.deps.db.prepare('SELECT state, primary_table_id FROM seatings WHERE seating_id = ?').get(c.seating_id);
    expect(seat).toEqual({ state: 'CLOSED', primary_table_id: VX.tables.T12 });
    expect(state().orders[c.order_id]?.table_id).toBe(VX.tables.T12);
  });

  it('[04 §10 fixtures] noCurrentTable: open seating with its table detached — no currentTableOf entry, seating SEATED, engine table T2', async () => {
    hub = await startVoids();
    const n = noCurrentTable(hub);
    expect(currentTableOf(hub.deps.db, [n.order_id]).has(n.order_id)).toBe(false);
    const seat = hub.deps.db.prepare('SELECT state, primary_table_id FROM seatings WHERE seating_id = ?').get(n.seating_id) as { state: string; primary_table_id: string };
    expect(seat.state).not.toBe('CLOSED');
    expect(seat.primary_table_id).toBe(FX.table);
    expect(state().orders[n.order_id]?.table_id).toBe(FX.table);
  });

  it('[04 §10 fixtures] takeawayOrder { token: 12 }: `#12` of today', async () => {
    hub = await startVoids();
    const t = takeawayOrder(hub, { token: 12 });
    const head = hub.deps.db.prepare('SELECT order_type, token, business_date FROM orders WHERE order_id = ?').get(t.order_id);
    expect(t.token).toBe(12);
    expect(head).toEqual({ order_type: 'takeaway', token: 12, business_date: state().business_day!.business_date });
    expect(currentTableOf(hub.deps.db, [t.order_id]).size).toBe(0);
    expect(() => takeawayOrder(hub, { prefix: 'TW3', token: 5 })).toThrow('already passed');
  });

  it('[04 §10 fixtures] earlierDayTakeaway: `#12 10 Nov` — real open / place / close of an earlier day, then today opens', async () => {
    hub = await startVoids({ open: false });
    const e = earlierDayTakeaway(hub, { date: '2025-11-10', token: 12 });
    expect(e).toMatchObject({ token: 12, business_date: '2025-11-10' });
    const today = openVoidsDay(hub);
    expect(today.business_date).toBe('2025-11-11');
    expect(state().business_day!.business_date).toBe('2025-11-11');
    const head = hub.deps.db.prepare('SELECT token, business_date FROM orders WHERE order_id = ?').get(e.order_id);
    expect(head).toEqual({ token: 12, business_date: '2025-11-10' });
    expect(currentTableOf(hub.deps.db, [e.order_id]).size).toBe(0);
    expect(takeawayOrder(hub).token).toBe(1); // today's tokens start again
  });
});

describe('[04 §10 fixtures] directory, sign-in and the 01d request helpers', () => {
  it('[04 §10 fixtures] Cashier and Order taker: void-item requires approval by Manager, move-item-to-stock allowed; Manager allowed', async () => {
    hub = await startVoids();
    const dir = currentDirectory(hub.app);
    for (const staff of [STAFF.cashier, STAFF.orderTaker]) {
      expect(dir.resolve(staff, 'void-item')).toMatchObject({ grant: 'requires_approval', approver_role_ids: [VX.managerRole] });
      expect(dir.resolve(staff, 'move-item-to-stock')).toMatchObject({ grant: 'allowed' });
      expect(dir.resolve(staff, 'approve-void').grant).toBe('not_granted');
    }
    for (const p of ['approve-void', 'void-item', 'view-audit-log', 'move-item-to-stock'] as const) expect(dir.resolve(STAFF.manager, p).grant).toBe('allowed');
  });

  it('[04 §10 fixtures] raiseVoid: §6.8 deal variant — karahi part cooking, moved → { D: null, P1: moved, P2: null }; §3.5 values; deduped on void:<id>', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const d = dealX2(hub);
    toStage(hub, d.order_id, [d.karahiPart], 'cooking');
    const r = raiseVoid(hub, { requester: cashier, order_id: d.order_id, order_item_id: d.deal, units: 1, disposition: 'moved' });
    expect(r.deduped).toBe(false);
    const alert = hub.deps.db.prepare('SELECT kind, state, requester_staff_id, dedupe_key, values_json FROM alerts WHERE alert_id = ?').get(r.alert_id) as Record<string, string>;
    expect(alert).toMatchObject({ kind: VOID_KIND, requester_staff_id: STAFF.cashier, dedupe_key: `void:${d.deal}` });
    const values = JSON.parse(alert.values_json!) as Record<string, unknown>;
    expect(values).toEqual({
      order_id: d.order_id,
      order_item_id: d.deal,
      units: 1,
      reason_code: 'customer_changed_mind',
      note: null,
      disposition: 'moved',
      disposition_note: null,
      touched_ids: [d.deal, d.karahiPart, d.naanPart],
      line_dispositions: { [d.deal]: null, [d.karahiPart]: 'moved', [d.naanPart]: null },
      refund_minor: 119_999, // 02b planVoid: 1 of 2 deal units, its parts' shares (the remainder stays on the last unit, test 44)
      comp_voided_minor: 0,
    });
    expect(hub.deps.db.prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'ItemVoided'`).pluck().get()).toBe(0);
    expect(raiseVoid(hub, { requester: cashier, order_id: d.order_id, order_item_id: d.deal }).deduped).toBe(true);
  });

  it('[04 §10 fixtures] raiseVoid V3 / §3.1: not started → null; moved without a draw or off cooking/done → wastage; served no-station drink + child → both chosen', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const disp = (order_id: string, order_item_id: string, disposition: 'moved' | 'wastage' | 'staff_meal') =>
      raiseVoid(hub, { requester: cashier, order_id, order_item_id, disposition }).values.line_dispositions;
    const oc = optionChildOrder(hub); // 4d: item at added, its own-station child cooking
    toStage(hub, oc.order_id, [oc.child], 'cooking');
    expect(disp(oc.order_id, oc.item, 'moved')).toEqual({ [oc.item]: null, [oc.child]: 'wastage' }); // Raita has no draw
    const s = stagedOrder(hub); // a done naan has no draw; a cooking karahi has one
    expect(disp(s.order_id, s.done, 'moved')).toEqual({ [s.done]: 'wastage' });
    expect(disp(s.order_id, s.cooking, 'moved')).toEqual({ [s.cooking]: 'moved' });
    expect(disp(s.order_id, s.served, 'moved')).toEqual({ [s.served]: 'wastage' });
    const dr = servedColdDrink(hub); // 4f: not a header (no engine line touched)
    expect(disp(dr.order_id, dr.drink, 'staff_meal')).toEqual({ [dr.drink]: 'staff_meal', [dr.option]: 'staff_meal' });
  });

  it('[04 §10 fixtures] answer: withdraw by the requester (onWithdraw []) lifts the dedupe; nothing voided', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const o = stagedOrder(hub);
    const first = raiseVoid(hub, { requester: cashier, order_id: o.order_id, order_item_id: o.cooking });
    const w = await answer(hub, cashier, first.alert_id, 'withdraw');
    expect(w.status).toBe(200);
    expect(w.events.map((e) => e.event_type)).toContain('RequestWithdrawn');
    const again = raiseVoid(hub, { requester: cashier, order_id: o.order_id, order_item_id: o.cooking });
    expect(again.deduped).toBe(false);
    // approve / reject: not asserted here. 01d runs the kind's apply in preRead, before the PIN (§3.4), and P0.7's apply
    // throws for every decision until v7, so no answer outcome or PIN step is observable yet; v7's tests own both.
    expect(hub.deps.db.prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'ItemVoided'`).pluck().get()).toBe(0);
  });

  it('[04 §10 fixtures] strictRefold: the fixture event log re-folds in strict mode to the live lines (10f–10h)', async () => {
    hub = await startVoids();
    stagedOrder(hub);
    waitingT4(hub);
    dealX2(hub, { hold: true });
    servedColdDrink(hub);
    await remakeLine(hub);
    const refolded = strictRefold(hub);
    const stages = (s: EngineState) => Object.fromEntries(Object.values(s.lines).map((l) => [l.order_item_id, [l.stage, l.draws.map((d) => d.reserved)]]));
    expect(stages(refolded)).toEqual(stages(state()));
    expect(refolded.stock).toEqual(state().stock);
  });
});
