import type { InventorySnapshot } from '@pos/events';
import type { TenantSql } from '../../lib/config-version.js';

// 08 v1.1 Part B §5.3, B15 (08b AD-1): the five reads of the snapshot `inventory` key. A function of the stored rows
// only (M-2): no statement takes a time, so one config_version always builds one body and one hash. BIGINT values
// leave Postgres as text (m-16); millisecond times become numbers here. Array order is the builder's (in JS, m-1).

type Big = string | number;
const ms = (x: Big): number => Number(BigInt(String(x)));

// +∞ for a null valid_until_at on both sides of the dominance rule (n-1): the BIGINT maximum. No route can store it
// (08a §5.1 CHECK: valid_until_at ≤ created_at + 30 days), so it never ties with a real expiry.
const OPEN_END = '9223372036854775807';

// B15 (b): the active stock items, every kind.
export function selectSnapshotItems(db: TenantSql): Promise<InventorySnapshot['items']> {
  return db.query(
    `SELECT stock_item_id, kind, name, code, stock_unit, cost_category, is_a_item FROM stock_items
      WHERE tenant_id = $1 AND archived_at IS NULL`,
  );
}

// B15 (d), 08a I5 step 2: per active item and unit name, the latest unit row whose base is the item's current stock_unit.
export function selectSnapshotUnits(db: TenantSql): Promise<InventorySnapshot['units']> {
  return db.query(
    `SELECT DISTINCT ON (u.stock_item_id, u.unit_name)
            u.stock_item_id, u.unit_name, u.factor_num::text AS factor_num, u.factor_den::text AS factor_den
       FROM stock_item_units u
       JOIN stock_items s ON s.tenant_id = u.tenant_id AND s.stock_item_id = u.stock_item_id
      WHERE u.tenant_id = $1 AND s.archived_at IS NULL AND u.base_unit = s.stock_unit
      ORDER BY u.stock_item_id, u.unit_name, u.created_at DESC, u.unit_row_id COLLATE "C" DESC`,
  );
}

interface RawPrice {
  price_id: string;
  stock_item_id: string;
  branch_id: string | null;
  kind: 'manual' | 'market_rate';
  unit_name: string;
  stock_unit: 'piece' | 'g' | 'ml';
  price_minor: string;
  stock_qty_num: string;
  stock_qty_den: string;
  created_at: Big;
  valid_until_at: Big | null;
}

// B15 (a), N-3: the builder's own, time-free price read (never 08a's selectPriceCandidates, which filters for a
// `now`). Per active item and scope (every branch: branch_id null; this branch), among the rows in the item's current
// stock_unit, a row is dominated when a newer row (created_at, then price_id: 08a I7's order) of the same item and
// scope has valid_until_at ≥ its own (null = +∞ on both sides); the rest are sent. One window query: the largest
// valid_until_at among the strictly newer rows of the partition.
export async function selectSnapshotPrices(db: TenantSql, branchId: string): Promise<InventorySnapshot['prices']> {
  const rows = await db.query<RawPrice>(
    `SELECT price_id, stock_item_id, branch_id, kind, unit_name, stock_unit, price_minor, stock_qty_num, stock_qty_den,
            created_at, valid_until_at
       FROM (SELECT p.price_id, p.stock_item_id, p.branch_id, p.kind, p.unit_name, p.stock_unit,
                    p.price_minor::text AS price_minor, p.stock_qty_num::text AS stock_qty_num,
                    p.stock_qty_den::text AS stock_qty_den, p.created_at, p.valid_until_at,
                    MAX(COALESCE(p.valid_until_at, ${OPEN_END})) OVER (
                      PARTITION BY p.stock_item_id, p.branch_id
                      ORDER BY p.created_at DESC, p.price_id COLLATE "C" DESC
                      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS newer_until
               FROM item_prices p
               JOIN stock_items s ON s.tenant_id = p.tenant_id AND s.stock_item_id = p.stock_item_id
              WHERE p.tenant_id = $1 AND s.archived_at IS NULL AND p.stock_unit = s.stock_unit
                AND (p.branch_id IS NULL OR p.branch_id = $2)) w
      WHERE newer_until IS NULL OR newer_until < COALESCE(valid_until_at, ${OPEN_END})`,
    [branchId],
  );
  return rows.map((row) => ({
    ...row,
    created_at: ms(row.created_at),
    valid_until_at: row.valid_until_at === null ? null : ms(row.valid_until_at),
  }));
}

