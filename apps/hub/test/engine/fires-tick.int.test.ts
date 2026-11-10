// 03a task 22: the `fires` tick and the config catch-up (§6.2, §3.6.1, §3.6.2, §3.11, §3.12; tests #60, #62 hub, #63,
// #71, #73, #79, #95, #111 hub). The §7.1 pass timing is fires-tick.perf.test.ts (the clean perf run, AD-32).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Writable } from 'node:stream';
import { getTickIntents, isOrderInEngine, nextDueAt, type EngineState, type TickDraft } from '@pos/engine';
import type { EngineConfig, EventDraft, PosEvent } from '@pos/events';
import { aBranchConfig, aBusinessDayClosed, aBusinessDayOpened, anEngineConfigApplied, aStockSet } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alertsTick, registeredTicks, startTickLoop, TICK_MS } from '../../src/alerts/tick';
import { unregisterTick } from '../../src/alerts/tick';
import { engineStep6, registerEngineBootSteps } from '../../src/engine-host/boot-steps';
import { firesAlertsTick } from '../../src/engine-host/fires-alerts-tick';
import { firesTick, onFreezeEntry, setEngineConfigOf } from '../../src/engine-host/fires-tick';
import { hostFlags } from '../../src/engine-host/host-flags';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import type { WriterTx } from '../../src/engine-host/writer';
import { boot, type BootContext, type BootHandle } from '../../src/lib/boot';
import { registerRestaurantBootSteps } from '../../src/sync/boot-steps';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { draftOf, fakeSubmit, fakeTap, type FakeOrder } from './fakes';

// As main.ts: the engine steps (and the fires tick, right after 01d's `alerts`), then the restaurant steps.
registerEngineBootSteps(() => performance.now());
registerRestaurantBootSteps();

const BRANCH = 'branch-1';
const TENANT = 'tenant-a';
const MIN = 60_000;
const HOUR = 60 * MIN;

const nextImmediate = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// The host's stamp of an engine draft (§3.6.1): the pass's now, no actor, the hub as device.
const stamped = (drafts: readonly TickDraft[], now: number): EventDraft[] =>
  drafts.map((d) => ({ stream_type: d.stream_type, stream_id: d.stream_id, event_type: d.event_type, schema_version: d.schema_version, payload: d.payload as unknown as Record<string, unknown>, occurred_at: now, actor_id: null, device_id: 'hub' }));
const draftsOf = (events: readonly PosEvent[]): EventDraft[] => events.map((e) => draftOf(e));

function config(o: { capacity?: number; stations?: string[]; freeze_ms?: number } = {}): EngineConfig {
  const base = anEngineConfigApplied().payload as unknown as EngineConfig;
  const s1 = base.stations[0]!;
  const ids = o.stations ?? ['S1'];
  return { ...base, stations: ids.map((station_id) => ({ ...s1, station_id, name: station_id, capacity: o.capacity ?? s1.capacity, freeze_ms: o.freeze_ms ?? s1.freeze_ms })) };
}

