import type { ItemUnitRow, PriceRow, YieldRow } from '@pos/domain';
import type { TenantSql } from '../../lib/config-version.js';
import type { StockItemRow } from '../menu-variants/versions.js';

// 08a §5.1, §6.4–§6.7: the SQL of the inventory module (stock_item_units, item_prices, yield_profiles; append-only,
// I4 / I6 / I8: this file has no UPDATE or DELETE on them, test 34). Tenant SQL goes through TenantLevelRepository
// (`tenant_id = $1`). BIGINT columns reach here as strings and are read with BigInt(String(x)), never Number()
// (m-12); millisecond timestamps go through BigInt too, then to a number for the wire.

// ------------------------------------------------------------------------------------------------- records

export type StockItemRecord = Omit<StockItemRow, 'archived_at'> & { archived_at: number | null };

export interface ItemUnitRecord extends ItemUnitRow {
  note: string | null;
  recorded_by: string;
}

export interface ItemPriceRecord extends PriceRow {
  note: string | null;
  recorded_by: string;
}

export interface YieldProfileRecord extends YieldRow {
  test_ap_qty: bigint | null;
  test_ep_qty: bigint | null;
  test_unit: ItemUnitRow['base_unit'] | null;
  note: string | null;
  recorded_by: string;
}

type Big = string | number | bigint;

const big = (x: Big): bigint => BigInt(String(x));
const bigOrNull = (x: Big | null): bigint | null => (x === null ? null : big(x));
const ms = (x: Big): number => Number(big(x));
const msOrNull = (x: Big | null): number | null => (x === null ? null : ms(x));

// The C-7 stock-item columns (menu-variants STOCK_ITEM_COLUMNS, which that module does not export).
const STOCK_ITEM_COLUMNS = 'stock_item_id, name, stock_unit, carries_over, archived_at, kind, code, cost_category, is_a_item';

type RawStockItem = Omit<StockItemRecord, 'archived_at'> & { archived_at: Big | null };

function stockItemRecord(row: RawStockItem): StockItemRecord {
  return { ...row, archived_at: msOrNull(row.archived_at) };
}

const UNIT_COLUMNS = 'unit_row_id, unit_name, base_unit, factor_num, factor_den, note, recorded_by, created_at';

type RawUnit = Omit<ItemUnitRecord, 'factor_num' | 'factor_den' | 'created_at'> & { factor_num: Big; factor_den: Big; created_at: Big };

export function itemUnitRecord(row: RawUnit): ItemUnitRecord {
  return { ...row, factor_num: big(row.factor_num), factor_den: big(row.factor_den), created_at: ms(row.created_at) };
}

const PRICE_COLUMNS =
  'price_id, branch_id, kind, unit_name, price_minor, stock_qty_num, stock_qty_den, stock_unit, created_at, valid_until_at, note, recorded_by';

type RawPrice = Omit<ItemPriceRecord, 'price_minor' | 'stock_qty_num' | 'stock_qty_den' | 'created_at' | 'valid_until_at'> & {
  price_minor: Big;
  stock_qty_num: Big;
  stock_qty_den: Big;
  created_at: Big;
  valid_until_at: Big | null;
};

export function itemPriceRecord(row: RawPrice): ItemPriceRecord {
  return {
    ...row,
    price_minor: big(row.price_minor),
    stock_qty_num: big(row.stock_qty_num),
    stock_qty_den: big(row.stock_qty_den),
    created_at: ms(row.created_at),
    valid_until_at: msOrNull(row.valid_until_at),
  };
}

const YIELD_COLUMNS = 'yield_profile_id, yield_bp, test_ap_qty, test_ep_qty, test_unit, note, recorded_by, created_at';

type RawYield = Omit<YieldProfileRecord, 'test_ap_qty' | 'test_ep_qty' | 'created_at'> & {
  test_ap_qty: Big | null;
  test_ep_qty: Big | null;
  created_at: Big;
};

