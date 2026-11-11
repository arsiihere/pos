import { DomainError } from '@pos/domain';
import { capacityForLanes } from '@pos/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { liveStation } from '../../commands/set-station-capacity.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { branchConfig } from '../../sync/branch-config-holder.js';

// 03b §3.7, §6.5: SetLaneState — a station session for its own station, or run-pass staff (branch, §3.9). Engine
// numbers from 03a's liveStation; capacity / lane_units from branchConfig().stations[]. G-4: the own-station check is
// inline (requireStationInScope is not used), next to 03a's station-session cap check. Appends, in this order,
// StationCapacitySet { capacityForLanes (null when all on), previous, lane_off | lane_on } and LanesSet (G1-7).
// Statements 1: the lane devices (H-6) and the stored lanes in one read.
const Payload = z.object({
  station_id: z.string().min(1),
  lanes_on: z.number().int().min(1),
});

// §3.7: lane_count = labelled, unrevoked `kds` devices of the station (none → 1); `stored` = the kds_config mirror row.
const LANES_SQL = `
  SELECT (SELECT COUNT(*) FROM devices
           WHERE device_type = 'kds' AND station_id = @station_id AND lane_label IS NOT NULL AND revoked_at IS NULL) AS devices,
         (SELECT COUNT(*) FROM station_lanes WHERE station_id = @station_id) AS has_row,
         (SELECT lanes_on FROM station_lanes WHERE station_id = @station_id) AS lanes_on,
         (SELECT lane_count FROM station_lanes WHERE station_id = @station_id) AS stored_count`;

export function registerSetLaneState(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'SetLaneState',
      payloadSchema: Payload,
      sessionKind: 'device',
      permission: 'run-pass',
      stationScoped: true,
      handle(ctx, payload) {
        const now = ctx.clock.branchNow();
        const live = liveStation(ctx.state, payload.station_id, now);
        const station = branchConfig()?.stations.find((s) => s.station_id === payload.station_id);
        if (station === undefined) throw new DomainError('STATION_NOT_FOUND', { station_id: payload.station_id });
        const isStation = ctx.actor.kind === 'station';
        if (isStation && payload.station_id !== ctx.actor.stationId) {
          throw new DomainError('PERMISSION_DENIED', { permission: 'run-pass', reason: 'outside_scope', station_id: payload.station_id });
        }
        const row = ctx.tx.db.prepare(LANES_SQL).get({ station_id: payload.station_id }) as {
          devices: number;
          has_row: number;
          lanes_on: number | null;
          stored_count: number | null;
        };
        const lane_count = Math.max(1, row.devices);
        if (payload.lanes_on > lane_count) {
          throw new DomainError('VALIDATION_FAILED', {
            field: 'lanes_on',
            issues: [{ path: 'lanes_on', message: `lanes_on above the lane count ${lane_count}` }],
          });
        }
        // no row = all on (day open), at today's lane count; NULL lanes_on = custom
        const stored = row.has_row === 0 ? { lanes_on: lane_count, lane_count } : { lanes_on: row.lanes_on, lane_count: row.stored_count };
        const result = (capacity_override: number | null) => ({ lanes_on: payload.lanes_on, lane_count, capacity: capacity_override ?? live.capacity });
        // §3.7 no-op = same lanes_on AND same lane_count (a screen labelled / revoked since changes the numbers)
        if (stored.lanes_on === payload.lanes_on && stored.lane_count === lane_count) return { events: [], result: result(live.capacity_override) };
        const capacity_override = payload.lanes_on === lane_count ? null : capacityForLanes(station, payload.lanes_on, lane_count);
        // 03a §6.6 station-session cap check (set-station-capacity.ts): never above the engine's station capacity
        if (isStation && capacity_override !== null && capacity_override > live.capacity) {
          throw new DomainError('VALIDATION_FAILED', {
            field: 'capacity_override',
            issues: [{ path: 'capacity_override', message: `capacity_override above the station capacity ${live.capacity}` }],
          });
        }
        // direction: by lanes_on when it moved from a known value; else by the effective capacity
        const before = live.capacity_override ?? live.capacity;
        const after = capacity_override ?? live.capacity;
        const reason =
          stored.lanes_on !== null && stored.lanes_on !== payload.lanes_on
            ? payload.lanes_on < stored.lanes_on
              ? 'lane_off'
              : 'lane_on'
            : after < before
              ? 'lane_off'
              : 'lane_on';
        const envelope = { schema_version: 1, occurred_at: now, actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
        // the engine override unchanged (e.g. all on before and after a revoke) → no StationCapacitySet, LanesSet only
        const capacityEvents =
          capacity_override === live.capacity_override
            ? []
            : [
                {
                  ...envelope,
                  stream_type: 'station' as const,
                  stream_id: payload.station_id,
                  event_type: 'StationCapacitySet',
                  payload: { station_id: payload.station_id, capacity_override, previous: live.capacity_override, reason },
                },
              ];
        return {
          events: [
            ...capacityEvents,
            {
              ...envelope,
              stream_type: 'station',
              stream_id: payload.station_id,
              event_type: 'LanesSet',
              payload: { station_id: payload.station_id, lanes_on: payload.lanes_on, lane_count },
            },
          ],
          result: result(capacity_override),
        };
      },
    }),
  );
}
