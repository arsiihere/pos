import { afterEach, describe, expect, it } from 'vitest';
import { listTenantScopes } from '../src/plugins/tenant-scope';
import { OWNER_PASSWORD, owner, restaurantFixture } from './helpers/restaurant';
import { createTestCloud } from './helpers/test-cloud';

// Tenant B's ids that a ROUTE_CASES entry may name in its path or payload.
interface BIds {
  tenantId: string;
  userId: string;
  branchId: string;
  auditId: string;
  floorId: string;
  tableId: string;
  stationId: string;
  programId: string;
  taxClassId: string;
  categoryId: string;
  itemId: string;
  refreshToken: string;
}

// Every jwt / branch-key route, keyed "METHOD /url" (D54, M25). A body that is otherwise valid.
const ROUTE_CASES: Record<string, (ids: BIds) => { url: string; payload?: unknown }> = {
  'POST /v1/auth/logout': (ids) => ({ url: '/v1/auth/logout', payload: { refresh_token: ids.refreshToken } }),
  'POST /v1/hubs/confirm': () => ({ url: '/v1/hubs/confirm', payload: { hub_version: '1.0.0' } }),
  'GET /v1/sync/config': () => ({ url: '/v1/sync/config?config_version=0&directory_version=0' }),
  'GET /v1/admin/branches': () => ({ url: '/v1/admin/branches' }),
  'GET /v1/admin/branches/:branch_id/floors': (ids) => ({ url: `/v1/admin/branches/${ids.branchId}/floors` }),
  'POST /v1/admin/branches/:branch_id/floors': (ids) => ({
    url: `/v1/admin/branches/${ids.branchId}/floors`,
    payload: { name: 'Ground' },
  }),
  'PATCH /v1/admin/branches/:branch_id/floors/:floor_id': (ids) => ({
    url: `/v1/admin/branches/${ids.branchId}/floors/${ids.floorId}`,
    payload: { name: 'Ground' },
  }),
  'POST /v1/admin/branches/:branch_id/tables': (ids) => ({
    url: `/v1/admin/branches/${ids.branchId}/tables`,
    payload: { floor_id: ids.floorId, name: 'T1' },
  }),
  'PATCH /v1/admin/branches/:branch_id/tables/:table_id': (ids) => ({
    url: `/v1/admin/branches/${ids.branchId}/tables/${ids.tableId}`,
    payload: { floor_id: ids.floorId, name: 'T1' },
  }),
  'GET /v1/admin/branches/:branch_id/stations': (ids) => ({ url: `/v1/admin/branches/${ids.branchId}/stations` }),
  'POST /v1/admin/branches/:branch_id/stations': (ids) => ({
    url: `/v1/admin/branches/${ids.branchId}/stations`,
    payload: { name: 'Fryer', station_type: 'batch', capacity: 2 },
  }),
  'PATCH /v1/admin/branches/:branch_id/stations/:station_id': (ids) => ({
    url: `/v1/admin/branches/${ids.branchId}/stations/${ids.stationId}`,
    payload: { name: 'Fryer' },
  }),
  'POST /v1/admin/branches/:branch_id/stations/:station_id/programs': (ids) => ({
    url: `/v1/admin/branches/${ids.branchId}/stations/${ids.stationId}/programs`,
    payload: { name: 'Fries', cook_time_ms: 300000 },
  }),
  'PATCH /v1/admin/branches/:branch_id/stations/:station_id/programs/:program_id': (ids) => ({
    url: `/v1/admin/branches/${ids.branchId}/stations/${ids.stationId}/programs/${ids.programId}`,
    payload: { cook_time_ms: 300000 },
  }),
  'POST /v1/admin/tax-classes': () => ({ url: '/v1/admin/tax-classes', payload: { name: 'GST', rate_bp: 1600 } }),
  'PATCH /v1/admin/tax-classes/:tax_class_id': (ids) => ({
    url: `/v1/admin/tax-classes/${ids.taxClassId}`,
    payload: { rate_bp: 1600 },
  }),
  'POST /v1/admin/categories': () => ({ url: '/v1/admin/categories', payload: { name: 'Mains' } }),
  'PATCH /v1/admin/categories/:category_id': (ids) => ({
    url: `/v1/admin/categories/${ids.categoryId}`,
    payload: { name: 'Mains' },
  }),
  'GET /v1/admin/menu': (ids) => ({ url: `/v1/admin/menu?category_id=${ids.categoryId}` }),
  'POST /v1/admin/menu-items': (ids) => ({
    url: '/v1/admin/menu-items',
    payload: {
      category_id: ids.categoryId,
      tax_class_id: ids.taxClassId,
      name: 'Karahi',
      price_minor: 100,
      serve_mode: 'sync',
      cook_time_ms: 60000,
      routes: [{ branch_id: ids.branchId, station_id: ids.stationId, program_id: ids.programId }],
    },
  }),
  'PATCH /v1/admin/menu-items/:item_id': (ids) => ({
    url: `/v1/admin/menu-items/${ids.itemId}`,
    payload: { category_id: ids.categoryId, tax_class_id: ids.taxClassId, price_minor: 100 },
  }),
  'PUT /v1/admin/menu-items/:item_id/routes/:branch_id': (ids) => ({
    url: `/v1/admin/menu-items/${ids.itemId}/routes/${ids.branchId}`,
    payload: { station_id: ids.stationId, program_id: ids.programId },
  }),
};

