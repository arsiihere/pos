import { Algorithm, hash, Version } from '@node-rs/argon2';
import { DomainError, PERMISSION_SCOPES } from '@pos/domain';
import type { BranchRenameBody, BranchSettingsPatchBody, BranchWire, ChangedVersions, GrantWire, PinBody, ResponsibilitiesPutBody, ResponsibilityWire, RoleCreateBody, RolePatchBody, RoleWire, StaffCreateBody, StaffPatchBody, StaffWire } from '@pos/events';
import type { z } from 'zod';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import type { TenantContext } from '../../db/tenant-scoped-repository.js';
import { writeConfigAudit } from '../../lib/config-audit.js';
import { bumpConfigVersion } from '../../lib/config-version.js';
import { assertBranchAllowed } from '../restaurant/service.js';
import { inTransaction, type IdempotentResult } from '../../lib/idempotency.js';
import {
  addBranches,
  addRoles,
  deleteStaffResponsibilities,
  firstNameClash,
  insertGrants,
  insertRole,
  insertStaff,
  isLinkedToOwner,
  leadLineReaches,
  lockRoles,
  lockStaff,
  pairKey,
  removeBranches,
  removeRoles,
  replaceDenials,
  replaceFloors,
  replaceGrants,
  replaceLeads,
  replaceResponsibilities,
  roleNameTaken,
  roleUsedBy,
  selectActiveAtBranch,
  selectActiveResponsibilities,
  selectBranchIds,
  selectBranchWire,
  selectOwner,
  selectFloorStates,
  selectRoleStates,
  selectRoles,
  selectReports,
  selectStaff,
  selectStationStates,
  setLead,
  selectRoleHolders,
  setRoleArchived,
  updateBranchName,
  updateBranchSettings,
  updatePin,
  updateRoleRow,
  updateStaffRow,
  type RoleFilter,
  type StaffFilter,
} from './repository.js';
import {
  responsibilitySetVersion,
  roleVersion,
  staffVersion,
  toResponsibilitySet,
  toRoleWire,
  toStaffWire,
  withVersion,
  type RoleRow,
  type StaffRow,
} from './versions.js';
import { qualifyingAdmins, runAdminGuards } from './guards.js';
import { directoryWrite, type OwnerRequest, type StaffRolesDeps } from './write.js';

type StaffCreateInput = z.infer<typeof StaffCreateBody>;
type StaffPatchInput = z.infer<typeof StaffPatchBody>;
type RoleCreateInput = z.infer<typeof RoleCreateBody>;
type RolePatchInput = z.infer<typeof RolePatchBody>;
type MovedReport = { staff_id: string; branch_id: string; lead_staff_id: string | null };

// 00 M8: argon2id m=19456, t=2, p=1.
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1, algorithm: Algorithm.Argon2id, version: Version.V0x13 };

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
    await checkReportsTo(ctx.repo, branchIds, reportsTo, null);
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

// §6.3: hash first, outside the transaction; then the directory write script. Never a no-op (a new salt
// ends the person's hub sessions, M50); the version is unchanged (the PIN is not in its input, B23).
export async function setPin(
  deps: StaffRolesDeps,
  req: OwnerRequest,
  staffId: string,
  body: z.infer<typeof PinBody>,
): Promise<{ staff: StaffWire; changed_versions: ChangedVersions }> {
  const pinHash = await hash(body.pin, ARGON);
  const out = await directoryWrite(deps, req, { idempotent: false }, async (ctx) => {
    const target = (await lockStaff(ctx.repo, [staffId])).get(staffId);
    if (target === undefined || !target.is_active) throw new DomainError('STAFF_NOT_FOUND', { staff_id: staffId });
    const [before] = await selectStaff(ctx.repo, { ids: [staffId] });
    const now = ctx.deps.clock.branchNow();
    await updatePin(ctx.repo, staffId, pinHash, now);
    const wire = toStaffWire({ ...before!, has_pin: true, pin_set_at: now });
    await writeConfigAudit(
      ctx.repo,
      {
        actor: { kind: 'owner', ownerUserId: ctx.ownerUserId },
        entity: 'staff',
        entityId: staffId,
        branchId: null,
        action: 'pin_set',
        before: { has_pin: before!.has_pin, pin_set_at: before!.pin_set_at },
        after: { has_pin: true, pin_set_at: now },
      },
      ctx.deps,
    );
    const changed_versions = await ctx.changed.resolve(ctx, { staffId });
    return { body: { staff: withVersion(wire, staffVersion(wire)), changed_versions }, bump: true };
  });
  return out.body;
}

