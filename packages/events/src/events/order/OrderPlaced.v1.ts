import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2 (v0.2, pre-G2 #6): the engine fields of one line. `station_id` is the engine's starting
// station (D8); ItemAdded.station_id stays the home route (D25).
export const OrderLinePayload = z.object({
  order_item_id: z.string(),
  station_id: z.string(),
  alternates: z.array(z.object({ station_id: z.string(), carry_ms: z.number().int(), home: z.boolean() })),
  point_id: z.string().nullable(),
  carry_ms: z.number().int(),
  from_stock: z.boolean(),
  weight_pct: z.number().int(),
  max_early_ms: z.number().int(),
  max_late_ms: z.number().int().nullable(),
  max_carry_ms: z.number().int().nullable(),
});
export type OrderLinePayload = z.infer<typeof OrderLinePayload>;

export const OrderGroupPayload = z.object({
  group_id: z.string(),
  target_land_ms: z.number().int(),
  promise_ms: z.number().int(),
  order_item_ids: z.array(z.string()),
});
export type OrderGroupPayload = z.infer<typeof OrderGroupPayload>;

// 03a §3.3 deterministic ids: a group id is `order_id + ':' + index`.
export function isGroupIdOf(orderId: string, groupId: string): boolean {
  const prefix = `${orderId}:`;
  return groupId.startsWith(prefix) && /^(0|[1-9]\d*)$/.test(groupId.slice(prefix.length));
}

export function checkGroupIds(p: { order_id: string; groups: OrderGroupPayload[] }, ctx: z.RefinementCtx): void {
  p.groups.forEach((g, i) => {
    if (!isGroupIdOf(p.order_id, g.group_id)) {
      ctx.addIssue({ code: 'custom', path: ['groups', i, 'group_id'], message: 'group_id must be order_id:<n>' });
    }
  });
}

export const OrderPlacedPayload = z
  .object({
    order_id: z.string(),
    order_type: z.enum(['dine_in', 'takeaway', 'delivery', 'parking']),
    table_id: z.string().nullable(),
    table_key: z.string(),
    follow_up: z.boolean(),
    pickup_at_ms: z.number().int().nullable(),
    order_item_ids: z.array(z.string()),
    groups: z.array(OrderGroupPayload),
    lines: z.array(OrderLinePayload),
    // 02b E-1, 03a v1.2 §4.2: additive and optional at v1 (the engine ignores them). No contact fields (02b O17).
    business_date: z.string().optional(),
    token: z.number().int().min(1).optional(),
    car_number: z.string().optional(),
    car_type: z.enum(['sedan', 'mini', 'large']).optional(),
    order_note: z.string().optional(),
    sent_after_reconnect: z.boolean().optional(),
    has_phone: z.boolean().optional(),
    has_food: z.boolean().optional(),
  })
  .superRefine(checkGroupIds);
export type OrderPlacedPayload = z.infer<typeof OrderPlacedPayload>;

// placed_by = envelope actor_id, placed_at = recorded_at (§3.3, v0.5 G4-1 #22): no payload field.
export const OrderPlaced = defineEvent({ eventType: 'OrderPlaced', version: 1, payload: OrderPlacedPayload });
