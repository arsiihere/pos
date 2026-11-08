-- 01a v2.1 §5.2a (03a v1.0 §4.5 A-1–A-13): timing-engine configuration. One transaction (applied by the migrator).
-- Tenant-scoped keys as in 0002: the spec's short keys ("PK point_id", "PK branch_id") are (tenant_id, …) keys here,
-- and branch_id in every composite FK is what makes "same branch" (A-9, A-10, A-2) hold.
-- "Both slot" (A-9) reads another row, so the service checks it (as the slot / batch rules of §5.2).
-- New tables carry `version` (§5.2a, R30). No audit rows, no config_version bump: a migration is not an owner write.

CREATE TABLE points (                                                        -- A-1
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, point_id TEXT NOT NULL,  -- point_id: ULID
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  sort_order INT NOT NULL DEFAULT 0,
  archived_at BIGINT, version BIGINT NOT NULL DEFAULT 1, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, point_id),                              -- snapshot, stations GET: one branch's points
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches);
CREATE UNIQUE INDEX points_branch_name_active ON points (tenant_id, branch_id, name) WHERE archived_at IS NULL;

-- A-1: one "Pass" per branch. A DO loop because each id needs its own random part. ULID: 48-bit ms, 80 random bits.
DO $$
DECLARE
  alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';           -- Crockford base32
  now_ms CONSTANT BIGINT := (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT;
  b RECORD;
  id TEXT;
BEGIN
  FOR b IN SELECT tenant_id, branch_id FROM branches LOOP
    id := '';
    FOR i IN 0..9 LOOP
      id := id || substr(alphabet, ((now_ms >> (45 - 5 * i)) & 31)::INT + 1, 1);
    END LOOP;
    FOR i IN 1..16 LOOP
      id := id || substr(alphabet, floor(random() * 32)::INT + 1, 1);
    END LOOP;
    INSERT INTO points (tenant_id, branch_id, point_id, name, created_at, updated_at)
    VALUES (b.tenant_id, b.branch_id, id, 'Pass', now_ms, now_ms);
  END LOOP;
END $$;

ALTER TABLE stations
  ADD COLUMN point_id TEXT,                                                  -- A-2
  ADD COLUMN policy TEXT NOT NULL DEFAULT 'waada_guard' CHECK (policy IN ('waada_guard','edf','fifo')),   -- A-3
  ADD COLUMN freeze_ms INT NOT NULL DEFAULT 120000 CHECK (freeze_ms BETWEEN 0 AND 900000),                -- A-4
  ADD COLUMN min_slack_keep_ms INT NOT NULL DEFAULT 60000 CHECK (min_slack_keep_ms BETWEEN 0 AND 600000), -- A-5
  ADD COLUMN promise_padding_ms INT CHECK (promise_padding_ms BETWEEN 0 AND 1800000),                     -- A-6: null = branch value
  ADD COLUMN pressure_window_ms INT NOT NULL DEFAULT 900000 CHECK (pressure_window_ms BETWEEN 300000 AND 3600000),  -- A-7
  ADD COLUMN pressure_amber_bp INT NOT NULL DEFAULT 8000 CHECK (pressure_amber_bp BETWEEN 1 AND 20000),
  ADD COLUMN pressure_red_bp INT NOT NULL DEFAULT 10000 CHECK (pressure_red_bp BETWEEN 1 AND 20000),
  ADD COLUMN pressure_alert_ms INT NOT NULL DEFAULT 300000 CHECK (pressure_alert_ms BETWEEN 60000 AND 3600000),
  ADD COLUMN pause_enabled BOOLEAN NOT NULL DEFAULT false,                   -- A-8
  ADD COLUMN lane_units INT,                                                 -- null = capacity ÷ lane count (§3.10)
  ADD COLUMN reserve_units INT NOT NULL DEFAULT 0,
  ADD CONSTRAINT stations_pressure_amber_below_red CHECK (pressure_amber_bp < pressure_red_bp),
  ADD CONSTRAINT stations_lane_units_range CHECK (lane_units BETWEEN 1 AND capacity),
  ADD CONSTRAINT stations_reserve_units_range CHECK (reserve_units BETWEEN 0 AND capacity);

-- A-2: every station, archived too, starts at its branch's "Pass". This migration just created that point,
-- and no other point exists yet, so the branch alone identifies it.
UPDATE stations s SET point_id = p.point_id
  FROM points p
 WHERE p.tenant_id = s.tenant_id AND p.branch_id = s.branch_id;
ALTER TABLE stations ALTER COLUMN point_id SET NOT NULL,
  ADD CONSTRAINT stations_point_fk FOREIGN KEY (tenant_id, branch_id, point_id) REFERENCES points;
CREATE INDEX stations_point ON stations (tenant_id, branch_id, point_id)
  WHERE archived_at IS NULL;                                                 -- point archive check (§12.3 Q-v2.1-2)

CREATE TABLE station_alternates (                                            -- A-9
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, station_id TEXT NOT NULL, alternate_station_id TEXT NOT NULL,
  order_types TEXT[] NOT NULL
    CHECK (cardinality(order_types) > 0 AND order_types <@ ARRAY['dine_in','takeaway','delivery','parking']),
  home_for_order_types TEXT[] NOT NULL,
  CHECK (home_for_order_types <@ order_types),
  CHECK (station_id <> alternate_station_id),
  version BIGINT NOT NULL DEFAULT 1, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, station_id, alternate_station_id),      -- snapshot, stations GET: one branch's rows
  FOREIGN KEY (tenant_id, branch_id, station_id) REFERENCES stations,
  FOREIGN KEY (tenant_id, branch_id, alternate_station_id) REFERENCES stations);

