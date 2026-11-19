-- 05 §4.5 rows A-1 (2), (3), A-2 (01a v2.6 §5.2b; ⚠️ P0.G R-6 / G-13: the number was 0016). The jurisdiction catalog
-- (global, versioned, seeded, read-only to owners) and the per-branch billing settings document.
-- The `none` and `PK` rule values equal @pos/events admin/jurisdiction-seeds.ts JURISDICTION_SEEDS (H11-5; a cloud test
-- asserts the seeded rows equal the constant). The seeds hold no effective_from: their rule rows take the minimum date
-- '0001-01-01' (BILLING_MIN_EFFECTIVE_FROM, G-23). Only confirmed rows are seeded; no row has pro_rata (H16-10).

CREATE TABLE jurisdictions (
  jurisdiction_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  adapter_key TEXT NOT NULL,
  currency_code CHAR(3) CHECK (currency_code ~ '^[A-Z]{3}$'));                -- NULL only for `none` = the tenant's

CREATE TABLE jurisdiction_rules (
  jurisdiction_id TEXT NOT NULL REFERENCES jurisdictions,
  effective_from DATE NOT NULL,
  prices_include_tax BOOLEAN NOT NULL,
  rounding_step_minor INT CHECK (rounding_step_minor >= 1),                   -- NULL = 1 minor unit = no rounding (H10-3)
  rounding_mode TEXT NOT NULL CHECK (rounding_mode IN ('nearest','down','up')),
  rounding_applies_to TEXT NOT NULL CHECK (rounding_applies_to IN ('all','cash')),
  mixed_class_rule TEXT NOT NULL,
  CONSTRAINT jurisdiction_rules_mixed_class_rule_check CHECK (mixed_class_rule = 'higher_rate'),  -- A-2 H16-10, §26
  buyer_id JSONB NOT NULL,                                                    -- { threshold_minor | null, accepted_types }
  receipt_fiscal JSONB,                                                       -- NULL = no fiscal fields (G-3 maps it)
  catch_up_window_ms BIGINT CHECK (catch_up_window_ms >= 0),
  credit_support TEXT NOT NULL CHECK (credit_support IN ('credit_invoice','none')),
  ref TEXT,
  PRIMARY KEY (jurisdiction_id, effective_from));

CREATE TABLE jurisdiction_profile_taxes (
  jurisdiction_id TEXT NOT NULL REFERENCES jurisdictions,
  fiscal_category TEXT NOT NULL CHECK (fiscal_category ~ '^[a-z][a-z0-9_]{0,39}$'),  -- as tax_classes (R-31)
  seq INT NOT NULL CHECK (seq BETWEEN 1 AND 4),
  tax_code TEXT NOT NULL,
  label TEXT NOT NULL,
  compound BOOLEAN NOT NULL,
  PRIMARY KEY (jurisdiction_id, fiscal_category, seq),
  UNIQUE (jurisdiction_id, fiscal_category, tax_code));

CREATE TABLE jurisdiction_tax_rates (
  jurisdiction_id TEXT NOT NULL,
  fiscal_category TEXT NOT NULL,
  tax_code TEXT NOT NULL,
  payment_class TEXT NOT NULL CHECK (payment_class IN ('cash','digital')),
  integration_status TEXT NOT NULL CHECK (integration_status IN ('integrated','not_integrated')),
  effective_from DATE NOT NULL,
  rate_bp INT NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  notification_ref TEXT,
  source_note TEXT,
  PRIMARY KEY (jurisdiction_id, fiscal_category, tax_code, payment_class, integration_status, effective_from),
  FOREIGN KEY (jurisdiction_id, fiscal_category, tax_code)
    REFERENCES jurisdiction_profile_taxes (jurisdiction_id, fiscal_category, tax_code));

INSERT INTO jurisdictions (jurisdiction_id, name, adapter_key, currency_code) VALUES
  ('none', 'No authority', 'none', NULL),
  ('PK', 'Pakistan (no authority)', 'none', 'PKR'),
  ('PK-PB', 'Punjab', 'PRA', 'PKR');

