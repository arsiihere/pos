import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { activity } from '../auth/session-store.js';
import { defineQuery, queryRegistry } from './registry.js';

export function registerSessionsQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'sessions',
      sessionKind: 'admin',
      session: 'none',
      countsAsActivity: false,
      querySchema: z.object({}),
      handle(ctx) {
        const rows = ctx.db
          .prepare(
            `SELECT s.session_id, s.kind, s.staff_id, s.station_id, s.device_id,
                    s.started_at, s.last_activity_at, s.idle_ttl_ms, d.device_name
             FROM staff_sessions s
             LEFT JOIN devices d ON d.device_id = s.device_id
             WHERE s.ended_at IS NULL
             ORDER BY s.started_at, s.session_id`,
          )
          .all() as Array<{
          session_id: string;
          kind: string;
          staff_id: string | null;
          station_id: string | null;
          device_id: string | null;
          started_at: number;
          last_activity_at: number;
          idle_ttl_ms: number | null;
          device_name: string | null;
        }>;
        return {
          data: {
            sessions: rows.map((row) => ({
              session_id: row.session_id,
              kind: row.kind,
              staff_id: row.staff_id,
              display_name: row.staff_id === null ? null : (ctx.directory.get(row.staff_id)?.display_name ?? null),
              station_id: row.station_id,
              device_id: row.device_id,
              device_name: row.device_name,
              started_at: row.started_at,
              last_activity_at: activity.get(row.session_id) ?? row.last_activity_at,
              idle_ttl_ms: row.idle_ttl_ms,
            })),
          },
        };
      },
    }),
  );
}
