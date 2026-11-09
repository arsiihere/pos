import { afterEach, describe, expect, it } from 'vitest';
import { registerSetupRoutes } from '../src/setup/provision';
import { createTestHub, type TestHub } from './helpers/test-hub';

const ALLOWED = 'http://localhost';
const OTHER = 'http://evil.example';
const ALLOW_HEADERS = 'Authorization, X-Session-Token, X-Client-Version, X-Poll-Secret, Content-Type, X-Queued-At';
const ALLOW_METHODS = 'GET, POST';

const DEVICE_ROUTES = [
  { method: 'GET' as const, url: '/queries/session' },
  { method: 'POST' as const, url: '/commands/noop' },
  { method: 'POST' as const, url: '/auth/pin' },
  { method: 'POST' as const, url: '/auth/station' },
  { method: 'POST' as const, url: '/auth/logout' },
  { method: 'GET' as const, url: '/pair' },
  { method: 'POST' as const, url: '/devices/pair' },
  { method: 'POST' as const, url: '/pair/requests' },
  { method: 'GET' as const, url: '/pair/requests/01ARZ3NDEKTSV4RRFFQ69G5FAV' },
];

const ADMIN_ROUTES = [
  { method: 'POST' as const, url: '/admin/auth' },
  { method: 'POST' as const, url: '/admin/auth/bootstrap' },
  { method: 'POST' as const, url: '/admin/auth/logout' },
  { method: 'GET' as const, url: '/admin/login-roster' },
  { method: 'GET' as const, url: '/admin/bootstrap' },
  { method: 'GET' as const, url: '/admin/approve' },
  { method: 'POST' as const, url: '/admin/commands/revoke-device' },
  { method: 'GET' as const, url: '/admin/queries/session' },
];

const cleanups: Array<() => Promise<void>> = [];

describe('CORS', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 #158] preflight from a cors_origins origin requesting X-Queued-At -> allowed', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const preflight = await hub.app.inject({
      method: 'OPTIONS',
      url: '/commands/noop',
      headers: {
        origin: ALLOWED,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-queued-at',
      },
    });
    expect(preflight.statusCode).toBe(200);
    expect(preflight.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(String(preflight.headers['access-control-allow-headers']).split(', ')).toContain('X-Queued-At');
  });

  it('[00 §10 #120] allowed origin gets headers and preflight on device routes and /pair/*; other origins none; /admin/* and /setup never', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());

    for (const route of DEVICE_ROUTES) {
      const res = await hub.app.inject({ method: route.method, url: route.url, headers: { origin: ALLOWED } });
      expect(res.headers['access-control-allow-origin'], `${route.method} ${route.url}`).toBe(ALLOWED);
      expect(res.headers.vary, `${route.method} ${route.url}`).toBe('Origin');
    }

    for (const route of DEVICE_ROUTES) {
      const preflight = await hub.app.inject({
        method: 'OPTIONS',
        url: route.url,
        headers: { origin: ALLOWED, 'access-control-request-method': route.method },
      });
      expect(preflight.statusCode, `OPTIONS ${route.url}`).toBe(200);
      expect(preflight.headers['access-control-allow-origin'], `OPTIONS ${route.url}`).toBe(ALLOWED);
      expect(preflight.headers.vary, `OPTIONS ${route.url}`).toBe('Origin');
      expect(preflight.headers['access-control-allow-headers'], `OPTIONS ${route.url}`).toBe(ALLOW_HEADERS);
      expect(preflight.headers['access-control-allow-methods'], `OPTIONS ${route.url}`).toBe(ALLOW_METHODS);
    }

    for (const route of DEVICE_ROUTES) {
      const res = await hub.app.inject({ method: route.method, url: route.url, headers: { origin: OTHER } });
      expect(res.headers['access-control-allow-origin'], `${route.method} ${route.url} other`).toBeUndefined();
      const preflight = await hub.app.inject({ method: 'OPTIONS', url: route.url, headers: { origin: OTHER } });
      expect(preflight.headers['access-control-allow-origin'], `OPTIONS ${route.url} other`).toBeUndefined();
    }

    for (const route of ADMIN_ROUTES) {
      const res = await hub.app.inject({ method: route.method, url: route.url, headers: { origin: ALLOWED } });
      expect(res.headers['access-control-allow-origin'], `${route.method} ${route.url}`).toBeUndefined();
      const preflight = await hub.app.inject({ method: 'OPTIONS', url: route.url, headers: { origin: ALLOWED } });
      expect(preflight.headers['access-control-allow-origin'], `OPTIONS ${route.url}`).toBeUndefined();
    }

    const setup = await openSetup();
    for (const url of ['/setup', '/setup/provision']) {
      const res = await setup.app.inject({
        method: url === '/setup' ? 'GET' : 'POST',
        url,
        headers: { origin: ALLOWED },
        payload: url === '/setup' ? undefined : {},
      });
      expect(res.headers['access-control-allow-origin'], url).toBeUndefined();
      const preflight = await setup.app.inject({ method: 'OPTIONS', url, headers: { origin: ALLOWED } });
      expect(preflight.headers['access-control-allow-origin'], `OPTIONS ${url}`).toBeUndefined();
    }
  });
});

async function openSetup(): Promise<TestHub> {
  const hub = await createTestHub({ provisioned: false });
  cleanups.push(() => hub.close());
  registerSetupRoutes(hub.app, { ...hub.deps, cloud: { async registerHub() { return { data: {} }; }, async confirmHub() { return { data: {} }; } }, configPath: `${hub.deps.config.data_dir}/config.json`, exit: () => undefined });
  return hub;
}
