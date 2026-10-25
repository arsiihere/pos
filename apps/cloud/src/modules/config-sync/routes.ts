import { DomainError } from '@pos/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type pg from 'pg';
import type { CloudTestHooks } from '../../server.js';
import { SyncConfigQuery, SyncConfigResponse } from './schemas.js';
import { syncConfig } from './service.js';

export function registerConfigSyncRoutes(app: FastifyInstance, deps: { pool: pg.Pool; testHooks?: CloudTestHooks }): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/v1/sync/config',
    {
      config: { tenantScope: 'branch-key' },
      schema: { querystring: SyncConfigQuery, response: { 200: SyncConfigResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('GET /v1/sync/config');
      if (request.tenant === undefined) throw new DomainError('BRANCH_API_KEY_INVALID');
      const result = await syncConfig(deps.pool, request.tenant, request.query);
      // S4: no body; the typed reply only knows the 200 schema
      if (result.kind === 'not_modified') return (reply as unknown as FastifyReply).code(304).send();
      return reply.send({ data: result.data });
    },
  );
}
