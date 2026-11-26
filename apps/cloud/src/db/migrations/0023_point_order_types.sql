-- 01a v2.11 §5.2a PT-1, PT-5 (03b v1.0.16 PT-1 routePoint): the order types a Pass point receives. NULL = 'all' (every
-- order type, today's behaviour); existing rows stay NULL. The shape and CHECK of A-9 station_alternates.order_types.
-- No config_version bump and no audit row: every existing point is delivered as 'all', which equals the hub's reading
-- of the absent snapshot key, so no hub behaves differently until an owner write (which bumps). Next contiguous cloud
-- number on module-02b-tk (D6).
ALTER TABLE points ADD COLUMN order_types TEXT[] NULL
  CHECK (order_types IS NULL OR (cardinality(order_types) > 0 AND order_types <@ ARRAY['dine_in','takeaway','delivery','parking']));
