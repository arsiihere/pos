// 04 §6.1 VoidItems, direct path (task v4), §10 tests 1–19b: the real command over HTTP (fixtures' `post`), real orders,
// real events. Grant `allowed` = the Manager (aDirectory); the approval path is v6.
import { isOrderInEngine, type EngineState } from '@pos/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import { defineCommand, type CommandCtx } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { COMP_KIND } from '../../src/orders/line-change';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { voidItemsCommand } from '../../src/voids/commands/void-items';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';
import {
  append,
  appendOrder,
  dealX2,
  FX,
  openSeating,
  openVoidsDay,
  pendingWeight,
  post,
  raiseVoid,
  remakeLine,
  servedColdDrink,
  signIn,
  STAFF,
  stagedOrder,
  startVoids,
  strictRefold,
  toStage,
  voidsDirectory,
  VX,
  waitingT4,
  type Reply,
  type Who,
} from './fixtures';

let hub: TestHub;

afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

const state = (): EngineState => hub.deps.state.get();
const events = (): number => hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number;
const lineRow = (id: string) =>
  hub.deps.db.prepare('SELECT units, voided_units, refund_minor, comp_voided_minor, refundable_minor FROM order_lines WHERE order_item_id = ?').get(id) as {
    units: number;
    voided_units: number;
    refund_minor: number;
    comp_voided_minor: number;
    refundable_minor: number;
  };
const ofType = (r: Reply, t: string) => r.events.filter((e) => e.event_type === t);
const types = (r: Reply) => r.events.map((e) => e.event_type);

type Line = { order_item_id: string; units?: number; disposition: 'moved' | 'wastage' | 'staff_meal' | 'other' };
function voidItems(who: Who, order_id: string, lines: Line[], o: { reason_code?: string; note?: string | null; disposition_note?: string | null; commandId?: string } = {}): Promise<Reply> {
  return post(hub, who, 'void-items', 'VoidItems', { order_id, reason_code: o.reason_code ?? 'customer_changed_mind', note: o.note ?? null, disposition_note: o.disposition_note ?? null, lines }, o.commandId);
}

