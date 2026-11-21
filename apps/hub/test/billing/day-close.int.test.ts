// 05 §6.24 `CarryOverOrders`, §6.25 day close (05's guard and appender on 01a's `CloseBusinessDay`), §3.13, B25, R-76
// (task 25; 05-plan §3 row 25, G-74, G-77). Tests #62, #62b, #63, #63c, #64, #65. Real commands over HTTP through the
// hub's writer and the real folds; orders from 02b's fixtures (naan Rs 30, 3,000 minor). Every PKR amount is literal:
// float Rs 5,000; a count of Rs 4,000 → variance −Rs 1,000, above the built-in Rs 100 threshold. The permanent
// afterEach scan keeps every note in `bill_texts` only and every token out of the logs.
import { aBillReopened, anInvoiceCredited, anInvoiceIssued } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { currentDirectory } from '../../src/auth/guards';
import { billingDayCloseAppender, billingDayCloseGuard } from '../../src/billing/lanes/day-close';
import type { CommandCtx } from '../../src/commands/registry';
import { billingProjection } from '../../src/billing/projections/billing';
import { commandRegistry } from '../../src/commands/route';
import { createProjectionRegistry } from '../../src/projections/registry';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import type { EngineState } from '@pos/engine';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, seedDirectory, type TestHub } from '../helpers/test-hub';
import { append, openVoidsDay, raiseVoid } from '../voids/fixtures';
import { answer, appendOrder, billingDirectory, FX, openSeating, post, signIn, STAFF, startBilling, takeawayOrder, VX, type Reply, type Who } from './fixtures';

let hub: TestHub;
const seats: Who[] = [];
const NOTES = new Set<string>();
const noteSecret = (s: string): string => (NOTES.add(s), s);

const NAAN = 3_000; // Rs 30
const FLOAT = 500_000; // Rs 5,000
const SHORT = 400_000; // Rs 4,000 counted → −Rs 1,000

function leaks(): string[] {
  const logs = hub.logs();
  const found: string[] = [];
  const tables = hub.deps.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).pluck().all() as string[];
  for (const note of NOTES) {
    if (logs.includes(note)) found.push('note in logs');
    for (const t of tables) {
      if (t === 'bill_texts') continue;
      if (JSON.stringify(hub.deps.db.prepare(`SELECT * FROM "${t}"`).all()).includes(note)) found.push(`note in ${t}`);
    }
  }
  for (const who of seats) for (const secret of [who.token, who.sessionToken]) if (logs.includes(secret)) found.push(`token of ${who.staffId} in logs`);
  return found;
}

afterEach(async () => {
  const found = hub === undefined ? [] : leaks();
  NOTES.clear();
  seats.length = 0;
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
  expect(found).toEqual([]);
});

// ------------------------------------------------------------------------------------------------ set-up

interface Started {
  manager: Who;
  cashier: Who;
  waiter: Who;
  owner: Who;
}

/** A billing hub with the day open and no minimum gap (01a `opened_recently` is not under test here). */
async function start(testHooks?: { beforeCommit?: () => void }): Promise<Started> {
  if (testHooks === undefined) hub = await startBilling();
  else {
    hub = await createTestHub({ testHooks });
    await seedDirectory(hub, await billingDirectory());
    openVoidsDay(hub);
  }
  noGap();
  const manager = signIn(hub, STAFF.manager);
  const cashier = signIn(hub, STAFF.cashier);
  const waiter = signIn(hub, STAFF.orderTaker);
  const owner = signIn(hub, 'S_OWNER');
  seats.push(manager, cashier, waiter, owner);
  return { manager, cashier, waiter, owner };
}

function noGap(): void {
  const config = branchConfig()!;
  swapBranchConfig({ config: { ...config, day_min_gap_hours: 0 }, snapshotHash: 'h'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 4, appliedAt: 0 });
}

const state = (): EngineState => hub.deps.state.get() as EngineState;
const closeDay = (who: Who, commandId?: string): Promise<Reply> => post(hub, who, 'close-business-day', 'CloseBusinessDay', {}, commandId);
const carry = (who: Who, payload: Record<string, unknown>, commandId?: string): Promise<Reply> => post(hub, who, 'carry-over-orders', 'CarryOverOrders', payload, commandId);

async function openShift(who: Who): Promise<string> {
  const r = await post(hub, who, 'open-shift', 'OpenShift', { float_minor: FLOAT, as_drawer: false });
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  return r.result!.shift_id as string;
}

/** The cashier's shift counted Rs 1,000 short: CLOSED, sign-off pending; returns the shift and its request. */
async function shortShift(cashier: Who): Promise<{ shift_id: string; alert_id: string; closed_at: number }> {
  const shift_id = await openShift(cashier);
  const r = await post(hub, cashier, 'count-shift', 'CountShift', { shift_id, counted_minor: SHORT });
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  const row = hub.deps.db.prepare('SELECT variance_state, variance_alert_id, closed_at FROM shifts WHERE shift_id = ?').get(shift_id) as {
    variance_state: string;
    variance_alert_id: string;
    closed_at: number;
  };
  expect(row.variance_state).toBe('pending');
  return { shift_id, alert_id: row.variance_alert_id, closed_at: row.closed_at };
}

