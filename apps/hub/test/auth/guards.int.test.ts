import type { RouteGroup } from '../../src/auth/guards';
import { guardsFor, listRouteGuards } from '../../src/auth/guards';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestHub } from '../helpers/test-hub';

const EXPECTED: Record<RouteGroup, string[]> = {
  health: ['host', 'isGuest'],
  setup: ['host', 'guest'],
  device: ['host', 'provisioned', 'guest', 'version'],
  'device-session': ['host', 'provisioned', 'guest', 'version'],
  admin: ['host', 'provisioned', 'guest'],
  'admin-device-public': ['host', 'provisioned', 'guest'],
  'admin-bootstrap': ['host', 'provisioned', 'guest'],
  pair: ['host', 'provisioned', 'guest', 'version'],
  'pair-request': ['host', 'provisioned', 'guest', 'version'],
  ws: ['host', 'provisioned', 'guest', 'version'],
};

describe('route guards', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #72] every route has its guard set and an unguarded route fails ready', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    for (const group of Object.keys(EXPECTED) as RouteGroup[]) {
      hub.app.get(`/g/${group}`, { config: { group } }, async () => ({ data: { group } }));
      expect(guardsFor(group)).toEqual(EXPECTED[group]);
    }
    await hub.app.ready();
    const listed = listRouteGuards(hub.app);
    for (const group of Object.keys(EXPECTED) as RouteGroup[]) {
      expect(listed.find((route) => route.method === 'GET' && route.url === `/g/${group}`)?.guards).toEqual(EXPECTED[group]);
    }
    const open = await createTestHub();
    cleanups.push(() => open.close());
    open.app.get('/open', async () => ({ data: {} }));
    await expect(open.app.ready()).rejects.toThrow(/group/);
  });

  it('[00 §10 #21] other routes before provisioning return 409', async () => {
    const hub = await createTestHub({ provisioned: false });
    cleanups.push(() => hub.close());
    hub.app.get('/health', { config: { group: 'health' } }, async () => ({ data: { ok: true } }));
    hub.app.post('/setup/provision', { config: { group: 'setup' } }, async () => ({ data: { ok: true } }));
    const blockedGroups = [
      'device',
      'device-session',
      'admin',
      'admin-device-public',
      'admin-bootstrap',
      'pair',
      'pair-request',
      'ws',
    ] as const;
    for (const group of blockedGroups) {
      hub.app.get(`/blocked/${group}`, { config: { group } }, async () => ({ data: { ok: true } }));
    }
    expect((await hub.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await hub.app.inject({ method: 'POST', url: '/setup/provision' })).statusCode).toBe(200);
    for (const group of blockedGroups) {
      const blocked = await hub.app.inject({ method: 'GET', url: `/blocked/${group}` });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error.code).toBe('HUB_NOT_PROVISIONED');
    }
  });

  it('[00 §10 #97] a bad Host is rejected and localhost, the advertised host and a setup-mode own address pass', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    hub.app.get('/health', { config: { group: 'health' } }, async () => ({ data: { ok: true } }));
    hub.app.post('/admin/auth', { config: { group: 'admin-device-public' } }, async () => ({ data: { ok: true } }));
    hub.app.post('/devices/pair', { config: { group: 'pair' } }, async () => ({ data: { ok: true } }));
    hub.app.post('/pair/requests', { config: { group: 'pair-request' } }, async () => ({ data: { ok: true } }));
    for (const target of [
      { method: 'GET' as const, url: '/health' },
      { method: 'POST' as const, url: '/admin/auth' },
      { method: 'POST' as const, url: '/devices/pair' },
      { method: 'POST' as const, url: '/pair/requests' },
    ]) {
      const denied = await hub.app.inject({ ...target, headers: { host: 'evil.example:3000' } });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe('HOST_NOT_ALLOWED');
      expect((await hub.app.inject({ ...target, headers: { host: 'localhost:3000' } })).statusCode).toBe(200);
      expect((await hub.app.inject({ ...target, headers: { host: '192.168.10.2:3000' } })).statusCode).toBe(200);
    }
    const setup = await createTestHub({ provisioned: false });
    cleanups.push(() => setup.close());
    setup.app.get('/health', { config: { group: 'health' } }, async () => ({ data: { ok: true } }));
    expect((await setup.app.inject({ method: 'GET', url: '/health', headers: { host: '192.168.10.2:3000' } })).statusCode).toBe(200);
    const foreign = await setup.app.inject({ method: 'GET', url: '/health', headers: { host: 'evil.example:3000' } });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().error.code).toBe('HOST_NOT_ALLOWED');
  });

  it('[00 §3.9] X-Client-Version below min returns 426 and an absent version passes', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    hub.app.get('/commands/test', { config: { group: 'device' } }, async () => ({ data: { ok: true } }));
    hub.app.get('/admin/queries/devices', { config: { group: 'admin' } }, async () => ({ data: { ok: true } }));
    const old = await hub.app.inject({
      method: 'GET',
      url: '/commands/test',
      headers: { 'x-client-version': '0.9.0' },
    });
    expect(old.statusCode).toBe(426);
    expect(old.json().error.code).toBe('CLIENT_UPGRADE_REQUIRED');
    expect((await hub.app.inject({ method: 'GET', url: '/commands/test' })).statusCode).toBe(200);
    expect(
      (await hub.app.inject({ method: 'GET', url: '/commands/test', headers: { 'x-client-version': '1.0.0' } })).statusCode,
    ).toBe(200);
    expect(
      (await hub.app.inject({ method: 'GET', url: '/admin/queries/devices', headers: { 'x-client-version': '0.9.0' } }))
        .statusCode,
    ).toBe(200);
    const strict = await createTestHub({ config: { min_client_version: '1.0.10' } });
    cleanups.push(() => strict.close());
    strict.app.get('/commands/test', { config: { group: 'device' } }, async () => ({ data: { ok: true } }));
    const olderPatch = await strict.app.inject({
      method: 'GET',
      url: '/commands/test',
      headers: { 'x-client-version': '1.0.9' },
    });
    expect(olderPatch.statusCode).toBe(426);
    expect(olderPatch.json().error.code).toBe('CLIENT_UPGRADE_REQUIRED');
    expect(
      (await strict.app.inject({ method: 'GET', url: '/commands/test', headers: { 'x-client-version': '1.0.10' } }))
        .statusCode,
    ).toBe(200);
  });

  it('[00 §7.1] guards run before Zod', async () => {
    const body = { qty: 'nope' };
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    hub.app.withTypeProvider<ZodTypeProvider>().post(
      '/check',
      { config: { group: 'device' }, schema: { body: z.object({ qty: z.number().int() }) } },
      () => ({ data: { ok: true } }),
    );
    const badHost = await hub.app.inject({
      method: 'POST',
      url: '/check',
      headers: { host: 'evil.example:3000', 'content-type': 'application/json' },
      payload: body,
    });
    expect(badHost.statusCode).toBe(403);
    expect(badHost.json().error.code).toBe('HOST_NOT_ALLOWED');
    const guest = await hub.app.inject({
      method: 'POST',
      url: '/check',
      headers: { 'content-type': 'application/json' },
      payload: body,
      remoteAddress: '192.168.20.7',
    });
    expect(guest.statusCode).toBe(403);
    expect(guest.json().error.code).toBe('GUEST_NETWORK_FORBIDDEN');
    const open = await createTestHub({ provisioned: false });
    cleanups.push(() => open.close());
    open.app.withTypeProvider<ZodTypeProvider>().post(
      '/check',
      { config: { group: 'device' }, schema: { body: z.object({ qty: z.number().int() }) } },
      () => ({ data: { ok: true } }),
    );
    const unprovisioned = await open.app.inject({
      method: 'POST',
      url: '/check',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
    expect(unprovisioned.statusCode).toBe(409);
    expect(unprovisioned.json().error.code).toBe('HUB_NOT_PROVISIONED');
  });

  it('[00 §3.9] a guest-network address is forbidden except on /health, which records isGuest', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    hub.app.get('/health', { config: { group: 'health' } }, async (request) => ({ data: { isGuest: request.isGuest === true } }));
    hub.app.get('/commands/test', { config: { group: 'device' } }, async () => ({ data: { ok: true } }));
    hub.app.post('/setup/provision', { config: { group: 'setup' } }, async () => ({ data: { ok: true } }));
    const guestHealth = await hub.app.inject({ method: 'GET', url: '/health', remoteAddress: '192.168.20.7' });
    expect(guestHealth.statusCode).toBe(200);
    expect(guestHealth.json().data.isGuest).toBe(true);
    const staffHealth = await hub.app.inject({ method: 'GET', url: '/health', remoteAddress: '192.168.10.5' });
    expect(staffHealth.json().data.isGuest).toBe(false);
    const guest = await hub.app.inject({ method: 'GET', url: '/commands/test', remoteAddress: '192.168.20.7' });
    expect(guest.statusCode).toBe(403);
    expect(guest.json().error.code).toBe('GUEST_NETWORK_FORBIDDEN');
    const guestSetup = await hub.app.inject({ method: 'POST', url: '/setup/provision', remoteAddress: '192.168.20.7' });
    expect(guestSetup.statusCode).toBe(403);
    expect(guestSetup.json().error.code).toBe('GUEST_NETWORK_FORBIDDEN');
    expect((await hub.app.inject({ method: 'GET', url: '/commands/test', remoteAddress: '192.168.10.5' })).statusCode).toBe(200);
  });
});
