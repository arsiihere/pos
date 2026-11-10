import { AlertDetailsBase } from '@pos/events';
import { z } from 'zod';
import { defineAlertKind } from '../alerts/kinds.js';
import { applyHandover, HANDOVER_KIND, type HandoverValues } from './handover.js';

// 02a v1.1.3 §6.15, §11 step 12 (AD-5): the kinds 02a registers, at the top level of this module. tables/index.ts
// imports it statically (server.ts → tables/index.ts), so the kind exists before boot replays the `alerts`
// projection (01d §3.5 / P-8); otherwise a replayed open handover would take the unknown-kind path.
// Lane D adds `call_waiter` here (§6.14).

export const HandoverValuesSchema = z.object({
  table_id: z.string().min(1),
  seating_id: z.string().min(1),
  from_staff_id: z.string().min(1),
});

/** §6.15: order count, running total (G4-1 #16); both omitted (`{}`) with no live order, `amount` until 02b (AD-3). */
export const HandoverDetails = AlertDetailsBase.pick({ quantity: true, amount: true });
export type HandoverDetails = z.infer<typeof HandoverDetails>;

/** §6.15 `table_handover`. */
export const TABLE_HANDOVER = defineAlertKind<HandoverValues, HandoverDetails>({
  kind: HANDOVER_KIND,
  family: 'action',
  subject: 'table',
  steps: [
    { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'answerer' }] },
    { at: { ms: 60_000 }, to: [{ target: 'raised_target', set: 'answerer' }] }, // remind (A14)
    { at: { ms: 120_000 }, to: [{ target: { kind: 'requester_lead' }, set: 'informed' }] }, // sender's lead (G0-1)
  ],
  closes_on: 'owner', // 02a closes it 'obsolete' (§3.9); requests never expire
  values_schema: HandoverValuesSchema,
  details_schema: HandoverDetails,
  lead_fallback: false,
  expires_at_day_close: true, // required field; no effect on a request kind (01d:148)
  silent: false,
  labels: { card: 'alert.table_handover.card', lock: 'alert.table_handover.lock' },
  request: {
    answers: ['accept', 'decline'],
    right: { mode: 'named' },
    needs_pin: 'never',
    apply: applyHandover, // §3.8: accept → TableHolderChanged, or throw TABLE_HANDOVER_STALE; decline → []
    onWithdraw: () => [],
  },
});
