import { DomainError } from '@pos/domain';
import type { AlertDisplay } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { alerts } from '../../alerts/raise.js';
import { defineCommand, type CommandCtx } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { checkReceiver, HANDOVER_KIND, handoverDedupeKey, scopeCoversFloor, type HandoverValues } from '../handover.js';
import { TABLE_HANDOVER, type HandoverDetails } from '../kinds.js';

// 02a v1.1.3 §6.7 RequestTableHandover (§3.8, §3.15, T18). Statements: 1 (the seating, its tables and its live
// order count) + 1 (the receiver's live session) + the alerts.raise bound; no seatingTotals (AD-3).

export const RequestTableHandoverPayload = z.object({
  table_id: z.string().min(1),
  seating_id: z.string().min(1),
  to_staff_id: z.string().min(1),
  note: z.string().max(120).optional(),
});
export type RequestTableHandoverPayload = z.infer<typeof RequestTableHandoverPayload>;

interface SeatingRead {
  seating_id: string;
  primary_table_id: string;
  state: string;
  holder_staff_id: string;
  /** JSON array of the seating's table ids, joined order (primary first) */
  table_ids: string;
  live_orders: number;
}

// One statement: the named table's open seating, its tables and its live (not cancelled) orders.
const READ_SEATING = `SELECT s.seating_id AS seating_id, s.primary_table_id AS primary_table_id, s.state AS state,
       s.holder_staff_id AS holder_staff_id,
       (SELECT json_group_array(table_id) FROM
          (SELECT t.table_id AS table_id FROM seating_tables t WHERE t.seating_id = s.seating_id ORDER BY t.joined_at, t.table_id)) AS table_ids,
       (SELECT COUNT(*) FROM seating_orders o WHERE o.seating_id = s.seating_id AND o.cancelled = 0) AS live_orders
  FROM seating_tables st
  JOIN seatings s ON s.seating_id = st.seating_id
 WHERE st.table_id = ?`;

/** "T4 + T5": the config names of the seating's tables (0 statements); an id the config does not know stays the id. */
function tableCode(table_ids: string[]): string {
  const names = new Map<string, string>();
  for (const floor of branchConfig()?.floors ?? []) for (const t of floor.tables) names.set(t.table_id, t.name);
  return table_ids.map((id) => names.get(id) ?? id).join(' + ');
}

function handle(ctx: CommandCtx, payload: RequestTableHandoverPayload): { alert_id: string; events: ReturnType<typeof alerts.raise>['events'] } {
  const { table_id, seating_id, to_staff_id } = payload;
  // 1. seating checks (T18); NEEDS_CLEANING → 409
  const row = ctx.tx.db.prepare(READ_SEATING).get(table_id) as SeatingRead | undefined;
  if (row === undefined || row.seating_id !== seating_id) throw new DomainError('TABLE_SEATING_CHANGED', { table_id, seating_id });
  if (row.state === 'NEEDS_CLEANING') throw new DomainError('TABLE_NEEDS_CLEANING', { table_id });

  // 2. sender rule: the holder, or an `allowed` force-release-table-lock grant (§3.15; its scope is checked last)
  const caller = ctx.actor.staffId;
  const isHolder = caller !== null && caller === row.holder_staff_id;
  const force = caller === null || isHolder ? null : ctx.directory.resolve(caller, 'force-release-table-lock');
  if (caller === null || (!isHolder && force?.grant !== 'allowed')) {
    throw new DomainError('PERMISSION_DENIED', {
      reason: 'not_holder',
      table_id,
      assigned_staff_id: ctx.directory.assignedOrderTaker(table_id),
      holder_staff_id: row.holder_staff_id,
    });
  }

  // 3. receiver
  checkReceiver(ctx.tx.db, ctx.directory, { table_id, holder_staff_id: row.holder_staff_id, sender_staff_id: caller, to_staff_id });

  // 4. raise; deduped → 409 with the pending request's receiver
  const values: HandoverValues = { table_id, seating_id, from_staff_id: row.holder_staff_id };
  const display: AlertDisplay = {
    kind_label_key: TABLE_HANDOVER.labels.lock,
    table_code: tableCode(JSON.parse(row.table_ids) as string[]),
    requester_name: ctx.directory.get(caller)?.display_name ?? null,
  };
  const details: HandoverDetails = row.live_orders > 0 ? { quantity: row.live_orders } : {};
  const raised = alerts.raise(ctx, {
    kind: HANDOVER_KIND,
    subject: { stream_type: 'table', stream_id: row.primary_table_id },
    target: { kind: 'person', staff_id: to_staff_id },
    values,
    display,
    details,
    dedupe_key: handoverDedupeKey(seating_id),
    requester_staff_id: caller,
    request: { receiver_staff_id: to_staff_id },
  });
  if (raised.deduped) {
    // error path only: the pending request's receiver (1 statement)
    const pending = alerts.listOpen(ctx.tx.db, { kind: HANDOVER_KIND, subject: { stream_type: 'table', stream_id: row.primary_table_id } });
    const receiver = pending.find((a) => a.alert_id === raised.alert_id)?.receiver_staff_id ?? null;
    throw new DomainError('TABLE_HANDOVER_PENDING', { table_id, alert_id: raised.alert_id, to_staff_id: receiver });
  }

  // 5. scope (C8, last): the holder's take-order grant (own_tables covers his own seating), or the force grant
  const scope = isHolder ? ctx.permission : force;
  const covered =
    scope !== null &&
    scope.grant === 'allowed' &&
    ((isHolder && scope.scope === 'own_tables') || scopeCoversFloor(ctx.directory, caller, scope.scope, table_id));
  if (!covered) throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', table_ids: [table_id] });

  return { alert_id: raised.alert_id, events: raised.events };
}

export function registerRequestTableHandover(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'RequestTableHandover',
      payloadSchema: RequestTableHandoverPayload,
      sessionKind: 'device',
      permission: 'take-order',
      handle(ctx, payload) {
        const { alert_id, events } = handle(ctx, payload);
        return { events, result: { alert_id } };
      },
    }),
  );
}
