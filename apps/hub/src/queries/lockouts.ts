import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineQuery, queryRegistry } from './registry.js';

// §6.18a, M88: lockouts in force, so a manager can see what ClearPinLockout would clear. 1 query.
export function registerLockoutsQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'lockouts',
      sessionKind: 'admin',
      session: 'none',
      countsAsActivity: false,
      querySchema: z.object({}),
      handle(ctx) {
        const rows = ctx.db
          .prepare(
            `SELECT l.subject_type, l.subject_id, l.locked_until, d.device_name
             FROM auth_lockouts l
             LEFT JOIN devices d ON l.subject_type = 'device' AND d.device_id = l.subject_id
             WHERE l.locked_until > ?
             ORDER BY l.locked_until DESC, l.subject_id`,
          )
          .all(ctx.now) as Array<{ subject_type: 'staff' | 'device' | 'ip'; subject_id: string; locked_until: number; device_name: string | null }>;
        const staff = [];
        const devices = [];
        const ips = [];
        for (const row of rows) {
          if (row.subject_type === 'staff') {
            const member = ctx.directory.get(row.subject_id);
            if (member !== undefined) staff.push({ staff_id: row.subject_id, display_name: member.display_name, locked_until: row.locked_until });
          } else if (row.subject_type === 'device') {
            devices.push({ device_id: row.subject_id, device_name: row.device_name, locked_until: row.locked_until });
          } else {
            ips.push({ ip: row.subject_id, locked_until: row.locked_until });
          }
        }
        return { data: { staff, devices, ips } };
      },
    }),
  );
}
