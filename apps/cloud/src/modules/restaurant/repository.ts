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
  zone_id: string | null;
  name: string;
  seats: number | null;
  sort_order: number;
  archived_at: number | null;
}

// 01a v2.2 §5.2 (02a A-1): a zone inside a floor.
export interface ZoneRow {
  zone_id: string;
  floor_id: string;
  name: string;
  sort_order: number;
  archived_at: number | null;
}

// 01a v2.3 §5.2 (02b A-1): the zone's two whole lists.
export interface ZoneRouteRow {
  item_id: string;
  station_id: string;
}
export interface ZoneStockItemRow {
  item_id: string;
  threshold: number;
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
  point_id: string;
  policy: 'waada_guard' | 'edf' | 'fifo';
  freeze_ms: number;
  min_slack_keep_ms: number;
  promise_padding_ms: number | null;
  pressure_window_ms: number;
  pressure_amber_bp: number;
  pressure_red_bp: number;
  pressure_alert_ms: number;
  pause_enabled: boolean;
  lane_units: number | null;
  reserve_units: number;
}

export type OrderType = 'dine_in' | 'takeaway' | 'delivery' | 'parking';

// 01a §5.2a A-9, A-10: the station's replace-lists.
export interface StationLists {
  alternates: Array<{ alternate_station_id: string; order_types: OrderType[]; home_for_order_types: OrderType[] }>;
  carry_times: Array<{ point_id: string; carry_ms: number }>;
}

export type StationWithLists = StationRow & StationLists;

export interface PointRow {
  point_id: string;
  name: string;
  sort_order: number;
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
const TABLE_COLUMNS = 'table_id, floor_id, zone_id, name, seats, sort_order, archived_at';
const ZONE_COLUMNS = 'zone_id, floor_id, name, sort_order, archived_at';
const POINT_COLUMNS = 'point_id, name, sort_order, archived_at';
const STATION_COLUMNS =
  'station_id, name, location_label, station_type, capacity, freshness_window_ms, completion_mode, archived_at, ' +
  'point_id, policy, freeze_ms, min_slack_keep_ms, promise_padding_ms, pressure_window_ms, pressure_amber_bp, ' +
  'pressure_red_bp, pressure_alert_ms, pause_enabled, lane_units, reserve_units';
// One station's lists as columns of a statement over `stations`. COLLATE "C": the order the service sorts in.
const STATION_LIST_COLUMNS = `
  COALESCE((SELECT json_agg(json_build_object('alternate_station_id', a.alternate_station_id, 'order_types', a.order_types,
                                              'home_for_order_types', a.home_for_order_types)
                            ORDER BY a.alternate_station_id COLLATE "C")
              FROM station_alternates a
             WHERE a.tenant_id = stations.tenant_id AND a.branch_id = stations.branch_id AND a.station_id = stations.station_id),
           '[]'::json) AS alternates,
  COALESCE((SELECT json_agg(json_build_object('point_id', c.point_id, 'carry_ms', c.carry_ms) ORDER BY c.point_id COLLATE "C")
              FROM carry_times c
             WHERE c.tenant_id = stations.tenant_id AND c.branch_id = stations.branch_id AND c.station_id = stations.station_id),
           '[]'::json) AS carry_times`;
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
  input: {
    branchId: string;
    tableId: string;
    floorId: string;
    zoneId: string | null;
    name: string;
    seats: number | null;
    sortOrder: number;
    now: number;
  },
): Promise<TableRow> {
  const rows = await repo.query<Raw<TableRow>>(
    `INSERT INTO dining_tables (tenant_id, branch_id, table_id, floor_id, zone_id, name, seats, sort_order, created_at, updated_at)
     SELECT tenant_id, branch_id, $4, $5, $6, $7, $8, $9, $10, $10 FROM branches
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3
     RETURNING ${TABLE_COLUMNS}`,
    [input.branchId, input.tableId, input.floorId, input.zoneId, input.name, input.seats, input.sortOrder, input.now],
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
    `UPDATE dining_tables SET floor_id = $5, zone_id = $6, name = $7, seats = $8, sort_order = $9, archived_at = $10,
                              updated_at = $11
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND table_id = $4
      RETURNING ${TABLE_COLUMNS}`,
    [branchId, table.table_id, table.floor_id, table.zone_id, table.name, table.seats, table.sort_order, table.archived_at, now],
  );
  return tableRow(rows[0]!);
}

// ---------------------------------------------------------------------------------------------------- zones

// §6.2 (02a A-1): the branch's zones, archived included; one statement, by sort order then id (as floors).
export async function selectZones(repo: TenantScopedRepository, branchId: string): Promise<ZoneRow[]> {
  const rows = await repo.query<Raw<ZoneRow>>(
    `SELECT ${ZONE_COLUMNS} FROM zones
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3
      ORDER BY sort_order, zone_id`,
    [branchId],
  );
  return rows.map(withArchivedAt<ZoneRow>);
}

