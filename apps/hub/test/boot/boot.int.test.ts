import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTick, TICK_MS, unregisterTick } from '../../src/alerts/tick';
import { ConfigError } from '../../src/config/schema';
import { openDb } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { boot, registerBootStep } from '../../src/lib/boot';
import { fixedClock } from '../../src/lib/clock';
import { sha256hex } from '../../src/lib/hash';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const WALL = 1_761_000_000_000;

describe('boot', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #66] wall ≤ last recorded_at → ClockAlarm first, branchNow = last + 1', async () => {
    const cfg = writeConfig({ provisioned: true });
    const db = openDb(join(cfg.dataDir, 'hub.sqlite'));
    await runMigrations(db, { dir: migrationsDir, clock: fixedClock(WALL) });
    db.prepare(
      `INSERT INTO events (
        event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
        schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq
      ) VALUES (?, ?, ?, 'hub', 'branch-1', 'HubProvisioned', 1, ?, ?, ?, NULL, 'hub', 1)`,
    ).run(
      'seed-1',
      'tenant-a',
      'branch-1',
      JSON.stringify({ tenant_id: 'tenant-a', branch_id: 'branch-1', hub_version: '0' }),
      WALL,
      WALL,
    );
    db.close();
    const booted = await boot({ configPath: cfg.path, wallNow: () => WALL, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud() });
    cleanups.push(() => booted.stop(), cfg.cleanup);
    expect(booted.deps.clock.branchNow()).toBe(WALL + 1);
    const rows = booted.deps.db
      .prepare('SELECT event_type, payload FROM events WHERE branch_id = ? ORDER BY seq')
      .all('branch-1') as Array<{ event_type: string; payload: string }>;
    expect(rows.map((row) => row.event_type)).toEqual(['HubProvisioned', 'ClockAlarm', 'HubStarted']);
    expect(JSON.parse(rows[1]!.payload)).toMatchObject({
      source: 'boot',
      wall_ms: WALL,
      last_recorded_at: WALL,
    });
  });

  it('[00 §3.7] the production boot (main.ts options) registers no test command: TestNoop → 404 ROUTE_NOT_FOUND, nothing written', async () => {
    const cfg = writeConfig({ provisioned: true });
    const booted = await boot({ configPath: cfg.path, wallNow: () => WALL, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud() });
    cleanups.push(() => booted.stop(), cfg.cleanup);
    booted.deps.db
      .prepare(
        `INSERT INTO devices (device_id, branch_id, token_hash, device_name, device_type, paired_at, paired_by)
         VALUES ('dev-1', 'branch-1', ?, 'Till', 'tablet', ?, 'S_OWNER')`,
      )
      .run(sha256hex('device-token-1'), WALL);
    const res = await booted.app.inject({
      method: 'POST',
      url: '/commands/test-noop',
      headers: { host: '192.168.10.2:3000', authorization: 'Bearer device-token-1' },
      payload: {
        command_id: 'cmd-test-noop',
        tenant_id: 'tenant-a',
        branch_id: 'branch-1',
        command_type: 'TestNoop',
        payload: {},
        occurred_at: WALL,
        actor_id: 'S_OWNER',
        device_id: 'dev-1',
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ROUTE_NOT_FOUND');
    expect(booted.deps.db.prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'TestNooped'`).pluck().get()).toBe(0);
  });

  it('[00 §3.8] registered steps run in order', async () => {
    const seen: string[] = [];
    registerBootStep('5', () => {
      seen.push('5');
    });
    registerBootStep('2', () => {
      seen.push('2');
    });
    registerBootStep('6', () => {
      seen.push('6');
    });
    registerBootStep('3', () => {
      seen.push('3');
    });
    const cfg = writeConfig({ provisioned: true });
    const booted = await boot({ configPath: cfg.path, wallNow: () => WALL, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud() });
    cleanups.push(() => booted.stop(), cfg.cleanup);
    expect(seen).toEqual(['2', '3', '5', '6']);
  });

  it('[01d §3.5] the tick loop starts after boot step 7 (F §5.8: HubStarted written) and stops on close', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let active = true;
    const passes: number[] = [];
    registerTick({
      name: 'boot_probe',
      due: (db) => {
        passes.push((db.prepare("SELECT COUNT(*) AS n FROM events WHERE event_type = 'HubStarted'").get() as { n: number }).n);
        return false;
      },
      intents: () => [],
    });
    cleanups.push(() => {
      active = false;
      unregisterTick('boot_probe');
      vi.useRealTimers();
    });
    // a loop started at or before step 6 would run its passes here
    registerBootStep('6', () => {
      if (active) vi.advanceTimersByTime(TICK_MS * 4);
    });
    const cfg = writeConfig({ provisioned: true });
    const booted = await boot({ configPath: cfg.path, wallNow: () => WALL, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud() });
    cleanups.push(cfg.cleanup);
    expect(passes).toEqual([]);
    vi.advanceTimersByTime(TICK_MS);
    expect(passes).toEqual([1]); // the first pass sees step 7's HubStarted
    await booted.stop();
    vi.advanceTimersByTime(TICK_MS * 4);
    expect(passes).toEqual([1]);
  });

  it('[00 §3.8] unprovisioned → setup mode routes only', async () => {
    let ran = false;
    registerBootStep('2', () => {
      ran = true;
    });
    const cfg = writeConfig({ provisioned: false });
    const booted = await boot({ configPath: cfg.path, wallNow: () => WALL, monoNow: () => 0 });
    cleanups.push(() => booted.stop(), cfg.cleanup);
    expect(booted.app.printRoutes()).not.toMatch(/commands|queries|admin|auth/);
    expect(ran).toBe(false);
    const missing = await booted.app.inject({
      method: 'GET',
      url: '/commands/x',
      headers: { host: 'localhost:3000' },
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json().error.code).toBe('HUB_NOT_PROVISIONED');
    const foreign = await booted.app.inject({
      method: 'GET',
      url: '/commands/x',
      headers: { host: 'evil.example:3000' },
    });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().error.code).toBe('HOST_NOT_ALLOWED');
    expect((await booted.app.inject({ method: 'GET', url: '/health', headers: { host: 'localhost:3000' } })).statusCode).toBe(
      200,
    );
  });

  it('[00 §6.28] a confirm failure is logged and the branch api key is not', async () => {
    const chunks: Buffer[] = [];
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    const cfg = writeConfig({ provisioned: true });
    const booted = await boot({
      configPath: cfg.path,
      wallNow: () => WALL,
      monoNow: () => 0,
      logStream,
      configClient: stubConfigCloud(),
      cloudClient: offlineCloud(),
    });
    cleanups.push(() => booted.stop(), cfg.cleanup);
    await vi.waitFor(() => {
      expect(Buffer.concat(chunks).toString('utf8')).toContain('hub confirm failed');
    });
    expect(Buffer.concat(chunks).toString('utf8')).not.toContain('test-branch-api-key');
  });

  it('[00 §3.10] invalid config → boot rejects with ConfigError', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-boot-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'config.json');
    writeFileSync(path, '{}');
    await expect(boot({ configPath: path, wallNow: () => WALL, monoNow: () => 0 })).rejects.toBeInstanceOf(ConfigError);
  });
});

function writeConfig(o: { provisioned: boolean }): { path: string; dataDir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-boot-'));
  const dataDir = join(dir, 'data');
  const backupDir = join(dir, 'backup');
  mkdirSync(dataDir);
  mkdirSync(backupDir);
  const path = join(dir, 'config.json');
  const body: Record<string, unknown> = {
    cloud_base_url: 'https://cloud.example',
    http_port: 3000,
    data_dir: dataDir,
    backup_dir: backupDir,
    min_client_version: '1.0.0',
    backup_encryption_key: Buffer.alloc(32, 7).toString('base64'),
  };
  if (o.provisioned) {
    body.advertised_host = '192.168.10.2';
    body.provisioned = { tenant_id: 'tenant-a', branch_id: 'branch-1', branch_name: 'Main', branch_api_key: 'test-branch-api-key' };
  }
  writeFileSync(path, JSON.stringify(body));
  return { path, dataDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
