import { afterEach, describe, expect, it } from 'vitest';
import { listTenantScopes, TENANT_SCOPE_ALLOWLIST } from '../src/plugins/tenant-scope';
import { createTestCloud } from './helpers/test-cloud';

const CSP = "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

describe('owner pages', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[01a §10 #15] /owner/ and its assets load with no JWT and the CSP; no inline script; /ui/* is gone; allowlisted', async () => {
    const cloud = await createTestCloud();
    cleanups.push(() => cloud.close());
    await cloud.app.ready();

    const index = await cloud.app.inject({ method: 'GET', url: '/owner/' });
    expect(index.statusCode).toBe(200);
    expect(index.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(index.headers['content-security-policy']).toBe(CSP);
    for (const tag of index.body.match(/<script\b[^>]*>/g) ?? []) expect(tag).toMatch(/\ssrc="/);

    const js = /src="(\/owner\/assets\/[^"]+\.js)"/.exec(index.body)?.[1];
    const css = /href="(\/owner\/assets\/[^"]+\.css)"/.exec(index.body)?.[1];
    expect(js).toBeDefined();
    expect(css).toBeDefined();
    for (const url of [js!, css!]) {
      const res = await cloud.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-security-policy'], url).toBe(CSP);
      expect(res.headers['cache-control'], url).toBe('public, max-age=31536000, immutable');
    }

    const ui = await cloud.app.inject({ method: 'GET', url: '/ui/tokens.css' });
    expect(ui.statusCode).toBe(404);
    expect(ui.json().error.code).toBe('ROUTE_NOT_FOUND');

    expect(TENANT_SCOPE_ALLOWLIST).toEqual(expect.arrayContaining(['GET /owner/', 'GET /owner/*']));
    expect(listTenantScopes(cloud.app)).toEqual(
      expect.arrayContaining([
        { method: 'GET', url: '/owner/', tenantScope: 'none' },
        { method: 'GET', url: '/owner/*', tenantScope: 'none' },
      ]),
    );
  });
});
