import { DomainError } from '@pos/domain';
import type { EventDraft, SeatingSplitPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CommandCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { closeHandover } from '../handover.js';
import { checkMergeGuard } from '../merge-guard.js';
import { covers } from './move-table.js';

// 02a v1.1.3 §3.12, §6.11 `SplitSeating` (T6, T17, T18, §3.14, §3.15, §4.1 row 04, C1, C8).
// `order_ids` non-empty → a new seating (id from ctx.ids) on `to_table_id` (FREE, or a joined table of S that is not
// the primary) with those whole live orders, holder = S's holder; `order_ids` empty on a joined table → detach (the
// table is FREE, no new seating). The lock stays on S; split takes no lock.
// Statements: 3 reads (S + lock, the target's seating, S's live orders; a detach needs only 2) + the 04 guard (only
// when orders move) + 1 `byDedupeKey` + the `alerts.close` bound when a handover is pending.
// Order of checks: S (T18, NEEDS_CLEANING), holder or force, the target (another seating or S's primary →
// TABLE_NOT_FREE; FREE and archived → 404), the orders (SPLIT_INVALID), R23 (a new seating only), the lock, the 04
// guard, scope last over the from and to tables.
// §3.12: the pending handover of S closes `obsolete` in the same transaction, drafts after SeatingSplit.

const SplitSeatingPayload = z
  .object({
    from_table_id: z.string().min(1),
    seating_id: z.string().min(1),
    to_table_id: z.string().min(1),
    order_ids: z.array(z.string().min(1)).max(50),
  })
  .strict()
  .refine((p) => new Set(p.order_ids).size === p.order_ids.length, { message: 'order_ids must be a set', path: ['order_ids'] });
type Payload = z.infer<typeof SplitSeatingPayload>;

const FROM_SEATING = `SELECT s.seating_id AS seating_id, s.state AS state, s.holder_staff_id AS holder_staff_id,
       s.primary_table_id AS primary_table_id, l.staff_id AS lock_staff_id, l.device_id AS lock_device_id
  FROM seating_tables st
  JOIN seatings s ON s.seating_id = st.seating_id
  LEFT JOIN table_locks l ON l.table_id = s.primary_table_id
 WHERE st.table_id = ?`;

interface FromRow {
  seating_id: string;
  state: string;
  holder_staff_id: string;
  primary_table_id: string;
  lock_staff_id: string | null;
  lock_device_id: string | null;
}

function handle(ctx: CommandCtx, p: Payload): { events: EventDraft[]; result: { new_seating_id: string | null } } {
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

  // The target: FREE, or a joined table of S. Another seating's table, or S's primary, is not free (§9).
  const target = db.prepare('SELECT seating_id FROM seating_tables WHERE table_id = ?').get(p.to_table_id) as
    | { seating_id: string }
    | undefined;
  if (target !== undefined && (target.seating_id !== from.seating_id || p.to_table_id === from.primary_table_id)) {
    throw new DomainError('TABLE_NOT_FREE', { table_id: p.to_table_id });
  }
  if (target === undefined) {
    // §3.14 (AD-2): a free table absent from the branch config (or no config at all) is archived or unknown: fail closed.
    const config = branchConfig();
    if (config === null || !config.floors.some((f) => f.tables.some((t) => t.table_id === p.to_table_id))) {
      throw new DomainError('TABLE_NOT_FOUND', { table_id: p.to_table_id });
    }
  }

  const detach = p.order_ids.length === 0;
  if (detach && target === undefined) throw new DomainError('SPLIT_INVALID', { reason: 'empty' });
  if (!detach) {
    // T17: whole live orders of S (cancelled = 0); a cancelled one, or another seating's, is not in the seating.
    const live = new Set(
      db.prepare('SELECT order_id FROM seating_orders WHERE seating_id = ? AND cancelled = 0').pluck().all(from.seating_id) as string[],
    );
    const foreign = p.order_ids.filter((o) => !live.has(o));
    if (foreign.length > 0) throw new DomainError('SPLIT_INVALID', { reason: 'not_in_seating', order_ids: foreign });
    // every id is live and the list is a set: equal sizes means S would keep no live order
    if (p.order_ids.length === live.size) throw new DomainError('SPLIT_INVALID', { reason: 'all_orders' });
  }

  // R23 (T6): a new seating on a table assigned to someone other than the caller needs the force grant.
  // A detach lands no party, so it needs none.
  let usedForceScope = holder ? null : forceScope;
  if (!detach) {
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
  }

  // Any lock on S by another (staff, device), even the caller's own other device, blocks (as Merge, G4-2 #18).
  if (from.lock_staff_id !== null && !(from.lock_staff_id === actor && from.lock_device_id === ctx.actor.deviceId)) {
    throw new DomainError('TABLE_ALREADY_LOCKED', {
      table_id: p.from_table_id,
      locked_by_staff_id: from.lock_staff_id,
      locked_by_name: ctx.directory.get(from.lock_staff_id)?.display_name ?? null,
    });
  }

  // §4.1 row 04: a pending void on a moved order blocks the split (a detach moves no order).
  if (!detach) {
    const verdict = checkMergeGuard(db, { seating_ids: [from.seating_id], order_ids: p.order_ids });
    if (verdict.blocked) throw new DomainError('MERGE_BLOCKED_BY_VOID', { order_item_ids: verdict.order_item_ids });
  }

  // Scope last (C8) over the from and to tables, for the take-order grant and for the force grant when it was used.
  // `own_tables`: both are (or become) a seating the caller holds when he holds S (the new seating keeps S's holder).
  const named = p.from_table_id === p.to_table_id ? [p.from_table_id] : [p.from_table_id, p.to_table_id];
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

  const newSeatingId = detach ? null : ctx.ids.next();
  const payload: SeatingSplitPayload = {
    from_seating_id: from.seating_id,
    new_seating_id: newSeatingId,
    to_table_id: p.to_table_id,
    order_ids: p.order_ids,
    by_staff_id: actor ?? '',
  };
  const event: EventDraft = {
    stream_type: 'table',
    stream_id: p.from_table_id,
    event_type: 'SeatingSplit',
    schema_version: 1,
    payload,
    occurred_at: ctx.clock.branchNow(),
    actor_id: actor,
    device_id: ctx.actor.deviceId,
  };
  // §7: table ids only in the note, no names.
  const closed = closeHandover(ctx, from.seating_id, `split: ${p.to_table_id} from ${p.from_table_id}`);
  return { events: [event, ...closed], result: { new_seating_id: newSeatingId } };
}

export function registerSplitSeating(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'SplitSeating',
      payloadSchema: SplitSeatingPayload,
      sessionKind: 'device',
      permission: 'take-order',
      handle: (ctx, payload) => handle(ctx, payload),
    }),
  );
}
