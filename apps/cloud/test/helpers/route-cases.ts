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
  stockItemId: string;
  modifierGroupId: string;
  dealId: string;
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
  'GET /v1/admin/stock-items': () => ({ url: '/v1/admin/stock-items' }),
  'POST /v1/admin/stock-items': () => ({ url: '/v1/admin/stock-items', payload: { name: 'Karahi pot', stock_unit: 'g' } }),
  'PATCH /v1/admin/stock-items/:stock_item_id': (ids) => ({
    url: `/v1/admin/stock-items/${ids.stockItemId}`,
    payload: { expected_version: 'stale', name: 'Karahi pot' },
  }),
  'PUT /v1/admin/stock-items/:stock_item_id/branches/:branch_id': (ids) => ({
    url: `/v1/admin/stock-items/${ids.stockItemId}/branches/${ids.branchId}`,
    payload: { expected_version: 'stale', station_id: ids.stationId },
  }),
  'GET /v1/admin/modifier-groups': () => ({ url: '/v1/admin/modifier-groups' }),
  'POST /v1/admin/modifier-groups': (ids) => ({
    url: '/v1/admin/modifier-groups',
    payload: {
      name: 'Spice level',
      min_choices: 0,
      max_choices: 1,
      options: [{ name: 'Normal', price_minor: 0 }],
      links: [{ target_kind: 'category', target_id: ids.categoryId, mode: 'attach' }],
    },
  }),
  'PATCH /v1/admin/modifier-groups/:modifier_group_id': (ids) => ({
    url: `/v1/admin/modifier-groups/${ids.modifierGroupId}`,
    payload: { expected_version: 'stale', name: 'Spice level' },
  }),
  'PUT /v1/admin/modifier-groups/:modifier_group_id/branches/:branch_id': (ids) => ({
    url: `/v1/admin/modifier-groups/${ids.modifierGroupId}/branches/${ids.branchId}`,
    payload: { expected_version: 'stale', options: [] },
  }),
  'GET /v1/admin/deals': () => ({ url: '/v1/admin/deals' }),
  'POST /v1/admin/deals': (ids) => ({
    url: '/v1/admin/deals',
    payload: {
      name: 'Family karahi',
      category_id: ids.categoryId,
      tax_class_id: ids.taxClassId,
      price_minor: 250000,
      parts: [{ quantity: 1, choices: [{ item_id: ids.itemId }] }],
    },
  }),
  'PATCH /v1/admin/deals/:deal_id': (ids) => ({
    url: `/v1/admin/deals/${ids.dealId}`,
    payload: { expected_version: 'stale', name: 'Family karahi' },
  }),
  'PUT /v1/admin/deals/:deal_id/branches/:branch_id': (ids) => ({
    url: `/v1/admin/deals/${ids.dealId}/branches/${ids.branchId}`,
    payload: { expected_version: 'stale', is_sold: true },
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
