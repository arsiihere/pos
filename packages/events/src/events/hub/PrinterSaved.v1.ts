import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03c §6.11 (hub / branch_id): SavePrinter; name 1–40, lan | usb, paper 58 | 80 (§3.2). The address rules are the
// command's (§3.2); the event keeps what was stored.
const Id = z.string().min(1);

export const PrinterSavedPayload = z.object({
  printer_id: Id,
  name: z.string().min(1).max(40),
  connection: z.enum(['lan', 'usb']),
  address: z.string().min(1),
  paper_width_mm: z.union([z.literal(58), z.literal(80)]),
  archived: z.boolean(),
});
export type PrinterSavedPayload = z.infer<typeof PrinterSavedPayload>;

export const PrinterSaved = defineEvent({ eventType: 'PrinterSaved', version: 1, payload: PrinterSavedPayload });
