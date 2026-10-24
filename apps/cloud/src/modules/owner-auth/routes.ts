import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type pg from 'pg';
import type { Clock } from '../../lib/clock.js';
import type { IdGen } from '../../lib/ids.js';
import type { SecretGen } from '../../lib/secrets.js';
import { DomainError } from '@pos/domain';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import { LogoutBody, LogoutResponse, LoginBody, LoginResponse, RefreshBody } from './schemas.js';
import { sha256 } from './repository.js';
import { createIpLimiter, IP_LOGIN_LIMIT, login, refreshTokens } from './service.js';

export function registerOwnerAuthRoutes(
  app: FastifyInstance,
  deps: { pool: pg.Pool; clock: Clock; ids: IdGen; secrets: SecretGen; env: { REFRESH_TOKEN_SECRET: string } },
): void {
  const limiter = createIpLimiter({ max: IP_LOGIN_LIMIT.max, windowMs: IP_LOGIN_LIMIT.windowMs, clock: deps.clock });
  app.withTypeProvider<ZodTypeProvider>().post(
    '/v1/auth/login',
    {
      config: { tenantScope: 'none' },
      schema: { body: LoginBody, response: { 200: LoginResponse } },
    },
    async (request, reply) => {
      const tokens = await login(
        app.ownerCredentials,
        request.body,
        { pool: deps.pool, clock: deps.clock, ids: deps.ids, secrets: deps.secrets, jwt: app.jwt },
        request.ip,
        limiter,
      );
      return reply.send({ data: tokens });
    },
  );

  app.withTypeProvider<ZodTypeProvider>().post(
    '/v1/auth/refresh',
    {
      config: { tenantScope: 'none' },
      schema: { body: RefreshBody, response: { 200: LoginResponse } },
    },
    async (request, reply) => {
      const tokens = await refreshTokens(app.ownerCredentials, request.body.refresh_token, {
        pool: deps.pool,
        clock: deps.clock,
        ids: deps.ids,
        secrets: deps.secrets,
        jwt: app.jwt,
        refreshSecret: deps.env.REFRESH_TOKEN_SECRET,
      });
      return reply.send({ data: tokens });
    },
  );

  app.withTypeProvider<ZodTypeProvider>().post(
    '/v1/auth/logout',
    {
      config: { tenantScope: 'jwt' },
      schema: { body: LogoutBody, response: { 200: LogoutResponse } },
    },
    async (request, reply) => {
      const access = bearer(request.headers.authorization);
      if (access === undefined || request.tenant === undefined) throw new DomainError('JWT_INVALID');
      const claims = app.jwt.verify(access);
      const client = await deps.pool.connect();
      try {
        const repo = new TenantLevelRepository(request.tenant, client);
        const rows = await repo.query<{ token_id: string }>(
          `UPDATE owner_refresh_tokens
              SET revoked_at = $2
            WHERE tenant_id = $1 AND user_id = $3 AND token_hash = $4 AND revoked_at IS NULL
            RETURNING token_id`,
          [deps.clock.branchNow(), claims.sub, sha256(request.body.refresh_token)],
        );
        return reply.send({ data: { revoked: rows.length > 0 } });
      } finally {
        client.release();
      }
    },
  );
}

function bearer(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) return undefined;
  return /^Bearer\s+(\S+)\s*$/i.exec(value)?.[1];
}
