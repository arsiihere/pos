import { AlertDetailsBase } from '@pos/events';
import { z } from 'zod';
import { defineAlertKind } from '../alerts/kinds.js';

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
});
export type ReadyToServeValues = z.infer<typeof ReadyToServeValues>;

// D-2: the order's identifier on the card.
export const ReadyToServeDetails = AlertDetailsBase.pick({ identifier: true });
export type ReadyToServeDetails = z.infer<typeof ReadyToServeDetails>;

export const READY_TO_SERVE = defineAlertKind<ReadyToServeValues, ReadyToServeDetails>({
  kind: READY_TO_SERVE_KIND,
  family: 'action',
  subject: 'order',
  steps: [
    { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] },
    { at: { value: 'window_ms', times: 1 }, to: [{ target: 'raised_target', set: 'recipient' }] },
    {
      at: { value: 'window_ms', times: 2 },
      escalation: true,
      to: [
        { target: { kind: 'point', from_value: 'point_id' }, set: 'recipient' },
        { target: { kind: 'managers' }, set: 'recipient' },
      ],
    },
  ],
  closes_on: 'owner',
  values_schema: ReadyToServeValues,
  details_schema: ReadyToServeDetails,
  lead_fallback: false,
  expires_at_day_close: true,
  silent: false,
  labels: { card: 'alert.ready_to_serve.card', lock: 'alert.ready_to_serve.lock' },
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
