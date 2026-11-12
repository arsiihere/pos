// 03b §3.2, §6.1 StartItem, §6.2 DoneItem (b8). Station data come from the in-memory engine state: 0 statements.
// Callers (§3.9): a station session for a line of its own station (`stationScoped`, ctx.permission null), or a staff
// session holding `run-pass` (branch). Not queueable (P5).
import { DomainError } from '@pos/domain';
import { applyEvents, isOrderInEngine, lateStartShift, stockEffects, type EngineLine, type EngineState } from '@pos/engine';
import type { EventDraft, PosEvent } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CommandCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';

type CompletionMode = 'two_tap' | 'single_tap' | 'auto_done';

/**
 * §3.2 common steps 1–2 (shared with UndoDone): `state.lines[id]` absent → 404 ORDER_NOT_FOUND { order_item_id,
 * order_id: null }; its order out of the engine → 409 ITEM_WRONG_STAGE { stage: 'out_of_engine' }; a station session
 * on another station's line → 403 PERMISSION_DENIED. 0 statements. A placeholder (AD-8: listed by OrderPlaced, its
 * ItemAdded not seen yet) is not a line, so it is absent.
 */
export function stationLine(ctx: CommandCtx, order_item_id: string, now: number): EngineLine {
  const line = ctx.state.lines[order_item_id];
  if (line === undefined || isPlaceholder(line)) throw new DomainError('ORDER_NOT_FOUND', { order_item_id, order_id: null });
  if (!isOrderInEngine(ctx.state as EngineState, line.order_id, now)) throw new DomainError('ITEM_WRONG_STAGE', { order_item_id, stage: 'out_of_engine' });
  requireOwnStation(ctx, line.station_id);
  return line;
}

/** §3.2 common step 2 / §3.9: a station session acts on its own station only. */
export function requireOwnStation(ctx: CommandCtx, station_id: string): void {
  if (ctx.actor.kind === 'station' && ctx.actor.stationId !== station_id) {
    throw new DomainError('PERMISSION_DENIED', { session_kind: 'station', reason: 'outside_scope', station_id });
  }
}

/** The station's completion mode from the engine config (the one the fires tick reads); default two_tap as the tick. */
export function completionMode(state: Readonly<EngineState>, station_id: string): CompletionMode {
  return state.config?.stations.find((s) => s.station_id === station_id)?.completion_mode ?? 'two_tap';
}

// AD-8 (engine lifecycle.ts isPlaceholder, not in the package index): a listed line not yet filled by its ItemAdded.
function isPlaceholder(line: EngineLine): boolean {
  return line.units === 0 && line.fire_ms === null && line.booked === null;
}

/**
 * §3.2 step 4 (AD-18): the line and, on a load, every line of the same station and load_id that `pick` admits and that
 * passes step 1 itself (its order in the engine at `now`; a member of an exited order is left out, never written).
 */
export function loadMembers(state: Readonly<EngineState>, line: EngineLine, pick: (l: EngineLine) => boolean, now: number): EngineLine[] {
  if (line.load_id === null) return [line];
  const out: EngineLine[] = [];
  for (const id in state.lines) {
    const l = state.lines[id]!;
    if (l === line) out.push(l);
    else if (l.load_id === line.load_id && l.station_id === line.station_id && pick(l) && isOrderInEngine(state as EngineState, l.order_id, now)) out.push(l);
  }
  return out.sort((a, b) => (a.order_item_id < b.order_item_id ? -1 : a.order_item_id > b.order_item_id ? 1 : 0));
}

const fired = (l: EngineLine): boolean => l.stage === 'added' && l.fired_at !== null;

