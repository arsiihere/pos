import { PERMISSIONS } from '@pos/domain';
import { z } from 'zod';
import { AlertTargetSchema } from '../../alerts.js';
import { defineEvent } from '../../registry.js';
import { AlertRaisedPayloadV5 } from './AlertRaised.v5.js';

// ⚠️ Changed by run 3 reconcile (AlertRaised v6; 01d v1.3.7 §5.4, the single definition; R3-B-1, D5, F D46): the
// persisted permission fields (the permission target arm, `request.base_permission`, `request.range_permission`) take
// the live @pos/domain PERMISSIONS, widened by 01b v1.12 B-5 `hand-over-unpaid` (02b's `hand_over_unpaid` holders right
// stores it in `base_permission`). v1–v5 stay frozen (AlertRaised.v1.ts). A later widening of these enums is v7. The
// upcaster v5 → v6 is the identity: every v5 value is in the wider enum. The kind `hand_over_unpaid` is a string.
const Permission = z.enum(PERMISSIONS);
const RequestPartV5 = AlertRaisedPayloadV5.shape.request.unwrap();

export const AlertRaisedPayloadV6 = AlertRaisedPayloadV5.extend({
  target: AlertTargetSchema,
  request: RequestPartV5.extend({ base_permission: Permission.nullable(), range_permission: Permission.nullable() }).nullable(),
});
export type AlertRaisedPayloadV6 = z.infer<typeof AlertRaisedPayloadV6>;

export const AlertRaisedV6 = defineEvent({
  eventType: 'AlertRaised',
  version: 6,
  payload: AlertRaisedPayloadV6,
  upcastFromPrevious: (prev) => prev as AlertRaisedPayloadV6,
});