export function yieldProfileRecord(row: RawYield): YieldProfileRecord {
  return {
    ...row,
    yield_bp: Number(row.yield_bp), // INT column
    test_ap_qty: bigOrNull(row.test_ap_qty),
    test_ep_qty: bigOrNull(row.test_ep_qty),
    created_at: ms(row.created_at),
  };
}

// ------------------------------------------------------------------------------------- §6.4 detail (reads)

export const PRICE_HISTORY_LIMIT = 100;
export const YIELD_HISTORY_LIMIT = 20;

// §6.4 statement 2: the stock item, active or archived; undefined = unknown or another tenant's.
export async function selectStockItem(db: TenantSql, stockItemId: string): Promise<StockItemRecord | undefined> {
  const rows = await db.query<RawStockItem>(`SELECT ${STOCK_ITEM_COLUMNS} FROM stock_items WHERE tenant_id = $1 AND stock_item_id = $2`, [
    stockItemId,
  ]);
  return rows[0] === undefined ? undefined : stockItemRecord(rows[0]);
}

// §6.4 statement 3: every unit row of the item, newest first (created_at, then id; I4).
export async function selectItemUnits(db: TenantSql, stockItemId: string): Promise<ItemUnitRecord[]> {
  const rows = await db.query<RawUnit>(
    `SELECT ${UNIT_COLUMNS} FROM stock_item_units
      WHERE tenant_id = $1 AND stock_item_id = $2
      ORDER BY created_at DESC, unit_row_id DESC`,
    [stockItemId],
  );
  return rows.map(itemUnitRecord);
}

// §6.4 statement 4: the price history, every branch's, newest 100 (created_at, then id; item_prices_item).
export async function selectPriceHistory(db: TenantSql, stockItemId: string): Promise<ItemPriceRecord[]> {
  const rows = await db.query<RawPrice>(
    `SELECT ${PRICE_COLUMNS} FROM item_prices
      WHERE tenant_id = $1 AND stock_item_id = $2
      ORDER BY created_at DESC, price_id DESC
      LIMIT ${PRICE_HISTORY_LIMIT}`,
    [stockItemId],
  );
  return rows.map(itemPriceRecord);
}

// §6.1 / §6.4 statement 5 (M-3): the price candidates in effect at `now` for these items — the every-branch rows,
// plus the branch's when `branchId` is given. I7 (stock unit, branch set, latest) runs in the service, so
// menu_cost never depends on the history LIMIT.
export async function selectPriceCandidates(
  db: TenantSql,
  stockItemIds: readonly string[],
  branchId: string | null,
  now: number,
): Promise<Array<ItemPriceRecord & { stock_item_id: string }>> {
  const rows = await db.query<RawPrice & { stock_item_id: string }>(
    `SELECT stock_item_id, ${PRICE_COLUMNS} FROM item_prices
      WHERE tenant_id = $1 AND stock_item_id = ANY($2) AND created_at <= $3
        AND (valid_until_at IS NULL OR valid_until_at > $3)
        AND (branch_id IS NULL OR branch_id = $4)
      ORDER BY stock_item_id, created_at DESC, price_id DESC`,
    [stockItemIds, now, branchId],
  );
  return rows.map((row) => ({ ...itemPriceRecord(row), stock_item_id: row.stock_item_id }));
}

// §6.4 statement 6: the newest 20 yield profiles (created_at, then id; yield_profiles_item).
export async function selectYieldProfiles(db: TenantSql, stockItemId: string): Promise<YieldProfileRecord[]> {
  const rows = await db.query<RawYield>(
    `SELECT ${YIELD_COLUMNS} FROM yield_profiles
      WHERE tenant_id = $1 AND stock_item_id = $2
      ORDER BY created_at DESC, yield_profile_id DESC
      LIMIT ${YIELD_HISTORY_LIMIT}`,
    [stockItemId],
  );
  return rows.map(yieldProfileRecord);
}

