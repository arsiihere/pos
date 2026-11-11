import { isOrderInEngine, planOrder, type EngineState, type ProposedOrder } from '@pos/engine';
import type { BranchConfig, DirectoryInput, EventDraft, ItemAddedPayload } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { orderLines } from '../../src/orders/exports';
import { foodDrafts } from '../../src/orders/food';
import { registerOrdersProjection } from '../../src/orders/index';
import { createProjectionRegistry } from '../../src/projections/registry';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { registerTablesProjection } from '../../src/tables/index';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FX, fixtureMenu, openDay, openSeating, setZoneStock } from './fixtures';

// 02b v1.0.3 §3.2 step 5 (zone-served lines, O5) and step 10 (zone-served ItemAdded → ItemServed { source: 'zone' } →
// zone alert drafts last), §3.10 counts and alerts, §3.3 food line / table state (P-1d), 03a v1.2 Q-3; §10 #12 and #13
// (the queued-command clause of #13 that needs the device queue is task 22; the hub-side queued replay is here).
// Clauses whose trigger is a command of another wave-2 lane (MarkServed, RemoveItems, ReturnToKitchen) append, through
// the writer, the real events that command writes (its food part built with foodDrafts); RequestBill and CleanTable
// (02a) are posted for real.

let hub: TestHub;

afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

function grant(permission: string) {
  return { permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope: 'branch' as const };
}

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  return {
    ...base,
    roles: [...base.roles, { role_id: 'R_TAKER', name: 'R_TAKER', session_idle_ttl_ms: 3_600_000, permissions: [grant('take-order'), grant('clean-table')] }],
    staff: [
      ...base.staff,
      ...['S_ALI', 'S_NOOR'].map((staff_id) => ({ staff_id, display_name: staff_id, pin_hash: pin, role_ids: ['R_TAKER'], denied_permissions: [], lead_staff_id: null, floor_ids: [] })),
    ],
  };
}

/** fixtureMenu with the water (is_ready_item) on the counter station S2: "a bottle from the counter". */
function menu(): BranchConfig {
  const m = fixtureMenu();
  return { ...m, items: m.items.map((i) => (i.item_id === FX.ready ? { ...i, station_id: FX.zoneStation } : i)) };
}

async function setUp(o: { stock?: Record<string, number>; zone?: number } = {}): Promise<void> {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  openDay(hub, { menu: menu(), stock: o.stock });
  if (o.zone !== undefined) setZoneStock(hub, FX.zone, FX.zoneItem, o.zone);
}

interface Who {
  staffId: string;
  deviceId: string;
  token: string;
  sessionToken: string;
}

function signIn(staffId: string): Who {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, token: device.token, sessionToken: session.token };
}

interface Logged {
  event_type: string;
  stream_type: string;
  stream_id: string;
  payload: Record<string, unknown>;
}

interface Reply {
  status: number;
  result?: {
    order_id: string;
    groups: Array<{ group_id: string; order_item_ids: string[] }>;
    lines: Array<{ order_item_id: string; eta_ms: number | null; from_stock: boolean; zone_served: boolean }>;
  };
  events: Logged[];
  error?: { code: string; details: Record<string, unknown> };
}

let commandSeq = 0;

async function post(who: Who, command_type: string, path: string, payload: object, o: { queuedAt?: number } = {}): Promise<Reply> {
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${path}`,
    headers: {
      authorization: `Bearer ${who.token}`,
      'x-session-token': who.sessionToken,
      ...(o.queuedAt === undefined ? {} : { 'x-queued-at': String(o.queuedAt) }),
    },
    payload: {
      command_id: `cmd-${(commandSeq += 1)}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: who.staffId,
      device_id: who.deviceId,
    },
  });
  const body = res.json() as { data?: { event_ids: string[]; result: Reply['result'] }; error?: Reply['error'] };
  const events =
    body.data === undefined
      ? []
      : (
          hub.deps.db
            .prepare('SELECT event_type, stream_type, stream_id, payload FROM events WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY seq')
            .all(JSON.stringify(body.data.event_ids)) as Array<Omit<Logged, 'payload'> & { payload: string }>
        ).map((r) => ({ ...r, payload: JSON.parse(r.payload) as Record<string, unknown> }));
  return { status: res.statusCode, result: body.data?.result, events, error: body.error };
}

