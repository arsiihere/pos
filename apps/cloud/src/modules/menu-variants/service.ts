import { DomainError } from '@pos/domain';
import { canonicalJson } from '@pos/domain/hash';
import type { CreateVariantGroupInput, PatchVariantGroupInput, VariantGroupWire } from '@pos/events';
import type pg from 'pg';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import type { Clock } from '../../lib/clock.js';
import { auditActionFor, writeConfigAudit } from '../../lib/config-audit.js';
import { bumpEveryBranch, coversEveryBranch } from '../../lib/config-version.js';
import { inTransaction, withIdempotency, type IdempotentResult } from '../../lib/idempotency.js';
import type { IdGen } from '../../lib/ids.js';
import type { CloudTestHooks } from '../../server.js';
import { insertConfigAuditRows, shareCategory } from '../restaurant/repository.js';
import type { OwnerRequest } from '../restaurant/service.js';
import {
  insertVariantGroup,
  lockVariantGroup,
  moveMembers,
  selectMembers,
  updateVariantGroup,
  type MemberRow,
  type VariantGroupRecord,
} from './repository.js';
import { toVariantGroupWire } from './versions.js';

export interface MenuVariantDeps {
  pool: pg.Pool;
  clock: Clock;
  ids: IdGen;
  testHooks?: CloudTestHooks;
}

// §6.1: idempotency key → tenant-wide check (403) → category FOR SHARE (lock order 6) → insert (name index → 409)
// → audit → bump every branch (10).
export async function createVariantGroup(
  deps: MenuVariantDeps,
  req: OwnerRequest,
  body: CreateVariantGroupInput,
): Promise<IdempotentResult<{ variant_group: VariantGroupWire }>> {
  return withIdempotency(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...hooks(deps) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const level = new TenantLevelRepository(req.tenant, client);
      await assertTenantWide(level, req.ownerUserId);
      assertCategory(await shareCategory(level, body.category_id));
      const group = await nameTaken(body.name, () =>
        insertVariantGroup(
          level,
          {
            variant_group_id: deps.ids.next(),
            name: body.name,
            category_id: body.category_id,
            description: body.description,
            sort_order: body.sort_order,
          },
          deps.clock.branchNow(),
        ),
      );
      await writeConfigAudit(
        level,
        {
          actor: { kind: 'owner', ownerUserId: req.ownerUserId },
          entity: 'variant_group',
          entityId: group.variant_group_id,
          branchId: null,
          action: 'create',
          before: null,
          after: group,
        },
        deps,
      );
      await deps.testHooks?.beforeBump?.();
      await bumpEveryBranch(level);
      return { status: 201, body: { variant_group: toVariantGroupWire({ ...group, member_ids: [] }) } };
    },
  );
}

