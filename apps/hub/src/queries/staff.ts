import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineQuery, queryRegistry } from './registry.js';

// §6.18c, M88: every staff member with role names and device count. 1 query. ⚠️ 05a (00 v1.12.3 row H-4):
// `device_count` = unrevoked `listed` devices whose list names the person (any hardware), from `device_people`
// joined to unrevoked `devices` (index `device_people_staff`); was `phone_count` over `owner_staff_id`.
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
                `SELECT dp.staff_id, COUNT(*) AS devices FROM device_people dp
                 JOIN devices d ON d.device_id = dp.device_id
                 WHERE d.revoked_at IS NULL
                 GROUP BY dp.staff_id`,
              )
              .all() as Array<{ staff_id: string; devices: number }>
          ).map((row) => [row.staff_id, row.devices]),
        );
        const staff = ctx.directory
          .list()
          .sort((a, b) => a.display_name.localeCompare(b.display_name))
          .map((member) => ({
            staff_id: member.staff_id,
            display_name: member.display_name,
            role_names: ctx.directory.roleNames(member.staff_id),
            device_count: counts.get(member.staff_id) ?? 0,
          }));
        return { data: { staff } };
      },
    }),
  );
}
