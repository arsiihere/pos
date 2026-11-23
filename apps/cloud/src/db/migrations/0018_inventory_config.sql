-- 08a §5.1: inventory config. Expand only; no config_version bump (no snapshot content changes, I11).
ALTER TABLE stock_items
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'prepared' CHECK (kind IN ('prepared','ingredient','packet')),
  ADD COLUMN code TEXT CHECK (code ~ '^[A-Z0-9-]{1,16}$'),
  ADD COLUMN cost_category TEXT NOT NULL DEFAULT 'food'
    CHECK (cost_category IN ('food','packaging','cleaning','beverage')),
  ADD COLUMN is_a_item BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT stock_items_packet_unit CHECK (kind <> 'packet' OR stock_unit = 'g'),
  ADD CONSTRAINT stock_items_carries_over_kind CHECK (NOT carries_over OR kind = 'prepared');
CREATE UNIQUE INDEX stock_items_active_code ON stock_items (tenant_id, code)
  WHERE archived_at IS NULL AND code IS NOT NULL;                -- §3.3 code read before the write; backstop

CREATE TABLE stock_item_units (                                  -- I4: append-only
  tenant_id TEXT NOT NULL, unit_row_id TEXT NOT NULL,            -- ULID
  stock_item_id TEXT NOT NULL, unit_name TEXT NOT NULL CHECK (unit_name ~ '^[a-z0-9 ._-]{1,20}$'),
  base_unit TEXT NOT NULL CHECK (base_unit IN ('piece','g','ml')),
  CHECK (unit_name <> base_unit),
  factor_num BIGINT NOT NULL CHECK (factor_num BETWEEN 1 AND 1000000000),
  factor_den INT NOT NULL CHECK (factor_den BETWEEN 1 AND 1000000),
  note TEXT CHECK (length(note) <= 200),
  recorded_by TEXT NOT NULL, created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, unit_row_id),
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items,
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES owner_users (tenant_id, user_id));   -- v0.3 N-2
CREATE INDEX stock_item_units_item ON stock_item_units (tenant_id, stock_item_id, unit_name, created_at DESC);
                                                                 -- I5 latest per name; §6.4 history; §6.6 resolve

CREATE TABLE item_prices (                                       -- I6: append-only
  tenant_id TEXT NOT NULL, price_id TEXT NOT NULL,               -- ULID
  stock_item_id TEXT NOT NULL, branch_id TEXT,                   -- null = every branch
  kind TEXT NOT NULL CHECK (kind IN ('manual','market_rate')),
  CHECK (kind = 'market_rate' OR branch_id IS NULL),             -- M-6: no branch manual price
  unit_name TEXT NOT NULL, price_minor BIGINT NOT NULL CHECK (price_minor BETWEEN 1 AND 1000000000),
  stock_qty_num BIGINT NOT NULL CHECK (stock_qty_num >= 1), stock_qty_den BIGINT NOT NULL CHECK (stock_qty_den >= 1),
  stock_unit TEXT NOT NULL CHECK (stock_unit IN ('piece','g','ml')),   -- frozen at write (I6)
  created_at BIGINT NOT NULL,                                    -- the price takes effect here (I6)
  valid_until_at BIGINT,
  CHECK ((kind = 'manual') = (valid_until_at IS NULL)),
  CHECK (valid_until_at IS NULL OR (valid_until_at > created_at AND valid_until_at <= created_at + 2592000000)),  -- v0.4 OQ-3: 1 h … 30 days
  note TEXT CHECK (length(note) <= 200),
  recorded_by TEXT NOT NULL,
  PRIMARY KEY (tenant_id, price_id),
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches,     -- key-share lock on branches at insert (§6 lock order)
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES owner_users (tenant_id, user_id));   -- v0.3 N-2
CREATE INDEX item_prices_item ON item_prices (tenant_id, stock_item_id, created_at DESC);
                                                                 -- §6.1 / §6.4 / §6.6 candidates; §6.4 history page

CREATE TABLE yield_profiles (                                    -- I8: append-only
  tenant_id TEXT NOT NULL, yield_profile_id TEXT NOT NULL,       -- ULID
  stock_item_id TEXT NOT NULL,
  yield_bp INT NOT NULL CHECK (yield_bp BETWEEN 1 AND 50000),
  test_ap_qty BIGINT CHECK (test_ap_qty BETWEEN 1 AND 1000000000),
  test_ep_qty BIGINT CHECK (test_ep_qty BETWEEN 1 AND 1000000000),
  test_unit TEXT CHECK (test_unit IN ('piece','g','ml')),
  CHECK ((test_ap_qty IS NULL) = (test_ep_qty IS NULL) AND (test_ap_qty IS NULL) = (test_unit IS NULL)),
  note TEXT CHECK (length(note) <= 200),
  recorded_by TEXT NOT NULL, created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, yield_profile_id),
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items,
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES owner_users (tenant_id, user_id));   -- v0.3 N-2
CREATE INDEX yield_profiles_item ON yield_profiles (tenant_id, stock_item_id, created_at DESC);  -- active + history

-- 01a §5.2 config_audit (08a row A-1): entities widen; actions unchanged.
ALTER TABLE config_audit DROP CONSTRAINT config_audit_entity_check;
ALTER TABLE config_audit ADD CONSTRAINT config_audit_entity_check CHECK (entity IN (
  'floor','table','station','batch_program','tax_class','category','menu_item','item_route','branch_settings',
  'staff','role','responsibility','branch','owner_user',
  'variant_group','stock_item','stock_item_branch','modifier_group','deal','deal_branch',
  'point','zone','billing_settings',
  'stock_item_unit','item_price','yield_profile'));
