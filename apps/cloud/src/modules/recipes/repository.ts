import type { CloudCostRows } from '@pos/domain';
import type { Clock } from '../../lib/clock.js';
import type { TenantSql } from '../../lib/config-version.js';
import type { IdGen } from '../../lib/ids.js';
import { selectPriceCandidates } from '../inventory/repository.js';

// 08 v1.1 Part B §5.1, §6: the SQL of the recipes module (recipes, recipe_versions, recipe_lines). Tenant SQL goes
// through TenantLevelRepository (`tenant_id = $1`). BIGINT columns reach here as strings and are read with
// BigInt(String(x)) (m-12); millisecond timestamps go through BigInt too, then to a number for the wire. Published
// content is append-only: this file has no UPDATE of a non-draft version's lines or fields (§5.1).

type Big = string | number | bigint;
const big = (x: Big): bigint => BigInt(String(x));
const ms = (x: Big): number => Number(big(x));
const msOrNull = (x: Big | null): number | null => (x === null ? null : ms(x));

export type OwnerType = 'menu_item' | 'modifier_option' | 'stock_item';
export type StockUnit = 'piece' | 'g' | 'ml';
export type Basis = 'per_unit' | 'per_measure' | 'per_batch';

// ------------------------------------------------------------------------------------------------- owners

export interface MenuItemOwner {
  owner_type: 'menu_item';
  owner_id: string;
  name: string;
  sale_unit: StockUnit;
  archived_at: number | null;
}

export interface OptionOwner {
  owner_type: 'modifier_option';
  owner_id: string;
  name: string;
  linked_item_id: string | null;
  archived_at: number | null;
}

export interface StockItemRow {
  stock_item_id: string;
  name: string;
  kind: string; // 'prepared' | 'ingredient' | 'packet'
  stock_unit: StockUnit;
  archived_at: number | null;
}

export type StockItemOwner = { owner_type: 'stock_item'; owner_id: string } & StockItemRow;
export type RecipeOwner = MenuItemOwner | OptionOwner | StockItemOwner;

type RawStockItem = Omit<StockItemRow, 'archived_at'> & { archived_at: Big | null };
const STOCK_ITEM_COLUMNS = 'stock_item_id, name, kind, stock_unit, archived_at';
const stockItemRow = (row: RawStockItem): StockItemRow => ({ ...row, archived_at: msOrNull(row.archived_at) });

// §6 lock order kind 4: the menu item owner FOR SHARE (a C-14 sale_unit PATCH takes it FOR UPDATE). undefined =
// unknown or another tenant's.
export async function shareMenuItemOwner(db: TenantSql, itemId: string): Promise<MenuItemOwner | undefined> {
  const rows = await db.query<{ item_id: string; name: string; sale_unit: StockUnit; archived_at: Big | null }>(
    `SELECT item_id, name, sale_unit, archived_at FROM menu_items WHERE tenant_id = $1 AND item_id = $2 FOR SHARE`,
    [itemId],
  );
  const row = rows[0];
  return row === undefined ? undefined : { owner_type: 'menu_item', owner_id: row.item_id, name: row.name, sale_unit: row.sale_unit, archived_at: msOrNull(row.archived_at) };
}

// §6 lock order kind 1: an option owner is read under its modifier group, the group row FOR SHARE (the §6.12 option
// patch takes it FOR UPDATE, C-15). One statement. The option row is locked too (OF g, o): under READ COMMITTED only
// locked rows are re-fetched after the wait, so a §6.12 link committed while we waited is seen (never a stale
// linked_item_id / archived_at).
export async function shareOptionOwner(db: TenantSql, optionId: string): Promise<OptionOwner | undefined> {
  const rows = await db.query<{ option_id: string; name: string; linked_item_id: string | null; archived_at: Big | null }>(
    `SELECT o.option_id, o.name, o.linked_item_id, o.archived_at
       FROM modifier_options o
       JOIN modifier_groups g ON g.tenant_id = o.tenant_id AND g.modifier_group_id = o.modifier_group_id
      WHERE o.tenant_id = $1 AND o.option_id = $2
      FOR SHARE OF g, o`,
    [optionId],
  );
  const row = rows[0];
  return row === undefined
    ? undefined
    : { owner_type: 'modifier_option', owner_id: row.option_id, name: row.name, linked_item_id: row.linked_item_id, archived_at: msOrNull(row.archived_at) };
}