describe('[04 §6.1] VoidItems direct (allowed)', () => {
  it('[04 #1] cooking line, wastage → refund, engine line ended, ItemVoided carries the why; result voided + cancelled', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const r = await voidItems(mgr, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }], { reason_code: 'quality' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(ofType(r, 'ItemVoided').map((e) => e.payload)).toEqual([
      {
        order_item_id: s.cooking,
        units: 1,
        refund_minor: lineRow(s.cooking).refundable_minor,
        comp_voided_minor: 0,
        disposition: 'wastage',
        reason_code: 'quality',
        note: null,
        disposition_note: null,
        requester_staff_id: STAFF.manager,
        approver_staff_id: null,
        alert_id: null,
      },
    ]);
    expect(r.result).toEqual({ voided: [{ order_item_id: s.cooking, units: 1, refund_minor: lineRow(s.cooking).refundable_minor, comp_voided_minor: 0, disposition: 'wastage' }], cancelled: false });
    expect(lineRow(s.cooking)).toMatchObject({ voided_units: 1 });
    expect(state().lines[s.cooking]?.stage ?? 'voided').toBe('voided');
    expect(strictRefold(hub)).toEqual(state());
  });

  it('[04 #2] served engine line → money only, engine no-op (no stock event)', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const before = state().lines[s.served];
    const r = await voidItems(mgr, s.order_id, [{ order_item_id: s.served, disposition: 'wastage' }]);
    expect(r.status).toBe(200);
    expect(types(r).filter((t) => t.startsWith('Stock'))).toEqual([]);
    expect(lineRow(s.served)).toMatchObject({ voided_units: 1, refund_minor: 3_000 });
    expect(state().lines[s.served]?.stage).toBe(before?.stage);
  });

  it('[04 #3] order out of the engine (abandoned) → money only', async () => {
    hub = await startVoids();
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'AB', item_id: FX.naan }] });
    toStage(hub, order_id, ['AB'], 'done');
    hub.clock.advance(5 * 3_600_000); // past order_abandon_ms (4 h) and the planned land (02b #22)
    expect(isOrderInEngine(state(), order_id, hub.clock.branchNow())).toBe(false);
    const mgr = signIn(hub, STAFF.manager); // after the jump: a session from before it has expired
    const r = await voidItems(mgr, order_id, [{ order_item_id: 'AB', disposition: 'wastage' }]);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(lineRow('AB')).toMatchObject({ voided_units: 1, refund_minor: 3_000 });
  });

  it('[04 #4, #4b] stage added → ITEM_WRONG_STAGE added; served station-less drink → voided wastage, moved refused', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'A1', item_id: FX.naan }] });
    expect((await voidItems(mgr, order_id, [{ order_item_id: 'A1', disposition: 'wastage' }])).error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'A1', stage: 'added' } });
    const d = servedColdDrink(hub);
    expect((await voidItems(mgr, d.order_id, [{ order_item_id: d.drink, disposition: 'moved' }])).error).toMatchObject({ code: 'VOID_NOT_ALLOWED', details: { reason: 'not_movable_stage' } });
    const r = await voidItems(mgr, d.order_id, [{ order_item_id: d.drink, disposition: 'wastage' }]);
    expect(ofType(r, 'ItemVoided').map((e) => [e.payload.order_item_id, e.payload.disposition])).toEqual([
      [d.drink, 'wastage'],
      [d.option, 'wastage'],
    ]);
  });

  it('[04 #5] remake line past stage 1 → voided, refund 0; at stage 1 → ITEM_WRONG_STAGE added', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    const m = await remakeLine(hub, { by: mgr });
    expect((await voidItems(mgr, m.order_id, [{ order_item_id: m.remake, disposition: 'wastage' }])).error?.code).toBe('ITEM_WRONG_STAGE');
    toStage(hub, m.order_id, [m.remake], 'done');
    const r = await voidItems(mgr, m.order_id, [{ order_item_id: m.remake, disposition: 'wastage' }]);
    expect(r.status).toBe(200);
    expect(ofType(r, 'ItemVoided')[0]!.payload).toMatchObject({ refund_minor: 0, comp_voided_minor: 0 });
  });

  it('[04 #6] pending-weight line → voided, refund 0; a later SetLineWeight → 409 LINE_ALREADY_SETTLED', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    const w = pendingWeight(hub);
    const r = await voidItems(mgr, w.order_id, [{ order_item_id: w.line, disposition: 'wastage' }]);
    expect(r.status).toBe(200);
    expect(lineRow(w.line)).toMatchObject({ voided_units: 1, refund_minor: 0 });
    const weigh = await post(hub, mgr, 'set-line-weight', 'SetLineWeight', { order_item_id: w.line, quantity: 500 });
    expect(weigh.error?.code).toBe('LINE_ALREADY_SETTLED');
  });

  it('[04 #7] billed order → 409 ORDER_BILLED', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    hub.deps.db.prepare('UPDATE orders SET billed_at = ? WHERE order_id = ?').run(hub.clock.branchNow(), s.order_id); // 05 does not exist yet: fixture
    const n = events();
    expect((await voidItems(mgr, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }])).error).toEqual({ code: 'ORDER_BILLED', details: { order_id: s.order_id } });
    expect(events()).toBe(n);
  });

  it('[04 #8, #9] unknown order → 404; foreign line → 400 path; repeated id → 400 (C6)', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const other = stagedOrder(hub, { prefix: 'OT' });
    expect((await voidItems(mgr, 'NO_ORDER', [{ order_item_id: s.cooking, disposition: 'wastage' }])).error?.code).toBe('ORDER_NOT_FOUND');
    const foreign = await voidItems(mgr, s.order_id, [{ order_item_id: other.cooking, disposition: 'wastage' }]);
    expect(foreign.status).toBe(400);
    expect(foreign.error?.details).toMatchObject({ issues: [{ path: 'lines.0.order_item_id' }] });
    const repeat = await voidItems(mgr, s.order_id, [
      { order_item_id: s.cooking, disposition: 'wastage' },
      { order_item_id: s.cooking, disposition: 'wastage' },
    ]);
    expect(repeat.status).toBe(400);
    expect(JSON.stringify(repeat.error?.details)).toContain('lines.1.order_item_id');
  });

  it('[04 #10] moved partial: 2 of 4 stock naan cooking → ItemMovedToStock before ItemVoided, StockAdded 2, waiting line reserved, engine units 2', async () => {
    hub = await startVoids({ stock: { [FX.stock]: 0, [VX.naanStock]: 4 } });
    const mgr = signIn(hub, STAFF.manager);
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'N4', item_id: VX.stockNaan, quantity: 4 }] });
    toStage(hub, order_id, ['N4'], 'cooking');
    openSeating(hub, { table_id: VX.tables.T5, seating_id: 'SEAT_W' });
    const waiting = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT_W', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'WN', item_id: VX.stockNaan, quantity: 2 }, { order_item_id: 'WN_HOLD', item_id: VX.slow }] });
    expect(state().lines.WN).toMatchObject({ from_stock: false, stage: 'added' });
    const r = await voidItems(mgr, order_id, [{ order_item_id: 'N4', units: 2, disposition: 'moved' }]);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const seq = types(r).filter((t) => ['ItemMovedToStock', 'StockAdded', 'StockReserved', 'ItemVoided', 'StockReleased'].includes(t));
    expect(seq).toEqual(['ItemMovedToStock', 'StockAdded', 'StockReserved', 'ItemVoided']);
    expect(ofType(r, 'StockAdded')[0]!.payload).toMatchObject({ stock_item_id: VX.naanStock, quantity: 2, reason: 'moved' });
    expect(ofType(r, 'StockReserved')[0]!.payload).toMatchObject({ order_item_id: 'WN' });
    expect(state().lines.N4).toMatchObject({ units: 2 });
    expect(state().lines.N4!.draws[0]!.quantity).toBe(2);
    expect(state().stock[VX.naanStock]).toMatchObject({ on_hand: 2, reserved: 2 });
    expect(state().lines.WN).toMatchObject({ from_stock: true });
    expect(waiting.order_id).toBeDefined();
    expect(strictRefold(hub)).toEqual(state());
  });

  it('[04 #11] moved: no draw → stock_not_tracked; served → not_movable_stage; day closed → day_closed', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    let n = events();
    expect((await voidItems(mgr, s.order_id, [{ order_item_id: s.done, disposition: 'moved' }])).error).toEqual({ code: 'VOID_NOT_ALLOWED', details: { order_item_id: s.done, reason: 'stock_not_tracked' } });
    expect(events()).toBe(n);
    expect((await voidItems(mgr, s.order_id, [{ order_item_id: s.served, disposition: 'moved' }])).error).toEqual({ code: 'VOID_NOT_ALLOWED', details: { order_item_id: s.served, reason: 'not_movable_stage' } });
    expect(events()).toBe(n);
    append(hub, [{ stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, event_type: 'BusinessDayClosed', payload: {} }], { actor: STAFF.manager });
    n = events();
    expect((await voidItems(mgr, s.order_id, [{ order_item_id: s.cooking, disposition: 'moved' }])).error).toEqual({ code: 'VOID_NOT_ALLOWED', details: { order_item_id: s.cooking, reason: 'day_closed' } });
    expect(events()).toBe(n);
  });

  it('[04 #11] caller without move-item-to-stock allowed → 403 move_not_granted', async () => {
    const base = await voidsDirectory();
    // the Manager keeps void-item allowed; move-item-to-stock removed from every role
    const dir = { ...base, roles: base.roles.map((r) => ({ ...r, permissions: r.permissions.filter((p) => p.permission !== 'move-item-to-stock') })) };
    hub = await startVoids({ directory: dir });
    const mgr = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const n = events();
    expect((await voidItems(mgr, s.order_id, [{ order_item_id: s.cooking, disposition: 'moved' }])).error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'move_not_granted' } });
    expect(events()).toBe(n);
  });

  it('[04 #12] a still-reserved line voided → StockReleased { voided } share', async () => {
    hub = await startVoids({ stock: { [FX.stock]: 0, [VX.naanStock]: 4 } });
    const mgr = signIn(hub, STAFF.manager);
    // a reserve not yet consumed on a line past stage 1's cascade: a deal part at added under a started deal (OQ-C)
    const d = appendOrder(hub, {
      order_type: 'takeaway',
      placed_by: STAFF.orderTaker,
      lines: [
        { order_item_id: 'D', deal_id: FX.deal, quantity: 1 },
        { order_item_id: 'D_P1', deal_id: FX.deal, deal_part_id: FX.dealParts[0], item_id: FX.piece, parent_order_item_id: 'D' },
        { order_item_id: 'D_P2', deal_id: FX.deal, deal_part_id: FX.dealParts[1], item_id: VX.stockNaan, parent_order_item_id: 'D' },
      ],
    }).order_id;
    toStage(hub, d, ['D_P1'], 'cooking');
    expect(state().lines.D_P2!.draws[0]!.reserved).toBeGreaterThan(0);
    const reserved = state().lines.D_P2!.draws[0]!.reserved;
    const r = await voidItems(mgr, d, [{ order_item_id: 'D', disposition: 'wastage' }]);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(ofType(r, 'StockReleased').map((e) => e.payload)).toEqual([expect.objectContaining({ order_item_id: 'D_P2', quantity: reserved, reason: 'voided' })]);
  });

  it('[04 #13] zone line in its undo window → zone_undo; after → money only, zone count unchanged', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    hub.deps.writer.run((tx) =>
      tx.append([{ stream_type: 'table', stream_id: `zone:${FX.zone}`, event_type: 'ZoneStockSet', schema_version: 1, payload: { zone_id: FX.zone, item_id: FX.zoneItem, on_hand: 5, previous: 0 }, occurred_at: hub.clock.branchNow(), actor_id: STAFF.manager, device_id: 'D_SEED' }]),
    );
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'SEAT_Z' });
    const { order_id } = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT_Z', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'Z_C', item_id: FX.zoneItem, from_zone: true }] });
    const zone = () => hub.deps.db.prepare('SELECT on_hand FROM zone_stock WHERE zone_id = ? AND item_id = ?').pluck().get(FX.zone, FX.zoneItem);
    const count = zone();
    expect((await voidItems(mgr, order_id, [{ order_item_id: 'Z_C', disposition: 'wastage' }])).error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'Z_C', stage: 'zone_undo' } });
    hub.clock.advance(3_600_000);
    const r = await voidItems(mgr, order_id, [{ order_item_id: 'Z_C', disposition: 'wastage' }]);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(zone()).toBe(count);
  });

  it('[04 #14] Void all of the 3 last live lines → exactly one OrderCancelled; food-cleared case → exactly one OrderFoodCleared', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const r = await voidItems(mgr, s.order_id, [s.cooking, s.done, s.served].map((id) => ({ order_item_id: id, disposition: 'wastage' as const })));
    expect(r.status).toBe(200);
    expect(types(r).filter((t) => t === 'OrderCancelled' || t === 'OrderFoodCleared')).toEqual(['OrderCancelled']);
    expect(r.result).toMatchObject({ cancelled: true });
    // food cleared: the two unserved food lines voided, the served one stays live
    const f = stagedOrder(hub, { prefix: 'FC' });
    const g = await voidItems(mgr, f.order_id, [f.cooking, f.done].map((id) => ({ order_item_id: id, disposition: 'wastage' as const })));
    expect(types(g).filter((t) => t === 'OrderCancelled' || t === 'OrderFoodCleared')).toEqual(['OrderFoodCleared']);
    expect(strictRefold(hub)).toEqual(state());
  });

  it('[04 #14] dine-in: Void all of the last live lines → one OrderCancelled; the seating stays SEATED (no table lock, V14)', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    openSeating(hub, { table_id: VX.tables.T6, seating_id: 'SEAT_DV' });
    const s = stagedOrder(hub, { seating_id: 'SEAT_DV', prefix: 'DV' });
    const r = await voidItems(mgr, s.order_id, [s.cooking, s.done, s.served].map((id) => ({ order_item_id: id, disposition: 'wastage' as const })));
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(types(r).filter((t) => t === 'OrderCancelled' || t === 'OrderFoodCleared')).toEqual(['OrderCancelled']);
    expect(hub.deps.db.prepare('SELECT state FROM seatings WHERE seating_id = ?').pluck().get('SEAT_DV')).toBe('SEATED');
  });

  it('[04 §7 race] two VoidItems on the same line at once (different command_ids): one 200, one 400 lines.0.units; voided_units 1', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const [a, b] = await Promise.all([
      voidItems(mgr, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }], { commandId: 'race-a' }),
      voidItems(mgr, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }], { commandId: 'race-b' }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);
    const refused = a.status === 400 ? a : b;
    expect(refused.error?.details).toMatchObject({ issues: [{ path: 'lines.0.units' }] });
    expect(lineRow(s.cooking)).toMatchObject({ voided_units: 1 });
  });

  it('[04 #14b] overlapping entries [deal D ×1, its part P ×1] → P judged on what is left; refunds ≤ refundable', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    const d = dealX2(hub);
    toStage(hub, d.order_id, [d.karahiPart], 'cooking');
    const r = await voidItems(mgr, d.order_id, [
      { order_item_id: d.deal, units: 1, disposition: 'wastage' },
      { order_item_id: d.karahiPart, units: 1, disposition: 'wastage' },
    ]);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    for (const id of [d.deal, d.karahiPart, d.naanPart]) expect(lineRow(id).refund_minor).toBeLessThanOrEqual(lineRow(id).refundable_minor);
    expect(lineRow(d.karahiPart)).toMatchObject({ voided_units: 2 });
    const resultRefund = (r.result as { voided: Array<{ refund_minor: number }> }).voided.reduce((sum, v) => sum + v.refund_minor, 0);
    expect(resultRefund).toBe(ofType(r, 'ItemVoided').reduce((sum, e) => sum + (e.payload.refund_minor as number), 0));
  });

  it('[04 #15] reason other without note → 400; disposition other without disposition_note → 400; with them → 200', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const a = await voidItems(mgr, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }], { reason_code: 'other' });
    expect(a.status).toBe(400);
    expect(JSON.stringify(a.error?.details)).toContain('note');
    const b = await voidItems(mgr, s.order_id, [{ order_item_id: s.cooking, disposition: 'other' }]);
    expect(b.status).toBe(400);
    expect(JSON.stringify(b.error?.details)).toContain('disposition_note');
    const c = await voidItems(mgr, s.order_id, [{ order_item_id: s.cooking, disposition: 'other' }], { reason_code: 'other', note: 'guest left', disposition_note: 'given to driver' });
    expect(c.status, JSON.stringify(c.error)).toBe(200);
    expect(ofType(c, 'ItemVoided')[0]!.payload).toMatchObject({ reason_code: 'other', note: 'guest left', disposition: 'other', disposition_note: 'given to driver' });
  });

  it('[04 #16] retransmit (D32) → the stored response, no second event', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const first = await voidItems(mgr, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }], { commandId: 'void-retx' });
    const n = events();
    const second = await voidItems(mgr, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }], { commandId: 'void-retx' });
    expect(second.status).toBe(200);
    expect(second.result).toEqual(first.result);
    expect(events()).toBe(n);
  });

  it('[04 #17] COMMIT failure (D45) → nothing written, engine state unchanged', async () => {
    const failing = { on: false };
    hub = await createTestHub({ testHooks: { beforeCommit: () => { if (failing.on) throw new Error('commit failed'); } } });
    await seedDirectory(hub, await voidsDirectory());
    openVoidsDay(hub);
    const mgr = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const before = state();
    const n = events();
    failing.on = true;
    const r = await voidItems(mgr, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }]);
    expect(r.status).toBe(500);
    expect(state()).toBe(before);
    expect(events()).toBe(n);
    expect(lineRow(s.cooking)).toMatchObject({ voided_units: 0 });
  });

  it('[04 #18] scope branch last (C8): a 404 / 409 wins over scope; a non-branch void-item scope → 403 outside_scope', async () => {
    const base = await voidsDirectory();
    const dir = {
      ...base,
      roles: base.roles.map((r) => (r.role_id === 'R_MGR' ? { ...r, permissions: r.permissions.map((p) => (p.permission === 'void-item' ? { ...p, scope: 'my_floors' as const } : p)) } : r)),
    };
    hub = await startVoids({ directory: dir });
    const mgr = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'A1', item_id: FX.naan }] });
    expect((await voidItems(mgr, 'NO_ORDER', [{ order_item_id: s.cooking, disposition: 'wastage' }])).error?.code).toBe('ORDER_NOT_FOUND');
    expect((await voidItems(mgr, order_id, [{ order_item_id: 'A1', disposition: 'wastage' }])).error?.code).toBe('ITEM_WRONG_STAGE');
    expect((await voidItems(mgr, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }])).error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', order_id: s.order_id } });
  });

  it('[04 #19] direct void on a line with an open comp request → voided, the comp request closed obsolete (G1-1b)', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    const cashier = signIn(hub, STAFF.cashier);
    const s = stagedOrder(hub);
    const comp = hub.deps.writer.run((tx) => {
      const ctx = { tx, state: tx.state, clock: tx.clock, ids: tx.ids, actor: { kind: 'device', staffId: STAFF.cashier, stationId: null, sessionId: cashier.sessionId, deviceId: cashier.deviceId }, permission: null } as unknown as CommandCtx;
      const [res] = alerts.raiseMany(ctx, [
        { kind: COMP_KIND, subject: { stream_type: 'order', stream_id: s.order_id }, target: { kind: 'answerers' }, values: { order_id: s.order_id, order_item_id: s.cooking, units: 1, reason_code: 'quality', note: null }, details: { item: 'Karahi', quantity: 1, amount: 1, reason: 'quality' }, display: { kind_label_key: 'alert.comp.lock', table_code: null, requester_name: null }, dedupe_key: `comp:${s.cooking}`, requester_staff_id: STAFF.cashier, request: { approver_role_ids: [VX.managerRole] } },
      ]);
      tx.append(res!.events);
      return res!;
    }).result;
    const r = await voidItems(mgr, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }]);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(ofType(r, 'AlertClosed').map((e) => [e.payload.alert_id, e.payload.reason])).toEqual([[comp.alert_id, 'obsolete']]);
  });

  it('[04 #19b] direct void on a locked line → 409 VOID_PENDING { alert_id, order_item_id }', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const req = raiseVoid(hub, { requester: signIn(hub, STAFF.cashier), order_id: s.order_id, order_item_id: s.cooking });
    expect((await voidItems(mgr, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }])).error).toEqual({ code: 'VOID_PENDING', details: { alert_id: req.alert_id, order_item_id: s.cooking } });
  });
});

