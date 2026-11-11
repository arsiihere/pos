import { z } from 'zod';
import { AlertDetailsBase } from '../../alerts.js';
import { defineEvent } from '../../registry.js';
import { AlertRaisedPayloadV2 } from './AlertRaised.v2.js';

// 01d v1.2.2 D-2 (03b v1.0.1 §4.5, F D46): `details` over the widened AlertDetailsBase (+ identifier, station_name,
// printer_name, problem). The upcaster v2 → v3 is the identity: a v2 payload has none of the new fields.
export const AlertRaisedPayloadV3 = AlertRaisedPayloadV2.extend({
  details: AlertDetailsBase.nullable(),
});
export type AlertRaisedPayloadV3 = z.infer<typeof AlertRaisedPayloadV3>;

export const AlertRaisedV3 = defineEvent({
  eventType: 'AlertRaised',
  version: 3,
  payload: AlertRaisedPayloadV3,
  upcastFromPrevious: (prev) => prev as AlertRaisedPayloadV3,
});
