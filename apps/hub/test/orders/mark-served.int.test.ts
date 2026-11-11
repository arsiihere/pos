import { isOrderInEngine, type EngineState } from '@pos/engine';
import type { DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { markServedCommand } from '../../src/orders/commands/mark-served';
import { orderLines } from '../../src/orders/exports';
import { voidUnits } from '../../src/orders/ledger';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { appendOrder, FX, openDay, openSeating } from './fixtures';

// 02b §6.4, §3.7, O16, §3.3, §3.14 MarkServed. Orders are seeded through the shared fixtures (real submit batches);
// engine progress (fire / start / done) and removals are real engine events through the writer.

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;

function grant(permission: string, scope: 'branch' | 'my_floors' | 'own_tables' = 'branch') {
  return { permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope };
}

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const person = (staff_id: string, role_id: string, floor_ids: string[] = []) => ({
    staff_id,
    display_name: staff_id,
    pin_hash: pin,
    role_ids: [role_id],
    denied_permissions: [],
    lead_staff_id: null,
    floor_ids,
  });
  const role = (role_id: string, permissions: ReturnType<typeof grant>[]) => ({ role_id, name: role_id, session_idle_ttl_ms: 36_000_000, permissions });
  return {
    ...base,
    roles: [
      ...base.roles,
      // 01b §6.15 default waiter (03a AD-32): mark-served and clean-table at branch.
      role('R_WAITER', [grant('mark-served'), grant('clean-table')]),
      role('R_OWN', [grant('mark-served', 'own_tables')]),
      role('R_FLOOR', [grant('mark-served', 'my_floors')]),
    ],
    staff: [
      ...base.staff,
      person('S_WAITER', 'R_WAITER'),
      person('S_OWN1', 'R_OWN'),
      person('S_OWN2', 'R_OWN'),
      person('S_FLOOR', 'R_FLOOR', [FX.floor]),
      person('S_FAR', 'R_FLOOR', ['F_OTHER']),
    ],
  };
}

beforeEach(async () => {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  // The real MarkServed handler under a test-only name, so its own statements are counted (02a R-2D-6 pattern).
  commandRegistry(hub.app).register(
    defineCommand({
      ...markServedCommand,
      commandType: 'TestMarkServedCounted',
      handle(ctx, payload, cmd) {
        const before = counter.count;
        try {
          return markServedCommand.handle(ctx, payload, cmd);
        } finally {
          lastStatements = counter.count - before;
        }
      },
    }),
  );
  counter = statementCounter(hub.deps.db);
  lastStatements = -1;
});

afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

// ------------------------------------------------------------------------------------------- seeding

const engine = (): EngineState => hub.deps.state.get() as EngineState;

function draft(stream_type: EventDraft['stream_type'], stream_id: string, event_type: string, payload: Record<string, unknown>): EventDraft {
  return { stream_type, stream_id, event_type, schema_version: 1, payload, occurred_at: hub.clock.branchNow(), actor_id: 'S_WAIT', device_id: 'D_SEED' };
}
function append(...drafts: EventDraft[]): void {
  hub.clock.advance(1_000);
  hub.deps.writer.run((tx) => tx.append(drafts));
}
const fire = (station_id: string, ...order_item_ids: string[]) =>
  append(draft('station', station_id, 'FireDispatched', { station_id, order_item_ids, load_id: null, due_at: hub.clock.branchNow(), reason: 'pulled' }));
const start = (order_id: string, order_item_id: string) =>
  append(draft('order', order_id, 'ItemStarted', { order_item_id, started_at: hub.clock.branchNow(), source: 'tap' }));
const done = (order_id: string, order_item_id: string) =>
  append(draft('order', order_id, 'ItemDone', { order_item_id, done_at: hub.clock.branchNow(), source: 'tap' }));
const remove = (order_id: string, order_item_id: string) => append(draft('order', order_id, 'ItemRemoved', { order_item_id }));
// 04's void of a started line, money from the §3.4 ledger (voidUnits over the line as folded).
function void3(order_id: string): void {
  const line = orderLines(hub.deps.db, [order_id]).get(order_id)!.find((l) => l.order_item_id === 'N3')!;
  const { refund_minor, comp_voided_minor } = voidUnits(line, line.live_units);
  append(draft('order', order_id, 'ItemVoided', { order_item_id: 'N3', units: line.live_units, refund_minor, comp_voided_minor }));
}
const lock = (table_id: string, seating_id: string, staff_id: string) =>
  append({ ...draft('table', table_id, 'TableLocked', { table_id, seating_id, staff_id }), actor_id: staff_id, device_id: 'D_HOLDER' });

