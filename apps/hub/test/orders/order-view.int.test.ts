import type { EngineState } from '@pos/engine';
import type { DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { currentDirectory } from '../../src/auth/guards';
import { ordersOf } from '../../src/orders/exports';
import { pendingComps, toSeatingOrder, type SeatingOrder } from '../../src/orders/queries/seating-orders';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { appendOrder, FX, openDay, openSeating } from './fixtures';

// ⚠️ 02b v1.0.11 §6.18a GET /queries/order-view (Q-8), scope Q-27 (§12.3 Q6); §10 #47. Orders are seeded with the
// shared fixtures through the hub writer; the query goes through the HTTP route.

const PLACER = 'S_PLACER'; // order taker, mark-served own_tables
const OTHER = 'S_OTHER'; // order taker, mark-served own_tables
const BRANCH = 'S_BRANCH'; // mark-served branch
const NONE = 'S_NONE'; // a staff session with no mark-served at all

type Scope = 'branch' | 'own_tables' | 'my_floors';
const grant = (permission: string, scope: Scope = 'branch') => ({ permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [] as string[], scope });

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const person = (staff_id: string, display_name: string, role_id: string) => ({
    staff_id,
    display_name,
    pin_hash: pin,
    role_ids: [role_id],
    denied_permissions: [],
    lead_staff_id: null,
    floor_ids: [],
  });
  const role = (role_id: string, permissions: Array<ReturnType<typeof grant>>) => ({ role_id, name: role_id, session_idle_ttl_ms: 3_600_000, permissions });
  return {
    ...base,
    roles: [
      ...base.roles,
      role('R_OWN', [grant('take-order'), grant('mark-served', 'own_tables')]),
      role('R_BRANCH', [grant('mark-served')]),
      role('R_NONE', [grant('take-order')]),
    ],
    staff: [...base.staff, person(PLACER, 'Usman', 'R_OWN'), person(OTHER, 'Omar', 'R_OWN'), person(BRANCH, 'Wasim', 'R_BRANCH'), person(NONE, 'Nadia', 'R_NONE')],
  };
}

let hub: TestHub;

beforeEach(async () => {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  openDay(hub);
});

afterEach(async () => {
  activity.drain();
  swapBranchConfig(null);
  await hub.close();
});

const engine = (): EngineState => hub.deps.state.get() as EngineState;

function append(event_type: string, stream_type: EventDraft['stream_type'], stream_id: string, payload: Record<string, unknown>): void {
  hub.clock.advance(1_000);
  hub.deps.writer.run((tx) =>
    tx.append([{ stream_type, stream_id, event_type, schema_version: 1, payload, occurred_at: hub.clock.branchNow(), actor_id: 'S_SEED', device_id: 'D_SEED' }]),
  );
}

interface Who {
  staffId: string;
  sessionId: string;
  token: string;
  sessionToken: string;
}
function signIn(staffId: string): Who {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, sessionId: session.sessionId, token: device.token, sessionToken: session.token };
}

type OrderViewData = SeatingOrder & { order_type: string; seating_id: string | null };

