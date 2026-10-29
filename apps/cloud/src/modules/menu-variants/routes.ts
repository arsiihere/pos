import { DomainError } from '@pos/domain';
import {
  CreateStockItemBody,
  CreateVariantGroupBody,
  PatchStockItemBody,
  PatchVariantGroupBody,
  StockItemListResponse,
  StockItemResponse,
  VariantGroupResponse,
} from '@pos/events';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sendIdempotent } from '../../lib/idempotency.js';
import type { OwnerRequest } from '../restaurant/service.js';
import {
  createStockItem,
  createVariantGroup,
  listStockItems,
  patchStockItem,
  patchVariantGroup,
  type MenuVariantDeps,
} from './service.js';

const VariantGroupParams = z.object({ variant_group_id: z.string().min(1) });
const StockItemParams = z.object({ stock_item_id: z.string().min(1) });
// §6.6
const StockItemQuery = z.object({ status: z.enum(['active', 'archived']).default('active') });

// 01c §6: owner routes (JWT, tenant guard, password guard). Tenant-wide writes; the owner must cover every branch.
export function registerMenuVariantRoutes(app: FastifyInstance, deps: MenuVariantDeps): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.post(
    '/v1/admin/variant-groups',
    {
      config: { tenantScope: 'jwt' },
      schema: { body: CreateVariantGroupBody, response: { 201: VariantGroupResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('POST /v1/admin/variant-groups');
      return sendIdempotent(reply, await createVariantGroup(deps, ownerRequest(app, request), request.body));
    },
  );

  routes.patch(
    '/v1/admin/variant-groups/:variant_group_id',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: VariantGroupParams, body: PatchVariantGroupBody, response: { 200: VariantGroupResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('PATCH /v1/admin/variant-groups/:variant_group_id');
      const data = await patchVariantGroup(deps, ownerRequest(app, request), request.params.variant_group_id, request.body);
      return reply.send({ data });
    },
  );

  routes.get(
    '/v1/admin/stock-items',
    {
      config: { tenantScope: 'jwt' },
      schema: { querystring: StockItemQuery, response: { 200: StockItemListResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('GET /v1/admin/stock-items');
      const { tenant, ownerUserId } = ownerRequest(app, request);
      return reply.send({ data: await listStockItems(deps, tenant, ownerUserId, request.query) });
    },
  );

  routes.post(
    '/v1/admin/stock-items',
    {
      config: { tenantScope: 'jwt' },
      schema: { body: CreateStockItemBody, response: { 201: StockItemResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('POST /v1/admin/stock-items');
      return sendIdempotent(reply, await createStockItem(deps, ownerRequest(app, request), request.body));
    },
  );

  routes.patch(
    '/v1/admin/stock-items/:stock_item_id',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: StockItemParams, body: PatchStockItemBody, response: { 200: StockItemResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('PATCH /v1/admin/stock-items/:stock_item_id');
      const data = await patchStockItem(deps, ownerRequest(app, request), request.params.stock_item_id, request.body);
      return reply.send({ data });
    },
  );
}

function tenantOf(request: FastifyRequest) {
  if (request.tenant === undefined) throw new DomainError('JWT_INVALID');
  return request.tenant;
}

// The tenant guard has verified the JWT; its `sub` is the audit actor (01a S26).
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