// §6.4 (02a A-1): the floor's active zones (index zones_floor), for the archive refusal.
export async function activeZoneIds(repo: TenantScopedRepository, branchId: string, floorId: string): Promise<string[]> {
  const rows = await repo.query<{ zone_id: string }>(
    `SELECT zone_id FROM zones
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND floor_id = $4 AND archived_at IS NULL
      ORDER BY zone_id`,
    [branchId, floorId],
  );
  return rows.map((row) => row.zone_id);
}

// Inserts through the branch row, so a branch that does not exist inserts nothing.
export async function insertZone(
  repo: TenantScopedRepository,
  input: { branchId: string; zoneId: string; floorId: string; name: string; sortOrder: number; now: number },
): Promise<ZoneRow | undefined> {
  const rows = await repo.query<Raw<ZoneRow>>(
    `INSERT INTO zones (tenant_id, branch_id, zone_id, floor_id, name, sort_order, created_at, updated_at)
     SELECT tenant_id, branch_id, $4, $5, $6, $7, $8, $8 FROM branches
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3
     RETURNING ${ZONE_COLUMNS}`,
    [input.branchId, input.zoneId, input.floorId, input.name, input.sortOrder, input.now],
  );
  return rows[0] === undefined ? undefined : withArchivedAt<ZoneRow>(rows[0]);
}

export async function lockZone(repo: TenantScopedRepository, branchId: string, zoneId: string): Promise<ZoneRow | undefined> {
  const rows = await repo.query<Raw<ZoneRow>>(
    `SELECT ${ZONE_COLUMNS} FROM zones
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND zone_id = $4
      FOR UPDATE`,
    [branchId, zoneId],
  );
  return rows[0] === undefined ? undefined : withArchivedAt<ZoneRow>(rows[0]);
}

// The zone's name, sort order and archive time change; a zone never changes floor (§6.6b).
export async function updateZone(repo: TenantScopedRepository, branchId: string, zone: ZoneRow, now: number): Promise<ZoneRow> {
  const rows = await repo.query<Raw<ZoneRow>>(
    `UPDATE zones SET name = $5, sort_order = $6, archived_at = $7, updated_at = $8
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND zone_id = $4
      RETURNING ${ZONE_COLUMNS}`,
    [branchId, zone.zone_id, zone.name, zone.sort_order, zone.archived_at, now],
  );
  return withArchivedAt<ZoneRow>(rows[0]!);
}

// A plain read (no lock) of the zone's floor and archive time, for a table that keeps its zone: it must not lock the
// zone after the table, because a zone archive locks the zone first and then updates its tables.
export async function readZone(
  repo: TenantScopedRepository,
  zoneId: string,
): Promise<{ branch_id: string; floor_id: string; archived_at: number | null } | undefined> {
  type Read = { branch_id: string; floor_id: string; archived_at: number | null };
  const rows = await repo.query<Raw<Read>>(
    `SELECT branch_id, floor_id, archived_at FROM zones WHERE tenant_id = $1 AND branch_id = ANY($2) AND zone_id = $3`,
    [zoneId],
  );
  return rows[0] === undefined ? undefined : withArchivedAt<Read>(rows[0]);
}

// A reference check for a table's zone_id (§6.5, §6.6): the zone in any of the caller's branches, FOR SHARE against
// a concurrent archive (the zone archive locks the zone FOR UPDATE).
export async function shareZone(
  repo: TenantScopedRepository,
  zoneId: string,
): Promise<{ branch_id: string; floor_id: string; archived_at: number | null } | undefined> {
  type Shared = { branch_id: string; floor_id: string; archived_at: number | null };
  const rows = await repo.query<Raw<Shared>>(
    `SELECT branch_id, floor_id, archived_at FROM zones
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND zone_id = $3
      FOR SHARE`,
    [zoneId],
  );
  return rows[0] === undefined ? undefined : withArchivedAt<Shared>(rows[0]);
}

// AD-6 (§6.9, S22 style): the branch's active zones whose routes[] name the station. One plain read after the
// station lock; zone_item_routes has no station index, and a branch holds at most 200 rows per zone.
export async function activeZoneIdsRoutingStation(
  repo: TenantScopedRepository,
  branchId: string,
  stationId: string,
): Promise<string[]> {
  const rows = await repo.query<{ zone_id: string }>(
    `SELECT DISTINCT z.zone_id FROM zone_item_routes r
       JOIN zones z ON z.tenant_id = r.tenant_id AND z.branch_id = r.branch_id AND z.zone_id = r.zone_id AND z.archived_at IS NULL
      WHERE r.tenant_id = $1 AND r.branch_id = ANY($2) AND r.branch_id = $3 AND r.station_id = $4
      ORDER BY z.zone_id`,
    [branchId, stationId],
  );
  return rows.map((row) => row.zone_id);
}

