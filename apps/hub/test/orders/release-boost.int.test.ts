import { isOrderInEngine, type EngineState } from '@pos/engine';
import type { DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { firesAlertsTick, ENGINE_ALERT_KINDS } from '../../src/engine-host/fires-alerts-tick';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { boostOrderCommand, releaseItemsCommand } from '../../src/orders/commands/release-boost';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { appendOrder, FX, openDay, openSeating } from './fixtures';

// 02b §6.5, §6.6, §3.8, O18, §3.14 ReleaseItems and BoostOrder. Orders are seeded through the shared fixtures (real
// submit batches); engine progress (fire / start / done) and the merge are real events through the writer; the
// slip_warning alerts are raised by the real fires_alerts tick (03a §6.2a) at the engine's own due time.

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;
let closeManyStatements = 0;

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
      // 01b §6.15 default waiter (03a AD-32): mark-served at branch, no boost-order.
      role('R_WAITER', [grant('mark-served'), grant('clean-table')]),
      // 02b §3.14 default order taker: mark-served and boost-order at branch.
      role('R_TAKER', [grant('mark-served'), grant('boost-order')]),
      role('R_OWN', [grant('mark-served', 'own_tables'), grant('boost-order', 'own_tables')]),
      role('R_FLOOR', [grant('mark-served', 'my_floors'), grant('boost-order', 'my_floors')]),
    ],
    staff: [
      ...base.staff,
      person('S_WAITER', 'R_WAITER'),
      person('S_TAKER', 'R_TAKER'),
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
  // The real handlers under test-only names, so their own statements are counted (02a R-2D-6 pattern). 01d's
  // closeMany statements are measured apart (§6 common rules: counts exclude 01d's own bounds).
  for (const [command, name] of [
    [releaseItemsCommand, 'TestReleaseItemsCounted'],
    [boostOrderCommand, 'TestBoostOrderCounted'],
  ] as const) {
    commandRegistry(hub.app).register(
      defineCommand({
        ...(command as typeof releaseItemsCommand),
        commandType: name,
        handle(ctx, payload, cmd) {
          const before = counter.count;
          closeManyStatements = 0;
          try {
            return (command as typeof releaseItemsCommand).handle(ctx, payload, cmd);
          } finally {
            lastStatements = counter.count - before - closeManyStatements;
          }
        },
      }),
    );
  }
  counter = statementCounter(hub.deps.db);
  lastStatements = -1;
});

