export const PAYMENT_CLASSES = ['cash', 'digital'] as const;
export const PAYMENT_MODE_KINDS = ['cash', 'card', 'wallet', 'online', 'other'] as const;
export const SPLIT_MODES = ['items', 'amount', 'equal'] as const;
export const MIXED_CLASS_RULES = ['higher_rate'] as const;
export const ROUNDING_METHODS = ['nearest', 'down', 'up'] as const;
export const ROUNDING_APPLIES_TO = ['all', 'cash'] as const;
export const CREDIT_SUPPORT = ['credit_invoice', 'none'] as const;
export const FISCAL_ORDERING = ['strict_per_pos_id', 'none'] as const;
export const INVOICE_SERIES = ['sale', 'credit'] as const;
export const FISCAL_ROW_STATES = ['pending', 'acked', 'rejected', 'not_required'] as const;
export const DISCOUNT_KINDS = ['amount', 'percent'] as const;
export const PETTY_KINDS = ['advance', 'out', 'in'] as const;
export const BILL_REOPEN_REASONS = [
  'wrong_item_billed',
  'wrong_payment_mode',
  'customer_returned_item',
  'price_error',
  'other',
] as const;
export const CHARGE_REMOVE_REASONS = [
  'customer_request',
  'service_complaint',
  'staff_meal',
  'other',
] as const;
export const COMP_REMOVE_REASONS = ['comped_by_mistake', 'wrong_line', 'other'] as const;
export const CARRY_OVER_REASONS = [
  'table_still_seated',
  'customer_will_pay_later',
  'other',
] as const;
