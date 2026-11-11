import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 01c v1.1.1 §4.3 exactly (03a owns this file, C-1). station_id is the home route (D25).
export const ItemAddedPayload = z.object({
  order_id: z.string(),
  order_item_id: z.string(),
  parent_order_item_id: z.string().nullable(),
  line_kind: z.enum(['item', 'option_child', 'deal', 'deal_part']),
  item_id: z.string().nullable(),
  deal_id: z.string().nullable(),
  deal_part_id: z.string().nullable(),
  option_id: z.string().nullable(),
  option_quantity: z.number().int().nullable(),
  variant_group_id: z.string().nullable(),
  variant_group_name: z.string().nullable(),
  variant_name: z.string().nullable(),
  name: z.string(),
  category_id: z.string(),
  requires_weighing: z.boolean(),
  quantity: z.number().int().nullable(),
  sale_unit: z.enum(['piece', 'g', 'ml']),
  price_minor: z.number().int(),
  extra_price_minor: z.number().int().nullable(),
  allocated_price_minor: z.number().int().nullable(),
  tax_class_id: z.string().nullable(),
  station_id: z.string().nullable(),
  program_id: z.string().nullable(),
  stock_program_id: z.string().nullable(),
  program_cook_time_ms: z.number().int().nullable(),
  stock_program_cook_time_ms: z.number().int().nullable(),
  serve_mode: z.enum(['immediate', 'sync']).nullable(),
  prep_buffer_ms: z.number().int().nullable(),
  cook_time_ms: z.number().int().nullable(),
  stock_time_ms: z.number().int().nullable(),
  out_of_stock_behaviour: z.enum(['cook_fresh', 'sold_out']).nullable(),
  stock_draws: z.array(z.object({ stock_item_id: z.string(), quantity: z.number().int() })),
  options: z.array(
    z.object({
      option_id: z.string(),
      modifier_group_id: z.string(),
      name: z.string(),
      price_minor: z.number().int(),
      quantity: z.number().int(),
      charge_minor: z.number().int(),
    }),
  ),
  line_total_minor: z.number().int().nullable(),
  kitchen_note: z.string().max(80).nullable(),
  // 01c v1.1.2 C-1, 03a v1.2 §4.2: additive at v1, no upcaster; an event logged without them parses as null / false.
  served_from_zone_id: z.string().nullable().default(null),
  is_ready_item: z.boolean().default(false),
  // 02b AD-15, owner 2026-11-11; 03a §4.2 / 02b §6.19 text bump pending. On a return line's ItemAdded (02b §3.8
  // ReturnToKitchen, fix and remake): the order_item_id of the line it returns; absent on every other line.
  return_of: z.string().optional(),
});
export type ItemAddedPayload = z.infer<typeof ItemAddedPayload>;

export const ItemAdded = defineEvent({ eventType: 'ItemAdded', version: 1, payload: ItemAddedPayload });
