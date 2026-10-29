import type { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import type { VariantGroupRow } from './versions.js';

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
