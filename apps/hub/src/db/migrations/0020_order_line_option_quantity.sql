-- 02b v1.0.13 §5 (owner 2026-11-12 21:03 PKT, 04 Q-19 (b); 01c §3.4.8 Q4): order_lines.option_quantity = the line's
-- ItemAdded.option_quantity (NULL on every non-option_child line and on an option child added later), read by the §3.4
-- cascade (cascadeUnits) through readOrder and the CompLine / applyComp line read.
ALTER TABLE order_lines ADD COLUMN option_quantity INTEGER;
-- Refold, no data UPDATE (as 0019): with the orders checkpoint gone, the next boot's catchUp resets `orders` and replays
-- the log from seq 0, filling option_quantity for every existing line. Safe by 00 v1.10 H-2 (applyAll only updates
-- existing checkpoint rows, so a boot-time ClockAlarm does not recreate it). Other checkpoints stay.
DELETE FROM projection_checkpoints WHERE projection = 'orders';
