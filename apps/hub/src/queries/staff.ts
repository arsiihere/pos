import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineQuery, queryRegistry } from './registry.js';

// §6.18c, M88: every staff member with role names and phones owned, for "Add a phone". 1 query.
export function registerStaffQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'staff',
      sessionKind: 'admin',
      session: 'none',
      countsAsActivity: false,
      querySchema: z.object({}),
      handle(ctx) {
        const counts = new Map(
          (
            ctx.db
              .prepare(
                `SELECT owner_staff_id, COUNT(*) AS phones FROM devices
                 WHERE device_type = 'phone' AND revoked_at IS NULL
                 GROUP BY owner_staff_id`,
              )
              .all() as Array<{ owner_staff_id: string; phones: number }>
          ).map((row) => [row.owner_staff_id, row.phones]),
        );
        const staff = ctx.directory
          .list()
          .sort((a, b) => a.display_name.localeCompare(b.display_name))
          .map((member) => ({
            staff_id: member.staff_id,
            display_name: member.display_name,
            role_names: ctx.directory.roleNames(member.staff_id),
            phone_count: counts.get(member.staff_id) ?? 0,
          }));
        return { data: { staff } };
      },
    }),
  );
}
