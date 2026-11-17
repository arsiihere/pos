-- 00 v1.10 §5 (04 §4.5 H-1; gap G-1, G-2): the hub's never-deleted list of staff names, for audit and later reports
-- (04 §3.6; 05 / 07). Not a cache of the directory and not used for sign-in. Every directory apply upserts it.
CREATE TABLE staff_names (
  staff_id     TEXT    PRIMARY KEY,
  display_name TEXT    NOT NULL,
  updated_at   INTEGER NOT NULL          -- hub-clock ms (recorded_at timeline)
);
-- seed: a directory apply runs only when directory_version moves, so the migration fills it once.
-- Seed time (G-1): plain SQL has no hub clock, so the latest event's recorded_at (0 on an empty log).
-- Staff first, then no-pin: an id in both keeps the staff name (G-2, as the cache).
INSERT OR IGNORE INTO staff_names (staff_id, display_name, updated_at)
  SELECT staff_id, display_name, (SELECT COALESCE(MAX(recorded_at), 0) FROM events) FROM staff;
INSERT OR IGNORE INTO staff_names (staff_id, display_name, updated_at)
  SELECT staff_id, display_name, (SELECT COALESCE(MAX(recorded_at), 0) FROM events) FROM no_pin_staff;
