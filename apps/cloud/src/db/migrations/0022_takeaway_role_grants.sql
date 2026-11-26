-- 01b v1.12 §5.1c (B-4, B-5; owner review OR-2, OR-7): cloud 0022, the next contiguous number on module-02b-tk (D6).
-- 01b v1.12 B-4 (owner review OR-2, owner correction 2026-11-24; 03b v1.0.16 §3.4): a new default role "Pass" for the
-- dedicated person who runs the Pass point. ⚠️ Changed by run 3 (R3-m-2): the Pass insert preserves all existing grants.
-- Only B-5 adds grants to existing roles (Owner and Manager). Cook keeps run-pass + reprint-ticket.
-- 01b v1.12 B-5 (owner review OR-7, 02b v1.0.25 §3.7a): Owner and Manager may approve handing over an unpaid order.
ALTER TABLE roles DROP CONSTRAINT roles_default_key_check;
ALTER TABLE roles ADD CONSTRAINT roles_default_key_check
  CHECK (default_key IN ('owner','manager','cashier','order_taker','waiter','cook','pass'));

-- Guard (0005 N6 pattern): a tenant with no Pass role whose active roles already use both "Pass" and "Pass point"
-- (roles_active_name, case-insensitive) is fixed by hand, then the migration is re-run.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(t.tenant_id, ', ' ORDER BY t.tenant_id) INTO bad
    FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.tenant_id = t.tenant_id AND r.default_key = 'pass')
     AND EXISTS (SELECT 1 FROM roles r WHERE r.tenant_id = t.tenant_id AND r.archived_at IS NULL AND lower(r.name) = 'pass')
     AND EXISTS (SELECT 1 FROM roles r WHERE r.tenant_id = t.tenant_id AND r.archived_at IS NULL AND lower(r.name) = 'pass point');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'takeaway_role_grants: tenants % have active roles named both "Pass" and "Pass point"; rename one by hand, then re-run', bad;
  END IF;
END $$;

-- One Pass role per tenant that has none (roles_default_key keeps it unique). A tenant that already has an active role
-- named "Pass" gets the name "Pass point" instead (the guard above makes that name free).
-- role_id: an opaque string (named departure, R2-m-4): ULIDs are minted by app code and SQL has none.
WITH new_roles AS (
  INSERT INTO roles (tenant_id, role_id, name, session_idle_ttl_ms, default_key)
  SELECT t.tenant_id, gen_random_uuid()::text,
         CASE WHEN EXISTS (SELECT 1 FROM roles r WHERE r.tenant_id = t.tenant_id AND r.archived_at IS NULL
                                                   AND lower(r.name) = 'pass')
              THEN 'Pass point' ELSE 'Pass' END,
         300000, 'pass'
    FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.tenant_id = t.tenant_id AND r.default_key = 'pass')
  RETURNING tenant_id, role_id),
pass_grants AS (
  INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, approver_role_id, scope)
  SELECT n.tenant_id, n.role_id, p.permission, 'allowed', NULL, 'branch'
    FROM new_roles n CROSS JOIN (VALUES ('run-pass'), ('mark-served'), ('reprint-ticket')) AS p(permission)
  RETURNING tenant_id),
hou_grants AS (
  INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, approver_role_id, scope)
  SELECT tenant_id, role_id, 'hand-over-unpaid', 'allowed', NULL, 'branch'
    FROM roles
   WHERE default_key IN ('owner', 'manager') AND archived_at IS NULL
  ON CONFLICT (tenant_id, role_id, permission) DO NOTHING
  RETURNING tenant_id)
UPDATE tenants SET directory_version = directory_version + 1
 WHERE tenant_id IN (SELECT tenant_id FROM pass_grants UNION SELECT tenant_id FROM hou_grants);
