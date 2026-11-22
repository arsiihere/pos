-- 01a v2.7.3 §5.2a rows PT-1, PT-2 (STAB-5; 05 v1.0.33 §3.16; owner 2026-11-22, proposal §6 Q2): the branch setting
-- show_part_times_to_customers — when on, the takeaway receipt prints a split line's per-part ready times. Default
-- true for every row. As 0012 (AD-9), this bumps config_version for every branch with a settings row, so a hub on the
-- old version receives the new key. No audit row: a migration is not an owner write.
ALTER TABLE branch_engine_settings
  ADD COLUMN show_part_times_to_customers BOOLEAN NOT NULL DEFAULT true;

UPDATE branches b SET config_version = b.config_version + 1
  FROM branch_engine_settings s
 WHERE s.tenant_id = b.tenant_id AND s.branch_id = b.branch_id;
