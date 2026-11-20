import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { pettyShape } from './petty.js';

// 05 §6.20, §6.29 (stream shift): kind 'in'. Reading: `advance_staff_id` is set on an advance only (§6.20 "advance
// needs advance_staff_id") and null on 'out' / 'in'.
export const PettyCashInPayload = z
  .object(pettyShape)
  .strict()
  .refine((p) => p.advance_staff_id === null, { message: 'only an advance names advance_staff_id', path: ['advance_staff_id'] });
export type PettyCashInPayload = z.infer<typeof PettyCashInPayload>;

export const PettyCashIn = defineEvent({ eventType: 'PettyCashIn', version: 1, payload: PettyCashInPayload });
