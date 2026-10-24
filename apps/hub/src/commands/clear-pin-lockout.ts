import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand } from './registry.js';
import { commandRegistry } from './route.js';

const Payload = z.object({
  subject_type: z.enum(['staff', 'device', 'ip']),
  subject_id: z.string().min(1),
});

export function registerClearPinLockout(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'ClearPinLockout',
      payloadSchema: Payload,
      sessionKind: 'admin',
      permission: 'manage-staff',
      handle(ctx, payload) {
        const row = ctx.tx.db
          .prepare(
            `SELECT locked_until FROM auth_lockouts
             WHERE branch_id = ? AND subject_type = ? AND subject_id = ?`,
          )
          .get(ctx.branch.branchId, payload.subject_type, payload.subject_id) as { locked_until: number | null } | undefined;
        const now = ctx.clock.branchNow();
        const locked = row !== undefined && row.locked_until !== null && row.locked_until > now;
        if (!locked) {
          return { events: [], result: { subject_type: payload.subject_type, subject_id: payload.subject_id, cleared: false } };
        }
        ctx.tx.db
          .prepare(
            `UPDATE auth_lockouts SET failed_count = 0, locked_until = NULL
             WHERE branch_id = ? AND subject_type = ? AND subject_id = ?`,
          )
          .run(ctx.branch.branchId, payload.subject_type, payload.subject_id);
        const actor = ctx.actor.staffId;
        return {
          events: [
            {
              stream_type: payload.subject_type === 'staff' ? 'staff' : 'hub',
              stream_id: payload.subject_id,
              event_type: 'PinLockoutCleared',
              schema_version: 1,
              payload: { subject_type: payload.subject_type, subject_id: payload.subject_id },
              occurred_at: now,
              actor_id: actor,
              device_id: ctx.actor.deviceId,
            },
          ],
          result: { subject_type: payload.subject_type, subject_id: payload.subject_id, cleared: true },
        };
      },
    }),
  );
}
