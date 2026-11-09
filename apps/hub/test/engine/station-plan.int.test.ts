// 03a task 22b: the `station_plan` catch-up part and frame (§3.6.3, §6.4; test #83; 00 H-4).
import { performance } from 'node:perf_hooks';
import { stationPlan, type EngineState } from '@pos/engine';
import { WsStationPlan, type EngineConfig, type EventDraft, type PosEvent } from '@pos/events';
import { aBusinessDayOpened, anEngineConfigApplied, aStockReleased, aStockSet } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTickLoop, TICK_MS } from '../../src/alerts/tick';
import { unregisterTick } from '../../src/alerts/tick';
import { registerEngineBootSteps } from '../../src/engine-host/boot-steps';
import { firesAlertsTick } from '../../src/engine-host/fires-alerts-tick';
import { firesTick } from '../../src/engine-host/fires-tick';
import { hostFlags } from '../../src/engine-host/host-flags';
import { stationPlanPart } from '../../src/engine-host/station-plan';
import type { WriterTx } from '../../src/engine-host/writer';
import { registerRestaurantBootSteps } from '../../src/sync/boot-steps';
import type { SocketCtx } from '../../src/ws/catch-up';
import { wsHubFor } from '../../src/ws/server';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { draftOf, fakeSubmit, fakeSubmitDrafts, fakeTap, type FakeOrder } from './fakes';

// As main.ts: the engine steps (the fires tick right after 01d's `alerts`), then the restaurant steps.
registerEngineBootSteps(() => performance.now());
registerRestaurantBootSteps();

const MIN = 60_000;

type Plan = { type: 'station_plan'; station_id: string; as_of_seq: number; lines: Array<{ order_item_id: string; frozen: boolean }> };
type Client = { device: { deviceId: string; token: string }; session: { sessionId: string; token: string } };

function config(o: { stations?: string[]; freeze_ms?: number } = {}): EngineConfig {
  const base = anEngineConfigApplied().payload as unknown as EngineConfig;
  const s1 = base.stations[0]!;
  return { ...base, stations: (o.stations ?? ['S1', 'S2']).map((station_id) => ({ ...s1, station_id, name: station_id, freeze_ms: o.freeze_ms ?? s1.freeze_ms })) };
}