function billOrders(order_ids: string[]): void {
  append(hub, [{ stream_type: 'order', stream_id: order_ids[0]!, event_type: 'OrdersBilled', payload: { order_ids, bill_id: `BILL_${order_ids[0]}` } }]);
}

function cancelOrder(order_id: string): void {
  append(hub, [{ stream_type: 'order', stream_id: order_id, event_type: 'OrderCancelled', payload: { order_id } }]);
}

function counted<T>(fn: () => T): { value: T; statements: number } {
  const counter = statementCounter(hub.deps.db);
  const value = fn();
  return { value, statements: counter.count };
}

/** 05's guard alone (04's void guard runs before it in the close: +1 statement there). */
const guardNow = () => counted(() => billingDayCloseGuard(hub.deps.db, state()));

// ------------------------------------------------------------------------------------------------ guard

describe('[05 §6.25 guard] day close refused while shifts are open, a sign-off is pending or orders are unbilled', () => {
  it('[05 #62] void pending (04) first, then open shift, then pending variance sign-off, then unbilled orders — each with its list and count', async () => {
    const { manager, cashier } = await start();
    openSeating(hub, { table_id: VX.tables.T12, seating_id: 'SEAT_T12' });
    const { order_id: dine } = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT_T12', lines: [{ order_item_id: 'D_N', item_id: FX.naan }] });
    const { alert_id: void_id } = raiseVoid(hub, { requester: cashier, order_id: dine, order_item_id: 'D_N', disposition: 'wastage' });
    const { shift_id: short, alert_id: variance_id, closed_at } = await shortShift(cashier);
    const managerShift = await openShift(manager);

    const r1 = await closeDay(manager);
    expect(r1.status).toBe(409);
    expect(r1.error).toMatchObject({ code: 'DAY_CLOSE_BLOCKED', details: { reason: 'void_pending', count: 1 } });

    expect((await answer(hub, cashier, void_id, 'withdraw')).status).toBe(200);
    const r2 = await closeDay(manager);
    expect(r2.status).toBe(409);
    const opened_at = (hub.deps.db.prepare('SELECT opened_at FROM shifts WHERE shift_id = ?').pluck().get(managerShift) as number);
    expect(r2.error).toEqual({
      code: 'DAY_CLOSE_BLOCKED',
      details: { reason: 'shift_open', shifts: [{ shift_id: managerShift, staff_name: 'Manager', opened_at, is_drawer: false }], count: 1 },
    });

    expect((await post(hub, manager, 'count-shift', 'CountShift', { shift_id: managerShift, counted_minor: FLOAT })).status).toBe(200);
    const r3 = await closeDay(manager);
    expect(r3.status).toBe(409);
    expect(r3.error).toEqual({
      code: 'DAY_CLOSE_BLOCKED',
      details: { reason: 'variance_pending', shifts: [{ shift_id: short, staff_name: 'Cashier', closed_at, alert_id: variance_id }], count: 1 },
    });

    expect((await answer(hub, manager, variance_id, 'approve')).status).toBe(200);
    const r4 = await closeDay(manager);
    expect(r4.status).toBe(409);
    const placed_at = hub.deps.db.prepare('SELECT placed_at FROM orders WHERE order_id = ?').pluck().get(dine) as number;
    const open_minutes = Math.floor((hub.clock.branchNow() - placed_at) / 60_000);
    expect(r4.error).toEqual({
      code: 'DAY_CLOSE_BLOCKED',
      details: { reason: 'unbilled_orders', orders: [{ order_id: dine, identifier: 'T12', total_minor: NAAN, placed_at, open_minutes }], count: 1 },
    });
    expect(state().business_day?.closed_at).toBeNull();
    // a refusal writes nothing: no processed_commands row, so the same command_id may run again once unblocked
    billOrders([dine]);
    const ok = await closeDay(manager);
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    expect(ok.result).toMatchObject({ changed: true, reason: 'closed' });
  });

  it('[05 #62] 41 unbilled orders → 40 listed oldest first, count 41; billed and cancelled ones never listed; ≤ 3 statements (1 per reason asked)', async () => {
    await start();
    const ids: string[] = [];
    for (let i = 0; i < 43; i += 1) ids.push(takeawayOrder(hub, { prefix: `TW${i}` }).order_id);
    billOrders([ids[0]!]);
    cancelOrder(ids[1]!);
    const g = guardNow();
    expect(g.statements).toBe(3);
    const d = g.value!.details as { reason: string; orders: Array<{ order_id: string; identifier: string; total_minor: number }>; count: number };
    expect(d.reason).toBe('unbilled_orders');
    expect(d.count).toBe(41);
    expect(d.orders.map((o) => o.order_id)).toEqual(ids.slice(2, 42));
    const token = hub.deps.db.prepare('SELECT token FROM orders WHERE order_id = ?').pluck().get(ids[2]) as number;
    expect(d.orders[0]).toMatchObject({ identifier: `#${token}`, total_minor: NAAN });
  });

  it('[05 #62] statements: an open shift answers with 1, a pending sign-off with 2; nothing to block → 3 and null', async () => {
    const { cashier, manager } = await start();
    expect(guardNow()).toEqual({ value: null, statements: 3 });
    const { alert_id } = await shortShift(cashier);
    const pending = guardNow();
    expect(pending.statements).toBe(2);
    expect(pending.value!.details).toMatchObject({ reason: 'variance_pending', count: 1 });
    await openShift(manager);
    const open = guardNow();
    expect(open.statements).toBe(1);
    expect(open.value!.details).toMatchObject({ reason: 'shift_open', count: 1 });
    expect(alert_id).toBeTruthy();
  });

  it('[05 #62b] a pending variance (shift CLOSED, no open shift) refuses with the sign-off list; with an open shift too → shift_open first; reject → the close succeeds', async () => {
    const { cashier, manager } = await start();
    const { shift_id, alert_id, closed_at } = await shortShift(cashier);
    const other = await openShift(manager);
    expect((await closeDay(manager)).error!.details.reason).toBe('shift_open');
    expect((await post(hub, manager, 'count-shift', 'CountShift', { shift_id: other, counted_minor: FLOAT })).status).toBe(200);
    const blocked = await closeDay(manager);
    expect(blocked.status).toBe(409);
    expect(blocked.error).toEqual({
      code: 'DAY_CLOSE_BLOCKED',
      details: { reason: 'variance_pending', shifts: [{ shift_id, staff_name: 'Cashier', closed_at, alert_id }], count: 1 },
    });
    expect((await answer(hub, manager, alert_id, 'reject')).status).toBe(200);
    const closed = await closeDay(manager);
    expect(closed.status, JSON.stringify(closed.error)).toBe(200);
    const day = state().business_day!.business_date;
    expect(hub.deps.db.prepare('SELECT outcome, business_date FROM shift_signoffs WHERE shift_id = ?').get(shift_id)).toEqual({ outcome: 'disputed', business_date: day });
  });
});

