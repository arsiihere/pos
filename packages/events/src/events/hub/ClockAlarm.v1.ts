import { z } from 'zod';
import { defineEvent } from '../../registry.js';

export const ClockAlarmPayload = z.object({
  wall_ms: z.number().int(),
  last_recorded_at: z.number().int(),
  delta_ms: z.number().int(),
  source: z.enum(['boot', 'cloud_offset']),
});

export const ClockAlarm = defineEvent({
  eventType: 'ClockAlarm',
  version: 1,
  payload: ClockAlarmPayload,
});
