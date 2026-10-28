import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { activity } from '../auth/session-store.js';
import { defineQuery, queryRegistry } from './registry.js';

const Query = z.object({
  include_revoked: z.enum(['true', 'false']).optional(),
});

export function registerDevicesQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'devices',
      sessionKind: 'admin',
      session: 'none',
      countsAsActivity: false,
      querySchema: Query,
      handle(ctx, query) {
        const includeRevoked = query.include_revoked === 'true' ? 1 : 0;
        const rows = ctx.db
          .prepare(
            `SELECT d.device_id, d.device_name, d.device_type, d.station_id, d.owner_staff_id,
                    d.paired_at, d.paired_by, d.last_seen_at, d.revoked_at, d.revoked_by,
                    CASE WHEN d.device_type IN ('tablet', 'phone') THEN 'token' ELSE 'request' END AS pairing_source,
                    s.session_id, s.kind, s.staff_id
             FROM devices d
             LEFT JOIN staff_sessions s
               ON s.device_id = d.device_id AND s.ended_at IS NULL AND s.kind IN ('staff', 'station')
             WHERE (? = 1 OR d.revoked_at IS NULL)
             ORDER BY d.paired_at, d.device_id`,
          )
          .all(includeRevoked) as Array<{
          device_id: string;
          device_name: string;
          device_type: string;
          station_id: string | null;
          owner_staff_id: string | null;
          paired_at: number;
          paired_by: string;
          last_seen_at: number | null;
          revoked_at: number | null;
          revoked_by: string | null;
          pairing_source: 'token' | 'request';
          session_id: string | null;
          kind: string | null;
          staff_id: string | null;
        }>;
        // M87: the removal reason lives in the DeviceRevoked payload; one more read, only for revoked rows.
        const revokedIds = rows.filter((row) => row.revoked_at !== null).map((row) => row.device_id);
        const reasons = new Map<string, string | null>();
        if (revokedIds.length > 0) {
          const events = ctx.db
            .prepare(
              `SELECT stream_id, payload FROM events
               WHERE stream_type = 'hub' AND event_type = 'DeviceRevoked'
                 AND stream_id IN (${revokedIds.map(() => '?').join(', ')})
               ORDER BY seq`,
            )
            .all(...revokedIds) as Array<{ stream_id: string; payload: string }>;
          for (const event of events) reasons.set(event.stream_id, (JSON.parse(event.payload) as { reason: string | null }).reason);
        }
        const nameOf = (staffId: string | null) => (staffId === null ? null : (ctx.directory.get(staffId)?.display_name ?? null));
        return {
          data: {
            devices: rows.map((row) => ({
              device_id: row.device_id,
              device_name: row.device_name,
              device_type: row.device_type,
              station_id: row.station_id,
              owner_staff_id: row.owner_staff_id,
              owner_name: nameOf(row.owner_staff_id),
              pairing_source: row.pairing_source,
              paired_at: row.paired_at,
              paired_by_name: ctx.directory.get(row.paired_by)?.display_name ?? null,
              last_seen_at: activity.deviceSeenAt(row.device_id) ?? row.last_seen_at,
              revoked_at: row.revoked_at,
              revoked_by_name: nameOf(row.revoked_by),
              revoked_reason: reasons.get(row.device_id) ?? null,
              active_session:
                row.session_id === null
                  ? null
                  : {
                      session_id: row.session_id,
                      kind: row.kind,
                      staff_id: row.staff_id,
                      display_name: row.staff_id === null ? null : (ctx.directory.get(row.staff_id)?.display_name ?? null),
                    },
            })),
          },
        };
      },
    }),
  );
}