// AD-6 (§6.15): the tenant's active zones whose routes[] or stock_items[] name the item (`stockOnly`: stock_items[]
// alone, for a change that only a stock item cannot take). One plain read after the item lock, two EXISTS per zone.
export async function activeZoneIdsNamingItem(
  repo: TenantLevelRepository,
  itemId: string,
  stockOnly: boolean,
): Promise<string[]> {
  const rows = await repo.query<{ zone_id: string }>(
    `SELECT z.zone_id FROM zones z
      WHERE z.tenant_id = $1 AND z.archived_at IS NULL
        AND (EXISTS (SELECT 1 FROM zone_stock_items s
                      WHERE s.tenant_id = z.tenant_id AND s.branch_id = z.branch_id AND s.zone_id = z.zone_id AND s.item_id = $2)
             OR (NOT $3::boolean AND EXISTS (SELECT 1 FROM zone_item_routes r
                      WHERE r.tenant_id = z.tenant_id AND r.branch_id = z.branch_id AND r.zone_id = z.zone_id AND r.item_id = $2)))
      ORDER BY z.zone_id`,
    [itemId, stockOnly],
  );
  return rows.map((row) => row.zone_id);
}

// §6.6b: the active tables of an archived zone fall back to the floor's implicit zone (index dining_tables_zone).
export async function clearZoneOfActiveTables(
  repo: TenantScopedRepository,
  branchId: string,
  zoneId: string,
  now: number,
): Promise<void> {
  await repo.query(
    `UPDATE dining_tables SET zone_id = NULL, updated_at = $5
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND zone_id = $4 AND archived_at IS NULL`,
    [branchId, zoneId, now],
  );
}

// §6.6a, §6.6b: the lists of the given zones, two statements for any number of zones; by item_id.
export async function selectZoneLists(
  repo: TenantScopedRepository,
  branchId: string,
  zoneIds: readonly string[],
): Promise<{ routes: Array<ZoneRouteRow & { zone_id: string }>; stock_items: Array<ZoneStockItemRow & { zone_id: string }> }> {
  const routes = await repo.query<ZoneRouteRow & { zone_id: string }>(
    `SELECT zone_id, item_id, station_id FROM zone_item_routes
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND zone_id = ANY($4)
      ORDER BY zone_id, item_id COLLATE "C"`,
    [branchId, zoneIds],
  );
  const stockItems = await repo.query<ZoneStockItemRow & { zone_id: string }>(
    `SELECT zone_id, item_id, threshold FROM zone_stock_items
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND zone_id = ANY($4)
      ORDER BY zone_id, item_id COLLATE "C"`,
    [branchId, zoneIds],
  );
  return { routes, stock_items: stockItems };
}

// A replace-list is rewritten whole: delete the zone's rows, insert the sent ones (one statement each, any length).
export async function replaceZoneRoutes(
  repo: TenantScopedRepository,
  branchId: string,
  zoneId: string,
  routes: readonly ZoneRouteRow[],
): Promise<void> {
  await repo.query(
    `DELETE FROM zone_item_routes WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND zone_id = $4`,
    [branchId, zoneId],
  );
  if (routes.length === 0) return;
  await repo.query(
    `INSERT INTO zone_item_routes (tenant_id, branch_id, zone_id, item_id, station_id)
     SELECT b.tenant_id, b.branch_id, $4, x.item_id, x.station_id
       FROM branches b
      CROSS JOIN jsonb_to_recordset($5::jsonb) AS x (item_id text, station_id text)
      WHERE b.tenant_id = $1 AND b.branch_id = ANY($2) AND b.branch_id = $3`,
    [branchId, zoneId, JSON.stringify(routes)],
  );
}

export async function replaceZoneStockItems(
  repo: TenantScopedRepository,
  branchId: string,
  zoneId: string,
  stockItems: readonly ZoneStockItemRow[],
): Promise<void> {
  await repo.query(
    `DELETE FROM zone_stock_items WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND zone_id = $4`,
    [branchId, zoneId],
  );
  if (stockItems.length === 0) return;
  await repo.query(
    `INSERT INTO zone_stock_items (tenant_id, branch_id, zone_id, item_id, threshold)
     SELECT b.tenant_id, b.branch_id, $4, x.item_id, x.threshold
       FROM branches b
      CROSS JOIN jsonb_to_recordset($5::jsonb) AS x (item_id text, threshold int)
      WHERE b.tenant_id = $1 AND b.branch_id = ANY($2) AND b.branch_id = $3`,
    [branchId, zoneId, JSON.stringify(stockItems)],
  );
}