// §6.4: directory write script with expected_version (B23); rules on the merged row (§3.2 rule 1); branch_ids
// as a diff (§5.1 notes); leaving and a removed branch move the person's reports up (B15) and drop their
// responsibilities there (§3.6); returning re-checks B12; the admin guards (§3.4) compare before and after.
export async function updateStaff(
  deps: StaffRolesDeps,
  req: OwnerRequest,
  staffId: string,
  body: StaffPatchInput,
): Promise<{ staff: StaffWire; moved_reports: MovedReport[]; changed_versions: ChangedVersions }> {
  const out = await directoryWrite(deps, req, { idempotent: false }, async (ctx) => {
    if (!(await lockStaff(ctx.repo, [staffId])).has(staffId)) throw new DomainError('STAFF_NOT_FOUND', { staff_id: staffId });
    const [stored] = await selectStaff(ctx.repo, { ids: [staffId] });
    const before = toStaffWire(stored!);
    const storedVersion = staffVersion(before);
    ctx.deps.testHooks?.onVersionCompare?.('staff', staffId, storedVersion);
    if (body.expected_version !== storedVersion) throw new DomainError('CONFIG_STALE', { entity: 'staff', id: staffId });

    const now = ctx.deps.clock.branchNow();
    const isActive = body.is_active ?? before.is_active;
    const leaving = before.is_active && !isActive;
    const returning = !before.is_active && isActive;
    const branchIds = body.branch_ids === undefined ? before.branch_ids : unique(body.branch_ids);
    const removed = before.branch_ids.filter((id) => !branchIds.includes(id));
    const kept = (entry: { branch_id: string }) => branchIds.includes(entry.branch_id);
    // §3.5: a leaver's own lead rows are deleted.
    const reportsTo = leaving ? [] : (body.reports_to ?? before.reports_to.filter(kept));
    const floorPairs =
      body.floors === undefined
        ? before.floors.filter(kept).flatMap((entry) => entry.floor_ids.map((floor_id) => ({ branch_id: entry.branch_id, floor_id })))
        : uniquePairs(body.floors.flatMap((entry) => entry.floor_ids.map((floor_id) => ({ branch_id: entry.branch_id, floor_id }))));
    const merged = toStaffWire({
      ...stored!,
      display_name: body.display_name ?? before.display_name,
      role_ids: body.role_ids === undefined ? before.role_ids : unique(body.role_ids),
      branch_ids: branchIds,
      denied_permissions: body.denied_permissions === undefined ? before.denied_permissions : unique(body.denied_permissions),
      reports_to: reportsTo,
      floors: groupFloors(floorPairs),
      is_active: isActive,
      left_at: leaving ? now : returning ? null : stored!.left_at,
    });
    const noop = { staff: withVersion(before, storedVersion), moved_reports: [], changed_versions: emptyChanged() };
    if (staffVersion(merged) === storedVersion) return { body: noop, bump: false };
    // Review 2 N3: before the guards, so the answer is the same with or without a second admin.
    if (leaving && (await isLinkedToOwner(ctx.repo, staffId))) throw new DomainError('STAFF_LINKED_TO_OWNER', { staff_id: staffId });
    const adminsBefore = await qualifyingAdmins(ctx.repo);

    // Rules on the merged row (§6.2 rules 1–4, §3.2).
    if (body.branch_ids !== undefined) {
      const known = await selectBranchIds(ctx.repo, branchIds);
      const foreign = body.branch_ids.find((id) => !known.has(id));
      if (foreign !== undefined) throw new DomainError('BRANCH_NOT_FOUND', { branch_id: foreign });
    }
    const roles = await selectRoleStates(ctx.repo, merged.role_ids);
    if (body.role_ids !== undefined) {
      body.role_ids.forEach((roleId, i) => {
        const role = roles.get(roleId);
        if (role === undefined) throw referenceInvalid(`role_ids.${i}`, 'not_found');
        if (role.archived) throw referenceInvalid(`role_ids.${i}`, 'role_archived');
      });
    } else if (merged.is_active && !merged.role_ids.some((roleId) => roles.get(roleId)?.archived === false)) {
      throw referenceInvalid('role_ids', 'role_archived');
    }
    if (body.reports_to !== undefined && !leaving) await checkReportsTo(ctx.repo, branchIds, body.reports_to, staffId);
    if (body.floors !== undefined) await checkFloors(ctx.repo, branchIds, body.floors);
    const added = branchIds.filter((id) => !before.branch_ids.includes(id));
    if (merged.is_active && (returning || merged.display_name !== before.display_name || added.length > 0)) {
      const clash = await firstNameClash(ctx.repo, merged.display_name, merged.branch_ids, staffId);
      if (clash !== undefined) throw new DomainError('STAFF_NAME_TAKEN', { display_name: merged.display_name, branch_id: clash });
    }

    // Write.
    await updateStaffRow(ctx.repo, staffId, { displayName: merged.display_name, isActive, leftAt: merged.left_at, now });
    // B15 before the branch rows go (a report's lead row references the person's staff_branches row).
    const movedAt = leaving ? before.branch_ids : removed;
    const moved: MovedReport[] = (await selectReports(ctx.repo, staffId, movedAt)).map((report) => ({
      staff_id: report.staff_id,
      branch_id: report.branch_id,
      lead_staff_id: before.reports_to.find((entry) => entry.branch_id === report.branch_id)?.lead_staff_id ?? null,
    }));
    for (const move of moved) await setLead(ctx.repo, move.branch_id, move.staff_id, move.lead_staff_id);
    if (leaving || removed.length > 0) {
      const sets = await deleteStaffResponsibilities(ctx.repo, staffId, leaving ? null : removed);
      sets.forEach((branchId) => ctx.changed.responsibilities(branchId));
    }
    await removeBranches(ctx.repo, staffId, removed);
    await addBranches(ctx.repo, staffId, added);
    await removeRoles(ctx.repo, staffId, before.role_ids.filter((id) => !merged.role_ids.includes(id)));
    await addRoles(ctx.repo, staffId, merged.role_ids.filter((id) => !before.role_ids.includes(id)));
    if (body.denied_permissions !== undefined) await replaceDenials(ctx.repo, staffId, merged.denied_permissions);
    if (body.reports_to !== undefined || leaving) await replaceLeads(ctx.repo, staffId, merged.reports_to);
    if (body.floors !== undefined) await replaceFloors(ctx.repo, staffId, floorPairs);

    runAdminGuards(adminsBefore, await qualifyingAdmins(ctx.repo), ctx.ownerStaffId);

    const [row] = await selectStaff(ctx.repo, { ids: [staffId] });
    const after = toStaffWire(row!);
    await writeConfigAudit(
      ctx.repo,
      {
        actor: { kind: 'owner', ownerUserId: ctx.ownerUserId },
        entity: 'staff',
        entityId: staffId,
        branchId: null,
        action: leaving ? 'left' : returning ? 'returned' : 'update',
        before,
        after,
      },
      ctx.deps,
    );
    for (const move of moved) {
      await writeConfigAudit(
        ctx.repo,
        {
          actor: { kind: 'owner', ownerUserId: ctx.ownerUserId },
          entity: 'staff',
          entityId: move.staff_id,
          branchId: move.branch_id,
          action: 'reports_to_reassigned',
          before: { branch_id: move.branch_id, lead_staff_id: staffId },
          after: { branch_id: move.branch_id, lead_staff_id: move.lead_staff_id },
        },
        ctx.deps,
      );
      ctx.changed.staff(move.staff_id);
    }
    const changed_versions = await ctx.changed.resolve(ctx, { staffId });
    return { body: { staff: withVersion(after, staffVersion(after)), moved_reports: moved, changed_versions }, bump: true };
  });
  return out.body;
}

