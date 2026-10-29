import { availableStock, openDayStartMs, stockLevel, type EngineState } from '@pos/engine';
import type { BranchConfig, ConfigStockItem } from '@pos/events';
import { aBranchConfigItemStock } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { foldEngineEvents } from '../../src/sync/boot-steps';
import { aDirectory } from '../helpers/fixtures';
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
