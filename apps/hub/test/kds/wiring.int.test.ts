import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boot } from '../../src/lib/boot';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub } from '../helpers/test-hub';

// 03b P0.11 (03b §5 note, D12; 03c §3.5, §3.7, G-7, G-8): the skeleton is wired. A probe projection stands in for
// each module's lane register files (empty in phase 0), so the registration order is visible.
vi.mock('../../src/kds/lanes/B1', () => ({
  register: () => undefined,
  registerProjections: (p: { register(x: unknown): void }) =>
    p.register({ name: 'probe_kds', eventTypes: [], apply: () => undefined }),
}));
vi.mock('../../src/print/lanes/C1', () => ({
  register: () => undefined,
  registerProjections: (p: { register(x: unknown): void }) =>
    p.register({ name: 'probe_print', eventTypes: [], apply: () => undefined }),
}));

const WALL = 1_761_000_000_000;

describe('[03b #53, 03c #10] 03b / 03c wiring (phase 0 skeleton)', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[03b §5, 03c #10] test hub: kds then print projections register right after 02b orders', async () => {
    const hub = await createTestHub({ provisioned: true });
    cleanups.push(() => hub.close());
    const order = Object.keys(hub.deps.projections.catchUp(hub.deps.db, hub.deps.config.provisioned!.branch_id).replayed);
    // b13: lane B4's `pass` (not mocked) registers after B1's probe, before 03c
    expect(order.slice(order.indexOf('orders'))).toEqual(['orders', 'probe_kds', 'pass', 'probe_print']);
  });

  it('[03b §5, 03c §3.7, H-11] a booted hub with every stub registers in that order, starts, listens and stops', async () => {
    const cfg = writeConfig(await freePort());
    cleanups.push(cfg.cleanup);
    const booted = await boot({
      configPath: cfg.path,
      wallNow: () => WALL,
      monoNow: () => 0,
      listen: true,
      configClient: stubConfigCloud(),
      cloudClient: offlineCloud(),
    });
    let stopped = false;
    cleanups.push(async () => {
      if (!stopped) await booted.stop();
    });
    const order = Object.keys(booted.deps.projections.catchUp(booted.deps.db, 'branch-1').replayed);
    // boot registers 00's access_reconcile after createDeps; 03b / 03c sit right after 02b's orders
    expect(order.slice(order.indexOf('orders'), order.indexOf('orders') + 4)).toEqual(['orders', 'probe_kds', 'pass', 'probe_print']);
    expect(booted.app.server.listening).toBe(true);
    await booted.stop();
    stopped = true;
    expect(booted.app.server.listening).toBe(false);
  });
});

describe('[03b §4.2, 03c §4.2] contracts and hooks before their tasks', () => {
  it('[03b §4.2] every 03b export throws "not built" until its task', async () => {
    const kds = await import('../../src/kds/contracts');
    // stationPresence: built by b20, provided by lane B6's register (test/kds/presence.int.test.ts).
    // buildLineDetails, pointOfLine: built by b11 (test/kds/details.int.test.ts).
    expect(() => kds.devicePoint('D1')).toThrow(/not built/);
    // handoversDue: built by b17, provided by lane B5's register (test/pass/handovers-due.int.test.ts).
    // undoReadyForLines: built by b9b, provided by lane B4's register (test/pass/undo-ready.int.test.ts).
  });

  it('[03c §4.2] printDocument throws "not built"; the boot, worker and retention hooks are no-ops', async () => {
    const print = await import('../../src/print/contracts');
    void print; // printDocument: built by c18, provided by lane C4's register (test/print/api.int.test.ts).
    // renderText: built by c10 (test/print/render.int.test.ts).
    const hooks = await import('../../src/print/boot');
    expect(() => hooks.resumePrintQueue({} as never)).not.toThrow();
    const stop = hooks.startPrintWorker({} as never, { error: () => undefined });
    expect(() => stop()).not.toThrow();
    expect(() => {
      hooks.registerPrintBootSteps();
      hooks.registerPrintBootSteps(); // once-guarded
    }).not.toThrow();
    const retention = await import('../../src/print/retention');
    expect(retention.purgePrint({} as never, 'branch-1', WALL)).toBe(0);
  });
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address !== null ? address.port : 0));
    });
  });
}

function writeConfig(port: number): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-wiring-'));
  const dataDir = join(dir, 'data');
  const backupDir = join(dir, 'backup');
  mkdirSync(dataDir);
  mkdirSync(backupDir);
  const path = join(dir, 'config.json');
  writeFileSync(
    path,
    JSON.stringify({
      cloud_base_url: 'https://cloud.example',
      http_port: port,
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