// §6 lock order kind 5: stock items FOR SHARE in ONE statement, id order (the owner, if a stock item, and the line
// stock items). Runs for an empty list too (fixed statement count).
export async function shareStockItems(db: TenantSql, stockItemIds: readonly string[]): Promise<Map<string, StockItemRow>> {
  const rows = await db.query<RawStockItem>(
    `SELECT ${STOCK_ITEM_COLUMNS} FROM stock_items
      WHERE tenant_id = $1 AND stock_item_id = ANY($2)
      ORDER BY stock_item_id
      FOR SHARE`,
    [[...new Set(stockItemIds)].sort()],
  );
  return new Map(rows.map((row) => [row.stock_item_id, stockItemRow(row)]));
}

// --------------------------------------------------------------------------------------------- recipes

export interface RecipeRecord {
  recipe_id: string;
  owner_type: OwnerType;
  owner_id: string;
  archived_at: number | null;
}

type RawRecipe = Omit<RecipeRecord, 'archived_at'> & { archived_at: Big | null };
const recipeRecord = (row: RawRecipe): RecipeRecord => ({ ...row, archived_at: msOrNull(row.archived_at) });

// §6.3 / §3.3 (n-2): one recipe per owner, archived included. null = the owner already has one (0 rows; the
// transaction is not aborted, so the existing id can be read next).
export async function insertRecipe(db: TenantSql, row: { recipe_id: string; owner_type: OwnerType; owner_id: string; now: number }): Promise<string | null> {
  const rows = await db.query<{ recipe_id: string }>(
    `INSERT INTO recipes (tenant_id, recipe_id, owner_type, owner_id, archived_at, created_at, updated_at)
     SELECT tenant_id, $2, $3, $4, NULL::bigint, $5::bigint, $5::bigint FROM tenants WHERE tenant_id = $1
     ON CONFLICT (tenant_id, owner_type, owner_id) DO NOTHING
     RETURNING recipe_id`,
    [row.recipe_id, row.owner_type, row.owner_id, row.now],
  );
  return rows[0]?.recipe_id ?? null;
}

// §6.3 conflict path: the existing recipe's id (it committed before our insert waited on the unique index).
export async function selectRecipeIdByOwner(db: TenantSql, ownerType: OwnerType, ownerId: string): Promise<string> {
  const rows = await db.query<{ recipe_id: string }>(`SELECT recipe_id FROM recipes WHERE tenant_id = $1 AND owner_type = $2 AND owner_id = $3`, [
    ownerType,
    ownerId,
  ]);
  return rows[0]!.recipe_id;
}

// §6 lock order kind 0.5: the target recipe FOR UPDATE (archived accepted, T-1). undefined = unknown or foreign.
export async function lockRecipe(db: TenantSql, recipeId: string): Promise<RecipeRecord | undefined> {
  const rows = await db.query<RawRecipe>(
    `SELECT recipe_id, owner_type, owner_id, archived_at FROM recipes WHERE tenant_id = $1 AND recipe_id = $2 FOR UPDATE`,
    [recipeId],
  );
  return rows[0] === undefined ? undefined : recipeRecord(rows[0]);
}

// ------------------------------------------------------------------------------------------- versions

export interface LineRecord {
  line_no: number;
  stock_item_id: string;
  unit_name: string;
  entered_num: bigint;
  entered_den: bigint;
  stock_qty_num: bigint;
  stock_qty_den: bigint;
  stock_unit: StockUnit;
  qty_basis: 'AP' | 'EP';
}

