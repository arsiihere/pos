-- 08 v1.1 Part B §5.1 (08b Recipes + cost engine; expand, one transaction). B1: one recipe per owner, ever;
-- B8: draft → published → superseded versions; B4: lines with the entered and the frozen stock-unit quantity.

CREATE TABLE recipes (                                             -- B1: one per owner, ever
  tenant_id TEXT NOT NULL REFERENCES tenants, recipe_id TEXT NOT NULL,     -- ULID
  owner_type TEXT NOT NULL CHECK (owner_type IN ('menu_item','modifier_option','stock_item')),
  owner_id TEXT NOT NULL,                                          -- polymorphic: checked by the service (B2)
  archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, recipe_id),
  UNIQUE (tenant_id, owner_type, owner_id));                       -- §3.3 one per owner; B17 owner-edit reads

CREATE TABLE recipe_versions (                                     -- B8
  tenant_id TEXT NOT NULL, recipe_version_id TEXT NOT NULL,        -- ULID
  recipe_id TEXT NOT NULL, version_no INT NOT NULL CHECK (version_no >= 1),
  status TEXT NOT NULL CHECK (status IN ('draft','published','superseded')),
  basis TEXT NOT NULL CHECK (basis IN ('per_unit','per_measure','per_batch')),   -- v0.3: per_kg → per_measure (g or ml)
  base_qty INT CHECK (base_qty BETWEEN 1 AND 1000000),
  batch_yield_qty BIGINT CHECK (batch_yield_qty BETWEEN 1 AND 1000000000),
  CHECK ((basis = 'per_measure') = (base_qty IS NOT NULL)),
  CHECK (basis = 'per_batch' OR batch_yield_qty IS NULL),
  CHECK (status = 'draft' OR basis <> 'per_batch' OR batch_yield_qty IS NOT NULL),
  batch_stock_unit TEXT CHECK (batch_stock_unit IN ('piece','g','ml')),   -- v0.3 N-1: owner's stock_unit frozen with batch_yield_qty
  CHECK ((batch_yield_qty IS NULL) = (batch_stock_unit IS NULL)),
  measure_unit TEXT CHECK (measure_unit IN ('g','ml')),                -- v0.4 T-2: owner's sale_unit frozen on a per_measure version
  CHECK ((basis = 'per_measure') = (measure_unit IS NOT NULL)),
  misc_allowance_bp INT NOT NULL DEFAULT 500 CHECK (misc_allowance_bp BETWEEN 0 AND 5000),
  created_by TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  published_by TEXT, published_at BIGINT,
  CHECK ((status = 'draft') = (published_at IS NULL)),
  PRIMARY KEY (tenant_id, recipe_version_id),
  UNIQUE (tenant_id, recipe_id, version_no),
  FOREIGN KEY (tenant_id, recipe_id) REFERENCES recipes,
  FOREIGN KEY (tenant_id, created_by) REFERENCES owner_users (tenant_id, user_id),
  FOREIGN KEY (tenant_id, published_by) REFERENCES owner_users (tenant_id, user_id));
CREATE UNIQUE INDEX recipe_versions_one_draft ON recipe_versions (tenant_id, recipe_id) WHERE status = 'draft';
CREATE UNIQUE INDEX recipe_versions_one_published ON recipe_versions (tenant_id, recipe_id) WHERE status = 'published';
CREATE INDEX recipe_versions_recent ON recipe_versions (tenant_id, recipe_id, published_at DESC, recipe_version_id DESC)
  WHERE status IN ('published','superseded');                      -- B15 (e) published + 3 superseded; §6.2 history

CREATE TABLE recipe_lines (                                        -- B4
  tenant_id TEXT NOT NULL, recipe_version_id TEXT NOT NULL, line_no INT NOT NULL CHECK (line_no BETWEEN 1 AND 60),
  stock_item_id TEXT NOT NULL,
  unit_name TEXT NOT NULL,                                         -- as entered; resolved by resolveUnit at save
  entered_num BIGINT NOT NULL CHECK (entered_num <> 0), entered_den BIGINT NOT NULL CHECK (entered_den >= 1),
  stock_qty_num BIGINT NOT NULL CHECK (stock_qty_num <> 0 AND abs(stock_qty_num) <= 1000000000000000),
  stock_qty_den BIGINT NOT NULL CHECK (stock_qty_den >= 1),
  stock_unit TEXT NOT NULL CHECK (stock_unit IN ('piece','g','ml')),   -- frozen at save (B4)
  CHECK (sign(entered_num) = sign(stock_qty_num)),
  qty_basis TEXT NOT NULL CHECK (qty_basis IN ('AP','EP')),
  PRIMARY KEY (tenant_id, recipe_version_id, line_no),
  UNIQUE (tenant_id, recipe_version_id, stock_item_id),
  FOREIGN KEY (tenant_id, recipe_version_id) REFERENCES recipe_versions,
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items);
CREATE INDEX recipe_lines_stock_item ON recipe_lines (tenant_id, stock_item_id);   -- B17 in-use read

-- 01a §5.2 config_audit (row A-5): entities + recipe, recipe_version; action + publish. Live lists re-read first
-- (01b D-5): entity CHECK last written by 0018_inventory_config.sql, action CHECK by 0006_menu_variants.sql.
ALTER TABLE config_audit DROP CONSTRAINT config_audit_entity_check;
ALTER TABLE config_audit ADD CONSTRAINT config_audit_entity_check CHECK (entity IN (
  'floor','table','station','batch_program','tax_class','category','menu_item','item_route','branch_settings',
  'staff','role','responsibility','branch','owner_user',
  'variant_group','stock_item','stock_item_branch','modifier_group','deal','deal_branch',
  'point','zone','billing_settings',
  'stock_item_unit','item_price','yield_profile',
  'recipe','recipe_version'));
ALTER TABLE config_audit DROP CONSTRAINT config_audit_action_check;
ALTER TABLE config_audit ADD CONSTRAINT config_audit_action_check CHECK (action IN (
  'create','update','archive','restore','route_set','route_removed',
  'pin_set','left','returned','reports_to_reassigned','password_change','password_reset',
  'branch_set','branch_removed',
  'publish'));

-- ⚠️ v0.2 M-1 (row A-6): release delivery of the inventory key, as 0017 (01a MD-3) and 0012 (AD-9).
UPDATE branches SET config_version = config_version + 1;
