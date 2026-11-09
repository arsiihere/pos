import { DomainError } from '@pos/domain';
import type { EventDraft, TablesMergedPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CommandCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { checkMergeGuard } from '../merge-guard.js';
import { covers } from './move-table.js';

// 02a v1.1.3 §3.11, §6.10 `MergeTables` (T6, T17, T18, §3.14, §3.15, §4.1 row 04, C8).
// `table_id` FREE → joins S; `table_id` with seating S2 → S2 is absorbed (orders and tables move to S, S2 closes
// `merged`, its lock ends in the fold). Merge takes no lock.
// Statements: 3 reads (S + lock, the other side + lock, S2's orders; a join needs only 2) + the 04 guard.
// Order of checks: S (T18, NEEDS_CLEANING), holder or force, the other side (T18, NEEDS_CLEANING, FREE and archived),
// R23, locks on either side, the 04 guard, scope last over every table.
// The pending-handover close of S and S2 (2 `byDedupeKey` + `alerts.closeMany`) is added after task 12.

const MergeTablesPayload = z
  .object({
    into_table_id: z.string().min(1),
    into_seating_id: z.string().min(1),
    table_id: z.string().min(1),
    table_seating_id: z.string().min(1).nullable(),
  })
  .strict()
  .refine((p) => p.table_id !== p.into_table_id && p.table_seating_id !== p.into_seating_id, {
    message: 'the two sides of a merge must differ',
  });
type Payload = z.infer<typeof MergeTablesPayload>;

const SEATING_OF_TABLE = `SELECT s.seating_id AS seating_id, s.state AS state, s.holder_staff_id AS holder_staff_id,
       l.staff_id AS lock_staff_id, l.device_id AS lock_device_id,
       (SELECT json_group_array(table_id) FROM (SELECT table_id FROM seating_tables WHERE seating_id = s.seating_id ORDER BY joined_at, table_id)) AS table_ids
  FROM seating_tables st
  JOIN seatings s ON s.seating_id = st.seating_id
  LEFT JOIN table_locks l ON l.table_id = s.primary_table_id
 WHERE st.table_id = ?`;

interface SeatingRow {
  seating_id: string;
  state: string;
  holder_staff_id: string;
  lock_staff_id: string | null;
  lock_device_id: string | null;
  table_ids: string;
}

interface Result {
  seating_id: string;
  table_ids: string[];
}

function handle(ctx: CommandCtx, p: Payload): { events: EventDraft[]; result: Result } {
  const db = ctx.tx.db;
  const seatingOfTable = db.prepare(SEATING_OF_TABLE);
  const into = seatingOfTable.get(p.into_table_id) as SeatingRow | undefined;
  // T18: no seating, or another one (into_seating_id is always the one shown).
  if (into === undefined || into.seating_id !== p.into_seating_id) {
    throw new DomainError('TABLE_SEATING_CHANGED', { table_id: p.into_table_id, seating_id: p.into_seating_id });
  }
  if (into.state === 'NEEDS_CLEANING') throw new DomainError('TABLE_NEEDS_CLEANING', { table_id: p.into_table_id });

  const actor = ctx.actor.staffId;
  const holder = actor !== null && into.holder_staff_id === actor;
  // §3.15: only an `allowed` grant counts; requires_approval is denied.
  const force = actor === null ? null : ctx.directory.resolve(actor, 'force-release-table-lock');
  const forceScope = force !== null && force.grant === 'allowed' ? force.scope : null;
  if (!holder && forceScope === null) {
    throw new DomainError('PERMISSION_DENIED', {
      reason: 'not_holder',
      table_id: p.into_table_id,
      assigned_staff_id: ctx.directory.assignedOrderTaker(p.into_table_id),
      holder_staff_id: into.holder_staff_id,
    });
  }

  // The other side: FREE (join) or S2 (absorb); T18 both ways (a seating while null was shown, or none / another one).
  const other = seatingOfTable.get(p.table_id) as SeatingRow | undefined;
  if (other === undefined ? p.table_seating_id !== null : other.seating_id !== p.table_seating_id) {
    throw new DomainError('TABLE_SEATING_CHANGED', { table_id: p.table_id, seating_id: p.table_seating_id });
  }
  if (other !== undefined && other.state === 'NEEDS_CLEANING') {
    throw new DomainError('TABLE_NEEDS_CLEANING', { table_id: p.table_id });
  }
  if (other === undefined) {
    // §3.14 (AD-2): a free table absent from the branch config (or no config at all) is archived or unknown: fail closed.
    const config = branchConfig();
    if (config === null || !config.floors.some((f) => f.tables.some((t) => t.table_id === p.table_id))) {
      throw new DomainError('TABLE_NOT_FOUND', { table_id: p.table_id });
    }
  }

  const intoTables = JSON.parse(into.table_ids) as string[];
  const otherTables = other === undefined ? [p.table_id] : (JSON.parse(other.table_ids) as string[]);
  const otherHolder = other === undefined ? null : other.holder_staff_id;

  // R23 (T6): any table of either side assigned to someone other than the caller, or S2 held by someone else,
  // needs the force grant. The first offender names the table.
  let usedForceScope = holder ? null : forceScope;
  const offender = r23Offender(ctx, actor, [
    ...intoTables.map((t) => ({ table_id: t, holder_staff_id: into.holder_staff_id })),
    ...otherTables.map((t) => ({ table_id: t, holder_staff_id: otherHolder })),
  ]);
  const s2Foreign = otherHolder !== null && otherHolder !== actor;
  if (offender !== null || s2Foreign) {
    if (forceScope === null) {
      throw new DomainError('PERMISSION_DENIED', {
        reason: 'other_owner',
        ...(offender ?? {
          table_id: p.table_id,
          assigned_staff_id: ctx.directory.assignedOrderTaker(p.table_id),
          holder_staff_id: otherHolder,
        }),
      });
    }
    usedForceScope = forceScope;
  }

  // A lock on either side by anyone other than (caller, this device), even the caller's own other device, blocks.
  checkLock(ctx, actor, into, p.into_table_id);
  if (other !== undefined) checkLock(ctx, actor, other, p.table_id);

  // §4.1 row 04: a pending void on either seating blocks the merge.
  const seatingIds = other === undefined ? [into.seating_id] : [into.seating_id, other.seating_id];
  const verdict = checkMergeGuard(db, { seating_ids: seatingIds });
  if (verdict.blocked) throw new DomainError('MERGE_BLOCKED_BY_VOID', { order_item_ids: verdict.order_item_ids });

  // Scope last (C8) over every table of both sides, for the take-order grant and for the force grant when it was used.
  // `own_tables` covers S's tables and a FREE table joining S when the caller holds S, and S2's when he holds S2.
  const named = [...intoTables, ...otherTables];
  const owned = new Map<string, boolean>([
    ...intoTables.map((t): [string, boolean] => [t, holder]),
    ...otherTables.map((t): [string, boolean] => [t, other === undefined ? holder : otherHolder === actor]),
  ]);
  const outside = new Set<string>();
  // Fail closed: no granting permission in the context means no scope, which covers nothing.
  const takeScope = ctx.permission !== null && 'scope' in ctx.permission ? ctx.permission.scope : 'none';
  for (const scope of [takeScope, usedForceScope]) {
    if (scope === null) continue;
    for (const t of named) if (!covers(ctx, scope, actor, owned.get(t) === true, t)) outside.add(t);
  }
  if (outside.size > 0) {
    throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', table_ids: named.filter((t) => outside.has(t)) });
  }

  // T17: whole orders; every order of S2 (cancelled ones too) moves with the party.
  const orderIds =
    other === undefined
      ? []
      : (db.prepare('SELECT order_id FROM seating_orders WHERE seating_id = ? ORDER BY order_id').pluck().all(other.seating_id) as string[]);

  const payload: TablesMergedPayload = {
    into_seating_id: into.seating_id,
    into_table_id: p.into_table_id,
    table_ids: otherTables,
    absorbed_seating_id: other === undefined ? null : other.seating_id,
    order_ids: orderIds,
    by_staff_id: actor ?? '',
  };
  const event: EventDraft = {
    stream_type: 'table',
    stream_id: p.into_table_id,
    event_type: 'TablesMerged',
    schema_version: 1,
    payload,
    occurred_at: ctx.clock.branchNow(),
    actor_id: actor,
    device_id: ctx.actor.deviceId,
  };
  return { events: [event], result: { seating_id: into.seating_id, table_ids: [...intoTables, ...otherTables] } };
}

function r23Offender(
  ctx: CommandCtx,
  actor: string | null,
  tables: Array<{ table_id: string; holder_staff_id: string | null }>,
): { table_id: string; assigned_staff_id: string; holder_staff_id: string | null } | null {
  for (const t of tables) {
    const assignee = ctx.directory.assignedOrderTaker(t.table_id);
    if (assignee !== null && assignee !== actor) return { table_id: t.table_id, assigned_staff_id: assignee, holder_staff_id: t.holder_staff_id };
  }
  return null;
}

function checkLock(ctx: CommandCtx, actor: string | null, s: SeatingRow, table_id: string): void {
  if (s.lock_staff_id !== null && !(s.lock_staff_id === actor && s.lock_device_id === ctx.actor.deviceId)) {
    throw new DomainError('TABLE_ALREADY_LOCKED', {
      table_id,
      locked_by_staff_id: s.lock_staff_id,
      locked_by_name: ctx.directory.get(s.lock_staff_id)?.display_name ?? null,
    });
  }
}

export function registerMergeTables(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'MergeTables',
      payloadSchema: MergeTablesPayload,
      sessionKind: 'device',
      permission: 'take-order',
      handle: (ctx, payload) => handle(ctx, payload),
    }),
  );
}
