// 03b §3.2, §6.3 UndoDone (b9a: the line part). The Ready part (step 5's open-Ready read, ReadyToServeUndone, the alert
// close) is the `undoReadyForLines` contract (b9b), called inside this command's transaction.
import { DomainError, UNDO_DONE_MS } from '@pos/domain';
import type { EngineLine } from '@pos/engine';
import type { EventDraft } from '@pos/events';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { CommandCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { undoReadyForLines } from '../contracts.js';
import { envelopeOf, loadMembers, stationLine } from './start-done.js';

export const UndoDonePayload = z.object({ order_item_id: z.string().min(1) });

/** §5 handover_lines: the ids of `order_item_ids` that are in a Handover. 1 statement. */
function handedOver(db: Database.Database, order_item_ids: readonly string[]): Set<string> {
  const rows = db
    .prepare('SELECT order_item_id FROM handover_lines WHERE order_item_id IN (SELECT value FROM json_each(?))')
    .pluck()
    .all(JSON.stringify(order_item_ids)) as string[];
  return new Set(rows);
}

/**
 * §3.2 UndoDone steps 3–6. Common steps 1–2 (start-done.ts). Stage `done` within UNDO_DONE_MS of `done_at` (the
 * engine's, min(done_at, recorded_at): an inferred Done counts from its own done_at), else 409
 * ITEM_UNDO_WINDOW_CLOSED; another stage → ITEM_WRONG_STAGE { stage }; a line in a Handover → ITEM_WRONG_STAGE
 * { stage: 'handed_over' } (1 statement, read for the whole load at once). Batch: every `done` line of the load inside
 * the window and not handed over. Drafts ItemDoneUndone per line, then the contract's Ready drafts.
 * Statements: 1 here + the contract's (§6.3: 2).
 */
function undoDone(ctx: CommandCtx, payload: z.infer<typeof UndoDonePayload>): { events: EventDraft[]; result: { undone: string[]; ready_undone: Array<{ order_id: string; point_id: string }> } } {
  const now = ctx.clock.branchNow();
  const line = stationLine(ctx, payload.order_item_id, now);
  if (line.stage !== 'done') throw new DomainError('ITEM_WRONG_STAGE', { order_item_id: line.order_item_id, stage: line.stage });
  const inWindow = (l: EngineLine): boolean => l.stage === 'done' && l.done_at !== null && now - l.done_at <= UNDO_DONE_MS;
  if (!inWindow(line)) throw new DomainError('ITEM_UNDO_WINDOW_CLOSED', { order_item_id: line.order_item_id });

  const candidates = loadMembers(ctx.state, line, inWindow);
  const handed = handedOver(ctx.tx.db, candidates.map((l) => l.order_item_id));
  if (handed.has(line.order_item_id)) throw new DomainError('ITEM_WRONG_STAGE', { order_item_id: line.order_item_id, stage: 'handed_over' });
  const members = candidates.filter((l) => !handed.has(l.order_item_id));

  const envelope = envelopeOf(ctx, now);
  const undone = members.map(
    (l): EventDraft => ({
      stream_type: 'order',
      stream_id: l.order_id,
      event_type: 'ItemDoneUndone',
      schema_version: 1,
      payload: { order_item_id: l.order_item_id },
      ...envelope,
    }),
  );
  const ids = members.map((l) => l.order_item_id);
  const ready = undoReadyForLines(ctx, ids);
  return { events: [...undone, ...ready.events], result: { undone: ids, ready_undone: ready.ready_undone } };
}

export const undoDoneCommand = defineCommand({
  commandType: 'UndoDone',
  payloadSchema: UndoDonePayload,
  sessionKind: 'device',
  permission: 'run-pass',
  stationScoped: true,
  handle: (ctx, payload) => undoDone(ctx, payload),
});
