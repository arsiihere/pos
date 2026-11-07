import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand } from './registry.js';
import { commandRegistry } from './route.js';
import { liveStation, requireStationInScope } from './set-station-capacity.js';

// 03a §6.7: { station_id, paused: boolean }.
const Payload = z.object({
  station_id: z.string().min(1),
  paused: z.boolean(),
});

// 03a §6.7: staff sessions only (stationScoped false: a KDS does not pause its station, the route answers 403).
// Steps 1–3 as §6.6; pausing a station with pause_enabled false → 409 before the scope check (C8, scope last);
// unpausing is always allowed. The station data is the in-memory engine state: no SQL read (§10.5).
export function registerSetStationPause(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'SetStationPause',
      payloadSchema: Payload,
      sessionKind: 'device',
      permission: 'manage-stations',
      stationScoped: false,
      handle(ctx, payload) {
        const now = ctx.clock.branchNow();
        const live = liveStation(ctx.state, payload.station_id, now);
        if (payload.paused && !live.pause_enabled) throw new DomainError('STATION_PAUSE_DISABLED', { station_id: payload.station_id });
        requireStationInScope(ctx, payload.station_id);
        // Same as current → the same shape with changed false (v0.4 G2 #20).
        if (live.paused === payload.paused) return { events: [], result: pauseResult(payload.station_id, payload.paused, false) };
        // The result does not depend on the post-fold state, so the draft goes back through `events`: the route
        // appends it once, the writer folds it and swaps after COMMIT (D45), and no extra MAX(seq) read (§10.5).
        return {
          events: [
            {
              stream_type: 'station',
              stream_id: payload.station_id,
              event_type: 'StationPauseSet',
              schema_version: 1,
              payload: { station_id: payload.station_id, paused: payload.paused },
              occurred_at: now,
              actor_id: ctx.actor.staffId,
              device_id: ctx.actor.deviceId,
            },
          ],
          result: pauseResult(payload.station_id, payload.paused, true),
        };
      },
    }),
  );
}

function pauseResult(stationId: string, paused: boolean, changed: boolean) {
  return { station_id: stationId, paused, changed };
}
