import { DomainError } from '@pos/domain';
import { StationOutputSet, draftOf } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { branchConfig } from '../../sync/branch-config-holder.js';

// 03c §3.2, §6.3 (task c5): SetStationOutput (admin, manage-devices, §3.10). Writes StationOutputSet on hub / branch_id.
// Statements 1: the printer read (the station comes from the branch config in memory).

const Payload = z.object({
  station_id: z.string().min(1),
  mode: z.enum(['screen', 'both', 'printer']),
  /** used by `both`, `printer`, and by `screen` as its paper-fallback printer (§3.2) */
  printer_id: z.string().min(1).nullable(),
  show_taker: z.boolean().default(true),
  show_order_id: z.boolean().default(true),
});

export const setStationOutputCommand = defineCommand({
  commandType: 'SetStationOutput',
  payloadSchema: Payload,
  sessionKind: 'admin',
  permission: 'manage-devices',
  handle(ctx, payload) {
    if (payload.mode !== 'screen' && payload.printer_id === null) {
      throw new DomainError('VALIDATION_FAILED', {
        field: 'printer_id',
        issues: [{ path: 'printer_id', message: `mode ${payload.mode} needs a printer` }],
      });
    }
    const station = branchConfig()?.stations.find((s) => s.station_id === payload.station_id);
    if (station === undefined || station.is_archived) throw new DomainError('STATION_NOT_FOUND', { station_id: payload.station_id });
    if (payload.printer_id !== null) {
      const active = ctx.tx.db
        .prepare('SELECT 1 FROM printers WHERE printer_id = ? AND archived_at IS NULL')
        .pluck()
        .get(payload.printer_id);
      if (active === undefined) throw new DomainError('PRINTER_NOT_FOUND', { printer_id: payload.printer_id });
    }
    const output = {
      station_id: payload.station_id,
      mode: payload.mode,
      printer_id: payload.printer_id,
      show_taker: payload.show_taker,
      show_order_id: payload.show_order_id,
    };
    const event = draftOf(StationOutputSet, {
      stream_type: 'hub',
      stream_id: ctx.branch.branchId,
      payload: output,
      occurred_at: ctx.clock.branchNow(),
      actor_id: ctx.actor.staffId,
      device_id: ctx.actor.deviceId,
    });
    return { events: [event], result: { station_output: output } };
  },
});

export function registerSetStationOutput(app: FastifyInstance): void {
  commandRegistry(app).register(setStationOutputCommand);
}