// §6.8: stations with their lists, archived included; by name, then id (as in the snapshot). One statement, so the
// lists keep the GET at 3 (subqueries on the A-9, A-10 primary keys, one branch's rows).
export async function selectStations(repo: TenantScopedRepository, branchId: string): Promise<StationWithLists[]> {
  const rows = await repo.query<Raw<StationWithLists>>(
    `SELECT ${STATION_COLUMNS}, ${STATION_LIST_COLUMNS} FROM stations
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3
      ORDER BY name, station_id`,
    [branchId],
  );
  return rows.map((row) => withArchivedAt<StationWithLists>(row));
}

// §6.8 (A-1): the branch's points, archived included.
export async function selectPoints(repo: TenantScopedRepository, branchId: string): Promise<PointRow[]> {
  const rows = await repo.query<Raw<PointRow>>(
    `SELECT ${POINT_COLUMNS} FROM points
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3
      ORDER BY sort_order, point_id`,
    [branchId],
  );
  return rows.map((row) => withArchivedAt<PointRow>(row));
}

// §6.9a: a new point of the branch; undefined when the branch is gone.
export async function insertPoint(
  repo: TenantScopedRepository,
  input: { branchId: string; pointId: string; name: string; sortOrder: number; now: number },
): Promise<PointRow | undefined> {
  const rows = await repo.query<Raw<PointRow>>(
    `INSERT INTO points (tenant_id, branch_id, point_id, name, sort_order, created_at, updated_at)
     SELECT tenant_id, branch_id, $4, $5, $6, $7, $7 FROM branches
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3
     RETURNING ${POINT_COLUMNS}`,
    [input.branchId, input.pointId, input.name, input.sortOrder, input.now],
  );
  return rows[0] === undefined ? undefined : withArchivedAt<PointRow>(rows[0]);
}

export async function lockPoint(repo: TenantScopedRepository, branchId: string, pointId: string): Promise<PointRow | undefined> {
  const rows = await repo.query<Raw<PointRow>>(
    `SELECT ${POINT_COLUMNS} FROM points
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND point_id = $4
      FOR UPDATE`,
    [branchId, pointId],
  );
  return rows[0] === undefined ? undefined : withArchivedAt<PointRow>(rows[0]);
}

export async function updatePoint(repo: TenantScopedRepository, branchId: string, point: PointRow, now: number): Promise<PointRow> {
  const rows = await repo.query<Raw<PointRow>>(
    `UPDATE points SET name = $5, sort_order = $6, archived_at = $7, updated_at = $8
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND point_id = $4
      RETURNING ${POINT_COLUMNS}`,
    [branchId, point.point_id, point.name, point.sort_order, point.archived_at, now],
  );
  return withArchivedAt<PointRow>(rows[0]!);
}

// Q-v2.1-2: the active stations naming the point (index stations_point). A plain read after the point's lock.
export async function activeStationIdsAtPoint(repo: TenantScopedRepository, branchId: string, pointId: string): Promise<string[]> {
  const rows = await repo.query<{ station_id: string }>(
    `SELECT station_id FROM stations
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND point_id = $4 AND archived_at IS NULL
      ORDER BY station_id`,
    [branchId, pointId],
  );
  return rows.map((row) => row.station_id);
}

// §6.9: a locked station's lists, in a statement of their own: run after the lock, it sees what a write it waited for
// committed (a subquery in the locking statement would keep that statement's older snapshot).
export async function selectStationLists(
  repo: TenantScopedRepository,
  branchId: string,
  stationId: string,
): Promise<StationLists> {
  const rows = await repo.query<StationLists & { station_id: string }>(
    `SELECT station_id, ${STATION_LIST_COLUMNS} FROM stations
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND station_id = $4`,
    [branchId, stationId],
  );
  return { alternates: rows[0]!.alternates, carry_times: rows[0]!.carry_times };
}

// Ruling 1 (CL rulings, §6.9): the point a POST without point_id gets. FOR SHARE against a concurrent archive.
export async function shareDefaultPoint(repo: TenantScopedRepository, branchId: string): Promise<string | undefined> {
  const rows = await repo.query<{ point_id: string }>(
    `SELECT point_id FROM points
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND archived_at IS NULL
      ORDER BY name = 'Pass' DESC, sort_order, point_id
      LIMIT 1
      FOR SHARE`,
    [branchId],
  );
  return rows[0]?.point_id;
}

// §6.9 reference check: the named points of this branch, FOR SHARE in id order.
export async function sharePointsById(
  repo: TenantScopedRepository,
  branchId: string,
  pointIds: string[],
): Promise<Array<{ point_id: string; archived_at: number | null }>> {
  type Shared = { point_id: string; archived_at: number | null };
  const rows = await repo.query<Raw<Shared>>(
    `SELECT point_id, archived_at FROM points
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND point_id = ANY($4)
      ORDER BY point_id
      FOR SHARE`,
    [branchId, pointIds],
  );
  return rows.map((row) => withArchivedAt<Shared>(row));
}

