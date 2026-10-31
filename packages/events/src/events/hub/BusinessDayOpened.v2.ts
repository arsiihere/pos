import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { BusinessDayOpenedPayload } from './BusinessDayOpened.v1.js';

const UnitSchema = z.enum(['piece', 'g', 'ml']);

// 01c V20, §3.5.3, §6.20: recorded_at is the day's start; frozen for the day are every stock item's
// stock_unit and every tracked item's sale_unit and draws.
export const BusinessDayOpenedPayloadV2 = z.object({
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  stock_units: z.record(z.string(), UnitSchema),
  draws: z.record(
    z.string(),
    z.object({
      sale_unit: UnitSchema,
      stock_draws: z.array(
        z.object({
          stock_item_id: z.string(),
          quantity_per_sale_unit: z.number().int().min(1).max(1_000_000),
        }),
      ),
    }),
  ),
});
export type BusinessDayOpenedPayloadV2 = z.infer<typeof BusinessDayOpenedPayloadV2>;

// 01c §5.3 row 3: for each key k, stock_units[k] = stock_unit and one draw from stock item k (V5: same id).
export const BusinessDayOpenedV2 = defineEvent({
  eventType: 'BusinessDayOpened',
  version: 2,
  payload: BusinessDayOpenedPayloadV2,
  upcastFromPrevious: (prev) => {
    const p = prev as z.infer<typeof BusinessDayOpenedPayload>;
    const stockUnits: BusinessDayOpenedPayloadV2['stock_units'] = {};
    const draws: BusinessDayOpenedPayloadV2['draws'] = {};
    for (const [k, units] of Object.entries(p.units)) {
      stockUnits[k] = units.stock_unit;
      draws[k] = {
        sale_unit: units.sale_unit,
        stock_draws: [{ stock_item_id: k, quantity_per_sale_unit: units.stock_per_sale_unit }],
      };
    }
    return { business_date: p.business_date, stock_units: stockUnits, draws };
  },
});
