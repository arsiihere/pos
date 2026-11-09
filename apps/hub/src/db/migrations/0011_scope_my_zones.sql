-- migrate:foreign-keys-off
-- 01b v1.7 B-3 (§3.3, §5.2): scope my_zones. SQLite cannot alter a CHECK, so the cache table is rebuilt with the
-- widened CHECK and every row copied (the runner's foreign-keys-off recipe, as 0005; it runs foreign_key_check
-- before commit). Same columns, default and key as 0005. Only role_permission_approvers refers to it, by name:
-- dropping and renaming back keeps that foreign key pointing at role_permissions, and its rows are not touched.
CREATE TABLE role_permissions_v3 (
  role_id    TEXT NOT NULL REFERENCES roles(role_id),
  permission TEXT NOT NULL,
  grant_type TEXT NOT NULL CHECK (grant_type IN ('allowed','requires_approval')),
  scope      TEXT NOT NULL DEFAULT 'branch'
             CHECK (scope IN ('branch','own_tables','my_floors','my_team','my_stations','my_zones')),
  PRIMARY KEY (role_id, permission));
INSERT INTO role_permissions_v3 (role_id, permission, grant_type, scope)
  SELECT role_id, permission, grant_type, scope FROM role_permissions;
DROP TABLE role_permissions;
ALTER TABLE role_permissions_v3 RENAME TO role_permissions;
