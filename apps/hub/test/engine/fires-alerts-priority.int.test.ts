// 03a v1.2.10 §3.5.7 PR-3 "Host", §6.2a step 7 (STAB-7; review B-1, m-5; re-review R-2; final check FC-2): the
// priority half of the fires_alerts pass — LinePrioritized drafts in one transaction of their own, the pass's last; the
// host map priority_parked; tests 153 (hub part (3), (4)), 168 (hub part), 173. The fires tick is held off (its due
// stubbed false) so a line stays waiting while its estimate passes T + limit; FireDispatched / Start are appended by hand.
import { performance } from 'node:perf_hooks';
import { getAlertIntents, nextAlertDueAt, type EngineState } from '@pos/engine';
import type { EngineConfig, PosEvent } from '@pos/events';
import { aFireDispatched, aBusinessDayOpened, anEngineConfigApplied } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTickLoop, TICK_MS, unregisterTick } from '../../src/alerts/tick';
import { registerEngineBootSteps } from '../../src/engine-host/boot-steps';
import { firesAlertsPriorityTick, firesAlertsTick } from '../../src/engine-host/fires-alerts-tick';
import { firesTick } from '../../src/engine-host/fires-tick';
import { hostFlags, resetHostFlags } from '../../src/engine-host/host-flags';
import { registerRestaurantBootSteps } from '../../src/sync/boot-steps';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';
import { draftOf, fakeSubmit, fakeTap, type FakeOrder } from './fakes';
import { resetSlipReaders } from '../../src/engine-host/slip-readers';

registerEngineBootSteps(() => performance.now());
registerRestaurantBootSteps();

const MIN = 60_000;
const WAITER = 'S_WAIT';

function config(stations: Record<string, Partial<EngineConfig['stations'][number]>>, settings: Partial<EngineConfig['settings']> = {}): EngineConfig {
  const base = anEngineConfigApplied().payload as unknown as EngineConfig;
  const s1 = base.stations[0]!;
  return { ...base, stations: Object.entries(stations).map(([station_id, o]) => ({ ...s1, station_id, name: station_id, ...o })), settings: { ...base.settings, ...settings } };
}

