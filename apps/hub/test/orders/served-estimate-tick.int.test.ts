import { isOrderInEngine, type EngineState } from '@pos/engine';
import type { BranchConfig, EventDraft } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registeredTicks } from '../../src/alerts/tick';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { passClosuresTick } from '../../src/kds/ticks';
import { SERVED_ESTIMATE_TICK, servedEstimateTick } from '../../src/orders/served-estimate-tick';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, seedDirectory, type TestHub } from '../helpers/test-hub';
import { COOK, FX, append, appendOrder, cookDirectory, fireLines, fixtureMenu, openDay, pairDevice, pairPassTablet, removeLine, serveLines } from '../kds/fixtures';

// 02b §3.7 "Estimated Served", §6.11 tick `served_estimate` (03b §4.3, task 0e; G-2): `due` = 03b's handoversDue when
// `served_estimate_ms` is not null; intents = servedDrafts(…, 'estimated') per order. Hand-overs through the real
// Handover route; serving / removing through real events; a tick pass is run as the loop runs it, with an injected clock.

let hub: TestHub;
const POINT = 'P1';
const ESTIMATE = 180_000;
const engine = (): EngineState => hub.deps.state.get() as EngineState;

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
});
afterEach(async () => {
  counter = null;
  await hub.close();
});

function menu(served_estimate_ms: number | null): BranchConfig {
  const m = fixtureMenu();
  return { ...m, engine_settings: { ...m.engine_settings, served_estimate_ms } };
}

