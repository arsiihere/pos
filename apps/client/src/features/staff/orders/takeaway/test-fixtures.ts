import type { CatchUpOrder, LineView, OpenOrder } from '../contracts';

// 02b-TK C2 tests only: an open-orders row, a line and a catch-up order of a takeaway token (24 Nov 2026, UTC offset 0).

export const at = (h: number, m: number) => Date.UTC(2026, 10, 24, h, m);

export function aRow(over: Partial<OpenOrder> & { order_id: string }): OpenOrder {
  return {
    order_type: 'takeaway',
    table_key: `takeaway:${over.order_id}`,
    token: 50,
    car_number: null,
    car_type: null,
    has_phone: false,
    placed_at: at(13, 0),
    business_date: '2026-11-24',
    from_date: null,
    ready: { n: 0, m: 2 },
    promise_ms: at(13, 30),
    abandoned: false,
    ...over,
  };
}

export function aLine(order_id: string, order_item_id: string, name: string, o: Partial<LineView> = {}): LineView {
  return {
    order_item_id,
    order_id,
    parent_order_item_id: null,
    line_kind: 'item',
    item_id: 'I1',
    deal_id: null,
    name,
    sale_unit: 'piece',
    quantity: 1,
    units: 1,
    live_units: 1,
    comped_units: 0,
    removed_units: 0,
    voided_units: 0,
    returned_units: 0,
    refundable_minor: 0,
    comp_minor: 0,
    comp_voided_minor: 0,
    removed_minor: 0,
    refund_minor: 0,
    line_total_minor: 10_000,
    billed_minor: 10_000,
    return_of: null,
    served_from_zone_id: null,
    zone_served: false,
    added_at: at(13, 0),
    served_at: null,
    served_source: null,
    is_food: true,
    kitchen_note: null,
    ...o,
  };
}

export function aCaught(order_id: string, token: number, lines: LineView[], o: Partial<CatchUpOrder> = {}): CatchUpOrder {
  return {
    order_id,
    order_type: 'takeaway',
    table_key: `takeaway:${order_id}`,
    business_date: '2026-11-24',
    token,
    car_number: null,
    car_type: null,
    order_note: null,
    placed_by: 'sana',
    placed_at: at(13, 0),
    follow_up: false,
    cancelled: false,
    cancelled_at: null,
    billed: false,
    billed_at: null,
    day_closed_at: null,
    sent_after_reconnect: false,
    has_phone: false,
    lines,
    customer_name: null,
    phone: null,
    ...o,
  };
}