// B15 (d), 08a I8: the active (latest) yield profile of each active ingredient.
export function selectSnapshotYields(db: TenantSql): Promise<InventorySnapshot['yields']> {
  return db.query(
    `SELECT DISTINCT ON (y.stock_item_id) y.stock_item_id, y.yield_bp
       FROM yield_profiles y
       JOIN stock_items s ON s.tenant_id = y.tenant_id AND s.stock_item_id = y.stock_item_id
      WHERE y.tenant_id = $1 AND s.archived_at IS NULL AND s.kind = 'ingredient'
      ORDER BY y.stock_item_id, y.created_at DESC, y.yield_profile_id COLLATE "C" DESC`,
  );
}

type RawVersion = Omit<InventorySnapshot['recipes'][number], 'published_at'> & { published_at: Big };

// B15 (e), m-20, t-7 b, T-2, N-1: per recipe the published version and its up to 3 most recent superseded ones
// (ROW_NUMBER ≤ 4: the published one first, then by published_at, then id), archived recipes included and flagged; the owner filter is the builder
// backstop (M-4): a menu item (active or archived), a plain modifier option, a prepared stock item. Each version's
// lines with their frozen stock_unit, aggregated in line_no order (json_agg: one statement).
export async function selectSnapshotRecipes(db: TenantSql): Promise<InventorySnapshot['recipes']> {
  const rows = await db.query<RawVersion>(
    `SELECT v.recipe_version_id, v.status, r.owner_type, r.owner_id, v.basis, v.base_qty, v.measure_unit,
            r.archived_at IS NOT NULL AS recipe_archived, v.batch_yield_qty::text AS batch_yield_qty, v.batch_stock_unit,
            v.misc_allowance_bp, v.published_at,
            COALESCE((SELECT json_agg(json_build_object(
                               'stock_item_id', l.stock_item_id, 'stock_qty_num', l.stock_qty_num::text,
                               'stock_qty_den', l.stock_qty_den::text, 'stock_unit', l.stock_unit, 'qty_basis', l.qty_basis)
                             ORDER BY l.line_no)
                        FROM recipe_lines l
                       WHERE l.tenant_id = v.tenant_id AND l.recipe_version_id = v.recipe_version_id), '[]'::json) AS lines
       FROM (SELECT rv.*, ROW_NUMBER() OVER (
                      PARTITION BY rv.recipe_id
                      ORDER BY (rv.status = 'published') DESC, rv.published_at DESC, rv.recipe_version_id COLLATE "C" DESC) AS recent
               FROM recipe_versions rv
              WHERE rv.tenant_id = $1 AND rv.status IN ('published', 'superseded')) v
       JOIN recipes r ON r.tenant_id = v.tenant_id AND r.recipe_id = v.recipe_id
      WHERE v.recent <= 4
        AND CASE r.owner_type
              WHEN 'menu_item' THEN EXISTS (SELECT 1 FROM menu_items m WHERE m.tenant_id = r.tenant_id AND m.item_id = r.owner_id)
              WHEN 'modifier_option' THEN EXISTS (SELECT 1 FROM modifier_options o
                                                   WHERE o.tenant_id = r.tenant_id AND o.option_id = r.owner_id AND o.linked_item_id IS NULL)
              WHEN 'stock_item' THEN EXISTS (SELECT 1 FROM stock_items s
                                              WHERE s.tenant_id = r.tenant_id AND s.stock_item_id = r.owner_id AND s.kind = 'prepared')
              ELSE false
            END`,
  );
  return rows.map((row) => ({ ...row, published_at: ms(row.published_at) }));
}
