import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { availableStock, buildEngineState, dayDraws, dayStockUnit, openDayStartMs, stockLevel, stockOf, type EngineState } from '@pos/engine';
import { parseEvent, type BranchConfig, type ConfigItem, type PosEvent } from '@pos/events';
import { aBranchConfigItemStock } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { boot, type BootHandle } from '../../src/lib/boot';
import { registerRestaurantBootSteps } from '../../src/sync/boot-steps';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { configPoller } from '../../src/sync/config-poller';
import { aDirectory } from '../helpers/fixtures';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

const BRANCH = 'branch-1';
const HOST = '192.168.10.2:3000';

registerRestaurantBootSteps();

type Admin = { device: { deviceId: string; token: string }; session: { sessionId: string; token: string } };
type Hub = Pick<TestHub, 'app' | 'deps'>;

const cleanups: Array<() => Promise<void> | void> = [];

describe('business day across restart; units frozen per day (S33, S44)', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('[01a §10 #147] replay and restart across a closed day: the closed day survives, stock commands 409, the day-1 count stays 0 after a new open; buildEngineState(log) equals the live state', async () => {
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const cloud = stubConfigCloud();
    const time = { wall: at(6), mono: 0 };
    const start = async (): Promise<BootHandle> => {
      const booted = await boot({
        configPath: cfg.path,
        wallNow: () => time.wall,
        monoNow: () => time.mono,
        ifaces: ['192.168.10.2'],
        configClient: cloud,
      });
      let stopped = false;
      cleanups.push(async () => {
        if (!stopped) await booted.stop();
      });
      const stop = booted.stop.bind(booted);
      booted.stop = async () => {
        stopped = true;
        await stop();
      };
      return booted;
    };

    const first = await start();
    cloud.respondWithSnapshot({ ...aBranchConfigItemStock({ branch_id: BRANCH, config_version: 1 }) }, { directory: await longDirectory() });
    expect((await configPoller(first.app).pollOnce()).outcome).toBe('applied');
    const i1 = stockItemOf(branchConfig(), 'I1');
    expect(i1.carries_over).toBe(false);
    let admin = adminOn(first);
    expect((await post(first, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-1')).statusCode).toBe(200);
    time.mono += 3_600_000;
    expect((await post(first, admin, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ stock_item_id: 'I1', on_hand: 4 }] }, 'cmd-set-1')).statusCode).toBe(200);
    time.mono += 15 * 3_600_000;
    const closed = await post(first, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close-1');
    expect(closed.json().data.result).toMatchObject({ opened_at: at(6), closed_at: at(22), reason: 'closed' });
    expect(buildEngineState(log(first))).toEqual(engine(first));
    const beforeRestart = engine(first);
    await first.stop();

    time.wall = at(23);
    time.mono = 0;
    const second = await start();
    expect(engine(second)).toEqual(beforeRestart);
    expect(engine(second).business_day).toMatchObject({ opened_at: at(6), closed_at: at(22) });
    expect(buildEngineState(log(second))).toEqual(engine(second));
    expect(available(second, 'I1')).toBe(0);
    admin = adminOn(second);
    const stockEvents = () => second.deps.db.prepare("SELECT COUNT(*) FROM events WHERE stream_type = 'stock'").pluck().get();
    const stockBefore = stockEvents();
    const set = await post(second, admin, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ stock_item_id: 'I1', on_hand: 2 }] }, 'cmd-set-2');
    expect(set.statusCode).toBe(409);
    expect(set.json().error.code).toBe('BUSINESS_DAY_NOT_OPEN');
    const add = await post(second, admin, 'add-precooked-stock', 'AddPrecookedStock', { entries: [{ stock_item_id: 'I1', quantity: 2 }] }, 'cmd-add-2');
    expect(add.statusCode).toBe(409);
    expect(stockEvents()).toBe(stockBefore);

    const opened = await post(second, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-2');
    expect(opened.json().data.result).toMatchObject({ opened_at: at(23), changed: true, reason: 'opened' });
    expect(engine(second).business_day).toMatchObject({ opened_at: at(23), closed_at: null });
    expect(available(second, 'I1')).toBe(0);
    expect(level(second, 'I1')).toBe('not_counted');
    expect(buildEngineState(log(second))).toEqual(engine(second));

    // Test 68's engine fixture holds both day events.
    const fixture = JSON.parse(readFileSync(new URL('../../../../packages/engine/fixtures/engine-log.v2.json', import.meta.url), 'utf8')) as Array<{ event_type: string }>;
    expect(fixture.map((e) => e.event_type)).toEqual(expect.arrayContaining(['BusinessDayOpened', 'BusinessDayClosed']));
  });

  it('[01a §10 #149] stock units and draws are frozen for the day: a unit change mid-day takes effect at the next open; an item added mid-day uses its own (dayStockUnit / dayDraws)', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    hub.clock.set(at(6));
    await seedDirectory(hub, await longDirectory());
    withConfig(aBranchConfigItemStock());
    const admin = adminOn(hub);
    await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-1');
    hub.clock.set(at(7));
    await post(hub, admin, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ stock_item_id: 'I1', on_hand: 6 }] }, 'cmd-count-1');

    // A new snapshot: I1 becomes g / piece / 250, and I4 (g / piece / 250) joins the menu.
    const changed = aBranchConfigItemStock({ config_version: 2 });
    const i1g = { ...item(changed, 'I1'), sale_unit: 'piece' as const, stock_draws: [{ stock_item_id: 'I1', quantity_per_sale_unit: 250 }] };
    const i4 = { ...item(changed, 'I3'), item_id: 'I4', name: 'Seekh Kebab', sort_order: 4, stock_draws: [{ stock_item_id: 'I4', quantity_per_sale_unit: 250 }] };
    withConfig({
      ...changed,
      stock_items: [
        ...changed.stock_items.map((s) => (s.stock_item_id === 'I1' ? { ...s, stock_unit: 'g' as const } : s)),
        { ...stockItemOf(changed, 'I3'), stock_item_id: 'I4', name: 'Seekh Kebab' },
      ],
      items: [...changed.items.map((i) => (i.item_id === 'I1' ? i1g : i)), i4],
    });
    const state = engine(hub);
    expect(stockOf(state, 'I1')).toMatchObject({ on_hand: 6, unit: 'piece' });
    const v2 = branchConfig();
    expect(dayStockUnit(state, stockItemOf(v2, 'I1'))).toBe('piece');
    expect(dayDraws(state, configItemOf(v2, 'I1'), stockUnitsOf(v2))).toEqual({ sale_unit: 'piece', stock_draws: [{ stock_item_id: 'I1', quantity_per_sale_unit: 1 }] });
    expect(availableStock(state, 'I1', openDayStartMs(state), stockItemOf(v2, 'I1'))).toBe(6);
    expect(dayStockUnit(state, stockItemOf(v2, 'I4'))).toBe('g');
    expect(dayDraws(state, configItemOf(v2, 'I4'), stockUnitsOf(v2))).toEqual({ sale_unit: 'piece', stock_draws: [{ stock_item_id: 'I4', quantity_per_sale_unit: 250 }] });

    hub.clock.set(at(8));
    const recount = await post(hub, admin, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ stock_item_id: 'I1', on_hand: 5 }, { stock_item_id: 'I4', on_hand: 1_000 }] }, 'cmd-count-2');
    expect(recount.statusCode).toBe(200);
    expect(recount.json().data.result.stock_items).toMatchObject([
      { stock_item_id: 'I1', on_hand: 5, unit: 'piece', available: 5 },
      { stock_item_id: 'I4', on_hand: 1_000, unit: 'g', available: 1_000 },
    ]);
    expect(lastPayload(hub, 'StockSet', 'I1')).toEqual({ stock_item_id: 'I1', on_hand: 5, unit: 'piece' });
    expect(lastPayload(hub, 'StockSet', 'I4')).toEqual({ stock_item_id: 'I4', on_hand: 1_000, unit: 'g' });

    hub.clock.set(at(22));
    expect((await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close')).json().data.result.reason).toBe('closed');
    expect((await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-2')).json().data.result.reason).toBe('opened');
    const opened = lastPayload(hub, 'BusinessDayOpened', BRANCH) as { stock_units: Record<string, unknown>; draws: Record<string, unknown> };
    expect(opened.stock_units).toEqual({ I1: 'g', I3: 'g', I4: 'g' });
    expect(opened.draws.I1).toEqual({ sale_unit: 'piece', stock_draws: [{ stock_item_id: 'I1', quantity_per_sale_unit: 250 }] });
    const day2 = engine(hub);
    expect(dayStockUnit(day2, stockItemOf(v2, 'I1'))).toBe('g');
    expect(dayDraws(day2, configItemOf(v2, 'I1'), stockUnitsOf(v2))).toEqual({ sale_unit: 'piece', stock_draws: [{ stock_item_id: 'I1', quantity_per_sale_unit: 250 }] });
    expect(availableStock(day2, 'I1', openDayStartMs(day2), stockItemOf(v2, 'I1'))).toBe(0);
    expect(stockLevel(day2, 'I1', openDayStartMs(day2), stockItemOf(v2, 'I1'))).toBe('not_counted');

    hub.clock.set(at(23));
    const fresh = await post(hub, admin, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ stock_item_id: 'I1', on_hand: 2_000 }] }, 'cmd-count-3');
    expect(fresh.json().data.result.stock_items[0]).toMatchObject({ unit: 'g', available: 2_000 });
    expect(lastPayload(hub, 'StockSet', 'I1')).toEqual({ stock_item_id: 'I1', on_hand: 2_000, unit: 'g' });
  });

  it('[01c #68] OpenBusinessDay → BusinessDayOpened v2 with stock_units for each counted stock item and draws for each tracked item; a later unit change waits for the next open', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    hub.clock.set(at(6));
    await seedDirectory(hub, await longDirectory());
    withConfig(aBranchConfigItemStock());
    const admin = adminOn(hub);
    expect((await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-1')).statusCode).toBe(200);
    const day1 = lastEvent(hub, 'BusinessDayOpened', BRANCH);
    expect(day1.schema_version).toBe(2);
    // I1 and I3 are stock items (same ids, 01c §5.1); I2 is not tracked, so it has neither.
    expect(day1.payload).toEqual({
      business_date: '2026-10-25',
      stock_units: { I1: 'piece', I3: 'g' },
      draws: {
        I1: { sale_unit: 'piece', stock_draws: [{ stock_item_id: 'I1', quantity_per_sale_unit: 1 }] },
        I3: { sale_unit: 'piece', stock_draws: [{ stock_item_id: 'I3', quantity_per_sale_unit: 250 }] },
      },
    });

    // A unit change mid-day: I3 becomes pieces, one per sale. The open day keeps g and 250.
    const changed = aBranchConfigItemStock({ config_version: 2 });
    withConfig({
      ...changed,
      stock_items: changed.stock_items.map((s) => (s.stock_item_id === 'I3' ? { ...s, stock_unit: 'piece' as const } : s)),
      items: changed.items.map((i) => (i.item_id === 'I3' ? { ...i, stock_draws: [{ stock_item_id: 'I3', quantity_per_sale_unit: 1 }] } : i)),
    });
    hub.clock.set(at(7));
    const counted = await post(hub, admin, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ stock_item_id: 'I3', on_hand: 1_000 }] }, 'cmd-count-1');
    expect(counted.statusCode, counted.body).toBe(200);
    expect(lastPayload(hub, 'StockSet', 'I3')).toEqual({ stock_item_id: 'I3', on_hand: 1_000, unit: 'g' });
    expect(engine(hub).business_day).toMatchObject({ stock_units: { I1: 'piece', I3: 'g' } });

    hub.clock.set(at(22));
    expect((await post(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close')).json().data.result.reason).toBe('closed');
    expect((await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-2')).json().data.result.reason).toBe('opened');
    expect(lastPayload(hub, 'BusinessDayOpened', BRANCH)).toMatchObject({
      stock_units: { I1: 'piece', I3: 'piece' },
      draws: { I3: { sale_unit: 'piece', stock_draws: [{ stock_item_id: 'I3', quantity_per_sale_unit: 1 }] } },
    });
  });
});

// Local wall-clock hours on 2026-10-25 (the hub's zone).
function at(hours: number): number {
  return new Date(2026, 9, 25, hours).getTime();
}

function writeConfig(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-day-restart-'));
  const dataDir = join(dir, 'data');
  const backupDir = join(dir, 'backup');
  mkdirSync(dataDir);
  mkdirSync(backupDir);
  const path = join(dir, 'config.json');
  writeFileSync(
    path,
    JSON.stringify({
      cloud_base_url: 'https://cloud.example',
      http_port: 3000,
      data_dir: dataDir,
      backup_dir: backupDir,
      min_client_version: '1.0.0',
      backup_encryption_key: Buffer.alloc(32, 7).toString('base64'),
      advertised_host: '192.168.10.2',
      provisioned: { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'key-1', confirmed_at: 1 },
    }),
  );
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// The tests move the clock by hours; long idle TTLs keep the admin sessions alive.
async function longDirectory() {
  const directory = await aDirectory();
  for (const role of directory.roles) role.session_idle_ttl_ms = 7 * 86_400_000;
  return directory;
}

function withConfig(config: BranchConfig): void {
  swapBranchConfig({ config, snapshotHash: 'h'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 2, appliedAt: 0 });
}

function item(config: BranchConfig | null, itemId: string): ConfigItem {
  const found = config?.items.find((candidate) => candidate.item_id === itemId);
  if (found === undefined) throw new Error(`no item ${itemId}`);
  return found;
}

function stockItemOf(config: BranchConfig | null, stockItemId: string) {
  const found = config?.stock_items.find((candidate) => candidate.stock_item_id === stockItemId);
  if (found === undefined) throw new Error(`no stock item ${stockItemId}`);
  return found;
}

function configItemOf(config: BranchConfig | null, itemId: string) {
  const found = config?.items.find((candidate) => candidate.item_id === itemId);
  if (found === undefined) throw new Error(`no item ${itemId}`);
  return found;
}

function stockUnitsOf(config: BranchConfig | null): Record<string, BranchConfig['stock_items'][number]['stock_unit']> {
  return Object.fromEntries((config?.stock_items ?? []).map((s) => [s.stock_item_id, s.stock_unit]));
}

function adminOn(hub: Hub): Admin {
  const h = { ...hub, clock: hub.deps.clock } as unknown as TestHub;
  const device = pairDevice(h, { type: 'tablet' });
  const session = openSession(h, { kind: 'admin', staffId: 'S_MGR', deviceId: device.deviceId });
  return { device, session };
}

function post(hub: Hub, admin: Admin, name: string, commandType: string, payload: Record<string, unknown>, commandId: string) {
  return hub.app.inject({
    method: 'POST',
    url: `/admin/commands/${name}`,
    headers: { host: HOST, authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
    payload: {
      command_id: commandId,
      tenant_id: 'tenant-a',
      branch_id: BRANCH,
      command_type: commandType,
      payload,
      occurred_at: hub.deps.clock.branchNow(),
      actor_id: 'S_MGR',
      device_id: admin.device.deviceId,
    },
  });
}

function engine(hub: Hub): EngineState {
  return hub.deps.state.get();
}

function log(hub: Hub): PosEvent[] {
  const rows = hub.deps.db.prepare('SELECT * FROM events WHERE branch_id = ? ORDER BY seq').all(BRANCH) as Array<Record<string, unknown> & { payload: string }>;
  return rows.map((row) => parseEvent({ ...row, payload: JSON.parse(row.payload) }));
}

function available(hub: Hub, stockItemId: string): number {
  const state = engine(hub);
  return availableStock(state, stockItemId, openDayStartMs(state), stockItemOf(branchConfig(), stockItemId));
}

function level(hub: Hub, stockItemId: string): string {
  const state = engine(hub);
  return stockLevel(state, stockItemId, openDayStartMs(state), stockItemOf(branchConfig(), stockItemId));
}

function lastPayload(hub: Hub, eventType: string, streamId: string): unknown {
  const raw = hub.deps.db
    .prepare('SELECT payload FROM events WHERE event_type = ? AND stream_id = ? ORDER BY seq DESC LIMIT 1')
    .pluck()
    .get(eventType, streamId) as string;
  return JSON.parse(raw);
}

function lastEvent(hub: Hub, eventType: string, streamId: string): { schema_version: number; payload: unknown } {
  const row = hub.deps.db
    .prepare('SELECT schema_version, payload FROM events WHERE event_type = ? AND stream_id = ? ORDER BY seq DESC LIMIT 1')
    .get(eventType, streamId) as { schema_version: number; payload: string };
  return { schema_version: row.schema_version, payload: JSON.parse(row.payload) };
}
