-- 01b v1.6 B-2 (02a v1.0 §3.6; 02p §11 #7), §5.1: order-taker assignments, per branch, one person per zone and per
-- table (§3.2 rule 7). Forward only, expand only (a new table). Rows go with the person's staff_branches row
-- (a removed branch) and are deleted when the person leaves (left_at). A zone or table archived later keeps its rows;
-- loadDirectory leaves it out (AD-24). No audit rows, no version bump: a migration is not an owner write.

CREATE TABLE staff_assignments (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, staff_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('zone','table')), subject_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, staff_id, subject_kind, subject_id),
  FOREIGN KEY (tenant_id, branch_id, staff_id) REFERENCES staff_branches (tenant_id, branch_id, staff_id) ON DELETE CASCADE);
-- one person per zone and per table (rows of people who left are deleted with left_at); the write checks it first,
-- under the tenant lock (B11), and this index is the backstop.
CREATE UNIQUE INDEX staff_assignments_one_person ON staff_assignments (tenant_id, branch_id, subject_kind, subject_id);
