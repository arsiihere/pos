-- 01b v1.13 (owner 2026-11-28 Q7): tenants seeded before the Cashier default gained boost-order get it on their active
-- default cashier role (allowed, branch), so the counter's "Customer is here — cook now" works (02b §6.6, 03a PK-5).
-- The 0020 pattern: seed-tenant never updates an existing tenant, hence this backfill. By default_key, never by name
-- (01b §3.8); an archived role is skipped. Idempotent: ON CONFLICT keeps any boost-order grant the role already has (the
-- owner's choice), and only a tenant that gained a row bumps directory_version, once, so its hubs download the grant.
WITH granted AS (
  INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, approver_role_id, scope)
  SELECT tenant_id, role_id, 'boost-order', 'allowed', NULL, 'branch'
    FROM roles
   WHERE default_key = 'cashier' AND archived_at IS NULL
  ON CONFLICT (tenant_id, role_id, permission) DO NOTHING
  RETURNING tenant_id)
UPDATE tenants SET directory_version = directory_version + 1
 WHERE tenant_id IN (SELECT tenant_id FROM granted);
