import { z } from 'zod';
import { defineEvent } from '../../registry.js';

export const SessionStartedPayload = z.object({
  session_id: z.string(),
  kind: z.enum(['staff', 'admin', 'station']),
  staff_id: z.string().nullable(),
  station_id: z.string().nullable(),
  device_id: z.string().nullable(),
  idle_ttl_ms: z.number().int().nullable(),
});

export const SessionStarted = defineEvent({
  eventType: 'SessionStarted',
  version: 1,
  payload: SessionStartedPayload,
});
