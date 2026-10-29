import type { EngineState } from '@pos/engine';
import type { BranchConfigV1 } from '@pos/events';
import { aBranchConfigV1 } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

type Admin = { device: { deviceId: string; token: string }; session: { sessionId: string; token: string } };

const cleanups: Array<() => Promise<void>> = [];

describe('SetPrecookedStock (§6.17)', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[01a §10 #59] morning entry of 3 items → 3 StockSet events; the result shows on_hand, reserved 0, available', async () => {
    const { hub, admin } = await openDay();
    const now = hub.clock.branchNow();
    const res = await setStock(hub, admin, [
      { item_id: 'I1', on_hand: 6 },
      { item_id: 'I2', on_hand: 0 },
      { item_id: 'I3', on_hand: 1_500 },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.result).toEqual({
      items: [
        { item_id: 'I1', on_hand: 6, reserved: 0, unit: 'piece', available: 6, level: 'ok', set_at: now },
        { item_id: 'I2', on_hand: 0, reserved: 0, unit: 'piece', available: 0, level: 'out', set_at: now },
        { item_id: 'I3', on_hand: 1_500, reserved: 0, unit: 'g', available: 1_500, level: 'ok', set_at: now },
      ],
    });
    expect(stockSets(hub)).toEqual([
      { stream_id: 'I1', payload: { stock_item_id: 'I1', on_hand: 6, unit: 'piece' } },
      { stream_id: 'I2', payload: { stock_item_id: 'I2', on_hand: 0, unit: 'piece' } },
      { stream_id: 'I3', payload: { stock_item_id: 'I3', on_hand: 1_500, unit: 'g' } },
    ]);
    expect(res.json().data.event_ids).toHaveLength(3);
    expect(engine(hub).stock.I3).toEqual({ on_hand: 1_500, reserved: 0, set_at: now, unit: 'g' });
  });

  it('[01a §10 #60] an on_hand equal to the current value still appends one StockSet and moves set_at to its recorded_at', async () => {
    const { hub, admin } = await openDay();
    await setStock(hub, admin, [{ item_id: 'I1', on_hand: 6 }], 'cmd-first');
    hub.clock.advance(120_000);
    const later = hub.clock.branchNow();
    const res = await setStock(hub, admin, [{ item_id: 'I1', on_hand: 6 }], 'cmd-recount');
    expect(res.statusCode).toBe(200);
    expect(stockSets(hub)).toHaveLength(2);
    const [eventId] = res.json().data.event_ids as string[];
    const recordedAt = hub.deps.db.prepare('SELECT recorded_at FROM events WHERE event_id = ?').pluck().get(eventId);
    expect(recordedAt).toBe(later);
    expect(engine(hub).stock.I1?.set_at).toBe(recordedAt);
    expect(res.json().data.result.items[0]).toMatchObject({ on_hand: 6, set_at: later });
  });

  it('[01a §10 #61] item not in config → 404 MENU_ITEM_NOT_FOUND; not stock-tracked → 422 STOCK_NOT_TRACKED; nothing written for any entry', async () => {
    const { hub, admin } = await openDay(aBranchConfigV1());
    const missing = await setStock(hub, admin, [{ item_id: 'I1', on_hand: 3 }, { item_id: 'I9', on_hand: 1 }], 'cmd-missing');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('MENU_ITEM_NOT_FOUND');
    expect(missing.json().error.details).toEqual({ item_id: 'I9' });
    const untracked = await setStock(hub, admin, [{ item_id: 'I1', on_hand: 3 }, { item_id: 'I2', on_hand: 1 }], 'cmd-untracked');
    expect(untracked.statusCode).toBe(422);
    expect(untracked.json().error.code).toBe('STOCK_NOT_TRACKED');
    expect(untracked.json().error.details).toEqual({ item_id: 'I2' });
    expect(stockSets(hub)).toEqual([]);
    expect(engine(hub).stock).toEqual({});
    expect(processed(hub, 'cmd-missing') + processed(hub, 'cmd-untracked')).toBe(0);

    swapBranchConfig(null);
    const noConfig = await setStock(hub, admin, [{ item_id: 'I1', on_hand: 3 }], 'cmd-no-config');
    expect(noConfig.statusCode).toBe(404);
    expect(noConfig.json().error.details).toEqual({ item_id: 'I1' });
  });

  it('[01a §10 #62] duplicate item_id in entries → 400 VALIDATION_FAILED; 201 entries → 400', async () => {
    const { hub, admin } = await openDay();
    const duplicate = await setStock(hub, admin, [{ item_id: 'I1', on_hand: 3 }, { item_id: 'I1', on_hand: 4 }], 'cmd-dup');
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json().error.code).toBe('VALIDATION_FAILED');
    const many = Array.from({ length: 201 }, (_, i) => ({ item_id: `X${i}`, on_hand: 1 }));
    const tooMany = await setStock(hub, admin, many, 'cmd-201');
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error.code).toBe('VALIDATION_FAILED');
    const empty = await setStock(hub, admin, [], 'cmd-empty');
    expect(empty.statusCode).toBe(400);
    const outOfRange = await setStock(hub, admin, [{ item_id: 'I1', on_hand: 1_000_001 }], 'cmd-range');
    expect(outOfRange.statusCode).toBe(400);
    expect(stockSets(hub)).toEqual([]);
  });

  it('[01a §10 #63] without manage-stock → 403 PERMISSION_DENIED; the Manager role has it', async () => {
    const { hub, admin } = await openDay(undefined, undefined, { S_OWNER: ['manage-stock'] });
    const owner = adminOn(hub, 'S_OWNER');
    const denied = await setStock(hub, owner, [{ item_id: 'I1', on_hand: 3 }], 'cmd-denied', 'S_OWNER');
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PERMISSION_DENIED');
    expect(denied.json().error.details).toMatchObject({ permission: 'manage-stock' });
    const manager = await setStock(hub, admin, [{ item_id: 'I1', on_hand: 3 }], 'cmd-manager');
    expect(manager.statusCode).toBe(200);
  });

  it('[01a §10 #64] retransmit with the same command_id → identical response, Idempotent-Replay: true, no new events', async () => {
    const { hub, admin } = await openDay();
    const first = await setStock(hub, admin, [{ item_id: 'I1', on_hand: 3 }], 'cmd-once');
    hub.clock.advance(5_000);
    const replay = await setStock(hub, admin, [{ item_id: 'I1', on_hand: 3 }], 'cmd-once');
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect(stockSets(hub)).toHaveLength(1);
  });

  it('[01a §10 #65] forced COMMIT failure → EngineState.stock unchanged', async () => {
    let fail = false;
    const { hub, admin } = await openDay(undefined, {
      beforeCommit() {
        if (fail) throw new Error('forced commit failure');
      },
    });
    await setStock(hub, admin, [{ item_id: 'I1', on_hand: 3 }], 'cmd-before');
    const before = engine(hub).stock;
    fail = true;
    const failed = await setStock(hub, admin, [{ item_id: 'I1', on_hand: 9 }, { item_id: 'I3', on_hand: 500 }], 'cmd-fail');
    expect(failed.statusCode).toBe(500);
    expect(engine(hub).stock).toBe(before);
    expect(stockSets(hub)).toHaveLength(1);
  });

  it('[01a §10 #134] before any OpenBusinessDay: SetPrecookedStock and AddPrecookedStock → 409 BUSINESS_DAY_NOT_OPEN, no event, no processed_commands row; after the first open → 200', async () => {
    const hub = await open();
    withConfig(trackedConfig());
    const admin = adminOn(hub, 'S_MGR');
    const blocked = await setStock(hub, admin, [{ item_id: 'I1', on_hand: 3 }], 'cmd-early');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('BUSINESS_DAY_NOT_OPEN');
    expect(stockSets(hub)).toEqual([]);
    expect(processed(hub, 'cmd-early')).toBe(0);
    const addBlocked = await post(hub, admin, 'add-precooked-stock', 'AddPrecookedStock', { entries: [{ item_id: 'I1', quantity: 2 }] }, 'cmd-add-early');
    expect(addBlocked.statusCode).toBe(409);
    expect(addBlocked.json().error.code).toBe('BUSINESS_DAY_NOT_OPEN');
    expect(processed(hub, 'cmd-add-early')).toBe(0);
    expect(hub.deps.db.prepare("SELECT COUNT(*) FROM events WHERE stream_type = 'stock'").pluck().get()).toBe(0);
    const opened = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open');
    expect(opened.statusCode).toBe(200);
    const allowed = await setStock(hub, admin, [{ item_id: 'I1', on_hand: 3 }], 'cmd-after');
    expect(allowed.statusCode).toBe(200);
    expect(stockSets(hub)).toHaveLength(1);
  });
});

