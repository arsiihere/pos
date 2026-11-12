import { z } from 'zod';
import { AlertDetailsBase } from '../../alerts.js';
import { defineEvent } from '../../registry.js';
import { AlertRaisedPayloadV3 } from './AlertRaised.v3.js';

// 01d v1.2.5 D-3 (04 §4.5, F D46): `details` over the widened AlertDetailsBase (+ disposition). The upcaster
// v3 -> v4 is the identity: a v3 payload has no disposition.
export const AlertRaisedPayloadV4 = AlertRaisedPayloadV3.extend({
  details: AlertDetailsBase.nullable(),
});
export type AlertRaisedPayloadV4 = z.infer<typeof AlertRaisedPayloadV4>;

export const AlertRaisedV4 = defineEvent({
  eventType: 'AlertRaised',
  version: 4,
  payload: AlertRaisedPayloadV4,
  upcastFromPrevious: (prev) => prev as AlertRaisedPayloadV4,
});
