import { afterEach, describe, expect, it } from 'vitest';
import { createTestCloud } from './helpers/test-cloud';

describe('GET /v1/health', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #125] /v1/health ok; db down → 503', async () => {
    const cloud = await createTestCloud();
    cleanups.push(async () => {
      await cloud.app.close();
      try {
        await cloud.pool.end();
      } catch {
        // the db-down case already ended the pool
      }
    });

    const ok = await cloud.app.inject({ method: 'GET', url: '/v1/health' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ data: { status: 'ok', version: '0.0.0', db: 'ok' } });

    await cloud.pool.end();
    const down = await cloud.app.inject({ method: 'GET', url: '/v1/health' });
    expect(down.statusCode).toBe(503);
    expect(down.json().error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
