import type { EngineState } from '@pos/engine';
import type { BranchConfig } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { foldEngineEvents } from '../../src/sync/boot-steps';
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
});

async function open(testHooks?: { beforeCommit?: () => void }): Promise<TestHub> {
  const hub = await createTestHub(testHooks === undefined ? undefined : { testHooks });
  cleanups.push(() => hub.close());
  await seedDirectory(hub);
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
