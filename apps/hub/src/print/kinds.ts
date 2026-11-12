import { AlertDetailsBase } from '@pos/events';
import { z } from 'zod';
import { defineAlertKind } from '../alerts/kinds.js';

// 03c v1.0.1 §6.10: registered at the top level of this module (print/index.ts imports it statically, before boot
// step 4). Subject { stream_type: 'hub', stream_id: branch_id }; dedupe_key 'printer_problem:' + printer_id.
// Manager step written `{ target: { kind: 'managers' }, set }` (G-14).

export const PRINTER_PROBLEM_KIND = 'printer_problem';

export const PrinterProblemValues = z.object({ printer_id: z.string().min(1), waiting: z.number().int().min(0) });
export type PrinterProblemValues = z.infer<typeof PrinterProblemValues>;
// 03b D-2
export const PrinterProblemDetails = AlertDetailsBase.pick({ printer_name: true, problem: true });
export type PrinterProblemDetails = z.infer<typeof PrinterProblemDetails>;

export const PRINTER_PROBLEM = defineAlertKind<PrinterProblemValues, PrinterProblemDetails>({
  kind: PRINTER_PROBLEM_KIND,
  family: 'action',
  subject: 'hub',
  steps: [{ at: { ms: 0 }, to: [{ target: { kind: 'managers' }, set: 'recipient' }] }],
  closes_on: 'owner',
  values_schema: PrinterProblemValues,
  details_schema: PrinterProblemDetails,
  lead_fallback: true,
  expires_at_day_close: true,
  silent: false,
  labels: { card: 'alert.printer_problem.card', lock: 'alert.printer_problem.lock' },
  request: null,
});
