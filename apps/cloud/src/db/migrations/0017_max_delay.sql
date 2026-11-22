-- 01a v2.7.5 §5.2a rows MD-1–MD-3 (STAB-7; 03a v1.2.10 §3.5.7 PR-1; re-review F-1): an item's max delay (null = the
-- branch default; max_delay_unlimited = "No limit") and the branch's default max delay (null = no limit by default),
-- both 60 000–1 800 000 ms (1–30 min). Existing items take null / false (the branch default), existing settings rows
-- 300 000 (5 min). The item columns are tenant-wide, so this bumps config_version for EVERY branch (MD-3; the hub
-- compares versions for equality, AD-9 as 0012 / 0016). No audit row: a migration is not an owner write. No hub
-- migration (the hub keeps the snapshot body as JSON).
ALTER TABLE menu_items
  ADD COLUMN max_delay_ms INTEGER NULL CHECK (max_delay_ms IS NULL OR max_delay_ms BETWEEN 60000 AND 1800000),
  ADD COLUMN max_delay_unlimited BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT menu_items_max_delay_unlimited CHECK (NOT max_delay_unlimited OR max_delay_ms IS NULL);

ALTER TABLE branch_engine_settings
  ADD COLUMN max_delay_default_ms INTEGER NULL DEFAULT 300000
    CHECK (max_delay_default_ms IS NULL OR max_delay_default_ms BETWEEN 60000 AND 1800000);

UPDATE branches SET config_version = config_version + 1;
