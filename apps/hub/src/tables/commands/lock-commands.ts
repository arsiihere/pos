import { DomainError } from '@pos/domain';
import type { EventDraft, TableLockReleasedPayload, TableLockTouchedPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CommandCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { branchConfig } from '../../sync/branch-config-holder.js';

// 02a v1.1.3 §6.2 TouchTableLock (D61), §6.3 ReleaseTableLock, §6.4 ForceReleaseTableLock; Common rules (§6), §3.3, §3.15.
// Script (all three): 1. one statement (the table's seating and its lock, stored under the primary table, §3.2);
// 2. no seating, or a seating_id ≠ → 409 TABLE_SEATING_CHANGED (T18, G4-2 #11; seating_id is required, so TABLE_NOT_OPEN
// cannot occur); 3. the command's own lock rule; 4. Force: scope last (C8).
// NEEDS_CLEANING does not block these three: §12.2 lists no TABLE_NEEDS_CLEANING for rows 6.2–6.4 (a lock may be
// released or touched there). Not queueable: ctx.queuedAt is always null.

const TOUCH_INTERVAL_MS = 50_000; // D61

const LockPayload = z.object({ table_id: z.string().min(1), seating_id: z.string().min(1) }).strict();
const ForcePayload = z
  .object({ table_id: z.string().min(1), seating_id: z.string().min(1), reason: z.string().min(1).max(120) })
  .strict();

interface LockRow {
  seating_id: string;
  primary_table_id: string;
  lock_staff_id: string | null;
  lock_device_id: string | null;
  last_touch_at: number | null;
}

const SEATING_AND_LOCK = `SELECT s.seating_id AS seating_id, s.primary_table_id AS primary_table_id,
        l.staff_id AS lock_staff_id, l.device_id AS lock_device_id, l.last_touch_at AS last_touch_at
   FROM seating_tables st
   JOIN seatings s ON s.seating_id = st.seating_id
   LEFT JOIN table_locks l ON l.table_id = s.primary_table_id
  WHERE st.table_id = ?`;

function readSeating(ctx: CommandCtx, table_id: string, seating_id: string): LockRow {
  const row = ctx.tx.db.prepare(SEATING_AND_LOCK).get(table_id) as LockRow | undefined;
  if (row === undefined || row.seating_id !== seating_id) throw new DomainError('TABLE_SEATING_CHANGED', { table_id, seating_id });
  return row;
}

function actorOf(ctx: CommandCtx, permission: string): string {
  // The route refuses a command whose permission needs a staff on the session; kept for the type.
  if (ctx.actor.staffId === null) throw new DomainError('PERMISSION_DENIED', { permission, grant: 'not_granted' });
  return ctx.actor.staffId;
}

function heldHere(ctx: CommandCtx, row: LockRow, actor: string): boolean {
  return row.lock_staff_id === actor && row.lock_device_id === ctx.actor.deviceId;
}

function draft(ctx: CommandCtx, event_type: string, stream_id: string, actor: string, payload: TableLockTouchedPayload | TableLockReleasedPayload): EventDraft {
  return {
    stream_type: 'table',
    stream_id,
    event_type,
    schema_version: 1,
    payload,
    occurred_at: ctx.clock.branchNow(),
    actor_id: actor,
    device_id: ctx.actor.deviceId,
  };
}

function touch(ctx: CommandCtx, p: z.infer<typeof LockPayload>): { events: EventDraft[]; result: { touched: boolean } } {
  const actor = actorOf(ctx, 'take-order');
  const row = readSeating(ctx, p.table_id, p.seating_id);
  if (!heldHere(ctx, row, actor)) throw new DomainError('TABLE_LOCK_NOT_HELD', { table_id: p.table_id });
  // D61: no touch yet, or ≥ 50 s since the last → write; else success without writing.
  if (row.last_touch_at !== null && ctx.clock.branchNow() - row.last_touch_at < TOUCH_INTERVAL_MS) {
    return { events: [], result: { touched: false } };
  }
  const payload: TableLockTouchedPayload = { table_id: row.primary_table_id, seating_id: row.seating_id };
  return { events: [draft(ctx, 'TableLockTouched', row.primary_table_id, actor, payload)], result: { touched: true } };
}

function release(ctx: CommandCtx, p: z.infer<typeof LockPayload>): { events: EventDraft[]; result: { released: boolean } } {
  const actor = actorOf(ctx, 'take-order');
  const row = readSeating(ctx, p.table_id, p.seating_id);
  if (!heldHere(ctx, row, actor)) return { events: [], result: { released: false } };
  const payload: TableLockReleasedPayload = {
    table_id: row.primary_table_id,
    seating_id: row.seating_id,
    staff_id: actor,
    reason: 'released',
  };
  return { events: [draft(ctx, 'TableLockReleased', row.primary_table_id, actor, payload)], result: { released: true } };
}

function forceRelease(ctx: CommandCtx, p: z.infer<typeof ForcePayload>): { events: EventDraft[]; result: { released: boolean } } {
  const actor = actorOf(ctx, 'force-release-table-lock');
  const row = readSeating(ctx, p.table_id, p.seating_id);
  // Scope last (C8), after the state checks: my_floors must cover the table's floor.
  if (ctx.permission?.grant === 'allowed' && ctx.permission.scope === 'my_floors') {
    const floor = branchConfig()?.floors.find((f) => f.tables.some((t) => t.table_id === p.table_id))?.floor_id;
    if (floor === undefined || !ctx.directory.floorsOf(actor).includes(floor)) {
      throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', table_ids: [p.table_id] });
    }
  }
  if (row.lock_staff_id === null) return { events: [], result: { released: false } };
  const payload: TableLockReleasedPayload = {
    table_id: row.primary_table_id,
    seating_id: row.seating_id,
    staff_id: row.lock_staff_id,
    reason: 'force',
    by_staff_id: actor,
    note: p.reason,
  };
  return { events: [draft(ctx, 'TableLockReleased', row.primary_table_id, actor, payload)], result: { released: true } };
}

export function registerLockCommands(app: FastifyInstance): void {
  const registry = commandRegistry(app);
  registry.register(
    defineCommand({
      commandType: 'TouchTableLock',
      payloadSchema: LockPayload,
      sessionKind: 'device',
      permission: 'take-order',
      handle: (ctx, payload) => touch(ctx, payload),
    }),
  );
  registry.register(
    defineCommand({
      commandType: 'ReleaseTableLock',
      payloadSchema: LockPayload,
      sessionKind: 'device',
      permission: 'take-order',
      handle: (ctx, payload) => release(ctx, payload),
    }),
  );
  registry.register(
    defineCommand({
      commandType: 'ForceReleaseTableLock',
      payloadSchema: ForcePayload,
      sessionKind: 'device',
      permission: 'force-release-table-lock',
      handle: (ctx, payload) => forceRelease(ctx, payload),
    }),
  );
}
