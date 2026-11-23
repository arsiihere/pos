import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DomainError } from '@pos/domain';
import { deviceProfile } from '../auth/device-profile.js';
import { defineQuery, queryRegistry } from './registry.js';

export function registerSessionQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'session',
      sessionKind: 'device',
      session: 'required',
      allowStation: true,
      countsAsActivity: false,
      querySchema: z.object({}),
      handle(ctx) {
        const session = ctx.session;
        if (session === undefined) throw new DomainError('SESSION_INVALID');
        const staff = session.staff_id === null ? undefined : ctx.directory.get(session.staff_id);
        // 05a §6.7: the device's profile from memory (no statement). No profile (kds, or R-1) reads as `everyone`
        // with no screens, as the view masks it.
        const profile = session.device_id === null ? undefined : deviceProfile(session.device_id);
        return {
          data: {
            session_id: session.session_id,
            kind: session.kind,
            staff:
              staff === undefined
                ? null
                : { staff_id: staff.staff_id, display_name: staff.display_name, role_ids: staff.role_ids },
            station_id: session.station_id,
            idle_ttl_ms: session.idle_ttl_ms,
            device:
              session.device_id === null
                ? null
                : {
                    device_id: session.device_id,
                    screens: profile?.screens ?? [],
                    access: profile?.access ?? 'everyone',
                    point_id: profile?.point_id ?? null,
                  },
            // 05a §3.3a, §6.7: the session view's resolutions, with `masked` where the view changed a grant.
            permissions: session.kind === 'station' || session.staff_id === null ? {} : ctx.directory.permissionsOf(session.staff_id),
          },
        };
      },
    }),
  );
}
