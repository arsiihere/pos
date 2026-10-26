import { DomainError } from '@pos/domain';
import { canonicalJson } from '@pos/domain/hash';
import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import { TenantScopedRepository, type TenantContext } from '../../db/tenant-scoped-repository.js';
import type { Clock } from '../../lib/clock.js';
import { auditActionFor, writeConfigAudit, type AuditEntity } from '../../lib/config-audit.js';
import { bumpConfigVersion, coversEveryBranch } from '../../lib/config-version.js';
import { inTransaction, withIdempotency, type IdempotentResult } from '../../lib/idempotency.js';
import type { IdGen } from '../../lib/ids.js';
import type { CloudTestHooks } from '../../server.js';
import {
  activeItemIdsWith,
  activeRouteItemIds,
  activeTableIds,
  archiveStationPrograms,
  deleteWindowsOf,
  insertCategory,
  insertConfigAuditRows,
  insertFloor,
  insertItemRoutes,
  insertMenuItem,
  insertProgram,
  insertStation,
  insertTable,
  insertTaxClass,
  insertWindows,
  deleteItemRoute,
  lockCategory,
  lockFloor,
  lockItemRoute,
  lockMenuItem,
  lockProgram,
  lockStation,
  lockTable,
  lockTaxClass,
  programRouteItemIds,
  selectAllCategories,
  selectAllTaxClasses,
  selectFloors,
  selectItemRoutes,
  selectItemWindows,
  selectMenuPage,
  selectPrograms,
  selectStations,
  selectTables,
  selectWindowsOf,
  shareCategory,
  shareFloor,
  shareProgramsById,
  shareStation,
  shareStationsById,
  shareTaxClass,
  updateCategory,
  updateFloor,
  updateMenuItem,
  updateProgram,
  updateStation,
  updateTable,
  updateTaxClass,
  upsertItemRoute,
  type CategoryRow,
  type FloorRow,
  type MenuItemRow,
  type ProgramRow,
  type RouteRow,
  type StationRow,
  type TableRow,
  type TaxClassRow,
  type WindowRow,
  type WindowTarget,
} from './repository.js';
import type {
  CreateCategoryInput,
  CreateFloorInput,
  CreateMenuItemInput,
  CreateProgramInput,
  CreateStationInput,
  CreateTableInput,
  CreateTaxClassInput,
  PatchCategoryInput,
  PatchFloorInput,
  PatchMenuItemInput,
  PatchProgramInput,
  PatchStationInput,
  PatchTableInput,
  PatchTaxClassInput,
  PutItemRouteInput,
} from '@pos/events';
import type { MenuQueryInput } from './schemas.js';

export interface RestaurantDeps {
  pool: pg.Pool;
  clock: Clock;
  ids: IdGen;
  testHooks?: CloudTestHooks;
}

export interface OwnerRequest {
  tenant: TenantContext;
  ownerUserId: string;
  idempotencyKey: string | undefined;
  method: string;
  path: string;
  log: Pick<FastifyBaseLogger, 'error'>;
}

// §3.3: the path branch must be one of the JWT's allowed branches.
export function assertBranchAllowed(tenant: TenantContext, branchId: string): void {
  if (!tenant.branchIds.includes(branchId)) throw new DomainError('BRANCH_NOT_FOUND', { branch_id: branchId });
}

// §6.2: 2 statements, archived rows included.
export async function listFloors(deps: RestaurantDeps, tenant: TenantContext, branchId: string) {
  assertBranchAllowed(tenant, branchId);
  const repo = new TenantScopedRepository(tenant, deps.pool);
  const floors = await selectFloors(repo, branchId);
  const tables = await selectTables(repo, branchId);
  return floors.map((floor) => ({
    ...floor,
    tables: tables
      .filter((table) => table.floor_id === floor.floor_id)
      .map((table) => ({
        table_id: table.table_id,
        name: table.name,
        seats: table.seats,
        sort_order: table.sort_order,
        archived_at: table.archived_at,
      })),
  }));
}

// §6.3 on the common write script: key → write → audit → bump.
export async function createFloor(
  deps: RestaurantDeps,
  req: OwnerRequest,
  branchId: string,
  body: CreateFloorInput,
): Promise<IdempotentResult<{ floor: FloorRow }>> {
  assertBranchAllowed(req.tenant, branchId);
  return withIdempotency(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...hooks(deps) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const scoped = new TenantScopedRepository(req.tenant, client);
      const level = new TenantLevelRepository(req.tenant, client);
      const floor = await nameTaken('floors_active_name', 'floor', body.name, () =>
        insertFloor(scoped, {
          branchId,
          floorId: deps.ids.next(),
          name: body.name,
          sortOrder: body.sort_order,
          now: deps.clock.branchNow(),
        }),
      );
      if (floor === undefined) throw new DomainError('BRANCH_NOT_FOUND', { branch_id: branchId });
      await writeConfigAudit(
        level,
        {
          actor: { kind: 'owner', ownerUserId: req.ownerUserId },
          entity: 'floor',
          entityId: floor.floor_id,
          branchId,
          action: 'create',
          before: null,
          after: floor,
        },
        deps,
      );
      await deps.testHooks?.beforeBump?.();
      await bumpConfigVersion(level, { kind: 'branch', branchId });
      return { status: 201, body: { floor } };
    },
  );
}

