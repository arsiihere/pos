// 03a task 27: live = replay (§2.1 #1, §3.12; test #59). Fifty seeds of a mixed day sliced from @pos/engine/sim (P-12)
// run through a test hub the way live runs: fake submits (02), the real tick loop (01d's alerts, fires, fires_alerts) on
// fake timers, Start / Done / Served fakes (03b), the real commands for a recount, an add, a capacity change and a day
// close and open, and 02's boost and return as fakes (§4.4). The live state deep-equals the fresh boots (steps 2–3)
// after each disturbance, after every CHECK_EVERY-th submit and at the end: from seq 0, from the newest snapshot once one
// is written, and (after the checkpoint) from the day-close checkpoint. No breach is logged (AD-6).
//
// Each seed: part A (60 % of the slice) in an opened day, with every disturbance and one line in LATE_EVERY started
// late (03b's lateStartShift); a drain; a stock add and an order
// kept over the close (its hidden from-stock line is released `day_closed`, the checkpoint is deferred until it exits);
// the close at least day_min_gap_hours after the open; passes until the deferred checkpoint is written; a reopen; part B
// (the rest of the slice, moved after the reopen), stopped mid-flight. Idle passes are skipped as the simulator does
// (a pass at each fires or alert due, at every tap and submit instant's grid, and a 30 s heartbeat while work is open).
// No wall-clock assert (AD-32).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { initialEngineState, nextAlertDueAt, nextDueAt, openDayStartMs, type Diagnostic, type EngineState } from '@pos/engine';
import { generateDay, type SimOrder, type SimStation } from '@pos/engine/sim';
import type { BranchConfig, ConfigItem, ConfigStation, ConfigStockItem, DirectoryInput, PosEvent } from '@pos/events';
import { parseEvent } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import Database from 'better-sqlite3';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTickLoop, TICK_MS } from '../../src/alerts/tick';
import { registerEngineBootSteps } from '../../src/engine-host/boot-steps';
import { setEngineConfigOf } from '../../src/engine-host/fires-tick';
import { hostFlags, resetHostFlags } from '../../src/engine-host/host-flags';
import { loadEngineBase, replayEngine } from '../../src/engine-host/replay';
import { registerRestaurantBootSteps } from '../../src/sync/boot-steps';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { configPoller } from '../../src/sync/config-poller';
import { aDirectory } from '../helpers/fixtures';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { fakeBoostDrafts, fakeDoneDrafts, fakeLateStartDrafts, fakeReturnDrafts, fakeServedDrafts, fakeStartDrafts, fakeSubmitOrRefuse, type FakeOrder } from './fakes';

registerEngineBootSteps(() => performance.now());
registerRestaurantBootSteps();

const BRANCH = 'branch-1';
const CONFIRMED = { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'key-1', confirmed_at: 1 };
const SECOND = 1_000;
const MIN = 60 * SECOND;
const HOUR = 60 * MIN;
const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);
// Sized for the normal gate (task 27 brief): 80 orders of the dinner peak per seed, 48 in part A and 32 in part B.
const SLICE = 80;
const PART_A = Math.round(SLICE * 0.6);
const HEARTBEAT_MS = 30 * SECOND;
const LATE_START_MS = 90 * SECOND;
const LATE_EVERY = 5;
// Live is also compared with the boots after every CHECK_EVERY-th submit, and after each disturbance.
const CHECK_EVERY = 10;
const STOCK = 'K1';
const STOCK_STATION = 'tawa';
const STOCK_COOK_MS = 60 * SECOND;
// AD-6: these mean a bookkeeping bug; over_capacity and reserve_fallback are planning facts.
const BREACHES = new Set(['profile_underflow', 'stock_breach', 'invalid_event']);
const TERMINAL = new Set(['served', 'removed', 'voided', 'returned']);

const nextImmediate = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const nextGrid = (t: number): number => (Math.floor(t / TICK_MS) + 1) * TICK_MS;
const ceilGrid = (t: number): number => Math.ceil(t / TICK_MS) * TICK_MS;

