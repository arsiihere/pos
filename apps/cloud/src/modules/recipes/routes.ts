import { DomainError } from '@pos/domain';
import {
  CreateRecipeBody,
  CreateRecipeResponse,
  RecipeDetailQuery,
  RecipeDetailResponse,
  RecipeListQuery,
  RecipeListResponse,
  SaveDraftBody,
  SaveDraftResponse,
} from '@pos/events';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { IdempotentResult } from '../../lib/idempotency.js';
import type { OwnerRequest } from '../restaurant/service.js';
import { DETAIL_ROUTE, getRecipeDetail, LIST_ROUTE, listRecipes } from './reads.js';
import { createRecipe, CREATE_ROUTE, DRAFT_ROUTE, saveDraft, type RecipeDeps } from './service.js';

const RecipeParams = z.object({ recipe_id: z.string().min(1) });

// 08 v1.1 Part B §6: owner routes (JWT, tenant guard, password guard; check order C4). Each route has its
// ROUTE_CASES entry (apps/cloud/test/helpers/route-cases.ts, C7; AD-2).
export function registerRecipeRoutes(app: FastifyInstance, deps: RecipeDeps): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  // §6.3
  routes.post(
    '/v1/admin/recipes',
    { config: { tenantScope: 'jwt' }, schema: { body: CreateRecipeBody, response: { 201: CreateRecipeResponse } } },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.(CREATE_ROUTE);
      return sendStored(reply, request, await createRecipe(deps, ownerRequest(app, request), request.body));
    },
  );

  // §6.4 (branch_id? for the response's costs, as §6.1 / §6.2)
  routes.put(
    '/v1/admin/recipes/:recipe_id/draft',
    { config: { tenantScope: 'jwt' }, schema: { params: RecipeParams, querystring: RecipeDetailQuery, body: SaveDraftBody, response: { 200: SaveDraftResponse } } },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.(DRAFT_ROUTE);
      return reply.send({ data: await saveDraft(deps, ownerRequest(app, request), request.params.recipe_id, request.body, request.query) });
    },
  );

  // ---------------------------------------------------------------------------------- §6.1 / §6.2 reads (r4)

  // §6.1
  routes.get(
    '/v1/admin/recipes',
    { config: { tenantScope: 'jwt' }, schema: { querystring: RecipeListQuery, response: { 200: RecipeListResponse } } },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.(LIST_ROUTE);
      const { tenant, ownerUserId } = ownerRequest(app, request);
      return reply.send({ data: await listRecipes(deps, tenant, ownerUserId, request.query) });
    },
  );

  // §6.2
  routes.get(
    '/v1/admin/recipes/:recipe_id',
    { config: { tenantScope: 'jwt' }, schema: { params: RecipeParams, querystring: RecipeDetailQuery, response: { 200: RecipeDetailResponse } } },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.(DETAIL_ROUTE);
      const { tenant, ownerUserId } = ownerRequest(app, request);
      return reply.send({ data: await getRecipeDetail(deps, tenant, ownerUserId, request.params.recipe_id, request.query) });
    },
  );
}

// sendIdempotent, plus a stored error answer (§6.3 t-2: the conflict's 409 is the key response): an `error` body is
// sent as the shared error shape with this request's id, a success body under `data`.
function sendStored(reply: FastifyReply, request: FastifyRequest, r: IdempotentResult<object>): FastifyReply {
  if (r.replay) void reply.header('Idempotent-Replay', 'true');
  if ('error' in r.body) {
    const error = (r.body as { error: Record<string, unknown> }).error;
    return reply.status(r.status).send({ error: { ...error, request_id: String(request.id) } });
  }
  return reply.status(r.status).send({ data: r.body });
}

function tenantOf(request: FastifyRequest) {
  if (request.tenant === undefined) throw new DomainError('JWT_INVALID');
  return request.tenant;
}

// The tenant guard has verified the JWT; its `sub` is the audit actor (01a S26). As inventory/routes.ts.
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
