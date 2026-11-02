import { DomainError } from '@pos/domain';
import { openDayStartMs } from '@pos/engine';
import { SetPresencePayload, type EventDraft, type PresenceSetPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import type { CommandCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { sessionStaff } from './request-row.js';

// 01d §6.6 `SetPresence`, §3.11: a manager (`manage-staff`, the normal permission check; not handler-checked)
// ticks who is present today. `present: false` marks the listed people absent (BF-8: absent = a
// `presence_today` row with present = 0); `present: true` clears that. Processing, in the spec's order: a
// business day open (engine state, in memory) → else 409 BUSINESS_DAY_NOT_OPEN; ids in neither `staff` nor
// `no_pin_staff` (directory, in memory) → 404 STAFF_NOT_FOUND { staff_ids } (every unknown id); append
// `PresenceSet` on staff / branch_id. `business_day_id` is the open day's BusinessDayOpened event id, read in
// the command's one statement (index events_stream). The routing reads the new row at the next raise or tick;
// in the same transaction BF-6 drops the cached fixed reads (targets.ts STALE_ON).

type Payload = SetPresencePayload;

const OPEN_DAY_ID = `SELECT event_id FROM events
  WHERE stream_type = 'hub' AND stream_id = ? AND event_type = 'BusinessDayOpened'
  ORDER BY seq DESC LIMIT 1`;

function openBusinessDayId(ctx: CommandCtx): string {
  if (openDayStartMs(ctx.state) === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  const id = ctx.tx.db.prepare(OPEN_DAY_ID).pluck().get(ctx.branch.branchId) as string | undefined;
  if (id === undefined) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  return id;
}

function handle(ctx: CommandCtx, payload: Payload): { events: EventDraft[]; result: { business_day_id: string; staff_ids: string[]; present: boolean } } {
  const staffId = sessionStaff(ctx.actor);
  const businessDayId = openBusinessDayId(ctx);
  const unknown = payload.staff_ids.filter((id) => ctx.directory.get(id) === undefined && !ctx.directory.isNoPin(id));
  if (unknown.length > 0) throw new DomainError('STAFF_NOT_FOUND', { staff_ids: unknown });
  const p: PresenceSetPayload = { business_day_id: businessDayId, staff_ids: payload.staff_ids, present: payload.present, set_by: staffId };
  const event: EventDraft = {
    stream_type: 'staff',
    stream_id: ctx.branch.branchId,
    event_type: 'PresenceSet',
    schema_version: 1,
    payload: p,
    occurred_at: ctx.clock.branchNow(),
    actor_id: staffId,
    device_id: ctx.actor.deviceId,
  };
  return { events: [event], result: { business_day_id: businessDayId, staff_ids: payload.staff_ids, present: payload.present } };
}

export function registerSetPresence(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'SetPresence',
      payloadSchema: SetPresencePayload,
      sessionKind: 'device',
      permission: 'manage-staff',
      handle: (ctx, payload) => handle(ctx, payload),
    }),
  );
}