describe('cross-tenant', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("[00 §10 #77] every scoped route with tenant A's credentials returns no tenant B id", async () => {
    const cloud = await createTestCloud();
    cleanups.push(() => cloud.close());
    const f = await restaurantFixture(cloud);

    const loginB = await cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'b@example.com', password: OWNER_PASSWORD },
    });
    expect(loginB.statusCode).toBe(200);
    const auditId = 'B-AUDIT-0000000000000000001';
    await cloud.pool.query(
      `INSERT INTO config_audit (tenant_id, audit_id, actor_kind, actor_owner_user_id, branch_id, entity, entity_id, action, after, at)
       VALUES ($1, $2, 'owner', $3, $4, 'floor', 'B-FLOOR', 'create', '{"name":"B floor"}', $5)`,
      [f.other.tenantId, auditId, f.other.userId, f.other.branchId, cloud.clock.branchNow()],
    );
    const floorId = 'B-FLOOR-000000000000000001';
    await cloud.pool.query(
      `INSERT INTO floors (tenant_id, branch_id, floor_id, name, created_at, updated_at) VALUES ($1, $2, $3, 'B floor', 0, 0)`,
      [f.other.tenantId, f.other.branchId, floorId],
    );
    const tableId = 'B-TABLE-000000000000000001';
    await cloud.pool.query(
      `INSERT INTO dining_tables (tenant_id, branch_id, table_id, floor_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'B table', 0, 0)`,
      [f.other.tenantId, f.other.branchId, tableId, floorId],
    );
    const stationId = 'B-STATION-0000000000000001';
    await cloud.pool.query(
      `INSERT INTO stations (tenant_id, branch_id, station_id, name, station_type, capacity, freshness_window_ms, created_at, updated_at)
       VALUES ($1, $2, $3, 'B station', 'batch', 1, 0, 0, 0)`,
      [f.other.tenantId, f.other.branchId, stationId],
    );
    const programId = 'B-PROGRAM-0000000000000001';
    await cloud.pool.query(
      `INSERT INTO batch_programs (tenant_id, branch_id, station_id, program_id, name, cook_time_ms, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'B program', 60000, 0, 0)`,
      [f.other.tenantId, f.other.branchId, stationId, programId],
    );
    const taxClassId = 'B-TAX-CLASS-00000000000001';
    await cloud.pool.query(
      `INSERT INTO tax_classes (tenant_id, tax_class_id, name, rate_bp, created_at, updated_at) VALUES ($1, $2, 'B tax', 1600, 0, 0)`,
      [f.other.tenantId, taxClassId],
    );
    const categoryId = 'B-CATEGORY-000000000000001';
    await cloud.pool.query(
      `INSERT INTO categories (tenant_id, category_id, name, created_at, updated_at) VALUES ($1, $2, 'B category', 0, 0)`,
      [f.other.tenantId, categoryId],
    );
    const itemId = 'B-ITEM-00000000000000000001';
    await cloud.pool.query(
      `INSERT INTO menu_items (tenant_id, item_id, category_id, tax_class_id, name, price_minor, serve_mode, cook_time_ms,
                               created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'B item', 100, 'immediate', 60000, 0, 0)`,
      [f.other.tenantId, itemId, categoryId, taxClassId],
    );
    await cloud.pool.query(
      `INSERT INTO item_routes (tenant_id, branch_id, item_id, station_id, program_id, updated_at) VALUES ($1, $2, $3, $4, $5, 0)`,
      [f.other.tenantId, f.other.branchId, itemId, stationId, programId],
    );
    const ids: BIds = {
      tenantId: f.other.tenantId,
      userId: f.other.userId,
      branchId: f.other.branchId,
      auditId,
      floorId,
      tableId,
      stationId,
      programId,
      taxClassId,
      categoryId,
      itemId,
      refreshToken: loginB.json().data.refresh_token as string,
    };
    const staff = await cloud.pool.query<{ staff_id: string }>(`SELECT staff_id FROM staff WHERE tenant_id = $1`, [
      ids.tenantId,
    ]);
    const roles = await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1`, [
      ids.tenantId,
    ]);
    const bIds = [
      ids.tenantId,
      ids.userId,
      ids.branchId,
      ids.auditId,
      ids.floorId,
      ids.tableId,
      ids.stationId,
      ids.programId,
      ids.taxClassId,
      ids.categoryId,
      ids.itemId,
      ...staff.rows.map((row) => row.staff_id),
      ...roles.rows.map((row) => row.role_id),
    ];

    const routes = listTenantScopes(cloud.app).filter(
      (route) => (route.tenantScope === 'jwt' || route.tenantScope === 'branch-key') && route.method !== 'HEAD',
    );
    expect(routes.map((route) => `${route.method} ${route.url}`).sort()).toEqual(Object.keys(ROUTE_CASES).sort());

    for (const route of routes) {
      const credential = route.tenantScope === 'jwt' ? f.token : f.branchKey;
      const request = ROUTE_CASES[`${route.method} ${route.url}`]!(ids);
      const response = await cloud.app.inject({
        method: route.method as 'POST',
        url: request.url,
        headers: { authorization: `Bearer ${credential}` },
        ...(request.payload !== undefined ? { payload: request.payload as object } : {}),
      });
      expect(response.statusCode).toBeLessThan(500);
      // 01a §9: a *_NOT_FOUND error's details name the id the caller sent; echoing the caller's own input
      // is not a leak, so only those strings are exempt, and only inside error.details.
      const body = response.json() as { error?: { details?: unknown } };
      const sent = new Set([...request.url.split(/[/?&=]/), ...stringsIn(request.payload)]);
      const echoed = stringsIn(body.error?.details).filter((s) => sent.has(s));
      const returned = stringsIn(body);
      for (const id of bIds) {
        if (!echoed.includes(id)) expect(returned).not.toContain(id);
      }
      if (
        route.url === '/v1/admin/tax-classes/:tax_class_id' ||
        route.url === '/v1/admin/categories/:category_id' ||
        route.url === '/v1/admin/menu-items/:item_id'
      ) {
        expect(response.statusCode, `${route.method} ${route.url}`).toBe(404);
        expect(returned.filter((s) => bIds.includes(s))).toEqual(echoed);
      }
      if (route.url === '/v1/hubs/confirm') {
        expect(response.statusCode).toBe(200);
        expect(response.json().data.branch_id).toBe(f.branches[0]);
      }
      if (route.url.includes(':branch_id')) {
        expect(response.statusCode, `${route.method} ${route.url}`).toBe(404);
        expect(response.json().error.code).toBe('BRANCH_NOT_FOUND');
      }
    }

    // 01a §6.5: tenant A's own branch with B's floor id stops at the tenant-scoped floor read, not the branch guard.
    const foreignFloor = await cloud.app.inject({
      method: 'POST',
      url: `/v1/admin/branches/${f.branches[0]}/tables`,
      ...owner(f),
      payload: { floor_id: ids.floorId, name: 'T1' },
    });
    expect(foreignFloor.statusCode).toBe(422);
    expect(foreignFloor.json().error).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'floor_id', reason: 'not_found' },
    });
    expect(stringsIn(foreignFloor.json())).not.toContain(ids.floorId);

    // 01a §6.16: B's item on A's own branch stops at the tenant-level item lock; B's station at the scoped read.
    const foreignItem = await cloud.app.inject({
      method: 'PUT',
      url: `/v1/admin/menu-items/${ids.itemId}/routes/${f.branches[0]}`,
      ...owner(f),
      payload: { station_id: ids.stationId, program_id: ids.programId },
    });
    expect(foreignItem.statusCode).toBe(404);
    expect(foreignItem.json().error).toMatchObject({ code: 'MENU_ITEM_NOT_FOUND', details: { item_id: ids.itemId } });
    expect(stringsIn(foreignItem.json()).filter((s) => bIds.includes(s))).toEqual([ids.itemId]);

    // 01a §6.14: B's category or tax class on a tenant-level create stops at the tenant-level read.
    const ownCategory = (
      await cloud.app.inject({ method: 'POST', url: '/v1/admin/categories', ...owner(f), payload: { name: 'Own' } })
    ).json().data.category.category_id as string;
    for (const [field, foreignId, refs] of [
      ['category_id', ids.categoryId, { category_id: ids.categoryId, tax_class_id: null }],
      ['tax_class_id', ids.taxClassId, { category_id: ownCategory, tax_class_id: ids.taxClassId }],
    ] as const) {
      const foreign = await cloud.app.inject({
        method: 'POST',
        url: '/v1/admin/menu-items',
        ...owner(f),
        payload: { name: 'Karahi', price_minor: 100, serve_mode: 'sync', cook_time_ms: 60000, ...refs },
      });
      expect(foreign.statusCode, field).toBe(422);
      expect(foreign.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field, reason: 'not_found' } });
      expect(stringsIn(foreign.json())).not.toContain(foreignId);
    }
  });
});

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => stringsIn(item));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => (key === 'request_id' ? [] : stringsIn(child)));
  }
  return [];
}
