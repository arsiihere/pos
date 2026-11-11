// 03a task 23: the kinds 03a registers (§6.4): slip_warning (§3.8: receiver, escalation, apply on accept / decline,
// details), station_overload (§3.10), engine_line_dropped (AD-8); 01d v1.1.2 D-1 / D-2 (widened details, AlertRaised
// v2); tests #65, #67, #72, #77 hub.
import { performance } from 'node:perf_hooks';
import { getAlertIntents, type EngineState } from '@pos/engine';
import type { BranchConfig, EngineConfig, EventDraft, PosEvent } from '@pos/events';
import { aBranchConfig, aBusinessDayOpened, anEngineConfigApplied } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kindOf } from '../../src/alerts/kinds';
import { registeredTicks, startTickLoop, TICK_MS } from '../../src/alerts/tick';
import { unregisterTick } from '../../src/alerts/tick';
import { lockOnlyView, signedInView, type ViewRow } from '../../src/alerts/ws-frames';
import type { CommandCtx } from '../../src/commands/registry';
import { registerEngineBootSteps } from '../../src/engine-host/boot-steps';
import { bindFiresAlertsTick, firesAlertsTick } from '../../src/engine-host/fires-alerts-tick';
import { hostFlags, resetHostFlags } from '../../src/engine-host/host-flags';
import { ENGINE_ALERT_KINDS, readLineFacts, SLIP_WARNING, SlipWarningDetails, slipDetails } from '../../src/engine-host/kinds';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { resetSlipReaders } from '../../src/engine-host/slip-readers';
import type { WriterTx } from '../../src/engine-host/writer';
import { currentConfigEntry, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { registerRestaurantBootSteps } from '../../src/sync/boot-steps';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { draftOf, fakeSubmit, fakeTap, type FakeOrder } from './fakes';

registerEngineBootSteps(() => performance.now());
registerRestaurantBootSteps();

const MIN = 60_000;
const KEY = 'dine_in:T12';
const WAITER = 'S_WAIT';
const CASH = 'S_CASH';
const TENANT = 'tenant-a';
const BRANCH = 'branch-1';

type StationOver = Partial<EngineConfig['stations'][number]>;
function config(stations: Record<string, StationOver> = { S1: { capacity: 8 } }, settings: Partial<EngineConfig['settings']> = {}): EngineConfig {
  const base = anEngineConfigApplied().payload as unknown as EngineConfig;
  const s1 = base.stations[0]!;
  return {
    ...base,
    stations: Object.entries(stations).map(([station_id, o]) => ({ ...s1, station_id, name: station_id, ...o })),
    settings: { ...base.settings, ...settings },
  };
}
const HOT: StationOver = { capacity: 1, pressure_amber_bp: 1_000, pressure_red_bp: 2_000, pressure_alert_ms: MIN };

interface AlertRow {
  alert_id: string;
  state: 'open' | 'closed';
  close_reason: string | null;
  dedupe_key: string;
  family: string;
  subject_stream_type: string;
  subject_stream_id: string;
  raised_device_id: string;
  requester_staff_id: string | null;
  values: Record<string, unknown>;
  target: Record<string, unknown>;
  details: Record<string, unknown> | null;
  receiver: string | null;
}

describe('03a task 23: the engine alert kinds', () => {
  let hub: TestHub;
  let stop: () => void = () => undefined;
  const log = { error: vi.fn<(obj: Record<string, unknown>, msg?: string) => void>() };
  let savedConfig: ReturnType<typeof currentConfigEntry> = null;
  const clients: WsClient[] = [];

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    hub = await createTestHub();
    resetSlipReaders(); // SG-6: registerTables registered 02a's pair; these tests rely on the §4.4 stub or register fakes
    unregisterTick('table_locks'); // 02a §3.4: registerTables adds it to every test hub; this file counts the ticks
    for (const name of ['pass_closures', 'ready_retarget', 'served_estimate']) unregisterTick(name); // 03b §6.18–6.19 (b16), 02b §6.11 (0e): lane B5 adds these to every test hub too
    // 03b §6.20 (b20): registerKds adds kds_presence to every test hub too; this file counts the ticks
    unregisterTick('kds_presence');
    await seedDirectory(hub);
    clean();
    log.error.mockClear();
    savedConfig = currentConfigEntry();
    stop = startTickLoop(hub.deps, log);
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    stop();
    stop = () => undefined;
    swapBranchConfig(savedConfig);
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetHostFlags();
    resetSlipReaders();
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
  function clean(): void {
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
  }
  function kitchen(c: EngineConfig = config()): void {
    append([anEngineConfigApplied({ payload: c as unknown as Record<string, unknown> }), aBusinessDayOpened()]);
    clean();
  }
  const submit = (o: FakeOrder): PosEvent[] => fakeSubmit(hub.deps, { actor_id: WAITER, ...o });
  function stored(type: string): Array<PosEvent & { schema_version: number }> {
    return (hub.deps.db.prepare('SELECT * FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<Record<string, unknown>>).map(
      (row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent & { schema_version: number },
    );
  }
  function alertRows(kind: string): AlertRow[] {
    const rows = hub.deps.db
      .prepare(
        `SELECT alert_id, state, close_reason, dedupe_key, family, subject_stream_type, subject_stream_id, raised_device_id,
                requester_staff_id, values_json, target_json, details_json, json_extract(request_json, '$.receiver_staff_id') AS receiver
         FROM alerts WHERE kind = ? ORDER BY raised_seq`,
      )
      .all(kind) as Array<Omit<AlertRow, 'values' | 'target' | 'details'> & { values_json: string; target_json: string; details_json: string | null }>;
    return rows.map(({ values_json, target_json, details_json, ...r }) => ({
      ...r,
      values: JSON.parse(values_json) as Record<string, unknown>,
      target: JSON.parse(target_json) as Record<string, unknown>,
      details: details_json === null ? null : (JSON.parse(details_json) as Record<string, unknown>),
    }));
  }
  const slipAlerts = (): AlertRow[] => alertRows(ENGINE_ALERT_KINDS.slip);
  const overloadAlerts = (): AlertRow[] => alertRows(ENGINE_ALERT_KINDS.overload);

  // Counts fires_alerts' transactions and the statements of its intents apart from its own appends.
  function meter(): { readonly tx: number; readonly reads: number[]; reset(): void } {
    const counter = statementCounter(hub.deps.db);
    let tx = 0;
    let reads: number[] = [];
    const realIntents = firesAlertsTick.intents.bind(firesAlertsTick);
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
      get reads() {
        return reads;
      },
      reset() {
        tx = 0;
        reads = [];
        counter.reset();
      },
    };
  }

  // A late order: its lines are fired and never started, so the estimate passes T + slip_threshold_ms; raised.
  async function raisedSlip(o: Partial<FakeOrder> = {}): Promise<{ order_id: string; row: AlertRow }> {
    const order_id = o.order_id ?? 'O1';
    submit({ order_id, lines: o.lines ?? [{ order_item_id: `${order_id}-L1` }], ...o });
    await pass(hub.clock.branchNow());
    const due = engine().next_alert_due_at;
    expect(due).not.toBeNull();
    await pass(due!);
    const row = slipAlerts().find((r) => (r.values.order_ids as string[]).includes(order_id));
    expect(row).toBeDefined();
    return { order_id, row: row! };
  }

  // A signed-in seat of `staffId` (paired tablet + staff session), opened now so its idle TTL is fresh.
  function seat(staffId: string): { deviceId: string; deviceToken: string; sessionToken: string } {
    const device = pairDevice(hub, { type: 'tablet', name: staffId });
    const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
    return { deviceId: device.deviceId, deviceToken: device.token, sessionToken: session.token };
  }
  let commandNo = 0;
  async function answer(staffId: string, alert_id: string, decision: 'accept' | 'decline'): Promise<{ status: number; body: Record<string, unknown> }> {
    const s = seat(staffId);
    commandNo += 1;
    const res = await hub.app.inject({
      method: 'POST',
      url: '/commands/answer-request',
      headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
      payload: {
        command_id: `cmd-23-${commandNo}`,
        tenant_id: TENANT,
        branch_id: BRANCH,
        command_type: 'AnswerRequest',
        payload: { alert_id, decision, method: 'session' },
        occurred_at: hub.clock.branchNow(),
        actor_id: staffId,
        device_id: s.deviceId,
      },
    });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }
  const released = (): Array<Record<string, unknown>> => stored('ItemsReleased').map((e) => e.payload as Record<string, unknown>);

  // ------------------------------------------------------------------------------------------------ registration
  it('[03a §6.4] the three kinds are registered at module load with the §3.8 / §3.10 / AD-8 definitions', () => {
    expect(registeredTicks().map((t) => t.name)).toEqual(['alerts', 'fires', 'fires_alerts']);
    const slip = kindOf(ENGINE_ALERT_KINDS.slip)!;
    expect(slip).toBe(SLIP_WARNING);
    expect(slip).toMatchObject({
      family: 'action',
      subject: 'order',
      closes_on: 'owner',
      lead_fallback: false,
      expires_at_day_close: true,
      silent: false,
      labels: { card: 'alert.slip_warning.card', lock: 'alert.slip_warning.lock' },
    });
    expect(slip.request).toMatchObject({ answers: ['accept', 'decline'], right: { mode: 'named' }, needs_pin: 'never' });
    expect(slip.request!.onWithdraw).toBeUndefined();
    expect(slip.steps).toEqual([
      { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'answerer' }] },
      { at: { value: 'escalate_ms', times: 1 }, escalation: true, to: [{ target: 'raised_target', set: 'answerer' }, { target: { kind: 'managers' }, set: 'informed' }] },
    ]);
    expect(Object.keys(slip.values_schema.shape).sort()).toEqual(['escalate_ms', 'order_ids', 'table_key']);
    // details_schema picks and requires minutes_late and lines (01d v1.1.2 D-1)
    const line = { name: 'Mutton Karahi', quantity: 1, state: 'added' };
    expect(slip.details_schema!.safeParse({ minutes_late: 3, lines: [line] }).success).toBe(true);
    expect(slip.details_schema!.safeParse({ lines: [line] }).success).toBe(false);
    expect(slip.details_schema!.safeParse({ minutes_late: 3 }).success).toBe(false);
    expect(slip.details_schema!.parse({ minutes_late: 3, lines: [line], amount: 100 })).toEqual({ minutes_late: 3, lines: [line] });

    expect(kindOf(ENGINE_ALERT_KINDS.overload)).toMatchObject({
      family: 'info',
      subject: 'station',
      steps: [{ at: { ms: 0 }, to: [{ target: { kind: 'managers' }, set: 'recipient' }] }],
      closes_on: 'owner',
      lead_fallback: false,
      expires_at_day_close: true,
      details_schema: null,
      request: null,
    });
    expect(Object.keys(kindOf(ENGINE_ALERT_KINDS.overload)!.values_schema.shape).sort()).toEqual(['pressure_bp', 'station_id', 'waiting']);
    expect(kindOf(ENGINE_ALERT_KINDS.lineDropped)).toMatchObject({
      family: 'info',
      subject: 'order',
      steps: [{ at: { ms: 0 }, to: [{ target: { kind: 'managers' }, set: 'recipient' }] }],
      details_schema: null,
      request: null,
      lead_fallback: false,
    });
    expect(Object.keys(kindOf(ENGINE_ALERT_KINDS.lineDropped)!.values_schema.shape).sort()).toEqual(['order_id', 'order_item_id', 'reason']);
  });

  // ----------------------------------------------------------------------------------------------- §6.2a gap 4
  it('[03a §6.2a gap 4] EXPLAIN QUERY PLAN of the line-facts read uses the events_stream index', () => {
    kitchen();
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2', item: { name: 'Naan', quantity: 3 } }] });
    submit({ order_id: 'O2', order: { table_id: 'T2', table_key: 'dine_in:T2' }, lines: [{ order_item_id: 'L3' }] });
    // The statement readLineFacts really runs (AD-37 (1)): recorded from db.prepare, not copied into the test.
    const db = hub.deps.db;
    const prepare = db.prepare;
    const seen: string[] = [];
    db.prepare = ((sql: string) => {
      seen.push(sql);
      return prepare.call(db, sql);
    }) as typeof db.prepare;
    let facts: ReturnType<typeof readLineFacts>;
    try {
      facts = readLineFacts(db, engine(), ['O1', 'O2']);
    } finally {
      db.prepare = prepare;
    }
    expect(seen).toHaveLength(1);
    expect([...facts.keys()].sort()).toEqual(['L1', 'L2', 'L3']);
    const sql = seen[0]!;
    const flat = sql.replace(/\s+/g, ' ').trim(); // a reformat of the SQL does not break the matches
    expect(flat).toMatch(/stream_type = 'order' AND event_type = 'ItemAdded' AND stream_id IN/);
    expect(flat).not.toMatch(/branch_id/); // AD-37 (8): no branch_id predicate
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(JSON.stringify(['O1', 'O2'])) as Array<{ detail: string }>).map((r) => r.detail).join('\n');
    expect(plan).toMatch(/SEARCH events USING INDEX events_stream \(stream_type=\? AND stream_id=\?\)/);
    expect(plan).not.toMatch(/SCAN events/);
  });

  // ---------------------------------------------------------------------------------------------------------- #65
  // 03a v1.2 (Q-1): #65's dine_in receiver clause is replaced by #120 (the holder of the oldest order through
  // registerSlipReaders, fires-alerts-tick.int.test.ts); here the readers are stubbed (§4.4), so placed_by.
  it('[03a #65] with the slip readers stubbed a dine_in slip is raised to the order\'s placed_by (§4.4), tick-raised, AlertRaised v2 with the §3.8 details; 2 + 1 + 6 statements', async () => {
    kitchen();
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2', item: { name: 'Naan', quantity: 3 } }] });
    await pass(hub.clock.branchNow());
    const due = engine().next_alert_due_at!;
    const m = meter();
    await pass(due);
    expect(m.tx).toBe(1);
    // 2 listOpen + 0 readers (stubbed, §4.4) + 1 ItemAdded read for the details + raiseMany's 6
    expect(m.reads).toEqual([2 + 1 + 6]);
    const [row] = slipAlerts();
    expect(row).toMatchObject({
      state: 'open',
      family: 'action',
      dedupe_key: `slip:${KEY}`,
      subject_stream_type: 'order',
      subject_stream_id: 'O1',
      raised_device_id: 'hub',
      requester_staff_id: null,
      receiver: WAITER,
      target: { kind: 'person', staff_id: WAITER },
    });
    expect(row!.values).toEqual({ table_key: KEY, order_ids: ['O1'], escalate_ms: engine().config!.settings.slip_escalate_ms });
    // AD-37 (3), owner ruling: minutes against the engine target T. With the defaults (slip_threshold_ms 120 000,
    // padding 180 000) the first card is just past T + 2 min, so it reads 3 (never 0: the promise is not yet blown).
    const warned = stored('SlipWarned')[0]!.payload as { estimated_land_ms: number; target_land_ms: number };
    const minutes = Math.ceil((warned.estimated_land_ms - warned.target_land_ms) / MIN);
    expect(engine().config!.settings.slip_threshold_ms).toBe(120_000);
    expect(minutes).toBe(3);
    expect(row!.details).toEqual({
      minutes_late: minutes,
      lines: [
        { name: 'Mutton Karahi', quantity: 1, state: 'added' },
        { name: 'Naan', quantity: 3, state: 'added' },
      ],
    });
    const raised = stored('AlertRaised').filter((e) => (e.payload as { kind: string }).kind === ENGINE_ALERT_KINDS.slip);
    expect(raised).toHaveLength(1);
    expect(raised[0]!.schema_version).toBe(3); // 01d v1.2.2 D-2 (03b): AlertRaised v3
    expect((raised[0]!.payload as { details: unknown }).details).toEqual(row!.details);
    expect((raised[0]!.payload as { request: unknown }).request).toMatchObject({ right_mode: 'named', receiver_staff_id: WAITER, needs_pin: 'never', answers: ['accept', 'decline'] });
  });

  it('[03a §3.8, AD-37 (3)] minutes_late = ceil((estimate − target) / 1 min), never below 0, whatever the promise', () => {
    const T = 1_000_000;
    const at = (late_ms: number, promise = T + 3 * MIN): number => {
      const slip = { order_ids: [], estimate: T + late_ms, target: T, promise }; // the intent carries the promise too
      return slipDetails(engine(), slip, new Map()).minutes_late;
    };
    expect(at(7.5 * MIN)).toBe(8);
    expect(at(7.5 * MIN, T + 10 * MIN)).toBe(8); // the promise does not count
    expect(at(2 * MIN + 1)).toBe(3);
    expect(at(-MIN)).toBe(0);
  });

  it('[03a #65] the card quantity is the line\'s engine units: a partial void shows what is left, a g / ml line shows 1', async () => {
    kitchen();
    submit({
      order_id: 'O1',
      lines: [
        { order_item_id: 'L1', item: { quantity: 3 } },
        { order_item_id: 'L2', item: { name: 'Mutton (500 g)', sale_unit: 'g', quantity: 500 } },
      ],
    });
    // BF-12: 04 voids 1 of the 3 units (a partial void; the line stays with 2 units)
    hub.deps.writer.run((tx) =>
      tx.append([{ stream_type: 'order', stream_id: 'O1', event_type: 'ItemVoided', schema_version: 1, payload: { order_item_id: 'L1', units: 1 }, occurred_at: hub.clock.branchNow(), actor_id: null, device_id: 'hub' }]),
    );
    expect(engine().lines.L1!.units).toBe(2);
    await pass(hub.clock.branchNow());
    await pass(engine().next_alert_due_at!);
    const [row] = slipAlerts();
    expect((row!.details as { lines: unknown }).lines).toEqual([
      { name: 'Mutton Karahi', quantity: 2, state: 'added' },
      { name: 'Mutton (500 g)', quantity: 1, state: 'added' },
    ]);
  });

  it('[03a #65] takeaway, delivery and parking slips go to the order\'s placed_by; placed_by = null (readers stubbed) is skipped and logged', async () => {
    kitchen();
    const types = [
      ['O_T', 'takeaway', 'S_CASH'],
      ['O_D', 'delivery', 'S_MGR'],
      ['O_P', 'parking', 'S_OWNER'],
    ] as const;
    for (const [order_id, order_type, staff] of types) {
      submit({ order_id, actor_id: staff, order: { order_type, table_id: null, table_key: `${order_type}:${order_id}` }, lines: [{ order_item_id: `${order_id}-L1` }] });
    }
    submit({ order_id: 'O_N', actor_id: null, order: { table_id: 'T9', table_key: 'dine_in:T9' }, lines: [{ order_item_id: 'O_N-L1' }] });
    await pass(hub.clock.branchNow());
    await pass(engine().next_alert_due_at!);
    const rows = slipAlerts();
    expect(rows.map((r) => [r.dedupe_key, r.receiver, r.target]).sort()).toEqual(
      types.map(([order_id, order_type, staff]) => [`slip:${order_type}:${order_id}`, staff, { kind: 'person', staff_id: staff }]).sort(),
    );
    const skips = hub
      .logs()
      .split('\n')
      .filter((l) => l.includes('"tick":"fires_alerts"'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(skips.map((s) => [s.kind, s.table_key, s.reason])).toEqual([[ENGINE_ALERT_KINDS.slip, 'dine_in:T9', 'no_receiver']]);
  });

  it('[03a #65] step 1 escalates at escalate_ms: the receiver stays the answerer and the managers are informed', async () => {
    kitchen(config({ S1: { capacity: 8 } }, { slip_escalate_ms: 2 * MIN }));
    const { row } = await raisedSlip();
    const raisedAt = (hub.deps.db.prepare('SELECT raised_at FROM alerts WHERE alert_id = ?').get(row.alert_id) as { raised_at: number }).raised_at;
    hub.clock.set(raisedAt + 2 * MIN - 2 * TICK_MS);
    await pass();
    expect(stored('EscalationStepped')).toEqual([]);
    await pass(raisedAt + 2 * MIN + TICK_MS);
    const esc = stored('EscalationStepped');
    expect(esc).toHaveLength(1);
    const p = esc[0]!.payload as { alert_id: string; step: number; recipients: Array<{ staff_id: string | null; set: string }> };
    expect(p).toMatchObject({ alert_id: row.alert_id, step: 1 });
    expect(p.recipients).toContainEqual(expect.objectContaining({ staff_id: WAITER, set: 'answerer' }));
    const informed = p.recipients.filter((r) => r.set === 'informed').map((r) => r.staff_id).sort();
    expect(informed).toEqual(['S_MGR', 'S_OWNER']); // branch-scope force-release-table-lock holders (01d Q1)
  });

  it('[03a #65] accept → one ItemsReleased per order with work, carrying the alert_id: released = done sync lines, expedite = goes-with pre-ticks', async () => {
    kitchen();
    // D12 link: what is released (category C_MAIN) takes the bread (C_BREAD) with it; nothing else.
    const cfg: BranchConfig = { ...aBranchConfig(), goes_with: [{ source_kind: 'category', source_id: 'C_MAIN', target_kind: 'category', target_id: 'C_BREAD', excluded: false }] };
    swapBranchConfig({ config: cfg, snapshotHash: 'h', configVersion: 1, snapshotSchemaVersion: 3, appliedAt: 0 });
    const { row } = await raisedSlip({
      lines: [
        { order_item_id: 'L1', item: { category_id: 'C_MAIN' } },
        { order_item_id: 'L2', item: { category_id: 'C_BREAD', name: 'Naan' } },
        { order_item_id: 'L3', item: { category_id: 'C_SALAD', name: 'Raita' } },
      ],
    });
    fakeTap(hub.deps, 'start', 'L1');
    fakeTap(hub.deps, 'done', 'L1');
    const res = await answer(WAITER, row.alert_id, 'accept');
    expect(res.status).toBe(200);
    expect(released()).toEqual([{ order_id: 'O1', alert_id: row.alert_id, released: ['L1'], expedite: ['L2'] }]);
    const ev = stored('ItemsReleased')[0]!;
    expect(ev).toMatchObject({ stream_type: 'order', stream_id: 'O1', actor_id: WAITER });
    // the fold: L1 leaves its group, L2 is expedited, L3 stays sync
    expect(engine().lines.L2!).toMatchObject({ serve_mode: 'immediate', expedited: true });
    expect(engine().lines.L3!.serve_mode).toBe('sync');
    // 01d closes an answered request on RequestAnswered (no AlertClosed); the engine folds AlertClosed only (§3.12)
    expect(slipAlerts()[0]).toMatchObject({ state: 'closed', close_reason: 'answered' });
    expect(stored('AlertClosed').filter((e) => (e.payload as { alert_id: string }).alert_id === row.alert_id)).toEqual([]);
  });

  it('[03a #65] decline → nothing written but the answer; non-receiver → 403 not_receiver', async () => {
    kitchen();
    const { row } = await raisedSlip();
    fakeTap(hub.deps, 'start', 'O1-L1');
    fakeTap(hub.deps, 'done', 'O1-L1');
    const other = await answer(CASH, row.alert_id, 'accept');
    expect(other.status).toBe(403);
    expect(other.body).toMatchObject({ error: { code: 'PERMISSION_DENIED', details: { reason: 'not_receiver' } } });
    expect(slipAlerts()[0]!.state).toBe('open');
    const seq = hub.deps.writer.lastSeq();
    const res = await answer(WAITER, row.alert_id, 'decline');
    expect(res.status).toBe(200);
    expect(released()).toEqual([]);
    const types = (hub.deps.db.prepare('SELECT event_type FROM events WHERE seq > ? ORDER BY seq').all(seq) as Array<{ event_type: string }>).map((r) => r.event_type);
    expect(types).not.toContain('ItemsReleased');
    expect(types).toContain('RequestAnswered');
    expect(slipAlerts()[0]).toMatchObject({ state: 'closed', close_reason: 'answered' });
  });

  it('[03a #65] apply only reads (writes throw on its view): 0 statements with no goes-with link, 1 with links; decline returns []', async () => {
    kitchen();
    const { row } = await raisedSlip({ lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2' }] });
    fakeTap(hub.deps, 'start', 'L1');
    fakeTap(hub.deps, 'done', 'L1');
    const refuse = (): never => {
      throw new Error('apply must not write');
    };
    const record = {
      alert_id: row.alert_id,
      kind: ENGINE_ALERT_KINDS.slip,
      family: 'action' as const,
      subject: { stream_type: 'order', stream_id: 'O1' },
      dedupe_key: row.dedupe_key,
      requester_staff_id: null,
      receiver_staff_id: WAITER,
      raised_device_id: 'hub',
      values: row.values as { table_key: string; order_ids: string[]; escalate_ms: number },
      display: { kind_label_key: 'alert.slip_warning.lock' },
      details: row.details as SlipWarningDetails,
      step: 0,
      raised_at: 0,
    };
    const ctxOf = (): CommandCtx & { alert: typeof record } =>
      ({
        tx: { db: readOnlyDb(hub.deps.db), state: engine(), clock: hub.clock, ids: { next: refuse }, branchId: BRANCH, append: refuse, onCommit: refuse },
        state: engine(),
        alert: record,
      }) as unknown as CommandCtx & { alert: typeof record };
    const facts = { decision: 'accept' as const, answerer_staff_id: WAITER, method: 'session' as const, device_id: 'D1', answered_at: hub.clock.branchNow() };
    const counter = statementCounter(hub.deps.db);
    const seq = hub.deps.writer.lastSeq();
    const drafts = SLIP_WARNING.request!.apply(ctxOf(), facts);
    expect(counter.count).toBe(0);
    expect(drafts).toEqual([
      {
        stream_type: 'order',
        stream_id: 'O1',
        event_type: 'ItemsReleased',
        schema_version: 1,
        payload: { order_id: 'O1', alert_id: row.alert_id, released: ['L1'], expedite: [] },
        occurred_at: facts.answered_at,
        actor_id: WAITER,
        device_id: 'D1',
      },
    ]);
    swapBranchConfig({ config: { ...aBranchConfig(), goes_with: [{ source_kind: 'category', source_id: 'C1', target_kind: 'category', target_id: 'C1', excluded: false }] }, snapshotHash: 'h', configVersion: 1, snapshotSchemaVersion: 3, appliedAt: 0 });
    counter.reset();
    expect(SLIP_WARNING.request!.apply(ctxOf(), facts).map((d) => d.payload)).toEqual([{ order_id: 'O1', alert_id: row.alert_id, released: ['L1'], expedite: ['L2'] }]);
    expect(counter.count).toBe(1);
    counter.reset();
    expect(SLIP_WARNING.request!.apply(ctxOf(), { ...facts, decision: 'decline' })).toEqual([]);
    expect(counter.count).toBe(0);
    expect(hub.deps.writer.lastSeq()).toBe(seq);
  });

  // ---------------------------------------------------------------------------------------------------------- #72
  it('[03a #72] accept answered after the last line went Done: ItemsReleased with released only; the tick close is a no-op', async () => {
    kitchen();
    const { row } = await raisedSlip({ lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2' }] });
    for (const id of ['L1', 'L2']) {
      fakeTap(hub.deps, 'start', id);
      fakeTap(hub.deps, 'done', id);
    }
    expect(engine().slips[KEY]!.resolved_at).not.toBeNull();
    const res = await answer(WAITER, row.alert_id, 'accept');
    expect(res.status).toBe(200);
    expect(released()).toEqual([{ order_id: 'O1', alert_id: row.alert_id, released: ['L1', 'L2'], expedite: [] }]);
    expect(slipAlerts()[0]).toMatchObject({ state: 'closed', close_reason: 'answered' });
    // The resolved slip still names the alert (RequestAnswered is not an AlertClosed): the tick's done close finds it
    // closed and writes nothing; the key is skipped (22a reading), so the pass is not repeated.
    expect(engine().slips[KEY]).toMatchObject({ alert_id: row.alert_id });
    const closes = (): number => stored('AlertClosed').filter((e) => (e.payload as { alert_id: string }).alert_id === row.alert_id).length;
    clean(); // the answering seat's sign-in marks 01d's no_approver flag dirty
    const seq = hub.deps.writer.lastSeq();
    const m = meter();
    await passes(5);
    expect(m.tx).toBe(1);
    expect(closes()).toBe(0);
    expect(hub.deps.writer.lastSeq()).toBe(seq);
    expect(slipAlerts()[0]).toMatchObject({ state: 'closed', close_reason: 'answered' });
  });

  // ---------------------------------------------------------------------------------------------------------- #123
  // 03a v1.2 Q-2 / AD-37 (2), 02p U-7: dine_in keys are 'dine_in:' + seating_id. An answered slip silences its key for
  // that seating (RequestAnswered is not folded, so slips[key].alert_id stays set); a new party is a new key.
  it('[03a #123] a new seating on the same table gets a fresh slip after S1\'s slip was answered "Wait"; a second late group in S1 raises nothing', async () => {
    kitchen();
    const S1 = 'dine_in:SEAT_S1';
    const S2 = 'dine_in:SEAT_S2';
    const { row } = await raisedSlip({ order_id: 'O1', order: { table_id: 'T4', table_key: S1 } });
    expect(row.dedupe_key).toBe(`slip:${S1}`);
    const res = await answer(WAITER, row.alert_id, 'decline');
    expect(res.status).toBe(200);
    expect(slipAlerts()[0]).toMatchObject({ state: 'closed', close_reason: 'answered' });
    expect(engine().slips[S1]!.alert_id).toBe(row.alert_id);
    clean(); // the answering seat's sign-in marks 01d's no_approver flag dirty

    // A second late group in S1 (a follow-up order of the same party) and a new party S2 seated on T4, both late.
    submit({ order_id: 'O3', order: { table_id: 'T4', table_key: S1 }, lines: [{ order_item_id: 'O3-L1' }] });
    submit({ order_id: 'O2', order: { table_id: 'T4', table_key: S2 }, lines: [{ order_item_id: 'O2-L1' }] });
    await pass(hub.clock.branchNow());
    // S1 is due only at its BF-4 abandon time (no crossing while its answered alert is held), S2 at its crossing.
    const due = engine().next_alert_due_at!;
    expect(due).toBe(engine().slip_due[S2]);
    expect(engine().slip_due[S1]).toBeGreaterThan(due);
    await pass(due);
    const rows = slipAlerts();
    expect(rows.map((r) => [r.dedupe_key, r.state, r.values.order_ids])).toEqual([
      [`slip:${S1}`, 'closed', ['O1']],
      [`slip:${S2}`, 'open', ['O2']],
    ]);
    expect(stored('SlipWarned').map((e) => (e.payload as { table_key: string }).table_key)).toEqual([S1, S2]);
    // O3 crossed with O2 (same submit, same line): nothing for S1, in that pass or later ones.
    expect(getAlertIntents(engine(), hub.clock.branchNow()).slips.map((x) => x.table_key)).toEqual([]);
    await passes(5);
    expect(slipAlerts().filter((r) => r.dedupe_key === `slip:${S1}`)).toHaveLength(1);
    expect(engine().slips[S1]!.alert_id).toBe(row.alert_id);
  });

  // ------------------------------------------------------------------------------------------------------ #77 hub
  it('[03a #77 hub] SlipWarned.alert_id equals the raiseMany id and AlertRaised.values.table_key equals its key', async () => {
    kitchen();
    const { row } = await raisedSlip({ order_id: 'O7', order: { table_id: 'T7', table_key: 'dine_in:T7' } });
    const warned = stored('SlipWarned');
    expect(warned).toHaveLength(1);
    expect(warned[0]!.payload).toMatchObject({ table_key: 'dine_in:T7', order_ids: ['O7'], alert_id: row.alert_id });
    const raised = stored('AlertRaised').find((e) => (e.payload as { alert_id: string }).alert_id === row.alert_id)!;
    expect((raised.payload as { values: { table_key: string } }).values.table_key).toBe('dine_in:T7');
    expect(engine().slips['dine_in:T7']!.alert_id).toBe(row.alert_id);
  });

  // ---------------------------------------------------------------------------------------------------------- #67
  it('[03a #67] station_overload: raised after red for pressure_alert_ms, deduped, no pass while it stays red, closed done below amber; reconcile after a restart closes it', async () => {
    kitchen(config({ S1: HOT }));
    submit({ order_id: 'O1', lines: [{ order_item_id: 'L1' }] });
    await pass(hub.clock.branchNow());
    fakeTap(hub.deps, 'start', 'L1');
    await passes(MIN / TICK_MS - 4);
    expect(overloadAlerts()).toEqual([]);
    await passes(8);
    const rows = overloadAlerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'open', family: 'info', dedupe_key: 'station_overload:S1', subject_stream_type: 'station', subject_stream_id: 'S1', target: { kind: 'managers' }, details: null, receiver: null });
    expect(Object.keys(rows[0]!.values).sort()).toEqual(['pressure_bp', 'station_id', 'waiting']);
    // stays red: never due
    const m = meter();
    await passes(20);
    expect(m.tx).toBe(0);
    // a restart while still red: the reconcile pass re-reads overload_open; raiseMany dedupes onto the open one
    resetHostFlags();
    bindFiresAlertsTick(hub.deps, hub.app.log);
    hostFlags.reconcile = true;
    await passes(MIN / TICK_MS + 4);
    expect(overloadAlerts()).toHaveLength(1);
    expect(hostFlags.overload_open.has('S1')).toBe(true);
    // a restart, then below amber: the reconcile pass closes it done
    fakeTap(hub.deps, 'done', 'L1');
    resetHostFlags();
    bindFiresAlertsTick(hub.deps, hub.app.log);
    hostFlags.reconcile = true;
    m.reset();
    await pass(hub.clock.branchNow() + TICK_MS);
    expect(m.tx).toBe(1);
    expect(overloadAlerts()[0]).toMatchObject({ state: 'closed', close_reason: 'done' });
    expect(hostFlags.overload_open.size).toBe(0);
  });

  // -------------------------------------------------------------------------------------------- 01d v1.1.2 D-1, §7
  it('[01d v1.1.2 D-1] the strict card takes a slip card with minutes_late and lines and refuses an unknown key; the lock view carries no details', () => {
    const details = { minutes_late: 4, lines: [{ name: 'Mutton Karahi', quantity: 1, state: 'cooking' }] };
    const row = (d: unknown): ViewRow => ({
      alert_id: 'A1',
      kind: ENGINE_ALERT_KINDS.slip,
      family: 'action',
      display_json: JSON.stringify({ kind_label_key: 'alert.slip_warning.lock' }),
      values_json: JSON.stringify({ table_key: KEY, order_ids: ['O1'], escalate_ms: 120_000 }),
      raised_at: 1,
      details_json: JSON.stringify(d),
      request_json: JSON.stringify({ answers: ['accept', 'decline'], needs_pin: 'never' }),
      raised_device_id: 'hub',
    });
    const place = { escalation: false, set: 'answerer' as const, for_staff_id: null };
    expect(signedInView(row(details), SLIP_WARNING, 0, place).card.details).toEqual(details);
    expect(() => signedInView(row({ ...details, table_code: '12' }), SLIP_WARNING, 0, place)).toThrow();
    expect(() => signedInView(row({ ...details, lines: [{ ...details.lines[0], price_minor: 1 }] }), SLIP_WARNING, 0, place)).toThrow();
    const lock = lockOnlyView(row(details), SLIP_WARNING, 0, place);
    expect(JSON.stringify(lock)).not.toContain('details');
    expect(JSON.stringify(lock)).not.toContain('Mutton Karahi');
  });

  it('[01d §7] a slip reaches the receiver\'s staff socket with its card details; the alert-mode socket of a tablet bound to them gets no details', async () => {
    kitchen();
    const staffDev = pairDevice(hub, { type: 'tablet', name: 'waiter-1' });
    const staffSession = openSession(hub, { kind: 'staff', staffId: WAITER, deviceId: staffDev.deviceId });
    const tab = pairDevice(hub, { type: 'tablet', name: 'waiter-2' });
    openSession(hub, { kind: 'staff', staffId: WAITER, deviceId: tab.deviceId }); // binds the tablet to the waiter
    const staffWs = await connectWs(hub.app);
    clients.push(staffWs);
    staffWs.send({ type: 'auth', device_token: staffDev.token, session_token: staffSession.token });
    await staffWs.untilCount(1);
    const modeWs = await connectWs(hub.app);
    clients.push(modeWs);
    modeWs.send({ type: 'auth', device_token: tab.token });
    await modeWs.untilCount(1);
    expect(modeWs.messages[0]).toMatchObject({ type: 'alerts_open' });
    const { row } = await raisedSlip();
    const frameOf = async (ws: WsClient): Promise<Record<string, unknown>> => {
      const find = (): Record<string, unknown> | undefined =>
        (ws.messages as Array<{ type?: string; alert?: { alert_id?: string } }>).find((m) => m.type === 'alert' && m.alert?.alert_id === row.alert_id) as Record<string, unknown> | undefined;
      for (let i = 0; i < 50 && find() === undefined; i += 1) await ws.untilCount(ws.messages.length + 1);
      return find()!;
    };
    const card = (await frameOf(staffWs)).alert as { card: { details: unknown } };
    expect(card.card.details).toEqual(row.details);
    const locked = (await frameOf(modeWs)).alert as Record<string, unknown>;
    expect(locked).not.toHaveProperty('card');
    const text = JSON.stringify(modeWs.messages);
    expect(text).not.toContain('"details"');
    expect(text).not.toContain('minutes_late');
    expect(text).not.toContain('Mutton Karahi');
    expect(hub.logs()).not.toContain('minutes_late');
    expect(hub.logs()).not.toContain('Mutton Karahi');
  });
});
