import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listRouteGuards } from '../src/auth/guards';
import { CSP as HUB_CSP, KDS_DIST_DIR, registerClientDist as registerHubClientDist, STAFF_DIST_DIR } from '../src/lib/client-dist';
import { CSP as CLOUD_CSP, registerClientDist as registerCloudClientDist } from '../../cloud/src/lib/client-dist';
import { createTestHub } from './helpers/test-hub';

// 00 v1.9.2 #163: the server reads KDS_DIST_DIR at build time; a test may point it at a stand-in build or a
// missing directory (the client's kds entry lands with 03b K1). Undefined = the real directory.
const dist = vi.hoisted(() => ({ kds: undefined as string | undefined }));
vi.mock('../src/lib/client-dist', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/client-dist')>();
  return {
    ...real,
    get KDS_DIST_DIR() {
      return dist.kds ?? real.KDS_DIST_DIR;
    },
  };
});

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
  it('[01d task 41] an index meta source adds escaped <meta> tags to index.html only, read on each request', async () => {
    const own = buildDir({
      'index.html': '<!doctype html><head><title>x</title></head><script type="module" src="/s/assets/a1.js"></script>',
      'assets/a1.js': 'console.log(1);',
    });
    cleanups.push(() => rmSync(own, { recursive: true, force: true }));
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    let tenant = 'T<1>"';
    registerHubClientDist(hub.app, { prefix: '/s/', dir: own, routeConfig: { group: 'static' }, indexMeta: () => ({ 'pos-tenant-id': tenant }) });
    await hub.app.ready();

    const index = await hub.app.inject({ method: 'GET', url: '/s/' });
    expect(index.statusCode).toBe(200);
    expect(index.headers['content-security-policy']).toBe(EXPECTED_CSP);
    expect(index.headers['cache-control']).toBe('no-cache');
    expect(index.body).toContain('<meta name="pos-tenant-id" content="T&lt;1&gt;&quot;"></head>');
    tenant = 'T2';
    expect((await hub.app.inject({ method: 'GET', url: '/s/index.html' })).body).toContain('content="T2"');
    const asset = await hub.app.inject({ method: 'GET', url: '/s/assets/a1.js' });
    expect(asset.body).toBe('console.log(1);');
  });

  it('[01d task 41] the hub serves /staff/ from the built staff entry with the same headers and guards as /admin/stock/', async () => {
    expect(STAFF_DIST_DIR.endsWith('/client/dist/staff/')).toBe(true);
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    await hub.app.ready();
    const stock = await hub.app.inject({ method: 'GET', url: '/admin/stock/' });
    const page = await hub.app.inject({ method: 'GET', url: '/staff/' });
    expect(page.statusCode).toBe(200);
    for (const header of ['content-security-policy', 'cache-control', 'content-type']) {
      expect(page.headers[header], header).toBe(stock.headers[header]);
    }
    expect(page.body).toContain('/staff/assets/');
    // the envelope ids and the hub clock for the staff app (as /admin/approve embeds the ids, 00 M79)
    const provisioned = hub.deps.config.provisioned!;
    expect(page.body).toContain(`<meta name="pos-tenant-id" content="${provisioned.tenant_id}">`);
    expect(page.body).toContain(`<meta name="pos-branch-id" content="${provisioned.branch_id}">`);
    expect(page.body).toMatch(/<meta name="pos-hub-now-ms" content="\d+">/);
    expect(page.body).toMatch(/<meta name="pos-hub-utc-offset-ms" content="-?\d+">/);
    const asset = /\/staff\/(assets\/[^"]+\.js)/.exec(page.body)![1]!;
    const js = await hub.app.inject({ method: 'GET', url: `/staff/${asset}` });
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(js.headers['content-security-policy']).toBe(EXPECTED_CSP);
    expect(listRouteGuards(hub.app).filter((r) => r.url.startsWith('/staff/') && r.method === 'GET')).toEqual([
      { method: 'GET', url: '/staff/', guards: ['host', 'provisioned', 'guest'] },
      { method: 'GET', url: '/staff/*', guards: ['host', 'provisioned', 'guest'] },
    ]);

    const guest = await createTestHub({ config: { guest_network_cidrs: ['10.9.0.0/16'] } });
    cleanups.push(() => guest.close());
    const denied = await guest.app.inject({ method: 'GET', url: '/staff/', remoteAddress: '10.9.0.5' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('GUEST_NETWORK_FORBIDDEN');
  });

  it('[00 §10 #163] GET /kds/ serves the kds build with pos-tenant-id, pos-branch-id and hub-clock meta, admin-page guards; no build dir → the route stays registered and answers 404 ROUTE_NOT_FOUND', async () => {
    expect(KDS_DIST_DIR.endsWith('/client/dist/kds/')).toBe(true);
    const build = buildDir({
      'index.html': '<!doctype html><head><title>kds</title></head><script type="module" src="/kds/assets/k1.js"></script>',
      'assets/k1.js': 'kds();',
    });
    cleanups.push(() => rmSync(build, { recursive: true, force: true }));
    cleanups.push(() => {
      dist.kds = undefined;
    });
    dist.kds = build;
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    await hub.app.ready();
    const staff = await hub.app.inject({ method: 'GET', url: '/staff/' });
    const page = await hub.app.inject({ method: 'GET', url: '/kds/' });
    expect(page.statusCode).toBe(200);
    for (const header of ['content-security-policy', 'cache-control', 'content-type']) {
      expect(page.headers[header], header).toBe(staff.headers[header]);
    }
    expect(page.body).toContain('/kds/assets/k1.js');
    const provisioned = hub.deps.config.provisioned!;
    expect(page.body).toContain(`<meta name="pos-tenant-id" content="${provisioned.tenant_id}">`);
    expect(page.body).toContain(`<meta name="pos-branch-id" content="${provisioned.branch_id}">`);
    expect(page.body).toContain(`<meta name="pos-branch-name" content="${provisioned.branch_name}">`);
    expect(page.body).toMatch(/<meta name="pos-hub-now-ms" content="\d+">/);
    expect(page.body).toMatch(/<meta name="pos-hub-utc-offset-ms" content="-?\d+">/);
    // the same page meta as /staff/ (one source), ids and clock only: no token or secret
    const metaOf = (html: string) => [...html.matchAll(/<meta name="(pos-[^"]+)"/g)].map((m) => m[1]);
    expect(metaOf(page.body)).toEqual(metaOf(staff.body));
    expect(page.body).not.toMatch(/token|secret|api_key/i);
    const js = await hub.app.inject({ method: 'GET', url: '/kds/assets/k1.js' });
    expect(js.statusCode).toBe(200);
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(js.body).toBe('kds();');
    expect(listRouteGuards(hub.app).filter((r) => r.url.startsWith('/kds/') && r.method === 'GET')).toEqual([
      { method: 'GET', url: '/kds/', guards: ['host', 'provisioned', 'guest'] },
      { method: 'GET', url: '/kds/*', guards: ['host', 'provisioned', 'guest'] },
    ]);

    const guest = await createTestHub({ config: { guest_network_cidrs: ['10.9.0.0/16'] } });
    cleanups.push(() => guest.close());
    const denied = await guest.app.inject({ method: 'GET', url: '/kds/', remoteAddress: '10.9.0.5' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('GUEST_NETWORK_FORBIDDEN');

    dist.kds = join(tmpdir(), 'client-dist-kds-missing-does-not-exist');
    const bare = await createTestHub();
    cleanups.push(() => bare.close());
    await bare.app.ready();
    expect(listRouteGuards(bare.app).filter((r) => r.url.startsWith('/kds/') && r.method === 'GET').map((r) => r.url)).toEqual(['/kds/', '/kds/*']);
    for (const url of ['/kds/', '/kds/index.html', '/kds/assets/k1.js']) {
      const res = await bare.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error.code, url).toBe('ROUTE_NOT_FOUND');
    }
  });
});