// §6.5: 4 statements; each version built in memory (B23).
export async function listRoles(deps: StaffRolesDeps, tenant: TenantContext, filter: RoleFilter): Promise<RoleWire[]> {
  const rows = await selectRoles(new TenantLevelRepository(tenant, deps.pool), filter);
  return rows.map(versionedRole);
}

// §6.6: directory write script, creating POST (Idempotency-Key); the B8 check is in the script.
export async function createRole(
  deps: StaffRolesDeps,
  req: OwnerRequest,
  body: RoleCreateInput,
): Promise<IdempotentResult<{ role: RoleWire; changed_versions: ChangedVersions }>> {
  return directoryWrite(deps, req, { idempotent: true, body }, async (ctx) => {
    const grants = await checkGrants(ctx.repo, body.grants);
    if (await roleNameTaken(ctx.repo, body.name, null)) throw new DomainError('CONFIG_NAME_TAKEN', { entity: 'role', name: body.name });
    const roleId = ctx.deps.ids.next();
    await insertRole(ctx.repo, { roleId, name: body.name, idleMs: body.idle_minutes * 60_000 });
    await insertGrants(ctx.repo, roleId, grants);
    const [row] = await selectRoles(ctx.repo, { ids: [roleId] });
    const wire = toRoleWire(row!);
    await writeConfigAudit(
      ctx.repo,
      {
        actor: { kind: 'owner', ownerUserId: ctx.ownerUserId },
        entity: 'role',
        entityId: roleId,
        branchId: null,
        action: 'create',
        before: null,
        after: auditedRole(wire),
      },
      ctx.deps,
    );
    const changed_versions = await ctx.changed.resolve(ctx);
    return { body: { role: withVersion(wire, roleVersion(wire)), changed_versions }, bump: true };
  });
}

