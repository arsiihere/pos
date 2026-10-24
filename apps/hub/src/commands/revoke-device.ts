import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { activeSessionsOf, endSession } from '../auth/session-store.js';
import { defineCommand } from './registry.js';
import { commandRegistry } from './route.js';

const Payload = z.object({
  device_id: z.string().min(1),
  reason: z.string().max(200).optional(),
});

export function registerRevokeDevice(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'RevokeDevice',
      payloadSchema: Payload,
      sessionKind: 'admin',
      permission: 'manage-devices',
      handle(ctx, payload) {
        const device = ctx.tx.db
          .prepare('SELECT revoked_at FROM devices WHERE device_id = ? AND branch_id = ?')
          .get(payload.device_id, ctx.branch.branchId) as { revoked_at: number | null } | undefined;
        if (device === undefined) throw new DomainError('DEVICE_NOT_FOUND', { device_id: payload.device_id });
        if (device.revoked_at !== null) {
          return {
            events: [],
            result: { device_id: payload.device_id, revoked_at: device.revoked_at, already_revoked: true },
          };
        }
        const now = ctx.clock.branchNow();
        const actor = ctx.actor.staffId;
        const reason = payload.reason ?? null;
        ctx.tx.db
          .prepare('UPDATE devices SET revoked_at = ?, revoked_by = ? WHERE device_id = ? AND revoked_at IS NULL')
          .run(now, actor, payload.device_id);
        for (const session of activeSessionsOf(ctx.tx.db, { deviceId: payload.device_id })) {
          endSession(ctx.tx, session, 'device_revoked', actor, actor, ctx.actor.deviceId);
        }
        return {
          events: [
            {
              stream_type: 'hub',
              stream_id: payload.device_id,
              event_type: 'DeviceRevoked',
              schema_version: 1,
              payload: { device_id: payload.device_id, reason, cause: 'manual' },
              occurred_at: now,
              actor_id: actor,
              device_id: ctx.actor.deviceId,
            },
          ],
          result: { device_id: payload.device_id, revoked_at: now, already_revoked: false },
        };
      },
    }),
  );
}
