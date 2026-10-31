import type pg from 'pg';
import { issueRegistrationCode } from '../../src/cli/issue-registration-code';
import { seedTenant } from '../../src/cli/seed-tenant';
import { SystemContext } from '../../src/cli/system-context';
import { testIdGen, type IdGen } from '../../src/lib/ids';
import { testSecrets } from '../../src/lib/secrets';
import { legacyToken } from './legacy-token';
import { truncateAll, type TestCloud } from './test-cloud';

export const OWNER_PASSWORD = 'password-1';

export interface RestaurantFixture {
  tenantId: string;
  userId: string;
  branches: [string, string, string];
  token: string;
  tokenFor(branchIds: string[]): string;
  branchKey: string;
  other: { tenantId: string; userId: string; branchId: string; token: string };
}

const idempotencyKeys = testIdGen();

// Seeded rows get their own id space ('Z…'), so ids the app under test draws from its own testIdGen
// (which also starts at 1) never collide with them (a created role would reuse a seeded role_id).
function seedIds(): IdGen {
  const base = testIdGen();
  return { next: () => `Z${base.next().slice(1)}` };
}

// Tenant A: one owner, branches A, B, C, branch A registered (branchKey). Tenant B: one owner, one branch.
export async function restaurantFixture(cloud: TestCloud): Promise<RestaurantFixture> {
  await truncateAll(cloud.pool);
  const sys = new SystemContext(cloud.pool);
  const deps = { clock: cloud.clock, ids: seedIds(), secrets: testSecrets() };
  const a = await seedTenant(
    sys,
    { name: 'Tenant A', currency: 'PKR', ownerEmail: 'a@example.com', ownerName: 'Ada', password: OWNER_PASSWORD, pin: '1234' },
    deps,
  );
  const issued = [];
  for (const branchName of ['Branch A', 'Branch B', 'Branch C']) {
    issued.push(await issueRegistrationCode(sys, { tenantId: a.tenant_id, branchName }, deps));
  }
  const b = await seedTenant(
    sys,
    { name: 'Tenant B', currency: 'PKR', ownerEmail: 'b@example.com', ownerName: 'Bea', password: OWNER_PASSWORD, pin: '1234' },
    deps,
  );
  const issuedB = await issueRegistrationCode(sys, { tenantId: b.tenant_id, branchName: 'Branch X' }, deps);

  const registered = await cloud.app.inject({
    method: 'POST',
    url: '/v1/hubs/register',
    headers: { 'idempotency-key': idempotencyKeys.next() },
    payload: { registration_code: issued[0]!.code, hub_version: '1.0.0', accepted_kinds: ['new_branch'] },
  });
  if (registered.statusCode !== 200) throw new Error(`hub register failed: ${registered.body}`);

  const branches = issued.map((row) => row.branch_id) as [string, string, string];
  const tokenFor = (branchIds: string[]) =>
    legacyToken(cloud, { sub: a.user_id, tenant_id: a.tenant_id, allowed_branch_ids: branchIds });
  return {
    tenantId: a.tenant_id,
    userId: a.user_id,
    branches,
    token: tokenFor([...branches]),
    tokenFor,
    branchKey: registered.json().data.branch_api_key as string,
    other: {
      tenantId: b.tenant_id,
      userId: b.user_id,
      branchId: issuedB.branch_id,
      token: legacyToken(cloud, { sub: b.user_id, tenant_id: b.tenant_id, allowed_branch_ids: [issuedB.branch_id] }),
    },
  };
}

export function owner(f: RestaurantFixture, token?: string): { headers: Record<string, string> } {
  return {
    headers: { authorization: `Bearer ${token ?? f.token}`, 'idempotency-key': idempotencyKeys.next() },
  };
}

export interface SeededMenu {
  floorId: string;
  tableIds: [string, string];
  slotStationId: string;
  batchStationId: string;
  programIds: [string, string];
  taxClassId: string;
  categoryIds: [string, string];
  itemIds: string[];
  unroutedItemId: string;
  windowIds: { category: string; itemLate: string; itemEarly: string };
  archived?: {
    floorId: string;
    tableId: string;
    stationId: string;
    programId: string;
    taxClassId: string;
    categoryId: string;
    itemId: string;
  };
}

