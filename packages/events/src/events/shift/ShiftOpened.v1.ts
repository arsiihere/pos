import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { BusinessDate, NonNegativeMinor } from '../bill/parts.js';

// 05 §6.15, §6.29 (stream shift, id shift_id), B11: `drawer_device_id` non-null = a drawer shift.
export const ShiftOpenedPayload = z
  .object({
    shift_id: z.string(),
    staff_id: z.string(),
    drawer_device_id: z.string().nullable(),
    float_minor: NonNegativeMinor,
    business_date: BusinessDate,
  })
  .strict();
export type ShiftOpenedPayload = z.infer<typeof ShiftOpenedPayload>;

export const ShiftOpened = defineEvent({ eventType: 'ShiftOpened', version: 1, payload: ShiftOpenedPayload });
