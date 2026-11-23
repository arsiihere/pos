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

// ----------------------------------------------------------------------------------------------- §6.6 prices

// ----------------------------------------------------------------------------------------------- §6.7 yields
