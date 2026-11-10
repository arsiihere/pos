import { z } from 'zod';
import { defineAlertKind } from '../alerts/kinds.js';

// 02a §6.14 kind `call_waiter`, verbatim. Defined at module top level (AD-5): server.ts imports tables/index.ts
// statically, which imports this file, so the kind exists before boot replays the `alerts` projection (01d P-8).

export const CallWaiterValues = z.object({
  table_id: z.string().min(1),
  seating_id: z.string().min(1),
  chip: z.enum(['water', 'clear', 'come', 'other']).optional(),
});
export type CallWaiterValues = z.infer<typeof CallWaiterValues>;

export const callWaiterKind = defineAlertKind({
  kind: 'call_waiter',
  family: 'action',
  subject: 'table',
  steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
  closes_on: { after_ms: 300_000 }, // not 'seen' (single-recipient rule, AD-107; G4-1 #7)
  values_schema: CallWaiterValues,
  details_schema: null,
  lead_fallback: true,
  expires_at_day_close: true,
  silent: false,
  skip_requester: true, // D-3: the caller's own tablet does not ring
  labels: { card: 'alert.call_waiter.card', lock: 'alert.call_waiter.lock' },
  request: null,
});
