-- 04 §4.5 B-1 / 01b v1.9 §5.1a (gap G-20): tenants seeded before 04 get the void defaults on their default cashier and
-- order_taker roles; any move-item-to-stock requires_approval grant becomes allowed (B-2, allowed-only). By default_key,
-- never by name (01b §3.8). Steps 1-2 touch only active roles (archived_at IS NULL): the grantee and the manager
-- approver, since a migration bypasses checkGrants' archived rule; a tenant without an active manager gets no void-item.
-- Idempotent: ON CONFLICT skips a grant that exists (an owner's choice is kept), step 3 finds nothing on a second run,
-- and only a tenant that changed bumps directory_version, once, so its hubs download the new grants (00 directory sync).
WITH grantee AS (
  SELECT r.tenant_id, r.role_id, m.role_id AS manager_role_id
    FROM roles r
    LEFT JOIN roles m ON m.tenant_id = r.tenant_id AND m.default_key = 'manager' AND m.archived_at IS NULL
   WHERE r.default_key IN ('cashier', 'order_taker') AND r.archived_at IS NULL),
-- step 1: dual-written approver_role_id only on requires_approval (CHECK 0001_platform.sql:41)
granted AS (
  INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, approver_role_id, scope)
  SELECT tenant_id, role_id, 'void-item', 'requires_approval', manager_role_id, 'branch'
    FROM grantee WHERE manager_role_id IS NOT NULL
  UNION ALL
  SELECT tenant_id, role_id, 'move-item-to-stock', 'allowed', NULL, 'branch'
    FROM grantee
  ON CONFLICT (tenant_id, role_id, permission) DO NOTHING
  RETURNING tenant_id, role_id, permission, approver_role_id),
-- step 2: approver rows for exactly the returned void-item rows
approved AS (
  INSERT INTO role_permission_approvers (tenant_id, role_id, permission, approver_role_id)
  SELECT tenant_id, role_id, permission, approver_role_id FROM granted WHERE permission = 'void-item'
  RETURNING tenant_id),
-- step 3: allowed-only (B-2), every role, in one UPDATE with the CHECK pair; its approver rows go
converted AS (
  UPDATE role_permissions SET grant_type = 'allowed', approver_role_id = NULL
   WHERE permission = 'move-item-to-stock' AND grant_type = 'requires_approval'
  RETURNING tenant_id, role_id, permission),
unlinked AS (
  DELETE FROM role_permission_approvers x
   USING converted c
   WHERE x.tenant_id = c.tenant_id AND x.role_id = c.role_id AND x.permission = c.permission
  RETURNING x.tenant_id)
-- step 4: one bump per tenant that changed
UPDATE tenants SET directory_version = directory_version + 1
 WHERE tenant_id IN (SELECT tenant_id FROM granted UNION SELECT tenant_id FROM converted);
