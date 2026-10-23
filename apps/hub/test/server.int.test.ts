import { DomainError, ULID_RE } from '@pos/domain';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { REDACT_PATHS } from '../src/server';
import { createTestHub } from './helpers/test-hub';

const SECRET_HEADERS = {
  authorization: 'Bearer super-secret-token',
  'x-session-token': 'session-secret-value',
  'x-admin-session': 'admin-secret-value',
  'x-admin-bootstrap': 'bootstrap-secret-value',
  'x-poll-secret': 'poll-secret-value',
} as const;

describe('hub server', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[F §6.1] DomainError becomes the error envelope and catalogue status', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    hub.app.get('/boom', { config: { group: 'health' } }, () => {
      throw new DomainError('PERMISSION_DENIED', { permission: 'reprint-ticket' });
    });
    const res = await hub.app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error.code).toBe('PERMISSION_DENIED');
    expect(body.error.message).toBe('PERMISSION_DENIED');
    expect(body.error.details).toEqual({ permission: 'reprint-ticket' });
    expect(body.error.request_id).toMatch(ULID_RE);
    expect(body.error).not.toHaveProperty('stack');
    expect(hub.logs()).toContain(body.error.request_id);
  });

  it('[F §6.1] an unknown error becomes INTERNAL_ERROR without a stack', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    hub.app.get('/explode', { config: { group: 'health' } }, () => {
      throw new Error('top-secret-stack');
    });
    const res = await hub.app.inject({ method: 'GET', url: '/explode' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'INTERNAL_ERROR',
        details: {},
        request_id: expect.stringMatching(ULID_RE),
      },
    });
    expect(res.body).not.toContain('top-secret-stack');
    expect(res.body).not.toContain('at ');
    expect(hub.logs()).toContain('top-secret-stack');
  });

  it('[F §6.1] an unknown route is ROUTE_NOT_FOUND', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const res = await hub.app.inject({ method: 'GET', url: '/missing' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(body.error.message).toBe('ROUTE_NOT_FOUND');
    expect(body.error.details).toEqual({});
    expect(body.error.request_id).toMatch(ULID_RE);
  });

  it('[00 §7.2] a Zod failure is VALIDATION_FAILED with issues', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    hub.app.withTypeProvider<ZodTypeProvider>().post(
      '/check',
      { config: { group: 'health' }, schema: { body: z.object({ qty: z.number().int() }) } },
      () => ({ data: { ok: true } }),
    );
    const res = await hub.app.inject({
      method: 'POST',
      url: '/check',
      headers: { 'content-type': 'application/json' },
      payload: { qty: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.issues).toEqual([
      expect.objectContaining({ path: expect.stringMatching(/qty/), message: expect.any(String) }),
    ]);
    expect(body.error.request_id).toMatch(ULID_RE);
  });

  it('[00 §7.2] secret headers are redacted in logs', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    hub.app.get('/echo-auth', { config: { group: 'health' } }, (req) => ({ data: { authorization: req.headers.authorization } }));
    const res = await hub.app.inject({ method: 'GET', url: '/echo-auth', headers: { ...SECRET_HEADERS } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.authorization).toBe(SECRET_HEADERS.authorization);
    const logs = hub.logs();
    for (const value of Object.values(SECRET_HEADERS)) {
      expect(logs).not.toContain(value.replace('Bearer ', ''));
      expect(logs).not.toContain(value);
    }
    expect(logs).toContain('[Redacted]');
    for (const name of ['authorization', 'x-session-token', 'x-admin-session', 'x-admin-bootstrap', 'x-poll-secret']) {
      expect(REDACT_PATHS.some((path) => path.includes(name))).toBe(true);
    }
  });
});