// §6.4: lock → rules on the merged row → write → audit → bump.
export async function patchFloor(
  deps: RestaurantDeps,
  req: OwnerRequest,
  branchId: string,
  floorId: string,
  body: PatchFloorInput,
): Promise<{ floor: FloorRow }> {
  assertBranchAllowed(req.tenant, branchId);
  return inTransaction(deps.pool, async (client) => {
    const scoped = new TenantScopedRepository(req.tenant, client);
    const level = new TenantLevelRepository(req.tenant, client);
    const before = await lockFloor(scoped, branchId, floorId);
    if (before === undefined) throw new DomainError('FLOOR_NOT_FOUND', { floor_id: floorId });
    const now = deps.clock.branchNow();
    const merged: FloorRow = {
      ...before,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.sort_order !== undefined ? { sort_order: body.sort_order } : {}),
      ...(body.archived !== undefined ? { archived_at: body.archived ? (before.archived_at ?? now) : null } : {}),
    };
    if (unchangedRow(before, merged)) return { floor: before };
    if (before.archived_at === null && merged.archived_at !== null) {
      const ids = await activeTableIds(scoped, branchId, floorId);
      if (ids.length > 0) {
        throw new DomainError('CONFIG_IN_USE', { entity: 'floor', id: floorId, used_by: { entity: 'table', ids } });
      }
    }
    const floor = await nameTaken('floors_active_name', 'floor', merged.name, () =>
      updateFloor(scoped, branchId, merged, now),
    );
    await writeConfigAudit(
      level,
      {
        actor: { kind: 'owner', ownerUserId: req.ownerUserId },
        entity: 'floor',
        entityId: floorId,
        branchId,
        action: auditActionFor(before, floor),
        before,
        after: floor,
      },
      deps,
    );
    await deps.testHooks?.beforeBump?.();
    await bumpConfigVersion(level, { kind: 'branch', branchId });
    return { floor };
  });
}

// §6.5 on the common write script: key → floor FOR SHARE → write → audit → bump.
export async function createTable(
  deps: RestaurantDeps,
  req: OwnerRequest,
  branchId: string,
  body: CreateTableInput,
): Promise<IdempotentResult<{ table: TableRow }>> {
  assertBranchAllowed(req.tenant, branchId);
  return withIdempotency(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...hooks(deps) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const scoped = new TenantScopedRepository(req.tenant, client);
      const level = new TenantLevelRepository(req.tenant, client);
      await assertFloor(scoped, branchId, body.floor_id, { requireActive: true });
      const table = await nameTaken('dining_tables_active_name', 'table', body.name, () =>
        insertTable(scoped, {
          branchId,
          tableId: deps.ids.next(),
          floorId: body.floor_id,
          name: body.name,
          seats: body.seats,
          sortOrder: body.sort_order,
          now: deps.clock.branchNow(),
        }),
      );
      await writeConfigAudit(
        level,
        {
          actor: { kind: 'owner', ownerUserId: req.ownerUserId },
          entity: 'table',
          entityId: table.table_id,
          branchId,
          action: 'create',
          before: null,
          after: table,
        },
        deps,
      );
      await deps.testHooks?.beforeBump?.();
      await bumpConfigVersion(level, { kind: 'branch', branchId });
      return { status: 201, body: { table } };
    },
  );
}

// §6.6: lock → rules on the merged row (a sent floor_id must be a floor of this branch; an active table needs it
// active) → write → audit → bump.
export async function patchTable(
  deps: RestaurantDeps,
  req: OwnerRequest,
  branchId: string,
  tableId: string,
  body: PatchTableInput,
): Promise<{ table: TableRow }> {
  assertBranchAllowed(req.tenant, branchId);
  return inTransaction(deps.pool, async (client) => {
    const scoped = new TenantScopedRepository(req.tenant, client);
    const level = new TenantLevelRepository(req.tenant, client);
    const before = await lockTable(scoped, branchId, tableId);
    if (before === undefined) throw new DomainError('TABLE_NOT_FOUND', { table_id: tableId });
    const now = deps.clock.branchNow();
    const merged: TableRow = {
      ...before,
      ...(body.floor_id !== undefined ? { floor_id: body.floor_id } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.seats !== undefined ? { seats: body.seats } : {}),
      ...(body.sort_order !== undefined ? { sort_order: body.sort_order } : {}),
      ...(body.archived !== undefined ? { archived_at: body.archived ? (before.archived_at ?? now) : null } : {}),
    };
    if (unchangedRow(before, merged)) return { table: before };
    if (body.floor_id !== undefined || merged.archived_at === null) {
      await assertFloor(scoped, branchId, merged.floor_id, { requireActive: merged.archived_at === null });
    }
    const table = await nameTaken('dining_tables_active_name', 'table', merged.name, () =>
      updateTable(scoped, branchId, merged, now),
    );
    await writeConfigAudit(
      level,
      {
        actor: { kind: 'owner', ownerUserId: req.ownerUserId },
        entity: 'table',
        entityId: tableId,
        branchId,
        action: auditActionFor(before, table),
        before,
        after: table,
      },
      deps,
    );
    await deps.testHooks?.beforeBump?.();
    await bumpConfigVersion(level, { kind: 'branch', branchId });
    return { table };
  });
}

