import { DomainError } from '@pos/domain';
import { BillingSettingsResponse, JurisdictionsQuery, JurisdictionsResponse, PutBillingSettingsBodyShape } from '@pos/events';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getBillingSettings, listJurisdictions, putBillingSettings, type BillingSettingsDeps } from './service.js';

// 05 §4.5 row A-1 (4) (01a v2.6 §6.25, §6.26): owner routes (JWT, tenant guard, 00's password guard). The PUT is a
// branch-level write (bumps that branch, S8); it is not a creating POST, so no idempotency key (01b settings PATCH).

const BranchIdParams = z.object({ branch_id: z.string().min(1) });

export function registerBillingSettingsRoutes(app: FastifyInstance, deps: BillingSettingsDeps): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    '/v1/admin/branches/:branch_id/billing',
    { config: { tenantScope: 'jwt' }, schema: { params: BranchIdParams, response: { 200: BillingSettingsResponse } } },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('GET /v1/admin/branches/:branch_id/billing');
      return reply.send({ data: await getBillingSettings(deps, tenantOf(request), request.params.branch_id) });
    },
  );

  routes.put(
    '/v1/admin/branches/:branch_id/billing',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: BranchIdParams, body: PutBillingSettingsBodyShape, response: { 200: BillingSettingsResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('PUT /v1/admin/branches/:branch_id/billing');
      const data = await putBillingSettings(deps, ownerRequest(app, request), request.params.branch_id, request.body);
      return reply.send({ data });
    },
  );

  routes.get(
    '/v1/admin/jurisdictions',
    { config: { tenantScope: 'jwt' }, schema: { querystring: JurisdictionsQuery, response: { 200: JurisdictionsResponse } } },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('GET /v1/admin/jurisdictions');
      tenantOf(request);
      return reply.send({ data: await listJurisdictions(deps, request.query.jurisdiction_id) });
    },
  );
}

function tenantOf(request: FastifyRequest) {
  if (request.tenant === undefined) throw new DomainError('JWT_INVALID');
  return request.tenant;
}

// The tenant guard has verified the JWT; its `sub` is the audit actor (01a S26).
function ownerRequest(app: FastifyInstance, request: FastifyRequest) {
  const token = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.authorization ?? '')?.[1];
  if (token === undefined) throw new DomainError('JWT_INVALID');
  return { tenant: tenantOf(request), ownerUserId: app.jwt.verify(token).sub };
}
