import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { boot, registerBootStep, type BootOptions } from '../../src/lib/boot';
import { STAFF_DIST_DIR } from '../../src/lib/client-dist';
import { fixedClock } from '../../src/lib/clock';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';

// 05b H-1: the server reads STAFF_DIST_DIR / KDS_DIST_DIR at build time; a test may point them at a stand-in build or
// a missing directory. Undefined = the real directory.
const dist = vi.hoisted(() => ({ staff: undefined as string | undefined, kds: undefined as string | undefined }));
vi.mock('../../src/lib/client-dist', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/client-dist')>();
  return {
    ...real,
    get STAFF_DIST_DIR() {
      return dist.staff ?? real.STAFF_DIST_DIR;
    },
    get KDS_DIST_DIR() {
      return dist.kds ?? real.KDS_DIST_DIR;
    },
  };
});
const sha256 = (body: string | Buffer): string => createHash('sha256').update(body).digest('hex');
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
    const staffIndex = join(STAFF_DIST_DIR, 'index.html');
    expect(staff.json().data).toEqual({
      staff_build: existsSync(staffIndex) ? sha256(readFileSync(staffIndex)) : null,
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

  it('[05b #7] [05b H-1] staff_build = sha256 of the /staff/ index.html loaded at start: in non-guest /health and as /staff/ meta pos-staff-build only (not /kds/, not guest /health); no staff build → null and no meta', async () => {
    const STAFF_INDEX = '<!doctype html><head><title>staff</title></head><script type="module" src="/staff/assets/s1.js"></script>';
    const staffDir = mkdtempSync(join(tmpdir(), 'pos-health-staff-'));
    writeFileSync(join(staffDir, 'index.html'), STAFF_INDEX);
    const kdsDir = mkdtempSync(join(tmpdir(), 'pos-health-kds-'));
    writeFileSync(join(kdsDir, 'index.html'), '<!doctype html><head><title>kds</title></head>');
    cleanups.push(() => {
      dist.staff = undefined;
      dist.kds = undefined;
      rmSync(staffDir, { recursive: true, force: true });
      rmSync(kdsDir, { recursive: true, force: true });
    });
    dist.staff = staffDir;
    dist.kds = kdsDir;
    const cfg = writeConfig(true);
    const booted = await boot(bootOpts(cfg));
    cleanups.push(() => booted.stop(), cfg.cleanup);
    // a release replacing the file on disk takes effect at the next restart, like the page itself
    writeFileSync(join(staffDir, 'index.html'), 'changed after start');
    const get = (url: string, remoteAddress = '192.168.10.9') => booted.app.inject({ method: 'GET', url, remoteAddress, headers: { host: HOST } });
    const build = sha256(STAFF_INDEX);
    expect(build).toMatch(/^[0-9a-f]{64}$/);
    expect((await get('/health')).json().data.staff_build).toBe(build);
    expect((await get('/health', GUEST)).json()).toEqual({ data: { status: 'ready' } });
    const staffPage = await get('/staff/');
    expect(staffPage.statusCode).toBe(200);
    expect(staffPage.body).toContain(`<meta name="pos-staff-build" content="${build}">`);
    expect(staffPage.body).toContain('<meta name="pos-tenant-id" content="tenant-a">');
    const kdsPage = await get('/kds/');
    expect(kdsPage.statusCode).toBe(200);
    expect(kdsPage.body).toContain('<meta name="pos-tenant-id" content="tenant-a">');
    expect(kdsPage.body).not.toContain('pos-staff-build');

    dist.staff = join(tmpdir(), 'pos-health-staff-missing-does-not-exist');
    const bareCfg = writeConfig(true);
    const bare = await boot(bootOpts(bareCfg));
    cleanups.push(() => bare.stop(), bareCfg.cleanup);
    const bareHealth = await bare.app.inject({ method: 'GET', url: '/health', remoteAddress: '192.168.10.9', headers: { host: HOST } });
    expect(bareHealth.json().data.staff_build).toBeNull();
    const bareKds = await bare.app.inject({ method: 'GET', url: '/kds/', remoteAddress: '192.168.10.9', headers: { host: HOST } });
    expect(bareKds.body).not.toContain('pos-staff-build');

    // setup mode loads no staff build
    const setupCfg = writeConfig(false);
    const setup = await boot(bootOpts(setupCfg));
    cleanups.push(() => setup.stop(), setupCfg.cleanup);
    const setupHealth = await setup.app.inject({ method: 'GET', url: '/health', remoteAddress: '192.168.10.9', headers: { host: HOST } });
    expect(setupHealth.json().data.staff_build).toBeNull();
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