describe('03a v1.2.10 §6.2a step 7: the priority transaction of fires_alerts', () => {
  let hub: TestHub;
  let stop: () => void = () => undefined;
  const log = { error: vi.fn<(obj: Record<string, unknown>, msg?: string) => void>() };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    hub = await createTestHub();
    resetSlipReaders();
    for (const name of ['table_locks', 'pass_closures', 'ready_retarget', 'served_estimate', 'kds_presence', 'fiscal_outbox_stuck']) unregisterTick(name);
    await seedDirectory(hub);
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
    vi.spyOn(firesTick, 'due').mockReturnValue(false); // lines stay waiting; fires are appended by hand
    log.error.mockClear();
    stop = startTickLoop(hub.deps, log);
  });

  afterEach(async () => {
    stop();
    stop = () => undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetHostFlags();
    resetSlipReaders();
    await hub.close();
  });

  const engine = (): EngineState => hub.deps.state.get();
  const append = (events: readonly PosEvent[]): PosEvent[] => hub.deps.writer.run((tx) => tx.append(events.map((e) => draftOf(e, hub.clock.branchNow())))).appended;
  const pass = async (at: number): Promise<void> => {
    hub.clock.set(at);
    await vi.advanceTimersByTimeAsync(TICK_MS);
  };
  function kitchen(c: EngineConfig): void {
    append([anEngineConfigApplied({ payload: c as unknown as Record<string, unknown> }), aBusinessDayOpened()]);
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
  }
  const submit = (o: FakeOrder): PosEvent[] => fakeSubmit(hub.deps, { actor_id: WAITER, ...o });
  const fire = (station_id: string, ids: string[]): void => {
    append([aFireDispatched({ stream_id: station_id, payload: { station_id, order_item_ids: ids, load_id: null, due_at: hub.clock.branchNow(), reason: 'scheduled' } })]);
  };
  const batches = (type: string): number[] => hub.published.flatMap((b, i) => (b.some((e) => e.event_type === type) ? [i] : []));
  const prioritized = (): PosEvent[] => hub.published.flat().filter((e) => e.event_type === 'LinePrioritized');
  // The priority tick's transactions (intents calls) and the statements inside its due.
  function meter(): { readonly tx: number; readonly dueStatements: number } {
    const counter = statementCounter(hub.deps.db);
    let tx = 0;
    let dueStatements = 0;
    const realDue = firesAlertsPriorityTick.due.bind(firesAlertsPriorityTick);
    const realIntents = firesAlertsPriorityTick.intents.bind(firesAlertsPriorityTick);
    vi.spyOn(firesAlertsPriorityTick, 'due').mockImplementation((db, state, now) => {
      const before = counter.count;
      const out = realDue(db, state, now);
      dueStatements += counter.count - before;
      return out;
    });
    vi.spyOn(firesAlertsPriorityTick, 'intents').mockImplementation((t, state, now) => {
      tx += 1;
      return realIntents(t, state, now);
    });
    return {
      get tx() {
        return tx;
      },
      get dueStatements() {
        return dueStatements;
      },
    };
  }

  // One immediate line (cook 10, max delay 1 min) on S1, planned to fire now and never fired: it crosses at now + 1 min + 1.
  function oneLate(o: { key?: string; mode?: 'sync' | 'immediate' } = {}): { order_id: string; crossing: number } {
    const t0 = hub.clock.branchNow();
    submit({ order_id: 'O1', order: { table_key: o.key ?? 'dine_in:T12' }, lines: [{ order_item_id: 'A', item: { cook_time_ms: 10 * MIN, serve_mode: o.mode ?? 'immediate', max_delay_ms: MIN } }] });
    expect(engine().lines.A!.fire_ms).toBe(t0);
    const crossing = engine().priority_due['O1:0']!;
    expect(crossing).toBe(t0 + MIN + 1);
    return { order_id: 'O1', crossing };
  }

  it('[03a #153 (3)] a table key in `skipped` still gets its LinePrioritized; nextAlertDueAt keeps the priority term', async () => {
    kitchen(config({ S1: { capacity: 8 } }));
    const { crossing } = oneLate();
    hostFlags.skipped.add('dine_in:T12');
    expect(nextAlertDueAt(engine(), hostFlags.skipped)).toBe(crossing);
    await pass(crossing - 1);
    expect(prioritized()).toHaveLength(0);
    await pass(crossing);
    expect(prioritized().map((e) => e.payload)).toEqual([{ order_id: 'O1', group_id: 'O1:0', order_item_ids: ['A'], delay_ms: MIN + 1, at_ms: crossing }]);
    expect(engine().lines.A!.priority_at).toBe(crossing);
    expect(engine().priority_due).toEqual({});
    // Not due again: an idle pass opens no transaction.
    const m = meter();
    await pass(crossing + 5 * MIN);
    expect(m.tx).toBe(0);
    expect(m.dueStatements).toBe(0);
  });

  it('[03a #173] one pass with a slip and a priority crossing for one table: SlipWarned first, LinePrioritized in the last transaction, the slip with the estimate before priority; a throw in the slip transaction does not stop it', async () => {
    kitchen(config({ S1: { capacity: 8 } }, { slip_threshold_ms: MIN }));
    oneLate({ mode: 'sync' });
    const at = hub.clock.branchNow() + 3 * MIN;
    const before = getAlertIntents(engine(), at);
    expect(before.slips).toHaveLength(1);
    expect(before.prioritized).toHaveLength(1);
    await pass(at);
    const warned = batches('SlipWarned');
    const prio = batches('LinePrioritized');
    expect(warned).toHaveLength(1);
    expect(prio).toHaveLength(1);
    expect(prio[0]!).toBeGreaterThan(warned[0]!);
    expect(prio[0]!).toBe(hub.published.length - 1);
    const slip = hub.published.flat().find((e) => e.event_type === 'SlipWarned')!;
    expect((slip.payload as { estimated_land_ms: number }).estimated_land_ms).toBe(before.slips[0]!.estimate);

    // Isolation (01d): a throw in fires_alerts' intents rolls back only that transaction.
    hub.published.length = 0;
    submit({ order_id: 'O2', order: { table_key: 'dine_in:T7', table_id: 'T7' }, lines: [{ order_item_id: 'B', item: { cook_time_ms: 10 * MIN, serve_mode: 'sync', max_delay_ms: MIN } }] });
    vi.spyOn(firesAlertsTick, 'intents').mockImplementation(() => {
      throw new Error('slip transaction failed');
    });
    hub.published.length = 0;
    await pass(hub.clock.branchNow() + 3 * MIN);
    expect(hub.published.flat().filter((e) => e.event_type === 'SlipWarned')).toHaveLength(0);
    expect(prioritized().map((e) => e.stream_id)).toEqual(['O2']);
    expect(log.error).toHaveBeenCalled();
  });

  // Raita (S2, cook 10, max delay 5 min) and naan (S1, cook 2) served together; Z (S1, cook 20) ahead of the naan. Z and the
  // naan are fired by hand and nobody taps Start: the naan slides 12 min past the raita's estimate.
  function slide(): number {
    kitchen(config({ S1: { capacity: 1 }, S2: { capacity: 1 } }));
    submit({ order_id: 'OZ', order: { table_key: 'dine_in:T1', table_id: 'T1' }, lines: [{ order_item_id: 'z', item: { cook_time_ms: 20 * MIN, serve_mode: 'immediate' } }] });
    submit({
      order_id: 'OG',
      lines: [
        { order_item_id: 'raita', station_id: 'S2', item: { cook_time_ms: 10 * MIN, max_delay_ms: 5 * MIN } },
        { order_item_id: 'naan', item: { cook_time_ms: 2 * MIN } },
      ],
    });
    fire('S1', ['z']);
    hub.clock.set(hub.clock.branchNow() + 1_000); // packed in (fire, id) order: the naan after Z
    fire('S1', ['naan']);
    return engine().priority_due['OG:0']!;
  }

  it('[03a #153 (4), #168 hub] a group driven by a sliding sibling is parked: due stays false (0 statements, no transaction); any commit un-parks it and due re-parks it in memory; Start lets the next pass draft it', async () => {
    const due = slide();
    expect(due).toBeGreaterThan(hub.clock.branchNow());
    const m = meter();
    for (let k = 0; k < 4; k += 1) await pass(due + k * MIN);
    expect(prioritized().map((e) => e.payload)).toEqual([]);
    expect(m.tx).toBe(0);
    expect(m.dueStatements).toBe(0);
    expect(hostFlags.priority_parked.has('OG:0')).toBe(true);
    const recheck = hostFlags.priority_parked.get('OG:0')!;
    expect(recheck).toBe(engine().orders.OZ!.last_line_fold_at + engine().config!.settings.order_abandon_ms);
    // FC-2: a commit on an unrelated table un-parks every group; due re-evaluates condition 3 and stays false.
    submit({ order_id: 'OU', order: { table_key: 'dine_in:T9', table_id: 'T9' }, lines: [{ order_item_id: 'u', station_id: 'S2', item: { cook_time_ms: MIN, serve_mode: 'immediate' } }] });
    expect(hostFlags.priority_parked.size).toBe(0);
    await pass(due + 5 * MIN);
    expect(m.tx).toBe(0);
    expect(hostFlags.priority_parked.has('OG:0')).toBe(true);
    // (b) Start on the naan: its land is fixed, the raita drives the delay; the commit un-parks and the next pass drafts.
    hub.clock.set(due + 6 * MIN);
    fakeTap(hub.deps, 'start', 'naan');
    await pass(due + 6 * MIN);
    expect(m.tx).toBe(1);
    expect(prioritized().map((e) => (e.payload as { order_item_ids: string[] }).order_item_ids)).toEqual([['raita']]);
  });
});
