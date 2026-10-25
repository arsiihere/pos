import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listRouteGuards } from '../src/auth/guards';
import { CSP as HUB_CSP, registerClientDist as registerHubClientDist } from '../src/lib/client-dist';
import { CSP as CLOUD_CSP, registerClientDist as registerCloudClientDist } from '../../cloud/src/lib/client-dist';
import { createTestHub } from './helpers/test-hub';

const EXPECTED_CSP = "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function buildDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'client-dist-'));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

describe('client-dist', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[01a §10 #78] serves only the build files with the CSP and cache headers; ../, unlisted, other entry and missing dir → 404', async () => {
    const own = buildDir({
      'index.html': '<!doctype html><script type="module" src="/t/assets/a1.js"></script>',
      'assets/a1.js': 'console.log(1);',
      '.vite/manifest.json': '{}',
    });
    const other = buildDir({ 'index.html': 'other', 'assets/other-b2.js': 'other();' });
    const missing = join(tmpdir(), 'client-dist-missing-does-not-exist');
    cleanups.push(() => rmSync(own, { recursive: true, force: true }));
    cleanups.push(() => rmSync(other, { recursive: true, force: true }));

    expect(HUB_CSP).toBe(EXPECTED_CSP);
    expect(CLOUD_CSP).toBe(EXPECTED_CSP);

    for (const register of [registerHubClientDist, registerCloudClientDist]) {
      const hub = await createTestHub();
      cleanups.push(() => hub.close());
      register(hub.app, { prefix: '/t/', dir: own, routeConfig: { group: 'static' } });
      register(hub.app, { prefix: '/o/', dir: other, routeConfig: { group: 'static' } });
      register(hub.app, { prefix: '/m/', dir: missing, routeConfig: { group: 'static' } });
      await hub.app.ready();

      const index = await hub.app.inject({ method: 'GET', url: '/t/' });
      expect(index.statusCode).toBe(200);
      expect(index.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(index.headers['cache-control']).toBe('no-cache');
      expect(index.headers['content-security-policy']).toBe(EXPECTED_CSP);
      expect(index.body).toContain('/t/assets/a1.js');

      const asset = await hub.app.inject({ method: 'GET', url: '/t/assets/a1.js' });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers['content-type']).toBe('text/javascript; charset=utf-8');
      expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(asset.headers['content-security-policy']).toBe(EXPECTED_CSP);
      expect(asset.body).toBe('console.log(1);');

      const indexByName = await hub.app.inject({ method: 'GET', url: '/t/index.html' });
      expect(indexByName.statusCode).toBe(200);
      expect(indexByName.headers['content-security-policy']).toBe(EXPECTED_CSP);

      for (const url of [
        '/t/.vite/manifest.json',
        // Plain `../` segments are resolved before routing (as a browser does); an encoded slash reaches the
        // helper as a literal `../` name, which is never listed.
        '/t/../../package.json',
        '/t/..%2f..%2fpackage.json',
        '/t/assets/..%2findex.html',
        '/t/..%2fo%2fassets%2fother-b2.js',
        '/t/assets/missing.js',
        '/t/assets/other-b2.js',
        '/m/',
        '/m/index.html',
      ]) {
        const res = await hub.app.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(404);
        expect(res.json().error.code, url).toBe('ROUTE_NOT_FOUND');
      }
      expect((await hub.app.inject({ method: 'GET', url: '/o/assets/other-b2.js' })).statusCode).toBe(200);

      const errorLines = hub
        .logs()
        .split('\n')
        .filter((line) => line.includes(missing));
      expect(errorLines.length).toBe(1);
      expect(JSON.parse(errorLines[0]!).level).toBe(50);
    }
  });

  it('[01a §7.1] the hub serves /admin/stock/ from the built admin-stock entry under the admin-page guards', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    await hub.app.ready();
    const page = await hub.app.inject({ method: 'GET', url: '/admin/stock/' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-security-policy']).toBe(EXPECTED_CSP);
    expect(page.body).toContain('/admin/stock/assets/');
    expect(listRouteGuards(hub.app).filter((r) => r.url.startsWith('/admin/stock/') && r.method === 'GET')).toEqual([
      { method: 'GET', url: '/admin/stock/', guards: ['host', 'provisioned', 'guest'] },
      { method: 'GET', url: '/admin/stock/*', guards: ['host', 'provisioned', 'guest'] },
    ]);

    const guest = await createTestHub({ config: { guest_network_cidrs: ['10.9.0.0/16'] } });
    cleanups.push(() => guest.close());
    const denied = await guest.app.inject({ method: 'GET', url: '/admin/stock/', remoteAddress: '10.9.0.5' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('GUEST_NETWORK_FORBIDDEN');
  });
});
