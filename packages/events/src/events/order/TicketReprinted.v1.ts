import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03c §6.11 (order / order_id): ReprintTicket.
const Id = z.string().min(1);

export const TicketReprintedPayload = z.object({
  order_id: Id,
  station_id: Id.nullable(),
  ticket_ids: z.array(Id).min(1),
});
export type TicketReprintedPayload = z.infer<typeof TicketReprintedPayload>;

export const TicketReprinted = defineEvent({ eventType: 'TicketReprinted', version: 1, payload: TicketReprintedPayload });
