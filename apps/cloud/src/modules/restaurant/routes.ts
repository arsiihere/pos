import { DomainError } from '@pos/domain';
import {
  CategoryResponse,
  CreateCategoryBody,
  CreateFloorBody,
  CreateMenuItemBody,
  CreateProgramBody,
  CreateStationBody,
  CreateTableBody,
  CreateTaxClassBody,
  FloorListResponse,
  FloorResponse,
  ItemRouteResponse,
  MenuItemResponse,
  MenuResponse,
  PatchCategoryBody,
  PatchFloorBody,
  PatchMenuItemBody,
  PatchProgramBody,
  PatchStationBody,
  PatchTableBody,
  PatchTaxClassBody,
  ProgramResponse,
  PutItemRouteBody,
  StationListResponse,
  StationResponse,
  TableResponse,
  TaxClassResponse,
} from '@pos/events';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sendIdempotent } from '../../lib/idempotency.js';
import {
  BranchParams,
  CategoryParams,
  FloorParams,
  ItemRouteParams,
  MenuItemParams,
  MenuQuery,
  ProgramParams,
  StationParams,
  TableParams,
  TaxClassParams,
} from './schemas.js';
import {
  createCategory,
  createFloor,
  createMenuItem,
  createProgram,
  createStation,
  createTable,
  createTaxClass,
  listFloors,
  listMenu,
  listStations,
  patchCategory,
  patchFloor,
  patchMenuItem,
  patchProgram,
  patchStation,
  patchTable,
  patchTaxClass,
  putItemRoute,
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

  routes.get(
    '/v1/admin/branches/:branch_id/stations',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: BranchParams, response: { 200: StationListResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('GET /v1/admin/branches/:branch_id/stations');
      const stations = await listStations(deps, tenantOf(request), request.params.branch_id);
      return reply.send({ data: { stations } });
    },
  );

  routes.post(
    '/v1/admin/branches/:branch_id/stations',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: BranchParams, body: CreateStationBody, response: { 201: StationResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('POST /v1/admin/branches/:branch_id/stations');
      const result = await createStation(deps, ownerRequest(app, request), request.params.branch_id, request.body);
      return sendIdempotent(reply, result);
    },
  );

  routes.patch(
    '/v1/admin/branches/:branch_id/stations/:station_id',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: StationParams, body: PatchStationBody, response: { 200: StationResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('PATCH /v1/admin/branches/:branch_id/stations/:station_id');
      const { branch_id, station_id } = request.params;
      const data = await patchStation(deps, ownerRequest(app, request), branch_id, station_id, request.body);
      return reply.send({ data });
    },
  );

  routes.post(
    '/v1/admin/branches/:branch_id/stations/:station_id/programs',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: StationParams, body: CreateProgramBody, response: { 201: ProgramResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('POST /v1/admin/branches/:branch_id/stations/:station_id/programs');
      const { branch_id, station_id } = request.params;
      const result = await createProgram(deps, ownerRequest(app, request), branch_id, station_id, request.body);
      return sendIdempotent(reply, result);
    },
  );

  routes.patch(
    '/v1/admin/branches/:branch_id/stations/:station_id/programs/:program_id',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: ProgramParams, body: PatchProgramBody, response: { 200: ProgramResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('PATCH /v1/admin/branches/:branch_id/stations/:station_id/programs/:program_id');
      const { branch_id, station_id, program_id } = request.params;
      const data = await patchProgram(deps, ownerRequest(app, request), branch_id, station_id, program_id, request.body);
      return reply.send({ data });
    },
  );

  routes.post(
    '/v1/admin/tax-classes',
    {
      config: { tenantScope: 'jwt' },
      schema: { body: CreateTaxClassBody, response: { 201: TaxClassResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('POST /v1/admin/tax-classes');
      return sendIdempotent(reply, await createTaxClass(deps, ownerRequest(app, request), request.body));
    },
  );

  routes.patch(
    '/v1/admin/tax-classes/:tax_class_id',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: TaxClassParams, body: PatchTaxClassBody, response: { 200: TaxClassResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('PATCH /v1/admin/tax-classes/:tax_class_id');
      const data = await patchTaxClass(deps, ownerRequest(app, request), request.params.tax_class_id, request.body);
      return reply.send({ data });
    },
  );

  routes.post(
    '/v1/admin/categories',
    {
      config: { tenantScope: 'jwt' },
      schema: { body: CreateCategoryBody, response: { 201: CategoryResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('POST /v1/admin/categories');
      return sendIdempotent(reply, await createCategory(deps, ownerRequest(app, request), request.body));
    },
  );

  routes.patch(
    '/v1/admin/categories/:category_id',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: CategoryParams, body: PatchCategoryBody, response: { 200: CategoryResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('PATCH /v1/admin/categories/:category_id');
      const data = await patchCategory(deps, ownerRequest(app, request), request.params.category_id, request.body);
      return reply.send({ data });
    },
  );

  routes.get(
    '/v1/admin/menu',
    {
      config: { tenantScope: 'jwt' },
      schema: { querystring: MenuQuery, response: { 200: MenuResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('GET /v1/admin/menu');
      const { tenant, ownerUserId } = ownerRequest(app, request);
      return reply.send({ data: await listMenu(deps, tenant, ownerUserId, request.query) });
    },
  );

  routes.post(
    '/v1/admin/menu-items',
    {
      config: { tenantScope: 'jwt' },
      schema: { body: CreateMenuItemBody, response: { 201: MenuItemResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('POST /v1/admin/menu-items');
      return sendIdempotent(reply, await createMenuItem(deps, ownerRequest(app, request), request.body));
    },
  );

  routes.patch(
    '/v1/admin/menu-items/:item_id',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: MenuItemParams, body: PatchMenuItemBody, response: { 200: MenuItemResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('PATCH /v1/admin/menu-items/:item_id');
      const data = await patchMenuItem(deps, ownerRequest(app, request), request.params.item_id, request.body);
      return reply.send({ data });
    },
  );

  routes.put(
    '/v1/admin/menu-items/:item_id/routes/:branch_id',
    {
      config: { tenantScope: 'jwt' },
      schema: { params: ItemRouteParams, body: PutItemRouteBody, response: { 200: ItemRouteResponse } },
    },
    async (request, reply) => {
      deps.testHooks?.handlerStart?.('PUT /v1/admin/menu-items/:item_id/routes/:branch_id');
      const { item_id, branch_id } = request.params;
      const data = await putItemRoute(deps, ownerRequest(app, request), item_id, branch_id, request.body);
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