const item = (order_item_id: string, item_id: string, quantity = 1, o: Record<string, unknown> = {}) => ({ order_item_id, item_id, quantity, ...o });
const zoneLine = (order_item_id: string, quantity = 1) => item(order_item_id, FX.zoneItem, quantity, { from_zone: true });
const SEAT = 'SEAT1';
const dineIn = (order_id: string, lines: unknown[], seating_id = SEAT, table_id: string = FX.zoneTable) => ({ order_id, order_type: 'dine_in', table_id, seating_id, lines });
const submit = (who: Who, payload: object, o: { queuedAt?: number } = {}) => post(who, 'SubmitOrder', 'submit-order', payload, o);

/** Counts the statements of each SubmitOrder `handle` call (the append is the route's, outside `handle`). */
function countHandle(): { calls: number[]; restore(): void } {
  const def = commandRegistry(hub.app).byPath('submit-order') as CommandDef;
  const counter = statementCounter(hub.deps.db);
  const original = def.handle;
  const calls: number[] = [];
  def.handle = (ctx, payload, cmd) => {
    counter.reset();
    try {
      return original.call(def, ctx, payload, cmd);
    } finally {
      calls.push(counter.count);
    }
  };
  return {
    calls,
    restore() {
      def.handle = original;
    },
  };
}

const engine = (): EngineState => hub.deps.state.get() as EngineState;
const types = (r: Reply): string[] => r.events.map((e) => e.event_type);
const stateOf = (seating_id = SEAT): string => (hub.deps.db.prepare('SELECT state FROM seatings WHERE seating_id = ?').get(seating_id) as { state: string }).state;
const zoneCount = (): number | undefined =>
  (hub.deps.db.prepare('SELECT on_hand FROM zone_stock WHERE zone_id = ? AND item_id = ?').get(FX.zone, FX.zoneItem) as { on_hand: number } | undefined)?.on_hand;
const line = (order_item_id: string) =>
  hub.deps.db.prepare('SELECT served_from_zone_id, served_source, is_food, served_at FROM order_lines WHERE order_item_id = ?').get(order_item_id) as Record<string, unknown>;
const seatingOrder = (order_id: string) => hub.deps.db.prepare('SELECT has_food, served_any, cancelled FROM seating_orders WHERE order_id = ?').get(order_id);

type Draft = Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id'>;
const onOrder = (order_id: string, event_type: string, payload: object): Draft => ({
  stream_type: 'order',
  stream_id: order_id,
  event_type,
  schema_version: 1,
  payload: payload as Record<string, unknown>,
});

/**
 * One writer transaction of another lane's command: `first(tx state)` is its own events, then the food drafts it adds
 * (§3.3, built with the shared foodDrafts over the lines as folded so far). Returns the event types appended.
 */
function another(order_id: string, first: (state: EngineState) => Draft[], after: Parameters<typeof foodDrafts>[2]): string[] {
  hub.clock.advance(1_000);
  const at = hub.clock.branchNow();
  const envelope = { occurred_at: at, actor_id: 'S_ALI', device_id: 'D_OTHER_LANE' };
  const { appended } = hub.deps.writer.run((tx) => {
    tx.append(first(tx.state as EngineState).map((d) => ({ ...d, ...envelope })));
    const lines = orderLines(tx.db, [order_id]).get(order_id)!;
    const food = foodDrafts(order_id, lines, after);
    if (food.length > 0) tx.append(food.map((d) => ({ ...d, payload: d.payload as unknown as Record<string, unknown>, ...envelope })));
  });
  return appended.map((e) => e.event_type);
}

/** MarkServed (lane 2C, §3.7): ItemServed { source: 'tap' } + OrderFoodServed when it serves a food line. */
const markServed = (order_id: string, order_item_ids: string[]): string[] =>
  another(order_id, () => [onOrder(order_id, 'ItemServed', { order_item_ids, source: 'tap' })], { kind: 'served', order_item_ids });

/** RemoveItems (lane 2B, §3.5) of whole lines with no reservation: ItemRemoved per line + OrderFoodCleared (§3.3). */
const removeLines = (order_id: string, ids: string[]): string[] =>
  another(order_id, () => ids.map((order_item_id) => onOrder(order_id, 'ItemRemoved', { order_item_id })), 'change');

function itemAddedOf(order_item_id: string): ItemAddedPayload {
  const row = hub.deps.db
    .prepare(`SELECT payload FROM events WHERE event_type = 'ItemAdded' AND json_extract(payload, '$.order_item_id') = ?`)
    .get(order_item_id) as { payload: string };
  return JSON.parse(row.payload) as ItemAddedPayload;
}