// §6.8: 2 statements, archived rows included.
export async function listStations(deps: RestaurantDeps, tenant: TenantContext, branchId: string) {
  assertBranchAllowed(tenant, branchId);
  const repo = new TenantScopedRepository(tenant, deps.pool);
  const stations = await selectStations(repo, branchId);
  const programs = await selectPrograms(repo, branchId);
  return stations.map((station) => ({
    ...station,
    programs: programs
      .filter((program) => program.station_id === station.station_id)
      .map(({ program_id, name, cook_time_ms, archived_at }) => ({ program_id, name, cook_time_ms, archived_at })),
  }));
}

// §6.9 POST on the common write script.
export async function createStation(
  deps: RestaurantDeps,
  req: OwnerRequest,
  branchId: string,
  body: CreateStationInput,
): Promise<IdempotentResult<{ station: StationRow }>> {
  assertBranchAllowed(req.tenant, branchId);
  return withIdempotency(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...hooks(deps) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const scoped = new TenantScopedRepository(req.tenant, client);
      const level = new TenantLevelRepository(req.tenant, client);
      const station = await nameTaken('stations_active_name', 'station', body.name, () =>
        insertStation(
          scoped,
          branchId,
          {
            station_id: deps.ids.next(),
            name: body.name,
            location_label: body.location_label,
            station_type: body.station_type,
            capacity: body.capacity,
            freshness_window_ms: body.station_type === 'batch' ? (body.freshness_window_ms ?? 0) : null,
            completion_mode: body.completion_mode,
          },
          deps.clock.branchNow(),
        ),
      );
      if (station === undefined) throw new DomainError('BRANCH_NOT_FOUND', { branch_id: branchId });
      await writeConfigAudit(
        level,
        {
          actor: { kind: 'owner', ownerUserId: req.ownerUserId },
          entity: 'station',
          entityId: station.station_id,
          branchId,
          action: 'create',
          before: null,
          after: station,
        },
        deps,
      );
      await deps.testHooks?.beforeBump?.();
      await bumpConfigVersion(level, { kind: 'branch', branchId });
      return { status: 201, body: { station } };
    },
  );
}

// §6.9 PATCH: lock → rules on the merged row (S22 in-use check on a type change or an archive; freshness only
// for batch) → write → audit (plus one batch_program / archive row per program a slot change archives) → bump.
export async function patchStation(
  deps: RestaurantDeps,
  req: OwnerRequest,
  branchId: string,
  stationId: string,
  body: PatchStationInput,
): Promise<{ station: StationRow }> {
  assertBranchAllowed(req.tenant, branchId);
  return inTransaction(deps.pool, async (client) => {
    const scoped = new TenantScopedRepository(req.tenant, client);
    const level = new TenantLevelRepository(req.tenant, client);
    const before = await lockStation(scoped, branchId, stationId);
    if (before === undefined) throw new DomainError('STATION_NOT_FOUND', { station_id: stationId });
    await deps.testHooks?.afterTargetLock?.('PATCH /v1/admin/branches/:branch_id/stations/:station_id');
    const now = deps.clock.branchNow();
    const stationType = body.station_type ?? before.station_type;
    const typeChanged = stationType !== before.station_type;
    if (stationType === 'slot' && body.freshness_window_ms !== undefined) {
      throw new DomainError('VALIDATION_FAILED', {
        issues: [{ path: 'freshness_window_ms', message: 'only batch stations have a freshness window' }],
      });
    }
    const merged: StationRow = {
      ...before,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.location_label !== undefined ? { location_label: body.location_label } : {}),
      ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
      ...(body.completion_mode !== undefined ? { completion_mode: body.completion_mode } : {}),
      ...(body.archived !== undefined ? { archived_at: body.archived ? (before.archived_at ?? now) : null } : {}),
      station_type: stationType,
      freshness_window_ms:
        stationType === 'slot' ? null : (body.freshness_window_ms ?? (typeChanged ? 0 : before.freshness_window_ms)),
    };
    if (unchangedRow(before, merged)) return { station: before };
    const archiving = before.archived_at === null && merged.archived_at !== null;
    if (typeChanged || archiving) {
      const ids = await activeRouteItemIds(scoped, branchId, stationId);
      if (ids.length > 0) {
        throw new DomainError('CONFIG_IN_USE', { entity: 'station', id: stationId, used_by: { entity: 'menu_item', ids } });
      }
    }
    const station = await nameTaken('stations_active_name', 'station', merged.name, () =>
      updateStation(scoped, branchId, merged, now),
    );
    const actor = { kind: 'owner' as const, ownerUserId: req.ownerUserId };
    await writeConfigAudit(
      level,
      { actor, entity: 'station', entityId: stationId, branchId, action: auditActionFor(before, station), before, after: station },
      deps,
    );
    if (typeChanged && stationType === 'slot') {
      for (const program of await archiveStationPrograms(scoped, branchId, stationId, now)) {
        await writeConfigAudit(
          level,
          {
            actor,
            entity: 'batch_program',
            entityId: program.program_id,
            branchId,
            action: 'archive',
            before: { ...program, archived_at: null },
            after: program,
          },
          deps,
        );
      }
    }
    await deps.testHooks?.beforeBump?.();
    await bumpConfigVersion(level, { kind: 'branch', branchId });
    return { station };
  });
}

