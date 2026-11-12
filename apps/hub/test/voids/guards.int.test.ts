// 04 §6.6, §4.2, row A-1 (task v8): the real void guards registered at boot (registerVoids → lanes/V2.ts) and the
// `pendingVoids` export. Tests 24b, 26b (blocked), 33, 34, 34b, 35, 36, plus the A-1 end-to-end close and the
// statement counts of §6.6 / Q-3 / A-1 (1 statement each, `alerts_open_kind`).
import type { EngineState } from '@pos/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDayCloseGuard } from '../../src/commands/close-business-day';
import { seatingTotals } from '../../src/orders/exports';
import { checkLineGuard } from '../../src/orders/line-guard';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { checkMergeGuard } from '../../src/tables/merge-guard';
import { pendingVoids } from '../../src/voids/contracts';
import { statementCounter } from '../helpers/statement-counter';
import { openSession, pairDevice, type TestHub } from '../helpers/test-hub';
import {
  answer,
  append,
  appendOrder,
  dealX2,
  FX,
  openSeating,
  post,
  raiseVoid,
  signIn,
  STAFF,
  stagedOrder,
  startVoids,
  toStage,
  VX,
  type Reply,
  type Who,
} from './fixtures';

let hub: TestHub;

afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

const state = (): EngineState => hub.deps.state.get();

type Line = { order_item_id: string; units?: number; disposition: 'moved' | 'wastage' | 'staff_meal' | 'other' };
async function ask(who: Who, order_id: string, lines: Line[]): Promise<string[]> {
  const reply = await post(hub, who, 'void-items', 'VoidItems', { order_id, reason_code: 'customer_changed_mind', note: null, disposition_note: null, lines });
  if (reply.status !== 200) throw new Error(`ask: ${reply.status} ${JSON.stringify(reply.error)}`);
  return (reply.result as { pending: Array<{ alert_id: string }> }).pending.map((p) => p.alert_id);
}

/** Statements of one call, counted on the hub's db. */
function counted<T>(fn: () => T): { value: T; statements: number } {
  const counter = statementCounter(hub.deps.db);
  counter.reset();
  const value = fn();
  return { value, statements: counter.count };
}

// ------------------------------------------------------------------------------------------- merge guard (02a)

async function command(who: Who, path: string, command_type: string, payload: Record<string, unknown>): Promise<Reply> {
  return post(hub, who, path, command_type, payload);
}

