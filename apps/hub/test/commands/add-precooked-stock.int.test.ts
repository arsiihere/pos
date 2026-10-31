import type { EngineState } from '@pos/engine';
import type { BranchConfig, DirectoryInput } from '@pos/events';
import { aBranchConfigItemStock } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

type Admin = { device: { deviceId: string; token: string }; session: { sessionId: string; token: string } };
type Unit = 'piece' | 'g' | 'ml';

const cleanups: Array<() => Promise<void>> = [];

describe('AddPrecookedStock (§6.17a)', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[01a §10 #130] AddPrecookedStock adds onto a count from today and records a set otherwise; 404, 400, 403, replay, COMMIT failure; nothing written when one entry fails', async () => {
    let fail = false;
    const hub = await open({
      beforeCommit() {
        if (fail) throw new Error('forced commit failure');
      },
    }, { S_OWNER: ['manage-stock'] });
    // I1, I2, I3 and I4 stock-tracked; I4 counted in pieces though its unit is g.
    withConfig(config());
    const admin = adminOn(hub, 'S_MGR');
    countStock(hub, [{ item_id: 'I1', on_hand: 9, unit: 'piece' }]); // before the day opens
    hub.clock.advance(60_000);
    const opened = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open');
    expect(opened.statusCode).toBe(200);
    hub.clock.advance(60_000);
    const countedAt = hub.clock.branchNow();
    countStock(hub, [
      { item_id: 'I3', on_hand: 1_000, unit: 'g' },
      { item_id: 'I4', on_hand: 3, unit: 'piece' },
    ]);
    hub.clock.advance(60_000);
    const now = hub.clock.branchNow();
    const before = eventCount(hub);

    const added = await add(
      hub,
      admin,
      [
        { stock_item_id: 'I3', quantity: 500 },
        { stock_item_id: 'I1', quantity: 2 },
        { stock_item_id: 'I2', quantity: 4 },
        { stock_item_id: 'I4', quantity: 750 },
      ],
      'cmd-add',
    );
    expect(added.statusCode).toBe(200);
    expect(added.json().data.result).toEqual({
      stock_items: [
        { stock_item_id: 'I3', on_hand: 1_500, reserved: 0, unit: 'g', available: 1_500, level: 'ok', set_at: countedAt, recorded_as: 'added' },
        { stock_item_id: 'I1', on_hand: 2, reserved: 0, unit: 'piece', available: 2, level: 'ok', set_at: now, recorded_as: 'set' },
        { stock_item_id: 'I2', on_hand: 4, reserved: 0, unit: 'piece', available: 4, level: 'ok', set_at: now, recorded_as: 'set' },
        { stock_item_id: 'I4', on_hand: 750, reserved: 0, unit: 'g', available: 750, level: 'ok', set_at: now, recorded_as: 'set' },
      ],
    });
    expect(eventsSince(hub, before)).toEqual([
      { event_type: 'StockAdded', schema_version: 2, stream_id: 'I3', payload: { stock_item_id: 'I3', quantity: 500, unit: 'g' } },
      { event_type: 'StockSet', schema_version: 2, stream_id: 'I1', payload: { stock_item_id: 'I1', on_hand: 2, unit: 'piece' } },
      { event_type: 'StockSet', schema_version: 2, stream_id: 'I2', payload: { stock_item_id: 'I2', on_hand: 4, unit: 'piece' } },
      { event_type: 'StockSet', schema_version: 2, stream_id: 'I4', payload: { stock_item_id: 'I4', on_hand: 750, unit: 'g' } },
    ]);
    // S45: an add is not a count; set_at stays the count's time.
    expect(engine(hub).stock.I3).toEqual({ on_hand: 1_500, reserved: 0, set_at: countedAt, unit: 'g' });

    const replay = await add(hub, admin, [{ stock_item_id: 'I3', quantity: 500 }, { stock_item_id: 'I1', quantity: 2 }, { stock_item_id: 'I2', quantity: 4 }, { stock_item_id: 'I4', quantity: 750 }], 'cmd-add');
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(added.json());
    const afterAdd = eventCount(hub);
    expect(afterAdd).toBe(before + 4);

    const stockBefore = engine(hub).stock;
    const missing = await add(hub, admin, [{ stock_item_id: 'I3', quantity: 1 }, { stock_item_id: 'I9', quantity: 1 }], 'cmd-missing');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('STOCK_ITEM_NOT_FOUND');
    expect(missing.json().error.details).toEqual({ stock_item_id: 'I9' });
    const untracked = await add(hub, admin, [{ stock_item_id: 'I3', quantity: 1 }, { stock_item_id: 'I5', quantity: 1 }], 'cmd-untracked');
    expect(untracked.statusCode).toBe(404);
    expect(untracked.json().error.code).toBe('STOCK_ITEM_NOT_FOUND');
    expect(untracked.json().error.details).toEqual({ stock_item_id: 'I5' });
    const duplicate = await add(hub, admin, [{ stock_item_id: 'I3', quantity: 1 }, { stock_item_id: 'I3', quantity: 2 }], 'cmd-dup');
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json().error.code).toBe('VALIDATION_FAILED');
    const zero = await add(hub, admin, [{ stock_item_id: 'I3', quantity: 0 }], 'cmd-zero');
    expect(zero.statusCode).toBe(400);
    const owner = adminOn(hub, 'S_OWNER');
    const denied = await add(hub, owner, [{ stock_item_id: 'I3', quantity: 1 }], 'cmd-denied', 'S_OWNER');
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.details).toMatchObject({ permission: 'manage-stock' });
    expect(eventCount(hub)).toBe(afterAdd);
    expect(engine(hub).stock).toBe(stockBefore);

    fail = true;
    const failed = await add(hub, admin, [{ stock_item_id: 'I3', quantity: 100 }, { stock_item_id: 'I2', quantity: 1 }], 'cmd-fail');
    expect(failed.statusCode).toBe(500);
    expect(engine(hub).stock).toBe(stockBefore);
    expect(eventCount(hub)).toBe(afterAdd);
  });

  it('[01c #79] AddPrecookedStock on a stock item counted today → one StockAdded v2, recorded_as added; on one counted before the day open → one StockSet v2, recorded_as set; duplicate id → 400; my_stations outside → 403', async () => {
    const hub = await open({}, {}, counterDirectory);
    // I1 at S1 (Karahi), I3 at S2 (Grill): both stock items, each counted at its route station.
    const base = aBranchConfigItemStock();
    withConfig({
      ...base,
      stations: [...base.stations, { ...base.stations[0]!, station_id: 'S2', name: 'Grill' }],
      stock_items: base.stock_items.map((s) => (s.stock_item_id === 'I3' ? { ...s, station_id: 'S2' } : s)),
      items: base.items.map((item) => (item.item_id === 'I3' ? { ...item, station_id: 'S2' } : item)),
    });
    const admin = adminOn(hub, 'S_MGR');
    countStock(hub, [{ item_id: 'I3', on_hand: 400, unit: 'g' }]); // before the day opens
    hub.clock.advance(60_000);
    expect((await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open')).statusCode).toBe(200);
    hub.clock.advance(60_000);
    const countedAt = hub.clock.branchNow();
    countStock(hub, [{ item_id: 'I1', on_hand: 5, unit: 'piece' }]);
    hub.clock.advance(60_000);
    const now = hub.clock.branchNow();
    const before = eventCount(hub);

    const added = await add(hub, admin, [{ stock_item_id: 'I1', quantity: 2 }, { stock_item_id: 'I3', quantity: 750 }], 'cmd-add');
    expect(added.statusCode, added.body).toBe(200);
    expect(added.json().data.result.stock_items).toEqual([
      { stock_item_id: 'I1', on_hand: 7, reserved: 0, unit: 'piece', available: 7, level: 'ok', set_at: countedAt, recorded_as: 'added' },
      { stock_item_id: 'I3', on_hand: 750, reserved: 0, unit: 'g', available: 750, level: 'ok', set_at: now, recorded_as: 'set' },
    ]);
    expect(eventsSince(hub, before)).toEqual([
      { event_type: 'StockAdded', schema_version: 2, stream_id: 'I1', payload: { stock_item_id: 'I1', quantity: 2, unit: 'piece' } },
      { event_type: 'StockSet', schema_version: 2, stream_id: 'I3', payload: { stock_item_id: 'I3', on_hand: 750, unit: 'g' } },
    ]);
    const afterAdd = eventCount(hub);

    const duplicate = await add(hub, admin, [{ stock_item_id: 'I1', quantity: 1 }, { stock_item_id: 'I1', quantity: 2 }], 'cmd-dup');
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json().error.details.issues.map((issue: { path: string }) => issue.path)).toEqual(['entries.1.stock_item_id']);

    const counter = adminOn(hub, 'S_CNT');
    const outside = await add(hub, counter, [{ stock_item_id: 'I3', quantity: 250 }, { stock_item_id: 'I1', quantity: 1 }], 'cmd-out', 'S_CNT');
    expect(outside.statusCode, outside.body).toBe(403);
    expect(outside.json().error).toMatchObject({
      code: 'PERMISSION_DENIED',
      details: { permission: 'manage-stock', reason: 'outside_scope', stock_item_ids: ['I3'] },
    });
    expect(eventCount(hub)).toBe(afterAdd);
    const inside = await add(hub, counter, [{ stock_item_id: 'I1', quantity: 1 }], 'cmd-in', 'S_CNT');
    expect(inside.statusCode, inside.body).toBe(200);
  });
});

