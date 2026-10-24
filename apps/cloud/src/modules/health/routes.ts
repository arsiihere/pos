import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

export const CLOUD_VERSION = '0.0.0';

export function registerHealthRoutes(app: FastifyInstance, deps: { pool: pg.Pool }): void {
  app.get('/v1/health', { config: { tenantScope: 'none' } }, async () => {
    try {
      await deps.pool.query('SELECT 1');
    } catch {
      throw new DomainError('SERVICE_UNAVAILABLE');
    }
    return { data: { status: 'ok', version: CLOUD_VERSION, db: 'ok' } };
  });
}