describe('03a task 22: the fires tick', () => {
  let hub: TestHub;
  let stop: () => void = () => undefined;
  const log = { error: vi.fn<(obj: Record<string, unknown>, msg?: string) => void>() };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    hub = await createTestHub();
    unregisterTick('table_locks'); // 02a §3.4: registerTables adds it to every test hub; this file counts the ticks
    // 0006 seeds the no_approver flag dirty (01d's flag pass): start clean, so 01d's tick is idle (1 SELECT per pass).
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
    log.error.mockClear();
    // These tests count the fires tick alone; fires_alerts (task 22a: its boot reconcile pass, its slips) has its own file.
    vi.spyOn(firesAlertsTick, 'due').mockReturnValue(false);
    stop = startTickLoop(hub.deps, log);
  });

  afterEach(async () => {
    stop();
    stop = () => undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
    setEngineConfigOf(null);
    swapBranchConfig(null);
    hostFlags.configStale = false;
    hostFlags.checkpoint_pending = false;
    await hub.close();
  });

  const engine = (): EngineState => hub.deps.state.get();
  const append = (events: readonly PosEvent[]): PosEvent[] => hub.deps.writer.run((tx) => tx.append(draftsOf(events))).appended;
  const pass = async (at?: number): Promise<void> => {
    if (at !== undefined) hub.clock.set(at);
    await vi.advanceTimersByTimeAsync(TICK_MS);
  };
  const eventsOf = (type: string): PosEvent[] => hub.published.flat().filter((e) => e.event_type === type);
  const fired = (): string[] => eventsOf('FireDispatched').flatMap((e) => (e.payload as { order_item_ids: string[] }).order_item_ids);

  // 01d's no_approver flag is marked dirty by a day open or close; cleared, so 01d's tick stays idle in these tests.
  const clean = (): void => {
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
  };
  function kitchen(c: EngineConfig = config()): void {
    append([anEngineConfigApplied({ payload: c as unknown as Record<string, unknown> }), aBusinessDayOpened()]);
    clean();
  }
  const submit = (o: FakeOrder): PosEvent[] => fakeSubmit(hub.deps, o);
  const dueAt = (): number => nextDueAt(engine(), hub.clock.branchNow())!;

  // Spies writer.run: counts transactions, and the statements run inside tx.append (the appends) apart from the rest.
  function meter(): { readonly tx: number; readonly appendStatements: number; readonly statements: number; reset(): void } {
    const counter = statementCounter(hub.deps.db);
    const run = hub.deps.writer.run.bind(hub.deps.writer);
    let tx = 0;
    let appendStatements = 0;
    vi.spyOn(hub.deps.writer, 'run').mockImplementation(((fn: (t: WriterTx) => unknown) => {
      tx += 1;
      return run((t) => {
        const original = t.append.bind(t);
        t.append = (drafts) => {
          const before = counter.count;
          const out = original(drafts);
          appendStatements += counter.count - before;
          return out;
        };
        return fn(t);
      });
    }) as typeof hub.deps.writer.run);
    return {
      get tx() {
        return tx;
      },
      get appendStatements() {
        return appendStatements;
      },
      get statements() {
        return counter.count;
      },
      reset() {
        tx = 0;
        appendStatements = 0;
        counter.reset();
      },
    };
  }

  it('[03a §6.2] the fires tick is registered right after 01d\'s alerts tick', () => {
    expect(registeredTicks().map((t) => t.name)).toEqual(['alerts', 'fires', 'fires_alerts']);
  });

  // ------------------------------------------------------------------------------------------------------ #62 hub
  it('[03a #62 hub] an idle pass opens no transaction and runs no statement; a pass with work is one transaction with 0 reads plus the appends', async () => {
    kitchen();
    hub.clock.advance(MIN);
    // A takeaway picked up in an hour: its lines fire later.
    const pickup = hub.clock.branchNow() + HOUR;
    submit({ order_id: 'O1', order: { order_type: 'takeaway', table_id: null, table_key: 'takeaway:O1', pickup_at_ms: pickup }, lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2' }] });
    const due = dueAt();
    expect(due).toBeGreaterThan(hub.clock.branchNow() + 10 * TICK_MS);

    const m = meter();
    const realIntents = firesTick.intents.bind(firesTick);
    let insideIntents = -1;
    const intents = vi.spyOn(firesTick, 'intents').mockImplementation((tx, state, now) => {
      const start = m.statements;
      const drafts = realIntents(tx, state, now);
      insideIntents = m.statements - start;
      return drafts;
    });
    // Idle: 20 passes before the first fire. 01d's own tick reads its one indexed SELECT per pass; fires reads nothing.
    for (let i = 0; i < 20; i += 1) await pass(hub.clock.branchNow() + TICK_MS);
    expect(hub.clock.branchNow()).toBeLessThan(due);
    expect(m.tx).toBe(0);
    expect(m.statements).toBe(20);
    expect(intents).not.toHaveBeenCalled();
    // The due itself, called directly on the read-only view: 0 statements.
    m.reset();
    expect(firesTick.due(readOnlyDb(hub.deps.db), engine(), hub.clock.branchNow())).toBe(false);
    expect(m.statements).toBe(0);

    // With work: one transaction; inside intents no statement; every other statement of the pass is an append's,
    // except 01d's one SELECT.
    const before = engine();
    const expected = stamped(getTickIntents(before, due), due);
    m.reset();
    hub.published.length = 0;
    await pass(due);
    expect(m.tx).toBe(1);
    expect(insideIntents).toBe(0);
    expect(m.statements).toBe(1 + m.appendStatements);
    expect(hub.published).toHaveLength(1);
    expect(draftsOf(hub.published[0]!)).toEqual(expected);
    expect(fired().sort()).toEqual(['L1', 'L2']);

    // The next pass at the same instant: nothing due, no transaction.
    m.reset();
    await pass(due);
    expect(m.tx).toBe(0);
    expect(m.statements).toBe(1);
  });

  // ------------------------------------------------------------------------------------------- §10.5 gap 2 (hub)
  it('[03a §10.5 gap 2] a fires pass writing Start, Done, StockConsumed, ReservationsShifted drafts: exact count', async () => {
    // X two_tap capacity 1 (the overrun cascade), AD auto_done (the inferred Done), ST single_tap (the inferred Start
    // and its StockConsumed). Every line is immediate, one order each, prep 0.
    const base = anEngineConfigApplied().payload as unknown as EngineConfig;
    const s1 = base.stations[0]!;
    const st = (station_id: string, o: Partial<EngineConfig['stations'][number]>) => ({ ...s1, station_id, name: station_id, ...o });
    kitchen({ ...base, stations: [st('AD', { capacity: 1, completion_mode: 'auto_done' }), st('ST', { capacity: 2, completion_mode: 'single_tap' }), st('X', { capacity: 1, completion_mode: 'two_tap' })] });
    const open = hub.clock.branchNow();
    append([aStockSet({ stream_id: 'K1', payload: { stock_item_id: 'K1', on_hand: 5, unit: 'piece' } })]);
    const line = (order_item_id: string, station_id: string, cook: number, extra: Record<string, unknown> = {}) => ({
      order_item_id,
      station_id,
      item: { station_id, cook_time_ms: cook, prep_buffer_ms: 0, serve_mode: 'immediate', ...extra },
    });
    const t0 = hub.clock.branchNow();
    // On X: A [t0, t0 + 5), B [t0 + 5, t0 + 10), C [t0 + 10, t0 + 15). On AD: D [t0, t0 + 6).
    submit({ order_id: 'OA', lines: [line('A', 'X', 5 * MIN)] });
    submit({ order_id: 'OB', lines: [line('B', 'X', 5 * MIN)] });
    submit({ order_id: 'OC', lines: [line('C', 'X', 5 * MIN)] });
    submit({ order_id: 'OD', lines: [line('D', 'AD', 6 * MIN)] });
    expect(engine().lines.C!.booked).toMatchObject({ start: t0 + 10 * MIN });
    await pass(t0);
    expect(fired().sort()).toEqual(['A', 'D']);
    fakeTap(hub.deps, 'start', 'A');
    fakeTap(hub.deps, 'start', 'D');
    await pass(t0 + 5 * MIN); // B fires at A's planned end (no overrun yet)
    expect(fired()).toContain('B');
    // At t0 + 8: A (never tapped Done) overruns by 3 min, so B packed behind it overlaps C; D is past its auto Done; E,
    // a from-stock line on ST submitted now, fires at once with its inferred Start and StockConsumed.
    const P = t0 + 8 * MIN;
    hub.clock.set(P);
    fakeSubmit(
      hub.deps,
      { order_id: 'OE', lines: [line('E', 'ST', 20 * MIN, { stock_time_ms: MIN, stock_draws: [{ stock_item_id: 'K1', quantity: 1 }] })] },
      { dayStartMs: open, stockItems: [{ stock_item_id: 'K1', name: 'Kebab', stock_unit: 'piece', carries_over: true, station_id: 'ST', low_stock_threshold: null }] },
    );
    expect(engine().lines.E!.from_stock).toBe(true);
    const before = engine();
    const expected = stamped(getTickIntents(before, P), P);
    expect(expected.map((d) => d.event_type)).toEqual(['FireDispatched', 'ItemStarted', 'StockConsumed', 'ItemDone', 'ReservationsShifted']);
    expect(expected.map((d) => (d.payload as { order_item_id?: string }).order_item_id ?? null)).toEqual([null, 'E', 'E', 'D', null]);
    expect((expected[4]!.payload as { shifts: Array<{ order_item_id: string }> }).shifts.map((s) => s.order_item_id)).toEqual(['C']);
    // The registered projections each upsert their checkpoint once per append (projections/registry.ts applyAll); none
    // handles these five event types.
    const projections = hub.deps.db.prepare('SELECT COUNT(*) FROM projection_checkpoints WHERE branch_id = ?').pluck().get(BRANCH) as number;
    expect(projections).toBeGreaterThan(0);

    const m = meter();
    const realIntents = firesTick.intents.bind(firesTick);
    let insideIntents = -1;
    vi.spyOn(firesTick, 'intents').mockImplementation((tx, state, now) => {
      const start = m.statements;
      const drafts = realIntents(tx, state, now);
      insideIntents = m.statements - start;
      return drafts;
    });
    m.reset();
    hub.published.length = 0;
    await pass(P);
    expect(m.tx).toBe(1);
    expect(hub.published).toHaveLength(1);
    expect(draftsOf(hub.published[0]!)).toEqual(expected);
    // §6.2 / §10.5: 0 reads in intents (state in memory). The appends: 1 MAX(seq) + 5 INSERTs + one checkpoint upsert per
    // projection. The pass: 01d's one indexed SELECT + those. No after-commit statement (no checkpoint pending, no
    // snapshot multiple crossed; the frames read nothing).
    expect(insideIntents).toBe(0);
    expect(m.appendStatements).toBe(1 + 5 + projections);
    expect(m.statements).toBe(1 + 0 + (1 + 5 + projections));
    expect(engine().lines.D).toMatchObject({ stage: 'done', done_at: t0 + 6 * MIN });
    expect(engine().lines.E).toMatchObject({ stage: 'cooking', started_at: P, reserved_seq: null });
    expect(engine().stock.K1).toMatchObject({ on_hand: 4, reserved: 0 });
  });

  // ---------------------------------------------------------------------------------------------------------- #63
  it('[03a #63] a throw in fires.intents rolls back only the fires tick; 01d\'s tick still runs; the next pass fires', async () => {
    kitchen();
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }] });
    const due = dueAt();
    const order: string[] = [];
    vi.spyOn(alertsTick, 'due').mockImplementation(() => {
      order.push('alerts.due');
      return true;
    });
    vi.spyOn(alertsTick, 'intents').mockImplementation(() => {
      order.push('alerts.intents');
      return [];
    });
    const real = firesTick.intents.bind(firesTick);
    const spy = vi.spyOn(firesTick, 'intents').mockImplementation((tx, state, now) => {
      order.push('fires.intents');
      tx.append(real(tx, state, now));
      throw new Error('fires intents failed');
    });
    const seq = hub.deps.writer.lastSeq();
    const state = engine();
    await pass(due);
    expect(order).toEqual(['alerts.due', 'alerts.intents', 'fires.intents']);
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ tick: 'fires', err: expect.any(Error) }), 'tick failed');
    expect(hub.deps.writer.lastSeq()).toBe(seq);
    expect(engine()).toBe(state);
    expect(hub.deps.db.prepare("SELECT COUNT(*) AS n FROM events WHERE event_type = 'FireDispatched'").get()).toEqual({ n: 0 });

    spy.mockRestore();
    order.length = 0;
    await pass(due + TICK_MS);
    expect(order).toEqual(['alerts.due', 'alerts.intents']);
    expect(fired()).toEqual(['L1']);
  });

  // ---------------------------------------------------------------------------------------------------------- #71
  it('[03a #71] a submit and the fires tick in the same 500 ms: intents re-select inside the transaction; no double fire', async () => {
    kitchen(config({ capacity: 1 }));
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }] });
    const due = dueAt();
    hub.clock.set(due);
    let between: EngineState | null = null;
    (hub.deps as { testHooks?: unknown }).testHooks = {
      betweenDueAndRun: (name: string) => {
        if (name !== 'fires') return;
        submit({ order_id: 'O2', lines: [{ order_item_id: 'L2' }] });
        between = engine();
      },
    };
    hub.published.length = 0;
    await pass();
    expect(between).not.toBeNull();
    const tick = hub.published.find((batch) => batch.some((e) => e.event_type === 'FireDispatched'))!;
    // Computed on the state after the submit, read inside the tick's own transaction.
    expect(draftsOf(tick)).toEqual(stamped(getTickIntents(between!, due), due));
    expect(fired().filter((id) => id === 'L1')).toEqual(['L1']);

    // Later passes: L1 is never dispatched a second time.
    (hub.deps as { testHooks?: unknown }).testHooks = undefined;
    for (let i = 0; i < 4; i += 1) await pass(hub.clock.branchNow() + TICK_MS);
    expect(fired().filter((id) => id === 'L1')).toEqual(['L1']);
  });

  it('[03a #71] a line dispatched by a commit between due and intents is not fired twice', async () => {
    kitchen();
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }] });
    const due = dueAt();
    hub.clock.set(due);
    (hub.deps as { testHooks?: unknown }).testHooks = {
      betweenDueAndRun: (name: string) => {
        if (name !== 'fires') return;
        // The same pass's work already committed by another writer (e.g. a pass that raced this one).
        hub.deps.writer.run((tx) => tx.append(stamped(getTickIntents(tx.state as EngineState, due), due)));
      },
    };
    hub.published.length = 0;
    await pass();
    expect(fired()).toEqual(['L1']);
  });

  // ---------------------------------------------------------------------------------------------------------- #73
  it('[03a #73] a StationCapacitySet committed between due and intents: intents are computed on the new state', async () => {
    kitchen(config({ capacity: 4 }));
    submit({ order_id: 'O1', lines: [{ order_item_id: 'A' }, { order_item_id: 'B' }, { order_item_id: 'C' }] });
    const due = dueAt();
    hub.clock.set(due);
    const old = engine();
    let between: EngineState | null = null;
    (hub.deps as { testHooks?: unknown }).testHooks = {
      betweenDueAndRun: (name: string) => {
        if (name !== 'fires') return;
        append([
          { ...anEngineConfigApplied(), stream_id: 'S1', event_type: 'StationCapacitySet', payload: { station_id: 'S1', capacity_override: 1, previous: null, reason: 'manager' } } as PosEvent,
        ]);
        between = engine();
      },
    };
    const m = meter();
    hub.published.length = 0;
    await pass();
    expect(m.tx).toBe(2); // the capacity commit, then the tick's own
    const onNew = stamped(getTickIntents(between!, due), due);
    const onOld = stamped(getTickIntents(old, due), due);
    expect(onNew).not.toEqual(onOld);
    expect(fired()).toHaveLength(1); // capacity 1 now: one of the three
    const tick = hub.published.filter((batch) => batch.every((e) => e.event_type !== 'StationCapacitySet')).flat();
    expect(draftsOf(tick)).toEqual(onNew);
  });

  // ---------------------------------------------------------------------------------------------------------- #79
  describe('[03a #79, #95] config catch-up (§3.11)', () => {
    const step6 = (): void => {
      engineStep6({ config: hub.deps.config, db: hub.deps.db, initialState: engine(), clock: hub.clock } as BootContext);
    };
    const applied = (): BranchConfigEntry => ({ config: aBranchConfig(), snapshotHash: 'h', configVersion: 1, snapshotSchemaVersion: 3, appliedAt: 1 });
    type BranchConfigEntry = Parameters<typeof swapBranchConfig>[0] & object;

    it('[03a #79] a hub with an applied config and no EngineConfigApplied writes one in the first fires pass, and nothing more', async () => {
      const e = config();
      swapBranchConfig(applied());
      setEngineConfigOf(() => e);
      expect(engine().config).toBeNull();
      step6();
      expect(hostFlags.configStale).toBe(true);
      const m = meter();
      await pass();
      expect(m.tx).toBe(1);
      expect(hub.published).toHaveLength(1);
      expect(hub.published[0]!.map((x) => x.event_type)).toEqual(['EngineConfigApplied']);
      expect(hub.published[0]![0]).toMatchObject({ stream_type: 'station', stream_id: BRANCH, payload: e });
      expect(engine().config).toEqual(e);
      expect(hostFlags.configStale).toBe(false);
      m.reset();
      for (let i = 0; i < 3; i += 1) await pass();
      expect(m.tx).toBe(0);
      expect(hub.published).toHaveLength(1);
    });

    it('[03a #79] nothing when equal: step 6 leaves configStale false and no pass writes', async () => {
      kitchen();
      swapBranchConfig(applied());
      setEngineConfigOf(() => config());
      step6();
      expect(hostFlags.configStale).toBe(false);
      const m = meter();
      for (let i = 0; i < 3; i += 1) await pass();
      expect(m.tx).toBe(0);
      expect(m.statements).toBe(3);
    });

    it('[03a #79] no E() source yet (task 24) or no applied config: configStale stays false', () => {
      setEngineConfigOf(null); // the server build wires task 24's E() (config-hook.ts); unset for the no-source case
      kitchen();
      swapBranchConfig(applied());
      step6();
      expect(hostFlags.configStale).toBe(false);
      swapBranchConfig(null);
      setEngineConfigOf(() => config({ capacity: 2 }));
      step6();
      expect(hostFlags.configStale).toBe(false);
    });

    it('[03a #95] with configStale and due fires, the first pass writes only EngineConfigApplied; the fires follow in the next pass, on the folded state', async () => {
      kitchen(config({ capacity: 4 }));
      for (const id of ['A', 'B', 'C']) submit({ order_id: `O${id}`, lines: [{ order_item_id: id }] });
      const due = dueAt();
      const next = config({ capacity: 1 });
      swapBranchConfig(applied());
      setEngineConfigOf(() => next);
      hub.clock.set(due);
      step6();
      expect(hostFlags.configStale).toBe(true);
      expect(getTickIntents(engine(), due).length).toBeGreaterThan(0);
      const m = meter();
      hub.published.length = 0;
      await pass();
      expect(m.tx).toBe(1);
      expect(hub.published.flat().map((e) => e.event_type)).toEqual(['EngineConfigApplied']);
      expect(hostFlags.configStale).toBe(false);
      const folded = engine();
      expect(folded.config).toEqual(next);
      hub.published.length = 0;
      const at = due + TICK_MS;
      const expected = stamped(getTickIntents(folded, at), at);
      expect(expected.length).toBeGreaterThan(0);
      await pass(at);
      expect(draftsOf(hub.published.flat())).toEqual(expected);
    });
  });

  // ------------------------------------------------------------------------------------------------------ #111 hub
  it('[03a #111 hub] the abandon pass writes StockReleased { abandoned } and, after its fold, the checkpoint pending since the close', async () => {
    const c = { ...config(), settings: { ...config().settings, order_abandon_ms: 4 * HOUR } };
    kitchen(c);
    const open = hub.clock.branchNow();
    append([aStockSet({ stream_id: 'K1', payload: { stock_item_id: 'K1', on_hand: 2_000, unit: 'g' } })]);
    fakeSubmit(
      hub.deps,
      { order_id: 'O1', lines: [{ order_item_id: 'L1', item: { stock_time_ms: 300_000, stock_draws: [{ stock_item_id: 'K1', quantity: 500 }] } }] },
      { dayStartMs: open, stockItems: [{ stock_item_id: 'K1', name: 'Karahi base', stock_unit: 'g', carries_over: true, station_id: 'S1', low_stock_threshold: null }] },
    );
    expect(engine().lines.L1!.reserved_seq).toEqual(expect.any(Number));
    await pass(dueAt());
    expect(fired()).toEqual(['L1']); // fired, never tapped
    const lastFold = engine().orders.O1!.last_line_fold_at;

    hub.clock.advance(HOUR);
    append([aBusinessDayClosed()]);
    clean();
    expect(hostFlags.checkpoint_pending).toBe(true);
    const checkpoints = (): Array<{ last_seq: number }> => hub.deps.db.prepare('SELECT last_seq FROM engine_checkpoints').all() as Array<{ last_seq: number }>;
    expect(checkpoints()).toEqual([]);

    const abandonAt = lastFold + 4 * HOUR;
    expect(nextDueAt(engine(), abandonAt - TICK_MS)).toBe(abandonAt);
    await pass(abandonAt - TICK_MS);
    expect(eventsOf('StockReleased')).toEqual([]);

    const m = meter();
    hub.published.length = 0;
    await pass(abandonAt);
    expect(m.tx).toBe(1);
    const batch = hub.published.flat();
    expect(batch.map((e) => [e.event_type, (e.payload as { reason?: string }).reason])).toEqual([['StockReleased', 'abandoned']]);
    expect(batch[0]!.payload).toMatchObject({ stock_item_id: 'K1', order_item_id: 'L1', quantity: 500 });
    expect(engine().stock.K1).toMatchObject({ reserved: 0 });
    expect(isOrderInEngine(engine(), 'O1', abandonAt)).toBe(false);
    // "That pass": scheduled after the pass's fold (AD-20), written in its own setImmediate, last_seq = the release.
    await nextImmediate();
    expect(checkpoints()).toEqual([{ last_seq: batch[0]!.seq }]);
    expect(hostFlags.checkpoint_pending).toBe(false);
    m.reset();
    await pass(abandonAt + TICK_MS);
    await nextImmediate();
    expect(m.tx).toBe(0);
    expect(checkpoints()).toHaveLength(1);
  });

  // ------------------------------------------------------------------------------------------------- §3.6.3 seam
  it('[03a §3.6.3] a pass with only freeze entries: no transaction, no statement; the crossed stations go to the frame seam (task 22b)', async () => {
    kitchen(config({ stations: ['S1', 'S2'], freeze_ms: 2 * MIN }));
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2', station_id: 'S2' }] });
    const sent: string[][] = [];
    onFreezeEntry(hub.deps, (ids) => sent.push(ids));
    const fireAt = engine().lines.L1!.fire_ms!;
    const m = meter();
    await pass(fireAt - 2 * MIN - TICK_MS);
    expect(sent).toEqual([]);
    await pass(fireAt - 2 * MIN);
    expect(sent).toEqual([['S1', 'S2']]);
    await pass(fireAt - 2 * MIN + TICK_MS);
    expect(sent).toHaveLength(1);
    expect(m.tx).toBe(0);
    expect(m.statements).toBe(3); // 01d's SELECT, one per pass
  });

});