INSERT INTO jurisdiction_rules (jurisdiction_id, effective_from, prices_include_tax, rounding_step_minor, rounding_mode,
    rounding_applies_to, mixed_class_rule, buyer_id, receipt_fiscal, catch_up_window_ms, credit_support, ref) VALUES
  ('none', '0001-01-01', false, NULL, 'nearest', 'all', 'higher_rate',
   '{"threshold_minor": null, "accepted_types": []}', NULL, NULL, 'credit_invoice', NULL),
  ('PK', '0001-01-01', false, 100, 'nearest', 'all', 'higher_rate',
   '{"threshold_minor": null, "accepted_types": []}', NULL, NULL, 'credit_invoice', NULL),
  ('PK-PB', '0001-01-01', false, 100, 'nearest', 'all', 'higher_rate',
   '{"threshold_minor": 5000000, "accepted_types": [
      {"type": "CNIC", "label": "CNIC", "pattern": "^[0-9]{13}$", "strip": "-"},
      {"type": "NTN", "label": "NTN", "pattern": "^[A-Za-z0-9]{7,9}$", "strip": ""}]}',
   '{"fiscal_number_label": "PRA invoice no.", "tax_reg_labels": [{"code": "NTN", "label": "NTN"}], "show_qr": true,
     "qr_url_template": "https://reg.pra.punjab.gov.pk/IMSFiscalReport/SearchPOSInvoice_Report.aspx?PRAInvNo={fiscal_number}",
     "buyer_id_on_receipt": true}',
   604800000, 'credit_invoice', 'eIMS Rules 2019');

INSERT INTO jurisdiction_profile_taxes (jurisdiction_id, fiscal_category, seq, tax_code, label, compound) VALUES
  ('PK-PB', 'restaurant_service', 1, 'PST', 'Punjab sales tax on services', false);

INSERT INTO jurisdiction_tax_rates (jurisdiction_id, fiscal_category, tax_code, payment_class, integration_status,
    effective_from, rate_bp, notification_ref, source_note) VALUES
  ('PK-PB', 'restaurant_service', 'PST', 'digital', 'integrated', '2026-02-19', 500, 'PRA.32-24/2026/1313',
   'PRA restaurant service, card / wallet / QR'),
  ('PK-PB', 'restaurant_service', 'PST', 'cash', 'integrated', '2026-02-19', 1600, 'PRA.32-24/2026/1313',
   'PRA restaurant service, other payment');

-- ⚠️ R-31 (01a v2.7 §5.2b, owner 2026-11-19, option (a)): A-1 (1) `fiscal_category` on the tax class (05 tax profile):
-- `^[a-z][a-z0-9_]{0,39}$`, or NULL (no category; under a jurisdiction with profile rows an active class without one is
-- `profile_missing`). Existing rows stay NULL: no backfill, no bump. The tax-class routes take and return it; the
-- snapshot carries it.
ALTER TABLE tax_classes ADD COLUMN fiscal_category TEXT NULL CHECK (fiscal_category ~ '^[a-z][a-z0-9_]{0,39}$');

-- A-1 (3): one billing settings document per branch; no row = the default document (`defaultBillingSettings`).
-- The version is the document's content hash (01b B23 style), not a column. No secret in it (B22).
CREATE TABLE branch_billing_settings (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  jurisdiction_id TEXT NOT NULL REFERENCES jurisdictions,
  document JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, branch_id));

-- A-1 (4): the PUT writes a `billing_settings` audit row (S26). Actions unchanged.
ALTER TABLE config_audit DROP CONSTRAINT config_audit_entity_check;
ALTER TABLE config_audit ADD CONSTRAINT config_audit_entity_check CHECK (entity IN (
  'floor','table','station','batch_program','tax_class','category','menu_item','item_route','branch_settings',
  'staff','role','responsibility','branch','owner_user',
  'variant_group','stock_item','stock_item_branch','modifier_group','deal','deal_branch',
  'point','zone','billing_settings'));
