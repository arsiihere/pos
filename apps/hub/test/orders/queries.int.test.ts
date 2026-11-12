import type { EngineState } from '@pos/engine';
import type { DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { ordersCatchUpPart } from '../../src/orders/catch-up';
import type { openOrdersBody } from '../../src/orders/queries/open-orders';
import type { seatingOrdersBody } from '../../src/orders/queries/seating-orders';
import type { ZoneStockBody } from '../../src/orders/queries/zone-stock';
import { seatingTotals } from '../../src/orders/exports';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { TABLE_EVENT_TYPES } from '../../src/tables/audiences';
import { TABLES_EVENT_TYPES } from '../../src/tables/projection';
import { audienceAllows } from '../../src/ws/audience';
import type { SocketCtx } from '../../src/ws/catch-up';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { appendOrder, FX, openDay, openSeating, setZoneStock } from './fixtures';

// 02b v1.0.3 §6.15 seating-orders, §6.16 open-orders, §6.17 zone-stock, §6.18 order-contact, catch-up part `orders`,
// §6.19 Audiences, O17, §7 (Logs, Privacy); §10 #30 (open orders), #32, #33; board AD-6, AD-24. State is seeded with
// real events through the hub writer (fixtures.ts, SubmitOrder, AddZoneStock); queries go through the HTTP route.

const OT1 = 'S_OT1'; // default order taker (view-customer-contact own_tables, apply-comp with approval)
const OT2 = 'S_OT2'; // default order taker
const WAITER = 'S_WAITER'; // default waiter: mark-served only
const CASHIER = 'S_CASHIER'; // default cashier: view-customer-contact branch, apply-comp with approval
const MGR = 'S_MGR'; // aDirectory's manager: every permission at branch (a 01d `managers` member)
const FLOOR = 'S_FLOOR'; // view-customer-contact my_floors, floor F1

type Scope = 'branch' | 'own_tables' | 'my_floors';
function grant(permission: string, grant_type: 'allowed' | 'requires_approval' = 'allowed', scope: Scope = 'branch') {
  return {
    permission,
    grant_type,
    approver_role_id: grant_type === 'requires_approval' ? 'R_MGR' : null,
    approver_role_ids: grant_type === 'requires_approval' ? ['R_MGR'] : [],
    scope,
  };
}

/** 02b §3.14 defaults (as the hub receives them) for order taker, waiter and cashier. */
async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const person = (staff_id: string, display_name: string, role_id: string, floor_ids: string[] = []) => ({
    staff_id,
    display_name,
    pin_hash: pin,
    role_ids: [role_id],
    denied_permissions: [],
    lead_staff_id: null,
    floor_ids,
  });
  const role = (role_id: string, permissions: ReturnType<typeof grant>[]) => ({ role_id, name: role_id, session_idle_ttl_ms: 3_600_000, permissions });
  return {
    ...base,
    roles: [
      ...base.roles,
      role('R_DEF_TAKER', [
        grant('take-order'),
        grant('mark-served'),
        grant('mark-item-returned'),
        grant('boost-order'),
        grant('view-customer-contact', 'allowed', 'own_tables'),
        grant('apply-comp', 'requires_approval'),
      ]),
      role('R_DEF_WAITER', [grant('mark-served')]),
      role('R_FLOOR_CONTACT', [grant('take-order'), grant('view-customer-contact', 'allowed', 'my_floors')]),
      role('R_DEF_CASH', [grant('take-order'), grant('set-line-weight'), grant('apply-comp', 'requires_approval'), grant('view-customer-contact')]),
    ],
    staff: [
      ...base.staff,
      person(OT1, 'Usman', 'R_DEF_TAKER'),
      person(OT2, 'Omar', 'R_DEF_TAKER'),
      person(WAITER, 'Wasim', 'R_DEF_WAITER'),
      person(CASHIER, 'Hina', 'R_DEF_CASH'),
      person(FLOOR, 'Fahad', 'R_FLOOR_CONTACT', [FX.floor]),
    ],
  };
}

let hub: TestHub;
let day: { business_date: string };

beforeEach(async () => {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  day = openDay(hub);
});

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  activity.drain();
  swapBranchConfig(null);
  await hub.close();
});

// ------------------------------------------------------------------------------------------- seeding

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
const served = (order_id: string, ...order_item_ids: string[]) => append(draft('order', order_id, 'ItemServed', { order_item_ids, source: 'tap' }));
const closeDay = () => append(draft('hub', 'branch-1', 'BusinessDayClosed', {}, 'S_MGR'));

interface Who {
  staffId: string;
  deviceId: string;
  token: string;
  sessionId: string;
  sessionToken: string;
}

function signIn(staffId: string, type: 'tablet' | 'cashier_kiosk' = 'tablet'): Who {
  const device = pairDevice(hub, { type });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, token: device.token, sessionId: session.sessionId, sessionToken: session.token };
}

type Seating = ReturnType<typeof seatingOrdersBody>;
type Open = ReturnType<typeof openOrdersBody>;
type Zones = ZoneStockBody[];

