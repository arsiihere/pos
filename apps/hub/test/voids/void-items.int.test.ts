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
