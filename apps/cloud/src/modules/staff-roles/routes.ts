import { DomainError } from '@pos/domain';
import { PinBody, RoleCreateBody, RolePatchBody, StaffCreateBody, StaffPatchBody } from '@pos/events';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sendIdempotent } from '../../lib/idempotency.js';
import {
  RoleIdParams,
  RoleListResponse,
  RoleQuery,
  RoleResponse,
  StaffIdParams,
  StaffListResponse,
  StaffPatchResponse,
  StaffQuery,
  StaffResponse,
} from './schemas.js';
import { createRole, createStaff, listRoles, listStaff, setPin, updateRole, updateStaff } from './service.js';
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

  routes.patch(
    '/v1/admin/staff/:staff_id',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: StaffIdParams, body: StaffPatchBody, response: { 200: StaffPatchResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('PATCH /v1/admin/staff/:staff_id');
      return reply.send({ data: await updateStaff(deps, ownerRequest(app, request), request.params.staff_id, request.body) });
    },
  );

  routes.put(
    '/v1/admin/staff/:staff_id/pin',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: StaffIdParams, body: PinBody, response: { 200: StaffResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('PUT /v1/admin/staff/:staff_id/pin');
      return reply.send({ data: await setPin(deps, ownerRequest(app, request), request.params.staff_id, request.body) });
    },
  );

  routes.get(
    '/v1/admin/roles',
    {
      config: { tenantScope: 'jwt' },
      schema: { querystring: RoleQuery, response: { 200: RoleListResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('GET /v1/admin/roles');
      const roles = await listRoles(deps, tenantOf(request), { archived: request.query.archived === 'true' });
      return reply.send({ data: { roles } });
    },
  );

  routes.post(
    '/v1/admin/roles',
    {
      config: { tenantScope: 'jwt' },
      schema: { body: RoleCreateBody, response: { 200: RoleResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('POST /v1/admin/roles');
      return sendIdempotent(reply, await createRole(deps, ownerRequest(app, request), request.body));
    },
  );

  routes.patch(
    '/v1/admin/roles/:role_id',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: RoleIdParams, body: RolePatchBody, response: { 200: RoleResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('PATCH /v1/admin/roles/:role_id');
      return reply.send({ data: await updateRole(deps, ownerRequest(app, request), request.params.role_id, request.body) });
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
