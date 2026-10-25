import { BranchConfigSnapshotSchemaV1, SNAPSHOT_SCHEMA_VERSION } from '@pos/events';
import type pg from 'pg';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import { TenantScopedRepository, type TenantContext } from '../../db/tenant-scoped-repository.js';

export interface SnapshotHeader {
  config_version: number;
  currency_code: string;
  tax_enabled: boolean;
  day_stale_after_hours: number;
  day_min_gap_hours: number;
}

interface WindowRow {
  item_id: string | null;
  category_id: string | null;
  start_ms: number;
  end_ms: number;
}

// §6.1 step 3, §4.3: 7 fixed statements, one builder (S28). Active rows only, except stations, programs and
// tax classes (S22). Arrays by sort_order, then id; rows without sort_order (stations, programs, tax classes)
// by name, then id; windows by start_ms, end_ms, window_id (S47). Returns the wire object (S27).
export async function buildSnapshot(
  client: pg.PoolClient,
  tenant: TenantContext,
  branchId: string,
  header: SnapshotHeader,
): Promise<Record<string, unknown>> {
  const scoped = new TenantScopedRepository(tenant, client);
  const level = new TenantLevelRepository(tenant, client);
  const branch = 'tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3';

  const floors = await scoped.query<{ floor_id: string; name: string; sort_order: number }>(
    `SELECT floor_id, name, sort_order FROM floors WHERE ${branch} AND archived_at IS NULL ORDER BY sort_order, floor_id`,
    [branchId],
  );
  const tables = await scoped.query<{ floor_id: string; table_id: string; name: string; seats: number | null; sort_order: number }>(
    `SELECT floor_id, table_id, name, seats, sort_order FROM dining_tables
      WHERE ${branch} AND archived_at IS NULL ORDER BY sort_order, table_id`,
    [branchId],
  );
  const stations = await scoped.query<{
    station_id: string;
    name: string;
    location_label: string | null;
    station_type: 'slot' | 'batch';
    capacity: number;
    freshness_window_ms: number | null;
    completion_mode: string;
    is_archived: boolean;
    program_id: string | null;
    program_name: string | null;
    cook_time_ms: number | null;
    program_archived: boolean | null;
  }>(
    `SELECT s.station_id, s.name, s.location_label, s.station_type, s.capacity, s.freshness_window_ms,
            s.completion_mode, s.archived_at IS NOT NULL AS is_archived,
            p.program_id, p.name AS program_name, p.cook_time_ms, p.archived_at IS NOT NULL AS program_archived
       FROM stations s
       LEFT JOIN batch_programs p
         ON p.tenant_id = s.tenant_id AND p.branch_id = s.branch_id AND p.station_id = s.station_id
      WHERE s.tenant_id = $1 AND s.branch_id = ANY($2) AND s.branch_id = $3
      ORDER BY s.name, s.station_id, p.name, p.program_id`,
    [branchId],
  );
  const taxClasses = await level.query<{ tax_class_id: string; name: string; rate_bp: number; is_archived: boolean }>(
    `SELECT tax_class_id, name, rate_bp, archived_at IS NOT NULL AS is_archived FROM tax_classes
      WHERE tenant_id = $1 ORDER BY name, tax_class_id`,
  );
  const categories = await level.query<{ category_id: string; name: string; sort_order: number }>(
    `SELECT category_id, name, sort_order FROM categories
      WHERE tenant_id = $1 AND archived_at IS NULL ORDER BY sort_order, category_id`,
  );
  const items = await scoped.query<Record<string, unknown> & { item_id: string; price_minor: string }>(
    `SELECT m.item_id, m.category_id, m.name, m.group_label, m.description, m.sort_order, m.price_minor,
            m.tax_class_id, m.serve_mode, m.prep_buffer_ms, m.cook_time_ms, m.stock_time_ms, m.out_of_stock_behaviour,
            m.stock_unit, m.sale_unit, m.stock_per_sale_unit, m.low_stock_threshold, m.carries_over,
            r.station_id, r.program_id, r.stock_program_id
       FROM item_routes r
       JOIN menu_items m ON m.tenant_id = r.tenant_id AND m.item_id = r.item_id
      WHERE r.tenant_id = $1 AND r.branch_id = ANY($2) AND r.branch_id = $3 AND m.archived_at IS NULL
      ORDER BY m.sort_order, m.item_id`,
    [branchId],
  );
  const windows = await level.query<WindowRow>(
    `SELECT w.item_id, w.category_id, w.start_ms, w.end_ms FROM availability_windows w
      WHERE w.tenant_id = $1
        AND (w.category_id IS NOT NULL
             OR w.item_id IN (SELECT item_id FROM item_routes WHERE tenant_id = $1 AND branch_id = $2))
      ORDER BY w.start_ms, w.end_ms, w.window_id`,
    [branchId],
  );

  const windowsByTarget = new Map<string, Array<{ start_ms: number; end_ms: number }>>();
  for (const w of windows) {
    const key = w.item_id !== null ? `item:${w.item_id}` : `category:${w.category_id}`;
    const list = windowsByTarget.get(key) ?? [];
    list.push({ start_ms: w.start_ms, end_ms: w.end_ms });
    windowsByTarget.set(key, list);
  }
  const windowsOf = (kind: 'item' | 'category', id: string) => windowsByTarget.get(`${kind}:${id}`) ?? [];
  const tablesByFloor = new Map<string, Array<{ table_id: string; name: string; seats: number | null; sort_order: number }>>();
  for (const table of tables) {
    const list = tablesByFloor.get(table.floor_id) ?? [];
    list.push({ table_id: table.table_id, name: table.name, seats: table.seats, sort_order: table.sort_order });
    tablesByFloor.set(table.floor_id, list);
  }

  const stationList: Array<Record<string, unknown> & { programs: unknown[] }> = [];
  for (const row of stations) {
    let station = stationList.at(-1);
    if (station === undefined || station.station_id !== row.station_id) {
      station = {
        station_id: row.station_id,
        name: row.name,
        location_label: row.location_label,
        station_type: row.station_type,
        capacity: row.capacity,
        freshness_window_ms: row.freshness_window_ms,
        completion_mode: row.completion_mode,
        is_archived: row.is_archived,
        programs: [],
      };
      stationList.push(station);
    }
    if (row.program_id !== null) {
      station.programs.push({
        program_id: row.program_id,
        name: row.program_name,
        cook_time_ms: row.cook_time_ms,
        is_archived: row.program_archived,
      });
    }
  }

  const built = {
    snapshot_schema_version: SNAPSHOT_SCHEMA_VERSION,
    config_version: header.config_version,
    branch_id: branchId,
    currency_code: header.currency_code,
    tax_enabled: header.tax_enabled,
    day_stale_after_hours: header.day_stale_after_hours,
    day_min_gap_hours: header.day_min_gap_hours,
    floors: floors.map((floor) => ({ ...floor, tables: tablesByFloor.get(floor.floor_id) ?? [] })),
    stations: stationList,
    tax_classes: taxClasses,
    categories: categories.map((category) => ({
      ...category,
      availability_windows: windowsOf('category', category.category_id),
    })),
    items: items.map((item) => ({
      ...item,
      price_minor: Number(item.price_minor), // BIGINT arrives as a string (S27)
      availability_windows: windowsOf('item', item.item_id),
    })),
  };
  return JSON.parse(JSON.stringify(BranchConfigSnapshotSchemaV1.parse(built))) as Record<string, unknown>;
}