/**
 * ReturnToKitchen (lane 2C, §3.8): a one-line ProposedOrder through planOrder → OrderLinesAdded (with order_header from
 * the EngineOrder) + its ItemAdded (money 0) (+ ItemReturned for remake), then OrderFoodCleared by the §3.3 return gate.
 */
function returnLine(order_id: string, original: string, replacement: string, mode: 'fix' | 'remake'): string[] {
  return another(
    order_id,
    (state) => {
      const o = state.orders[order_id]!;
      const copy = itemAddedOf(original);
      const config = branchConfig()!;
      const ci = config.items.find((i) => i.item_id === copy.item_id)!;
      const added: ItemAddedPayload = { ...copy, order_item_id: replacement, price_minor: 0, line_total_minor: 0, options: [], stock_draws: [], kitchen_note: null, return_of: original };
      const return_of = { order_item_id: original, mode };
      const cook_ms_override = mode === 'fix' ? ci.adjust_time_ms : null;
      const header = { order_type: o.order_type, table_id: o.table_id, table_key: o.table_key, follow_up: o.follow_up, pickup_at_ms: o.pickup_at_ms };
      const point_id = config.stations.find((s) => s.station_id === added.station_id)?.point_id ?? null;
      const proposed: ProposedOrder = {
        order_id,
        order: header,
        lines: [{ ...added, alternates: [], point_id, carry_ms: 0, weight_pct: ci.weight_pct, max_early_ms: ci.max_early_ms, max_late_ms: ci.max_late_ms, max_carry_ms: ci.max_carry_ms, cook_ms_override, return_of }],
      };
      const plan = planOrder(state, proposed, hub.clock.branchNow(), {});
      const lines = plan.lines.map(({ order_item_id, station_id, alternates, point_id: p, carry_ms, from_stock }) => ({
        order_item_id,
        station_id,
        alternates,
        point_id: p,
        carry_ms,
        from_stock,
        weight_pct: ci.weight_pct,
        max_early_ms: ci.max_early_ms,
        max_late_ms: ci.max_late_ms,
        max_carry_ms: ci.max_carry_ms,
        return_of,
        cook_ms_override,
      }));
      return [
        onOrder(order_id, 'OrderLinesAdded', { order_id, order_item_ids: [replacement], groups: plan.groups, lines, order_header: { ...header, placed_by: o.placed_by } }),
        onOrder(order_id, 'ItemAdded', added),
        ...(mode === 'remake' ? [onOrder(order_id, 'ItemReturned', { order_item_id: original, mode, replacement_order_item_id: replacement })] : []),
      ];
    },
    'return',
  );
}

