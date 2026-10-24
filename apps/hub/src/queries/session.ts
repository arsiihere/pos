import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DomainError } from '@pos/domain';
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
            permissions: session.kind === 'station' || session.staff_id === null ? {} : ctx.directory.permissionsOf(session.staff_id),
          },
        };
      },
    }),
  );
}
