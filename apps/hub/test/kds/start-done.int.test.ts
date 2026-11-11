// 03b b8: StartItem, DoneItem (§3.2, §6.1–6.2; tests #1–#6, #10). Orders through 02b's shared fixtures (real submit
// batches); fires through the 03b fixture's real FireDispatched; the commands through the real route with real
// station / staff sessions. Statement counts on the real handlers under test-only names (02a R-2D-6 pattern).
import { lateStartShift, type EngineState } from '@pos/engine';
import type { BranchConfig, ConfigItem } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { doneItemCommand, startItemCommand } from '../../src/kds/commands/start-done';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { COOK, FX, append, appendOrder, cookDirectory, fireLines, fixtureMenu, openDay, pairKds, serveLines, signInCook } from './fixtures';

const MIN = 60_000;
// Stations of menu(): S1 (fixtureMenu: slot, two_tap, capacity 4), ST single_tap, AD auto_done, ONE two_tap capacity 1,
// B a batch station with program PR (capacity 4).
const ST = 'S_ST';
const AD = 'S_AD';
const ONE = 'S_ONE';
const B = 'S_B';

function menu(): BranchConfig {
  const base = fixtureMenu();
  const s1 = base.stations.find((s) => s.station_id === FX.station)!;
  const naan = base.items.find((i) => i.item_id === FX.naan)!;
  const item = (item_id: string, station_id: string, o: Partial<ConfigItem> = {}): ConfigItem => ({ ...naan, item_id, name: item_id, station_id, ...o });
  return {
    ...base,
    stations: [
      ...base.stations,
      { ...s1, station_id: ST, name: 'Tawa', completion_mode: 'single_tap' },
      { ...s1, station_id: AD, name: 'Fryer', completion_mode: 'auto_done' },
      { ...s1, station_id: ONE, name: 'Grill', capacity: 1 },
      { ...s1, station_id: B, name: 'Tandoor', station_type: 'batch', programs: [{ program_id: 'PR', name: 'Bake', cook_time_ms: 8 * MIN, is_archived: false }] },
    ],
    items: [
      ...base.items,
      item('I_ST', ST),
      item('I_AD', AD),
      item('I_ONE', ONE, { cook_time_ms: 5 * MIN, serve_mode: 'immediate' }),
      item('I_B', B, { program_id: 'PR', cook_time_ms: 8 * MIN }),
    ],
  };
}

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  await seedDirectory(hub, await cookDirectory());
  for (const [command, name] of [
    [startItemCommand, 'TestStartItemCounted'],
    [doneItemCommand, 'TestDoneItemCounted'],
  ] as const) {
    commandRegistry(hub.app).register(
      defineCommand({
        ...(command as typeof startItemCommand),
        commandType: name,
        handle(ctx, payload, cmd) {
          const before = counter.count;
          try {
            return (command as typeof startItemCommand).handle(ctx, payload, cmd);
          } finally {
            lastStatements = counter.count - before;
          }
        },
      }),
    );
  }
  counter = statementCounter(hub.deps.db);
  lastStatements = -1;
  openDay(hub, { menu: menu(), stock: { [FX.stock]: 5_000 } });
});

afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

const engine = (): EngineState => hub.deps.state.get() as EngineState;

// ------------------------------------------------------------------------------------------- calls

interface Who {
  staffId: string | null;
  deviceId: string;
  token: string;
  sessionToken: string;
}

function kds(stationId: string): Who {
  const device = pairKds(hub, { stationId });
  const session = openSession(hub, { kind: 'station', stationId, deviceId: device.deviceId });
  return { staffId: null, deviceId: device.deviceId, token: device.token, sessionToken: session.token };
}

async function cook(): Promise<Who> {
  const c = await signInCook(hub);
  return { staffId: COOK.staff, deviceId: c.deviceId, token: c.token, sessionToken: c.sessionToken };
}

function staff(staffId: string): Who {
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
  occurred_at: number;
  payload: Record<string, unknown>;
}
interface Reply {
  status: number;
  result: Record<string, unknown> | undefined;
  events: Stored[];
  error?: { code: string; details: Record<string, unknown> };
}

const URLS: Record<string, string> = {
  StartItem: 'start-item',
  DoneItem: 'done-item',
  TestStartItemCounted: 'test-start-item-counted',
  TestDoneItemCounted: 'test-done-item-counted',
};
let commandSeq = 0;

