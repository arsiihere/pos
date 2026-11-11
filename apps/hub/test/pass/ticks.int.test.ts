import { isOrderInEngine, planOrder, type EngineState, type ProposedOrder } from '@pos/engine';
import type { DirectoryInput, EventDraft, ItemAddedPayload } from '@pos/events';
import { aBusinessDayClosed } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import { registeredTicks, type TickDef } from '../../src/alerts/tick';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { branchConfig } from '../../src/sync/branch-config-holder';
import { OPEN_READIES_SQL, OPEN_TABLE_READIES_SQL, PASS_CLOSURES_TICK, passClosuresTick, READY_RETARGET_TICK, readyRetargetTick, SETTLED_CARDS_SQL } from '../../src/kds/ticks';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, seedDirectory, type TestHub } from '../helpers/test-hub';
import { COOK, FX, append, appendOrder, cookDirectory, fireLines, openDay, openSeating, pairDevice, pairPassTablet, removeLine, serveLines, voidLine } from '../kds/fixtures';

// 03b §3.5 Closing / Re-target, §6.18 tick `ready_retarget`, §6.19 tick `pass_closures` (Statements 2 + 2 each);
// tests #22, #26, #27 (card half). Orders, seatings, table moves and engine progress are real events through the
// writer; Readies and hand-overs go through the real MarkReadyToServe / Handover routes. A tick pass is run as the
// loop runs it (`due` on a read-only view, then its own writer.run with the intents appended), with an injected clock.

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
/** statements spent inside 01d's closeMany / raiseMany (01d's own bounds, not 03b's count) */
let alertStatements = 0;
const calls = { closeMany: [] as number[], raiseMany: [] as number[] };

const POINT = 'P1';
const engine = (): EngineState => hub.deps.state.get() as EngineState;

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  counter = statementCounter(hub.deps.db);
  alertStatements = 0;
  calls.closeMany = [];
  calls.raiseMany = [];
  for (const name of ['closeMany', 'raiseMany'] as const) {
    const original = alerts[name] as (...args: unknown[]) => unknown;
    vi.spyOn(alerts, name).mockImplementation(((...args: unknown[]) => {
      calls[name].push((args[1] as unknown[]).length);
      const before = counter.count;
      try {
        return original(...args);
      } finally {
        alertStatements += counter.count - before;
      }
    }) as never);
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  await hub.close();
});

// ------------------------------------------------------------------------------------------- seeding

const on = (order_id: string, event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, payload });
const onTable = (table_id: string, event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'table' as const, stream_id: table_id, event_type, payload });

