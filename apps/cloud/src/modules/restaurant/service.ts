import { DomainError } from '@pos/domain';
import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import { TenantScopedRepository, type TenantContext } from '../../db/tenant-scoped-repository.js';
import type { Clock } from '../../lib/clock.js';
import { auditActionFor, writeConfigAudit, type AuditEntity } from '../../lib/config-audit.js';
import { bumpConfigVersion } from '../../lib/config-version.js';
import { inTransaction, withIdempotency, type IdempotentResult } from '../../lib/idempotency.js';
import type { IdGen } from '../../lib/ids.js';
import type { CloudTestHooks } from '../../server.js';
import {
  activeRouteItemIds,
  activeTableIds,
  archiveStationPrograms,
  insertFloor,
  insertProgram,
  insertStation,
  insertTable,
  lockFloor,
  lockProgram,
  lockStation,
  lockTable,
  programRouteItemIds,
  selectFloors,
  selectPrograms,
  selectStations,
  selectTables,
  shareFloor,
  shareStation,
  updateFloor,
  updateProgram,
  updateStation,
  updateTable,
  type FloorRow,
  type ProgramRow,
  type StationRow,
  type TableRow,
} from './repository.js';
import type {
  CreateFloorInput,
  CreateProgramInput,
  CreateStationInput,
  CreateTableInput,
  PatchFloorInput,
  PatchProgramInput,
  PatchStationInput,
  PatchTableInput,
} from './schemas.js';

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
  if (!tenant.branchIds.includes(branchId)) throw new DomainError('BRANCH_NOT_FOUND');
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
      if (floor === undefined) throw new DomainError('BRANCH_NOT_FOUND');
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
    if (before === undefined) throw new DomainError('FLOOR_NOT_FOUND');
    const now = deps.clock.branchNow();
    const merged: FloorRow = {
      ...before,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.sort_order !== undefined ? { sort_order: body.sort_order } : {}),
      ...(body.archived !== undefined ? { archived_at: body.archived ? (before.archived_at ?? now) : null } : {}),
    };
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
      await assertActiveFloor(scoped, branchId, body.floor_id);
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

// §6.6: lock → rules on the merged row (an active table needs an active floor of this branch) → write → audit → bump.
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
    if (merged.archived_at === null) await assertActiveFloor(scoped, branchId, merged.floor_id);
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
      if (station === undefined) throw new DomainError('BRANCH_NOT_FOUND');
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
    const now = deps.clock.branchNow();
    const merged: ProgramRow = {
      ...before,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.cook_time_ms !== undefined ? { cook_time_ms: body.cook_time_ms } : {}),
      ...(body.archived !== undefined ? { archived_at: body.archived ? (before.archived_at ?? now) : null } : {}),
    };
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

// §3.3: a table references an active floor of the same branch.
async function assertActiveFloor(scoped: TenantScopedRepository, branchId: string, floorId: string): Promise<void> {
  const floor = await shareFloor(scoped, floorId);
  const reason =
    floor === undefined ? 'not_found' : floor.branch_id !== branchId ? 'wrong_branch' : floor.archived_at !== null ? 'archived' : null;
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
