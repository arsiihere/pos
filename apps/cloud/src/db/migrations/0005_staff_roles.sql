-- 01b §5.1: staff, roles, teams, responsibilities, owner password state, branch limits.
-- Expand + contract, roll forward only (B22). Any violating row aborts the whole migration.

-- staff (B3, B12, §3.2)
ALTER TABLE staff ALTER COLUMN pin_hash DROP NOT NULL;                       -- contract for rollback (B22): v1.4 code cannot read a NULL. B3
ALTER TABLE staff ADD COLUMN pin_set_at BIGINT;                              -- expand. "Set on 12 Oct"
ALTER TABLE staff ADD COLUMN left_at BIGINT;                                 -- expand
ALTER TABLE staff ADD CONSTRAINT staff_left CHECK (is_active = (left_at IS NULL));            -- contract (new CHECK on existing rows; all active)
ALTER TABLE staff ADD CONSTRAINT staff_name_len CHECK (char_length(display_name) BETWEEN 1 AND 40);  -- contract
CREATE INDEX staff_active ON staff (tenant_id, is_active, display_name);    -- §6.1 list by status, ordered by name

-- names unique per branch among active staff (B12): checked in the write (§6.2 rule 4), not by index,
-- because uniqueness spans staff × staff_branches; the tenants row lock (B11) serialises the check.

-- owner link and password state (B5, B7)
ALTER TABLE owner_users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;  -- expand
ALTER TABLE owner_users ADD COLUMN lock_notice_at BIGINT;                                -- expand
ALTER TABLE owner_users ADD COLUMN password_changed_at BIGINT;                           -- expand. audit and display (B5)
ALTER TABLE owner_users ADD COLUMN temp_password_expires_at BIGINT;                      -- expand. 24 h temporary password (B5)
ALTER TABLE owner_users ADD CONSTRAINT owner_users_temp_password
  CHECK (temp_password_expires_at IS NULL OR must_change_password);                     -- a temporary password is always a forced change
ALTER TABLE owner_users ADD COLUMN credential_version INT NOT NULL DEFAULT 0;            -- expand. B5 (review 2 N1): +1 on every change or reset
ALTER TABLE owner_refresh_tokens ADD COLUMN credential_version INT NOT NULL DEFAULT 0;   -- expand. N1: the owner's version when the token was issued
ALTER TABLE owner_users ADD COLUMN staff_id TEXT;                                        -- expand. B7 own-admin guard
ALTER TABLE owner_users ADD CONSTRAINT owner_users_staff
  FOREIGN KEY (tenant_id, staff_id) REFERENCES staff (tenant_id, staff_id);
CREATE UNIQUE INDEX owner_users_staff_once ON owner_users (tenant_id, staff_id)
  WHERE staff_id IS NOT NULL;                                                         -- one owner login per staff row (§6.15a)

-- roles (B13, B14, B17)
ALTER TABLE roles ADD COLUMN default_key TEXT
  CHECK (default_key IN ('owner','manager','cashier','order_taker','waiter','cook'));       -- expand. B17: stable handle; is_default = (default_key IS NOT NULL)
CREATE UNIQUE INDEX roles_default_key ON roles (tenant_id, default_key)
  WHERE default_key IS NOT NULL;                                             -- one role per key per tenant; later default-grant migrations look up by it
-- one-time backfill (review 1 M5), the last role-name match allowed (§3.8): per tenant and name, the oldest
-- role (smallest ULID role_id). 'Order taker' gets 'order_taker' (D-12). Waiter and Cook do not exist
-- before 01b and are not created here (B6: re-seeded). No grant changes.
UPDATE roles r SET default_key = m.default_key
  FROM (SELECT DISTINCT ON (tenant_id, name) tenant_id, role_id,
               CASE name WHEN 'Owner' THEN 'owner' WHEN 'Manager' THEN 'manager' WHEN 'Cashier' THEN 'cashier'
                         WHEN 'Order taker' THEN 'order_taker' END AS default_key
          FROM roles WHERE name IN ('Owner','Manager','Cashier','Order taker')
         ORDER BY tenant_id, name, role_id) m
 WHERE r.tenant_id = m.tenant_id AND r.role_id = m.role_id;
-- review 2 N6: abort loudly if any tenant would lack one of the four keys every v1.4 seed created
-- (e.g. the owner renamed "Manager" before this release). Fixed by hand, then the migration is re-run.
DO $$
DECLARE missing TEXT;
BEGIN
  SELECT string_agg(t.tenant_id || ': ' || k.key, ', ' ORDER BY t.tenant_id, k.key) INTO missing
    FROM tenants t
   CROSS JOIN (VALUES ('owner'), ('manager'), ('cashier'), ('order_taker')) AS k(key)
   WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.tenant_id = t.tenant_id AND r.default_key = k.key);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'default_key backfill incomplete (tenant: missing key): %', missing;
  END IF;
END $$;
ALTER TABLE roles ADD COLUMN archived_at BIGINT;                             -- expand
ALTER TABLE roles ADD CONSTRAINT roles_idle CHECK (session_idle_ttl_ms BETWEEN 60000 AND 14400000
                                                   AND session_idle_ttl_ms % 60000 = 0);  -- contract (whole minutes, m10)
