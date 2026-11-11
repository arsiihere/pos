import { localTimeOfDayMs } from '@pos/domain';
import { availableStock, dayDraws, type EngineState } from '@pos/engine';
import type { BranchConfig, DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { hubTime } from '../../src/lib/hub-time';
import { buildSubmit } from '../../src/orders/build-submit';
import type { SubmitInput } from '../../src/orders/contracts';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { appendOrder, FX, fixtureMenu, openDay, openSeating } from './fixtures';

// 02b v1.0.3 §6.1 SubmitOrder, §3.2 steps 1–4 and 6–11 (step 5, zone-served lines, is submit-zone.int.test.ts), §3.1,
// §3.3 follow_up, §3.11 token, §3.14 scope; §10 #1, #2 (order_note), #4, #5, #7, #8, #9, #10, #16, #23 (submit);
// 02a #53 (order half, AD-3); the §6 preamble (retransmit, scope last, stale seating_id).

let hub: TestHub;

afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

type Scope = 'branch' | 'my_floors' | 'own_tables';
function grant(permission: string, grant_type: 'allowed' | 'requires_approval' = 'allowed', scope: Scope = 'branch') {
  return {
    permission,
    grant_type,
    approver_role_id: grant_type === 'requires_approval' ? 'R_MGR' : null,
    approver_role_ids: grant_type === 'requires_approval' ? ['R_MGR'] : [],
    scope,
  };
}

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
      role('R_TAKER', [grant('take-order')]),
      role('R_ANYWHERE', [grant('take-order'), grant('take-order-anywhere')]),
      role('R_FLOOR', [grant('take-order', 'allowed', 'my_floors')]),
      // AD-36: take-order my_floors plus take-order-anywhere at branch / at my_floors.
      role('R_FLOOR_ANYWHERE', [grant('take-order', 'allowed', 'my_floors'), grant('take-order-anywhere')]),
      role('R_FLOOR_ANYWHERE_FLOORS', [grant('take-order', 'allowed', 'my_floors'), grant('take-order-anywhere', 'allowed', 'my_floors')]),
      // 01b §6.15 v1.7 defaults (cloud default-roles.ts), as the hub receives them: order_taker and cashier.
      role('R_DEF_TAKER', [
        grant('mark-served'),
        grant('mark-item-returned'),
        grant('take-order'),
        grant('clean-table'),
        grant('boost-order'),
        grant('view-customer-contact', 'allowed', 'own_tables'),
        grant('apply-comp', 'requires_approval'),
      ]),
      role('R_DEF_CASH', [
        grant('apply-discount', 'requires_approval'),
        grant('reprint-ticket'),
        grant('take-order'),
        grant('clean-table'),
        grant('set-line-weight'),
        grant('apply-comp', 'requires_approval'),
        grant('view-customer-contact'),
      ]),
    ],
    staff: [
      ...base.staff,
      person('S_ALI', 'Ali', 'R_TAKER'),
      person('S_BILAL', 'Bilal', 'R_ANYWHERE'),
      person('S_NOOR', 'Noor', 'R_TAKER'),
      person('S_FAIZ', 'Faiz', 'R_FLOOR', ['F9']),
      person('S_FLOORED', 'Fahad', 'R_FLOOR', [FX.floor]),
      person('S_ROOF', 'Rafay', 'R_FLOOR', ['F2']),
      person('S_FARAH', 'Farah', 'R_FLOOR_ANYWHERE', ['F9']),
      person('S_FAWAD', 'Fawad', 'R_FLOOR_ANYWHERE_FLOORS', ['F9']),
      person('S_OT', 'Usman', 'R_DEF_TAKER', ['F9']),
      person('S_CASHIER', 'Hina', 'R_DEF_CASH'),
    ],
  };
}

async function setUp(o: { menu?: BranchConfig; stock?: Record<string, number> } = {}): Promise<{ business_date: string }> {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  return openDay(hub, o);
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
  actor_id: string | null;
  device_id: string;
  payload: Record<string, unknown>;
}

interface SubmitResult {
  order_id: string;
  token: number | null;
  groups: Array<{ group_id: string; promise_ms: number; order_item_ids: string[] }>;
  lines: Array<{ order_item_id: string; eta_ms: number | null; from_stock: boolean; zone_served: boolean }>;
}

interface Reply {
  status: number;
  body: unknown;
  result?: SubmitResult;
  events: Logged[];
  error?: { code: string; details: Record<string, unknown> };
}

let commandSeq = 0;

function loggedEvents(eventIds: readonly string[]): Logged[] {
  return (
    hub.deps.db
      .prepare(
        `SELECT event_type, stream_type, stream_id, actor_id, device_id, payload FROM events
          WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY seq`,
      )
      .all(JSON.stringify(eventIds)) as Array<Omit<Logged, 'payload'> & { payload: string }>
  ).map((r) => ({ ...r, payload: JSON.parse(r.payload) as Record<string, unknown> }));
}

