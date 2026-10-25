import type { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import type { TenantScopedRepository } from '../../db/tenant-scoped-repository.js';

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
