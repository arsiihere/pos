import { BranchConfigSnapshotSchemaV4, SNAPSHOT_SCHEMA_VERSION } from '@pos/events';
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

interface DealChoiceRow {
  deal_id: string;
  category_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  price_minor: string;
  tax_class_id: string | null;
  deal_part_id: string;
  quantity: number;
  part_sort_order: number;
  item_id: string | null;
  extra_price_minor: string | null;
  choice_sort_order: number | null;
}

interface SnapshotDealPart {
  deal_part_id: string;
  quantity: number;
  sort_order: number;
  choices: Array<{ item_id: string; extra_price_minor: number; sort_order: number }>;
}

interface DrawRow {
  item_id: string;
  stock_item_id: string;
  quantity_per_sale_unit: number;
}

// §6.1 step 3, §4.3 (01c §6.17, §4.6): 22 fixed statements, one builder (S28): 01a's 7 + variant groups, stock
// items with this branch's rows, draws, modifier groups with options, this branch's option rows, links, this
// branch's deal rows, the deals sold here with their active parts and choices, deal windows, schema 3's points,
// alternates, carry times, engine settings, goes-with (01b v1.5 B-8), and schema 4's zones with their lists (01a v2.2
// A-1 "+1 statement", v2.3 A-1). Active rows only, except stations, programs, tax classes (S22), points and zones.
// Arrays by sort_order, then id; rows without sort_order (stations, programs, tax classes) by name, then id;
// stock items by toLowerCase() name, then id, in JS; windows by start_ms, end_ms, window_id (S47); deal choices by
// sort_order, then item_id (m5); zone routes and stock items by item_id (AD-12). Returns the wire object (S27).
export async function buildSnapshot(
  client: pg.PoolClient,
  tenant: TenantContext,
  branchId: string,
  header: SnapshotHeader,
): Promise<Record<string, unknown>> {
  const body = await buildSnapshotBody(client, tenant, branchId, header);
  return JSON.parse(JSON.stringify(BranchConfigSnapshotSchemaV4.parse(body))) as Record<string, unknown>;
}