// §6.10 POST on the common write script: key → station FOR SHARE (an active batch station) → write → audit → bump.
export async function createProgram(
  deps: RestaurantDeps,
  req: OwnerRequest,
  branchId: string,
  stationId: string,
  body: CreateProgramInput,
): Promise<IdempotentResult<{ program: ProgramRow }>> {
  assertBranchAllowed(req.tenant, branchId);
  return withIdempotency(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...hooks(deps) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const scoped = new TenantScopedRepository(req.tenant, client);
      const level = new TenantLevelRepository(req.tenant, client);
      await assertActiveBatchStation(scoped, branchId, stationId);
      const program = await nameTaken('batch_programs_active_name', 'batch_program', body.name, () =>
        insertProgram(
          scoped,
          branchId,
          { program_id: deps.ids.next(), station_id: stationId, name: body.name, cook_time_ms: body.cook_time_ms },
          deps.clock.branchNow(),
        ),
      );
      await writeConfigAudit(
        level,
        {
          actor: { kind: 'owner', ownerUserId: req.ownerUserId },
          entity: 'batch_program',
          entityId: program.program_id,
          branchId,
          action: 'create',
          before: null,
          after: program,
        },
        deps,
      );
      await deps.testHooks?.beforeBump?.();
      await bumpConfigVersion(level, { kind: 'branch', branchId });
      return { status: 201, body: { program } };
    },
  );
}

// §6.10 PATCH: lock the program → rules on the merged row (an active program sits on an active batch station;
// S22 in-use check on archive) → write → audit → bump.
export async function patchProgram(
  deps: RestaurantDeps,
  req: OwnerRequest,
  branchId: string,
  stationId: string,
  programId: string,
  body: PatchProgramInput,
): Promise<{ program: ProgramRow }> {
  assertBranchAllowed(req.tenant, branchId);
  return inTransaction(deps.pool, async (client) => {
    const scoped = new TenantScopedRepository(req.tenant, client);
    const level = new TenantLevelRepository(req.tenant, client);
    const before = await lockProgram(scoped, branchId, stationId, programId);
    if (before === undefined) throw new DomainError('PROGRAM_NOT_FOUND', { program_id: programId });
    await deps.testHooks?.afterTargetLock?.('PATCH /v1/admin/branches/:branch_id/stations/:station_id/programs/:program_id');
    const now = deps.clock.branchNow();
    const merged: ProgramRow = {
      ...before,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.cook_time_ms !== undefined ? { cook_time_ms: body.cook_time_ms } : {}),
      ...(body.archived !== undefined ? { archived_at: body.archived ? (before.archived_at ?? now) : null } : {}),
    };
    if (unchangedRow(before, merged)) return { program: before };
    if (merged.archived_at === null) await assertActiveBatchStation(scoped, branchId, stationId);
    if (before.archived_at === null && merged.archived_at !== null) {
      const ids = await programRouteItemIds(scoped, branchId, programId);
      if (ids.length > 0) {
        throw new DomainError('CONFIG_IN_USE', {
          entity: 'batch_program',
          id: programId,
          used_by: { entity: 'menu_item', ids },
        });
      }
    }
    const program = await nameTaken('batch_programs_active_name', 'batch_program', merged.name, () =>
      updateProgram(scoped, branchId, merged, now),
    );
    await writeConfigAudit(
      level,
      {
        actor: { kind: 'owner', ownerUserId: req.ownerUserId },
        entity: 'batch_program',
        entityId: programId,
        branchId,
        action: auditActionFor(before, program),
        before,
        after: program,
      },
      deps,
    );
    await deps.testHooks?.beforeBump?.();
    await bumpConfigVersion(level, { kind: 'branch', branchId });
    return { program };
  });
}

// §6.12 POST: tenant-level, so the audit row has no branch and every branch is bumped (S8).
export async function createTaxClass(
  deps: RestaurantDeps,
  req: OwnerRequest,
  body: CreateTaxClassInput,
): Promise<IdempotentResult<{ tax_class: TaxClassRow }>> {
  return withIdempotency(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...hooks(deps) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const level = new TenantLevelRepository(req.tenant, client);
      const taxClass = await nameTaken('tax_classes_active_name', 'tax_class', body.name, () =>
        insertTaxClass(level, { taxClassId: deps.ids.next(), name: body.name, rateBp: body.rate_bp, now: deps.clock.branchNow() }),
      );
      await writeConfigAudit(
        level,
        {
          actor: { kind: 'owner', ownerUserId: req.ownerUserId },
          entity: 'tax_class',
          entityId: taxClass.tax_class_id,
          branchId: null,
          action: 'create',
          before: null,
          after: taxClass,
        },
        deps,
      );
      await deps.testHooks?.beforeBump?.();
      await bumpConfigVersion(level, { kind: 'tenant', ownerUserId: req.ownerUserId });
      return { status: 201, body: { tax_class: taxClass } };
    },
  );
}