export interface VersionRecord {
  recipe_version_id: string;
  recipe_id: string;
  version_no: number;
  status: 'draft' | 'published' | 'superseded';
  basis: Basis;
  base_qty: number | null;
  batch_yield_qty: bigint | null;
  batch_stock_unit: StockUnit | null;
  measure_unit: 'g' | 'ml' | null;
  misc_allowance_bp: number;
  created_by: string;
  created_at: number;
  published_by: string | null;
  published_at: number | null;
  lines: LineRecord[];
}

const VERSION_COLUMNS =
  'recipe_version_id, recipe_id, version_no, status, basis, base_qty, batch_yield_qty, batch_stock_unit, measure_unit, misc_allowance_bp, created_by, created_at, published_by, published_at';

type RawLine = Omit<LineRecord, 'entered_num' | 'entered_den' | 'stock_qty_num' | 'stock_qty_den'> & {
  entered_num: Big;
  entered_den: Big;
  stock_qty_num: Big;
  stock_qty_den: Big;
};
type RawVersion = Omit<VersionRecord, 'batch_yield_qty' | 'created_at' | 'published_at' | 'lines'> & {
  batch_yield_qty: Big | null;
  created_at: Big;
  published_at: Big | null;
  lines?: RawLine[] | null;
};

const lineRecord = (row: RawLine): LineRecord => ({
  line_no: Number(row.line_no),
  stock_item_id: row.stock_item_id,
  unit_name: row.unit_name,
  entered_num: big(row.entered_num),
  entered_den: big(row.entered_den),
  stock_qty_num: big(row.stock_qty_num),
  stock_qty_den: big(row.stock_qty_den),
  stock_unit: row.stock_unit,
  qty_basis: row.qty_basis,
});

export function versionRecord(row: RawVersion): VersionRecord {
  return {
    recipe_version_id: row.recipe_version_id,
    recipe_id: row.recipe_id,
    version_no: Number(row.version_no),
    status: row.status,
    basis: row.basis,
    base_qty: row.base_qty === null ? null : Number(row.base_qty),
    batch_yield_qty: row.batch_yield_qty === null ? null : big(row.batch_yield_qty),
    batch_stock_unit: row.batch_stock_unit,
    measure_unit: row.measure_unit,
    misc_allowance_bp: Number(row.misc_allowance_bp),
    created_by: row.created_by,
    created_at: ms(row.created_at),
    published_by: row.published_by,
    published_at: msOrNull(row.published_at),
    lines: (row.lines ?? []).map(lineRecord).sort((a, b) => a.line_no - b.line_no),
  };
}

// json_agg of one version's lines, every BIGINT as text (never a JSON number).
const LINES_JSON = `COALESCE(
  (SELECT json_agg(json_build_object(
            'line_no', l.line_no, 'stock_item_id', l.stock_item_id, 'unit_name', l.unit_name,
            'entered_num', l.entered_num::text, 'entered_den', l.entered_den::text,
            'stock_qty_num', l.stock_qty_num::text, 'stock_qty_den', l.stock_qty_den::text,
            'stock_unit', l.stock_unit, 'qty_basis', l.qty_basis) ORDER BY l.line_no)
     FROM recipe_lines l WHERE l.tenant_id = v.tenant_id AND l.recipe_version_id = v.recipe_version_id),
  '[]'::json)`;

export interface NewVersion {
  recipe_version_id: string;
  recipe_id: string;
  basis: Basis;
  base_qty: number | null;
  batch_yield_qty: bigint | null;
  batch_stock_unit: StockUnit | null;
  measure_unit: 'g' | 'ml' | null;
  misc_allowance_bp: number;
  created_by: string;
  now: number;
}

const ownerName = (alias: string) => `(SELECT display_name FROM owner_users WHERE tenant_id = $1 AND user_id = ${alias}.created_by) AS created_by_name`;