// I2 and the new I4 (g, counted per piece in the test) are stock-tracked; I5 is not (no stock item).
function config(): BranchConfig {
  const base = aBranchConfigItemStock();
  const i2 = base.items.find((item) => item.item_id === 'I2')!;
  const i3 = base.items.find((item) => item.item_id === 'I3')!;
  const [k1, k3] = base.stock_items;
  return {
    ...base,
    stock_items: [k1!, k3!, { ...k1!, stock_item_id: 'I2', name: 'Mutton Karahi' }, { ...k3!, stock_item_id: 'I4', name: 'Seekh Kebab' }],
    items: [
      ...base.items.map((item) =>
        item.item_id === 'I2' ? { ...item, stock_time_ms: 300_000, stock_draws: [{ stock_item_id: 'I2', quantity_per_sale_unit: 1 }] } : item,
      ),
      { ...i3, item_id: 'I4', name: 'Seekh Kebab', sort_order: 4, stock_draws: [{ stock_item_id: 'I4', quantity_per_sale_unit: 250 }] },
      { ...i2, item_id: 'I5', name: 'Raita', sort_order: 5 },
    ],
  };
}

// S_CNT: a stock counter (manage-stock with scope my_stations) counting stock at S1 (Karahi).
function counterDirectory(directory: DirectoryInput): void {
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
  directory.responsibilities = [{ responsibility: 'count_stock', station_id: 'S1', staff_ids: ['S_CNT'], role_ids: [] }];
}