// §6.12 PATCH: lock → rules on the merged row (S22 in-use check on archive) → write → audit → bump every branch.
export async function patchTaxClass(
  deps: RestaurantDeps,
  req: OwnerRequest,
  taxClassId: string,
  body: PatchTaxClassInput,
): Promise<{ tax_class: TaxClassRow }> {
  return inTransaction(deps.pool, async (client) => {
    const level = new TenantLevelRepository(req.tenant, client);
    const before = await lockTaxClass(level, taxClassId);
    if (before === undefined) throw new DomainError('TAX_CLASS_NOT_FOUND', { tax_class_id: taxClassId });
    const now = deps.clock.branchNow();
    const merged: TaxClassRow = {
      ...before,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.rate_bp !== undefined ? { rate_bp: body.rate_bp } : {}),
      ...(body.archived !== undefined ? { archived_at: body.archived ? (before.archived_at ?? now) : null } : {}),
    };
    if (unchangedRow(before, merged)) return { tax_class: before };
    if (before.archived_at === null && merged.archived_at !== null) {
      const ids = await activeItemIdsWith(level, 'tax_class_id', taxClassId);
      if (ids.length > 0) {
        throw new DomainError('CONFIG_IN_USE', { entity: 'tax_class', id: taxClassId, used_by: { entity: 'menu_item', ids } });
      }
    }
    const taxClass = await nameTaken('tax_classes_active_name', 'tax_class', merged.name, () =>
      updateTaxClass(level, merged, now),
    );
    await writeConfigAudit(
      level,
      {
        actor: { kind: 'owner', ownerUserId: req.ownerUserId },
        entity: 'tax_class',
        entityId: taxClassId,
        branchId: null,
        action: auditActionFor(before, taxClass),
        before,
        after: taxClass,
      },
      deps,
    );
    await deps.testHooks?.beforeBump?.();
    await bumpConfigVersion(level, { kind: 'tenant', ownerUserId: req.ownerUserId });
    return { tax_class: taxClass };
  });
}

type CategoryWire = CategoryRow & { availability_windows: WindowRow[] };

// §6.13 POST: tenant-level, with its availability_windows (S47).
export async function createCategory(
  deps: RestaurantDeps,
  req: OwnerRequest,
  body: CreateCategoryInput,
): Promise<IdempotentResult<{ category: CategoryWire }>> {
  return withIdempotency(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...hooks(deps) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const level = new TenantLevelRepository(req.tenant, client);
      const row = await nameTaken('categories_active_name', 'category', body.name, () =>
        insertCategory(level, {
          categoryId: deps.ids.next(),
          name: body.name,
          sortOrder: body.sort_order,
          now: deps.clock.branchNow(),
        }),
      );
      const category = {
        ...row,
        availability_windows: await replaceWindows(
          level,
          deps.ids,
          { category_id: row.category_id },
          [],
          body.availability_windows,
        ),
      };
      await writeConfigAudit(
        level,
        {
          actor: { kind: 'owner', ownerUserId: req.ownerUserId },
          entity: 'category',
          entityId: category.category_id,
          branchId: null,
          action: 'create',
          before: null,
          after: category,
        },
        deps,
      );
      await deps.testHooks?.beforeBump?.();
      await bumpConfigVersion(level, { kind: 'tenant', ownerUserId: req.ownerUserId });
      return { status: 201, body: { category } };
    },
  );
}

// §6.13 PATCH: lock → rules on the merged row (S22 in-use check on archive) → write (windows replaced when sent,
// S47) → audit → bump every branch.
export async function patchCategory(
  deps: RestaurantDeps,
  req: OwnerRequest,
  categoryId: string,
  body: PatchCategoryInput,
): Promise<{ category: CategoryWire }> {
  return inTransaction(deps.pool, async (client) => {
    const level = new TenantLevelRepository(req.tenant, client);
    const before = await lockCategory(level, categoryId);
    if (before === undefined) throw new DomainError('CATEGORY_NOT_FOUND', { category_id: categoryId });
    const now = deps.clock.branchNow();
    const merged: CategoryRow = {
      ...before,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.sort_order !== undefined ? { sort_order: body.sort_order } : {}),
      ...(body.archived !== undefined ? { archived_at: body.archived ? (before.archived_at ?? now) : null } : {}),
    };
    const target = { category_id: categoryId };
    const beforeWindows = await selectWindowsOf(level, target);
    if (unchangedRow(before, merged) && unchangedWindows(beforeWindows, body.availability_windows)) {
      return { category: { ...before, availability_windows: beforeWindows } };
    }
    if (before.archived_at === null && merged.archived_at !== null) {
      const ids = await activeItemIdsWith(level, 'category_id', categoryId);
      if (ids.length > 0) {
        throw new DomainError('CONFIG_IN_USE', { entity: 'category', id: categoryId, used_by: { entity: 'menu_item', ids } });
      }
    }
    const row = await nameTaken('categories_active_name', 'category', merged.name, () =>
      updateCategory(level, merged, now),
    );
    const category = {
      ...row,
      availability_windows: await replaceWindows(level, deps.ids, target, beforeWindows, body.availability_windows),
    };
    await writeConfigAudit(
      level,
      {
        actor: { kind: 'owner', ownerUserId: req.ownerUserId },
        entity: 'category',
        entityId: categoryId,
        branchId: null,
        action: auditActionFor(before, category),
        before: { ...before, availability_windows: beforeWindows },
        after: category,
      },
      deps,
    );
    await deps.testHooks?.beforeBump?.();
    await bumpConfigVersion(level, { kind: 'tenant', ownerUserId: req.ownerUserId });
    return { category };
  });
}

