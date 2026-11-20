-- 05 v1.0.24 §5 (owner ruling R-85, task 25): hub migration 0025_billing_z_reports_key. A business date may hold two
-- business days (closed and reopened on the same calendar date, 01a §6.18a), so z_reports is keyed by z_no and
-- business_date is a plain index (the Z list filters by it). SQLite cannot change a primary key, so the table is
-- rebuilt with every row copied (the 0011 pattern); no other table refers to it. 0023_billing.sql is never edited.
CREATE TABLE z_reports_v2 (
  z_no          INTEGER PRIMARY KEY,
  business_date TEXT NOT NULL,
  issued_at     INTEGER NOT NULL,
  report_json   TEXT NOT NULL
);
INSERT INTO z_reports_v2 (z_no, business_date, issued_at, report_json)
  SELECT z_no, business_date, issued_at, report_json FROM z_reports;
DROP TABLE z_reports;
ALTER TABLE z_reports_v2 RENAME TO z_reports;
CREATE INDEX z_reports_day ON z_reports (business_date);
