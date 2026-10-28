import type { DayUnits } from '@pos/engine';
import { isStockTracked } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { branchConfig } from '../sync/branch-config-holder.js';
import { defineCommand } from './registry.js';
import { requireBranchScope } from './set-precooked-stock.js';
import { commandRegistry } from './route.js';

const Payload = z.object({}).strict();

// §6.18a, S33: opens a day only when none is open; while one is open it is a no-op.
export function registerOpenBusinessDay(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'OpenBusinessDay',
      payloadSchema: Payload,
      sessionKind: 'admin',
      permission: 'manage-stock',
      handle(ctx) {
        requireBranchScope(ctx);
        const day = ctx.state.business_day;
        if (day !== null && day.closed_at === null) {
          return {
            events: [],
            result: { business_date: day.business_date, opened_at: day.opened_at, changed: false, reason: 'already_open' },
          };
        }
        const now = ctx.clock.branchNow();
        const businessDate = localDate(now);
        // S44: the units of every stock-tracked item are frozen for the day.
        const units: Record<string, DayUnits> = {};
        const config = branchConfig();
        for (const item of config?.items ?? []) {
          if (config === null || !isStockTracked(config, item)) continue;
          units[item.item_id] = {
            stock_unit: item.stock_unit,
            sale_unit: item.sale_unit,
            stock_per_sale_unit: item.stock_per_sale_unit,
          };
        }
        // Appended here so the result's opened_at is the event's recorded_at, the day's start.
        const [opened] = ctx.tx.append([
          {
            stream_type: 'hub',
            stream_id: ctx.branch.branchId,
            event_type: 'BusinessDayOpened',
            schema_version: 1,
            payload: { business_date: businessDate, units },
            occurred_at: now,
            actor_id: ctx.actor.staffId,
            device_id: ctx.actor.deviceId,
          },
        ]);
        return {
          events: [],
          result: { business_date: businessDate, opened_at: opened!.recorded_at, changed: true, reason: 'opened' },
        };
      },
    }),
  );
}

// S33: a label only, the hub's local date at the open.
function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
