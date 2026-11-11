import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { branchConfig } from '../../sync/branch-config-holder.js';

// 03b §6.9, §3.8: SetStationScreen (admin session, manage-devices, §3.9) → StationScreenSet; the kds_config projection
// stores sound_volume. Statements 0: the station from branchConfig().stations[] (memory).
const Payload = z.object({
  station_id: z.string().min(1),
  sound_volume: z.number().int().min(0).max(100),
});

export function registerSetStationScreen(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'SetStationScreen',
      payloadSchema: Payload,
      sessionKind: 'admin',
      permission: 'manage-devices',
      handle(ctx, payload) {
        const station = branchConfig()?.stations.find((s) => s.station_id === payload.station_id && !s.is_archived);
        if (station === undefined) throw new DomainError('STATION_NOT_FOUND', { station_id: payload.station_id });
        return {
          events: [
            {
              stream_type: 'hub',
              stream_id: ctx.branch.branchId,
              event_type: 'StationScreenSet',
              schema_version: 1,
              payload: { station_id: payload.station_id, sound_volume: payload.sound_volume },
              occurred_at: ctx.clock.branchNow(),
              actor_id: ctx.actor.staffId,
              device_id: ctx.actor.deviceId,
            },
          ],
          result: { station_id: payload.station_id, sound_volume: payload.sound_volume },
        };
      },
    }),
  );
}