// §6.7: directory write script with expected_version (B23); rules as §6.6 on the sent fields; grants replace
// the stored list with the dual-written approver (B22); default_key is kept. `archived` per B14: refused while
// an active person holds only this role or another active role lists it as approver; else it comes off every
// holder with its responsibilities. Restore re-checks the name. The admin guards (§3.4) compare before and after.
export async function updateRole(
  deps: StaffRolesDeps,
  req: OwnerRequest,
  roleId: string,
  body: RolePatchInput,
): Promise<{ role: RoleWire; changed_versions: ChangedVersions }> {
  const out = await directoryWrite(deps, req, { idempotent: false }, async (ctx) => {
    if (!(await lockRoles(ctx.repo, [roleId])).has(roleId)) throw new DomainError('ROLE_NOT_FOUND', { role_id: roleId });
    const [stored] = await selectRoles(ctx.repo, { ids: [roleId] });
    const before = toRoleWire(stored!);
    const storedVersion = roleVersion(before);
    ctx.deps.testHooks?.onVersionCompare?.('role', roleId, storedVersion);
    if (body.expected_version !== storedVersion) throw new DomainError('CONFIG_STALE', { entity: 'role', id: roleId });

    const now = ctx.deps.clock.branchNow();
    const wasArchived = stored!.archived_at !== null;
    const archiving = body.archived === true && !wasArchived;
    const restoring = body.archived === false && wasArchived;
    // R-2: a restore re-checks the stored grants as §6.6 (an approver may have been archived meanwhile).
    const grants =
      body.grants !== undefined
        ? await checkGrants(ctx.repo, body.grants, roleId)
        : restoring
          ? await checkGrants(ctx.repo, before.grants, roleId)
          : before.grants;
    const merged = toRoleWire({
      ...stored!,
      name: body.name ?? before.name,
      session_idle_ttl_ms: body.idle_minutes === undefined ? stored!.session_idle_ttl_ms : body.idle_minutes * 60_000,
      archived_at: archiving ? now : restoring ? null : stored!.archived_at,
      grants,
    });
    if (roleVersion(merged) === storedVersion) {
      return { body: { role: withVersion(before, storedVersion), changed_versions: emptyChanged() }, bump: false };
    }
    const adminsBefore = await qualifyingAdmins(ctx.repo);
    if (merged.archived_at === null && (merged.name !== before.name || restoring) && (await roleNameTaken(ctx.repo, merged.name, roleId))) {
      throw new DomainError('CONFIG_NAME_TAKEN', { entity: 'role', name: merged.name });
    }
    if (archiving) {
      const usedBy = await roleUsedBy(ctx.repo, roleId);
      if (usedBy.staff.length > 0) {
        throw new DomainError('CONFIG_IN_USE', { entity: 'role', id: roleId, used_by: { entity: 'staff', ids: usedBy.staff } });
      }
      if (usedBy.roles.length > 0) {
        throw new DomainError('CONFIG_IN_USE', { entity: 'role', id: roleId, used_by: { entity: 'role', ids: usedBy.roles } });
      }
    }

    await updateRoleRow(ctx.repo, roleId, { name: merged.name, idleMs: merged.idle_minutes * 60_000 });
    if (body.grants !== undefined) await replaceGrants(ctx.repo, roleId, grants);
    // §6 "one row per changed entity": each holder the archive takes the role off gets its own `staff` row.
    const holderIds = archiving ? await selectRoleHolders(ctx.repo, roleId) : [];
    const holdersBefore = holderIds.length === 0 ? [] : (await selectStaff(ctx.repo, { ids: holderIds })).map(toStaffWire);
    if (archiving || restoring) {
      const removed = await setRoleArchived(ctx.repo, roleId, merged.archived_at);
      removed.holders.forEach((staffId) => ctx.changed.staff(staffId));
      removed.branches.forEach((branchId) => ctx.changed.responsibilities(branchId));
    }

    runAdminGuards(adminsBefore, await qualifyingAdmins(ctx.repo), ctx.ownerStaffId);

    const [row] = await selectRoles(ctx.repo, { ids: [roleId] });
    const after = toRoleWire(row!);
    await writeConfigAudit(
      ctx.repo,
      {
        actor: { kind: 'owner', ownerUserId: ctx.ownerUserId },
        entity: 'role',
        entityId: roleId,
        branchId: null,
        action: archiving ? 'archive' : restoring ? 'restore' : 'update',
        before: auditedRole(before),
        after: auditedRole(after),
      },
      ctx.deps,
    );
    const holdersAfter = holderIds.length === 0 ? [] : (await selectStaff(ctx.repo, { ids: holderIds })).map(toStaffWire);
    for (const holder of holdersAfter) {
      await writeConfigAudit(
        ctx.repo,
        {
          actor: { kind: 'owner', ownerUserId: ctx.ownerUserId },
          entity: 'staff',
          entityId: holder.staff_id,
          branchId: null,
          action: 'update',
          before: holdersBefore.find((wire) => wire.staff_id === holder.staff_id)!,
          after: holder,
        },
        ctx.deps,
      );
    }
    const changed_versions = await ctx.changed.resolve(ctx);
    return { body: { role: withVersion(after, roleVersion(after)), changed_versions }, bump: true };
  });
  return out.body;
}

