-- 02b v1.0.16 §5 (05 rows Q-1, Q-5, Q-6; ⚠️ Changed by 05 (R-7, R-17), owner rulings 2026-11-19): the one 02b migration of 05.
-- Q-1: order_lines.tax_profile_id = the line's ItemAdded.tax_class_id (NULL = untaxed item; a deal_part carries the deal's).
-- R-7 / R-17: order_lines.unit_price_minor = round_half_up(line_total_minor ÷ units), folded where line_total_minor is
-- (ItemAdded, LineWeightSet); NULL while a weight is pending; 0 on a deal_part.
ALTER TABLE order_lines ADD COLUMN tax_profile_id TEXT;
ALTER TABLE order_lines ADD COLUMN unit_price_minor INTEGER;
-- Q-6 (§3.1): takeaway / parking bill key, folded from OrderPlaced; 05 bill lookup index.
ALTER TABLE orders ADD COLUMN bill_key TEXT;
-- Q-5 (§3.3): OrdersCarriedOver sets 1; applyDayClosed skips and clears it.
ALTER TABLE orders ADD COLUMN carried_over INTEGER NOT NULL DEFAULT 0 CHECK (carried_over IN (0,1));
CREATE INDEX orders_bill_key ON orders (bill_key);
-- Q-6 (§3.11): an addition keeps its root order's token, so the token index is no longer unique (token MAX).
DROP INDEX orders_token;
CREATE INDEX orders_token_day ON orders (business_date, token) WHERE token IS NOT NULL;
-- Refold, no data UPDATE (the 0019 / 0020 pattern): with the orders checkpoint gone, the next boot's catchUp resets
-- `orders` and replays the log from seq 0, filling tax_profile_id and unit_price_minor for every existing line.
-- Safe by 00 v1.10 H-2 (applyAll only updates existing checkpoint rows). Other checkpoints stay.
DELETE FROM projection_checkpoints WHERE projection = 'orders';