afterEach(async () => {
  vi.restoreAllMocks();
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

/** 03a §6.2a: one pass of the real fires_alerts tick at the engine's own next_alert_due_at (as the tick loop runs it). */
function raiseSlips(): void {
  const due = engine().next_alert_due_at;
  expect(due).not.toBeNull();
  hub.clock.set(Math.max(hub.clock.branchNow(), due!) + 1_000);
  const now = hub.clock.branchNow();
  expect(firesAlertsTick.due(readOnlyDb(hub.deps.db), engine(), now)).toBe(true);
  hub.deps.writer.run((tx) => tx.append(firesAlertsTick.intents(tx, engine(), now)));
}

interface SlipRow {
  alert_id: string;
  state: string;
  close_reason: string | null;
  dedupe_key: string;
}
function slipAlerts(): SlipRow[] {
  return hub.deps.db
    .prepare('SELECT alert_id, state, close_reason, dedupe_key FROM alerts WHERE kind = ? ORDER BY raised_seq')
    .all(ENGINE_ALERT_KINDS.slip) as SlipRow[];
}
function eventCount(): number {
  return (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
}

/** Counts alerts.closeMany calls and their statements (01d's own, excluded from the command's count). */
function watchCloseMany() {
  const real = alerts.closeMany.bind(alerts);
  return vi.spyOn(alerts, 'closeMany').mockImplementation((ctx, items) => {
    const before = counter.count;
    try {
      return real(ctx, items);
    } finally {
      closeManyStatements += counter.count - before;
    }
  });
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

let commandSeq = 0;
const URLS: Record<string, string> = {
  ReleaseItems: 'release-items',
  BoostOrder: 'boost-order',
  TestReleaseItemsCounted: 'test-release-items-counted',
  TestBoostOrderCounted: 'test-boost-order-counted',
};

async function send(who: Who, type: string, payload: unknown, commandId?: string): Promise<Reply> {
  commandSeq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${URLS[type]!}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id: commandId ?? `cmd-${commandSeq}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: type,
      payload,
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

type ReleasePayload = { order_ids: string[]; released: string[]; expedite: string[] };
const release = (who: Who, p: ReleasePayload, o: { commandId?: string; counted?: boolean } = {}) =>
  send(who, o.counted === true ? 'TestReleaseItemsCounted' : 'ReleaseItems', p, o.commandId);
const boost = (who: Who, order_id: string, o: { commandId?: string; counted?: boolean } = {}) =>
  send(who, o.counted === true ? 'TestBoostOrderCounted' : 'BoostOrder', { order_id }, o.commandId);

/** A dine-in order of two naans on `seating_id`, both fired and never started (it goes late). */
function lateDineIn(seating_id: string, prefix: string): string {
  const order_id = appendOrder(hub, {
    order_type: 'dine_in',
    seating_id,
    lines: [
      { order_item_id: `${prefix}A`, item_id: FX.naan },
      { order_item_id: `${prefix}B`, item_id: FX.naan },
    ],
  }).order_id;
  return order_id;
}

// ------------------------------------------------------------------------------------------- §3.8 / §6.5 release

describe('ReleaseItems (02b §6.5, §3.8)', () => {
  it('[02b #24] the alert_id from planRelease is closed done via one closeMany; a pre-ticked goes-with partner still cooking arrives in expedite', async () => {
    openDay(hub);
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    const o1 = lateDineIn('SEAT1', 'N');
    fire(FX.station, 'NA', 'NB');
    raiseSlips();
    const [slip] = slipAlerts();
    expect(slip).toMatchObject({ state: 'open', dedupe_key: 'slip:dine_in:SEAT1' });
    expect(engine().slips['dine_in:SEAT1']!.alert_id).toBe(slip!.alert_id);
    // The karahi-and-naan case of D12: NA is done, its goes-with partner NB is still cooking.
    start(o1, 'NA');
    done(o1, 'NA');
    start(o1, 'NB');

    const closeMany = watchCloseMany();
    const taker = signIn('S_TAKER');
    const reply = await release(taker, { order_ids: [o1], released: ['NA'], expedite: ['NB'] });
    expect(reply.status).toBe(200);
    expect(reply.result).toEqual({ alerts_closed: 1 });
    const envelope = { actor_id: 'S_TAKER', device_id: taker.deviceId };
    expect(reply.events.map((e) => [e.event_type, e.stream_id])).toEqual([
      ['ItemsReleased', o1],
      ['AlertClosed', o1],
    ]);
    expect(reply.events[0]).toEqual({
      event_type: 'ItemsReleased',
      stream_type: 'order',
      stream_id: o1,
      ...envelope,
      payload: { order_id: o1, alert_id: slip!.alert_id, released: ['NA'], expedite: ['NB'] },
    });
    expect(reply.events[1]).toMatchObject({ ...envelope, payload: { alert_id: slip!.alert_id, reason: 'done', by_staff_id: 'S_TAKER' } });
    expect(closeMany).toHaveBeenCalledTimes(1);
    expect(closeMany.mock.calls[0]![1]).toEqual([{ alert_id: slip!.alert_id, reason: 'done' }]);
    expect(slipAlerts()).toEqual([{ ...slip!, state: 'closed', close_reason: 'done' }]);
    // The engine folded both: NB is expedited (immediate), the slip's alert is gone from its memory.
    expect(engine().lines.NB).toMatchObject({ serve_mode: 'immediate', mark: 'expedite' });
    expect(engine().slips['dine_in:SEAT1']?.alert_id ?? null).toBeNull();
  });

  it('[02b #24] merged party with two original seatings both late → two slip_warnings; one ReleaseItems for both closes both in one closeMany (O18)', async () => {
    openDay(hub);
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'SEAT1' });
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT2' });
    const o1 = lateDineIn('SEAT1', 'P');
    const o2 = lateDineIn('SEAT2', 'Q');
    // 02a T17: SEAT2 joins SEAT1 with its order; table keys are never re-keyed (02a T21, O18).
    append(
      draft('table', FX.zoneTable, 'TablesMerged', {
        into_seating_id: 'SEAT1',
        into_table_id: FX.zoneTable,
        table_ids: [FX.table],
        absorbed_seating_id: 'SEAT2',
        order_ids: [o2],
        by_staff_id: 'S_WAIT',
      }),
    );
    expect(engine().orders[o2]!.table_key).toBe('dine_in:SEAT2');
    fire(FX.zoneStation, 'PA', 'PB');
    fire(FX.station, 'QA', 'QB');
    raiseSlips();
    if (slipAlerts().length < 2) raiseSlips(); // the second seating may cross a second later
    const slips = slipAlerts();
    expect(slips.map((s) => [s.dedupe_key, s.state])).toEqual([
      ['slip:dine_in:SEAT1', 'open'],
      ['slip:dine_in:SEAT2', 'open'],
    ]);
    start(o1, 'PA');
    done(o1, 'PA');
    start(o2, 'QA');
    done(o2, 'QA');

    // The card's "Send what's ready": one ReleaseItems with every order of the card.
    const closeMany = watchCloseMany();
    const reply = await release(signIn('S_TAKER'), { order_ids: [o1, o2], released: ['PA', 'QA'], expedite: [] });
    expect(reply.status).toBe(200);
    expect(reply.result).toEqual({ alerts_closed: 2 });
    expect(reply.events.map((e) => [e.event_type, e.stream_id])).toEqual([
      ['ItemsReleased', o1],
      ['ItemsReleased', o2],
      ['AlertClosed', o1],
      ['AlertClosed', o2],
    ]);
    expect(reply.events[0]!.payload).toEqual({ order_id: o1, alert_id: slips[0]!.alert_id, released: ['PA'], expedite: [] });
    expect(reply.events[1]!.payload).toEqual({ order_id: o2, alert_id: slips[1]!.alert_id, released: ['QA'], expedite: [] });
    expect(closeMany).toHaveBeenCalledTimes(1);
    expect(closeMany.mock.calls[0]![1]).toEqual([
      { alert_id: slips[0]!.alert_id, reason: 'done' },
      { alert_id: slips[1]!.alert_id, reason: 'done' },
    ]);
    expect(slipAlerts().map((s) => [s.state, s.close_reason])).toEqual([
      ['closed', 'done'],
      ['closed', 'done'],
    ]);
  });

  it('[02b #24] no extra read: 1 statement (orders) at branch scope, + currentTableOf for a my_floors dine-in; closeMany is 01d\'s', async () => {
    openDay(hub);
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    const o1 = lateDineIn('SEAT1', 'N');
    fire(FX.station, 'NA', 'NB');
    raiseSlips();
    start(o1, 'NA');
    done(o1, 'NA');
    const closeMany = watchCloseMany();

    const floor = await release(signIn('S_FLOOR'), { order_ids: [o1], released: ['NA'], expedite: [] }, { counted: true });
    expect(floor.status).toBe(200);
    expect(floor.result).toEqual({ alerts_closed: 1 });
    expect(closeMany).toHaveBeenCalledTimes(1);
    expect(closeManyStatements).toBeGreaterThan(0);
    expect(lastStatements).toBe(2);

    start(o1, 'NB');
    done(o1, 'NB');
    const branch = await release(signIn('S_TAKER'), { order_ids: [o1], released: ['NB'], expedite: [] }, { counted: true });
    expect(branch.status).toBe(200);
    expect(lastStatements).toBe(1);
  });

  it('[02b §3.8] no open slip → ItemsReleased with alert_id null, no closeMany; nothing to send → no event', async () => {
    openDay(hub);
    const o1 = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'NA', item_id: FX.naan },
        { order_item_id: 'NB', item_id: FX.naan },
      ],
    }).order_id;
    fire(FX.station, 'NA', 'NB');
    const closeMany = watchCloseMany();
    const taker = signIn('S_TAKER');

    const nothing = await release(taker, { order_ids: [o1], released: [], expedite: [] });
    expect(nothing.status).toBe(200);
    expect(nothing.result).toEqual({ alerts_closed: 0 });
    expect(nothing.events).toEqual([]);

    start(o1, 'NA');
    done(o1, 'NA');
    const reply = await release(taker, { order_ids: [o1], released: ['NA'], expedite: [] });
    expect(reply.result).toEqual({ alerts_closed: 0 });
    expect(reply.events.map((e) => e.event_type)).toEqual(['ItemsReleased']);
    expect(reply.events[0]!.payload).toEqual({ order_id: o1, alert_id: null, released: ['NA'], expedite: [] });
    expect(closeMany).not.toHaveBeenCalled();
  });

  it('[02b §6.5] an order not in the engine (unknown, or abandoned) → 409 ORDER_NOT_IN_ENGINE, nothing written', async () => {
    openDay(hub);
    const live = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'NA', item_id: FX.naan }] }).order_id;
    fire(FX.station, 'NA');
    start(live, 'NA');
    done(live, 'NA');
    const taker = signIn('S_TAKER');
    const before = eventCount();

    const unknown = await release(taker, { order_ids: [live, 'O_NOPE'], released: ['NA'], expedite: [] });
    expect(unknown.status).toBe(409);
    expect(unknown.error).toEqual({ code: 'ORDER_NOT_IN_ENGINE', details: { order_id: 'O_NOPE' } });

    hub.clock.advance(5 * 3_600_000); // past order_abandon_ms (4 h)
    expect(isOrderInEngine(engine(), live, hub.clock.branchNow())).toBe(false);
    const gone = await release(taker, { order_ids: [live], released: ['NA'], expedite: [] });
    expect(gone.status).toBe(409);
    expect(gone.error).toEqual({ code: 'ORDER_NOT_IN_ENGINE', details: { order_id: live } });
    expect(eventCount()).toBe(before);
  });

  it('[02b §6.5] payload: order_ids required (≥ 1); lists are sets (C1): a repeated id is dropped', async () => {
    openDay(hub);
    const o1 = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'NA', item_id: FX.naan }] }).order_id;
    fire(FX.station, 'NA');
    start(o1, 'NA');
    done(o1, 'NA');
    const taker = signIn('S_TAKER');
    const empty = await release(taker, { order_ids: [], released: [], expedite: [] });
    expect(empty.status).toBe(400);
    expect(empty.error?.code).toBe('VALIDATION_FAILED');
    const missing = await send(taker, 'ReleaseItems', { order_ids: [o1] });
    expect(missing.status).toBe(400);

    const repeated = await release(taker, { order_ids: [o1, o1], released: ['NA', 'NA'], expedite: [] });
    expect(repeated.status).toBe(200);
    expect(repeated.events.map((e) => e.payload)).toEqual([{ order_id: o1, alert_id: null, released: ['NA'], expedite: [] }]);
  });

  it('[02b §6 D32] same command_id → same response, no new event', async () => {
    openDay(hub);
    const o1 = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'NA', item_id: FX.naan }] }).order_id;
    fire(FX.station, 'NA');
    start(o1, 'NA');
    done(o1, 'NA');
    const taker = signIn('S_TAKER');
    const first = await release(taker, { order_ids: [o1], released: ['NA'], expedite: [] }, { commandId: 'cmd-same' });
    expect(first.status).toBe(200);
    const before = eventCount();
    const again = await release(taker, { order_ids: [o1], released: ['NA'], expedite: [] }, { commandId: 'cmd-same' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(eventCount()).toBe(before);
  });

  it('[02b §3.14] scope as MarkServed: takeaway own_tables = placed by the person, another → outside_scope; dine-in = the holder; scope last (C8)', async () => {
    openDay(hub);
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_OWN1' });
    const take = appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_OWN1', lines: [{ order_item_id: 'TA', item_id: FX.naan }] }).order_id;
    const dine = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', placed_by: 'S_OWN2', lines: [{ order_item_id: 'DA', item_id: FX.naan }] }).order_id;
    fire(FX.station, 'TA', 'DA');
    for (const [o, l] of [
      [take, 'TA'],
      [dine, 'DA'],
    ] as const) {
      start(o, l);
      done(o, l);
    }
    const other = await release(signIn('S_OWN2'), { order_ids: [take, dine], released: ['TA', 'DA'], expedite: [] });
    expect(other.status).toBe(403);
    expect(other.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', order_ids: [take, dine] } });
    const outsiderGone = await release(signIn('S_OWN2'), { order_ids: [take, 'O_NOPE'], released: [], expedite: [] });
    expect(outsiderGone.status).toBe(409);
    expect(outsiderGone.error?.code).toBe('ORDER_NOT_IN_ENGINE');

    const own = await release(signIn('S_OWN1'), { order_ids: [take, dine], released: ['TA', 'DA'], expedite: [] });
    expect(own.status).toBe(200);
    expect(own.events.map((e) => e.stream_id)).toEqual([take, dine]);
  });
});

// ------------------------------------------------------------------------------------------- §3.8 / §6.6 boost

describe('BoostOrder (02b §6.6, §3.8)', () => {
  it('[02b #23 boost] happy path: OrderBoosted { order_id } with the command envelope; the engine marks the order boosted', async () => {
    openDay(hub);
    const o1 = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'NA', item_id: FX.naan }] }).order_id;
    expect(engine().orders[o1]!.boosted).toBe(false);
    const taker = signIn('S_TAKER');
    const reply = await boost(taker, o1);
    expect(reply.status).toBe(200);
    expect(reply.result).toEqual({});
    expect(reply.events).toEqual([
      { event_type: 'OrderBoosted', stream_type: 'order', stream_id: o1, actor_id: 'S_TAKER', device_id: taker.deviceId, payload: { order_id: o1 } },
    ]);
    expect(engine().orders[o1]!.boosted).toBe(true);
  });

  it('[02b #23 boost] ORDER_NOT_IN_ENGINE for an order that left the engine (m-10); ORDER_NOT_FOUND for an unknown order; nothing written', async () => {
    openDay(hub);
    const o1 = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'NA', item_id: FX.naan }] }).order_id;
    fire(FX.station, 'NA');
    hub.clock.advance(5 * 3_600_000); // past order_abandon_ms (4 h)
    expect(isOrderInEngine(engine(), o1, hub.clock.branchNow())).toBe(false);
    const taker = signIn('S_TAKER');
    const before = eventCount();
    const gone = await boost(taker, o1);
    expect(gone.status).toBe(409);
    expect(gone.error).toEqual({ code: 'ORDER_NOT_IN_ENGINE', details: { order_id: o1 } });
    const unknown = await boost(taker, 'O_NOPE');
    expect(unknown.status).toBe(404);
    expect(unknown.error).toEqual({ code: 'ORDER_NOT_FOUND', details: { order_id: 'O_NOPE' } });
    expect(eventCount()).toBe(before);
  });

  it('[02b #23 boost] takeaway boosted by its placer with own_tables → allowed; by another → outside_scope; my_floors same; branch any', async () => {
    openDay(hub);
    const byOwn1 = appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_OWN1', lines: [{ order_item_id: 'A1', item_id: FX.naan }] }).order_id;
    const byFloor = appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_FLOOR', lines: [{ order_item_id: 'A2', item_id: FX.naan }] }).order_id;
    const byMgr = appendOrder(hub, { order_type: 'parking', placed_by: 'S_MGR', lines: [{ order_item_id: 'A3', item_id: FX.naan }] }).order_id;

    const other = await boost(signIn('S_OWN2'), byOwn1);
    expect(other.status).toBe(403);
    expect(other.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', order_ids: [byOwn1] } });
    const otherFloor = await boost(signIn('S_FLOOR'), byOwn1);
    expect(otherFloor.status).toBe(403);
    expect(otherFloor.error?.details).toMatchObject({ reason: 'outside_scope' });

    expect((await boost(signIn('S_OWN1'), byOwn1)).status).toBe(200);
    expect((await boost(signIn('S_FLOOR'), byFloor)).status).toBe(200);
    expect((await boost(signIn('S_TAKER'), byMgr)).status).toBe(200);
  });

  it('[02b §3.14] dine-in: own_tables = the holder (not the placer); my_floors = the current table\'s floor; scope last (C8)', async () => {
    openDay(hub);
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_OWN1' });
    const o1 = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', placed_by: 'S_OWN2', lines: [{ order_item_id: 'NA', item_id: FX.naan }] }).order_id;
    expect((await boost(signIn('S_OWN2'), o1)).error?.details).toEqual({ reason: 'outside_scope', order_ids: [o1] });
    expect((await boost(signIn('S_FAR'), o1)).status).toBe(403);
    expect((await boost(signIn('S_OWN1'), o1)).status).toBe(200);
    expect((await boost(signIn('S_FLOOR'), o1)).status).toBe(200);
    // C8: an outsider on an unknown order gets the 404, not the 403.
    expect((await boost(signIn('S_OWN2'), 'O_NOPE')).status).toBe(404);
  });

  it('[02b §6.6] statements: 1 (order + holder) at branch scope; 2 with currentTableOf for a my_floors dine-in', async () => {
    openDay(hub);
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    const o1 = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'NA', item_id: FX.naan }] }).order_id;
    expect((await boost(signIn('S_TAKER'), o1, { counted: true })).status).toBe(200);
    expect(lastStatements).toBe(1);
    expect((await boost(signIn('S_FLOOR'), o1, { counted: true })).status).toBe(200);
    expect(lastStatements).toBe(2);
  });

  it('[02b §6 D32] same command_id → same response, no new event', async () => {
    openDay(hub);
    const o1 = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'NA', item_id: FX.naan }] }).order_id;
    const taker = signIn('S_TAKER');
    const first = await boost(taker, o1, { commandId: 'cmd-same' });
    const before = eventCount();
    const again = await boost(taker, o1, { commandId: 'cmd-same' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(eventCount()).toBe(before);
  });

  it('[02b §6.6] payload: order_id required → 400 VALIDATION_FAILED', async () => {
    openDay(hub);
    const reply = await send(signIn('S_TAKER'), 'BoostOrder', {});
    expect(reply.status).toBe(400);
    expect(reply.error?.code).toBe('VALIDATION_FAILED');
  });
});
