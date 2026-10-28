-- 01a S18 (v1.0.1): tenants seeded before manage-stock existed get it on their default Owner and Manager roles.
-- Idempotent: ON CONFLICT skips a role that already has it; only a tenant that gained a row bumps directory_version,
-- so its hubs download the new grants (00 directory sync).
WITH granted AS (
  INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, approver_role_id)
  SELECT r.tenant_id, r.role_id, 'manage-stock', 'allowed', NULL
    FROM roles r
   WHERE r.name IN ('Owner', 'Manager')
  ON CONFLICT (tenant_id, role_id, permission) DO NOTHING
  RETURNING tenant_id)
UPDATE tenants SET directory_version = directory_version + 1
 WHERE tenant_id IN (SELECT tenant_id FROM granted);
