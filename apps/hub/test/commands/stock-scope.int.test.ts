import type { DirectoryInput } from '@pos/events';
import type { BranchConfig } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

type Admin = { staffId: string; device: { deviceId: string; token: string }; session: { sessionId: string; token: string } };

const cleanups: Array<() => Promise<void>> = [];

describe('manage-stock scope my_stations on the stock page and its item commands (01b B20, §4.4 rows 9–10)', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[01b #34] my_stations: the stock query lists only the counter\'s stations\' items; SetPrecookedStock, AddPrecookedStock, SetItemAvailability with an outside item → 403 outside_scope, nothing appended; scope branch unchanged', async () => {
    const hub = await open();
    const manager = adminOn(hub, 'S_MGR');
    const counter = adminOn(hub, 'S_CNT');
    expect((await command(hub, manager, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open')).statusCode).toBe(200);

    // The stock query: only S1's items (I1, I2) for the counter, every item for the manager; 1 statement each.
    const mine = statementCounter(hub.deps.readDb);
    const scoped = await query(hub, counter);
    expect(scoped.statusCode, scoped.body).toBe(200);
    expect(mine.count).toBe(1);
    expect(scoped.json().data.items_meta.map((row: { item_id: string }) => row.item_id)).toEqual(['I1', 'I2']);
    expect(scoped.json().data.items.map((row: { item_id: string }) => row.item_id)).toEqual(['I1', 'I2']);
    const all = statementCounter(hub.deps.readDb);
    const branch = await query(hub, manager);
    expect(all.count).toBe(1);
    expect(branch.json().data.items.map((row: { item_id: string }) => row.item_id)).toEqual(['I1', 'I2', 'I3']);

    // Item commands with an item routed to S2 → 403, nothing appended, no processed row.
    const before = stockEvents(hub);
    const refused = [
      await command(hub, counter, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ item_id: 'I1', on_hand: 3 }, { item_id: 'I3', on_hand: 500 }] }, 'cmd-set-out'),
      await command(hub, counter, 'add-precooked-stock', 'AddPrecookedStock', { entries: [{ item_id: 'I3', quantity: 250 }, { item_id: 'I1', quantity: 1 }] }, 'cmd-add-out'),
      await command(hub, counter, 'set-item-availability', 'SetItemAvailability', { item_id: 'I3', is_available: false }, 'cmd-off-out'),
    ];
    for (const response of refused) {
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json().error).toMatchObject({
        code: 'PERMISSION_DENIED',
        details: { permission: 'manage-stock', reason: 'outside_scope', item_ids: ['I3'] },
      });
    }
    expect(stockEvents(hub)).toBe(before);
    expect(processed(hub, ['cmd-set-out', 'cmd-add-out', 'cmd-off-out'])).toBe(0);

    // Inside the counter's stations → 200.
    expect((await command(hub, counter, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ item_id: 'I1', on_hand: 3 }] }, 'cmd-set-in')).statusCode).toBe(200);
    expect((await command(hub, counter, 'add-precooked-stock', 'AddPrecookedStock', { entries: [{ item_id: 'I1', quantity: 2 }] }, 'cmd-add-in')).statusCode).toBe(200);
    expect((await command(hub, counter, 'set-item-availability', 'SetItemAvailability', { item_id: 'I2', is_available: false }, 'cmd-off-in')).statusCode).toBe(200);

    // Scope branch: every item, as in 01a.
    expect((await command(hub, manager, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ item_id: 'I3', on_hand: 500 }] }, 'cmd-set-mgr')).statusCode).toBe(200);
    expect((await command(hub, manager, 'set-item-availability', 'SetItemAvailability', { item_id: 'I3', is_available: false }, 'cmd-off-mgr')).statusCode).toBe(200);
  });

  it('[01b B20] a my_stations holder with no stations sees no items and may change none', async () => {
    const hub = await open({ responsibilities: [] });
    const counter = adminOn(hub, 'S_CNT');
    const response = await query(hub, counter);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.items).toEqual([]);
    expect(response.json().data.items_meta).toEqual([]);
    const refused = await command(hub, counter, 'set-item-availability', 'SetItemAvailability', { item_id: 'I1', is_available: false }, 'cmd-none');
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.details).toMatchObject({ reason: 'outside_scope', item_ids: ['I1'] });
  });
});

// S1 (I1, I2) and S2 (I3); every item stock-tracked.
function twoStations(): BranchConfig {
  const base = aBranchConfig();
  return {
    ...base,
    stations: [...base.stations, { ...base.stations[0]!, station_id: 'S2', name: 'Grill' }],
    items: base.items.map((item) =>
      item.item_id === 'I2' ? { ...item, stock_time_ms: 300_000 } : item.item_id === 'I3' ? { ...item, station_id: 'S2' } : item,
    ),
  };
}

// S_CNT: a stock counter (access-hub-admin, manage-stock with my_stations) counting stock at S1.
async function open(o: { responsibilities?: DirectoryInput['responsibilities'] } = {}): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  const directory = await aDirectory();
  directory.roles.push({
    role_id: 'R_CNT',
    name: 'Stock counter',
    session_idle_ttl_ms: 3_600_000,
    permissions: [
      { permission: 'access-hub-admin', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'branch' },
      { permission: 'manage-stock', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'my_stations' },
    ],
  });
  const cashier = directory.staff.find((staff) => staff.staff_id === 'S_CASH')!;
  directory.staff.push({ ...cashier, staff_id: 'S_CNT', display_name: 'Counter', role_ids: ['R_CNT'] });
  directory.responsibilities = o.responsibilities ?? [{ responsibility: 'count_stock', station_id: 'S1', staff_ids: ['S_CNT'], role_ids: [] }];
  await seedDirectory(hub, directory);
  swapBranchConfig({ config: twoStations(), snapshotHash: 'h'.repeat(64), configVersion: 1, snapshotSchemaVersion: 1, appliedAt: 0 });
  return hub;
}

function adminOn(hub: TestHub, staffId: string): Admin {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'admin', staffId, deviceId: device.deviceId });
  return { staffId, device, session };
}

function query(hub: TestHub, admin: Admin) {
  return hub.app.inject({
    method: 'GET',
    url: '/admin/queries/stock',
    headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
  });
}

function command(hub: TestHub, admin: Admin, name: string, commandType: string, payload: Record<string, unknown>, commandId: string) {
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
      actor_id: admin.staffId,
      device_id: admin.device.deviceId,
    },
  });
}

function stockEvents(hub: TestHub): number {
  return hub.deps.db.prepare("SELECT COUNT(*) FROM events WHERE stream_type = 'stock'").pluck().get() as number;
}

function processed(hub: TestHub, commandIds: string[]): number {
  return hub.deps.db
    .prepare('SELECT COUNT(*) FROM processed_commands WHERE command_id IN (SELECT value FROM json_each(?))')
    .pluck()
    .get(JSON.stringify(commandIds)) as number;
}
