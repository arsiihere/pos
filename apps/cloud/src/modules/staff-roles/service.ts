import { DomainError } from '@pos/domain';
import type { ChangedVersions, StaffCreateBody, StaffWire } from '@pos/events';
import type { z } from 'zod';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import type { TenantContext } from '../../db/tenant-scoped-repository.js';
import { writeConfigAudit } from '../../lib/config-audit.js';
import type { IdempotentResult } from '../../lib/idempotency.js';
import {
  firstNameClash,
  insertStaff,
  pairKey,
  selectActiveAtBranch,
  selectBranchIds,
  selectFloorStates,
  selectRoleStates,
  selectStaff,
  type StaffFilter,
} from './repository.js';
import { staffVersion, toStaffWire, withVersion, type StaffRow } from './versions.js';
import { directoryWrite, type OwnerRequest, type StaffRolesDeps } from './write.js';

type StaffCreateInput = z.infer<typeof StaffCreateBody>;

// §6.1: 6 statements; each version built in memory (B23).
export async function listStaff(deps: StaffRolesDeps, tenant: TenantContext, filter: StaffFilter): Promise<StaffWire[]> {
  const rows = await selectStaff(new TenantLevelRepository(tenant, deps.pool), filter);
  return rows.map(versioned);
}

// §6.2: directory write script, creating POST (Idempotency-Key). No guard: it only adds (§3.4).
export async function createStaff(
  deps: StaffRolesDeps,
  req: OwnerRequest,
  body: StaffCreateInput,
): Promise<IdempotentResult<{ staff: StaffWire; changed_versions: ChangedVersions }>> {
  return directoryWrite(deps, req, { idempotent: true, body }, async (ctx) => {
    const branchIds = unique(body.branch_ids);
    const roleIds = unique(body.role_ids);
    const reportsTo = body.reports_to ?? [];
    const floors = body.floors ?? [];
    // (1) branches of the tenant
    const known = await selectBranchIds(ctx.repo, branchIds);
    const foreign = body.branch_ids.find((id) => !known.has(id));
    if (foreign !== undefined) throw new DomainError('BRANCH_NOT_FOUND', { branch_id: foreign });
    // (2) roles, §3.2 rule 2
    const roles = await selectRoleStates(ctx.repo, roleIds);
    body.role_ids.forEach((roleId, i) => {
      const role = roles.get(roleId);
      if (role === undefined) throw referenceInvalid(`role_ids.${i}`, 'not_found');
      if (role.archived) throw referenceInvalid(`role_ids.${i}`, 'role_archived');
    });
    // (3) reports_to and floors, §3.2 rules 5–6
    await checkReportsTo(ctx.repo, branchIds, reportsTo);
    await checkFloors(ctx.repo, branchIds, floors);
    // (4) B12
    const clash = await firstNameClash(ctx.repo, body.display_name, branchIds, null);
    if (clash !== undefined) throw new DomainError('STAFF_NAME_TAKEN', { display_name: body.display_name, branch_id: clash });
    // (5) write, audit
    const staffId = ctx.deps.ids.next();
    await insertStaff(ctx.repo, {
      staffId,
      displayName: body.display_name,
      roleIds,
      branchIds,
      deniedPermissions: unique(body.denied_permissions ?? []),
      reportsTo,
      floors: uniquePairs(floors.flatMap((entry) => entry.floor_ids.map((floor_id) => ({ branch_id: entry.branch_id, floor_id })))),
      now: ctx.deps.clock.branchNow(),
    });
    const [row] = await selectStaff(ctx.repo, { ids: [staffId] });
    const wire = toStaffWire(row!);
    await writeConfigAudit(
      ctx.repo,
      {
        actor: { kind: 'owner', ownerUserId: ctx.ownerUserId },
        entity: 'staff',
        entityId: staffId,
        branchId: null,
        action: 'create',
        before: null,
        after: wire,
      },
      ctx.deps,
    );
    const changed_versions = await ctx.changed.resolve(ctx, { staffId });
    return { body: { staff: withVersion(wire, staffVersion(wire)), changed_versions }, bump: true };
  });
}

// §3.2 rule 5, §3.5: one lead per branch, at one of the person's branches, active and working there.
// The loop walk joins with PATCH (task 15): a new person has no reports.
async function checkReportsTo(
  repo: TenantLevelRepository,
  branchIds: string[],
  reportsTo: { branch_id: string; lead_staff_id: string }[],
): Promise<void> {
  const seen = new Set<string>();
  for (const entry of reportsTo) {
    if (seen.has(entry.branch_id)) throw referenceInvalid('reports_to', 'one_lead_per_branch');
    seen.add(entry.branch_id);
  }
  reportsTo.forEach((entry, i) => {
    if (!branchIds.includes(entry.branch_id)) throw referenceInvalid(`reports_to.${i}.branch_id`, 'wrong_branch');
  });
  if (reportsTo.length === 0) return;
  const working = await selectActiveAtBranch(repo, unique(reportsTo.map((entry) => entry.lead_staff_id)));
  reportsTo.forEach((entry, i) => {
    if (!working.has(pairKey(entry.branch_id, entry.lead_staff_id))) {
      throw referenceInvalid(`reports_to.${i}.lead_staff_id`, 'not_at_branch');
    }
  });
}

// §3.2 rule 6: floors of that branch, not archived at write time.
async function checkFloors(
  repo: TenantLevelRepository,
  branchIds: string[],
  floors: { branch_id: string; floor_ids: string[] }[],
): Promise<void> {
  floors.forEach((entry, i) => {
    if (!branchIds.includes(entry.branch_id)) throw referenceInvalid(`floors.${i}.branch_id`, 'wrong_branch');
  });
  const floorIds = unique(floors.flatMap((entry) => entry.floor_ids));
  if (floorIds.length === 0) return;
  const states = await selectFloorStates(repo, floorIds);
  floors.forEach((entry, i) => {
    entry.floor_ids.forEach((floorId, j) => {
      const floor = states.get(floorId);
      if (floor === undefined) throw referenceInvalid(`floors.${i}.floor_ids.${j}`, 'not_found');
      if (floor.branch_id !== entry.branch_id) throw referenceInvalid(`floors.${i}.floor_ids.${j}`, 'wrong_branch');
      if (floor.archived) throw referenceInvalid(`floors.${i}.floor_ids.${j}`, 'archived');
    });
  });
}

function versioned(row: StaffRow): StaffWire {
  const wire = toStaffWire(row);
  return withVersion(wire, staffVersion(wire));
}

function referenceInvalid(field: string, reason: string): DomainError {
  return new DomainError('CONFIG_REFERENCE_INVALID', { field, reason });
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

// AD-11: lists are sets, so one (branch, floor) pair even when a branch repeats across `floors` entries.
function uniquePairs(rows: { branch_id: string; floor_id: string }[]): { branch_id: string; floor_id: string }[] {
  return [...new Map(rows.map((row) => [pairKey(row.branch_id, row.floor_id), row])).values()];
}