/** The command envelope: station sessions carry actor_id null (staffId is null) and the KDS device_id (§3.2). */
export function envelopeOf(ctx: CommandCtx, now: number): Pick<EventDraft, 'occurred_at' | 'actor_id' | 'device_id'> {
  return { occurred_at: now, actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
}

// ------------------------------------------------------------------------------------------- §6.1 StartItem

export const StartItemPayload = z.object({ order_item_id: z.string().min(1) });

/**
 * §3.2 StartItem steps 3–6. Stage `added` and fired, else ITEM_WRONG_STAGE { stage }; `single_tap` → { stage: 'cooking' }
 * (its Start is inferred). Batch: every fired `added` line of the load. Drafts: ItemStarted { started_at: now, source:
 * 'tap' } per line with its stockEffects (array form), then `lateStartShift` → ReservationsShifted, drafted on the state
 * with the whole load started (a scratch fold, as lateStartShift itself folds one line).
 */
function startItem(ctx: CommandCtx, payload: z.infer<typeof StartItemPayload>): { events: EventDraft[]; result: { started: string[] } } {
  const now = ctx.clock.branchNow();
  const line = stationLine(ctx, payload.order_item_id, now);
  if (!fired(line)) throw new DomainError('ITEM_WRONG_STAGE', { order_item_id: line.order_item_id, stage: line.stage });
  if (completionMode(ctx.state, line.station_id) === 'single_tap') throw new DomainError('ITEM_WRONG_STAGE', { order_item_id: line.order_item_id, stage: 'cooking' });

  const members = loadMembers(ctx.state, line, fired, now);
  const envelope = envelopeOf(ctx, now);
  const starts = members.map(
    (l): EventDraft => ({
      stream_type: 'order',
      stream_id: l.order_id,
      event_type: 'ItemStarted',
      schema_version: 1,
      payload: { order_item_id: l.order_item_id, started_at: now, source: 'tap' },
      ...envelope,
    }),
  );
  const events = stockEffects(ctx.state as EngineState, starts).map((d): EventDraft => ({ ...envelope, ...d }) as EventDraft);
  // One load: fold every member's Start but the tapped line's on a scratch copy; lateStartShift folds the tapped one.
  const others = starts.filter((d) => (d.payload as { order_item_id: string }).order_item_id !== line.order_item_id);
  const shift = lateStartShift(scratch(ctx.state as EngineState, others, now), line.order_item_id, now);
  if (shift !== null) events.push({ ...shift, payload: shift.payload as unknown as Record<string, unknown>, ...envelope });
  return { events, result: { started: members.map((l) => l.order_item_id) } };
}

function scratch(state: EngineState, drafts: readonly EventDraft[], now: number): EngineState {
  if (drafts.length === 0) return state;
  const events = drafts.map(
    (d, i): PosEvent => ({ ...d, event_id: `scratch-${i}`, tenant_id: '', branch_id: '', recorded_at: now, seq: 0 }),
  );
  return applyEvents(state, events, { strict: false });
}

export const startItemCommand = defineCommand({
  commandType: 'StartItem',
  payloadSchema: StartItemPayload,
  sessionKind: 'device',
  permission: 'run-pass',
  stationScoped: true,
  handle: (ctx, payload) => startItem(ctx, payload),
});

// ------------------------------------------------------------------------------------------- §6.2 DoneItem

export const DoneItemPayload = z.object({ order_item_id: z.string().min(1), confirm: z.boolean().optional() });

/**
 * §3.2 DoneItem steps 3–6. `cooking` → ok; `added` and fired → ok only from stock or at an `auto_done` station, else
 * ITEM_WRONG_STAGE { stage: 'added' } ("Tap Start first", also for an unfired line); later stages → ITEM_WRONG_STAGE
 * { stage }. Only with `started_at` set: now − started_at < 0.5 × cook_ms without confirm → 422
 * ITEM_DONE_CONFIRM_REQUIRED, nothing written. Batch: every line of the load the same rule admits. Drafts ItemDone
 * { done_at: now, source: 'tap' } per line + stockEffects (array form: a from-stock Done with no Start consumes).
 */
function doneItem(ctx: CommandCtx, payload: z.infer<typeof DoneItemPayload>): { events: EventDraft[]; result: { done: string[] } } {
  const now = ctx.clock.branchNow();
  const line = stationLine(ctx, payload.order_item_id, now);
  const autoDone = completionMode(ctx.state, line.station_id) === 'auto_done';
  const doneable = (l: EngineLine): boolean => l.stage === 'cooking' || (fired(l) && (l.from_stock || autoDone));
  if (!doneable(line)) throw new DomainError('ITEM_WRONG_STAGE', { order_item_id: line.order_item_id, stage: line.stage });
  if (line.started_at !== null && payload.confirm !== true) {
    const elapsed_ms = now - line.started_at;
    if (elapsed_ms < 0.5 * line.cook_ms) {
      throw new DomainError('ITEM_DONE_CONFIRM_REQUIRED', { order_item_id: line.order_item_id, elapsed_ms, cook_ms: line.cook_ms });
    }
  }

  const members = loadMembers(ctx.state, line, doneable, now);
  const envelope = envelopeOf(ctx, now);
  const dones = members.map(
    (l): EventDraft => ({
      stream_type: 'order',
      stream_id: l.order_id,
      event_type: 'ItemDone',
      schema_version: 1,
      payload: { order_item_id: l.order_item_id, done_at: now, source: 'tap' },
      ...envelope,
    }),
  );
  const events = stockEffects(ctx.state as EngineState, dones).map((d): EventDraft => ({ ...envelope, ...d }) as EventDraft);
  return { events, result: { done: members.map((l) => l.order_item_id) } };
}

export const doneItemCommand = defineCommand({
  commandType: 'DoneItem',
  payloadSchema: DoneItemPayload,
  sessionKind: 'device',
  permission: 'run-pass',
  stationScoped: true,
  handle: (ctx, payload) => doneItem(ctx, payload),
});

export function registerStartDone(app: FastifyInstance): void {
  commandRegistry(app).register(startItemCommand);
  commandRegistry(app).register(doneItemCommand);
}