async function open(
  testHooks: { beforeCommit?: () => void },
  denied: Record<string, string[]>,
  editDirectory?: (directory: DirectoryInput) => void,
): Promise<TestHub> {
  const hub = await createTestHub({ testHooks });
  cleanups.push(() => hub.close());
  const directory = await aDirectory();
  for (const staff of directory.staff) staff.denied_permissions = denied[staff.staff_id] ?? [];
  editDirectory?.(directory);
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

function countStock(hub: TestHub, entries: Array<{ item_id: string; on_hand: number; unit: Unit }>): void {
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

function add(hub: TestHub, admin: Admin, entries: Array<{ stock_item_id: string; quantity: number }>, commandId: string, actorId = 'S_MGR') {
  return post(hub, admin, 'add-precooked-stock', 'AddPrecookedStock', { entries }, commandId, actorId);
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

function eventCount(hub: TestHub): number {
  return hub.deps.db.prepare("SELECT COUNT(*) FROM events WHERE stream_type = 'stock'").pluck().get() as number;
}

function eventsSince(hub: TestHub, count: number): Array<{ event_type: string; schema_version: number; stream_id: string; payload: unknown }> {
  const rows = hub.deps.db
    .prepare("SELECT event_type, schema_version, stream_id, payload FROM events WHERE stream_type = 'stock' ORDER BY seq LIMIT -1 OFFSET ?")
    .all(count) as Array<{ event_type: string; schema_version: number; stream_id: string; payload: string }>;
  return rows.map((row) => ({ event_type: row.event_type, schema_version: row.schema_version, stream_id: row.stream_id, payload: JSON.parse(row.payload) }));
}