describe('[04 §6.6] merge guard (02a §3.11 / §3.12)', () => {
  it('[04 #33] merge with a pending void → 409 MERGE_BLOCKED_BY_VOID { order_item_ids } (the touched ids); after approve / reject / withdraw → allowed', async () => {
    for (const end of ['approve', 'reject', 'withdraw'] as const) {
      hub = await startVoids();
      const cashier = signIn(hub, STAFF.cashier);
      const manager = signIn(hub, STAFF.manager);
      openSeating(hub, { table_id: VX.tables.T4, seating_id: 'SEAT_T4', holder_staff_id: STAFF.manager });
      openSeating(hub, { table_id: VX.tables.T5, seating_id: 'SEAT_T5', holder_staff_id: STAFF.manager });
      const d = dealX2(hub, { seating_id: 'SEAT_T5' });
      toStage(hub, d.order_id, [d.karahiPart], 'cooking');
      const [alert_id] = await ask(cashier, d.order_id, [{ order_item_id: d.deal, units: 1, disposition: 'wastage' }]);
      const mg = { into_table_id: VX.tables.T4, into_seating_id: 'SEAT_T4', table_id: VX.tables.T5, table_seating_id: 'SEAT_T5' };
      const blocked = await command(manager, 'merge-tables', 'MergeTables', mg);
      expect(blocked.status, end).toBe(409);
      expect(blocked.error).toEqual({ code: 'MERGE_BLOCKED_BY_VOID', details: { order_item_ids: [d.deal, d.karahiPart, d.naanPart] } });
      const closed = await answer(hub, end === 'withdraw' ? cashier : manager, alert_id!, end);
      expect(closed.status, `${end} ${JSON.stringify(closed.error)}`).toBe(200);
      const merged = await command(manager, 'merge-tables', 'MergeTables', mg);
      expect(merged.status, `${end} ${JSON.stringify(merged.error)}`).toBe(200);
      await hub.close();
      hub = undefined as unknown as TestHub;
    }
  });

  it('[04 #34, #34b] split: moving the order with a pending void → blocked; moving another order of that seating → allowed (moved orders only, H6-7)', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    openSeating(hub, { table_id: VX.tables.T4, seating_id: 'SEAT_T4', holder_staff_id: STAFF.manager });
    const locked = stagedOrder(hub, { seating_id: 'SEAT_T4', prefix: 'SA' });
    const free = stagedOrder(hub, { seating_id: 'SEAT_T4', prefix: 'SB' });
    append(hub, [{ stream_type: 'table', stream_id: VX.tables.T4, event_type: 'TableLocked', payload: { table_id: VX.tables.T4, seating_id: 'SEAT_T4', staff_id: STAFF.manager } }], { actor: STAFF.manager, device: manager.deviceId });
    await ask(cashier, locked.order_id, [{ order_item_id: locked.cooking, disposition: 'wastage' }]);
    const split = (order_ids: string[], to: string) => command(manager, 'split-seating', 'SplitSeating', { from_table_id: VX.tables.T4, seating_id: 'SEAT_T4', to_table_id: to, order_ids });
    const blocked = await split([locked.order_id], VX.tables.T6);
    expect(blocked.status).toBe(409);
    expect(blocked.error).toEqual({ code: 'MERGE_BLOCKED_BY_VOID', details: { order_item_ids: [locked.cooking] } });
    const moved = await split([free.order_id], VX.tables.T7);
    expect(moved.status, JSON.stringify(moved.error)).toBe(200);
  });

  it('[04 §6.6] merge guard: 1 statement whether it blocks or not, by seatings (merge) or by order ids (split)', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    openSeating(hub, { table_id: VX.tables.T4, seating_id: 'SEAT_T4' });
    const s = stagedOrder(hub, { seating_id: 'SEAT_T4' });
    const free = counted(() => checkMergeGuard(hub.deps.db, { seating_ids: ['SEAT_T4'] }));
    expect(free).toEqual({ value: { blocked: false, order_item_ids: [] }, statements: 1 });
    await ask(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }, { order_item_id: s.done, disposition: 'wastage' }]);
    expect(counted(() => checkMergeGuard(hub.deps.db, { seating_ids: ['SEAT_T4', 'SEAT_X'] }))).toEqual({ value: { blocked: true, order_item_ids: [s.cooking, s.done] }, statements: 1 });
    expect(counted(() => checkMergeGuard(hub.deps.db, { seating_ids: ['SEAT_T4'], order_ids: ['OTHER'] }))).toEqual({ value: { blocked: false, order_item_ids: [] }, statements: 1 });
    expect(counted(() => checkMergeGuard(hub.deps.db, { seating_ids: ['SEAT_X'], order_ids: [s.order_id] }))).toEqual({ value: { blocked: true, order_item_ids: [s.cooking, s.done] }, statements: 1 });
  });
});

// ------------------------------------------------------------------------------------------- line guard (02b Q-3)

describe('[04 §6.6, row Q-3] line guard', () => {
  it('[04 §6.6] an open void request of the order whose touched ids meet the given ids → { alert_id, order_item_id: the first locked given id }; other orders / ids → null; 1 statement', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const d = dealX2(hub);
    const other = stagedOrder(hub);
    toStage(hub, d.order_id, [d.karahiPart], 'cooking');
    const [alert_id] = await ask(cashier, d.order_id, [{ order_item_id: d.karahiPart, units: 1, disposition: 'wastage' }]);
    expect(counted(() => checkLineGuard(hub.deps.db, d.order_id, [d.deal, d.naanPart]))).toEqual({ value: null, statements: 1 });
    expect(counted(() => checkLineGuard(hub.deps.db, d.order_id, [d.deal, d.naanPart, d.karahiPart]))).toEqual({ value: { alert_id, order_item_id: d.karahiPart }, statements: 1 });
    expect(checkLineGuard(hub.deps.db, other.order_id, [d.karahiPart])).toBeNull();
    expect(checkLineGuard(hub.deps.db, d.order_id, [])).toBeNull();
  });

  it('[04 §6.6] two given ids locked by different requests, given in the reverse of their raise order → the first GIVEN id (and its request) is named', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const s = stagedOrder(hub);
    const [first] = await ask(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }]);
    const [second] = await ask(cashier, s.order_id, [{ order_item_id: s.done, disposition: 'wastage' }]);
    expect(checkLineGuard(hub.deps.db, s.order_id, [s.done, s.cooking])).toEqual({ alert_id: second, order_item_id: s.done });
    expect(checkLineGuard(hub.deps.db, s.order_id, [s.served, s.cooking, s.done])).toEqual({ alert_id: first, order_item_id: s.cooking });
  });
});