// §6.11: 6 fixed statements (coversEveryBranch, tax classes, categories with windows, the item page, its windows,
// its routes). The cursor is base64url JSON { n: lower(name), id } of the page's last row (S48 keyset).
export async function listMenu(deps: RestaurantDeps, tenant: TenantContext, ownerUserId: string, query: MenuQueryInput) {
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
  const level = new TenantLevelRepository(tenant, deps.pool);
  const scoped = new TenantScopedRepository(tenant, deps.pool);
  const canEditTenant = await coversEveryBranch(level, ownerUserId);
  const taxClasses = await selectAllTaxClasses(level);
  const categories = await selectAllCategories(level);
  const rows = await selectMenuPage(level, {
    archived: query.status === 'archived',
    categoryId: query.category_id ?? null,
    pattern: query.q === undefined ? null : `%${query.q.replace(/[\\%_]/g, '\\$&')}%`,
    after,
    limit: query.limit,
  });
  const pageRows = rows.slice(0, query.limit);
  const ids = pageRows.map((row) => row.item.item_id);
  const windows = await selectItemWindows(level, ids);
  const routes = await selectItemRoutes(scoped, ids);
  const last = pageRows.at(-1);
  const items = pageRows.map(({ item: { archived_at, ...item } }) => ({
    ...item,
    availability_windows: windows
      .filter((w) => w.item_id === item.item_id)
      .map(({ start_ms, end_ms }) => ({ start_ms, end_ms })),
    archived_at,
    routes: wireRoutes(routes.filter((r) => r.item_id === item.item_id)),
  }));
  return {
    can_edit_tenant: canEditTenant,
    tax_classes: taxClasses,
    categories,
    items,
    next_cursor:
      rows.length > query.limit && last !== undefined
        ? Buffer.from(JSON.stringify({ n: last.sortName, id: last.item.item_id })).toString('base64url')
        : null,
  };
}

function decodeCursor(cursor: string): { n: string; id: string } {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof value === 'object' && value !== null) {
      const { n, id } = value as { n?: unknown; id?: unknown };
      if (typeof n === 'string' && typeof id === 'string') return { n, id };
    }
  } catch {
    // falls through to the 400 below
  }
  throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'cursor', message: 'cursor does not decode' }] });
}

// §6.14 on the common write script: [route branches allowed] → key → references FOR SHARE (category, tax class,
// stations, programs; one statement per kind) → item and routes (one INSERT each) → one audit INSERT → bump
// every branch (S8). The schema has no availability_windows yet (task 31).
export async function createMenuItem(
  deps: RestaurantDeps,
  req: OwnerRequest,
  body: CreateMenuItemInput,
): Promise<IdempotentResult<{ item: MenuItemWire }>> {
  for (const route of body.routes) assertBranchAllowed(req.tenant, route.branch_id);
  assertUnits(body);
  if (body.stock_time_ms !== null && body.stock_time_ms > body.cook_time_ms) {
    throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'stock_time_ms', reason: 'stock_time_exceeds_cook_time' });
  }
  return withIdempotency(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...hooks(deps) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const scoped = new TenantScopedRepository(req.tenant, client);
      const level = new TenantLevelRepository(req.tenant, client);
      assertReference('category_id', await shareCategory(level, body.category_id));
      if (body.tax_class_id !== null) assertReference('tax_class_id', await shareTaxClass(level, body.tax_class_id));
      await assertRoutes(scoped, body.routes);
      await deps.testHooks?.afterReferenceLock?.('POST /v1/admin/menu-items');
      const now = deps.clock.branchNow();
      const { routes: routeInput, availability_windows: windowInput, ...fields } = body;
      const row = await nameTaken('menu_items_active_name', 'menu_item', body.name, () =>
        insertMenuItem(level, { item_id: deps.ids.next(), ...fields }, now),
      );
      const routes = routeInput.length > 0 ? await insertItemRoutes(scoped, row.item_id, routeInput, now) : [];
      const item = {
        ...row,
        availability_windows: await replaceWindows(level, deps.ids, { item_id: row.item_id }, [], windowInput),
      };
      const actor = { kind: 'owner' as const, ownerUserId: req.ownerUserId };
      await insertConfigAuditRows(
        level,
        [
          { actor, entity: 'menu_item', entityId: item.item_id, branchId: null, action: 'create', before: null, after: item },
          ...routes.map((route) => ({
            actor,
            entity: 'item_route' as const,
            entityId: item.item_id,
            branchId: route.branch_id,
            action: 'route_set' as const,
            before: null,
            after: route,
          })),
        ],
        deps,
      );
      await deps.testHooks?.beforeBump?.();
      await bumpConfigVersion(level, { kind: 'tenant', ownerUserId: req.ownerUserId });
      return { status: 201, body: { item: { ...item, routes } } };
    },
  );
}

type MenuItemWire = MenuItemRow & { availability_windows: WindowRow[]; routes: RouteRow[] };

