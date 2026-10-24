CREATE TABLE schema_migrations (version INT PRIMARY KEY, name TEXT NOT NULL,
  checksum TEXT NOT NULL, applied_at BIGINT NOT NULL);

-- tenant-level (M16)
CREATE TABLE tenants (
  tenant_id TEXT PRIMARY KEY, name TEXT NOT NULL,
  currency_code TEXT NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  directory_version BIGINT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL);
CREATE TABLE owner_users (
  tenant_id TEXT NOT NULL REFERENCES tenants, user_id TEXT NOT NULL,
  email TEXT NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
  allowed_branch_ids TEXT[] NOT NULL,
  failed_login_count INT NOT NULL DEFAULT 0, login_window_started_at BIGINT,
  login_locked_until BIGINT,                                         -- M33
  created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, user_id));
CREATE UNIQUE INDEX owner_users_email ON owner_users (lower(email)); -- login lookup (pre-tenant)
CREATE TABLE owner_refresh_tokens (
  tenant_id TEXT NOT NULL, token_id TEXT NOT NULL, user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
  rotated_at BIGINT, revoked_at BIGINT,
  PRIMARY KEY (tenant_id, token_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES owner_users);
CREATE UNIQUE INDEX owner_refresh_tokens_hash ON owner_refresh_tokens (token_hash);  -- refresh lookup
CREATE INDEX owner_refresh_tokens_user ON owner_refresh_tokens (tenant_id, user_id)
  WHERE revoked_at IS NULL;                                          -- reuse → revoke all
CREATE TABLE staff (
  tenant_id TEXT NOT NULL REFERENCES tenants, staff_id TEXT NOT NULL,
  display_name TEXT NOT NULL, pin_hash TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, staff_id));
CREATE TABLE roles (                                                -- no is_admin_role (M57)
  tenant_id TEXT NOT NULL REFERENCES tenants, role_id TEXT NOT NULL, name TEXT NOT NULL,
  session_idle_ttl_ms INTEGER NOT NULL CHECK (session_idle_ttl_ms > 0),
  PRIMARY KEY (tenant_id, role_id));
CREATE TABLE role_permissions (
  tenant_id TEXT NOT NULL, role_id TEXT NOT NULL, permission TEXT NOT NULL,
  grant_type TEXT NOT NULL CHECK (grant_type IN ('allowed','requires_approval')),
  approver_role_id TEXT,
  CHECK ((grant_type = 'requires_approval') = (approver_role_id IS NOT NULL)),
  PRIMARY KEY (tenant_id, role_id, permission),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles,
  FOREIGN KEY (tenant_id, approver_role_id) REFERENCES roles (tenant_id, role_id));
CREATE TABLE staff_roles (
  tenant_id TEXT NOT NULL, staff_id TEXT NOT NULL, role_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, staff_id, role_id),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES staff, FOREIGN KEY (tenant_id, role_id) REFERENCES roles);
CREATE TABLE staff_permission_denials (
  tenant_id TEXT NOT NULL, staff_id TEXT NOT NULL, permission TEXT NOT NULL,
  PRIMARY KEY (tenant_id, staff_id, permission),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES staff);

-- branch-level
CREATE TABLE branches (
  tenant_id TEXT NOT NULL REFERENCES tenants, branch_id TEXT NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_hub','active')),
  hub_confirmed_at BIGINT,                                          -- M41
  CHECK ((status = 'active') = (hub_confirmed_at IS NOT NULL)),
  created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id));
CREATE UNIQUE INDEX branches_branch_id ON branches (branch_id);
CREATE TABLE staff_branches (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, staff_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, staff_id),                     -- directory build per branch
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches, FOREIGN KEY (tenant_id, staff_id) REFERENCES staff);
CREATE TABLE registration_codes (
  code_hash TEXT PRIMARY KEY,                                       -- exchange lookup (pre-tenant)
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('new_branch','replace_hub')),
  created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
  consumed_at BIGINT, consumed_attempt_id TEXT,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches);
CREATE INDEX registration_codes_branch ON registration_codes (tenant_id, branch_id)
  WHERE consumed_at IS NULL;                                        -- M22 reissue / confirm expire old codes
CREATE TABLE branch_api_keys (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, key_id TEXT NOT NULL,
  key_hash TEXT NOT NULL, created_at BIGINT NOT NULL, revoked_at BIGINT,
  PRIMARY KEY (tenant_id, key_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches);
CREATE UNIQUE INDEX branch_api_keys_hash ON branch_api_keys (key_hash);        -- sync auth (pre-tenant)
CREATE UNIQUE INDEX branch_api_keys_one_active
  ON branch_api_keys (tenant_id, branch_id) WHERE revoked_at IS NULL;          -- one live key per branch

-- idempotency_keys: moved to 01 (M69)
