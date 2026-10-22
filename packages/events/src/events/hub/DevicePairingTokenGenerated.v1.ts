import { z } from 'zod';
import { defineEvent } from '../../registry.js';

export const DevicePairingTokenGeneratedPayload = z.object({
  pairing_token_id: z.string(),
  device_type: z.enum(['tablet', 'phone']),
  owner_staff_id: z.string().nullable(),
  expires_at: z.number().int(),
});

export const DevicePairingTokenGenerated = defineEvent({
  eventType: 'DevicePairingTokenGenerated',
  version: 1,
  payload: DevicePairingTokenGeneratedPayload,
});