// §6.2 (C4; lock order 3 → 4 → 6 → 10): tenant-wide check (403) → group FOR UPDATE (404) → version
// (409 CONFIG_STALE, a stale no-op too) → a category change locks every member FOR UPDATE by item_id, otherwise the members are a plain read →
// a sent category_id FOR SHARE (422) → no-op (200, nothing written) → R1 archive with active members (409),
// R2 name (index → 409) → write; a category change moves every member (M6) → one multi-row audit insert:
// the group, then one menu_item / update per moved member (C5, branch_id null) → bump every branch.
export async function patchVariantGroup(
  deps: MenuVariantDeps,
  req: OwnerRequest,
  variantGroupId: string,
  body: PatchVariantGroupInput,
): Promise<{ variant_group: VariantGroupWire }> {
  return inTransaction(deps.pool, async (client) => {
    const level = new TenantLevelRepository(req.tenant, client);
    await assertTenantWide(level, req.ownerUserId);
    const before = await lockVariantGroup(level, variantGroupId);
    if (before === undefined) throw new DomainError('VARIANT_GROUP_NOT_FOUND', { variant_group_id: variantGroupId });
    // the version input has no member_ids (§5.4), so the compare needs no member read
    if (body.expected_version !== toVariantGroupWire({ ...before, member_ids: [] }).version) {
      throw new DomainError('CONFIG_STALE', { entity: 'variant_group', id: variantGroupId });
    }
    const moving = body.category_id !== undefined && body.category_id !== before.category_id;
    const members = await selectMembers(level, variantGroupId, { lock: moving });
    // C4 step 4: a sent category_id, and on a restore the merged one (sent or stored, AD-7), FOR SHARE (slot 6)
    const restoring = before.archived_at !== null && body.archived === false;
    if (body.category_id !== undefined || restoring) {
      assertCategory(await shareCategory(level, body.category_id ?? before.category_id));
    }
    const now = deps.clock.branchNow();
    const merged: VariantGroupRecord = {
      ...before,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.category_id !== undefined ? { category_id: body.category_id } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.sort_order !== undefined ? { sort_order: body.sort_order } : {}),
      ...(body.archived !== undefined ? { archived_at: body.archived ? (before.archived_at ?? now) : null } : {}),
    };
    if (canonicalJson(before) === canonicalJson(merged)) return { variant_group: wire(before, members) };
    if (before.archived_at === null && merged.archived_at !== null) {
      const ids = members.filter((m) => m.archived_at === null).map((m) => m.item_id);
      if (ids.length > 0) {
        throw new DomainError('CONFIG_IN_USE', { entity: 'variant_group', id: variantGroupId, used_by: { entity: 'menu_item', ids } });
      }
    }
    const group = await nameTaken(merged.name, () => updateVariantGroup(level, merged, now));
    const moved = moving ? await moveMembers(level, variantGroupId, group.category_id, now) : [];
    const actor = { kind: 'owner' as const, ownerUserId: req.ownerUserId };
    const beforeOf = new Map(members.map((m) => [m.item_id, m.row]));
    await insertConfigAuditRows(
      level,
      [
        {
          actor,
          entity: 'variant_group',
          entityId: variantGroupId,
          branchId: null,
          action: auditActionFor(before, group),
          before,
          after: group,
        },
        ...moved.map((m) => ({
          actor,
          entity: 'menu_item' as const,
          entityId: m.item_id,
          branchId: null,
          action: 'update' as const,
          before: beforeOf.get(m.item_id) ?? null,
          after: m.row,
        })),
      ],
      deps,
    );
    await deps.testHooks?.beforeBump?.();
    await bumpEveryBranch(level);
    return { variant_group: wire(group, members) };
  });
}

// member_ids holds every member, archived ones included (§3.2 rule 4, AD-8), by item_id.
function wire(group: VariantGroupRecord, members: readonly MemberRow[]): VariantGroupWire {
  return toVariantGroupWire({ ...group, member_ids: members.map((m) => m.item_id) });
}

// C4 (01c §6): the tenant-wide 403 runs before the 404, 409, references and the no-op, as in 01b's directoryWrite
// (owner check before fn, whose no-op comes later). One statement; the bump then skips its own owner read.
async function assertTenantWide(level: TenantLevelRepository, ownerUserId: string): Promise<void> {
  if (!(await coversEveryBranch(level, ownerUserId))) {
    throw new DomainError('PERMISSION_DENIED', { reason: 'tenant_wide_write' });
  }
}

function assertCategory(row: { archived_at: number | null } | undefined): void {
  const reason = row === undefined ? 'not_found' : row.archived_at !== null ? 'archived' : null;
  if (reason !== null) throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'category_id', reason });
}

function hooks(deps: MenuVariantDeps): { testHooks?: CloudTestHooks } {
  return deps.testHooks !== undefined ? { testHooks: deps.testHooks } : {};
}

// R2: pg 23505 on variant_groups_active_name → 409 CONFIG_NAME_TAKEN { entity: 'variant_group', name }.
async function nameTaken<T>(name: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint === 'variant_groups_active_name') {
      throw new DomainError('CONFIG_NAME_TAKEN', { entity: 'variant_group', name });
    }
    throw error;
  }
}
