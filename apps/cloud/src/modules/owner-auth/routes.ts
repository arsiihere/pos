import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type pg from 'pg';
import type { Clock } from '../../lib/clock.js';
import type { IdGen } from '../../lib/ids.js';
import type { SecretGen } from '../../lib/secrets.js';
import { LoginBody, LoginResponse } from './schemas.js';
import { createIpLimiter, IP_LOGIN_LIMIT, login } from './service.js';

export function registerOwnerAuthRoutes(
  app: FastifyInstance,
  deps: { pool: pg.Pool; clock: Clock; ids: IdGen; secrets: SecretGen },
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
}