// §6.3: draft v1 (no lines), with its creator's display name (one statement).
export async function insertFirstDraft(db: TenantSql, v: NewVersion): Promise<{ version: VersionRecord; createdByName: string }> {
  const rows = await db.query<RawVersion & { created_by_name: string }>(
    `WITH v AS (
       INSERT INTO recipe_versions (tenant_id, recipe_version_id, recipe_id, version_no, status, basis, base_qty, batch_yield_qty, batch_stock_unit,
                                    measure_unit, misc_allowance_bp, created_by, created_at, updated_at)
       SELECT tenant_id, $2, $3, 1, 'draft', $4, $5::int, $6::bigint, $7, $8, $9::int, $10, $11::bigint, $11::bigint FROM tenants WHERE tenant_id = $1
       RETURNING tenant_id, ${VERSION_COLUMNS})
     SELECT ${VERSION_COLUMNS}, ${ownerName('v')} FROM v`,
    [v.recipe_version_id, v.recipe_id, v.basis, v.base_qty, v.batch_yield_qty?.toString() ?? null, v.batch_stock_unit, v.measure_unit, v.misc_allowance_bp, v.created_by, v.now],
  );
  const { created_by_name: createdByName, ...version } = rows[0]!;
  return { version: versionRecord(version), createdByName };
}

// §6.4 draft read (under the recipe lock): the draft with its lines, or undefined (409 CONFIG_STALE decides).
export async function selectDraft(db: TenantSql, recipeId: string): Promise<VersionRecord | undefined> {
  const rows = await db.query<RawVersion>(
    `SELECT ${VERSION_COLUMNS}, ${LINES_JSON} AS lines
       FROM recipe_versions v WHERE v.tenant_id = $1 AND v.recipe_id = $2 AND v.status = 'draft'`,
    [recipeId],
  );
  return rows[0] === undefined ? undefined : versionRecord(rows[0]);
}

// §6.4 upsert: replace the draft's fields (same id, same version_no), or insert a new draft as version max + 1
// (B8: the old published version stays as it is). One statement either way.
export async function upsertDraft(db: TenantSql, existing: VersionRecord | undefined, v: NewVersion): Promise<VersionRecord> {
  const fields = [v.basis, v.base_qty, v.batch_yield_qty?.toString() ?? null, v.batch_stock_unit, v.measure_unit, v.misc_allowance_bp];
  // the UPDATE keeps the draft's creator (created_by); a new draft is created by the saver
  const rows =
    existing !== undefined
      ? await db.query<RawVersion>(
          `UPDATE recipe_versions
              SET basis = $3, base_qty = $4, batch_yield_qty = $5, batch_stock_unit = $6, measure_unit = $7, misc_allowance_bp = $8,
                  updated_at = $9
            WHERE tenant_id = $1 AND recipe_version_id = $2 AND status = 'draft'
            RETURNING ${VERSION_COLUMNS}`,
          [existing.recipe_version_id, ...fields, v.now],
        )
      : await db.query<RawVersion>(
          `INSERT INTO recipe_versions (tenant_id, recipe_version_id, recipe_id, version_no, status, basis, base_qty, batch_yield_qty, batch_stock_unit,
                                        measure_unit, misc_allowance_bp, created_by, created_at, updated_at)
           SELECT $1, $2::text, $3::text, COALESCE(MAX(version_no), 0) + 1, 'draft', $4::text, $5::int, $6::bigint, $7::text, $8::text, $9::int,
                  $10::text, $11::bigint, $11::bigint
             FROM recipe_versions WHERE tenant_id = $1 AND recipe_id = $3
           RETURNING ${VERSION_COLUMNS}`,
          [v.recipe_version_id, v.recipe_id, ...fields, v.created_by, v.now],
        );
  return versionRecord(rows[0]!);
}

// §6.4: the draft's lines are replaced (delete + insert) inside the draft save; only a draft's lines (§5.1).
export async function deleteDraftLines(db: TenantSql, draftVersionId: string): Promise<void> {
  await db.query(
    `DELETE FROM recipe_lines l USING recipe_versions v
      WHERE l.tenant_id = $1 AND l.recipe_version_id = $2
        AND v.tenant_id = l.tenant_id AND v.recipe_version_id = l.recipe_version_id AND v.status = 'draft'`,
    [draftVersionId],
  );
}

