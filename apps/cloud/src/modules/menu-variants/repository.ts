import type { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import type { TenantScopedRepository } from '../../db/tenant-scoped-repository.js';
import type { StockItemRow, VariantGroupRow } from './versions.js';

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