describe('02b zone-served lines at submit (§3.2 step 5, §3.10, O5)', () => {
  it('[02b #12] zone-only raita round: no EngineOrder (Q-3), no engine diagnostic, isOrderInEngine false; ItemServed { source: zone }; count − 1; 7 statements', async () => {
    await setUp({ zone: 5 });
    openSeating(hub, { table_id: FX.zoneTable, seating_id: SEAT, holder_staff_id: 'S_ALI' });
    const counted = countHandle();
    const r = await submit(signIn('S_ALI'), dineIn('O1', [zoneLine('L1')]));
    counted.restore();
    expect(r.status).toBe(200);
    // §3.2 Statements: seating 1 + lock 1 + ids 1 + follow_up 1 + zone counts 1 + item_availability 1, plus 01d's
    // alerts.listOpen for the zone subject (zoneAlertDrafts; 5 → 4 stays above the threshold 2: no raise).
    expect(counted.calls).toEqual([7]);
    expect(types(r)).toEqual(['TableLocked', 'OrderPlaced', 'ItemAdded', 'ItemServed']);
    expect(r.events[1]!.payload).toMatchObject({ order_item_ids: [], groups: [], lines: [], has_food: false });
    expect(r.events[2]!.payload).toMatchObject({ order_item_id: 'L1', served_from_zone_id: FX.zone, line_kind: 'item' });
    expect(r.events[3]).toMatchObject({ stream_type: 'order', stream_id: 'O1', payload: { order_item_ids: ['L1'], source: 'zone' } });
    expect(r.events[3]!.payload).not.toHaveProperty('served_at');
    expect(r.result!.groups).toEqual([]);
    expect(r.result!.lines).toEqual([{ order_item_id: 'L1', eta_ms: null, from_stock: false, zone_served: true }]);
    expect(engine().orders.O1).toBeUndefined();
    expect(engine().lines.L1).toBeUndefined();
    expect(isOrderInEngine(engine(), 'O1', hub.clock.branchNow())).toBe(false);
    expect(hub.logs()).not.toMatch(/engine diagnostic|absent/);
    expect(zoneCount()).toBe(4);
    expect(line('L1')).toMatchObject({ served_from_zone_id: FX.zone, served_source: 'zone', is_food: 0 });
    expect(line('L1').served_at).not.toBeNull();
    expect(stateOf()).toBe('ORDERED'); // zone items only: never green (owner Q5)
  });

  it('[02b #12] round 3 not follow_up from a zone serve alone; mains served → zone-only raita round → table stays FOOD_ON_TABLE', async () => {
    await setUp({ zone: 5 });
    openSeating(hub, { table_id: FX.zoneTable, seating_id: SEAT, holder_staff_id: 'S_ALI' });
    const ali = signIn('S_ALI');
    expect((await submit(ali, dineIn('O1', [zoneLine('L1')]))).status).toBe(200);
    const r2 = await submit(ali, dineIn('O2', [item('L2', FX.naan)]));
    expect(r2.events.find((e) => e.event_type === 'OrderPlaced')!.payload.follow_up).toBe(false); // the zone serve is not food
    expect(markServed('O2', ['L2'])).toEqual(['ItemServed', 'OrderFoodServed']);
    expect(stateOf()).toBe('FOOD_ON_TABLE');
    const r3 = await submit(ali, dineIn('O3', [zoneLine('L3')]));
    expect(r3.events.find((e) => e.event_type === 'OrderPlaced')!.payload).toMatchObject({ follow_up: true, has_food: false });
    expect(stateOf()).toBe('FOOD_ON_TABLE');
    expect(seatingOrder('O3')).toEqual({ has_food: 0, served_any: 0, cancelled: 0 });
  });

  it('[02b #12] mixed round (raita + karahi) → ORDERED until the karahi is served; batch order: kitchen ItemAdded → zone ItemAdded → ItemServed zone', async () => {
    await setUp({ zone: 5 });
    openSeating(hub, { table_id: FX.zoneTable, seating_id: SEAT, holder_staff_id: 'S_ALI' });
    const r = await submit(signIn('S_ALI'), dineIn('O1', [zoneLine('L1'), item('L2', FX.piece)]));
    expect(r.status).toBe(200);
    expect(r.events.map((e) => [e.event_type, e.payload.order_item_id ?? null])).toEqual([
      ['TableLocked', null],
      ['OrderPlaced', null],
      ['ItemAdded', 'L2'],
      ['ItemAdded', 'L1'],
      ['ItemServed', null],
    ]);
    expect(r.events[1]!.payload).toMatchObject({ order_item_ids: ['L2'], has_food: true });
    expect(r.result!.lines.map((l) => [l.order_item_id, l.zone_served, l.eta_ms === null])).toEqual([
      ['L1', true, true],
      ['L2', false, false],
    ]);
    expect(engine().lines.L2).toBeDefined();
    expect(engine().lines.L1).toBeUndefined();
    expect(hub.logs()).not.toMatch(/engine diagnostic|absent/);
    expect(stateOf()).toBe('ORDERED');
    expect(markServed('O1', ['L2'])).toEqual(['ItemServed', 'OrderFoodServed']);
    expect(stateOf()).toBe('FOOD_ON_TABLE');
  });

  it('[02b #12] mixed round whose karahi is then removed → OrderFoodCleared, table not stranded; a live no-station or ready line never blocks it (R-4); all food of a round removed → OrderFoodCleared', async () => {
    await setUp({ zone: 5 });
    openSeating(hub, { table_id: FX.zoneTable, seating_id: SEAT, holder_staff_id: 'S_ALI' });
    const ali = signIn('S_ALI');
    await submit(ali, dineIn('O1', [item('L1', FX.naan)]));
    markServed('O1', ['L1']);
    expect(stateOf()).toBe('FOOD_ON_TABLE');
    // Round 2: raita (zone) + karahi + water (ready, unserved).
    const r2 = await submit(ali, dineIn('O2', [zoneLine('L2'), item('L3', FX.piece), item('L4', FX.ready)]));
    expect(r2.status).toBe(200);
    expect(stateOf()).toBe('ORDERED');
    expect(removeLines('O2', ['L3'])).toEqual(['ItemRemoved', 'OrderFoodCleared']);
    const cleared = hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'OrderFoodCleared' AND stream_id = 'O2'`).get() as { payload: string };
    expect(JSON.parse(cleared.payload)).toEqual({ order_id: 'O2', food_served: false });
    expect(seatingOrder('O2')).toMatchObject({ has_food: 0, cancelled: 0 });
    expect(stateOf()).toBe('FOOD_ON_TABLE'); // not stranded on ORDERED by the removed karahi
    // Round 3: two food lines, both removed; the ready water keeps the order live.
    await submit(ali, dineIn('O3', [item('L5', FX.piece), item('L6', FX.naan), item('L7', FX.ready)]));
    expect(stateOf()).toBe('ORDERED');
    expect(removeLines('O3', ['L5', 'L6'])).toEqual(['ItemRemoved', 'ItemRemoved', 'OrderFoodCleared']);
    expect(stateOf()).toBe('FOOD_ON_TABLE');
    // Round 4: a deal (its header has no station) + water; both parts removed alone → the live header never blocks.
    const deal = {
      order_item_id: 'D1',
      deal_id: FX.deal,
      quantity: 1,
      deal_choices: [
        { deal_part_id: FX.dealParts[0], item_id: FX.piece, order_item_id: 'D1a' },
        { deal_part_id: FX.dealParts[1], item_id: FX.naan, order_item_id: 'D1b' },
      ],
    };
    expect((await submit(ali, dineIn('O4', [deal, item('L8', FX.ready)]))).status).toBe(200);
    expect(stateOf()).toBe('ORDERED');
    expect(removeLines('O4', ['D1a', 'D1b'])).toEqual(['ItemRemoved', 'ItemRemoved', 'OrderFoodCleared']);
    expect(stateOf()).toBe('FOOD_ON_TABLE');
  });

  it('[02b #12] owner Q5: water + raita only → ORDERED, never green; RequestBill accepted; CleanTable → TABLE_HAS_OPEN_ORDERS', async () => {
    await setUp({ zone: 5 });
    openSeating(hub, { table_id: FX.zoneTable, seating_id: SEAT, holder_staff_id: 'S_ALI' });
    const ali = signIn('S_ALI');
    await submit(ali, dineIn('O1', [item('L1', FX.ready), zoneLine('L2')]));
    expect(stateOf()).toBe('ORDERED');
    expect(markServed('O1', ['L1'])).toEqual(['ItemServed']); // water served: no OrderFoodServed
    expect(stateOf()).toBe('ORDERED');
    const ref = { table_id: FX.zoneTable, seating_id: SEAT };
    const clean = await post(ali, 'CleanTable', 'clean-table', ref);
    expect(clean.status).toBe(409);
    expect(clean.error!.code).toBe('TABLE_HAS_OPEN_ORDERS');
    const bill = await post(ali, 'RequestBill', 'request-bill', ref);
    expect(bill.status).toBe(200);
    expect(types(bill)).toContain('BillRequested');
    expect(stateOf()).toBe('BILL_REQUESTED');
    expect((await post(ali, 'CleanTable', 'clean-table', ref)).error!.code).toBe('TABLE_HAS_OPEN_ORDERS');
  });

  it('[02b #12] drinks round after mains → stays green; karahi + water round → green only on the karahi; the counter bottle served → no OrderFoodServed', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.zoneTable, seating_id: SEAT, holder_staff_id: 'S_ALI' });
    const ali = signIn('S_ALI');
    await submit(ali, dineIn('O1', [item('L1', FX.piece)]));
    markServed('O1', ['L1']);
    expect(stateOf()).toBe('FOOD_ON_TABLE');
    const drinks = await submit(ali, dineIn('O2', [item('L2', FX.ready)]));
    expect(drinks.events.find((e) => e.event_type === 'ItemAdded')!.payload.station_id).toBe(FX.zoneStation); // the counter
    expect(stateOf()).toBe('FOOD_ON_TABLE');
    await submit(ali, dineIn('O3', [item('L3', FX.piece), item('L4', FX.ready)]));
    expect(stateOf()).toBe('ORDERED');
    expect(markServed('O3', ['L4'])).toEqual(['ItemServed']);
    expect(stateOf()).toBe('ORDERED'); // the karahi still cooks
    expect(markServed('O3', ['L3'])).toEqual(['ItemServed', 'OrderFoodServed']);
    expect(stateOf()).toBe('FOOD_ON_TABLE');
  });

  it('[02b #12] reheated karahi from stock served → OrderFoodServed (a pre-cooked item is food unless marked ready)', async () => {
    await setUp({ stock: { [FX.stock]: 1_000 } });
    openSeating(hub, { table_id: FX.zoneTable, seating_id: SEAT, holder_staff_id: 'S_ALI' });
    const r = await submit(signIn('S_ALI'), dineIn('O1', [item('L1', FX.piece)]));
    expect(r.result!.lines[0]!.from_stock).toBe(true);
    expect(line('L1').is_food).toBe(1);
    expect(markServed('O1', ['L1'])).toEqual(['ItemServed', 'OrderFoodServed']);
    expect(stateOf()).toBe('FOOD_ON_TABLE');
  });

  it('[02b #12] remake → serve the replacement → FOOD_ON_TABLE (M-5)', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.zoneTable, seating_id: SEAT, holder_staff_id: 'S_ALI' });
    await submit(signIn('S_ALI'), dineIn('O1', [item('L1', FX.piece)]));
    markServed('O1', ['L1']);
    expect(returnLine('O1', 'L1', 'L1r', 'remake')).toEqual(['OrderLinesAdded', 'ItemAdded', 'ItemReturned']); // food returned: no clear
    expect(stateOf()).toBe('ORDERED');
    expect(markServed('O1', ['L1r'])).toEqual(['ItemServed', 'OrderFoodServed']);
    expect(stateOf()).toBe('FOOD_ON_TABLE');
  });

  it('[02b #12] remake then remove the replacement → OrderFoodCleared { food_served: true }, table FOOD_ON_TABLE (N-2)', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.zoneTable, seating_id: SEAT, holder_staff_id: 'S_ALI' });
    await submit(signIn('S_ALI'), dineIn('O1', [item('L1', FX.piece)]));
    markServed('O1', ['L1']);
    returnLine('O1', 'L1', 'L1r', 'remake');
    expect(stateOf()).toBe('ORDERED');
    expect(removeLines('O1', ['L1r'])).toEqual(['ItemRemoved', 'OrderFoodCleared']);
    expect(hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'OrderFoodCleared'`).get()).toEqual({ payload: JSON.stringify({ order_id: 'O1', food_served: true }) });
    expect(stateOf()).toBe('FOOD_ON_TABLE');
  });

  it('[02b #12] water fix return → OrderFoodCleared { food_served: true }, table unchanged', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.zoneTable, seating_id: SEAT, holder_staff_id: 'S_ALI' });
    await submit(signIn('S_ALI'), dineIn('O1', [item('L1', FX.piece), item('L2', FX.ready)]));
    markServed('O1', ['L1', 'L2']);
    expect(stateOf()).toBe('FOOD_ON_TABLE');
    expect(returnLine('O1', 'L2', 'L2r', 'fix')).toEqual(['OrderLinesAdded', 'ItemAdded', 'OrderFoodCleared']);
    expect(hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'OrderFoodCleared'`).get()).toEqual({ payload: JSON.stringify({ order_id: 'O1', food_served: true }) });
    expect(stateOf()).toBe('FOOD_ON_TABLE');
  });

  it('[02b #12] water served, then returned while the karahi cooks → no OrderFoodCleared; ORDERED until the karahi’s OrderFoodServed → green (N-1)', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.zoneTable, seating_id: SEAT, holder_staff_id: 'S_ALI' });
    await submit(signIn('S_ALI'), dineIn('O1', [item('L1', FX.piece), item('L2', FX.ready)]));
    markServed('O1', ['L2']);
    expect(returnLine('O1', 'L2', 'L2r', 'remake')).toEqual(['OrderLinesAdded', 'ItemAdded', 'ItemReturned']);
    expect(stateOf()).toBe('ORDERED');
    expect(markServed('O1', ['L1'])).toEqual(['ItemServed', 'OrderFoodServed']);
    expect(stateOf()).toBe('FOOD_ON_TABLE');
  });

  it('[02b #12] food reaching an order cleared earlier → OrderFoodServed sets has_food = 1 (02a fold)', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.zoneTable, seating_id: SEAT, holder_staff_id: 'S_ALI' });
    await submit(signIn('S_ALI'), dineIn('O1', [item('L1', FX.piece), item('L2', FX.ready)]));
    removeLines('O1', ['L1']);
    expect(seatingOrder('O1')).toMatchObject({ has_food: 0, served_any: 0 });
    expect(stateOf()).toBe('ORDERED'); // no live food order
    // The OrderFoodServed a serve of a food line of this order appends (§3.3; 02a folds has_food = 1 with served_any).
    another('O1', () => [onOrder('O1', 'OrderFoodServed', { order_id: 'O1' })], { kind: 'served', order_item_ids: [] });
    expect(seatingOrder('O1')).toMatchObject({ has_food: 1, served_any: 1 });
    expect(stateOf()).toBe('FOOD_ON_TABLE');
  });

  it('[02b #12] replay of orders and tables registered in either order → the same state over a zone day', async () => {
    await setUp({ zone: 6 });
    openSeating(hub, { table_id: FX.zoneTable, seating_id: SEAT, holder_staff_id: 'S_ALI' });
    const ali = signIn('S_ALI');
    await submit(ali, dineIn('O1', [item('L1', FX.naan)]));
    markServed('O1', ['L1']);
    await submit(ali, dineIn('O2', [zoneLine('L2', 2)]));
    await submit(ali, dineIn('O3', [zoneLine('L3'), item('L4', FX.piece), item('L5', FX.ready)]));
    removeLines('O3', ['L4']);
    await submit(ali, dineIn('O4', [item('L6', FX.piece)]));
    markServed('O4', ['L6']);
    returnLine('O4', 'L6', 'L6r', 'remake');
    removeLines('O2', ['L2']); // a zone undo: the count goes back up
    const dump = () => {
      const q = (sql: string) => hub.deps.db.prepare(sql).all();
      return {
        orders: q('SELECT * FROM orders ORDER BY order_id'),
        order_lines: q('SELECT * FROM order_lines ORDER BY order_item_id'),
        zone_stock: q('SELECT * FROM zone_stock ORDER BY zone_id, item_id'),
        seatings: q('SELECT * FROM seatings ORDER BY seating_id'),
        seating_orders: q('SELECT * FROM seating_orders ORDER BY order_id'),
      };
    };
    const live = dump();
    expect(live.zone_stock).toEqual([{ zone_id: FX.zone, item_id: FX.zoneItem, on_hand: 5 }]);
    expect(stateOf()).toBe('ORDERED'); // O4's replacement is unserved
    const replayWith = (register: Array<(r: ReturnType<typeof createProjectionRegistry>) => void>) => {
      hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection IN ('orders', 'tables')`).run();
      const registry = createProjectionRegistry();
      for (const r of register) r(registry);
      registry.catchUp(hub.deps.db, hub.deps.config.provisioned!.branch_id);
      return dump();
    };
    expect(replayWith([registerOrdersProjection, registerTablesProjection])).toEqual(live);
    expect(replayWith([registerTablesProjection, registerOrdersProjection])).toEqual(live);
  });

  it('[02b #13] two raita lines of 4 with 6 left in one payload → the first zone-served, the second a kitchen line; no 500, no 409; zone_stock_low raised last', async () => {
    await setUp({ zone: 6 });
    openSeating(hub, { table_id: FX.zoneTable, seating_id: SEAT, holder_staff_id: 'S_ALI' });
    const r = await submit(signIn('S_ALI'), dineIn('O1', [zoneLine('L1', 4), zoneLine('L2', 4)]));
    expect(r.status).toBe(200);
    expect(r.result!.lines.map((l) => [l.order_item_id, l.zone_served])).toEqual([
      ['L1', true],
      ['L2', false],
    ]);
    const placed = r.events.find((e) => e.event_type === 'OrderPlaced')!.payload;
    expect(placed).toMatchObject({ order_item_ids: ['L2'], has_food: true });
    const added = r.events.filter((e) => e.event_type === 'ItemAdded').map((e) => [e.payload.order_item_id, e.payload.served_from_zone_id, e.payload.station_id]);
    expect(added).toEqual([
      ['L2', null, FX.station], // routed per step 6 (no zone route for the item: the branch route)
      ['L1', FX.zone, FX.station],
    ]);
    // §3.2 step 10: ItemServed zone, then the zone alert drafts last (6 → 2 reaches the threshold 2).
    const order = types(r);
    expect(order.slice(0, 5)).toEqual(['TableLocked', 'OrderPlaced', 'ItemAdded', 'ItemAdded', 'ItemServed']);
    expect(order.slice(5)[0]).toBe('AlertRaised');
    const raised = r.events.filter((e) => e.event_type === 'AlertRaised').map((e) => [e.payload.kind, e.payload.dedupe_key]);
    expect(raised).toEqual([['zone_stock_low', `zone_low:${FX.zone}:${FX.zoneItem}`]]);
    expect(zoneCount()).toBe(2);
    expect(engine().lines.L2).toBeDefined();
  });

  it('[02b #13] two submits on the last raita: one zone-served, the other a kitchen line; the count reaches 0 → zone_stock_out', async () => {
    await setUp({ zone: 1 });
    openSeating(hub, { table_id: FX.zoneTable, seating_id: SEAT, holder_staff_id: 'S_ALI' });
    const ali = signIn('S_ALI');
    const [a, b] = await Promise.all([submit(ali, dineIn('O1', [zoneLine('L1')])), submit(ali, dineIn('O2', [zoneLine('L2')]))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.result!.lines[0]!.zone_served, b.result!.lines[0]!.zone_served].sort()).toEqual([false, true]);
    expect(zoneCount()).toBe(0);
    const raised = [...a.events, ...b.events].filter((e) => e.event_type === 'AlertRaised').map((e) => e.payload.kind);
    expect(raised).toEqual(['zone_stock_out']); // 1 was already at or below the threshold: no low raise
  });

  it('[02b #13] a queued replay with the zone emptied meanwhile → accepted, the zone line sent to its station (M-4)', async () => {
    await setUp({ zone: 3 });
    openSeating(hub, { table_id: FX.zoneTable, seating_id: SEAT, holder_staff_id: 'S_ALI' });
    const queuedAt = hub.clock.branchNow();
    setZoneStock(hub, FX.zone, FX.zoneItem, 0, 3);
    hub.clock.advance(60_000);
    const r = await submit(signIn('S_ALI'), dineIn('O1', [zoneLine('L1')]), { queuedAt });
    expect(r.status).toBe(200);
    expect(r.result!.lines).toEqual([{ order_item_id: 'L1', eta_ms: expect.any(Number), from_stock: false, zone_served: false }]);
    expect(types(r)).toEqual(['OrderPlaced', 'ItemAdded']);
    expect(r.events[0]!.payload).toMatchObject({ order_item_ids: ['L1'], sent_after_reconnect: true });
    expect(r.events[1]!.payload).toMatchObject({ station_id: FX.station, served_from_zone_id: null });
    expect(engine().lines.L1).toBeDefined();
    expect(zoneCount()).toBe(0);
  });

  it('[02b §3.2 step 5] any check failing → a kitchen line, never a refusal: no zone, item not of the zone, options, takeaway; no candidate → no zone read', async () => {
    const m = menu();
    // The karahi (has an option group) is also a zone item here, so a from_zone karahi with options is a candidate check.
    m.floors[0]!.zones[0]!.stock_items.push({ item_id: FX.piece, threshold: 0 });
    hub = await createTestHub();
    await seedDirectory(hub, await directory());
    openDay(hub, { menu: m });
    setZoneStock(hub, FX.zone, FX.zoneItem, 9);
    setZoneStock(hub, FX.zone, FX.piece, 9);
    openSeating(hub, { table_id: FX.zoneTable, seating_id: SEAT, holder_staff_id: 'S_ALI' });
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT2', holder_staff_id: 'S_ALI' });
    const ali = signIn('S_ALI');
    const counted = countHandle();
    const noZone = await submit(ali, dineIn('O1', [zoneLine('L1')], 'SEAT2', FX.table));
    const notZoneItem = await submit(ali, dineIn('O2', [item('L2', FX.naan, 1, { from_zone: true })]));
    const withOptions = await submit(ali, dineIn('O3', [item('L3', FX.piece, 1, { from_zone: true, options: [{ option_id: FX.option, quantity: 1, order_item_id: 'L3o' }] })]));
    const notMarked = await submit(ali, dineIn('O4', [item('L4', FX.zoneItem)]));
    const take = await submit(ali, { order_id: 'O5', order_type: 'takeaway', lines: [zoneLine('L5')] });
    counted.restore();
    for (const r of [noZone, notZoneItem, withOptions, notMarked, take]) {
      expect(r.status).toBe(200);
      expect(r.result!.lines.every((l) => !l.zone_served)).toBe(true);
      expect(types(r)).not.toContain('ItemServed');
    }
    // dine-in without a candidate: 5 (no zone read); takeaway: ids + token + item_availability.
    expect(counted.calls).toEqual([5, 5, 5, 5, 3]);
    expect(zoneCount()).toBe(9);
  });
});