// The sim's stations as a schema-3 branch config (aBranchConfig's station defaults), one item per station (item_id =
// station_id), and one stock item drawn by the tawa item, 1 piece per sale, cooked in 60 s from stock.
function branchConfigOf(stations: readonly SimStation[]): BranchConfig {
  const base = aBranchConfig();
  const station = base.stations[0]!;
  const item = base.items[1]!;
  return {
    ...base,
    stations: stations.map(
      (s): ConfigStation => ({
        ...station,
        station_id: s.station_id,
        name: s.station_id,
        station_type: s.type,
        capacity: s.capacity,
        freshness_window_ms: s.freshness_window_ms,
        programs: s.type === 'batch' ? [{ program_id: `${s.station_id}-p`, name: s.station_id, cook_time_ms: s.cook_ms, is_archived: false }] : [],
      }),
    ),
    variant_groups: [],
    stock_items: [{ stock_item_id: STOCK, name: 'Tawa stock', stock_unit: 'piece', carries_over: false, station_id: STOCK_STATION, low_stock_threshold: null }],
    items: stations.map(
      (s, i): ConfigItem => ({
        ...item,
        item_id: s.station_id,
        name: s.station_id,
        sort_order: i + 1,
        station_id: s.station_id,
        cook_time_ms: s.cook_ms,
        program_id: s.type === 'batch' ? `${s.station_id}-p` : null,
        ...(s.station_id === STOCK_STATION ? { stock_time_ms: STOCK_COOK_MS, stock_draws: [{ stock_item_id: STOCK, quantity_per_sale_unit: 1 }] } : {}),
      }),
    ),
  };
}

// The ItemAdded copy of a line's item (D25), as 02 copies it from branchConfig().
function itemOf(s: SimStation): Record<string, unknown> {
  return {
    station_id: s.station_id,
    item_id: s.station_id,
    name: s.station_id,
    cook_time_ms: s.cook_ms,
    ...(s.type === 'batch' ? { program_id: `${s.station_id}-p`, program_cook_time_ms: s.cook_ms } : {}),
    ...(s.station_id === STOCK_STATION ? { stock_time_ms: STOCK_COOK_MS, stock_draws: [{ stock_item_id: STOCK, quantity: 1 }], out_of_stock_behaviour: 'cook_fresh' } : {}),
  };
}

type Client = { device: { deviceId: string; token: string }; session: { sessionId: string; token: string } };
type Disturbance = 'recount' | 'capacity' | 'boost' | 'add' | 'return' | 'close' | 'open';

