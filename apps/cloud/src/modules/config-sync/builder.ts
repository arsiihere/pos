import { BranchConfigSnapshotSchemaV2, SNAPSHOT_SCHEMA_VERSION } from '@pos/events';
import type pg from 'pg';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import { TenantScopedRepository, type TenantContext } from '../../db/tenant-scoped-repository.js';
import { effectiveGroupIds, type LinkRow } from '../menu-variants/effective-set.js';

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

interface StockItemRow {
  stock_item_id: string;
  name: string;
  stock_unit: string;
  carries_over: boolean;
  station_id: string;
  low_stock_threshold: number | null;
}

interface GroupOptionRow {
  modifier_group_id: string;
  name: string;
  min_choices: number;
  max_choices: number;
  sort_order: number;
  option_id: string | null;
  option_name: string | null;
  price_minor: string | null;
  max_quantity: number | null;
  is_default: boolean | null;
  linked_item_id: string | null;
  option_sort_order: number | null;
}

interface SnapshotOption {
  option_id: string;
  name: string;
  price_minor: number;
  max_quantity: number;
  is_default: boolean;
  linked_item_id: string | null;
  sort_order: number;
}

interface DrawRow {
  item_id: string;
  stock_item_id: string;
  quantity_per_sale_unit: number;
}