const on = (order_id: string, event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, payload });
function cook(order_id: string, ids: string[]): void {
  fireLines(hub, engine().lines[ids[0]!]!.station_id, ids);
  append(hub, ids.map((order_item_id) => on(order_id, 'ItemStarted', { order_item_id, started_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
  append(hub, ids.map((order_item_id) => on(order_id, 'ItemDone', { order_item_id, done_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
}
/**
 * ItemDone with no Start and no stock drafts (a Done that wrote no consume; 03a stock.ts ItemServed row: "a `done`
 * line whose Done wrote no consume still consumes here"), so the line still holds its draw when it is served.
 */
function doneWithoutConsume(order_id: string, order_item_id: string): void {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  hub.deps.writer.run((tx) =>
    tx.append([{ ...on(order_id, 'ItemDone', { order_item_id, done_at: now, source: 'tap' }), schema_version: 1, occurred_at: now, actor_id: 'S_WAIT', device_id: 'D_FIXTURE' }]),
  );
}
// ⚠️ 02b v1.0.25 §3.7 (M-2): takeaway hand-overs are never estimated; parking keeps the estimate
const parking = (lines: Array<{ order_item_id: string; item_id: string }>) => appendOrder(hub, { order_type: 'parking', lines }).order_id;
const naans = (ids: string[]) => ids.map((order_item_id) => ({ order_item_id, item_id: FX.naan }));

interface Who {
  deviceId: string;
  token: string;
  sessionToken: string;
}
async function seed(): Promise<Who> {
  await seedDirectory(hub, await cookDirectory());
  const device = pairPassTablet(hub, { pointId: POINT });
  const session = openSession(hub, { kind: 'staff', staffId: COOK.staff, deviceId: device.deviceId });
  openSession(hub, { kind: 'staff', staffId: 'S_OWNER', deviceId: pairDevice(hub, { type: 'tablet' }).deviceId }); // a signed-in receiver (03b B4-3)
  return { deviceId: device.deviceId, token: device.token, sessionToken: session.token };
}
let seq = 0;
async function handover(who: Who, order_id: string, order_item_ids?: string[]): Promise<{ handover_id: string; served_card_alert_id: string }> {
  seq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: '/commands/handover',
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id: `cmd-${seq}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'Handover',
      payload: { order_id, point_id: POINT, receiver_staff_id: 'S_OWNER', ...(order_item_ids === undefined ? {} : { order_item_ids }) },
      occurred_at: hub.clock.branchNow(),
      actor_id: COOK.staff,
      device_id: who.deviceId,
    },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: { result: { handover_id: string; served_card_alert_id: string } } }).data.result;
}

interface Stored {
  event_type: string;
  stream_id: string;
  actor_id: string | null;
  device_id: string;
  payload: Record<string, unknown>;
}
/** One pass of the tick as the loop runs it: due (read-only view), then its own writer.run with the intents appended. */
let counter: ReturnType<typeof statementCounter> | null = null;
function pass(): { due: boolean; dueStatements: number; intentStatements: number; events: Stored[] } {
  const now = hub.clock.branchNow();
  counter ??= statementCounter(hub.deps.db);
  const before = counter.count;
  const due = servedEstimateTick.due(readOnlyDb(hub.deps.db), hub.deps.state.get(), now);
  const dueStatements = counter.count - before;
  if (!due) return { due, dueStatements, intentStatements: -1, events: [] };
  let intentStatements = -1;
  const { appended } = hub.deps.writer.run((tx) => {
    const start = counter!.count;
    const drafts = servedEstimateTick.intents(tx, hub.deps.state.get(), now);
    intentStatements = counter!.count - start;
    return tx.append(drafts);
  });
  return { due, dueStatements, intentStatements, events: appended.map((e) => ({ event_type: e.event_type, stream_id: e.stream_id, actor_id: e.actor_id, device_id: e.device_id, payload: e.payload as Record<string, unknown> })) };
}
const servedRow = (id: string) => hub.deps.db.prepare('SELECT served_at, served_source FROM order_lines WHERE order_item_id = ?').get(id) as { served_at: number | null; served_source: string | null };

describe('02b tick served_estimate (§3.7, §6.11; 03b §4.3 task 0e)', () => {
  it('[02b §6.11] registered once per process', async () => {
    const second = await createTestHub({ provisioned: true });
    await second.close();
    expect(registeredTicks().filter((t) => t.name === SERVED_ESTIMATE_TICK)).toEqual([servedEstimateTick]);
  });

  it('[02b §6.11] null setting = not due, even for a hand-over long past any cut-off', async () => {
    openDay(hub, { menu: menu(null) });
    const who = await seed();
    const a = parking(naans(['A1']));
    cook(a, ['A1']);
    await handover(who, a);
    hub.clock.advance(3_600_000);
    expect(pass().due).toBe(false);
    expect(servedRow('A1').served_at).toBeNull();
  });

  it('[02b §3.7] after served_estimate_ms: ItemServed { estimated } per order (unsettled handed lines only) + OrderFoodServed; the card then closes', async () => {
    openDay(hub, { menu: menu(ESTIMATE) });
    const who = await seed();
    const a = parking(naans(['A1', 'A2', 'A3', 'A4']));
    const b = parking(naans(['B1']));
    cook(a, ['A1', 'A2', 'A3', 'A4']);
    cook(b, ['B1']);
    const ha = await handover(who, a, ['A1', 'A2', 'A3']); // A4 done but never handed
    await handover(who, b);
    serveLines(hub, a, ['A1']); // the waiter's own tap: settled
    removeLine(hub, a, 'A3'); // removed: settled

    hub.clock.advance(ESTIMATE - 10_000);
    expect(pass(), 'not before the cut-off').toMatchObject({ due: false, dueStatements: 1 });
    hub.clock.advance(10_000);

    const run = pass();
    // due = handoversDue (2); intents = handoversDue (2) + orderLines (1); servedDrafts and stockEffects run on memory
    expect(run).toMatchObject({ due: true, dueStatements: 2, intentStatements: 3 });
    const served = run.events.filter((e) => e.event_type === 'ItemServed');
    expect(served.map((e) => [e.stream_id, e.payload])).toEqual([
      [a, { order_item_ids: ['A2'], source: 'estimated' }],
      [b, { order_item_ids: ['B1'], source: 'estimated' }],
    ]);
    for (const e of run.events) expect(e).toMatchObject({ actor_id: null, device_id: 'hub' });
    // per order: ItemServed → OrderFoodServed (naan is food, §3.3) → its stock effects
    const types = run.events.map((e) => `${e.event_type}:${e.stream_id === a ? 'a' : e.stream_id === b ? 'b' : e.stream_id}`);
    expect(types.indexOf('ItemServed:a')).toBeLessThan(types.indexOf('OrderFoodServed:a'));
    expect(types.indexOf('OrderFoodServed:a')).toBeLessThan(types.indexOf('ItemServed:b'));
    expect(types).toContain('OrderFoodServed:b');

    expect(servedRow('A2').served_source).toBe('estimated');
    expect(servedRow('A1').served_source).toBe('tap');
    expect(servedRow('A4').served_at).toBeNull();
    expect(engine().lines.A2?.stage).toBe('served');
    expect(pass().due, 'settled: nothing left').toBe(false);

    // 03b §3.5: the estimate settles the hand-over, so pass_closures closes its card `done`
    const now = hub.clock.branchNow();
    hub.deps.writer.run((tx) => tx.append(passClosuresTick.intents(tx, engine(), now)));
    expect(hub.deps.db.prepare('SELECT state, close_reason FROM alerts WHERE alert_id = ?').get(ha.served_card_alert_id)).toEqual({ state: 'closed', close_reason: 'done' });
  });

  it('[02b §6.11] race rule: a line served by tap between due and intents → intents re-selects and writes nothing', async () => {
    openDay(hub, { menu: menu(ESTIMATE) });
    const who = await seed();
    const a = parking(naans(['A1']));
    cook(a, ['A1']);
    await handover(who, a);
    hub.clock.advance(ESTIMATE);
    const now = hub.clock.branchNow();
    expect(servedEstimateTick.due(readOnlyDb(hub.deps.db), engine(), now)).toBe(true);
    serveLines(hub, a, ['A1']);
    const drafts: EventDraft[] = hub.deps.writer.run((tx) => servedEstimateTick.intents(tx, engine(), now)).result;
    expect(drafts).toEqual([]);
    expect(servedRow('A1').served_source).toBe('tap');
  });

  it('[02b §3.7] two due hand-overs of one order → one ItemServed for that order with both hand-overs\' lines', async () => {
    openDay(hub, { menu: menu(ESTIMATE) });
    const who = await seed();
    const a = parking(naans(['A1', 'A2']));
    cook(a, ['A1', 'A2']);
    await handover(who, a, ['A1']);
    await handover(who, a, ['A2']);
    hub.clock.advance(ESTIMATE);
    const run = pass();
    expect(run.events.filter((e) => e.event_type === 'ItemServed').map((e) => e.payload)).toEqual([{ order_item_ids: ['A1', 'A2'], source: 'estimated' }]);
    expect(run.events.filter((e) => e.event_type === 'OrderFoodServed')).toHaveLength(1);
  });

  it('[02b O16] an order that has left the engine → ItemServed { estimated } with no stock effects', async () => {
    openDay(hub, { menu: menu(ESTIMATE), stock: { [FX.stock]: 10_000 } });
    const who = await seed();
    const a = parking([{ order_item_id: 'K1', item_id: FX.piece }]);
    fireLines(hub, FX.station, ['K1']);
    doneWithoutConsume(a, 'K1'); // K1 still holds its draw: in the engine, a serve would consume it (case below)
    await handover(who, a);
    hub.clock.advance(14_400_000 + 60_000); // past order_abandon_ms (03a §3.3)
    expect(isOrderInEngine(engine(), a, hub.clock.branchNow())).toBe(false);
    const run = pass();
    expect(run.events.map((e) => e.event_type)).toEqual(['ItemServed', 'OrderFoodServed']);
    expect(run.events[0]!.payload).toEqual({ order_item_ids: ['K1'], source: 'estimated' });
  });

  it('[02b §3.3] an order with no food line (a ready item) → ItemServed, no OrderFoodServed', async () => {
    openDay(hub, { menu: menu(ESTIMATE) });
    const who = await seed();
    const a = parking([{ order_item_id: 'W1', item_id: FX.ready }]);
    cook(a, ['W1']);
    await handover(who, a);
    hub.clock.advance(ESTIMATE);
    const run = pass();
    expect(run.events.map((e) => e.event_type)).toEqual(['ItemServed']);
    expect(run.events[0]!.payload).toEqual({ order_item_ids: ['W1'], source: 'estimated' });
  });

  it('[02b §3.7] a handed line never started → its StockConsumed right after its ItemServed (AD-29 Q7 split), tick envelope', async () => {
    openDay(hub, { menu: menu(ESTIMATE), stock: { [FX.stock]: 10_000 } });
    const who = await seed();
    const a = parking([{ order_item_id: 'K1', item_id: FX.piece }]);
    const b = parking(naans(['N1']));
    fireLines(hub, FX.station, ['K1']);
    doneWithoutConsume(a, 'K1');
    cook(b, ['N1']);
    await handover(who, a);
    await handover(who, b);
    expect(engine().lines.K1).toMatchObject({ stage: 'done', started_at: null });
    hub.clock.advance(ESTIMATE);
    const run = pass();
    expect(run.events.map((e) => [e.event_type, e.stream_id])).toEqual([
      ['ItemServed', a],
      ['OrderFoodServed', a],
      ['StockConsumed', FX.stock],
      ['ItemServed', b],
      ['OrderFoodServed', b],
    ]);
    expect(run.events[2]).toMatchObject({ actor_id: null, device_id: 'hub', payload: { stock_item_id: FX.stock, order_item_id: 'K1' } });
  });
});

// ⚠️ 02b v1.0.25 §3.3 Open (lists), §3.7 (run 1 M-2, TK-Q12 / OR-2): a takeaway is handed to the customer only by
// MarkServed; the estimate never serves it, a Pass Handover keeps it listed. Imports inside (append-only per lane).
describe('[02b #76 #77] [03b #124] served_estimate skips takeaway; parking keeps it (§3.7 v1.0.25)', () => {
  it('[02b #76] [03b #124] a paid takeaway handed Pass → counter is never estimate-served and stays listed; a parking order of the same fixture is; 0 extra statements', async () => {
    const { openOrderRows } = await import('../../src/orders/queries/open-orders');
    const { ordersCatchUpPart } = await import('../../src/orders/catch-up');
    openDay(hub, { menu: menu(ESTIMATE) });
    const who = await seed();
    const t = appendOrder(hub, { order_type: 'takeaway', lines: naans(['T1']) }).order_id;
    const p = parking(naans(['P1']));
    append(hub, [on(t, 'OrdersBilled', { order_ids: [t], bill_id: 'BL1' }), on(p, 'OrdersBilled', { order_ids: [p], bill_id: 'BL2' })]);
    cook(t, ['T1']);
    cook(p, ['P1']);
    await handover(who, t);
    await handover(who, p);
    hub.clock.advance(ESTIMATE);

    const run = pass();
    expect(run).toMatchObject({ due: true, dueStatements: 2, intentStatements: 3 });
    expect(run.events.filter((e) => e.event_type === 'ItemServed').map((e) => e.stream_id)).toEqual([p]);
    expect(servedRow('P1').served_source).toBe('estimated');
    expect(servedRow('T1').served_at).toBeNull();
    // only the takeaway's hand-over is left: not due (it never fills the tick's slots)
    hub.clock.advance(3_600_000);
    expect(pass()).toMatchObject({ due: false, dueStatements: 1 });
    expect(openOrderRows(hub.deps.db, 'all').map((r) => r.order_id)).toEqual([t]);
    const part = ordersCatchUpPart().build(hub.deps.db, engine(), { deviceId: 'D1', deviceType: 'tablet', sessionId: 'X', kind: 'staff', staffId: COOK.staff, stationId: null, asOfSeq: 0 }) as { orders: Array<{ order_id: string }> };
    expect(part.orders.map((o) => o.order_id)).toEqual([t]);
  });

  it('[02b #77] a paid takeaway handed Pass → counter keeps a non-null ready_at and stays listed; the counter\'s MarkServed of every line → gone', async () => {
    const { openOrdersBody, openOrderRows } = await import('../../src/orders/queries/open-orders');
    const { currentDirectory } = await import('../../src/auth/guards');
    openDay(hub, { menu: menu(ESTIMATE) });
    const who = await seed();
    const t = appendOrder(hub, { order_type: 'takeaway', lines: naans(['T1', 'T2']) }).order_id;
    append(hub, [on(t, 'OrdersBilled', { order_ids: [t], bill_id: 'BL1' })]);
    pairDevice(hub, { type: 'cashier_kiosk', name: 'Counter', profile: { access: 'everyone', screens: ['takeaway', 'cashier'] } });
    cook(t, ['T1', 'T2']);
    // Ready at the Pass: the whole bag complete → the D8 epoch (03b §3.5, pass_bag_ready)
    const ready = await hub.app.inject({
      method: 'POST',
      url: '/commands/mark-ready-to-serve',
      headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
      payload: { command_id: 'ready-1', tenant_id: 'tenant-a', branch_id: 'branch-1', command_type: 'MarkReadyToServe', payload: { order_id: t, point_id: POINT }, occurred_at: hub.clock.branchNow(), actor_id: COOK.staff, device_id: who.deviceId },
    });
    expect(ready.statusCode, ready.body).toBe(200);
    await handover(who, t);
    hub.clock.advance(ESTIMATE);
    pass();
    const body = (): ReturnType<typeof openOrdersBody> => openOrdersBody(hub.deps.db, engine(), currentDirectory(hub.app), { order_type: 'takeaway', abandoned: false }, hub.clock.branchNow());
    const row = body().orders.find((o) => o.order_id === t);
    expect(row).toMatchObject({ bill: { state: 'paid', due_minor: 0 }, handed: { n: 0, m: 2 } });
    expect(row!.ready_at).not.toBeNull();
    serveLines(hub, t, ['T1', 'T2']); // the cashier hands the bag to the customer (MarkServed, source tap)
    expect(openOrderRows(hub.deps.db, 'all').map((r) => r.order_id)).toEqual([]);
  });
});
