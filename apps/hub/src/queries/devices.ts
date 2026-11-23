import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DomainError } from '@pos/domain';
import { currentDirectory } from '../auth/guards.js';
import { listedAdminDeviceCount } from '../auth/device-profile.js';
import { activity } from '../auth/session-store.js';
import { defineQuery, queryRegistry } from './registry.js';

const Query = z.object({
  include_revoked: z.enum(['true', 'false']).optional(),
});

export function registerDevicesQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'devices',
      // 05a §6.8, H-6: both routes; `manage-devices` through the session view (an `everyone` device is masked).
      sessionKind: 'both',
      session: 'required',
      countsAsActivity: false,
      querySchema: Query,
      handle(ctx, query) {
        const staffId = ctx.session?.staff_id ?? null;
        const resolution = staffId === null ? { grant: 'not_granted' as const } : ctx.directory.resolve(staffId, 'manage-devices');
        if (resolution.grant !== 'allowed') throw new DomainError('PERMISSION_DENIED', { permission: 'manage-devices', grant: resolution.grant });
        const includeRevoked = query.include_revoked === 'true' ? 1 : 0;
        const rows = ctx.db
          .prepare(
            `SELECT d.device_id, d.device_name, d.device_type, d.station_id, d.point_id, d.owner_staff_id,
                    d.paired_at, d.paired_by, d.last_seen_at, d.revoked_at, d.revoked_by,
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
          point_id: string | null;
          owner_staff_id: string | null;
          paired_at: number;
          paired_by: string;
          last_seen_at: number | null;
          revoked_at: number | null;
          revoked_by: string | null;
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
        // §6.8 +1: `device_profiles` ⋈ `device_people`; +1: pending requests (never the display code).
        const profileRows = ctx.db
          .prepare(
            `SELECT p.device_id, p.access, p.screens, p.profile_version, p.needs_review, dp.staff_id
             FROM device_profiles p LEFT JOIN device_people dp ON dp.device_id = p.device_id
             ORDER BY p.device_id, dp.staff_id`,
          )
          .all() as Array<{ device_id: string; access: 'everyone' | 'listed'; screens: string; profile_version: number; needs_review: number; staff_id: string | null }>;
        const profiles = new Map<string, { access: string; screens: unknown; profile_version: number; needs_review: boolean; people: Array<{ staff_id: string; display_name: string }> }>();
        for (const r of profileRows) {
          let entry = profiles.get(r.device_id);
          if (entry === undefined) {
            entry = { access: r.access, screens: JSON.parse(r.screens), profile_version: r.profile_version, needs_review: r.needs_review === 1, people: [] };
            profiles.set(r.device_id, entry);
          }
          if (r.staff_id !== null) entry.people.push({ staff_id: r.staff_id, display_name: ctx.directory.get(r.staff_id)?.display_name ?? r.staff_id });
        }
        const pending = ctx.db
          .prepare(
            `SELECT request_id, device_name, hardware_hint, created_at FROM pair_requests
             WHERE approved_at IS NULL AND expires_at > ? ORDER BY created_at, request_id`,
          )
          .all(ctx.now) as Array<{ request_id: string; device_name: string; hardware_hint: string | null; created_at: number }>;
        const listedAdmins = listedAdminDeviceCount(currentDirectory(app));
        const staff = ctx.directory
          .list()
          .map((p) => ({ staff_id: p.staff_id, display_name: p.display_name }))
          .sort((a, b) => a.display_name.localeCompare(b.display_name) || a.staff_id.localeCompare(b.staff_id));
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
              point_id: row.point_id,
              access: profiles.get(row.device_id)?.access ?? null,
              people: profiles.get(row.device_id)?.people ?? [],
              screens: profiles.get(row.device_id)?.screens ?? [],
              profile_version: profiles.get(row.device_id)?.profile_version ?? null,
              needs_review: profiles.get(row.device_id)?.needs_review ?? false,
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
            pending_requests: pending,
            admin_warning: listedAdmins === 0 || listedAdmins === 1 ? listedAdmins : null,
            staff,
          },
        };
      },
    }),
  );
}