// The built body before the schema parse.
export async function buildSnapshotBody(
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
  const tables = await scoped.query<{
    floor_id: string;
    table_id: string;
    name: string;
    seats: number | null;
    sort_order: number;
    zone_id: string | null;
  }>(
    // 01a §4.3 V4: zone_id as stored; archiving a zone sets it to NULL on its tables (§6.6b, #184).
    `SELECT floor_id, table_id, name, seats, sort_order, zone_id FROM dining_tables
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
    point_id: string;
    policy: string;
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
    program_id: string | null;
    program_name: string | null;
    cook_time_ms: number | null;
    program_archived: boolean | null;
  }>(
    `SELECT s.station_id, s.name, s.location_label, s.station_type, s.capacity, s.freshness_window_ms,
            s.completion_mode, s.archived_at IS NOT NULL AS is_archived,
            s.point_id, s.policy, s.freeze_ms, s.min_slack_keep_ms, s.promise_padding_ms, s.pressure_window_ms,
            s.pressure_amber_bp, s.pressure_red_bp, s.pressure_alert_ms, s.pause_enabled, s.lane_units, s.reserve_units,
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
      sale_unit: string;
      requires_weighing: boolean;
      station_id: string;
      stock_time_ms: number | null;
      stock_program_id: string | null;
    }
  >(
    `SELECT m.item_id, m.category_id, m.variant_group_id, m.variant_name, m.name, m.description, m.sort_order,
            COALESCE(r.price_minor_override, m.price_minor) AS price_minor, -- S57: the branch's effective price
            m.tax_class_id, m.serve_mode, m.prep_buffer_ms, m.cook_time_ms, m.stock_time_ms, m.out_of_stock_behaviour,
            m.sale_unit, m.requires_weighing, r.station_id, r.program_id, r.stock_program_id,
            m.weight_pct, m.max_early_ms, m.max_carry_ms, m.max_late_ms, m.adjust_time_ms, m.is_ready_item
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
  // 01c V19: this branch's option differences (rows of archived options are never matched, m4).
  const optionBranches = await scoped.query<{ option_id: string; is_offered: boolean; price_minor_override: string | null }>(
    `SELECT option_id, is_offered, price_minor_override FROM modifier_option_branches WHERE ${branch}`,
    [branchId],
  );
  // 01c V8: the links of the active groups; resolved per item in memory (effectiveGroupIds).
  const links = await level.query<LinkRow>(
    `SELECT modifier_group_id, target_kind, target_id, mode FROM modifier_group_links
      WHERE tenant_id = $1 AND modifier_group_id = ANY($2)`,
    [activeGroupIds],
  );

  // 01c §6.16, V11 e: this branch's deal rows (branch-scoped by the primary key); a deal with no row here is not sold.
  const dealBranches = await scoped.query<{ deal_id: string; price_minor_override: string | null }>(
    `SELECT deal_id, price_minor_override FROM deal_branches WHERE ${branch}`,
    [branchId],
  );
  const soldDealIds = dealBranches.map((row) => row.deal_id);
  // 01c §4.6 rule 5: the active deals sold here, their active parts and each part's choices (a part with no choice
  // row still returns one row), by deal sort_order, id, part sort_order, id, then choice sort_order, item_id (m5).
  const dealRows = await level.query<DealChoiceRow>(
    `SELECT d.deal_id, d.category_id, d.name, d.description, d.sort_order, d.price_minor, d.tax_class_id,
            p.deal_part_id, p.quantity, p.sort_order AS part_sort_order,
            c.item_id, c.extra_price_minor, c.sort_order AS choice_sort_order
       FROM deals d
       JOIN deal_parts p ON p.tenant_id = d.tenant_id AND p.deal_id = d.deal_id AND p.archived_at IS NULL
       LEFT JOIN deal_part_choices c ON c.tenant_id = p.tenant_id AND c.deal_part_id = p.deal_part_id
      WHERE d.tenant_id = $1 AND d.archived_at IS NULL AND d.deal_id = ANY($2)
      ORDER BY d.sort_order, d.deal_id, p.sort_order, p.deal_part_id, c.sort_order, c.item_id`,
    [soldDealIds],
  );
  // 01c §4.6: the windows of the deals sold here (S47 window order).
  const dealWindows = await level.query<{ deal_id: string; start_ms: number; end_ms: number }>(
    `SELECT deal_id, start_ms, end_ms FROM availability_windows
      WHERE tenant_id = $1 AND deal_id = ANY($2)
      ORDER BY start_ms, end_ms, window_id`,
    [soldDealIds],
  );

  // 01a v2.1 §4.3, schema 3 (01b v1.5 B-8).
  const points = await selectPoints(scoped, branchId);
  const alternates = await selectStationAlternates(scoped, branchId);
  const carryTimes = await selectCarryTimes(scoped, branchId);
  const engineSettings = await selectEngineSettings(scoped, branchId);
  const goesWith = await selectGoesWith(level);
  // 01a v2.2 / v2.3 §4.3, schema 4: one statement (§6.1 "+1").
  const zones = await selectZones(scoped, branchId);

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

  // 01c §4.6 rules 2, 3 (V19, F1, M1): each active group's options at this branch. Left out: an option not offered
  // here; a linked option whose item is not in this snapshot (not routed here, or archived); backstop (Q1): a linked
  // option whose item is not sale_unit 'piece' or is weighed. Price (AU-4): branch override, else the option's
  // price_minor, else the linked item's effective branch price.
  const branchRows = new Map(optionBranches.map((row) => [row.option_id, row]));
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
    const atBranch = branchRows.get(row.option_id);
    if (atBranch?.is_offered === false) continue;
    const linked = row.linked_item_id === null ? undefined : itemsById.get(row.linked_item_id);
    if (row.linked_item_id !== null && (linked === undefined || linked.sale_unit !== 'piece' || linked.requires_weighing)) continue;
    const price = atBranch?.price_minor_override ?? row.price_minor ?? linked?.price_minor;
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

  // 01c §4.6 rules 1, 5 (V11 e, S57): a choice is listed only when its item is in this snapshot (routed here and
  // active, m15); a deal is left out when a part keeps no choice. The first listed choice is the part's reference
  // choice at this branch (V11 c, AU-11). Price: this branch's override, else the deal's price_minor.
  const overrides = new Map(dealBranches.map((row) => [row.deal_id, row.price_minor_override]));
  const dealWindowsById = new Map<string, Array<{ start_ms: number; end_ms: number }>>();
  for (const w of dealWindows) {
    const list = dealWindowsById.get(w.deal_id) ?? [];
    list.push({ start_ms: w.start_ms, end_ms: w.end_ms });
    dealWindowsById.set(w.deal_id, list);
  }
  const deals: Array<Record<string, unknown> & { deal_id: string; parts: SnapshotDealPart[] }> = [];
  for (const row of dealRows) {
    let deal = deals.at(-1);
    if (deal === undefined || deal.deal_id !== row.deal_id) {
      deal = {
        deal_id: row.deal_id,
        category_id: row.category_id,
        name: row.name,
        description: row.description,
        sort_order: row.sort_order,
        price_minor: Number(overrides.get(row.deal_id) ?? row.price_minor), // BIGINT arrives as a string (S27)
        tax_class_id: row.tax_class_id,
        availability_windows: dealWindowsById.get(row.deal_id) ?? [],
        parts: [],
      };
      deals.push(deal);
    }
    let part = deal.parts.at(-1);
    if (part === undefined || part.deal_part_id !== row.deal_part_id) {
      part = { deal_part_id: row.deal_part_id, quantity: row.quantity, sort_order: row.part_sort_order, choices: [] };
      deal.parts.push(part);
    }
    if (row.item_id === null || !itemsById.has(row.item_id)) continue;
    part.choices.push({ item_id: row.item_id, extra_price_minor: Number(row.extra_price_minor), sort_order: row.choice_sort_order! });
  }

  const windowsByTarget = new Map<string, Array<{ start_ms: number; end_ms: number }>>();
  for (const w of windows) {
    const key = w.item_id !== null ? `item:${w.item_id}` : `category:${w.category_id}`;
    const list = windowsByTarget.get(key) ?? [];
    list.push({ start_ms: w.start_ms, end_ms: w.end_ms });
    windowsByTarget.set(key, list);
  }
  const windowsOf = (kind: 'item' | 'category', id: string) => windowsByTarget.get(`${kind}:${id}`) ?? [];
  const tablesByFloor = new Map<
    string,
    Array<{ table_id: string; name: string; seats: number | null; sort_order: number; zone_id: string | null }>
  >();
  for (const table of tables) {
    const list = tablesByFloor.get(table.floor_id) ?? [];
    list.push({ table_id: table.table_id, name: table.name, seats: table.seats, sort_order: table.sort_order, zone_id: table.zone_id });
    tablesByFloor.set(table.floor_id, list);
  }
  // A zone of an archived floor has no floor here, so it is not delivered (an archived floor has no active zone, §6.4).
  const zonesByFloor = new Map<string, Array<Omit<ZoneRow, 'floor_id'>>>();
  for (const { floor_id, ...zone } of zones) {
    const list = zonesByFloor.get(floor_id) ?? [];
    list.push(zone);
    zonesByFloor.set(floor_id, list);
  }

  const alternatesByStation = new Map<string, Array<{ station_id: string; order_types: string[]; home_for_order_types: string[] }>>();
  for (const row of alternates) {
    const list = alternatesByStation.get(row.station_id) ?? [];
    list.push({
      station_id: row.alternate_station_id,
      order_types: [...row.order_types].sort(compare),
      home_for_order_types: [...row.home_for_order_types].sort(compare),
    });
    alternatesByStation.set(row.station_id, list);
  }
  const carryTimesByStation = new Map<string, Array<{ point_id: string; carry_ms: number }>>();
  for (const row of carryTimes) {
    const list = carryTimesByStation.get(row.station_id) ?? [];
    list.push({ point_id: row.point_id, carry_ms: row.carry_ms });
    carryTimesByStation.set(row.station_id, list);
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
        point_id: row.point_id,
        policy: row.policy,
        freeze_ms: row.freeze_ms,
        min_slack_keep_ms: row.min_slack_keep_ms,
        promise_padding_ms: row.promise_padding_ms,
        pressure_window_ms: row.pressure_window_ms,
        pressure_amber_bp: row.pressure_amber_bp,
        pressure_red_bp: row.pressure_red_bp,
        pressure_alert_ms: row.pressure_alert_ms,
        pause_enabled: row.pause_enabled,
        lane_units: row.lane_units,
        reserve_units: row.reserve_units,
        alternates: alternatesByStation.get(row.station_id) ?? [],
        carry_times: carryTimesByStation.get(row.station_id) ?? [],
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

  return {
    snapshot_schema_version: SNAPSHOT_SCHEMA_VERSION,
    config_version: header.config_version,
    branch_id: branchId,
    currency_code: header.currency_code,
    tax_enabled: header.tax_enabled,
    day_stale_after_hours: header.day_stale_after_hours,
    day_min_gap_hours: header.day_min_gap_hours,
    floors: floors.map((floor) => ({
      ...floor,
      zones: zonesByFloor.get(floor.floor_id) ?? [],
      tables: tablesByFloor.get(floor.floor_id) ?? [],
    })),
    points,
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
    deals: deals.filter((deal) => deal.parts.every((part) => part.choices.length > 0)),
    engine_settings: engineSettings,
    goes_with: goesWith,
  };
}

// 01a §4.3 V3: archived rows stay, as stations do, so an archived station's point_id still resolves.
function selectPoints(scoped: TenantScopedRepository, branchId: string) {
  return scoped.query<{ point_id: string; name: string; sort_order: number; is_archived: boolean }>(
    `SELECT point_id, name, sort_order, archived_at IS NOT NULL AS is_archived FROM points
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3
      ORDER BY sort_order, point_id COLLATE "C"`,
    [branchId],
  );
}

// CL-10: a row naming an archived station, at either end, is left out (restore has no check).
function selectStationAlternates(scoped: TenantScopedRepository, branchId: string) {
  return scoped.query<{ station_id: string; alternate_station_id: string; order_types: string[]; home_for_order_types: string[] }>(
    `SELECT a.station_id, a.alternate_station_id, a.order_types, a.home_for_order_types
       FROM station_alternates a
       JOIN stations s ON s.tenant_id = a.tenant_id AND s.branch_id = a.branch_id AND s.station_id = a.station_id
       JOIN stations t ON t.tenant_id = a.tenant_id AND t.branch_id = a.branch_id AND t.station_id = a.alternate_station_id
      WHERE a.tenant_id = $1 AND a.branch_id = ANY($2) AND a.branch_id = $3
        AND s.archived_at IS NULL AND t.archived_at IS NULL
      ORDER BY a.station_id COLLATE "C", a.alternate_station_id COLLATE "C"`,
    [branchId],
  );
}

function selectCarryTimes(scoped: TenantScopedRepository, branchId: string) {
  return scoped.query<{ station_id: string; point_id: string; carry_ms: number }>(
    `SELECT station_id, point_id, carry_ms FROM carry_times
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3
      ORDER BY station_id COLLATE "C", point_id COLLATE "C"`,
    [branchId],
  );
}

// CL-3: every branch has exactly one row, so a missing row is an error, never a default.
async function selectEngineSettings(scoped: TenantScopedRepository, branchId: string) {
  const rows = await scoped.query<Record<string, unknown>>(
    `SELECT weight_dine_in_pct, weight_takeaway_pct, weight_delivery_pct, weight_parking_pct, weight_follow_up_pct,
            promise_padding_dine_in_ms, promise_padding_takeaway_ms, promise_padding_delivery_ms, promise_padding_parking_ms,
            slip_threshold_ms, slip_escalate_ms, cascade_step_ms, min_gain_ms, returns_boost, order_abandon_ms, table_lock_ttl_ms,
            queue_auto_send_max_ms, zone_undo_ms, slow_item_threshold_ms, served_estimate_ms, comp_reason_chips, -- 02b A-1, AD-10
            ready_window_ms, kds_offline_ms -- 03b A-1
       FROM branch_engine_settings
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3`,
    [branchId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`no engine settings row for branch ${branchId}`);
  return row;
}

interface ZoneRow {
  floor_id: string;
  zone_id: string;
  name: string;
  sort_order: number;
  is_archived: boolean;
  routes: Array<{ item_id: string; station_id: string }>;
  stock_items: Array<{ item_id: string; threshold: number }>;
}

// 01a §4.3 V4: every zone of the branch, archived ones included with is_archived: true (like stations) and with empty
// lists (AD-11; their rows stay and apply again on restore, AD-9). By sort_order, then zone_id; each list by item_id
// (AD-12), in code-unit order (COLLATE "C"). An active zone's lists never name an archived item or station (AD-6,
// AD-9), so they are not filtered. One statement: the lists are aggregated in correlated subqueries on their primary keys.
function selectZones(scoped: TenantScopedRepository, branchId: string) {
  return scoped.query<ZoneRow>(
    `SELECT z.floor_id, z.zone_id, z.name, z.sort_order, z.archived_at IS NOT NULL AS is_archived,
            CASE WHEN z.archived_at IS NOT NULL THEN '[]'::json ELSE COALESCE(
              (SELECT json_agg(json_build_object('item_id', r.item_id, 'station_id', r.station_id) ORDER BY r.item_id COLLATE "C")
                 FROM zone_item_routes r
                WHERE r.tenant_id = z.tenant_id AND r.branch_id = z.branch_id AND r.zone_id = z.zone_id),
              '[]'::json) END AS routes,
            CASE WHEN z.archived_at IS NOT NULL THEN '[]'::json ELSE COALESCE(
              (SELECT json_agg(json_build_object('item_id', s.item_id, 'threshold', s.threshold) ORDER BY s.item_id COLLATE "C")
                 FROM zone_stock_items s
                WHERE s.tenant_id = z.tenant_id AND s.branch_id = z.branch_id AND s.zone_id = z.zone_id),
              '[]'::json) END AS stock_items
       FROM zones z
      WHERE z.tenant_id = $1 AND z.branch_id = ANY($2) AND z.branch_id = $3
      ORDER BY z.sort_order, z.zone_id COLLATE "C"`,
    [branchId],
  );
}

// CL-12: archiving a category or item does not touch its links, so a link with an archived end is left out here.
function selectGoesWith(level: TenantLevelRepository) {
  const active = (kind: 'source' | 'target') => `CASE l.${kind}_kind
          WHEN 'category' THEN EXISTS (SELECT 1 FROM categories c
                                        WHERE c.tenant_id = l.tenant_id AND c.category_id = l.${kind}_id AND c.archived_at IS NULL)
          ELSE EXISTS (SELECT 1 FROM menu_items m
                        WHERE m.tenant_id = l.tenant_id AND m.item_id = l.${kind}_id AND m.archived_at IS NULL)
        END`;
  return level.query<{ source_kind: string; source_id: string; target_kind: string; target_id: string; excluded: boolean }>(
    `SELECT l.source_kind, l.source_id, l.target_kind, l.target_id, l.excluded
       FROM goes_with_links l
      WHERE l.tenant_id = $1
        AND ${active('source')}
        AND ${active('target')}
      ORDER BY l.source_kind COLLATE "C", l.source_id COLLATE "C", l.target_kind COLLATE "C", l.target_id COLLATE "C"`,
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
