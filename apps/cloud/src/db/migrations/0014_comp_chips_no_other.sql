-- 01a v2.4.4 §5.2a (02b v1.0.11 §3.9; owner 2026-11-12 Q-19, Q-28): the comp reason chips default drops "Other"; the
-- staff client draws one fixed "Other" chip that sends reason_code 'other' with the required note. 0009_zones.sql stays
-- as merged; this migration sets the new column default and strips a stored "Other" (exact text, any case) from every
-- existing row, keeping the order of the other labels. A row left empty takes the new default, since
-- comp_reason_chips_valid (0009) needs 1–10 labels. Numbered 0014: module-04 holds 0013_void_defaults_backfill.sql.
-- Only a branch whose chips changed bumps config_version, once, so its hub receives the list (as 0012, AD-9).
-- No audit row and updated_at untouched: a migration is not an owner write.
ALTER TABLE branch_engine_settings
  ALTER COLUMN comp_reason_chips SET DEFAULT ARRAY['Late','Wrong item','Quality','Guest'];

WITH changed AS (
  UPDATE branch_engine_settings s
     SET comp_reason_chips = COALESCE(
           NULLIF(ARRAY(SELECT u.c FROM unnest(s.comp_reason_chips) WITH ORDINALITY AS u(c, n)
                         WHERE lower(u.c) <> 'other' ORDER BY u.n), '{}'::TEXT[]),
           ARRAY['Late','Wrong item','Quality','Guest'])
   WHERE EXISTS (SELECT 1 FROM unnest(s.comp_reason_chips) AS x(c) WHERE lower(x.c) = 'other')
  RETURNING s.tenant_id, s.branch_id)
UPDATE branches b SET config_version = b.config_version + 1
  FROM changed c
 WHERE b.tenant_id = c.tenant_id AND b.branch_id = c.branch_id;