async function query<T = unknown>(who: Who, path: string): Promise<{ status: number; data: T; error?: { code: string; details: Record<string, unknown> } }> {
  const res = await hub.app.inject({
    method: 'GET',
    url: `/queries/${path}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
  });
  const body = res.json() as { data: T; error?: { code: string; details: Record<string, unknown> } };
  return { status: res.statusCode, data: body.data, error: body.error };
}

let commandSeq = 0;
async function command(who: Who, path: string, command_type: string, payload: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${path}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
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
  return { status: res.statusCode, body: res.json() };
}

const sockets: WsClient[] = [];

async function authed(who: { token: string; sessionToken: string }): Promise<WsClient> {
  const ws = await connectWs(hub.app);
  sockets.push(ws);
  ws.send({ type: 'auth', device_token: who.token, session_token: who.sessionToken });
  await ws.untilCount(1);
  return ws;
}

async function stationSocket(): Promise<WsClient> {
  const kds = pairDevice(hub, { type: 'kds', stationId: FX.station });
  const session = openSession(hub, { kind: 'station', deviceId: kds.deviceId, stationId: FX.station });
  return authed({ token: kds.token, sessionToken: session.token });
}

function frames(ws: WsClient): Array<{ event_type: string; payload: Record<string, unknown> }> {
  return ws.messages
    .filter((m) => (m as { type?: string }).type === 'event')
    .map((m) => (m as { event: { event_type: string; payload: Record<string, unknown> } }).event);
}
const typesOf = (ws: WsClient) => frames(ws).map((f) => f.event_type);
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

function catchUpOrders(ws: WsClient): { orders: Array<Record<string, unknown>>; zone_stock: unknown } {
  const first = ws.messages[0] as { type: string; state: Record<string, unknown> };
  expect(first.type).toBe('catch_up');
  return first.state.orders as { orders: Array<Record<string, unknown>>; zone_stock: unknown };
}

function socketCtx(o: Partial<SocketCtx>): SocketCtx {
  return { deviceId: 'D1', deviceType: 'tablet', sessionId: 'X1', kind: 'staff', staffId: OT1, stationId: null, asOfSeq: 0, ...o };
}

// ------------------------------------------------------------------------------------------- §6.15

describe('seating-orders (§6.15)', () => {
  it('[02b §6.15] the seating\'s orders by placed_at: placed_by with name, flags, has_phone, lines (LineView + engine stage), total_minor = seatingTotals', async () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: OT1 });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: 'O1', placed_by: OT1, lines: [{ order_item_id: 'A1', item_id: FX.piece }, { order_item_id: 'A2', item_id: FX.naan, quantity: 2 }] });
    hub.clock.advance(5_000);
    appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'SEAT1',
      order_id: 'O2',
      placed_by: OT2,
      lines: [
        { order_item_id: 'B1', deal_id: FX.deal },
        { order_item_id: 'B1a', deal_id: FX.deal, deal_part_id: FX.dealParts[0], item_id: FX.piece, parent_order_item_id: 'B1' },
        { order_item_id: 'B1b', deal_id: FX.deal, deal_part_id: FX.dealParts[1], item_id: FX.naan, parent_order_item_id: 'B1' },
      ],
    });
    hub.clock.advance(5_000);
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: 'O3', placed_by: OT1, lines: [{ order_item_id: 'C1', item_id: FX.naan }] });
    append(draft('order', 'O3', 'OrderCancelled', { order_id: 'O3' }));
    fire('A1', 'B1a');
    start('O1', 'A1');

    const who = signIn(WAITER);
    const r = await query<Seating>(who, 'seating-orders?seating_id=SEAT1');
    expect(r.status).toBe(200);
    const body = r.data;
    expect(body.orders.map((o) => o.order_id)).toEqual(['O1', 'O2', 'O3']);
    expect(body.orders[0]).toMatchObject({ placed_by: { staff_id: OT1, name: 'Usman' }, follow_up: false, cancelled: false, billed: false, has_phone: false });
    expect(body.orders[1]!.placed_by).toEqual({ staff_id: OT2, name: 'Omar' });
    expect(body.orders[2]!.cancelled).toBe(true);
    const lines = new Map(body.orders.flatMap((o) => o.lines.map((l) => [l.order_item_id, l] as const)));
    expect(lines.get('A1')).toMatchObject({ order_id: 'O1', line_kind: 'item', stage: 'cooking', fired: true, live_units: 1 });
    expect(lines.get('A2')).toMatchObject({ stage: 'added', fired: false, units: 2 });
    expect(lines.get('B1')).toMatchObject({ line_kind: 'deal', stage: null, fired: false }); // a deal header is never in the engine (never served)
    expect(lines.get('B1a')).toMatchObject({ stage: 'added', fired: true }); // fired, not started
    expect(lines.get('B1b')).toMatchObject({ stage: 'added', fired: false });
    // S-1 (d): the order-level promise (EngineOrder.promise_ms), no per-group list
    expect(body.orders[0]!.promise_ms).toBe(engine().orders.O1!.promise_ms);
    expect(body.orders[1]!.promise_ms).toBe(engine().orders.O2!.promise_ms);
    expect(body.orders[0]).not.toHaveProperty('groups');
    // total = seatingTotals (live orders only: the cancelled O3 is out)
    expect(body.total_minor).toBe(seatingTotals(hub.deps.db, 'SEAT1').total_minor);
    expect(body.total_minor).toBeGreaterThan(0);
    // contact never here (O17)
    expect(JSON.stringify(body)).not.toMatch(/customer_name|"phone"/);

    const none = await query(who, 'seating-orders?seating_id=NOPE');
    expect(none.data).toEqual({ orders: [], total_minor: 0 });
    expect((await query(who, 'seating-orders')).error?.code).toBe('VALIDATION_FAILED');
  });

  it('[02b §6.15 O16] a line of an order out of the engine (abandoned) shows stage out_of_engine', async () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: OT1 });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: 'O1', lines: [{ order_item_id: 'A1', item_id: FX.piece }] });
    fire('A1');
    hub.clock.advance(5 * 3_600_000); // past order_abandon_ms (4 h) and the planned land
    const r = await query<Seating>(signIn(OT1), 'seating-orders?seating_id=SEAT1');
    expect(r.data.orders[0]!.lines[0]!.stage).toBe('out_of_engine');
    // O16: a line of an order that left the engine counts as fired (Mark served allowed); no promise out of the engine
    expect(r.data.orders[0]!.lines[0]!.fired).toBe(true);
    expect(r.data.orders[0]!.promise_ms).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------- #29 merge

describe('[02b #29 merge] grouping after a merge (§3.3: 02a\'s current seating_orders)', () => {
  // T4 = FX.zoneTable (surviving seating S_T4), T5 = FX.table (absorbed seating S_T5); the merge is 02a's real
  // TablesMerged event through the hub writer (as exports.int.test.ts `[02b #29 exports]`).
  const merge = () =>
    append(
      draft('table', FX.zoneTable, 'TablesMerged', {
        into_seating_id: 'S_T4',
        into_table_id: FX.zoneTable,
        table_ids: [FX.table],
        absorbed_seating_id: 'S_T5',
        order_ids: ['O5'],
        by_staff_id: OT1,
      }, OT1),
    );
  const round = (order_id: string, order_item_id: string) => ({
    order_id,
    order_type: 'dine_in',
    table_id: FX.zoneTable,
    seating_id: 'S_T4',
    lines: [{ order_item_id, item_id: FX.naan, quantity: 1 }],
  });
  const followUp = (order_id: string) =>
    (hub.deps.db.prepare('SELECT follow_up FROM orders WHERE order_id = ?').get(order_id) as { follow_up: number }).follow_up;

  it('[02b #29 merge] merge T5 into T4: seating-orders for T4\'s seating lists T5\'s order; T5\'s seating lists none', async () => {
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'S_T4', holder_staff_id: OT1 });
    openSeating(hub, { table_id: FX.table, seating_id: 'S_T5', holder_staff_id: OT2 });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'S_T4', order_id: 'O4', placed_by: OT1, lines: [{ order_item_id: 'A1', item_id: FX.naan }] });
    hub.clock.advance(5_000);
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'S_T5', order_id: 'O5', placed_by: OT2, lines: [{ order_item_id: 'B1', item_id: FX.piece }, { order_item_id: 'B2', item_id: FX.naan }] });
    const who = signIn(WAITER);
    expect((await query<Seating>(who, 'seating-orders?seating_id=S_T4')).data.orders.map((o) => o.order_id)).toEqual(['O4']);

    merge();

    const t4 = (await query<Seating>(who, 'seating-orders?seating_id=S_T4')).data;
    expect(t4.orders.map((o) => o.order_id)).toEqual(['O4', 'O5']);
    expect(t4.orders[1]!.placed_by).toEqual({ staff_id: OT2, name: 'Omar' });
    expect(t4.orders[1]!.lines.map((l) => l.order_item_id)).toEqual(['B1', 'B2']);
    expect(t4.total_minor).toBe(seatingTotals(hub.deps.db, 'S_T4').total_minor);
    expect(seatingTotals(hub.deps.db, 'S_T4').order_count).toBe(2);
    expect((await query<Seating>(who, 'seating-orders?seating_id=S_T5')).data).toEqual({ orders: [], total_minor: 0 });
  });

  it('[02b #29 merge] follow_up of a round on the merged seating is true from a served food line of the absorbed seating\'s order (§3.3)', async () => {
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'S_T4', holder_staff_id: OT1 });
    openSeating(hub, { table_id: FX.table, seating_id: 'S_T5', holder_staff_id: OT2 });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'S_T4', order_id: 'O4', placed_by: OT1, lines: [{ order_item_id: 'A1', item_id: FX.naan }] });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'S_T5', order_id: 'O5', placed_by: OT2, lines: [{ order_item_id: 'B1', item_id: FX.piece }] });
    fire('B1');
    served('O5', 'B1'); // the karahi of T5's order: a food line, served
    const ot1 = signIn(OT1);

    // before the merge: T4's own orders have no served food line → false
    const before = await command(ot1, 'submit-order', 'SubmitOrder', round('O4b', 'A2'));
    expect(before.status).toBe(200);
    expect(followUp('O4b')).toBe(0);

    merge();

    const after = await command(ot1, 'submit-order', 'SubmitOrder', round('O4c', 'A3'));
    expect(after.status).toBe(200);
    expect(followUp('O4c')).toBe(1);
    expect(engine().orders.O4c!.follow_up).toBe(true);
    const placed = hub.deps.db
      .prepare("SELECT payload FROM events WHERE event_type = 'OrderPlaced' AND stream_id = 'O4c'")
      .get() as { payload: string };
    expect(JSON.parse(placed.payload)).toMatchObject({ follow_up: true, table_key: 'dine_in:S_T4' });
  });
});

