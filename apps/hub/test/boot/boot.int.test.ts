import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../../src/config/schema';
import { openDb } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { boot, registerBootStep } from '../../src/lib/boot';
import { fixedClock } from '../../src/lib/clock';

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
    const booted = await boot({ configPath: cfg.path, wallNow: () => WALL, monoNow: () => 0 });
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

  it('[00 §3.8] registered steps run in order', async () => {
    const seen: string[] = [];
    registerBootStep('5', () => seen.push('5'));
    registerBootStep('2', () => seen.push('2'));
    registerBootStep('6', () => seen.push('6'));
    registerBootStep('3', () => seen.push('3'));
    const cfg = writeConfig({ provisioned: true });
    const booted = await boot({ configPath: cfg.path, wallNow: () => WALL, monoNow: () => 0 });
    cleanups.push(() => booted.stop(), cfg.cleanup);
    expect(seen).toEqual(['2', '3', '5', '6']);
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
    body.provisioned = { tenant_id: 'tenant-a', branch_id: 'branch-1', branch_api_key: 'test-branch-api-key' };
  }
  writeFileSync(path, JSON.stringify(body));
  return { path, dataDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
