import { DomainError } from '@pos/domain';
import type { EventDraft, TableLockedPayload, TableOpenedPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CommandCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { branchConfig } from '../../sync/branch-config-holder.js';

// 02a v1.1.3 §6.1 OpenTable, §3.2, §3.14 (archived = absent from branchConfig(), AD-2), §3.15, T15, T18.
// Script: 1. one statement (the table's open seating and its lock, stored under the primary table, §3.2);
// 2. no seating: a seating_id given → 409 TABLE_SEATING_CHANGED (G4-3 #9); archived / unknown → 404; else
// TableOpened + TableLocked; 3. seating: seating_id ≠ → 409; NEEDS_CLEANING → 409; holder ≠ caller →
// take-order-anywhere (`allowed` only, §3.15); then the lock; 4. scope last (C8).
// Unlike requireLock, a non-holder with take-order-anywhere TAKES a free lock here (§3.2 row 4; holder unchanged).
// Not queueable: ctx.queuedAt is always null.

const OpenTablePayload = z
  .object({
    table_id: z.string().min(1),
    seating_id: z.string().min(1).optional(),
    party_size: z.number().int().min(1).max(50).optional(),
  })
  .strict();
type Payload = z.infer<typeof OpenTablePayload>;

interface Result {
  seating_id: string;
  primary_table_id: string;
  opened: boolean;
  holder_staff_id: string;
}

interface SeatingLockRow {
  seating_id: string;
  primary_table_id: string;
  state: string;
  holder_staff_id: string;
  lock_staff_id: string | null;
  lock_device_id: string | null;
}

const SEATING_AND_LOCK = `SELECT s.seating_id AS seating_id, s.primary_table_id AS primary_table_id, s.state AS state,
        s.holder_staff_id AS holder_staff_id, l.staff_id AS lock_staff_id, l.device_id AS lock_device_id
   FROM seating_tables st
   JOIN seatings s ON s.seating_id = st.seating_id
   LEFT JOIN table_locks l ON l.table_id = s.primary_table_id
  WHERE st.table_id = ?`;

function handle(ctx: CommandCtx, payload: Payload): { events: EventDraft[]; result: Result } {
  const actor = ctx.actor.staffId;
  // The route refuses a `take-order` command without a staff on the session; kept for the type.
  if (actor === null) throw new DomainError('PERMISSION_DENIED', { permission: 'take-order', grant: 'not_granted' });
  const { table_id } = payload;
  const row = ctx.tx.db.prepare(SEATING_AND_LOCK).get(table_id) as SeatingLockRow | undefined;
  if (row === undefined) return openFree(ctx, actor, payload);

  if (payload.seating_id !== undefined && payload.seating_id !== row.seating_id) {
    throw new DomainError('TABLE_SEATING_CHANGED', { table_id, seating_id: payload.seating_id });
  }
  if (row.state === 'NEEDS_CLEANING') throw new DomainError('TABLE_NEEDS_CLEANING', { table_id });

  // Holder ≠ caller: the second permission, `allowed` only (§3.15); its scope is checked last.
  let anywhereScope: string | null = null;
  if (row.holder_staff_id !== actor) {
    const grant = ctx.directory.resolve(actor, 'take-order-anywhere');
    if (grant.grant !== 'allowed') {
      throw new DomainError('PERMISSION_DENIED', {
        reason: 'not_holder',
        table_id,
        assigned_staff_id: ctx.directory.assignedOrderTaker(table_id),
        holder_staff_id: row.holder_staff_id,
      });
    }
    anywhereScope = grant.scope;
  }

  let events: EventDraft[];
  if (row.lock_staff_id === actor && row.lock_device_id === ctx.actor.deviceId) {
    events = [];
  } else if (row.lock_staff_id === actor) {
    events = [tableLocked(ctx, actor, row.primary_table_id, row.seating_id, row.lock_device_id ?? undefined)]; // T15
  } else if (row.lock_staff_id !== null) {
    throw new DomainError('TABLE_ALREADY_LOCKED', {
      table_id,
      locked_by_staff_id: row.lock_staff_id,
      locked_by_name: ctx.directory.get(row.lock_staff_id)?.display_name ?? null,
    });
  } else {
    events = [tableLocked(ctx, actor, row.primary_table_id, row.seating_id)];
  }

  // Scope last (C8): take-order-anywhere's scope must cover the table named. take-order's own scope is not checked
  // on an open seating (owner 2026-11-10, Q1; as requireLock).
  if (anywhereScope !== null && anywhereScope !== 'branch' && !coversFloor(ctx, actor, table_id)) {
    throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', table_ids: [table_id] });
  }
  // owner 2026-11-10 (Q2): `opened` = an event was written (lock taken or moved, T15); false only for the no-op.
  // A party_size sent here is ignored: no event carries it (owner 2026-11-10, Q3).
  return {
    events,
    result: {
      seating_id: row.seating_id,
      primary_table_id: row.primary_table_id,
      opened: events.length > 0,
      holder_staff_id: row.holder_staff_id,
    },
  };
}

function openFree(ctx: CommandCtx, actor: string, payload: Payload): { events: EventDraft[]; result: Result } {
  const { table_id } = payload;
  // G4-3 #9: a stale tile (the seating shown was cleaned) never opens a new one.
  if (payload.seating_id !== undefined) throw new DomainError('TABLE_SEATING_CHANGED', { table_id, seating_id: payload.seating_id });
  // §3.14 / AD-2: an archived table is absent from the config; an unknown id answers the same.
  if (floorOf(table_id) === undefined) throw new DomainError('TABLE_NOT_FOUND', { table_id });
  // Scope last (C8): take-order `my_floors` must cover the table's floor (§3.2 row 1); `own_tables` passes, the new
  // seating is the caller's (owner 2026-11-10, Q1). Checked only here, on a FREE table.
  if (ctx.permission?.grant === 'allowed' && ctx.permission.scope === 'my_floors' && !coversFloor(ctx, actor, table_id)) {
    throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', table_ids: [table_id] });
  }
  const seating_id = ctx.ids.next();
  const opened: TableOpenedPayload = { table_id, seating_id, holder_staff_id: actor, party_size: payload.party_size ?? null };
  const events: EventDraft[] = [
    {
      stream_type: 'table',
      stream_id: table_id,
      event_type: 'TableOpened',
      schema_version: 1,
      payload: opened,
      occurred_at: ctx.clock.branchNow(),
      actor_id: actor,
      device_id: ctx.actor.deviceId,
    },
    tableLocked(ctx, actor, table_id, seating_id),
  ];
  return { events, result: { seating_id, primary_table_id: table_id, opened: true, holder_staff_id: actor } };
}

function tableLocked(ctx: CommandCtx, staff_id: string, primary_table_id: string, seating_id: string, replaced_device_id?: string): EventDraft {
  const payload: TableLockedPayload = {
    table_id: primary_table_id,
    seating_id,
    staff_id,
    ...(replaced_device_id === undefined ? {} : { replaced_device_id }),
  };
  return {
    stream_type: 'table',
    stream_id: primary_table_id,
    event_type: 'TableLocked',
    schema_version: 1,
    payload,
    occurred_at: ctx.clock.branchNow(),
    actor_id: staff_id,
    device_id: ctx.actor.deviceId, // §6.19: the lock's device is the envelope device_id
  };
}

// 0 statements: the config is in memory.
function floorOf(table_id: string): string | undefined {
  return branchConfig()?.floors.find((f) => f.tables.some((t) => t.table_id === table_id))?.floor_id;
}

function coversFloor(ctx: CommandCtx, staffId: string, table_id: string): boolean {
  const floor = floorOf(table_id);
  return floor !== undefined && ctx.directory.floorsOf(staffId).includes(floor);
}

export function registerOpenTable(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'OpenTable',
      payloadSchema: OpenTablePayload,
      sessionKind: 'device',
      permission: 'take-order',
      handle: (ctx, payload) => handle(ctx, payload),
    }),
  );
}
