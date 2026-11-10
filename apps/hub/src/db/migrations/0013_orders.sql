-- 02b v1.0.2 §5 (hub SQLite), verbatim. One projection `orders` (with `reset`) writes all three tables and reads
-- only its own events.
CREATE TABLE orders (
  order_id        TEXT PRIMARY KEY,
  order_type      TEXT NOT NULL CHECK (order_type IN ('dine_in','takeaway','parking')),
  table_key       TEXT NOT NULL,
  business_date   TEXT NOT NULL,
  token           INTEGER,                               -- takeaway only
  car_number      TEXT, car_type TEXT CHECK (car_type IN ('sedan','mini','large')),
  customer_name   TEXT, phone TEXT,                      -- OrderContactSet (O17)
  order_note      TEXT,
  placed_by       TEXT NOT NULL,                         -- envelope actor_id
  placed_at       INTEGER NOT NULL,                      -- recorded_at
  follow_up       INTEGER NOT NULL CHECK (follow_up IN (0,1)),
  cancelled_at    INTEGER,
  billed_at       INTEGER,                               -- OrdersBilled (every bill, §3.3)
  day_closed_at   INTEGER,                               -- BusinessDayClosed: cancelled, billed or finished orders
  sent_after_reconnect INTEGER NOT NULL DEFAULT 0 CHECK (sent_after_reconnect IN (0,1))
);
CREATE UNIQUE INDEX orders_token ON orders (business_date, token) WHERE token IS NOT NULL;   -- token MAX
CREATE INDEX orders_open ON orders (order_type, placed_at)
  WHERE billed_at IS NULL AND cancelled_at IS NULL AND day_closed_at IS NULL;              -- open-orders, catch-up

CREATE TABLE order_lines (
  order_item_id   TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL,
  parent_order_item_id TEXT,
  line_kind       TEXT NOT NULL CHECK (line_kind IN ('item','option_child','deal','deal_part')),
  item_id TEXT, deal_id TEXT, name TEXT NOT NULL,
  sale_unit       TEXT NOT NULL,
  quantity        INTEGER,                               -- NULL while weight pending
  units           INTEGER NOT NULL,                      -- §3.4
  line_total_minor INTEGER,                              -- copy; LineWeightSet
  refundable_minor INTEGER NOT NULL DEFAULT 0,           -- §3.4: line total, or a deal part's allocated + options; 0 deal / return
  removed_units INTEGER NOT NULL DEFAULT 0, removed_minor INTEGER NOT NULL DEFAULT 0,
  voided_units  INTEGER NOT NULL DEFAULT 0, refund_minor  INTEGER NOT NULL DEFAULT 0,
  comped_units  INTEGER NOT NULL DEFAULT 0, comp_minor    INTEGER NOT NULL DEFAULT 0,
  comp_voided_minor INTEGER NOT NULL DEFAULT 0,          -- O21
  returned_units INTEGER NOT NULL DEFAULT 0,             -- engine view only; money-live (O20)
  return_of       TEXT,                                  -- return lines (money 0)
  served_from_zone_id TEXT,
  added_at        INTEGER NOT NULL,                      -- zone undo window
  served_at       INTEGER,
  served_source   TEXT CHECK (served_source IN ('tap','estimated','zone')),
  is_food         INTEGER NOT NULL CHECK (is_food IN (0,1)),   -- engine line, not zone-served, not ready item (§3.3)
  kitchen_note    TEXT,
  CHECK (removed_units + voided_units <= units),
  CHECK (comped_units <= units - removed_units - voided_units),
  CHECK (comp_minor + comp_voided_minor + removed_minor + refund_minor <= refundable_minor)
);
CREATE INDEX order_lines_order ON order_lines (order_id);                                  -- every per-order read

CREATE TABLE zone_stock (
  zone_id TEXT NOT NULL, item_id TEXT NOT NULL,
  on_hand INTEGER NOT NULL CHECK (on_hand >= 0),
  PRIMARY KEY (zone_id, item_id)
);
