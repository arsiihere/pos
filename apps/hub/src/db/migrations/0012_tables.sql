-- 02a v1.1.1 §5 (hub SQLite), as specified there. One projection `tables` (T19) writes all four tables; only
-- 02a writes them. 02b reads seating_orders and seatings read-only.
CREATE TABLE seatings (
  seating_id        TEXT PRIMARY KEY,
  primary_table_id  TEXT NOT NULL,
  state             TEXT NOT NULL CHECK (state IN
                      ('SEATED','ORDERED','FOOD_ON_TABLE','BILL_REQUESTED','NEEDS_CLEANING','CLOSED')),
  holder_staff_id   TEXT NOT NULL,
  party_size        INTEGER,
  opened_at         INTEGER NOT NULL,
  bill_requested_at INTEGER,
  bill_closed       INTEGER NOT NULL DEFAULT 0 CHECK (bill_closed IN (0,1)),  -- sticky NEEDS_CLEANING
  closed_at         INTEGER,
  close_reason      TEXT CHECK (close_reason IN ('cleaned','left_without_order','merged'))
);
CREATE INDEX seatings_open ON seatings (state) WHERE state <> 'CLOSED';         -- table-map, catch-up

CREATE TABLE seating_tables (                     -- tables of OPEN seatings only
  table_id   TEXT PRIMARY KEY,                    -- one open seating per table (T2)
  seating_id TEXT NOT NULL,
  joined_at  INTEGER NOT NULL
);
CREATE INDEX seating_tables_seating ON seating_tables (seating_id);           -- merge, split, close

CREATE TABLE seating_orders (
  order_id   TEXT PRIMARY KEY,
  seating_id TEXT NOT NULL,
  served_any INTEGER NOT NULL DEFAULT 0 CHECK (served_any IN (0,1)),
  has_food   INTEGER NOT NULL DEFAULT 1 CHECK (has_food IN (0,1)),          -- ⚠️ Changed by 02b v1.0 (P-1d): from OrderPlaced.has_food
  cancelled  INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0,1))            -- fold of 02b's OrderCancelled
);
CREATE INDEX seating_orders_seating ON seating_orders (seating_id);           -- state, merge, split, counts, holdersOfOrders

CREATE TABLE table_locks (                        -- F §4.3; one per seating, keyed by its primary table
  table_id         TEXT PRIMARY KEY,
  seating_id       TEXT NOT NULL,
  staff_id         TEXT NOT NULL,
  device_id        TEXT NOT NULL,
  locked_at        INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  last_touch_at    INTEGER                        -- NULL until the first TableLockTouched (D61, G4-1 #27)
);
CREATE INDEX table_locks_seating ON table_locks (seating_id);                 -- activity fold by seating
