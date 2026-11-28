import { isOrderInEngine, type EngineState } from '@pos/engine';
import type { EventDraft } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StaffDirectory } from '../../src/auth/staff-directory';
import { ordersCatchUpPart } from '../../src/orders/catch-up';
import { openOrdersBody, type OpenOrder } from '../../src/orders/queries/open-orders';
import { customerReadyAt } from '../../src/print/render/ready-at';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import type { SocketCtx } from '../../src/ws/catch-up';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { appendOrder, FX, openDay, openSeating } from './fixtures';

// ⚠️ 02b v1.0.25 §6.16 row `planned_ready_at_ms` (owner ruling BR-1, 2026-11-27) and §6.18 (catch-up part `orders`);
// 03a v1.2.11 PK-5 (the stored promise never changes). The engine's whole-order planned ready time of an open takeaway /
// parking order: the latest customer time (customerReadyAt(...).ready_at: the planned land plus the engine's padding,
// owner 2026-11-27, as receipts and slips) of its lines not yet ready (stage added / cooking, held lines included), from the in-memory engine state (0 extra statements); null when
// every live line is ready, when the order is not in the engine, or when a not-ready line has no land yet. Dine-in rows
// carry null (the ruling names takeaway / parking). Orders are seeded with real events through the hub writer.

const MGR = 'S_MGR'; // aDirectory's manager: every permission at branch
const MIN = 60_000;

let hub: TestHub;

beforeEach(async () => {
  hub = await createTestHub();
  await seedDirectory(hub, await aDirectory());
  openDay(hub);
});

afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

const engine = (): EngineState => hub.deps.state.get() as EngineState;

function draft(stream_type: EventDraft['stream_type'], stream_id: string, event_type: string, payload: Record<string, unknown>, actor = 'S_WAIT'): EventDraft {
  return { stream_type, stream_id, event_type, schema_version: 1, payload, occurred_at: hub.clock.branchNow(), actor_id: actor, device_id: 'D_SEED' };
}
function append(...drafts: EventDraft[]): void {
  hub.clock.advance(1_000);
  hub.deps.writer.run((tx) => tx.append(drafts));
}
const fire = (...order_item_ids: string[]) =>
  append(draft('station', FX.station, 'FireDispatched', { station_id: FX.station, order_item_ids, load_id: null, due_at: hub.clock.branchNow(), reason: 'pulled' }));
const start = (order_id: string, order_item_id: string) => append(draft('order', order_id, 'ItemStarted', { order_item_id, started_at: hub.clock.branchNow(), source: 'tap' }));
const done = (order_id: string, order_item_id: string) => append(draft('order', order_id, 'ItemDone', { order_item_id, done_at: hub.clock.branchNow(), source: 'tap' }));
const boost = (order_id: string) => append(draft('order', order_id, 'OrderBoosted', { order_id }));
const closeDay = () => append(draft('hub', 'branch-1', 'BusinessDayClosed', {}, MGR));