// ------------------------------------------------------------------------------------------- day-close guard (01a A-1)

/** An admin session on a new device (CloseBusinessDay is an admin command). */
function adminOn(staffId: string): { deviceId: string; token: string; sessionToken: string } {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'admin', staffId, deviceId: device.deviceId });
  return { deviceId: device.deviceId, token: device.token, sessionToken: session.token };
}

async function closeDay(): Promise<{ status: number; body: { data?: { result: { changed: boolean } }; error?: { code: string; details: Record<string, unknown> } } }> {
  const admin = adminOn(STAFF.manager);
  const res = await hub.app.inject({
    method: 'POST',
    url: '/admin/commands/close-business-day',
    headers: { authorization: `Bearer ${admin.token}`, 'x-admin-session': admin.sessionToken },
    payload: { command_id: `close-${hub.clock.branchNow()}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type: 'CloseBusinessDay', payload: {}, occurred_at: hub.clock.branchNow(), actor_id: STAFF.manager, device_id: admin.deviceId },
  });
  return { status: res.statusCode, body: res.json() };
}

/** No minimum gap: the day may close right away (01a §6.18b `opened_recently` is not what these tests are about). */
function noGap(): void {
  const config = branchConfig()!;
  swapBranchConfig({ config: { ...config, day_min_gap_hours: 0 }, snapshotHash: 'h'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 4, appliedAt: 0 });
}

describe('[04 row A-1] day-close guard', () => {
  it('[04 A-1 end to end] open void → CloseBusinessDay 409 DAY_CLOSE_BLOCKED with the list (identifier, item, requester name); withdraw → the day closes', async () => {
    hub = await startVoids();
    noGap();
    const cashier = signIn(hub, STAFF.cashier);
    openSeating(hub, { table_id: VX.tables.T12, seating_id: 'SEAT_T12' });
    const s = stagedOrder(hub, { seating_id: 'SEAT_T12' });
    const [alert_id] = await ask(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }]);
    const blocked = await closeDay();
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({
      code: 'DAY_CLOSE_BLOCKED',
      details: { reason: 'void_pending', voids: [{ alert_id, identifier: 'T12', item: 'Chicken Karahi', requester_name: 'Cashier' }], count: 1 },
    });
    expect(state().business_day?.closed_at).toBeNull();
    expect((await answer(hub, cashier, alert_id!, 'withdraw')).status).toBe(200);
    const closed = await closeDay();
    expect(closed.status, JSON.stringify(closed.body.error)).toBe(200);
    expect(closed.body.data!.result.changed).toBe(true);
    expect(state().business_day?.closed_at).not.toBeNull();
  });

  it('[04 #24b] 41 open requests → 40 listed oldest first, count 41; 1 statement (COUNT(*) OVER ()); after approve / reject / withdraw of every one → closes', async () => {
    hub = await startVoids();
    noGap();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const orders = Array.from({ length: 41 }, (_, i) => stagedOrder(hub, { prefix: `D${String(i).padStart(2, '0')}` }));
    const ids = orders.map((o) => raiseVoid(hub, { requester: cashier, order_id: o.order_id, order_item_id: o.cooking, identifier: `#${o.order_id.slice(-4)}` }).alert_id);
    const guard = counted(() => checkDayCloseGuard(hub.deps.db, state()));
    expect(guard.statements).toBe(1);
    const details = guard.value!.details as { reason: string; voids: Array<{ alert_id: string; identifier: string | null; item: string; requester_name: string | null }>; count: number };
    expect(guard.value!.code).toBe('DAY_CLOSE_BLOCKED');
    expect(details.reason).toBe('void_pending');
    expect(details.count).toBe(41);
    expect(details.voids.map((v) => v.alert_id)).toEqual(ids.slice(0, 40));
    expect(details.voids[0]).toEqual({ alert_id: ids[0], identifier: `#${orders[0]!.order_id.slice(-4)}`, item: 'Chicken Karahi', requester_name: 'Cashier' });
    const blocked = await closeDay();
    expect(blocked.status).toBe(409);
    expect(blocked.body.error!.details).toEqual(details);
    // every request ends: approve, reject or withdraw
    for (const [i, id] of ids.entries()) {
      const end = (['approve', 'reject', 'withdraw'] as const)[i % 3]!;
      const r = await answer(hub, end === 'withdraw' ? cashier : manager, id, end);
      expect(r.status, `${end} ${JSON.stringify(r.error)}`).toBe(200);
    }
    expect(counted(() => checkDayCloseGuard(hub.deps.db, state()))).toEqual({ value: null, statements: 1 });
    expect((await closeDay()).status).toBe(200);
  });
});