// §6.15: lock → rules on the merged row (units, stock ≤ cook, references; a restored item's routes are re-checked
// against §3.3, so it cannot bring back a route to a station or program archived meanwhile) → write → audit →
// bump every branch. Archiving needs no in-use check (open orders hold copies, §4.4).
export async function patchMenuItem(
  deps: RestaurantDeps,
  req: OwnerRequest,
  itemId: string,
  body: PatchMenuItemInput,
): Promise<{ item: MenuItemWire }> {
  return inTransaction(deps.pool, async (client) => {
    const scoped = new TenantScopedRepository(req.tenant, client);
    const level = new TenantLevelRepository(req.tenant, client);
    const before = await lockMenuItem(level, itemId);
    if (before === undefined) throw new DomainError('MENU_ITEM_NOT_FOUND', { item_id: itemId });
    const now = deps.clock.branchNow();
    const { archived, availability_windows: windowInput, ...fields } = body;
    const merged: MenuItemRow = {
      ...before,
      ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
      ...(archived !== undefined ? { archived_at: archived ? (before.archived_at ?? now) : null } : {}),
    };
    const beforeWindows = await selectWindowsOf(level, { item_id: itemId });
    if (unchangedRow(before, merged) && unchangedWindows(beforeWindows, windowInput)) {
      const stored = await selectItemRoutes(scoped, [itemId]);
      return { item: { ...before, availability_windows: beforeWindows, routes: wireRoutes(stored) } };
    }
    assertUnits(merged);
    if (merged.stock_time_ms !== null && merged.stock_time_ms > merged.cook_time_ms) {
      throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'stock_time_ms', reason: 'stock_time_exceeds_cook_time' });
    }
    const active = merged.archived_at === null;
    if (body.category_id !== undefined || active) {
      assertReference('category_id', await shareCategory(level, merged.category_id), active);
    }
    if (merged.tax_class_id !== null && (body.tax_class_id !== undefined || active)) {
      assertReference('tax_class_id', await shareTaxClass(level, merged.tax_class_id), active);
    }
    const routes = await selectItemRoutes(scoped, [itemId]);
    if (before.archived_at !== null && active) await assertRoutes(scoped, routes);
    const row = await nameTaken('menu_items_active_name', 'menu_item', merged.name, () => updateMenuItem(level, merged, now));
    const item = {
      ...row,
      availability_windows: await replaceWindows(level, deps.ids, { item_id: itemId }, beforeWindows, windowInput),
    };
    await writeConfigAudit(
      level,
      {
        actor: { kind: 'owner', ownerUserId: req.ownerUserId },
        entity: 'menu_item',
        entityId: itemId,
        branchId: null,
        action: auditActionFor(before, item),
        before: { ...before, availability_windows: beforeWindows },
        after: item,
      },
      deps,
    );
    await deps.testHooks?.beforeBump?.();
    await bumpConfigVersion(level, { kind: 'tenant', ownerUserId: req.ownerUserId });
    return { item: { ...item, routes: wireRoutes(routes) } };
  });
}

// §6.16: lock the item (404) and its route at the branch → §3.3 route rules (station, programs FOR SHARE) →
// upsert or delete → item_route / route_set or route_removed → bump that branch. No Idempotency-Key: a repeat
// gives the same state, and every PUT is one write, so each bumps once.
export async function putItemRoute(
  deps: RestaurantDeps,
  req: OwnerRequest,
  itemId: string,
  branchId: string,
  body: PutItemRouteInput,
): Promise<{ route: RouteRow | null }> {
  assertBranchAllowed(req.tenant, branchId);
  return inTransaction(deps.pool, async (client) => {
    const scoped = new TenantScopedRepository(req.tenant, client);
    const level = new TenantLevelRepository(req.tenant, client);
    if ((await lockMenuItem(level, itemId)) === undefined) throw new DomainError('MENU_ITEM_NOT_FOUND', { item_id: itemId });
    const before = (await lockItemRoute(scoped, branchId, itemId)) ?? null;
    const next =
      body.station_id === null
        ? null
        : {
            branch_id: branchId,
            station_id: body.station_id,
            program_id: body.program_id,
            stock_program_id: body.stock_program_id,
            price_minor_override: body.price_minor_override,
          };
    if (unchangedRow(before, next)) return { route: before };
    let route: RouteRow | null = null;
    if (next !== null) {
      await assertRoutes(scoped, [next], () => '');
      await deps.testHooks?.afterReferenceLock?.('PUT /v1/admin/menu-items/:item_id/routes/:branch_id');
      route = await upsertItemRoute(scoped, itemId, next, deps.clock.branchNow());
    } else if (before !== null) {
      await deleteItemRoute(scoped, branchId, itemId);
    }
    await writeConfigAudit(
      level,
      {
        actor: { kind: 'owner', ownerUserId: req.ownerUserId },
        entity: 'item_route',
        entityId: itemId,
        branchId,
        action: route === null ? 'route_removed' : 'route_set',
        before,
        after: route,
      },
      deps,
    );
    await deps.testHooks?.beforeBump?.();
    await bumpConfigVersion(level, { kind: 'branch', branchId });
    return { route };
  });
}

// v1.0.2 S26: a write that changes nothing makes no row update, no audit row and no bump.
function unchangedRow<T>(before: T, merged: T): boolean {
  return canonicalJson(before) === canonicalJson(merged);
}

function unchangedWindows(current: readonly WindowRow[], next: readonly WindowRow[] | undefined): boolean {
  if (next === undefined) return true;
  const keys = (rows: readonly WindowRow[]) => rows.map((w) => `${w.start_ms}-${w.end_ms}`).sort();
  return canonicalJson(keys(current)) === canonicalJson(keys(next));
}

function wireRoutes(routes: readonly RouteRow[]): RouteRow[] {
  return routes.map(({ branch_id, station_id, program_id, stock_program_id, price_minor_override }) => ({
    branch_id,
    station_id,
    program_id,
    stock_program_id,
    price_minor_override,
  }));
}

