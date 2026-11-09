-- 01b v1.6 B-2 (02a v1.0 §3.6; 02p §11 #7), §5.2: hub copy of the order-taker assignments (directory v3). A cache
-- replaced whole by applyStaffDirectory, read whole by StaffDirectory.load (11 statements, AD-27), so no secondary
-- index. One branch per hub, so one person per zone and per table is the primary key.
CREATE TABLE staff_assignments (
  staff_id     TEXT NOT NULL REFERENCES staff(staff_id),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('zone','table')),
  subject_id   TEXT NOT NULL,
  PRIMARY KEY (subject_kind, subject_id));