// ------------------------------------------------------------------------------------------- §6.16

describe('open-orders (§6.16)', () => {
  it('[02b #30 open-orders] [02b §6.16 R5] a carried takeaway shows under the next day with its date (and with no open day, every order has its date); finished ones leave at the close; ready n / m; by promise', async () => {
    appendOrder(hub, { order_type: 'takeaway', order_id: 'TA', lines: [{ order_item_id: 'TA1', item_id: FX.piece }, { order_item_id: 'TA2', item_id: FX.naan }] });
    appendOrder(hub, { order_type: 'takeaway', order_id: 'TB', lines: [{ order_item_id: 'TB1', item_id: FX.naan }] });
    appendOrder(hub, { order_type: 'parking', order_id: 'PC', car_number: 'LEB-77', lines: [{ order_item_id: 'PC1', item_id: FX.naan }] });
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: 'DI', lines: [{ order_item_id: 'DI1', item_id: FX.naan }] });
    fire('TA2', 'TB1');
    done('TA', 'TA2');
    served('TB', 'TB1');

    const who = signIn(CASHIER);
    const before = await query<Open>(who, 'open-orders');
    expect(before.status).toBe(200);
    const rows = before.data.orders;
    // non-table orders only (the dine-in DI is the table view's)
    expect(rows.map((o) => o.order_id).sort()).toEqual(['PC', 'TA', 'TB']);
    const ta = rows.find((o) => o.order_id === 'TA')!;
    expect(ta).toMatchObject({ order_type: 'takeaway', token: 1, car_number: null, has_phone: false, ready: { n: 1, m: 2 }, business_date: day.business_date, from_date: null, abandoned: false });
    expect(ta.promise_ms).toBe(engine().orders.TA!.promise_ms);
    expect(rows.find((o) => o.order_id === 'TB')!.ready).toEqual({ n: 1, m: 1 });
    expect(rows.find((o) => o.order_id === 'PC')).toMatchObject({ order_type: 'parking', token: null, car_number: 'LEB-77', car_type: 'sedan' });
    // by promise
    const promises = rows.map((o) => o.promise_ms as number);
    expect([...promises].sort((a, b) => a - b)).toEqual(promises);
    // order_type filter
    expect((await query<Open>(who, 'open-orders?order_type=parking')).data.orders.map((o) => o.order_id)).toEqual(['PC']);
    expect((await query<Open>(who, 'open-orders?order_type=takeaway')).data.orders.map((o) => o.order_id).sort()).toEqual(['TA', 'TB']);
    expect((await query(who, 'open-orders?order_type=dine_in')).error?.code).toBe('VALIDATION_FAILED');

    // day close: the served TB leaves; TA (a line still cooking) and PC (unserved) stay, shown under the next day with their date
    closeDay();
    // [02b §6.16 R5] (v1.0.4; owner 2026-11-11 G-1): while no day is open, every order gets from_date = its business_date,
    // although the engine still holds the closed day (closed_at set)
    expect(engine().business_day).toMatchObject({ business_date: day.business_date });
    expect(engine().business_day!.closed_at).not.toBeNull();
    const closed = (await query<Open>(who, 'open-orders')).data.orders;
    expect(closed.map((o) => o.order_id).sort()).toEqual(['PC', 'TA']);
    for (const o of closed) expect(o).toMatchObject({ business_date: day.business_date, from_date: day.business_date });
    hub.clock.advance(24 * 3_600_000);
    const next = openDay(hub);
    expect(next.business_date).not.toBe(day.business_date);
    const after = (await query<Open>(signIn(CASHIER), 'open-orders')).data.orders;
    expect(after.map((o) => o.order_id).sort()).toEqual(['PC', 'TA']);
    expect(after.find((o) => o.order_id === 'TA')).toMatchObject({ business_date: day.business_date, from_date: day.business_date });
  });

  it('[02b §6.16 R2] an order with no engine lines (only no-station / ready / zone-served lines) is never in the abandoned list', async () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'SEAT2' });
    setZoneStock(hub, FX.zone, FX.zoneItem, 5);
    const noStation = { station_id: null }; // a counter item with no station: never in the engine
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: 'RDY', lines: [{ order_item_id: 'R1', item_id: FX.ready }] });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: 'NOS', lines: [{ order_item_id: 'N1', item_id: FX.naan, item: noStation }] });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT2', order_id: 'ZON', lines: [{ order_item_id: 'Z1', item_id: FX.zoneItem, from_zone: true }] });
    appendOrder(hub, { order_type: 'takeaway', order_id: 'TRDY', lines: [{ order_item_id: 'TR1', item_id: FX.ready }] });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: 'DI', lines: [{ order_item_id: 'DI1', item_id: FX.piece }] });
    fire('R1', 'TR1', 'DI1');
    hub.clock.advance(5 * 3_600_000); // every engine order fired, never tapped: out of the engine with unserved lines
    const all = (await query<Open>(signIn(MGR), 'open-orders?abandoned=true')).data.orders;
    expect(all.filter((o) => o.abandoned).map((o) => o.order_id)).toEqual(['DI']); // the karahi order still shows
    expect(all.map((o) => o.order_id).sort()).toEqual(['DI', 'TRDY']); // the ready takeaway is listed as a takeaway, not abandoned
  });

  it('[02b §6.16 R2] an order with a food line stays abandoned on any live unserved line: karahi served, water fired never tapped → listed', async () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: 'MIX', lines: [{ order_item_id: 'M1', item_id: FX.piece }, { order_item_id: 'M2', item_id: FX.ready }] });
    fire('M1', 'M2');
    served('MIX', 'M1');
    hub.clock.advance(5 * 3_600_000); // the water is never tapped: the order leaves the engine with it unserved
    const all = (await query<Open>(signIn(MGR), 'open-orders?abandoned=true')).data.orders;
    expect(all.find((o) => o.order_id === 'MIX')).toMatchObject({ order_type: 'dine_in', abandoned: true });
  });

  it('[02b §6.16 R12] abandoned: true with an order_type adds the abandoned orders of every type', async () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: 'DI', lines: [{ order_item_id: 'DI1', item_id: FX.piece }] });
    appendOrder(hub, { order_type: 'takeaway', order_id: 'TA', lines: [{ order_item_id: 'TA1', item_id: FX.piece }] });
    appendOrder(hub, { order_type: 'takeaway', order_id: 'TB', lines: [{ order_item_id: 'TB1', item_id: FX.naan }] });
    appendOrder(hub, { order_type: 'parking', order_id: 'PC', lines: [{ order_item_id: 'PC1', item_id: FX.naan }] });
    fire('DI1', 'TA1');
    hub.clock.advance(5 * 3_600_000);
    const rows = (await query<Open>(signIn(MGR), 'open-orders?abandoned=true&order_type=parking')).data.orders;
    expect(rows.map((o) => o.order_id).sort()).toEqual(['DI', 'PC', 'TA']); // TB (takeaway, not abandoned) stays out
  });

  it('[02b §6.16 abandoned] abandoned: true (managers) adds orders of any type with no tap for order_abandon_ms; others → 403', async () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: 'DI', lines: [{ order_item_id: 'DI1', item_id: FX.piece }] });
    appendOrder(hub, { order_type: 'takeaway', order_id: 'TA', lines: [{ order_item_id: 'TA1', item_id: FX.piece }] });
    appendOrder(hub, { order_type: 'takeaway', order_id: 'TB', lines: [{ order_item_id: 'TB1', item_id: FX.naan }] });
    fire('DI1', 'TA1');
    hub.clock.advance(5 * 3_600_000); // DI and TA: fired, never tapped → out of the engine with unserved lines; TB unfired stays in
    const mgr = signIn(MGR);
    const all = (await query<Open>(mgr, 'open-orders?abandoned=true')).data.orders;
    expect(all.map((o) => o.order_id).sort()).toEqual(['DI', 'TA', 'TB']);
    expect(all.find((o) => o.order_id === 'DI')).toMatchObject({ order_type: 'dine_in', abandoned: true, promise_ms: null, table_key: 'dine_in:SEAT1' });
    expect(all.find((o) => o.order_id === 'TA')!.abandoned).toBe(true);
    expect(all.find((o) => o.order_id === 'TB')!.abandoned).toBe(false);
    // without the flag: non-table orders only
    expect((await query<Open>(mgr, 'open-orders')).data.orders.map((o) => o.order_id).sort()).toEqual(['TA', 'TB']);
    // not a manager (01d `managers`: branch-scope force-release-table-lock)
    const denied = await query(signIn(CASHIER), 'open-orders?abandoned=true');
    expect(denied.status).toBe(403);
    expect(denied.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'force-release-table-lock' } });
  });
});

