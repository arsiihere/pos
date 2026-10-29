import type { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import type { TenantScopedRepository } from '../../db/tenant-scoped-repository.js';
import type { AuditEntry } from '../../lib/config-audit.js';
import type { Clock } from '../../lib/clock.js';
import type { IdGen } from '../../lib/ids.js';
import type { VariantGroupRow } from '../menu-variants/versions.js';

export interface FloorRow {
  floor_id: string;
  name: string;
  sort_order: number;
  archived_at: number | null;
}

export interface TableRow {
  table_id: string;
  floor_id: string;
  name: string;
  seats: number | null;
  sort_order: number;
  archived_at: number | null;
}

export type StationType = 'slot' | 'batch';
export type CompletionMode = 'two_tap' | 'single_tap' | 'auto_done';

export interface StationRow {
  station_id: string;
  name: string;
  location_label: string | null;
  station_type: StationType;
  capacity: number;
  freshness_window_ms: number | null;
  completion_mode: CompletionMode;
  archived_at: number | null;
}

export interface ProgramRow {
  program_id: string;
  station_id: string;
  name: string;
  cook_time_ms: number;
  archived_at: number | null;
}

export interface TaxClassRow {
  tax_class_id: string;
  name: string;
  rate_bp: number;
  archived_at: number | null;
}

export interface CategoryRow {
  category_id: string;
  name: string;
  sort_order: number;
  archived_at: number | null;
}

type Raw<T> = { [K in keyof T]: K extends 'archived_at' ? string | null : T[K] };

const FLOOR_COLUMNS = 'floor_id, name, sort_order, archived_at';
const TABLE_COLUMNS = 'table_id, floor_id, name, seats, sort_order, archived_at';
const STATION_COLUMNS =
  'station_id, name, location_label, station_type, capacity, freshness_window_ms, completion_mode, archived_at';
const PROGRAM_COLUMNS = 'program_id, station_id, name, cook_time_ms, archived_at';

export interface BranchRow {
  branch_id: string;
  name: string;
  status: 'pending_hub' | 'active';
  hub_last_seen_at: number | null;
  hub_synced_at: number | null;
}

// §6.7b (S58): the caller's branches, by name; v1.3 (01b B19) with the hub's two times.
export async function selectBranches(repo: TenantScopedRepository): Promise<BranchRow[]> {
  const rows = await repo.query<Omit<BranchRow, 'hub_last_seen_at' | 'hub_synced_at'> & { hub_last_seen_at: string | null; hub_synced_at: string | null }>(
    `SELECT branch_id, name, status, hub_last_seen_at, hub_synced_at FROM branches
      WHERE tenant_id = $1 AND branch_id = ANY($2)
      ORDER BY name, branch_id`,
  );
  return rows.map((row) => ({
    ...row,
    hub_last_seen_at: row.hub_last_seen_at === null ? null : Number(row.hub_last_seen_at),
    hub_synced_at: row.hub_synced_at === null ? null : Number(row.hub_synced_at),
  }));
}

export async function selectFloors(repo: TenantScopedRepository, branchId: string): Promise<FloorRow[]> {
  const rows = await repo.query<Raw<FloorRow>>(
    `SELECT ${FLOOR_COLUMNS} FROM floors
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3
      ORDER BY sort_order, floor_id`,
    [branchId],
  );
  return rows.map(floorRow);
}

export async function selectTables(repo: TenantScopedRepository, branchId: string): Promise<TableRow[]> {
  const rows = await repo.query<Raw<TableRow>>(
    `SELECT ${TABLE_COLUMNS} FROM dining_tables
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3
      ORDER BY sort_order, table_id`,
    [branchId],
  );
  return rows.map(tableRow);
}

// Inserts through the branch row, so a branch that does not exist inserts nothing.
export async function insertFloor(
  repo: TenantScopedRepository,
  input: { branchId: string; floorId: string; name: string; sortOrder: number; now: number },
): Promise<FloorRow | undefined> {
  const rows = await repo.query<Raw<FloorRow>>(
    `INSERT INTO floors (tenant_id, branch_id, floor_id, name, sort_order, created_at, updated_at)
     SELECT tenant_id, branch_id, $4, $5, $6, $7, $7 FROM branches
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3
     RETURNING ${FLOOR_COLUMNS}`,
    [input.branchId, input.floorId, input.name, input.sortOrder, input.now],
  );
  return rows[0] === undefined ? undefined : floorRow(rows[0]);
}

export async function lockFloor(
  repo: TenantScopedRepository,
  branchId: string,
  floorId: string,
): Promise<FloorRow | undefined> {
  const rows = await repo.query<Raw<FloorRow>>(
    `SELECT ${FLOOR_COLUMNS} FROM floors
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND floor_id = $4
      FOR UPDATE`,
    [branchId, floorId],
  );
  return rows[0] === undefined ? undefined : floorRow(rows[0]);
}

export async function activeTableIds(repo: TenantScopedRepository, branchId: string, floorId: string): Promise<string[]> {
  const rows = await repo.query<{ table_id: string }>(
    `SELECT table_id FROM dining_tables
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND floor_id = $4 AND archived_at IS NULL
      ORDER BY table_id`,
    [branchId, floorId],
  );
  return rows.map((row) => row.table_id);
}

export async function updateFloor(
  repo: TenantScopedRepository,
  branchId: string,
  floor: FloorRow,
  now: number,
): Promise<FloorRow> {
  const rows = await repo.query<Raw<FloorRow>>(
    `UPDATE floors SET name = $5, sort_order = $6, archived_at = $7, updated_at = $8
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND floor_id = $4
      RETURNING ${FLOOR_COLUMNS}`,
    [branchId, floor.floor_id, floor.name, floor.sort_order, floor.archived_at, now],
  );
  return floorRow(rows[0]!);
}

// A reference check: the floor in any of the caller's branches, so another branch's floor is told apart
// from an unknown one (§3.3 wrong_branch). FOR SHARE holds it against a concurrent archive.
export async function shareFloor(
  repo: TenantScopedRepository,
  floorId: string,
): Promise<{ branch_id: string; archived_at: number | null } | undefined> {
  const rows = await repo.query<{ branch_id: string; archived_at: string | null }>(
    `SELECT branch_id, archived_at FROM floors
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND floor_id = $3
      FOR SHARE`,
    [floorId],
  );
  return rows[0] === undefined ? undefined : { branch_id: rows[0].branch_id, archived_at: msOrNull(rows[0].archived_at) };
}

export async function insertTable(
  repo: TenantScopedRepository,
  input: { branchId: string; tableId: string; floorId: string; name: string; seats: number | null; sortOrder: number; now: number },
): Promise<TableRow> {
  const rows = await repo.query<Raw<TableRow>>(
    `INSERT INTO dining_tables (tenant_id, branch_id, table_id, floor_id, name, seats, sort_order, created_at, updated_at)
     SELECT tenant_id, branch_id, $4, $5, $6, $7, $8, $9, $9 FROM branches
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3
     RETURNING ${TABLE_COLUMNS}`,
    [input.branchId, input.tableId, input.floorId, input.name, input.seats, input.sortOrder, input.now],
  );
  return tableRow(rows[0]!);
}

export async function lockTable(
  repo: TenantScopedRepository,
  branchId: string,
  tableId: string,
): Promise<TableRow | undefined> {
  const rows = await repo.query<Raw<TableRow>>(
    `SELECT ${TABLE_COLUMNS} FROM dining_tables
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND table_id = $4
      FOR UPDATE`,
    [branchId, tableId],
  );
  return rows[0] === undefined ? undefined : tableRow(rows[0]);
}

export async function updateTable(
  repo: TenantScopedRepository,
  branchId: string,
  table: TableRow,
  now: number,
): Promise<TableRow> {
  const rows = await repo.query<Raw<TableRow>>(
    `UPDATE dining_tables SET floor_id = $5, name = $6, seats = $7, sort_order = $8, archived_at = $9, updated_at = $10
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND table_id = $4
      RETURNING ${TABLE_COLUMNS}`,
    [branchId, table.table_id, table.floor_id, table.name, table.seats, table.sort_order, table.archived_at, now],
  );
  return tableRow(rows[0]!);
}

// §6.8: stations and programs, archived included; by name, then id (as in the snapshot).
export async function selectStations(repo: TenantScopedRepository, branchId: string): Promise<StationRow[]> {
  const rows = await repo.query<Raw<StationRow>>(
    `SELECT ${STATION_COLUMNS} FROM stations
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3
      ORDER BY name, station_id`,
    [branchId],
  );
  return rows.map(withArchivedAt);
}

export async function selectPrograms(repo: TenantScopedRepository, branchId: string): Promise<ProgramRow[]> {
  const rows = await repo.query<Raw<ProgramRow>>(
    `SELECT ${PROGRAM_COLUMNS} FROM batch_programs
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3
      ORDER BY name, program_id`,
    [branchId],
  );
  return rows.map(withArchivedAt);
}

export async function insertStation(
  repo: TenantScopedRepository,
  branchId: string,
  station: Omit<StationRow, 'archived_at'>,
  now: number,
): Promise<StationRow | undefined> {
  const rows = await repo.query<Raw<StationRow>>(
    `INSERT INTO stations (tenant_id, branch_id, station_id, name, location_label, station_type, capacity,
                           freshness_window_ms, completion_mode, created_at, updated_at)
     SELECT tenant_id, branch_id, $4, $5, $6, $7, $8, $9, $10, $11, $11 FROM branches
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3
     RETURNING ${STATION_COLUMNS}`,
    [
      branchId,
      station.station_id,
      station.name,
      station.location_label,
      station.station_type,
      station.capacity,
      station.freshness_window_ms,
      station.completion_mode,
      now,
    ],
  );
  return rows[0] === undefined ? undefined : withArchivedAt(rows[0]);
}

export async function lockStation(
  repo: TenantScopedRepository,
  branchId: string,
  stationId: string,
): Promise<StationRow | undefined> {
  const rows = await repo.query<Raw<StationRow>>(
    `SELECT ${STATION_COLUMNS} FROM stations
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND station_id = $4
      FOR UPDATE`,
    [branchId, stationId],
  );
  return rows[0] === undefined ? undefined : withArchivedAt(rows[0]);
}

export async function updateStation(
  repo: TenantScopedRepository,
  branchId: string,
  station: StationRow,
  now: number,
): Promise<StationRow> {
  const rows = await repo.query<Raw<StationRow>>(
    `UPDATE stations SET name = $5, location_label = $6, station_type = $7, capacity = $8, freshness_window_ms = $9,
                         completion_mode = $10, archived_at = $11, updated_at = $12
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND station_id = $4
      RETURNING ${STATION_COLUMNS}`,
    [
      branchId,
      station.station_id,
      station.name,
      station.location_label,
      station.station_type,
      station.capacity,
      station.freshness_window_ms,
      station.completion_mode,
      station.archived_at,
      now,
    ],
  );
  return withArchivedAt(rows[0]!);
}

// S22: routes of active items that point at the station (index item_routes_station).
export async function activeRouteItemIds(
  repo: TenantScopedRepository,
  branchId: string,
  stationId: string,
): Promise<string[]> {
  const rows = await repo.query<{ item_id: string }>(
    `SELECT r.item_id FROM item_routes r
       JOIN menu_items m ON m.tenant_id = r.tenant_id AND m.item_id = r.item_id AND m.archived_at IS NULL
      WHERE r.tenant_id = $1 AND r.branch_id = ANY($2) AND r.branch_id = $3 AND r.station_id = $4
      ORDER BY r.item_id`,
    [branchId, stationId],
  );
  return rows.map((row) => row.item_id);
}

// §6.9: a station that becomes slot archives its active programs; returns them archived, by id.
export async function archiveStationPrograms(
  repo: TenantScopedRepository,
  branchId: string,
  stationId: string,
  now: number,
): Promise<ProgramRow[]> {
  const rows = await repo.query<Raw<ProgramRow>>(
    `UPDATE batch_programs SET archived_at = $5, updated_at = $5
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND station_id = $4 AND archived_at IS NULL
      RETURNING ${PROGRAM_COLUMNS}`,
    [branchId, stationId, now],
  );
  return rows.map(withArchivedAt).sort((a, b) => (a.program_id < b.program_id ? -1 : a.program_id > b.program_id ? 1 : 0));
}

// A reference check: the path station of this branch, FOR SHARE against a concurrent archive or type change.
export async function shareStation(
  repo: TenantScopedRepository,
  branchId: string,
  stationId: string,
): Promise<{ station_type: StationType; archived_at: number | null } | undefined> {
  type Shared = { station_type: StationType; archived_at: number | null };
  const rows = await repo.query<Raw<Shared>>(
    `SELECT station_type, archived_at FROM stations
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND station_id = $4
      FOR SHARE`,
    [branchId, stationId],
  );
  return rows[0] === undefined ? undefined : withArchivedAt<Shared>(rows[0]);
}

export async function insertProgram(
  repo: TenantScopedRepository,
  branchId: string,
  program: Omit<ProgramRow, 'archived_at'>,
  now: number,
): Promise<ProgramRow> {
  const rows = await repo.query<Raw<ProgramRow>>(
    `INSERT INTO batch_programs (tenant_id, branch_id, station_id, program_id, name, cook_time_ms, created_at, updated_at)
     SELECT tenant_id, branch_id, $4, $5, $6, $7, $8, $8 FROM branches
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3
     RETURNING ${PROGRAM_COLUMNS}`,
    [branchId, program.station_id, program.program_id, program.name, program.cook_time_ms, now],
  );
  return withArchivedAt(rows[0]!);
}

export async function lockProgram(
  repo: TenantScopedRepository,
  branchId: string,
  stationId: string,
  programId: string,
): Promise<ProgramRow | undefined> {
  const rows = await repo.query<Raw<ProgramRow>>(
    `SELECT ${PROGRAM_COLUMNS} FROM batch_programs
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND station_id = $4 AND program_id = $5
      FOR UPDATE`,
    [branchId, stationId, programId],
  );
  return rows[0] === undefined ? undefined : withArchivedAt(rows[0]);
}

export async function updateProgram(
  repo: TenantScopedRepository,
  branchId: string,
  program: ProgramRow,
  now: number,
): Promise<ProgramRow> {
  const rows = await repo.query<Raw<ProgramRow>>(
    `UPDATE batch_programs SET name = $5, cook_time_ms = $6, archived_at = $7, updated_at = $8
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND program_id = $4
      RETURNING ${PROGRAM_COLUMNS}`,
    [branchId, program.program_id, program.name, program.cook_time_ms, program.archived_at, now],
  );
  return withArchivedAt(rows[0]!);
}

// S22: active items whose route uses the program as program_id or stock_program_id.
export async function programRouteItemIds(
  repo: TenantScopedRepository,
  branchId: string,
  programId: string,
): Promise<string[]> {
  const rows = await repo.query<{ item_id: string }>(
    `SELECT r.item_id FROM item_routes r
       JOIN menu_items m ON m.tenant_id = r.tenant_id AND m.item_id = r.item_id AND m.archived_at IS NULL
      WHERE r.tenant_id = $1 AND r.branch_id = ANY($2) AND r.branch_id = $3
        AND (r.program_id = $4 OR r.stock_program_id = $4)
      ORDER BY r.item_id`,
    [branchId, programId],
  );
  return rows.map((row) => row.item_id);
}

const TAX_CLASS_COLUMNS = 'tax_class_id, name, rate_bp, archived_at';
const CATEGORY_COLUMNS = 'category_id, name, sort_order, archived_at';

// Tenant-level rows insert through the tenant row (TenantLevelRepository needs tenant_id = $1).
export async function insertTaxClass(
  repo: TenantLevelRepository,
  input: { taxClassId: string; name: string; rateBp: number; now: number },
): Promise<TaxClassRow> {
  const rows = await repo.query<Raw<TaxClassRow>>(
    `INSERT INTO tax_classes (tenant_id, tax_class_id, name, rate_bp, created_at, updated_at)
     SELECT tenant_id, $2, $3, $4, $5, $5 FROM tenants WHERE tenant_id = $1
     RETURNING ${TAX_CLASS_COLUMNS}`,
    [input.taxClassId, input.name, input.rateBp, input.now],
  );
  return withArchivedAt(rows[0]!);
}

export async function lockTaxClass(repo: TenantLevelRepository, taxClassId: string): Promise<TaxClassRow | undefined> {
  const rows = await repo.query<Raw<TaxClassRow>>(
    `SELECT ${TAX_CLASS_COLUMNS} FROM tax_classes WHERE tenant_id = $1 AND tax_class_id = $2 FOR UPDATE`,
    [taxClassId],
  );
  return rows[0] === undefined ? undefined : withArchivedAt(rows[0]);
}

export async function updateTaxClass(repo: TenantLevelRepository, row: TaxClassRow, now: number): Promise<TaxClassRow> {
  const rows = await repo.query<Raw<TaxClassRow>>(
    `UPDATE tax_classes SET name = $3, rate_bp = $4, archived_at = $5, updated_at = $6
      WHERE tenant_id = $1 AND tax_class_id = $2
      RETURNING ${TAX_CLASS_COLUMNS}`,
    [row.tax_class_id, row.name, row.rate_bp, row.archived_at, now],
  );
  return withArchivedAt(rows[0]!);
}

export async function insertCategory(
  repo: TenantLevelRepository,
  input: { categoryId: string; name: string; sortOrder: number; now: number },
): Promise<CategoryRow> {
  const rows = await repo.query<Raw<CategoryRow>>(
    `INSERT INTO categories (tenant_id, category_id, name, sort_order, created_at, updated_at)
     SELECT tenant_id, $2, $3, $4, $5, $5 FROM tenants WHERE tenant_id = $1
     RETURNING ${CATEGORY_COLUMNS}`,
    [input.categoryId, input.name, input.sortOrder, input.now],
  );
  return withArchivedAt(rows[0]!);
}

export async function lockCategory(repo: TenantLevelRepository, categoryId: string): Promise<CategoryRow | undefined> {
  const rows = await repo.query<Raw<CategoryRow>>(
    `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE tenant_id = $1 AND category_id = $2 FOR UPDATE`,
    [categoryId],
  );
  return rows[0] === undefined ? undefined : withArchivedAt(rows[0]);
}

export async function updateCategory(repo: TenantLevelRepository, row: CategoryRow, now: number): Promise<CategoryRow> {
  const rows = await repo.query<Raw<CategoryRow>>(
    `UPDATE categories SET name = $3, sort_order = $4, archived_at = $5, updated_at = $6
      WHERE tenant_id = $1 AND category_id = $2
      RETURNING ${CATEGORY_COLUMNS}`,
    [row.category_id, row.name, row.sort_order, row.archived_at, now],
  );
  return withArchivedAt(rows[0]!);
}

// S22: active items of a tax class or a category (indexes menu_items_tax_class, menu_items_category).
export async function activeItemIdsWith(
  repo: TenantLevelRepository,
  column: 'tax_class_id' | 'category_id',
  id: string,
): Promise<string[]> {
  const rows = await repo.query<{ item_id: string }>(
    `SELECT item_id FROM menu_items WHERE tenant_id = $1 AND ${column} = $2 AND archived_at IS NULL ORDER BY item_id`,
    [id],
  );
  return rows.map((row) => row.item_id);
}

export type Unit = 'piece' | 'g' | 'ml';

export interface MenuItemRow {
  item_id: string;
  category_id: string;
  tax_class_id: string | null;
  name: string;
  group_label: string | null;
  variant_group_id: string | null;
  variant_name: string | null;
  description: string | null;
  sort_order: number;
  price_minor: number;
  serve_mode: 'immediate' | 'sync';
  prep_buffer_ms: number;
  cook_time_ms: number;
  stock_time_ms: number | null;
  out_of_stock_behaviour: 'cook_fresh' | 'sold_out';
  stock_unit: Unit;
  sale_unit: Unit;
  stock_per_sale_unit: number;
  low_stock_threshold: number | null;
  carries_over: boolean;
  requires_weighing: boolean;
  archived_at: number | null;
}

// 01c V4: how many stock units one sale unit of the item uses.
export interface DrawRow {
  stock_item_id: string;
  quantity_per_sale_unit: number;
}

export interface RouteRow {
  branch_id: string;
  station_id: string;
  program_id: string | null;
  stock_program_id: string | null;
  price_minor_override: number | null;
}

const ROUTE_COLUMNS = 'branch_id, station_id, program_id, stock_program_id, price_minor_override';

const MENU_ITEM_COLUMNS =
  'item_id, category_id, tax_class_id, name, group_label, variant_group_id, variant_name, description, sort_order, ' +
  'price_minor, serve_mode, prep_buffer_ms, cook_time_ms, stock_time_ms, out_of_stock_behaviour, stock_unit, sale_unit, ' +
  'stock_per_sale_unit, low_stock_threshold, carries_over, requires_weighing, archived_at';

// 01c §6 lock order 3: an item's variant group FOR SHARE (§6.4 reference), with what §3.3 checks against.
export async function shareVariantGroup(
  repo: TenantLevelRepository,
  variantGroupId: string,
): Promise<{ category_id: string; archived_at: number | null } | undefined> {
  const rows = await repo.query<{ category_id: string; archived_at: string | null }>(
    `SELECT category_id, archived_at FROM variant_groups WHERE tenant_id = $1 AND variant_group_id = $2 FOR SHARE`,
    [variantGroupId],
  );
  return rows[0] === undefined ? undefined : { category_id: rows[0].category_id, archived_at: msOrNull(rows[0].archived_at) };
}

// 01c §6 lock order 3 (§6.5, M3): the item's stored and merged variant groups FOR SHARE in one statement, ids
// ascending, before the item lock. An unknown id is simply not returned.
export async function shareVariantGroups(
  repo: TenantLevelRepository,
  variantGroupIds: readonly string[],
): Promise<Array<{ variant_group_id: string; category_id: string; archived_at: number | null }>> {
  const rows = await repo.query<{ variant_group_id: string; category_id: string; archived_at: string | null }>(
    `SELECT variant_group_id, category_id, archived_at FROM variant_groups
      WHERE tenant_id = $1 AND variant_group_id = ANY($2)
      ORDER BY variant_group_id
      FOR SHARE`,
    [variantGroupIds],
  );
  return rows.map((row) => ({ variant_group_id: row.variant_group_id, category_id: row.category_id, archived_at: msOrNull(row.archived_at) }));
}

// 01c §6 lock order 5: a draw's stock item FOR SHARE (§6.4 reference), with its unit for the V4 rule.
export async function shareStockItem(
  repo: TenantLevelRepository,
  stockItemId: string,
): Promise<{ stock_unit: Unit; archived_at: number | null } | undefined> {
  const rows = await repo.query<{ stock_unit: Unit; archived_at: string | null }>(
    `SELECT stock_unit, archived_at FROM stock_items WHERE tenant_id = $1 AND stock_item_id = $2 FOR SHARE`,
    [stockItemId],
  );
  return rows[0] === undefined ? undefined : { stock_unit: rows[0].stock_unit, archived_at: msOrNull(rows[0].archived_at) };
}

// 01c §6.3 statement 8 (and the item write's response): the items' draws, = ANY($ids), by item, then stock item.
export async function selectDrawsOf(
  repo: TenantLevelRepository,
  itemIds: string[],
): Promise<Array<DrawRow & { item_id: string }>> {
  return repo.query<DrawRow & { item_id: string }>(
    `SELECT item_id, stock_item_id, quantity_per_sale_unit FROM stock_draws
      WHERE tenant_id = $1 AND item_id = ANY($2)
      ORDER BY item_id, stock_item_id`,
    [itemIds],
  );
}

// 01c §6.4: an item's draws in one multi-row INSERT (pilot: at most one), returned by stock item.
export async function insertDraws(repo: TenantLevelRepository, itemId: string, draws: DrawRow[]): Promise<DrawRow[]> {
  const rows = await repo.query<DrawRow>(
    `INSERT INTO stock_draws (tenant_id, item_id, stock_item_id, quantity_per_sale_unit)
     SELECT t.tenant_id, $2, u.stock_item_id, u.quantity_per_sale_unit
       FROM tenants t, unnest($3::text[], $4::int[]) AS u (stock_item_id, quantity_per_sale_unit)
      WHERE t.tenant_id = $1
     RETURNING stock_item_id, quantity_per_sale_unit`,
    [itemId, draws.map((d) => d.stock_item_id), draws.map((d) => d.quantity_per_sale_unit)],
  );
  return rows.sort((a, b) => (a.stock_item_id < b.stock_item_id ? -1 : a.stock_item_id > b.stock_item_id ? 1 : 0));
}

// Reference checks (§6.14): FOR SHARE against a concurrent archive.
export async function shareCategory(repo: TenantLevelRepository, categoryId: string): Promise<{ archived_at: number | null } | undefined> {
  const rows = await repo.query<{ archived_at: string | null }>(
    `SELECT archived_at FROM categories WHERE tenant_id = $1 AND category_id = $2 FOR SHARE`,
    [categoryId],
  );
  return rows[0] === undefined ? undefined : { archived_at: msOrNull(rows[0].archived_at) };
}

export async function shareTaxClass(repo: TenantLevelRepository, taxClassId: string): Promise<{ archived_at: number | null } | undefined> {
  const rows = await repo.query<{ archived_at: string | null }>(
    `SELECT archived_at FROM tax_classes WHERE tenant_id = $1 AND tax_class_id = $2 FOR SHARE`,
    [taxClassId],
  );
  return rows[0] === undefined ? undefined : { archived_at: msOrNull(rows[0].archived_at) };
}

// The routes' stations in any of the caller's branches (so another branch's station is told apart as
// wrong_branch), one statement, locked in id order (S8).
export async function shareStationsById(
  repo: TenantScopedRepository,
  stationIds: string[],
): Promise<Array<{ branch_id: string; station_id: string; station_type: StationType; archived_at: number | null }>> {
  type Shared = { branch_id: string; station_id: string; station_type: StationType; archived_at: number | null };
  const rows = await repo.query<Raw<Shared>>(
    `SELECT branch_id, station_id, station_type, archived_at FROM stations
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND station_id = ANY($3)
      ORDER BY station_id, branch_id
      FOR SHARE`,
    [stationIds],
  );
  return rows.map((row) => withArchivedAt<Shared>(row));
}

export async function shareProgramsById(
  repo: TenantScopedRepository,
  programIds: string[],
): Promise<Array<{ branch_id: string; station_id: string; program_id: string; archived_at: number | null }>> {
  type Shared = { branch_id: string; station_id: string; program_id: string; archived_at: number | null };
  const rows = await repo.query<Raw<Shared>>(
    `SELECT branch_id, station_id, program_id, archived_at FROM batch_programs
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND program_id = ANY($3)
      ORDER BY program_id, branch_id
      FOR SHARE`,
    [programIds],
  );
  return rows.map((row) => withArchivedAt<Shared>(row));
}

export async function insertMenuItem(
  repo: TenantLevelRepository,
  item: Omit<MenuItemRow, 'archived_at'>,
  now: number,
): Promise<MenuItemRow> {
  const rows = await repo.query<Raw<MenuItemRow> & { price_minor: string }>(
    `INSERT INTO menu_items (tenant_id, item_id, category_id, tax_class_id, name, group_label, variant_group_id, variant_name,
                             description, sort_order, price_minor, serve_mode, prep_buffer_ms, cook_time_ms, stock_time_ms,
                             out_of_stock_behaviour, stock_unit, sale_unit, stock_per_sale_unit, low_stock_threshold,
                             carries_over, requires_weighing, created_at, updated_at)
     SELECT tenant_id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $23
       FROM tenants WHERE tenant_id = $1
     RETURNING ${MENU_ITEM_COLUMNS}`,
    [
      item.item_id,
      item.category_id,
      item.tax_class_id,
      item.name,
      item.group_label,
      item.variant_group_id,
      item.variant_name,
      item.description,
      item.sort_order,
      item.price_minor,
      item.serve_mode,
      item.prep_buffer_ms,
      item.cook_time_ms,
      item.stock_time_ms,
      item.out_of_stock_behaviour,
      item.stock_unit,
      item.sale_unit,
      item.stock_per_sale_unit,
      item.low_stock_threshold,
      item.carries_over,
      item.requires_weighing,
      now,
    ],
  );
  return menuItemRow(rows[0]!);
}

// 01c §6.5 restart rule (N2): the item read without a lock, so its variant group(s) can be locked before it.
export async function readMenuItem(repo: TenantLevelRepository, itemId: string): Promise<MenuItemRow | undefined> {
  const rows = await repo.query<Raw<MenuItemRow> & { price_minor: string }>(
    `SELECT ${MENU_ITEM_COLUMNS} FROM menu_items WHERE tenant_id = $1 AND item_id = $2`,
    [itemId],
  );
  return rows[0] === undefined ? undefined : menuItemRow(rows[0]);
}

export async function lockMenuItem(repo: TenantLevelRepository, itemId: string): Promise<MenuItemRow | undefined> {
  const rows = await repo.query<Raw<MenuItemRow> & { price_minor: string }>(
    `SELECT ${MENU_ITEM_COLUMNS} FROM menu_items WHERE tenant_id = $1 AND item_id = $2 FOR UPDATE`,
    [itemId],
  );
  return rows[0] === undefined ? undefined : menuItemRow(rows[0]);
}

export async function updateMenuItem(repo: TenantLevelRepository, item: MenuItemRow, now: number): Promise<MenuItemRow> {
  const rows = await repo.query<Raw<MenuItemRow> & { price_minor: string }>(
    `UPDATE menu_items SET category_id = $3, tax_class_id = $4, name = $5, group_label = $6, description = $7,
                           sort_order = $8, price_minor = $9, serve_mode = $10, prep_buffer_ms = $11, cook_time_ms = $12,
                           stock_time_ms = $13, out_of_stock_behaviour = $14, stock_unit = $15, sale_unit = $16,
                           stock_per_sale_unit = $17, low_stock_threshold = $18, carries_over = $19, archived_at = $20,
                           updated_at = $21, variant_group_id = $22, variant_name = $23
      WHERE tenant_id = $1 AND item_id = $2
      RETURNING ${MENU_ITEM_COLUMNS}`,
    [
      item.item_id,
      item.category_id,
      item.tax_class_id,
      item.name,
      item.group_label,
      item.description,
      item.sort_order,
      item.price_minor,
      item.serve_mode,
      item.prep_buffer_ms,
      item.cook_time_ms,
      item.stock_time_ms,
      item.out_of_stock_behaviour,
      item.stock_unit,
      item.sale_unit,
      item.stock_per_sale_unit,
      item.low_stock_threshold,
      item.carries_over,
      item.archived_at,
      now,
      item.variant_group_id,
      item.variant_name,
    ],
  );
  return menuItemRow(rows[0]!);
}

// One multi-row INSERT through the caller's branch rows (§6.14 query count); returned by branch_id.
export async function insertItemRoutes(
  repo: TenantScopedRepository,
  itemId: string,
  routes: RouteRow[],
  now: number,
): Promise<RouteRow[]> {
  const raw = await repo.query<RawRoute>(
    `INSERT INTO item_routes (tenant_id, branch_id, item_id, station_id, program_id, stock_program_id,
       price_minor_override, updated_at)
     SELECT b.tenant_id, b.branch_id, $3, u.station_id, u.program_id, u.stock_program_id, u.price_minor_override, $4
       FROM unnest($5::text[], $6::text[], $7::text[], $8::text[], $9::bigint[])
              AS u (branch_id, station_id, program_id, stock_program_id, price_minor_override)
       JOIN branches b ON b.tenant_id = $1 AND b.branch_id = ANY($2) AND b.branch_id = u.branch_id
     RETURNING ${ROUTE_COLUMNS}`,
    [
      itemId,
      now,
      routes.map((r) => r.branch_id),
      routes.map((r) => r.station_id),
      routes.map((r) => r.program_id),
      routes.map((r) => r.stock_program_id),
      routes.map((r) => r.price_minor_override),
    ],
  );
  const rows = raw.map(routeRow);
  return rows.sort((a, b) => (a.branch_id < b.branch_id ? -1 : a.branch_id > b.branch_id ? 1 : 0));
}

// §6.16: the item's route at one branch, locked (the route is the PUT's target row).
export async function lockItemRoute(repo: TenantScopedRepository, branchId: string, itemId: string): Promise<RouteRow | undefined> {
  const rows = await repo.query<RawRoute>(
    `SELECT ${ROUTE_COLUMNS} FROM item_routes
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND item_id = $4
      FOR UPDATE`,
    [branchId, itemId],
  );
  return rows[0] === undefined ? undefined : routeRow(rows[0]);
}

// §6.16: idempotent replace of the one route, inserted through the branch row.
export async function upsertItemRoute(repo: TenantScopedRepository, itemId: string, route: RouteRow, now: number): Promise<RouteRow> {
  const rows = await repo.query<RawRoute>(
    `INSERT INTO item_routes (tenant_id, branch_id, item_id, station_id, program_id, stock_program_id,
       price_minor_override, updated_at)
     SELECT tenant_id, branch_id, $4, $5, $6, $7, $8, $9 FROM branches
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3
     ON CONFLICT (tenant_id, branch_id, item_id) DO UPDATE
       SET station_id = EXCLUDED.station_id, program_id = EXCLUDED.program_id,
           stock_program_id = EXCLUDED.stock_program_id, price_minor_override = EXCLUDED.price_minor_override,
           updated_at = EXCLUDED.updated_at
     RETURNING ${ROUTE_COLUMNS}`,
    [route.branch_id, itemId, route.station_id, route.program_id, route.stock_program_id, route.price_minor_override, now],
  );
  return routeRow(rows[0]!);
}

export async function deleteItemRoute(repo: TenantScopedRepository, branchId: string, itemId: string): Promise<void> {
  await repo.query(
    `DELETE FROM item_routes WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND item_id = $4`,
    [branchId, itemId],
  );
}

// S26 rows of one write in one multi-row INSERT (§6.14: "1 audit insert" for the item and its routes).
export async function insertConfigAuditRows(
  repo: TenantLevelRepository,
  entries: AuditEntry[],
  deps: { clock: Clock; ids: IdGen },
): Promise<void> {
  const at = deps.clock.branchNow();
  await repo.query(
    `INSERT INTO config_audit
       (tenant_id, audit_id, actor_kind, actor_owner_user_id, branch_id, entity, entity_id, action, before, after, at)
     SELECT t.tenant_id, u.audit_id, u.actor_kind, u.actor_owner_user_id, u.branch_id, u.entity, u.entity_id, u.action,
            u.before::jsonb, u.after::jsonb, $11
       FROM tenants t,
            unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[])
              AS u (audit_id, actor_kind, actor_owner_user_id, branch_id, entity, entity_id, action, before, after)
      WHERE t.tenant_id = $1`,
    [
      entries.map(() => deps.ids.next()),
      entries.map((e) => e.actor.kind),
      entries.map((e) => (e.actor.kind === 'owner' ? e.actor.ownerUserId : null)),
      entries.map((e) => e.branchId),
      entries.map((e) => e.entity),
      entries.map((e) => e.entityId),
      entries.map((e) => e.action),
      entries.map((e) => (e.before === null ? null : JSON.stringify(e.before))),
      entries.map((e) => (e.after === null ? null : JSON.stringify(e.after))),
      at,
    ],
  );
}

export interface WindowRow {
  start_ms: number;
  end_ms: number;
}

// §6.11 statement 2: every tax class, archived included, by name, then id.
export async function selectAllTaxClasses(repo: TenantLevelRepository): Promise<TaxClassRow[]> {
  const rows = await repo.query<Raw<TaxClassRow>>(
    `SELECT ${TAX_CLASS_COLUMNS} FROM tax_classes WHERE tenant_id = $1 ORDER BY name, tax_class_id`,
  );
  return rows.map(withArchivedAt);
}

// §6.11 statement 3: every category with its windows in one statement (S47 window order).
export async function selectAllCategories(
  repo: TenantLevelRepository,
): Promise<Array<CategoryRow & { availability_windows: WindowRow[] }>> {
  const rows = await repo.query<Raw<CategoryRow> & { start_ms: number | null; end_ms: number | null }>(
    `SELECT c.category_id, c.name, c.sort_order, c.archived_at, w.start_ms, w.end_ms
       FROM categories c
       LEFT JOIN availability_windows w ON w.tenant_id = c.tenant_id AND w.category_id = c.category_id
      WHERE c.tenant_id = $1
      ORDER BY c.sort_order, c.category_id, w.start_ms, w.end_ms, w.window_id`,
  );
  const out: Array<CategoryRow & { availability_windows: WindowRow[] }> = [];
  for (const row of rows) {
    let category = out.at(-1);
    if (category === undefined || category.category_id !== row.category_id) {
      category = {
        category_id: row.category_id,
        name: row.name,
        sort_order: row.sort_order,
        archived_at: msOrNull(row.archived_at),
        availability_windows: [],
      };
      out.push(category);
    }
    if (row.start_ms !== null && row.end_ms !== null) category.availability_windows.push({ start_ms: row.start_ms, end_ms: row.end_ms });
  }
  return out;
}

// 01c §6.3: every variant group, archived included, with every member's id (archived members included, AD-8),
// in one statement, by sort_order, then id.
export async function selectAllVariantGroups(repo: TenantLevelRepository): Promise<VariantGroupRow[]> {
  return repo.query<VariantGroupRow>(
    `SELECT g.variant_group_id, g.name, g.category_id, g.description, g.sort_order, g.archived_at,
            COALESCE(array_agg(m.item_id ORDER BY m.item_id) FILTER (WHERE m.item_id IS NOT NULL), '{}') AS member_ids
       FROM variant_groups g
       LEFT JOIN menu_items m ON m.tenant_id = g.tenant_id AND m.variant_group_id = g.variant_group_id
      WHERE g.tenant_id = $1
      GROUP BY g.tenant_id, g.variant_group_id
      ORDER BY g.sort_order, g.variant_group_id`,
  );
}

// §6.11 statement 4: one keyset page by (lower(name), item_id) (index menu_items_name_order), limit + 1 rows;
// q matches the item's name or its variant group's name (01c §6.3).
export async function selectMenuPage(
  repo: TenantLevelRepository,
  o: { archived: boolean; categoryId: string | null; pattern: string | null; after: { n: string; id: string } | null; limit: number },
): Promise<Array<{ item: MenuItemRow; sortName: string }>> {
  const rows = await repo.query<Raw<MenuItemRow> & { price_minor: string; sort_name: string }>(
    `SELECT ${MENU_ITEM_COLUMNS}, lower(name) AS sort_name FROM menu_items
      WHERE tenant_id = $1
        AND (archived_at IS NOT NULL) = $2
        AND ($3::text IS NULL OR category_id = $3)
        AND ($4::text IS NULL OR name ILIKE $4 ESCAPE '\\' OR variant_group_id IN (
              SELECT variant_group_id FROM variant_groups WHERE tenant_id = $1 AND name ILIKE $4 ESCAPE '\\'))
        AND ($5::text IS NULL OR (lower(name), item_id) > ($5, $6::text))
      ORDER BY lower(name), item_id
      LIMIT $7`,
    [o.archived, o.categoryId, o.pattern, o.after?.n ?? null, o.after?.id ?? null, o.limit + 1],
  );
  return rows.map(({ sort_name, ...row }) => ({ item: menuItemRow(row), sortName: sort_name }));
}

// §6.11 statement 5: the page items' windows, = ANY($ids).
export async function selectItemWindows(
  repo: TenantLevelRepository,
  itemIds: string[],
): Promise<Array<WindowRow & { item_id: string }>> {
  return repo.query<WindowRow & { item_id: string }>(
    `SELECT item_id, start_ms, end_ms FROM availability_windows
      WHERE tenant_id = $1 AND item_id = ANY($2)
      ORDER BY start_ms, end_ms, window_id`,
    [itemIds],
  );
}

// §6.11 statement 6: the page items' routes in the caller's branches only, = ANY($ids).
export async function selectItemRoutes(
  repo: TenantScopedRepository,
  itemIds: string[],
): Promise<Array<RouteRow & { item_id: string }>> {
  const rows = await repo.query<RawRoute & { item_id: string }>(
    `SELECT item_id, ${ROUTE_COLUMNS} FROM item_routes
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND item_id = ANY($3)
      ORDER BY item_id, branch_id`,
    [itemIds],
  );
  return rows.map((row) => ({ ...routeRow(row), item_id: row.item_id }));
}

export type WindowTarget = { item_id: string } | { category_id: string };

// S47: a target's windows, by start_ms, end_ms, window_id.
export async function selectWindowsOf(repo: TenantLevelRepository, target: WindowTarget): Promise<WindowRow[]> {
  const [column, id] = 'item_id' in target ? ['item_id', target.item_id] : ['category_id', target.category_id];
  return repo.query<WindowRow>(
    `SELECT start_ms, end_ms FROM availability_windows
      WHERE tenant_id = $1 AND ${column} = $2
      ORDER BY start_ms, end_ms, window_id`,
    [id],
  );
}

// §6.13–6.15: a PATCH with availability_windows deletes the target's rows ...
export async function deleteWindowsOf(repo: TenantLevelRepository, target: WindowTarget): Promise<void> {
  const [column, id] = 'item_id' in target ? ['item_id', target.item_id] : ['category_id', target.category_id];
  await repo.query(`DELETE FROM availability_windows WHERE tenant_id = $1 AND ${column} = $2`, [id]);
}

// ... and inserts the new set in one multi-row INSERT; returned by start_ms, end_ms, window_id.
export async function insertWindows(
  repo: TenantLevelRepository,
  target: WindowTarget,
  windows: WindowRow[],
  ids: IdGen,
): Promise<WindowRow[]> {
  const rows = await repo.query<WindowRow & { window_id: string }>(
    `INSERT INTO availability_windows (tenant_id, window_id, item_id, category_id, start_ms, end_ms)
     SELECT t.tenant_id, u.window_id, $2, $3, u.start_ms, u.end_ms
       FROM tenants t, unnest($4::text[], $5::int[], $6::int[]) AS u (window_id, start_ms, end_ms)
      WHERE t.tenant_id = $1
     RETURNING window_id, start_ms, end_ms`,
    [
      'item_id' in target ? target.item_id : null,
      'category_id' in target ? target.category_id : null,
      windows.map(() => ids.next()),
      windows.map((w) => w.start_ms),
      windows.map((w) => w.end_ms),
    ],
  );
  return rows
    .sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms || (a.window_id < b.window_id ? -1 : 1))
    .map(({ start_ms, end_ms }) => ({ start_ms, end_ms }));
}

type RawRoute = Omit<RouteRow, 'price_minor_override'> & { price_minor_override: string | null };

// BIGINT arrives as a string (S57)
function routeRow(row: RawRoute): RouteRow {
  return {
    branch_id: row.branch_id,
    station_id: row.station_id,
    program_id: row.program_id,
    stock_program_id: row.stock_program_id,
    price_minor_override: row.price_minor_override === null ? null : Number(row.price_minor_override),
  };
}

function menuItemRow(row: Raw<MenuItemRow> & { price_minor: string }): MenuItemRow {
  // BIGINT arrives as a string
  return { ...row, price_minor: Number(row.price_minor), archived_at: msOrNull(row.archived_at) };
}

function withArchivedAt<T extends { archived_at: number | null }>(row: Raw<T>): T {
  return { ...row, archived_at: msOrNull(row.archived_at) } as T;
}

function tableRow(row: Raw<TableRow>): TableRow {
  return { ...row, archived_at: msOrNull(row.archived_at) };
}

function floorRow(row: Raw<FloorRow>): FloorRow {
  return { ...row, archived_at: msOrNull(row.archived_at) };
}

function msOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}
