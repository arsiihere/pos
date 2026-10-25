import { DomainError } from '@pos/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sendIdempotent } from '../../lib/idempotency.js';
import {
  BranchParams,
  CreateFloorBody,
  CreateTableBody,
  FloorListResponse,
  FloorParams,
  FloorResponse,
  PatchFloorBody,
  PatchTableBody,
  TableParams,
  TableResponse,
} from './schemas.js';
import {
  createFloor,
  createTable,
  listFloors,
  patchFloor,
  patchTable,
  type OwnerRequest,
  type RestaurantDeps,
} from './service.js';

export function registerRestaurantRoutes(app: FastifyInstance, deps: RestaurantDeps): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    '/v1/admin/branches/:branch_id/floors',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: BranchParams, response: { 200: FloorListResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('GET /v1/admin/branches/:branch_id/floors');
      const floors = await listFloors(deps, tenantOf(request), request.params.branch_id);
      return reply.send({ data: { floors } });
    },
  );

  routes.post(
    '/v1/admin/branches/:branch_id/floors',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: BranchParams, body: CreateFloorBody, response: { 201: FloorResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('POST /v1/admin/branches/:branch_id/floors');
      const result = await createFloor(deps, ownerRequest(app, request), request.params.branch_id, request.body);
      return sendIdempotent(reply, result);
    },
  );

  routes.patch(
    '/v1/admin/branches/:branch_id/floors/:floor_id',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: FloorParams, body: PatchFloorBody, response: { 200: FloorResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('PATCH /v1/admin/branches/:branch_id/floors/:floor_id');
      const { branch_id, floor_id } = request.params;
      const data = await patchFloor(deps, ownerRequest(app, request), branch_id, floor_id, request.body);
      return reply.send({ data });
    },
  );

  routes.post(
    '/v1/admin/branches/:branch_id/tables',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: BranchParams, body: CreateTableBody, response: { 201: TableResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('POST /v1/admin/branches/:branch_id/tables');
      const result = await createTable(deps, ownerRequest(app, request), request.params.branch_id, request.body);
      return sendIdempotent(reply, result);
    },
  );

  routes.patch(
    '/v1/admin/branches/:branch_id/tables/:table_id',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: TableParams, body: PatchTableBody, response: { 200: TableResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('PATCH /v1/admin/branches/:branch_id/tables/:table_id');
      const { branch_id, table_id } = request.params;
      const data = await patchTable(deps, ownerRequest(app, request), branch_id, table_id, request.body);
      return reply.send({ data });
    },
  );
}

function tenantOf(request: FastifyRequest) {
  if (request.tenant === undefined) throw new DomainError('JWT_INVALID');
  return request.tenant;
}

// The tenant guard has verified the JWT; its `sub` is the audit actor (S26).
function ownerRequest(app: FastifyInstance, request: FastifyRequest): OwnerRequest {
  const token = bearer(request.headers.authorization);
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

function bearer(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) return undefined;
  return /^Bearer\s+(\S+)\s*$/i.exec(value)?.[1];
}
