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
  activeTableIds,
  insertFloor,
  insertTable,
  lockFloor,
  lockTable,
  selectFloors,
  selectTables,
  shareFloor,
  updateFloor,
  updateTable,
  type FloorRow,
  type TableRow,
} from './repository.js';
import type { CreateFloorInput, CreateTableInput, PatchFloorInput, PatchTableInput } from './schemas.js';

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
