import { afterEach, describe, expect, it } from 'vitest';
import { listTenantScopes } from '../src/plugins/tenant-scope';
import { OWNER_PASSWORD, restaurantFixture } from './helpers/restaurant';
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
  refreshToken: string;
}

// Every jwt / branch-key route, keyed "METHOD /url" (D54, M25). A body that is otherwise valid.
const ROUTE_CASES: Record<string, (ids: BIds) => { url: string; payload?: unknown }> = {
  'POST /v1/auth/logout': (ids) => ({ url: '/v1/auth/logout', payload: { refresh_token: ids.refreshToken } }),
  'POST /v1/hubs/confirm': () => ({ url: '/v1/hubs/confirm', payload: { hub_version: '1.0.0' } }),
  'GET /v1/sync/config': () => ({ url: '/v1/sync/config?config_version=0&directory_version=0' }),
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
      `INSERT INTO stations (tenant_id, branch_id, station_id, name, station_type, capacity, created_at, updated_at)
       VALUES ($1, $2, $3, 'B station', 'slot', 1, 0, 0)`,
      [f.other.tenantId, f.other.branchId, stationId],
    );
    const ids: BIds = {
      tenantId: f.other.tenantId,
      userId: f.other.userId,
      branchId: f.other.branchId,
      auditId,
      floorId,
      tableId,
      stationId,
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
      const returned = stringsIn(response.json());
      for (const id of bIds) expect(returned).not.toContain(id);
      if (route.url === '/v1/hubs/confirm') {
        expect(response.statusCode).toBe(200);
        expect(response.json().data.branch_id).toBe(f.branches[0]);
      }
      if (route.url.includes(':branch_id')) {
        expect(response.statusCode, `${route.method} ${route.url}`).toBe(404);
        expect(response.json().error.code).toBe('BRANCH_NOT_FOUND');
      }
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