// ------------------------------------------------------------------------------------------------ CarryOverOrders

describe('[05 §6.24] CarryOverOrders', () => {
  it('[05 #63] carry an unbilled order → OrdersCarriedOver (hub stream), carried_orders row, note in bill_texts only; the close succeeds and the order stays open; 2 statements; replay', async () => {
    const { manager } = await start();
    const { order_id } = takeawayOrder(hub, { prefix: 'C1' });
    const day = state().business_day!.business_date;
    const note = noteSecret('table 4 pays tomorrow morning');
    const counter = statementCounter(hub.deps.db);
    const r = await carry(manager, { order_ids: [order_id], reason_code: 'customer_will_pay_later', note }, 'carry-1');
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(counter.count).toBeGreaterThan(0);
    expect(r.result).toEqual({ business_date: day, order_ids: [order_id] });
    expect(r.events).toHaveLength(1);
    const e = r.events[0]!;
    expect(e).toMatchObject({ event_type: 'OrdersCarriedOver', stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, actor_id: STAFF.manager });
    expect(e.payload).toEqual({ order_ids: [order_id], business_date: day, reason_code: 'customer_will_pay_later', has_note: true, note_id: expect.any(String) });
    expect(hub.deps.db.prepare(`SELECT text FROM bill_texts WHERE subject_id = ? AND field = 'note'`).pluck().get(e.payload.note_id)).toBe(note);
    expect(hub.deps.db.prepare('SELECT order_id, business_date, reason_code FROM carried_orders').all()).toEqual([{ order_id, business_date: day, reason_code: 'customer_will_pay_later' }]);

    // replay: the stored answer, no second event or text
    const again = await carry(manager, { order_ids: [order_id], reason_code: 'customer_will_pay_later', note }, 'carry-1');
    expect(again.status).toBe(200);
    expect(again.result).toEqual(r.result);
    expect((hub.deps.db.prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'OrdersCarriedOver'`).pluck().get() as number)).toBe(1);
    expect((hub.deps.db.prepare('SELECT COUNT(*) FROM bill_texts').pluck().get() as number)).toBe(1);

    expect(guardNow().value).toBeNull();
    const closed = await closeDay(manager);
    expect(closed.status, JSON.stringify(closed.error)).toBe(200);
    expect(hub.deps.db.prepare('SELECT day_closed_at, carried_over FROM orders WHERE order_id = ?').get(order_id)).toEqual({ day_closed_at: null, carried_over: 0 });
  });

  it('[05 §6.24] handler statements: 1 without a note, 2 with one, whatever the number of orders', async () => {
    const { manager } = await start();
    const ids = [0, 1, 2].map((i) => takeawayOrder(hub, { prefix: `S${i}` }).order_id);
    const handled = measure('carry-over-orders');
    expect((await carry(manager, { order_ids: ids, reason_code: 'table_still_seated' })).status).toBe(200);
    expect(handled()).toBe(1);
    expect((await carry(manager, { order_ids: [ids[0]!], reason_code: 'other', note: noteSecret('see manager') })).status).toBe(200);
    expect(handled()).toBe(2);
  });

  it('[05 §6.24] refusals in order: 400 Zod (empty, 41, repeated id, unknown reason, extra field), 403 without close-business-day, 409 BUSINESS_DAY_NOT_OPEN, 400 per index (unknown, cancelled), 409 ORDER_BILLED', async () => {
    const { manager, waiter } = await start();
    const a = takeawayOrder(hub, { prefix: 'A' }).order_id;
    const b = takeawayOrder(hub, { prefix: 'B' }).order_id;
    const c = takeawayOrder(hub, { prefix: 'C' }).order_id;
    const ok = { reason_code: 'other' };
    const bad = async (payload: Record<string, unknown>, who = manager) => (await carry(who, payload)).status;
    expect(await bad({ ...ok, order_ids: [] })).toBe(400);
    expect(await bad({ ...ok, order_ids: Array.from({ length: 41 }, (_, i) => `O${i}`) })).toBe(400);
    const repeated = await carry(manager, { ...ok, order_ids: [a, b, a] });
    expect(repeated.status).toBe(400);
    expect(JSON.stringify(repeated.error)).toContain('order_ids.2');
    expect(await bad({ order_ids: [a], reason_code: 'because' })).toBe(400);
    expect(await bad({ ...ok, order_ids: [a], extra: 1 })).toBe(400);
    const denied = await carry(waiter, { ...ok, order_ids: [a] });
    expect(denied.status).toBe(403);
    expect(denied.error).toMatchObject({ code: 'PERMISSION_DENIED' });

    cancelOrder(b);
    billOrders([c]);
    const unknown = await carry(manager, { ...ok, order_ids: [a, 'NO_SUCH'] });
    expect(unknown).toMatchObject({ status: 400, error: { code: 'VALIDATION_FAILED', details: { issues: [{ path: 'order_ids.1' }] } } });
    const cancelled = await carry(manager, { ...ok, order_ids: [a, b, c] });
    expect(cancelled).toMatchObject({ status: 400, error: { code: 'VALIDATION_FAILED', details: { issues: [{ path: 'order_ids.1' }] } } });
    const billed = await carry(manager, { ...ok, order_ids: [a, c] });
    expect(billed).toMatchObject({ status: 409, error: { code: 'ORDER_BILLED', details: { order_id: c } } });
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM carried_orders').pluck().get()).toBe(0);

    billOrders([a]);
    expect((await closeDay(manager)).status).toBe(200);
    const closed = await carry(manager, { ...ok, order_ids: [a] });
    expect(closed).toMatchObject({ status: 409, error: { code: 'BUSINESS_DAY_NOT_OPEN' } });
  });

  it('[05 §6.24, F-7 owner ruling 2026-11-20] device route only: /admin/commands/carry-over-orders → 404 ROUTE_NOT_FOUND; nothing written', async () => {
    const { owner } = await start();
    const { order_id } = takeawayOrder(hub, { prefix: 'AD' });
    const admin = openSession(hub, { kind: 'admin', staffId: owner.staffId, deviceId: owner.deviceId });
    seats.push({ ...owner, sessionId: admin.sessionId, sessionToken: admin.token });
    const provisioned = hub.deps.config.provisioned!;
    const res = await hub.app.inject({
      method: 'POST',
      url: '/admin/commands/carry-over-orders',
      headers: { authorization: `Bearer ${owner.token}`, 'x-admin-session': admin.token },
      payload: {
        command_id: 'carry-admin-1',
        tenant_id: provisioned.tenant_id,
        branch_id: provisioned.branch_id,
        command_type: 'CarryOverOrders',
        payload: { order_ids: [order_id], reason_code: 'other' },
        occurred_at: hub.clock.branchNow(),
        actor_id: owner.staffId,
        device_id: owner.deviceId,
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ROUTE_NOT_FOUND');
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM carried_orders').pluck().get()).toBe(0);
    expect(hub.deps.db.prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'OrdersCarriedOver'`).pluck().get()).toBe(0);
  });

  it('[05 #63c] carry the same order on day 1 and day 2 → two carried_orders rows, no key error, each close succeeds; a carried order blocks the next day unless carried again; rebuild equal', async () => {
    let { manager } = await start();
    const { order_id } = takeawayOrder(hub, { prefix: 'K' });
    const day1 = state().business_day!.business_date;
    expect((await carry(manager, { order_ids: [order_id], reason_code: 'customer_will_pay_later' })).status).toBe(200);
    expect((await carry(manager, { order_ids: [order_id], reason_code: 'customer_will_pay_later' })).status).toBe(200); // twice in a day: one row
    expect((await closeDay(manager)).status).toBe(200);

    hub.clock.advance(86_400_000);
    openVoidsDay(hub);
    noGap();
    manager = signIn(hub, STAFF.manager);
    seats.push(manager);
    const day2 = state().business_day!.business_date;
    expect(day2).not.toBe(day1);
    expect((await closeDay(manager)).error).toMatchObject({ code: 'DAY_CLOSE_BLOCKED', details: { reason: 'unbilled_orders', orders: [{ order_id }], count: 1 } });
    expect((await carry(manager, { order_ids: [order_id], reason_code: 'other' })).status).toBe(200);
    expect((await closeDay(manager)).status).toBe(200);

    const rows = () => hub.deps.db.prepare('SELECT order_id, business_date, reason_code FROM carried_orders ORDER BY business_date').all();
    expect(rows()).toEqual([
      { order_id, business_date: day1, reason_code: 'customer_will_pay_later' },
      { order_id, business_date: day2, reason_code: 'other' },
    ]);
    const before = rows();
    hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'billing'`).run();
    const registry = createProjectionRegistry();
    registry.register(billingProjection());
    registry.catchUp(hub.deps.db, hub.deps.config.provisioned!.branch_id);
    expect(rows()).toEqual(before);
  });
});

// ------------------------------------------------------------------------------------------------ appender

/** A request raised through 01d's real raise by `who` (no command): the open requests the appender must close. */
function raiseAs(who: Who, input: RaiseInput): string {
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
    const r = alerts.raise(ctx, input);
    tx.append(r.events);
    return r.alert_id;
  }).result;
}

const display = (kind: string) => ({ kind_label_key: `alert.${kind}.lock` });

/** Six open 05 requests (every kind but shift_variance) and one 02b comp request, all by the cashier. */
function openRequests(cashier: Who): { ids05: string[]; comp: string } {
  const r = (kind: string, rest: Pick<RaiseInput, 'subject' | 'values' | 'details' | 'dedupe_key'>, approver = true) =>
    raiseAs(cashier, { kind, target: { kind: 'answerers' }, display: display(kind), requester_staff_id: cashier.staffId, request: approver ? { approver_role_ids: ['R_MGR'] } : {}, ...rest });
  const ids05 = [
    r('discount', { subject: { stream_type: 'bill', stream_id: 'B1' }, values: { bill_id: 'B1', kind: 'percent', value: 1_000, reason_code: 'regular_customer', note_id: null, has_note: false }, details: { amount: 50_000, reason: 'regular_customer' }, dedupe_key: 'discount:B1' }),
    r('remove_service_charge', { subject: { stream_type: 'bill', stream_id: 'B1' }, values: { bill_id: 'B1', reason_code: 'customer_request', note_id: null, has_note: false }, details: { amount: 20_000 }, dedupe_key: 'remove_sc:B1' }),
    r('reopen_bill', { subject: { stream_type: 'bill', stream_id: 'B2' }, values: { bill_id: 'B2', invoice_ids: ['I1'], credit_invoice_ids: ['C1'], reason_code: 'wrong_payment_mode', note_id: null, has_note: false }, details: { amount: 300_000 }, dedupe_key: 'reopen:B2' }),
    r('remove_comp', { subject: { stream_type: 'order', stream_id: 'O1' }, values: { order_id: 'O1', order_item_id: 'L1', units: 1, reason_code: 'comped_by_mistake', note_id: null, has_note: false }, details: { amount: 3_000 }, dedupe_key: 'remove_comp:L1' }),
    r('close_without_buyer_id', { subject: { stream_type: 'bill', stream_id: 'B3' }, values: { bill_id: 'B3', note_id: null, has_note: false }, details: { amount: 6_000_000 }, dedupe_key: 'buyer_waiver:B3' }),
    r('petty_cash', { subject: { stream_type: 'shift', stream_id: 'SH1' }, values: { entry_id: 'E1', kind: 'out', shift_id: 'SH1', amount_minor: 600_000, category_id: 'supplies', has_paid_to: false, advance_staff_id: null, has_note: false }, details: { amount: 600_000 }, dedupe_key: 'petty:CMD1' }, false),
  ];
  const comp = r('comp', { subject: { stream_type: 'order', stream_id: 'O2' }, values: { order_id: 'O2', order_item_id: 'L2', units: 1, reason_code: 'regular_customer', note: null }, details: { amount: 3_000 }, dedupe_key: 'comp:L2' });
  return { ids05, comp };
}

const eventsOf = (type: string) =>
  (hub.deps.db.prepare('SELECT seq, payload FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<{ seq: number; payload: string }>).map((r) => ({
    seq: r.seq,
    payload: JSON.parse(r.payload) as Record<string, unknown>,
  }));
const openAlerts = () => hub.deps.db.prepare(`SELECT kind FROM alerts WHERE state = 'open' AND request_json IS NOT NULL ORDER BY kind`).pluck().all();

describe('[05 §6.25 appender] the close closes open requests obsolete and writes ZReportIssued', () => {
  it('[05 #64] open 05 requests and 02b comp requests → AlertClosed { obsolete, day_closed }; the requesters get request_result; nothing open after', async () => {
    const { manager, cashier } = await start();
    const { ids05, comp } = openRequests(cashier);
    expect(openAlerts()).toHaveLength(7);
    const closed = await closeDay(manager);
    expect(closed.status, JSON.stringify(closed.error)).toBe(200);
    const closes = closed.events.filter((e) => e.event_type === 'AlertClosed').map((e) => e.payload);
    expect(closes.map((p) => p['alert_id']).sort()).toEqual([...ids05, comp].sort());
    for (const p of closes) expect(p).toMatchObject({ reason: 'obsolete', note: 'day_closed', by_staff_id: STAFF.manager });
    expect(openAlerts()).toEqual([]);
    const results = closed.events.filter((e) => e.event_type === 'AlertRaised' && e.payload['kind'] === 'request_result');
    expect(results).toHaveLength(7);
  });

  it('[05 #65, #63] event order in the close commit: AlertClosed… → ZReportIssued → StockReleased… → BusinessDayClosed; z_no 1 then 2; z_reports row = the event; carried orders carried out, then in', async () => {
    const { manager, cashier } = await start();
    openRequests(cashier);
    const { order_id } = takeawayOrder(hub, { prefix: 'Z1' });
    const token = hub.deps.db.prepare('SELECT token FROM orders WHERE order_id = ?').pluck().get(order_id) as number;
    expect((await carry(manager, { order_ids: [order_id], reason_code: 'customer_will_pay_later' })).status).toBe(200);
    const day1 = state().business_day!.business_date;
    const closed = await closeDay(manager);
    expect(closed.status, JSON.stringify(closed.error)).toBe(200);
    const types = closed.events.map((e) => e.event_type);
    const z = types.indexOf('ZReportIssued');
    expect(z).toBeGreaterThan(0);
    expect(types.slice(0, z), JSON.stringify(types)).toEqual(expect.arrayContaining(['AlertClosed']));
    // 01d's closeMany: each AlertClosed with its request_result (AlertRaised + AttemptSent)
    expect(types.slice(0, z).every((t) => ['AlertClosed', 'AlertRaised', 'AttemptSent'].includes(t)), JSON.stringify(types)).toBe(true);
    expect(types[0]).toBe('AlertClosed');
    expect(types.at(-1)).toBe('BusinessDayClosed');
    expect(types.slice(z + 1, -1).every((t) => t === 'StockReleased')).toBe(true);
    const issued = closed.events[z]!;
    expect(issued).toMatchObject({ stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id });
    expect(issued.payload).toMatchObject({ business_date: day1, z_no: 1, report: { kind: 'z', z_no: 1, business_date: day1, carried_over: [{ label: `#${token}`, carried_in: false }] } });
    const row = hub.deps.db.prepare('SELECT business_date, z_no, report_json FROM z_reports').get() as { business_date: string; z_no: number; report_json: string };
    expect(row).toMatchObject({ business_date: day1, z_no: 1 });
    expect(JSON.parse(row.report_json)).toEqual(issued.payload['report']);
    // H16-5: staff ids only, never a name
    for (const name of ['Manager', 'Cashier', 'Owner', 'Order taker']) expect(JSON.stringify(issued.payload)).not.toContain(`"${name}"`);

    hub.clock.advance(86_400_000);
    openVoidsDay(hub);
    noGap();
    const m2 = signIn(hub, STAFF.manager);
    seats.push(m2);
    billOrders([order_id]);
    const second = await closeDay(m2);
    expect(second.status, JSON.stringify(second.error)).toBe(200);
    const z2 = eventsOf('ZReportIssued').at(-1)!.payload;
    expect(z2).toMatchObject({ z_no: 2, report: { z_no: 2, carried_over: [{ carried_in: true }] } });
  });

  it('[05 #62b] reject the pending sign-off → the Z lists it under variance sign-offs with business_date = the closing day and no pending sign-off; the appender closes no shift_variance request', async () => {
    const { cashier, manager } = await start();
    const { shift_id, alert_id } = await shortShift(cashier);
    expect((await answer(hub, manager, alert_id, 'reject')).status).toBe(200);
    const closed = await closeDay(manager);
    expect(closed.status, JSON.stringify(closed.error)).toBe(200);
    expect(closed.events.filter((e) => e.event_type === 'AlertClosed')).toEqual([]);
    const report = closed.events.find((e) => e.event_type === 'ZReportIssued')!.payload['report'] as Record<string, unknown>;
    const day = state().business_day!.business_date;
    expect(report['pending_signoffs']).toEqual([]);
    expect(report['variance_signoffs']).toEqual([expect.objectContaining({ shift_date: day, staff_id: STAFF.cashier, amount_minor: SHORT - FLOAT, outcome: 'disputed', approver_staff_id: STAFF.manager })]);
    expect(report['shifts']).toEqual([expect.objectContaining({ staff_id: STAFF.cashier, float_minor: FLOAT, counted_minor: SHORT, variance_minor: SHORT - FLOAT, signoff_state: 'disputed' })]);
    expect(shift_id).toBeTruthy();
  });

  it('[05 #63] forced COMMIT failure → no ZReportIssued, no z_reports row, no AlertClosed, no print job; the retry closes with z_no 1', async () => {
    let fail = false;
    const { manager, cashier } = await start({
      beforeCommit() {
        if (fail) throw new Error('forced commit failure');
      },
    });
    openRequests(cashier);
    const jobs = () => hub.deps.db.prepare('SELECT COUNT(*) FROM print_jobs').pluck().get();
    const jobsBefore = jobs();
    fail = true;
    const failed = await closeDay(manager, 'close-fail');
    expect(failed.status).toBe(500);
    expect(eventsOf('ZReportIssued')).toEqual([]);
    expect(eventsOf('AlertClosed')).toEqual([]);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM z_reports').pluck().get()).toBe(0);
    expect(jobs()).toBe(jobsBefore);
    expect(state().business_day!.closed_at).toBeNull();
    expect(openAlerts()).toHaveLength(7);
    fail = false;
    const ok = await closeDay(manager, 'close-fail');
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    expect(eventsOf('ZReportIssued').map((e) => e.payload['z_no'])).toEqual([1]);
    // replay: the stored answer, no second Z
    expect((await closeDay(manager, 'close-fail')).status).toBe(200);
    expect(eventsOf('ZReportIssued')).toHaveLength(1);
  });

  it('[05 §6.25 bound] 05 adds ≤ 11 statements to the close (guard 3 + appender 8), whatever the number of requests, orders or invoices; 01d closeMany excluded', async () => {
    const { cashier } = await start();
    const measureAppender = () => {
      const day = state().business_day!;
      return hub.deps.writer.run((tx) => {
        const ctx = {
          tx,
          state: tx.state,
          clock: tx.clock,
          ids: tx.ids,
          actor: { kind: 'staff', staffId: STAFF.manager, stationId: null, sessionId: 'x', deviceId: 'D_FIXTURE' },
          branch: { tenantId: 'tenant-a', branchId: 'branch-1' },
        } as unknown as CommandCtx;
        const counter = statementCounter(tx.db);
        const real = alerts.closeMany;
        let inside = 0;
        alerts.closeMany = ((c, items) => {
          const before = counter.count;
          try {
            return real(c, items);
          } finally {
            inside += counter.count - before;
          }
        }) as typeof alerts.closeMany;
        try {
          billingDayCloseAppender(ctx);
        } finally {
          alerts.closeMany = real;
        }
        void day;
        throw Object.assign(new Error('rollback'), { n: counter.count - inside });
      });
    };
    const n = (): number => {
      try {
        measureAppender();
      } catch (e) {
        return (e as { n: number }).n;
      }
      throw new Error('no rollback');
    };
    expect(n()).toBe(8);
    openRequests(cashier);
    for (let i = 0; i < 5; i += 1) {
      const { order_id } = takeawayOrder(hub, { prefix: `B${i}` });
      billOrders([order_id]);
    }
    expect(n()).toBe(8);
    expect(guardNow().statements + 8).toBeLessThanOrEqual(11);
  });
});

