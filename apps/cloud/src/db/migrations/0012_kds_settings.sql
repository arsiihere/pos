-- 03b §4.5 A-1 (01a v2.4): the Pass Ready window and the KDS offline threshold, and the range of served_estimate_ms
-- (null = off). Existing rows get served_estimate_ms = 180 000 so the pilot runs with the estimate on; a row written
-- later takes the column default (null). The owner settings PATCH writes the three (03b B-2, 01b v1.8).
ALTER TABLE branch_engine_settings
  ADD COLUMN ready_window_ms INT NOT NULL DEFAULT 60000
    CHECK (ready_window_ms BETWEEN 15000 AND 300000),
  ADD COLUMN kds_offline_ms INT NOT NULL DEFAULT 30000
    CHECK (kds_offline_ms BETWEEN 10000 AND 300000),
  ADD CONSTRAINT branch_engine_settings_served_estimate_ms_check
    CHECK (served_estimate_ms IS NULL OR served_estimate_ms BETWEEN 60000 AND 1800000);

UPDATE branch_engine_settings SET served_estimate_ms = 180000;
