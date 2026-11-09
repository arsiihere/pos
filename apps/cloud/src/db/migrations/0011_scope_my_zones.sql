-- 01b v1.7 B-3 (§3.3, §5.1): scope my_zones for manage-zone-stock. Expand only: the CHECK widens in place, every
-- existing row already satisfies it, so no row is touched. The column CHECK added in 0005 is named by Postgres.
ALTER TABLE role_permissions DROP CONSTRAINT role_permissions_scope_check;
ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_scope_check
  CHECK (scope IN ('branch','own_tables','my_floors','my_team','my_stations','my_zones'));