export async function branchExists(repo: TenantScopedRepository, branchId: string): Promise<boolean> {
  const rows = await repo.query(`SELECT 1 FROM branches WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3`, [branchId]);
  return rows.length > 0;
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
                           freshness_window_ms, completion_mode, point_id, policy, freeze_ms, min_slack_keep_ms,
                           promise_padding_ms, pressure_window_ms, pressure_amber_bp, pressure_red_bp, pressure_alert_ms,
                           pause_enabled, lane_units, reserve_units, created_at, updated_at)
     SELECT tenant_id, branch_id, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $23
       FROM branches
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
      station.point_id,
      station.policy,
      station.freeze_ms,
      station.min_slack_keep_ms,
      station.promise_padding_ms,
      station.pressure_window_ms,
      station.pressure_amber_bp,
      station.pressure_red_bp,
      station.pressure_alert_ms,
      station.pause_enabled,
      station.lane_units,
      station.reserve_units,
      now,
    ],
  );
  return rows[0] === undefined ? undefined : withArchivedAt(rows[0]);
}

// §6.9 PATCH: the target and the alternates its body names, this branch only, FOR UPDATE in id order. S8 takes the
// target, then the references: two stations naming each other would deadlock on that order, so here one ordered
// statement takes both, and an alternate waits for a type change to it (and the reverse) as a reference must.
export async function lockStationsById(
  repo: TenantScopedRepository,
  branchId: string,
  stationIds: string[],
): Promise<StationRow[]> {
  const rows = await repo.query<Raw<StationRow>>(
    `SELECT ${STATION_COLUMNS} FROM stations
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND station_id = ANY($4)
      ORDER BY station_id
      FOR UPDATE`,
    [branchId, stationIds],
  );
  return rows.map((row) => withArchivedAt<StationRow>(row));
}