describe('[04 §6.6, §4.2] index', () => {
  it('[04 §6.6] merge (both forms), line and day-close guards and pendingVoids each run one statement on alerts_open_kind', async () => {
    hub = await startVoids();
    const db = hub.deps.db;
    const seen: string[] = [];
    const prepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      seen.push(sql);
      return prepare(sql);
    }) as typeof db.prepare;
    checkMergeGuard(db, { seating_ids: ['S'] });
    checkMergeGuard(db, { seating_ids: ['S'], order_ids: ['O'] });
    checkLineGuard(db, 'O', ['L']);
    checkDayCloseGuard(db, state());
    pendingVoids(db, ['O'], state());
    db.prepare = prepare;
    expect(seen).toHaveLength(5);
    for (const sql of seen) {
      const args = Array.from({ length: (sql.match(/\?/g) ?? []).length }, () => '[]');
      const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
      expect(plan, sql).toMatch(/alerts_open_kind/);
    }
  });
});

// ------------------------------------------------------------------------------------------- pendingVoids (§4.2)

describe('[04 §4.2] pendingVoids', () => {
  it('[04 #35] 1 statement for 40 orders; one entry per open request with the raise-time plan (refund_minor / comp_voided_minor = values); orders without one are absent', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const orders = Array.from({ length: 40 }, (_, i) => stagedOrder(hub, { prefix: `P${String(i).padStart(2, '0')}` }));
    const raised = orders.slice(0, 39).map((o) => raiseVoid(hub, { requester: cashier, order_id: o.order_id, order_item_id: o.done }));
    const extra = raiseVoid(hub, { requester: cashier, order_id: orders[0]!.order_id, order_item_id: orders[0]!.cooking });
    const out = counted(() => pendingVoids(hub.deps.db, orders.map((o) => o.order_id), state()));
    expect(out.statements).toBe(1);
    expect(out.value.size).toBe(39);
    expect(out.value.has(orders[39]!.order_id)).toBe(false);
    const first = out.value.get(orders[0]!.order_id)!;
    expect(first.map((v) => v.alert_id)).toEqual([raised[0]!.alert_id, extra.alert_id]);
    const row = hub.deps.db.prepare('SELECT raised_at FROM alerts WHERE alert_id = ?').pluck().get(raised[0]!.alert_id) as number;
    expect(first[0]).toEqual({
      alert_id: raised[0]!.alert_id,
      order_item_id: orders[0]!.done,
      units: raised[0]!.values.units,
      touched_ids: raised[0]!.values.touched_ids,
      refund_minor: raised[0]!.values.refund_minor,
      comp_voided_minor: raised[0]!.values.comp_voided_minor,
      requester_staff_id: STAFF.cashier,
      raised_at: row,
      blocked: null,
    });
    expect(first[0]!.refund_minor).toBeGreaterThan(0);
    expect(counted(() => pendingVoids(hub.deps.db, [])).value.size).toBe(0);
  });

  it('[04 #26b] a stored `moved` line served meanwhile → blocked: not_movable_stage (engine state in memory, still 1 statement); without state → null; the approve is refused; withdraw + re-ask as wastage → approved', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const [alert_id] = await ask(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'moved' }]);
    expect(pendingVoids(hub.deps.db, [s.order_id], state()).get(s.order_id)![0]!.blocked).toBeNull();
    toStage(hub, s.order_id, [s.cooking], 'served');
    const live = counted(() => pendingVoids(hub.deps.db, [s.order_id], state()));
    expect(live.statements).toBe(1);
    expect(live.value.get(s.order_id)![0]!.blocked).toBe('not_movable_stage');
    expect(pendingVoids(hub.deps.db, [s.order_id]).get(s.order_id)![0]!.blocked).toBeNull();
    const refused = await answer(hub, manager, alert_id!, 'approve');
    expect(refused.status).toBe(409);
    expect(refused.error).toEqual({ code: 'VOID_NOT_ALLOWED', details: { order_item_id: s.cooking, reason: 'not_movable_stage', hint: 'withdraw_and_reask' } });
    expect((await answer(hub, cashier, alert_id!, 'withdraw')).status).toBe(200);
    expect(pendingVoids(hub.deps.db, [s.order_id], state()).size).toBe(0);
    const [again] = await ask(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }]);
    expect(pendingVoids(hub.deps.db, [s.order_id], state()).get(s.order_id)![0]!.blocked).toBeNull();
    const ok = await answer(hub, manager, again!, 'approve');
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
  });

  it('[04 #26b] a stored `moved` line at cooking with NO stock draw: pendingVoids.blocked and the approve re-check agree (one movableLine rule)', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'ND_N', item_id: FX.naan }] });
    toStage(hub, order_id, ['ND_N'], 'cooking');
    expect(state().lines.ND_N).toMatchObject({ stage: 'cooking', draws: [] });
    // a state the raise rules prevent (moved needs a draw): stored through 01d directly
    const { alert_id } = raiseVoid(hub, { requester: cashier, order_id, order_item_id: 'ND_N', disposition: 'moved', line_dispositions: { ND_N: 'moved' } });
    expect(pendingVoids(hub.deps.db, [order_id], state()).get(order_id)![0]!.blocked).toBe('not_movable_stage');
    const refused = await answer(hub, manager, alert_id, 'approve');
    expect(refused.error).toEqual({ code: 'VOID_NOT_ALLOWED', details: { order_item_id: 'ND_N', reason: 'not_movable_stage', hint: 'withdraw_and_reask' } });
  });

  it('[04 #36] bill with a pending void of a comped unit: the total minus refund_minor only equals the bill after the approve (H1-5)', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    openSeating(hub, { table_id: VX.tables.T4, seating_id: 'SEAT_T4' });
    const { order_id } = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT_T4', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'NN', item_id: FX.naan, quantity: 3 }, { order_item_id: 'NK', item_id: FX.naan }] });
    toStage(hub, order_id, ['NN'], 'cooking');
    const comped = await post(hub, manager, 'comp-line', 'CompLine', { order_item_id: 'NN', units: 1, reason_code: 'guest', note: 'regular' });
    expect(comped.status, JSON.stringify(comped.error)).toBe(200);
    const [alert_id] = await ask(cashier, order_id, [{ order_item_id: 'NN', units: 3, disposition: 'wastage' }]);
    const pending = pendingVoids(hub.deps.db, [order_id]).get(order_id)!;
    expect(pending[0]!.comp_voided_minor).toBeGreaterThan(0);
    expect(pending[0]!.refund_minor).toBeGreaterThan(0);
    const before = seatingTotals(hub.deps.db, 'SEAT_T4').total_minor;
    const shown = before - pending.reduce((sum, v) => sum + v.refund_minor, 0);
    expect((await answer(hub, manager, alert_id!, 'approve')).status).toBe(200);
    expect(seatingTotals(hub.deps.db, 'SEAT_T4').total_minor).toBe(shown);
  });
});
