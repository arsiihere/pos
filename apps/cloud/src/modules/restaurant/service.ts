import { DomainError } from '@pos/domain';
import { canonicalJson } from '@pos/domain/hash';
import { CONFIG_POLL_INTERVAL_MS } from '@pos/events';
import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import { TenantScopedRepository, type TenantContext } from '../../db/tenant-scoped-repository.js';
import type { Clock } from '../../lib/clock.js';
import { auditActionFor, writeConfigAudit, type AuditEntity } from '../../lib/config-audit.js';
import { assertTenantWide, bumpConfigVersion, bumpEveryBranch, coversEveryBranch } from '../../lib/config-version.js';
import { inTransaction, withIdempotency, type IdempotentResult } from '../../lib/idempotency.js';
import type { IdGen } from '../../lib/ids.js';
import type { CloudTestHooks } from '../../server.js';
import { activeDealIdsWith, activeVariantGroupIdsIn, shareItemsById } from '../menu-variants/repository.js';
import { assertItemEffectiveSets } from '../menu-variants/service.js';
import { toVariantGroupWire } from '../menu-variants/versions.js';
import {
  activeItemIdsWith,
  activeRouteItemIds,
  activeStationIdsAtPoint,
  activeStationsNamingAlternate,
  activeStockItemIdsAt,
  activeTableIds,
  activeZoneIds,
  clearZoneOfActiveTables,
  archiveStationPrograms,
  branchExists,
  deleteDrawsOf,
  deleteGoesWithOf,
  deleteWindowsOf,
  insertCategory,
  insertPoint,
  insertConfigAuditRows,
  insertDraws,
  insertFloor,
  insertZone,
  insertItemRoutes,
  insertGoesWith,
  insertMenuItem,
  insertProgram,
  insertStation,
  insertTable,
  insertTaxClass,
  insertWindows,
  offeringDealIds,
  deleteItemRoute,
  dealsBrokenBySaleUnit,
  linkingGroupIds,
  lockCategory,
  lockFloor,
  lockZone,
  lockPoint,
  lockItemRoute,
  lockMenuItem,
  readMenuItem,
  lockProgram,
  lockStationsById,
  lockTable,
  lockTaxClass,
  programRouteItemIds,
  selectAllCategories,
  selectAllVariantGroups,
  selectAllTaxClasses,
  selectFloors,
  selectZoneLists,
  selectZones,
  selectBranches,
  selectDrawsOf,
  selectItemRoutes,
  selectItemWindows,
  selectGoesWithOf,
  selectGoesWithTargets,
  selectMenuPage,
  selectPrograms,
  replaceAlternates,
  replaceZoneRoutes,
  replaceZoneStockItems,
  replaceCarryTimes,
  selectPoints,
  selectStationLists,
  selectStations,
  shareDefaultPoint,
  sharePointsById,
  stationsNamingAlternate,
  selectTables,
  selectWindowsOf,
  shareCategory,
  shareFloor,
  shareZone,
  shareProgramsById,
  shareStation,
  shareStationsById,
  shareStockItem,
  shareTaxClass,
  shareVariantGroup,
  shareVariantGroups,
  updateCategory,
  updateFloor,
  updateZone,
  updatePoint,
  updateMenuItem,
  updateProgram,
  updateStation,
  updateTable,
  updateTaxClass,
  upsertItemRoute,
  type CategoryRow,
  type DrawRow,
  type FloorRow,
  type GoesWithKind,
  type GoesWithLinkRow,
  type MenuItemRow,
  type PointRow,
  type ProgramRow,
  type RouteRow,
  type StationLists,
  type StationRow,
  type StationWithLists,
  type TableRow,
  type TaxClassRow,
  type WindowRow,
  type WindowTarget,
  type ZoneRow,
  type ZoneRouteRow,
  type ZoneStockItemRow,
} from './repository.js';
import { toPointWire } from './versions.js';
import type {
  AdminMenuItem,
  AdminPoint,
  AdminZone,
  CreateCategoryInput,
  CreateFloorInput,
  CreateMenuItemInput,
  CreatePointInput,
  CreateProgramInput,
  CreateStationInput,
  CreateTableInput,
  CreateTaxClassInput,
  CreateZoneInput,
  PatchCategoryInput,
  PatchFloorInput,
  PatchMenuItemInput,
  PatchPointInput,
  PatchProgramInput,
  PatchStationInput,
  PatchTableInput,
  PatchTaxClassInput,
  PatchZoneInput,
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
// §6.7b (v1.2, S58): one statement, no audit. v1.3 (01b D-11): the warning threshold, computed, not stored.
export async function listBranches(deps: RestaurantDeps, tenant: TenantContext) {
  const branches = await selectBranches(new TenantScopedRepository(tenant, deps.pool));
  return { branches, hub_stale_after_ms: 3 * CONFIG_POLL_INTERVAL_MS };
}

export async function listFloors(deps: RestaurantDeps, tenant: TenantContext, branchId: string) {
  assertBranchAllowed(tenant, branchId);
  const repo = new TenantScopedRepository(tenant, deps.pool);
  const floors = await selectFloors(repo, branchId);
  const zones = await selectZones(repo, branchId);
  const tables = await selectTables(repo, branchId);
  return floors.map((floor) => ({
    ...floor,
    zones: zones
      .filter((zone) => zone.floor_id === floor.floor_id)
      .map(({ zone_id, name, sort_order, archived_at }) => ({ zone_id, name, sort_order, archived_at })),
    tables: tables
      .filter((table) => table.floor_id === floor.floor_id)
      .map((table) => ({
        table_id: table.table_id,
        name: table.name,
        seats: table.seats,
        sort_order: table.sort_order,
        zone_id: table.zone_id,
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
      // 02a A-1 (§6.4): checked after the tables rule.
      const zoneIds = await activeZoneIds(scoped, branchId, floorId);
      if (zoneIds.length > 0) {
        throw new DomainError('CONFIG_IN_USE', { entity: 'floor', id: floorId, used_by: { entity: 'zone', ids: zoneIds } });
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
      const zoneId = body.zone_id ?? null;
      if (zoneId !== null) await assertZoneOfFloor(scoped, branchId, zoneId, body.floor_id);
      const table = await nameTaken('dining_tables_active_name', 'table', body.name, () =>
        insertTable(scoped, {
          branchId,
          tableId: deps.ids.next(),
          floorId: body.floor_id,
          zoneId,
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
      // 02a A-1 (§6.6): a zone never crosses floors, so a floor change without a zone_id leaves the zone.
      ...(body.zone_id !== undefined
        ? { zone_id: body.zone_id }
        : body.floor_id !== undefined && body.floor_id !== before.floor_id
          ? { zone_id: null }
          : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.seats !== undefined ? { seats: body.seats } : {}),
      ...(body.sort_order !== undefined ? { sort_order: body.sort_order } : {}),
      ...(body.archived !== undefined ? { archived_at: body.archived ? (before.archived_at ?? now) : null } : {}),
    };
    if (unchangedRow(before, merged)) return { table: before };
    if (body.floor_id !== undefined || merged.archived_at === null) {
      await assertFloor(scoped, branchId, merged.floor_id, { requireActive: merged.archived_at === null });
    }
    // 02a A-1: a given zone is active, in this branch and on the table's floor (after the patch). A table coming back
    // from the archive is checked too: its stored zone may have been archived since. Lock order: a zone archive locks
    // the zone, then updates its tables, so a table that keeps its zone on its floor must not lock the zone after the
    // table (deadlock); only a table entering a zone, changing floor or coming back from the archive reads it.
    const restoring = before.archived_at !== null && merged.archived_at === null;
    if (merged.zone_id !== null && (merged.zone_id !== before.zone_id || merged.floor_id !== before.floor_id || restoring)) {
      await assertZoneOfFloor(scoped, branchId, merged.zone_id, merged.floor_id);
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

// ------------------------------------------------------------------------------------------------- zones

const byItemId = (a: { item_id: string }, b: { item_id: string }) => byText(a.item_id, b.item_id);

// §6.6a response: the zone with both lists, by item_id (the stored order).
function zoneWire(zone: ZoneRow, routes: readonly ZoneRouteRow[], stockItems: readonly ZoneStockItemRow[]): AdminZone {
  return {
    zone_id: zone.zone_id,
    floor_id: zone.floor_id,
    name: zone.name,
    sort_order: zone.sort_order,
    archived_at: zone.archived_at,
    routes: [...routes].sort(byItemId).map(({ item_id, station_id }) => ({ item_id, station_id })),
    stock_items: [...stockItems].sort(byItemId).map(({ item_id, threshold }) => ({ item_id, threshold })),
  };
}

// §6.6a (02b A-1): every item is an active item of the tenant, every station an active station of this branch; a
// stock item must also be sale_unit 'piece' and not requires_weighing. One statement per kind, however long the
// lists (items first, then stations, as the item routes lock them). The routes are checked before the stock items.
async function assertZoneLists(
  level: TenantLevelRepository,
  scoped: TenantScopedRepository,
  branchId: string,
  routes: readonly ZoneRouteRow[] | undefined,
  stockItems: readonly ZoneStockItemRow[] | undefined,
): Promise<void> {
  const itemIds = [...new Set([...(routes ?? []), ...(stockItems ?? [])].map((entry) => entry.item_id))];
  if (itemIds.length === 0) return;
  const items = new Map((await shareItemsById(level, itemIds)).map((item) => [item.item_id, item]));
  const stationIds = [...new Set((routes ?? []).map((route) => route.station_id))];
  const stations = stationIds.length > 0 ? await shareStationsById(scoped, stationIds) : [];
  const invalid = (field: string, reason: string) => new DomainError('CONFIG_REFERENCE_INVALID', { field, reason });
  (routes ?? []).forEach((route, i) => {
    const item = items.get(route.item_id);
    if (item === undefined) throw invalid(`routes.${i}.item_id`, 'not_found');
    if (item.archived_at !== null) throw invalid(`routes.${i}.item_id`, 'archived');
    const station = stations.find((s) => s.branch_id === branchId && s.station_id === route.station_id);
    if (station === undefined) {
      throw invalid(`routes.${i}.station_id`, stations.some((s) => s.station_id === route.station_id) ? 'wrong_branch' : 'not_found');
    }
    if (station.archived_at !== null) throw invalid(`routes.${i}.station_id`, 'archived');
  });
  (stockItems ?? []).forEach((stock, i) => {
    const item = items.get(stock.item_id);
    const field = `stock_items.${i}.item_id`;
    if (item === undefined) throw invalid(field, 'not_found');
    if (item.archived_at !== null) throw invalid(field, 'archived');
    if (item.sale_unit !== 'piece') throw invalid(field, 'not_piece');
    if (item.requires_weighing) throw invalid(field, 'requires_weighing');
  });
}

// §6.5, §6.6 (02a A-1): a table's zone is active, in this branch and on the table's floor, else 422 zone_id.
async function assertZoneOfFloor(scoped: TenantScopedRepository, branchId: string, zoneId: string, floorId: string): Promise<void> {
  const zone = await shareZone(scoped, zoneId);
  const reason =
    zone === undefined
      ? 'not_found'
      : zone.branch_id !== branchId
        ? 'wrong_branch'
        : zone.archived_at !== null
          ? 'archived'
          : zone.floor_id !== floorId
            ? 'wrong_floor'
            : null;
  if (reason !== null) throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'zone_id', reason });
}

// §6.6a on the common write script: key → floor check → list checks → insert → lists → audit → bump.
export async function createZone(
  deps: RestaurantDeps,
  req: OwnerRequest,
  branchId: string,
  body: CreateZoneInput,
): Promise<IdempotentResult<{ zone: AdminZone }>> {
  assertBranchAllowed(req.tenant, branchId);
  return withIdempotency(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...hooks(deps) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const scoped = new TenantScopedRepository(req.tenant, client);
      const level = new TenantLevelRepository(req.tenant, client);
      await assertFloor(scoped, branchId, body.floor_id, { requireActive: true });
      const routes = body.routes ?? [];
      const stockItems = body.stock_items ?? [];
      await assertZoneLists(level, scoped, branchId, body.routes, body.stock_items);
      const row = await nameTaken('zones_active_name', 'zone', body.name, () =>
        insertZone(scoped, {
          branchId,
          zoneId: deps.ids.next(),
          floorId: body.floor_id,
          name: body.name,
          sortOrder: body.sort_order,
          now: deps.clock.branchNow(),
        }),
      );
      if (row === undefined) throw new DomainError('BRANCH_NOT_FOUND', { branch_id: branchId });
      if (routes.length > 0) await replaceZoneRoutes(scoped, branchId, row.zone_id, routes);
      if (stockItems.length > 0) await replaceZoneStockItems(scoped, branchId, row.zone_id, stockItems);
      const zone = zoneWire(row, routes, stockItems);
      await writeConfigAudit(
        level,
        {
          actor: { kind: 'owner', ownerUserId: req.ownerUserId },
          entity: 'zone',
          entityId: row.zone_id,
          branchId,
          action: 'create',
          before: null,
          after: zone,
        },
        deps,
      );
      await deps.testHooks?.beforeBump?.();
      await bumpConfigVersion(level, { kind: 'branch', branchId });
      return { status: 201, body: { zone } };
    },
  );
}

// §6.6b: lock → rules on the merged row and the sent lists → write → audit → bump. A list sent replaces the stored
// list (absent = unchanged, [] = clear); one audit row covers the row and both lists. Archiving clears `zone_id` on
// the zone's active tables in the same transaction and keeps the lists.
export async function patchZone(
  deps: RestaurantDeps,
  req: OwnerRequest,
  branchId: string,
  zoneId: string,
  body: PatchZoneInput,
): Promise<{ zone: AdminZone }> {
  assertBranchAllowed(req.tenant, branchId);
  return inTransaction(deps.pool, async (client) => {
    const scoped = new TenantScopedRepository(req.tenant, client);
    const level = new TenantLevelRepository(req.tenant, client);
    const before = await lockZone(scoped, branchId, zoneId);
    if (before === undefined) throw new DomainError('ZONE_NOT_FOUND', { zone_id: zoneId });
    const now = deps.clock.branchNow();
    const stored = await selectZoneLists(scoped, branchId, [zoneId]);
    const beforeWire = zoneWire(before, stored.routes, stored.stock_items);
    const merged: ZoneRow = {
      ...before,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.sort_order !== undefined ? { sort_order: body.sort_order } : {}),
      ...(body.archived !== undefined ? { archived_at: body.archived ? (before.archived_at ?? now) : null } : {}),
    };
    const next = zoneWire(merged, body.routes ?? stored.routes, body.stock_items ?? stored.stock_items);
    // S26: nothing changes → nothing is written (no row update, no audit row, no bump).
    if (unchangedRow(beforeWire, next)) return { zone: beforeWire };
    const routesChanged = canonicalJson(beforeWire.routes) !== canonicalJson(next.routes);
    const stockChanged = canonicalJson(beforeWire.stock_items) !== canonicalJson(next.stock_items);
    await assertZoneLists(level, scoped, branchId, routesChanged ? body.routes : undefined, stockChanged ? body.stock_items : undefined);
    // A restored zone needs its floor active (a floor with an active zone cannot be archived, §6.4).
    if (before.archived_at !== null && merged.archived_at === null) {
      await assertFloor(scoped, branchId, merged.floor_id, { requireActive: true });
    }
    const row = await nameTaken('zones_active_name', 'zone', merged.name, () => updateZone(scoped, branchId, merged, now));
    if (before.archived_at === null && row.archived_at !== null) await clearZoneOfActiveTables(scoped, branchId, zoneId, now);
    if (routesChanged) await replaceZoneRoutes(scoped, branchId, zoneId, next.routes);
    if (stockChanged) await replaceZoneStockItems(scoped, branchId, zoneId, next.stock_items);
    const zone = zoneWire(row, next.routes, next.stock_items);
    await writeConfigAudit(
      level,
      {
        actor: { kind: 'owner', ownerUserId: req.ownerUserId },
        entity: 'zone',
        entityId: zoneId,
        branchId,
        action: auditActionFor(before, row),
        before: beforeWire,
        after: zone,
      },
      deps,
    );
    await deps.testHooks?.beforeBump?.();
    await bumpConfigVersion(level, { kind: 'branch', branchId });
    return { zone };
  });
}

// §6.8 (A-1–A-10): 3 statements, archived rows included. Each station's lists come with its row.
export async function listStations(deps: RestaurantDeps, tenant: TenantContext, branchId: string) {
  assertBranchAllowed(tenant, branchId);
  const repo = new TenantScopedRepository(tenant, deps.pool);
  const stations = await selectStations(repo, branchId);
  const programs = await selectPrograms(repo, branchId);
  const points = await selectPoints(repo, branchId);
  return {
    points: points.map(toPointWire),
    stations: stations.map((station) => ({
      ...station,
      programs: programs
        .filter((program) => program.station_id === station.station_id)
        .map(({ program_id, name, cook_time_ms, archived_at }) => ({ program_id, name, cook_time_ms, archived_at })),
    })),
  };
}

// Ruling 2 (§5.2a A-7, A-8): the rules across fields, on the merged row, so the CHECKs never fire as a 500.
function assertStationFieldsFit(
  row: Pick<StationRow, 'capacity' | 'lane_units' | 'reserve_units' | 'pressure_amber_bp' | 'pressure_red_bp'>,
): void {
  const issues: Array<{ path: string; message: string }> = [];
  if (row.lane_units !== null && row.lane_units > row.capacity) {
    issues.push({ path: 'lane_units', message: 'lane_units is above capacity' });
  }
  if (row.reserve_units > row.capacity) issues.push({ path: 'reserve_units', message: 'reserve_units is above capacity' });
  if (row.pressure_amber_bp >= row.pressure_red_bp) {
    issues.push({ path: 'pressure_amber_bp', message: 'pressure_amber_bp must be below pressure_red_bp' });
  }
  if (issues.length > 0) throw new DomainError('VALIDATION_FAILED', { issues });
}

// The fields a PATCH body sent (a sent null stays: it clears a nullable field).
function sentFields<T extends object>(fields: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// The stored form of a list: rows by id, order types sorted, so a list sent in another order is the same list.
function normaliseLists(lists: StationLists): StationLists {
  return {
    alternates: lists.alternates
      .map((row) => ({
        ...row,
        order_types: [...row.order_types].sort(byText),
        home_for_order_types: [...row.home_for_order_types].sort(byText),
      }))
      .sort((a, b) => byText(a.alternate_station_id, b.alternate_station_id)),
    carry_times: [...lists.carry_times].sort((a, b) => byText(a.point_id, b.point_id)),
  };
}

// A-9: both slot, same branch, distinct, and the named station is not archived. `found` holds the named stations of
// this branch.
function assertAlternates(
  alternates: StationLists['alternates'],
  stationType: StationRow['station_type'],
  stationId: string,
  found: ReadonlyArray<{ station_id: string; station_type: StationRow['station_type']; archived_at: number | null }>,
): void {
  const invalid = (reason: string) => new DomainError('CONFIG_REFERENCE_INVALID', { field: 'alternates', reason });
  if (alternates.length === 0) return;
  if (stationType !== 'slot') throw invalid('not_slot');
  for (const { alternate_station_id: id } of alternates) {
    if (id === stationId) throw invalid('self');
    const station = found.find((row) => row.station_id === id);
    if (station === undefined) throw invalid('not_found');
    if (station.archived_at !== null) throw invalid('archived');
    if (station.station_type !== 'slot') throw invalid('not_slot');
  }
}

// A-2, A-10: pointId (when given) is an active point of the branch; carry times name points of the branch, archived
// ones included (ruling 4). A branch that does not exist answers 404 first, as insertStation would have.
async function assertPoints(
  scoped: TenantScopedRepository,
  branchId: string,
  pointId: string | null,
  carryTimes: StationLists['carry_times'],
): Promise<void> {
  const carryIds = carryTimes.map((row) => row.point_id);
  const ids = [...new Set(pointId === null ? carryIds : [pointId, ...carryIds])];
  if (ids.length === 0) return;
  const points = await sharePointsById(scoped, branchId, ids);
  const named = (id: string) => points.find((point) => point.point_id === id);
  if (pointId !== null) {
    const point = named(pointId);
    if (point === undefined) return refuseMissingPoint(scoped, branchId, 'not_found');
    if (point.archived_at !== null) throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'point_id', reason: 'archived' });
  }
  if (carryIds.some((id) => named(id) === undefined)) {
    throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'carry_times', reason: 'not_found' });
  }
}

async function refuseMissingPoint(scoped: TenantScopedRepository, branchId: string, reason: string): Promise<never> {
  if (!(await branchExists(scoped, branchId))) throw new DomainError('BRANCH_NOT_FOUND', { branch_id: branchId });
  throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'point_id', reason });
}

// §6.9 POST on the common write script. References FOR SHARE: the point (ruling 1 when not sent), then the alternates.
export async function createStation(
  deps: RestaurantDeps,
  req: OwnerRequest,
  branchId: string,
  body: CreateStationInput,
): Promise<IdempotentResult<{ station: StationWithLists }>> {
  assertBranchAllowed(req.tenant, branchId);
  assertStationFieldsFit(body);
  return withIdempotency(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...hooks(deps) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const scoped = new TenantScopedRepository(req.tenant, client);
      const level = new TenantLevelRepository(req.tenant, client);
      const now = deps.clock.branchNow();
      const lists = normaliseLists(body);
      const stationId = deps.ids.next();
      const pointId =
        body.point_id ?? (await shareDefaultPoint(scoped, branchId)) ?? (await refuseMissingPoint(scoped, branchId, 'no_active_point'));
      await assertPoints(scoped, branchId, pointId, lists.carry_times);
      const namedIds = lists.alternates.map((row) => row.alternate_station_id);
      const named = namedIds.length > 0 ? await shareStationsById(scoped, namedIds) : [];
      assertAlternates(lists.alternates, body.station_type, stationId, named.filter((row) => row.branch_id === branchId));
      const row = await nameTaken('stations_active_name', 'station', body.name, () =>
        insertStation(
          scoped,
          branchId,
          {
            station_id: stationId,
            name: body.name,
            location_label: body.location_label,
            station_type: body.station_type,
            capacity: body.capacity,
            freshness_window_ms: body.station_type === 'batch' ? (body.freshness_window_ms ?? 0) : null,
            completion_mode: body.completion_mode,
            point_id: pointId,
            policy: body.policy,
            freeze_ms: body.freeze_ms,
            min_slack_keep_ms: body.min_slack_keep_ms,
            promise_padding_ms: body.promise_padding_ms,
            pressure_window_ms: body.pressure_window_ms,
            pressure_amber_bp: body.pressure_amber_bp,
            pressure_red_bp: body.pressure_red_bp,
            pressure_alert_ms: body.pressure_alert_ms,
            pause_enabled: body.pause_enabled,
            lane_units: body.lane_units,
            reserve_units: body.reserve_units,
          },
          now,
        ),
      );
      if (row === undefined) throw new DomainError('BRANCH_NOT_FOUND', { branch_id: branchId });
      if (lists.alternates.length > 0) await replaceAlternates(scoped, branchId, stationId, lists.alternates, now);
      if (lists.carry_times.length > 0) await replaceCarryTimes(scoped, branchId, stationId, lists.carry_times, now);
      const station: StationWithLists = { ...row, ...lists };
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

// §6.9 PATCH: lock (the target and the alternates named; see lockStationsById) → rules on the merged row (S22 in-use
// check on a type change or an archive; freshness only for batch; A-2, A-7–A-10) → write the row and the lists that
// changed → one audit row (plus one batch_program / archive row per program a slot change archives) → bump.
export async function patchStation(
  deps: RestaurantDeps,
  req: OwnerRequest,
  branchId: string,
  stationId: string,
  body: PatchStationInput,
): Promise<{ station: StationWithLists }> {
  assertBranchAllowed(req.tenant, branchId);
  return inTransaction(deps.pool, async (client) => {
    const scoped = new TenantScopedRepository(req.tenant, client);
    const level = new TenantLevelRepository(req.tenant, client);
    const namedIds = (body.alternates ?? []).map((row) => row.alternate_station_id);
    const locked = await lockStationsById(scoped, branchId, [...new Set([stationId, ...namedIds])]);
    const target = locked.find((row) => row.station_id === stationId);
    if (target === undefined) throw new DomainError('STATION_NOT_FOUND', { station_id: stationId });
    await deps.testHooks?.afterTargetLock?.('PATCH /v1/admin/branches/:branch_id/stations/:station_id');
    const before: StationWithLists = { ...target, ...(await selectStationLists(scoped, branchId, stationId)) };
    const now = deps.clock.branchNow();
    const stationType = body.station_type ?? before.station_type;
    const typeChanged = stationType !== before.station_type;
    if (stationType === 'slot' && body.freshness_window_ms !== undefined) {
      throw new DomainError('VALIDATION_FAILED', {
        issues: [{ path: 'freshness_window_ms', message: 'only batch stations have a freshness window' }],
      });
    }
    const { archived, alternates, carry_times, ...fields } = body;
    const lists = normaliseLists({ alternates: alternates ?? before.alternates, carry_times: carry_times ?? before.carry_times });
    const merged: StationWithLists = {
      ...before,
      ...sentFields(fields),
      ...lists,
      ...(archived !== undefined ? { archived_at: archived ? (before.archived_at ?? now) : null } : {}),
      station_type: stationType,
      freshness_window_ms:
        stationType === 'slot' ? null : (body.freshness_window_ms ?? (typeChanged ? 0 : before.freshness_window_ms)),
    };
    assertStationFieldsFit(merged);
    if (unchangedRow(before, merged)) return { station: before };
    const archiving = before.archived_at === null && merged.archived_at !== null;
    if (typeChanged || archiving) {
      const ids = await activeRouteItemIds(scoped, branchId, stationId);
      if (ids.length > 0) {
        throw new DomainError('CONFIG_IN_USE', { entity: 'station', id: stationId, used_by: { entity: 'menu_item', ids } });
      }
    }
    // 01c V16 (P-10): an archive is refused while an active stock item is counted at the station
    if (archiving) {
      const ids = await activeStockItemIdsAt(scoped, branchId, stationId);
      if (ids.length > 0) {
        throw new DomainError('CONFIG_IN_USE', { entity: 'station', id: stationId, used_by: { entity: 'stock_item', ids } });
      }
      // A-9: refused while an active station names it as an alternate; its own list does not block and keeps its rows.
      const naming = await activeStationsNamingAlternate(scoped, branchId, stationId);
      if (naming.length > 0) {
        throw new DomainError('CONFIG_IN_USE', { entity: 'station', id: stationId, used_by: { entity: 'station', ids: naming } });
      }
    }
    if (alternates !== undefined) assertAlternates(lists.alternates, stationType, stationId, locked);
    // Ruling 5: a station in an alternates list, either side, cannot become batch.
    if (typeChanged && stationType === 'batch') {
      const naming = await stationsNamingAlternate(scoped, branchId, stationId);
      const ids = naming.length > 0 ? naming : lists.alternates.length > 0 ? [stationId] : [];
      if (ids.length > 0) {
        throw new DomainError('CONFIG_IN_USE', { entity: 'station', id: stationId, used_by: { entity: 'station', ids } });
      }
    }
    const pointMoved = merged.point_id !== before.point_id;
    const restoring = before.archived_at !== null && merged.archived_at === null;
    await assertPoints(scoped, branchId, pointMoved || restoring ? merged.point_id : null, carry_times === undefined ? [] : lists.carry_times);
    const row = await nameTaken('stations_active_name', 'station', merged.name, () =>
      updateStation(scoped, branchId, merged, now),
    );
    if (!unchangedRow(before.alternates, lists.alternates)) {
      await replaceAlternates(scoped, branchId, stationId, lists.alternates, now);
    }
    if (!unchangedRow(before.carry_times, lists.carry_times)) {
      await replaceCarryTimes(scoped, branchId, stationId, lists.carry_times, now);
    }
    const station: StationWithLists = { ...row, ...lists };
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

// §6.9a POST on the common write script: key → write (index → 409) → audit → bump.
export async function createPoint(
  deps: RestaurantDeps,
  req: OwnerRequest,
  branchId: string,
  body: CreatePointInput,
): Promise<IdempotentResult<{ point: AdminPoint }>> {
  assertBranchAllowed(req.tenant, branchId);
  return withIdempotency(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...hooks(deps) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const scoped = new TenantScopedRepository(req.tenant, client);
      const level = new TenantLevelRepository(req.tenant, client);
      const point = await nameTaken('points_branch_name_active', 'point', body.name, () =>
        insertPoint(scoped, {
          branchId,
          pointId: deps.ids.next(),
          name: body.name,
          sortOrder: body.sort_order,
          now: deps.clock.branchNow(),
        }),
      );
      if (point === undefined) throw new DomainError('BRANCH_NOT_FOUND', { branch_id: branchId });
      await writeConfigAudit(
        level,
        {
          actor: { kind: 'owner', ownerUserId: req.ownerUserId },
          entity: 'point',
          entityId: point.point_id,
          branchId,
          action: 'create',
          before: null,
          after: point,
        },
        deps,
      );
      await deps.testHooks?.beforeBump?.();
      await bumpConfigVersion(level, { kind: 'branch', branchId });
      return { status: 201, body: { point: toPointWire(point) } };
    },
  );
}

// §6.9a PATCH: lock (Q-v2.1-1 404) → version (R30 409 CONFIG_STALE, a stale no-op too) → no-op (200, nothing written)
// → archive with an active station (Q-v2.1-2 409) → name (index → 409, a rename or a restore) → write → audit → bump.
export async function patchPoint(
  deps: RestaurantDeps,
  req: OwnerRequest,
  branchId: string,
  pointId: string,
  body: PatchPointInput,
): Promise<{ point: AdminPoint }> {
  assertBranchAllowed(req.tenant, branchId);
  return inTransaction(deps.pool, async (client) => {
    const scoped = new TenantScopedRepository(req.tenant, client);
    const level = new TenantLevelRepository(req.tenant, client);
    const before = await lockPoint(scoped, branchId, pointId);
    if (before === undefined) throw new DomainError('POINT_NOT_FOUND', { point_id: pointId });
    await deps.testHooks?.afterTargetLock?.('PATCH /v1/admin/branches/:branch_id/points/:point_id');
    if (body.expected_version !== toPointWire(before).version) {
      throw new DomainError('CONFIG_STALE', { entity: 'point', id: pointId });
    }
    const now = deps.clock.branchNow();
    const merged: PointRow = {
      ...before,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.sort_order !== undefined ? { sort_order: body.sort_order } : {}),
      ...(body.archived !== undefined ? { archived_at: body.archived ? (before.archived_at ?? now) : null } : {}),
    };
    if (unchangedRow(before, merged)) return { point: toPointWire(before) };
    if (before.archived_at === null && merged.archived_at !== null) {
      const ids = await activeStationIdsAtPoint(scoped, branchId, pointId);
      if (ids.length > 0) {
        throw new DomainError('CONFIG_IN_USE', { entity: 'point', id: pointId, used_by: { entity: 'station', ids } });
      }
    }
    const point = await nameTaken('points_branch_name_active', 'point', merged.name, () => updatePoint(scoped, branchId, merged, now));
    await writeConfigAudit(
      level,
      {
        actor: { kind: 'owner', ownerUserId: req.ownerUserId },
        entity: 'point',
        entityId: pointId,
        branchId,
        action: auditActionFor(before, point),
        before,
        after: point,
      },
      deps,
    );
    await deps.testHooks?.beforeBump?.();
    await bumpConfigVersion(level, { kind: 'branch', branchId });
    return { point: toPointWire(point) };
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

// §6.12 PATCH: lock → rules on the merged row (S22 in-use check on archive: items, then 01c V16 active deals) → write → audit → bump every branch.
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
      // 01c V16: an active deal keeps its tax class (a plain read after the target lock; AD-11 active deals only).
      const dealIds = await activeDealIdsWith(level, 'tax_class_id', taxClassId);
      if (dealIds.length > 0) {
        throw new DomainError('CONFIG_IN_USE', { entity: 'tax_class', id: taxClassId, used_by: { entity: 'deal', ids: dealIds } });
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

type CategoryWire = CategoryRow & { availability_windows: WindowRow[]; goes_with: GoesWithLinkRow[] };

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
        goes_with: [], // §6.13: PATCH only
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

// §6.13 PATCH: lock → no-op (row, windows, goes_with, S26) → A-13 self link (400) → rules on the merged row (S22
// in-use check on archive: items, then 01c V16 active variant groups, then active deals) → A-13 targets (422) →
// write (windows S47 and goes_with A-13 replaced when sent) → audit → bump every branch.
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
    const beforeLinks = await selectGoesWithOf(level, 'category', categoryId);
    const nextLinks = goesWithFrom('category', categoryId, body.goes_with);
    if (unchangedRow(before, merged) && unchangedWindows(beforeWindows, body.availability_windows) && unchangedLinks(beforeLinks, nextLinks)) {
      return { category: { ...before, availability_windows: beforeWindows, goes_with: beforeLinks } };
    }
    assertNoSelfLink(nextLinks);
    if (before.archived_at === null && merged.archived_at !== null) {
      const ids = await activeItemIdsWith(level, 'category_id', categoryId);
      if (ids.length > 0) {
        throw new DomainError('CONFIG_IN_USE', { entity: 'category', id: categoryId, used_by: { entity: 'menu_item', ids } });
      }
      // 01c V16: an active variant group keeps its category (a plain read after the target lock).
      const groupIds = await activeVariantGroupIdsIn(level, categoryId);
      if (groupIds.length > 0) {
        throw new DomainError('CONFIG_IN_USE', {
          entity: 'category',
          id: categoryId,
          used_by: { entity: 'variant_group', ids: groupIds },
        });
      }
      // 01c V16: an active deal keeps its category (a plain read after the target lock; AD-11 active deals only).
      const dealIds = await activeDealIdsWith(level, 'category_id', categoryId);
      if (dealIds.length > 0) {
        throw new DomainError('CONFIG_IN_USE', { entity: 'category', id: categoryId, used_by: { entity: 'deal', ids: dealIds } });
      }
    }
    await assertGoesWithTargets(level, nextLinks);
    const row = await nameTaken('categories_active_name', 'category', merged.name, () =>
      updateCategory(level, merged, now),
    );
    const category = {
      ...row,
      availability_windows: await replaceWindows(level, deps.ids, target, beforeWindows, body.availability_windows),
      goes_with: await replaceGoesWith(level, deps.ids, 'category', categoryId, beforeLinks, nextLinks, now),
    };
    await writeConfigAudit(
      level,
      {
        actor: { kind: 'owner', ownerUserId: req.ownerUserId },
        entity: 'category',
        entityId: categoryId,
        branchId: null,
        action: auditActionFor(before, category),
        before: { ...before, availability_windows: beforeWindows, goes_with: beforeLinks },
        after: category,
      },
      deps,
    );
    await deps.testHooks?.beforeBump?.();
    await bumpConfigVersion(level, { kind: 'tenant', ownerUserId: req.ownerUserId });
    return { category };
  });
}

// §6.11 (01c §6.3): 8 fixed statements (coversEveryBranch, tax classes, categories with windows and goes_with, variant
// groups with their members, the item page with its goes_with, its windows, its routes, its draws). The cursor is base64url JSON
// { n: lower(name), id } of the page's last row (S48 keyset).
export async function listMenu(deps: RestaurantDeps, tenant: TenantContext, ownerUserId: string, query: MenuQueryInput) {
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
  const level = new TenantLevelRepository(tenant, deps.pool);
  const scoped = new TenantScopedRepository(tenant, deps.pool);
  const canEditTenant = await coversEveryBranch(level, ownerUserId);
  const taxClasses = await selectAllTaxClasses(level);
  const categories = await selectAllCategories(level);
  const variantGroups = await selectAllVariantGroups(level);
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
  const draws = await selectDrawsOf(level, ids);
  const last = pageRows.at(-1);
  const items = pageRows.map(({ item, goesWith }) =>
    itemWire(
      item,
      windows.filter((w) => w.item_id === item.item_id),
      draws.filter((d) => d.item_id === item.item_id),
      routes.filter((r) => r.item_id === item.item_id),
      goesWith,
    ),
  );
  return {
    can_edit_tenant: canEditTenant,
    tax_classes: taxClasses,
    categories,
    variant_groups: variantGroups.map(toVariantGroupWire),
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

// §6.14 on the common write script (01c §6.4): key → tenant-wide 403 (§6 C4, before all) → route branches allowed
// (404) → stock ≤ cook (422) → references FOR SHARE in the §6
// lock order: variant group (3), the draw's stock item (5), category (6), tax class (7), stations then programs (8;
// one statement per kind) → the §3.3 item rows (category equals the group's, the V4 draw unit rule, a weighed item
// has no draw, the effective-set limit: one links read) → item, draw, routes, windows (one INSERT each; branch rows last, 9) → one audit INSERT → bump every
// branch (10, S8). The deprecated columns are written as §5.1 says (P-11) and are not on the wire.
export async function createMenuItem(
  deps: RestaurantDeps,
  req: OwnerRequest,
  body: CreateMenuItemInput,
): Promise<IdempotentResult<{ item: AdminMenuItem }>> {
  return withIdempotency(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...hooks(deps) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const scoped = new TenantScopedRepository(req.tenant, client);
      const level = new TenantLevelRepository(req.tenant, client);
      await assertTenantWide(level, req.ownerUserId);
      for (const route of body.routes) assertBranchAllowed(req.tenant, route.branch_id);
      if (body.stock_time_ms !== null && body.stock_time_ms > body.cook_time_ms) {
        throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'stock_time_ms', reason: 'stock_time_exceeds_cook_time' });
      }
      const group = body.variant_group_id === null ? undefined : await shareVariantGroup(level, body.variant_group_id);
      if (body.variant_group_id !== null) assertReference('variant_group_id', group);
      const draw = body.stock_draws[0];
      const stockItem = draw === undefined ? undefined : await shareStockItem(level, draw.stock_item_id);
      if (draw !== undefined) assertReference('stock_draws.0.stock_item_id', stockItem);
      assertReference('category_id', await shareCategory(level, body.category_id));
      if (body.tax_class_id !== null) assertReference('tax_class_id', await shareTaxClass(level, body.tax_class_id));
      await assertRoutes(scoped, body.routes);
      await deps.testHooks?.afterReferenceLock?.('POST /v1/admin/menu-items');
      if (group !== undefined && group.category_id !== body.category_id) {
        throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'category_id', reason: 'category_mismatch' });
      }
      if (draw !== undefined && stockItem !== undefined) assertDrawUnits(body.sale_unit, stockItem.stock_unit, draw);
      if (body.requires_weighing && draw !== undefined) {
        throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'stock_draws', reason: 'weighed_item_stock_draw' });
      }
      // §3.3 effective-set row (V8, M5): the new item's category and variant group links, one plain read; the
      // references above are active. A group carrying the excess answers at variant_group_id, else category_id.
      const itemId = deps.ids.next();
      const newItem = { item_id: itemId, category_id: body.category_id, variant_group_id: body.variant_group_id };
      await assertItemEffectiveSets(
        level,
        [newItem],
        new Set([itemId, body.category_id, ...(body.variant_group_id === null ? [] : [body.variant_group_id])]),
        body.variant_group_id === null ? 'category_id' : 'variant_group_id',
      );
      const now = deps.clock.branchNow();
      const { routes: routeInput, availability_windows: windowInput, stock_draws: drawInput, ...fields } = body;
      const row = await nameTaken('menu_items_active_name', 'menu_item', body.name, () =>
        nameTaken('menu_items_variant_name', 'variant', body.variant_name ?? '', () =>
          insertMenuItem(
            level,
            {
              item_id: itemId,
              ...fields,
              // §5.1 deprecated columns (P-11): kept so the 01a CHECKs hold, never read by 01c.
              group_label: null,
              stock_unit: body.sale_unit,
              stock_per_sale_unit: 1,
              low_stock_threshold: null,
              carries_over: false,
            },
            now,
          ),
        ),
      );
      const draws = drawInput.length > 0 ? await insertDraws(level, row.item_id, drawInput) : [];
      const routes = routeInput.length > 0 ? await insertItemRoutes(scoped, row.item_id, routeInput, now) : [];
      const windows = await replaceWindows(level, deps.ids, { item_id: row.item_id }, [], windowInput);
      const { routes: wiredRoutes, ...item } = itemWire(row, windows, draws, routes, []); // goes_with: §6.15 PATCH only
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
      await bumpEveryBranch(level);
      return { status: 201, body: { item: { ...item, routes: wiredRoutes } } };
    },
  );
}

// 01c §6.3, §5.4: the item wire, exactly its keys (the deprecated columns are left out); routes as 01a §6.11.
function itemWire(
  item: MenuItemRow,
  windows: readonly WindowRow[],
  draws: readonly DrawRow[],
  routes: readonly RouteRow[],
  links: readonly GoesWithLinkRow[],
): AdminMenuItem {
  return { ...itemFields(item, windows, draws, links), routes: wireRoutes(routes) };
}

// The item wire without its routes: what a menu_item config_audit row holds (§6.4, §6.5: draws in before / after).
function itemFields(
  item: MenuItemRow,
  windows: readonly WindowRow[],
  draws: readonly DrawRow[],
  links: readonly GoesWithLinkRow[],
): Omit<AdminMenuItem, 'routes'> {
  return {
    item_id: item.item_id,
    category_id: item.category_id,
    tax_class_id: item.tax_class_id,
    name: item.name,
    variant_group_id: item.variant_group_id,
    variant_name: item.variant_name,
    description: item.description,
    sort_order: item.sort_order,
    price_minor: item.price_minor,
    serve_mode: item.serve_mode,
    prep_buffer_ms: item.prep_buffer_ms,
    cook_time_ms: item.cook_time_ms,
    stock_time_ms: item.stock_time_ms,
    out_of_stock_behaviour: item.out_of_stock_behaviour,
    sale_unit: item.sale_unit,
    requires_weighing: item.requires_weighing,
    is_ready_item: item.is_ready_item,
    stock_draws: draws.map(({ stock_item_id, quantity_per_sale_unit }) => ({ stock_item_id, quantity_per_sale_unit })),
    availability_windows: windows.map(({ start_ms, end_ms }) => ({ start_ms, end_ms })),
    weight_pct: item.weight_pct,
    max_early_ms: item.max_early_ms,
    max_carry_ms: item.max_carry_ms,
    max_late_ms: item.max_late_ms,
    adjust_time_ms: item.adjust_time_ms,
    goes_with: [...links],
    archived_at: item.archived_at,
  };
}

// 01c §6.5 restart rule (N2): thrown inside the transaction when the locked item's variant_group_id differs from
// the unlocked read; withItemRestart rolls back and runs again. Never leaves this module.
class ItemRestart extends Error {}

const ITEM_ATTEMPTS = 3;

// 01c §6 "§6.5 restart rule" (N2): each attempt is its own transaction; an ItemRestart rolls it back and starts
// again from the beginning. After attempt 3 → 503 SERVICE_UNAVAILABLE (nothing committed). Any other error ends it.
async function withItemRestart<T>(deps: RestaurantDeps, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= ITEM_ATTEMPTS; attempt += 1) {
    try {
      return await inTransaction(deps.pool, run);
    } catch (error) {
      if (!(error instanceof ItemRestart)) throw error;
    }
  }
  throw new DomainError('SERVICE_UNAVAILABLE');
}

type SharedGroup = { variant_group_id: string; category_id: string; archived_at: number | null };

// What every §6.5 rule reads: the locked row, the merged row and draw, the groups locked before the item, and the
// references the first rule locks (the draw's stock item 5, category 6, then tax class 7, in the §6 order).
interface ItemPatch {
  level: TenantLevelRepository;
  scoped: TenantScopedRepository;
  body: PatchMenuItemInput;
  before: MenuItemRow;
  merged: MenuItemRow;
  draw: DrawRow | undefined;
  links: readonly GoesWithLinkRow[] | undefined;
  groups: readonly SharedGroup[];
  restoring: boolean;
  routes: RouteRow[];
  stockItem?: { stock_unit: string; archived_at: number | null } | undefined;
  category?: { archived_at: number | null } | undefined;
  taxClass?: { archived_at: number | null } | undefined;
  linkingGroupIds?: string[] | undefined;
}

type ItemRule = (p: ItemPatch) => void | Promise<void>;

const invalidReference = (field: string, reason: string) => new DomainError('CONFIG_REFERENCE_INVALID', { field, reason });
const groupOf = (p: ItemPatch) => p.groups.find((g) => g.variant_group_id === p.merged.variant_group_id);
const isActive = (p: ItemPatch) => p.merged.archived_at === null;
const inUse = (p: ItemPatch, entity: 'modifier_group' | 'deal', ids: string[]) =>
  new DomainError('CONFIG_IN_USE', { entity: 'menu_item', id: p.before.item_id, used_by: { entity, ids } });
// R4 and R10 share one read (§6.5 R10: "the same read as R4"); read once per attempt.
const linkingGroups = async (p: ItemPatch) => (p.linkingGroupIds ??= await linkingGroupIds(p.level, p.before.item_id));

// 01c §6.5 rule precedence (v0.6 Q2) with the T4 decision (§12.7, P-8): after the no-op, in this order; the first
// failure answers.
const ITEM_PATCH_RULES: ReadonlyArray<readonly [name: string, rule: ItemRule]> = [
  // C4 step 4: references on sent fields. The merged draw's stock item (5; R2 reads its unit, R9 its archive,
  // under this lock), then the category and tax class (sent, or on an active merged row, as 01a did) are locked
  // here in the §6 kind order; the variant group was locked before the item.
  [
    'references on sent fields',
    async (p) => {
      const active = isActive(p);
      if (p.draw !== undefined) p.stockItem = await shareStockItem(p.level, p.draw.stock_item_id);
      if (p.body.category_id !== undefined || active) p.category = await shareCategory(p.level, p.merged.category_id);
      if (p.merged.tax_class_id !== null && (p.body.tax_class_id !== undefined || active)) {
        p.taxClass = await shareTaxClass(p.level, p.merged.tax_class_id);
      }
      if (p.body.variant_group_id !== undefined && p.body.variant_group_id !== null) {
        assertReference('variant_group_id', groupOf(p), active);
      }
      if (p.body.stock_draws !== undefined && p.draw !== undefined) {
        assertReference('stock_draws.0.stock_item_id', p.stockItem, active);
      }
      if (p.body.category_id !== undefined) assertReference('category_id', p.category, active);
      if (p.body.tax_class_id !== undefined && p.merged.tax_class_id !== null) assertReference('tax_class_id', p.taxClass, active);
    },
  ],
  // (1) 400
  [
    '400 variant pair',
    (p) => {
      if ((p.merged.variant_group_id === null) === (p.merged.variant_name === null)) return;
      const path = p.merged.variant_name === null ? 'variant_name' : 'variant_group_id';
      throw new DomainError('VALIDATION_FAILED', { issues: [{ path, message: 'variant_group_id and variant_name go together' }] });
    },
  ],
  [
    '400 R7 sale_unit part',
    (p) => {
      if (!p.merged.requires_weighing || p.merged.sale_unit !== 'piece') return;
      const path = p.body.requires_weighing !== undefined ? 'requires_weighing' : 'sale_unit';
      throw new DomainError('VALIDATION_FAILED', { issues: [{ path, message: "requires_weighing needs sale_unit 'g' or 'ml'" }] });
    },
  ],
  ['400 A-13 self link', (p) => assertNoSelfLink(p.links)],
  // (2) 409 CONFIG_IN_USE: R4, R10, R6
  // (V16, D-3; P1). Plain reads after the item lock, no lock taken (§6 "Lock order").
  [
    '409 R4 archive while linked or offered',
    async (p) => {
      if (p.before.archived_at !== null || isActive(p)) return;
      const groupIds = await linkingGroups(p);
      if (groupIds.length > 0) throw inUse(p, 'modifier_group', groupIds);
      const dealIds = await offeringDealIds(p.level, p.before.item_id);
      if (dealIds.length > 0) throw inUse(p, 'deal', dealIds);
    },
  ],
  [
    '409 R10 linked item stays piece',
    async (p) => {
      const awayFromPiece = p.before.sale_unit === 'piece' && p.merged.sale_unit !== 'piece';
      const weighingOn = !p.before.requires_weighing && p.merged.requires_weighing;
      if (!awayFromPiece && !weighingOn) return;
      const groupIds = await linkingGroups(p);
      if (groupIds.length > 0) throw inUse(p, 'modifier_group', groupIds);
    },
  ],
  [
    '409 R6 deal part would mix units',
    async (p) => {
      if (p.merged.sale_unit === p.before.sale_unit) return;
      const dealIds = await dealsBrokenBySaleUnit(p.level, p.before.item_id, p.merged.sale_unit);
      if (dealIds.length > 0) throw inUse(p, 'deal', dealIds);
    },
  ],
  // (3) 422: 01a's first, then R1, R1a, R2, R3, R7 draw part, R8, R9
  [
    '422 01a stock_time_exceeds_cook_time',
    (p) => {
      if (p.merged.stock_time_ms !== null && p.merged.stock_time_ms > p.merged.cook_time_ms) {
        throw invalidReference('stock_time_ms', 'stock_time_exceeds_cook_time');
      }
    },
  ],
  [
    '422 01a references on the active merged row',
    (p) => {
      if (!isActive(p)) return;
      if (p.body.category_id === undefined) assertReference('category_id', p.category);
      if (p.body.tax_class_id === undefined && p.merged.tax_class_id !== null) assertReference('tax_class_id', p.taxClass);
    },
  ],
  [
    '422 01a routes on restore',
    async (p) => {
      if (p.restoring) await assertRoutes(p.scoped, p.routes);
    },
  ],
  [
    '422 R1 category equals the group’s',
    (p) => {
      if (p.merged.variant_group_id === null) return;
      const changed = p.merged.category_id !== p.before.category_id || p.merged.variant_group_id !== p.before.variant_group_id;
      const group = groupOf(p);
      if ((changed || p.restoring) && group !== undefined && group.category_id !== p.merged.category_id) {
        throw invalidReference('category_id', 'category_mismatch');
      }
    },
  ],
  [
    '422 R1a restored member’s group is active',
    (p) => {
      if (p.restoring && p.merged.variant_group_id !== null && groupOf(p)?.archived_at !== null) {
        throw invalidReference('variant_group_id', 'archived');
      }
    },
  ],
  [
    '422 R2 draw unit',
    (p) => {
      if (p.draw !== undefined && p.stockItem !== undefined) assertDrawUnits(p.merged.sale_unit, p.stockItem.stock_unit, p.draw);
    },
  ],
  // (V8, §3.3, M5) one plain links read when category_id or variant_group_id changes. A changed group answers at
  // variant_group_id, else category_id. Targets are active unless read archived (the item itself: the merged row).
  [
    '422 R3 effective-set limit',
    async (p) => {
      const groupChanged = p.merged.variant_group_id !== p.before.variant_group_id;
      if (!groupChanged && p.merged.category_id === p.before.category_id) return;
      const group = groupOf(p);
      const active = new Set([
        ...(isActive(p) ? [p.merged.item_id] : []),
        ...(p.category === undefined || p.category.archived_at === null ? [p.merged.category_id] : []),
        ...(p.merged.variant_group_id !== null && group?.archived_at === null ? [p.merged.variant_group_id] : []),
      ]);
      const item = { item_id: p.merged.item_id, category_id: p.merged.category_id, variant_group_id: p.merged.variant_group_id };
      await assertItemEffectiveSets(p.level, [item], active, groupChanged ? 'variant_group_id' : 'category_id');
    },
  ],
  [
    '422 R7 draw part',
    (p) => {
      if (!p.merged.requires_weighing || p.draw === undefined) return;
      const field = p.body.requires_weighing !== undefined && p.body.stock_draws === undefined ? 'requires_weighing' : 'stock_draws';
      throw invalidReference(field, 'weighed_item_stock_draw');
    },
  ],
  // (V18) requires_weighing turned on while an active part of an active deal offers the item (AD-11): one plain read
  [
    '422 R8 weighed item in a deal',
    async (p) => {
      if (p.before.requires_weighing || !p.merged.requires_weighing) return;
      if ((await offeringDealIds(p.level, p.before.item_id)).length > 0) throw invalidReference('requires_weighing', 'weighed_item_in_deal');
    },
  ],
  [
    '422 R9 restored draw’s stock item',
    (p) => {
      if (p.restoring && p.draw !== undefined && p.stockItem?.archived_at !== null) {
        throw invalidReference('stock_draws.0.stock_item_id', 'archived');
      }
    },
  ],
  ['422 A-13 goes_with targets', (p) => assertGoesWithTargets(p.level, p.links)],
];

// 01c §6.5 (01a §6.15): per attempt (withItemRestart): tenant-wide 403 (C4, before all) → read the item without a
// lock (404) → lock its stored and merged variant group(s) FOR SHARE in id order (3) → lock the item FOR UPDATE (4);
// a variant_group_id other than the unlocked read → restart → merge → no-op (row, windows, draws and goes_with, S26) →
// ITEM_PATCH_RULES (the draw's stock item is locked in the first, §6 kind 5) → write (R5 and 01a's name index;
// stock_draws and goes_with replaced by delete + insert; the deprecated columns as §5.1, P-11) → audit (the item wire,
// draws and goes_with in before / after, as on create) → bump every branch (10). No variant_groups row is locked after the item; later
// reads of a group use the rows locked before it.
export async function patchMenuItem(
  deps: RestaurantDeps,
  req: OwnerRequest,
  itemId: string,
  body: PatchMenuItemInput,
): Promise<{ item: AdminMenuItem }> {
  let attempt = 0;
  return withItemRestart(deps, async (client) => {
    attempt += 1;
    const scoped = new TenantScopedRepository(req.tenant, client);
    const level = new TenantLevelRepository(req.tenant, client);
    await assertTenantWide(level, req.ownerUserId);
    const seen = await readMenuItem(level, itemId);
    if (seen === undefined) throw new DomainError('MENU_ITEM_NOT_FOUND', { item_id: itemId });
    const mergedGroupId = body.variant_group_id !== undefined ? body.variant_group_id : seen.variant_group_id;
    const groupIds = [...new Set([seen.variant_group_id, mergedGroupId].filter((id) => id !== null))].sort();
    const groups = groupIds.length > 0 ? await shareVariantGroups(level, groupIds) : [];
    await deps.testHooks?.beforeItemLock?.(attempt);
    const before = await lockMenuItem(level, itemId);
    if (before === undefined) throw new DomainError('MENU_ITEM_NOT_FOUND', { item_id: itemId });
    if (before.variant_group_id !== seen.variant_group_id) throw new ItemRestart();
    const now = deps.clock.branchNow();
    const { archived, availability_windows: windowInput, stock_draws: drawInput, goes_with: linkInput, ...fields } = body;
    const merged: MenuItemRow = {
      ...before,
      ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
      ...(archived !== undefined ? { archived_at: archived ? (before.archived_at ?? now) : null } : {}),
    };
    const beforeWindows = await selectWindowsOf(level, { item_id: itemId });
    const beforeDraws: DrawRow[] = (await selectDrawsOf(level, [itemId])).map(({ stock_item_id, quantity_per_sale_unit }) => ({
      stock_item_id,
      quantity_per_sale_unit,
    }));
    const routes = await selectItemRoutes(scoped, [itemId]);
    const beforeLinks = await selectGoesWithOf(level, 'item', itemId);
    const nextLinks = goesWithFrom('item', itemId, linkInput);
    // T4 (§12.7, V13 divergence): the no-op runs before the reference checks on menu_items; S26 compares the
    // merged row, the windows, the draws and the goes_with list.
    if (
      unchangedRow(before, merged) &&
      unchangedWindows(beforeWindows, windowInput) &&
      unchangedDraws(beforeDraws, drawInput) &&
      unchangedLinks(beforeLinks, nextLinks)
    ) {
      return { item: itemWire(before, beforeWindows, beforeDraws, routes, beforeLinks) };
    }
    const patch: ItemPatch = {
      level,
      scoped,
      body,
      before,
      merged,
      draw: (drawInput ?? beforeDraws)[0],
      links: nextLinks,
      groups,
      restoring: before.archived_at !== null && merged.archived_at === null,
      routes,
    };
    for (const [, rule] of ITEM_PATCH_RULES) await rule(patch);
    // (4) R5 (variant name, index) and 01a's active-name index, at the write
    // §5.1 deprecated columns (P-11): set on every item write, never read by 01c.
    const written: MenuItemRow = {
      ...merged,
      group_label: null,
      stock_unit: merged.sale_unit,
      stock_per_sale_unit: 1,
      low_stock_threshold: null,
      carries_over: false,
    };
    const row = await nameTaken('menu_items_active_name', 'menu_item', merged.name, () =>
      nameTaken('menu_items_variant_name', 'variant', merged.variant_name ?? '', () => updateMenuItem(level, written, now)),
    );
    const windows = await replaceWindows(level, deps.ids, { item_id: itemId }, beforeWindows, windowInput);
    const draws = await replaceDraws(level, itemId, beforeDraws, drawInput);
    const links = await replaceGoesWith(level, deps.ids, 'item', itemId, beforeLinks, nextLinks, now);
    const item = itemFields(row, windows, draws, links);
    await writeConfigAudit(
      level,
      {
        actor: { kind: 'owner', ownerUserId: req.ownerUserId },
        entity: 'menu_item',
        entityId: itemId,
        branchId: null,
        action: auditActionFor(before, item),
        before: itemFields(before, beforeWindows, beforeDraws, beforeLinks),
        after: item,
      },
      deps,
    );
    await deps.testHooks?.beforeBump?.();
    await bumpEveryBranch(level);
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

// 01c §6.5 S26: the sent draws equal the stored ones (pilot: 0–1, compared by stock item).
function unchangedDraws(current: readonly DrawRow[], next: readonly DrawRow[] | undefined): boolean {
  if (next === undefined) return true;
  const keys = (rows: readonly DrawRow[]) => rows.map((d) => `${d.stock_item_id}:${d.quantity_per_sale_unit}`).sort();
  return canonicalJson(keys(current)) === canonicalJson(keys(next));
}

// 01c §6.5: stock_draws replaces the item's draws (delete + insert); not sent → the stored draws.
async function replaceDraws(
  level: TenantLevelRepository,
  itemId: string,
  current: DrawRow[],
  next: DrawRow[] | undefined,
): Promise<DrawRow[]> {
  if (next === undefined || unchangedDraws(current, next)) return current;
  if (current.length > 0) await deleteDrawsOf(level, itemId);
  return next.length > 0 ? insertDraws(level, itemId, next) : [];
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

// A-13: the sent list as stored rows (the source is the path), in the read's order; not sent → undefined.
function goesWithFrom(
  kind: GoesWithKind,
  sourceId: string,
  input: ReadonlyArray<{ target_kind: GoesWithKind; target_id: string; excluded: boolean }> | undefined,
): GoesWithLinkRow[] | undefined {
  if (input === undefined) return undefined;
  const key = (link: { target_kind: string; target_id: string }) => `${link.target_kind}:${link.target_id}`;
  return input
    .map(({ target_kind, target_id, excluded }) => ({ source_kind: kind, source_id: sourceId, target_kind, target_id, excluded }))
    .sort((a, b) => (key(a) < key(b) ? -1 : 1));
}

// S26: goesWithFrom and selectGoesWithOf answer in one order, so the lists compare directly.
function unchangedLinks(current: readonly GoesWithLinkRow[], next: readonly GoesWithLinkRow[] | undefined): boolean {
  return next === undefined || canonicalJson(current) === canonicalJson(next);
}

// A-13: a source never links itself. An item naming its own category is not a self link.
function assertNoSelfLink(links: readonly GoesWithLinkRow[] | undefined): void {
  const self = links?.find((link) => link.target_kind === link.source_kind && link.target_id === link.source_id);
  if (self === undefined) return;
  throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'goes_with', message: 'a source cannot link itself' }] });
}

// A-13: every target is an active row of this tenant (another tenant's reads as unknown).
async function assertGoesWithTargets(level: TenantLevelRepository, links: readonly GoesWithLinkRow[] | undefined): Promise<void> {
  if (links === undefined || links.length === 0) return;
  const idsOf = (kind: GoesWithKind) => links.filter((link) => link.target_kind === kind).map((link) => link.target_id);
  const rows = await selectGoesWithTargets(level, idsOf('category'), idsOf('item'));
  const found = new Map(rows.map((row) => [`${row.kind}:${row.id}`, row]));
  for (const link of links) assertReference('goes_with', found.get(`${link.target_kind}:${link.target_id}`));
}

// A-13: replace-list (delete + one multi-row INSERT, in the write's transaction); not sent or unchanged → the stored list.
async function replaceGoesWith(
  level: TenantLevelRepository,
  ids: IdGen,
  kind: GoesWithKind,
  sourceId: string,
  current: GoesWithLinkRow[],
  next: GoesWithLinkRow[] | undefined,
  now: number,
): Promise<GoesWithLinkRow[]> {
  if (next === undefined || unchangedLinks(current, next)) return current;
  if (current.length > 0) await deleteGoesWithOf(level, kind, sourceId);
  if (next.length > 0) await insertGoesWith(level, next, ids, now);
  return next;
}

// 01c V4 (01a S44 between the item and its stock item): equal units → quantity_per_sale_unit 1; different units
// → sale_unit 'piece' (any quantity in range).
function assertDrawUnits(saleUnit: string, stockUnit: string, draw: DrawRow): void {
  const ok = saleUnit === stockUnit ? draw.quantity_per_sale_unit === 1 : saleUnit === 'piece';
  if (!ok) throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'stock_draws.0.stock_item_id', reason: 'unit_mismatch' });
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
async function nameTaken<T>(index: string, entity: AuditEntity | 'variant', name: string, write: () => Promise<T>): Promise<T> {
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