// ------------------------------------------------------------------------------------------- §6.17

describe('zone-stock (§6.17)', () => {
  it('[02b §6.17] any staff session reads every zone\'s counts (name, items with name, on_hand, threshold); zone_id filter; unknown → 404', async () => {
    setZoneStock(hub, FX.zone, FX.zoneItem, 5);
    const who = signIn(WAITER);
    const r = await query(who, 'zone-stock');
    expect(r.status).toBe(200);
    expect(r.data).toEqual([{ zone_id: FX.zone, name: 'Front', items: [{ item_id: FX.zoneItem, name: 'Cola', on_hand: 5, threshold: 2 }] }]);
    expect((await query(who, `zone-stock?zone_id=${FX.zone}`)).data).toEqual(r.data);
    const unknown = await query(who, 'zone-stock?zone_id=Z_NONE');
    expect(unknown.status).toBe(404);
    expect(unknown.error).toMatchObject({ code: 'ZONE_NOT_FOUND', details: { zone_id: 'Z_NONE' } });
  });
});

// ------------------------------------------------------------------------------------------- #33 counts

describe('statement counts (§6.15–§6.18, catch-up)', () => {
  it('[02b #33 queries] seating-orders 2, open-orders 2, zone-stock 1, order-contact 1; catch-up part `orders` 4 (orders, lines, zone_stock, open_slips)', async () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: OT1 });
    for (let n = 1; n <= 6; n += 1) {
      appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: `D${n}`, lines: [{ order_item_id: `D${n}a`, item_id: FX.naan }, { order_item_id: `D${n}b`, item_id: FX.piece }] });
      appendOrder(hub, { order_type: 'takeaway', order_id: `T${n}`, placed_by: OT1, lines: [{ order_item_id: `T${n}a`, item_id: FX.naan }, { order_item_id: `T${n}b`, item_id: FX.ready }] });
    }
    setZoneStock(hub, FX.zone, FX.zoneItem, 4);
    const mgr = signIn(MGR);
    const ot = signIn(OT1);
    const counter = statementCounter(hub.deps.readDb);
    const count = async (who: Who, path: string): Promise<number> => {
      counter.reset();
      const r = await query(who, path);
      expect(r.status, path).toBe(200);
      return counter.count;
    };
    expect(await count(mgr, 'seating-orders?seating_id=SEAT1')).toBe(2);
    expect(await count(mgr, 'open-orders')).toBe(2);
    expect(await count(mgr, 'open-orders?abandoned=true')).toBe(2);
    expect(await count(mgr, 'zone-stock')).toBe(1);
    expect(await count(mgr, 'order-contact?order_id=T1')).toBe(1); // branch scope
    expect(await count(ot, 'order-contact?order_id=T1')).toBe(1); // own_tables, placed by the caller
    expect(await count(ot, 'order-contact?order_id=D1')).toBe(1); // own_tables, holder of the seating
    // S-2 (a), owner 2026-11-11: my_floors on a dine-in order adds 02a currentTableOf → 2; otherwise 1
    const floor = signIn(FLOOR);
    expect(await count(floor, 'order-contact?order_id=D1')).toBe(2); // D1 is on T2, floor F1

    const part = ordersCatchUpPart();
    const db = statementCounter(hub.deps.db);
    const built = part.build(hub.deps.db, engine(), socketCtx({ staffId: OT1 })) as { orders: Array<{ lines: unknown[] }>; zone_stock: unknown };
    expect(db.count).toBe(4); // 02b v1.0.11 (Q-10, #49): + open_slips (one alerts.listOpen)
    expect(built.orders).toHaveLength(12);
    expect(built.orders.every((o) => o.lines.length === 2)).toBe(true);

    appendOrder(hub, { order_type: 'takeaway', order_id: 'TF', placed_by: FLOOR, lines: [{ order_item_id: 'TFa', item_id: FX.naan }] });
    expect(await count(floor, 'order-contact?order_id=TF')).toBe(1); // my_floors on a non-table order: placed by the caller
  });
});

// ------------------------------------------------------------------------------------------- #32 privacy

const takeaway = (order_id: string, contact: { customer_name?: string; phone?: string }) => ({
  order_id,
  order_type: 'takeaway',
  takeaway: contact,
  lines: [{ order_item_id: `${order_id}-1`, item_id: FX.naan, quantity: 1 }],
});