describe('[05 v1.0.24 R-85, v1.0.23 R-84] same-date Z, no branch config, missing credit', () => {
  it('[05 #63d, R-85, 01a #68 case] close, reopen on the same date, close again → two Zs on one business_date, z_no 1 and 2, both closes 200; each Z counts only its own session; Z2 brings forward Z1\'s carried forward (previous z_no)', async () => {
    const { manager, cashier } = await start();
    const SALE_TOTAL = 695_500; // Rs 6,955: the builder's sale invoice
    const PART = 1_000; // Rs 10 paid on a carried takeaway (naan Rs 30): carried forward
    const PETTY = 50_000; // Rs 500 supplies out
    const sale = (n: number) => {
      const issued = anInvoiceIssued();
      const pl = issued.payload as Record<string, unknown>;
      append(hub, [{ stream_type: 'bill', stream_id: `B_S${n}`, event_type: issued.event_type, payload: { ...pl, bill_id: `B_S${n}`, invoice_id: `S${n}`, number: n, invoice_ref: `AC1-S00000${n}`, business_date: state().business_day!.business_date } }]);
    };
    const day1 = state().business_day!.business_date;

    // session 1: a sale; the cashier's shift with a part payment and a petty out (counted exact, closed);
    // a second shift counted Rs 1,000 short and approved (a variance sign-off); the part-paid order carried
    sale(1);
    const shift1 = await openShift(cashier);
    const { order_id } = takeawayOrder(hub, { prefix: 'CF' });
    const paid = await post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref: { order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: PART });
    expect(paid.status, JSON.stringify(paid.error)).toBe(200);
    const petty = await post(hub, cashier, 'record-petty-cash', 'RecordPettyCash', { kind: 'out', amount_minor: PETTY, category_id: 'supplies' });
    expect(petty.status, JSON.stringify(petty.error)).toBe(200);
    expect(petty.result!['pending']).toBeUndefined();
    const counted1 = await post(hub, cashier, 'count-shift', 'CountShift', { shift_id: shift1, counted_minor: FLOAT + PART - PETTY });
    expect(counted1.status, JSON.stringify(counted1.error)).toBe(200);
    const waiter = signIn(hub, STAFF.orderTaker);
    seats.push(waiter);
    const { alert_id } = await shortShift(waiter);
    expect((await answer(hub, manager, alert_id, 'approve')).status).toBe(200);
    expect((await carry(manager, { order_ids: [order_id], reason_code: 'customer_will_pay_later' })).status).toBe(200);
    const first = await closeDay(manager);
    expect(first.status, JSON.stringify(first.error)).toBe(200);

    // session 2, same date: one sale only
    hub.clock.advance(60_000); // same calendar date
    openVoidsDay(hub);
    noGap();
    expect(state().business_day!.business_date).toBe(day1);
    sale(2);
    const again = await closeDay(manager);
    expect(again.status, JSON.stringify(again.error)).toBe(200);

    expect(hub.deps.db.prepare('SELECT z_no, business_date FROM z_reports ORDER BY z_no').all()).toEqual([
      { z_no: 1, business_date: day1 },
      { z_no: 2, business_date: day1 },
    ]);
    type Z = { z_no: number; report: Record<string, unknown> & { sales: { invoice_count: number; total_minor: number } } };
    const [z1, z2] = eventsOf('ZReportIssued').map((e) => e.payload as unknown as Z);
    expect([z1!.z_no, z2!.z_no]).toEqual([1, 2]);
    expect(z1!.report.sales).toMatchObject({ invoice_count: 1, total_minor: SALE_TOTAL });
    expect(z2!.report.sales).toMatchObject({ invoice_count: 1, total_minor: SALE_TOTAL });

    // session 1's shifts, takings, petty and sign-off are Z1's only
    expect((z1!.report['shifts'] as unknown[]).length).toBe(2);
    expect(z1!.report['payments_by_mode']).toEqual([expect.objectContaining({ in_minor: PART })]);
    expect(z1!.report['petty_cash']).toEqual([{ category_name: 'Supplies', kind: 'out', amount_minor: PETTY }]);
    expect(z1!.report['variance_signoffs']).toEqual([expect.objectContaining({ staff_id: STAFF.orderTaker, outcome: 'approved' })]);
    expect(z2!.report['shifts']).toEqual([]);
    expect(z2!.report['payments_by_mode']).toEqual([]);
    expect(z2!.report['takings_by_taker']).toEqual([]);
    expect(z2!.report['petty_cash']).toEqual([]);
    expect(z2!.report['variance_signoffs']).toEqual([]);

    // brought forward of Z2 = carried forward of Z1 (the previous z_no, same date)
    expect(z1!.report['carried_forward']).toEqual([{ mode_name: 'Cash', staff_id: STAFF.cashier, amount_minor: PART }]);
    expect(z2!.report['brought_forward']).toEqual(z1!.report['carried_forward']);
  });

  it('[05 R-85] no branch config → the close succeeds with no ZReportIssued; a warning with ids only (code, business_date); open requests still closed obsolete', async () => {
    const { manager, cashier } = await start();
    openRequests(cashier);
    const day = state().business_day!.business_date;
    swapBranchConfig(null);
    hub.clock.advance(5 * 3_600_000); // no config → the built-in 4 h gap (01a), so wait it out
    const m2 = signIn(hub, STAFF.manager);
    seats.push(m2);
    void manager;
    const closed = await closeDay(m2);
    expect(closed.status, JSON.stringify(closed.error)).toBe(200);
    expect(closed.events.map((e) => e.event_type)).not.toContain('ZReportIssued');
    expect(closed.events.filter((e) => e.event_type === 'AlertClosed'), JSON.stringify(closed.events.map((e) => e.event_type))).toHaveLength(7);
    expect(closed.events.at(-1)!.event_type).toBe('BusinessDayClosed');
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM z_reports').pluck().get()).toBe(0);
    const line = hub.logs().split('\n').find((l) => l.includes('z_skipped_no_config'));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ code: 'z_skipped_no_config', business_date: day });
  });

  it('[05 R-84 (2)] a reopen of the day whose credit invoice is not among the day\'s invoices → the close succeeds, the reopen is left out of the Z, and the warning logs ids only (code, reopen_id, credit_invoice_id)', async () => {
    const { manager } = await start();
    const reopened = aBillReopened();
    const credited = anInvoiceCredited();
    const bill_id = 'B_MISSING';
    const [r] = append(hub, [{ stream_type: 'bill', stream_id: bill_id, event_type: reopened.event_type, payload: { ...(reopened.payload as Record<string, unknown>), bill_id } }]);
    // the credit (and its original) carry another business_date, so the day's invoices do not hold it
    const issued = anInvoiceIssued();
    append(hub, [{ stream_type: 'bill', stream_id: bill_id, event_type: issued.event_type, payload: { ...(issued.payload as Record<string, unknown>), bill_id, invoice_id: 'S_OLD', business_date: '2000-01-01' } }]);
    append(hub, [{ stream_type: 'bill', stream_id: bill_id, event_type: credited.event_type, payload: { ...(credited.payload as Record<string, unknown>), bill_id, invoice_id: 'C_MISSING', ref_invoice_id: 'S_OLD', business_date: '2000-01-01' } }]);
    const closed = await closeDay(manager);
    expect(closed.status, JSON.stringify(closed.error)).toBe(200);
    const report = closed.events.find((e) => e.event_type === 'ZReportIssued')!.payload['report'] as { reopens: { count: number; value_minor: number } };
    expect(report.reopens).toMatchObject({ count: 0, value_minor: 0 });
    const line = hub.logs().split('\n').find((l) => l.includes('reopen_credit_missing'));
    expect(line).toBeDefined();
    const logged = JSON.parse(line!) as Record<string, unknown>;
    expect(logged).toMatchObject({ code: 'reopen_credit_missing', reopen_id: r!.event_id, credit_invoice_id: 'C_MISSING' });
    expect(Object.keys(logged).filter((k) => /minor|_name|amount/.test(k))).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ helpers

/** The named command's handler statements of its last call (the envelope and the append excluded). */
function measure(path: string): () => number | undefined {
  const def = commandRegistry(hub.app).byPath(path) as { handle: (...a: unknown[]) => unknown } | undefined;
  let last: number | undefined;
  if (def !== undefined) {
    const original = def.handle;
    const counter = statementCounter(hub.deps.db);
    def.handle = (...a: unknown[]) => {
      counter.reset();
      try {
        return original.apply(def, a);
      } finally {
        last = counter.count;
      }
    };
  }
  return () => last;
}
