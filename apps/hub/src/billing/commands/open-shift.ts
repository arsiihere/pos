// 05 §6.15 `OpenShift` (task 15), B11, B23, §3.11. One person holds at most one open shift; a drawer device is held
// by at most one open shift. Check order: grant `manage-own-shift` (the pipeline, 403 before any read) → Zod →
// business day open (`409 BUSINESS_DAY_NOT_OPEN`, 01a's code) → the caller's open shift (`409 SHIFT_ALREADY_OPEN`) →
// `as_drawer`: the device can hold a drawer (`422 DRAWER_DEVICE_INVALID`), no open shift holds it
// (`409 DRAWER_IN_USE`) → `ShiftOpened` → drawer kick when `float_minor > 0`.
// Races: the writer runs every command in one `BEGIN IMMEDIATE` transaction, so the read below sees every shift
// committed before it; `shifts_open_staff` / `shifts_open_drawer` (0023) refuse a second open row if a check were ever
// skipped. A retransmit with the same command_id replays the stored answer (00 §3.7).
// Statements: the read (1, the device's own route printer included), and for a kick printDocument (2) — 3 (1 without a kick), fixed whatever the number of
// shifts or payments (ShiftOpened's append and fold are 00's). Never an expected-cash figure in the result (B23).
import { DomainError } from '@pos/domain';
import { draftOf, ShiftOpened, ShiftOpenedPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { printDocument } from '../../print/api.js';

/** §6.15 (H16-13): the float, 0 … 10¹² minor units. */
export const MAX_FLOAT_MINOR = 1_000_000_000_000;

export const OpenShiftPayload = z
  .object({
    float_minor: z.number().int().min(0).max(MAX_FLOAT_MINOR),
    as_drawer: z.boolean(),
  })
  .strict();
export type OpenShiftPayload = z.infer<typeof OpenShiftPayload>;

export interface OpenShiftResult {
  shift_id: string;
  opened_at: number;
}

interface OpenShiftRead {
  own_shift_id: string | null;
  device_type: string | null;
  device_route_printer: string | null;
  drawer_shift_id: string | null;
  drawer_staff_id: string | null;
}

// 1 statement: the caller's open shift, the device's type and active device-route printer, the open shift holding
// the device as its drawer.
const READ = `
SELECT
  (SELECT shift_id FROM shifts WHERE staff_id = @staff_id AND state = 'open') AS own_shift_id,
  (SELECT device_type FROM devices WHERE device_id = @device_id) AS device_type,
  (SELECT r.printer_id FROM bill_routes r JOIN printers p ON p.printer_id = r.printer_id AND p.archived_at IS NULL
    WHERE r.scope = 'device' AND r.ref_id = @device_id) AS device_route_printer,
  (SELECT shift_id FROM shifts WHERE drawer_device_id = @device_id AND state = 'open') AS drawer_shift_id,
  (SELECT staff_id FROM shifts WHERE drawer_device_id = @device_id AND state = 'open') AS drawer_staff_id`;

export const openShiftCommand = defineCommand({
  commandType: 'OpenShift',
  payloadSchema: OpenShiftPayload,
  sessionKind: 'device',
  permission: 'manage-own-shift',
  handle(ctx, payload) {
    const staff_id = ctx.actor.staffId;
    if (staff_id === null) throw new DomainError('PERMISSION_DENIED', { permission: 'manage-own-shift', grant: 'not_granted' });
    const day = ctx.state.business_day;
    if (day === null || day.closed_at !== null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');

    const device_id = ctx.actor.deviceId;
    const r = ctx.tx.db.prepare(READ).get({ staff_id, device_id }) as OpenShiftRead; // 1
    if (r.own_shift_id !== null) throw new DomainError('SHIFT_ALREADY_OPEN', { shift_id: r.own_shift_id });
    if (payload.as_drawer) {
      // §6.15: a cashier kiosk, or a tablet with a printer route of its own (an active printer)
      const canHold = r.device_type === 'cashier_kiosk' || (r.device_type === 'tablet' && r.device_route_printer !== null);
      if (!canHold) throw new DomainError('DRAWER_DEVICE_INVALID', { device_id });
      if (r.drawer_shift_id !== null) {
        const holder = r.drawer_staff_id === null ? undefined : ctx.directory.get(r.drawer_staff_id);
        throw new DomainError('DRAWER_IN_USE', { shift_id: r.drawer_shift_id, staff_name: holder?.display_name ?? null });
      }
    }

    const shift_id = ctx.ids.next();
    const opened = ShiftOpenedPayload.parse({
      shift_id,
      staff_id,
      drawer_device_id: payload.as_drawer ? device_id : null,
      float_minor: payload.float_minor,
      business_date: day.business_date,
    });
    // appended here so the result's opened_at is the event's recorded_at, the shifts row's opened_at
    const [event] = ctx.tx.append([
      draftOf(ShiftOpened, { stream_type: 'shift', stream_id: shift_id, payload: opened, occurred_at: ctx.clock.branchNow(), actor_id: staff_id, device_id }),
    ]);

    // §6.15, R-57: the drawer kick only on the device's own bill route (its active printer, read above) — no zone,
    // floor or default fallback; no own route → no kick and the shift still opens (R8: print never blocks the
    // caller). A shift that is not a drawer has no drawer to open.
    if (payload.as_drawer && payload.float_minor > 0 && r.device_route_printer !== null) {
      printDocument(ctx.tx, r.device_route_printer, { blocks: [{ drawer: true }] }); // 2
    }

    const result: OpenShiftResult = { shift_id, opened_at: event!.recorded_at };
    return { events: [], result };
  },
});

export function registerOpenShift(app: FastifyInstance): void {
  commandRegistry(app).register(openShiftCommand);
}
