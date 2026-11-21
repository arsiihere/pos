import { DomainError } from '@pos/domain';
import { BillRouteSet, draftOf } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { branchConfig } from '../../sync/branch-config-holder.js';

// 03c v1.0.13 §3.2, §6.13 (05 row P-1, R-22): SetBillRoute (admin, manage-devices, §3.10). Writes BillRouteSet on
// hub / branch_id; one route per (scope, ref_id): a save replaces it, `printer_id: null` removes it.
// Statements ≤ 2: the device read (scope `device` only; zones and floors come from the config in memory) and the
// printer read (a save only).

const Payload = z
  .object({
    scope: z.enum(['zone', 'floor', 'device', 'report', 'default']),
    ref_id: z.string().max(64),
    printer_id: z.string().min(1).nullable(),
  })
  .superRefine((p, rc) => {
    const branchLevel = p.scope === 'report' || p.scope === 'default';
    if (branchLevel !== (p.ref_id === '')) {
      rc.addIssue({ code: 'custom', path: ['ref_id'], message: branchLevel ? "ref_id is '' for report and default" : `ref_id is the ${p.scope} id` });
    }
  });

function referenceExists(ctx: { tx: { db: import('better-sqlite3').Database } }, scope: 'zone' | 'floor' | 'device', ref_id: string): boolean {
  if (scope === 'device') return ctx.tx.db.prepare('SELECT 1 FROM devices WHERE device_id = ?').pluck().get(ref_id) !== undefined;
  const floors = branchConfig()?.floors ?? [];
  // an archived zone still exists: its route can be removed
  return scope === 'floor' ? floors.some((f) => f.floor_id === ref_id) : floors.some((f) => f.zones.some((z) => z.zone_id === ref_id));
}

export const setBillRouteCommand = defineCommand({
  commandType: 'SetBillRoute',
  payloadSchema: Payload,
  sessionKind: 'admin',
  permission: 'manage-devices',
  handle(ctx, payload) {
    if (payload.scope !== 'report' && payload.scope !== 'default' && !referenceExists(ctx, payload.scope, payload.ref_id)) {
      throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'ref_id', reason: 'not_found' });
    }
    if (payload.printer_id !== null) {
      const active = ctx.tx.db.prepare('SELECT 1 FROM printers WHERE printer_id = ? AND archived_at IS NULL').pluck().get(payload.printer_id);
      if (active === undefined) throw new DomainError('PRINTER_NOT_FOUND', { printer_id: payload.printer_id });
    }
    const route = { scope: payload.scope, ref_id: payload.ref_id, printer_id: payload.printer_id };
    const event = draftOf(BillRouteSet, {
      stream_type: 'hub',
      stream_id: ctx.branch.branchId,
      payload: route,
      occurred_at: ctx.clock.branchNow(),
      actor_id: ctx.actor.staffId,
      device_id: ctx.actor.deviceId,
    });
    return { events: [event], result: { bill_route: route } };
  },
});

export function registerSetBillRoute(app: FastifyInstance): void {
  commandRegistry(app).register(setBillRouteCommand);
}