function eventCount(): number {
  return (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
}
function servedAt(order_item_id: string): { served_at: number | null; served_source: string | null } {
  return hub.deps.db.prepare('SELECT served_at, served_source FROM order_lines WHERE order_item_id = ?').get(order_item_id) as {
    served_at: number | null;
    served_source: string | null;
  };
}
function seatingState(seating_id: string): string {
  return (hub.deps.db.prepare('SELECT state FROM seatings WHERE seating_id = ?').get(seating_id) as { state: string }).state;
}

// ------------------------------------------------------------------------------------------- calls

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

interface Stored {
  event_type: string;
  stream_type: string;
  stream_id: string;
  actor_id: string | null;
  device_id: string;
  payload: Record<string, unknown>;
}

interface Reply {
  status: number;
  body: unknown;
  result: Record<string, unknown> | undefined;
  events: Stored[];
  error?: { code: string; details: Record<string, unknown> };
}

type Lines = Array<{ order_id: string; order_item_ids: string[] }>;
let commandSeq = 0;

async function serve(who: Who, lines: Lines, o: { commandId?: string; type?: 'MarkServed' | 'TestMarkServedCounted' } = {}): Promise<Reply> {
  commandSeq += 1;
  const type = o.type ?? 'MarkServed';
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${type === 'MarkServed' ? 'mark-served' : 'test-mark-served-counted'}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id: o.commandId ?? `cmd-${commandSeq}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: type,
      payload: { lines },
      occurred_at: hub.clock.branchNow(),
      actor_id: who.staffId,
      device_id: who.deviceId,
    },
  });
  const body = res.json() as {
    data?: { event_ids: string[]; result: Record<string, unknown> };
    error?: { code: string; details: Record<string, unknown> };
  };
  const events =
    body.data === undefined
      ? []
      : (
          hub.deps.db
            .prepare(
              `SELECT event_type, stream_type, stream_id, actor_id, device_id, payload AS payload_json FROM events
                WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY seq`,
            )
            .all(JSON.stringify(body.data.event_ids)) as Array<Omit<Stored, 'payload'> & { payload_json: string }>
        ).map(({ payload_json, ...rest }) => ({ ...rest, payload: JSON.parse(payload_json) as Record<string, unknown> }));
  const error = body.error === undefined ? undefined : { code: body.error.code, details: body.error.details };
  return { status: res.statusCode, body, result: body.data?.result, events, error };
}

// ------------------------------------------------------------------------------------------- §3.7 / §6.4

describe('MarkServed (02b §6.4, §3.7)', () => {
  it('[02b #22] lines of 2 orders: one ItemServed per order, OrderFoodServed after it, stockEffects in array form; a from-stock line with no Start consumes (AD-29 Q7)', async () => {
    openDay(hub, { stock: { [FX.stock]: 10_000 } });
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    const o1 = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'K1', item_id: FX.piece }] }).order_id;
    const o2 = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'N1', item_id: FX.naan },
        { order_item_id: 'K2', item_id: FX.piece },
      ],
    }).order_id;
    expect(engine().lines.K1!.from_stock).toBe(true);
    expect(engine().lines.K2!.from_stock).toBe(true);
    fire(FX.station, 'K1', 'N1', 'K2');
    start(o2, 'N1');
    done(o2, 'N1');
    expect(seatingState('SEAT1')).toBe('ORDERED');

    const waiter = signIn('S_WAITER');
    const now = hub.clock.branchNow();
    const reply = await serve(waiter, [
      { order_id: o1, order_item_ids: ['K1'] },
      { order_id: o2, order_item_ids: ['N1', 'K2'] },
    ]);
    expect(reply.status).toBe(200);
    expect(reply.result).toEqual({ served: 3, skipped: [] });
    const envelope = { actor_id: 'S_WAITER', device_id: waiter.deviceId };
    expect(reply.events.map((e) => [e.event_type, e.stream_id])).toEqual([
      ['ItemServed', o1],
      ['OrderFoodServed', o1],
      ['StockConsumed', FX.stock],
      ['ItemServed', o2],
      ['OrderFoodServed', o2],
      ['StockConsumed', FX.stock],
    ]);
    expect(reply.events[0]).toEqual({ event_type: 'ItemServed', stream_type: 'order', stream_id: o1, ...envelope, payload: { order_item_ids: ['K1'], source: 'tap' } });
    expect(reply.events[1]).toEqual({ event_type: 'OrderFoodServed', stream_type: 'order', stream_id: o1, ...envelope, payload: { order_id: o1 } });
    expect(reply.events[2]).toMatchObject({ stream_type: 'stock', ...envelope, payload: { stock_item_id: FX.stock, order_item_id: 'K1' } });
    expect(reply.events[3]!.payload).toEqual({ order_item_ids: ['N1', 'K2'], source: 'tap' });
    // N1 was started: its consume was its Start's; only K2 (no Start) consumes here.
    expect(reply.events[5]).toMatchObject({ payload: { stock_item_id: FX.stock, order_item_id: 'K2' } });

    expect(servedAt('K1')).toEqual({ served_at: now, served_source: 'tap' });
    expect(engine().lines.K1!.stage).toBe('served');
    expect(engine().lines.K2!.stage).toBe('served');
    expect(seatingState('SEAT1')).toBe('FOOD_ON_TABLE');
  });

  it('[02b #22] repeat → skipped, nothing appended; a served line among new ones is skipped', async () => {
    openDay(hub, { stock: { [FX.stock]: 10_000 } });
    const o1 = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'N1', item_id: FX.naan },
        { order_item_id: 'N2', item_id: FX.naan },
      ],
    }).order_id;
    fire(FX.station, 'N1', 'N2');
    const waiter = signIn('S_WAITER');
    expect((await serve(waiter, [{ order_id: o1, order_item_ids: ['N1'] }])).result).toEqual({ served: 1, skipped: [] });

    const before = eventCount();
    const repeat = await serve(waiter, [{ order_id: o1, order_item_ids: ['N1'] }]);
    expect(repeat.status).toBe(200);
    expect(repeat.result).toEqual({ served: 0, skipped: ['N1'] });
    expect(repeat.events).toEqual([]);
    expect(eventCount()).toBe(before);

    const mixed = await serve(waiter, [{ order_id: o1, order_item_ids: ['N1', 'N2'] }]);
    expect(mixed.result).toEqual({ served: 1, skipped: ['N1'] });
    expect(mixed.events[0]!.payload).toEqual({ order_item_ids: ['N2'], source: 'tap' });
  });

  it('[02b #22] unfired line → 409 ITEM_WRONG_STAGE { stage: added }, nothing written (another order of the payload included)', async () => {
    openDay(hub);
    const o1 = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'N1', item_id: FX.naan }] }).order_id;
    const o2 = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'N2', item_id: FX.naan }] }).order_id;
    fire(FX.station, 'N1');
    const waiter = signIn('S_WAITER');
    const before = eventCount();
    const reply = await serve(waiter, [
      { order_id: o1, order_item_ids: ['N1'] },
      { order_id: o2, order_item_ids: ['N2'] },
    ]);
    expect(reply.status).toBe(409);
    expect(reply.error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'N2', stage: 'added' } });
    expect(eventCount()).toBe(before);
    expect(servedAt('N1').served_at).toBeNull();
  });

  it('[02b §3.7] fired-not-started, cooking and done lines are all servable (O16)', async () => {
    openDay(hub);
    const o1 = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'A', item_id: FX.naan },
        { order_item_id: 'B', item_id: FX.naan },
        { order_item_id: 'C', item_id: FX.naan },
      ],
    }).order_id;
    fire(FX.station, 'A', 'B', 'C');
    start(o1, 'B');
    start(o1, 'C');
    done(o1, 'C');
    const reply = await serve(signIn('S_WAITER'), [{ order_id: o1, order_item_ids: ['A', 'B', 'C'] }]);
    expect(reply.status).toBe(200);
    expect(reply.result).toEqual({ served: 3, skipped: [] });
  });

  it('[02b #22] abandoned order (out of the engine, O16: counts as fired) → Served allowed, no stockEffects', async () => {
    openDay(hub, { stock: { [FX.stock]: 10_000 } });
    const o1 = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'K1', item_id: FX.piece }] }).order_id;
    fire(FX.station, 'K1');
    hub.clock.advance(5 * 3_600_000); // past order_abandon_ms (4 h) and the planned land
    expect(isOrderInEngine(engine(), o1, hub.clock.branchNow())).toBe(false);
    // K1 is fired, never started and still holds its reservation: in the engine, a serve would consume it (AD-29 Q7).
    expect(engine().lines.K1).toMatchObject({ stage: 'added', started_at: null });
    const reply = await serve(signIn('S_WAITER'), [{ order_id: o1, order_item_ids: ['K1'] }]);
    expect(reply.status).toBe(200);
    expect(reply.result).toEqual({ served: 1, skipped: [] });
    expect(reply.events.map((e) => e.event_type)).toEqual(['ItemServed', 'OrderFoodServed']);
    expect(servedAt('K1').served_source).toBe('tap');
  });

  it('[02b §3.7 O16] an UNFIRED line cannot reach an out-of-engine order through real events: an unfired line keeps its order in the engine (03a §3.3 abandon)', async () => {
    openDay(hub, { stock: { [FX.stock]: 10_000 } });
    const o1 = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'K1', item_id: FX.piece },
        { order_item_id: 'N1', item_id: FX.naan },
      ],
    }).order_id;
    fire(FX.station, 'K1');
    hub.clock.advance(5 * 3_600_000);
    expect(engine().lines.N1).toMatchObject({ stage: 'added', fired_at: null });
    expect(isOrderInEngine(engine(), o1, hub.clock.branchNow())).toBe(true);
    const reply = await serve(signIn('S_WAITER'), [{ order_id: o1, order_item_ids: ['N1'] }]);
    expect(reply.error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'N1', stage: 'added' } });
  });

  it('[02b §3.7] removed / voided line → ITEM_WRONG_STAGE; unknown order → 404 ORDER_NOT_FOUND; a line not of the order → 404 ORDER_NOT_FOUND', async () => {
    openDay(hub);
    const o1 = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'N1', item_id: FX.naan },
        { order_item_id: 'N2', item_id: FX.naan },
        { order_item_id: 'N3', item_id: FX.naan },
      ],
    }).order_id;
    remove(o1, 'N1');
    fire(FX.station, 'N2', 'N3');
    start(o1, 'N3');
    void3(o1);
    const waiter = signIn('S_WAITER');
    const before = eventCount();

    const removed = await serve(waiter, [{ order_id: o1, order_item_ids: ['N1'] }]);
    expect(removed.status).toBe(409);
    expect(removed.error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'N1', stage: 'removed' } });

    const voided = await serve(waiter, [{ order_id: o1, order_item_ids: ['N3'] }]);
    expect(voided.status).toBe(409);
    expect(voided.error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'N3', stage: 'voided' } });

    const unknown = await serve(waiter, [{ order_id: 'O_NOPE', order_item_ids: ['N2'] }]);
    expect(unknown.status).toBe(404);
    expect(unknown.error).toEqual({ code: 'ORDER_NOT_FOUND', details: { order_id: 'O_NOPE' } });

    const stray = await serve(waiter, [{ order_id: o1, order_item_ids: ['N2', 'X9'] }]);
    expect(stray.status).toBe(404);
    expect(stray.error).toEqual({ code: 'ORDER_NOT_FOUND', details: { order_id: o1 } });
    expect(eventCount()).toBe(before);
  });

  it('[02b §3.3] a served ready item (water) → ItemServed with no OrderFoodServed; the table stays ORDERED', async () => {
    openDay(hub);
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    const o1 = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'SEAT1',
      lines: [
        { order_item_id: 'W1', item_id: FX.ready },
        { order_item_id: 'N1', item_id: FX.naan },
      ],
    }).order_id;
    fire(FX.station, 'W1', 'N1');
    const reply = await serve(signIn('S_WAITER'), [{ order_id: o1, order_item_ids: ['W1'] }]);
    expect(reply.events.map((e) => e.event_type)).toEqual(['ItemServed']);
    expect(seatingState('SEAT1')).toBe('ORDERED');
  });

  it('[02b §6 D32] same command_id → same response, no new event', async () => {
    openDay(hub);
    const o1 = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'N1', item_id: FX.naan }] }).order_id;
    fire(FX.station, 'N1');
    const waiter = signIn('S_WAITER');
    const first = await serve(waiter, [{ order_id: o1, order_item_ids: ['N1'] }], { commandId: 'cmd-same' });
    const before = eventCount();
    const again = await serve(waiter, [{ order_id: o1, order_item_ids: ['N1'] }], { commandId: 'cmd-same' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(eventCount()).toBe(before);
  });

  it('[02b §6.4] payload: 1–20 orders, a repeated order or line → 400 VALIDATION_FAILED (C6)', async () => {
    openDay(hub);
    const waiter = signIn('S_WAITER');
    const empty = await serve(waiter, []);
    expect(empty.status).toBe(400);
    expect(empty.error?.code).toBe('VALIDATION_FAILED');
    const many = await serve(
      waiter,
      Array.from({ length: 21 }, (_, i) => ({ order_id: `O${i}`, order_item_ids: [`L${i}`] })),
    );
    expect(many.status).toBe(400);
    const repeatedOrder = await serve(waiter, [
      { order_id: 'O1', order_item_ids: ['A'] },
      { order_id: 'O1', order_item_ids: ['B'] },
    ]);
    expect(repeatedOrder.status).toBe(400);
    expect(repeatedOrder.error?.code).toBe('VALIDATION_FAILED');
    const repeatedLine = await serve(waiter, [
      { order_id: 'O1', order_item_ids: ['A'] },
      { order_id: 'O2', order_item_ids: ['B', 'A'] },
    ]);
    expect(repeatedLine.status).toBe(400);
    expect(repeatedLine.error?.code).toBe('VALIDATION_FAILED');
    const noLines = await serve(waiter, [{ order_id: 'O1', order_item_ids: [] }]);
    expect(noLines.status).toBe(400);
  });

  it('[02b §6.4] statements: 2 (orders, lines) at branch scope; 3 with currentTableOf for a my_floors dine-in', async () => {
    openDay(hub);
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    const o1 = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'N1', item_id: FX.naan }] }).order_id;
    const o2 = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'N2', item_id: FX.naan }] }).order_id;
    const o3 = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'N3', item_id: FX.naan }] }).order_id;
    fire(FX.station, 'N1', 'N2', 'N3');

    const branch = await serve(signIn('S_WAITER'), [{ order_id: o1, order_item_ids: ['N1'] }, { order_id: o2, order_item_ids: ['N2'] }], { type: 'TestMarkServedCounted' });
    expect(branch.status).toBe(200);
    expect(lastStatements).toBe(2);

    const floor = await serve(signIn('S_FLOOR'), [{ order_id: o3, order_item_ids: ['N3'] }], { type: 'TestMarkServedCounted' });
    expect(floor.status).toBe(200);
    expect(lastStatements).toBe(3);
  });
});

// ------------------------------------------------------------------------------------------- §3.14 scope

describe('MarkServed scope (02b §3.14, C8)', () => {
  async function takeawayBy(placed_by: string): Promise<string> {
    const id = appendOrder(hub, { order_type: 'takeaway', placed_by, lines: [{ order_item_id: `N_${placed_by}`, item_id: FX.naan }] }).order_id;
    fire(FX.station, `N_${placed_by}`);
    return id;
  }

  it('[02b #23 serve] takeaway / parking: own_tables and my_floors = placed by the person; another person → outside_scope; branch any', async () => {
    openDay(hub);
    const byOwn1 = await takeawayBy('S_OWN1');
    const byFloor = await takeawayBy('S_FLOOR');
    const parking = appendOrder(hub, { order_type: 'parking', placed_by: 'S_OWN1', lines: [{ order_item_id: 'P1', item_id: FX.naan }] }).order_id;
    fire(FX.station, 'P1');

    const other = await serve(signIn('S_OWN2'), [{ order_id: byOwn1, order_item_ids: ['N_S_OWN1'] }]);
    expect(other.status).toBe(403);
    expect(other.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', order_ids: [byOwn1] } });

    const otherFloor = await serve(signIn('S_FLOOR'), [{ order_id: byOwn1, order_item_ids: ['N_S_OWN1'] }]);
    expect(otherFloor.status).toBe(403);
    expect(otherFloor.error?.details).toMatchObject({ reason: 'outside_scope' });

    const own = await serve(signIn('S_OWN1'), [{ order_id: byOwn1, order_item_ids: ['N_S_OWN1'] }, { order_id: parking, order_item_ids: ['P1'] }]);
    expect(own.status).toBe(200);
    const floor = await serve(signIn('S_FLOOR'), [{ order_id: byFloor, order_item_ids: ['N_S_FLOOR'] }]);
    expect(floor.status).toBe(200);

    const anyone = await takeawayBy('S_MGR');
    const branch = await serve(signIn('S_WAITER'), [{ order_id: anyone, order_item_ids: ['N_S_MGR'] }]);
    expect(branch.status).toBe(200);
  });

  it('[02b #23 serve] default waiter (mark-served branch, AD-32) serves a line of another person\'s table', async () => {
    openDay(hub);
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_OWN1' });
    const o1 = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', placed_by: 'S_OWN1', lines: [{ order_item_id: 'N1', item_id: FX.naan }] }).order_id;
    fire(FX.station, 'N1');
    const reply = await serve(signIn('S_WAITER'), [{ order_id: o1, order_item_ids: ['N1'] }]);
    expect(reply.status).toBe(200);
    expect(reply.result).toEqual({ served: 1, skipped: [] });
  });

  it('[02b §3.14] dine-in: own_tables = the current holder; my_floors = the current table\'s floor', async () => {
    openDay(hub);
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_OWN1' });
    // placed by S_OWN2: a dine-in order's scope is the table, never the placer
    const o1 = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'SEAT1',
      placed_by: 'S_OWN2',
      lines: [
        { order_item_id: 'N1', item_id: FX.naan },
        { order_item_id: 'N2', item_id: FX.naan },
      ],
    }).order_id;
    fire(FX.station, 'N1', 'N2');

    const placer = await serve(signIn('S_OWN2'), [{ order_id: o1, order_item_ids: ['N1'] }]);
    expect(placer.status).toBe(403);
    expect(placer.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', order_ids: [o1] } });
    const far = await serve(signIn('S_FAR'), [{ order_id: o1, order_item_ids: ['N1'] }]);
    expect(far.status).toBe(403);

    expect((await serve(signIn('S_OWN1'), [{ order_id: o1, order_item_ids: ['N1'] }])).status).toBe(200);
    expect((await serve(signIn('S_FLOOR'), [{ order_id: o1, order_item_ids: ['N2'] }])).status).toBe(200);
  });

  it('[02b §6 C8] scope is checked last: an outsider serving an unfired line gets ITEM_WRONG_STAGE', async () => {
    openDay(hub);
    const o1 = appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_OWN1', lines: [{ order_item_id: 'N1', item_id: FX.naan }] }).order_id;
    const reply = await serve(signIn('S_OWN2'), [{ order_id: o1, order_item_ids: ['N1'] }]);
    expect(reply.status).toBe(409);
    expect(reply.error?.code).toBe('ITEM_WRONG_STAGE');
  });

  it('[02a #62] P-1e: MarkServed by a non-holder on a locked table → allowed (no requireLock), the lock untouched', async () => {
    openDay(hub);
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_OWN1' });
    const o1 = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', placed_by: 'S_OWN1', lines: [{ order_item_id: 'N1', item_id: FX.naan }] }).order_id;
    fire(FX.station, 'N1');
    lock(FX.table, 'SEAT1', 'S_OWN1');
    const lockRow = () => hub.deps.db.prepare('SELECT staff_id, device_id FROM table_locks WHERE table_id = ?').get(FX.table);
    expect(lockRow()).toEqual({ staff_id: 'S_OWN1', device_id: 'D_HOLDER' });

    const reply = await serve(signIn('S_WAITER'), [{ order_id: o1, order_item_ids: ['N1'] }]);
    expect(reply.status).toBe(200);
    expect(reply.events.every((e) => e.stream_type !== 'table')).toBe(true);
    expect(lockRow()).toEqual({ staff_id: 'S_OWN1', device_id: 'D_HOLDER' });
  });
});
