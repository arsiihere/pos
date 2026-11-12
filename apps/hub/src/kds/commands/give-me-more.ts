// 03b §3.2, §6.4 GiveMeMore (b9a). Memory only: 0 statements.
import { pullEarly, stockEffects, type EngineState } from '@pos/engine';
import type { EventDraft } from '@pos/events';
import { z } from 'zod';
import type { CommandCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { liveStation } from '../../commands/set-station-capacity.js';
import { completionMode, envelopeOf, requireOwnStation } from './start-done.js';

export const GiveMeMorePayload = z.object({ station_id: z.string().min(1), n: z.number().int().min(1).max(10).optional() });

/**
 * §3.2 GiveMeMore: unknown / archived station → 404 STATION_NOT_FOUND (03a `liveStation`, memory); a station session
 * for its own station only (403 PERMISSION_DENIED, after the 404, C8), a `run-pass` staff session for any station.
 * `pullEarly(state, station_id, n ?? 1, now)`: null → { pulled: null }, nothing written; else its FireDispatched
 * { reason: 'pulled' } draft, and at a `single_tap` station an inferred ItemStarted per pulled line with its
 * stockEffects (as the fires tick's inferred Start, 03a D60, P-5). Result { pulled: order_item_ids | null }.
 */
function giveMeMore(ctx: CommandCtx, payload: z.infer<typeof GiveMeMorePayload>): { events: EventDraft[]; result: { pulled: string[] | null } } {
  const now = ctx.clock.branchNow();
  liveStation(ctx.state, payload.station_id, now);
  requireOwnStation(ctx, payload.station_id);
  const state = ctx.state as EngineState;
  const pull = pullEarly(state, payload.station_id, payload.n ?? 1, now);
  if (pull === null) return { events: [], result: { pulled: null } };

  const envelope = envelopeOf(ctx, now);
  const events: EventDraft[] = [{ ...pull, payload: pull.payload as unknown as Record<string, unknown>, ...envelope }];
  if (completionMode(state, payload.station_id) === 'single_tap') {
    const starts = pull.payload.order_item_ids.map(
      (id): EventDraft => ({
        stream_type: 'order',
        stream_id: state.lines[id]!.order_id,
        event_type: 'ItemStarted',
        schema_version: 1,
        payload: { order_item_id: id, started_at: now, source: 'inferred' },
        ...envelope,
      }),
    );
    events.push(...stockEffects(state, starts).map((d): EventDraft => ({ ...envelope, ...d }) as EventDraft));
  }
  return { events, result: { pulled: [...pull.payload.order_item_ids] } };
}

export const giveMeMoreCommand = defineCommand({
  commandType: 'GiveMeMore',
  payloadSchema: GiveMeMorePayload,
  sessionKind: 'device',
  permission: 'run-pass',
  stationScoped: true,
  handle: (ctx, payload) => giveMeMore(ctx, payload),
});
