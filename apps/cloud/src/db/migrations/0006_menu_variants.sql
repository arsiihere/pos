-- 01c §5.1: menu variants, stock items, modifiers, deals. Expand; one transaction (applied by the migrator).
-- Real CHECK names read from the test DB (01b D-5): availability_windows_check, config_audit_entity_check, config_audit_action_check.

CREATE TABLE variant_groups (
  tenant_id TEXT NOT NULL REFERENCES tenants, variant_group_id TEXT NOT NULL,
  category_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT CHECK (length(description) <= 300),
  sort_order INT NOT NULL DEFAULT 0, archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, variant_group_id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES categories);
CREATE UNIQUE INDEX variant_groups_active_name ON variant_groups (tenant_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX variant_groups_category ON variant_groups (tenant_id, category_id) WHERE archived_at IS NULL;  -- category archive check

ALTER TABLE menu_items ADD COLUMN variant_group_id TEXT, ADD COLUMN variant_name TEXT,
  ADD CONSTRAINT menu_items_variant_pair CHECK ((variant_group_id IS NULL) = (variant_name IS NULL)),
  ADD CONSTRAINT menu_items_variant_group_fk FOREIGN KEY (tenant_id, variant_group_id) REFERENCES variant_groups;
CREATE UNIQUE INDEX menu_items_variant_name ON menu_items (tenant_id, variant_group_id, lower(variant_name))
  WHERE archived_at IS NULL AND variant_group_id IS NOT NULL;            -- variant name unique in its group; members by group

ALTER TABLE menu_items ADD COLUMN requires_weighing BOOLEAN NOT NULL DEFAULT false,      -- V18
  ADD CONSTRAINT menu_items_weighing_unit CHECK (NOT requires_weighing OR sale_unit IN ('g','ml'));

CREATE TABLE stock_items (
  tenant_id TEXT NOT NULL REFERENCES tenants, stock_item_id TEXT NOT NULL,
  name TEXT NOT NULL,                                                    -- v0.3 m8: no kind (R28 adds it)
  stock_unit TEXT NOT NULL CHECK (stock_unit IN ('piece','g','ml')),
  carries_over BOOLEAN NOT NULL DEFAULT false,
  archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, stock_item_id));
CREATE UNIQUE INDEX stock_items_active_name ON stock_items (tenant_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE stock_item_branches (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, stock_item_id TEXT NOT NULL,
  station_id TEXT NOT NULL, low_stock_threshold INT CHECK (low_stock_threshold BETWEEN 0 AND 1000000),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, stock_item_id),                     -- snapshot: one branch's stock items
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items,
  FOREIGN KEY (tenant_id, branch_id, station_id) REFERENCES stations);
CREATE INDEX stock_item_branches_station ON stock_item_branches (tenant_id, branch_id, station_id);  -- station archive check

CREATE TABLE stock_draws (
  tenant_id TEXT NOT NULL, item_id TEXT NOT NULL, stock_item_id TEXT NOT NULL,
  quantity_per_sale_unit INT NOT NULL CHECK (quantity_per_sale_unit BETWEEN 1 AND 1000000),
  PRIMARY KEY (tenant_id, item_id, stock_item_id),                       -- an item's draws (snapshot, menu read)
  FOREIGN KEY (tenant_id, item_id) REFERENCES menu_items,
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items);
CREATE INDEX stock_draws_stock_item ON stock_draws (tenant_id, stock_item_id);  -- drawers list, stock item archive check

CREATE TABLE modifier_groups (
  tenant_id TEXT NOT NULL REFERENCES tenants, modifier_group_id TEXT NOT NULL, name TEXT NOT NULL,
  min_choices INT NOT NULL CHECK (min_choices BETWEEN 0 AND 50),
  max_choices INT NOT NULL CHECK (max_choices BETWEEN 1 AND 50), CHECK (min_choices <= max_choices),
  sort_order INT NOT NULL DEFAULT 0, archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, modifier_group_id));
