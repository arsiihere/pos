-- 05 §4.5 B-2 / 01b v1.10 §5.1b, §6.15 (gap G-13 / R-6: was 0017; G-27 idempotent): tenants seeded before 05 get the
-- default grants of the new `bills` permissions. By default_key, never by name (01b §3.8). Only active roles
-- (archived_at IS NULL): the grantee and the manager approver, since a migration bypasses checkGrants' archived rule;
-- a tenant without an active manager gets no requires_approval row (the allowed ones are still written).
-- Owner: every new permission. Manager: all but skip-blind-count and manage-fiscal-settings (Owner only, 05 OQ-3, H6-13).
-- Cashier: take-payment, manage-own-shift, open-cash-drawer, record-petty-cash allowed; apply-discount,
-- remove-service-charge, reopen-bill, remove-comp, close-without-buyer-id requires_approval by Manager.
-- Order taker: take-payment (own_tables), manage-own-shift.
-- Idempotent: ON CONFLICT skips a grant that exists (apply-discount already exists on Cashier and is kept; an owner's
-- choice is kept), approver rows are written only for the rows this run inserted, and only a tenant that changed bumps
-- directory_version, once, so its hubs download the new grants (00 directory sync). A second run changes nothing.
WITH defaults (default_key, permission, grant_type, scope) AS (
  VALUES
    ('owner', 'take-payment', 'allowed', 'branch'),
    ('owner', 'manage-own-shift', 'allowed', 'branch'),
    ('owner', 'close-shift-for-others', 'allowed', 'branch'),
    ('owner', 'skip-blind-count', 'allowed', 'branch'),
    ('owner', 'record-petty-cash', 'allowed', 'branch'),
    ('owner', 'remove-service-charge', 'allowed', 'branch'),
    ('owner', 'close-business-day', 'allowed', 'branch'),
    ('owner', 'open-cash-drawer', 'allowed', 'branch'),
    ('owner', 'remove-comp', 'allowed', 'branch'),
    ('owner', 'close-without-buyer-id', 'allowed', 'branch'),
    ('owner', 'manage-fiscal-settings', 'allowed', 'branch'),
    ('manager', 'take-payment', 'allowed', 'branch'),
    ('manager', 'manage-own-shift', 'allowed', 'branch'),
    ('manager', 'close-shift-for-others', 'allowed', 'branch'),
    ('manager', 'record-petty-cash', 'allowed', 'branch'),
    ('manager', 'remove-service-charge', 'allowed', 'branch'),
    ('manager', 'close-business-day', 'allowed', 'branch'),
    ('manager', 'open-cash-drawer', 'allowed', 'branch'),
    ('manager', 'remove-comp', 'allowed', 'branch'),
    ('manager', 'close-without-buyer-id', 'allowed', 'branch'),
    ('cashier', 'take-payment', 'allowed', 'branch'),
    ('cashier', 'manage-own-shift', 'allowed', 'branch'),
    ('cashier', 'open-cash-drawer', 'allowed', 'branch'),
    ('cashier', 'record-petty-cash', 'allowed', 'branch'),
    ('cashier', 'apply-discount', 'requires_approval', 'branch'),
    ('cashier', 'remove-service-charge', 'requires_approval', 'branch'),
    ('cashier', 'reopen-bill', 'requires_approval', 'branch'),
    ('cashier', 'remove-comp', 'requires_approval', 'branch'),
    ('cashier', 'close-without-buyer-id', 'requires_approval', 'branch'),
    ('order_taker', 'take-payment', 'allowed', 'own_tables'),
    ('order_taker', 'manage-own-shift', 'allowed', 'branch')),
wanted AS (
  SELECT r.tenant_id, r.role_id, d.permission, d.grant_type, d.scope, m.role_id AS manager_role_id
    FROM defaults d
    JOIN roles r ON r.default_key = d.default_key AND r.archived_at IS NULL
    LEFT JOIN roles m ON m.tenant_id = r.tenant_id AND m.default_key = 'manager' AND m.archived_at IS NULL),
-- step 1: dual-written approver_role_id only on requires_approval (CHECK 0001_platform.sql:41)
granted AS (
  INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, approver_role_id, scope)
  SELECT tenant_id, role_id, permission, grant_type,
         CASE WHEN grant_type = 'requires_approval' THEN manager_role_id END, scope
    FROM wanted
   WHERE grant_type = 'allowed' OR manager_role_id IS NOT NULL
  ON CONFLICT (tenant_id, role_id, permission) DO NOTHING
  RETURNING tenant_id, role_id, permission, grant_type, approver_role_id),
-- step 2: approver rows for exactly the returned requires_approval rows
approved AS (
  INSERT INTO role_permission_approvers (tenant_id, role_id, permission, approver_role_id)
  SELECT tenant_id, role_id, permission, approver_role_id FROM granted WHERE grant_type = 'requires_approval'
  RETURNING tenant_id)
-- step 3: one bump per tenant that changed
UPDATE tenants SET directory_version = directory_version + 1
 WHERE tenant_id IN (SELECT tenant_id FROM granted);
