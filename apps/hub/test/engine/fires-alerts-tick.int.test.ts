// 03a task 22a: the `fires_alerts` tick (§6.2a steps 1–6, §3.8 defensive inputs and `skipped`, §3.10 overload check,
// flags `day_closed` / `reconcile`, BF-4 close; tests #76, #82, #86, #93, #113; AD-8 developer condition
// `engine_line_dropped`). The three kinds are the real ones (engine-host/kinds.ts, task 23).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Writable } from 'node:stream';
import { getAlertIntents, type EngineState } from '@pos/engine';
import type { EngineConfig, EventDraft, PosEvent } from '@pos/events';
import Database from 'better-sqlite3';
import { aBusinessDayClosed, aBusinessDayOpened, anEngineConfigApplied, anOrderBatch } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import { registeredTicks, startTickLoop, TICK_MS } from '../../src/alerts/tick';
import { engineStep6, registerEngineBootSteps } from '../../src/engine-host/boot-steps';
import { bindFiresAlertsTick, ENGINE_ALERT_KINDS, firesAlertsTick } from '../../src/engine-host/fires-alerts-tick';
import { onFreezeEntry } from '../../src/engine-host/fires-tick';
import { hostFlags, resetHostFlags } from '../../src/engine-host/host-flags';
import { onSigterm } from '../../src/engine-host/snapshots';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import type { WriterTx } from '../../src/engine-host/writer';
import { boot, type BootContext, type BootHandle } from '../../src/lib/boot';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { registerRestaurantBootSteps } from '../../src/sync/boot-steps';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';
import { draftOf, fakeSubmit, fakeTap, type FakeOrder } from './fakes';

registerEngineBootSteps(() => performance.now());
registerRestaurantBootSteps();

const MIN = 60_000;
const HOUR = 60 * MIN;
const KEY = 'dine_in:T12';
const WAITER = 'S_WAIT';

type StationOver = Partial<EngineConfig['stations'][number]>;
function config(stations: Record<string, StationOver> = { S1: {} }, settings: Partial<EngineConfig['settings']> = {}): EngineConfig {
  const base = anEngineConfigApplied().payload as unknown as EngineConfig;
  const s1 = base.stations[0]!;
  return {
    ...base,
    stations: Object.entries(stations).map(([station_id, o]) => ({ ...s1, station_id, name: station_id, ...o })),
    settings: { ...base.settings, ...settings },
  };
}
// §3.10: thresholds low enough that one 20-minute line on a capacity-1 station is red.
const HOT: StationOver = { capacity: 1, pressure_amber_bp: 1_000, pressure_red_bp: 2_000, pressure_alert_ms: MIN };

interface AlertRow {
  alert_id: string;
  state: 'open' | 'closed';
  close_reason: string | null;
  dedupe_key: string;
  subject_stream_type: string;
  subject_stream_id: string;
  values: Record<string, unknown>;
  target: Record<string, unknown>;
  receiver: string | null;
}

