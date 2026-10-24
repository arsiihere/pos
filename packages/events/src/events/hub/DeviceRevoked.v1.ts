import { z } from 'zod';
import { defineEvent } from '../../registry.js';

export const DeviceRevokedPayload = z.object({
  device_id: z.string(),
  reason: z.string().nullable(),
  cause: z.enum(['manual', 'owner_removed']),
});

export const DeviceRevoked = defineEvent({
  eventType: 'DeviceRevoked',
  version: 1,
  payload: DeviceRevokedPayload,
});
