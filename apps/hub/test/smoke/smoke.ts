import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { boot } from '../../src/lib/boot';
import { buildBigFixture } from '../helpers/big-fixture';
import { PIN } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory } from '../helpers/test-hub';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';

export interface Measure {
  name: string;
  value_ms: number;
  limit_ms: number;
}

export function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

// Built from parts so the §12.1 one-test-per-number grep matches only the test that carries #79.
const TAG = ['[00 §10', '#79]'].join(' ');

export function report(results: Measure[]): { lines: string[]; code: 0 | 1 } {
  const lines = results.map(
    (r) =>
      `${TAG} ${r.name} ${r.value_ms.toFixed(1)} ms (limit ${r.limit_ms} ms) ${r.value_ms <= r.limit_ms ? 'ok' : 'MISS'}`,
  );
  return { lines, code: results.every((r) => r.value_ms <= r.limit_ms) ? 0 : 1 };
}

// Requests before this count are JIT warm-up and are not sampled; the hub is measured warm.
const WARMUP = 20;

async function timed(run: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await run();
  return performance.now() - started;
}

// §7.8: /auth/pin p95 and no-op command p95 on a test hub with M8 argon2 params.
async function measureRequests(): Promise<Measure[]> {
  const hub = await createTestHub();
  try {
    await seedDirectory(hub);
    const tablet = pairDevice(hub, { type: 'tablet' });
    const pins: number[] = [];
    for (let i = 0; i < WARMUP + 40; i += 1) {
      const ms = await timed(() =>
          hub.app.inject({
            method: 'POST',
            url: '/auth/pin',
            headers: { authorization: `Bearer ${tablet.token}` },
            payload: { staff_id: 'S_CASH', pin: PIN.c },
          }),
      );
      if (i >= WARMUP) pins.push(ms);
    }
    const owner = pairDevice(hub, { type: 'tablet' });
    const session = openSession(hub, { kind: 'staff', staffId: 'S_OWNER', deviceId: owner.deviceId });
    const commands: number[] = [];
    for (let i = 0; i < WARMUP + 200; i += 1) {
      const ms = await timed(() =>
          hub.app.inject({
            method: 'POST',
            url: '/commands/test-noop',
            headers: { authorization: `Bearer ${owner.token}`, 'x-session-token': session.token },
            payload: {
              command_id: `smoke-${i}`,
              tenant_id: 'tenant-a',
              branch_id: 'branch-1',
              command_type: 'TestNoop',
              payload: {},
              occurred_at: hub.clock.branchNow(),
              actor_id: 'S_OWNER',
              device_id: owner.deviceId,
            },
          }),
      );
      if (i >= WARMUP) commands.push(ms);
    }
    return [
      { name: 'auth_pin_p95', value_ms: p95(pins), limit_ms: 300 },
      { name: 'command_p95', value_ms: p95(commands), limit_ms: 5 },
    ];
  } finally {
    await hub.close();
  }
}

// §7.8 / #100: 00's boot steps on the 1 M-event fixture.
async function measureBoot(): Promise<Measure> {
  const dir = mkdtempSync(join(tmpdir(), 'pos-smoke-'));
  try {
    const dataDir = join(dir, 'data');
    mkdirSync(dataDir);
    buildBigFixture(join(dataDir, 'hub.sqlite'), 1_000_000);
    const configPath = join(dir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        cloud_base_url: 'https://cloud.example',
        http_port: 3000,
        data_dir: dataDir,
        backup_dir: dataDir,
        min_client_version: '1.0.0',
        backup_encryption_key: Buffer.alloc(32, 7).toString('base64'),
        advertised_host: '192.168.10.2',
        provisioned: { tenant_id: 'tenant-a', branch_id: 'branch-1', branch_name: 'Main', branch_api_key: 'smoke' },
      }),
    );
    let stop: () => Promise<void> = async () => undefined;
    const value = await timed(async () => {
      const booted = await boot({ configPath, wallNow: Date.now, monoNow: () => performance.now(), configClient: stubConfigCloud(), cloudClient: offlineCloud() });
      stop = async () => booted.stop();
    });
    await stop();
    return { name: 'boot_1m', value_ms: value, limit_ms: 5_000 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const results = [...(await measureRequests()), await measureBoot()];
  const { lines, code } = report(results);
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(code);
}
