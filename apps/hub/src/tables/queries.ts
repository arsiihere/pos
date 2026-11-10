import { DomainError, type DeviceType, type TableState } from '@pos/domain';
import type { BranchConfig } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentDirectory } from '../auth/guards.js';
import type { StaffDirectory } from '../auth/staff-directory.js';
import { defineQuery, queryRegistry } from '../queries/registry.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import { registerCatchUp, type CatchUpPart } from '../ws/catch-up.js';
import { floorOf, scopeCoversFloor } from './handover.js';

// 02a v1.1.3 §6.17 table-map, §6.18 handover-candidates, catch-up part `tables` (the §6.17 builder for the
// socket's (staff, device)). Both queries are polled: countsAsActivity false (00 M59).

export const TABLE_MAP_DEVICE_TYPES: DeviceType[] = ['tablet', 'phone', 'cashier_kiosk'];

interface Person {
  staff_id: string;
  name: string | null;
}

export interface MapTile {
  table_id: string;
  name: string;
  seats: number | null;
  archived: boolean;
  state: TableState;
  seating_id: string | null;
  party_size: number | null;
  primary_table_id: string | null;
  joined_table_names: string[];
  holder: Person | null;
  assignee: Person | null;
  lock: (Person & { mine: boolean }) | null;
  opened_at: number | null;
  bill_requested_at: number | null;
  live_order_count: number;
}

export interface TableMapBody {
  as_of_seq: number;
  floors: Array<{ floor_id: string; name: string | null; zones: Array<{ zone_id: string | null; name: string | null; tables: MapTile[] }> }>;
}

interface SeatedRow {
  table_id: string;
  seating_id: string;
  primary_table_id: string;
  state: TableState;
  holder_staff_id: string;
  party_size: number | null;
  opened_at: number;
  bill_requested_at: number | null;
}

// 1: the open seatings with their tables, joined order (primary first)
const OPEN_SEATINGS = `SELECT st.table_id AS table_id, s.seating_id AS seating_id, s.primary_table_id AS primary_table_id,
       s.state AS state, s.holder_staff_id AS holder_staff_id, s.party_size AS party_size, s.opened_at AS opened_at,
       s.bill_requested_at AS bill_requested_at
  FROM seatings s
  JOIN seating_tables st ON st.seating_id = s.seating_id
 WHERE s.state <> 'CLOSED'
 ORDER BY s.seating_id, st.joined_at, st.table_id`;
// 2: the locks (one per open seating)
const LOCKS = `SELECT seating_id, staff_id, device_id FROM table_locks`;
// 3: live (not cancelled) order counts of the open seatings
const LIVE_ORDER_COUNTS = `SELECT so.seating_id AS seating_id, COUNT(*) AS n
  FROM seating_orders so
  JOIN seatings s ON s.seating_id = so.seating_id
 WHERE so.cancelled = 0 AND s.state <> 'CLOSED'
 GROUP BY so.seating_id`;
// +1 (the query only; the catch-up part takes the socket's as_of_seq)
const LAST_SEQ = `SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE branch_id = ?`;

/**
 * §6.17 builder: 3 statements. `mine` = the lock is the asking staff's on the asking device. Configured tables by
 * floor (sort order), zone (sort order, then the no-zone group), table (sort order); a seated table the config no
 * longer lists (archived, AD-2) goes to a last "Archived tables" group (SG-4): floor_id '', name null, zone null,
 * name = table_id, seats null, archived true — until it is cleaned. A FREE archived table is not shown (§3.14).
 */
