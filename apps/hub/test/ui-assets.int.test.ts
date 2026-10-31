import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { guardsFor } from '../src/auth/guards';
import { boot } from '../src/lib/boot';
import { uiVersion } from '../src/lib/ui-assets';
import { createTestHub } from './helpers/test-hub';

const LONG_CACHE = 'public, max-age=31536000, immutable';

describe('UI kit route', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #135] serves the kit css and fonts with long caching, nothing else, before provisioning too, and refuses guests and bad hosts', async () => {
    expect(guardsFor('static')).toEqual(['host', 'guest']);
    const hub = await createTestHub();
    cleanups.push(() => hub.close());

    for (const url of ['/ui/tokens.css', '/ui/components/bundle.css', `/ui/tokens.css?v=${uiVersion()}`]) {
      const res = await hub.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type']).toBe('text/css; charset=utf-8');
      expect(res.headers['cache-control']).toBe(LONG_CACHE);
    }
    const tokens = await hub.app.inject({ method: 'GET', url: '/ui/tokens.css' });
    expect(tokens.body).toContain('--surface');
    const font = await hub.app.inject({ method: 'GET', url: '/ui/fonts/Figtree-var.woff2' });
    expect(font.statusCode).toBe(200);
    expect(font.headers['content-type']).toBe('font/woff2');
    expect(font.headers['cache-control']).toBe(LONG_CACHE);
    expect(font.rawPayload.subarray(0, 4).toString('latin1')).toBe('wOF2');

    for (const url of [
      '/ui/README.md',
      '/ui/tokens.json',
      '/ui/fonts/OFL-NotoNastaliqUrdu.txt',
      '/ui/../package.json',
      '/ui/%2e%2e/package.json',
      '/ui/fonts/../../package.json',
      '/ui/missing.css',
      '/ui/',
    ]) {
      const res = await hub.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error.code).toBe('ROUTE_NOT_FOUND');
    }

    const guest = await hub.app.inject({ method: 'GET', url: '/ui/tokens.css', remoteAddress: '192.168.20.7' });
    expect(guest.statusCode).toBe(403);
    expect(guest.json().error.code).toBe('GUEST_NETWORK_FORBIDDEN');
    const badHost = await hub.app.inject({ method: 'GET', url: '/ui/tokens.css', headers: { host: 'evil.example:3000' } });
    expect(badHost.statusCode).toBe(403);
    expect(badHost.json().error.code).toBe('HOST_NOT_ALLOWED');

    const unprovisioned = await createTestHub({ provisioned: false });
    cleanups.push(() => unprovisioned.close());
    expect((await unprovisioned.app.inject({ method: 'GET', url: '/ui/tokens.css' })).statusCode).toBe(200);

    const dir = mkdtempSync(join(tmpdir(), 'pos-ui-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'data'));
    mkdirSync(join(dir, 'backup'));
    const configPath = join(dir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        cloud_base_url: 'https://cloud.example',
        http_port: 3000,
        data_dir: join(dir, 'data'),
        backup_dir: join(dir, 'backup'),
        min_client_version: '1.0.0',
      }),
    );
    const setupMode = await boot({ configPath, wallNow: () => 1_761_000_000_000, monoNow: () => 0, ifaces: ['192.168.10.2'] });
    cleanups.push(() => setupMode.stop());
    const res = await setupMode.app.inject({ method: 'GET', url: '/ui/components/bundle.css', headers: { host: 'localhost:3000' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe(LONG_CACHE);
    const setupMissing = await setupMode.app.inject({ method: 'GET', url: '/ui/README.md', headers: { host: 'localhost:3000' } });
    expect(setupMissing.statusCode).toBe(404);
  });

  it('[00 §6.35] the version is a 12-hex hash of the two stylesheets', () => {
    expect(uiVersion()).toMatch(/^[0-9a-f]{12}$/);
    expect(uiVersion()).toBe(uiVersion());
  });
});
