-- 01a v2.2 §5.2 (02a v1.0 A-1) and v2.3 §5.2 (02b v1.0 A-1): zones inside a floor, per-zone item routes and zone
-- stock items, menu_items.is_ready_item, and the new branch_engine_settings columns. One transaction (applied by the
-- migrator). Forward only. Tenant-scoped keys as in 0002: the spec's composite FKs are (tenant_id, branch_id, …).
-- No audit rows, no config_version bump: a migration is not an owner write.

CREATE TABLE zones (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, zone_id TEXT NOT NULL,
  floor_id TEXT NOT NULL, name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  sort_order INT NOT NULL DEFAULT 0, archived_at BIGINT,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, zone_id),
  FOREIGN KEY (tenant_id, branch_id, floor_id) REFERENCES floors);
CREATE UNIQUE INDEX zones_active_name ON zones (tenant_id, branch_id, floor_id, lower(name))
  WHERE archived_at IS NULL;                                                 -- CONFIG_NAME_TAKEN (per floor)
CREATE INDEX zones_floor ON zones (tenant_id, branch_id, floor_id)
  WHERE archived_at IS NULL;                                                 -- floor archive check, list

ALTER TABLE dining_tables ADD COLUMN zone_id TEXT;                           -- NULL = the floor's implicit zone
ALTER TABLE dining_tables ADD FOREIGN KEY (tenant_id, branch_id, zone_id) REFERENCES zones;
CREATE INDEX dining_tables_zone ON dining_tables (tenant_id, branch_id, zone_id)
  WHERE archived_at IS NULL AND zone_id IS NOT NULL;                         -- zone archive (nulls its tables)

-- 02b A-1: replaced as whole lists by the zone routes (§6.6a, §6.6b).
CREATE TABLE zone_item_routes (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, zone_id TEXT NOT NULL,
  item_id TEXT NOT NULL, station_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, zone_id, item_id),
  FOREIGN KEY (tenant_id, branch_id, zone_id) REFERENCES zones,
  FOREIGN KEY (tenant_id, item_id) REFERENCES menu_items);
CREATE TABLE zone_stock_items (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, zone_id TEXT NOT NULL,
  item_id TEXT NOT NULL, threshold INT NOT NULL DEFAULT 0 CHECK (threshold BETWEEN 0 AND 5000),
  PRIMARY KEY (tenant_id, branch_id, zone_id, item_id),
  FOREIGN KEY (tenant_id, branch_id, zone_id) REFERENCES zones,
  FOREIGN KEY (tenant_id, item_id) REFERENCES menu_items);

-- 02b A-1 (owner Q5): a ready item (bottled water, a soft drink) is not cooked and never turns a table green.
ALTER TABLE menu_items ADD COLUMN is_ready_item BOOLEAN NOT NULL DEFAULT false;

-- 02b A-1 (§5.2a A-12): four branch settings and the comp reason chips. Existing rows take the defaults, which are the
-- only copy of the values. The writes come with the settings PATCH; the snapshot delivers them (V4).
-- comp_reason_chips: 1–10 labels of 1–30 characters. A CHECK cannot hold a subquery, so the per-label rule is a
-- function (as config_audit_immutable is for the audit trigger); a NULL label is not a label.
CREATE FUNCTION comp_reason_chips_valid(chips TEXT[]) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS
  $$ SELECT cardinality(chips) BETWEEN 1 AND 10
            AND NOT EXISTS (SELECT 1 FROM unnest(chips) AS c WHERE c IS NULL OR char_length(c) NOT BETWEEN 1 AND 30) $$;
ALTER TABLE branch_engine_settings
  ADD COLUMN queue_auto_send_max_ms INT NOT NULL DEFAULT 14400000
    CHECK (queue_auto_send_max_ms BETWEEN 3600000 AND 86400000),             -- the cap of 00 v1.8 M95
  ADD COLUMN zone_undo_ms INT NOT NULL DEFAULT 300000
    CHECK (zone_undo_ms BETWEEN 0 AND 1800000),
  ADD COLUMN slow_item_threshold_ms INT NOT NULL DEFAULT 900000
    CHECK (slow_item_threshold_ms BETWEEN 60000 AND 7200000),                -- E2-SOLD AC2, the "25 min" tile clock
  ADD COLUMN served_estimate_ms INT,                                         -- null until 03b; the spec gives no range
  ADD COLUMN comp_reason_chips TEXT[] NOT NULL DEFAULT ARRAY['Late','Wrong item','Quality','Guest','Other']
    CHECK (comp_reason_chips_valid(comp_reason_chips));

-- §6.6a, §6.6b: the zone routes write `zone` audit rows (common write script, S26). Actions unchanged.
ALTER TABLE config_audit DROP CONSTRAINT config_audit_entity_check;
ALTER TABLE config_audit ADD CONSTRAINT config_audit_entity_check CHECK (entity IN (
  'floor','table','station','batch_program','tax_class','category','menu_item','item_route','branch_settings',
  'staff','role','responsibility','branch','owner_user',
  'variant_group','stock_item','stock_item_branch','modifier_group','deal','deal_branch',
  'point','zone'));
