import { z } from 'zod';
import { defineEvent } from '../../registry.js';

const UnitSchema = z.enum(['piece', 'g', 'ml']);

// 01a S33, S44: recorded_at is the day's start; units are frozen for every stock-tracked item.
export const BusinessDayOpenedPayload = z.object({
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  units: z.record(
    z.string(),
    z.object({
      stock_unit: UnitSchema,
      sale_unit: UnitSchema,
      stock_per_sale_unit: z.number().int().min(1).max(1_000_000),
    }),
  ),
});

export const BusinessDayOpened = defineEvent({
  eventType: 'BusinessDayOpened',
  version: 1,
  payload: BusinessDayOpenedPayload,
});
