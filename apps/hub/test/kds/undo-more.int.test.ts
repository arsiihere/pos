// 03b b9a: UndoDone (line part; the Ready part is the undoReadyForLines contract, b9b) and GiveMeMore (§3.2, §6.3–6.4;
// tests #7, #9). Orders through 02b's shared fixtures, fires / Dones through real events, the commands through the
// real route with real station / staff sessions. Handler statements counted on the real handlers under test names.
import { UNDO_DONE_MS } from '@pos/domain';
import { pullEarly, type EngineState } from '@pos/engine';
import type { BranchConfig, ConfigItem } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { provideKds } from '../../src/kds/contracts';
import { giveMeMoreCommand } from '../../src/kds/commands/give-me-more';
import { undoDoneCommand } from '../../src/kds/commands/undo-done';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { COOK, FX, append, appendOrder, cookDirectory, fireLines, fixtureMenu, openDay, pairKds, signInCook } from './fixtures';

const MIN = 60_000;
const ST = 'S_ST'; // single_tap
const B = 'S_B'; // batch, program PR

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
      { ...s1, station_id: B, name: 'Tandoor', station_type: 'batch', programs: [{ program_id: 'PR', name: 'Bake', cook_time_ms: 8 * MIN, is_archived: false }] },
      { ...s1, station_id: 'S_ARCH', name: 'Old', is_archived: true },
    ],
    items: [...base.items, item('I_ST', ST), item('I_B', B, { program_id: 'PR', cook_time_ms: 8 * MIN })],
  };
}

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  await seedDirectory(hub, await cookDirectory());
  for (const [command, name] of [
    [undoDoneCommand, 'TestUndoDoneCounted'],
    [giveMeMoreCommand, 'TestGiveMeMoreCounted'],
  ] as const) {
    const real = command as typeof undoDoneCommand;
    commandRegistry(hub.app).register(
      defineCommand({
        ...real,
        commandType: name,
        handle(ctx, payload, cmd) {
          const before = counter.count;
          try {
            return real.handle(ctx, payload, cmd);
          } finally {
            lastStatements = counter.count - before;
          }
        },
      }),
    );
  }
  counter = statementCounter(hub.deps.db);
  lastStatements = -1;
  openDay(hub, { menu: menu() });
});

afterEach(async () => {
  provideKds({ undoReadyForLines: undefined });
  swapBranchConfig(null);
  await hub.close();
});

const engine = (): EngineState => hub.deps.state.get() as EngineState;

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
  payload: Record<string, unknown>;
}
interface Reply {
  status: number;
  result: Record<string, unknown> | undefined;
  events: Stored[];
  error?: { code: string; details: Record<string, unknown> };
}
const URLS: Record<string, string> = {
  UndoDone: 'undo-done',
  GiveMeMore: 'give-me-more',
  TestUndoDoneCounted: 'test-undo-done-counted',
  TestGiveMeMoreCounted: 'test-give-me-more-counted',
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
              `SELECT event_type, stream_type, stream_id, actor_id, device_id, payload AS payload_json FROM events
                WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY seq`,
            )
            .all(JSON.stringify(body.data.event_ids)) as Array<Omit<Stored, 'payload'> & { payload_json: string }>
        ).map(({ payload_json, ...rest }) => ({ ...rest, payload: JSON.parse(payload_json) as Record<string, unknown> }));
  const error = body.error === undefined ? undefined : { code: body.error.code, details: body.error.details };
  return { status: res.statusCode, result: body.data?.result, events, error };
}
const undo = (who: Who, order_item_id: string, counted = false) => send(who, counted ? 'TestUndoDoneCounted' : 'UndoDone', { order_item_id });
const more = (who: Who, station_id: string, n?: number, counted = false) =>
  send(who, counted ? 'TestGiveMeMoreCounted' : 'GiveMeMore', { station_id, ...(n === undefined ? {} : { n }) });
