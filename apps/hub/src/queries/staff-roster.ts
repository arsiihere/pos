import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Clock } from '../lib/clock.js';
import { defineQuery, queryRegistry } from './registry.js';

export function registerStaffRosterQuery(app: FastifyInstance, clock: Clock): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'staff-roster',
      sessionKind: 'device',
      session: 'none',
      deviceTypes: ['tablet', 'cashier_kiosk', 'phone'],
      countsAsActivity: false,
      querySchema: z.object({}),
      handle(ctx) {
        const now = clock.branchNow();
        const locks = ctx.db
          .prepare(`SELECT subject_id, locked_until FROM auth_lockouts WHERE subject_type = 'staff' AND locked_until > ?`)
          .all(now) as Array<{ subject_id: string; locked_until: number }>;
        const lockedUntil = new Map(locks.map((row) => [row.subject_id, row.locked_until]));
        const active = ctx.db
          .prepare(
            `SELECT staff_id FROM staff_sessions
             WHERE device_id = ? AND ended_at IS NULL AND kind = 'staff'
             LIMIT 1`,
          )
          .get(ctx.device?.device_id ?? '') as { staff_id: string } | undefined;
        const owner = ctx.device?.device_type === 'phone' ? ctx.device.owner_staff_id : undefined;
        const staff = ctx.directory
          .list()
          .filter((row) => owner === undefined || row.staff_id === owner)
          .map((row) => ({
            staff_id: row.staff_id,
            display_name: row.display_name,
            locked_until: lockedUntil.get(row.staff_id) ?? null,
          }))
          .sort((a, b) => a.display_name.localeCompare(b.display_name) || a.staff_id.localeCompare(b.staff_id));
        const activeStaff = active === undefined ? undefined : ctx.directory.get(active.staff_id);
        return {
          data: {
            staff,
            active_session:
              active === undefined || activeStaff === undefined
                ? null
                : { staff_id: active.staff_id, display_name: activeStaff.display_name },
          },
        };
      },
    }),
  );
}