/** The real VoidItems handler under a test-only name, its own statements counted (02a SG-3 pattern); the count. */
async function countedVoid(who: Who, payload: Record<string, unknown>): Promise<{ reply: Reply; statements: number }> {
  const counter = statementCounter(hub.deps.db);
  let handled = -1;
  commandRegistry(hub.app).register(
    defineCommand({
      ...voidItemsCommand,
      commandType: 'TestVoidItemsCountedB',
      handle(ctx, p, cmd) {
        const before = counter.count;
        try {
          return voidItemsCommand.handle(ctx, p, cmd);
        } finally {
          handled = counter.count - before;
        }
      },
    }),
  );
  const reply = await post(hub, who, 'test-void-items-counted-b', 'TestVoidItemsCountedB', payload);
  return { reply, statements: handled };
}

// 04 §10 tests 10b, 10d–10h end to end (Z1 gaps): one real VoidItems over HTTP on a real test hub, real events and tables.
// Each run checks the batch's StockReserved lines, the engine state, the §6.1 direct-path statement count (3 + 2 = 5, no
// stale comp request) and a strict re-fold of the whole log (03a applyEvents strict: a stock_reserved_past_added or a
// breach throws) equal to the live state. 10g is not here: the spec makes it a pure stockEffects test (rule 4 keeps an
// at-added line out of VoidItems); it stays in packages/engine/test/stock-effects.test.ts.
// 10d here is a flow check only: rule 4 forces the voided K2 past stage 1 (it is `done`), so K2 is never a waiting
// candidate and this test cannot catch a broken T-2 reserve exclusion. The T-2 coverage of 10d is the engine-level
// `[04 #10d]` in packages/engine/test/stock-effects.test.ts, where K2 is a hidden waiting line.
// 10e: 02b §10 #10 makes a second round a new order, so "same order, second-round K2" cannot be a later round of K1's
// order; K2 is placed with K1 and held unfired (a VX.slow hold line), a live waiting line of the same order.
describe('[04 §6.1, T-2] VoidItems moved: stock effects end to end (10b, 10d–10h)', () => {
  type Entry = { order_item_id: string; units?: number; disposition: 'moved' | 'wastage' };
  async function voidCounted(order_id: string, lines: Entry[]): Promise<{ reply: Reply; reserved: string[] }> {
    const mgr = signIn(hub, STAFF.manager);
    const { reply, statements } = await countedVoid(mgr, { order_id, reason_code: 'quality', note: null, disposition_note: null, lines });
    expect(reply.status, JSON.stringify(reply.error)).toBe(200);
    expect(statements).toBe(5);
    expect(strictRefold(hub)).toEqual(state());
    expect(state().diagnostics.filter((d) => d.kind === 'stock_breach')).toEqual([]);
    return { reply, reserved: ofType(reply, 'StockReserved').map((e) => e.payload.order_item_id as string) };
  }
  /** One order: `lines` placed with a VX.slow hold line (the order's unfired lines stay hidden), then staged. */
  function heldOrder(lines: Parameters<typeof appendOrder>[1]['lines'], stages: Array<[string, 'cooking' | 'done']>): string {
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [...lines, { order_item_id: 'O1_HOLD', item_id: VX.slow }] });
    for (const [id, stage] of stages) toStage(hub, order_id, [id], stage);
    return order_id;
  }
  const deal = (quantity: number) => [
    { order_item_id: 'D', deal_id: FX.deal, quantity },
    { order_item_id: 'D_P1', deal_id: FX.deal, deal_part_id: FX.dealParts[0], item_id: FX.piece, parent_order_item_id: 'D' },
    { order_item_id: 'D_P2', deal_id: FX.deal, deal_part_id: FX.dealParts[1], item_id: FX.naan, parent_order_item_id: 'D' },
  ];

  it('[04 #10b] two moved entries on lines of one stock item, one waiting T4 line → [move, void] per entry, exactly one StockReserved {T4}', async () => {
    hub = await startVoids();
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'KA', item_id: FX.piece }, { order_item_id: 'KB', item_id: FX.piece }] });
    toStage(hub, order_id, ['KA'], 'cooking');
    toStage(hub, order_id, ['KB'], 'done');
    const t4 = waitingT4(hub);
    const { reply, reserved } = await voidCounted(order_id, [{ order_item_id: 'KA', disposition: 'moved' }, { order_item_id: 'KB', disposition: 'moved' }]);
    expect(reply.events.filter((e) => e.event_type === 'ItemMovedToStock' || e.event_type === 'ItemVoided').map((e) => `${e.event_type} ${String(e.payload.order_item_id)}`)).toEqual([
      'ItemMovedToStock KA',
      'ItemVoided KA',
      'ItemMovedToStock KB',
      'ItemVoided KB',
    ]);
    expect(ofType(reply, 'StockAdded')).toHaveLength(2);
    expect(reserved).toEqual([t4.line]);
    expect(state().lines[t4.line]).toMatchObject({ from_stock: true, stage: 'added' });
    expect(ofType(reply, 'ItemVoided').map((e) => e.payload.disposition)).toEqual(['moved', 'moved']);
  });

  it('[04 #10d] Void all on two karahi lines of one order (one moved), either array order, waiting T4 → T4 reserved, one OrderCancelled', async () => {
    for (const movedFirst of [true, false]) {
      hub = await startVoids();
      const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'K1', item_id: FX.piece }, { order_item_id: 'K2', item_id: FX.piece }] });
      toStage(hub, order_id, ['K1'], 'cooking');
      toStage(hub, order_id, ['K2'], 'done');
      const t4 = waitingT4(hub);
      const k1: Entry = { order_item_id: 'K1', disposition: 'moved' };
      const k2: Entry = { order_item_id: 'K2', disposition: 'wastage' };
      const { reply, reserved } = await voidCounted(order_id, movedFirst ? [k1, k2] : [k2, k1]);
      expect(reserved, String(movedFirst)).toEqual([t4.line]);
      expect(ofType(reply, 'OrderCancelled')).toHaveLength(1);
      expect(state().lines[t4.line]).toMatchObject({ from_stock: true });
      if (movedFirst) await hub.close(); // afterEach closes the last hub
    }
  });

  it('[04 #10e] same order, karahi K2 waiting and not voided (placed with K1: 02b §10 #10 makes a second round a new order), K1 voided moved → K2 reserved', async () => {
    hub = await startVoids();
    const order_id = heldOrder([{ order_item_id: 'K1', item_id: FX.piece }, { order_item_id: 'K2', item_id: FX.piece }], [['K1', 'cooking']]);
    expect(state().lines.K2).toMatchObject({ stage: 'added', from_stock: false, fired_at: null });
    const { reply, reserved } = await voidCounted(order_id, [{ order_item_id: 'K1', disposition: 'moved' }]);
    expect(reserved).toEqual(['K2']);
    expect(ofType(reply, 'OrderCancelled')).toHaveLength(0);
    expect(state().lines.K2).toMatchObject({ from_stock: true });
  });

  it('[04 #10f] [deal D with karahi part P1 at added, karahi K1 done moved] in that order, with and without a waiting T4 → never StockReserved{P1}; T4 reserved when present', async () => {
    for (const withT4 of [true, false]) {
      hub = await startVoids();
      const order_id = heldOrder([...deal(1), { order_item_id: 'K1', item_id: FX.piece }], [['D_P2', 'cooking'], ['K1', 'done']]);
      expect(state().lines.D_P1).toMatchObject({ stage: 'added', from_stock: false, fired_at: null });
      const t4 = withT4 ? waitingT4(hub) : null;
      const { reply, reserved } = await voidCounted(order_id, [{ order_item_id: 'D', disposition: 'wastage' }, { order_item_id: 'K1', disposition: 'moved' }]);
      expect(reserved, String(withT4)).not.toContain('D_P1');
      expect(reserved, String(withT4)).toEqual(t4 === null ? [] : [t4.line]);
      expect(ofType(reply, 'ItemVoided').find((e) => e.payload.order_item_id === 'D_P1')!.payload).toMatchObject({ disposition: null });
      expect(state().lines.D_P1?.from_stock ?? false).toBe(false);
      if (withT4) await hub.close(); // afterEach closes the last hub
    }
  });

  it('[04 #10h] [deal D ×2 units 1 with karahi part P at added waiting, K1 ×2 done moved] and the reverse, waiting T4 → never StockReserved{P}, T4 reserved, no stock_breach', async () => {
    for (const dealFirst of [true, false]) {
      hub = await startVoids();
      const order_id = heldOrder([...deal(2), { order_item_id: 'K1', item_id: FX.piece, quantity: 2 }], [['D_P2', 'cooking'], ['K1', 'done']]);
      expect(state().lines.D_P1).toMatchObject({ stage: 'added', from_stock: false, fired_at: null, units: 2 });
      const t4 = waitingT4(hub);
      const d: Entry = { order_item_id: 'D', units: 1, disposition: 'wastage' };
      const k: Entry = { order_item_id: 'K1', units: 2, disposition: 'moved' };
      const { reserved } = await voidCounted(order_id, dealFirst ? [d, k] : [k, d]);
      expect(reserved, String(dealFirst)).not.toContain('D_P1');
      expect(reserved, String(dealFirst)).toEqual([t4.line]);
      expect(state().lines.D_P1).toMatchObject({ units: 1, from_stock: false });
      if (dealFirst) await hub.close(); // afterEach closes the last hub
    }
  });
});

