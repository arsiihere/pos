ALTER TABLE branches ADD COLUMN config_version BIGINT NOT NULL DEFAULT 1;    -- S8 (expand-only); raised by restore-bump (S42)
ALTER TABLE branches ADD COLUMN tax_enabled BOOLEAN NOT NULL DEFAULT false; -- S34
ALTER TABLE branches ADD COLUMN day_stale_after_hours INT NOT NULL DEFAULT 16
  CHECK (day_stale_after_hours BETWEEN 1 AND 72);                           -- S33: stale-day prompt (data, P2)
ALTER TABLE branches ADD COLUMN day_min_gap_hours INT NOT NULL DEFAULT 4
  CHECK (day_min_gap_hours BETWEEN 0 AND 24);                               -- S33: close guard (data, P2)
ALTER TABLE branches ADD CONSTRAINT branches_day_settings
  CHECK (day_stale_after_hours > day_min_gap_hours);                        -- S33: the stale prompt can always close

CREATE TABLE config_audit (                                                  -- S26: insert-only
  tenant_id TEXT NOT NULL, audit_id TEXT NOT NULL,                           -- audit_id: ULID
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('owner','cli')),           -- 'cli': set-branch-settings (§6.7)
  actor_owner_user_id TEXT,
  CHECK ((actor_kind = 'owner') = (actor_owner_user_id IS NOT NULL)),
  branch_id TEXT,                                                            -- null for tenant-level data
  entity TEXT NOT NULL CHECK (entity IN ('floor','table','station','batch_program',
                                         'tax_class','category','menu_item','item_route',
                                         'branch_settings')),
  entity_id TEXT NOT NULL,                                                   -- item_id for item_route
  action TEXT NOT NULL CHECK (action IN ('create','update','archive','restore','route_set','route_removed')),
  before JSONB, after JSONB,
  CHECK (before IS NOT NULL OR after IS NOT NULL),
  at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, audit_id),
  FOREIGN KEY (tenant_id, actor_owner_user_id) REFERENCES owner_users (tenant_id, user_id));
CREATE INDEX config_audit_entity ON config_audit (tenant_id, entity, entity_id, at);  -- "who changed this item's price"
CREATE FUNCTION config_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN RAISE EXCEPTION 'config_audit is insert-only'; END $$;
CREATE TRIGGER config_audit_no_update_delete BEFORE UPDATE OR DELETE ON config_audit
  FOR EACH ROW EXECUTE FUNCTION config_audit_immutable();

CREATE TABLE idempotency_keys (                                              -- S7, M69
  tenant_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  route TEXT NOT NULL, request_hash TEXT NOT NULL,
  response_status INT, response_body JSONB,                                  -- set before COMMIT
  created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, idempotency_key));
CREATE INDEX idempotency_keys_age ON idempotency_keys (tenant_id, created_at); -- 24 h prune per tenant, after COMMIT (S7)

CREATE TABLE floors (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, floor_id TEXT NOT NULL,
  name TEXT NOT NULL, sort_order INT NOT NULL DEFAULT 0, archived_at BIGINT,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, floor_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches);
CREATE UNIQUE INDEX floors_active_name ON floors (tenant_id, branch_id, lower(name))
  WHERE archived_at IS NULL;                                                 -- CONFIG_NAME_TAKEN

CREATE TABLE dining_tables (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, table_id TEXT NOT NULL,
  floor_id TEXT NOT NULL, name TEXT NOT NULL, seats INT CHECK (seats IS NULL OR seats BETWEEN 1 AND 100),
  sort_order INT NOT NULL DEFAULT 0, archived_at BIGINT,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, table_id),
  FOREIGN KEY (tenant_id, branch_id, floor_id) REFERENCES floors);
CREATE UNIQUE INDEX dining_tables_active_name ON dining_tables (tenant_id, branch_id, lower(name))
  WHERE archived_at IS NULL;
CREATE INDEX dining_tables_floor ON dining_tables (tenant_id, branch_id, floor_id)
  WHERE archived_at IS NULL;                                                 -- floor archive check, list

CREATE TABLE stations (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, station_id TEXT NOT NULL,
  name TEXT NOT NULL, location_label TEXT,
  station_type TEXT NOT NULL CHECK (station_type IN ('slot','batch')),
  capacity INT NOT NULL CHECK (capacity BETWEEN 1 AND 100),
  freshness_window_ms INT CHECK (freshness_window_ms BETWEEN 0 AND 3600000),
  completion_mode TEXT NOT NULL DEFAULT 'two_tap' CHECK (completion_mode IN ('two_tap','single_tap','auto_done')),
  CHECK ((station_type = 'batch') = (freshness_window_ms IS NOT NULL)),
  archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, station_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches);
CREATE UNIQUE INDEX stations_active_name ON stations (tenant_id, branch_id, lower(name))
  WHERE archived_at IS NULL;

CREATE TABLE batch_programs (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, station_id TEXT NOT NULL, program_id TEXT NOT NULL,
  name TEXT NOT NULL, cook_time_ms INT NOT NULL CHECK (cook_time_ms BETWEEN 1 AND 14400000),
  archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, program_id),
  FOREIGN KEY (tenant_id, branch_id, station_id) REFERENCES stations);
CREATE UNIQUE INDEX batch_programs_active_name ON batch_programs (tenant_id, branch_id, station_id, lower(name))
  WHERE archived_at IS NULL;                                                 -- also serves programs per station