// §6.4: every line in one multi-row insert (unnest; runs for no lines too, fixed statement count).
export async function insertLines(db: TenantSql, versionId: string, lines: readonly LineRecord[]): Promise<void> {
  const col = <K extends keyof LineRecord>(k: K) => lines.map((l) => (typeof l[k] === 'bigint' ? l[k].toString() : l[k]));
  await db.query(
    `INSERT INTO recipe_lines (tenant_id, recipe_version_id, line_no, stock_item_id, unit_name, entered_num, entered_den,
                               stock_qty_num, stock_qty_den, stock_unit, qty_basis)
     SELECT t.tenant_id, $2, x.line_no, x.stock_item_id, x.unit_name, x.entered_num, x.entered_den, x.stock_qty_num, x.stock_qty_den, x.stock_unit, x.qty_basis
       FROM unnest($3::int[], $4::text[], $5::text[], $6::bigint[], $7::bigint[], $8::bigint[], $9::bigint[], $10::text[], $11::text[])
            AS x(line_no, stock_item_id, unit_name, entered_num, entered_den, stock_qty_num, stock_qty_den, stock_unit, qty_basis)
       JOIN tenants t ON t.tenant_id = $1`,
    [
      versionId,
      col('line_no'),
      col('stock_item_id'),
      col('unit_name'),
      col('entered_num'),
      col('entered_den'),
      col('stock_qty_num'),
      col('stock_qty_den'),
      col('stock_unit'),
      col('qty_basis'),
    ],
  );
}

// ------------------------------------------------------------------------------------- line references

export interface UnitRecord {
  unit_row_id: string;
  stock_item_id: string;
  unit_name: string;
  base_unit: StockUnit;
  factor_num: bigint;
  factor_den: bigint;
  created_at: number;
}

// §6.4 "their item units": every unit row of the line stock items (resolveUnit keeps the locked stock unit's
// latest of each name, 08a I5). One statement.
export async function selectUnitsOf(db: TenantSql, stockItemIds: readonly string[]): Promise<UnitRecord[]> {
  const rows = await db.query<{ unit_row_id: string; stock_item_id: string; unit_name: string; base_unit: StockUnit; factor_num: Big; factor_den: Big; created_at: Big }>(
    `SELECT unit_row_id, stock_item_id, unit_name, base_unit, factor_num, factor_den, created_at
       FROM stock_item_units WHERE tenant_id = $1 AND stock_item_id = ANY($2)`,
    [[...new Set(stockItemIds)]],
  );
  return rows.map((row) => ({ ...row, factor_num: big(row.factor_num), factor_den: big(row.factor_den), created_at: ms(row.created_at) }));
}

// §6.4 "their active yields" (M-7 default): the latest yield profile per line stock item (08a I8). One statement.
export async function selectActiveYieldsOf(db: TenantSql, stockItemIds: readonly string[]): Promise<Map<string, number>> {
  const rows = await db.query<{ stock_item_id: string; yield_bp: number }>(
    `SELECT DISTINCT ON (stock_item_id) stock_item_id, yield_bp
       FROM yield_profiles WHERE tenant_id = $1 AND stock_item_id = ANY($2)
      ORDER BY stock_item_id, created_at DESC, yield_profile_id DESC`,
    [[...new Set(stockItemIds)]],
  );
  return new Map(rows.map((row) => [row.stock_item_id, Number(row.yield_bp)]));
}

// §6.4 response statement 1: the version's owner-user names, joined with the recipe's owner row (its sale_unit for
// main_line_off, n-4; null for an option or stock-item owner). One statement.
export async function selectNamesWithOwner(
  db: TenantSql,
  userIds: readonly string[],
  owner: { owner_type: OwnerType; owner_id: string },
): Promise<{ names: Map<string, string>; saleUnit: StockUnit | null }> {
  const rows = await db.query<{ user_id: string | null; display_name: string | null; sale_unit: StockUnit | null }>(
    `SELECT u.user_id, u.display_name, m.sale_unit
       FROM (SELECT 1) one
       LEFT JOIN owner_users u ON u.tenant_id = $1 AND u.user_id = ANY($2)
       LEFT JOIN menu_items m ON m.tenant_id = $1 AND m.item_id = $3 AND $4 = 'menu_item'`,
    [[...new Set(userIds)], owner.owner_id, owner.owner_type],
  );
  const names = new Map<string, string>();
  for (const row of rows) if (row.user_id !== null && row.display_name !== null) names.set(row.user_id, row.display_name);
  return { names, saleUnit: rows[0]?.sale_unit ?? null };
}

