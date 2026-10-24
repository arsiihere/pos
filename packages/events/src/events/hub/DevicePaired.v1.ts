import { z } from 'zod';
import { defineEvent } from '../../registry.js';

export const DevicePairedPayload = z
  .object({
    device_id: z.string(),
    device_name: z.string(),
    device_type: z.enum(['tablet', 'cashier_kiosk', 'kds', 'phone']),
    station_id: z.string().nullable(),
    owner_staff_id: z.string().nullable(),
    pairing_token_id: z.string().nullable(),
    pairing_request_id: z.string().nullable(),
  })
  .refine((payload) => (payload.pairing_token_id !== null) !== (payload.pairing_request_id !== null), {
    message: 'exactly one pairing source id',
  });

export const DevicePaired = defineEvent({
  eventType: 'DevicePaired',
  version: 1,
  payload: DevicePairedPayload,
});
