-- 01b v1.8.1 §6.15 (02b v1.0.11 §3.14; owner 2026-11-12 Q-23, Q-34): tenants seeded before the Cashier default gained
-- mark-served get it on their active default cashier role (allowed, branch); not boost-order. seed-tenant never updates
-- an existing tenant, hence this backfill (overrides B6's "no migration rewrites role grants" for this one grant).
-- By default_key, never by name (01b §3.8); an archived role is skipped, since a migration bypasses checkGrants.
-- Idempotent: ON CONFLICT keeps any mark-served grant the role already has (any grant_type or scope, the owner's
-- choice), and only a tenant that gained a row bumps directory_version, once, so its hubs download the new grant
-- (00 directory sync). No audit row: a migration is not an owner write. Pattern of module-04's 0013.
WITH granted AS (
  INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, approver_role_id, scope)
  SELECT tenant_id, role_id, 'mark-served', 'allowed', NULL, 'branch'
    FROM roles
   WHERE default_key = 'cashier' AND archived_at IS NULL
  ON CONFLICT (tenant_id, role_id, permission) DO NOTHING
  RETURNING tenant_id)
UPDATE tenants SET directory_version = directory_version + 1
 WHERE tenant_id IN (SELECT tenant_id FROM granted);