CREATE UNIQUE INDEX modifier_groups_active_name ON modifier_groups (tenant_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE modifier_options (
  tenant_id TEXT NOT NULL, option_id TEXT NOT NULL, modifier_group_id TEXT NOT NULL,
  name TEXT NOT NULL, price_minor BIGINT CHECK (price_minor BETWEEN 0 AND 1000000000),
  max_quantity INT NOT NULL DEFAULT 1 CHECK (max_quantity BETWEEN 1 AND 20),
  is_default BOOLEAN NOT NULL DEFAULT false, linked_item_id TEXT, sort_order INT NOT NULL DEFAULT 0,
  CHECK (linked_item_id IS NOT NULL OR price_minor IS NOT NULL),          -- a plain option has a price
  archived_at BIGINT,
  PRIMARY KEY (tenant_id, option_id),                                    -- option ids are tenant-unique, never reused
  FOREIGN KEY (tenant_id, modifier_group_id) REFERENCES modifier_groups,
  FOREIGN KEY (tenant_id, linked_item_id) REFERENCES menu_items);
CREATE INDEX modifier_options_group ON modifier_options (tenant_id, modifier_group_id, sort_order);  -- read, rewrite
-- Option names: unique among the group's active options by lower(name), checked by one SQL statement under the
-- group lock (V14, m13); no partial unique index, because the upsert of a rename swap would trip it mid-statement.
CREATE INDEX modifier_options_linked_item ON modifier_options (tenant_id, linked_item_id)
  WHERE linked_item_id IS NOT NULL AND archived_at IS NULL;              -- item archive check (V16)

CREATE TABLE modifier_option_branches (                                  -- V19: differences only
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, option_id TEXT NOT NULL,
  is_offered BOOLEAN NOT NULL,
  price_minor_override BIGINT CHECK (price_minor_override BETWEEN 0 AND 1000000000),
  CHECK (is_offered OR price_minor_override IS NULL),
  CHECK (NOT (is_offered AND price_minor_override IS NULL)),             -- a default entry is not stored
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, option_id),                         -- snapshot of one branch; PUT reads a group's rows (option_id = ANY)
  FOREIGN KEY (tenant_id, option_id) REFERENCES modifier_options,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches);

CREATE TABLE modifier_group_links (
  tenant_id TEXT NOT NULL, modifier_group_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('category','variant_group','item')),
  target_id TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('attach','detach')),
  CHECK (NOT (target_kind = 'category' AND mode = 'detach')),
  PRIMARY KEY (tenant_id, modifier_group_id, target_kind, target_id),
  FOREIGN KEY (tenant_id, modifier_group_id) REFERENCES modifier_groups);
-- target_id is polymorphic: checked by the service (C1), not by a foreign key.
CREATE INDEX modifier_group_links_target ON modifier_group_links (tenant_id, target_kind, target_id);  -- effective-set check on item writes

CREATE TABLE deals (
  tenant_id TEXT NOT NULL REFERENCES tenants, deal_id TEXT NOT NULL,
  category_id TEXT NOT NULL, tax_class_id TEXT, name TEXT NOT NULL,
  description TEXT CHECK (length(description) <= 300), sort_order INT NOT NULL DEFAULT 0,
  price_minor BIGINT NOT NULL CHECK (price_minor BETWEEN 0 AND 1000000000),
  archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, deal_id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES categories,
  FOREIGN KEY (tenant_id, tax_class_id) REFERENCES tax_classes);
CREATE UNIQUE INDEX deals_active_name ON deals (tenant_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX deals_category ON deals (tenant_id, category_id) WHERE archived_at IS NULL;    -- category archive check
CREATE INDEX deals_tax_class ON deals (tenant_id, tax_class_id) WHERE archived_at IS NULL;  -- tax class archive check

CREATE TABLE deal_parts (
  tenant_id TEXT NOT NULL, deal_part_id TEXT NOT NULL, deal_id TEXT NOT NULL,
  quantity INT NOT NULL CHECK (quantity BETWEEN 1 AND 1000000), sort_order INT NOT NULL DEFAULT 0,
  archived_at BIGINT,
  PRIMARY KEY (tenant_id, deal_part_id),
  FOREIGN KEY (tenant_id, deal_id) REFERENCES deals);
CREATE INDEX deal_parts_deal ON deal_parts (tenant_id, deal_id, sort_order);

CREATE TABLE deal_part_choices (
  tenant_id TEXT NOT NULL, deal_part_id TEXT NOT NULL, item_id TEXT NOT NULL,
  extra_price_minor BIGINT NOT NULL DEFAULT 0 CHECK (extra_price_minor BETWEEN 0 AND 1000000000),
  sort_order INT NOT NULL DEFAULT 0,                                     -- v0.3 m5: display order, reference choice
  PRIMARY KEY (tenant_id, deal_part_id, item_id),
  FOREIGN KEY (tenant_id, deal_part_id) REFERENCES deal_parts,
  FOREIGN KEY (tenant_id, item_id) REFERENCES menu_items);
CREATE INDEX deal_part_choices_item ON deal_part_choices (tenant_id, item_id);  -- item archive check (V16; joined to active parts)

CREATE TABLE deal_branches (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, deal_id TEXT NOT NULL,
  price_minor_override BIGINT CHECK (price_minor_override BETWEEN 0 AND 1000000000),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, deal_id),                           -- snapshot: one branch's deals
  FOREIGN KEY (tenant_id, deal_id) REFERENCES deals,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches);

