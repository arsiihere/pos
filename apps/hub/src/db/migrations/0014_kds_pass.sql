-- 03b v1.0.1 §5 (hub SQLite), verbatim. Projections kds_config and pass (reset) own these tables; device_roles writes
-- devices.point_id / lane_label (00 H-5, H-6). Times are recorded_at.
-- kds_config projection (with reset): StationScreenSet, StationCapacitySet, BusinessDayOpened
CREATE TABLE kds_station_settings (
  station_id   TEXT PRIMARY KEY,
  sound_volume INTEGER NOT NULL CHECK (sound_volume BETWEEN 0 AND 100)
);
CREATE TABLE station_lanes (
  station_id TEXT PRIMARY KEY,
  lanes_on   INTEGER,                            -- NULL = custom (manager, or no k matches)
  lane_count INTEGER NOT NULL
);

-- pass projection (with reset): ReadyToServe, ReadyToServeUndone, Handover, ReadyRetargeted, AlertClosed,
--   ItemServed, ItemReturned, ItemRemoved, ItemVoided, OrderCancelled
CREATE TABLE pass_orders (
  order_id       TEXT NOT NULL,
  point_id       TEXT NOT NULL,
  ready_at       INTEGER,
  ready_by       TEXT,
  ready_alert_id TEXT,                           -- open Ready alert, NULL when closed
  ready_table_id TEXT,
  PRIMARY KEY (order_id, point_id)
);
CREATE INDEX pass_orders_open ON pass_orders (ready_alert_id) WHERE ready_alert_id IS NOT NULL;   -- ticks, AlertClosed fold

CREATE TABLE pass_ready_lines (
  order_item_id TEXT NOT NULL,
  order_id      TEXT NOT NULL,
  point_id      TEXT NOT NULL,
  settled_at    INTEGER,
  PRIMARY KEY (order_id, point_id, order_item_id)
);
CREATE INDEX pass_ready_lines_item ON pass_ready_lines (order_item_id) WHERE settled_at IS NULL;  -- settle folds, UndoDone

CREATE TABLE handovers (
  handover_id          TEXT PRIMARY KEY,
  order_id             TEXT NOT NULL,
  point_id             TEXT NOT NULL,
  receiver_staff_id    TEXT NOT NULL,
  handed_at            INTEGER NOT NULL,
  open_lines           INTEGER NOT NULL CHECK (open_lines >= 0),   -- decremented by rows actually settled (§3.5)
  served_card_alert_id TEXT,
  card_closed_at       INTEGER
);
CREATE INDEX handovers_unsettled ON handovers (handed_at) WHERE open_lines > 0;              -- handoversDue (02b estimate)
CREATE INDEX handovers_card_open ON handovers (served_card_alert_id)
  WHERE served_card_alert_id IS NOT NULL AND card_closed_at IS NULL;                         -- pass_closures, AlertClosed fold

CREATE TABLE handover_lines (
  order_item_id TEXT PRIMARY KEY,
  handover_id   TEXT NOT NULL,
  settled_at    INTEGER
);
CREATE INDEX handover_lines_handover ON handover_lines (handover_id);                       -- handoversDue lines
