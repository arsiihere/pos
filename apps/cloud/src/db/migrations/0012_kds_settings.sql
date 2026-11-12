-- 03b §4.5 A-1 (01a v2.4): the Pass Ready window and the KDS offline threshold, and the range of served_estimate_ms
-- (null = off). Existing rows get served_estimate_ms = 180 000 so the pilot runs with the estimate on; a row written
-- later takes the column default (null). The owner settings PATCH writes the three (03b B-2, 01b v1.8).
-- Unlike 0007 / 0009, this migration bumps config_version for every branch that has a settings row (owner
-- 2026-11-11, AD-9): the hub compares versions with !== (config-sync service.ts), so without the bump a hub
-- on the old version would never receive the three new keys. Still no audit row: a migration is not an owner write.
ALTER TABLE branch_engine_settings
  ADD COLUMN ready_window_ms INT NOT NULL DEFAULT 60000
    CHECK (ready_window_ms BETWEEN 15000 AND 300000),
  ADD COLUMN kds_offline_ms INT NOT NULL DEFAULT 30000
    CHECK (kds_offline_ms BETWEEN 10000 AND 300000),
  ADD CONSTRAINT branch_engine_settings_served_estimate_ms_check
    CHECK (served_estimate_ms IS NULL OR served_estimate_ms BETWEEN 60000 AND 1800000);

UPDATE branch_engine_settings SET served_estimate_ms = 180000;

UPDATE branches b SET config_version = b.config_version + 1
  FROM branch_engine_settings s
 WHERE s.tenant_id = b.tenant_id AND s.branch_id = b.branch_id;