ALTER TABLE availability_windows ADD COLUMN deal_id TEXT,
  ADD CONSTRAINT availability_windows_deal_fk FOREIGN KEY (tenant_id, deal_id) REFERENCES deals;
ALTER TABLE availability_windows DROP CONSTRAINT availability_windows_check;   -- real name read at build step 1 (01b D-5)
ALTER TABLE availability_windows ADD CONSTRAINT availability_windows_one_target
  CHECK (num_nonnulls(item_id, category_id, deal_id) = 1);
CREATE INDEX availability_windows_deal ON availability_windows (tenant_id, deal_id, start_ms) WHERE deal_id IS NOT NULL;

-- audit: entities and actions widen (expand)
ALTER TABLE config_audit DROP CONSTRAINT config_audit_entity_check;
ALTER TABLE config_audit ADD CONSTRAINT config_audit_entity_check CHECK (entity IN (
  'floor','table','station','batch_program','tax_class','category','menu_item','item_route','branch_settings',
  'staff','role','responsibility','branch','owner_user',
  'variant_group','stock_item','stock_item_branch','modifier_group','deal','deal_branch'));
ALTER TABLE config_audit DROP CONSTRAINT config_audit_action_check;
ALTER TABLE config_audit ADD CONSTRAINT config_audit_action_check CHECK (action IN (
  'create','update','archive','restore','route_set','route_removed',
  'pin_set','left','returned','reports_to_reassigned','password_change','password_reset',
  'branch_set','branch_removed'));

-- Backfill (V5: same ULIDs). Stock-tracked under 01a's rule: a route at a slot station with stock_time_ms,
-- or at a batch station with stock_program_id. Active items only. No audit rows (a migration is not an owner write).
INSERT INTO stock_items (tenant_id, stock_item_id, name, stock_unit, carries_over, created_at, updated_at)
SELECT i.tenant_id, i.item_id, i.name, i.stock_unit, i.carries_over, i.created_at, i.updated_at
  FROM menu_items i
 WHERE i.archived_at IS NULL
   AND EXISTS (SELECT 1 FROM item_routes r JOIN stations s
                 ON s.tenant_id = r.tenant_id AND s.branch_id = r.branch_id AND s.station_id = r.station_id
                WHERE r.tenant_id = i.tenant_id AND r.item_id = i.item_id
                  AND ((s.station_type = 'slot' AND i.stock_time_ms IS NOT NULL)
                    OR (s.station_type = 'batch' AND r.stock_program_id IS NOT NULL)));

INSERT INTO stock_item_branches (tenant_id, branch_id, stock_item_id, station_id, low_stock_threshold, updated_at)
SELECT r.tenant_id, r.branch_id, r.item_id, r.station_id, i.low_stock_threshold, i.updated_at
  FROM item_routes r
  JOIN stations s ON s.tenant_id = r.tenant_id AND s.branch_id = r.branch_id AND s.station_id = r.station_id
  JOIN menu_items i ON i.tenant_id = r.tenant_id AND i.item_id = r.item_id
 WHERE i.archived_at IS NULL
   AND ((s.station_type = 'slot' AND i.stock_time_ms IS NOT NULL)
     OR (s.station_type = 'batch' AND r.stock_program_id IS NOT NULL));

INSERT INTO stock_draws (tenant_id, item_id, stock_item_id, quantity_per_sale_unit)
SELECT i.tenant_id, i.item_id, i.item_id, i.stock_per_sale_unit
  FROM menu_items i
 WHERE i.archived_at IS NULL
   AND EXISTS (SELECT 1 FROM stock_items x WHERE x.tenant_id = i.tenant_id AND x.stock_item_id = i.item_id);
