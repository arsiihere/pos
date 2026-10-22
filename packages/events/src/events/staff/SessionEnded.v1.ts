import { z } from 'zod';
import { defineEvent } from '../../registry.js';

export const SessionEndedPayload = z.object({
  session_id: z.string(),
  kind: z.enum(['staff', 'admin', 'station']),
  staff_id: z.string().nullable(),
  station_id: z.string().nullable(),
  reason: z.enum([
    'logout',
    'replaced',
    'taken_over',
    'idle_timeout',
    'forced',
    'device_revoked',
    'staff_removed',
    'credentials_changed',
    'hub_restored',
  ]),
  ended_by: z.string().nullable(),
});

export const SessionEnded = defineEvent({
  eventType: 'SessionEnded',
  version: 1,
  payload: SessionEndedPayload,
});
