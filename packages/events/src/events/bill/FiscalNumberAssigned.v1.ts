import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 05 §6.29 (stream bill), §3.15, J-6: written by the fiscal worker's answer transaction (ok, or duplicate with a
// number). `pos_id` and `qr_payload` nullable as on the port (R-9 / G-7; `FiscalAnswer.qr_payload: string | null`).
export const FiscalNumberAssignedPayload = z
  .object({
    invoice_id: z.string(),
    adapter_key: z.string().min(1),
    pos_id: z.string().nullable(),
    fiscal_number: z.string().min(1),
    qr_payload: z.string().nullable(),
  })
  .strict();
export type FiscalNumberAssignedPayload = z.infer<typeof FiscalNumberAssignedPayload>;

export const FiscalNumberAssigned = defineEvent({ eventType: 'FiscalNumberAssigned', version: 1, payload: FiscalNumberAssignedPayload });
