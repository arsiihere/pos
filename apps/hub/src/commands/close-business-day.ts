import { DEFAULT_DAY_MIN_GAP_HOURS } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { branchConfig } from '../sync/branch-config-holder.js';
import { defineCommand } from './registry.js';
import { requireBranchScope } from './set-precooked-stock.js';
import { commandRegistry } from './route.js';

const Payload = z.object({}).strict();

// §6.18b, S33: closes the open day unless it was opened less than day_min_gap_hours ago.
export function registerCloseBusinessDay(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'CloseBusinessDay',
      payloadSchema: Payload,
      sessionKind: 'admin',
      permission: 'manage-stock',
      handle(ctx) {
        requireBranchScope(ctx);
        const day = ctx.state.business_day;
        if (day === null || day.closed_at !== null) {
          return {
            events: [],
            result: {
              business_date: day?.business_date ?? null,
              opened_at: day?.opened_at ?? null,
              closed_at: day?.closed_at ?? null,
              changed: false,
              reason: 'not_open',
            },
          };
        }
        const now = ctx.clock.branchNow();
        const gapHours = branchConfig()?.day_min_gap_hours ?? DEFAULT_DAY_MIN_GAP_HOURS;
        // A negative age (hub clock moved back) also counts as recent.
        if (now - day.opened_at < gapHours * 3_600_000) {
          return {
            events: [],
            result: { business_date: day.business_date, opened_at: day.opened_at, closed_at: null, changed: false, reason: 'opened_recently' },
          };
        }
        // Appended here so the result's closed_at is the event's recorded_at, the day's end.
        const [closed] = ctx.tx.append([
          {
            stream_type: 'hub',
            stream_id: ctx.branch.branchId,
            event_type: 'BusinessDayClosed',
            schema_version: 1,
            payload: {},
            occurred_at: now,
            actor_id: ctx.actor.staffId,
            device_id: ctx.actor.deviceId,
          },
        ]);
        return {
          events: [],
          result: {
            business_date: day.business_date,
            opened_at: day.opened_at,
            closed_at: closed!.recorded_at,
            changed: true,
            reason: 'closed',
          },
        };
      },
    }),
  );
}
