import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 01a S33: recorded_at is the day's end; 05 adds the Z report fields.
export const BusinessDayClosedPayload = z.object({});

export const BusinessDayClosed = defineEvent({
  eventType: 'BusinessDayClosed',
  version: 1,
  payload: BusinessDayClosedPayload,
});