function cook(order_id: string, ids: string[]): void {
  fireLines(hub, engine().lines[ids[0]!]!.station_id, ids);
  append(hub, ids.map((order_item_id) => on(order_id, 'ItemStarted', { order_item_id, started_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
  append(hub, ids.map((order_item_id) => on(order_id, 'ItemDone', { order_item_id, done_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
}
const naans = (ids: string[]) => ids.map((order_item_id) => ({ order_item_id, item_id: FX.naan }));

function dineIn(ids: string[], seating_id = 'SEAT2', table_id: string = FX.table, open = true): string {
  if (open) openSeating(hub, { table_id, seating_id });
  return appendOrder(hub, { order_type: 'dine_in', seating_id, lines: naans(ids) }).order_id;
}
const takeaway = (ids: string[]) => appendOrder(hub, { order_type: 'takeaway', lines: naans(ids) }).order_id;

/** A second round on an existing order through planOrder (02b test pattern, submit-zone.int.test.ts): OrderLinesAdded +
 * ItemAdded (a copy of `like` under a new id). */
function addRound(order_id: string, like: string, order_item_id: string): void {
  const copy = JSON.parse(
    (hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'ItemAdded' AND json_extract(payload, '$.order_item_id') = ?`).get(like) as { payload: string }).payload,
  ) as ItemAddedPayload;
  const added: ItemAddedPayload = { ...copy, order_item_id };
  const o = engine().orders[order_id]!;
  const ci = branchConfig()!.items.find((i) => i.item_id === copy.item_id)!;
  const header = { order_type: o.order_type, table_id: o.table_id, table_key: o.table_key, follow_up: o.follow_up, pickup_at_ms: o.pickup_at_ms };
  const point_id = branchConfig()!.stations.find((s) => s.station_id === added.station_id)?.point_id ?? null;
  const knobs = { weight_pct: ci.weight_pct, max_early_ms: ci.max_early_ms, max_late_ms: ci.max_late_ms, max_carry_ms: ci.max_carry_ms };
  const proposed: ProposedOrder = { order_id, order: header, lines: [{ ...added, alternates: [], point_id, carry_ms: 0, ...knobs, cook_ms_override: null, return_of: null }] };
  const plan = planOrder(engine(), proposed, hub.clock.branchNow(), {});
  const lines = plan.lines.map(({ order_item_id: id, station_id, alternates, point_id: p, carry_ms, from_stock }) => ({ order_item_id: id, station_id, alternates, point_id: p, carry_ms, from_stock, ...knobs, return_of: null, cook_ms_override: null }));
  append(hub, [
    on(order_id, 'OrderLinesAdded', { order_id, order_item_ids: [order_item_id], groups: plan.groups, lines, order_header: { ...header, placed_by: o.placed_by } }),
    on(order_id, 'ItemAdded', added),
  ]);
}

interface Who {
  staffId: string;
  deviceId: string;
  token: string;
  sessionToken: string;
}
async function seed(): Promise<Who> {
  const dir: DirectoryInput = await cookDirectory();
  await seedDirectory(hub, dir);
  const device = pairPassTablet(hub, { pointId: POINT });
  const session = openSession(hub, { kind: 'staff', staffId: COOK.staff, deviceId: device.deviceId });
  // a signed-in receiver (owner ruling B4-3): the Owner of aDirectory
  const other = pairDevice(hub, { type: 'tablet' });
  openSession(hub, { kind: 'staff', staffId: 'S_OWNER', deviceId: other.deviceId });
  return { staffId: COOK.staff, deviceId: device.deviceId, token: device.token, sessionToken: session.token };
}

let commandSeq = 0;
async function command(who: Who, type: string, url: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  commandSeq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${url}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: { command_id: `cmd-${commandSeq}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type: type, payload, occurred_at: hub.clock.branchNow(), actor_id: who.staffId, device_id: who.deviceId },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: { result: Record<string, unknown> } }).data.result;
}
const markReady = async (who: Who, order_id: string): Promise<string> => (await command(who, 'MarkReadyToServe', 'mark-ready-to-serve', { order_id, point_id: POINT })).alert_id as string;
const handover = async (who: Who, order_id: string, receiver_staff_id = 'S_OWNER') =>
  (await command(who, 'Handover', 'handover', { order_id, point_id: POINT, receiver_staff_id })) as { handover_id: string; served_card_alert_id: string };

const alertRow = (alert_id: string) =>
  hub.deps.db.prepare('SELECT kind, state, close_reason, target_json, values_json, display_json, details_json, dedupe_key FROM alerts WHERE alert_id = ?').get(alert_id) as {
    kind: string;
    state: string;
    close_reason: string | null;
    target_json: string;
    values_json: string;
    display_json: string;
    details_json: string | null;
    dedupe_key: string;
  };
const passRow = (order_id: string) =>
  hub.deps.db.prepare('SELECT ready_alert_id, ready_table_id, ready_at FROM pass_orders WHERE order_id = ? AND point_id = ?').get(order_id, POINT) as {
    ready_alert_id: string | null;
    ready_table_id: string | null;
    ready_at: number | null;
  };

// ------------------------------------------------------------------------------------------- tick passes

interface Pass {
  due: boolean;
  dueStatements: number;
  /** intents' own statements (01d's closeMany / raiseMany excluded); -1 when not due */
  intentStatements: number;
  events: Array<{ event_type: string; stream_type: string; stream_id: string; actor_id: string | null; device_id: string; payload: Record<string, unknown> }>;
}
/** One pass of `tick` as the loop runs it (alerts/tick.ts tickPass), counting statements. */
function pass(tick: TickDef): Pass {
  const now = hub.clock.branchNow();
  const before = counter.count;
  const due = tick.due(readOnlyDb(hub.deps.db), hub.deps.state.get(), now);
  const dueStatements = counter.count - before;
  if (!due) return { due, dueStatements, intentStatements: -1, events: [] };
  let intentStatements = -1;
  const { appended } = hub.deps.writer.run((tx) => {
    alertStatements = 0;
    const start = counter.count;
    const drafts: EventDraft[] = tick.intents(tx, hub.deps.state.get(), now);
    intentStatements = counter.count - start - alertStatements;
    return tx.append(drafts);
  });
  return {
    due,
    dueStatements,
    intentStatements,
    events: appended.map((e) => ({ event_type: e.event_type, stream_type: e.stream_type, stream_id: e.stream_id, actor_id: e.actor_id, device_id: e.device_id, payload: e.payload as Record<string, unknown> })),
  };
}
const types = (p: Pass) => p.events.map((e) => e.event_type);

// ------------------------------------------------------------------------------------------- wiring

describe('pass ticks wiring (03b §6.18, §6.19)', () => {
  it('[03b §6.18–6.19] both ticks are registered once per process, pass_closures before ready_retarget', async () => {
    const second = await createTestHub({ provisioned: true }); // a second server build registers nothing twice
    await second.close();
    const names = registeredTicks().map((t) => t.name);
    expect(names.filter((n) => n === PASS_CLOSURES_TICK)).toHaveLength(1);
    expect(names.filter((n) => n === READY_RETARGET_TICK)).toHaveLength(1);
    expect(names.indexOf(PASS_CLOSURES_TICK)).toBeLessThan(names.indexOf(READY_RETARGET_TICK));
    expect(registeredTicks().find((t) => t.name === PASS_CLOSURES_TICK)).toBe(passClosuresTick);
    expect(registeredTicks().find((t) => t.name === READY_RETARGET_TICK)).toBe(readyRetargetTick);
  });
});

describe('pass ticks query plans (03b §5 indexes)', () => {
  it('[03b §6.18–6.19] every tick read searches its partial index (pass_orders is never pruned): no full scan, no sort', async () => {
    const plan = (sql: string) => (hub.deps.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>).map((r) => r.detail);
    expect(plan(OPEN_TABLE_READIES_SQL)[0]).toMatch(/^SEARCH o USING INDEX pass_orders_open/);
    expect(plan(OPEN_READIES_SQL)[0]).toMatch(/^SEARCH o USING INDEX pass_orders_open/);
    expect(plan(SETTLED_CARDS_SQL)[0]).toMatch(/^SEARCH handovers USING INDEX handovers_card_open/);
    for (const sql of [OPEN_TABLE_READIES_SQL, OPEN_READIES_SQL, SETTLED_CARDS_SQL]) expect(plan(sql).join(' | ')).not.toMatch(/SCAN|TEMP B-TREE/);
  });
});

// ------------------------------------------------------------------------------------------- #22

describe('tick ready_retarget (03b §3.5 Re-target, §6.18)', () => {
  it('[03b #22] TableMoved → old alert obsolete, a new open alert on the new table; move back → a third, open alert; 2 + 2 statements', async () => {
    openDay(hub);
    const cook_ = await seed();
    const order_id = dineIn(['L1', 'L2']);
    cook(order_id, ['L1', 'L2']);
    const first = await markReady(cook_, order_id);
    const readyAt = passRow(order_id).ready_at;

    expect(pass(readyRetargetTick)).toMatchObject({ due: false, dueStatements: 2 }); // nothing moved

    append(hub, [onTable(FX.table, 'TableMoved', { seating_id: 'SEAT2', from_table_id: FX.table, to_table_id: FX.zoneTable, by_staff_id: 'S_WAIT' })]);
    const moved = pass(readyRetargetTick);
    expect(moved).toMatchObject({ due: true, dueStatements: 2, intentStatements: 2 });
    expect(calls).toEqual({ closeMany: [1], raiseMany: [1] });
    expect(types(moved)[0]).toBe('AlertClosed');
    expect(types(moved)[types(moved).length - 1]).toBe('ReadyRetargeted');
    const second = moved.events.find((e) => e.event_type === 'ReadyRetargeted')!;
    expect(second).toMatchObject({ stream_type: 'order', stream_id: order_id, actor_id: null, device_id: 'hub' });
    const secondId = second.payload.alert_id as string;
    expect(second.payload).toEqual({ order_id, point_id: POINT, table_id: FX.zoneTable, alert_id: secondId, previous_alert_id: first });
    expect(alertRow(first)).toMatchObject({ state: 'closed', close_reason: 'obsolete' });
    const row = alertRow(secondId);
    expect(row).toMatchObject({ kind: 'ready_to_serve', state: 'open', dedupe_key: `${order_id}:${POINT}:${FX.zoneTable}` });
    expect(JSON.parse(row.target_json)).toEqual({ kind: 'table_team', table_id: FX.zoneTable, depth: 'direct' });
    expect(JSON.parse(row.values_json)).toEqual({ order_id, point_id: POINT, table_id: FX.zoneTable, window_ms: 60_000 });
    expect(JSON.parse(row.display_json)).toMatchObject({ table_code: null, kind_label_key: 'alert.ready_to_serve' });
    expect(JSON.parse(row.details_json!)).toEqual({ identifier: 'T1' });
    expect(passRow(order_id)).toEqual({ ready_alert_id: secondId, ready_table_id: FX.zoneTable, ready_at: readyAt });
    expect(pass(readyRetargetTick).due).toBe(false);

    append(hub, [onTable(FX.zoneTable, 'TableMoved', { seating_id: 'SEAT2', from_table_id: FX.zoneTable, to_table_id: FX.table, by_staff_id: 'S_WAIT' })]);
    const back = pass(readyRetargetTick);
    const thirdId = back.events.find((e) => e.event_type === 'ReadyRetargeted')!.payload.alert_id as string;
    expect(new Set([first, secondId, thirdId]).size).toBe(3);
    expect(alertRow(secondId)).toMatchObject({ state: 'closed', close_reason: 'obsolete' });
    expect(alertRow(thirdId)).toMatchObject({ state: 'open', dedupe_key: `${order_id}:${POINT}:${FX.table}` });
    expect(passRow(order_id)).toMatchObject({ ready_alert_id: thirdId, ready_table_id: FX.table });
  });

  it('[03b #22] a merge moving 3 Readies uses one closeMany + one raiseMany; one ReadyRetargeted per Ready', async () => {
    openDay(hub);
    const cook_ = await seed();
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'SEAT1' });
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT2' });
    const orders = [dineIn(['A1'], 'SEAT2', FX.table, false), dineIn(['B1'], 'SEAT2', FX.table, false), dineIn(['C1'], 'SEAT2', FX.table, false)];
    for (const [i, order_id] of orders.entries()) cook(order_id, [['A1', 'B1', 'C1'][i]!]);
    const firsts = [];
    for (const order_id of orders) firsts.push(await markReady(cook_, order_id));

    append(hub, [
      onTable(FX.zoneTable, 'TablesMerged', { into_seating_id: 'SEAT1', into_table_id: FX.zoneTable, table_ids: [], absorbed_seating_id: 'SEAT2', order_ids: orders, by_staff_id: 'S_WAIT' }),
    ]);
    const merged = pass(readyRetargetTick);
    expect(merged).toMatchObject({ due: true, dueStatements: 2, intentStatements: 2 });
    expect(calls).toEqual({ closeMany: [3], raiseMany: [3] });
    const retargeted = merged.events.filter((e) => e.event_type === 'ReadyRetargeted');
    expect(retargeted.map((e) => e.payload.order_id).sort()).toEqual([...orders].sort());
    for (const e of retargeted) {
      expect(e.payload.table_id).toBe(FX.zoneTable);
      expect(firsts).toContain(e.payload.previous_alert_id);
      expect(JSON.parse(alertRow(e.payload.alert_id as string).details_json!)).toEqual({ identifier: 'T1 + T2' }); // primary first
    }
    for (const id of firsts) expect(alertRow(id)).toMatchObject({ state: 'closed', close_reason: 'obsolete' });
  });

  it('[03b §6.18] a Ready whose alert day close marked expire_due is not re-targeted (it expires; no never-expiring alert)', async () => {
    openDay(hub);
    const cook_ = await seed();
    const order_id = dineIn(['L1']);
    cook(order_id, ['L1']);
    const first = await markReady(cook_, order_id);
    const closed = aBusinessDayClosed();
    append(hub, [{ stream_type: closed.stream_type, stream_id: closed.stream_id, event_type: closed.event_type, payload: closed.payload as Record<string, unknown> }], { actor: null, device: 'hub' });
    expect((hub.deps.db.prepare('SELECT expire_due FROM alerts WHERE alert_id = ?').get(first) as { expire_due: number }).expire_due).toBe(1);
    append(hub, [onTable(FX.table, 'TableMoved', { seating_id: 'SEAT2', from_table_id: FX.table, to_table_id: FX.zoneTable, by_staff_id: 'S_WAIT' })]);
    expect(pass(readyRetargetTick)).toMatchObject({ due: false, dueStatements: 1 });
    expect(calls).toEqual({ closeMany: [], raiseMany: [] });
    expect(passRow(order_id).ready_alert_id).toBe(first);
  });

  it('[03b §6.18] race rule: moved back between due and intents → intents re-selects and writes nothing; a takeaway Ready is never re-targeted', async () => {
    openDay(hub);
    const cook_ = await seed();
    const order_id = dineIn(['L1']);
    const take = takeaway(['K1']);
    cook(order_id, ['L1']);
    cook(take, ['K1']);
    const first = await markReady(cook_, order_id);
    await markReady(cook_, take);
    append(hub, [onTable(FX.table, 'TableMoved', { seating_id: 'SEAT2', from_table_id: FX.table, to_table_id: FX.zoneTable, by_staff_id: 'S_WAIT' })]);
    const now = hub.clock.branchNow();
    expect(readyRetargetTick.due(readOnlyDb(hub.deps.db), engine(), now)).toBe(true);
    append(hub, [onTable(FX.zoneTable, 'TableMoved', { seating_id: 'SEAT2', from_table_id: FX.zoneTable, to_table_id: FX.table, by_staff_id: 'S_WAIT' })]);
    const drafts = hub.deps.writer.run((tx) => readyRetargetTick.intents(tx, engine(), now)).result;
    expect(drafts).toEqual([]);
    expect(alertRow(first).state).toBe('open');
  });
});

// ------------------------------------------------------------------------------------------- #26, #27

describe('tick pass_closures (03b §3.5 Closing, §6.19)', () => {
  it('[03b #26] Ready → the waiter\'s own MarkServed (no Handover) → closed done before step 1; 2 + 2 statements', async () => {
    openDay(hub);
    const cook_ = await seed();
    const order_id = dineIn(['L1', 'L2']);
    cook(order_id, ['L1', 'L2']);
    const ready = await markReady(cook_, order_id);
    expect(pass(passClosuresTick)).toMatchObject({ due: false, dueStatements: 2 });

    serveLines(hub, order_id, ['L1']);
    expect(pass(passClosuresTick).due, 'one ready line still unsettled').toBe(false);
    serveLines(hub, order_id, ['L2']);
    const closed = pass(passClosuresTick);
    expect(closed).toMatchObject({ due: true, dueStatements: 2, intentStatements: 2 });
    expect(calls.closeMany).toEqual([1]);
    expect(closed.events).toEqual([expect.objectContaining({ event_type: 'AlertClosed', actor_id: null, device_id: 'hub', payload: expect.objectContaining({ alert_id: ready, reason: 'done' }) })]);
    expect(alertRow(ready)).toMatchObject({ state: 'closed', close_reason: 'done' });
    // before step 1 (window_ms): the escalation step never ran
    expect((hub.deps.db.prepare('SELECT step FROM alerts WHERE alert_id = ?').get(ready) as { step: number }).step).toBe(0);
    expect(passRow(order_id).ready_alert_id).toBeNull();
    expect(pass(passClosuresTick).due).toBe(false);
  });

  it('[03b #26] Ready → a new round at the same point → MarkServed of the ready lines → closed done (new lines do not hold it)', async () => {
    openDay(hub);
    const cook_ = await seed();
    const order_id = takeaway(['L1']);
    cook(order_id, ['L1']);
    const ready = await markReady(cook_, order_id);
    addRound(order_id, 'L1', 'L9');
    expect(engine().lines.L9?.stage).toBe('added');
    serveLines(hub, order_id, ['L1']);
    pass(passClosuresTick);
    expect(alertRow(ready)).toMatchObject({ state: 'closed', close_reason: 'done' });
  });

  it('[03b #26] last ready line removed / voided / order cancelled → closed', async () => {
    openDay(hub);
    const cook_ = await seed();
    const removed = takeaway(['R1', 'R2']);
    const voided = takeaway(['V1']);
    const cancelled = takeaway(['X1']);
    for (const [order_id, ids] of [
      [removed, ['R1', 'R2']],
      [voided, ['V1']],
      [cancelled, ['X1']],
    ] as const)
      cook(order_id, [...ids]);
    const readies = [await markReady(cook_, removed), await markReady(cook_, voided), await markReady(cook_, cancelled)];

    serveLines(hub, removed, ['R1']);
    removeLine(hub, removed, 'R2');
    voidLine(hub, voided, 'V1', 1);
    append(hub, [on(cancelled, 'OrderCancelled', { order_id: cancelled })]);
    pass(passClosuresTick);
    expect(calls.closeMany).toEqual([3]);
    for (const id of readies) expect(alertRow(id)).toMatchObject({ state: 'closed', close_reason: 'done' });
  });

  it('[03b #26] order left the engine (memory) → closed, its lines still unsettled', async () => {
    openDay(hub);
    const cook_ = await seed();
    const order_id = takeaway(['L1']);
    cook(order_id, ['L1']);
    const ready = await markReady(cook_, order_id);
    expect(pass(passClosuresTick).due).toBe(false);
    hub.clock.advance(14_400_000 + 60_000); // past order_abandon_ms (03a §3.3)
    expect(isOrderInEngine(engine(), order_id, hub.clock.branchNow())).toBe(false);
    pass(passClosuresTick);
    expect(alertRow(ready)).toMatchObject({ state: 'closed', close_reason: 'done' });
  });

  it('[03b #27] Served card closes at open_lines = 0 (not before); 2 + 2 statements', async () => {
    openDay(hub);
    const cook_ = await seed();
    const order_id = takeaway(['L1', 'L2']);
    cook(order_id, ['L1', 'L2']);
    const { handover_id, served_card_alert_id } = await handover(cook_, order_id);
    serveLines(hub, order_id, ['L1']);
    expect(pass(passClosuresTick).due).toBe(false);
    expect((hub.deps.db.prepare('SELECT open_lines FROM handovers WHERE handover_id = ?').get(handover_id) as { open_lines: number }).open_lines).toBe(1);

    removeLine(hub, order_id, 'L2');
    const closed = pass(passClosuresTick);
    expect(closed).toMatchObject({ due: true, dueStatements: 2, intentStatements: 2 });
    expect(closed.events.map((e) => e.payload.alert_id)).toEqual([served_card_alert_id]);
    expect(alertRow(served_card_alert_id)).toMatchObject({ kind: 'served_card', state: 'closed', close_reason: 'done' });
    expect((hub.deps.db.prepare('SELECT card_closed_at FROM handovers WHERE handover_id = ?').get(handover_id) as { card_closed_at: number | null }).card_closed_at).not.toBeNull();
    expect(pass(passClosuresTick).due).toBe(false);
  });
});
