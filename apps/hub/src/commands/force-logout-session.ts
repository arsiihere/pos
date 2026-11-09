import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { endSession, type SessionRow } from '../auth/session-store.js';
import { defineCommand } from './registry.js';
import { commandRegistry } from './route.js';

const Payload = z.object({
  session_id: z.string().min(1),
});

const SESSION_COLUMNS =
  'session_id, kind, staff_id, station_id, device_id, idle_ttl_ms, started_at, last_activity_at, ended_at, token_hash';

export function registerForceLogoutSession(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'ForceLogoutSession',
      payloadSchema: Payload,
      sessionKind: 'admin',
      permission: 'manage-staff',
      handle(ctx, payload) {
        const session = ctx.tx.db
          .prepare(`SELECT ${SESSION_COLUMNS} FROM staff_sessions WHERE session_id = ? AND branch_id = ?`)
          .get(payload.session_id, ctx.branch.branchId) as SessionRow | undefined;
        if (session === undefined) throw new DomainError('SESSION_NOT_FOUND', { session_id: payload.session_id });
        if (session.ended_at !== null) {
          return {
            events: [],
            result: { session_id: session.session_id, ended_at: session.ended_at, already_ended: true },
          };
        }
        const actor = ctx.actor.staffId;
        endSession(ctx.tx, session, 'forced', actor, actor, ctx.actor.deviceId);
        if (session.ended_at === null) throw new DomainError('SESSION_NOT_FOUND', { session_id: payload.session_id });
        return {
          events: [],
          result: { session_id: session.session_id, ended_at: session.ended_at, already_ended: false },
        };
      },
    }),
  );
}
