import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type pg from 'pg';
import type { Clock } from '../../lib/clock.js';
import type { IdGen } from '../../lib/ids.js';
import type { SecretGen } from '../../lib/secrets.js';
import { sha256 } from './repository.js';
import { confirmHub, registerHub } from './service.js';
import { ConfirmBody, ConfirmResponse, IdempotencyKey, RegisterBody, RegisterResponse } from './schemas.js';

export function registerHubRegistrationRoutes(
  app: FastifyInstance,
  deps: { pool: pg.Pool; clock: Clock; ids: IdGen; secrets: SecretGen },
): void {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/v1/hubs/register',
    {
      config: { tenantScope: 'registration-code' },
      schema: { body: RegisterBody, response: { 200: RegisterResponse } },
    },
    async (request, reply) => {
      const header = request.headers['idempotency-key'];
      const idempotencyKey = Array.isArray(header) ? header[0] : header;
      const parsed = IdempotencyKey.safeParse(idempotencyKey);
      if (!parsed.success) throw new DomainError('VALIDATION_FAILED');
      const result = await registerHub(
        deps.pool,
        {
          registrationCode: request.body.registration_code,
          idempotencyKey: parsed.data,
          acceptedKinds: request.body.accepted_kinds,
        },
        deps,
      );
      request.log.info(
        { tenant_id: result.tenant_id, branch_id: result.branch_id, kind: result.kind, rotated: result.rotated },
        'hub_registered',
      );
      return reply.send({
        data: {
          tenant_id: result.tenant_id,
          branch_id: result.branch_id,
          branch_name: result.branch_name,
          currency_code: result.currency_code,
          kind: result.kind,
          branch_api_key: result.branch_api_key,
          directory: result.directory,
        },
      });
    },
  );

  app.withTypeProvider<ZodTypeProvider>().post(
    '/v1/hubs/confirm',
    {
      config: { tenantScope: 'branch-key' },
      schema: { body: ConfirmBody, response: { 200: ConfirmResponse } },
    },
    async (request, reply) => {
      const tenant = request.tenant;
      const branchId = tenant?.branchIds[0];
      const header = request.headers.authorization;
      const value = Array.isArray(header) ? header[0] : header;
      const key = value === undefined ? undefined : /^Bearer\s+(\S+)\s*$/i.exec(value)?.[1];
      if (tenant === undefined || branchId === undefined || key === undefined) {
        throw new DomainError('BRANCH_API_KEY_INVALID');
      }
      const result = await confirmHub(
        deps.pool,
        { tenantId: tenant.tenantId, branchId, keyHash: sha256(key) },
        deps,
      );
      return reply.send({ data: result });
    },
  );
}
