-- 00 v1.7 §5.1 (H-5, H-6), as specified there
ALTER TABLE devices ADD COLUMN point_id   TEXT;  -- H-5: the 01a point the tablet is bound to
ALTER TABLE devices ADD COLUMN lane_label TEXT;  -- H-6: 1–20 chars; a kds device with it is a lane
