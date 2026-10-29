import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EngineState } from '@pos/engine';
import type { EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { boot, type BootHandle } from '../../src/lib/boot';
import { registerRestaurantBootSteps } from '../../src/sync/boot-steps';
import { setStockVersion, stockVersion } from '../../src/sync/stock-version';

const WALL = 1_761_000_000_000;
const BRANCH = 'branch-1';

function writeConfig(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-fold-'));
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
      provisioned: { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'test-branch-api-key', confirmed_at: 1 },
    }),
  );
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function draft(stream: 'stock' | 'hub', streamId: string, eventType: string, payload: Record<string, unknown>, at: number): EventDraft {
  return {
    stream_type: stream,
    stream_id: streamId,
    event_type: eventType,
    schema_version: 1,
    payload,
    occurred_at: at,
    actor_id: null,
    device_id: 'hub',
  };
}

describe('engine state through boot (S15)', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });
  async function start(path: string, wall: number): Promise<BootHandle> {
    const booted = await boot({ configPath: path, wallNow: () => wall, monoNow: () => 0, ifaces: ['192.168.10.2'] });
    cleanups.push(() => booted.stop());
    return booted;
  }
  function append(booted: BootHandle, drafts: EventDraft[]): number[] {
    return booted.deps.writer.run((tx) => tx.append(drafts)).appended.map((e) => e.seq);
  }
  const engine = (booted: BootHandle) => booted.deps.state.get() as EngineState;

  // Runs first: nothing in this file has registered the restaurant steps yet.
  it('[01a §2] with no step-3 handler the state is {} as before', async () => {
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const booted = await start(cfg.path, WALL);
    expect(booted.deps.state.get()).toEqual({});
  });

  it('[01a §10 #67] restart → boot step 3 rebuilds stock from StockSet events; values equal pre-restart', async () => {
    registerRestaurantBootSteps();
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const first = await start(cfg.path, WALL);
    expect(engine(first)).toEqual({ stock: {}, business_day: null });
    append(first, [
      draft('stock', 'I1', 'StockSet', { item_id: 'I1', on_hand: 12, unit: 'piece' }, WALL),
      draft('stock', 'I2', 'StockSet', { item_id: 'I2', on_hand: 2500, unit: 'g' }, WALL),
    ]);
    append(first, [draft('stock', 'I2', 'StockAdded', { item_id: 'I2', quantity: 500, unit: 'g' }, WALL)]);
    append(first, [draft('stock', 'I1', 'StockSet', { item_id: 'I1', on_hand: 9, unit: 'piece' }, WALL)]);
    const before = engine(first).stock;
    expect(before.I1).toMatchObject({ on_hand: 9, reserved: 0, unit: 'piece' });
    expect(before.I2).toMatchObject({ on_hand: 3000, reserved: 0, unit: 'g' });
    await first.stop();
    cleanups.splice(cleanups.length - 1, 1);

    const second = await start(cfg.path, WALL + 60_000);
    expect(engine(second).stock).toEqual(before);
  });

  it('[01c #67] boot fold over a v1 StockSet (item id) then a v2 StockSet (same id) → one entry, latest wins', async () => {
    registerRestaurantBootSteps();
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const first = await start(cfg.path, WALL);
    // a v1 row as an 01a hub stored it (the writer now upcasts on append, so insert it raw)
    first.deps.db
      .prepare(
        `INSERT INTO events (event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
           schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq)
         VALUES ('01J000000000000000000000V1', 'tenant-a', ?, 'stock', 'I1', 'StockSet', 1, ?, ?, ?, NULL, 'hub', ?)`,
      )
      .run(BRANCH, JSON.stringify({ item_id: 'I1', on_hand: 12, unit: 'piece' }), WALL, WALL, first.deps.writer.lastSeq() + 1);
    append(first, [{ ...draft('stock', 'I1', 'StockSet', { stock_item_id: 'I1', on_hand: 7, unit: 'piece' }, WALL), schema_version: 2 }]);
    const stored = first.deps.db
      .prepare(`SELECT schema_version, payload FROM events WHERE event_type = 'StockSet' ORDER BY seq`)
      .all() as Array<{ schema_version: number; payload: string }>;
    expect(stored.map((row) => [row.schema_version, JSON.parse(row.payload) as unknown])).toEqual([
      [1, { item_id: 'I1', on_hand: 12, unit: 'piece' }],
      [2, { stock_item_id: 'I1', on_hand: 7, unit: 'piece' }],
    ]);
    await first.stop();
    cleanups.splice(cleanups.length - 1, 1);

    const second = await start(cfg.path, WALL + 60_000);
    expect(Object.keys(engine(second).stock)).toEqual(['I1']);
    expect(engine(second).stock.I1).toMatchObject({ on_hand: 7, reserved: 0, unit: 'piece' });
  });

  it('[01a §10 #93] restart after StockSet → set_at equals its value before the restart', async () => {
    registerRestaurantBootSteps();
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const first = await start(cfg.path, WALL);
    append(first, [draft('stock', 'I1', 'StockSet', { item_id: 'I1', on_hand: 4, unit: 'piece' }, WALL)]);
    const setAt = engine(first).stock.I1!.set_at;
    const recordedAt = first.deps.db
      .prepare(`SELECT recorded_at FROM events WHERE event_type = 'StockSet'`)
      .pluck()
      .get() as number;
    expect(setAt).toBe(recordedAt);
    await first.stop();
    cleanups.splice(cleanups.length - 1, 1);

    const second = await start(cfg.path, WALL + 3_600_000);
    expect(second.deps.clock.branchNow()).toBeGreaterThan(recordedAt);
    expect(engine(second).stock.I1!.set_at).toBe(setAt);
  });

  it('[01a S33] a BusinessDayOpened and BusinessDayClosed in the log are folded at boot', async () => {
    registerRestaurantBootSteps();
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const first = await start(cfg.path, WALL);
    const units = { I1: { stock_unit: 'piece', sale_unit: 'piece', stock_per_sale_unit: 1 } };
    append(first, [draft('hub', BRANCH, 'BusinessDayOpened', { business_date: '2025-10-20', units }, WALL)]);
    const opened = engine(first).business_day;
    expect(opened).toMatchObject({ business_date: '2025-10-20', closed_at: null, units });
    await first.stop();
    cleanups.splice(cleanups.length - 1, 1);

    const second = await start(cfg.path, WALL + 60_000);
    expect(engine(second).business_day).toEqual(opened);
    append(second, [draft('hub', BRANCH, 'BusinessDayClosed', {}, WALL + 60_000)]);
    const closed = engine(second).business_day;
    expect(closed?.closed_at).not.toBeNull();
    await second.stop();
    cleanups.splice(cleanups.length - 1, 1);

    const third = await start(cfg.path, WALL + 120_000);
    expect(engine(third).business_day).toEqual(closed);
  });

  it('[01a §6.19] stockVersion after boot equals the last stock-stream or business-day event seq; noteCommitted moves it after a commit and ignores other events', async () => {
    registerRestaurantBootSteps();
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const first = await start(cfg.path, WALL);
    const [stockSeq] = append(first, [draft('stock', 'I1', 'StockSet', { item_id: 'I1', on_hand: 4, unit: 'piece' }, WALL)]);
    expect(stockVersion()).toBe(stockSeq);
    const [daySeq] = append(first, [
      draft('hub', BRANCH, 'BusinessDayOpened', { business_date: '2025-10-20', units: {} }, WALL),
    ]);
    expect(stockVersion()).toBe(daySeq);
    const [offSeq] = append(first, [draft('stock', 'I1', 'ItemMadeUnavailable', { item_id: 'I1' }, WALL)]);
    expect(stockVersion()).toBe(offSeq);
    // another event commits: the version stays
    const [other] = append(first, [draft('hub', BRANCH, 'ClockAlarm', { wall_ms: WALL, last_recorded_at: WALL, delta_ms: 0, source: 'cloud_offset' }, WALL)]);
    expect(other).toBeGreaterThan(offSeq!);
    expect(stockVersion()).toBe(offSeq);
    await first.stop();
    cleanups.splice(cleanups.length - 1, 1);

    setStockVersion(-1);
    const second = await start(cfg.path, WALL + 60_000);
    // the ClockAlarm and HubStarted come later in the log; the fold still reports the ItemMadeUnavailable seq
    expect(second.deps.writer.lastSeq()).toBeGreaterThan(offSeq!);
    expect(stockVersion()).toBe(offSeq);
    const [added] = append(second, [draft('stock', 'I1', 'StockAdded', { item_id: 'I1', quantity: 2, unit: 'piece' }, WALL)]);
    expect(stockVersion()).toBe(added);
  });

  it('[01a S15] main.ts registers the restaurant boot steps', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)), 'utf8');
    const registers = source.indexOf('registerRestaurantBootSteps()');
    expect(registers).toBeGreaterThan(-1);
    expect(source).toMatch(/import \{ registerRestaurantBootSteps \} from '\.\/sync\/boot-steps\.js';/);
    expect(registers).toBeLessThan(source.indexOf('boot({'));
  });
});