describe('privacy (O17, §7, #32)', () => {
  it('[02b #32] push path: OrderPlaced (has_phone, no contact) to staff, kiosks; OrderContactSet only to the kiosk and the placer; KDS gets no order event', async () => {
    const placer = signIn(OT1);
    const waiter = signIn(WAITER);
    const other = signIn(OT2);
    const kiosk = signIn(CASHIER, 'cashier_kiosk');
    const placerWs = await authed(placer);
    const waiterWs = await authed(waiter);
    const otherWs = await authed(other);
    const kioskWs = await authed(kiosk);
    const kdsWs = await stationSocket();

    const r = await command(placer, 'submit-order', 'SubmitOrder', takeaway('O1', { customer_name: 'Ahmed', phone: '0300-1234567' }));
    expect(r.status).toBe(200);
    await placerWs.untilCount(2);
    await settle();

    for (const ws of [placerWs, waiterWs, otherWs, kioskWs]) {
      const placed = frames(ws).find((f) => f.event_type === 'OrderPlaced')!;
      expect(placed.payload.has_phone).toBe(true);
      expect(JSON.stringify(placed.payload)).not.toMatch(/Ahmed|03001234567|customer_name|"phone"/);
      expect(typesOf(ws)).toContain('ItemAdded');
    }
    expect(typesOf(placerWs)).toContain('OrderContactSet');
    expect(typesOf(kioskWs)).toContain('OrderContactSet');
    expect(typesOf(waiterWs)).not.toContain('OrderContactSet');
    expect(typesOf(otherWs)).not.toContain('OrderContactSet');
    for (const ws of [waiterWs, otherWs]) expect(JSON.stringify(ws.messages)).not.toMatch(/Ahmed|03001234567/);
    expect(typesOf(kdsWs).filter((t) => ['OrderPlaced', 'ItemAdded', 'OrderContactSet'].includes(t))).toEqual([]);
  });

  it('[02b #32] catch-up: contact only for the kiosk and the placer\'s sockets; has_phone for everyone; KDS gets no `orders` part', async () => {
    const placer = signIn(OT1);
    expect((await command(placer, 'submit-order', 'SubmitOrder', takeaway('O1', { customer_name: 'Ahmed', phone: '03001234567' }))).status).toBe(200);
    const part = async (who: Who) => catchUpOrders(await authed(who)).orders.find((o) => o.order_id === 'O1')!;
    const placerRow = await part(signIn(OT1));
    expect(placerRow).toMatchObject({ has_phone: true, customer_name: 'Ahmed', phone: '03001234567' });
    expect(await part(signIn(CASHIER, 'cashier_kiosk'))).toMatchObject({ customer_name: 'Ahmed', phone: '03001234567' });
    for (const staff of [WAITER, OT2, CASHIER]) {
      const row = await part(signIn(staff)); // the cashier on a tablet is not a kiosk
      expect(row.has_phone, staff).toBe(true);
      expect(row, staff).not.toHaveProperty('customer_name');
      expect(row, staff).not.toHaveProperty('phone');
    }
    const kds = await stationSocket();
    expect((kds.messages[0] as { state: Record<string, unknown> }).state).not.toHaveProperty('orders');
  });

  it('[02b #32] order-contact: view-customer-contact; default waiter → 403; order taker only for orders they placed / tables they hold; logged without values', async () => {
    const placer = signIn(OT1);
    expect((await command(placer, 'submit-order', 'SubmitOrder', takeaway('O1', { customer_name: 'Ahmed', phone: '03001234567' }))).status).toBe(200);
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: OT1 });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: 'D1', placed_by: OT2, lines: [{ order_item_id: 'D1a', item_id: FX.naan }] });

    const waiter = await query(signIn(WAITER), 'order-contact?order_id=O1');
    expect(waiter.status).toBe(403);
    expect(waiter.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'view-customer-contact' } });

    expect((await query(placer, 'order-contact?order_id=O1')).data).toEqual({ customer_name: 'Ahmed', phone: '03001234567' });
    expect((await query(signIn(CASHIER), 'order-contact?order_id=O1')).data).toEqual({ customer_name: 'Ahmed', phone: '03001234567' });
    const other = signIn(OT2);
    const outside = await query(other, 'order-contact?order_id=O1');
    expect(outside.status).toBe(403);
    expect(outside.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', order_ids: ['O1'] } });
    // dine-in: the holder of the seating (OT1), not the placer (OT2), under own_tables
    expect((await query(placer, 'order-contact?order_id=D1')).data).toEqual({ customer_name: null, phone: null });
    expect((await query(other, 'order-contact?order_id=D1')).status).toBe(403);
    const missing = await query(placer, 'order-contact?order_id=NOPE');
    expect(missing.status).toBe(404);
    expect(missing.error).toMatchObject({ code: 'ORDER_NOT_FOUND', details: { order_id: 'NOPE' } });

    const logs = hub.logs();
    const lines = logs.split('\n').filter((l) => l.includes('"order_id":"O1"') && l.includes('order contact'));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.some((l) => l.includes(`"staff_id":"${OT1}"`))).toBe(true);
    expect(logs).not.toMatch(/Ahmed|03001234567/);
  });

  it('[02b §6.18] order-contact counts as activity (a deliberate tap)', async () => {
    const placer = signIn(OT1);
    expect((await command(placer, 'submit-order', 'SubmitOrder', takeaway('O1', { phone: '03001234567' }))).status).toBe(200);
    activity.drain();
    await query(placer, 'open-orders');
    await query(placer, 'zone-stock');
    await query(placer, 'seating-orders?seating_id=SEAT1');
    expect(activity.get(placer.sessionId)).toBeUndefined();
    await query(placer, 'order-contact?order_id=O1');
    expect(activity.get(placer.sessionId)).toBe(hub.clock.branchNow());
  });
});

// ------------------------------------------------------------------------------------------- §6.19 audiences

const ORDER_EVENTS = [
  'OrderPlaced',
  'ItemAdded',
  'OrderLinesAdded',
  'ItemRemoved',
  'ItemVoided',
  'ItemServed',
  'ItemReturned',
  'ItemsReleased',
  'OrderBoosted',
  'OrderCancelled',
  'OrderFoodServed',
  'OrderFoodCleared',
  'OrdersBilled',
  'LineWeightSet',
];

