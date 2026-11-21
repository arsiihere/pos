import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { AlertRaisedPayloadV4 } from './AlertRaised.v4.js';

// ⚠️ Changed by 05 (row D-1; P0.G G-16; F D46), 01d v1.3.4 §3.3 rule 6: `request.right_mode` gains `holders`
// (the answerer holds `base_permission` `allowed` with a scope covering the requester). v4's shape never changes;
// the upcaster v4 -> v5 is the identity: a v4 payload's right_mode is `approval` or `named`, both still valid.
const RequestPartV4 = AlertRaisedPayloadV4.shape.request.unwrap();

export const AlertRaisedPayloadV5 = AlertRaisedPayloadV4.extend({
  request: RequestPartV4.extend({ right_mode: z.enum(['approval', 'named', 'holders']) }).nullable(),
});
export type AlertRaisedPayloadV5 = z.infer<typeof AlertRaisedPayloadV5>;

export const AlertRaisedV5 = defineEvent({
  eventType: 'AlertRaised',
  version: 5,
  payload: AlertRaisedPayloadV5,
  upcastFromPrevious: (prev) => prev as AlertRaisedPayloadV5,
});
