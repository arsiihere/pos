// Shared void types, browser-safe [04 §4.4].

export const VOID_REASON_CODES = ['customer_changed_mind', 'wrong_order_taken', 'too_late', 'quality', 'other'] as const;
export type VoidReasonCode = (typeof VOID_REASON_CODES)[number];
export const VOID_DISPOSITIONS = ['moved', 'wastage', 'staff_meal', 'other'] as const;
export type VoidDisposition = (typeof VOID_DISPOSITIONS)[number];
export type VoidBlock = 'not_movable_stage' | 'stock_not_tracked' | 'day_closed' | 'move_not_granted'; // v0.7 (H6-1): no 'return_line'
