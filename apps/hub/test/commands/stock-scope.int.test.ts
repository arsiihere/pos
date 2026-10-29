import type { DirectoryInput } from '@pos/events';
import type { BranchConfigV1 } from '@pos/events';
import { aBranchConfigV1 } from '@pos/events/testing';
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
      await command(hub, counter, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ stock_item_id: 'I1', on_hand: 3 }, { stock_item_id: 'I3', on_hand: 500 }] }, 'cmd-set-out'),
      await command(hub, counter, 'add-precooked-stock', 'AddPrecookedStock', { entries: [{ stock_item_id: 'I3', quantity: 250 }, { stock_item_id: 'I1', quantity: 1 }] }, 'cmd-add-out'),
      await command(hub, counter, 'set-item-availability', 'SetItemAvailability', { item_id: 'I3', is_available: false }, 'cmd-off-out'),
    ];
    // 01c §6.18: the stock commands name stock items (I3 through the V2 view); SetItemAvailability names items.
    for (const [response, key] of [[refused[0]!, 'stock_item_ids'], [refused[1]!, 'stock_item_ids'], [refused[2]!, 'item_ids']] as const) {
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json().error).toMatchObject({
        code: 'PERMISSION_DENIED',
        details: { permission: 'manage-stock', reason: 'outside_scope', [key]: ['I3'] },
      });
    }
    expect(stockEvents(hub)).toBe(before);
    expect(processed(hub, ['cmd-set-out', 'cmd-add-out', 'cmd-off-out'])).toBe(0);

    // Inside the counter's stations → 200.
    expect((await command(hub, counter, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ stock_item_id: 'I1', on_hand: 3 }] }, 'cmd-set-in')).statusCode).toBe(200);
    expect((await command(hub, counter, 'add-precooked-stock', 'AddPrecookedStock', { entries: [{ stock_item_id: 'I1', quantity: 2 }] }, 'cmd-add-in')).statusCode).toBe(200);
    expect((await command(hub, counter, 'set-item-availability', 'SetItemAvailability', { item_id: 'I2', is_available: false }, 'cmd-off-in')).statusCode).toBe(200);

    // Scope branch: every item, as in 01a.
    expect((await command(hub, manager, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ stock_item_id: 'I3', on_hand: 500 }] }, 'cmd-set-mgr')).statusCode).toBe(200);
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

  it('[01b B20] R-2: a scope change mid-session reaches the next poll with the old versions (new stations, then scope branch)', async () => {
    const hub = await open();
    const counter = adminOn(hub, 'S_CNT');
    const first = (await query(hub, counter)).json().data;
    expect(first.items_meta.map((row: { item_id: string }) => row.item_id)).toEqual(['I1', 'I2']);

    // The owner also gives the counter S2; the directory syncs.
    const directory = await aDirectory();
    const counterStaff = { ...directory.staff.find((staff) => staff.staff_id === 'S_CASH')!, staff_id: 'S_CNT', display_name: 'Counter', role_ids: ['R_CNT'] };
    const counterRole = {
      role_id: 'R_CNT',
      name: 'Stock counter',
      session_idle_ttl_ms: 3_600_000,
      permissions: [
        { permission: 'access-hub-admin' as const, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope: 'branch' as const },
        { permission: 'manage-stock' as const, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope: 'my_stations' as const },
      ],
    };
    directory.roles.push(counterRole);
    directory.staff.push(counterStaff);
    directory.responsibilities = [{ responsibility: 'count_stock', station_id: 'S1', staff_ids: ['S_CNT'], role_ids: [] }, { responsibility: 'count_stock', station_id: 'S2', staff_ids: ['S_CNT'], role_ids: [] }];
    let version = directory.directory_version + 1;
    const resync = () => seedDirectory(hub, { ...directory, directory_version: (version += 1) });
    await resync();
    const second = (await query(hub, counter, first)).json().data;
    expect(second.unchanged).toBe(false);
    expect(second.meta_version).not.toBe(first.meta_version);
    expect(second.items_meta.map((row: { item_id: string }) => row.item_id)).toEqual(['I1', 'I2', 'I3']);
    expect(second.items.map((row: { item_id: string }) => row.item_id)).toEqual(['I1', 'I2', 'I3']);

    // Back to S1 only, then the role's scope becomes branch.
    directory.responsibilities = [{ responsibility: 'count_stock', station_id: 'S1', staff_ids: ['S_CNT'], role_ids: [] }];
    await resync();
    const third = (await query(hub, counter, second)).json().data;
    expect(third.items_meta.map((row: { item_id: string }) => row.item_id)).toEqual(['I1', 'I2']);
    counterRole.permissions[1]!.scope = 'branch' as never;
    await resync();
    const fourth = (await query(hub, counter, third)).json().data;
    expect(fourth.items_meta.map((row: { item_id: string }) => row.item_id)).toEqual(['I1', 'I2', 'I3']);
    expect(fourth.items.map((row: { item_id: string }) => row.item_id)).toEqual(['I1', 'I2', 'I3']);

    // Nothing moved: unchanged again.
    expect((await query(hub, counter, fourth)).json().data.unchanged).toBe(true);
  });

  it('[01b #68] my_stations: OpenBusinessDay and CloseBusinessDay → 403 outside_scope with required_scope branch, no event; scope branch opens and closes as in 01a', async () => {
    const hub = await open();
    const manager = adminOn(hub, 'S_MGR');
    const counter = adminOn(hub, 'S_CNT');
    const before = hubEvents(hub);
    for (const [name, type, id] of [['open-business-day', 'OpenBusinessDay', 'cmd-open-cnt'], ['close-business-day', 'CloseBusinessDay', 'cmd-close-cnt-1']] as const) {
      const refused = await command(hub, counter, name, type, {}, id);
      expect(refused.statusCode, refused.body).toBe(403);
      expect(refused.json().error).toMatchObject({
        code: 'PERMISSION_DENIED',
        details: { permission: 'manage-stock', reason: 'outside_scope', required_scope: 'branch' },
      });
    }
    expect(hubEvents(hub)).toBe(before);

    // Scope branch: opens; the counter still cannot close the open day.
    const opened = await command(hub, manager, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-mgr');
    expect(opened.statusCode, opened.body).toBe(200);
    expect(opened.json().data.result).toMatchObject({ changed: true, reason: 'opened' });
    const afterOpen = hubEvents(hub);
    const refusedClose = await command(hub, counter, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close-cnt-2');
    expect(refusedClose.statusCode).toBe(403);
    expect(refusedClose.json().error.details).toMatchObject({ reason: 'outside_scope', required_scope: 'branch' });
    expect(hubEvents(hub)).toBe(afterOpen);
    expect(processed(hub, ['cmd-open-cnt', 'cmd-close-cnt-1', 'cmd-close-cnt-2'])).toBe(0);
  });

  it('[01b §4.4 row 13] the stock query returns manage_stock_scope for the session: my_stations for the counter, branch for the manager', async () => {
    const hub = await open();
    const counter = (await query(hub, adminOn(hub, 'S_CNT'))).json().data;
    expect(counter.manage_stock_scope).toBe('my_stations');
    const manager = (await query(hub, adminOn(hub, 'S_MGR'))).json().data;
    expect(manager.manage_stock_scope).toBe('branch');
    // On an unchanged poll too.
    const again = (await query(hub, adminOn(hub, 'S_CNT'), counter)).json().data;
    expect(again.unchanged).toBe(true);
    expect(again.manage_stock_scope).toBe('my_stations');
  });
});

function hubEvents(hub: TestHub): number {
  return hub.deps.db.prepare("SELECT COUNT(*) FROM events WHERE stream_type = 'hub'").pluck().get() as number;
}

// S1 (I1, I2) and S2 (I3); every item stock-tracked.
function twoStations(): BranchConfigV1 {
  const base = aBranchConfigV1();
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

function query(hub: TestHub, admin: Admin, versions?: { meta_version: string; stock_version: number }) {
  return hub.app.inject({
    method: 'GET',
    url: '/admin/queries/stock',
    query: versions === undefined ? {} : { meta_version: versions.meta_version, stock_version: String(versions.stock_version) },
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
