import { DomainError } from '@pos/domain';
import { StaffCreateBody } from '@pos/events';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sendIdempotent } from '../../lib/idempotency.js';
import { StaffListResponse, StaffQuery, StaffResponse } from './schemas.js';
import { createStaff, listStaff } from './service.js';
import type { OwnerRequest, StaffRolesDeps } from './write.js';

export function registerStaffRolesRoutes(app: FastifyInstance, deps: StaffRolesDeps): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    '/v1/admin/staff',
    {
      config: { tenantScope: 'jwt' },
      schema: { querystring: StaffQuery, response: { 200: StaffListResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('GET /v1/admin/staff');
      const { status, branch_id } = request.query;
      const staff = await listStaff(deps, tenantOf(request), branch_id === undefined ? { status } : { status, branchId: branch_id });
      return reply.send({ data: { staff } });
    },
  );

  routes.post(
    '/v1/admin/staff',
    {
      config: { tenantScope: 'jwt' },
      schema: { body: StaffCreateBody, response: { 200: StaffResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('POST /v1/admin/staff');
      return sendIdempotent(reply, await createStaff(deps, ownerRequest(app, request), request.body));
    },
  );
}

function tenantOf(request: FastifyRequest) {
  if (request.tenant === undefined) throw new DomainError('JWT_INVALID');
  return request.tenant;
}

// The tenant guard has verified the JWT; its `sub` is the audit actor (01a S26).
function ownerRequest(app: FastifyInstance, request: FastifyRequest): OwnerRequest {
  const token = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.authorization ?? '')?.[1];
  if (token === undefined) throw new DomainError('JWT_INVALID');
  const header = request.headers['idempotency-key'];
  return {
    tenant: tenantOf(request),
    ownerUserId: app.jwt.verify(token).sub,
    idempotencyKey: Array.isArray(header) ? header[0] : header,
    method: request.method,
    path: request.url.split('?')[0]!,
    log: request.log,
  };
}
