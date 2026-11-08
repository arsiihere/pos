-- 01b v1.5 B-4 (§3.6, §5.2): responsibility kind run_station. SQLite cannot alter a CHECK, so the cache table is
-- rebuilt with the widened CHECK and every row copied. Same columns and key as 0005; no index, foreign key or
-- trigger refers to it.
CREATE TABLE responsibilities_v2 (
  responsibility TEXT NOT NULL CHECK (responsibility IN ('count_stock', 'run_station')),
  station_id     TEXT NOT NULL,
  subject_kind   TEXT NOT NULL CHECK (subject_kind IN ('staff','role')),
  subject_id     TEXT NOT NULL,
  PRIMARY KEY (responsibility, station_id, subject_kind, subject_id));
INSERT INTO responsibilities_v2 (responsibility, station_id, subject_kind, subject_id)
  SELECT responsibility, station_id, subject_kind, subject_id FROM responsibilities;
DROP TABLE responsibilities;
ALTER TABLE responsibilities_v2 RENAME TO responsibilities;
