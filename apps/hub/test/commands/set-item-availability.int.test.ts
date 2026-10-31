import { aBranchConfig } from '@pos/events/testing';
import type { BranchConfig } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { itemAvailability } from '../../src/projections/item-availability';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

type Admin = { device: { deviceId: string; token: string }; session: { sessionId: string; token: string } };

const cleanups: Array<() => Promise<void>> = [];

describe('SetItemAvailability (§6.18)', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[01a §10 #69] toggle off → ItemMadeUnavailable, row 0 with changed_at = recorded_at; off again → no event, changed false; on → ItemMadeAvailable', async () => {
    const hub = await open();
    withConfig(aBranchConfig());
    const admin = adminOn(hub, 'S_MGR');

    const off = await toggle(hub, admin, 'I1', false, 'cmd-off');
    expect(off.statusCode).toBe(200);
    expect(off.json().data.result).toEqual({ item_id: 'I1', is_available: false, changed: true });
    const events = stockEvents(hub);
    expect(events).toEqual([
      { event_type: 'ItemMadeUnavailable', stream_id: 'I1', payload: { item_id: 'I1' }, recorded_at: expect.any(Number) },
    ]);
    expect(row(hub, 'I1')).toEqual({ is_available: 0, changed_at: events[0]!.recorded_at, changed_by: 'S_MGR' });

    hub.clock.advance(60_000);
    const again = await toggle(hub, admin, 'I1', false, 'cmd-off-again');
    expect(again.statusCode).toBe(200);
    expect(again.json().data.result).toEqual({ item_id: 'I1', is_available: false, changed: false });
    expect(stockEvents(hub)).toHaveLength(1);
    expect(row(hub, 'I1')?.changed_at).toBe(events[0]!.recorded_at);

    hub.clock.advance(60_000);
    const on = await toggle(hub, admin, 'I1', true, 'cmd-on');
    expect(on.statusCode).toBe(200);
    expect(on.json().data.result).toEqual({ item_id: 'I1', is_available: true, changed: true });
    const after = stockEvents(hub);
    expect(after.map((event) => event.event_type)).toEqual(['ItemMadeUnavailable', 'ItemMadeAvailable']);
    expect(row(hub, 'I1')).toEqual({ is_available: 1, changed_at: after[1]!.recorded_at, changed_by: 'S_MGR' });

    // A missing row means available: turning on an item never turned off writes nothing.
    const fresh = await toggle(hub, admin, 'I2', true, 'cmd-fresh');
    expect(fresh.json().data.result).toEqual({ item_id: 'I2', is_available: true, changed: false });
    expect(stockEvents(hub)).toHaveLength(2);
  });

  it('[01a §10 #70] retransmit → replay; unknown item → 404; no manage-stock → 403', async () => {
    const hub = await open({ S_OWNER: ['manage-stock'] });
    const admin = adminOn(hub, 'S_MGR');

    const noConfig = await toggle(hub, admin, 'I1', false, 'cmd-no-config');
    expect(noConfig.statusCode).toBe(404);
    expect(noConfig.json().error.code).toBe('MENU_ITEM_NOT_FOUND');

    withConfig(aBranchConfig());
    const first = await toggle(hub, admin, 'I1', false, 'cmd-1');
    expect(first.statusCode).toBe(200);
    const replay = await toggle(hub, admin, 'I1', false, 'cmd-1');
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect(stockEvents(hub)).toHaveLength(1);

    const unknown = await toggle(hub, admin, 'I9', false, 'cmd-unknown');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('MENU_ITEM_NOT_FOUND');
    expect(unknown.json().error.details).toEqual({ item_id: 'I9' });

    const owner = adminOn(hub, 'S_OWNER');
    const denied = await toggle(hub, owner, 'I1', true, 'cmd-denied', 'S_OWNER');
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PERMISSION_DENIED');
    expect(denied.json().error.details).toMatchObject({ permission: 'manage-stock' });
    expect(stockEvents(hub)).toHaveLength(1);
    expect(row(hub, 'I1')?.is_available).toBe(0);
  });

  it('[01a §10 #71] itemAvailability(db, ids) is 1 statement for 1 and 100 ids; a missing row is available', async () => {
    const hub = await open();
    withConfig(aBranchConfig());
    const admin = adminOn(hub, 'S_MGR');
    expect((await toggle(hub, admin, 'I1', false, 'cmd-off')).statusCode).toBe(200);
    expect((await toggle(hub, admin, 'I2', false, 'cmd-off-2')).statusCode).toBe(200);
    expect((await toggle(hub, admin, 'I2', true, 'cmd-on-2')).statusCode).toBe(200);

    const counter = statementCounter(hub.deps.db);
    expect(itemAvailability(hub.deps.db, ['I1'])).toEqual(new Map([['I1', false]]));
    expect(counter.count).toBe(1);

    counter.reset();
    const ids = ['I1', 'I2', ...Array.from({ length: 98 }, (_, i) => `X${i}`)];
    const many = itemAvailability(hub.deps.db, ids);
    expect(counter.count).toBe(1);
    expect(many.size).toBe(100);
    expect(many.get('I1')).toBe(false);
    expect(many.get('I2')).toBe(true);
    expect(ids.slice(2).every((id) => many.get(id) === true)).toBe(true);
  });
});

async function open(denied: Record<string, string[]> = {}): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  const directory = await aDirectory();
  for (const staff of directory.staff) staff.denied_permissions = denied[staff.staff_id] ?? [];
  await seedDirectory(hub, directory);
  return hub;
}

function withConfig(c: BranchConfig): void {
  swapBranchConfig({ config: c, snapshotHash: 'h'.repeat(64), configVersion: c.config_version, snapshotSchemaVersion: 2, appliedAt: 0 });
}

function adminOn(hub: TestHub, staffId: string): Admin {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'admin', staffId, deviceId: device.deviceId });
  return { device, session };
}

function toggle(hub: TestHub, admin: Admin, itemId: string, isAvailable: boolean, commandId: string, actorId = 'S_MGR') {
  return hub.app.inject({
    method: 'POST',
    url: '/admin/commands/set-item-availability',
    headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
    payload: {
      command_id: commandId,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'SetItemAvailability',
      payload: { item_id: itemId, is_available: isAvailable },
      occurred_at: hub.clock.branchNow(),
      actor_id: actorId,
      device_id: admin.device.deviceId,
    },
  });
}

function row(hub: TestHub, itemId: string) {
  return hub.deps.db
    .prepare('SELECT is_available, changed_at, changed_by FROM item_availability WHERE item_id = ?')
    .get(itemId) as { is_available: number; changed_at: number; changed_by: string | null } | undefined;
}

function stockEvents(hub: TestHub): Array<{ event_type: string; stream_id: string; payload: unknown; recorded_at: number }> {
  const rows = hub.deps.db
    .prepare("SELECT event_type, stream_id, payload, recorded_at FROM events WHERE stream_type = 'stock' ORDER BY seq")
    .all() as Array<{ event_type: string; stream_id: string; payload: string; recorded_at: number }>;
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
}
