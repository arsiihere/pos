import { z } from 'zod';
import { defineEvent } from '../../registry.js';

export const DeviceTokenRotatedPayload = z.object({
  device_id: z.string(),
  pair_request_id: z.string(),
});

export const DeviceTokenRotated = defineEvent({
  eventType: 'DeviceTokenRotated',
  version: 1,
  payload: DeviceTokenRotatedPayload,
});