async function view(who: Who, order_id?: string): Promise<{ status: number; data: OrderViewData; error?: { code: string; details: Record<string, unknown> } }> {
  const res = await hub.app.inject({
    method: 'GET',
    url: order_id === undefined ? '/queries/order-view' : `/queries/order-view?order_id=${order_id}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
  });
  const body = res.json() as { data: OrderViewData; error?: { code: string; details: Record<string, unknown> } };
  return { status: res.statusCode, data: body.data, error: body.error };
}

const plain = (name: string, quantity: number, n: number) => ({ option_id: `OPT_${n}`, modifier_group_id: 'M_PLAIN', name, price_minor: 0, quantity, charge_minor: 0 });

function takeaway(order_id = 'T1', placed_by = PLACER): void {
  appendOrder(hub, {
    order_type: 'takeaway',
    order_id,
    placed_by,
    lines: [
      { order_item_id: `${order_id}a`, item_id: FX.piece, item: { options: [plain('No onion', 1, 1), plain('Less spicy', 2, 2)] } },
      { order_item_id: `${order_id}b`, item_id: FX.naan },
    ],
  });
}

describe('[02b #47] order-view (§6.18a; Q-8, Q-27)', () => {
  it('[02b #47] order-view on a takeaway = that order\'s seating-orders shape (stage, fired, options)', async () => {
    takeaway();
    append('FireDispatched', 'station', FX.station, { station_id: FX.station, order_item_ids: ['T1a'], load_id: null, due_at: hub.clock.branchNow(), reason: 'pulled' });
    const who = signIn(BRANCH);
    const r = await view(who, 'T1');
    expect(r.status).toBe(200);
    // the seating-orders shape: same order keys and line keys as a seating-orders element
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: PLACER });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: 'D1', placed_by: PLACER, lines: [{ order_item_id: 'D1a', item_id: FX.naan }] });
    const res = await hub.app.inject({ method: 'GET', url: '/queries/seating-orders?seating_id=SEAT1', headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
    const seated = (res.json() as { data: { orders: SeatingOrder[] } }).data.orders[0]!;
    // ⚠️ 01d v1.3 (L-4b): order-view = the seating-orders element + order_type and seating_id (02b v1.0.15 §6.18a)
    expect(Object.keys(r.data).sort()).toEqual([...Object.keys(seated), 'order_type', 'seating_id'].sort());
    expect(Object.keys(r.data.lines[0]!).sort()).toEqual(Object.keys(seated.lines[0]!).sort());
    expect(r.data).toMatchObject({ order_id: 'T1', placed_by: { staff_id: PLACER, name: 'Usman' }, cancelled: false, billed: false, order_note: null });
    expect(r.data.promise_ms).toBe(engine().orders.T1!.promise_ms);
    const [a, b] = r.data.lines;
    expect(a).toMatchObject({ order_item_id: 'T1a', stage: 'added', fired: true, pending_comp: null, options: [{ name: 'No onion', quantity: 1 }, { name: 'Less spicy', quantity: 2 }] });
    expect(b).toMatchObject({ order_item_id: 'T1b', stage: 'added', fired: false, options: [] });
    expect(JSON.stringify(r.data)).not.toMatch(/customer_name|"phone"/);
  });

  it('[02b #47] placer with mark-served own_tables → 200; another order taker → 403 outside_scope; branch → 200', async () => {
    takeaway('T1');
    appendOrder(hub, { order_type: 'parking', order_id: 'P1', placed_by: PLACER, lines: [{ order_item_id: 'P1a', item_id: FX.naan }] });
    for (const id of ['T1', 'P1']) {
      expect((await view(signIn(PLACER), id)).status, id).toBe(200);
      const other = await view(signIn(OTHER), id);
      expect(other.status, id).toBe(403);
      expect(other.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', order_ids: [id] } });
      expect((await view(signIn(BRANCH), id)).status, id).toBe(200);
      // no mark-served at all: nothing covers a non-table order
      expect((await view(signIn(NONE), id)).error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope' } });
    }
  });

  it('[02b Q-27] a dine-in order: any staff session → 200', async () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: PLACER });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: 'D1', placed_by: PLACER, lines: [{ order_item_id: 'D1a', item_id: FX.naan }] });
    for (const staff of [PLACER, OTHER, BRANCH, NONE]) {
      const r = await view(signIn(staff), 'D1');
      expect(r.status, staff).toBe(200);
      expect(r.data.order_id).toBe('D1');
    }
    // the same element as seating-orders gives for the seating
    const seating = ordersOf(hub.deps.db, 'SEAT1').map((o) => toSeatingOrder(engine(), currentDirectory(hub.app), o, hub.clock.branchNow(), pendingComps(hub.deps.db, hub.app.log)));
    // ⚠️ 01d v1.3 (L-4b): plus order_type and the current seating_id (02b v1.0.15 §6.18a)
    expect((await view(signIn(OTHER), 'D1')).data).toEqual({ ...seating[0], order_type: 'dine_in', seating_id: 'SEAT1' });
  });

  it('[02b #47] unknown order_id → 404 ORDER_NOT_FOUND', async () => {
    const who = signIn(BRANCH);
    const r = await view(who, 'NOPE');
    expect(r.status).toBe(404);
    expect(r.error).toMatchObject({ code: 'ORDER_NOT_FOUND', details: { order_id: 'NOPE' } });
    expect((await view(who)).error?.code).toBe('VALIDATION_FAILED');
  });

  it('[02b #47] 2 + 1 statements (the order, its lines, the open comp requests of pending_comp; #50), countsAsActivity false', async () => {
    takeaway('T1');
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: PLACER });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: 'D1', placed_by: PLACER, lines: [{ order_item_id: 'D1a', item_id: FX.naan }] });
    const placer = signIn(PLACER);
    const counter = statementCounter(hub.deps.readDb);
    for (const id of ['T1', 'D1']) {
      counter.reset();
      expect((await view(placer, id)).status, id).toBe(200);
      expect(counter.count, id).toBe(3);
    }
    activity.drain();
    await view(placer, 'T1');
    expect(activity.get(placer.sessionId)).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------- #52

describe('[02b #52] order-view carries order_type and the current seating_id (§6.18a; 01d v1.3 L-4b, review B1)', () => {
  // T1 = FX.zoneTable (seating S_T1), T2 = FX.table (seating S_T2); merge and split are 02a's real events through the
  // hub writer, so the seating_orders rows are rewritten by 02a's fold (projection.ts applyMerged / applySplit).
  const dineIn = (seating_id: string, order_id: string) =>
    appendOrder(hub, { order_type: 'dine_in', seating_id, order_id, placed_by: PLACER, lines: [{ order_item_id: `${order_id}a`, item_id: FX.naan }] });

  it('[02b #52] a dine-in order → order_type dine_in and its seating', async () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'S_T2', holder_staff_id: PLACER });
    dineIn('S_T2', 'D1');
    const r = await view(signIn(BRANCH), 'D1');
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ order_id: 'D1', order_type: 'dine_in', seating_id: 'S_T2' });
    expect(r.data).not.toHaveProperty('table_key');
  });

  it('[02b #52] after TablesMerged absorbs its seating → the surviving seating_id', async () => {
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'S_T1', holder_staff_id: PLACER });
    openSeating(hub, { table_id: FX.table, seating_id: 'S_T2', holder_staff_id: PLACER });
    dineIn('S_T2', 'D2');
    append('TablesMerged', 'table', FX.zoneTable, {
      into_seating_id: 'S_T1',
      into_table_id: FX.zoneTable,
      table_ids: [FX.table],
      absorbed_seating_id: 'S_T2',
      order_ids: ['D2'],
      by_staff_id: PLACER,
    });
    const r = await view(signIn(OTHER), 'D2');
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ order_id: 'D2', order_type: 'dine_in', seating_id: 'S_T1' });
    expect(r.data).not.toHaveProperty('table_key');
  });

  it('[02b #52] after SeatingSplit moves it → the new seating; the order left behind keeps its seating', async () => {
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'S_T1', holder_staff_id: PLACER });
    dineIn('S_T1', 'D1');
    dineIn('S_T1', 'D2');
    append('SeatingSplit', 'table', FX.zoneTable, {
      from_seating_id: 'S_T1',
      new_seating_id: 'S_NEW',
      to_table_id: FX.table,
      order_ids: ['D2'],
      by_staff_id: PLACER,
    });
    const who = signIn(BRANCH);
    expect((await view(who, 'D2')).data).toMatchObject({ order_id: 'D2', order_type: 'dine_in', seating_id: 'S_NEW' });
    expect((await view(who, 'D1')).data).toMatchObject({ order_id: 'D1', order_type: 'dine_in', seating_id: 'S_T1' });
  });

  it('[02b #52] takeaway / parking → seating_id null and their order_type', async () => {
    takeaway('T1');
    appendOrder(hub, { order_type: 'parking', order_id: 'P1', placed_by: PLACER, lines: [{ order_item_id: 'P1a', item_id: FX.naan }] });
    const who = signIn(BRANCH);
    expect((await view(who, 'T1')).data).toMatchObject({ order_id: 'T1', order_type: 'takeaway', seating_id: null });
    expect((await view(who, 'P1')).data).toMatchObject({ order_id: 'P1', order_type: 'parking', seating_id: null });
  });

  it('[02b #52] still 3 statements (dine-in after a merge, takeaway); 403 / 404 unchanged', async () => {
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'S_T1', holder_staff_id: PLACER });
    openSeating(hub, { table_id: FX.table, seating_id: 'S_T2', holder_staff_id: PLACER });
    dineIn('S_T2', 'D2');
    append('TablesMerged', 'table', FX.zoneTable, {
      into_seating_id: 'S_T1',
      into_table_id: FX.zoneTable,
      table_ids: [FX.table],
      absorbed_seating_id: 'S_T2',
      order_ids: ['D2'],
      by_staff_id: PLACER,
    });
    takeaway('T1');
    const placer = signIn(PLACER);
    const counter = statementCounter(hub.deps.readDb);
    for (const id of ['D2', 'T1']) {
      counter.reset();
      const r = await view(placer, id);
      expect(r.status, id).toBe(200);
      expect(counter.count, id).toBe(3);
    }
    const other = await view(signIn(OTHER), 'T1');
    expect(other.status).toBe(403);
    expect(other.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', order_ids: ['T1'] } });
    const missing = await view(placer, 'NOPE');
    expect(missing.status).toBe(404);
    expect(missing.error).toMatchObject({ code: 'ORDER_NOT_FOUND', details: { order_id: 'NOPE' } });
  });

  it('[02b #52] seating-orders rows keep their keys (no order_type, seating_id or table_key; risk R-1)', async () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'S_T2', holder_staff_id: PLACER });
    dineIn('S_T2', 'D1');
    const who = signIn(BRANCH);
    const res = await hub.app.inject({ method: 'GET', url: '/queries/seating-orders?seating_id=S_T2', headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
    const seated = (res.json() as { data: { orders: SeatingOrder[] } }).data.orders[0]!;
    expect(Object.keys(seated).sort()).toEqual(
      ['billed', 'cancelled', 'follow_up', 'has_phone', 'lines', 'order_id', 'order_note', 'placed_at', 'placed_by', 'promise_ms'].sort(),
    );
  });
});
