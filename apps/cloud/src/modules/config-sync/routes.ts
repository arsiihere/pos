import { gzipSync } from 'node:zlib';
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
      // the typed reply only knows the 200 object schema; S4: the 304 has no body
      const raw = reply as unknown as FastifyReply;
      if (result.kind === 'not_modified') return raw.code(304).send();
      // S48 b, nit 2: both paths send the bytes of one JSON.stringify; a string or Buffer skips the serializer
      const body = JSON.stringify({ data: result.data });
      raw.header('content-type', 'application/json; charset=utf-8').header('vary', 'accept-encoding');
      if (acceptsGzip(request.headers['accept-encoding'] ?? '')) {
        return raw.header('content-encoding', 'gzip').send(gzipSync(body));
      }
      return raw.send(body);
    },
  );
}

// a gzip token whose q is 0 is an explicit refusal (RFC 9110 §12.5.3)
function acceptsGzip(header: string): boolean {
  return header.split(',').some((token) => {
    const [coding, ...params] = token.split(';').map((part) => part.trim().toLowerCase());
    if (coding !== 'gzip') return false;
    const q = params.find((param) => param.startsWith('q='));
    return q === undefined || Number(q.slice(2)) > 0;
  });
}