// Tenant A's menu routed to branch A, written by SQL (task 20). Item 0 is a slot item with stock and units;
// item 1 (items ≥ 2) is at the batch station; the rest are plain slot items. 'IT-B' is routed only to branch B.
// archived: one archived row of each kind (stations, programs and tax classes stay in the snapshot, S22).
export async function seedMenu(
  pool: pg.Pool,
  f: RestaurantFixture,
  o?: { items?: number; archived?: boolean },
): Promise<SeededMenu> {
  const [a, b] = f.branches;
  const q = (sql: string, params: unknown[] = []) => pool.query(sql, [f.tenantId, ...params]);
  await q(
    `INSERT INTO floors (tenant_id, branch_id, floor_id, name, sort_order, created_at, updated_at)
     VALUES ($1, $2, 'FL-1', 'Ground', 1, 0, 0)`,
    [a],
  );
  await q(
    `INSERT INTO dining_tables (tenant_id, branch_id, table_id, floor_id, name, seats, sort_order, created_at, updated_at)
     VALUES ($1, $2, 'TB-1', 'FL-1', 'T1', 4, 1, 0, 0), ($1, $2, 'TB-2', 'FL-1', 'T2', NULL, 2, 0, 0)`,
    [a],
  );
  await q(
    `INSERT INTO stations (tenant_id, branch_id, station_id, name, location_label, station_type, capacity,
       freshness_window_ms, created_at, updated_at)
     VALUES ($1, $2, 'ST-1', 'Karahi', NULL, 'slot', 4, NULL, 0, 0),
            ($1, $2, 'ST-2', 'Fryer', 'Back kitchen', 'batch', 8, 0, 0, 0),
            ($1, $3, 'ST-B', 'Karahi', NULL, 'slot', 4, NULL, 0, 0)`,
    [a, b],
  );
  await q(
    `INSERT INTO batch_programs (tenant_id, branch_id, station_id, program_id, name, cook_time_ms, created_at, updated_at)
     VALUES ($1, $2, 'ST-2', 'PG-1', 'Fry 180 °C', 360000, 0, 0), ($1, $2, 'ST-2', 'PG-2', 'Reheat', 120000, 0, 0)`,
    [a],
  );
  await q(
    `INSERT INTO tax_classes (tenant_id, tax_class_id, name, rate_bp, created_at, updated_at)
     VALUES ($1, 'TX-1', 'Standard', 1600, 0, 0)`,
  );
  await q(
    `INSERT INTO categories (tenant_id, category_id, name, sort_order, created_at, updated_at)
     VALUES ($1, 'CT-1', 'Karahi', 1, 0, 0), ($1, 'CT-2', 'Breakfast', 2, 0, 0)`,
  );
  const itemIds = Array.from({ length: o?.items ?? 2 }, (_, i) => `IT-${String(i).padStart(4, '0')}`);
  // item 0: stock 300 000 ms, 250 g per piece, threshold 1 000 g, taxed; item 1: carries over
  await q(
    `INSERT INTO menu_items (tenant_id, item_id, category_id, tax_class_id, name, group_label, sort_order, price_minor,
       serve_mode, cook_time_ms, stock_time_ms, stock_unit, stock_per_sale_unit, low_stock_threshold, carries_over,
       created_at, updated_at)
     SELECT $1, id, 'CT-1',
            CASE WHEN n = 0 THEN 'TX-1' END,
            CASE WHEN n = 0 THEN 'Chicken Karahi — Half' ELSE 'Item ' || n END,
            CASE WHEN n = 0 THEN 'Chicken Karahi' END,
            n, CASE WHEN n = 0 THEN 120000 ELSE 50000 + n END,
            'sync', 1200000,
            CASE WHEN n = 0 THEN 300000 END,
            CASE WHEN n = 0 THEN 'g' ELSE 'piece' END,
            CASE WHEN n = 0 THEN 250 ELSE 1 END,
            CASE WHEN n = 0 THEN 1000 END,
            n = 1, 0, 0
       FROM unnest($2::text[]) WITH ORDINALITY AS u (id, ord), LATERAL (SELECT (ord - 1)::int AS n) AS k`,
    [itemIds],
  );
  await q(
    `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, created_at, updated_at)
     VALUES ($1, 'IT-B', 'CT-1', 'Branch B only', 1000, 'immediate', 60000, 0, 0)`,
  );
  await q(
    `INSERT INTO item_routes (tenant_id, branch_id, item_id, station_id, program_id, stock_program_id, updated_at)
     SELECT $1, $2, id,
            CASE WHEN id = 'IT-0001' THEN 'ST-2' ELSE 'ST-1' END,
            CASE WHEN id = 'IT-0001' THEN 'PG-1' END,
            CASE WHEN id = 'IT-0001' THEN 'PG-2' END, 0
       FROM unnest($3::text[]) AS u (id)`,
    [a, itemIds],
  );
  await q(
    `INSERT INTO item_routes (tenant_id, branch_id, item_id, station_id, updated_at) VALUES ($1, $2, 'IT-B', 'ST-B', 0)`,
    [b],
  );
  // Two item windows with the same start: ordered by end although their ids sort the other way (S47).
  await q(
    `INSERT INTO availability_windows (tenant_id, window_id, item_id, category_id, start_ms, end_ms)
     VALUES ($1, 'WN-3', NULL, 'CT-2', 25200000, 46800000),
            ($1, 'WN-1', 'IT-0000', NULL, 3600000, 7200000),
            ($1, 'WN-2', 'IT-0000', NULL, 3600000, 5400000)`,
  );
  const menu: SeededMenu = {
    floorId: 'FL-1',
    tableIds: ['TB-1', 'TB-2'],
    slotStationId: 'ST-1',
    batchStationId: 'ST-2',
    programIds: ['PG-1', 'PG-2'],
    taxClassId: 'TX-1',
    categoryIds: ['CT-1', 'CT-2'],
    itemIds,
    unroutedItemId: 'IT-B',
    windowIds: { category: 'WN-3', itemLate: 'WN-1', itemEarly: 'WN-2' },
  };
  if (o?.archived !== true) return menu;

  await q(
    `INSERT INTO floors (tenant_id, branch_id, floor_id, name, archived_at, created_at, updated_at)
     VALUES ($1, $2, 'FL-X', 'Old floor', 1, 0, 0)`,
    [a],
  );
  await q(
    `INSERT INTO dining_tables (tenant_id, branch_id, table_id, floor_id, name, archived_at, created_at, updated_at)
     VALUES ($1, $2, 'TB-X', 'FL-1', 'Old table', 1, 0, 0), ($1, $2, 'TB-Y', 'FL-X', 'On old floor', 1, 0, 0)`,
    [a],
  );
  await q(
    `INSERT INTO stations (tenant_id, branch_id, station_id, name, station_type, capacity, archived_at, created_at, updated_at)
     VALUES ($1, $2, 'ST-X', 'Old tandoor', 'slot', 2, 1, 0, 0)`,
    [a],
  );
  await q(
    `INSERT INTO batch_programs (tenant_id, branch_id, station_id, program_id, name, cook_time_ms, archived_at, created_at, updated_at)
     VALUES ($1, $2, 'ST-2', 'PG-X', 'Old program', 60000, 1, 0, 0)`,
    [a],
  );
  await q(
    `INSERT INTO tax_classes (tenant_id, tax_class_id, name, rate_bp, archived_at, created_at, updated_at)
     VALUES ($1, 'TX-X', 'Old tax', 500, 1, 0, 0)`,
  );
  await q(
    `INSERT INTO categories (tenant_id, category_id, name, archived_at, created_at, updated_at)
     VALUES ($1, 'CT-X', 'Old category', 1, 0, 0)`,
  );
  await q(
    `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, archived_at, created_at, updated_at)
     VALUES ($1, 'IT-X', 'CT-1', 'Old item', 1000, 'immediate', 60000, 1, 0, 0)`,
  );
  await q(
    `INSERT INTO item_routes (tenant_id, branch_id, item_id, station_id, updated_at) VALUES ($1, $2, 'IT-X', 'ST-1', 0)`,
    [a],
  );
  return {
    ...menu,
    archived: {
      floorId: 'FL-X',
      tableId: 'TB-X',
      stationId: 'ST-X',
      programId: 'PG-X',
      taxClassId: 'TX-X',
      categoryId: 'CT-X',
      itemId: 'IT-X',
    },
  };
}
