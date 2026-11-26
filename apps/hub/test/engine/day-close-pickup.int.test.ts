// ⚠️ 03a v1.2.11 §10.3h test 193 (m-11; §3.5.8 PK-10, §3.7, §3.12), with owner ruling DC-1 (2026-11-26): the real
// CloseBusinessDay with an open pickup order holding a hidden from-stock held line. DC-1: the held line keeps its
// reservation and its placement (no StockReleased for it); a hidden non-held from-stock line in the same close is still
// released `day_closed`, before BusinessDayClosed, in the one transaction (§3.7 writer order). Both orders are kept over
// the close, so the checkpoint is deferred (checkpoint_pending) until they exit, then written by the fires tick's pass.
import { isOrderInEngine, openDayStartMs, initialEngineState, type EngineState } from '@pos/engine';
import type { ConfigStockItem, PosEvent } from '@pos/events';
import { aBranchConfigItemStock, aFireDispatched, anEngineConfigApplied, anItemStarted, aStockSet } from '@pos/events/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import { startTickLoop, TICK_MS } from '../../src/alerts/tick';
import { registerEngineBootSteps } from '../../src/engine-host/boot-steps';
import { hostFlags, resetHostFlags } from '../../src/engine-host/host-flags';
import { replayEngine } from '../../src/engine-host/replay';
import { registerRestaurantBootSteps } from '../../src/sync/boot-steps';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { draftOf, fakeSubmit, fakeTap, type FakeOrder } from './fakes';

// As main.ts: the engine steps (the fires tick and its checkpoint pass), then the restaurant steps.
registerEngineBootSteps(() => performance.now());
registerRestaurantBootSteps();

const MIN = 60_000;
const HOUR = 60 * MIN;
const COOK = 20 * MIN;
const STOCK_COOK = MIN;
const KEBAB = [{ stock_item_id: 'I1', quantity: 1 }];

type Admin = { device: { deviceId: string; token: string }; session: { sessionId: string; token: string } };