describe('03a task 22a: the fires_alerts tick', () => {
  let hub: TestHub;
  let stop: () => void = () => undefined;
  const log = { error: vi.fn<(obj: Record<string, unknown>, msg?: string) => void>() };


  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    hub = await createTestHub();
    await seedDirectory(hub);
    clean();
    log.error.mockClear();
    stop = startTickLoop(hub.deps, log);
  });

  afterEach(async () => {
    stop();
    stop = () => undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetHostFlags();
    await hub.close();
  });

  const engine = (): EngineState => hub.deps.state.get();
  const append = (events: readonly PosEvent[]): PosEvent[] => hub.deps.writer.run((tx) => tx.append(events.map((e) => draftOf(e, hub.clock.branchNow())))).appended;
  const pass = async (at?: number): Promise<void> => {
    if (at !== undefined) hub.clock.set(at);
    await vi.advanceTimersByTimeAsync(TICK_MS);
  };
  const passes = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i += 1) await pass(hub.clock.branchNow() + TICK_MS);
  };
  // 01d's no_approver flag is marked dirty by a day open / close and a directory apply: cleared, so 01d's tick stays idle.
  function clean(): void {
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
  }
  function kitchen(c: EngineConfig = config()): void {
    append([anEngineConfigApplied({ payload: c as unknown as Record<string, unknown> }), aBusinessDayOpened()]);
    clean();
  }
  const submit = (o: FakeOrder): PosEvent[] => fakeSubmit(hub.deps, { actor_id: WAITER, ...o });
  const eventsOf = (type: string): PosEvent[] => hub.published.flat().filter((e) => e.event_type === type);
  function alertRows(kind: string): AlertRow[] {
    const rows = hub.deps.db
      .prepare(
        `SELECT alert_id, state, close_reason, dedupe_key, subject_stream_type, subject_stream_id, values_json, target_json,
                json_extract(request_json, '$.receiver_staff_id') AS receiver
         FROM alerts WHERE kind = ? ORDER BY raised_seq`,
      )
      .all(kind) as Array<Omit<AlertRow, 'values' | 'target'> & { values_json: string; target_json: string }>;
    return rows.map(({ values_json, target_json, ...r }) => ({ ...r, values: JSON.parse(values_json) as Record<string, unknown>, target: JSON.parse(target_json) as Record<string, unknown> }));
  }
  const slipAlerts = (): AlertRow[] => alertRows(ENGINE_ALERT_KINDS.slip);
  const overloadAlerts = (): AlertRow[] => alertRows(ENGINE_ALERT_KINDS.overload);
  const droppedAlerts = (): AlertRow[] => alertRows(ENGINE_ALERT_KINDS.lineDropped);
  const skipLogs = (): Array<Record<string, unknown>> =>
    hub
      .logs()
      .split('\n')
      .filter((l) => l.includes('"tick":"fires_alerts"'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  // Counts fires_alerts' transactions (intents calls), the statements inside its due, and inside its intents apart from
  // the appends that intents itself makes (the close drafts appended before raiseMany).
  function meter(): { readonly tx: number; readonly dueStatements: number; readonly reads: number[]; readonly statements: number; reset(): void } {
    const counter = statementCounter(hub.deps.db);
    let tx = 0;
    let dueStatements = 0;
    let reads: number[] = [];
    const realDue = firesAlertsTick.due.bind(firesAlertsTick);
    const realIntents = firesAlertsTick.intents.bind(firesAlertsTick);
    vi.spyOn(firesAlertsTick, 'due').mockImplementation((db, state, now) => {
      const before = counter.count;
      const out = realDue(db, state, now);
      dueStatements += counter.count - before;
      return out;
    });
    vi.spyOn(firesAlertsTick, 'intents').mockImplementation((t: WriterTx, state, now) => {
      tx += 1;
      let appendStatements = 0;
      const original = t.append.bind(t);
      const wrapped: WriterTx = {
        ...t,
        append: (drafts: EventDraft[]) => {
          const before = counter.count;
          const out = original(drafts);
          appendStatements += counter.count - before;
          return out;
        },
      };
      const before = counter.count;
      const drafts = realIntents(wrapped, state, now);
      reads.push(counter.count - before - appendStatements);
      return drafts;
    });
    return {
      get tx() {
        return tx;
      },
      get dueStatements() {
        return dueStatements;
      },
      get reads() {
        return reads;
      },
      get statements() {
        return counter.count;
      },
      reset() {
        tx = 0;
        dueStatements = 0;
        reads = [];
        counter.reset();
      },
    };
  }

  // A late dine_in order: its line is fired and never started, so its estimate passes T + slip_threshold_ms.
  async function lateSlip(o: Partial<FakeOrder> = {}): Promise<{ order_id: string; due: number }> {
    const order_id = o.order_id ?? 'O1';
    submit({ order_id, lines: o.lines ?? [{ order_item_id: `${order_id}-L1` }], ...o });
    await pass(hub.clock.branchNow());
    const due = engine().next_alert_due_at;
    expect(due).not.toBeNull();
    return { order_id, due: due! };
  }

  // ------------------------------------------------------------------------------------------------------- wiring
  it('[03a §6.2a] fires_alerts is registered right after fires', () => {
    expect(registeredTicks().map((t) => t.name)).toEqual(['alerts', 'fires', 'fires_alerts']);
  });

  it('[03a §6.2a] a slip pass: 2 listOpen + raiseMany, the same count for 1 and 3 tables; SlipWarned carries the returned alert_id', async () => {
    kitchen(config({ S1: { capacity: 8 } }));
    const one = await lateSlip({ order_id: 'O1', order: { table_id: 'T1', table_key: 'dine_in:T1' } });
    const m = meter();
    await pass(one.due);
    expect(m.tx).toBe(1);
    const single = m.reads[0]!;
    const rows = slipAlerts();
    expect(rows).toHaveLength(1);
    const warned = eventsOf('SlipWarned');
    expect(warned).toHaveLength(1);
    expect(warned[0]!.payload).toMatchObject({ table_key: 'dine_in:T1', order_ids: ['O1'], alert_id: rows[0]!.alert_id });
    expect(warned[0]!.stream_id).toBe('O1');
    expect(engine().slips['dine_in:T1']!.alert_id).toBe(rows[0]!.alert_id);

    // Three tables late at once.
    for (const t of ['T2', 'T3', 'T4']) submit({ order_id: `O${t}`, order: { table_id: t, table_key: `dine_in:${t}` }, lines: [{ order_item_id: `L${t}` }] });
    await pass(hub.clock.branchNow());
    const due = engine().next_alert_due_at!;
    m.reset();
    await pass(due);
    expect(m.tx).toBe(1);
    expect(slipAlerts().filter((r) => r.state === 'open')).toHaveLength(4);
    expect(m.reads[0]).toBe(single);
    // 2 listOpen + 1 ItemAdded read for the slips' details (task 23, proposed reading; one for 1 or 3 tables) +
    // raiseMany's 6 (dedupe 1, fixed reads 5; a person target needs no resolver, and no route is registered).
    expect(single).toBe(2 + 1 + 6);
  });

  it('[03a §6.2a] the reconcile pass after boot: exactly the 2 listOpen statements, and it is not due again', async () => {
    kitchen();
    hostFlags.reconcile = true;
    const m = meter();
    await pass(hub.clock.branchNow() + TICK_MS);
    expect(m.tx).toBe(1);
    expect(m.reads).toEqual([2]);
    expect(hostFlags.reconcile).toBe(false);
    m.reset();
    await passes(10);
    expect(m.tx).toBe(0);
    expect(m.dueStatements).toBe(0);
  });

  // ----------------------------------------------------------------------------------------------------------- AD-8
  it('[03a AD-8] a dropped line raises one engine_line_dropped alert to managers with its values; a second fold of the line raises none', async () => {
    kitchen();
    const m = meter();
    // L2 is listed on a station the config does not have: its ItemAdded is a writer bug, the line is dropped (AD-8 c).
    const batch = anOrderBatch({ order_id: 'O1', lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2', line: { station_id: 'S9' } }], actor_id: WAITER });
    append(batch);
    expect(engine().lines.L2).toBeUndefined();
    expect(engine().lines.L1).toBeDefined();
    expect(engine().diagnostics).toEqual([]); // logged and cleared after commit (task 20)
    await pass(hub.clock.branchNow() + TICK_MS);
    expect(m.tx).toBe(1);
    const rows = droppedAlerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      state: 'open',
      dedupe_key: 'engine_line_dropped:L2',
      subject_stream_type: 'order',
      subject_stream_id: 'O1',
      target: { kind: 'managers' },
      values: { order_id: 'O1', order_item_id: 'L2', reason: 'station_missing' },
    });
    // Nothing queued: the next passes are not due.
    m.reset();
    await passes(5);
    expect(m.tx).toBe(0);
    expect(m.dueStatements).toBe(0);

    // A second fold of the same line: a repeated ItemAdded is not listed any more (it changes nothing, no line dropped).
    append([batch[2]!]);
    await passes(2);
    expect(droppedAlerts()).toHaveLength(1);
    // The same id dropped again (a later order lists it; the first alert is still open): deduped per order_item_id.
    append(anOrderBatch({ order_id: 'O2', lines: [{ order_item_id: 'L2', line: { station_id: 'S9' } }], actor_id: WAITER }));
    await passes(2);
    expect(droppedAlerts()).toHaveLength(1);
  });

  it('[03a AD-8] a refused reused-id batch raises one alert under its own key, which never collides with a real drop of that id', async () => {
    kitchen();
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }] });
    // O2 reuses L1 (AD-29 Q5): the whole OrderPlaced is refused, with one diagnostic naming L1.
    append(anOrderBatch({ order_id: 'O2', order: { table_id: 'T5', table_key: 'dine_in:T5' }, lines: [{ order_item_id: 'L1' }, { order_item_id: 'L7' }], actor_id: WAITER }).slice(0, 1));
    expect(engine().orders.O2).toBeUndefined();
    await pass(hub.clock.branchNow() + TICK_MS);
    const rows = droppedAlerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dedupe_key: 'engine_line_dropped:O2:L1',
      subject_stream_id: 'O2',
      values: { order_id: 'O2', order_item_id: 'L1', reason: 'order_item_id_reused' },
    });
    // A real drop of an id the refused batch named (L7, never placed) is its own alert.
    append(anOrderBatch({ order_id: 'O3', order: { table_id: 'T6', table_key: 'dine_in:T6' }, lines: [{ order_item_id: 'L7', line: { station_id: 'S9' } }], actor_id: WAITER }));
    await pass(hub.clock.branchNow() + TICK_MS);
    expect(droppedAlerts().map((r) => r.dedupe_key)).toEqual(['engine_line_dropped:O2:L1', 'engine_line_dropped:L7']);
  });

  it('[03a AD-8] an ItemAdded refused for stream_id_mismatch (its placeholder stays, the order never plans) raises engine_line_dropped', async () => {
    kitchen();
    const batch = anOrderBatch({ order_id: 'O1', lines: [{ order_item_id: 'L1' }], actor_id: WAITER });
    append([batch[0]!, { ...batch[1]!, stream_id: 'O-OTHER' }]);
    expect(engine().orders.O1!.awaiting).toBe(1);
    await pass(hub.clock.branchNow() + TICK_MS);
    expect(droppedAlerts().map((r) => [r.dedupe_key, r.values])).toEqual([
      ['engine_line_dropped:L1', { order_id: 'O1', order_item_id: 'L1', reason: 'stream_id_mismatch' }],
    ]);
  });

  it('[03a AD-8] a dropped-line fact with no order_id or order_item_id is skipped and logged as id_missing', async () => {
    kitchen();
    hostFlags.dropped_lines.push({ order_id: null, order_item_id: 'L9', reason: 'group_id_invalid', batch: true });
    await pass(hub.clock.branchNow() + TICK_MS);
    expect(droppedAlerts()).toEqual([]);
    expect(skipLogs().map((l) => [l.kind, l.order_item_id, l.reason])).toEqual([[ENGINE_ALERT_KINDS.lineDropped, 'L9', 'id_missing']]);
    expect(hostFlags.dropped_lines).toEqual([]);
  });

  // ---------------------------------------------------------------------------------------------------------- #76
  it('[03a #76] skipped inputs (no receiver; values failing the schema) are logged and never raised; the same pass\'s fires commit; a throwing raiseMany rolls back only fires_alerts and the alert follows', async () => {
    kitchen(config({ S1: { capacity: 8 }, S2: { capacity: 8 } }));
    // values the real values_schema refuses: an empty table key (table_key: z.string().min(1), §3.8)
    const empty = '';
    submit({ order_id: 'O1', actor_id: null, lines: [{ order_item_id: 'L1' }] }); // placed_by null: no receiver
    submit({ order_id: 'O2', order: { table_id: 'T2', table_key: empty }, lines: [{ order_item_id: 'L2' }] }); // values fail
    submit({ order_id: 'O3', order: { table_id: 'T3', table_key: 'dine_in:T3' }, actor_id: 'S_GONE', lines: [{ order_item_id: 'L3' }] }); // not in the directory
    await pass(hub.clock.branchNow());
    const due = engine().next_alert_due_at!;
    // A fresh order on S2 whose fire is due in the same pass as the slips.
    hub.clock.set(due - 1);
    submit({ order_id: 'O4', order: { table_id: 'T4', table_key: 'dine_in:T4' }, lines: [{ order_item_id: 'L4', station_id: 'S2' }] });
    hub.published.length = 0;
    await pass(due);
    expect(eventsOf('FireDispatched').flatMap((e) => (e.payload as { order_item_ids: string[] }).order_item_ids)).toContain('L4');
    expect(slipAlerts()).toEqual([]);
    expect(eventsOf('SlipWarned')).toEqual([]);
    const skips = skipLogs();
    expect(skips.map((l) => [l.table_key, l.reason]).sort()).toEqual([
      [KEY, 'no_receiver'],
      ['dine_in:T3', 'receiver_not_in_directory'],
      [empty, 'values_invalid'],
    ].sort());
    expect(skips.every((l) => l.kind === ENGINE_ALERT_KINDS.slip)).toBe(true);
    // Skipped keys are not retried every pass, nor logged again.
    const m = meter();
    await passes(6);
    expect(m.tx).toBe(0);
    expect(skipLogs()).toHaveLength(3);

    // A late order with a receiver: raiseMany throws once.
    submit({ order_id: 'O5', order: { table_id: 'T5', table_key: 'dine_in:T5' }, lines: [{ order_item_id: 'L5' }] });
    await pass(hub.clock.branchNow());
    const due5 = engine().slip_due['dine_in:T5']!; // next_alert_due_at still holds the skipped keys' times
    const spy = vi.spyOn(alerts, 'raiseMany').mockImplementationOnce(() => {
      throw new Error('raiseMany down');
    });
    const seq = hub.deps.writer.lastSeq();
    hub.published.length = 0;
    await pass(due5);
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ tick: 'fires_alerts' }), 'tick failed');
    expect(slipAlerts()).toEqual([]);
    // Only fires' events (if any) committed in that pass.
    expect(hub.published.flat().every((e) => e.event_type !== 'SlipWarned' && e.event_type !== 'AlertRaised')).toBe(true);
    expect(hub.deps.writer.lastSeq()).toBeGreaterThanOrEqual(seq);
    spy.mockRestore();
    // One-tick lag: the next pass raises it.
    await pass(due5 + TICK_MS);
    // (O4 on S2 is late by then too: its slip rides in the same passes.)
    expect(slipAlerts().map((r) => r.dedupe_key)).toContain('slip:dine_in:T5');
    expect(eventsOf('SlipWarned').filter((e) => (e.payload as { table_key: string }).table_key === 'dine_in:T5')).toHaveLength(1);
    expect(slipAlerts().map((r) => r.dedupe_key)).not.toContain(`slip:${KEY}`);
  });

  // ---------------------------------------------------------------------------------------------------------- #82
  it('[03a #82] every open slip_warning is closed obsolete in the first pass after BusinessDayClosed', async () => {
    kitchen(config({ S1: { capacity: 8 } }));
    const a = await lateSlip({ order_id: 'O1' });
    await pass(a.due);
    const b = await lateSlip({ order_id: 'O2', order: { table_id: 'T2', table_key: 'dine_in:T2' } });
    await pass(b.due);
    expect(slipAlerts().filter((r) => r.state === 'open')).toHaveLength(2);
    // Every line done, so no order is late after the close (nothing is raised again).
    for (const id of ['O1-L1', 'O2-L1']) {
      fakeTap(hub.deps, 'start', id);
      fakeTap(hub.deps, 'done', id);
    }
    stop();
    append([aBusinessDayClosed()]);
    expect(hostFlags.day_closed).toBe(true);
    stop = startTickLoop(hub.deps, log);
    await pass(hub.clock.branchNow() + TICK_MS);
    expect(hostFlags.day_closed).toBe(false);
    // The close dropped slips[key] (§3.8), so there is no `done` close: both go obsolete, and nothing is raised again.
    expect(slipAlerts().map((r) => [r.state, r.close_reason])).toEqual([
      ['closed', 'obsolete'],
      ['closed', 'obsolete'],
    ]);
  });

  it('[03a #82] an unresolved slip is closed obsolete with the note day_closed, also when the hub restarts between the close and that pass', async () => {
    kitchen(config({ S1: { capacity: 8 } }));
    const a = await lateSlip({ order_id: 'O1' });
    await pass(a.due);
    expect(slipAlerts()).toHaveLength(1);
    stop();
    append([aBusinessDayClosed()]);
    // Restart: the in-memory flag is lost; boot step 6 sets it again from state.business_day.closed_at.
    resetHostFlags();
    bindFiresAlertsTick(hub.deps, hub.app.log);
    expect(hostFlags.day_closed).toBe(false);
    engineStep6({ config: hub.deps.config, db: hub.deps.db, initialState: engine(), clock: hub.clock } as BootContext);
    expect(hostFlags.day_closed).toBe(true);
    expect(hostFlags.reconcile).toBe(true);
    stop = startTickLoop(hub.deps, log);
    await pass(hub.clock.branchNow() + TICK_MS);
    const first = slipAlerts()[0]!;
    expect(first.state).toBe('closed');
    expect(first.close_reason).toBe('obsolete');
    const closed = eventsOf('AlertClosed').find((e) => (e.payload as { alert_id: string }).alert_id === first.alert_id)!;
    expect(closed.payload).toMatchObject({ reason: 'obsolete', note: 'day_closed', by_staff_id: null });
    expect(hostFlags.day_closed).toBe(false);
    expect(hostFlags.reconcile).toBe(false);
  });

  // ---------------------------------------------------------------------------------------------------------- #86
  it('[03a #86] 60 s of an idle kitchen with lines entering Next: neither fires nor fires_alerts opens a transaction', async () => {
    kitchen();
    // A takeaway picked up in an hour; the window is the minute around its line's entry into Next (fire − freeze_ms),
    // before its early-fill eligibility (fire − max_early_ms): nothing fires or slips.
    submit({ order_id: 'O1', order: { order_type: 'takeaway', table_id: null, table_key: 'takeaway:O1', pickup_at_ms: hub.clock.branchNow() + HOUR }, lines: [{ order_item_id: 'L1' }] });
    await pass(hub.clock.branchNow());
    const fire = engine().lines.L1!.fire_ms!;
    hub.clock.set(fire - 120_000 - 30_000);
    await pass();
    const entered: string[][] = [];
    onFreezeEntry(hub.deps, (ids) => entered.push(ids));
    const counter = statementCounter(hub.deps.db);
    const run = vi.spyOn(hub.deps.writer, 'run');
    const m = meter();
    m.reset();
    counter.reset();
    await passes(120);
    expect(run).not.toHaveBeenCalled();
    expect(m.tx).toBe(0);
    expect(m.dueStatements).toBe(0);
    expect(counter.count).toBe(120); // 01d's one indexed SELECT per pass, nothing else
    expect(entered).toEqual([['S1']]); // the line entered Next inside the window
  });

  it('[03a #86] 60 s with one raised slip and one raised overload that persist unchanged: no fires_alerts transaction, 0 statements in its due', async () => {
    kitchen(config({ S1: HOT, S2: { capacity: 8 } }));
    // S1 red: one 20-minute line on capacity 1, started at once (no slip of its own).
    submit({ order_id: 'O1', order: { table_id: 'T1', table_key: 'dine_in:T1' }, lines: [{ order_item_id: 'L1' }] });
    await pass(hub.clock.branchNow());
    fakeTap(hub.deps, 'start', 'L1');
    // S2: a late line (fired, never started) → a slip.
    const s = await lateSlip({ order_id: 'O2', lines: [{ order_item_id: 'L2', station_id: 'S2' }] });
    await passes(Math.ceil((Math.max(s.due, hub.clock.branchNow() + MIN) - hub.clock.branchNow()) / TICK_MS) + 2);
    expect(overloadAlerts().filter((r) => r.state === 'open')).toHaveLength(1);
    expect(slipAlerts().filter((r) => r.state === 'open')).toHaveLength(1);
    clean();
    const m = meter();
    m.reset();
    await passes(120);
    expect(m.tx).toBe(0);
    expect(m.dueStatements).toBe(0);
    expect(overloadAlerts()).toHaveLength(1);
    expect(slipAlerts()).toHaveLength(1);
  });

  // ------------------------------------------------------------------------------------------------- §3.10 overload
  it('[03a §3.10] a station red for pressure_alert_ms raises one station_overload to managers; below amber it is closed done; red_since resets at restart', async () => {
    kitchen(config({ S1: HOT }));
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }] });
    await pass(hub.clock.branchNow());
    fakeTap(hub.deps, 'start', 'L1');
    const redAt = hub.clock.branchNow();
    await passes(MIN / TICK_MS - 4);
    expect(overloadAlerts()).toEqual([]);
    // A restart before pressure_alert_ms: red_since starts again (P-7).
    resetHostFlags();
    bindFiresAlertsTick(hub.deps, hub.app.log);
    await passes(10);
    expect(hub.clock.branchNow() - redAt).toBeGreaterThan(MIN);
    expect(overloadAlerts()).toEqual([]);
    await passes(MIN / TICK_MS);
    const rows = overloadAlerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'open', dedupe_key: 'station_overload:S1', subject_stream_type: 'station', subject_stream_id: 'S1', target: { kind: 'managers' } });
    expect(rows[0]!.values).toMatchObject({ station_id: 'S1', waiting: 1 });
    expect(rows[0]!.values.pressure_bp as number).toBeGreaterThan(2_000);
    expect(hostFlags.overload_open.has('S1')).toBe(true);
    // Done: nothing booked, below amber → closed done at the next check.
    fakeTap(hub.deps, 'done', 'L1');
    await pass(hub.clock.branchNow() + TICK_MS);
    expect(overloadAlerts()[0]).toMatchObject({ state: 'closed', close_reason: 'done' });
    expect(hostFlags.overload_open.has('S1')).toBe(false);
    const m = meter();
    await passes(5);
    expect(m.tx).toBe(0);
  });

  it('[03a §3.10] an open overload whose station left the config closes done at the next pass', async () => {
    kitchen(config({ S1: HOT, S2: { capacity: 8 } }));
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }] });
    await pass(hub.clock.branchNow());
    fakeTap(hub.deps, 'start', 'L1');
    await passes(MIN / TICK_MS + 4);
    expect(overloadAlerts()[0]).toMatchObject({ state: 'open', subject_stream_id: 'S1' });
    // S1 is removed from the config (deleted, not archived — an archived station stays in it): no longer red anywhere.
    append([anEngineConfigApplied({ payload: config({ S2: { capacity: 8 } }) as unknown as Record<string, unknown> })]);
    await pass(hub.clock.branchNow() + TICK_MS);
    expect(overloadAlerts()[0]).toMatchObject({ state: 'closed', close_reason: 'done' });
    expect(hostFlags.overload_open.size).toBe(0);
    const m = meter();
    await passes(5);
    expect(m.tx).toBe(0);
  });

  // ---------------------------------------------------------------------------------------------------------- #93
  it('[03a #93] a raised slip that persists, or grows while its alert is open, is not due; its resolution closes it done and the fold drops slips[key]', async () => {
    kitchen(config({ S1: { capacity: 8 } }));
    const s = await lateSlip({ order_id: 'O1' });
    await pass(s.due);
    const [row] = slipAlerts();
    expect(row).toMatchObject({ state: 'open', receiver: WAITER, target: { kind: 'person', staff_id: WAITER } });
    const m = meter();
    // Persists 60 s, then grows past another slip_threshold_ms (2 min more): never due while the alert is open.
    await passes(120);
    hub.clock.advance(3 * MIN);
    await passes(4);
    expect(m.tx).toBe(0);
    expect(m.dueStatements).toBe(0);
    // Resolves: the next pass closes the alert done; the AlertClosed fold drops slips[key].
    fakeTap(hub.deps, 'start', 'O1-L1');
    fakeTap(hub.deps, 'done', 'O1-L1');
    expect(engine().slips[KEY]!.resolved_at).not.toBeNull();
    await pass(hub.clock.branchNow() + TICK_MS);
    expect(slipAlerts()[0]).toMatchObject({ state: 'closed', close_reason: 'done' });
    expect(engine().slips[KEY]).toBeUndefined();
    m.reset();
    await passes(5);
    expect(m.tx).toBe(0);
  });

  it('[03a #93] a resolved slip whose alert was already closed (as by ReleaseItems) is dropped at resolution, with no close pass', async () => {
    kitchen(config({ S1: { capacity: 8 } }));
    const s = await lateSlip({ order_id: 'O1' });
    await pass(s.due);
    const [row] = slipAlerts();
    // 02's ReleaseItems closes it done (stubbed: the close alone, on its order subject).
    hub.deps.writer.run((tx) => tx.append(alerts.close(alerts.tickCtx(tx, hub.clock.branchNow()), row!.alert_id, 'done')));
    expect(engine().slips[KEY]!.alert_id).toBeNull();
    fakeTap(hub.deps, 'start', 'O1-L1');
    fakeTap(hub.deps, 'done', 'O1-L1');
    expect(engine().slips[KEY]).toBeUndefined();
    const m = meter();
    await passes(5);
    expect(m.tx).toBe(0);
  });

  it('[03a #93] Done then ItemDoneUndone before the close pass leaves the alert open; a skipped key is retried only after a commit that touches its order', async () => {
    kitchen(config({ S1: { capacity: 8 } }));
    const s = await lateSlip({ order_id: 'O1' });
    await pass(s.due);
    stop();
    fakeTap(hub.deps, 'start', 'O1-L1');
    fakeTap(hub.deps, 'done', 'O1-L1');
    const undo = draftOf({ stream_type: 'order', stream_id: 'O1', event_type: 'ItemDoneUndone', schema_version: 1, payload: { order_item_id: 'O1-L1' } }, hub.clock.branchNow());
    hub.deps.writer.run((tx) => tx.append([undo]));
    expect(engine().slips[KEY]!.resolved_at).toBeNull();
    stop = startTickLoop(hub.deps, log);
    const m = meter();
    await passes(5);
    expect(m.tx).toBe(0);
    expect(slipAlerts()[0]!.state).toBe('open');

    // Skipped: a late order with no receiver.
    submit({ order_id: 'O2', actor_id: null, order: { table_id: 'T2', table_key: 'dine_in:T2' }, lines: [{ order_item_id: 'L2' }] });
    await pass(hub.clock.branchNow());
    const due = engine().next_alert_due_at!;
    m.reset();
    await pass(due);
    expect(m.tx).toBe(1);
    expect(hostFlags.skipped.has('dine_in:T2')).toBe(true);
    m.reset();
    await passes(10);
    expect(m.tx).toBe(0);
    // A commit on its order: the key leaves `skipped` and is tried (and skipped) once more.
    fakeTap(hub.deps, 'start', 'L2');
    expect(hostFlags.skipped.has('dine_in:T2')).toBe(false);
    await passes(10);
    expect(m.tx).toBe(1);
    expect(skipLogs().filter((l) => l.table_key === 'dine_in:T2')).toHaveLength(2);
    expect(hostFlags.skipped.has('dine_in:T2')).toBe(true);
  });

  // --------------------------------------------------------------------------------------------------------- #113
  it('[03a #113] a dine_in table with no owner goes to placed_by; after a close with a carried late order the old alert is closed obsolete and a new one raised (close first)', async () => {
    kitchen(config({ S1: { capacity: 8 } }));
    const s = await lateSlip({ order_id: 'O1' });
    await pass(s.due);
    const [old] = slipAlerts();
    expect(old!.receiver).toBe(WAITER);
    clean();
    append([aBusinessDayClosed()]);
    expect(engine().orders.O1).toBeDefined(); // carried over the close, still late
    expect(engine().slips[KEY]).toBeUndefined();
    hub.published.length = 0;
    await pass(hub.clock.branchNow() + TICK_MS);
    const rows = slipAlerts();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ alert_id: old!.alert_id, state: 'closed', close_reason: 'obsolete' });
    expect(rows[1]).toMatchObject({ state: 'open', dedupe_key: `slip:${KEY}` });
    const types = hub.published.flat().map((e) => e.event_type);
    expect(types.indexOf('AlertClosed')).toBeLessThan(types.indexOf('AlertRaised'));
    expect(eventsOf('SlipWarned').map((e) => (e.payload as { alert_id: string }).alert_id)).toEqual([rows[1]!.alert_id]);
    expect(engine().slips[KEY]!.alert_id).toBe(rows[1]!.alert_id);
  });

  it('[03a #113] a deduped raise writes no SlipWarned (and the key is not retried every pass)', async () => {
    kitchen(config({ S1: { capacity: 8 } }));
    submit({ order_id: 'O1', lines: [{ order_item_id: 'O1-L1' }] });
    // An open slip_warning on the key the state does not know of.
    hub.deps.writer.run((tx) =>
      tx.append(
        alerts.raise(alerts.tickCtx(tx, hub.clock.branchNow()), {
          kind: ENGINE_ALERT_KINDS.slip,
          subject: { stream_type: 'order', stream_id: 'O1' },
          target: { kind: 'person', staff_id: WAITER },
          values: { table_key: KEY, order_ids: ['O1'], escalate_ms: 120_000 },
          display: { kind_label_key: 'alert.slip_warning.lock' },
          details: { minutes_late: 0, lines: [] }, // the real kind requires its details (task 23)
          dedupe_key: `slip:${KEY}`,
          request: { receiver_staff_id: WAITER },
        }).events,
      ),
    );
    clean();
    await pass(hub.clock.branchNow());
    const due = engine().next_alert_due_at!;
    const m = meter();
    await pass(due);
    expect(m.tx).toBe(1);
    expect(slipAlerts()).toHaveLength(1);
    expect(eventsOf('SlipWarned')).toEqual([]);
    expect(engine().slips[KEY]).toBeUndefined();
    m.reset();
    await passes(10);
    expect(m.tx).toBe(0);
  });

  it('[03a #113] an EngineConfigApplied lowering slip_threshold_ms moves next_alert_due_at, and the slip is raised at the new time; a carry is in the estimate', async () => {
    kitchen(config({ S1: { capacity: 8 } }));
    // A COOKING line with a carry of 2 min: estimate = started + prep + cook + carry (§3.8).
    const now = hub.clock.branchNow();
    append(
      anOrderBatch({
        order_id: 'O1',
        recorded_at: now,
        actor_id: WAITER,
        order: { groups: [{ group_id: 'O1:0', target_land_ms: now + 20 * MIN, promise_ms: now + 23 * MIN, order_item_ids: ['L1'] }] },
        lines: [{ order_item_id: 'L1', line: { carry_ms: 2 * MIN } }],
      }),
    );
    await pass(hub.clock.branchNow());
    fakeTap(hub.deps, 'start', 'L1');
    const started = engine().lines.L1!.started_at!;
    const estimate = started + 20 * MIN + 2 * MIN;
    const target = engine().orders.O1!.groups['O1:0']!.target_land_ms;
    // With the default 2-minute threshold it is not late enough; with 30 s it is.
    expect(estimate - target).toBeLessThanOrEqual(120_000);
    expect(engine().next_alert_due_at).toBeNull();
    append([anEngineConfigApplied({ payload: config({ S1: { capacity: 8 } }, { slip_threshold_ms: 30_000 }) as unknown as Record<string, unknown> })]);
    const due = engine().next_alert_due_at;
    expect(due).not.toBeNull();
    expect(getAlertIntents(engine(), due!).slips).toHaveLength(1);
    await pass(Math.max(due!, hub.clock.branchNow()));
    const warned = eventsOf('SlipWarned');
    expect(warned).toHaveLength(1);
    expect((warned[0]!.payload as { estimated_land_ms: number }).estimated_land_ms).toBe(estimate);
  });

  // ------------------------------------------------------------------------------------------------------ BF-4 hub
  it('[03a BF-4 hub] when every order of a key is abandoned, its open slip alert is closed done', async () => {
    kitchen(config({ S1: { capacity: 8 } }));
    const s = await lateSlip({ order_id: 'O1' });
    await pass(s.due);
    const [row] = slipAlerts();
    const abandonAt = engine().orders.O1!.last_line_fold_at + 14_400_000;
    expect(engine().slip_due[KEY]).toBe(abandonAt);
    await pass(abandonAt - TICK_MS);
    expect(slipAlerts()[0]!.state).toBe('open');
    await pass(abandonAt);
    expect(slipAlerts()[0]).toMatchObject({ alert_id: row!.alert_id, state: 'closed', close_reason: 'done' });
    expect(engine().slips[KEY]).toBeUndefined();
  });

  it('[03a §6.2a] due on the read-only view runs no statement', () => {
    kitchen();
    const counter = statementCounter(hub.deps.db);
    expect(firesAlertsTick.due(readOnlyDb(hub.deps.db), engine(), hub.clock.branchNow() + HOUR)).toBe(false);
    expect(counter.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------- AD-8 across a restart
function writeConfig(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-engine-fires-alerts-'));
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
      provisioned: { tenant_id: 'tenant-a', branch_id: 'branch-1', branch_name: 'Main', branch_api_key: 'test-branch-api-key', confirmed_at: 1 },
    }),
  );
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const dataDirOf = (path: string): string => (JSON.parse(readFileSync(path, 'utf8')) as { data_dir: string }).data_dir;
const quiet = (): Writable => new Writable({ write: (_chunk, _enc, done) => done() });

describe('[03a AD-8] a dropped line is never silent across a restart (review I1)', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetHostFlags();
  });

  it('[03a AD-8] a drop committed just before a crash is raised by the reconcile pass after boot; a drop whose alert is still open dedupes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const W = 1_762_000_000_000;
    const bootAt = (wall: number): Promise<BootHandle> =>
      boot({ configPath: cfg.path, wallNow: () => wall, monoNow: () => 0, ifaces: ['192.168.10.2'], configClient: stubConfigCloud(), logStream: quiet() });
    const rows = (h: BootHandle): Array<{ dedupe_key: string; state: string }> =>
      h.deps.db.prepare(`SELECT dedupe_key, state FROM alerts WHERE kind = ? ORDER BY raised_seq`).all(ENGINE_ALERT_KINDS.lineDropped) as Array<{ dedupe_key: string; state: string }>;
    const write = (h: BootHandle, events: readonly PosEvent[]): void => {
      h.deps.writer.run((tx) => tx.append(events.map((e) => draftOf(e, h.deps.clock.branchNow()))));
    };

    const h1 = await bootAt(W);
    let stopped = false;
    cleanups.push(async () => {
      if (!stopped) await h1.stop();
    });
    write(h1, [anEngineConfigApplied(), aBusinessDayOpened()]);
    // Drop 1: its alert is raised (the first pass after boot is the reconcile pass) and stays open.
    write(h1, anOrderBatch({ order_id: 'O1', lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2', line: { station_id: 'S9' } }] }));
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(rows(h1)).toEqual([{ dedupe_key: 'engine_line_dropped:L2', state: 'open' }]);
    // Drop 2, then the crash: no pass runs, and no SIGTERM snapshot (deleted, as a crash writes none).
    write(h1, anOrderBatch({ order_id: 'O2', order: { table_id: 'T2', table_key: 'dine_in:T2' }, lines: [{ order_item_id: 'L3', line: { station_id: 'S9' } }] }));
    expect(hostFlags.dropped_lines).toHaveLength(1);
    await h1.stop();
    stopped = true;
    // A crash writes no SIGTERM snapshot: remove the one stop wrote, so boot replays both drops.
    const file = new Database(join(dataDirOf(cfg.path), 'hub.sqlite'));
    file.prepare('DELETE FROM engine_snapshots').run();
    file.close();
    const h3 = await bootAt(W + MIN);
    cleanups.push(() => h3.stop());
    expect(hostFlags.reconcile).toBe(true);
    expect(hostFlags.dropped_lines.map((f) => f.order_item_id).sort()).toEqual(['L2', 'L3']);
    const counter = statementCounter(h3.deps.db);
    let reads = -1;
    const real = firesAlertsTick.intents.bind(firesAlertsTick);
    vi.spyOn(firesAlertsTick, 'intents').mockImplementation((tx, state, now) => {
      const before = counter.count;
      const out = real(tx, state, now);
      reads = counter.count - before;
      return out;
    });
    await vi.advanceTimersByTimeAsync(TICK_MS);
    // L3's alert is raised; L2's alert is still open, so its re-queued fact dedupes (no second alert).
    expect(rows(h3)).toEqual([
      { dedupe_key: 'engine_line_dropped:L2', state: 'open' },
      { dedupe_key: 'engine_line_dropped:L3', state: 'open' },
    ]);
    expect(hostFlags.dropped_lines).toEqual([]);
    expect(hostFlags.reconcile).toBe(false);
    // The reconcile pass with two re-queued drops: 2 listOpen + raiseMany's dedupe 1 + fixed reads 5.
    expect(reads).toBe(2 + 6);
  });

  async function bootPair(): Promise<{ bootAt: (wall: number) => Promise<BootHandle>; path: string }> {
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    return {
      path: cfg.path,
      bootAt: (wall: number) => boot({ configPath: cfg.path, wallNow: () => wall, monoNow: () => 0, ifaces: ['192.168.10.2'], configClient: stubConfigCloud(), logStream: quiet() }),
    };
  }
  const droppedRows = (h: BootHandle): Array<{ dedupe_key: string; state: string }> =>
    h.deps.db.prepare(`SELECT dedupe_key, state FROM alerts WHERE kind = ? ORDER BY raised_seq`).all(ENGINE_ALERT_KINDS.lineDropped) as Array<{ dedupe_key: string; state: string }>;
  const writeTo = (h: BootHandle, events: readonly PosEvent[]): void => {
    h.deps.writer.run((tx) => tx.append(events.map((e) => draftOf(e, h.deps.clock.branchNow()))));
  };

  it('[03a AD-8] a graceful stop (SIGTERM) raises a queued drop before its snapshot, so the next boot has the alert', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { bootAt } = await bootPair();
    const W = 1_762_000_000_000;
    const h1 = await bootAt(W);
    let stopped = false;
    cleanups.push(async () => {
      if (!stopped) await h1.stop();
    });
    writeTo(h1, [anEngineConfigApplied(), aBusinessDayOpened()]);
    await vi.advanceTimersByTimeAsync(TICK_MS); // the reconcile pass, before the drop
    writeTo(h1, anOrderBatch({ order_id: 'O1', lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2', line: { station_id: 'S9' } }] }));
    expect(hostFlags.dropped_lines).toHaveLength(1);
    expect(droppedRows(h1)).toEqual([]);
    const counter = statementCounter(h1.deps.db);
    let reads = -1;
    const real = firesAlertsTick.intents.bind(firesAlertsTick);
    vi.spyOn(firesAlertsTick, 'intents').mockImplementation((tx, state, now) => {
      const before = counter.count;
      const out = real(tx, state, now);
      reads = counter.count - before;
      return out;
    });
    let code = -1;
    await onSigterm(h1, (c) => {
      code = c;
    });
    stopped = true;
    expect(code).toBe(0);
    expect(reads).toBe(2 + 6); // the flush pass: 2 listOpen + raiseMany's 6 (plus its appends)
    vi.restoreAllMocks();

    const h2 = await bootAt(W + MIN);
    cleanups.push(() => h2.stop());
    expect(droppedRows(h2)).toEqual([{ dedupe_key: 'engine_line_dropped:L2', state: 'open' }]);
    // The snapshot was taken after the flush: the boot replays past the drop, nothing is re-queued.
    expect(hostFlags.dropped_lines).toEqual([]);
  });

  it('[03a AD-8] an empty queue at SIGTERM costs no statement before the snapshot', async () => {
    const { bootAt } = await bootPair();
    const h1 = await bootAt(1_762_000_000_000);
    expect(hostFlags.dropped_lines).toEqual([]);
    const intents = vi.spyOn(firesAlertsTick, 'intents');
    const due = vi.spyOn(firesAlertsTick, 'due');
    await onSigterm(h1, () => undefined);
    expect(due).not.toHaveBeenCalled();
    expect(intents).not.toHaveBeenCalled();
  });

  it('[03a AD-8] a drop whose id is re-added later is still raised after a crash (state-free rule)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { bootAt, path } = await bootPair();
    const W = 1_762_000_000_000;
    const h1 = await bootAt(W);
    let stopped = false;
    cleanups.push(async () => {
      if (!stopped) await h1.stop();
    });
    writeTo(h1, [anEngineConfigApplied(), aBusinessDayOpened()]);
    writeTo(h1, anOrderBatch({ order_id: 'O1', lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2', line: { station_id: 'S9' } }] }));
    // The same id re-added by a later, valid order: L2 is a live line again.
    writeTo(h1, anOrderBatch({ order_id: 'O2', order: { table_id: 'T2', table_key: 'dine_in:T2' }, lines: [{ order_item_id: 'L2' }] }));
    expect((h1.deps.state.get() as EngineState).lines.L2).toBeDefined();
    // Crash: no pass ran and no SIGTERM snapshot exists.
    await h1.stop();
    stopped = true;
    const file = new Database(join(dataDirOf(path), 'hub.sqlite'));
    file.prepare('DELETE FROM engine_snapshots').run();
    file.close();
    const h2 = await bootAt(W + MIN);
    cleanups.push(() => h2.stop());
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(droppedRows(h2)).toEqual([{ dedupe_key: 'engine_line_dropped:L2', state: 'open' }]);
  });
});