// ----------------------------------------------------------------------------------------------- audit

export type RecipeAuditEntity = 'recipe' | 'recipe_version';
export type RecipeAuditAction = 'create' | 'update' | 'archive' | 'restore' | 'publish';

export interface RecipeAuditRow {
  entity: RecipeAuditEntity;
  entityId: string;
  action: RecipeAuditAction;
  before: object | null;
  after: object | null;
}

// §6.0 / B1 (m-9): one config_audit row per entity changed, every row of a write in ONE insert (01a S26 columns;
// tenant-wide: branch_id null). Throws when a row was not written (as writeConfigAudit).
export async function insertRecipeAudit(
  db: TenantSql,
  ownerUserId: string,
  rows: readonly RecipeAuditRow[],
  deps: { clock: Clock; ids: IdGen },
): Promise<void> {
  const at = deps.clock.branchNow();
  const written = await db.query(
    `INSERT INTO config_audit (tenant_id, audit_id, actor_kind, actor_owner_user_id, branch_id, entity, entity_id, action, before, after, at)
     SELECT t.tenant_id, x.audit_id, 'owner', $2::text, NULL::text, x.entity, x.entity_id, x.action, x.before::jsonb, x.after::jsonb, $3::bigint
       FROM tenants t,
            unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[]) AS x(audit_id, entity, entity_id, action, before, after)
      WHERE t.tenant_id = $1
     RETURNING audit_id`,
    [
      ownerUserId,
      at,
      rows.map(() => deps.ids.next()),
      rows.map((r) => r.entity),
      rows.map((r) => r.entityId),
      rows.map((r) => r.action),
      rows.map((r) => (r.before === null ? null : JSON.stringify(r.before))),
      rows.map((r) => (r.after === null ? null : JSON.stringify(r.after))),
    ],
  );
  if (written.length !== rows.length) throw new Error('config audit rows not written');
}

// ---------------------------------------------------------------------------------------- cost context

export interface CostContext {
  /** Read 1: active stock items and every prepared one (archived too, §6.1 n-3); the cost uses the active ones. */
  stockItems: StockItemRow[];
  /** The five row sets mapped to AD-18's CloudCostRows (snapshot element shapes), for buildCostInputs. */
  rows: CloudCostRows;
}

