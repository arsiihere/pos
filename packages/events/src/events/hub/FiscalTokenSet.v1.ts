import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 05 §6.28a, §6.29 (stream hub, id branch_id), OQ-3, H10-5: no token, no length, no hash. `name` = the credential's
// name (an adapter `credentialNames` entry, e.g. 'token'), never a person's.
export const FiscalTokenSetPayload = z
  .object({
    pos_id: z.string().min(1).max(40),
    name: z.string().min(1).max(40),
    set_at: z.number().int(),
    set_by_staff_id: z.string(),
  })
  .strict();
export type FiscalTokenSetPayload = z.infer<typeof FiscalTokenSetPayload>;

export const FiscalTokenSet = defineEvent({ eventType: 'FiscalTokenSet', version: 1, payload: FiscalTokenSetPayload });