async function send(who: Who, type: string, payload: unknown): Promise<Reply> {
  commandSeq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${URLS[type]!}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id: `cmd-${commandSeq}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: type,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: who.staffId,
      device_id: who.deviceId,
    },
  });
  const body = res.json() as { data?: { event_ids: string[]; result: Record<string, unknown> }; error?: { code: string; details: Record<string, unknown> } };
  const events =
    body.data === undefined
      ? []
      : (
          hub.deps.db
            .prepare(
              `SELECT event_type, stream_type, stream_id, actor_id, device_id, occurred_at, payload AS payload_json FROM events
                WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY seq`,
            )
            .all(JSON.stringify(body.data.event_ids)) as Array<Omit<Stored, 'payload'> & { payload_json: string }>
        ).map(({ payload_json, ...rest }) => ({ ...rest, payload: JSON.parse(payload_json) as Record<string, unknown> }));
  const error = body.error === undefined ? undefined : { code: body.error.code, details: body.error.details };
  return { status: res.statusCode, result: body.data?.result, events, error };
}

const start = (who: Who, order_item_id: string, counted = false) => send(who, counted ? 'TestStartItemCounted' : 'StartItem', { order_item_id });
const done = (who: Who, order_item_id: string, o: { confirm?: boolean; counted?: boolean } = {}) =>
  send(who, o.counted === true ? 'TestDoneItemCounted' : 'DoneItem', { order_item_id, ...(o.confirm === undefined ? {} : { confirm: o.confirm }) });

function eventCount(): number {
  return (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
}

/** A takeaway order of `lines` (order_item_id → item_id), every line fired at its station. */
function firedOrder(lines: Record<string, string>, o: { fire?: boolean } = {}): string {
  const { order_id } = appendOrder(hub, { order_type: 'takeaway', lines: Object.entries(lines).map(([order_item_id, item_id]) => ({ order_item_id, item_id })) });
  if (o.fire !== false) {
    const byStation = new Map<string, string[]>();
    for (const id of Object.keys(lines)) {
      const sid = engine().lines[id]!.station_id;
      byStation.set(sid, [...(byStation.get(sid) ?? []), id]);
    }
    for (const [sid, ids] of byStation) fireLines(hub, sid, ids);
  }
  return order_id;
}

// ------------------------------------------------------------------------------------------- StartItem

describe('[03b §6.1] StartItem', () => {
  it('[03b #1] a station session starts a fired line of its own station: ItemStarted { source: tap }, actor_id null, KDS device_id; other station → PERMISSION_DENIED', async () => {
    const order_id = firedOrder({ L1: FX.naan });
    const other = kds(ST);
    const denied = await start(other, 'L1');
    expect(denied.status).toBe(403);
    expect(denied.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { session_kind: 'station', station_id: FX.station } });
    expect(engine().lines.L1!.stage).toBe('added');

    const own = kds(FX.station);
    hub.clock.advance(5_000);
    const now = hub.clock.branchNow();
    const r = await start(own, 'L1', true);
    expect(r.status).toBe(200);
    expect(r.result).toEqual({ started: ['L1'] });
    expect(lastStatements).toBe(0); // §6.1 Statements 0
    expect(r.events).toEqual([
      {
        event_type: 'ItemStarted',
        stream_type: 'order',
        stream_id: order_id,
        actor_id: null,
        device_id: own.deviceId,
        occurred_at: now,
        payload: { order_item_id: 'L1', started_at: now, source: 'tap' },
      },
    ]);
    expect(engine().lines.L1).toMatchObject({ stage: 'cooking', started_at: now });
  });

  it('[03b #2] unfired → added; single_tap → cooking; exited order → out_of_engine; unknown → ORDER_NOT_FOUND { order_id: null }; staff with / without run-pass', async () => {
    const pass = await cook();
    firedOrder({ U1: FX.naan }, { fire: false });
    expect((await start(pass, 'U1')).error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'U1', stage: 'added' } });

    firedOrder({ T1: 'I_ST' });
    expect(engine().lines.T1).toMatchObject({ stage: 'added', fired_at: expect.any(Number) });
    const t = await start(pass, 'T1');
    expect(t.status).toBe(409);
    expect(t.error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'T1', stage: 'cooking' } });

    const unknown = await start(pass, 'NOPE');
    expect(unknown.status).toBe(404);
    expect(unknown.error).toEqual({ code: 'ORDER_NOT_FOUND', details: { order_item_id: 'NOPE', order_id: null } });

    // Without run-pass (Cashier): the route refuses before the handler.
    const cashier = staff('S_CASH');
    firedOrder({ R1: FX.naan });
    const noRight = await start(cashier, 'R1');
    expect(noRight.status).toBe(403);
    expect(noRight.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'run-pass' } });
    // With run-pass (Cook, staff session on the Pass): any station; actor_id = the Cook.
    const ok = await start(pass, 'R1');
    expect(ok.status).toBe(200);
    expect(ok.events[0]).toMatchObject({ event_type: 'ItemStarted', actor_id: COOK.staff, device_id: pass.deviceId });

    // An order that left the engine (served, then 30 min): the line is still in the state, the order is not in the engine.
    const gone = firedOrder({ X1: FX.naan });
    serveLines(hub, gone, ['X1']);
    hub.clock.advance(31 * MIN);
    expect(engine().lines.X1).toBeDefined();
    const out = await start(await cook(), 'X1'); // a fresh session (the Cook's idle TTL is 5 min)
    expect(out.status).toBe(409);
    expect(out.error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'X1', stage: 'out_of_engine' } });
  });

  it('[03b #3] batch: Start and Done on one member act on the whole load', async () => {
    const station = kds(B);
    // 02b copies the program cook time from the snapshot (B1); the fixture leaves it null, so it is given here.
    const bake = { program_cook_time_ms: 8 * MIN };
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'B1', item_id: 'I_B', item: bake }, { order_item_id: 'B2', item_id: 'I_B', item: bake }] });
    const load = engine().lines.B1!.load_id;
    expect(load).not.toBeNull();
    expect(engine().lines.B2!.load_id).toBe(load);
    // fired whole, with its load (as the fires tick fires a load)
    append(hub, [{ stream_type: 'station', stream_id: B, event_type: 'FireDispatched', payload: { station_id: B, order_item_ids: ['B1', 'B2'], load_id: load, due_at: hub.clock.branchNow(), reason: 'pulled' } }]);
    expect(engine().lines.B1).toMatchObject({ load_id: load, fired_at: expect.any(Number) });

    const s = await start(station, 'B1', true);
    expect(s.status).toBe(200);
    expect(lastStatements).toBe(0);
    expect((s.result!.started as string[]).sort()).toEqual(['B1', 'B2']);
    expect(s.events.filter((e) => e.event_type === 'ItemStarted').map((e) => e.payload.order_item_id).sort()).toEqual(['B1', 'B2']);
    expect(engine().lines.B2!.stage).toBe('cooking');

    hub.clock.advance(8 * MIN);
    const d = await done(station, 'B2', { counted: true });
    expect(d.status).toBe(200);
    expect(lastStatements).toBe(0);
    expect((d.result!.done as string[]).sort()).toEqual(['B1', 'B2']);
    expect(d.events.map((e) => e.event_type)).toEqual(['ItemDone', 'ItemDone']);
    expect(engine().lines.B1!.stage).toBe('done');
  });

  it('[03b #4] a late Start → ReservationsShifted (lateStartShift, same batch); a from-stock Start → StockConsumed', async () => {
    const station = kds(ONE);
    // Capacity 1: A then B, two orders; A fired at once, B booked after A's cook.
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A', item_id: 'I_ONE' }] });
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'B', item_id: 'I_ONE' }] });
    fireLines(hub, ONE, ['A']);
    expect(engine().lines.B!.booked).not.toBeNull();
    hub.clock.advance(2 * MIN);
    const now = hub.clock.branchNow();
    const expected = lateStartShift(engine(), 'A', now);
    expect(expected).not.toBeNull();
    const r = await start(station, 'A');
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['ItemStarted', 'ReservationsShifted']);
    expect(r.events[1]).toMatchObject({ stream_type: 'station', stream_id: ONE, actor_id: null, device_id: station.deviceId, payload: expected!.payload });

    // From stock (FX.piece draws K1, 5 000 g on hand): the Start consumes.
    const pass = await cook();
    firedOrder({ P1: FX.piece });
    expect(engine().lines.P1!.from_stock).toBe(true);
    const s = await start(pass, 'P1');
    expect(s.status).toBe(200);
    expect(s.events.map((e) => e.event_type)).toEqual(['ItemStarted', 'StockConsumed']);
    expect(s.events[1]).toMatchObject({ stream_type: 'stock', stream_id: FX.stock, actor_id: COOK.staff, payload: { stock_item_id: FX.stock, order_item_id: 'P1' } });
  });
});

// ------------------------------------------------------------------------------------------- DoneItem

describe('[03b §6.2] DoneItem', () => {
  it('[03b #5] two_tap Done before Start → ITEM_WRONG_STAGE added; under 50 % → ITEM_DONE_CONFIRM_REQUIRED, nothing written; confirm → done', async () => {
    const station = kds(FX.station);
    const order_id = firedOrder({ L1: FX.naan }); // naan: cook 5 min, fresh
    const early = await done(station, 'L1');
    expect(early.status).toBe(409);
    expect(early.error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'L1', stage: 'added' } });

    await start(station, 'L1');
    hub.clock.advance(2 * MIN); // 120 000 < 0.5 × 300 000
    const before = eventCount();
    const refused = await done(station, 'L1', { counted: true });
    expect(refused.status).toBe(422);
    expect(lastStatements).toBe(0);
    expect(refused.error).toEqual({ code: 'ITEM_DONE_CONFIRM_REQUIRED', details: { order_item_id: 'L1', elapsed_ms: 2 * MIN, cook_ms: 5 * MIN } });
    expect(eventCount()).toBe(before);
    expect(engine().lines.L1!.stage).toBe('cooking');
    // confirm: false is still a refusal
    expect((await done(station, 'L1', { confirm: false })).status).toBe(422);

    const now = hub.clock.branchNow();
    const ok = await done(station, 'L1', { confirm: true, counted: true });
    expect(ok.status).toBe(200);
    expect(lastStatements).toBe(0);
    expect(ok.result).toEqual({ done: ['L1'] });
    expect(ok.events).toEqual([
      { event_type: 'ItemDone', stream_type: 'order', stream_id: order_id, actor_id: null, device_id: station.deviceId, occurred_at: now, payload: { order_item_id: 'L1', done_at: now, source: 'tap' } },
    ]);
  });

  it('[03b #5] at exactly 50 % of the cook time Done needs no confirm', async () => {
    const station = kds(FX.station);
    firedOrder({ L1: FX.naan });
    await start(station, 'L1');
    hub.clock.advance(150_000);
    expect((await done(station, 'L1')).status).toBe(200);
  });

  it('[03b #6] from-stock line: Done with no Start succeeds, consumes, no 50 % check; auto_done: Done from fired added', async () => {
    const pass = await cook();
    firedOrder({ P1: FX.piece });
    expect(engine().lines.P1).toMatchObject({ from_stock: true, stage: 'added', started_at: null });
    const r = await done(pass, 'P1');
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['ItemDone', 'StockConsumed']);
    expect(r.events[1]!.payload).toMatchObject({ stock_item_id: FX.stock, order_item_id: 'P1' });
    expect(engine().lines.P1!.stage).toBe('done');

    firedOrder({ A1: 'I_AD' });
    const a = await done(kds(AD), 'A1');
    expect(a.status).toBe(200);
    expect(a.events.map((e) => e.event_type)).toEqual(['ItemDone']);

    // single_tap / two_tap fresh fired added → "Tap Start first"
    firedOrder({ N1: 'I_ST' });
    expect((await done(pass, 'N1')).error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'N1', stage: 'added' } });
  });

  it('[03b #10] two Done taps → the second is ITEM_WRONG_STAGE { stage: done }; other station → PERMISSION_DENIED; unknown → ORDER_NOT_FOUND', async () => {
    const station = kds(FX.station);
    firedOrder({ L1: FX.naan });
    await start(station, 'L1');
    hub.clock.advance(5 * MIN);
    expect((await done(station, 'L1')).status).toBe(200);
    const second = await done(station, 'L1');
    expect(second.status).toBe(409);
    expect(second.error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'L1', stage: 'done' } });

    expect((await done(kds(AD), 'L1')).error).toMatchObject({ code: 'PERMISSION_DENIED', details: { session_kind: 'station' } });
    expect((await done(station, 'NOPE')).error).toEqual({ code: 'ORDER_NOT_FOUND', details: { order_item_id: 'NOPE', order_id: null } });
  });

  it('[03b §3.2] StartItem and DoneItem are not queueable and are station-scoped under run-pass', () => {
    for (const c of [startItemCommand, doneItemCommand]) {
      expect(c).toMatchObject({ sessionKind: 'device', permission: 'run-pass', stationScoped: true });
      expect(c.queueable ?? false).toBe(false);
    }
  });
});
