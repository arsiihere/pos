import { z } from 'zod';
import { AlertDetailsBaseV2 } from '../../alerts.js';
import { defineEvent } from '../../registry.js';
import { AlertRaisedPayload as AlertRaisedPayloadV1 } from './AlertRaised.v1.js';

// 01d v1.1.2 D-2 (03a AD-36, F D46): `details` over the widened AlertDetailsBase (+ minutes_late, lines). The upcaster
// v1 → v2 is the identity: a v1 payload has neither new field.
// ⚠️ Changed by 03b v1.0.1 D-2 (01d v1.2.2): over the frozen AlertDetailsBaseV2, so v2's shape never changes.
export const AlertRaisedPayloadV2 = AlertRaisedPayloadV1.extend({
  details: AlertDetailsBaseV2.nullable(),
});
export type AlertRaisedPayloadV2 = z.infer<typeof AlertRaisedPayloadV2>;

export const AlertRaisedV2 = defineEvent({
  eventType: 'AlertRaised',
  version: 2,
  payload: AlertRaisedPayloadV2,
  upcastFromPrevious: (prev) => prev as AlertRaisedPayloadV2,
});
