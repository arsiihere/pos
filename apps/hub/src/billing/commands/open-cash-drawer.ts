// 05 §6.21 `OpenCashDrawer` (task 23), §3.16 No-sale row, B11, B30, H3-5. A no-sale drawer open with a reason on
// the device of a drawer shift. Check order: Zod `.strict()` (§4.4: `note` ≤ 200, required for `other`) → grant
// `open-cash-drawer` (allowed-only, the pipeline, 403 before any read) → the device is the drawer of a shift in state
// `open` (`409 SHIFT_NOT_OPEN { reason: 'no_drawer_shift' }`) → `DrawerOpened` → drawer kick. No scope step: the
// permission takes `branch` only (01b §3.3) and a drawer names no table.
// Kick: the OpenShift path (task 15, R-57) — a standalone `{ drawer: true }` Doc on the device's **own** `bill_routes`
// device row with an active printer; no zone / floor / default fallback (§3.16 "the device's route"; a kiosk without
// one must not open another counter's drawer). None → no job, logged with ids, the no-sale is still recorded (R8).
// Owner ruling for task 23 (2026-11-20, 05 v1.0.18): no `bill_print_jobs` row for the no-sale kick — §3.16's "every
// job id" covers bill-document jobs only (unlike CloseSplit's receipt, whose kick is a block at the end of the receipt
// Doc on billPrinterFor's chain, with a 'receipt' row); statements ≤ 4; result `{ shift_id, printed }`.
// Statements (the append and its folds are 00's envelope): the read (1), the note into `bill_texts` (1, with a note),
// printDocument (2, with an own route) — ≤ 4, fixed whatever the number of shifts or payments.
// Notes stay out of `payload_hash` (`hashOmit: ['note']`, row H-4); text only in `bill_texts` under `note_id`.
// A retransmit with the same command_id replays the stored answer (00 §3.7).
import { DomainError } from '@pos/domain';
import { draftOf, DrawerOpened, DrawerOpenedPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { printDocument } from '../../print/api.js';

export const NO_SALE_REASONS = ['change_for_customer', 'check_cash', 'other'] as const;

export const OpenCashDrawerPayload = z
  .object({ reason_code: z.enum(NO_SALE_REASONS), note: z.string().max(200).optional() })
  .strict()
  .superRefine((p, rc) => {
    if (p.reason_code === 'other' && (p.note === undefined || p.note.trim() === '')) {
      rc.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: "note is required when reason_code is 'other'" });
    }
  });
export type OpenCashDrawerPayload = z.infer<typeof OpenCashDrawerPayload>;

export interface OpenCashDrawerResult {
  shift_id: string;
  /** true = a drawer kick job was queued (03c `print_jobs`); false = no own device route printer, no job (R8). */
  printed: boolean;
}

// 1 statement: the open shift holding this device as its drawer, and the device's own active route printer.
const READ = `
SELECT
  (SELECT shift_id FROM shifts WHERE drawer_device_id = @device_id AND state = 'open') AS shift_id,
  (SELECT r.printer_id FROM bill_routes r JOIN printers p ON p.printer_id = r.printer_id AND p.archived_at IS NULL
    WHERE r.scope = 'device' AND r.ref_id = @device_id) AS device_route_printer`;

type Log = Pick<FastifyInstance['log'], 'info'>;

/** One definition per server (as print-docs.ts): the skip line goes to that server's logger. */
function openCashDrawerCommand(log: Log) {
  return defineCommand({
    commandType: 'OpenCashDrawer',
    payloadSchema: OpenCashDrawerPayload,
    sessionKind: 'device',
    permission: 'open-cash-drawer',
    hashOmit: ['note'], // row H-4, H16-7: the note never reaches payload_hash
    handle(ctx, payload) {
      const device_id = ctx.actor.deviceId;
      const r = ctx.tx.db.prepare(READ).get({ device_id }) as { shift_id: string | null; device_route_printer: string | null }; // 1
      if (r.shift_id === null) throw new DomainError('SHIFT_NOT_OPEN', { reason: 'no_drawer_shift' });

      const text = payload.note === undefined || payload.note.trim() === '' ? null : payload.note;
      const note_id = text === null ? null : ctx.ids.next();
      if (note_id !== null) {
        ctx.tx.db.prepare(`INSERT INTO bill_texts (subject_id, field, text) VALUES (?, 'note', ?)`).run(note_id, text); // 2
      }
      const opened = DrawerOpenedPayload.parse({ shift_id: r.shift_id, device_id, reason_code: payload.reason_code, has_note: note_id !== null, note_id });
      ctx.tx.append([
        draftOf(DrawerOpened, { stream_type: 'shift', stream_id: r.shift_id, payload: opened, occurred_at: ctx.clock.branchNow(), actor_id: ctx.actor.staffId, device_id }),
      ]);

      // printed = a kick job was queued in this transaction (not that the drawer has opened: the worker sends it later)
      let printed = false;
      if (r.device_route_printer !== null) {
        printDocument(ctx.tx, r.device_route_printer, { blocks: [{ drawer: true }] }); // +2
        printed = true;
      } else {
        log.info({ shift_id: r.shift_id, device_id }, 'no-sale drawer kick skipped: no own device route printer');
      }

      const result: OpenCashDrawerResult = { shift_id: r.shift_id, printed };
      return { events: [], result };
    },
  });
}

export function registerOpenCashDrawer(app: FastifyInstance): void {
  commandRegistry(app).register(openCashDrawerCommand(app.log));
}