const eventCount = (): number => (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;

/** ItemDone { source } at `done_at` (default: the append's time), as the tap command or the tick writes it. */
function doneLine(order_id: string, order_item_id: string, o: { source?: 'tap' | 'inferred'; done_at?: number } = {}): number {
  const [e] = append(hub, [{ stream_type: 'order', stream_id: order_id, event_type: 'ItemDone', payload: { order_item_id, done_at: o.done_at ?? hub.clock.branchNow() + 1_000, source: o.source ?? 'tap' } }]);
  return engine().lines[order_item_id]!.done_at ?? e!.recorded_at;
}
function startLine(order_id: string, order_item_id: string): void {
  append(hub, [{ stream_type: 'order', stream_id: order_id, event_type: 'ItemStarted', payload: { order_item_id, started_at: hub.clock.branchNow() + 1_000, source: 'tap' } }]);
}
function takeaway(lines: Array<{ order_item_id: string; item_id: string; item?: Record<string, unknown> }>): string {
  return appendOrder(hub, { order_type: 'takeaway', lines }).order_id;
}
const bake = { program_cook_time_ms: 8 * MIN };

// ------------------------------------------------------------------------------------------- UndoDone

describe('[03b §6.3] UndoDone', () => {
  it('[03b #7] 30 000 ms after done_at → undone (ItemDoneUndone, back to cooking); 30 001 → ITEM_UNDO_WINDOW_CLOSED, nothing written', async () => {
    const station = kds(FX.station);
    const order_id = takeaway([
      { order_item_id: 'L1', item_id: FX.naan },
      { order_item_id: 'L2', item_id: FX.naan },
    ]);
    fireLines(hub, FX.station, ['L1', 'L2']);
    startLine(order_id, 'L1');
    startLine(order_id, 'L2');
    const at1 = doneLine(order_id, 'L1');
    const at2 = doneLine(order_id, 'L2');

    hub.clock.set(at1 + UNDO_DONE_MS);
    const ok = await undo(station, 'L1', true);
    expect(ok.status).toBe(200);
    expect(lastStatements).toBe(1); // §6.3: the Handover read (the Ready read is b9b's, inside undoReadyForLines)
    expect(ok.result).toEqual({ undone: ['L1'], ready_undone: [] });
    expect(ok.events).toEqual([
      { event_type: 'ItemDoneUndone', stream_type: 'order', stream_id: order_id, actor_id: null, device_id: station.deviceId, payload: { order_item_id: 'L1' } },
    ]);
    expect(engine().lines.L1).toMatchObject({ stage: 'cooking', done_at: null });

    hub.clock.set(at2 + UNDO_DONE_MS + 1);
    const before = eventCount();
    const late = await undo(station, 'L2', true);
    expect(late.status).toBe(409);
    expect(late.error).toEqual({ code: 'ITEM_UNDO_WINDOW_CLOSED', details: { order_item_id: 'L2' } });
    expect(eventCount()).toBe(before);
  });

  it('[03b #7] an inferred Done is undoable only within 30 s of its done_at (not of its append)', async () => {
    const station = kds(FX.station);
    const order_id = takeaway([{ order_item_id: 'L1', item_id: FX.naan }]);
    fireLines(hub, FX.station, ['L1']);
    startLine(order_id, 'L1');
    hub.clock.advance(10 * MIN);
    // the tick writes the planned end, 20 s before the append
    const doneAt = doneLine(order_id, 'L1', { source: 'inferred', done_at: hub.clock.branchNow() + 1_000 - 20_000 });
    expect(engine().lines.L1!.done_at).toBe(doneAt);
    hub.clock.set(doneAt + UNDO_DONE_MS + 1); // only ~10 s after the append
    expect((await undo(station, 'L1')).error).toEqual({ code: 'ITEM_UNDO_WINDOW_CLOSED', details: { order_item_id: 'L1' } });
  });

  it('[03b #7] a handed-over line → ITEM_WRONG_STAGE handed_over; not done → wrong stage; unknown / other station / no run-pass refused', async () => {
    const station = kds(FX.station);
    const order_id = takeaway([
      { order_item_id: 'L1', item_id: FX.naan },
      { order_item_id: 'L2', item_id: FX.naan },
    ]);
    fireLines(hub, FX.station, ['L1', 'L2']);
    startLine(order_id, 'L1');
    doneLine(order_id, 'L1');
    // 03b §5 handover_lines is the pass projection's (b13, not built yet): the row a Handover of L1 leaves.
    hub.deps.db.prepare('INSERT INTO handover_lines (order_item_id, handover_id, settled_at) VALUES (?, ?, NULL)').run('L1', 'H1');
    const handed = await undo(station, 'L1', true);
    expect(handed.status).toBe(409);
    expect(lastStatements).toBe(1);
    expect(handed.error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'L1', stage: 'handed_over' } });

    startLine(order_id, 'L2');
    expect((await undo(station, 'L2')).error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'L2', stage: 'cooking' } });
    expect((await undo(station, 'NOPE')).error).toEqual({ code: 'ORDER_NOT_FOUND', details: { order_item_id: 'NOPE', order_id: null } });
    expect((await undo(kds(ST), 'L2')).error).toMatchObject({ code: 'PERMISSION_DENIED', details: { session_kind: 'station' } });
    expect((await undo(staff('S_CASH'), 'L2')).error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'run-pass' } });
  });

  it('[03b #3] batch: Undo acts on every done line of the load inside the window', async () => {
    const station = kds(B);
    const order_id = takeaway([
      { order_item_id: 'B1', item_id: 'I_B', item: bake },
      { order_item_id: 'B2', item_id: 'I_B', item: bake },
    ]);
    const load = engine().lines.B1!.load_id;
    expect(load).not.toBeNull();
    append(hub, [{ stream_type: 'station', stream_id: B, event_type: 'FireDispatched', payload: { station_id: B, order_item_ids: ['B1', 'B2'], load_id: load, due_at: hub.clock.branchNow(), reason: 'pulled' } }]);
    startLine(order_id, 'B1');
    startLine(order_id, 'B2');
    doneLine(order_id, 'B1');
    doneLine(order_id, 'B2');
    const r = await undo(station, 'B2');
    expect(r.status).toBe(200);
    expect(r.result).toEqual({ undone: ['B1', 'B2'], ready_undone: [] });
    expect(r.events.map((e) => [e.event_type, e.payload.order_item_id])).toEqual([
      ['ItemDoneUndone', 'B1'],
      ['ItemDoneUndone', 'B2'],
    ]);
  });

  it('[03b §3.2 step 5] the Ready part goes through the undoReadyForLines contract with the undone lines, inside the command', async () => {
    const station = kds(FX.station);
    const order_id = takeaway([{ order_item_id: 'L1', item_id: FX.naan }]);
    fireLines(hub, FX.station, ['L1']);
    startLine(order_id, 'L1');
    doneLine(order_id, 'L1');
    const calls: string[][] = [];
    provideKds({
      undoReadyForLines(ctx, ids) {
        calls.push([...ids]);
        const now = ctx.clock.branchNow();
        return {
          events: [
            { stream_type: 'order', stream_id: order_id, event_type: 'ReadyToServeUndone', schema_version: 1, payload: { order_id, point_id: 'P1', alert_id: null }, occurred_at: now, actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId },
          ],
          ready_undone: [{ order_id, point_id: 'P1' }],
        };
      },
    });
    const r = await undo(station, 'L1');
    expect(r.status).toBe(200);
    expect(calls).toEqual([['L1']]);
    expect(r.result).toEqual({ undone: ['L1'], ready_undone: [{ order_id, point_id: 'P1' }] });
    expect(r.events.map((e) => e.event_type)).toEqual(['ItemDoneUndone', 'ReadyToServeUndone']);
  });
});

