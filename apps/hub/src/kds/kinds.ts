import { AlertDetailsBase } from '@pos/events';
import { z } from 'zod';
import { defineAlertKind, type StepTo } from '../alerts/kinds.js';
import type { StaffDirectory } from '../auth/staff-directory.js';
import { counterScreenOfOrder, placerOfOrder } from './order-screens.js';

// 03b v1.0.1 §6.21: the kinds 03b registers, at the top level of this module (kds/index.ts imports it statically, so
// the kinds exist before boot replays the `alerts` projection, 01d P-8). Manager steps are written
// `{ target: { kind: 'managers' }, set }` (G-14, owner 2026-11-11: the bare string is not an AlertStepTarget).

export const READY_TO_SERVE_KIND = 'ready_to_serve';
export const SERVED_CARD_KIND = 'served_card';
export const KDS_OFFLINE_KIND = 'kds_offline';

export const ReadyToServeValues = z.object({
  order_id: z.string().min(1),
  point_id: z.string().min(1),
  table_id: z.string(),
  window_ms: z.number(),
  // ⚠️ 03b v1.0.16 §6.21 (R8; run 3 verify V-03): the order-level counter alert's gate (01d v1.3.7 D-7); a per-point
  // Ready omits it, so its COUNTER entries reach nobody
  counter_screen: z.enum(['takeaway', 'parking']).optional(),
});
export type ReadyToServeValues = z.infer<typeof ReadyToServeValues>;

// D-2: the order's identifier on the card. ⚠️ 03b v1.0.10 §3.5 step 5 (STAB-2): + lines, what is ready.
export const ReadyToServeDetails = AlertDetailsBase.pick({ identifier: true, lines: true });
export type ReadyToServeDetails = z.infer<typeof ReadyToServeDetails>;

/** ⚠️ 03b v1.0.16 §6.21 (02b-tk R8): the counter devices of the alert's `counter_screen` (01d v1.3.7 D-7). */
const COUNTER: StepTo = { target: { kind: 'screen_devices', screen_from_value: 'counter_screen' }, set: 'recipient' };

/**
 * ⚠️ 03b v1.0.16 §3.5 step 4, §6.21 (run 3 verify R3-B-3): for a takeaway / parking order, a device showing the order's
 * counter screen gets Ready only from the order-level alert (`counter_screen` set); a per-point Ready never reaches it,
 * on any step or route (the placer signed in there included). Dine-in and delivery keep their delivery. Memory.
 */
export function readyExcludesDevice(values: ReadyToServeValues): boolean {
  // ⚠️ 03b v1.0.20 §6.21 (owner 2026-11-28 QA-R2, BUG-4): a pickup order's per-point Ready reaches no device at all
  // (was: only the devices showing the order's counter screen)
  return values.counter_screen === undefined && counterScreenOfOrder(values.order_id) !== null;
}

/**
 * ⚠️ 03b v1.0.20 §3.5, §6.21 (owner 2026-11-28 QA-R2, BUG-4, BUG-14; 01d v1.3.9 excludesStaff): a pickup order's
 * per-point Ready reaches nobody; the order-level counter alert reaches only people who take orders (the placer, or
 * `take-order` allowed) and managers (branch-scope `force-release-table-lock`) — never a Cook. Dine-in unchanged. Memory.
 */
export function readyExcludesStaff(values: ReadyToServeValues, staff_id: string, directory: StaffDirectory): boolean {
  if (values.counter_screen === undefined) return counterScreenOfOrder(values.order_id) !== null;
  if (placerOfOrder(values.order_id) === staff_id) return false;
  if (directory.resolve(staff_id, 'take-order').grant === 'allowed') return false;
  const m = directory.resolve(staff_id, 'force-release-table-lock');
  return !(m.grant === 'allowed' && m.scope === 'branch');
}

export const READY_TO_SERVE = defineAlertKind<ReadyToServeValues, ReadyToServeDetails>({
  kind: READY_TO_SERVE_KIND,
  family: 'action',
  subject: 'order',
  // ⚠️ 03b v1.0.16 §6.21 (R8; run 1 m-4, OQ-13): + the counter at 0, 1× and 2×
  steps: [
    { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }, COUNTER] },
    { at: { value: 'window_ms', times: 1 }, to: [{ target: 'raised_target', set: 'recipient' }, COUNTER] },
    {
      at: { value: 'window_ms', times: 2 },
      escalation: true,
      to: [
        { target: { kind: 'point', from_value: 'point_id' }, set: 'recipient' },
        { target: { kind: 'managers' }, set: 'recipient' },
        COUNTER,
      ],
    },
  ],
  // ⚠️ 03b v1.0.16 §6.21 (run 1 B-1): a signed-in counter socket gets the card (01d v1.3.7 counter row)
  counter_card: true,
  excludesDevice: readyExcludesDevice,
  excludesStaff: readyExcludesStaff,
  closes_on: 'owner',
  values_schema: ReadyToServeValues,
  details_schema: ReadyToServeDetails,
  lead_fallback: false,
  expires_at_day_close: true,
  silent: false,
  labels: { card: 'alert.ready_to_serve.card', lock: 'alert.ready_to_serve.lock' },
  // ⚠️ Changed by 01d v1.3 (L-4d), 03b v1.0.9 §6.21: the deep-link target, the ready order; the same on a ready_retarget re-raise (§3.13.1 row 10)
  link: (v) => ({ type: 'order', order_id: v.order_id }),
  request: null,
});

export const ServedCardValues = z.object({ handover_id: z.string().min(1), order_id: z.string().min(1) });
export type ServedCardValues = z.infer<typeof ServedCardValues>;
export const ServedCardDetails = AlertDetailsBase.pick({ identifier: true });
export type ServedCardDetails = z.infer<typeof ServedCardDetails>;

export const SERVED_CARD = defineAlertKind<ServedCardValues, ServedCardDetails>({
  kind: SERVED_CARD_KIND,
  family: 'info',
  subject: 'order',
  steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
  closes_on: 'owner',
  values_schema: ServedCardValues,
  details_schema: ServedCardDetails,
  lead_fallback: false,
  expires_at_day_close: true,
  silent: false,
  labels: { card: 'alert.served_card.card', lock: 'alert.served_card.lock' },
  // ⚠️ Changed by 01d v1.3 (L-4d), 03b v1.0.9 §6.21: the deep-link target, the served order (§3.13.1 row 11)
  link: (v) => ({ type: 'order', order_id: v.order_id }),
  request: null,
});

// Subject { stream_type: 'hub', stream_id: branch_id } (01d A3); dedupe_key 'kds_offline:' + station_id. Closed 'done'
// by kds_presence after 60 s back (§3.6).
export const KdsOfflineValues = z.object({ station_id: z.string().min(1) });
export type KdsOfflineValues = z.infer<typeof KdsOfflineValues>;
export const KdsOfflineDetails = AlertDetailsBase.pick({ station_name: true });
export type KdsOfflineDetails = z.infer<typeof KdsOfflineDetails>;

export const KDS_OFFLINE = defineAlertKind<KdsOfflineValues, KdsOfflineDetails>({
  kind: KDS_OFFLINE_KIND,
  family: 'action',
  subject: 'hub',
  steps: [{ at: { ms: 0 }, to: [{ target: { kind: 'managers' }, set: 'recipient' }] }],
  closes_on: 'owner',
  values_schema: KdsOfflineValues,
  details_schema: KdsOfflineDetails,
  lead_fallback: true,
  expires_at_day_close: true,
  silent: false,
  labels: { card: 'alert.kds_offline.card', lock: 'alert.kds_offline.lock' },
  request: null,
});
