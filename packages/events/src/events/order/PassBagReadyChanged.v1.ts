import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// ⚠️ 03b v1.0.16 §6.22 (run 3 R3-B-3, R3-M-9): written by the R8 writer reconciliation (§3.5) on an order's stream.
// `ready` starts an epoch with the committed counter alert's facts (bag_ready_since = the raise's recorded_at,
// bag_ready_window_ms = its values.window_ms, the alert and its escalation point); null clears the epoch.
export const PassBagReadyChangedPayload = z.strictObject({
  order_id: z.string(),
  ready: z
    .strictObject({
      bag_ready_since: z.number().int(),
      bag_ready_window_ms: z.number().int().min(0),
      alert_id: z.string().nullable(),
      point_id: z.string(),
    })
    .nullable(),
});
export type PassBagReadyChangedPayload = z.infer<typeof PassBagReadyChangedPayload>;

export const PassBagReadyChanged = defineEvent({ eventType: 'PassBagReadyChanged', version: 1, payload: PassBagReadyChangedPayload });