// ------------------------------------------------------------------------------------------- GiveMeMore

/** A sync order of a 20-min karahi (S1) and a short line on `station`: the short line waits; the clock is moved into its max_early_ms. */
function waitingLine(id: string, item_id: string, extra: Record<string, unknown> = {}): string {
  const order_id = takeaway([
    { order_item_id: `${id}K`, item_id: FX.piece },
    { order_item_id: id, item_id, item: extra },
  ]);
  return order_id;
}
function intoPullWindow(ids: string[]): void {
  const at = Math.max(...ids.map((id) => engine().lines[id]!.deadline_ms - engine().lines[id]!.max_early_ms));
  if (at > hub.clock.branchNow()) hub.clock.set(at);
  for (const id of ids) expect(engine().lines[id]!.fire_ms!).toBeGreaterThan(hub.clock.branchNow());
}

describe('[03b §6.4] GiveMeMore', () => {
  it('[03b #9] pulls: FireDispatched { reason: pulled } = pullEarly; nothing to pull → { pulled: null }, no event', async () => {
    const station = kds(FX.station);
    const empty = await more(station, FX.station, undefined, true);
    expect(empty.status).toBe(200);
    expect(lastStatements).toBe(0);
    expect(empty.result).toEqual({ pulled: null });
    expect(empty.events).toEqual([]);

    // Raita (S1, 1 min) waits behind the 20-min karahi of its sync group.
    waitingLine('W1', FX.optionItem);
    intoPullWindow(['W1']);
    const expected = pullEarly(engine(), FX.station, 1, hub.clock.branchNow());
    expect(expected).not.toBeNull();
    const r = await more(station, FX.station, undefined, true);
    expect(r.status).toBe(200);
    expect(lastStatements).toBe(0);
    expect(r.result).toEqual({ pulled: expected!.payload.order_item_ids });
    expect(r.events).toEqual([{ event_type: 'FireDispatched', stream_type: 'station', stream_id: FX.station, actor_id: null, device_id: station.deviceId, payload: expected!.payload }]);
    expect(engine().lines.W1!.fired_at).not.toBeNull();
  });

  it('[03b #9] single_tap: the pull carries the inferred ItemStarted; a run-pass staff session pulls for any station', async () => {
    const pass = await cook();
    waitingLine('W1', 'I_ST');
    intoPullWindow(['W1']);
    const now = hub.clock.branchNow();
    const r = await more(pass, ST);
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['FireDispatched', 'ItemStarted']);
    expect(r.events[1]).toMatchObject({ stream_type: 'order', actor_id: COOK.staff, payload: { order_item_id: 'W1', started_at: now, source: 'inferred' } });
    expect(engine().lines.W1!.stage).toBe('cooking');
  });

  it('[03b #9] batch: the whole load is pulled', async () => {
    const station = kds(B);
    takeaway([
      { order_item_id: 'BK', item_id: FX.piece },
      { order_item_id: 'B1', item_id: 'I_B', item: bake },
      { order_item_id: 'B2', item_id: 'I_B', item: bake },
    ]);
    const load = engine().lines.B1!.load_id;
    expect(engine().lines.B2!.load_id).toBe(load);
    intoPullWindow(['B1', 'B2']);
    const r = await more(station, B, 1);
    expect(r.status).toBe(200);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.payload).toMatchObject({ station_id: B, order_item_ids: ['B1', 'B2'], load_id: load, reason: 'pulled' });
  });

  it('[03b §3.2] unknown / archived station → STATION_NOT_FOUND; a station session for another station → PERMISSION_DENIED; n 1–10', async () => {
    const station = kds(FX.station);
    expect((await more(station, 'NOPE')).error).toEqual({ code: 'STATION_NOT_FOUND', details: { station_id: 'NOPE' } });
    expect((await more(await cook(), 'S_ARCH')).error).toEqual({ code: 'STATION_NOT_FOUND', details: { station_id: 'S_ARCH' } });
    const other = await more(station, ST);
    expect(other.status).toBe(403);
    expect(other.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { session_kind: 'station', station_id: ST } });
    expect((await more(station, FX.station, 0)).status).toBe(400);
    expect((await more(station, FX.station, 11)).status).toBe(400);
    expect((await more(station, FX.station, 10)).status).toBe(200);
    expect((await more(staff('S_CASH'), FX.station)).error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'run-pass' } });
  });

  it('[03b §3.2] UndoDone and GiveMeMore are not queueable and are station-scoped under run-pass', () => {
    for (const c of [undoDoneCommand, giveMeMoreCommand]) {
      expect(c).toMatchObject({ sessionKind: 'device', permission: 'run-pass', stationScoped: true });
      expect(c.queueable ?? false).toBe(false);
    }
  });
});