describe('audiences (§6.19)', () => {
  const staff = socketCtx({ staffId: WAITER });
  const kiosk = socketCtx({ deviceType: 'cashier_kiosk', staffId: CASHIER });
  const station = socketCtx({ deviceType: 'kds', kind: 'station', staffId: null, stationId: FX.station });
  const ev = (event_type: string, actor_id: string | null = OT1) => ({ event_type, actor_id, payload: {} }) as unknown as PosEvent;

  it('[02b §6.19] every listed order event → staff sockets and cashier kiosks, never KDS; ZoneStock* likewise', () => {
    for (const t of [...ORDER_EVENTS, 'ZoneStockAdded', 'ZoneStockSet']) {
      expect(audienceAllows(ev(t), staff), t).toBe(true);
      expect(audienceAllows(ev(t), kiosk), t).toBe(true);
      expect(audienceAllows(ev(t), station), t).toBe(false);
    }
  });

  it('[02b §6.19 O17] OrderContactSet → cashier kiosks and the placer\'s sockets only', () => {
    expect(audienceAllows(ev('OrderContactSet', OT1), socketCtx({ staffId: OT1 }))).toBe(true);
    expect(audienceAllows(ev('OrderContactSet', OT1), kiosk)).toBe(true);
    expect(audienceAllows(ev('OrderContactSet', OT1), socketCtx({ staffId: OT2 }))).toBe(false);
    expect(audienceAllows(ev('OrderContactSet', OT1), staff)).toBe(false);
    expect(audienceAllows(ev('OrderContactSet', null), staff)).toBe(false);
    expect(audienceAllows(ev('OrderContactSet', OT1), station)).toBe(false);
  });

  it('[02b §6.19] LineComped → cashier kiosks and sockets whose staff hold apply-comp (directory, in memory)', () => {
    expect(audienceAllows(ev('LineComped'), kiosk)).toBe(true);
    expect(audienceAllows(ev('LineComped'), socketCtx({ staffId: MGR }))).toBe(true); // allowed
    expect(audienceAllows(ev('LineComped'), socketCtx({ staffId: OT2 }))).toBe(true); // with approval
    expect(audienceAllows(ev('LineComped'), staff)).toBe(false); // the waiter has no apply-comp
    expect(audienceAllows(ev('LineComped'), station)).toBe(false);
  });
});

describe('zone audience and 02a readers (AD-24, AD-6)', () => {
  it('[02b #33 zone audience] an order taker without manage-zone-stock receives ZoneStockAdded and its tile updates; zone-stock answers it read-only', async () => {
    setZoneStock(hub, FX.zone, FX.zoneItem, 1);
    const ot = signIn(OT1);
    const otWs = await authed(ot);
    const kds = await stationSocket();
    const refill = await command(signIn(MGR), 'add-zone-stock', 'AddZoneStock', { zone_id: FX.zone, item_id: FX.zoneItem, quantity: 6 });
    expect(refill.status).toBe(200);
    await otWs.untilCount(2);
    await settle();
    expect(frames(otWs).find((f) => f.event_type === 'ZoneStockAdded')!.payload).toMatchObject({ zone_id: FX.zone, item_id: FX.zoneItem, quantity: 6 });
    expect(typesOf(kds)).not.toContain('ZoneStockAdded');
    const tile = await query<Zones>(ot, 'zone-stock');
    expect(tile.data[0]!.items[0]).toMatchObject({ item_id: FX.zoneItem, on_hand: 7 });
    // the order taker cannot change it
    expect((await command(ot, 'set-zone-stock', 'SetZoneStock', { zone_id: FX.zone, item_id: FX.zoneItem, on_hand: 0 })).status).toBe(403);
  });

  it('[02b AD-6] zone events (stream table, id zone:<zone_id>) reach no 02a reader', async () => {
    expect(TABLE_EVENT_TYPES).not.toContain('ZoneStockAdded');
    expect(TABLE_EVENT_TYPES).not.toContain('ZoneStockSet');
    expect(TABLES_EVENT_TYPES).not.toContain('ZoneStockAdded');
    expect(TABLES_EVENT_TYPES).not.toContain('ZoneStockSet');
    const who = signIn(OT1);
    const mapBefore = (await query<{ as_of_seq: number }>(who, 'table-map')).data;
    const rows = () => hub.deps.db.prepare('SELECT (SELECT COUNT(*) FROM seatings) AS s, (SELECT COUNT(*) FROM seating_tables) AS t').get();
    const before = rows();
    setZoneStock(hub, FX.zone, FX.zoneItem, 3);
    expect(rows()).toEqual(before);
    const mapAfter = (await query<{ as_of_seq: number }>(who, 'table-map')).data;
    expect({ ...mapAfter, as_of_seq: 0 }).toEqual({ ...mapBefore, as_of_seq: 0 });
  });
});

// ------------------------------------------------------------------------------------------- #48 (H4, Q-9)

describe('[02b #48] open-orders placed_by and table_id (§6.16 v1.0.11, Q-9)', () => {
  it('[02b #48] rows carry placed_by { staff_id, name }', async () => {
    appendOrder(hub, { order_type: 'takeaway', order_id: 'TA', placed_by: OT1, lines: [{ order_item_id: 'TA1', item_id: FX.naan }] });
    appendOrder(hub, { order_type: 'parking', order_id: 'PC', placed_by: CASHIER, lines: [{ order_item_id: 'PC1', item_id: FX.naan }] });
    appendOrder(hub, { order_type: 'takeaway', order_id: 'TX', placed_by: 'S_GONE', lines: [{ order_item_id: 'TX1', item_id: FX.naan }] });
    const rows = (await query<Open>(signIn(CASHIER), 'open-orders')).data.orders;
    expect(rows.find((o) => o.order_id === 'TA')!.placed_by).toEqual({ staff_id: OT1, name: 'Usman' });
    expect(rows.find((o) => o.order_id === 'PC')!.placed_by).toEqual({ staff_id: CASHIER, name: 'Hina' });
    // a placer no longer in the directory: the id stays, the name is null
    expect(rows.find((o) => o.order_id === 'TX')!.placed_by).toEqual({ staff_id: 'S_GONE', name: null });
    // non-table rows carry no table
    for (const o of rows) expect(o.table_id).toBeNull();
  });

  it('[02b #48] an abandoned dine-in row carries table_id = the current primary table, after a MoveTable the new one', async () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: 'DI', placed_by: OT1, lines: [{ order_item_id: 'DI1', item_id: FX.piece }] });
    appendOrder(hub, { order_type: 'takeaway', order_id: 'TA', lines: [{ order_item_id: 'TA1', item_id: FX.piece }] });
    fire('DI1', 'TA1');
    hub.clock.advance(5 * 3_600_000); // fired, never tapped: both abandoned
    const mgr = signIn(MGR);
    const before = (await query<Open>(mgr, 'open-orders?abandoned=true')).data.orders;
    expect(before.find((o) => o.order_id === 'DI')).toMatchObject({ abandoned: true, table_id: FX.table, placed_by: { staff_id: OT1, name: 'Usman' } });
    expect(before.find((o) => o.order_id === 'TA')).toMatchObject({ abandoned: true, table_id: null });
    // 02a moves the seating: the row follows the seating's current primary table
    append(draft('table', FX.table, 'TableMoved', { seating_id: 'SEAT1', from_table_id: FX.table, to_table_id: FX.zoneTable, by_staff_id: 'S_WAIT' }));
    const after = (await query<Open>(mgr, 'open-orders?abandoned=true')).data.orders;
    expect(after.find((o) => o.order_id === 'DI')!.table_id).toBe(FX.zoneTable);
  });

  it('[02b #48] statements: 2 with no dine-in row, 3 with one', async () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: 'DI', lines: [{ order_item_id: 'DI1', item_id: FX.piece }] });
    appendOrder(hub, { order_type: 'takeaway', order_id: 'TA', placed_by: OT1, lines: [{ order_item_id: 'TA1', item_id: FX.naan }] });
    appendOrder(hub, { order_type: 'takeaway', order_id: 'TB', placed_by: OT2, lines: [{ order_item_id: 'TB1', item_id: FX.naan }] });
    let mgr = signIn(MGR);
    const counter = statementCounter(hub.deps.readDb);
    const count = async (path: string): Promise<{ n: number; rows: Open['orders'] }> => {
      counter.reset();
      const r = await query<Open>(mgr, path);
      expect(r.status, path).toBe(200);
      return { n: counter.count, rows: r.data.orders };
    };
    // the dine-in DI is open but not abandoned (unfired, still in the engine): no dine-in row is listed
    expect(await count('open-orders')).toMatchObject({ n: 2 });
    const quiet = await count('open-orders?abandoned=true');
    expect(quiet.rows.map((o) => o.order_type)).not.toContain('dine_in');
    expect(quiet.n).toBe(2);
    fire('DI1');
    hub.clock.advance(5 * 3_600_000);
    mgr = signIn(MGR); // the earlier session went idle over the 5 h
    const loud = await count('open-orders?abandoned=true');
    expect(loud.rows.filter((o) => o.order_type === 'dine_in').map((o) => o.order_id)).toEqual(['DI']);
    expect(loud.n).toBe(3);
    expect(await count('open-orders')).toMatchObject({ n: 2 }); // without the flag no dine-in row is ever listed
  });
});

