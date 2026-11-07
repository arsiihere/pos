import { DomainError } from '@pos/domain';
import { applyEvents, stationsLive, type EngineState, type StationLive } from '@pos/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Resolution, StaffDirectory } from '../auth/staff-directory.js';
import { defineCommand, type CommandCtx } from './registry.js';
import { commandRegistry } from './route.js';

// 03a §6.6 (v0.4 G2 #15): capacity_override int 1–100 | null, as 01a's station capacity.
const Payload = z.object({
  station_id: z.string().min(1),
  capacity_override: z.number().int().min(1).max(100).nullable(),
  reason: z.enum(['manager', 'lane_off', 'lane_on']),
});

// 03a §6.6 steps 3–7: KDS station sessions for their own station (lane Off / On, ≤ the configured capacity); staff
// with manage-stations up to 100, scope last (C8). The station data is the in-memory engine state: no SQL read (§10.5).
export function registerSetStationCapacity(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'SetStationCapacity',
      payloadSchema: Payload,
      sessionKind: 'device',
      permission: 'manage-stations',
      stationScoped: true,
      handle(ctx, payload) {
        const now = ctx.clock.branchNow();
        const live = liveStation(ctx.state, payload.station_id, now);
        if (ctx.actor.kind === 'station') {
          if (payload.station_id !== ctx.actor.stationId || payload.reason === 'manager') throw outsideScope(payload.station_id);
          if (payload.capacity_override !== null && payload.capacity_override > live.capacity) {
            throw new DomainError('VALIDATION_FAILED', {
              field: 'capacity_override',
              issues: [{ path: 'capacity_override', message: `capacity_override above the station capacity ${live.capacity}` }],
            });
          }
        } else {
          requireStationInScope(ctx, payload.station_id);
        }
        if (live.capacity_override === payload.capacity_override) return { events: [], result: capacityResult(live, false) };
        // §6.6 step 6: the writer folds again and swaps after COMMIT (D45); this fold is for the response only.
        const appended = ctx.tx.append([
          {
            stream_type: 'station',
            stream_id: payload.station_id,
            event_type: 'StationCapacitySet',
            schema_version: 1,
            payload: {
              station_id: payload.station_id,
              capacity_override: payload.capacity_override,
              previous: live.capacity_override,
              reason: payload.reason,
            },
            occurred_at: now,
            actor_id: ctx.actor.staffId,
            device_id: ctx.actor.deviceId,
          },
        ]);
        const next = applyEvents(ctx.state, appended, { strict: false });
        return { events: [], result: capacityResult(liveStation(next, payload.station_id, now), true) };
      },
    }),
  );
}

// 03a §6.6 / §6.7 step 3: the station in state.stations and not archived (stationsLive leaves both out), else 404.
export function liveStation(state: Readonly<EngineState>, stationId: string, now: number): StationLive {
  const live = stationsLive(state as EngineState, now, [stationId]).stations[0];
  if (live === undefined) throw new DomainError('STATION_NOT_FOUND', { station_id: stationId });
  return live;
}

// 03a §6.6 / §6.7, 01b B-4, C8: under manage-stations scope my_stations the station must be one of the person's
// run_station stations; scope branch (the default) allows every station. Checked last, after the 404.
export function requireStationInScope(ctx: CommandCtx, stationId: string): void {
  if (stationScopeFilter(ctx.directory, ctx.actor.staffId, ctx.permission)(stationId)) return;
  throw outsideScope(stationId);
}

function stationScopeFilter(directory: StaffDirectory, staffId: string | null, resolution: Resolution | null): (stationId: string) => boolean {
  const scoped = resolution !== null && 'scope' in resolution && resolution.scope === 'my_stations';
  if (!scoped) return () => true;
  const stations = new Set(staffId === null ? [] : directory.stationsOf(staffId, 'run_station'));
  return (stationId) => stations.has(stationId);
}

function outsideScope(stationId: string): DomainError {
  return new DomainError('PERMISSION_DENIED', { permission: 'manage-stations', reason: 'outside_scope', station_id: stationId });
}

// 03a §6.6 step 7 (and step 5, one shape, v0.4 G2 #20).
function capacityResult(live: StationLive, changed: boolean) {
  return {
    station_id: live.station_id,
    effective_capacity: live.effective_capacity,
    pressure_bp: live.pressure_bp,
    band: live.band,
    changed,
  };
}
