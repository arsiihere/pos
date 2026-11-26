-- 03b v1.0.16 §5 (run 3 R3-M-9, R3-B-3): the R8 bag-ready epoch per takeaway / parking order, and the replayed explicit
-- Ready flag of a point Ready. Both are part of the resettable `pass` projection.

-- pass_bag_ready: one row per order with a running epoch (PassBagReadyChanged sets / replaces it, null deletes it).
-- alert_id is the order-level counter alert while it is open; its AlertClosed clears the link and keeps the epoch
-- (a carried, still-complete bag keeps its pair over day close).
CREATE TABLE pass_bag_ready (
  order_id            TEXT    PRIMARY KEY,
  bag_ready_since     INTEGER NOT NULL,
  bag_ready_window_ms INTEGER NOT NULL,
  alert_id            TEXT,
  point_id            TEXT    NOT NULL
);
CREATE INDEX pass_bag_ready_alert ON pass_bag_ready (alert_id) WHERE alert_id IS NOT NULL;   -- AlertClosed fold

-- ready_explicit: 1 when the point's latest Ready came from MarkReadyToServe (or its Undo's re-raise), i.e. its
-- ReadyToServe carries an alert_id; 0 for Handover's own Ready (alert_id null). Kept when the Ready's alert closes or
-- expires; cleared with the Ready by ReadyToServeUndone.
ALTER TABLE pass_orders ADD COLUMN ready_explicit INTEGER NOT NULL DEFAULT 0 CHECK (ready_explicit IN (0, 1));

-- ReadyToServe has history: refold the `pass` projection from seq 0 so every Ready gets its flag.
DELETE FROM projection_checkpoints WHERE projection = 'pass';