// ------------------------------------------------------------------------------------------- #45 kitchen progress (H1)

// 02b v1.0.11 §6.19 (Q-6): ItemStarted, ItemDone, ItemDoneUndone, FireDispatched → staff sockets and cashier kiosks too
// (audiences OR-ed with 03b §6.17, G-10). Imports stay inside the block (this file is append-only per lane).
describe('[02b #45] kitchen progress frames to staff and kiosks (§6.19, Q-6)', () => {
  const PROGRESS = ['FireDispatched', 'ItemDone', 'ItemDoneUndone', 'ItemStarted'];
  const progressOf = (ws: WsClient) => [...new Set(typesOf(ws).filter((t) => PROGRESS.includes(t)))].sort();

  /** Fire, start, done, undo on one S1 line of a takeaway placed by OT1. */
  function progress(): void {
    appendOrder(hub, { order_type: 'takeaway', order_id: 'KP1', placed_by: OT1, lines: [{ order_item_id: 'KP1a', item_id: FX.piece }] });
    fire('KP1a');
    start('KP1', 'KP1a');
    done('KP1', 'KP1a');
    append(draft('order', 'KP1', 'ItemDoneUndone', { order_item_id: 'KP1a' }));
  }

  it('[02b #45] ItemStarted, ItemDone, ItemDoneUndone, FireDispatched reach a point-less ordering tablet and a cashier kiosk', async () => {
    const tabletWs = await authed(signIn(OT1));
    const kioskWs = await authed(signIn(CASHIER, 'cashier_kiosk'));
    progress();
    await settle();
    expect(progressOf(tabletWs)).toEqual(PROGRESS);
    expect(progressOf(kioskWs)).toEqual(PROGRESS);

    // the audience is memory only: 0 statements
    const counter = statementCounter(hub.deps.db);
    const ev = (event_type: string) => ({ event_type, actor_id: null, payload: { order_item_id: 'KP1a', station_id: FX.station, order_item_ids: ['KP1a'] } }) as unknown as PosEvent;
    for (const t of PROGRESS) {
      expect(audienceAllows(ev(t), socketCtx({ staffId: WAITER })), t).toBe(true);
      expect(audienceAllows(ev(t), socketCtx({ deviceType: 'cashier_kiosk', staffId: CASHIER })), t).toBe(true);
    }
    expect(counter.count).toBe(0);
  });

  it('[02b #45] station and Pass sockets still get them (03b sets unchanged); a signed-out kiosk (alert mode) does not', async () => {
    const { loadDeviceMaps } = await import('../../src/kds/device-roles');
    const station = await stationSocket();
    const passDevice = pairDevice(hub, { type: 'tablet' });
    hub.deps.db.prepare("UPDATE devices SET point_id = 'P1' WHERE device_id = ?").run(passDevice.deviceId);
    loadDeviceMaps(hub.deps.db);
    const pass = await authed({ token: passDevice.token, sessionToken: openSession(hub, { kind: 'staff', staffId: WAITER, deviceId: passDevice.deviceId }).token });
    const signedOut = await connectWs(hub.app);
    sockets.push(signedOut);
    signedOut.send({ type: 'auth', device_token: pairDevice(hub, { type: 'cashier_kiosk' }).token });
    await signedOut.untilCount(1);
    progress();
    await settle();
    expect(progressOf(station)).toEqual(PROGRESS);
    expect(progressOf(pass)).toEqual(PROGRESS);
    expect(signedOut.messages.map((m) => (m as { type: string }).type)).toEqual(['alerts_open']);
  });
});

// ------------------------------------------------------------------------------------------- #49 slips (H5)