CREATE TABLE tax_classes (
  tenant_id TEXT NOT NULL REFERENCES tenants, tax_class_id TEXT NOT NULL,
  name TEXT NOT NULL, rate_bp INT NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, tax_class_id));
CREATE UNIQUE INDEX tax_classes_active_name ON tax_classes (tenant_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE categories (
  tenant_id TEXT NOT NULL REFERENCES tenants, category_id TEXT NOT NULL,
  name TEXT NOT NULL, sort_order INT NOT NULL DEFAULT 0,
  archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, category_id));
CREATE UNIQUE INDEX categories_active_name ON categories (tenant_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE menu_items (
  tenant_id TEXT NOT NULL REFERENCES tenants, item_id TEXT NOT NULL,
  category_id TEXT NOT NULL, tax_class_id TEXT,                              -- S34: null = never taxed
  name TEXT NOT NULL, group_label TEXT, description TEXT CHECK (length(description) <= 300),
  sort_order INT NOT NULL DEFAULT 0,
  price_minor BIGINT NOT NULL CHECK (price_minor BETWEEN 0 AND 1000000000),
  serve_mode TEXT NOT NULL CHECK (serve_mode IN ('immediate','sync')),
  prep_buffer_ms INT NOT NULL DEFAULT 0 CHECK (prep_buffer_ms BETWEEN 0 AND 3600000),
  cook_time_ms INT NOT NULL CHECK (cook_time_ms BETWEEN 1 AND 14400000),
  stock_time_ms INT CHECK (stock_time_ms IS NULL OR stock_time_ms BETWEEN 0 AND cook_time_ms),
  out_of_stock_behaviour TEXT NOT NULL DEFAULT 'cook_fresh'
    CHECK (out_of_stock_behaviour IN ('cook_fresh','sold_out')),             -- S32 [ASSUMPTION]
  stock_unit TEXT NOT NULL DEFAULT 'piece' CHECK (stock_unit IN ('piece','g','ml')),   -- S44
  sale_unit  TEXT NOT NULL DEFAULT 'piece' CHECK (sale_unit  IN ('piece','g','ml')),   -- S44
  stock_per_sale_unit INT NOT NULL DEFAULT 1 CHECK (stock_per_sale_unit BETWEEN 1 AND 1000000),
  CHECK ((stock_unit = sale_unit AND stock_per_sale_unit = 1)
         OR (stock_unit <> sale_unit AND sale_unit = 'piece')),                     -- S44
  low_stock_threshold INT CHECK (low_stock_threshold BETWEEN 0 AND 1000000),       -- S46, null = no alert
  carries_over BOOLEAN NOT NULL DEFAULT false,                                      -- S41
  archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, item_id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES categories,
  FOREIGN KEY (tenant_id, tax_class_id) REFERENCES tax_classes);
CREATE UNIQUE INDEX menu_items_active_name ON menu_items (tenant_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX menu_items_category ON menu_items (tenant_id, category_id) WHERE archived_at IS NULL;   -- category archive check
CREATE INDEX menu_items_tax_class ON menu_items (tenant_id, tax_class_id) WHERE archived_at IS NULL; -- tax class archive check
CREATE INDEX menu_items_name_order ON menu_items (tenant_id, lower(name), item_id);  -- §6.11 cursor pages (S48)

CREATE TABLE availability_windows (                                          -- S47: tenant-level, rows (P2)
  tenant_id TEXT NOT NULL REFERENCES tenants, window_id TEXT NOT NULL,      -- window_id: ULID
  item_id TEXT, category_id TEXT,
  CHECK ((item_id IS NULL) <> (category_id IS NULL)),                         -- one target
  start_ms INT NOT NULL CHECK (start_ms BETWEEN 0 AND 86340000 AND start_ms % 60000 = 0),
  end_ms   INT NOT NULL CHECK (end_ms   BETWEEN 0 AND 86340000 AND end_ms   % 60000 = 0),
  CHECK (start_ms <> end_ms),                                                 -- end < start wraps past midnight
  PRIMARY KEY (tenant_id, window_id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES menu_items,
  FOREIGN KEY (tenant_id, category_id) REFERENCES categories);
CREATE INDEX availability_windows_item ON availability_windows (tenant_id, item_id, start_ms)
  WHERE item_id IS NOT NULL;                                                  -- snapshot, menu read, PATCH replace
CREATE INDEX availability_windows_category ON availability_windows (tenant_id, category_id, start_ms)
  WHERE category_id IS NOT NULL;

CREATE TABLE item_routes (                                                   -- S11: one route per item per branch
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, item_id TEXT NOT NULL,
  station_id TEXT NOT NULL, program_id TEXT, stock_program_id TEXT,
  CHECK (stock_program_id IS NULL OR program_id IS NOT NULL),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, item_id),                               -- snapshot: routes of one branch
  FOREIGN KEY (tenant_id, item_id) REFERENCES menu_items,
  FOREIGN KEY (tenant_id, branch_id, station_id) REFERENCES stations,
  FOREIGN KEY (tenant_id, branch_id, program_id) REFERENCES batch_programs,
  FOREIGN KEY (tenant_id, branch_id, stock_program_id) REFERENCES batch_programs);
CREATE INDEX item_routes_station ON item_routes (tenant_id, branch_id, station_id);  -- station archive check
CREATE INDEX item_routes_program ON item_routes (tenant_id, branch_id, program_id);  -- program archive check
CREATE INDEX item_routes_stock_program ON item_routes (tenant_id, branch_id, stock_program_id)
  WHERE stock_program_id IS NOT NULL;
