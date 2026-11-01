/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { runAppRelease } from '../../src/app-update/cli';
import { writeHubConfigAtomic } from '../../src/config/write';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, pairDevice, type TestHub } from '../helpers/test-hub';

const APK_TYPE = 'application/vnd.android.package-archive';
const cleanups: Array<() => Promise<void> | void> = [];

describe('tablet app update (00 §6.36–§6.38)', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[01d #40] no release → latest 404 ROUTE_NOT_FOUND', async () => {
    const { hub, t1 } = await open();
    const res = await latest(hub, t1.token);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('[01d #40] add staged to T1 → T1 gets it, T2 gets 404 (no good release) then the previous good one; mark-good → T2 gets it', async () => {
    const { hub, t1, t2 } = await open();
    const cli = cliOn(hub);
    await cli.add(10, '1.0.0', t1.deviceId);
    expect((await latest(hub, t1.token)).json().data).toEqual({
      version_name: '1.0.0',
      version_code: 10,
      sha256: sha(apkBytes(10)),
      staged_device_id: t1.deviceId,
    });
    const none = await latest(hub, t2.token);
    expect(none.statusCode).toBe(404);
    expect(none.json().error.code).toBe('ROUTE_NOT_FOUND');

    await cli.markGood(10);
    expect((await latest(hub, t2.token)).json().data).toEqual({
      version_name: '1.0.0',
      version_code: 10,
      sha256: sha(apkBytes(10)),
      staged_device_id: null,
    });

    await cli.add(11, '1.1.0', t1.deviceId);
    expect((await latest(hub, t1.token)).json().data.version_code).toBe(11);
    expect((await latest(hub, t2.token)).json().data).toMatchObject({
      version_code: 10,
      staged_device_id: null,
    });

    await cli.markGood(11);
    expect((await latest(hub, t2.token)).json().data).toEqual({
      version_name: '1.1.0',
      version_code: 11,
      sha256: sha(apkBytes(11)),
      staged_device_id: null,
    });
  });

  it('[01d #40] GET /app/android/<version_code>.apk streams the file as an APK whose bytes hash to the stored sha256', async () => {
    const { hub, t1 } = await open();
    await cliOn(hub).add(10, '1.0.0', t1.deviceId);
    const stored = (await latest(hub, t1.token)).json().data.sha256 as string;
    const res = await hub.app.inject({
      method: 'GET',
      url: '/app/android/10.apk',
      headers: auth(t1.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(APK_TYPE);
    expect(res.rawPayload.equals(apkBytes(10))).toBe(true);
    expect(sha(res.rawPayload)).toBe(stored);
  });

  it('[01d #40] a KDS device gets 403 DEVICE_TYPE_NOT_ALLOWED on latest and .apk', async () => {
    const { hub, t1 } = await open();
    await cliOn(hub).add(10, '1.0.0', t1.deviceId);
    const kds = pairDevice(hub, { type: 'kds', stationId: 'ST_GRILL' });
    for (const url of ['/app/android/latest', '/app/android/10.apk']) {
      const res = await hub.app.inject({
        method: 'GET',
        url,
        headers: auth(kds.token),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('DEVICE_TYPE_NOT_ALLOWED');
    }
  });

  it('[01d #40] add keeps the newest 2 good versions plus the staged one and deletes older files from <data_dir>/apk/', async () => {
    const { hub, t1, t2 } = await open();
    const cli = cliOn(hub);
    for (const code of [10, 11, 12]) {
      await cli.add(code, `1.${code}.0`, t1.deviceId);
      await cli.markGood(code);
    }
    await cli.add(13, '1.13.0', t2.deviceId);
    expect(rows(hub)).toEqual([
      { version_code: 11, staged_device_id: null },
      { version_code: 12, staged_device_id: null },
      { version_code: 13, staged_device_id: t2.deviceId },
    ]);
    expect(apkFiles(hub)).toEqual(['11.apk', '12.apk', '13.apk']);

    // A newer staged release replaces the older staged one.
    await cli.add(14, '1.14.0', t1.deviceId);
    expect(rows(hub)).toEqual([
      { version_code: 11, staged_device_id: null },
      { version_code: 12, staged_device_id: null },
      { version_code: 14, staged_device_id: t1.deviceId },
    ]);
    expect(apkFiles(hub)).toEqual(['11.apk', '12.apk', '14.apk']);
    expect((await latest(hub, t2.token)).json().data.version_code).toBe(12);
  });

  it('[00 §6.36] latest is 1 statement', async () => {
    const { hub, t1 } = await open();
    await cliOn(hub).add(10, '1.0.0', t1.deviceId);
    const counter = statementCounter(hub.deps.readDb);
    expect((await latest(hub, t1.token)).statusCode).toBe(200);
    expect(counter.count).toBe(1);
  });

  it('[00 §6.36] a release staged to another tablet is not offered, even above an older own staged row', async () => {
    const { hub, t1, t2 } = await open();
    const cli = cliOn(hub);
    await cli.add(10, '1.0.0', t1.deviceId);
    await cli.markGood(10);
    // Simulate a stale staged row for T1 below a newer one staged to T2.
    hub.deps.db
      .prepare('INSERT INTO app_releases VALUES (11, ?, ?, ?, ?)')
      .run('1.1.0', 'x'.repeat(64), t1.deviceId, 1);
    hub.deps.db
      .prepare('INSERT INTO app_releases VALUES (12, ?, ?, ?, ?)')
      .run('1.2.0', 'y'.repeat(64), t2.deviceId, 2);
    expect((await latest(hub, t1.token)).json().data.version_code).toBe(10);
    expect((await latest(hub, t2.token)).json().data.version_code).toBe(12);
  });

  it('[00 §6.37] an unknown version_code .apk → 404 ROUTE_NOT_FOUND', async () => {
    const { hub, t1 } = await open();
    await cliOn(hub).add(10, '1.0.0', t1.deviceId);
    for (const url of ['/app/android/99.apk', '/app/android/abc.apk', '/app/android/10.zip']) {
      const res = await hub.app.inject({
        method: 'GET',
        url,
        headers: auth(t1.token),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('ROUTE_NOT_FOUND');
    }
  });

  it('[00 §6.36] no device token → 401 DEVICE_TOKEN_INVALID', async () => {
    const { hub } = await open();
    const res = await hub.app.inject({
      method: 'GET',
      url: '/app/android/latest',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('DEVICE_TOKEN_INVALID');
  });

  it('[00 §6.38] mark-good on an unknown version and add without --stage fail without writing', async () => {
    const { hub, t1 } = await open();
    const cli = cliOn(hub);
    await expect(cli.markGood(42)).rejects.toThrow(/42/);
    await expect(
      cli.run(['add', apkSource(hub, 10), '--version-code', '10', '--version-name', '1.0.0']),
    ).rejects.toThrow(/--stage/);
    await cli.add(10, '1.0.0', t1.deviceId);
    await expect(cli.add(10, '1.0.0', t1.deviceId)).rejects.toThrow(/10/);
    expect(rows(hub)).toEqual([{ version_code: 10, staged_device_id: t1.deviceId }]);
  });

  it('[00 §6.38] pnpm --filter @pos/hub app-release runs the CLI', async () => {
    const { hub, t1 } = await open();
    const configPath = join(hub.deps.config.data_dir, 'config.json');
    writeHubConfigAtomic(configPath, hub.deps.config);
    const run = spawnSync(
      'pnpm',
      [
        '--filter',
        '@pos/hub',
        'app-release',
        'add',
        apkSource(hub, 10),
        '--version-code',
        '10',
        '--version-name',
        '1.0.0',
        '--stage',
        t1.deviceId,
      ],
      {
        cwd: join(import.meta.dirname, '../../../..'),
        env: { ...process.env, POS_HUB_CONFIG: configPath },
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    expect(run.stderr).not.toMatch(/not found/);
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/app-release add 10/);
    expect(rows(hub)).toEqual([{ version_code: 10, staged_device_id: t1.deviceId }]);
  }, 70_000);
});

async function open(): Promise<{
  hub: TestHub;
  t1: { deviceId: string; token: string };
  t2: { deviceId: string; token: string };
}> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  return {
    hub,
    t1: pairDevice(hub, { type: 'tablet', name: 'T1' }),
    t2: pairDevice(hub, { type: 'tablet', name: 'T2' }),
  };
}

function cliOn(hub: TestHub) {
  const configPath = join(hub.deps.config.data_dir, 'config.json');
  writeHubConfigAtomic(configPath, hub.deps.config);
  const out = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const run = (args: string[]) =>
    runAppRelease({
      configPath,
      args,
      wallNow: () => hub.clock.branchNow(),
      out,
    });
  return {
    run,
    add: (code: number, name: string, stage: string) =>
      run(['add', apkSource(hub, code), '--version-code', String(code), '--version-name', name, '--stage', stage]),
    markGood: (code: number) => run(['mark-good', String(code)]),
  };
}

function apkBytes(code: number): Buffer {
  return Buffer.from(`PK\u0003\u0004 fake apk ${code} `.repeat(64));
}

function apkSource(hub: TestHub, code: number): string {
  const path = join(hub.deps.config.data_dir, `build-${code}.apk`);
  writeFileSync(path, apkBytes(code));
  return path;
}

function sha(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function latest(hub: TestHub, token: string) {
  return hub.app.inject({
    method: 'GET',
    url: '/app/android/latest',
    headers: auth(token),
  });
}

function rows(hub: TestHub): Array<{ version_code: number; staged_device_id: string | null }> {
  return hub.deps.db
    .prepare('SELECT version_code, staged_device_id FROM app_releases ORDER BY version_code')
    .all() as Array<{ version_code: number; staged_device_id: string | null }>;
}

function apkFiles(hub: TestHub): string[] {
  const dir = join(hub.deps.config.data_dir, 'apk');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}