export function tableMapBody(
  db: Database.Database,
  who: { staffId: string | null; deviceId: string | null },
  o: { asOfSeq: number; directory: StaffDirectory; floorId?: string; config?: BranchConfig | null },
): TableMapBody {
  const seatedRows = db.prepare(OPEN_SEATINGS).all() as SeatedRow[];
  const locks = db.prepare(LOCKS).all() as Array<{ seating_id: string; staff_id: string; device_id: string }>;
  const counts = db.prepare(LIVE_ORDER_COUNTS).all() as Array<{ seating_id: string; n: number }>;
  const directory = o.directory;
  const config = o.config === undefined ? branchConfig() : o.config;

  const names = new Map<string, string>();
  for (const floor of config?.floors ?? []) for (const t of floor.tables) names.set(t.table_id, t.name);
  const person = (staff_id: string | null): Person | null =>
    staff_id === null ? null : { staff_id, name: directory.get(staff_id)?.display_name ?? null };

  const bySeating = new Map<string, SeatedRow[]>();
  const seatedByTable = new Map<string, SeatedRow>();
  for (const row of seatedRows) {
    const list = bySeating.get(row.seating_id) ?? [];
    list.push(row);
    bySeating.set(row.seating_id, list);
    seatedByTable.set(row.table_id, row);
  }
  const lockBySeating = new Map(locks.map((l) => [l.seating_id, l]));
  const countBySeating = new Map(counts.map((c) => [c.seating_id, c.n]));

  const tile = (table_id: string, name: string, seats: number | null, archived: boolean): MapTile => {
    const seated = seatedByTable.get(table_id);
    if (seated === undefined) {
      return {
        table_id,
        name,
        seats,
        archived,
        state: 'FREE',
        seating_id: null,
        party_size: null,
        primary_table_id: null,
        joined_table_names: [],
        holder: null,
        assignee: person(directory.assignedOrderTaker(table_id) ?? null),
        lock: null,
        opened_at: null,
        bill_requested_at: null,
        live_order_count: 0,
      };
    }
    const lock = lockBySeating.get(seated.seating_id);
    return {
      table_id,
      name,
      seats,
      archived,
      state: seated.state,
      seating_id: seated.seating_id,
      party_size: seated.party_size,
      primary_table_id: seated.primary_table_id,
      joined_table_names: (bySeating.get(seated.seating_id) ?? []).map((r) => names.get(r.table_id) ?? r.table_id),
      holder: person(seated.holder_staff_id),
      // §3.6: the seating's assignee = its primary table's
      assignee: person(directory.assignedOrderTaker(seated.primary_table_id) ?? null),
      lock:
        lock === undefined
          ? null
          : { ...person(lock.staff_id)!, mine: who.staffId !== null && lock.staff_id === who.staffId && lock.device_id === who.deviceId },
      opened_at: seated.opened_at,
      bill_requested_at: seated.bill_requested_at,
      live_order_count: countBySeating.get(seated.seating_id) ?? 0,
    };
  };

  const bySort = <T extends { sort_order: number }>(a: T, b: T, ka: string, kb: string) => a.sort_order - b.sort_order || (ka < kb ? -1 : ka > kb ? 1 : 0);
  const floors: TableMapBody['floors'] = [];
  const configured = [...(config?.floors ?? [])].sort((a, b) => bySort(a, b, a.floor_id, b.floor_id));
  for (const floor of configured) {
    if (o.floorId !== undefined && floor.floor_id !== o.floorId) continue;
    const tables = [...floor.tables].sort((a, b) => bySort(a, b, a.table_id, b.table_id));
    // a floor without `zones` (a config older than snapshot V4, or a test's partial config) has only the no-zone group
    const zones = ((floor.zones as BranchConfig['floors'][number]['zones'] | undefined) ?? [])
      .filter((z) => !z.is_archived)
      .sort((a, b) => bySort(a, b, a.zone_id, b.zone_id))
      .map((z) => ({ zone_id: z.zone_id as string | null, name: z.name as string | null }));
    const known = new Set(zones.map((z) => z.zone_id));
    // a table whose zone is unknown or archived (zone_id null in V4 then) goes to the no-zone group
    const groups = [...zones, { zone_id: null, name: null }].map((g) => ({
      zone_id: g.zone_id,
      name: g.name,
      tables: tables
        .filter((t) => (g.zone_id === null ? t.zone_id === null || !known.has(t.zone_id) : t.zone_id === g.zone_id))
        .map((t) => tile(t.table_id, t.name, t.seats, false)),
    }));
    floors.push({ floor_id: floor.floor_id, name: floor.name, zones: groups.filter((g) => g.tables.length > 0) });
  }
  const archived = [...seatedByTable.keys()].filter((id) => !names.has(id)).sort();
  if (archived.length > 0) {
    floors.push({ floor_id: '', name: null, zones: [{ zone_id: null, name: null, tables: archived.map((id) => tile(id, id, null, true)) }] });
  }
  return { as_of_seq: o.asOfSeq, floors };
}

// ------------------------------------------------------------------------------------------- §6.18

// 1: the table's open seating (holder, primary table)
const SEATING_OF_TABLE = `SELECT s.holder_staff_id AS holder_staff_id, s.primary_table_id AS primary_table_id
  FROM seating_tables st
  JOIN seatings s ON s.seating_id = st.seating_id
 WHERE st.table_id = ?`;
// 2: the branch's live staff sessions (index staff_sessions_active) and the open seatings held per staff
const WORKING_AND_HELD = `SELECT 'live' AS k, staff_id AS staff_id, 0 AS n
  FROM staff_sessions
 WHERE branch_id = ? AND ended_at IS NULL AND kind = 'staff'
UNION ALL
SELECT 'held' AS k, holder_staff_id AS staff_id, COUNT(*) AS n
  FROM seatings
 WHERE state <> 'CLOSED'
 GROUP BY holder_staff_id`;