CREATE TABLE carry_times (                                                   -- A-10: missing row = 0
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, station_id TEXT NOT NULL, point_id TEXT NOT NULL,
  carry_ms INT NOT NULL CHECK (carry_ms BETWEEN 0 AND 600000),
  version BIGINT NOT NULL DEFAULT 1, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, station_id, point_id),                  -- snapshot, stations GET: one branch's rows
  FOREIGN KEY (tenant_id, branch_id, station_id) REFERENCES stations,
  FOREIGN KEY (tenant_id, branch_id, point_id) REFERENCES points);

ALTER TABLE menu_items                                                       -- A-11
  ADD COLUMN weight_pct INT NOT NULL DEFAULT 100 CHECK (weight_pct BETWEEN 10 AND 1000),
  ADD COLUMN max_early_ms INT NOT NULL DEFAULT 60000 CHECK (max_early_ms BETWEEN 0 AND 3600000),
  ADD COLUMN max_carry_ms INT CHECK (max_carry_ms BETWEEN 0 AND 600000),
  ADD COLUMN max_late_ms INT CHECK (max_late_ms BETWEEN 0 AND 7200000),
  ADD COLUMN adjust_time_ms INT NOT NULL DEFAULT 180000 CHECK (adjust_time_ms BETWEEN 0 AND 3600000);

CREATE TABLE branch_engine_settings (                                        -- A-12
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  weight_dine_in_pct INT NOT NULL DEFAULT 100 CHECK (weight_dine_in_pct BETWEEN 10 AND 1000),
  weight_takeaway_pct INT NOT NULL DEFAULT 200 CHECK (weight_takeaway_pct BETWEEN 10 AND 1000),
  weight_delivery_pct INT NOT NULL DEFAULT 200 CHECK (weight_delivery_pct BETWEEN 10 AND 1000),
  weight_parking_pct INT NOT NULL DEFAULT 200 CHECK (weight_parking_pct BETWEEN 10 AND 1000),
  weight_follow_up_pct INT NOT NULL DEFAULT 300 CHECK (weight_follow_up_pct BETWEEN 10 AND 1000),
  promise_padding_dine_in_ms INT NOT NULL DEFAULT 180000 CHECK (promise_padding_dine_in_ms BETWEEN 0 AND 1800000),
  promise_padding_takeaway_ms INT NOT NULL DEFAULT 180000 CHECK (promise_padding_takeaway_ms BETWEEN 0 AND 1800000),
  promise_padding_delivery_ms INT NOT NULL DEFAULT 180000 CHECK (promise_padding_delivery_ms BETWEEN 0 AND 1800000),
  promise_padding_parking_ms INT NOT NULL DEFAULT 180000 CHECK (promise_padding_parking_ms BETWEEN 0 AND 1800000),
  slip_threshold_ms INT NOT NULL DEFAULT 120000 CHECK (slip_threshold_ms BETWEEN 60000 AND 1800000),
  slip_escalate_ms INT NOT NULL DEFAULT 120000 CHECK (slip_escalate_ms BETWEEN 30000 AND 1800000),
  cascade_step_ms INT NOT NULL DEFAULT 60000 CHECK (cascade_step_ms BETWEEN 15000 AND 300000),
  min_gain_ms INT NOT NULL DEFAULT 60000 CHECK (min_gain_ms BETWEEN 0 AND 600000),
  table_lock_ttl_ms INT NOT NULL DEFAULT 600000 CHECK (table_lock_ttl_ms BETWEEN 60000 AND 3600000),  -- used by 02
  returns_boost BOOLEAN NOT NULL DEFAULT true,
  order_abandon_ms INT NOT NULL DEFAULT 14400000 CHECK (order_abandon_ms BETWEEN 3600000 AND 86400000),
  version BIGINT NOT NULL DEFAULT 1, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches);

-- A-12: one row per existing branch, so the column defaults above are the only copy of the values.
INSERT INTO branch_engine_settings (tenant_id, branch_id, created_at, updated_at)
SELECT b.tenant_id, b.branch_id, p.created_at, p.created_at
  FROM branches b
  JOIN points p ON p.tenant_id = b.tenant_id AND p.branch_id = b.branch_id;

CREATE TABLE goes_with_links (                                               -- A-13: empty, filled in the owner app
  tenant_id TEXT NOT NULL REFERENCES tenants, link_id TEXT NOT NULL,         -- link_id: ULID
  source_kind TEXT NOT NULL CHECK (source_kind IN ('category','item')), source_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('category','item')), target_id TEXT NOT NULL,
  excluded BOOLEAN NOT NULL DEFAULT false,                                   -- an item override that removes a category default
  version BIGINT NOT NULL DEFAULT 1, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, link_id),
  UNIQUE (tenant_id, source_kind, source_id, target_kind, target_id));

-- §6.9a: the points routes write `point` audit rows (common write script, S26). Actions unchanged.
ALTER TABLE config_audit DROP CONSTRAINT config_audit_entity_check;
ALTER TABLE config_audit ADD CONSTRAINT config_audit_entity_check CHECK (entity IN (
  'floor','table','station','batch_program','tax_class','category','menu_item','item_route','branch_settings',
  'staff','role','responsibility','branch','owner_user',
  'variant_group','stock_item','stock_item_branch','modifier_group','deal','deal_branch',
  'point'));