export async function updateStation(
  repo: TenantScopedRepository,
  branchId: string,
  station: StationRow,
  now: number,
): Promise<StationRow> {
  const rows = await repo.query<Raw<StationRow>>(
    `UPDATE stations SET name = $5, location_label = $6, station_type = $7, capacity = $8, freshness_window_ms = $9,
                         completion_mode = $10, archived_at = $11, point_id = $12, policy = $13, freeze_ms = $14,
                         min_slack_keep_ms = $15, promise_padding_ms = $16, pressure_window_ms = $17,
                         pressure_amber_bp = $18, pressure_red_bp = $19, pressure_alert_ms = $20, pause_enabled = $21,
                         lane_units = $22, reserve_units = $23, updated_at = $24
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
      station.point_id,
      station.policy,
      station.freeze_ms,
      station.min_slack_keep_ms,
      station.promise_padding_ms,
      station.pressure_window_ms,
      station.pressure_amber_bp,
      station.pressure_red_bp,
      station.pressure_alert_ms,
      station.pause_enabled,
      station.lane_units,
      station.reserve_units,
      now,
    ],
  );
  return withArchivedAt(rows[0]!);
}

// A-9: the rows are always rewritten whole, so `version` stays 1; no write compares it (CL-5).
export async function replaceAlternates(
  repo: TenantScopedRepository,
  branchId: string,
  stationId: string,
  alternates: StationLists['alternates'],
  now: number,
): Promise<void> {
  await repo.query(
    `DELETE FROM station_alternates WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND station_id = $4`,
    [branchId, stationId],
  );
  if (alternates.length === 0) return;
  await repo.query(
    `INSERT INTO station_alternates (tenant_id, branch_id, station_id, alternate_station_id, order_types,
                                     home_for_order_types, created_at, updated_at)
     SELECT b.tenant_id, b.branch_id, $4, x.alternate_station_id,
            ARRAY(SELECT jsonb_array_elements_text(x.order_types)),
            ARRAY(SELECT jsonb_array_elements_text(x.home_for_order_types)), $6, $6
       FROM branches b
      CROSS JOIN jsonb_to_recordset($5::jsonb) AS x (alternate_station_id text, order_types jsonb, home_for_order_types jsonb)
      WHERE b.tenant_id = $1 AND b.branch_id = ANY($2) AND b.branch_id = $3`,
    [branchId, stationId, JSON.stringify(alternates), now],
  );
}

export async function replaceCarryTimes(
  repo: TenantScopedRepository,
  branchId: string,
  stationId: string,
  carryTimes: StationLists['carry_times'],
  now: number,
): Promise<void> {
  await repo.query(
    `DELETE FROM carry_times WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND station_id = $4`,
    [branchId, stationId],
  );
  if (carryTimes.length === 0) return;
  await repo.query(
    `INSERT INTO carry_times (tenant_id, branch_id, station_id, point_id, carry_ms, created_at, updated_at)
     SELECT b.tenant_id, b.branch_id, $4, x.point_id, x.carry_ms, $7, $7
       FROM branches b
      CROSS JOIN unnest($5::text[], $6::int[]) AS x (point_id, carry_ms)
      WHERE b.tenant_id = $1 AND b.branch_id = ANY($2) AND b.branch_id = $3`,
    [branchId, stationId, carryTimes.map((row) => row.point_id), carryTimes.map((row) => row.carry_ms), now],
  );
}

// Ruling 5: the stations whose alternates name this one. The branch's rows of the A-9 primary key: a small read.
export async function stationsNamingAlternate(
  repo: TenantScopedRepository,
  branchId: string,
  stationId: string,
): Promise<string[]> {
  const rows = await repo.query<{ station_id: string }>(
    `SELECT station_id FROM station_alternates
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND alternate_station_id = $4
      ORDER BY station_id`,
    [branchId, stationId],
  );
  return rows.map((row) => row.station_id);
}

// A-9: the active stations whose alternates name this one. A plain read after the station lock.
export async function activeStationsNamingAlternate(
  repo: TenantScopedRepository,
  branchId: string,
  stationId: string,
): Promise<string[]> {
  const rows = await repo.query<{ station_id: string }>(
    `SELECT sa.station_id FROM station_alternates sa
       JOIN stations s ON s.tenant_id = sa.tenant_id AND s.branch_id = sa.branch_id AND s.station_id = sa.station_id
      WHERE sa.tenant_id = $1 AND sa.branch_id = ANY($2) AND sa.branch_id = $3 AND sa.alternate_station_id = $4
        AND s.archived_at IS NULL
      ORDER BY sa.station_id`,
    [branchId, stationId],
  );
  return rows.map((row) => row.station_id);
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

// 01c V16 (P-10): the active stock items counted at the station (index stock_item_branches_station); a row of an
// archived stock item does not block. A plain read after the station lock.
export async function activeStockItemIdsAt(repo: TenantScopedRepository, branchId: string, stationId: string): Promise<string[]> {
  const rows = await repo.query<{ stock_item_id: string }>(
    `SELECT sb.stock_item_id FROM stock_item_branches sb
       JOIN stock_items s ON s.tenant_id = sb.tenant_id AND s.stock_item_id = sb.stock_item_id AND s.archived_at IS NULL
      WHERE sb.tenant_id = $1 AND sb.branch_id = ANY($2) AND sb.branch_id = $3 AND sb.station_id = $4
      ORDER BY sb.stock_item_id`,
    [branchId, stationId],
  );
  return rows.map((row) => row.stock_item_id);
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

// 01c §6.5 R4, R10 (V16, m15, P1): the active groups with an active option linking the item. One plain read, no lock.
export async function linkingGroupIds(repo: TenantLevelRepository, itemId: string): Promise<string[]> {
  const rows = await repo.query<{ modifier_group_id: string }>(
    `SELECT DISTINCT o.modifier_group_id FROM modifier_options o
       JOIN modifier_groups g ON g.tenant_id = o.tenant_id AND g.modifier_group_id = o.modifier_group_id
      WHERE o.tenant_id = $1 AND o.linked_item_id = $2 AND o.archived_at IS NULL AND g.archived_at IS NULL
      ORDER BY o.modifier_group_id`,
    [itemId],
  );
  return rows.map((row) => row.modifier_group_id);
}

// 01c §6.5 R4 (V16): the active deals with an active part offering the item (AD-11: parts of archived deals do not
// count; R8, task 30, reuses this read). One plain read, no lock.
export async function offeringDealIds(repo: TenantLevelRepository, itemId: string): Promise<string[]> {
  const rows = await repo.query<{ deal_id: string }>(
    `SELECT DISTINCT p.deal_id FROM deal_part_choices c
       JOIN deal_parts p ON p.tenant_id = c.tenant_id AND p.deal_part_id = c.deal_part_id
       JOIN deals d ON d.tenant_id = p.tenant_id AND d.deal_id = p.deal_id AND d.archived_at IS NULL
      WHERE c.tenant_id = $1 AND c.item_id = $2 AND p.archived_at IS NULL
      ORDER BY p.deal_id`,
    [itemId],
  );
  return rows.map((row) => row.deal_id);
}

// 01c §6.5 R6 (D-3): the active deals (AD-11) with an active part offering the item whose other choices would not
// share the new sale_unit (the part would then mix units). One plain read over deal_part_choices_item, no lock.
export async function dealsBrokenBySaleUnit(repo: TenantLevelRepository, itemId: string, saleUnit: Unit): Promise<string[]> {
  const rows = await repo.query<{ deal_id: string }>(
    `SELECT DISTINCT p.deal_id FROM deal_part_choices c
       JOIN deal_parts p ON p.tenant_id = c.tenant_id AND p.deal_part_id = c.deal_part_id
       JOIN deals d ON d.tenant_id = p.tenant_id AND d.deal_id = p.deal_id AND d.archived_at IS NULL
       JOIN deal_part_choices other ON other.tenant_id = c.tenant_id AND other.deal_part_id = c.deal_part_id
        AND other.item_id <> c.item_id
       JOIN menu_items m ON m.tenant_id = other.tenant_id AND m.item_id = other.item_id
      WHERE c.tenant_id = $1 AND c.item_id = $2 AND p.archived_at IS NULL AND m.sale_unit <> $3
      ORDER BY p.deal_id`,
    [itemId, saleUnit],
  );
  return rows.map((row) => row.deal_id);
}

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
  is_ready_item: boolean;
  weight_pct: number;
  max_early_ms: number;
  max_carry_ms: number | null;
  max_late_ms: number | null;
  adjust_time_ms: number;
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
  'stock_per_sale_unit, low_stock_threshold, carries_over, requires_weighing, is_ready_item, ' +
  'weight_pct, max_early_ms, max_carry_ms, max_late_ms, adjust_time_ms, archived_at';

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

// 01c §6.5: stock_draws replaces the item's draws (delete + insert; the item is locked FOR UPDATE).
export async function deleteDrawsOf(repo: TenantLevelRepository, itemId: string): Promise<void> {
  await repo.query(`DELETE FROM stock_draws WHERE tenant_id = $1 AND item_id = $2`, [itemId]);
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
                             carries_over, requires_weighing, created_at, updated_at,
                             weight_pct, max_early_ms, max_carry_ms, max_late_ms, adjust_time_ms, is_ready_item)
     SELECT tenant_id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $23,
            $24, $25, $26, $27, $28, $29
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
      item.weight_pct,
      item.max_early_ms,
      item.max_carry_ms,
      item.max_late_ms,
      item.adjust_time_ms,
      item.is_ready_item,
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
                           updated_at = $21, variant_group_id = $22, variant_name = $23, requires_weighing = $24,
                           weight_pct = $25, max_early_ms = $26, max_carry_ms = $27, max_late_ms = $28, adjust_time_ms = $29,
                           is_ready_item = $30
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
      item.requires_weighing,
      item.weight_pct,
      item.max_early_ms,
      item.max_carry_ms,
      item.max_late_ms,
      item.adjust_time_ms,
      item.is_ready_item,
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

// A-13: the links a category or an item is the source of. Lists are ordered by (target_kind, target_id), byte order,
// so a read and the list a write has just stored answer alike.
export type GoesWithKind = 'category' | 'item';

export type GoesWithLinkRow = {
  source_kind: GoesWithKind;
  source_id: string;
  target_kind: GoesWithKind;
  target_id: string;
  excluded: boolean;
};

// §6.11: a source's list as one column, so the menu read keeps its statement count (index: the A-13 unique key).
function goesWithJson(kind: GoesWithKind, tenantId: string, sourceId: string): string {
  return `(SELECT COALESCE(json_agg(json_build_object('source_kind', l.source_kind, 'source_id', l.source_id,
                     'target_kind', l.target_kind, 'target_id', l.target_id, 'excluded', l.excluded)
                     ORDER BY l.target_kind, l.target_id COLLATE "C"), '[]'::json)
             FROM goes_with_links l
            WHERE l.tenant_id = ${tenantId} AND l.source_kind = '${kind}' AND l.source_id = ${sourceId})`;
}

export async function selectGoesWithOf(repo: TenantLevelRepository, kind: GoesWithKind, sourceId: string): Promise<GoesWithLinkRow[]> {
  return repo.query<GoesWithLinkRow>(
    `SELECT source_kind, source_id, target_kind, target_id, excluded FROM goes_with_links
      WHERE tenant_id = $1 AND source_kind = $2 AND source_id = $3
      ORDER BY target_kind, target_id COLLATE "C"`,
    [kind, sourceId],
  );
}

export async function deleteGoesWithOf(repo: TenantLevelRepository, kind: GoesWithKind, sourceId: string): Promise<void> {
  await repo.query(`DELETE FROM goes_with_links WHERE tenant_id = $1 AND source_kind = $2 AND source_id = $3`, [kind, sourceId]);
}

// One multi-row INSERT.
export async function insertGoesWith(
  repo: TenantLevelRepository,
  links: readonly GoesWithLinkRow[],
  ids: IdGen,
  now: number,
): Promise<void> {
  await repo.query(
    `INSERT INTO goes_with_links (tenant_id, link_id, source_kind, source_id, target_kind, target_id, excluded, created_at, updated_at)
     SELECT tenant_id, u.link_id, u.source_kind, u.source_id, u.target_kind, u.target_id, u.excluded, $2, $2
       FROM tenants, unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::boolean[])
            AS u (link_id, source_kind, source_id, target_kind, target_id, excluded)
      WHERE tenant_id = $1`,
    [
      now,
      links.map(() => ids.next()),
      links.map((l) => l.source_kind),
      links.map((l) => l.source_id),
      links.map((l) => l.target_kind),
      links.map((l) => l.target_id),
      links.map((l) => l.excluded),
    ],
  );
}

// A-13 target check, one statement, without a lock: a target archived a moment later is what the builder already
// handles (it drops links to inactive rows), and an item row locked here could break the 01c lock order.
export async function selectGoesWithTargets(
  repo: TenantLevelRepository,
  categoryIds: readonly string[],
  itemIds: readonly string[],
): Promise<Array<{ kind: GoesWithKind; id: string; archived_at: number | null }>> {
  const rows = await repo.query<{ kind: GoesWithKind; id: string; archived_at: string | null }>(
    `SELECT 'category' AS kind, category_id AS id, archived_at FROM categories WHERE tenant_id = $1 AND category_id = ANY($2)
     UNION ALL
     SELECT 'item' AS kind, item_id AS id, archived_at FROM menu_items WHERE tenant_id = $1 AND item_id = ANY($3)`,
    [categoryIds, itemIds],
  );
  return rows.map((row) => ({ ...row, archived_at: msOrNull(row.archived_at) }));
}

// §6.11 statement 3: every category with its windows and its goes_with list in one statement (S47 window order).
export async function selectAllCategories(
  repo: TenantLevelRepository,
): Promise<Array<CategoryRow & { availability_windows: WindowRow[]; goes_with: GoesWithLinkRow[] }>> {
  const rows = await repo.query<Raw<CategoryRow> & { start_ms: number | null; end_ms: number | null; goes_with: GoesWithLinkRow[] }>(
    `SELECT c.category_id, c.name, c.sort_order, c.archived_at, w.start_ms, w.end_ms,
            ${goesWithJson('category', 'c.tenant_id', 'c.category_id')} AS goes_with
       FROM categories c
       LEFT JOIN availability_windows w ON w.tenant_id = c.tenant_id AND w.category_id = c.category_id
      WHERE c.tenant_id = $1
      ORDER BY c.sort_order, c.category_id, w.start_ms, w.end_ms, w.window_id`,
  );
  const out: Array<CategoryRow & { availability_windows: WindowRow[]; goes_with: GoesWithLinkRow[] }> = [];
  for (const row of rows) {
    let category = out.at(-1);
    if (category === undefined || category.category_id !== row.category_id) {
      category = {
        category_id: row.category_id,
        name: row.name,
        sort_order: row.sort_order,
        archived_at: msOrNull(row.archived_at),
        availability_windows: [],
        goes_with: row.goes_with,
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
): Promise<Array<{ item: MenuItemRow; goesWith: GoesWithLinkRow[]; sortName: string }>> {
  const rows = await repo.query<Raw<MenuItemRow> & { price_minor: string; sort_name: string; goes_with: GoesWithLinkRow[] }>(
    `SELECT ${MENU_ITEM_COLUMNS}, lower(name) AS sort_name,
            ${goesWithJson('item', 'menu_items.tenant_id', 'menu_items.item_id')} AS goes_with
       FROM menu_items
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
  return rows.map(({ sort_name, goes_with, ...row }) => ({ item: menuItemRow(row), goesWith: goes_with, sortName: sort_name }));
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

// 01c §6.14: a deal's windows live in availability_windows.deal_id (§5.1).
export type WindowTarget = { item_id: string } | { category_id: string } | { deal_id: string };

function windowColumn(target: WindowTarget): ['item_id' | 'category_id' | 'deal_id', string] {
  if ('item_id' in target) return ['item_id', target.item_id];
  if ('category_id' in target) return ['category_id', target.category_id];
  return ['deal_id', target.deal_id];
}

// S47: a target's windows, by start_ms, end_ms, window_id.
export async function selectWindowsOf(repo: TenantLevelRepository, target: WindowTarget): Promise<WindowRow[]> {
  const [column, id] = windowColumn(target);
  return repo.query<WindowRow>(
    `SELECT start_ms, end_ms FROM availability_windows
      WHERE tenant_id = $1 AND ${column} = $2
      ORDER BY start_ms, end_ms, window_id`,
    [id],
  );
}

// §6.13–6.15: a PATCH with availability_windows deletes the target's rows ...
export async function deleteWindowsOf(repo: TenantLevelRepository, target: WindowTarget): Promise<void> {
  const [column, id] = windowColumn(target);
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
    `INSERT INTO availability_windows (tenant_id, window_id, item_id, category_id, deal_id, start_ms, end_ms)
     SELECT t.tenant_id, u.window_id, $2, $3, $4, u.start_ms, u.end_ms
       FROM tenants t, unnest($5::text[], $6::int[], $7::int[]) AS u (window_id, start_ms, end_ms)
      WHERE t.tenant_id = $1
     RETURNING window_id, start_ms, end_ms`,
    [
      'item_id' in target ? target.item_id : null,
      'category_id' in target ? target.category_id : null,
      'deal_id' in target ? target.deal_id : null,
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
