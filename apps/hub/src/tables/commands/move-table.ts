import { DomainError } from '@pos/domain';
import type { EventDraft, TableMovedPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CommandCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { closeHandover } from '../handover.js';
import { branchConfig } from '../../sync/branch-config-holder.js';

// 02a v1.1.3 §3.10, §6.9 `MoveTable` (T6, T17, T18, §3.14, §3.15, C8).
// Two statements: the from table's seating + lock (one read) and the target's seating. Order of checks: seating
// (T18, NEEDS_CLEANING), holder or force, merged, target busy, target archived, R23, lock, scope last.
// §6.9 / §3.9: after TableMoved, closeHandover closes the seating's pending table_handover `obsolete` (1 byDedupeKey
// statement, plus alerts.close when one is pending), drafts in the same transaction.

const MoveTablePayload = z
  .object({
    from_table_id: z.string().min(1),
    seating_id: z.string().min(1),
    to_table_id: z.string().min(1),
    reason: z.string().min(1).max(120).optional(),
  })
  .strict();
type Payload = z.infer<typeof MoveTablePayload>;

const FROM_SEATING = `SELECT s.seating_id AS seating_id, s.state AS state, s.holder_staff_id AS holder_staff_id,
       l.staff_id AS lock_staff_id, l.device_id AS lock_device_id,
       (SELECT json_group_array(table_id) FROM (SELECT table_id FROM seating_tables WHERE seating_id = s.seating_id ORDER BY joined_at, table_id)) AS table_ids
  FROM seating_tables st
  JOIN seatings s ON s.seating_id = st.seating_id
  LEFT JOIN table_locks l ON l.table_id = s.primary_table_id
 WHERE st.table_id = ?`;

interface FromRow {
  seating_id: string;
  state: string;
  holder_staff_id: string;
  lock_staff_id: string | null;
  lock_device_id: string | null;
  table_ids: string;
}

function handle(ctx: CommandCtx, p: Payload): { events: EventDraft[]; result: { primary_table_id: string } } {
  const db = ctx.tx.db;
  const from = db.prepare(FROM_SEATING).get(p.from_table_id) as FromRow | undefined;
  // T18: no seating, or another one (the payload always names the seating shown).
  if (from === undefined || from.seating_id !== p.seating_id) {
    throw new DomainError('TABLE_SEATING_CHANGED', { table_id: p.from_table_id, seating_id: p.seating_id });
  }
  if (from.state === 'NEEDS_CLEANING') throw new DomainError('TABLE_NEEDS_CLEANING', { table_id: p.from_table_id });

  const actor = ctx.actor.staffId;
  const holder = actor !== null && from.holder_staff_id === actor;
  // §3.15: only an `allowed` grant counts; requires_approval is denied.
  const force = actor === null ? null : ctx.directory.resolve(actor, 'force-release-table-lock');
  const forceScope = force !== null && force.grant === 'allowed' ? force.scope : null;
  if (!holder && forceScope === null) {
    throw new DomainError('PERMISSION_DENIED', {
      reason: 'not_holder',
      table_id: p.from_table_id,
      assigned_staff_id: ctx.directory.assignedOrderTaker(p.from_table_id),
      holder_staff_id: from.holder_staff_id,
    });
  }

  const tableIds = JSON.parse(from.table_ids) as string[];
  if (tableIds.length > 1) throw new DomainError('TABLE_MERGED', { seating_id: from.seating_id, table_ids: tableIds });

  const target = db.prepare('SELECT seating_id FROM seating_tables WHERE table_id = ?').get(p.to_table_id);
  if (target !== undefined) throw new DomainError('TABLE_NOT_FREE', { table_id: p.to_table_id });
  // §3.14 (AD-2): a free table absent from the branch config (or no config at all) is archived or unknown: fail closed.
  const config = branchConfig();
  if (config === null || !config.floors.some((f) => f.tables.some((t) => t.table_id === p.to_table_id))) {
    throw new DomainError('TABLE_NOT_FOUND', { table_id: p.to_table_id });
  }

  // R23 (T6): a target assigned to someone other than the caller needs the force grant.
  let usedForceScope = holder ? null : forceScope;
  const assignee = ctx.directory.assignedOrderTaker(p.to_table_id);
  if (assignee !== null && assignee !== actor) {
    if (forceScope === null) {
      throw new DomainError('PERMISSION_DENIED', {
        reason: 'other_owner',
        table_id: p.to_table_id,
        assigned_staff_id: assignee,
        holder_staff_id: from.holder_staff_id,
      });
    }
    usedForceScope = forceScope;
  }

  // The lock stays free if free; any lock of another (staff, device), even the caller's own other device, blocks.
  if (from.lock_staff_id !== null && !(from.lock_staff_id === actor && from.lock_device_id === ctx.actor.deviceId)) {
    throw new DomainError('TABLE_ALREADY_LOCKED', {
      table_id: p.from_table_id,
      locked_by_staff_id: from.lock_staff_id,
      locked_by_name: ctx.directory.get(from.lock_staff_id)?.display_name ?? null,
    });
  }

  // Scope last (C8) over both tables, for the take-order grant and for the force grant when it was used.
  const named = [p.from_table_id, p.to_table_id];
  const outside = new Set<string>();
  // Fail closed: no granting permission in the context means no scope, which covers nothing.
  const takeScope = ctx.permission !== null && 'scope' in ctx.permission ? ctx.permission.scope : 'none';
  for (const scope of [takeScope, usedForceScope]) {
    if (scope === null) continue;
    for (const t of named) if (!covers(ctx, scope, actor, holder, t)) outside.add(t);
  }
  if (outside.size > 0) {
    throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', table_ids: named.filter((t) => outside.has(t)) });
  }

  const payload: TableMovedPayload = {
    seating_id: from.seating_id,
    from_table_id: p.from_table_id,
    to_table_id: p.to_table_id,
    by_staff_id: actor ?? '',
    ...(p.reason === undefined ? {} : { note: p.reason }),
  };
  const event: EventDraft = {
    stream_type: 'table',
    stream_id: p.from_table_id,
    event_type: 'TableMoved',
    schema_version: 1,
    payload,
    occurred_at: ctx.clock.branchNow(),
    actor_id: actor,
    device_id: ctx.actor.deviceId,
  };
  const closed = closeHandover(ctx, from.seating_id, `moved to ${p.to_table_id}`);
  return { events: [event, ...closed], result: { primary_table_id: p.to_table_id } };
}

// `branch` covers all; `my_floors` the caller's floors (0 statements, config in memory); `own_tables` the caller's own
// seating (`holder`: the table is, or joins, a seating the caller holds; for a move both its tables). MergeTables shares it.
export function covers(ctx: CommandCtx, scope: string, actor: string | null, holder: boolean, table_id: string): boolean {
  if (scope === 'branch') return true;
  if (scope === 'own_tables') return holder;
  if (scope === 'my_floors') {
    const floor = branchConfig()?.floors.find((f) => f.tables.some((t) => t.table_id === table_id));
    return actor !== null && floor !== undefined && ctx.directory.floorsOf(actor).includes(floor.floor_id);
  }
  return false;
}

export function registerMoveTable(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'MoveTable',
      payloadSchema: MoveTablePayload,
      sessionKind: 'device',
      permission: 'take-order',
      handle: (ctx, payload) => handle(ctx, payload),
    }),
  );
}
