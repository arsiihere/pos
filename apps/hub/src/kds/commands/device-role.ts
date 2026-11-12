import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { branchConfig } from '../../sync/branch-config-holder.js';

// 03b §6.10, §3.8: SetDeviceRole (admin session, manage-devices, §3.9) → DeviceRoleSet; the device_roles projection
// writes devices.point_id / lane_label and the maps refresh after the commit. An omitted field keeps the device's value.
// H-6: lane_label only on a `kds` device with a station_id. Statements 1 (the device row); the point from
// branchConfig().points[] (memory); an archived point is POINT_NOT_FOUND.
const Id = z.string().min(1);
const Payload = z.object({
  device_id: Id,
  point_id: Id.nullable().optional(),
  lane_label: z.string().min(1).max(20).nullable().optional(),
});

const DEVICE_SQL =
  'SELECT device_type, station_id, point_id, lane_label FROM devices WHERE device_id = ? AND branch_id = ? AND revoked_at IS NULL';

interface DeviceRow {
  device_type: string;
  station_id: string | null;
  point_id: string | null;
  lane_label: string | null;
}

export function registerSetDeviceRole(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'SetDeviceRole',
      payloadSchema: Payload,
      sessionKind: 'admin',
      permission: 'manage-devices',
      handle(ctx, payload) {
        const device = ctx.tx.db.prepare(DEVICE_SQL).get(payload.device_id, ctx.branch.branchId) as DeviceRow | undefined;
        if (device === undefined) throw new DomainError('DEVICE_NOT_FOUND', { device_id: payload.device_id });
        const point_id = payload.point_id === undefined ? device.point_id : payload.point_id;
        const lane_label = payload.lane_label === undefined ? device.lane_label : payload.lane_label;
        if (payload.point_id !== undefined && payload.point_id !== null) {
          const known = branchConfig()?.points.some((p) => p.point_id === payload.point_id && !p.is_archived) ?? false;
          if (!known) throw new DomainError('POINT_NOT_FOUND', { point_id: payload.point_id });
        }
        if (lane_label !== null && (device.device_type !== 'kds' || device.station_id === null)) {
          throw new DomainError('VALIDATION_FAILED', {
            field: 'lane_label',
            issues: [{ path: 'lane_label', message: 'a lane label needs a kds device with a station' }],
          });
        }
        const role = { device_id: payload.device_id, point_id, lane_label };
        return {
          events: [
            {
              stream_type: 'hub',
              stream_id: ctx.branch.branchId,
              event_type: 'DeviceRoleSet',
              schema_version: 1,
              payload: role,
              occurred_at: ctx.clock.branchNow(),
              actor_id: ctx.actor.staffId,
              device_id: ctx.actor.deviceId,
            },
          ],
          result: role,
        };
      },
    }),
  );
}
