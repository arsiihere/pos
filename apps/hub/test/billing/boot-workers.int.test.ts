import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { registerFiscalWorkerSeams, resetFiscalWorkerSeams } from '../../src/billing/index';
import { FISCAL_LOOP_MS } from '../../src/billing/fiscal/worker';
import { boot, registerBootStep, type BootContext } from '../../src/lib/boot';
import { createLogCapture } from '../helpers/log-capture';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';

// 00 row H-3 (05 v1.0.7 §3.15, P0.18; G-21, PL-18): boot calls task 7's startBillingWorkers after listen, beside the
// print worker, and joins its stop to beat.stop. Mirrors the 01d tick-loop boot test (test/boot/boot.int.test.ts):
// a step-6 hook proves nothing ran at or before step 6, and a listen probe (app.listen replaced, no port bound) runs the
// fake timers inside listen, so a worker started before listen would pass there; each pass records whether step 7's
// HubStarted is already in `events` (as the tick test's first pass does). Fake timers, no timing asserts (AD-32).
// A fiscal pass is seen as its `fiscal_outbox` pending read on the hub db.

const WALL = 1_761_000_000_000;
const PASS_SQL = /FROM fiscal_outbox WHERE state = 'pending'/;
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

// boot steps are process-wide and never unregistered: one hook, armed per test
let armed: ((ctx: BootContext) => void) | null = null;
registerBootStep('6', (ctx) => {
  armed?.(ctx);
});

async function bootWithProbe(): Promise<{
  stop: () => Promise<void>;
  passes: () => number;
  hubStartedAtPass: () => number[];
  atStep6: () => number;
  log: () => string;
}> {
  const cfg = writeConfig();
  cleanups.push(cfg.cleanup);
  let spy: MockInstance | null = null;
  const seen: number[] = []; // per pass: the HubStarted rows already in `events`
  let atStep6 = -1;
  armed = (ctx) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const db: Database.Database = ctx.db;
    const prepare = db.prepare.bind(db);
    spy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      if (PASS_SQL.test(sql)) seen.push(prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'HubStarted'`).pluck().get() as number);
      return prepare(sql);
    }) as typeof db.prepare);
    // a worker started at or before step 6 would run its passes here
    vi.advanceTimersByTime(FISCAL_LOOP_MS * 5);
    atStep6 = seen.length;
    // a worker started before listen would run its passes inside listen (still before step 7's HubStarted)
    vi.spyOn(ctx.app!, 'listen').mockImplementation((async () => {
      await vi.advanceTimersByTimeAsync(FISCAL_LOOP_MS * 5);
      return '';
    }) as unknown as FastifyInstance['listen']);
  };
  cleanups.push(() => {
    armed = null;
    spy?.mockRestore();
    vi.useRealTimers();
  });
  const capture = createLogCapture();
  const booted = await boot({
    configPath: cfg.path,
    wallNow: () => WALL,
    monoNow: () => 0,
    listen: true, // the probe above replaces app.listen: no port is bound
    logStream: capture.stream,
    configClient: stubConfigCloud(),
    cloudClient: offlineCloud(),
  });
  let stopped = false;
  cleanups.push(async () => {
    if (!stopped) await booted.stop();
  });
  return {
    stop: async () => {
      stopped = true;
      await booted.stop();
    },
    passes: () => seen.length,
    hubStartedAtPass: () => [...seen],
    atStep6: () => atStep6,
    log: capture.text,
  };
}

describe('[05 row H-3, G-21] boot starts the billing workers after listen and beat.stop stops them', () => {
  it('[05 row H-3, G-21] with no seams registered: nothing runs, nothing fails, stop is clean', async () => {
    resetFiscalWorkerSeams();
    const hub = await bootWithProbe();
    expect(hub.atStep6()).toBe(0);
    await vi.advanceTimersByTimeAsync(FISCAL_LOOP_MS * 5);
    expect(hub.passes()).toBe(0);
    await expect(hub.stop()).resolves.toBeUndefined();
    expect(hub.log()).not.toMatch(/fiscal\./);
  });

  it('[05 row H-3, G-21] with seams registered: the fiscal worker starts after step 7, beat.stop ends it, no pass after stop', async () => {
    const loadSubmission = vi.fn(() => ({ ok: false as const, error_code: 'not_yet' }));
    const onAnswer = vi.fn();
    registerFiscalWorkerSeams({ loadSubmission, onAnswer });
    cleanups.push(() => resetFiscalWorkerSeams());
    const hub = await bootWithProbe();
    expect(hub.atStep6()).toBe(0); // not started at or before step 6
    expect(hub.passes()).toBe(0); // not started before listen (the probe ran the timers inside listen)
    await vi.advanceTimersByTimeAsync(0);
    expect(hub.passes()).toBe(1); // the first pass, right after boot returned
    expect(hub.hubStartedAtPass()).toEqual([1]); // it sees step 7's HubStarted
    await vi.advanceTimersByTimeAsync(FISCAL_LOOP_MS);
    expect(hub.passes()).toBe(2); // the loop keeps going
    await hub.stop();
    const atStop = hub.passes();
    await vi.advanceTimersByTimeAsync(FISCAL_LOOP_MS * 10);
    expect(hub.passes()).toBe(atStop);
    expect(loadSubmission).not.toHaveBeenCalled(); // empty outbox
    expect(onAnswer).not.toHaveBeenCalled();
    expect(hub.log()).not.toMatch(/fiscal\.pass_failed/);
  });
});

function writeConfig(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-05-boot-'));
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
      provisioned: { tenant_id: 'tenant-a', branch_id: 'branch-1', branch_name: 'Main', branch_api_key: 'test-branch-api-key' },
    }),
  );
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
