import { availableStock, openDayStartMs, stockLevel, type EngineState } from '@pos/engine';
import type { BranchConfig } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
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
    withConfig(aBranchConfig());
    const admin = adminOn(hub, 'S_MGR');
    const now = hub.clock.branchNow();

    const opened = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-1');
    expect(opened.statusCode).toBe(200);
    const date = localDate(now);
    expect(opened.json().data.result).toEqual({ business_date: date, opened_at: now, changed: true, reason: 'opened' });
    const units = {
      I1: { stock_unit: 'piece', sale_unit: 'piece', stock_per_sale_unit: 1 },
      I3: { stock_unit: 'g', sale_unit: 'piece', stock_per_sale_unit: 250 },
    };
    expect(eventsOf(hub, 'BusinessDayOpened')).toEqual([
      { stream_type: 'hub', stream_id: 'branch-1', payload: { business_date: date, units } },
    ]);
    const day = { business_date: date, opened_at: now, closed_at: null, units };
    expect(engine(hub).business_day).toEqual(day);

    hub.clock.advance(60_000);
    const again = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-2');
    expect(again.statusCode).toBe(200);
    expect(again.json().data.result).toEqual({ business_date: date, opened_at: now, changed: false, reason: 'already_open' });
    expect(again.json().data.event_ids).toEqual([]);
    expect(eventsOf(hub, 'BusinessDayOpened')).toHaveLength(1);

    // Restart: boot step 3 folds the log into the same business_day.
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

    let fail = false;
    const failing = await open({
      beforeCommit() {
        if (fail) throw new Error('forced commit failure');
      },
    });
    withConfig(aBranchConfig());
    const failAdmin = adminOn(failing, 'S_MGR');
    fail = true;
    const failed = await post(failing, failAdmin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-fail');
    expect(failed.statusCode).toBe(500);
    expect(engine(failing).business_day).toBeNull();
    expect(eventsOf(failing, 'BusinessDayOpened')).toEqual([]);
  });

  it('[01a §6.18a] with no config the day opens with empty units; a non-empty payload → 400', async () => {
    const hub = await open();
    const admin = adminOn(hub, 'S_MGR');
    const extra = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', { end_current_day: true }, 'cmd-open-extra');
    expect(extra.statusCode).toBe(400);
    expect(extra.json().error.code).toBe('VALIDATION_FAILED');
    const opened = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-empty');
    expect(opened.statusCode).toBe(200);
    expect(engine(hub).business_day?.units).toEqual({});
  });

  it('[01a §10 #143] close at exactly day_min_gap_hours then open: a new day; a non-carrying count reads not_counted, a carrying one keeps its stock', async () => {
    const hub = await open();
    const config = carrying(aBranchConfig(), 'I3');
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
      business_date: localDate(at(6)),
      opened_at: at(6),
      closed_at: at(10),
      changed: true,
      reason: 'closed',
    });
    expect(eventsOf(hub, 'BusinessDayClosed')).toEqual([{ stream_type: 'hub', stream_id: 'branch-1', payload: {} }]);
    expect(engine(hub).business_day?.closed_at).toBe(at(10));

    const reopened = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-1000');
    expect(reopened.json().data.result).toMatchObject({ opened_at: at(10), changed: true, reason: 'opened' });
    expect(engine(hub).business_day).toMatchObject({ opened_at: at(10), closed_at: null });
    expect(available(hub, config, 'I1')).toBe(0);
    expect(level(hub, config, 'I1')).toBe('not_counted');
    expect(available(hub, config, 'I3')).toBe(2_000);
  });

  it('[01a §10 #144] a close inside day_min_gap_hours is a no-op; a smaller gap in the snapshot allows it; a hub clock moved back is recent; retransmit replays', async () => {
    const hub = await open();
    withConfig(aBranchConfig());
    const admin = adminOn(hub, 'S_MGR');
    hub.clock.set(at(6));
    await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-0600');

    hub.clock.set(at(9, 59));
    const early = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close-0959');
    expect(early.statusCode).toBe(200);
    expect(early.json().data.result).toEqual({
      business_date: localDate(at(6)),
      opened_at: at(6),
      closed_at: null,
      changed: false,
      reason: 'opened_recently',
    });
    expect(early.json().data.event_ids).toEqual([]);
    expect(eventsOf(hub, 'BusinessDayClosed')).toEqual([]);
    expect(engine(hub).business_day?.closed_at).toBeNull();

    withConfig(aBranchConfig({ day_min_gap_hours: 2 }));
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
    const config = carrying(aBranchConfig(), 'I3');
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

    const replay = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close-2300');
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(closed.json());

    const again = await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close-again');
    expect(again.json().data.result).toEqual({
      business_date: localDate(at(6)),
      opened_at: at(6),
      closed_at: at(23),
      changed: false,
      reason: 'not_open',
    });
    expect(eventsOf(hub, 'BusinessDayClosed')).toHaveLength(1);

    hub.clock.set(at(24 + 6));
    const next = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-day2');
    expect(next.json().data.result).toEqual({ business_date: localDate(at(30)), opened_at: at(30), changed: true, reason: 'opened' });
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

// Local wall-clock hours on 2026-10-25 (the hub's zone, as business_date).
function at(hours: number, minutes = 0): number {
  return new Date(2026, 9, 25, hours, minutes).getTime();
}

function carrying(config: BranchConfig, itemId: string): BranchConfig {
  return { ...config, items: config.items.map((item) => (item.item_id === itemId ? { ...item, carries_over: true } : item)) };
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

function item(config: BranchConfig, itemId: string) {
  const found = config.items.find((candidate) => candidate.item_id === itemId);
  if (found === undefined) throw new Error(`no item ${itemId}`);
  return found;
}

function available(hub: TestHub, config: BranchConfig, itemId: string): number {
  const state = engine(hub);
  return availableStock(state, itemId, openDayStartMs(state), item(config, itemId));
}

function level(hub: TestHub, config: BranchConfig, itemId: string): string {
  const state = engine(hub);
  return stockLevel(state, itemId, openDayStartMs(state), item(config, itemId));
}

async function open(testHooks?: { beforeCommit?: () => void }): Promise<TestHub> {
  const hub = await createTestHub(testHooks === undefined ? undefined : { testHooks });
  cleanups.push(() => hub.close());
  hub.clock.set(at(0));
  // These tests move the clock by hours; long idle TTLs keep the admin sessions alive.
  const directory = await aDirectory();
  for (const role of directory.roles) role.session_idle_ttl_ms = 7 * 86_400_000;
  await seedDirectory(hub, directory);
  return hub;
}

function withConfig(config: BranchConfig): void {
  swapBranchConfig({ config, snapshotHash: 'h'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 1, appliedAt: 0 });
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

function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
