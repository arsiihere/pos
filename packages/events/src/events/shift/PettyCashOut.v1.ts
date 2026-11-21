import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { pettyShape } from './petty.js';

// 05 §6.20, §6.29 (stream shift): kind 'out'. Reading: `advance_staff_id` is set on an advance only (§6.20 "advance
// needs advance_staff_id") and null on 'out' / 'in'.
export const PettyCashOutPayload = z
  .object(pettyShape)
  .strict()
  .refine((p) => p.advance_staff_id === null, { message: 'only an advance names advance_staff_id', path: ['advance_staff_id'] });
export type PettyCashOutPayload = z.infer<typeof PettyCashOutPayload>;

export const PettyCashOut = defineEvent({ eventType: 'PettyCashOut', version: 1, payload: PettyCashOutPayload });
