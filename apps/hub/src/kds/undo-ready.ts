// 03b §3.2 UndoDone step 5 (b9b): the Ready part of UndoDone, inside UndoDone's transaction (contract
// `undoReadyForLines`, kds/contracts.ts). Every open Ready (pass_orders_open) whose unsettled own lines
// (pass_ready_lines) include an undone line → `ReadyToServeUndone { order_id, point_id, alert_id }` + its alert closed
// `undone`. Statements 1 (`pass_ready_lines` ⋈ `pass_orders`) + one 01d closeMany for every Ready at once.
import type { EventDraft, ReadyToServeUndonePayload } from '@pos/events';
import { alerts } from '../alerts/raise.js';
import type { CommandCtx } from '../commands/registry.js';
import type { UndoReadyResult } from './contracts.js';

export function undoReadyForLines(ctx: CommandCtx, order_item_ids: readonly string[]): UndoReadyResult {
  if (order_item_ids.length === 0) return { events: [], ready_undone: [] };
  const rows = ctx.tx.db
    .prepare(
      `SELECT DISTINCT p.order_id AS order_id, p.point_id AS point_id, p.ready_alert_id AS alert_id
         FROM pass_ready_lines r
         JOIN pass_orders p ON p.order_id = r.order_id AND p.point_id = r.point_id
        WHERE r.settled_at IS NULL AND p.ready_alert_id IS NOT NULL
          AND r.order_item_id IN (SELECT value FROM json_each(?))
        ORDER BY p.order_id, p.point_id`,
    )
    .all(JSON.stringify(order_item_ids)) as Array<{ order_id: string; point_id: string; alert_id: string }>;
  if (rows.length === 0) return { events: [], ready_undone: [] };
  const now = ctx.clock.branchNow();
  const undone = rows.map((r): EventDraft => {
    const payload: ReadyToServeUndonePayload = { order_id: r.order_id, point_id: r.point_id, alert_id: r.alert_id };
    return {
      stream_type: 'order',
      stream_id: r.order_id,
      event_type: 'ReadyToServeUndone',
      schema_version: 1,
      payload,
      occurred_at: now,
      actor_id: ctx.actor.staffId,
      device_id: ctx.actor.deviceId,
    };
  });
  const closed = alerts.closeMany(
    ctx,
    rows.map((r) => ({ alert_id: r.alert_id, reason: 'undone' as const })),
  );
  return { events: [...undone, ...closed], ready_undone: rows.map((r) => ({ order_id: r.order_id, point_id: r.point_id })) };
}