// §6.1 step 3, §4.3 (01c §6.17, §4.6): 12 fixed statements, one builder (S28): 01a's 7 + variant groups, stock
// items with this branch's rows, draws, modifier groups with options, links. Active rows only, except stations,
// programs and tax classes (S22).
// Arrays by sort_order, then id; rows without sort_order (stations, programs, tax classes) by name, then id;
// stock items by toLowerCase() name, then id, in JS; windows by start_ms, end_ms, window_id (S47). Returns the
// wire object (S27). deals stay empty until 01c task 31.
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
  const items = await scoped.query<
    Record<string, unknown> & {
      item_id: string;
      category_id: string;
      price_minor: string;
      variant_group_id: string | null;
      station_id: string;
      stock_time_ms: number | null;
      stock_program_id: string | null;
    }
  >(
    `SELECT m.item_id, m.category_id, m.variant_group_id, m.variant_name, m.name, m.description, m.sort_order,
            COALESCE(r.price_minor_override, m.price_minor) AS price_minor, -- S57: the branch's effective price
            m.tax_class_id, m.serve_mode, m.prep_buffer_ms, m.cook_time_ms, m.stock_time_ms, m.out_of_stock_behaviour,
            m.sale_unit, m.requires_weighing, r.station_id, r.program_id, r.stock_program_id
       FROM item_routes r
       JOIN menu_items m ON m.tenant_id = r.tenant_id AND m.item_id = r.item_id
      WHERE r.tenant_id = $1 AND r.branch_id = ANY($2) AND r.branch_id = $3 AND m.archived_at IS NULL
      ORDER BY m.sort_order, m.item_id`,
    [branchId],
  );
  const windows = await scoped.query<WindowRow>(
    `SELECT w.item_id, w.category_id, w.start_ms, w.end_ms FROM availability_windows w
      WHERE w.tenant_id = $1
        AND (w.category_id IS NOT NULL
             OR w.item_id IN (SELECT item_id FROM item_routes WHERE ${branch}))
      ORDER BY w.start_ms, w.end_ms, w.window_id`,
    [branchId],
  );

  // 01c §3.2.1, §4.6 rule 5: only groups with an active member routed here.
  const variantGroups = await level.query<{
    variant_group_id: string;
    category_id: string;
    name: string;
    description: string | null;
    sort_order: number;
  }>(
    `SELECT variant_group_id, category_id, name, description, sort_order FROM variant_groups
      WHERE tenant_id = $1 AND archived_at IS NULL AND variant_group_id = ANY($2)
      ORDER BY sort_order, variant_group_id`,
    [[...new Set(items.flatMap((item) => (item.variant_group_id === null ? [] : [item.variant_group_id])))]],
  );
  // 01c §4.6 rule 4: the active stock items counted at this branch.
  const stockItems = await scoped.query<StockItemRow>(
    `SELECT s.stock_item_id, s.name, s.stock_unit, s.carries_over, b.station_id, b.low_stock_threshold
       FROM stock_item_branches b
       JOIN stock_items s ON s.tenant_id = b.tenant_id AND s.stock_item_id = b.stock_item_id
      WHERE b.tenant_id = $1 AND b.branch_id = ANY($2) AND b.branch_id = $3 AND s.archived_at IS NULL`,
    [branchId],
  );
  // 01c V12: the draws of this snapshot's items (the deprecated item unit columns are never read).
  const draws = await level.query<DrawRow>(
    `SELECT item_id, stock_item_id, quantity_per_sale_unit FROM stock_draws
      WHERE tenant_id = $1 AND item_id = ANY($2) ORDER BY item_id, stock_item_id`,
    [items.map((item) => item.item_id)],
  );

  // 01c §4.6 rule 3: the active groups with their active options, by group sort_order, id, then option sort_order, id.
  const groupRows = await level.query<GroupOptionRow>(
    `SELECT g.modifier_group_id, g.name, g.min_choices, g.max_choices, g.sort_order,
            o.option_id, o.name AS option_name, o.price_minor, o.max_quantity, o.is_default, o.linked_item_id,
            o.sort_order AS option_sort_order
       FROM modifier_groups g
       LEFT JOIN modifier_options o
         ON o.tenant_id = g.tenant_id AND o.modifier_group_id = g.modifier_group_id AND o.archived_at IS NULL
      WHERE g.tenant_id = $1 AND g.archived_at IS NULL
      ORDER BY g.sort_order, g.modifier_group_id, o.sort_order, o.option_id`,
  );
  const activeGroupIds = [...new Set(groupRows.map((row) => row.modifier_group_id))];
  // 01c V8: the links of the active groups; resolved per item in memory (effectiveGroupIds).
  const links = await level.query<LinkRow>(
    `SELECT modifier_group_id, target_kind, target_id, mode FROM modifier_group_links
      WHERE tenant_id = $1 AND modifier_group_id = ANY($2)`,
    [activeGroupIds],
  );

  // §4.6: by toLowerCase() name, then id, in JavaScript string order (never the database collation).
  stockItems.sort((a, b) => compare(a.name.toLowerCase(), b.name.toLowerCase()) || compare(a.stock_item_id, b.stock_item_id));
  const counted = new Set(stockItems.map((stockItem) => stockItem.stock_item_id));
  const stationTypes = new Map(stations.map((row) => [row.station_id, row.station_type]));
  // 01c V12 (§4.6 rule 4): a draw is listed only when its stock item is counted here and the route tracks
  // (slot: stock_time_ms set; batch: stock_program_id set).
  const routeTracks = (item: (typeof items)[number]) =>
    stationTypes.get(item.station_id) === 'slot' ? item.stock_time_ms !== null : item.stock_program_id !== null;
  const drawsByItem = new Map<string, Array<{ stock_item_id: string; quantity_per_sale_unit: number }>>();
  for (const draw of draws) {
    if (!counted.has(draw.stock_item_id)) continue;
    const list = drawsByItem.get(draw.item_id) ?? [];
    list.push({ stock_item_id: draw.stock_item_id, quantity_per_sale_unit: draw.quantity_per_sale_unit });
    drawsByItem.set(draw.item_id, list);
  }

  // 01c §4.6 rules 2, 3 (F1, M1): each active group's options at this branch. A linked option whose item is not
  // in this snapshot (not routed here, or archived) is left out; its null price is the item's effective branch price.
  const itemsById = new Map(items.map((item) => [item.item_id, item]));
  const groups: Array<{
    modifier_group_id: string;
    name: string;
    min_choices: number;
    max_choices: number;
    sort_order: number;
    has_plain_options: boolean;
    options: SnapshotOption[];
  }> = [];
  for (const row of groupRows) {
    let group = groups.at(-1);
    if (group === undefined || group.modifier_group_id !== row.modifier_group_id) {
      group = {
        modifier_group_id: row.modifier_group_id,
        name: row.name,
        min_choices: row.min_choices,
        max_choices: row.max_choices,
        sort_order: row.sort_order,
        has_plain_options: false,
        options: [],
      };
      groups.push(group);
    }
    if (row.option_id === null) continue;
    if (row.linked_item_id === null) group.has_plain_options = true; // M1: configured, offered here or not
    const linked = row.linked_item_id === null ? undefined : itemsById.get(row.linked_item_id);
    if (row.linked_item_id !== null && linked === undefined) continue;
    const price = row.price_minor ?? linked?.price_minor;
    group.options.push({
      option_id: row.option_id,
      name: row.option_name!,
      price_minor: Number(price), // BIGINT arrives as a string (S27)
      max_quantity: row.max_quantity!,
      is_default: row.is_default!,
      linked_item_id: row.linked_item_id,
      sort_order: row.option_sort_order!,
    });
  }
  // F1: an optional group left with no options here is left out everywhere; a required one is kept with options: [].
  const offeredGroups = groups.filter((group) => group.options.length > 0 || group.min_choices >= 1);
  // m15 (§4.6 rule 6): only active targets count — this snapshot's items, active categories, active variant groups.
  const activeTargets = new Set<string>([
    ...items.map((item) => item.item_id),
    ...categories.map((category) => category.category_id),
    ...variantGroups.map((group) => group.variant_group_id),
  ]);
  const groupIdsByItem = new Map(
    items.map((item) => [
      item.item_id,
      // V8 resolution, no maximum (M5)
      effectiveGroupIds(
        { item_id: item.item_id, category_id: item.category_id, variant_group_id: item.variant_group_id },
        links,
        offeredGroups,
        activeTargets,
      ),
    ]),
  );
  // m5: only groups some item references.
  const referenced = new Set([...groupIdsByItem.values()].flat());

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
    variant_groups: variantGroups,
    stock_items: stockItems,
    modifier_groups: offeredGroups.filter((group) => referenced.has(group.modifier_group_id)),
    items: items.map((item) => ({
      ...item,
      price_minor: Number(item.price_minor), // BIGINT arrives as a string (S27)
      stock_draws: routeTracks(item) ? (drawsByItem.get(item.item_id) ?? []) : [],
      availability_windows: windowsOf('item', item.item_id),
      modifier_group_ids: groupIdsByItem.get(item.item_id) ?? [],
    })),
    deals: [],
  };
  return JSON.parse(JSON.stringify(BranchConfigSnapshotSchemaV2.parse(built))) as Record<string, unknown>;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
