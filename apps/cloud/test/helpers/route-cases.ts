// Tenant B's ids that a ROUTE_CASES entry may name in its path or payload.
export interface BIds {
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
  variantGroupId: string;
  roleId: string;
  staffId: string;
  refreshToken: string;
}

// Every jwt / branch-key route, keyed "METHOD /url" (D54, M25). A body that is otherwise valid.
export const ROUTE_CASES: Record<string, (ids: BIds) => { url: string; payload?: unknown }> = {
  'POST /v1/auth/logout': (ids) => ({ url: '/v1/auth/logout', payload: { refresh_token: ids.refreshToken } }),
  // a wrong current password: answered 401 without changing tenant A's credentials mid-sweep
  'POST /v1/auth/change-password': () => ({
    url: '/v1/auth/change-password',
    payload: { current_password: 'not-the-password', new_password: 'a-new-password-1' },
  }),
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
  'POST /v1/admin/variant-groups': (ids) => ({
    url: '/v1/admin/variant-groups',
    payload: { name: 'Karahi', category_id: ids.categoryId },
  }),
  'PATCH /v1/admin/variant-groups/:variant_group_id': (ids) => ({
    url: `/v1/admin/variant-groups/${ids.variantGroupId}`,
    payload: { expected_version: 'stale', name: 'Karahi' },
  }),
  'GET /v1/admin/staff': (ids) => ({ url: `/v1/admin/staff?branch_id=${ids.branchId}` }),
  'POST /v1/admin/staff': (ids) => ({
    url: '/v1/admin/staff',
    payload: { display_name: 'Bilal', role_ids: [ids.roleId], branch_ids: [ids.branchId] },
  }),
  'PATCH /v1/admin/staff/:staff_id': (ids) => ({
    url: `/v1/admin/staff/${ids.staffId}`,
    payload: { expected_version: 'stale', display_name: 'Bilal' },
  }),
  'GET /v1/admin/roles': () => ({ url: '/v1/admin/roles' }),
  'POST /v1/admin/roles': (ids) => ({
    url: '/v1/admin/roles',
    payload: {
      name: 'Shift lead',
      idle_minutes: 30,
      grants: [{ permission: 'apply-discount', grant_type: 'requires_approval', approver_role_ids: [ids.roleId] }],
    },
  }),
  'PATCH /v1/admin/roles/:role_id': (ids) => ({
    url: `/v1/admin/roles/${ids.roleId}`,
    payload: { expected_version: 'stale', name: 'Shift lead' },
  }),
  'PUT /v1/admin/staff/:staff_id/pin': (ids) => ({ url: `/v1/admin/staff/${ids.staffId}/pin`, payload: { pin: '1234' } }),
  'PATCH /v1/admin/branches/:branch_id': (ids) => ({ url: `/v1/admin/branches/${ids.branchId}`, payload: { name: 'Gulberg' } }),
  'GET /v1/admin/branches/:branch_id/settings': (ids) => ({ url: `/v1/admin/branches/${ids.branchId}/settings` }),
  'PATCH /v1/admin/branches/:branch_id/settings': (ids) => ({ url: `/v1/admin/branches/${ids.branchId}/settings`, payload: { tax_enabled: true } }),
  'GET /v1/admin/branches/:branch_id/responsibilities': (ids) => ({ url: `/v1/admin/branches/${ids.branchId}/responsibilities` }),
  'GET /v1/admin/branches/:branch_id/team-tree': (ids) => ({ url: `/v1/admin/branches/${ids.branchId}/team-tree` }),
  'PUT /v1/admin/branches/:branch_id/responsibilities': (ids) => ({
    url: `/v1/admin/branches/${ids.branchId}/responsibilities`,
    payload: {
      expected_version: 'stale',
      responsibilities: [{ responsibility: 'count_stock', station_id: ids.stationId, staff_ids: [ids.staffId], role_ids: [ids.roleId] }],
    },
  }),
};