async function submit(who: Who, payload: Record<string, unknown>, o: { command_id?: string; queuedAt?: number } = {}): Promise<Reply> {
  const res = await hub.app.inject({
    method: 'POST',
    url: '/commands/submit-order',
    headers: {
      authorization: `Bearer ${who.token}`,
      'x-session-token': who.sessionToken,
      ...(o.queuedAt === undefined ? {} : { 'x-queued-at': String(o.queuedAt) }),
    },
    payload: {
      command_id: o.command_id ?? `cmd-${(commandSeq += 1)}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'SubmitOrder',
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: who.staffId,
      device_id: who.deviceId,
    },
  });
  const body = res.json() as { data?: { event_ids: string[]; result: SubmitResult }; error?: { code: string; details: Record<string, unknown> } };
  return {
    status: res.statusCode,
    body,
    result: body.data?.result,
    events: body.data === undefined ? [] : loggedEvents(body.data.event_ids),
    error: body.error === undefined ? undefined : { code: body.error.code, details: body.error.details },
  };
}

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
const eventCount = (): number => (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
const lockRows = (): unknown[] => hub.deps.db.prepare('SELECT table_id, seating_id, staff_id, device_id FROM table_locks ORDER BY table_id').all();
const orderRow = (order_id: string) =>
  hub.deps.db.prepare('SELECT order_type, table_key, business_date, token, car_number, car_type, customer_name, phone, order_note, follow_up, day_closed_at, sent_after_reconnect FROM orders WHERE order_id = ?').get(order_id) as
    | Record<string, unknown>
    | undefined;

function append(draft: Omit<EventDraft, 'occurred_at' | 'schema_version' | 'device_id' | 'actor_id'> & { schema_version?: number; actor_id?: string | null }): void {
  const at = hub.clock.branchNow();
  hub.deps.writer.run((tx) =>
    tx.append([{ schema_version: 1, actor_id: null, device_id: 'hub', occurred_at: at, ...draft } as EventDraft]),
  );
}
const serve = (order_id: string, order_item_ids: string[]): void =>
  append({ stream_type: 'order', stream_id: order_id, event_type: 'ItemServed', payload: { order_item_ids, source: 'tap' }, actor_id: 'S_ALI' });
const closeDay = (): void => append({ stream_type: 'hub', stream_id: 'branch-1', event_type: 'BusinessDayClosed', payload: {} });
const pause = (station_id: string): void => append({ stream_type: 'station', stream_id: station_id, event_type: 'StationPauseSet', payload: { station_id, paused: true } });
const makeUnavailable = (item_id: string): void =>
  append({ stream_type: 'stock', stream_id: item_id, event_type: 'ItemMadeUnavailable', payload: { item_id }, actor_id: 'S_MGR' });
const billClosed = (seating_id: string): void =>
  append({ stream_type: 'table', stream_id: FX.table, event_type: 'BillClosed', payload: { seating_id } });

const item = (order_item_id: string, item_id: string, quantity = 1, o: Record<string, unknown> = {}) => ({ order_item_id, item_id, quantity, ...o });
const dineIn = (order_id: string, lines: unknown[], o: Record<string, unknown> = {}) => ({
  order_id,
  order_type: 'dine_in',
  table_id: FX.table,
  seating_id: 'SEAT1',
  lines,
  ...o,
});
const takeaway = (order_id: string, lines: unknown[], o: Record<string, unknown> = {}) => ({ order_id, order_type: 'takeaway', lines, ...o });

/** A full cart: karahi with a linked raita (option_child), 2 naan, a ready water, a combo deal (karahi + 2 naan). */
const fullCart = (): Array<Record<string, unknown>> => [
  item('L1', FX.piece, 1, { options: [{ option_id: FX.option, quantity: 1, order_item_id: 'L1o' }], kitchen_note: 'less oil' }),
  item('L2', FX.naan, 2),
  item('L3', FX.ready, 1),
  {
    order_item_id: 'D1',
    deal_id: FX.deal,
    quantity: 1,
    deal_choices: [
      { deal_part_id: FX.dealParts[0], item_id: FX.piece, order_item_id: 'D1a' },
      { deal_part_id: FX.dealParts[1], item_id: FX.naan, order_item_id: 'D1b' },
    ],
  },
];

describe('02b SubmitOrder (§6.1, §3.2)', () => {
  it('[02b #1] dine-in happy path: batch order exactly 03a :615 (lock → OrderPlaced → ItemAdded in order_item_ids order → StockReserved); table_key; promise_ms only; 5 statements', async () => {
    const day = await setUp({ stock: { [FX.stock]: 10_000 } });
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    const ali = signIn('S_ALI');
    const payload = dineIn('O1', fullCart(), { order_note: 'birthday' });
    const counted = countHandle();
    const r = await submit(ali, payload);
    counted.restore();
    expect(r.status).toBe(200);
    // §3.2 Statements: 1 seating + lock (02a requireLock, 1) + 1 ids + 1 follow_up + 1 item_availability = 5. The spec's
    // 7 also counts the zone counts (step 5, only with a zone candidate) and the token (takeaway only).
    expect(counted.calls).toEqual([5]);
    const ids = ['L1', 'L1o', 'L2', 'L3', 'D1', 'D1a', 'D1b'];
    expect(r.events.map((e) => e.event_type)).toEqual(['TableLocked', 'OrderPlaced', ...ids.map(() => 'ItemAdded'), 'StockReserved', 'StockReserved']);
    for (const e of r.events) expect({ actor_id: e.actor_id, device_id: e.device_id }).toEqual({ actor_id: 'S_ALI', device_id: ali.deviceId });
    expect(r.events[0]).toMatchObject({ stream_type: 'table', stream_id: FX.table, payload: { table_id: FX.table, seating_id: 'SEAT1', staff_id: 'S_ALI' } });

    const placed = r.events[1]!;
    expect(placed).toMatchObject({ stream_type: 'order', stream_id: 'O1' });
    const groups = placed.payload.groups as Array<{ group_id: string; target_land_ms: number; promise_ms: number; order_item_ids: string[] }>;
    expect(placed.payload).toEqual({
      order_id: 'O1',
      order_type: 'dine_in',
      table_id: FX.table,
      table_key: 'dine_in:SEAT1',
      follow_up: false,
      pickup_at_ms: null,
      order_item_ids: ids,
      groups,
      lines: expect.any(Array),
      business_date: day.business_date,
      order_note: 'birthday',
      sent_after_reconnect: false,
      has_phone: false,
      has_food: true,
    });
    // planOrder's route fields copied verbatim with the line's 01a knobs; the deal header is no engine line (03a :245).
    const lines = placed.payload.lines as Array<Record<string, unknown>>;
    expect(lines.map((l) => l.order_item_id)).toEqual(['L1', 'L1o', 'L2', 'L3', 'D1a', 'D1b']);
    for (const l of lines) {
      expect(Object.keys(l).sort()).toEqual(
        ['alternates', 'carry_ms', 'from_stock', 'max_carry_ms', 'max_early_ms', 'max_late_ms', 'order_item_id', 'point_id', 'station_id', 'weight_pct'].sort(),
      );
    }
    expect(lines.find((l) => l.order_item_id === 'L1')).toMatchObject({ station_id: FX.station, from_stock: true, weight_pct: 100 });

    // ItemAdded × n = buildSubmit's copies (01c §4.3), in order_item_ids order.
    const state = engine();
    const config = branchConfig()!;
    const units = Object.fromEntries(config.stock_items.map((s) => [s.stock_item_id, s.stock_unit]));
    const expected = buildSubmit(config, payload as unknown as SubmitInput, {
      now: hub.clock.branchNow(),
      utc_offset_ms: hubTime(hub.clock).utc_offset_ms,
      isAvailable: () => true,
      draws: (id) => dayDraws(state, config.items.find((i) => i.item_id === id)!, units),
      primary_table_id: FX.table,
      follow_up: false,
    }).itemAdded;
    expect(r.events.filter((e) => e.event_type === 'ItemAdded').map((e) => e.payload)).toEqual(expected);
    expect(r.events.filter((e) => e.event_type === 'StockReserved').map((e) => e.payload)).toEqual([
      { stock_item_id: FX.stock, order_item_id: 'L1', quantity: 500 },
      { stock_item_id: FX.stock, order_item_id: 'D1a', quantity: 500 },
    ]);

    // §3.2 step 11: promise_ms only, never target_land_ms (03a #9).
    expect(r.result).toEqual({
      order_id: 'O1',
      token: null,
      groups: groups.map((g) => ({ group_id: g.group_id, promise_ms: g.promise_ms, order_item_ids: g.order_item_ids })),
      lines: ids.map((id) => ({
        order_item_id: id,
        eta_ms: id === 'D1' ? null : expect.any(Number),
        from_stock: id === 'L1' || id === 'D1a',
        zone_served: false,
      })),
    });
    expect(JSON.stringify(r.body)).not.toContain('target_land_ms');
    expect(state.orders.O1).toMatchObject({ table_key: 'dine_in:SEAT1', table_id: FX.table, placed_by: 'S_ALI' });
    expect(orderRow('O1')).toMatchObject({ order_type: 'dine_in', table_key: 'dine_in:SEAT1', token: null, follow_up: 0 });
    expect(lockRows()).toEqual([{ table_id: FX.table, seating_id: 'SEAT1', staff_id: 'S_ALI', device_id: ali.deviceId }]);
  });

  it('[02b #2 order_note] order_note on OrderPlaced (and the orders row), kitchen_note on its ItemAdded; no note → no order_note field', async () => {
    await setUp();
    const cashier = signIn('S_CASHIER');
    const r = await submit(cashier, takeaway('O1', [item('L1', FX.naan, 1, { kitchen_note: 'well done' })], { order_note: 'x'.repeat(200) }));
    expect(r.status).toBe(200);
    expect(r.events.find((e) => e.event_type === 'OrderPlaced')!.payload.order_note).toBe('x'.repeat(200));
    expect(r.events.find((e) => e.event_type === 'ItemAdded')!.payload.kitchen_note).toBe('well done');
    expect(orderRow('O1')!.order_note).toBe('x'.repeat(200));
    const plain = await submit(cashier, takeaway('O2', [item('L2', FX.naan)]));
    expect(plain.events.find((e) => e.event_type === 'OrderPlaced')!.payload).not.toHaveProperty('order_note');
    const long = await submit(cashier, takeaway('O3', [item('L3', FX.naan, 1, { kitchen_note: 'y'.repeat(81) })], { order_note: 'x'.repeat(201) }));
    expect(long.status).toBe(400);
    expect((long.error!.details.issues as Array<{ path: string }>).map((i) => i.path).sort()).toEqual(['lines.0.kitchen_note', 'order_note']);
  });

  it('[02b #1] delivery → 400 VALIDATION_FAILED at order_type (AD-17: 400, not 422); nothing appended', async () => {
    await setUp();
    const cashier = signIn('S_CASHIER');
    const before = eventCount();
    const r = await submit(cashier, { order_id: 'O1', order_type: 'delivery', lines: [item('L1', FX.naan)] });
    expect(r.status).toBe(400);
    expect(r.error!.code).toBe('VALIDATION_FAILED');
    expect((r.error!.details.issues as Array<{ path: string }>).map((i) => i.path)).toEqual(['order_type']);
    expect(eventCount()).toBe(before);
  });

  it('[02b #1] parking: table_key from car_number_norm, car_number as typed; two orders on one plate share a table_key; 2 statements', async () => {
    await setUp();
    const cashier = signIn('S_CASHIER');
    const counted = countHandle();
    const a = await submit(cashier, { order_id: 'O1', order_type: 'parking', parking: { car_number: 'leb-12 34', car_type: 'mini' }, lines: [item('L1', FX.naan)] });
    const b = await submit(cashier, { order_id: 'O2', order_type: 'parking', parking: { car_number: 'LEB 1234', car_type: 'large' }, lines: [item('L2', FX.naan)] });
    counted.restore();
    expect([a.status, b.status]).toEqual([200, 200]);
    // parking: 1 ids + 1 item_availability (no seating, lock, follow_up, zone counts or token).
    expect(counted.calls).toEqual([2, 2]);
    const placedA = a.events.find((e) => e.event_type === 'OrderPlaced')!.payload;
    expect(placedA).toMatchObject({ order_type: 'parking', table_id: null, table_key: 'parking:LEB1234', car_number: 'leb-12 34', car_type: 'mini', follow_up: false });
    expect(placedA).not.toHaveProperty('token');
    expect(b.events.find((e) => e.event_type === 'OrderPlaced')!.payload.table_key).toBe('parking:LEB1234');
    expect(orderRow('O1')).toMatchObject({ table_key: 'parking:LEB1234', car_number: 'leb-12 34', car_type: 'mini', token: null });
    expect(a.result!.token).toBeNull();
    // car_type is required (S10); car_number 2–12 of letters, digits, space, dash.
    for (const parking of [{ car_number: 'LEB 1234' }, { car_number: 'L', car_type: 'mini' }, { car_number: 'LEB#1234', car_type: 'mini' }, { car_number: 'LEB 1234', car_type: 'bus' }]) {
      const bad = await submit(cashier, { order_id: 'O9', order_type: 'parking', parking, lines: [item('L9', FX.naan)] });
      expect(bad.status).toBe(400);
    }
    const none = await submit(cashier, { order_id: 'O9', order_type: 'parking', lines: [item('L9', FX.naan)] });
    expect(none.status).toBe(400);
    expect((none.error!.details.issues as Array<{ path: string }>).map((i) => i.path)).toEqual(['parking']);
  });

  it('[02b #1] TABLE_SEATING_CHANGED (stale or unknown seating) and TABLE_NEEDS_CLEANING (m-10); dine-in without seating_id → 400; nothing appended', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    const ali = signIn('S_ALI');
    const before = eventCount();
    const stale = await submit(ali, dineIn('O1', [item('L1', FX.naan)], { seating_id: 'SEAT_OLD' }));
    expect(stale.status).toBe(409);
    expect(stale.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: FX.table, seating_id: 'SEAT_OLD' } });
    const free = await submit(ali, dineIn('O1', [item('L1', FX.naan)], { table_id: FX.zoneTable }));
    expect(free.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: FX.zoneTable, seating_id: 'SEAT1' } });
    const missing = await submit(ali, dineIn('O1', [item('L1', FX.naan)], { seating_id: undefined }));
    expect(missing.status).toBe(400);
    expect((missing.error!.details.issues as Array<{ path: string }>).map((i) => i.path)).toEqual(['seating_id']);
    expect(eventCount()).toBe(before);
    billClosed('SEAT1');
    const cleaning = await submit(ali, dineIn('O1', [item('L1', FX.naan)]));
    expect(cleaning.status).toBe(409);
    expect(cleaning.error).toEqual({ code: 'TABLE_NEEDS_CLEANING', details: { table_id: FX.table } });
    expect(eventCount()).toBe(before + 1);
  });

  it('[02b §6.1] TABLE_ALREADY_LOCKED: the holder holds the lock, a take-order-anywhere submit is refused; nothing appended', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    const ali = signIn('S_ALI');
    expect((await submit(ali, dineIn('O1', [item('L1', FX.naan)]))).status).toBe(200);
    const bilal = signIn('S_BILAL');
    const before = eventCount();
    const r = await submit(bilal, dineIn('O2', [item('L2', FX.naan)]));
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'TABLE_ALREADY_LOCKED', details: { table_id: FX.table, locked_by_staff_id: 'S_ALI', locked_by_name: 'Ali' } });
    expect(eventCount()).toBe(before);
  });

  it('[02b #4] no open business day → 409 BUSINESS_DAY_NOT_OPEN; nothing appended', async () => {
    await setUp();
    closeDay();
    const cashier = signIn('S_CASHIER');
    const before = eventCount();
    const r = await submit(cashier, takeaway('O1', [item('L1', FX.naan)]));
    expect(r.status).toBe(409);
    expect(r.error!.code).toBe('BUSINESS_DAY_NOT_OPEN');
    expect(eventCount()).toBe(before);
    expect(orderRow('O1')).toBeUndefined();
  });

  it('[02b #5] an id repeated in the payload → 400 at its path (C6); nothing appended', async () => {
    await setUp();
    const cashier = signIn('S_CASHIER');
    const before = eventCount();
    const cases: Array<[unknown[], string]> = [
      [[item('L1', FX.naan), item('L1', FX.naan)], 'lines.1.order_item_id'],
      [[item('O1', FX.naan)], 'lines.0.order_item_id'],
      [[item('L1', FX.piece, 1, { options: [{ option_id: FX.option, quantity: 1, order_item_id: 'L1' }] })], 'lines.0.options.0.order_item_id'],
      [
        [
          item('L1', FX.naan),
          { order_item_id: 'D1', deal_id: FX.deal, quantity: 1, deal_choices: [
            { deal_part_id: FX.dealParts[0], item_id: FX.piece, order_item_id: 'D1a' },
            { deal_part_id: FX.dealParts[1], item_id: FX.naan, order_item_id: 'L1' },
          ] },
        ],
        'lines.1.deal_choices.1.order_item_id',
      ],
    ];
    for (const [lines, path] of cases) {
      const r = await submit(cashier, takeaway('O1', lines));
      expect(r.status).toBe(400);
      expect(r.error!.code).toBe('VALIDATION_FAILED');
      expect((r.error!.details.issues as Array<{ path: string }>).map((i) => i.path)).toEqual([path]);
    }
    expect(eventCount()).toBe(before);
  });

  it('[02b #5] an id already in orders / order_lines or live in EngineState → 409 ORDER_ITEM_ID_IN_USE before any append', async () => {
    await setUp();
    const cashier = signIn('S_CASHIER');
    const first = await submit(cashier, takeaway('O1', [item('L1', FX.naan)]));
    expect(first.status).toBe(200);
    const before = eventCount();
    const order = await submit(cashier, takeaway('O1', [item('L9', FX.naan)]));
    expect(order.status).toBe(409);
    expect(order.error).toEqual({ code: 'ORDER_ITEM_ID_IN_USE', details: { order_id: 'O1' } });
    const line = await submit(cashier, takeaway('O2', [item('L8', FX.naan), item('L1', FX.naan)]));
    expect(line.error).toEqual({ code: 'ORDER_ITEM_ID_IN_USE', details: { order_item_id: 'L1' } });
    const child = await submit(cashier, takeaway('O2', [item('L7', FX.piece, 1, { options: [{ option_id: FX.option, quantity: 1, order_item_id: 'L1' }] })]));
    expect(child.error).toEqual({ code: 'ORDER_ITEM_ID_IN_USE', details: { order_item_id: 'L1' } });
    // Live in EngineState only: an engine order whose projection rows are gone (as a pre-E-1 order, which 02b's
    // projection never stored) is still in use.
    const live = appendOrder(hub, { order_type: 'takeaway', order_id: 'O_LIVE', lines: [{ order_item_id: 'L_LIVE', item_id: FX.naan }] });
    hub.deps.db.prepare('DELETE FROM orders WHERE order_id = ?').run(live.order_id);
    hub.deps.db.prepare('DELETE FROM order_lines WHERE order_id = ?').run(live.order_id);
    expect(engine().orders.O_LIVE).toBeDefined();
    const afterFixture = eventCount();
    const liveOrder = await submit(cashier, takeaway('O_LIVE', [item('L6', FX.naan)]));
    expect(liveOrder.error).toEqual({ code: 'ORDER_ITEM_ID_IN_USE', details: { order_id: 'O_LIVE' } });
    const liveLine = await submit(cashier, takeaway('O3', [item('L_LIVE', FX.naan)]));
    expect(liveLine.error).toEqual({ code: 'ORDER_ITEM_ID_IN_USE', details: { order_item_id: 'L_LIVE' } });
    expect(eventCount()).toBe(afterFixture);
    expect(afterFixture).toBeGreaterThan(before);
  });

  it('[02b §6.1] MENU_ITEM_NOT_FOUND, DEAL_NOT_FOUND, ITEM_UNAVAILABLE (manual Off), ITEM_OUT_OF_HOURS (hub time), OPTION_CHOICE_INVALID; nothing appended', async () => {
    const now = 1_761_000_000_000;
    const tod = localTimeOfDayMs(now, 0 - new Date(now).getTimezoneOffset() * 60_000);
    const DAY = 86_400_000;
    // A window that opens 1 h from now and closes 2 h from now (hub local time).
    const window = { start_ms: (tod + 3_600_000) % DAY, end_ms: (tod + 7_200_000) % DAY };
    const menu = fixtureMenu();
    menu.items = menu.items.map((i) => (i.item_id === FX.optionItem ? { ...i, availability_windows: [window] } : i));
    await setUp({ menu });
    makeUnavailable(FX.naan);
    const cashier = signIn('S_CASHIER');
    const before = eventCount();
    const cases: Array<[unknown, number, string, Record<string, unknown> | undefined]> = [
      [item('L1', 'I_NOPE'), 404, 'MENU_ITEM_NOT_FOUND', { item_id: 'I_NOPE' }],
      [{ order_item_id: 'L1', deal_id: 'D_NOPE', quantity: 1, deal_choices: [] }, 404, 'DEAL_NOT_FOUND', { deal_id: 'D_NOPE' }],
      [item('L1', FX.naan), 409, 'ITEM_UNAVAILABLE', { item_id: FX.naan }],
      [item('L1', FX.optionItem), 409, 'ITEM_OUT_OF_HOURS', { item_id: FX.optionItem, opens_at_ms: expect.any(Number) }],
      [item('L1', FX.piece, 1, { options: [{ option_id: FX.option, quantity: 6, order_item_id: 'L1o' }] }), 422, 'OPTION_CHOICE_INVALID', undefined],
    ];
    for (const [line, status, code, details] of cases) {
      const r = await submit(cashier, takeaway('O1', [line]));
      expect([r.status, r.error!.code]).toEqual([status, code]);
      if (details !== undefined) expect(r.error!.details).toEqual(details);
      else expect(r.error!.details).toMatchObject({ order_item_id: 'L1', violations: expect.any(Array) });
    }
    expect(eventCount()).toBe(before);
  });

  it('[02b §3.2 step 4] the manual Off of a linked option item is read (item_availability over the items the payload reaches)', async () => {
    await setUp();
    makeUnavailable(FX.optionItem);
    const cashier = signIn('S_CASHIER');
    const before = eventCount();
    const r = await submit(cashier, takeaway('O1', [item('L1', FX.piece, 1, { options: [{ option_id: FX.option, quantity: 1, order_item_id: 'L1o' }] })]));
    expect(r.status).toBe(422);
    expect(r.error).toMatchObject({ code: 'OPTION_CHOICE_INVALID', details: { order_item_id: 'L1' } });
    expect(eventCount()).toBe(before);
    expect((await submit(cashier, takeaway('O2', [item('L2', FX.piece)]))).status).toBe(200);
  });

  it('[02b #7] sold_out with 0 < available < needed → ITEM_SOLD_OUT { available }; two lines of one item, 3 left → the second refused with available 1 (N-7); nothing appended', async () => {
    const menu = fixtureMenu();
    menu.items = menu.items.map((i) => (i.item_id === FX.piece ? { ...i, out_of_stock_behaviour: 'sold_out' as const } : i));
    await setUp({ menu, stock: { [FX.stock]: 1_500 } }); // 3 karahis (500 g each)
    const cashier = signIn('S_CASHIER');
    const before = eventCount();
    const four = await submit(cashier, takeaway('O1', [item('L1', FX.piece, 4)]));
    expect(four.status).toBe(409);
    expect(four.error).toEqual({ code: 'ITEM_SOLD_OUT', details: { item_id: FX.piece, available: 3 } });
    const two = await submit(cashier, takeaway('O1', [item('L1', FX.naan), item('L2', FX.piece, 2), item('L3', FX.piece, 2)]));
    expect(two.error).toEqual({ code: 'ITEM_SOLD_OUT', details: { item_id: FX.piece, available: 1 } });
    expect(eventCount()).toBe(before);
    const fits = await submit(cashier, takeaway('O1', [item('L2', FX.piece, 2), item('L3', FX.piece, 1)]));
    expect(fits.status).toBe(200);
    expect(fits.result!.lines.map((l) => l.from_stock)).toEqual([true, true]);
  });

  it('[02b #7] sold out is never ITEM_UNAVAILABLE (AD-21): a sold_out item at available 0 → ITEM_SOLD_OUT { available: 0 }; a cook_fresh one is accepted', async () => {
    const menu = fixtureMenu();
    menu.items = [...menu.items, { ...menu.items.find((i) => i.item_id === FX.piece)!, item_id: 'I_PAYE', name: 'Paye', out_of_stock_behaviour: 'sold_out' as const }];
    await setUp({ menu }); // K1 never counted: available 0
    const cashier = signIn('S_CASHIER');
    const sold = await submit(cashier, takeaway('O1', [item('L1', 'I_PAYE')]));
    expect(sold.error).toEqual({ code: 'ITEM_SOLD_OUT', details: { item_id: 'I_PAYE', available: 0 } });
    const fresh = await submit(cashier, takeaway('O2', [item('L2', FX.piece)]));
    expect(fresh.status).toBe(200);
    expect(fresh.result!.lines[0]!.from_stock).toBe(false);
  });

  it('[02b #7] cook_fresh short of stock → full cook time, not from stock; with stock → planOrder gets from_stock (StockReserved, stock time)', async () => {
    await setUp({ stock: { [FX.stock]: 500 } });
    const cashier = signIn('S_CASHIER');
    const now = hub.clock.branchNow();
    const fresh = await submit(cashier, takeaway('O1', [item('L1', FX.piece, 2)]));
    expect(fresh.status).toBe(200);
    expect(fresh.events.map((e) => e.event_type)).toEqual(['OrderPlaced', 'ItemAdded']);
    expect(fresh.result!.lines[0]).toMatchObject({ from_stock: false });
    expect(fresh.result!.lines[0]!.eta_ms! - now).toBeGreaterThanOrEqual(1_200_000); // cook_time_ms
    const stocked = await submit(cashier, takeaway('O2', [item('L2', FX.piece, 1)]));
    expect(stocked.events.map((e) => e.event_type)).toEqual(['OrderPlaced', 'ItemAdded', 'StockReserved']);
    expect(stocked.result!.lines[0]).toMatchObject({ from_stock: true });
    expect((stocked.events[0]!.payload.lines as Array<{ from_stock: boolean }>)[0]!.from_stock).toBe(true);
    expect(stocked.result!.lines[0]!.eta_ms! - now).toBeLessThan(1_200_000);
    expect(engine().lines.L2).toMatchObject({ from_stock: true });
  });

  it('[02b #8] paused station → 409 STATION_PAUSED { station_id }; nothing appended, no lock taken', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    pause(FX.station);
    const ali = signIn('S_ALI');
    const before = eventCount();
    const r = await submit(ali, dineIn('O1', [item('L1', FX.naan)]));
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'STATION_PAUSED', details: { station_id: FX.station } });
    expect(eventCount()).toBe(before);
    expect(lockRows()).toEqual([]);
  });

  it('[02b #9] two submits on the last Paye: one from stock, the other full cook time; stock never negative', async () => {
    await setUp({ stock: { [FX.stock]: 500 } }); // the last karahi
    const a = signIn('S_CASHIER');
    const b = signIn('S_CASHIER');
    const now = hub.clock.branchNow();
    const [ra, rb] = await Promise.all([submit(a, takeaway('O1', [item('L1', FX.piece)])), submit(b, takeaway('O2', [item('L2', FX.piece)]))]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    const lines = [ra.result!.lines[0]!, rb.result!.lines[0]!];
    expect(lines.map((l) => l.from_stock).sort()).toEqual([false, true]);
    const freshLine = lines.find((l) => !l.from_stock)!;
    expect(freshLine.eta_ms! - now).toBeGreaterThanOrEqual(1_200_000);
    const reserved = [...ra.events, ...rb.events].filter((e) => e.event_type === 'StockReserved');
    expect(reserved).toHaveLength(1);
    const stock = engine().stock[FX.stock]!;
    expect(stock.on_hand - stock.reserved).toBe(0);
    expect(availableStock(engine(), FX.stock, engine().business_day!.opened_at, branchConfig()!.stock_items[0]!)).toBe(0);
  });

  it('[02b #10] round 2 is a new order; follow_up only after a served food line (a served water alone → false); the earlier promise unchanged (E2-ADD AC1); 5 statements', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    const ali = signIn('S_ALI');
    const r1 = await submit(ali, dineIn('O1', [item('L1', FX.piece), item('L2', FX.ready)]));
    expect(r1.status).toBe(200);
    const promise1 = engine().orders.O1!.promise_ms;
    serve('O1', ['L2']); // water (is_ready_item) served: not food
    const counted = countHandle();
    const r2 = await submit(ali, dineIn('O2', [item('L3', FX.naan)]));
    counted.restore();
    expect(counted.calls).toEqual([5]);
    expect(r2.status).toBe(200);
    expect(r2.result!.order_id).toBe('O2');
    expect(r2.events.map((e) => e.event_type)).toEqual(['OrderPlaced', 'ItemAdded']); // the lock is already Ali's on this device
    expect(r2.events[0]!.payload.follow_up).toBe(false);
    expect(engine().orders.O1!.promise_ms).toBe(promise1);
    expect(hub.deps.db.prepare('SELECT order_id FROM seating_orders WHERE seating_id = ? ORDER BY order_id').all('SEAT1')).toEqual([{ order_id: 'O1' }, { order_id: 'O2' }]);
    serve('O1', ['L1']); // the karahi: a food line
    const r3 = await submit(ali, dineIn('O3', [item('L4', FX.naan)]));
    expect(r3.events[0]!.payload.follow_up).toBe(true);
    expect(engine().orders.O3!.follow_up).toBe(true);
    expect(orderRow('O3')!.follow_up).toBe(1);
    // Takeaway / parking: false.
    const t = await submit(signIn('S_CASHIER'), takeaway('O4', [item('L5', FX.naan)]));
    expect(t.events[0]!.payload.follow_up).toBe(false);
  });

  it('[02b #16] token 1, 2, 3 per business date (3 statements); dine-in / parking null; day close then reopen same date continues; next date restarts', async () => {
    const day = await setUp();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    const cashier = signIn('S_CASHIER');
    const counted = countHandle();
    const tokens: Array<number | null> = [];
    for (const n of [1, 2, 3]) {
      const r = await submit(cashier, takeaway(`T${n}`, [item(`L${n}`, FX.naan)]));
      tokens.push(r.result!.token);
      expect(r.events[0]!.payload).toMatchObject({ token: n, table_key: `takeaway:T${n}`, table_id: null, business_date: day.business_date });
    }
    counted.restore();
    // takeaway: 1 ids + 1 token + 1 item_availability.
    expect(counted.calls).toEqual([3, 3, 3]);
    expect(tokens).toEqual([1, 2, 3]);
    expect(orderRow('T2')).toMatchObject({ business_date: day.business_date, token: 2 });
    const dine = await submit(signIn('S_ALI'), dineIn('D1', [item('LD', FX.naan)]));
    expect(dine.result!.token).toBeNull();
    expect(dine.events.find((e) => e.event_type === 'OrderPlaced')!.payload).not.toHaveProperty('token');
    const park = await submit(cashier, { order_id: 'P1', order_type: 'parking', parking: { car_number: 'ABC 1', car_type: 'sedan' }, lines: [item('LP', FX.naan)] });
    expect(park.result!.token).toBeNull();
    expect([orderRow('D1')!.token, orderRow('P1')!.token]).toEqual([null, null]);

    // Day close: a served-but-unbilled takeaway leaves (m-3); an unserved one stays open with its date beside its token.
    serve('T1', ['L1']);
    closeDay();
    expect(orderRow('T1')!.day_closed_at).not.toBeNull();
    expect(orderRow('T2')).toMatchObject({ day_closed_at: null, business_date: day.business_date, token: 2 });
    // Reopened the same date: the numbering continues (§3.11).
    const again = openDay(hub);
    expect(again.business_date).toBe(day.business_date);
    const r4 = await submit(cashier, takeaway('T4', [item('L4', FX.naan)]));
    expect(r4.result!.token).toBe(4);
    // The next business date starts at 1.
    closeDay();
    hub.clock.advance(86_400_000);
    const next = openDay(hub);
    expect(next.business_date).not.toBe(day.business_date);
    const r5 = await submit(signIn('S_CASHIER'), takeaway('T5', [item('L5', FX.naan)])); // a new day, a new login
    expect(r5.result!.token).toBe(1);
    expect(orderRow('T5')).toMatchObject({ business_date: next.business_date, token: 1 });
  });

  it('[02b §3.2 step 10] takeaway contact → OrderContactSet last (O17), digits only; OrderPlaced has has_phone, no contact; parking phone alone', async () => {
    await setUp();
    const cashier = signIn('S_CASHIER');
    const r = await submit(cashier, takeaway('O1', [item('L1', FX.naan)], { takeaway: { customer_name: 'Ahmed', phone: '0300-123 4567' } }));
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['OrderPlaced', 'ItemAdded', 'OrderContactSet']);
    expect(r.events[2]).toMatchObject({ stream_type: 'order', stream_id: 'O1', payload: { order_id: 'O1', customer_name: 'Ahmed', phone: '03001234567' } });
    const placed = r.events[0]!.payload;
    expect(placed.has_phone).toBe(true);
    expect(placed).not.toHaveProperty('customer_name');
    expect(placed).not.toHaveProperty('phone');
    expect(JSON.stringify(placed)).not.toMatch(/Ahmed|03001234567/);
    expect(orderRow('O1')).toMatchObject({ customer_name: 'Ahmed', phone: '03001234567' });
    // §7 logs: order_id, command_type, order_type, line count, queued; never names or phones.
    expect(hub.logs()).toMatch(/"order_id":"O1","command_type":"SubmitOrder","order_type":"takeaway","line_count":1,"queued":false/);
    expect(hub.logs()).not.toMatch(/Ahmed|03001234567/);
    const name = await submit(cashier, takeaway('O2', [item('L2', FX.naan)], { takeaway: { customer_name: 'Sana' } }));
    expect(name.events.at(-1)!.payload).toEqual({ order_id: 'O2', customer_name: 'Sana', phone: null });
    expect(name.events[0]!.payload.has_phone).toBe(false);
    const park = await submit(cashier, { order_id: 'O3', order_type: 'parking', parking: { car_number: 'ABC 1', car_type: 'sedan', phone: '923001234567' }, lines: [item('L3', FX.naan)] });
    expect(park.events.at(-1)!.payload).toEqual({ order_id: 'O3', customer_name: null, phone: '923001234567' });
    const bare = await submit(cashier, takeaway('O4', [item('L4', FX.naan)]));
    expect(bare.events.map((e) => e.event_type)).toEqual(['OrderPlaced', 'ItemAdded']);
    for (const phone of ['12345', '12345678901234', 'call me']) {
      const bad = await submit(cashier, takeaway('O5', [item('L5', FX.naan)], { takeaway: { phone } }));
      expect(bad.status).toBe(400);
    }
    const longName = await submit(cashier, takeaway('O5', [item('L5', FX.naan)], { takeaway: { customer_name: 'n'.repeat(41) } }));
    expect(longName.status).toBe(400);
  });

  it('[02b §6.1] lines 1–40; contact or table fields on the wrong order type → 400', async () => {
    await setUp();
    const cashier = signIn('S_CASHIER');
    expect((await submit(cashier, takeaway('O1', []))).status).toBe(400);
    const many = Array.from({ length: 41 }, (_, n) => item(`L${n}`, FX.naan));
    expect((await submit(cashier, takeaway('O1', many))).status).toBe(400);
    expect((await submit(cashier, takeaway('O1', many.slice(0, 40)))).status).toBe(200);
    const wrong = await submit(cashier, takeaway('O2', [item('M1', FX.naan)], { table_id: FX.table, parking: { car_number: 'AB', car_type: 'mini' } }));
    expect(wrong.status).toBe(400);
    expect((wrong.error!.details.issues as Array<{ path: string }>).map((i) => i.path).sort()).toEqual(['parking', 'table_id']);
  });

  it('[02b #23 submit] default order taker submits on a table outside any assigned floor → allowed; default cashier places a takeaway → allowed (M-6)', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_OT' });
    const taker = await submit(signIn('S_OT'), dineIn('O1', [item('L1', FX.naan)]));
    expect(taker.status).toBe(200);
    expect(taker.events.map((e) => e.event_type)).toEqual(['TableLocked', 'OrderPlaced', 'ItemAdded']);
    const cashier = await submit(signIn('S_CASHIER'), takeaway('O2', [item('L2', FX.naan)]));
    expect(cashier.status).toBe(200);
    expect(cashier.result!.token).toBe(1);
  });

  it('[02a #53 order] after a take-over, Bilal with take-order-anywhere submits from his draft → order written, no TableLocked, lock stays free; Ali locks at once; without the permission → 403', async () => {
    await setUp();
    // Ali took SEAT1 over from Bilal: holder = Ali, Bilal's lock released (02a T20).
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    const bilal = await submit(signIn('S_BILAL'), dineIn('O1', [item('L1', FX.naan)]));
    expect(bilal.status).toBe(200);
    expect(bilal.events.map((e) => e.event_type)).toEqual(['OrderPlaced', 'ItemAdded']);
    expect(bilal.events[0]!.actor_id).toBe('S_BILAL');
    expect(orderRow('O1')).toMatchObject({ table_key: 'dine_in:SEAT1' });
    expect(lockRows()).toEqual([]);
    const ali = signIn('S_ALI');
    const opens = await submit(ali, dineIn('O2', [item('L2', FX.naan)]));
    expect(opens.events.map((e) => e.event_type)).toEqual(['TableLocked', 'OrderPlaced', 'ItemAdded']);
    expect(lockRows()).toEqual([{ table_id: FX.table, seating_id: 'SEAT1', staff_id: 'S_ALI', device_id: ali.deviceId }]);
    const noorWho = signIn('S_NOOR');
    const before = eventCount();
    const noor = await submit(noorWho, dineIn('O3', [item('L3', FX.naan)]));
    expect(noor.status).toBe(403);
    expect(noor.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'not_holder' } });
    expect(eventCount()).toBe(before);
  });

  it('[02b §6] D32 retransmit: the same command_id → the same response, no new event', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    const ali = signIn('S_ALI');
    const first = await submit(ali, dineIn('O1', [item('L1', FX.naan)]), { command_id: 'cmd-same' });
    expect(first.status).toBe(200);
    const before = eventCount();
    const again = await submit(ali, dineIn('O1', [item('L1', FX.naan)]), { command_id: 'cmd-same' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(eventCount()).toBe(before);
  });

  it('[02b §3.14 AD-36] dine-in scope is 02a requireLock: a take-order my_floors holder on a table of another floor → 200; no extra my_floors check', async () => {
    await setUp();
    // FX.table is on F1; Faiz's floors are F9 only. He is the holder, so requireLock passes and the submit is written.
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_FAIZ' });
    const faiz = signIn('S_FAIZ');
    const r = await submit(faiz, dineIn('O1', [item('L1', FX.naan)]));
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['TableLocked', 'OrderPlaced', 'ItemAdded']);
    expect(lockRows()).toEqual([{ table_id: FX.table, seating_id: 'SEAT1', staff_id: 'S_FAIZ', device_id: faiz.deviceId }]);
  });

  it('[02b §3.14 AD-36] take-order-anywhere (branch) with take-order my_floors outside the table\'s floor, not the holder → 200 (02a rule)', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    const r = await submit(signIn('S_FARAH'), dineIn('O1', [item('L1', FX.naan)]));
    expect(r.status).toBe(200);
    // A free lock is never taken by a non-holder (02a G4-3 #2).
    expect(r.events.map((e) => e.event_type)).toEqual(['OrderPlaced', 'ItemAdded']);
    expect(r.events[0]!.actor_id).toBe('S_FARAH');
    expect(lockRows()).toEqual([]);
  });

  it('[02b §3.14 AD-36] a non-holder is refused by requireLock as 02a refuses: no take-order-anywhere → 403 not_holder; take-order-anywhere my_floors off the floor → 403 outside_scope; nothing appended', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    const fahadWho = signIn('S_FLOORED');
    const fawadWho = signIn('S_FAWAD');
    const before = eventCount();
    // Fahad's take-order my_floors covers F1, but he is not the holder and has no take-order-anywhere.
    const fahad = await submit(fahadWho, dineIn('O1', [item('L1', FX.naan)]));
    expect(fahad.status).toBe(403);
    expect(fahad.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'not_holder', table_id: FX.table, holder_staff_id: 'S_ALI' } });
    const fawad = await submit(fawadWho, dineIn('O2', [item('L2', FX.naan)]));
    expect(fawad.status).toBe(403);
    expect(fawad.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: [FX.table] } });
    expect(eventCount()).toBe(before);
    expect(lockRows()).toEqual([]);
  });

  it('[02b §3.1] merged seating: naming the secondary table → OrderPlaced.table_id = the primary table; AD-36: no my_floors check on either named table', async () => {
    const menu = fixtureMenu();
    menu.floors = [...menu.floors, { floor_id: 'F2', name: 'Roof', sort_order: 1, zones: [], tables: [{ table_id: 'T3', name: 'T3', seats: 4, sort_order: 0, zone_id: null }] }];
    await setUp({ menu });
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ROOF' });
    append({
      stream_type: 'table',
      stream_id: FX.table,
      event_type: 'TablesMerged',
      payload: { into_seating_id: 'SEAT1', into_table_id: FX.table, table_ids: ['T3'], absorbed_seating_id: null, order_ids: [], by_staff_id: 'S_ROOF' },
    });
    const roof = signIn('S_ROOF');
    // The primary table T2 is on F1, outside Rafay's floors: he holds the seating, so 02a's rule allows it (AD-36).
    const primary = await submit(roof, dineIn('O1', [item('L1', FX.naan)]));
    expect(primary.status).toBe(200);
    // The secondary table T3 is on F2, his floor: allowed, and the order is on the seating's primary table.
    const secondary = await submit(roof, dineIn('O2', [item('L2', FX.naan)], { table_id: 'T3' }));
    expect(secondary.status).toBe(200);
    const placed = secondary.events.find((e) => e.event_type === 'OrderPlaced')!.payload;
    expect(placed).toMatchObject({ table_id: FX.table, table_key: 'dine_in:SEAT1' });
    expect(engine().orders.O2).toMatchObject({ table_id: FX.table });
  });

  it('[02b §3.2 step 2] a queued submit (X-Queued-At, AD-1) takes no free lock and sets sent_after_reconnect', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    const ali = signIn('S_ALI');
    const r = await submit(ali, dineIn('O1', [item('L1', FX.naan)]), { queuedAt: hub.clock.branchNow() });
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['OrderPlaced', 'ItemAdded']);
    expect(r.events[0]!.payload.sent_after_reconnect).toBe(true);
    expect(orderRow('O1')!.sent_after_reconnect).toBe(1);
    expect(lockRows()).toEqual([]);
  });

  it('[02b §3.2 step 5] a from_zone line with no zone count is a kitchen line (zone_served: false, routed per step 6)', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    const r = await submit(signIn('S_ALI'), dineIn('O1', [item('L1', FX.zoneItem, 1, { from_zone: true }), item('L2', FX.naan)], { table_id: FX.zoneTable }));
    expect(r.status).toBe(200);
    expect(r.result!.lines).toEqual([
      { order_item_id: 'L1', eta_ms: expect.any(Number), from_stock: false, zone_served: false },
      { order_item_id: 'L2', eta_ms: expect.any(Number), from_stock: false, zone_served: false },
    ]);
    const added = r.events.filter((e) => e.event_type === 'ItemAdded').map((e) => e.payload);
    expect(added.map((a) => [a.order_item_id, a.station_id, a.served_from_zone_id])).toEqual([
      ['L1', FX.station, null],
      ['L2', FX.zoneStation, null], // §3.10: the zone route of the table's zone
    ]);
    expect(r.events.map((e) => e.event_type)).not.toContain('ItemServed');
  });
});
