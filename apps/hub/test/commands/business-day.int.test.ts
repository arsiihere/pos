import { applyEvent, availableStock, initialEngineState, openDayStartMs, stockLevel, type EngineState } from '@pos/engine';
import { parseEvent, type BranchConfig, type ConfigStockItem, type PosEvent } from '@pos/events';
import { aBranchConfigItemStock, aFireDispatched, anEngineConfigApplied, anItemStarted, anOrderBatch, aStockSet } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { foldEngineEvents } from '../../src/sync/boot-steps';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

type Admin = { device: { deviceId: string; token: string }; session: { sessionId: string; token: string } };

const cleanups: Array<() => Promise<void>> = [];

describe('business day commands (§6.18a, §6.18b)', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[01a §10 #133] OpenBusinessDay opens a day with the hub local date and frozen units; a second open is a no-op; restart fold, replay, 403 and COMMIT failure', async () => {
    const hub = await open();
    withConfig(aBranchConfigItemStock());
    const admin = adminOn(hub, 'S_MGR');
    const now = hub.clock.branchNow();

    const opened = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-1');
    expect(opened.statusCode).toBe(200);
    const date = '2026-10-25';
    expect(opened.json().data.result).toEqual({ business_date: date, opened_at: now, changed: true, reason: 'opened' });
    // 01c §6.20: stock_units for every stock item, draws for every tracked item (I2 is untracked).
    const frozen = { stock_units: STOCK_UNITS, draws: DRAWS };
    expect(eventsOf(hub, 'BusinessDayOpened')).toEqual([
      { stream_type: 'hub', stream_id: 'branch-1', payload: { business_date: date, ...frozen } },
    ]);
    expect(hub.deps.db.prepare("SELECT schema_version FROM events WHERE event_type = 'BusinessDayOpened'").pluck().all()).toEqual([2]);
    const day = { business_date: date, opened_at: now, closed_at: null, ...frozen };
    expect(engine(hub).business_day).toEqual(day);

    hub.clock.advance(60_000);
    const again = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-2');
    expect(again.statusCode).toBe(200);
    expect(again.json().data.result).toEqual({ business_date: date, opened_at: now, changed: false, reason: 'already_open' });
    expect(again.json().data.event_ids).toEqual([]);
    expect(eventsOf(hub, 'BusinessDayOpened')).toHaveLength(1);

    // Boot step 3 fold of the log gives the same business_day (a real boot() restart is #147).
    expect(foldEngineEvents(hub.deps.db, 'branch-1').state.business_day).toEqual(engine(hub).business_day);

    const replay = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-1');
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(opened.json());
    expect(eventsOf(hub, 'BusinessDayOpened')).toHaveLength(1);

    const cashier = adminOn(hub, 'S_CASH');
    const denied = await post(hub, cashier, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-denied', 'S_CASH');
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PERMISSION_DENIED');
    const owner = adminOn(hub, 'S_OWNER');
    const noStock = await post(hub, owner, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-no-stock', 'S_OWNER');
    expect(noStock.statusCode).toBe(403);
    expect(noStock.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'manage-stock' } });

    let fail = false;
    const failing = await open({
      beforeCommit() {
        if (fail) throw new Error('forced commit failure');
      },
    });
    withConfig(aBranchConfigItemStock());
    const failAdmin = adminOn(failing, 'S_MGR');
    fail = true;
    const failed = await post(failing, failAdmin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-fail');
    expect(failed.statusCode).toBe(500);
    expect(engine(failing).business_day).toBeNull();
    expect(eventsOf(failing, 'BusinessDayOpened')).toEqual([]);
  });

  it('[01a §6.18a] with no config the day opens with empty stock_units and draws (01c §6.20); a non-empty payload → 400', async () => {
    const hub = await open();
    const admin = adminOn(hub, 'S_MGR');
    const extra = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', { end_current_day: true }, 'cmd-open-extra');
    expect(extra.statusCode).toBe(400);
    expect(extra.json().error.code).toBe('VALIDATION_FAILED');
    const opened = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-empty');
    expect(opened.statusCode).toBe(200);
    expect(eventsOf(hub, 'BusinessDayOpened')[0]?.payload).toEqual({ business_date: '2026-10-25', stock_units: {}, draws: {} });
    expect(engine(hub).business_day).toMatchObject({ stock_units: {}, draws: {} });
  });

  it('[01a §10 #143] close at exactly day_min_gap_hours then open: a new day; a non-carrying count reads not_counted, a carrying one keeps its stock', async () => {
    const hub = await open();
    const config = carrying(aBranchConfigItemStock(), 'I3');
    withConfig(config);
    const admin = adminOn(hub, 'S_MGR');
    hub.clock.set(at(6));
    expect((await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-0600')).statusCode).toBe(200);
    hub.clock.set(at(8));
    countStock(hub, [
      { item_id: 'I1', on_hand: 4, unit: 'piece' },
      { item_id: 'I3', on_hand: 2_000, unit: 'g' },
    ]);
    expect(available(hub, config, 'I3')).toBe(2_000);

    hub.clock.set(at(10));
    const closed = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close-1000');
    expect(closed.statusCode).toBe(200);
    expect(closed.json().data.result).toEqual({
      business_date: '2026-10-25',
      opened_at: at(6),
      closed_at: at(10),
      changed: true,
      reason: 'closed',
    });
    expect(eventsOf(hub, 'BusinessDayClosed')).toEqual([{ stream_type: 'hub', stream_id: 'branch-1', payload: {} }]);
    expect(engine(hub).business_day?.closed_at).toBe(at(10));

    const reopened = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-1000');
    expect(reopened.json().data.result).toMatchObject({ opened_at: at(10), changed: true, reason: 'opened' });
    expect(eventsOf(hub, 'BusinessDayOpened').map((e) => e.payload)).toEqual([
      { business_date: '2026-10-25', stock_units: STOCK_UNITS, draws: DRAWS },
      { business_date: '2026-10-25', stock_units: STOCK_UNITS, draws: DRAWS },
    ]);
    expect(engine(hub).business_day).toMatchObject({ opened_at: at(10), closed_at: null });
    expect(available(hub, config, 'I1')).toBe(0);
    expect(level(hub, config, 'I1')).toBe('not_counted');
    expect(available(hub, config, 'I3')).toBe(2_000);
  });

  it('[01a §10 #144] a close inside day_min_gap_hours is a no-op; a smaller gap in the snapshot allows it; a hub clock moved back is recent; retransmit replays', async () => {
    const hub = await open();
    withConfig(aBranchConfigItemStock());
    const admin = adminOn(hub, 'S_MGR');
    hub.clock.set(at(6));
    await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-0600');

    hub.clock.set(at(9, 59));
    const early = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close-0959');
    expect(early.statusCode).toBe(200);
    expect(early.json().data.result).toEqual({
      business_date: '2026-10-25',
      opened_at: at(6),
      closed_at: null,
      changed: false,
      reason: 'opened_recently',
    });
    expect(early.json().data.event_ids).toEqual([]);
    expect(eventsOf(hub, 'BusinessDayClosed')).toEqual([]);
    expect(engine(hub).business_day?.closed_at).toBeNull();

    withConfig(aBranchConfigItemStock({ day_min_gap_hours: 2 }));
    const allowed = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close-0959-gap2');
    expect(allowed.json().data.result).toMatchObject({ closed_at: at(9, 59), changed: true, reason: 'closed' });
    expect(eventsOf(hub, 'BusinessDayClosed')).toHaveLength(1);

    await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-0959');
    hub.clock.set(at(5));
    const backwards = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close-0500');
    expect(backwards.json().data.result).toMatchObject({ opened_at: at(9, 59), changed: false, reason: 'opened_recently' });
    expect(eventsOf(hub, 'BusinessDayClosed')).toHaveLength(1);

    const replay = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close-0959');
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(early.json());
  });

  it('[01a §10 #145] CloseBusinessDay ends the open day; counts of non-carrying items read 0; a second close is not_open; open starts a new day; 403, replay and COMMIT failure', async () => {
    let fail = false;
    const hub = await open({
      beforeCommit() {
        if (fail) throw new Error('forced commit failure');
      },
    });
    const config = carrying(aBranchConfigItemStock(), 'I3');
    withConfig(config);
    const admin = adminOn(hub, 'S_MGR');
    hub.clock.set(at(6));
    await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-0600');
    hub.clock.set(at(7));
    countStock(hub, [
      { item_id: 'I1', on_hand: 4, unit: 'piece' },
      { item_id: 'I3', on_hand: 1_500, unit: 'g' },
    ]);
    expect(available(hub, config, 'I1')).toBe(4);

    hub.clock.set(at(23));
    const cashier = adminOn(hub, 'S_CASH');
    const denied = await post(hub, cashier, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close-denied', 'S_CASH');
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PERMISSION_DENIED');
    const owner = adminOn(hub, 'S_OWNER');
    const noStock = await post(hub, owner, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close-no-stock', 'S_OWNER');
    expect(noStock.statusCode).toBe(403);
    expect(noStock.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'manage-stock' } });
    expect(engine(hub).business_day?.closed_at).toBeNull();

    fail = true;
    const before = engine(hub);
    const failed = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close-fail');
    expect(failed.statusCode).toBe(500);
    expect(engine(hub)).toBe(before);
    expect(eventsOf(hub, 'BusinessDayClosed')).toEqual([]);
    fail = false;

    const closed = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close-2300');
    expect(closed.json().data.result).toMatchObject({ closed_at: at(23), changed: true, reason: 'closed' });
    const [event] = closed.json().data.event_ids as string[];
    const recordedAt = hub.deps.db.prepare('SELECT recorded_at FROM events WHERE event_id = ?').pluck().get(event);
    expect(engine(hub).business_day?.closed_at).toBe(recordedAt);
    expect(openDayStartMs(engine(hub))).toBeNull();
    expect(available(hub, config, 'I1')).toBe(0);
    expect(available(hub, config, 'I3')).toBe(1_500);
    const stockEvents = () => hub.deps.db.prepare("SELECT COUNT(*) FROM events WHERE stream_type = 'stock'").pluck().get();
    const stockBefore = stockEvents();
    const setAfterClose = await post(hub, admin, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ stock_item_id: 'I1', on_hand: 2 }] }, 'cmd-set-closed');
    expect(setAfterClose.statusCode).toBe(409);
    expect(setAfterClose.json().error.code).toBe('BUSINESS_DAY_NOT_OPEN');
    const addAfterClose = await post(hub, admin, 'add-precooked-stock', 'AddPrecookedStock', { entries: [{ stock_item_id: 'I3', quantity: 100 }] }, 'cmd-add-closed');
    expect(addAfterClose.statusCode).toBe(409);
    expect(addAfterClose.json().error.code).toBe('BUSINESS_DAY_NOT_OPEN');
    expect(stockEvents()).toBe(stockBefore);
    expect(hub.deps.db.prepare("SELECT COUNT(*) FROM processed_commands WHERE command_id IN ('cmd-set-closed', 'cmd-add-closed')").pluck().get()).toBe(0);

    const replay = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close-2300');
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(closed.json());

    const again = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close-again');
    expect(again.json().data.result).toEqual({
      business_date: '2026-10-25',
      opened_at: at(6),
      closed_at: at(23),
      changed: false,
      reason: 'not_open',
    });
    expect(eventsOf(hub, 'BusinessDayClosed')).toHaveLength(1);

    hub.clock.set(at(24 + 6));
    const next = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-day2');
    expect(next.json().data.result).toEqual({ business_date: '2026-10-26', opened_at: at(30), changed: true, reason: 'opened' });
    expect(eventsOf(hub, 'BusinessDayOpened').map((e) => e.payload)).toEqual([
      { business_date: '2026-10-25', stock_units: STOCK_UNITS, draws: DRAWS },
      { business_date: '2026-10-26', stock_units: STOCK_UNITS, draws: DRAWS },
    ]);
    expect(engine(hub).business_day).toMatchObject({ business_date: '2026-10-26', stock_units: STOCK_UNITS, draws: DRAWS });
  });

  it('[01a §6.18b] CloseBusinessDay before any day was opened → not_open with null fields', async () => {
    const hub = await open();
    const admin = adminOn(hub, 'S_MGR');
    const closed = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close-none');
    expect(closed.statusCode).toBe(200);
    expect(closed.json().data.result).toEqual({ business_date: null, opened_at: null, closed_at: null, changed: false, reason: 'not_open' });
    expect(eventsOf(hub, 'BusinessDayClosed')).toEqual([]);
  });

  it('[01a §6.18b A-14] StockReleased { day_closed } before BusinessDayClosed, hidden lines and exited lines only, every draw; frozen and fired lines keep theirs', async () => {
    const { hub, admin } = await dayToClose();
    counted(hub, 'I1', 9);
    counted(hub, 'I3', 1_000, 'g');
    hidden(hub, 'O1', [{ id: 'H', draws: [{ stock_item_id: 'I1', quantity: 1 }, { stock_item_id: 'I3', quantity: 250 }], from_stock: true }]);
    frozen(hub, 'O2', [{ id: 'Z', draws: [{ stock_item_id: 'I1', quantity: 1 }], from_stock: true }]);
    frozen(hub, 'O3', [{ id: 'W', draws: [{ stock_item_id: 'I1', quantity: 1 }], from_stock: true }]);
    fired(hub, 'W');
    frozen(hub, 'O4', [{ id: 'S', draws: [{ stock_item_id: 'I1', quantity: 1 }], from_stock: true }]);
    served(hub, 'O4', 'S'); // served without a Start: exited, still holding its reservation
    hub.clock.advance(1_000);
    const now = hub.clock.branchNow();
    const day = engine(hub).business_day!;
    const before = lastSeq(hub);

    const res = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close');

    expect(res.statusCode).toBe(200);
    expect(logAfter(hub, before)).toEqual([
      { type: 'StockReleased', id: 'I1', line: 'H', q: 1, reason: 'day_closed' },
      { type: 'StockReleased', id: 'I3', line: 'H', q: 250, reason: 'day_closed' },
      { type: 'StockReleased', id: 'I1', line: 'S', q: 1, reason: 'day_closed' },
      { type: 'BusinessDayClosed' },
    ]);
    const rows = rowsAfter(hub, before);
    for (const row of rows) expect(row).toMatchObject({ occurred_at: now, recorded_at: now, actor_id: 'S_MGR', device_id: admin.device.deviceId });
    expect(rows.map((row) => [row.stream_type, row.stream_id])).toEqual([['stock', 'I1'], ['stock', 'I3'], ['stock', 'I1'], ['hub', 'branch-1']]);
    expect(res.json().data.event_ids).toEqual(rows.map((row) => row.event_id));
    // The result's closed_at is the BusinessDayClosed event's recorded_at; shape unchanged.
    expect(res.json().data.result).toEqual({
      business_date: day.business_date,
      opened_at: day.opened_at,
      closed_at: rows[3]!.recorded_at,
      changed: true,
      reason: 'closed',
    });
    expect(engine(hub).business_day!.closed_at).toBe(rows[3]!.recorded_at);
    expect(engine(hub).stock.I1).toMatchObject({ on_hand: 9, reserved: 2 });
    expect(engine(hub).stock.I3).toMatchObject({ on_hand: 1_000, reserved: 0 });
    expect(engine(hub).lines.H).toMatchObject({ from_stock: false, reserved_seq: null, cook_ms: COOK });
    expect(engine(hub).lines.Z!.reserved_seq).not.toBeNull();
    expect(engine(hub).lines.W!.reserved_seq).not.toBeNull();
    expectSameAsReplay(hub);

    const replay = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close');
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(res.json());
    expect(rowsAfter(hub, before)).toHaveLength(4);
  });

  it('[01a §6.18b A-14] the no-op paths append nothing, with reservations a close would release', async () => {
    const hub = await open();
    withConfig(aBranchConfigItemStock());
    const admin = adminOn(hub, 'S_MGR');
    expect((await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open')).statusCode).toBe(200);
    seed(hub, [anEngineConfigApplied()]);
    counted(hub, 'I1', 9);
    hidden(hub, 'O1', [{ id: 'H', draws: [{ stock_item_id: 'I1', quantity: 1 }], from_stock: true }]);
    const before = lastSeq(hub);
    const recent = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-recent');
    expect(recent.json().data.result).toMatchObject({ changed: false, reason: 'opened_recently', closed_at: null });
    expect(recent.json().data.event_ids).toEqual([]);
    expect(logAfter(hub, before)).toEqual([]);
    expect(engine(hub).lines.H!.reserved_seq).not.toBeNull();

    hub.clock.advance(5 * 3_600_000);
    expect((await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close')).json().data.result.reason).toBe('closed');
    const closedSeq = lastSeq(hub);
    const notOpen = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-again');
    expect(notOpen.json().data.result).toMatchObject({ changed: false, reason: 'not_open' });
    expect(notOpen.json().data.event_ids).toEqual([]);
    expect(logAfter(hub, closedSeq)).toEqual([]);
  });

  it('[01a §6.18b A-14] a close with no branch config still releases: the close needs no stock context', async () => {
    const { hub, admin } = await dayToClose();
    counted(hub, 'I1', 9);
    hidden(hub, 'O1', [{ id: 'H', draws: [{ stock_item_id: 'I1', quantity: 1 }], from_stock: true }]);
    swapBranchConfig(null);
    const before = lastSeq(hub);
    const res = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close');
    expect(res.statusCode).toBe(200);
    expect(logAfter(hub, before)).toEqual([{ type: 'StockReleased', id: 'I1', line: 'H', q: 1, reason: 'day_closed' }, { type: 'BusinessDayClosed' }]);
  });

  it('[01a §6.18b A-14] the releases and BusinessDayClosed are one transaction: a forced COMMIT failure writes none of them and keeps the day open; the retry appends the whole batch', async () => {
    let fail = false;
    const { hub, admin } = await dayToClose({
      beforeCommit() {
        if (fail) throw new Error('forced commit failure');
      },
    });
    counted(hub, 'I1', 9);
    hidden(hub, 'O1', [{ id: 'H', draws: [{ stock_item_id: 'I1', quantity: 1 }], from_stock: true }]);
    const state = engine(hub);
    const before = lastSeq(hub);
    fail = true;
    expect((await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-fail')).statusCode).toBe(500);
    expect(rowsAfter(hub, before)).toEqual([]);
    expect(engine(hub)).toBe(state);
    expect(engine(hub).business_day!.closed_at).toBeNull();
    fail = false;
    expect((await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-fail')).statusCode).toBe(200);
    expect(logAfter(hub, before)).toEqual([{ type: 'StockReleased', id: 'I1', line: 'H', q: 1, reason: 'day_closed' }, { type: 'BusinessDayClosed' }]);
  });

  it('[01a §6.18b A-14] the statement count changes only by the appends: each release adds one INSERT', async () => {
    const closeCount = async (lines: LineSpec[]): Promise<{ statements: number; events: number }> => {
      const { hub, admin } = await dayToClose();
      counted(hub, 'I1', 9);
      lines.forEach((line, i) => hidden(hub, `O${i}`, [line], i * 100_000));
      const counter = statementCounter(hub.deps.db);
      const res = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close');
      const statements = counter.count;
      return { statements, events: (res.json().data.event_ids as string[]).length };
    };
    const line = (id: string): LineSpec => ({ id, draws: [{ stock_item_id: 'I1', quantity: 1 }], from_stock: true });
    const plain = await closeCount([]);
    const withReleases = await closeCount([line('A'), line('B')]);
    expect(plain.events).toBe(1);
    expect(withReleases.events).toBe(3);
    expect(withReleases.statements).toBe(plain.statements + 2);
  });
});

// aBranchConfigItemStock (01c §5.1): I1 and I3 are stock items under their own ids.
const STOCK_UNITS = { I1: 'piece', I3: 'g' };
const DRAWS = {
  I1: { sale_unit: 'piece', stock_draws: [{ stock_item_id: 'I1', quantity_per_sale_unit: 1 }] },
  I3: { sale_unit: 'piece', stock_draws: [{ stock_item_id: 'I3', quantity_per_sale_unit: 250 }] },
};

// Local wall-clock hours on 2026-10-25 (the hub's zone, as business_date).
function at(hours: number, minutes = 0): number {
  return new Date(2026, 9, 25, hours, minutes).getTime();
}

function carrying(config: BranchConfig, stockItemId: string): BranchConfig {
  return {
    ...config,
    stock_items: config.stock_items.map((s) => (s.stock_item_id === stockItemId ? { ...s, carries_over: true } : s)),
  };
}

function countStock(hub: TestHub, entries: Array<{ item_id: string; on_hand: number; unit: 'piece' | 'g' | 'ml' }>): void {
  hub.deps.writer.run((tx) =>
    tx.append(
      entries.map((payload) => ({
        stream_type: 'stock' as const,
        stream_id: payload.item_id,
        event_type: 'StockSet',
        schema_version: 1,
        payload,
        occurred_at: hub.clock.branchNow(),
        actor_id: null,
        device_id: 'hub',
      })),
    ),
  );
}

function stockItem(config: BranchConfig, stockItemId: string): ConfigStockItem {
  const found = config.stock_items.find((candidate) => candidate.stock_item_id === stockItemId);
  if (found === undefined) throw new Error(`no stock item ${stockItemId}`);
  return found;
}

function available(hub: TestHub, config: BranchConfig, stockItemId: string): number {
  const state = engine(hub);
  return availableStock(state, stockItemId, openDayStartMs(state), stockItem(config, stockItemId));
}

function level(hub: TestHub, config: BranchConfig, stockItemId: string): string {
  const state = engine(hub);
  return stockLevel(state, stockItemId, openDayStartMs(state), stockItem(config, stockItemId));
}

async function open(testHooks?: { beforeCommit?: () => void }): Promise<TestHub> {
  const hub = await createTestHub(testHooks === undefined ? undefined : { testHooks });
  cleanups.push(() => hub.close());
  hub.clock.set(at(0));
  // These tests move the clock by hours; long idle TTLs keep the admin sessions alive.
  const directory = await aDirectory();
  for (const role of directory.roles) role.session_idle_ttl_ms = 7 * 86_400_000;
  // S_OWNER keeps access-hub-admin but not manage-stock, so the command's own 403 is reached.
  for (const staff of directory.staff) if (staff.staff_id === 'S_OWNER') staff.denied_permissions = ['manage-stock'];
  await seedDirectory(hub, directory);
  return hub;
}

function withConfig(config: BranchConfig): void {
  swapBranchConfig({ config, snapshotHash: 'h'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 2, appliedAt: 0 });
}

function adminOn(hub: TestHub, staffId: string): Admin {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'admin', staffId, deviceId: device.deviceId });
  return { device, session };
}

function post(hub: TestHub, admin: Admin, name: string, commandType: string, payload: Record<string, unknown>, commandId: string, actorId = 'S_MGR') {
  return hub.app.inject({
    method: 'POST',
    url: `/admin/commands/${name}`,
    headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
    payload: {
      command_id: commandId,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: commandType,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: actorId,
      device_id: admin.device.deviceId,
    },
  });
}

function engine(hub: TestHub): EngineState {
  return hub.deps.state.get();
}

function eventsOf(hub: TestHub, eventType: string): Array<{ stream_type: string; stream_id: string; payload: unknown }> {
  const rows = hub.deps.db
    .prepare('SELECT stream_type, stream_id, payload FROM events WHERE event_type = ? ORDER BY seq')
    .all(eventType) as Array<{ stream_type: string; stream_id: string; payload: string }>;
  return rows.map((row) => ({ stream_type: row.stream_type, stream_id: row.stream_id, payload: JSON.parse(row.payload) }));
}

// A day past the minimum gap (4 h), with the engine's config applied.
async function dayToClose(testHooks?: { beforeCommit?: () => void }): Promise<{ hub: TestHub; admin: Admin }> {
  const hub = await open(testHooks);
  withConfig(aBranchConfigItemStock());
  const admin = adminOn(hub, 'S_MGR');
  const opened = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-day');
  if (opened.statusCode !== 200) throw new Error(`open failed: ${opened.body}`);
  hub.clock.advance(5 * 3_600_000);
  seed(hub, [anEngineConfigApplied()]);
  return { hub, admin };
}

function served(hub: TestHub, order_id: string, order_item_id: string): void {
  seed(hub, [{ ...anItemStarted(), event_type: 'ItemServed', stream_id: order_id, payload: { order_item_ids: [order_item_id], source: 'tap' } }]);
}

// 03a lines through a real fold (A-14): the engine config and the §4.2 submit batches go through the hub's event
// store, so the command's ctx.state is what applyEvent makes of them.
const COOK = 1_200_000;
const STOCK_COOK = 60_000;
type Draw = { stock_item_id: string; quantity: number };
type LineSpec = { id: string; draws: Draw[]; from_stock?: boolean };
type Row = { event_id: string; tenant_id: string; branch_id: string; stream_type: PosEvent['stream_type']; stream_id: string; event_type: string; schema_version: number; payload: string; occurred_at: number; recorded_at: number; actor_id: string | null; device_id: string; seq: number };

function seed(hub: TestHub, events: PosEvent[]): void {
  const occurred_at = hub.clock.branchNow();
  hub.deps.writer.run((tx) => tx.append(events.map((event) => ({ ...event, occurred_at }))));
}

function counted(hub: TestHub, stock_item_id: string, on_hand: number, unit: 'piece' | 'g' = 'piece'): void {
  seed(hub, [aStockSet({ stream_id: stock_item_id, payload: { stock_item_id, on_hand, unit } })]);
}

function submit(hub: TestHub, order_id: string, lines: LineSpec[], land: number, pickup?: number): void {
  seed(
    hub,
    anOrderBatch({
      order_id,
      lines: lines.map((l) => ({
        order_item_id: l.id,
        item: { name: 'Seekh kebab', quantity: 1, stock_time_ms: STOCK_COOK, stock_draws: l.draws, out_of_stock_behaviour: 'cook_fresh' },
        line: { from_stock: l.from_stock ?? false },
      })),
      order: {
        groups: [{ group_id: `${order_id}:0`, target_land_ms: land, promise_ms: land + 180_000, order_item_ids: lines.map((l) => l.id) }],
        ...(pickup === undefined ? {} : { order_type: 'delivery', pickup_at_ms: pickup }),
      },
      reserved: lines.filter((l) => l.from_stock === true).flatMap((l) => l.draws.map((d) => ({ ...d, order_item_id: l.id }))),
    }),
  );
}

// A delivery picked up in an hour or later: its lines are hidden (fire_ms > now + freeze_ms).
function hidden(hub: TestHub, order_id: string, lines: LineSpec[], later = 0): void {
  const pickup = hub.clock.branchNow() + 3_600_000 + later;
  submit(hub, order_id, lines, pickup, pickup);
}

// A land this close fires at once: frozen (on the chef's Next list).
function frozen(hub: TestHub, order_id: string, lines: LineSpec[]): void {
  submit(hub, order_id, lines, hub.clock.branchNow() + COOK + 30_000);
}

function fired(hub: TestHub, order_item_id: string): void {
  seed(hub, [aFireDispatched({ payload: { station_id: 'S1', order_item_ids: [order_item_id], load_id: null, due_at: hub.clock.branchNow(), reason: 'scheduled' } })]);
}

function lastSeq(hub: TestHub): number {
  return hub.deps.db.prepare('SELECT COALESCE(MAX(seq), 0) FROM events').pluck().get() as number;
}

function rowsAfter(hub: TestHub, seq: number): Row[] {
  return hub.deps.db.prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq').all(seq) as Row[];
}

// The real event log after `seq`, in seq order.
function logAfter(hub: TestHub, seq: number): Array<Record<string, unknown>> {
  return rowsAfter(hub, seq).map((row) => {
    const p = JSON.parse(row.payload) as Record<string, unknown>;
    return {
      type: row.event_type,
      ...(typeof p.stock_item_id === 'string' ? { id: p.stock_item_id } : {}),
      ...(typeof p.order_item_id === 'string' ? { line: p.order_item_id } : {}),
      ...(typeof p.quantity === 'number' ? { q: p.quantity } : {}),
      ...(typeof p.on_hand === 'number' ? { on_hand: p.on_hand } : {}),
      ...(typeof p.unit === 'string' ? { unit: p.unit } : {}),
      ...(typeof p.reason === 'string' ? { reason: p.reason } : {}),
    };
  });
}

// Every event of the log folded from nothing: what a restart rebuilds must be what the commit swapped in.
function replayed(hub: TestHub): EngineState {
  return rowsAfter(hub, 0).reduce(
    (state, row) => applyEvent(state, parseEvent({ ...row, payload: JSON.parse(row.payload) as PosEvent['payload'] }), { strict: false }),
    initialEngineState(),
  );
}

function expectSameAsReplay(hub: TestHub): void {
  const live = hub.deps.state.get();
  const again = replayed(hub);
  expect(again.stock).toEqual(live.stock);
  expect(again.lines).toEqual(live.lines);
  expect(live.diagnostics.filter((d) => d.kind === 'stock_breach')).toEqual([]);
}
