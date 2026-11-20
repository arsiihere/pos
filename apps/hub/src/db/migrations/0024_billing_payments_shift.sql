-- 05 v1.0.11 §5 (owner ruling R-56): hub migration 0024_billing_payments_shift. Takings by shift (shift view, CountShift, X / Z).
-- Not partial: the class check reads removed rows too. 0023_billing.sql is merged and is never edited.
CREATE INDEX bill_payments_shift ON bill_payments (shift_id, mode_id, taken_by_staff_id);