describe('[03a #83] station_plan catch-up part and frame', () => {
  let hub: TestHub;
  let stop: () => void = () => undefined;
  const sockets: WsClient[] = [];
  const log = { error: vi.fn<(obj: Record<string, unknown>, msg?: string) => void>() };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    hub = await createTestHub();
    unregisterTick('table_locks'); // 02a §3.4: registerTables adds it to every test hub; this file counts the ticks
    await seedDirectory(hub);
    // 01d's no_approver flag: start clean, so its tick is idle (1 SELECT per pass).
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
    log.error.mockClear();
    vi.spyOn(firesAlertsTick, 'due').mockReturnValue(false);
    stop = startTickLoop(hub.deps, log);
  });

  afterEach(async () => {
    stop();
    stop = () => undefined;
    for (const ws of sockets.splice(0)) ws.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
    hostFlags.configStale = false;
    await hub.close();
  });

  const engine = (): EngineState => hub.deps.state.get();
  const append = (events: readonly (PosEvent | EventDraft)[]): void => {
    hub.deps.writer.run((tx) => tx.append(events.map((e) => draftOf(e))));
  };
  function kitchen(c: EngineConfig = config()): void {
    append([anEngineConfigApplied({ payload: c as unknown as Record<string, unknown> }), aBusinessDayOpened()]);
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
  }
  const submit = (o: FakeOrder): PosEvent[] => fakeSubmit(hub.deps, o);
  const pass = async (at?: number): Promise<void> => {
    if (at !== undefined) hub.clock.set(at);
    await vi.advanceTimersByTimeAsync(TICK_MS);
  };
  const body = (station_id: string, as_of_seq: number): unknown => ({ ...stationPlan(engine(), station_id, hub.clock.branchNow()), as_of_seq });

  function clientOf(kind: 'staff' | 'station', stationId?: string): Client {
    return kind === 'staff'
        ? (() => {
            const device = pairDevice(hub, { type: 'tablet' });
            return { device, session: openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: device.deviceId }) };
          })()
        : (() => {
            const device = pairDevice(hub, { type: 'kds', stationId });
            return { device, session: openSession(hub, { kind: 'station', deviceId: device.deviceId, stationId }) };
          })();
  }
  // A session socket (session token given) or, with session: false, the device's alert-mode socket (00 H-1).
  async function connect(c: Client, session = true): Promise<WsClient> {
    const ws = await connectWs(hub.app);
    sockets.push(ws);
    ws.send(session ? { type: 'auth', device_token: c.device.token, session_token: c.session.token } : { type: 'auth', device_token: c.device.token });
    await ws.untilCount(1);
    return ws;
  }
  const socketOf = (kind: 'staff' | 'station', stationId?: string): Promise<WsClient> => connect(clientOf(kind, stationId));
  const plans = (ws: WsClient): Plan[] => ws.messages.filter((m) => (m as { type?: string }).type === 'station_plan') as Plan[];
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

  // Spies writer.run: counts transactions.
  function meter(): { readonly tx: number; readonly statements: number; reset(): void } {
    const counter = statementCounter(hub.deps.db);
    const run = hub.deps.writer.run.bind(hub.deps.writer);
    let tx = 0;
    vi.spyOn(hub.deps.writer, 'run').mockImplementation(((fn: (t: WriterTx) => unknown) => {
      tx += 1;
      return run(fn);
    }) as typeof hub.deps.writer.run);
    return {
      get tx() {
        return tx;
      },
      get statements() {
        return counter.count;
      },
      reset() {
        tx = 0;
        counter.reset();
      },
    };
  }

  it('[03a #83] catch-up part: one body per station for a staff socket, only its own for a station socket; the build runs 0 statements', async () => {
    kitchen();
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2', station_id: 'S2' }] });
    const staff = await socketOf('staff');
    const kds = await socketOf('station', 'S2');
    const staffFrame = staff.messages[0] as { type: string; as_of_seq: number; state: Record<string, unknown> };
    const kdsFrame = kds.messages[0] as { type: string; as_of_seq: number; state: Record<string, unknown> };
    expect(staffFrame.type).toBe('catch_up');
    expect(staffFrame.state.station_plan).toEqual([body('S1', staffFrame.as_of_seq), body('S2', staffFrame.as_of_seq)]);
    expect(kdsFrame.state.station_plan).toEqual([body('S2', kdsFrame.as_of_seq)]);
    expect((kdsFrame.state.station_plan as Plan[])[0]!.lines.map((l) => l.order_item_id)).toEqual(['L2']);

    const part = stationPlanPart(hub.clock);
    const socket: SocketCtx = { deviceId: 'D1', deviceType: 'kds', sessionId: 'X', kind: 'station', staffId: null, stationId: 'S1', asOfSeq: 7 };
    expect(part.part).toBe('station_plan');
    expect(part.appliesTo(socket)).toBe(true);
    expect(part.appliesTo({ ...socket, kind: 'staff', stationId: null, staffId: 'S_MGR' })).toBe(true);
    const counter = statementCounter(hub.deps.db);
    expect(part.build(hub.deps.db, engine(), socket)).toEqual([body('S1', 7)]);
    expect(part.build(hub.deps.db, engine(), { ...socket, kind: 'staff', stationId: null, staffId: 'S_MGR' })).toEqual([body('S1', 7), body('S2', 7)]);
    expect(counter.count).toBe(0);
  });

  it('[03a #83] after a commit: one frame per changed station, to that station\'s sockets and every staff socket; none for an unchanged station', async () => {
    kitchen();
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2', station_id: 'S2' }] });
    const staff = await socketOf('staff');
    const k1 = await socketOf('station', 'S1');
    const k2 = await socketOf('station', 'S2');
    const sent = vi.spyOn(wsHubFor(hub.app), 'sendToSessions');
    // A commit that changes S1's plan only.
    submit({ order_id: 'O2', lines: [{ order_item_id: 'L3' }] });
    await settle();
    const seq = hub.deps.writer.lastSeq();
    expect(plans(staff)).toEqual([{ type: 'station_plan', ...(body('S1', seq) as object) }]);
    expect(plans(k1)).toEqual([{ type: 'station_plan', ...(body('S1', seq) as object) }]);
    expect(plans(k2)).toEqual([]);
    expect(WsStationPlan.strict().safeParse(plans(staff)[0]).success).toBe(true);
    expect(sent).toHaveBeenCalledTimes(1);

    // A commit that changes both: one frame each.
    submit({ order_id: 'O3', lines: [{ order_item_id: 'L4' }, { order_item_id: 'L5', station_id: 'S2' }] });
    await settle();
    expect(plans(staff).map((p) => p.station_id)).toEqual(['S1', 'S1', 'S2']);
    expect(plans(k1).map((p) => p.station_id)).toEqual(['S1', 'S1']);
    expect(plans(k2).map((p) => p.station_id)).toEqual(['S2']);
  });

  // Review I-1: a fold can change a line's plan fields without copying its station; the line's reference names it.
  it('[03a #83] expediting a frozen line (no station copy): exactly one frame for its station, with mark expedite', async () => {
    kitchen(config({ freeze_ms: 60 * MIN }));
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }] });
    expect(stationPlan(engine(), 'S1', hub.clock.branchNow()).lines).toEqual([expect.objectContaining({ order_item_id: 'L1', frozen: true, mark: null })]);
    const prevStation = engine().stations.S1;
    const staff = await socketOf('staff');
    const k1 = await socketOf('station', 'S1');
    const k2 = await socketOf('station', 'S2');
    append([{ stream_type: 'order', stream_id: 'O1', event_type: 'ItemsReleased', schema_version: 1, payload: { order_id: 'O1', alert_id: null, released: [], expedite: ['L1'] }, occurred_at: hub.clock.branchNow(), actor_id: null, device_id: 'hub' }]);
    await settle();
    expect(engine().stations.S1).toBe(prevStation); // the case: no station copy
    for (const ws of [staff, k1]) {
      expect(plans(ws)).toEqual([{ type: 'station_plan', ...(body('S1', hub.deps.writer.lastSeq()) as object) }]);
      expect(plans(ws)[0]!.lines).toEqual([expect.objectContaining({ order_item_id: 'L1', mark: 'expedite' })]);
    }
    expect(plans(k2)).toEqual([]);
  });

  // AD-35 (b): a frame only when the station's body (station_id, lines; never as_of_seq) differs from the last sent.
  it('[03a #83, AD-35 b] a commit that changes line references but no field of the plan body sends no frame', async () => {
    kitchen();
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2', station_id: 'S2' }] });
    const k1 = await socketOf('station', 'S1');
    const staff = await socketOf('staff');
    // The fires pass fires L1: S1's plan loses L1 (one frame).
    await pass(engine().lines.L1!.fire_ms!);
    await settle();
    expect(engine().lines.L1!.fired_at).not.toBeNull();
    expect(plans(k1).map((p) => p.lines.length)).toEqual([0]);
    const staffBefore = plans(staff).length;
    // A Start tap on the fired line: the line (and its station) change by reference, the S1 body does not.
    const prevLine = engine().lines.L1;
    fakeTap(hub.deps, 'start', 'L1');
    await settle();
    expect(engine().lines.L1).not.toBe(prevLine);
    expect(plans(k1)).toHaveLength(1);
    expect(plans(staff)).toHaveLength(staffBefore);
  });

  it('[03a #83, AD-35 b] the same freeze-entry crossing seen twice with an unchanged body: one frame', async () => {
    kitchen(config({ freeze_ms: 2 * MIN }));
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }] });
    const k1 = await socketOf('station', 'S1');
    const fireAt = engine().lines.L1!.fire_ms!;
    await pass(fireAt - 2 * MIN - TICK_MS);
    await pass(fireAt - 2 * MIN);
    await settle();
    expect(plans(k1)).toHaveLength(1);
    // The clock steps back and the same interval is passed again: S1 crosses again, its body is the one sent.
    await pass(fireAt - 2 * MIN - TICK_MS);
    await pass(fireAt - 2 * MIN);
    await settle();
    expect(plans(k1)).toHaveLength(1);
  });

  it('[03a #83] a StockReleased that makes a from-stock line fresh (deadline_ms changes): one frame for its station', async () => {
    kitchen();
    const open = hub.clock.branchNow();
    append([aStockSet({ stream_id: 'K1', payload: { stock_item_id: 'K1', on_hand: 2_000, unit: 'g' } })]);
    fakeSubmit(
      hub.deps,
      { order_id: 'O1', lines: [{ order_item_id: 'L1', item: { stock_time_ms: 300_000, stock_draws: [{ stock_item_id: 'K1', quantity: 500 }] } }] },
      { dayStartMs: open, stockItems: [{ stock_item_id: 'K1', name: 'Karahi base', stock_unit: 'g', carries_over: true, station_id: 'S1', low_stock_threshold: null }] },
    );
    const before = engine().lines.L1!;
    expect(before.from_stock).toBe(true);
    const k1 = await socketOf('station', 'S1');
    append([aStockReleased({ payload: { stock_item_id: 'K1', order_item_id: 'L1', quantity: 500, reason: 'removed' } })]);
    await settle();
    expect(engine().lines.L1!.deadline_ms).not.toBe(before.deadline_ms);
    expect(plans(k1)).toEqual([{ type: 'station_plan', ...(body('S1', hub.deps.writer.lastSeq()) as object) }]);
  });

  it('[03a #83] a commit that changes no line and no station sends no frame; the after-commit frames add 0 statements', async () => {
    kitchen();
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }] });
    const staff = await socketOf('staff');
    const k1 = await socketOf('station', 'S1');
    append([aStockSet({ stream_id: 'K1', payload: { stock_item_id: 'K1', on_hand: 2_000, unit: 'g' } })]);
    await settle();
    expect(plans(staff)).toEqual([]);
    expect(plans(k1)).toEqual([]);

    // Statements between the commit (tx.onCommit, before every after-commit hook) and a hook added after the frame
    // hook: the same for a commit with frames as for one without.
    const counter = statementCounter(hub.deps.db);
    let mark = 0;
    let window = -1;
    hub.deps.writer.addAfterCommit(() => {
      window = counter.count - mark;
    });
    const windowOf = (drafts: (t: WriterTx) => EventDraft[]): number => {
      hub.deps.writer.run((tx) => {
        tx.onCommit(() => {
          mark = counter.count;
        });
        return tx.append(drafts(tx));
      });
      return window;
    };
    const quiet = windowOf(() => [draftOf(aStockSet({ stream_id: 'K1', payload: { stock_item_id: 'K1', on_hand: 1_000, unit: 'g' } }))]);
    const framed = windowOf((tx) => fakeSubmitDrafts(tx.state as EngineState, { order_id: 'O2', lines: [{ order_item_id: 'L2' }] }, tx.clock.branchNow()));
    await settle();
    expect(plans(k1).map((p) => p.station_id)).toEqual(['S1']);
    expect(framed).toBe(quiet);
    expect(framed).toBe(0);
  });

  it('[03a #83] an alert-mode socket of a staff device gets no station_plan (only the session sockets are sent to)', async () => {
    kitchen();
    const c = clientOf('staff');
    const staff = await connect(c);
    const alerts = await connect(c, false);
    expect((alerts.messages[0] as { type: string }).type).toBe('alerts_open');
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }] });
    await settle();
    expect(plans(staff).map((p) => p.station_id)).toEqual(['S1']);
    expect(plans(alerts)).toEqual([]);
  });

  it('[03a #83] a station socket that reconnects still gets its frames', async () => {
    kitchen();
    const c = clientOf('station', 'S1');
    const first = await connect(c);
    first.close();
    await settle();
    const again = await connect(c);
    expect(((again.messages[0] as { state: Record<string, unknown> }).state.station_plan as Plan[]).map((p) => p.station_id)).toEqual(['S1']);
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }] });
    await settle();
    expect(plans(again).map((p) => p.station_id)).toEqual(['S1']);
  });

  it('[03a #83] a station socket whose station is not in the engine gets its own (empty) body in the catch-up', async () => {
    kitchen();
    const k9 = await socketOf('station', 'S9');
    const frame = k9.messages[0] as { as_of_seq: number; state: Record<string, unknown> };
    expect(frame.state.station_plan).toEqual([{ station_id: 'S9', as_of_seq: frame.as_of_seq, lines: [] }]);
  });

  it('[03a #83] a line entering Next with nothing else due: the frame is sent from due, with no transaction and no statement', async () => {
    kitchen(config({ freeze_ms: 2 * MIN }));
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }] });
    const k1 = await socketOf('station', 'S1');
    const k2 = await socketOf('station', 'S2');
    const fireAt = engine().lines.L1!.fire_ms!;
    await pass(fireAt - 2 * MIN - TICK_MS);
    const m = meter();
    m.reset();
    const due = vi.spyOn(firesTick, 'due');
    await pass(fireAt - 2 * MIN);
    await settle();
    expect(due).toHaveBeenCalledTimes(1);
    expect(due.mock.results[0]!.value).toBe(false);
    expect(m.tx).toBe(0);
    expect(m.statements).toBe(1); // 01d's SELECT, nothing else
    expect(plans(k1)).toEqual([{ type: 'station_plan', ...(body('S1', hub.deps.writer.lastSeq()) as object) }]);
    expect(plans(k1)[0]!.lines).toEqual([expect.objectContaining({ order_item_id: 'L1', frozen: true })]);
    expect(plans(k2)).toEqual([]);
    // The next pass: nothing crossed, nothing sent.
    await pass(fireAt - 2 * MIN + TICK_MS);
    await settle();
    expect(plans(k1)).toHaveLength(1);
    expect(m.tx).toBe(0);
  });

  it('[03a #83] a pass with intents: a station both crossed and changed by the commit gets one frame, from the after-commit hook; a crossed-only station gets one too', async () => {
    kitchen(config({ freeze_ms: 20 * MIN }));
    // S1: L1 cooks 20 min, L2 5 min, one deadline: L2's freeze entry falls before L1's fire. S2: L3 enters Next later.
    submit({
      order_id: 'O1',
      lines: [
        { order_item_id: 'L1', item: { cook_time_ms: 20 * MIN } },
        { order_item_id: 'L2', item: { cook_time_ms: 5 * MIN } },
        { order_item_id: 'L3', station_id: 'S2', item: { cook_time_ms: 10 * MIN } },
      ],
    });
    const s = engine();
    const fire1 = s.lines.L1!.fire_ms!;
    const fire2 = s.lines.L2!.fire_ms!;
    const fire3 = s.lines.L3!.fire_ms!;
    expect(fire2 - 20 * MIN).toBeLessThanOrEqual(fire1);
    expect(fire2 - MIN).toBeGreaterThan(fire1);
    expect(fire3 - 20 * MIN).toBeLessThanOrEqual(fire1);
    expect(fire3).toBeGreaterThan(fire1 + MIN);
    const k1 = await socketOf('station', 'S1');
    const k2 = await socketOf('station', 'S2');
    const staff = await socketOf('staff');
    const sent = vi.spyOn(wsHubFor(hub.app), 'sendToSessions');
    await pass(fire1 - 21 * MIN);
    expect(plans(k1)).toEqual([]);
    const m = meter();
    m.reset();
    // One pass over (fire1 − 21 min, fire1]: L1 fires (S1 changed), L2 and L3 enter Next (S1, S2 crossed).
    await pass(fire1);
    await settle();
    expect(m.tx).toBe(1);
    expect(engine().lines.L1!.fired_at).not.toBeNull();
    expect(plans(k1).map((p) => p.station_id)).toEqual(['S1']);
    expect(plans(k2).map((p) => p.station_id)).toEqual(['S2']);
    expect(plans(staff).map((p) => p.station_id).sort()).toEqual(['S1', 'S2']);
    expect(sent).toHaveBeenCalledTimes(2);
    expect(plans(k1)[0]).toEqual({ type: 'station_plan', ...(body('S1', hub.deps.writer.lastSeq()) as object) });
  });

  it('[03a #83] a failed commit of the fires pass loses no freeze-entry frame: crossed and last_pass_ms are restored, the next pass sends it', async () => {
    kitchen(config({ freeze_ms: 20 * MIN }));
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1', item: { cook_time_ms: 20 * MIN } }, { order_item_id: 'L2', item: { cook_time_ms: 5 * MIN } }] });
    const fire1 = engine().lines.L1!.fire_ms!;
    const k1 = await socketOf('station', 'S1');
    await pass(fire1 - 21 * MIN);
    const run = hub.deps.writer.run.bind(hub.deps.writer);
    let failed = 0;
    vi.spyOn(hub.deps.writer, 'run').mockImplementation(((fn: (t: WriterTx) => unknown) =>
      run((t) => {
        const out = fn(t);
        if (failed === 0) {
          failed += 1;
          throw new Error('disk full');
        }
        return out;
      })) as typeof hub.deps.writer.run);
    await pass(fire1);
    await settle();
    expect(failed).toBe(1);
    expect(log.error).toHaveBeenCalled();
    expect(engine().lines.L1!.fired_at).toBeNull();
    expect(plans(k1)).toEqual([]);
    // The retry pass commits: the frame for S1 (L1 fired, L2 entered Next during the failed pass) goes out once.
    await pass(fire1 + TICK_MS);
    await settle();
    expect(engine().lines.L1!.fired_at).not.toBeNull();
    expect(plans(k1)).toHaveLength(1);
    expect(plans(k1)[0]!.lines.find((l) => l.order_item_id === 'L2')).toMatchObject({ frozen: true });
  });

  it('[03a #83] crossed stations of a failed pass with no other change are still sent by the retry pass', async () => {
    kitchen(config({ freeze_ms: 20 * MIN }));
    // S1 fires at fire1; S2's L3 enters Next in the same interval and changes in no commit.
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1', item: { cook_time_ms: 20 * MIN } }, { order_item_id: 'L3', station_id: 'S2', item: { cook_time_ms: 10 * MIN } }] });
    const fire1 = engine().lines.L1!.fire_ms!;
    const k2 = await socketOf('station', 'S2');
    await pass(fire1 - 21 * MIN);
    const run = hub.deps.writer.run.bind(hub.deps.writer);
    let failed = 0;
    vi.spyOn(hub.deps.writer, 'run').mockImplementation(((fn: (t: WriterTx) => unknown) =>
      run((t) => {
        const out = fn(t);
        if (failed === 0) {
          failed += 1;
          throw new Error('disk full');
        }
        return out;
      })) as typeof hub.deps.writer.run);
    await pass(fire1);
    await settle();
    expect(plans(k2)).toEqual([]);
    await pass(fire1 + TICK_MS);
    await settle();
    expect(plans(k2).map((p) => p.station_id)).toEqual(['S2']);
    expect(plans(k2)[0]!.lines).toEqual([expect.objectContaining({ order_item_id: 'L3', frozen: true })]);
  });
});