ALTER TABLE roles ADD CONSTRAINT roles_name_len CHECK (char_length(name) BETWEEN 1 AND 40);          -- contract
CREATE UNIQUE INDEX roles_active_name ON roles (tenant_id, lower(name)) WHERE archived_at IS NULL;   -- CONFIG_NAME_TAKEN

-- grants (B2, B10): the approver list gets its own table. approver_role_id is dual-written with the first
-- approver (sorted) and its requires_approval ⇔ approver CHECK (role_permissions_check) is kept, so a
-- rolled-back v1.4 cloud still sends a valid approver (B22, review 1 M7). Dropped in a later release (§12.4).
ALTER TABLE role_permissions ADD COLUMN scope TEXT NOT NULL DEFAULT 'branch'
  CHECK (scope IN ('branch','own_tables','my_floors','my_team','my_stations'));          -- expand
CREATE TABLE role_permission_approvers (
  tenant_id TEXT NOT NULL, role_id TEXT NOT NULL, permission TEXT NOT NULL, approver_role_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, role_id, permission, approver_role_id),
  FOREIGN KEY (tenant_id, role_id, permission) REFERENCES role_permissions ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, approver_role_id) REFERENCES roles (tenant_id, role_id));
CREATE INDEX role_permission_approvers_approver
  ON role_permission_approvers (tenant_id, approver_role_id);                -- B14: "is this role an approver?"
INSERT INTO role_permission_approvers (tenant_id, role_id, permission, approver_role_id)
  SELECT tenant_id, role_id, permission, approver_role_id FROM role_permissions
   WHERE approver_role_id IS NOT NULL;                                        -- backfill (dev data only, B6)

-- teams (§3.5)
CREATE TABLE staff_leads (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, staff_id TEXT NOT NULL, lead_staff_id TEXT NOT NULL,
  CHECK (staff_id <> lead_staff_id),
  PRIMARY KEY (tenant_id, branch_id, staff_id),                              -- one lead per branch (Q18)
  FOREIGN KEY (tenant_id, branch_id, staff_id) REFERENCES staff_branches (tenant_id, branch_id, staff_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, branch_id, lead_staff_id) REFERENCES staff_branches (tenant_id, branch_id, staff_id));
CREATE INDEX staff_leads_lead ON staff_leads (tenant_id, branch_id, lead_staff_id);  -- B15 re-parent, loop walk

-- floors per person (B2)
CREATE TABLE staff_floors (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, staff_id TEXT NOT NULL, floor_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, staff_id, floor_id),
  FOREIGN KEY (tenant_id, branch_id, staff_id) REFERENCES staff_branches (tenant_id, branch_id, staff_id) ON DELETE CASCADE);

-- responsibilities (§3.6)
CREATE TABLE responsibilities (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  responsibility TEXT NOT NULL CHECK (responsibility IN ('count_stock')),
  station_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('staff','role')),
  subject_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, responsibility, station_id, subject_kind, subject_id));
CREATE INDEX responsibilities_subject ON responsibilities (tenant_id, subject_kind, subject_id);  -- leaver / role archive cleanup

-- branches (B16, B19, §6.9)
ALTER TABLE branches ADD COLUMN hub_last_seen_at BIGINT;                     -- expand. B19: every poll
ALTER TABLE branches ADD COLUMN hub_synced_at BIGINT;                        -- expand. B19: last 304 poll (hub up to date)
ALTER TABLE branches ADD CONSTRAINT branches_name_len CHECK (char_length(name) BETWEEN 1 AND 60);   -- contract
CREATE UNIQUE INDEX branches_name ON branches (tenant_id, lower(name));     -- contract (m9): §6.9 rename, issue-registration-code
UPDATE branches SET day_stale_after_hours = LEAST(day_stale_after_hours, 48),
                    day_min_gap_hours = LEAST(day_min_gap_hours, 12);        -- contract: clamp, runs first
ALTER TABLE branches DROP CONSTRAINT branches_day_stale_after_hours_check;
ALTER TABLE branches ADD CONSTRAINT branches_day_stale CHECK (day_stale_after_hours BETWEEN 1 AND 48);  -- contract
ALTER TABLE branches DROP CONSTRAINT branches_day_min_gap_hours_check;
ALTER TABLE branches ADD CONSTRAINT branches_day_gap CHECK (day_min_gap_hours BETWEEN 0 AND 12);        -- contract
-- branches_day_settings (stale > gap, 01a S33) is kept. The clamp keeps it true: before it, stale > gap;
-- if stale > 48 it becomes 48 and gap ≤ 12 < 48; if only gap > 12 it becomes 12 and stale > old gap > 12.

-- audit (01a S26 table, new entities and actions, B21)
ALTER TABLE config_audit DROP CONSTRAINT config_audit_entity_check;
ALTER TABLE config_audit ADD CONSTRAINT config_audit_entity_check CHECK (entity IN (
  'floor','table','station','batch_program','tax_class','category','menu_item','item_route','branch_settings',
  'staff','role','responsibility','branch','owner_user'));                    -- expand (widens)
ALTER TABLE config_audit DROP CONSTRAINT config_audit_action_check;
ALTER TABLE config_audit ADD CONSTRAINT config_audit_action_check CHECK (action IN (
  'create','update','archive','restore','route_set','route_removed',
  'pin_set','left','returned','reports_to_reassigned','password_change','password_reset'));  -- expand (widens)
