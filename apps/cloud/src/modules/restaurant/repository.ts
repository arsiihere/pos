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

type Raw<T> = { [K in keyof T]: K extends 'archived_at' ? string | null : T[K] };

const FLOOR_COLUMNS = 'floor_id, name, sort_order, archived_at';
const TABLE_COLUMNS = 'table_id, floor_id, name, seats, sort_order, archived_at';

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

function tableRow(row: Raw<TableRow>): TableRow {
  return { ...row, archived_at: msOrNull(row.archived_at) };
}

function floorRow(row: Raw<FloorRow>): FloorRow {
  return { ...row, archived_at: msOrNull(row.archived_at) };
}

function msOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}