// §6.4 statement 7 (§5.3): owner display names for recorded_by, by user id. Runs even for no ids (fixed count).
export async function selectOwnerNames(db: TenantSql, userIds: readonly string[]): Promise<Map<string, string>> {
  const rows = await db.query<{ user_id: string; display_name: string }>(
    `SELECT user_id, display_name FROM owner_users WHERE tenant_id = $1 AND user_id = ANY($2)`,
    [[...new Set(userIds)]],
  );
  return new Map(rows.map((row) => [row.user_id, row.display_name]));
}

// ------------------------------------------------------------------------------------------------ §6.5 units

// §6 lock order kind 5 (§6.5 – §6.7): the stock item FOR SHARE, so a concurrent stock-item PATCH (FOR UPDATE:
// archive, stock_unit or kind) serialises with the POST and its rules read the locked row. undefined = unknown or
// another tenant's.
export async function shareStockItem(db: TenantSql, stockItemId: string): Promise<StockItemRecord | undefined> {
  const rows = await db.query<RawStockItem>(
    `SELECT ${STOCK_ITEM_COLUMNS} FROM stock_items WHERE tenant_id = $1 AND stock_item_id = $2 FOR SHARE`,
    [stockItemId],
  );
  return rows[0] === undefined ? undefined : stockItemRecord(rows[0]);
}

// The columns of a `WITH inserted AS (INSERT … RETURNING …)` CTE, qualified for the owner_users join.
export const inserted = (columns: string): string =>
  columns
    .split(', ')
    .map((column) => `inserted.${column}`)
    .join(', ');

export interface NewItemUnit {
  unit_row_id: string;
  stock_item_id: string;
  unit_name: string;
  base_unit: ItemUnitRow['base_unit'];
  factor_num: bigint;
  factor_den: bigint;
  note: string | null;
  recorded_by: string;
  created_at: number;
}

// §6.5 insert (I4, append-only), one statement: the row and the recorder's display_name (§5.3 recorded_by_name).
export async function insertItemUnit(db: TenantSql, row: NewItemUnit): Promise<{ unit: ItemUnitRecord; recordedByName: string }> {
  const rows = await db.query<RawUnit & { recorded_by_name: string }>(
    `WITH inserted AS (
       INSERT INTO stock_item_units (tenant_id, unit_row_id, stock_item_id, unit_name, base_unit, factor_num, factor_den, note, recorded_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${UNIT_COLUMNS})
     SELECT ${inserted(UNIT_COLUMNS)}, owner_users.display_name AS recorded_by_name
       FROM inserted JOIN owner_users ON owner_users.tenant_id = $1 AND owner_users.user_id = inserted.recorded_by`,
    [
      row.unit_row_id,
      row.stock_item_id,
      row.unit_name,
      row.base_unit,
      row.factor_num.toString(),
      row.factor_den.toString(),
      row.note,
      row.recorded_by,
      row.created_at,
    ],
  );
  const { recorded_by_name: recordedByName, ...unit } = rows[0]!;
  return { unit: itemUnitRecord(unit), recordedByName };
}

// ----------------------------------------------------------------------------------------------- §6.6 prices

// C1: the price's branch_id is a body reference — a branch of this tenant (any of them; the price's scope is
// not the writer's, I10). The insert's FK then takes FOR KEY SHARE on that row (after kind 5).
export async function branchExists(db: TenantSql, branchId: string): Promise<boolean> {
  const rows = await db.query(`SELECT 1 FROM branches WHERE tenant_id = $1 AND branch_id = $2`, [branchId]);
  return rows.length > 0;
}

