import { DomainError } from '@pos/domain';
import { InventoryDetailQuery, InventoryDetailResponse } from '@pos/events';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { OwnerRequest } from '../restaurant/service.js';
import { getInventoryDetail, type InventoryDeps } from './service.js';

const StockItemParams = z.object({ stock_item_id: z.string().min(1) });

// 08a §6: owner routes (JWT, tenant guard, password guard; check order C4). Each route adds its ROUTE_CASES entry
// (apps/cloud/test/helpers/route-cases.ts, C7).
export function registerInventoryRoutes(app: FastifyInstance, deps: InventoryDeps): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  // §6.4
  routes.get(
    '/v1/admin/stock-items/:stock_item_id/inventory',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: StockItemParams, querystring: InventoryDetailQuery, response: { 200: InventoryDetailResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('GET /v1/admin/stock-items/:stock_item_id/inventory');
      const { tenant, ownerUserId } = ownerRequest(app, request);
      return reply.send({ data: await getInventoryDetail(deps, tenant, ownerUserId, request.params.stock_item_id, request.query) });
    },
  );

  // §6.5 units POST

  // §6.6 prices POST

  // §6.7 yields POST
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
