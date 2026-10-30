import type { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import type { TenantScopedRepository } from '../../db/tenant-scoped-repository.js';
import type { EffectiveSetItem, LinkRow } from './effective-set.js';
import type {
  ModifierGroupRow,
  ModifierLinkRow,
  ModifierOptionBranchRow,
  ModifierOptionRow,
  StockItemRow,
  VariantGroupRow,
} from './versions.js';

// 01c §5.1 variant_groups. The stored row without its members; member_ids come from menu_items.
export type VariantGroupRecord = Omit<VariantGroupRow, 'member_ids' | 'archived_at'> & { archived_at: number | null };

// A member as stored, for its C5 audit row (every menu_items column but the tenant and the timestamps; BIGINTs
// are JSON numbers through to_jsonb).
export interface MemberRow {
  item_id: string;
  archived_at: number | null;
  row: Record<string, unknown>;
}

const GROUP_COLUMNS = 'variant_group_id, name, category_id, description, sort_order, archived_at';

type RawGroup = Omit<VariantGroupRecord, 'archived_at'> & { archived_at: string | null };

function groupRow(row: RawGroup): VariantGroupRecord {
  return { ...row, archived_at: row.archived_at === null ? null : Number(row.archived_at) };
}

export async function insertVariantGroup(
  repo: TenantLevelRepository,
  row: Omit<VariantGroupRecord, 'archived_at'>,
  now: number,
): Promise<VariantGroupRecord> {
  const rows = await repo.query<RawGroup>(
    `INSERT INTO variant_groups (tenant_id, variant_group_id, category_id, name, description, sort_order, created_at, updated_at)
     SELECT tenant_id, $2, $3, $4, $5, $6, $7, $7 FROM tenants WHERE tenant_id = $1
     RETURNING ${GROUP_COLUMNS}`,
    [row.variant_group_id, row.category_id, row.name, row.description, row.sort_order, now],
  );
  return groupRow(rows[0]!);
}

// §6 lock order 3: the §6.2 target.
export async function lockVariantGroup(repo: TenantLevelRepository, variantGroupId: string): Promise<VariantGroupRecord | undefined> {
  const rows = await repo.query<RawGroup>(
    `SELECT ${GROUP_COLUMNS} FROM variant_groups WHERE tenant_id = $1 AND variant_group_id = $2 FOR UPDATE`,
    [variantGroupId],
  );
  return rows[0] === undefined ? undefined : groupRow(rows[0]);
}

export async function updateVariantGroup(repo: TenantLevelRepository, row: VariantGroupRecord, now: number): Promise<VariantGroupRecord> {
  const rows = await repo.query<RawGroup>(
    `UPDATE variant_groups SET category_id = $3, name = $4, description = $5, sort_order = $6, archived_at = $7, updated_at = $8
      WHERE tenant_id = $1 AND variant_group_id = $2
      RETURNING ${GROUP_COLUMNS}`,
    [row.variant_group_id, row.category_id, row.name, row.description, row.sort_order, row.archived_at, now],
  );
  return groupRow(rows[0]!);
}

const MEMBER_SELECT = `item_id, archived_at, to_jsonb(m) - 'tenant_id' - 'created_at' - 'updated_at' AS row`;

type RawMember = { item_id: string; archived_at: string | null; row: Record<string, unknown> };

function memberRow(row: RawMember): MemberRow {
  return { item_id: row.item_id, archived_at: row.archived_at === null ? null : Number(row.archived_at), row: row.row };
}

// §6.2: every member, active and archived, by item_id. `lock` → FOR UPDATE (lock order 4, before the category).
export async function selectMembers(repo: TenantLevelRepository, variantGroupId: string, o: { lock: boolean }): Promise<MemberRow[]> {
  const rows = await repo.query<RawMember>(
    `SELECT ${MEMBER_SELECT} FROM menu_items m
      WHERE tenant_id = $1 AND variant_group_id = $2
      ORDER BY item_id${o.lock ? ' FOR UPDATE' : ''}`,
    [variantGroupId],
  );
  return rows.map(memberRow);
}

// §6.2, §3.2 rule 4 (M6): the members move with the group, archived ones included.
export async function moveMembers(
  repo: TenantLevelRepository,
  variantGroupId: string,
  categoryId: string,
  now: number,
): Promise<MemberRow[]> {
  const rows = await repo.query<RawMember>(
    `UPDATE menu_items m SET category_id = $3, updated_at = $4
      WHERE tenant_id = $1 AND variant_group_id = $2
      RETURNING ${MEMBER_SELECT}`,
    [variantGroupId, categoryId, now],
  );
  return rows.map(memberRow).sort((a, b) => (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0));
}

// V16: the active variant groups of a category (the 01a category archive check; a plain read).
export async function activeVariantGroupIdsIn(repo: TenantLevelRepository, categoryId: string): Promise<string[]> {
  const rows = await repo.query<{ variant_group_id: string }>(
    `SELECT variant_group_id FROM variant_groups
      WHERE tenant_id = $1 AND category_id = $2 AND archived_at IS NULL
      ORDER BY variant_group_id`,
    [categoryId],
  );
  return rows.map((row) => row.variant_group_id);
}

// ------------------------------------------------------------------------------------------------ stock items

// 01c §5.1 stock_items as stored (archived_at a number).
export type StockItemRecord = Omit<StockItemRow, 'archived_at'> & { archived_at: number | null };

const STOCK_ITEM_COLUMNS = 'stock_item_id, name, stock_unit, carries_over, archived_at';

type RawStockItem = Omit<StockItemRecord, 'archived_at'> & { archived_at: string | null };

function stockItemRow(row: RawStockItem): StockItemRecord {
  return { ...row, archived_at: row.archived_at === null ? null : Number(row.archived_at) };
}

// §6.7: insert, no lock (the name index → 23505 stock_items_active_name).
export async function insertStockItem(
  repo: TenantLevelRepository,
  row: Omit<StockItemRecord, 'archived_at'>,
  now: number,
): Promise<StockItemRecord> {
  const rows = await repo.query<RawStockItem>(
    `INSERT INTO stock_items (tenant_id, stock_item_id, name, stock_unit, carries_over, created_at, updated_at)
     SELECT tenant_id, $2, $3, $4, $5, $6, $6 FROM tenants WHERE tenant_id = $1
     RETURNING ${STOCK_ITEM_COLUMNS}`,
    [row.stock_item_id, row.name, row.stock_unit, row.carries_over, now],
  );
  return stockItemRow(rows[0]!);
}

// §6 lock order 5: the §6.8 target.
export async function lockStockItem(repo: TenantLevelRepository, stockItemId: string): Promise<StockItemRecord | undefined> {
  const rows = await repo.query<RawStockItem>(
    `SELECT ${STOCK_ITEM_COLUMNS} FROM stock_items WHERE tenant_id = $1 AND stock_item_id = $2 FOR UPDATE`,
    [stockItemId],
  );
  return rows[0] === undefined ? undefined : stockItemRow(rows[0]);
}

export async function updateStockItem(repo: TenantLevelRepository, row: StockItemRecord, now: number): Promise<StockItemRecord> {
  const rows = await repo.query<RawStockItem>(
    `UPDATE stock_items SET name = $3, stock_unit = $4, carries_over = $5, archived_at = $6, updated_at = $7
      WHERE tenant_id = $1 AND stock_item_id = $2
      RETURNING ${STOCK_ITEM_COLUMNS}`,
    [row.stock_item_id, row.name, row.stock_unit, row.carries_over, row.archived_at, now],
  );
  return stockItemRow(rows[0]!);
}

// §6.6 statement 2: the active or the archived stock items, by lower(name), then id (C3).
export async function selectStockItems(repo: TenantLevelRepository, o: { archived: boolean }): Promise<StockItemRecord[]> {
  const rows = await repo.query<RawStockItem>(
    `SELECT ${STOCK_ITEM_COLUMNS} FROM stock_items
      WHERE tenant_id = $1 AND archived_at IS ${o.archived ? 'NOT NULL' : 'NULL'}
      ORDER BY lower(name), stock_item_id`,
  );
  return rows.map(stockItemRow);
}

export interface StockItemBranchRecord {
  stock_item_id: string;
  branch_id: string;
  station_id: string;
  low_stock_threshold: number | null;
}

// §6.6 statement 3: the stored branch rows of these stock items at the JWT's allowed branches ($2).
export async function selectStockItemBranches(repo: TenantScopedRepository, stockItemIds: string[]): Promise<StockItemBranchRecord[]> {
  return repo.query<StockItemBranchRecord>(
    `SELECT stock_item_id, branch_id, station_id, low_stock_threshold FROM stock_item_branches
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND stock_item_id = ANY($3)
      ORDER BY stock_item_id, branch_id`,
    [stockItemIds],
  );
}

export interface DrawerRecord {
  stock_item_id: string;
  item_id: string;
  name: string;
  variant_name: string | null;
  sale_unit: StockItemRow['stock_unit'];
  quantity_per_sale_unit: number;
}

// §6.6 statement 4 and §6.8 R1 / R2: the active items drawing from these stock items, a plain read (no lock),
// by stock item, then lower(name), then item_id (C3).
export async function selectActiveDrawers(repo: TenantLevelRepository, stockItemIds: string[]): Promise<DrawerRecord[]> {
  return repo.query<DrawerRecord>(
    `SELECT d.stock_item_id, d.item_id, m.name, m.variant_name, m.sale_unit, d.quantity_per_sale_unit
       FROM stock_draws d
       JOIN menu_items m ON m.tenant_id = d.tenant_id AND m.item_id = d.item_id
      WHERE d.tenant_id = $1 AND d.stock_item_id = ANY($2) AND m.archived_at IS NULL
      ORDER BY d.stock_item_id, lower(m.name), d.item_id`,
    [stockItemIds],
  );
}

// §6.9 (C2, inside the transaction): the path branch among the JWT's allowed branches ($2), a plain read.
export async function branchAllowed(repo: TenantScopedRepository, branchId: string): Promise<boolean> {
  const rows = await repo.query<{ branch_id: string }>(
    `SELECT branch_id FROM branches WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3`,
    [branchId],
  );
  return rows.length === 1;
}

// §6.9 (v0.5, P3): the stored row, read without a lock (the stock item FOR UPDATE serialises every write to it).
export async function selectStockItemBranch(
  repo: TenantScopedRepository,
  stockItemId: string,
  branchId: string,
): Promise<StockItemBranchRecord | undefined> {
  const rows = await repo.query<StockItemBranchRecord>(
    `SELECT stock_item_id, branch_id, station_id, low_stock_threshold FROM stock_item_branches
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND stock_item_id = $4`,
    [branchId, stockItemId],
  );
  return rows[0];
}

// §6 lock order 9: the row written (its own row lock), after the station FOR SHARE.
export async function upsertStockItemBranch(
  repo: TenantScopedRepository,
  row: StockItemBranchRecord,
  now: number,
): Promise<StockItemBranchRecord> {
  const rows = await repo.query<StockItemBranchRecord>(
    `INSERT INTO stock_item_branches (tenant_id, branch_id, stock_item_id, station_id, low_stock_threshold, updated_at)
     SELECT tenant_id, branch_id, $4, $5, $6, $7 FROM branches WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3
     ON CONFLICT (tenant_id, branch_id, stock_item_id)
       DO UPDATE SET station_id = EXCLUDED.station_id, low_stock_threshold = EXCLUDED.low_stock_threshold, updated_at = EXCLUDED.updated_at
     RETURNING stock_item_id, branch_id, station_id, low_stock_threshold`,
    [row.branch_id, row.stock_item_id, row.station_id, row.low_stock_threshold, now],
  );
  return rows[0]!;
}

export async function deleteStockItemBranch(repo: TenantScopedRepository, stockItemId: string, branchId: string): Promise<void> {
  await repo.query(
    `DELETE FROM stock_item_branches WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3 AND stock_item_id = $4`,
    [branchId, stockItemId],
  );
}

// -------------------------------------------------------------------------------------------- modifier groups

// §6 lock order 4 (§6.11): the linked and target items FOR SHARE in one = ANY, by item_id. An unknown or
// another tenant's id is simply not returned.
export async function shareItemsById(
  repo: TenantLevelRepository,
  itemIds: readonly string[],
): Promise<Array<{ item_id: string; sale_unit: string; requires_weighing: boolean; archived_at: number | null }>> {
  const rows = await repo.query<{ item_id: string; sale_unit: string; requires_weighing: boolean; archived_at: string | null }>(
    `SELECT item_id, sale_unit, requires_weighing, archived_at FROM menu_items
      WHERE tenant_id = $1 AND item_id = ANY($2)
      ORDER BY item_id
      FOR SHARE`,
    [itemIds],
  );
  return rows.map((row) => ({ ...row, archived_at: row.archived_at === null ? null : Number(row.archived_at) }));
}

// §6 lock order 6 (§6.11): the target categories FOR SHARE in one = ANY, by category_id.
export async function shareCategoriesById(
  repo: TenantLevelRepository,
  categoryIds: readonly string[],
): Promise<Array<{ category_id: string; archived_at: number | null }>> {
  const rows = await repo.query<{ category_id: string; archived_at: string | null }>(
    `SELECT category_id, archived_at FROM categories
      WHERE tenant_id = $1 AND category_id = ANY($2)
      ORDER BY category_id
      FOR SHARE`,
    [categoryIds],
  );
  return rows.map((row) => ({ category_id: row.category_id, archived_at: row.archived_at === null ? null : Number(row.archived_at) }));
}

// §3.3, V14 (m13): option names are unique among the group's active options by Postgres lower(), in one statement:
// the first name (in list order) whose lower() equals an earlier one's, as sent; undefined when all differ.
export async function firstRepeatedName(repo: TenantLevelRepository, names: readonly string[]): Promise<string | undefined> {
  const rows = await repo.query<{ name: string }>(
    `SELECT n.name FROM tenants t, unnest($2::text[]) WITH ORDINALITY AS n (name, i)
      WHERE t.tenant_id = $1
        AND EXISTS (SELECT 1 FROM unnest($2::text[]) WITH ORDINALITY AS m (name, j) WHERE m.j < n.i AND lower(m.name) = lower(n.name))
      ORDER BY n.i
      LIMIT 1`,
    [names],
  );
  return rows[0]?.name;
}

export type ModifierGroupRecord = Omit<ModifierGroupRow, 'options' | 'links' | 'archived_at'> & { archived_at: number | null };

// §6.11: insert, no lock (the name index → 23505 modifier_groups_active_name).
export async function insertModifierGroup(
  repo: TenantLevelRepository,
  row: Omit<ModifierGroupRecord, 'archived_at'>,
  now: number,
): Promise<ModifierGroupRecord> {
  const rows = await repo.query<Omit<ModifierGroupRecord, 'archived_at'> & { archived_at: string | null }>(
    `INSERT INTO modifier_groups (tenant_id, modifier_group_id, name, min_choices, max_choices, sort_order, created_at, updated_at)
     SELECT tenant_id, $2, $3, $4, $5, $6, $7, $7 FROM tenants WHERE tenant_id = $1
     RETURNING modifier_group_id, name, min_choices, max_choices, sort_order, archived_at`,
    [row.modifier_group_id, row.name, row.min_choices, row.max_choices, row.sort_order, now],
  );
  const inserted = rows[0]!;
  return { ...inserted, archived_at: inserted.archived_at === null ? null : Number(inserted.archived_at) };
}

// §6.11: the group's options, one multi-row INSERT (BIGINT price as a JSON number through Number()).
export async function insertModifierOptions(
  repo: TenantLevelRepository,
  modifierGroupId: string,
  options: ReadonlyArray<Omit<ModifierOptionRow, 'archived_at'>>,
): Promise<ModifierOptionRow[]> {
  type Raw = Omit<ModifierOptionRow, 'price_minor' | 'archived_at'> & { price_minor: string | null; archived_at: string | null };
  const rows = await repo.query<Raw>(
    `INSERT INTO modifier_options
       (tenant_id, option_id, modifier_group_id, name, price_minor, max_quantity, is_default, linked_item_id, sort_order)
     SELECT t.tenant_id, o.option_id, $2, o.name, o.price_minor, o.max_quantity, o.is_default, o.linked_item_id, o.sort_order
       FROM tenants t,
            unnest($3::text[], $4::text[], $5::bigint[], $6::int[], $7::boolean[], $8::text[], $9::int[])
              AS o (option_id, name, price_minor, max_quantity, is_default, linked_item_id, sort_order)
      WHERE t.tenant_id = $1
     RETURNING option_id, name, price_minor, max_quantity, is_default, linked_item_id, sort_order, archived_at`,
    [
      modifierGroupId,
      options.map((o) => o.option_id),
      options.map((o) => o.name),
      options.map((o) => (o.price_minor === null ? null : Number(o.price_minor))),
      options.map((o) => o.max_quantity),
      options.map((o) => o.is_default),
      options.map((o) => o.linked_item_id),
      options.map((o) => o.sort_order),
    ],
  );
  return rows.map((row) => ({
    ...row,
    price_minor: row.price_minor === null ? null : Number(row.price_minor),
    archived_at: row.archived_at === null ? null : Number(row.archived_at),
  }));
}

// §6.11: the group's links, one multi-row INSERT.
export async function insertModifierLinks(
  repo: TenantLevelRepository,
  modifierGroupId: string,
  links: readonly ModifierLinkRow[],
): Promise<ModifierLinkRow[]> {
  return repo.query<ModifierLinkRow>(
    `INSERT INTO modifier_group_links (tenant_id, modifier_group_id, target_kind, target_id, mode)
     SELECT t.tenant_id, $2, l.target_kind, l.target_id, l.mode
       FROM tenants t, unnest($3::text[], $4::text[], $5::text[]) AS l (target_kind, target_id, mode)
      WHERE t.tenant_id = $1
     RETURNING target_kind, target_id, mode`,
    [modifierGroupId, links.map((l) => l.target_kind), links.map((l) => l.target_id), links.map((l) => l.mode)],
  );
}

// A stored link of an active group, with that group's sort_order (V8 ordering).
export type StoredLink = LinkRow & { sort_order: number };

// §6.4, §6.5 R3, §6.2 R3 (V8): the links of active groups that target any of these categories, variant groups or
// items; one plain read (M5: a soft limit, no lock).
export async function selectLinksOfTargets(
  repo: TenantLevelRepository,
  targets: { categoryIds: readonly string[]; variantGroupIds: readonly string[]; itemIds: readonly string[] },
): Promise<StoredLink[]> {
  return repo.query<StoredLink>(
    `SELECT l.modifier_group_id, l.target_kind, l.target_id, l.mode, g.sort_order
       FROM modifier_group_links l
       JOIN modifier_groups g ON g.tenant_id = l.tenant_id AND g.modifier_group_id = l.modifier_group_id
      WHERE l.tenant_id = $1 AND g.archived_at IS NULL
        AND ((l.target_kind = 'category' AND l.target_id = ANY($2))
          OR (l.target_kind = 'variant_group' AND l.target_id = ANY($3))
          OR (l.target_kind = 'item' AND l.target_id = ANY($4)))
      ORDER BY l.modifier_group_id, l.target_kind, l.target_id`,
    [targets.categoryIds, targets.variantGroupIds, targets.itemIds],
  );
}

// An active item a group write reaches, with what its effective set needs.
export interface AffectedItem extends EffectiveSetItem {
  category_active: boolean;
  variant_group_active: boolean;
  links: StoredLink[];
}

// §6.11 effective-set read (one statement, M5 plain read): the active items these attach targets reach (the items,
// the members of the variant groups, the items of the categories), each with the stored links of active groups that
// reach it and whether its category and variant group are active; by item_id.
export async function selectAffectedItems(
  repo: TenantLevelRepository,
  targets: { categoryIds: readonly string[]; variantGroupIds: readonly string[]; itemIds: readonly string[] },
): Promise<AffectedItem[]> {
  return repo.query<AffectedItem>(
    `WITH affected AS (
       SELECT m.item_id, m.category_id, m.variant_group_id FROM menu_items m
        WHERE m.tenant_id = $1 AND m.archived_at IS NULL
          AND (m.item_id = ANY($4) OR m.variant_group_id = ANY($3) OR m.category_id = ANY($2))
     )
     SELECT a.item_id, a.category_id, a.variant_group_id,
            c.archived_at IS NULL AS category_active,
            (v.variant_group_id IS NOT NULL AND v.archived_at IS NULL) AS variant_group_active,
            COALESCE(
              json_agg(json_build_object('modifier_group_id', l.modifier_group_id, 'target_kind', l.target_kind,
                                         'target_id', l.target_id, 'mode', l.mode, 'sort_order', l.sort_order)
                       ORDER BY l.modifier_group_id, l.target_kind) FILTER (WHERE l.modifier_group_id IS NOT NULL),
              '[]') AS links
       FROM affected a
       JOIN categories c ON c.tenant_id = $1 AND c.category_id = a.category_id
       LEFT JOIN variant_groups v ON v.tenant_id = $1 AND v.variant_group_id = a.variant_group_id
       LEFT JOIN (SELECT gl.modifier_group_id, gl.target_kind, gl.target_id, gl.mode, g.sort_order
                    FROM modifier_group_links gl
                    JOIN modifier_groups g ON g.tenant_id = gl.tenant_id AND g.modifier_group_id = gl.modifier_group_id
                   WHERE gl.tenant_id = $1 AND g.archived_at IS NULL) l
         ON (l.target_kind = 'item' AND l.target_id = a.item_id)
         OR (l.target_kind = 'variant_group' AND l.target_id = a.variant_group_id)
         OR (l.target_kind = 'category' AND l.target_id = a.category_id)
      GROUP BY a.item_id, a.category_id, a.variant_group_id, c.archived_at, v.variant_group_id, v.archived_at
      ORDER BY a.item_id`,
    [targets.categoryIds, targets.variantGroupIds, targets.itemIds],
  );
}

type RawModifierGroup = Omit<ModifierGroupRecord, 'archived_at'> & { archived_at: string | null };
type RawOption = Omit<ModifierOptionRow, 'price_minor' | 'archived_at'> & { price_minor: string | null; archived_at: string | null };
const MODIFIER_GROUP_COLUMNS = 'modifier_group_id, name, min_choices, max_choices, sort_order, archived_at';
const OPTION_COLUMNS = 'option_id, name, price_minor, max_quantity, is_default, linked_item_id, sort_order, archived_at';

function modifierGroupRow(row: RawModifierGroup): ModifierGroupRecord {
  return { ...row, archived_at: row.archived_at === null ? null : Number(row.archived_at) };
}

function optionRow(row: RawOption): ModifierOptionRow {
  return {
    ...row,
    price_minor: row.price_minor === null ? null : Number(row.price_minor),
    archived_at: row.archived_at === null ? null : Number(row.archived_at),
  };
}

// §6 lock order 1: the §6.12 / §6.12a target.
export async function lockModifierGroup(repo: TenantLevelRepository, modifierGroupId: string): Promise<ModifierGroupRecord | undefined> {
  const rows = await repo.query<RawModifierGroup>(
    `SELECT ${MODIFIER_GROUP_COLUMNS} FROM modifier_groups WHERE tenant_id = $1 AND modifier_group_id = $2 FOR UPDATE`,
    [modifierGroupId],
  );
  return rows[0] === undefined ? undefined : modifierGroupRow(rows[0]);
}

export async function updateModifierGroup(repo: TenantLevelRepository, row: ModifierGroupRecord, now: number): Promise<ModifierGroupRecord> {
  const rows = await repo.query<RawModifierGroup>(
    `UPDATE modifier_groups SET name = $3, min_choices = $4, max_choices = $5, sort_order = $6, archived_at = $7, updated_at = $8
      WHERE tenant_id = $1 AND modifier_group_id = $2
      RETURNING ${MODIFIER_GROUP_COLUMNS}`,
    [row.modifier_group_id, row.name, row.min_choices, row.max_choices, row.sort_order, row.archived_at, now],
  );
  return modifierGroupRow(rows[0]!);
}

// Every option (active and archived) of these groups, one = ANY, by group then option_id.
export async function selectModifierOptions(
  repo: TenantLevelRepository,
  modifierGroupIds: readonly string[],
): Promise<Array<ModifierOptionRow & { modifier_group_id: string }>> {
  const rows = await repo.query<RawOption & { modifier_group_id: string }>(
    `SELECT modifier_group_id, ${OPTION_COLUMNS} FROM modifier_options
      WHERE tenant_id = $1 AND modifier_group_id = ANY($2)
      ORDER BY modifier_group_id, option_id`,
    [modifierGroupIds],
  );
  return rows.map((row) => ({ ...optionRow(row), modifier_group_id: row.modifier_group_id }));
}

// The links of these groups, one = ANY.
export async function selectModifierLinks(
  repo: TenantLevelRepository,
  modifierGroupIds: readonly string[],
): Promise<Array<ModifierLinkRow & { modifier_group_id: string }>> {
  return repo.query<ModifierLinkRow & { modifier_group_id: string }>(
    `SELECT modifier_group_id, target_kind, target_id, mode FROM modifier_group_links
      WHERE tenant_id = $1 AND modifier_group_id = ANY($2)
      ORDER BY modifier_group_id, target_kind, target_id`,
    [modifierGroupIds],
  );
}

// §6.12, V14: the sent options in one multi-row INSERT … ON CONFLICT (tenant_id, option_id) DO UPDATE (a sent id is
// an option of this group, checked before; a restored one gets archived_at null), so modifier_option_branches rows
// that reference an option survive every edit.
export async function upsertModifierOptions(
  repo: TenantLevelRepository,
  modifierGroupId: string,
  options: ReadonlyArray<Omit<ModifierOptionRow, 'archived_at'>>,
): Promise<void> {
  await repo.query(
    `INSERT INTO modifier_options
       (tenant_id, option_id, modifier_group_id, name, price_minor, max_quantity, is_default, linked_item_id, sort_order)
     SELECT t.tenant_id, o.option_id, $2, o.name, o.price_minor, o.max_quantity, o.is_default, o.linked_item_id, o.sort_order
       FROM tenants t,
            unnest($3::text[], $4::text[], $5::bigint[], $6::int[], $7::boolean[], $8::text[], $9::int[])
              AS o (option_id, name, price_minor, max_quantity, is_default, linked_item_id, sort_order)
      WHERE t.tenant_id = $1
     ON CONFLICT (tenant_id, option_id) DO UPDATE
        SET name = EXCLUDED.name, price_minor = EXCLUDED.price_minor, max_quantity = EXCLUDED.max_quantity,
            is_default = EXCLUDED.is_default, linked_item_id = EXCLUDED.linked_item_id, sort_order = EXCLUDED.sort_order,
            archived_at = NULL
      WHERE modifier_options.modifier_group_id = EXCLUDED.modifier_group_id`,
    [
      modifierGroupId,
      options.map((o) => o.option_id),
      options.map((o) => o.name),
      options.map((o) => (o.price_minor === null ? null : Number(o.price_minor))),
      options.map((o) => o.max_quantity),
      options.map((o) => o.is_default),
      options.map((o) => o.linked_item_id),
      options.map((o) => o.sort_order),
    ],
  );
}

// §6.12, V14: the group's active options left out of the sent list are archived (never deleted).
export async function archiveOmittedOptions(
  repo: TenantLevelRepository,
  modifierGroupId: string,
  keptOptionIds: readonly string[],
  now: number,
): Promise<void> {
  await repo.query(
    `UPDATE modifier_options SET archived_at = $3
      WHERE tenant_id = $1 AND modifier_group_id = $2 AND archived_at IS NULL AND NOT (option_id = ANY($4))`,
    [modifierGroupId, now, keptOptionIds],
  );
}

// §6.12, V14: links are rewritten, one DELETE then one multi-row INSERT (insertModifierLinks).
export async function deleteModifierLinks(repo: TenantLevelRepository, modifierGroupId: string): Promise<void> {
  await repo.query(`DELETE FROM modifier_group_links WHERE tenant_id = $1 AND modifier_group_id = $2`, [modifierGroupId]);
}

export type OptionBranchRecord = ModifierOptionBranchRow & { branch_id: string; modifier_group_id: string };

// V19: the stored difference rows of these groups' options (active and archived; the wire keeps the active ones)
// at the JWT's allowed branches ($2), one statement, by group, branch, option.
export async function selectOptionBranches(repo: TenantScopedRepository, modifierGroupIds: readonly string[]): Promise<OptionBranchRecord[]> {
  const rows = await repo.query<Omit<OptionBranchRecord, 'price_minor_override'> & { price_minor_override: string | null }>(
    `SELECT o.modifier_group_id, b.branch_id, b.option_id, b.is_offered, b.price_minor_override
       FROM modifier_option_branches b
       JOIN modifier_options o ON o.tenant_id = b.tenant_id AND o.option_id = b.option_id
      WHERE b.tenant_id = $1 AND b.branch_id = ANY($2) AND o.modifier_group_id = ANY($3)
      ORDER BY o.modifier_group_id, b.branch_id, b.option_id`,
    [modifierGroupIds],
  );
  return rows.map((row) => ({ ...row, price_minor_override: row.price_minor_override === null ? null : Number(row.price_minor_override) }));
}

// §6.10 statement 2: the active or the archived groups, by sort_order, then id.
export async function selectModifierGroups(repo: TenantLevelRepository, o: { archived: boolean }): Promise<ModifierGroupRecord[]> {
  const rows = await repo.query<RawModifierGroup>(
    `SELECT ${MODIFIER_GROUP_COLUMNS} FROM modifier_groups
      WHERE tenant_id = $1 AND archived_at IS ${o.archived ? 'NOT NULL' : 'NULL'}
      ORDER BY sort_order, modifier_group_id`,
  );
  return rows.map(modifierGroupRow);
}

// §6.12a (P3): the stored difference rows of the group's ACTIVE options at this branch (the version input, V19),
// read without a lock (the group FOR UPDATE serialises every write to them), by option_id.
export async function selectActiveOptionBranchRows(
  repo: TenantScopedRepository,
  modifierGroupId: string,
  branchId: string,
): Promise<ModifierOptionBranchRow[]> {
  const rows = await repo.query<Omit<ModifierOptionBranchRow, 'price_minor_override'> & { price_minor_override: string | null }>(
    `SELECT b.option_id, b.is_offered, b.price_minor_override
       FROM modifier_option_branches b
       JOIN modifier_options o ON o.tenant_id = b.tenant_id AND o.option_id = b.option_id
      WHERE b.tenant_id = $1 AND b.branch_id = ANY($2) AND b.branch_id = $3
        AND o.modifier_group_id = $4 AND o.archived_at IS NULL
      ORDER BY b.option_id`,
    [branchId, modifierGroupId],
  );
  return rows.map((row) => ({ ...row, price_minor_override: row.price_minor_override === null ? null : Number(row.price_minor_override) }));
}

// §6.12a payload check: which of these ids are active options of the group (one = ANY).
export async function selectActiveOptionIds(
  repo: TenantLevelRepository,
  modifierGroupId: string,
  optionIds: readonly string[],
): Promise<string[]> {
  const rows = await repo.query<{ option_id: string }>(
    `SELECT option_id FROM modifier_options
      WHERE tenant_id = $1 AND modifier_group_id = $2 AND archived_at IS NULL AND option_id = ANY($3)`,
    [modifierGroupId, optionIds],
  );
  return rows.map((row) => row.option_id);
}

// §6.12a (v0.3 m4): the rows of the group's active options at this branch are deleted; rows of archived options stay.
export async function deleteActiveOptionBranchRows(repo: TenantScopedRepository, modifierGroupId: string, branchId: string): Promise<void> {
  await repo.query(
    `DELETE FROM modifier_option_branches b
      USING modifier_options o
      WHERE b.tenant_id = $1 AND b.branch_id = ANY($2) AND b.branch_id = $3
        AND o.tenant_id = b.tenant_id AND o.option_id = b.option_id AND o.modifier_group_id = $4 AND o.archived_at IS NULL`,
    [branchId, modifierGroupId],
  );
}

// §6.12a: the normalised difference rows (lock order 9, the rows' own locks), one multi-row INSERT.
export async function insertOptionBranchRows(
  repo: TenantScopedRepository,
  branchId: string,
  rows: readonly ModifierOptionBranchRow[],
  now: number,
): Promise<void> {
  await repo.query(
    `INSERT INTO modifier_option_branches (tenant_id, branch_id, option_id, is_offered, price_minor_override, updated_at)
     SELECT br.tenant_id, br.branch_id, r.option_id, r.is_offered, r.price_minor_override, $7
       FROM branches br, unnest($4::text[], $5::boolean[], $6::bigint[]) AS r (option_id, is_offered, price_minor_override)
      WHERE br.tenant_id = $1 AND br.branch_id = ANY($2) AND br.branch_id = $3`,
    [
      branchId,
      rows.map((r) => r.option_id),
      rows.map((r) => r.is_offered),
      rows.map((r) => (r.price_minor_override === null ? null : Number(r.price_minor_override))),
      now,
    ],
  );
}