// S47: no field → the stored set; with the field → delete + one multi-row INSERT, in the write's transaction.
async function replaceWindows(
  level: TenantLevelRepository,
  ids: IdGen,
  target: WindowTarget,
  current: WindowRow[],
  next: WindowRow[] | undefined,
): Promise<WindowRow[]> {
  if (next === undefined) return current;
  if (current.length > 0) await deleteWindowsOf(level, target);
  return next.length > 0 ? insertWindows(level, target, next, ids) : [];
}

// §3.3, S44: equal units → stock_per_sale_unit 1; different units → sale_unit 'piece'.
function assertUnits(item: { stock_unit: string; sale_unit: string; stock_per_sale_unit: number }): void {
  const issue =
    item.stock_unit === item.sale_unit
      ? item.stock_per_sale_unit !== 1
        ? { path: 'stock_per_sale_unit', message: 'must be 1 when stock_unit and sale_unit are equal' }
        : null
      : item.sale_unit !== 'piece'
        ? { path: 'sale_unit', message: "must be 'piece' when it differs from stock_unit" }
        : null;
  if (issue !== null) throw new DomainError('VALIDATION_FAILED', { issues: [issue] });
}

// §3.3: an item references an active category and (when not null) an active tax class; an archived item may keep
// an archived one, but never an unknown one.
function assertReference(field: string, row: { archived_at: number | null } | undefined, requireActive = true): void {
  const reason = row === undefined ? 'not_found' : requireActive && row.archived_at !== null ? 'archived' : null;
  if (reason !== null) throw new DomainError('CONFIG_REFERENCE_INVALID', { field, reason });
}

// §3.3 route rules: the station is an active station of the route's branch; slot → no programs; batch → program_id
// required; both programs active and on that station. Stations, then programs, each kind in one statement.
// Field paths are routes.<i>.<field> (§6.14 body); the §6.16 body passes no prefix.
async function assertRoutes(
  scoped: TenantScopedRepository,
  routes: Array<{ branch_id: string; station_id: string; program_id: string | null; stock_program_id: string | null }>,
  prefix: (i: number) => string = (i) => `routes.${i}.`,
): Promise<void> {
  if (routes.length === 0) return;
  const stations = await shareStationsById(scoped, [...new Set(routes.map((r) => r.station_id))]);
  const programIds = [...new Set(routes.flatMap((r) => [r.program_id, r.stock_program_id]).filter((id) => id !== null))];
  const programs = programIds.length > 0 ? await shareProgramsById(scoped, programIds) : [];
  const invalid = (field: string, reason: string) => new DomainError('CONFIG_REFERENCE_INVALID', { field, reason });
  routes.forEach((route, i) => {
    const at = prefix(i);
    const station = stations.find((s) => s.branch_id === route.branch_id && s.station_id === route.station_id);
    if (station === undefined) {
      throw invalid(`${at}station_id`, stations.some((s) => s.station_id === route.station_id) ? 'wrong_branch' : 'not_found');
    }
    if (station.archived_at !== null) throw invalid(`${at}station_id`, 'archived');
    if (station.station_type === 'slot') {
      if (route.program_id !== null) throw invalid(`${at}program_id`, 'program_not_allowed');
      if (route.stock_program_id !== null) throw invalid(`${at}stock_program_id`, 'program_not_allowed');
      return;
    }
    if (route.program_id === null) throw invalid(`${at}program_id`, 'program_required');
    for (const field of ['program_id', 'stock_program_id'] as const) {
      const programId = route[field];
      if (programId === null) continue;
      const program = programs.find((p) => p.branch_id === route.branch_id && p.program_id === programId);
      if (program === undefined) {
        throw invalid(`${at}${field}`, programs.some((p) => p.program_id === programId) ? 'program_wrong_station' : 'not_found');
      }
      if (program.station_id !== route.station_id) throw invalid(`${at}${field}`, 'program_wrong_station');
      if (program.archived_at !== null) throw invalid(`${at}${field}`, 'archived');
    }
  });
}

// §6.10: programs live only on an active batch station of this branch.
async function assertActiveBatchStation(scoped: TenantScopedRepository, branchId: string, stationId: string): Promise<void> {
  const station = await shareStation(scoped, branchId, stationId);
  const reason =
    station === undefined
      ? 'not_found'
      : station.archived_at !== null
        ? 'archived'
        : station.station_type !== 'batch'
          ? 'program_not_allowed'
          : null;
  if (reason !== null) throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'station_id', reason });
}

// §3.3: a table references a floor of the same branch; an active table needs that floor active.
async function assertFloor(
  scoped: TenantScopedRepository,
  branchId: string,
  floorId: string,
  { requireActive }: { requireActive: boolean },
): Promise<void> {
  const floor = await shareFloor(scoped, floorId);
  const reason =
    floor === undefined
      ? 'not_found'
      : floor.branch_id !== branchId
        ? 'wrong_branch'
        : requireActive && floor.archived_at !== null
          ? 'archived'
          : null;
  if (reason !== null) throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'floor_id', reason });
}

function hooks(deps: RestaurantDeps): { testHooks?: CloudTestHooks } {
  return deps.testHooks !== undefined ? { testHooks: deps.testHooks } : {};
}

// pg 23505 on an *_active_name index → 409 CONFIG_NAME_TAKEN { entity, name } (§6 intro).
async function nameTaken<T>(index: string, entity: AuditEntity, name: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint === index) {
      throw new DomainError('CONFIG_NAME_TAKEN', { entity, name });
    }
    throw error;
  }
}