describe('03a #59: live state equals replayed state after a mixed day (property, 50 seeds)', () => {
  let directory: DirectoryInput;
  let hub: TestHub | null = null;
  let stop: () => void = () => undefined;
  let scratch: string | null = null;

  beforeAll(async () => {
    directory = await aDirectory();
    // The day moves the clock by hours: sessions stay alive.
    for (const role of directory.roles) role.session_idle_ttl_ms = 7 * 24 * HOUR;
  });

  afterEach(async () => {
    stop();
    stop = () => undefined;
    vi.useRealTimers();
    swapBranchConfig(null);
    setEngineConfigOf(null);
    resetHostFlags();
    if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
    scratch = null;
    if (hub !== null) await hub.close();
    hub = null;
  });

  it.each(SEEDS)('[03a #59] seed %i: live = replay from seq 0, from a snapshot and from the checkpoint; no breach logged', async (seed) => {
    const day = generateDay(seed);
    const stations = new Map(day.stations.map((s) => [s.station_id, s]));
    const config = branchConfigOf(day.stations);
    const from = day.orders.findIndex((o) => o.at_ms >= day.start_ms + 12 * HOUR + (seed % 7) * 10 * MIN);
    const slice = day.orders.slice(from, from + SLICE);
    expect(slice).toHaveLength(SLICE);

    resetHostFlags();
    const cloud = stubConfigCloud();
    const h = await createTestHub({ configClient: cloud, config: { provisioned: { ...CONFIRMED } } });
    hub = h;
    // Speed only: no fsync per commit in this file (the writer's transactions and their order are unchanged).
    h.deps.db.pragma('synchronous = OFF');
    await seedDirectory(h, structuredClone(directory));
    const tickLog = { error: vi.fn<(obj: Record<string, unknown>, msg?: string) => void>() };
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    stop = startTickLoop(h.deps, tickLog);

    const engine = (): EngineState => h.deps.state.get();
    const now = (): number => h.clock.branchNow();
    const device = pairDevice(h, { type: 'tablet' });
    const admin: Client = { device, session: openSession(h, { kind: 'admin', staffId: 'S_MGR', deviceId: device.deviceId }) };
    const staff: Client = { device, session: openSession(h, { kind: 'staff', staffId: 'S_MGR', deviceId: device.deviceId }) };
    let commandNo = 0;
    const command = async (path: string, commandType: string, payload: Record<string, unknown>, who: Client, header: 'x-admin-session' | 'x-session-token') => {
      const response = await h.app.inject({
        method: 'POST',
        url: path,
        headers: { authorization: `Bearer ${who.device.token}`, [header]: who.session.token },
        payload: { command_id: `cmd-${seed}-${++commandNo}`, tenant_id: 'tenant-a', branch_id: BRANCH, command_type: commandType, payload, occurred_at: now(), actor_id: 'S_MGR', device_id: who.device.deviceId },
      });
      expect(response.statusCode, `${commandType}: ${response.body}`).toBe(200);
      return response.json().data.result as Record<string, unknown>;
    };
    const adminCommand = (name: string, type: string, payload: Record<string, unknown>) => command(`/admin/commands/${name}`, type, payload, admin, 'x-admin-session');

    // ---------------------------------------------------------------------------------------------------- the driver
    // Tap instants → taps in order. A line is started at the pass that fired it, or LATE_START_MS later for one line in
    // LATE_EVERY (with 03b's lateStartShift); Done at Start + prep + cook; Served when the order's last open line is done.
    const taps = new Map<number, Array<{ kind: 'start' | 'done'; id: string }>>();
    const tapAt = (at: number, kind: 'start' | 'done', id: string): void => {
      taps.set(at, [...(taps.get(at) ?? []), { kind, id }]);
    };
    const waiting = new Set<string>();
    const run = (fn: (state: EngineState, at: number) => ReturnType<typeof fakeStartDrafts>): void => {
      h.deps.writer.run((tx) => tx.append(fn(tx.state as EngineState, tx.clock.branchNow())));
    };
    const start = (id: string, at: number, late: boolean): void => {
      run((s, t) => (late ? fakeLateStartDrafts(s, id, t) : fakeStartDrafts(s, id, t)));
      const started = engine().lines[id]!;
      tapAt(at + started.prep_ms + started.cook_ms, 'done', id);
    };
    const pass = async (at: number): Promise<void> => {
      h.clock.set(at);
      await vi.advanceTimersByTimeAsync(TICK_MS);
      await nextImmediate();
      for (const l of Object.values(engine().lines)) {
        if (l.fired_at === null || l.stage !== 'added' || waiting.has(l.order_item_id)) continue;
        if (lateOf(l.order_item_id)) {
          waiting.add(l.order_item_id);
          tapAt(at + LATE_START_MS, 'start', l.order_item_id);
        } else start(l.order_item_id, at, false);
      }
    };
    const tap = (at: number): void => {
      const list = taps.get(at);
      if (list === undefined) return;
      taps.delete(at);
      for (const { kind, id } of list) {
        if (kind === 'start') {
          waiting.delete(id);
          if (engine().lines[id]?.stage === 'added') start(id, at, true);
          continue;
        }
        if (engine().lines[id]?.stage !== 'cooking') continue;
        run((s, t) => fakeDoneDrafts(s, id, t));
        const order_id = engine().lines[id]!.order_id;
        const lines = engine()
          .orders[order_id]!.line_ids.map((l) => engine().lines[l])
          .filter((l) => l !== undefined);
        if (lines.every((l) => l.stage === 'done' || TERMINAL.has(l.stage))) {
          const ready = lines.filter((l) => l.stage === 'done').map((l) => l.order_item_id);
          if (ready.length > 0) run((s, t) => fakeServedDrafts(s, order_id, ready, t));
        }
      }
    };
    const submit = (o: SimOrder, shift: number): void => {
      const fake: FakeOrder = {
        order_id: o.order_id,
        actor_id: 'S_CASH',
        order: { order_type: o.order_type, table_id: o.table_id, table_key: o.table_key, follow_up: o.follow_up, pickup_at_ms: o.pickup_at_ms + shift },
        lines: o.lines.map((l) => ({ order_item_id: l.order_item_id, station_id: l.station_id, item: itemOf(stations.get(l.station_id)!) })),
      };
      const out = fakeSubmitOrRefuse(h.deps, fake, { dayStartMs: openDayStartMs(engine()) ?? 0, stockItems: config.stock_items as ConfigStockItem[] });
      expect(out.refused).toEqual([]);
    };
    const openWork = (): boolean => Object.values(engine().lines).some((l) => !TERMINAL.has(l.stage)) || hostFlags.checkpoint_pending;

    // Orders at their (shifted) instants; at one instant: taps, then the pass and its Start taps, then submits (the
    // simulator's order). `after` runs after each submit; the span ends when nothing is left at or before `until`.
    const span = async (orders: readonly SimOrder[], shift: number, o: { until: number; after?: (submitted: number) => Promise<void> }): Promise<void> => {
      let i = 0;
      let lastPass = now();
      for (;;) {
        const t0 = now();
        const g = nextGrid(t0);
        const dues = [nextDueAt(engine(), g), nextAlertDueAt(engine(), hostFlags.skipped)].filter((d): d is number => d !== null);
        let passAt = dues.length > 0 ? Math.max(g, ceilGrid(Math.min(...dues))) : Number.POSITIVE_INFINITY;
        if (openWork()) passAt = Math.min(passAt, Math.max(g, ceilGrid(lastPass + HEARTBEAT_MS)));
        const submitAt = i < orders.length ? orders[i]!.at_ms + shift : Number.POSITIVE_INFINITY;
        const nextTap = taps.size > 0 ? Math.min(...taps.keys()) : Number.POSITIVE_INFINITY;
        const t = Math.max(t0, Math.min(submitAt, nextTap, passAt));
        if (t === Number.POSITIVE_INFINITY || t > o.until) break;
        h.clock.set(t);
        if (nextTap === t) tap(t);
        if (passAt === t) {
          await pass(t);
          lastPass = t;
        }
        while (i < orders.length && orders[i]!.at_ms + shift === t) {
          submit(orders[i++]!, shift);
          await o.after?.(i);
        }
      }
    };

    // -------------------------------------------------------------------------------------------- the disturbances
    const done = new Set<Disturbance>();
    const unfiredOf = (state: EngineState) => Object.values(state.lines).filter((l) => l.stage === 'added' && l.fired_at === null);
    const capacityStation = day.stations[seed % day.stations.length]!;
    const tryDisturb = async (submitted: number): Promise<void> => {
      if (submitted % CHECK_EVERY === 0) await boots(`part A order ${submitted}`, false);
      const state = engine();
      if (!done.has('recount') && submitted >= 8) {
        const reserved = state.stock[STOCK]?.reserved ?? 0;
        if (reserved >= 1) {
          await adminCommand('set-precooked-stock', 'SetPrecookedStock', { entries: [{ stock_item_id: STOCK, on_hand: reserved - 1 }] });
          done.add('recount');
          await boots('recount', false);
        }
      }
      if (!done.has('capacity') && submitted >= 14) {
        const capacity_override = Math.max(1, Math.floor(capacityStation.capacity / 4));
        const result = await command('/commands/set-station-capacity', 'SetStationCapacity', { station_id: capacityStation.station_id, capacity_override, reason: 'manager' }, staff, 'x-session-token');
        expect(result.changed).toBe(true);
        done.add('capacity');
        await boots('capacity', false);
      }
      if (!done.has('boost') && submitted >= 18) {
        const candidates = [...new Set(unfiredOf(engine()).map((l) => l.order_id))].filter((id) => engine().orders[id]?.boosted === false).sort();
        const order_id = candidates[candidates.length - 1];
        if (order_id !== undefined) {
          run((_s, t) => fakeBoostDrafts(order_id, t));
          done.add('boost');
          await boots('boost', false);
        }
      }
      if (!done.has('add') && submitted >= 22) {
        await adminCommand('add-precooked-stock', 'AddPrecookedStock', { entries: [{ stock_item_id: STOCK, quantity: 3 }] });
        done.add('add');
        await boots('add', false);
      }
      if (!done.has('return') && submitted >= 24) await tryReturn();
    };
    const tryReturn = async (): Promise<void> => {
      const served = Object.values(engine().lines).filter((l) => l.stage === 'served' && l.station_id !== STOCK_STATION && l.return_of === null);
      const line = served.sort((a, b) => (a.done_at ?? 0) - (b.done_at ?? 0) || (a.order_item_id < b.order_item_id ? -1 : 1)).pop();
      if (line === undefined) return;
      const row = h.deps.db
        .prepare(
          `SELECT event_id, tenant_id, branch_id, stream_type, stream_id, event_type, schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq
           FROM events WHERE event_type = 'ItemAdded' AND json_extract(payload, '$.order_item_id') = ?`,
        )
        .get(line.order_item_id) as Record<string, unknown> & { payload: string };
      const added = parseEvent({ ...row, payload: JSON.parse(row.payload) } as unknown as PosEvent);
      run((s, t) => fakeReturnDrafts(s, added, seed % 2 === 0 ? 'fix' : 'remake', t));
      done.add('return');
      await boots('return', false);
    };

    // ------------------------------------------------------------------------------------------- the fresh boots
    // Steps 2–3 on the log as it stands (read-only): from seq 0; from the newest snapshot when one is written; with
    // `checkpoint`, on a copy of the log with no snapshot row, from the day-close checkpoint. Each deep-equals live.
    const breaches: Diagnostic[] = [];
    const report = (d: Diagnostic): void => {
      if (BREACHES.has(d.kind)) breaches.push(d);
    };
    const skip = vi.fn();
    const boots = async (label: string, checkpoint: boolean): Promise<{ snapshot: boolean; checkpoint: boolean }> => {
      await nextImmediate();
      const live = withoutDiagnostics(engine());
      const lastSeq = h.deps.writer.lastSeq();
      const fromZero = replayEngine(h.deps.db, BRANCH, 0, initialEngineState(), report);
      expect(withoutDiagnostics(fromZero.state), `${label}: from seq 0`).toStrictEqual(live);
      const base = loadEngineBase(h.deps.db, BRANCH, skip);
      const out = { snapshot: false, checkpoint: false };
      if (base.snapshot_seq !== null) {
        expect(base.snapshot_seq).toBeLessThanOrEqual(lastSeq);
        const fromSnapshot = replayEngine(h.deps.db, BRANCH, base.snapshot_seq, base.state!, report);
        expect(withoutDiagnostics(fromSnapshot.state), `${label}: from the snapshot at ${base.snapshot_seq}`).toEqual(live);
        out.snapshot = base.snapshot_seq < lastSeq;
      }
      if (!checkpoint) return out;
      scratch ??= mkdtempSync(join(tmpdir(), 'pos-live-replay-'));
      const copyPath = join(scratch, `${label}.db`);
      h.deps.db.prepare('VACUUM INTO ?').run(copyPath);
      const copy = new Database(copyPath);
      try {
        copy.prepare('DELETE FROM engine_snapshots').run();
        const fallback = loadEngineBase(copy, BRANCH, skip);
        expect(fallback.snapshot_seq).toBeNull();
        expect(fallback.checkpoint_seq).not.toBeNull();
        const fromCheckpoint = replayEngine(copy, BRANCH, fallback.checkpoint_seq!, fallback.state!, report);
        expect(withoutDiagnostics(fromCheckpoint.state), `${label}: from the checkpoint at ${fallback.checkpoint_seq}`).toEqual(live);
        out.checkpoint = fallback.checkpoint_seq! < lastSeq;
      } finally {
        copy.close();
      }
      return out;
    };

    // ------------------------------------------------------------------------------------------------------ the day
    const a0 = slice[0]!.at_ms - 5 * MIN;
    h.clock.set(a0);
    cloud.respondWithSnapshot(config as unknown as Record<string, unknown>);
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('applied');
    expect(engine().config?.stations.map((s) => s.station_id)).toEqual([...stations.keys()].sort());
    await adminCommand('open-business-day', 'OpenBusinessDay', {});
    done.add('open');
    await adminCommand('set-precooked-stock', 'SetPrecookedStock', { entries: [{ stock_item_id: STOCK, on_hand: 6 }] });
    await boots('open', false);

    // Part A, then its drain (every line served; a return not yet taken is taken on the newest served line).
    const partA = slice.slice(0, PART_A);
    await span(partA, 0, { until: Number.POSITIVE_INFINITY, after: tryDisturb });
    if (!done.has('return')) {
      await tryReturn();
      await span([], 0, { until: Number.POSITIVE_INFINITY });
    }
    expect([...done].sort()).toEqual(['add', 'boost', 'capacity', 'open', 'recount', 'return']);

    // The close, at least day_min_gap_hours after the open, with an order kept over it.
    const closeAt = ceilGrid(Math.max(a0 + 4 * HOUR + SECOND, now() + 5 * MIN));
    h.clock.set(closeAt - 2 * MIN);
    await adminCommand('add-precooked-stock', 'AddPrecookedStock', { entries: [{ stock_item_id: STOCK, quantity: 2 }] });
    const keptId = `KEPT${seed}`;
    const kept: SimOrder = {
      order_id: keptId,
      at_ms: closeAt - 2 * MIN,
      order_type: 'takeaway',
      follow_up: false,
      table_id: null,
      table_key: `takeaway:${keptId}`,
      pickup_at_ms: closeAt + 45 * MIN,
      lines: [
        { order_item_id: `${keptId}L1`, station_id: STOCK_STATION },
        { order_item_id: `${keptId}L2`, station_id: 'karahi' },
      ],
    };
    submit(kept, 0);
    expect(engine().lines[`${keptId}L1`]!.from_stock).toBe(true);
    h.clock.set(closeAt);
    expect((await adminCommand('close-business-day', 'CloseBusinessDay', {})).reason).toBe('closed');
    done.add('close');
    await boots('close', false);
    expect(engine().lines[`${keptId}L1`]!.from_stock).toBe(false);
    expect(hostFlags.checkpoint_pending).toBe(true);
    // Passes until the kept order has left the engine and the deferred checkpoint is written.
    await span([], 0, { until: closeAt + 6 * HOUR });
    await nextImmediate();
    const checkpoints = h.deps.db.prepare('SELECT COUNT(*) FROM engine_checkpoints').pluck().get() as number;
    expect(checkpoints).toBe(1);

    // The reopen, then part B moved after it, stopped mid-flight.
    h.clock.set(ceilGrid(now() + 5 * MIN));
    expect((await adminCommand('open-business-day', 'OpenBusinessDay', {})).reason).toBe('opened');
    const partB = slice.slice(PART_A);
    const shift = now() + MIN - partB[0]!.at_ms;
    await span(partB, shift, {
      until: partB[partB.length - 1]!.at_ms + shift + 3 * MIN,
      after: async (submitted) => {
        if (submitted % CHECK_EVERY === 0) await boots(`part B order ${submitted}`, true);
      },
    });
    await nextImmediate();
    await nextImmediate();
    stop();
    stop = () => undefined;

    // -------------------------------------------------------------------------------------------------- the boots
    const live = withoutDiagnostics(engine());
    expect(Object.values(live.lines).some((l) => !TERMINAL.has(l.stage))).toBe(true);
    expect(await boots('end', true)).toEqual({ snapshot: true, checkpoint: true });

    // No breach: not in the replays, not in the live log (AD-6, §7.2), and no tick failed.
    expect(breaches).toEqual([]);
    const logged = h
      .logs()
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { msg?: string; kind?: string })
      .filter((line) => line.msg === 'engine diagnostic' && BREACHES.has(line.kind ?? ''));
    expect(logged).toEqual([]);
    expect(tickLog.error).not.toHaveBeenCalled();
    expect([...done].sort()).toEqual(['add', 'boost', 'capacity', 'close', 'open', 'recount', 'return']);
  }, 60_000);
});

// One line in LATE_EVERY, by its id: started late.
function lateOf(id: string): boolean {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % LATE_EVERY === 0;
}

function withoutDiagnostics(state: EngineState): Omit<EngineState, 'diagnostics'> {
  const rest: Partial<EngineState> = { ...state };
  delete rest.diagnostics;
  return rest as Omit<EngineState, 'diagnostics'>;
}