// §6 cost context (M-13): 5 tenant-wide reads, once per request, reused by every cost of the response — (1) active
// stock items (+ archived prepared ones, §6.1); (2) current item units (base = the item's stock_unit, latest per
// name, I5 step 2); (3) price rows: 08a's selectPriceCandidates for `branchId` and every branch (time-filtered at
// `now`, N-3); (4) active yields (latest per ingredient); (5) every non-archived recipe's published version with
// its lines (json_agg) — the publish graph read (§6.5). Mapped to CloudCostRows (AD-18): BIGINT as strings.
export async function selectCostContext(db: TenantSql, branchId: string | null, now: number): Promise<CostContext> {
  const items = await db.query<RawStockItem & { code: string | null; cost_category: string; is_a_item: boolean }>(
    `SELECT ${STOCK_ITEM_COLUMNS}, code, cost_category, is_a_item FROM stock_items
      WHERE tenant_id = $1 AND (kind = 'prepared' OR archived_at IS NULL)
      ORDER BY stock_item_id`,
  );
  const active = items.filter((row) => row.archived_at === null);
  const units = await db.query<{ stock_item_id: string; unit_name: string; factor_num: string; factor_den: string }>(
    `SELECT DISTINCT ON (u.stock_item_id, u.unit_name) u.stock_item_id, u.unit_name, u.factor_num::text, u.factor_den::text
       FROM stock_item_units u
       JOIN stock_items s ON s.tenant_id = u.tenant_id AND s.stock_item_id = u.stock_item_id AND s.stock_unit = u.base_unit
      WHERE u.tenant_id = $1 AND s.archived_at IS NULL
      ORDER BY u.stock_item_id, u.unit_name, u.created_at DESC, u.unit_row_id DESC`,
  );
  const prices = await selectPriceCandidates(
    db,
    active.map((row) => row.stock_item_id),
    branchId,
    now,
  );
  const yields = await db.query<{ stock_item_id: string; yield_bp: number }>(
    `SELECT DISTINCT ON (y.stock_item_id) y.stock_item_id, y.yield_bp
       FROM yield_profiles y
       JOIN stock_items s ON s.tenant_id = y.tenant_id AND s.stock_item_id = y.stock_item_id
      WHERE y.tenant_id = $1 AND s.archived_at IS NULL AND s.kind = 'ingredient'
      ORDER BY y.stock_item_id, y.created_at DESC, y.yield_profile_id DESC`,
  );
  const recipes = await db.query<RawVersion & { owner_type: OwnerType; owner_id: string }>(
    `SELECT ${VERSION_COLUMNS.split(', ')
      .map((c) => `v.${c}`)
      .join(', ')}, r.owner_type, r.owner_id, ${LINES_JSON} AS lines
       FROM recipe_versions v
       JOIN recipes r ON r.tenant_id = v.tenant_id AND r.recipe_id = v.recipe_id
      WHERE v.tenant_id = $1 AND v.status = 'published' AND r.archived_at IS NULL
      ORDER BY v.recipe_version_id`,
  );
  return {
    stockItems: items.map(stockItemRow),
    rows: {
      source: 'cloud',
      items: active.map((row) => ({
        stock_item_id: row.stock_item_id,
        kind: row.kind,
        name: row.name,
        code: row.code,
        stock_unit: row.stock_unit,
        cost_category: row.cost_category,
        is_a_item: row.is_a_item,
      })),
      units: units.map((row) => ({ stock_item_id: row.stock_item_id, unit_name: row.unit_name, factor_num: row.factor_num, factor_den: row.factor_den })),
      prices: prices.map((row) => ({
        price_id: row.price_id,
        stock_item_id: row.stock_item_id,
        branch_id: row.branch_id,
        kind: row.kind,
        unit_name: row.unit_name,
        stock_unit: row.stock_unit,
        price_minor: row.price_minor.toString(),
        stock_qty_num: row.stock_qty_num.toString(),
        stock_qty_den: row.stock_qty_den.toString(),
        created_at: row.created_at,
        valid_until_at: row.valid_until_at,
      })),
      yields: yields.map((row) => ({ stock_item_id: row.stock_item_id, yield_bp: Number(row.yield_bp) })),
      recipes: recipes.map((row) => costVersionElement(versionRecord(row), row.owner_type, row.owner_id)),
    },
  };
}

// One version as a CloudCostRows `recipes` element (AD-18: the snapshot key's version shape). A draft (published_at
// null) gets published_at 0 and keeps status 'draft', so buildCostInputs keeps it by id but never in
// publishedByOwner.
export function costVersionElement(v: VersionRecord, ownerType: OwnerType, ownerId: string, archived = false): Record<string, unknown> {
  return {
    recipe_version_id: v.recipe_version_id,
    status: v.status,
    owner_type: ownerType,
    owner_id: ownerId,
    basis: v.basis,
    base_qty: v.base_qty,
    measure_unit: v.measure_unit,
    recipe_archived: archived,
    batch_yield_qty: v.batch_yield_qty === null ? null : v.batch_yield_qty.toString(),
    batch_stock_unit: v.batch_stock_unit,
    misc_allowance_bp: v.misc_allowance_bp,
    published_at: v.published_at ?? 0,
    lines: v.lines.map((l) => ({
      stock_item_id: l.stock_item_id,
      stock_qty_num: l.stock_qty_num.toString(),
      stock_qty_den: l.stock_qty_den.toString(),
      stock_unit: l.stock_unit,
      qty_basis: l.qty_basis,
    })),
  };
}
