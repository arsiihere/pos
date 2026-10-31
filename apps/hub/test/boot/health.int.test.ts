import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { boot, registerBootStep, type BootOptions } from '../../src/lib/boot';
import { fixedClock } from '../../src/lib/clock';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const WALL = 1_761_000_000_000;
const HOST = '192.168.10.2:3000';
const GUEST = '192.168.20.7';
const DOWN_AT = 1_700_000_000_000;

describe('health, heartbeat, HubStarted', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    vi.useRealTimers();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #14] /health in setup, booting and ready; no guest guard', async () => {
    let booting: { status?: number; body?: { status?: string } } = {};
    registerBootStep('5', async (ctx) => {
      const app = (ctx as { app?: FastifyInstance }).app;
      if (app === undefined) return;
      const guest = await app.inject({
        method: 'GET',
        url: '/health',
        remoteAddress: GUEST,
        headers: { host: HOST },
      });
      booting = { status: guest.statusCode, body: guest.json().data };
    });
    const readyCfg = writeConfig(true);
    const ready = await boot(bootOpts(readyCfg));
    cleanups.push(() => ready.stop(), readyCfg.cleanup);
    const readyGuest = await ready.app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: GUEST,
      headers: { host: HOST },
    });
    const setupCfg = writeConfig(false);
    const setup = await boot(bootOpts(setupCfg));
    cleanups.push(() => setup.stop(), setupCfg.cleanup);
    const setupGuest = await setup.app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: GUEST,
      headers: { host: HOST },
    });
    expect(booting).toEqual({ status: 200, body: { status: 'booting' } });
    expect(readyGuest.statusCode).toBe(200);
    expect(readyGuest.json().data.status).toBe('ready');
    expect(setupGuest.statusCode).toBe(200);
    expect(setupGuest.json().data.status).toBe('setup');
  });

  it('[00 §10 #108] guest IP → { status } only', async () => {
    const cfg = writeConfig(true);
    const booted = await boot(bootOpts(cfg));
    cleanups.push(() => booted.stop(), cfg.cleanup);
    const guest = await booted.app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: GUEST,
      headers: { host: HOST },
    });
    const staff = await booted.app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: '192.168.10.9',
      headers: { host: HOST },
    });
    expect(guest.statusCode).toBe(200);
    expect(guest.json()).toEqual({ data: { status: 'ready' } });
    expect(staff.statusCode).toBe(200);
    expect(staff.json().data).toEqual({
      status: 'ready',
      boot_step: '8',
      provisioned: true,
      confirmed: false,
      branch_id: 'branch-1',
      max_seq: 1,
      hub_version: '0.0.0',
      clock_alarm: null,
    });
  });

  it('[00 §10 #71] HubStarted hub_down_at from the heartbeat; null on first boot', async () => {
    const firstCfg = writeConfig(true);
    const first = await boot(bootOpts(firstCfg));
    const firstEvent = hubStarted(first.deps.db);
    await first.stop();
    firstCfg.cleanup();

    const secondCfg = writeConfig(true);
    const db = openDb(join(secondCfg.dataDir, 'hub.sqlite'));
    await runMigrations(db, { dir: migrationsDir, clock: fixedClock(WALL) });
    db.prepare('INSERT INTO hub_heartbeat (branch_id, last_beat) VALUES (?, ?)').run('branch-1', DOWN_AT);
    db.close();
    const second = await boot(bootOpts(secondCfg));
    cleanups.push(() => second.stop(), secondCfg.cleanup);
    const secondEvent = hubStarted(second.deps.db);
    expect(firstEvent).toMatchObject({
      hub_down_at: null,
      hub_up_at: WALL,
      events_replayed: 0,
      missed_fires: 0,
      boot_ms: 0,
    });
    expect(secondEvent.hub_down_at).toBe(DOWN_AT);
    expect(secondEvent.hub_up_at).toBe(WALL);
  });

  it('[F §5.8, D41] heartbeat every 60 s', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let mono = 0;
    const cfg = writeConfig(true);
    const booted = await boot({
      configPath: cfg.path,
      wallNow: () => WALL,
      monoNow: () => mono,
      configClient: stubConfigCloud(),
      cloudClient: offlineCloud(),
    });
    cleanups.push(() => booted.stop(), cfg.cleanup);
    expect(beat(booted.deps.db)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(beat(booted.deps.db)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(beat(booted.deps.db)).toBe(WALL);
    mono = 5_000;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(beat(booted.deps.db)).toBe(WALL + 5_000);
  });
});

function hubStarted(db: Database.Database): {
  hub_down_at: number | null;
  hub_up_at: number;
  events_replayed: number;
  missed_fires: number;
  boot_ms: number;
} {
  const row = db.prepare(`SELECT payload FROM events WHERE event_type = 'HubStarted'`).get() as
    | { payload: string }
    | undefined;
  if (row === undefined) throw new Error('HubStarted was not written');
  return JSON.parse(row.payload) as ReturnType<typeof hubStarted>;
}

function beat(db: { prepare: (sql: string) => { get: () => unknown } }): number | undefined {
  const row = db.prepare('SELECT last_beat FROM hub_heartbeat').get() as { last_beat: number } | undefined;
  return row?.last_beat;
}

function bootOpts(cfg: { path: string }): BootOptions {
  return { configPath: cfg.path, wallNow: () => WALL, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud() };
}

function writeConfig(provisioned: boolean): { path: string; dataDir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-health-'));
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir);
  const path = join(dir, 'config.json');
  const body: Record<string, unknown> = {
    cloud_base_url: 'https://cloud.example',
    http_port: 3000,
    data_dir: dataDir,
    backup_dir: dataDir,
    min_client_version: '1.0.0',
    backup_encryption_key: Buffer.alloc(32, 7).toString('base64'),
    advertised_host: '192.168.10.2',
    guest_network_cidrs: ['192.168.20.0/24'],
  };
  if (provisioned) {
    body.provisioned = { tenant_id: 'tenant-a', branch_id: 'branch-1', branch_name: 'Main', branch_api_key: 'test-branch-api-key' };
  }
  writeFileSync(path, JSON.stringify(body));
  return { path, dataDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