// §6.9: its own script, no version bump (the hub shows its provisioned name): BEGIN → B8 → branch row FOR UPDATE
// (404) → no-op → UPDATE → 23505 on branches_name → 409 CONFIG_NAME_TAKEN → audit branch / update → COMMIT.
export async function renameBranch(
  deps: StaffRolesDeps,
  req: OwnerRequest,
  branchId: string,
  body: z.infer<typeof BranchRenameBody>,
): Promise<{ branch: BranchWire }> {
  return inTransaction(deps.pool, async (client) => {
    const repo = new TenantLevelRepository(req.tenant, client);
    const owner = await selectOwner(repo, req.ownerUserId);
    if (owner === undefined || !owner.covers_every_branch) throw new DomainError('PERMISSION_DENIED', { reason: 'tenant_wide_write' });
    const before = await selectBranchWire(repo, branchId, { lock: true });
    if (before === undefined) throw new DomainError('BRANCH_NOT_FOUND', { branch_id: branchId });
    if (before.name === body.name) return { branch: before };
    try {
      await updateBranchName(repo, branchId, body.name);
    } catch (error) {
      const pgError = error as { code?: string; constraint?: string };
      if (pgError.code === '23505' && pgError.constraint === 'branches_name') {
        throw new DomainError('CONFIG_NAME_TAKEN', { entity: 'branch', name: body.name });
      }
      throw error;
    }
    await writeConfigAudit(
      repo,
      {
        actor: { kind: 'owner', ownerUserId: req.ownerUserId },
        entity: 'branch',
        entityId: branchId,
        branchId,
        action: 'update',
        before: { name: before.name },
        after: { name: body.name },
      },
      deps,
    );
    return { branch: { ...before, name: body.name } };
  });
}

