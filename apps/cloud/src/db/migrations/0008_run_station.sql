-- 01b v1.5 B-4 (§3.6, §5.1): responsibility kind run_station, assigned per station like count_stock. The CHECK
-- widens in place: every existing row already satisfies it, so no row is touched.
ALTER TABLE responsibilities DROP CONSTRAINT responsibilities_responsibility_check;
ALTER TABLE responsibilities ADD CONSTRAINT responsibilities_responsibility_check
  CHECK (responsibility IN ('count_stock', 'run_station'));