describe('[04 §6.1] definition and statements', () => {
  it('[04 V15, §6.1] approvable, not queueable; permission void-item; device session', () => {
    expect(voidItemsCommand).toMatchObject({ commandType: 'VoidItems', permission: 'void-item', approvable: true, sessionKind: 'device' });
    expect(voidItemsCommand.queueable ?? false).toBe(false);
  });

  it('[04 §6.1 Statements] direct path: 3 + 2 = 5 statements (readOrder, two listOpen, lineChangeDrafts 2)', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    waitingT4(hub);
    const counter = statementCounter(hub.deps.db);
    let handled = -1;
    commandRegistry(hub.app).register(
      defineCommand({
        ...voidItemsCommand,
        commandType: 'TestVoidItemsCounted',
        handle(ctx, payload, cmd) {
          const before = counter.count;
          try {
            return voidItemsCommand.handle(ctx, payload, cmd);
          } finally {
            handled = counter.count - before;
          }
        },
      }),
    );
    const r = await post(hub, mgr, 'test-void-items-counted', 'TestVoidItemsCounted', {
      order_id: s.order_id,
      reason_code: 'quality',
      note: null,
      disposition_note: null,
      lines: [
        { order_item_id: s.cooking, disposition: 'moved' },
        { order_item_id: s.done, disposition: 'wastage' },
        { order_item_id: s.served, disposition: 'wastage' },
      ],
    });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(handled).toBe(5);
  });

  // Reading (#131): §6.1's "3 + 2" excludes 01d's closeMany when lineChangeDrafts closes a stale comp request; measured
  // +7 here (closeMany's own statements for one close), so 12. Pinned as measured; the integrator records it as an AD row.
  it('[04 §6.1 Statements, #19 path] a direct void that closes a stale comp request: 3 + 2 + 01d closeMany (7, one close) = 12', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    const cashier = signIn(hub, STAFF.cashier);
    const s = stagedOrder(hub);
    hub.deps.writer.run((tx) => {
      const ctx = { tx, state: tx.state, clock: tx.clock, ids: tx.ids, actor: { kind: 'device', staffId: STAFF.cashier, stationId: null, sessionId: cashier.sessionId, deviceId: cashier.deviceId }, permission: null } as unknown as CommandCtx;
      const [res] = alerts.raiseMany(ctx, [
        { kind: COMP_KIND, subject: { stream_type: 'order', stream_id: s.order_id }, target: { kind: 'answerers' }, values: { order_id: s.order_id, order_item_id: s.cooking, units: 1, reason_code: 'quality', note: null }, details: { item: 'Karahi', quantity: 1, amount: 1, reason: 'quality' }, display: { kind_label_key: 'alert.comp.lock', table_code: null, requester_name: null }, dedupe_key: `comp:${s.cooking}`, requester_staff_id: STAFF.cashier, request: { approver_role_ids: [VX.managerRole] } },
      ]);
      tx.append(res!.events);
    });
    const { reply, statements } = await countedVoid(mgr, { order_id: s.order_id, reason_code: 'quality', note: null, disposition_note: null, lines: [{ order_item_id: s.cooking, disposition: 'wastage' }] });
    expect(reply.status, JSON.stringify(reply.error)).toBe(200);
    expect(ofType(reply, 'AlertClosed')).toHaveLength(1);
    expect(statements).toBe(12);
  });
});
