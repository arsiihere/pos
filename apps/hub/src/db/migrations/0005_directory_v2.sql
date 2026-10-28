-- migrate:foreign-keys-off
-- 01b §5.2: directory v2 cache. role_permissions is rebuilt with scope and its approvers move to their own
-- table; every table here is a cache replaced whole by applyStaffDirectory, so the copy only keeps the hub
-- working until the first v2 apply.
CREATE TABLE role_permissions_v2 (
  role_id    TEXT NOT NULL REFERENCES roles(role_id),
  permission TEXT NOT NULL,
  grant_type TEXT NOT NULL CHECK (grant_type IN ('allowed','requires_approval')),
  scope      TEXT NOT NULL DEFAULT 'branch'
             CHECK (scope IN ('branch','own_tables','my_floors','my_team','my_stations')),
  PRIMARY KEY (role_id, permission));
INSERT INTO role_permissions_v2 (role_id, permission, grant_type)
  SELECT role_id, permission, grant_type FROM role_permissions;
CREATE TABLE role_permission_approvers (
  role_id TEXT NOT NULL, permission TEXT NOT NULL,
  approver_role_id TEXT NOT NULL REFERENCES roles(role_id),
  PRIMARY KEY (role_id, permission, approver_role_id),
  FOREIGN KEY (role_id, permission) REFERENCES role_permissions_v2(role_id, permission));
INSERT INTO role_permission_approvers (role_id, permission, approver_role_id)
  SELECT role_id, permission, approver_role_id FROM role_permissions WHERE approver_role_id IS NOT NULL;
DROP TABLE role_permissions;
ALTER TABLE role_permissions_v2 RENAME TO role_permissions;   -- also renames the approvers' foreign-key target

ALTER TABLE staff ADD COLUMN lead_staff_id TEXT;               -- no FK: a skipped lead reads as none (B18)
CREATE TABLE staff_floors (
  staff_id TEXT NOT NULL REFERENCES staff(staff_id), floor_id TEXT NOT NULL,
  PRIMARY KEY (staff_id, floor_id));
CREATE TABLE responsibilities (
  responsibility TEXT NOT NULL CHECK (responsibility IN ('count_stock')),
  station_id     TEXT NOT NULL,
  subject_kind   TEXT NOT NULL CHECK (subject_kind IN ('staff','role')),
  subject_id     TEXT NOT NULL,
  PRIMARY KEY (responsibility, station_id, subject_kind, subject_id));
