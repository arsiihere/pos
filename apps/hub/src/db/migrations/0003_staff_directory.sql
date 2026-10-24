CREATE TABLE staff (
  staff_id     TEXT PRIMARY KEY,
  branch_id    TEXT NOT NULL,
  display_name TEXT NOT NULL,
  pin_hash     TEXT NOT NULL
);
CREATE TABLE roles (
  role_id             TEXT    PRIMARY KEY,
  branch_id           TEXT    NOT NULL,
  name                TEXT    NOT NULL,
  session_idle_ttl_ms INTEGER NOT NULL CHECK (session_idle_ttl_ms > 0)
);
CREATE TABLE role_permissions (
  role_id          TEXT NOT NULL REFERENCES roles(role_id),
  permission       TEXT NOT NULL,
  grant_type       TEXT NOT NULL CHECK (grant_type IN ('allowed','requires_approval')),
  approver_role_id TEXT REFERENCES roles(role_id),
  CHECK ((grant_type = 'requires_approval') = (approver_role_id IS NOT NULL)),
  PRIMARY KEY (role_id, permission)
);
CREATE TABLE staff_roles (
  staff_id TEXT NOT NULL REFERENCES staff(staff_id),
  role_id  TEXT NOT NULL REFERENCES roles(role_id),
  PRIMARY KEY (staff_id, role_id)
);
CREATE TABLE staff_permission_denials (
  staff_id   TEXT NOT NULL REFERENCES staff(staff_id),
  permission TEXT NOT NULL,
  PRIMARY KEY (staff_id, permission)
);
CREATE TABLE staff_directory_meta (
  branch_id         TEXT    PRIMARY KEY,
  directory_version INTEGER NOT NULL,
  applied_at        INTEGER NOT NULL
);