export interface HandoverCandidate {
  staff_id: string;
  name: string;
  is_assignee: boolean;
  working: boolean;
  tables_held: number;
}

/**
 * §6.18: 2 statements. People with an `allowed` take-order grant whose scope covers the table's floor (the §6.7
 * receiver rule), holder and caller excluded; working (a live staff session) first, then by name. A table neither
 * in the config nor seated → 404 TABLE_NOT_FOUND.
 */
export function handoverCandidates(
  db: Database.Database,
  directory: StaffDirectory,
  q: { table_id: string; caller_staff_id: string | null; branch_id: string },
): HandoverCandidate[] {
  const seating = db.prepare(SEATING_OF_TABLE).get(q.table_id) as { holder_staff_id: string; primary_table_id: string } | undefined;
  if (seating === undefined && floorOf(q.table_id) === null) throw new DomainError('TABLE_NOT_FOUND', { table_id: q.table_id });
  const rows = db.prepare(WORKING_AND_HELD).all(q.branch_id) as Array<{ k: 'live' | 'held'; staff_id: string; n: number }>;
  const live = new Set<string>();
  const held = new Map<string, number>();
  for (const row of rows) {
    if (row.k === 'live') live.add(row.staff_id);
    else held.set(row.staff_id, row.n);
  }
  const assignee = directory.assignedOrderTaker(seating?.primary_table_id ?? q.table_id);
  const out: HandoverCandidate[] = [];
  for (const staff of directory.list()) {
    if (staff.staff_id === seating?.holder_staff_id || staff.staff_id === q.caller_staff_id) continue;
    const takeOrder = directory.resolve(staff.staff_id, 'take-order');
    if (takeOrder.grant !== 'allowed' || !scopeCoversFloor(directory, staff.staff_id, takeOrder.scope, q.table_id)) continue;
    out.push({
      staff_id: staff.staff_id,
      name: staff.display_name,
      is_assignee: staff.staff_id === assignee,
      working: live.has(staff.staff_id),
      tables_held: held.get(staff.staff_id) ?? 0,
    });
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return out.sort((a, b) => Number(b.working) - Number(a.working) || cmp(a.name, b.name) || cmp(a.staff_id, b.staff_id));
}

// ------------------------------------------------------------------------------------------- registration

export function registerTableQueries(app: FastifyInstance, branchId: string): void {
  const registry = queryRegistry(app);
  registry.register(
    defineQuery({
      resource: 'table-map',
      sessionKind: 'device',
      session: 'required',
      deviceTypes: TABLE_MAP_DEVICE_TYPES,
      countsAsActivity: false,
      querySchema: z.object({ floor_id: z.string().min(1).optional() }),
      handle(ctx, q) {
        const body = tableMapBody(
          ctx.db,
          { staffId: ctx.session?.staff_id ?? null, deviceId: ctx.device?.device_id ?? null },
          { asOfSeq: 0, floorId: q.floor_id, directory: ctx.directory, config: ctx.branchConfig },
        );
        // +1: last_seq, read after the three map statements (no commit runs between them: one synchronous step)
        const seq = (ctx.db.prepare(LAST_SEQ).get(branchId) as { seq: number }).seq;
        return { data: { ...body, as_of_seq: seq } };
      },
    }),
  );
  registry.register(
    defineQuery({
      resource: 'handover-candidates',
      sessionKind: 'device',
      session: 'required',
      countsAsActivity: false,
      querySchema: z.object({ table_id: z.string().min(1) }),
      handle(ctx, q) {
        return {
          data: { staff: handoverCandidates(ctx.db, ctx.directory, { table_id: q.table_id, caller_staff_id: ctx.session?.staff_id ?? null, branch_id: branchId }) },
        };
      },
    }),
  );
}

/** Catch-up part `tables`: staff sockets of the map's device types; the §6.17 builder at the socket's as_of_seq. */
export function tablesCatchUpPart(app: FastifyInstance): CatchUpPart {
  return {
    part: 'tables',
    appliesTo: (socket) => socket.kind === 'staff' && socket.staffId !== null && TABLE_MAP_DEVICE_TYPES.includes(socket.deviceType),
    build: (db, _state, socket) =>
      tableMapBody(db, { staffId: socket.staffId, deviceId: socket.deviceId }, { asOfSeq: socket.asOfSeq, directory: currentDirectory(app) }),
  };
}

export function registerTablesCatchUp(app: FastifyInstance): () => void {
  return registerCatchUp(tablesCatchUpPart(app));
}
