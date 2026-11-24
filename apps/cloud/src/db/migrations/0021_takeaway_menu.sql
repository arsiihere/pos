-- 01a v2.11 §5.2c SC-1: keyboard short codes are unique among a tenant's active items.
ALTER TABLE menu_items
  ADD COLUMN short_code TEXT NULL CHECK (short_code IS NULL OR short_code ~ '^[a-z][a-z0-9]{0,5}$');

CREATE UNIQUE INDEX menu_items_active_short_code ON menu_items (tenant_id, short_code)
  WHERE archived_at IS NULL AND short_code IS NOT NULL;

-- CP-1: no FK on the companion target, so mutual companion edits do not deadlock.
CREATE TABLE menu_item_companions (
  tenant_id TEXT NOT NULL REFERENCES tenants,
  item_id TEXT NOT NULL,
  companion_item_id TEXT NOT NULL,
  quantity INT NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  sort_order INT NOT NULL CHECK (sort_order BETWEEN 0 AND 3),
  CHECK (companion_item_id <> item_id),
  PRIMARY KEY (tenant_id, item_id, companion_item_id),
  UNIQUE (tenant_id, item_id, sort_order),
  FOREIGN KEY (tenant_id, item_id) REFERENCES menu_items
);

-- RO-1, TS-1, BD-1: takeaway settings defaults and whole-minute local day end.
ALTER TABLE branch_engine_settings
  ADD COLUMN rush_open_orders INT NOT NULL DEFAULT 15 CHECK (rush_open_orders BETWEEN 5 AND 100),
  ADD COLUMN takeaway_slip_on_send BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE branches
  ADD COLUMN business_day_end_local_ms INT NOT NULL DEFAULT 14400000
    CHECK (business_day_end_local_ms BETWEEN 0 AND 86340000 AND business_day_end_local_ms % 60000 = 0);

-- MG-1: release the updated snapshot for every branch.
UPDATE branches SET config_version = config_version + 1;
