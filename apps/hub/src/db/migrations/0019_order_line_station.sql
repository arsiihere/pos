-- 02b v1.0.12 §5 (04 §4.5 Q-14, owner 2026-11-12 20:21): order_lines.station_id = the line's ItemAdded.station_id
-- (NULL for a deal header), read by 04 §3.1 (engine line = station_id IS NOT NULL and not a deal) through readOrder.
ALTER TABLE order_lines ADD COLUMN station_id TEXT;
-- Refold, no data UPDATE: with the orders checkpoint gone, the next boot's catchUp resets `orders` and replays the log
-- from seq 0, filling station_id for every existing line. Safe by 00 v1.10 H-2 (applyAll only updates existing
-- checkpoint rows, so a boot-time ClockAlarm does not recreate it). Other checkpoints (03c kitchen_tickets) stay.
DELETE FROM projection_checkpoints WHERE projection = 'orders';
