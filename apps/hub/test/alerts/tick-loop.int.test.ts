import type { PosEvent } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alertsTick, registeredTicks, registerTick, startTickLoop, TICK_MS, unregisterTick } from '../../src/alerts/tick';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { FAKE_EFFECT_EVENT, fakeFires, fakeFiresDraft, registerFakeFires, registerFakes, resetFakes } from './fakes';

// 01d task 27: the hub tick loop and registerTick (tick.ts). §3.5 "The tick": every TICK_MS on branchNow, one
// `now` per pass given to every registered tick, in registration order (`alerts` first); a tick's `due` is a
// read-only pre-check outside any transaction; only when it is true does that tick get its OWN writer.run, with
// testHooks.betweenDueAndRun(name) in between (m11). A throw in `due` or `intents` is logged
// { tick, err } (AD: pino's err key, as AD-28) and the other ticks still run. "Idle cost": nothing due → one
// indexed SELECT per registered tick, no transaction, no after-commit hook. #37's "alerts step" is played by a
// spy on alertsTick.intents (its real step pass is tested in tick-steps.int, task 28).

interface Log {
  error: ReturnType<typeof vi.fn<(obj: Record<string, unknown>, msg?: string) => void>>;
}

describe('tick loop (01d §3.5, §4.2 registerTick)', () => {
  let hub: TestHub;
  let log: Log;
  let stop: () => void = () => undefined;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    hub = await createTestHub();
    unregisterTick('table_locks'); // 02a §3.4: registerTables adds it to every test hub; this file counts the ticks
    for (const name of ['pass_closures', 'ready_retarget']) unregisterTick(name); // 03b §6.18–6.19 (b16): lane B5 adds both to every test hub too
    registerFakes();
    // 0006 seeds the no_approver flag dirty (cleared by the tick's flag pass, task 31): start clean
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
    log = { error: vi.fn<(obj: Record<string, unknown>, msg?: string) => void>() };
  });

  afterEach(async () => {
    stop();
    stop = () => undefined;
    vi.restoreAllMocks();
    resetFakes();
    vi.useRealTimers();
    await hub.close();
  });

  function start(): void {
    stop = startTickLoop(hub.deps, log);
  }

  async function pass(): Promise<void> {
    await vi.advanceTimersByTimeAsync(TICK_MS);
  }

  function setFlagDirty(): void {
    hub.deps.db.prepare("UPDATE alert_flags SET dirty = 1 WHERE name = 'no_approver'").run();
  }

  function seedAlert(alertId: string, o: { nextDueAt: number | null; state?: 'open' | 'closed' }): void {
    const state = o.state ?? 'open';
    hub.deps.db
      .prepare(
        `INSERT INTO alerts (alert_id, kind, family, subject_stream_type, subject_stream_id, dedupe_key,
           raised_device_id, raised_seq, target_json, values_json, display_json, step, next_due_at, state,
           close_reason, raised_at)
         VALUES (?, 't_two_step', 'info', 'hub', 'branch-1', ?, 'hub', 1, '{}', '{}', '{}', 0, ?, ?, ?, ?)`,
      )
      .run(alertId, alertId, o.nextDueAt, state, state === 'closed' ? 'done' : null, hub.clock.branchNow());
  }

  function effects(): Array<{ stream_id: string; marker: string }> {
    return (
      hub.deps.db.prepare('SELECT stream_id, payload FROM events WHERE event_type = ? ORDER BY seq').all(FAKE_EFFECT_EVENT) as Array<{
        stream_id: string;
        payload: string;
      }>
    ).map((row) => ({ stream_id: row.stream_id, marker: (JSON.parse(row.payload) as { alert_id: string }).alert_id }));
  }

  /** alertsTick.intents as task 28 will be: it writes inside its own transaction. */
  function alertsIntentsWrite(mode: 'ok' | 'throw'): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(alertsTick, 'intents').mockImplementation((tx, _state, now) => {
      const draft = { ...fakeFiresDraft(now, 'alerts_appended'), stream_id: 'alerts' };
      tx.append([draft]);
      if (mode === 'throw') throw new Error('alerts intents failed');
      return [{ ...draft, payload: { alert_id: 'alerts_returned' } }];
    });
  }

  it('[01d §4.2] registration order is the run order and `alerts` is first; a name registers once', () => {
    registerFakeFires();
    expect(registeredTicks().map((t) => t.name)).toEqual(['alerts', 'fires']);
    expect(() => {
      registerTick({ name: 'fires', due: () => false, intents: () => [] });
    }).toThrow(/already registered/);
    expect(() => {
      unregisterTick('alerts');
    }).toThrow();
    expect(TICK_MS).toBe(500);
  });

  it('[01d #22] idle tick: nothing due and no dirty flag → exactly one SELECT per registered tick, writer.run never called, no afterCommit hook', async () => {
    expect(registeredTicks().map((t) => t.name)).toEqual(['alerts']);
    seedAlert('A_LATER', { nextDueAt: hub.clock.branchNow() + 60_000 });
    seedAlert('A_CLOSED', { nextDueAt: hub.clock.branchNow() - 1, state: 'closed' });
    seedAlert('A_NOTHING', { nextDueAt: null });
    const run = vi.spyOn(hub.deps.writer, 'run');
    const hook = vi.fn();
    hub.deps.writer.addAfterCommit(hook);
    start();
    const counter = statementCounter(hub.deps.db);
    await pass();
    expect(counter.count).toBe(1);
    await pass();
    await pass();
    expect(counter.count).toBe(3);
    expect(run).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('[01d §3.5] the alerts pre-check is the §3.5 statement on alerts_due + alert_flags: true for a due open alert or a dirty flag', async () => {
    const plan = hub.deps.db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT EXISTS (SELECT 1 FROM alerts WHERE state = 'open' AND next_due_at IS NOT NULL AND next_due_at <= ?)
             OR EXISTS (SELECT 1 FROM alert_flags WHERE dirty = 1) AS due`,
      )
      .all(0) as Array<{ detail: string }>;
    expect(plan.map((row) => row.detail).join('\n')).toMatch(/alerts USING (COVERING )?INDEX alerts_due/);
    const due = (): boolean => alertsTick.due(hub.deps.db, hub.deps.state.get(), hub.clock.branchNow());
    expect(due()).toBe(false);
    seedAlert('A1', { nextDueAt: hub.clock.branchNow() + 1 });
    expect(due()).toBe(false);
    hub.clock.advance(1);
    expect(due()).toBe(true); // next_due_at <= now
    hub.deps.db.prepare("UPDATE alerts SET state = 'closed', close_reason = 'done'").run();
    expect(due()).toBe(false);
    setFlagDirty();
    expect(due()).toBe(true);
    // due → its own writer.run; with no due alert (only the flag, whose pass is task 31) intents appends nothing
    const run = vi.spyOn(hub.deps.writer, 'run');
    start();
    await pass();
    expect(run).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('[01d #37] tick isolation: a throwing fires.intents rolls back only its transaction, logged { tick: fires }; the alerts step of the pass commits; both get the same now', async () => {
    registerFakeFires();
    setFlagDirty();
    alertsIntentsWrite('ok');
    const alertsNow = vi.spyOn(alertsTick, 'due');
    fakeFires.due = true;
    fakeFires.mode = 'throw';
    const run = vi.spyOn(hub.deps.writer, 'run');
    start();
    await pass();
    expect(run).toHaveBeenCalledTimes(2); // each tick its own transaction
    expect(effects()).toEqual([
      { stream_id: 'alerts', marker: 'alerts_appended' },
      { stream_id: 'alerts', marker: 'alerts_returned' },
    ]); // nothing of fires: its own append rolled back with it
    expect(log.error).toHaveBeenCalledTimes(1);
    const [line] = log.error.mock.calls[0] as [Record<string, unknown>];
    expect(line).toMatchObject({ tick: 'fires' });
    expect(line.err).toBeInstanceOf(Error);
    const now = alertsNow.mock.calls[0]![2];
    expect(fakeFires.calls).toEqual([
      { fn: 'due', now },
      { fn: 'intents', now },
    ]);
    expect((alertsTick.intents as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![2]).toBe(now);
  });

  it('[01d #37] the reverse: a throwing alerts tick does not stop a fires intent; it is logged { tick: alerts }', async () => {
    registerFakeFires();
    setFlagDirty();
    alertsIntentsWrite('throw');
    fakeFires.due = true;
    start();
    await pass();
    expect(effects()).toEqual([
      { stream_id: 'fires', marker: 'fires_appended' },
      { stream_id: 'fires', marker: 'fires_returned' },
    ]);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0]![0]).toMatchObject({ tick: 'alerts' });
    // the failure is per pass: the next pass runs both again
    alertsIntentsWrite('ok');
    fakeFires.due = false;
    await pass();
    expect(effects().map((e) => e.marker)).toEqual(['fires_appended', 'fires_returned', 'alerts_appended', 'alerts_returned']);
  });

  it('[01d #37] a tick whose due is false opens no transaction', async () => {
    registerFakeFires();
    const run = vi.spyOn(hub.deps.writer, 'run');
    start();
    await pass();
    expect(run).not.toHaveBeenCalled();
    expect(fakeFires.calls.map((c) => c.fn)).toEqual(['due']);
    setFlagDirty(); // alerts due, fires not → exactly one transaction, the alerts one
    const intents = vi.spyOn(alertsTick, 'intents');
    await pass();
    expect(run).toHaveBeenCalledTimes(1);
    expect(intents).toHaveBeenCalledTimes(1);
    expect(fakeFires.calls.map((c) => c.fn)).toEqual(['due', 'due']);
  });

  it('[01d §3.5] one now = clock.branchNow() per pass, given to every tick (due and intents)', async () => {
    registerFakeFires();
    setFlagDirty();
    fakeFires.due = true;
    let t = hub.clock.branchNow();
    const branchNow = vi.spyOn(hub.deps.clock, 'branchNow').mockImplementation(() => (t += 7));
    const alertsDue = vi.spyOn(alertsTick, 'due');
    const alertsIntents = vi.spyOn(alertsTick, 'intents');
    start();
    const before = branchNow.mock.calls.length;
    await pass();
    const first = branchNow.mock.results[before]!.value as number;
    expect(alertsDue.mock.calls[0]![2]).toBe(first);
    expect(alertsIntents.mock.calls[0]![2]).toBe(first);
    expect(fakeFires.calls).toEqual([
      { fn: 'due', now: first },
      { fn: 'intents', now: first },
    ]);
    // idle pass: the loop itself reads branchNow exactly once
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
    fakeFires.due = false;
    const mark = branchNow.mock.calls.length;
    await pass();
    expect(branchNow.mock.calls.length - mark).toBe(1);
  });

  it('[01d §3.5] testHooks.betweenDueAndRun(name) runs after due and before that tick\'s writer.run, and only for a due tick', async () => {
    registerFakeFires();
    setFlagDirty();
    fakeFires.due = false;
    const order: string[] = [];
    vi.spyOn(alertsTick, 'due').mockImplementation(() => {
      order.push('due:alerts');
      return true;
    });
    const realRun = hub.deps.writer.run.bind(hub.deps.writer);
    vi.spyOn(hub.deps.writer, 'run').mockImplementation((fn) => {
      order.push('writer.run');
      return realRun(fn);
    });
    let release: () => void = () => undefined;
    hub.deps.testHooks = {
      betweenDueAndRun: (name: string) => {
        order.push(`hook:${name}`);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    };
    start();
    await pass();
    expect(order).toEqual(['due:alerts', 'hook:alerts']); // writer.run waits for the hook
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['due:alerts', 'hook:alerts', 'writer.run']);
    expect(fakeFires.calls.map((c) => c.fn)).toEqual(['due']); // fires not due: no hook call for it
  });

  it('[01d §3.5] a throwing due is logged { tick, err } and the next tick still runs', async () => {
    registerFakeFires();
    fakeFires.due = true;
    vi.spyOn(alertsTick, 'due').mockImplementation(() => {
      throw new Error('alerts due failed');
    });
    const run = vi.spyOn(hub.deps.writer, 'run');
    start();
    await pass();
    expect(log.error).toHaveBeenCalledTimes(1);
    const [line] = log.error.mock.calls[0] as [Record<string, unknown>];
    expect(line).toMatchObject({ tick: 'alerts' });
    expect((line.err as Error).message).toBe('alerts due failed');
    expect(run).toHaveBeenCalledTimes(1); // the fires tick's own transaction
    expect(effects().map((e) => e.marker)).toEqual(['fires_appended', 'fires_returned']);
  });

  it('[01d §3.5] a pass every TICK_MS; stop() ends the loop', async () => {
    const due = vi.spyOn(alertsTick, 'due');
    start();
    await vi.advanceTimersByTimeAsync(TICK_MS - 1);
    expect(due).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(due).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TICK_MS * 2);
    expect(due).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(TICK_MS * 4);
    expect(due).toHaveBeenCalledTimes(3);
  });

  it('[01d §4.2] due is read-only: the loop hands it a read-only view of the db (a write there throws, logged)', async () => {
    registerFakeFires();
    const due = vi.spyOn(alertsTick, 'due').mockImplementation((db) => {
      db.prepare("UPDATE alert_flags SET dirty = 1 WHERE name = 'no_approver'").run();
      return true;
    });
    start();
    await pass();
    expect(due).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0]![0]).toMatchObject({ tick: 'alerts' });
    expect((hub.deps.db.prepare('SELECT dirty FROM alert_flags').get() as { dirty: number }).dirty).toBe(0);
  });

  it('[01d §3.5] a dirty flag with no due alert: the alerts tick opens its transaction and appends nothing', async () => {
    setFlagDirty();
    const appended: PosEvent[][] = [];
    hub.deps.writer.addAfterCommit((events) => appended.push(events));
    start();
    await pass();
    expect(appended).toEqual([[]]);
  });
});