// I5 input: the item's unit rows of this name (every base unit; resolveUnit keeps the stock unit's latest).
export async function selectItemUnitsNamed(db: TenantSql, stockItemId: string, unitName: string): Promise<ItemUnitRecord[]> {
  const rows = await db.query<RawUnit>(
    `SELECT ${UNIT_COLUMNS} FROM stock_item_units
      WHERE tenant_id = $1 AND stock_item_id = $2 AND unit_name = $3
      ORDER BY created_at DESC, unit_row_id DESC`,
    [stockItemId, unitName],
  );
  return rows.map(itemUnitRecord);
}

export interface NewItemPrice {
  price_id: string;
  stock_item_id: string;
  branch_id: string | null;
  kind: ItemPriceRecord['kind'];
  unit_name: string;
  price_minor: bigint;
  stock_qty_num: bigint;
  stock_qty_den: bigint;
  stock_unit: ItemPriceRecord['stock_unit'];
  created_at: number;
  valid_until_at: number | null;
  note: string | null;
  recorded_by: string;
}

// I6: the append-only insert (frozen conversion and stock_unit), returning the row with the recorder's display
// name (§5.3 recorded_by_name) in the same statement.
export async function insertItemPrice(db: TenantSql, p: NewItemPrice): Promise<{ price: ItemPriceRecord; recordedByName: string }> {
  const rows = await db.query<RawPrice & { recorded_by_name: string }>(
    `WITH inserted AS (
       INSERT INTO item_prices (tenant_id, price_id, stock_item_id, branch_id, kind, unit_name, price_minor, stock_qty_num, stock_qty_den,
                                stock_unit, created_at, valid_until_at, note, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING ${PRICE_COLUMNS})
     SELECT ${inserted(PRICE_COLUMNS)}, owner_users.display_name AS recorded_by_name
       FROM inserted JOIN owner_users ON owner_users.tenant_id = $1 AND owner_users.user_id = inserted.recorded_by`,
    [
      p.price_id,
      p.stock_item_id,
      p.branch_id,
      p.kind,
      p.unit_name,
      p.price_minor.toString(),
      p.stock_qty_num.toString(),
      p.stock_qty_den.toString(),
      p.stock_unit,
      p.created_at,
      p.valid_until_at,
      p.note,
      p.recorded_by,
    ],
  );
  const { recorded_by_name: recordedByName, ...price } = rows[0]!;
  return { price: itemPriceRecord(price), recordedByName };
}

// ----------------------------------------------------------------------------------------------- §6.7 yields

export interface NewYieldProfile {
  yield_profile_id: string;
  stock_item_id: string;
  yield_bp: number;
  test_ap_qty: bigint | null;
  test_ep_qty: bigint | null;
  test_unit: ItemUnitRow['base_unit'] | null;
  note: string | null;
  recorded_by: string;
  created_at: number;
}

// §6.7 insert (I8, append-only), one statement: the row and the recorder's display_name (§5.3 recorded_by_name).
export async function insertYieldProfile(db: TenantSql, row: NewYieldProfile): Promise<{ profile: YieldProfileRecord; recordedByName: string }> {
  const rows = await db.query<RawYield & { recorded_by_name: string }>(
    `WITH inserted AS (
       INSERT INTO yield_profiles (tenant_id, yield_profile_id, stock_item_id, yield_bp, test_ap_qty, test_ep_qty, test_unit, note, recorded_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${YIELD_COLUMNS})
     SELECT ${inserted(YIELD_COLUMNS)}, owner_users.display_name AS recorded_by_name
       FROM inserted JOIN owner_users ON owner_users.tenant_id = $1 AND owner_users.user_id = inserted.recorded_by`,
    [
      row.yield_profile_id,
      row.stock_item_id,
      row.yield_bp,
      row.test_ap_qty?.toString() ?? null,
      row.test_ep_qty?.toString() ?? null,
      row.test_unit,
      row.note,
      row.recorded_by,
      row.created_at,
    ],
  );
  const { recorded_by_name: recordedByName, ...profile } = rows[0]!;
  return { profile: yieldProfileRecord(profile), recordedByName };
}