// §6.10 GET: the path branch among the owner's (no statement), then 1 statement.
export async function getBranchSettings(deps: StaffRolesDeps, tenant: TenantContext, branchId: string): Promise<{ branch: BranchWire }> {
  assertBranchAllowed(tenant, branchId);
  const branch = await selectBranchWire(new TenantLevelRepository(tenant, deps.pool), branchId, { lock: false });
  if (branch === undefined) throw new DomainError('BRANCH_NOT_FOUND', { branch_id: branchId });
  return { branch };
}

// §6.10 PATCH: 01a's common write script plus B8: lock the branch row → merge → stale > gap (B16, 01a S33) →
// no-op → update → audit branch_settings / update → bumpConfigVersion for this branch only.
export async function patchBranchSettings(
  deps: StaffRolesDeps,
  req: OwnerRequest,
  branchId: string,
  body: z.infer<typeof BranchSettingsPatchBody>,
): Promise<{ branch: BranchWire }> {
  assertBranchAllowed(req.tenant, branchId);
  return inTransaction(deps.pool, async (client) => {
    const repo = new TenantLevelRepository(req.tenant, client);
    const owner = await selectOwner(repo, req.ownerUserId);
    if (owner === undefined || !owner.covers_every_branch) throw new DomainError('PERMISSION_DENIED', { reason: 'tenant_wide_write' });
    const stored = await selectBranchWire(repo, branchId, { lock: true });
    if (stored === undefined) throw new DomainError('BRANCH_NOT_FOUND', { branch_id: branchId });
    const before = settingsOf(stored);
    const after = {
      tax_enabled: body.tax_enabled ?? before.tax_enabled,
      day_stale_after_hours: body.day_stale_after_hours ?? before.day_stale_after_hours,
      day_min_gap_hours: body.day_min_gap_hours ?? before.day_min_gap_hours,
    };
    if (after.day_stale_after_hours <= after.day_min_gap_hours) {
      throw new DomainError('VALIDATION_FAILED', {
        issues: [{ path: 'day_min_gap_hours', message: 'day_min_gap_hours must be less than day_stale_after_hours' }],
      });
    }
    if (
      after.tax_enabled === before.tax_enabled &&
      after.day_stale_after_hours === before.day_stale_after_hours &&
      after.day_min_gap_hours === before.day_min_gap_hours
    ) {
      return { branch: stored };
    }
    await updateBranchSettings(repo, branchId, after);
    await writeConfigAudit(
      repo,
      {
        actor: { kind: 'owner', ownerUserId: req.ownerUserId },
        entity: 'branch_settings',
        entityId: branchId,
        branchId,
        action: 'update',
        before,
        after,
      },
      deps,
    );
    await bumpConfigVersion(repo, { kind: 'branch', branchId });
    return { branch: { ...stored, ...after } };
  });
}

function settingsOf(branch: BranchWire) {
  return { tax_enabled: branch.tax_enabled, day_stale_after_hours: branch.day_stale_after_hours, day_min_gap_hours: branch.day_min_gap_hours };
}

type ResponsibilitySet = { responsibilities: ResponsibilityWire[]; version: string };

// §6.8 GET: 1 statement; active stations only, built by the one builder (B23). The path branch is checked
// against the tenant's branches without a statement, as 01a's branch GETs do.
export async function getResponsibilities(deps: StaffRolesDeps, tenant: TenantContext, branchId: string): Promise<ResponsibilitySet> {
  assertBranchAllowed(tenant, branchId);
  const set = toResponsibilitySet(branchId, await selectActiveResponsibilities(new TenantLevelRepository(tenant, deps.pool), branchId));
  return { responsibilities: set, version: responsibilitySetVersion(branchId, set) };
}