// --------------------------------------------------------------------------------------------------------------- #60
function writeConfig(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-engine-fires-'));
  const dataDir = join(dir, 'data');
  const backupDir = join(dir, 'backup');
  mkdirSync(dataDir);
  mkdirSync(backupDir);
  const path = join(dir, 'config.json');
  writeFileSync(
    path,
    JSON.stringify({
      cloud_base_url: 'https://cloud.example',
      http_port: 3000,
      data_dir: dataDir,
      backup_dir: backupDir,
      min_client_version: '1.0.0',
      backup_encryption_key: Buffer.alloc(32, 7).toString('base64'),
      advertised_host: '192.168.10.2',
      provisioned: { tenant_id: TENANT, branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'test-branch-api-key', confirmed_at: 1 },
    }),
  );
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const quiet = (): Writable => new Writable({ write: (_chunk, _enc, done) => done() });

describe('[03a #60] missed fires after a restart', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.useRealTimers();
  });

  it('[03a #60] step 6 writes nothing; HubStarted.missed_fires = the dry count; the first tick fires them scheduled with due_at < hub_up_at; lines fired before the outage are not fired again', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const W = 1_762_000_000_000;
    let mono = 0;
    const bootAt = (wall: number): Promise<BootHandle> => {
      mono = 0;
      return boot({ configPath: cfg.path, wallNow: () => wall, monoNow: () => mono, ifaces: ['192.168.10.2'], configClient: stubConfigCloud(), logStream: quiet() });
    };
    const h1 = await bootAt(W);
    let stopped = false;
    cleanups.push(async () => {
      if (!stopped) await h1.stop();
    });
    const t0 = h1.deps.clock.branchNow();
    h1.deps.writer.run((tx) => tx.append(draftsOf([anEngineConfigApplied(), aBusinessDayOpened()])));
    fakeSubmit(h1.deps, { order_id: 'O1', lines: [{ order_item_id: 'A' }] });
    mono += 10 * MIN;
    fakeSubmit(h1.deps, { order_id: 'O2', lines: [{ order_item_id: 'B1' }, { order_item_id: 'B2' }] });
    const s1 = h1.deps.state.get() as EngineState;
    const aFire = s1.lines.A!.fire_ms!;
    expect(s1.lines.B1!.fire_ms!).toBeGreaterThan(aFire);
    mono = aFire - t0;
    await vi.advanceTimersByTimeAsync(TICK_MS);
    const dispatched = (db: BootHandle['deps']['db']): Array<{ ids: string[]; reason: string; due_at: number; seq: number }> =>
      (db.prepare("SELECT seq, payload FROM events WHERE event_type = 'FireDispatched' ORDER BY seq").all() as Array<{ seq: number; payload: string }>).map((r) => {
        const p = JSON.parse(r.payload) as { order_item_ids: string[]; reason: string; due_at: number };
        return { ids: p.order_item_ids, reason: p.reason, due_at: p.due_at, seq: r.seq };
      });
    expect(dispatched(h1.deps.db).flatMap((d) => d.ids)).toEqual(['A']);
    await h1.stop();
    stopped = true;

    // Down for 3 h: B1 and B2 were due during the outage.
    const h2 = await bootAt(W + 3 * HOUR);
    cleanups.push(() => h2.stop());
    const started = h2.deps.db.prepare("SELECT seq, payload FROM events WHERE event_type = 'HubStarted' ORDER BY seq DESC LIMIT 1").get() as { seq: number; payload: string };
    const hubStarted = JSON.parse(started.payload) as { missed_fires: number; hub_up_at: number };
    expect(hubStarted.missed_fires).toBe(2);
    // Boot wrote nothing for them: HubStarted is the last event and no fire came after the outage yet.
    expect(h2.deps.writer.lastSeq()).toBe(started.seq);
    expect(dispatched(h2.deps.db).flatMap((d) => d.ids)).toEqual(['A']);

    mono += TICK_MS;
    await vi.advanceTimersByTimeAsync(TICK_MS);
    const after = dispatched(h2.deps.db).filter((d) => d.seq > started.seq);
    expect(after.flatMap((d) => d.ids).sort()).toEqual(['B1', 'B2']);
    for (const d of after) {
      expect(d.reason).toBe('scheduled');
      expect(d.due_at).toBeLessThan(hubStarted.hub_up_at);
    }
    // Not fired again later either.
    for (let i = 0; i < 4; i += 1) {
      mono += TICK_MS;
      await vi.advanceTimersByTimeAsync(TICK_MS);
    }
    expect(dispatched(h2.deps.db).flatMap((d) => d.ids).sort()).toEqual(['A', 'B1', 'B2']);
  });
});