// 02b v1.0.11 §6.19, catch-up `orders` (Q-10): SlipWarned → staff sockets and cashier kiosks; catch-up `open_slips`.
// The slip_warning is raised by the real fires_alerts tick (03a §6.2a) at the engine's own due time.
describe('[02b #49] slip warnings to staff and open_slips (§6.19, catch-up, Q-10)', () => {
  async function lateSeating(): Promise<{ order_id: string; alert_id: string }> {
    const { firesAlertsTick, ENGINE_ALERT_KINDS } = await import('../../src/engine-host/fires-alerts-tick');
    const { readOnlyDb } = await import('../../src/engine-host/read-only-tx');
    openSeating(hub, { table_id: FX.table, seating_id: 'SLIP1', holder_staff_id: OT1 });
    const { order_id } = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SLIP1', order_id: 'SL1', lines: [{ order_item_id: 'SL1a', item_id: FX.naan }, { order_item_id: 'SL1b', item_id: FX.naan }] });
    fire('SL1a', 'SL1b');
    const due = engine().next_alert_due_at;
    expect(due).not.toBeNull();
    hub.clock.set(Math.max(hub.clock.branchNow(), due!) + 1_000);
    const now = hub.clock.branchNow();
    expect(firesAlertsTick.due(readOnlyDb(hub.deps.db), engine(), now)).toBe(true);
    hub.deps.writer.run((tx) => tx.append(firesAlertsTick.intents(tx, engine(), now)));
    const row = hub.deps.db.prepare(`SELECT alert_id FROM alerts WHERE kind = ? AND state = 'open'`).get(ENGINE_ALERT_KINDS.slip) as { alert_id: string } | undefined;
    expect(row).toBeDefined();
    return { order_id, alert_id: row!.alert_id };
  }

  it('[02b #49] SlipWarned reaches staff sockets and cashier kiosks; never KDS stations', async () => {
    const tabletWs = await authed(signIn(WAITER));
    const kioskWs = await authed(signIn(CASHIER, 'cashier_kiosk'));
    const kdsWs = await stationSocket();
    const { order_id, alert_id } = await lateSeating();
    await settle();
    for (const ws of [tabletWs, kioskWs]) {
      expect(frames(ws).find((f) => f.event_type === 'SlipWarned')?.payload).toMatchObject({ alert_id, order_ids: [order_id] });
    }
    expect(typesOf(kdsWs)).not.toContain('SlipWarned');
    const counter = statementCounter(hub.deps.db);
    const ev = { event_type: 'SlipWarned', actor_id: null, payload: { order_ids: [order_id], alert_id } } as unknown as PosEvent;
    expect(audienceAllows(ev, socketCtx({ staffId: WAITER }))).toBe(true);
    expect(audienceAllows(ev, socketCtx({ deviceType: 'cashier_kiosk', staffId: CASHIER }))).toBe(true);
    expect(audienceAllows(ev, socketCtx({ deviceType: 'kds', kind: 'station', staffId: null, stationId: FX.station }))).toBe(false);
    expect(counter.count).toBe(0);
  });

  it('[02b #49] catch-up orders.open_slips lists each open slip_warning with its order_ids; gone after the alert closes', async () => {
    const before = catchUpOrders(await authed(signIn(OT1))) as unknown as { open_slips: unknown };
    expect(before.open_slips).toEqual([]);
    const { order_id, alert_id } = await lateSeating();
    const open = catchUpOrders(await authed(signIn(OT2))) as unknown as { open_slips: unknown };
    expect(open.open_slips).toEqual([{ alert_id, order_ids: [order_id] }]);
    const kioskPart = catchUpOrders(await authed(signIn(CASHIER, 'cashier_kiosk'))) as unknown as { open_slips: unknown };
    expect(kioskPart.open_slips).toEqual([{ alert_id, order_ids: [order_id] }]);
    const { alerts } = await import('../../src/alerts/raise');
    hub.deps.writer.run((tx) => tx.append(alerts.close(alerts.tickCtx(tx, hub.clock.branchNow()), alert_id, 'obsolete')));
    const after = catchUpOrders(await authed(signIn(WAITER))) as unknown as { open_slips: unknown };
    expect(after.open_slips).toEqual([]);
  });

  it('[02b #49] catch-up orders statements 3 → 4', async () => {
    const { order_id, alert_id } = await lateSeating();
    const part = ordersCatchUpPart();
    const db = statementCounter(hub.deps.db);
    const built = part.build(hub.deps.db, engine(), socketCtx({ staffId: OT1 })) as { open_slips: unknown };
    expect(db.count).toBe(4);
    expect(built.open_slips).toEqual([{ alert_id, order_ids: [order_id] }]);
  });
});

// ------------------------------------------------------------------------------------------- #46 (H2, lane HB)

describe('[02b #46] line options and order note in reads (§4.2, §6.15; Q-7)', () => {
  // append-only shared file (lane rule): this block imports its own export inside the tests
  const exportsOf = () => import('../../src/orders/exports');
  const plain = (name: string, quantity: number, n: number) => ({ option_id: `OPT_${n}`, modifier_group_id: 'M_PLAIN', name, price_minor: 0, quantity, charge_minor: 0 });

  it('[02b #46] a line with [No onion ×1, Less spicy ×2] → seating-orders / orderLines options in payload order; none → []', async () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: OT1 });
    appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'SEAT1',
      order_id: 'O1',
      placed_by: OT1,
      lines: [
        { order_item_id: 'A1', item_id: FX.piece, item: { options: [plain('No onion', 1, 1), plain('Less spicy', 2, 2)] } },
        { order_item_id: 'A2', item_id: FX.naan },
      ],
    });
    const r = await query<Seating>(signIn(WAITER), 'seating-orders?seating_id=SEAT1');
    expect(r.status).toBe(200);
    const lines = new Map(r.data.orders[0]!.lines.map((l) => [l.order_item_id, l] as const));
    expect(lines.get('A1')!.options).toEqual([
      { name: 'No onion', quantity: 1 },
      { name: 'Less spicy', quantity: 2 },
    ]);
    expect(lines.get('A2')!.options).toEqual([]);
    const { orderLines } = await exportsOf();
    const read = orderLines(hub.deps.db, ['O1']).get('O1')!;
    expect(read.map((l) => l.options)).toEqual([[{ name: 'No onion', quantity: 1 }, { name: 'Less spicy', quantity: 2 }], []]);
  });

  it('[02b #46] the order carries order_note', async () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: OT1 });
    const ot = signIn(OT1);
    const line = (order_item_id: string) => ({ order_item_id, item_id: FX.naan, quantity: 1 });
    const noted = await command(ot, 'submit-order', 'SubmitOrder', {
      order_id: 'O1',
      order_type: 'dine_in',
      table_id: FX.table,
      seating_id: 'SEAT1',
      order_note: 'birthday, bring together',
      lines: [line('N1')],
    });
    expect(noted.status).toBe(200);
    hub.clock.advance(1_000);
    expect((await command(ot, 'submit-order', 'SubmitOrder', { order_id: 'O2', order_type: 'dine_in', table_id: FX.table, seating_id: 'SEAT1', lines: [line('N2')] })).status).toBe(200);
    const r = await query<Seating>(signIn(WAITER), 'seating-orders?seating_id=SEAT1');
    expect(r.data.orders.map((o) => [o.order_id, o.order_note])).toEqual([
      ['O1', 'birthday, bring together'],
      ['O2', null],
    ]);
  });

  it('[02b #46] statement counts unchanged: seating-orders 2, orderLines 1, catch-up orders 4 (with #49 open_slips)', async () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: OT1 });
    for (let n = 1; n <= 4; n += 1) {
      appendOrder(hub, {
        order_type: 'dine_in',
        seating_id: 'SEAT1',
        order_id: `D${n}`,
        lines: [{ order_item_id: `D${n}a`, item_id: FX.piece, item: { options: [plain('No onion', 1, 1), plain('Less spicy', 2, 2)] } }, { order_item_id: `D${n}b`, item_id: FX.naan }],
      });
      appendOrder(hub, { order_type: 'takeaway', order_id: `T${n}`, placed_by: OT1, lines: [{ order_item_id: `T${n}a`, item_id: FX.piece, item: { options: [plain('Less spicy', 1, 2)] } }] });
    }
    const mgr = signIn(MGR);
    const counter = statementCounter(hub.deps.readDb);
    const r = await query<Seating>(mgr, 'seating-orders?seating_id=SEAT1');
    expect(r.status).toBe(200);
    expect(counter.count).toBe(2);
    expect(r.data.orders.every((o) => o.lines[0]!.options.length === 2 && o.order_note === null)).toBe(true);

    const { orderLines } = await exportsOf();
    const db = statementCounter(hub.deps.db);
    const read = orderLines(hub.deps.db, ['D1', 'T1']);
    expect(db.count).toBe(1);
    expect(read.get('T1')![0]!.options).toEqual([{ name: 'Less spicy', quantity: 1 }]);

    db.reset();
    const built = ordersCatchUpPart().build(hub.deps.db, engine(), socketCtx({ staffId: OT1 })) as { orders: Array<{ order_id: string; lines: Array<{ options: unknown }> }> };
    expect(db.count).toBe(4); // orders, lines, zone_stock, open_slips (#49)
    expect(built.orders.find((o) => o.order_id === 'T2')!.lines[0]!.options).toEqual([{ name: 'Less spicy', quantity: 1 }]);
  });
});