// I1 piece, I2 piece (tracked here), I3 g: all stock-tracked.
function trackedConfig(): BranchConfigV1 {
  const base = aBranchConfigV1();
  return { ...base, items: base.items.map((item) => (item.item_id === 'I2' ? { ...item, stock_time_ms: 300_000 } : item)) };
}

async function openDay(
  config: BranchConfigV1 = trackedConfig(),
  testHooks?: { beforeCommit?: () => void },
  denied?: Record<string, string[]>,
): Promise<{ hub: TestHub; admin: Admin }> {
  const hub = await open(testHooks, denied);
  withConfig(config);
  const admin = adminOn(hub, 'S_MGR');
  const opened = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-day');
  if (opened.statusCode !== 200) throw new Error(`open failed: ${opened.body}`);
  return { hub, admin };
}

async function open(testHooks?: { beforeCommit?: () => void }, denied: Record<string, string[]> = {}): Promise<TestHub> {
  const hub = await createTestHub(testHooks === undefined ? undefined : { testHooks });
  cleanups.push(() => hub.close());
  const directory = await aDirectory();
  for (const staff of directory.staff) staff.denied_permissions = denied[staff.staff_id] ?? [];
  await seedDirectory(hub, directory);
  return hub;
}

function withConfig(config: BranchConfigV1): void {
  swapBranchConfig({ config, snapshotHash: 'h'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 1, appliedAt: 0 });
}

function adminOn(hub: TestHub, staffId: string): Admin {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'admin', staffId, deviceId: device.deviceId });
  return { device, session };
}

function setStock(hub: TestHub, admin: Admin, entries: Array<{ item_id: string; on_hand: number }>, commandId = 'cmd-set', actorId = 'S_MGR') {
  return post(hub, admin, 'set-precooked-stock', 'SetPrecookedStock', { entries }, commandId, actorId);
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

function stockSets(hub: TestHub): Array<{ stream_id: string; payload: unknown }> {
  const rows = hub.deps.db
    .prepare("SELECT stream_id, payload FROM events WHERE event_type = 'StockSet' AND stream_type = 'stock' ORDER BY seq")
    .all() as Array<{ stream_id: string; payload: string }>;
  return rows.map((row) => ({ stream_id: row.stream_id, payload: JSON.parse(row.payload) }));
}

function processed(hub: TestHub, commandId: string): number {
  return hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands WHERE command_id = ?').pluck().get(commandId) as number;
}