// §6.8 PUT: directory write script; after the tenant lock the stored set is read with the GET's statement and
// compared (B23); rules §3.6; only the active stations' rows are replaced; one audit row; no-op rule.
export async function putResponsibilities(
  deps: StaffRolesDeps,
  req: OwnerRequest,
  branchId: string,
  body: z.infer<typeof ResponsibilitiesPutBody>,
): Promise<ResponsibilitySet & { changed_versions: ChangedVersions }> {
  const out = await directoryWrite(deps, req, { idempotent: false }, async (ctx) => {
    if (!(await selectBranchIds(ctx.repo, [branchId])).has(branchId)) throw new DomainError('BRANCH_NOT_FOUND', { branch_id: branchId });
    const before = toResponsibilitySet(branchId, await selectActiveResponsibilities(ctx.repo, branchId));
    const storedVersion = responsibilitySetVersion(branchId, before);
    ctx.deps.testHooks?.onVersionCompare?.('responsibility', branchId, storedVersion);
    if (body.expected_version !== storedVersion) throw new DomainError('CONFIG_STALE', { entity: 'responsibility', id: branchId });

    // AD-11: lists are sets. Stations with nobody are absent from the stored set (§6.8).
    const merged = toResponsibilitySet(
      branchId,
      body.responsibilities.flatMap((entry) => [
        ...unique(entry.staff_ids).map((id) => row(entry.station_id, 'staff', id)),
        ...unique(entry.role_ids).map((id) => row(entry.station_id, 'role', id)),
      ]),
    );
    const noop = { responsibilities: before, version: storedVersion, changed_versions: emptyChanged() };
    if (responsibilitySetVersion(branchId, merged) === storedVersion) return { body: noop, bump: false };
    await checkResponsibilities(ctx.repo, branchId, body.responsibilities);

    await replaceResponsibilities(ctx.repo, branchId, merged);
    const after = toResponsibilitySet(branchId, await selectActiveResponsibilities(ctx.repo, branchId));
    await writeConfigAudit(
      ctx.repo,
      {
        actor: { kind: 'owner', ownerUserId: ctx.ownerUserId },
        entity: 'responsibility',
        entityId: branchId,
        branchId,
        action: 'update',
        before,
        after,
      },
      ctx.deps,
    );
    const changed_versions = await ctx.changed.resolve(ctx);
    return { body: { responsibilities: after, version: responsibilitySetVersion(branchId, after), changed_versions }, bump: true };
  });
  return out.body;
}

function row(stationId: string, kind: 'staff' | 'role', id: string) {
  return { responsibility: 'count_stock' as const, station_id: stationId, subject_kind: kind, subject_id: id, station_archived_at: null };
}

// §3.6: one entry per station (AD-19), stations of the branch and active, staff working there, roles active.
async function checkResponsibilities(repo: TenantLevelRepository, branchId: string, entries: ResponsibilityWire[]): Promise<void> {
  const seen = new Set<string>();
  entries.forEach((entry, i) => {
    if (seen.has(entry.station_id)) throw new DomainError('CONFIG_REFERENCE_INVALID', { field: `responsibilities.${i}.station_id` });
    seen.add(entry.station_id);
  });
  const stations = await selectStationStates(repo, entries.map((entry) => entry.station_id));
  entries.forEach((entry, i) => {
    const station = stations.get(entry.station_id);
    if (station === undefined) throw referenceInvalid(`responsibilities.${i}.station_id`, 'not_found');
    if (station.branch_id !== branchId) throw referenceInvalid(`responsibilities.${i}.station_id`, 'wrong_branch');
    if (station.archived) throw referenceInvalid(`responsibilities.${i}.station_id`, 'archived');
  });
  const staffIds = unique(entries.flatMap((entry) => entry.staff_ids));
  const working = staffIds.length === 0 ? new Set<string>() : await selectActiveAtBranch(repo, staffIds);
  entries.forEach((entry, i) => {
    entry.staff_ids.forEach((staffId, j) => {
      if (!working.has(pairKey(branchId, staffId))) throw referenceInvalid(`responsibilities.${i}.staff_ids.${j}`, 'not_at_branch');
    });
  });
  const roleIds = unique(entries.flatMap((entry) => entry.role_ids));
  const roles = roleIds.length === 0 ? new Map<string, { archived: boolean }>() : await selectRoleStates(repo, roleIds);
  entries.forEach((entry, i) => {
    entry.role_ids.forEach((roleId, j) => {
      const role = roles.get(roleId);
      if (role === undefined) throw referenceInvalid(`responsibilities.${i}.role_ids.${j}`, 'not_found');
      if (role.archived) throw referenceInvalid(`responsibilities.${i}.role_ids.${j}`, 'role_archived');
    });
  });
}

