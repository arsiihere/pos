import type { EngineState } from '@pos/engine';
import type { DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { currentDirectory } from '../../src/auth/guards';
import { ordersOf } from '../../src/orders/exports';
import { toSeatingOrder, type SeatingOrder } from '../../src/orders/queries/seating-orders';
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

async function view(who: Who, order_id?: string): Promise<{ status: number; data: SeatingOrder; error?: { code: string; details: Record<string, unknown> } }> {
  const res = await hub.app.inject({
    method: 'GET',
    url: order_id === undefined ? '/queries/order-view' : `/queries/order-view?order_id=${order_id}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
  });
  const body = res.json() as { data: SeatingOrder; error?: { code: string; details: Record<string, unknown> } };
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
    expect(Object.keys(r.data).sort()).toEqual(Object.keys(seated).sort());
    expect(Object.keys(r.data.lines[0]!).sort()).toEqual(Object.keys(seated.lines[0]!).sort());
    expect(r.data).toMatchObject({ order_id: 'T1', placed_by: { staff_id: PLACER, name: 'Usman' }, cancelled: false, billed: false, order_note: null });
    expect(r.data.promise_ms).toBe(engine().orders.T1!.promise_ms);
    const [a, b] = r.data.lines;
    expect(a).toMatchObject({ order_item_id: 'T1a', stage: 'added', fired: true, options: [{ name: 'No onion', quantity: 1 }, { name: 'Less spicy', quantity: 2 }] });
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
    const seating = ordersOf(hub.deps.db, 'SEAT1').map((o) => toSeatingOrder(engine(), currentDirectory(hub.app), o, hub.clock.branchNow()));
    expect((await view(signIn(OTHER), 'D1')).data).toEqual(seating[0]);
  });

  it('[02b #47] unknown order_id → 404 ORDER_NOT_FOUND', async () => {
    const who = signIn(BRANCH);
    const r = await view(who, 'NOPE');
    expect(r.status).toBe(404);
    expect(r.error).toMatchObject({ code: 'ORDER_NOT_FOUND', details: { order_id: 'NOPE' } });
    expect((await view(who)).error?.code).toBe('VALIDATION_FAILED');
  });

  it('[02b #47] 2 statements before H6, countsAsActivity false', async () => {
    takeaway('T1');
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: PLACER });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', order_id: 'D1', placed_by: PLACER, lines: [{ order_item_id: 'D1a', item_id: FX.naan }] });
    const placer = signIn(PLACER);
    const counter = statementCounter(hub.deps.readDb);
    for (const id of ['T1', 'D1']) {
      counter.reset();
      expect((await view(placer, id)).status, id).toBe(200);
      expect(counter.count, id).toBe(2);
    }
    activity.drain();
    await view(placer, 'T1');
    expect(activity.get(placer.sessionId)).toBeUndefined();
  });
});