function signIn(staffId = MGR) {
  const device = pairDevice(hub, { type: 'cashier_kiosk' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { token: device.token, sessionToken: session.token };
}
type Who = ReturnType<typeof signIn>;

async function openOrders(who: Who = signIn(), path = 'open-orders'): Promise<OpenOrder[]> {
  const res = await hub.app.inject({ method: 'GET', url: `/queries/${path}`, headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
  expect(res.statusCode, path).toBe(200);
  return (res.json() as { data: { orders: OpenOrder[] } }).data.orders;
}
const rowOf = (rows: OpenOrder[], id: string): OpenOrder => {
  const r = rows.find((o) => o.order_id === id);
  if (r === undefined) throw new Error(`no row ${id}`);
  return r;
};

function socketCtx(o: Partial<SocketCtx> = {}): SocketCtx {
  return { deviceId: 'D1', deviceType: 'tablet', sessionId: 'X1', kind: 'staff', staffId: MGR, stationId: null, asOfSeq: 0, ...o };
}
type Caught = { orders: Array<{ order_id: string; planned_ready_at_ms: number | null }> };
const catchUp = (state: EngineState = engine()): Caught => ordersCatchUpPart(hub.clock).build(hub.deps.db, state, socketCtx()) as Caught;
const caughtOf = (c: Caught, id: string) => c.orders.find((o) => o.order_id === id)!;

/** The ruling's value computed apart from the code under test: max customer time of the order's added / cooking engine lines. */
function expectedPlanned(state: EngineState, order_id: string): number | null {
  const lands = state.orders[order_id]!.line_ids
    .map((id) => state.lines[id])
    .filter((l) => l !== undefined && (l.stage === 'added' || l.stage === 'cooking'))
    .map((l) => customerReadyAt(state, l!)?.ready_at ?? null);
  if (lands.length === 0 || lands.includes(null)) return null;
  return Math.max(...(lands as number[]));
}

describe('[02b §6.16 BR-1] open-orders planned_ready_at_ms', () => {
  it('a pickup takeaway: before the boost the planned customer time is the pickup = the promise (⚠️ 03a v1.2.12, owner 2026-11-28: the kitchen targets pickup − padding; held lines included); after BoostOrder it is earlier than the promise; the stored promise and pickup never change (PK-5)', async () => {
    const pickup = hub.clock.branchNow() + 60 * MIN;
    appendOrder(hub, { order_type: 'takeaway', order_id: 'TA', pickup_at_ms: pickup, lines: [{ order_item_id: 'TA1', item_id: FX.piece }, { order_item_id: 'TA2', item_id: FX.naan }] });
    const before = rowOf(await openOrders(), 'TA');
    expect(before.planned_ready_at_ms).not.toBeNull();
    expect(before.planned_ready_at_ms).toBe(expectedPlanned(engine(), 'TA'));
    // held for the pickup: the plan lands at pickup − padding; plus the padding that is the stored promise = the pickup
    expect(before.promise_ms).not.toBeNull();
    expect(before.planned_ready_at_ms).toBe(before.promise_ms);
    expect(before.planned_ready_at_ms!).toBe(pickup);

    boost('TA');
    const after = rowOf(await openOrders(), 'TA');
    expect(after.effective_pickup_at_ms).toBeNull();
    expect(after.planned_ready_at_ms).toBe(expectedPlanned(engine(), 'TA'));
    expect(after.planned_ready_at_ms!).toBeLessThan(before.planned_ready_at_ms!);
    expect(after.planned_ready_at_ms!).toBeLessThan(after.promise_ms!);
    expect(after.promise_ms).toBe(before.promise_ms); // PK-5: the stored promise never changes
    expect(after.pickup_at_ms).toBe(pickup);
  });

  it('a cooking line counts with its started land, a done line no longer counts; every live line ready → null', async () => {
    appendOrder(hub, { order_type: 'parking', order_id: 'PK', car_number: 'LEB-1', lines: [{ order_item_id: 'PK1', item_id: FX.piece }, { order_item_id: 'PK2', item_id: FX.naan }] });
    fire('PK1', 'PK2');
    start('PK', 'PK1');
    start('PK', 'PK2');
    let pk = rowOf(await openOrders(), 'PK');
    expect(pk.planned_ready_at_ms).toBe(expectedPlanned(engine(), 'PK'));
    const time2 = customerReadyAt(engine(), engine().lines.PK2!)!.ready_at;
    done('PK', 'PK1');
    pk = rowOf(await openOrders(), 'PK');
    expect(pk.planned_ready_at_ms).toBe(time2); // only the cooking naan is left
    done('PK', 'PK2');
    pk = rowOf(await openOrders(), 'PK');
    expect(pk.ready).toEqual({ n: 2, m: 2 });
    expect(pk.planned_ready_at_ms).toBeNull();
  });

  it('⚠️ 02b v1.0.29 #105 (QA-R2, BUG-12): a BOOSTED order whose every line is done keeps a time — the latest done_at — so "Ready ~" does not revert to the promise; a not-boosted ready order stays null', async () => {
    const pickup = hub.clock.branchNow() + 60 * MIN;
    appendOrder(hub, { order_type: 'takeaway', order_id: 'BD', pickup_at_ms: pickup, lines: [{ order_item_id: 'BD1', item_id: FX.naan }, { order_item_id: 'BD2', item_id: FX.naan }] });
    boost('BD');
    fire('BD1', 'BD2');
    start('BD', 'BD1');
    start('BD', 'BD2');
    done('BD', 'BD1');
    const first = engine().lines.BD1!.done_at!;
    let bd = rowOf(await openOrders(), 'BD');
    expect(bd.planned_ready_at_ms).toBe(Math.max(first, customerReadyAt(engine(), engine().lines.BD2!)!.ready_at));
    done('BD', 'BD2');
    bd = rowOf(await openOrders(), 'BD');
    expect(bd.ready).toEqual({ n: 2, m: 2 });
    expect(bd.planned_ready_at_ms).toBe(engine().lines.BD2!.done_at);
    expect(bd.planned_ready_at_ms!).toBeLessThan(bd.promise_ms!);
  });

  it('not in the engine (abandoned; the closed day) → null; dine-in rows → null', async () => {
    appendOrder(hub, { order_type: 'takeaway', order_id: 'AB', lines: [{ order_item_id: 'AB1', item_id: FX.piece }] });
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: 'DI', lines: [{ order_item_id: 'DI1', item_id: FX.piece }] });
    // in the engine, the dine-in order is still null (the ruling is for takeaway / parking)
    const caught = catchUp();
    expect(caughtOf(caught, 'AB').planned_ready_at_ms).not.toBeNull();
    expect(isOrderInEngine(engine(), 'DI', hub.clock.branchNow())).toBe(true);
    expect(caughtOf(caught, 'DI').planned_ready_at_ms).toBeNull();

    fire('AB1', 'DI1');
    hub.clock.advance(5 * 3_600_000);
    expect(isOrderInEngine(engine(), 'AB', hub.clock.branchNow())).toBe(false);
    const all = await openOrders(signIn(), 'open-orders?abandoned=true');
    expect(rowOf(all, 'AB')).toMatchObject({ abandoned: true, planned_ready_at_ms: null });
    expect(rowOf(all, 'DI')).toMatchObject({ abandoned: true, planned_ready_at_ms: null });
    expect(caughtOf(catchUp(), 'AB').planned_ready_at_ms).toBeNull();
  });

  it('a carried paid takeaway after BusinessDayClosed: null once the engine no longer holds it', async () => {
    appendOrder(hub, { order_type: 'takeaway', order_id: 'PF', lines: [{ order_item_id: 'PF1', item_id: FX.naan }] });
    append(draft('order', 'PF', 'OrdersBilled', { order_ids: ['PF'], bill_id: 'BL1' }));
    closeDay();
    const pf = rowOf(await openOrders(), 'PF');
    const inEngine = isOrderInEngine(engine(), 'PF', hub.clock.branchNow());
    expect(pf.planned_ready_at_ms).toBe(inEngine ? expectedPlanned(engine(), 'PF') : null);
    if (!inEngine) expect(pf.promise_ms).toBeNull();
  });

  it('a not-ready line with no land yet → null (unknown; the client keeps the promise)', async () => {
    appendOrder(hub, { order_type: 'takeaway', order_id: 'NL', lines: [{ order_item_id: 'NL1', item_id: FX.piece }, { order_item_id: 'NL2', item_id: FX.naan }] });
    const state = engine();
    expect(expectedPlanned(state, 'NL')).not.toBeNull();
    const line = state.lines.NL2!;
    const unplanned: EngineState = { ...state, lines: { ...state.lines, NL2: { ...line, fire_ms: null, fired_at: null, started_at: null, done_at: null, booked: null, load_id: null } } };
    expect(customerReadyAt(unplanned, unplanned.lines.NL2!)).toBeNull();
    const body = openOrdersBody(hub.deps.readDb, unplanned, StaffDirectory.load(hub.deps.db), { order_type: 'all', abandoned: false }, hub.clock.branchNow());
    expect(rowOf(body.orders, 'NL').planned_ready_at_ms).toBeNull();
    expect(caughtOf(catchUp(unplanned), 'NL').planned_ready_at_ms).toBeNull();
  });
});

describe('[02b §6.18 BR-1] catch-up part `orders` planned_ready_at_ms', () => {
  it('carries the same value as the open-orders row, before and after the boost; statements unchanged (open-orders 4, catch-up 4)', async () => {
    const pickup = hub.clock.branchNow() + 45 * MIN;
    appendOrder(hub, { order_type: 'takeaway', order_id: 'TA', pickup_at_ms: pickup, lines: [{ order_item_id: 'TA1', item_id: FX.piece }] });
    appendOrder(hub, { order_type: 'parking', order_id: 'PK', car_number: 'LEB-2', lines: [{ order_item_id: 'PK1', item_id: FX.naan }] });
    const who = signIn();
    const read = statementCounter(hub.deps.readDb);
    for (const step of ['before', 'after'] as const) {
      if (step === 'after') boost('TA');
      read.reset();
      const rows = await openOrders(who);
      expect(read.count, step).toBe(4); // orders, lines, keyBalances, passReadyTimesOf (§6.16)
      const db = statementCounter(hub.deps.db);
      const caught = catchUp();
      expect(db.count, step).toBe(4); // orders, lines, zone_stock, open_slips (§6.18)
      for (const id of ['TA', 'PK']) {
        expect(rowOf(rows, id).planned_ready_at_ms, `${step} ${id}`).not.toBeNull();
        expect(caughtOf(caught, id).planned_ready_at_ms, `${step} ${id}`).toBe(rowOf(rows, id).planned_ready_at_ms);
      }
    }
  });
});