describe('[03a #193] hub: day-close writer order with a held pickup line (PK-10, DC-1)', () => {
  let hub: TestHub | null = null;
  let stop: () => void = () => undefined;

  afterEach(async () => {
    stop();
    stop = () => undefined;
    vi.useRealTimers();
    swapBranchConfig(null);
    resetHostFlags();
    if (hub !== null) await hub.close();
    hub = null;
  });

  it('[03a #193] the held line keeps its reservation; the non-held hidden line is released day_closed before BusinessDayClosed; the checkpoint is deferred until the orders exit', async () => {
    resetHostFlags();
    const h = await createTestHub();
    hub = h;
    h.clock.set(new Date(2026, 9, 25, 9, 0).getTime());
    const directory = await aDirectory();
    for (const role of directory.roles) role.session_idle_ttl_ms = 7 * 24 * HOUR;
    await seedDirectory(h, directory);
    const config = aBranchConfigItemStock();
    swapBranchConfig({ config, snapshotHash: 'h'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 2, appliedAt: 0 });
    const device = pairDevice(h, { type: 'tablet' });
    const admin: Admin = { device, session: openSession(h, { kind: 'admin', staffId: 'S_MGR', deviceId: device.deviceId }) };
    const engine = (): EngineState => h.deps.state.get();
    const append = (events: PosEvent[]): PosEvent[] => h.deps.writer.run((tx) => tx.append(events.map((e) => draftOf(e, tx.clock.branchNow())))).appended;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    stop = startTickLoop(h.deps, { error: vi.fn() });
    const pass = async (at: number): Promise<void> => {
      h.clock.set(at);
      await vi.advanceTimersByTimeAsync(TICK_MS);
      await new Promise<void>((resolve) => setImmediate(resolve));
    };

    expect((await post(h, admin, 'open-business-day', 'OpenBusinessDay', 'cmd-open')).statusCode).toBe(200);
    h.clock.advance(5 * HOUR);
    append([anEngineConfigApplied(), aStockSet({ stream_id: 'I1', payload: { stock_item_id: 'I1', on_hand: 9, unit: 'piece' } })]);
    const now = h.clock.branchNow();
    const stock = { dayStartMs: openDayStartMs(engine())!, stockItems: config.stock_items as ConfigStockItem[] };
    const kebab = { item_id: 'I1', cook_time_ms: COOK, stock_time_ms: STOCK_COOK, stock_draws: KEBAB, out_of_stock_behaviour: 'cook_fresh' };
    // OP: a takeaway for +60 min with one immediate from-stock kebab: a held line (PK-1), hidden until near its fire.
    const pickup: FakeOrder = {
      order_id: 'OP',
      order: { order_type: 'takeaway', table_id: null, table_key: 'takeaway:OP', follow_up: false, pickup_at_ms: now + HOUR },
      lines: [{ order_item_id: 'HP', item: { ...kebab, serve_mode: 'immediate' } }],
    };
    // OD: a delivery for +70 min with one sync from-stock kebab: hidden, not a held line (sync), so the close releases it.
    const delivery: FakeOrder = {
      order_id: 'OD',
      order: { order_type: 'delivery', table_id: null, table_key: 'delivery:OD', follow_up: false, pickup_at_ms: now + HOUR + 10 * MIN },
      lines: [{ order_item_id: 'HD', item: { ...kebab, serve_mode: 'sync' } }],
    };
    fakeSubmit(h.deps, pickup, stock);
    fakeSubmit(h.deps, delivery, stock);
    expect(engine().lines.HP).toMatchObject({ from_stock: true, serve_mode: 'immediate', fired_at: null });
    expect(engine().lines.HD).toMatchObject({ from_stock: true, serve_mode: 'sync', fired_at: null });
    expect(engine().stock.I1).toMatchObject({ on_hand: 9, reserved: 2 });
    for (const id of ['HP', 'HD']) expect(engine().lines[id]!.fire_ms!).toBeGreaterThan(now + 30 * MIN); // hidden

    h.clock.advance(MIN);
    const heldBefore = engine().lines.HP!;
    const before = lastSeq(h);
    const res = await post(h, admin, 'close-business-day', 'CloseBusinessDay', 'cmd-close');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.result).toMatchObject({ changed: true, reason: 'closed' });
    // The writer order (§3.7): 05's Z first (its appender), then the release of the non-held line only, then the close;
    // one transaction (one recorded_at).
    const rows = rowsAfter(h, before);
    expect(rows.map((r) => [r.event_type, r.payload.order_item_id ?? null, r.payload.reason ?? null])).toEqual([
      ['ZReportIssued', null, null],
      ['StockReleased', 'HD', 'day_closed'],
      ['BusinessDayClosed', null, null],
    ]);
    expect(new Set(rows.map((r) => r.recorded_at)).size).toBe(1);
    // DC-1: the held line keeps its reservation, its from-stock cook and its placement; the released line is back to its
    // full cook, re-planned at the close's fold.
    expect(engine().lines.HP).toEqual(heldBefore);
    expect(engine().lines.HD).toMatchObject({ from_stock: false, reserved_seq: null, cook_ms: COOK });
    expect(engine().stock.I1).toMatchObject({ on_hand: 9, reserved: 1 });
    expect(withoutDiagnostics(replayEngine(h.deps.db, 'branch-1', 0, initialEngineState(), () => undefined).state)).toEqual(withoutDiagnostics(engine()));
    // Kept over the close (Q13), checkpoint deferred.
    const closedAt = rows[rows.length - 1]!.recorded_at;
    for (const id of ['OP', 'OD']) expect(isOrderInEngine(engine(), id, closedAt), id).toBe(true);
    expect(hostFlags.checkpoint_pending).toBe(true);
    await pass(closedAt + TICK_MS);
    expect(checkpoints(h)).toEqual([]);

    // Both lines are cooked and served; the held kebab's Start consumes the reservation it kept.
    for (const [order_id, id] of [['OP', 'HP'], ['OD', 'HD']] as const) {
      append([aFireDispatched({ stream_id: 'S1', payload: { station_id: 'S1', order_item_ids: [id], load_id: null, due_at: h.clock.branchNow(), reason: 'scheduled' } })]);
      const started = fakeTap(h.deps, 'start', id);
      if (id === 'HP') expect(started.map((e) => [e.event_type, (e.payload as { order_item_id: string }).order_item_id])).toEqual([['ItemStarted', 'HP'], ['StockConsumed', 'HP']]);
      fakeTap(h.deps, 'done', id);
      append([{ ...anItemStarted(), event_type: 'ItemServed', stream_id: order_id, payload: { order_item_ids: [id], source: 'tap' } }]);
    }
    const servedAt = h.clock.branchNow();
    await pass(servedAt + 29 * MIN);
    expect(checkpoints(h)).toEqual([]);
    expect(hostFlags.checkpoint_pending).toBe(true);
    // 30 min after the last serve both orders exit (ORDER_EXIT_AFTER_SERVED_MS); that pass writes the checkpoint.
    await pass(servedAt + 31 * MIN);
    expect(checkpoints(h)).toHaveLength(1);
    expect(hostFlags.checkpoint_pending).toBe(false);
  });
});

function post(hub: TestHub, admin: Admin, name: string, commandType: string, commandId: string) {
  return hub.app.inject({
    method: 'POST',
    url: `/admin/commands/${name}`,
    headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
    payload: { command_id: commandId, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type: commandType, payload: {}, occurred_at: hub.clock.branchNow(), actor_id: 'S_MGR', device_id: admin.device.deviceId },
  });
}

function lastSeq(hub: TestHub): number {
  return hub.deps.db.prepare('SELECT COALESCE(MAX(seq), 0) FROM events').pluck().get() as number;
}

function rowsAfter(hub: TestHub, seq: number): Array<{ event_type: string; recorded_at: number; payload: { order_item_id?: string; reason?: string } }> {
  const rows = hub.deps.db.prepare('SELECT event_type, recorded_at, payload FROM events WHERE seq > ? ORDER BY seq').all(seq) as Array<{ event_type: string; recorded_at: number; payload: string }>;
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) as { order_item_id?: string; reason?: string } }));
}

function checkpoints(hub: TestHub): unknown[] {
  return hub.deps.db.prepare('SELECT last_seq FROM engine_checkpoints').all();
}

function withoutDiagnostics(state: EngineState): Omit<EngineState, 'diagnostics'> {
  const rest: Partial<EngineState> = { ...state };
  delete rest.diagnostics;
  return rest as Omit<EngineState, 'diagnostics'>;
}