// §6.6 rules: one grant per permission; approvers non-empty iff requires_approval (AD-13: `field` only, as
// 01a's reason-less references); approvers active roles of the tenant; scope in the permission's row (§3.3).
// `selfId`: the role being written; it may approve its own grant (§3.3) and counts as active here.
async function checkGrants(repo: TenantLevelRepository, grants: RoleCreateInput['grants'], selfId?: string): Promise<GrantWire[]> {
  const seen = new Set<string>();
  grants.forEach((grant, i) => {
    if (seen.has(grant.permission)) throw new DomainError('CONFIG_REFERENCE_INVALID', { field: `grants.${i}.permission` });
    seen.add(grant.permission);
    if ((grant.grant_type === 'requires_approval') !== (grant.approver_role_ids.length > 0)) {
      throw new DomainError('CONFIG_REFERENCE_INVALID', { field: `grants.${i}.approver_role_ids` });
    }
    if (!PERMISSION_SCOPES[grant.permission].includes(grant.scope)) throw referenceInvalid(`grants.${i}.scope`, 'scope_not_allowed');
  });
  const approverIds = unique(grants.flatMap((grant) => grant.approver_role_ids));
  const states = approverIds.length === 0 ? new Map<string, { archived: boolean }>() : await selectRoleStates(repo, approverIds);
  grants.forEach((grant, i) => {
    grant.approver_role_ids.forEach((approver, j) => {
      const state = approver === selfId ? { archived: false } : states.get(approver);
      if (state === undefined) throw referenceInvalid(`grants.${i}.approver_role_ids.${j}`, 'not_found');
      if (state.archived) throw referenceInvalid(`grants.${i}.approver_role_ids.${j}`, 'role_archived');
    });
  });
  return grants.map((grant) => ({ ...grant, approver_role_ids: unique(grant.approver_role_ids) }));
}

// §3.2 rule 5, §3.5: one lead per branch, at one of the person's branches, active and working there, and
// no loop. A new person (`staffId` null) has no reports, so their line cannot loop.
async function checkReportsTo(
  repo: TenantLevelRepository,
  branchIds: string[],
  reportsTo: { branch_id: string; lead_staff_id: string }[],
  staffId: string | null,
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
  if (staffId === null) return;
  for (const [i, entry] of reportsTo.entries()) {
    if (await leadLineReaches(repo, entry.branch_id, entry.lead_staff_id, staffId)) {
      throw referenceInvalid(`reports_to.${i}.lead_staff_id`, 'loop');
    }
  }
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

// §6 script: audit rows carry the wire without version and staff_count.
function auditedRole(wire: Omit<RoleWire, 'version'>): Omit<RoleWire, 'version' | 'staff_count'> {
  const { staff_count, ...rest } = wire;
  void staff_count;
  return rest;
}

function versionedRole(row: RoleRow): RoleWire {
  const wire = toRoleWire(row);
  return withVersion(wire, roleVersion(wire));
}

function groupFloors(pairs: { branch_id: string; floor_id: string }[]): { branch_id: string; floor_ids: string[] }[] {
  const byBranch = new Map<string, string[]>();
  for (const pair of pairs) byBranch.set(pair.branch_id, [...(byBranch.get(pair.branch_id) ?? []), pair.floor_id]);
  return [...byBranch.entries()].map(([branch_id, floor_ids]) => ({ branch_id, floor_ids }));
}

function emptyChanged(): ChangedVersions {
  return { staff: [], roles: [], responsibilities: [] };
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
