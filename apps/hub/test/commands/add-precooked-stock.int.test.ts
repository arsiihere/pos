import { applyEvent, initialEngineState, type EngineState } from '@pos/engine';
import { parseEvent, type BranchConfig, type DirectoryInput, type PosEvent } from '@pos/events';
import { aBranchConfigItemStock, anEngineConfigApplied, anOrderBatch, aStockSet } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
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

  it('[01a §6.17a A-14] StockReserved drafts after the StockAdded for waiting hidden full-cook lines, in deadline order, as far as the stock reaches; frozen lines are not candidates', async () => {
    const { hub, admin } = await openWithEngine();
    counted(hub, 'I1', 0);
    const countedAt = hub.clock.branchNow();
    frozen(hub, 'O0', [{ id: 'Z', draws: [{ stock_item_id: 'I1', quantity: 1 }] }]);
    hidden(hub, 'O1', [{ id: 'W1', draws: [{ stock_item_id: 'I1', quantity: 1 }] }]);
    hidden(hub, 'O2', [{ id: 'W2', draws: [{ stock_item_id: 'I1', quantity: 3 }] }], 100_000); // does not fit: skipped
    hidden(hub, 'O3', [{ id: 'W3', draws: [{ stock_item_id: 'I1', quantity: 1 }] }], 200_000);
    hidden(hub, 'O4', [{ id: 'W4', draws: [{ stock_item_id: 'I1', quantity: 1 }] }], 300_000); // beyond the reach
    hub.clock.advance(1_000);
    const now = hub.clock.branchNow();
    const before = lastSeq(hub);

    const res = await add(hub, admin, [{ stock_item_id: 'I1', quantity: 2 }], 'cmd-add');

    expect(res.statusCode).toBe(200);
    expect(logAfter(hub, before)).toEqual([
      { type: 'StockAdded', id: 'I1', q: 2, unit: 'piece' },
      { type: 'StockReserved', id: 'I1', line: 'W1', q: 1 },
      { type: 'StockReserved', id: 'I1', line: 'W3', q: 1 },
    ]);
    const rows = rowsAfter(hub, before);
    for (const row of rows) expect(row).toMatchObject({ stream_type: 'stock', stream_id: 'I1', occurred_at: now, recorded_at: now, actor_id: 'S_MGR', device_id: admin.device.deviceId });
    expect(res.json().data.event_ids).toEqual(rows.map((row) => row.event_id));
    expect(res.json().data.result).toEqual({
      stock_items: [{ stock_item_id: 'I1', on_hand: 2, reserved: 2, unit: 'piece', available: 0, level: 'out', set_at: countedAt, recorded_as: 'added' }],
    });
    expect(engine(hub).lines.W1).toMatchObject({ from_stock: true, cook_ms: STOCK_COOK });
    expect(engine(hub).lines.W3).toMatchObject({ from_stock: true, cook_ms: STOCK_COOK });
    for (const id of ['Z', 'W2', 'W4']) expect(engine(hub).lines[id]).toMatchObject({ from_stock: false, reserved_seq: null });
    expectSameAsReplay(hub);
  });

  it('[01a §6.17a A-14] two entries in one command thread (BF-8): a two-draw line fits once the second entry sees the first add, its reservations after the second StockAdded', async () => {
    const { hub, admin } = await openWithEngine();
    counted(hub, 'I1', 0);
    counted(hub, 'I3', 0, 'g');
    hidden(hub, 'O1', [{ id: 'L', draws: [{ stock_item_id: 'I1', quantity: 1 }, { stock_item_id: 'I3', quantity: 250 }] }]);
    const before = lastSeq(hub);
    const res = await add(hub, admin, [{ stock_item_id: 'I1', quantity: 1 }, { stock_item_id: 'I3', quantity: 250 }], 'cmd-add');
    expect(res.statusCode).toBe(200);
    expect(logAfter(hub, before)).toEqual([
      { type: 'StockAdded', id: 'I1', q: 1, unit: 'piece' },
      { type: 'StockAdded', id: 'I3', q: 250, unit: 'g' },
      { type: 'StockReserved', id: 'I1', line: 'L', q: 1 },
      { type: 'StockReserved', id: 'I3', line: 'L', q: 250 },
    ]);
    expect(res.json().data.result.stock_items).toMatchObject([
      { stock_item_id: 'I1', on_hand: 1, reserved: 1, available: 0, recorded_as: 'added' },
      { stock_item_id: 'I3', on_hand: 250, reserved: 250, available: 0, recorded_as: 'added' },
    ]);
    expectSameAsReplay(hub);
  });

  it('[01a §6.17a A-14] two entries in one command thread claims (BF-8): the unit the first entry reserved is not claimed again by the second entry', async () => {
    const { hub, admin } = await openWithEngine();
    counted(hub, 'I1', 0);
    counted(hub, 'I3', 0, 'g');
    hidden(hub, 'O1', [{ id: 'W1', draws: [{ stock_item_id: 'I1', quantity: 1 }] }]);
    hidden(hub, 'O2', [{ id: 'W2', draws: [{ stock_item_id: 'I1', quantity: 1 }, { stock_item_id: 'I3', quantity: 250 }] }], 100_000);
    const before = lastSeq(hub);
    expect((await add(hub, admin, [{ stock_item_id: 'I1', quantity: 1 }, { stock_item_id: 'I3', quantity: 250 }], 'cmd-add')).statusCode).toBe(200);
    expect(logAfter(hub, before)).toEqual([
      { type: 'StockAdded', id: 'I1', q: 1, unit: 'piece' },
      { type: 'StockReserved', id: 'I1', line: 'W1', q: 1 },
      { type: 'StockAdded', id: 'I3', q: 250, unit: 'g' },
    ]);
    expect(engine(hub).stock.I1).toMatchObject({ on_hand: 1, reserved: 1 });
    expect(engine(hub).stock.I3).toMatchObject({ on_hand: 250, reserved: 0 });
    expect(engine(hub).lines.W2).toMatchObject({ from_stock: false, reserved_seq: null });
    expectSameAsReplay(hub);
  });

  it('[01a §6.17a A-14] an add recorded as a StockSet (S45) carries the StockSet effects: held lines consumed first on a unit change (BF-9 parked), the waiting reserve after', async () => {
    const { hub, admin } = await openWithEngine();
    counted(hub, 'I3', 6, 'piece'); // another unit: not a valid count for the day's g
    hidden(hub, 'O1', [{ id: 'H', draws: [{ stock_item_id: 'I3', quantity: 1 }], from_stock: true }]);
    hidden(hub, 'O2', [{ id: 'WAIT', draws: [{ stock_item_id: 'I3', quantity: 100 }] }], 100_000);
    const before = lastSeq(hub);
    const res = await add(hub, admin, [{ stock_item_id: 'I3', quantity: 500 }], 'cmd-add');
    expect(res.statusCode).toBe(200);
    expect(logAfter(hub, before)).toEqual([
      { type: 'StockConsumed', id: 'I3', line: 'H', q: 1 },
      { type: 'StockSet', id: 'I3', on_hand: 500, unit: 'g' },
      { type: 'StockReserved', id: 'I3', line: 'WAIT', q: 100 },
    ]);
    expect(res.json().data.result.stock_items).toMatchObject([{ stock_item_id: 'I3', on_hand: 500, reserved: 100, available: 400, recorded_as: 'set' }]);
    expect(engine(hub).lines.H).toMatchObject({ from_stock: true, reserved_seq: null });
    expectSameAsReplay(hub);
  });

  it('[01a §6.17a A-14] the StockAdded and its reservations are one transaction: a forced COMMIT failure writes none of them and leaves the state; the retry appends the whole batch', async () => {
    let fail = false;
    const { hub, admin } = await openWithEngine({
      beforeCommit() {
        if (fail) throw new Error('forced commit failure');
      },
    });
    counted(hub, 'I1', 0);
    hidden(hub, 'O1', [{ id: 'W1', draws: [{ stock_item_id: 'I1', quantity: 1 }] }]);
    const state = engine(hub);
    const before = lastSeq(hub);
    fail = true;
    expect((await add(hub, admin, [{ stock_item_id: 'I1', quantity: 1 }], 'cmd-fail')).statusCode).toBe(500);
    expect(rowsAfter(hub, before)).toEqual([]);
    expect(engine(hub)).toBe(state);
    fail = false;
    expect((await add(hub, admin, [{ stock_item_id: 'I1', quantity: 1 }], 'cmd-fail')).statusCode).toBe(200);
    expect(logAfter(hub, before)).toEqual([
      { type: 'StockAdded', id: 'I1', q: 1, unit: 'piece' },
      { type: 'StockReserved', id: 'I1', line: 'W1', q: 1 },
    ]);
  });

  it('[01a §6.17a A-14] the statement count changes only by the appends: each effect draft adds one INSERT', async () => {
    const { hub, admin } = await openWithEngine();
    counted(hub, 'I1', 0);
    counted(hub, 'I2', 0);
    hidden(hub, 'O1', [{ id: 'W1', draws: [{ stock_item_id: 'I1', quantity: 1 }] }]);
    hidden(hub, 'O2', [{ id: 'W2', draws: [{ stock_item_id: 'I1', quantity: 1 }] }], 100_000);
    const counter = statementCounter(hub.deps.db);
    await add(hub, admin, [{ stock_item_id: 'I2', quantity: 1 }], 'cmd-warm');
    counter.reset();
    await add(hub, admin, [{ stock_item_id: 'I2', quantity: 1 }], 'cmd-plain');
    const plain = counter.count;
    counter.reset();
    const res = await add(hub, admin, [{ stock_item_id: 'I1', quantity: 2 }], 'cmd-effects');
    const withEffects = counter.count;
    expect(res.json().data.event_ids).toHaveLength(3);
    expect(withEffects).toBe(plain + 2);
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

async function openWithEngine(testHooks: { beforeCommit?: () => void } = {}): Promise<{ hub: TestHub; admin: Admin }> {
  const hub = await open(testHooks, {});
  withConfig(config());
  const admin = adminOn(hub, 'S_MGR');
  const opened = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-day');
  if (opened.statusCode !== 200) throw new Error(`open failed: ${opened.body}`);
  seed(hub, [anEngineConfigApplied()]);
  hub.clock.advance(1_000);
  return { hub, admin };
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
