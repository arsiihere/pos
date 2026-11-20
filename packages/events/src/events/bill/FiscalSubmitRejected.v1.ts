import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 05 §6.29 (stream bill), §3.15, J-6: the authority refused the record; a short code only, no request body.
// `http_status` nullable as on the port (`FiscalAnswer` rejected: `http_status: number | null`).
export const FiscalSubmitRejectedPayload = z
  .object({
    invoice_id: z.string(),
    adapter_key: z.string().min(1),
    error_code: z.string().min(1).max(40),
    http_status: z.number().int().min(100).max(599).nullable(),
  })
  .strict();
export type FiscalSubmitRejectedPayload = z.infer<typeof FiscalSubmitRejectedPayload>;

export const FiscalSubmitRejected = defineEvent({ eventType: 'FiscalSubmitRejected', version: 1, payload: FiscalSubmitRejectedPayload });
