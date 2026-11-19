import type { BillingSettings, JurisdictionWire } from '@pos/events';
import type pg from 'pg';
import type { TenantSql } from '../../lib/config-version.js';

// 05 §4.5 rows A-1 (2), (3) (01a v2.6 §5.2b): the SQL of the billing settings module. Tenant SQL goes through
// TenantLevelRepository (`tenant_id = $1`); the jurisdiction catalog is global (read with a plain query).
// DATE columns are read as text (`YYYY-MM-DD`), BIGINT through Number().

export type Queryable = pg.Pool | pg.PoolClient;

export interface StoredBilling {
  currency_code: string;
  document: BillingSettings | null;
}

/** The tenant's currency and the branch's saved document (null = none saved); undefined = no such branch. 1 statement. */
export async function selectBilling(db: TenantSql, branchId: string, o: { lock: boolean }): Promise<StoredBilling | undefined> {
  // `FOR UPDATE OF b` serializes two PUTs of one branch on the branch row (the bump updates it anyway).
  const rows = await db.query<{ currency_code: string; document: BillingSettings | null }>(
    `SELECT t.currency_code, s.document
       FROM branches b
       JOIN tenants t ON t.tenant_id = b.tenant_id
       LEFT JOIN branch_billing_settings s ON s.tenant_id = b.tenant_id AND s.branch_id = b.branch_id
      WHERE b.tenant_id = $1 AND b.branch_id = $2${o.lock ? ' FOR UPDATE OF b' : ''}`,
    [branchId],
  );
  return rows[0];
}

export async function upsertBilling(db: TenantSql, branchId: string, document: BillingSettings, now: number): Promise<void> {
  await db.query(
    `INSERT INTO branch_billing_settings (tenant_id, branch_id, jurisdiction_id, document, created_at, updated_at)
     SELECT tenant_id, branch_id, $3, $4, $5, $5 FROM branches WHERE tenant_id = $1 AND branch_id = $2
     ON CONFLICT (tenant_id, branch_id)
     DO UPDATE SET jurisdiction_id = EXCLUDED.jurisdiction_id, document = EXCLUDED.document, updated_at = EXCLUDED.updated_at`,
    [branchId, document.jurisdiction_id, JSON.stringify(document), now],
  );
}

/** The tenant's tax classes, archived included, with their R-31 fiscal_category. 1 statement. */
export async function selectTaxClasses(
  db: TenantSql,
): Promise<Array<{ tax_class_id: string; is_archived: boolean; fiscal_category: string | null }>> {
  return db.query(
    `SELECT tax_class_id, archived_at IS NOT NULL AS is_archived, fiscal_category
       FROM tax_classes WHERE tenant_id = $1 ORDER BY tax_class_id`,
  );
}

type RuleRow = Omit<JurisdictionWire['rules'][number], 'catch_up_window_ms'> & {
  jurisdiction_id: string;
  catch_up_window_ms: string | number | null;
};

/** The catalog, all of it or one jurisdiction; 4 statements, whatever the size. */
export async function selectJurisdictions(db: Queryable, jurisdictionId: string | null): Promise<JurisdictionWire[]> {
  const filter = jurisdictionId === null ? '' : 'WHERE jurisdiction_id = $1';
  const params = jurisdictionId === null ? [] : [jurisdictionId];
  const heads = await db.query<{ jurisdiction_id: string; name: string; adapter_key: string; currency_code: string | null }>(
    `SELECT jurisdiction_id, name, adapter_key, currency_code FROM jurisdictions ${filter} ORDER BY jurisdiction_id COLLATE "C"`,
    params,
  );
  const rules = await db.query<RuleRow>(
    `SELECT jurisdiction_id, effective_from::text AS effective_from, prices_include_tax, rounding_step_minor, rounding_mode,
            rounding_applies_to, mixed_class_rule, buyer_id, receipt_fiscal, catch_up_window_ms, credit_support, ref
       FROM jurisdiction_rules ${filter} ORDER BY jurisdiction_id COLLATE "C", effective_from`,
    params,
  );
  const taxes = await db.query<JurisdictionWire['profile_taxes'][number] & { jurisdiction_id: string }>(
    `SELECT jurisdiction_id, fiscal_category, seq, tax_code, label, compound
       FROM jurisdiction_profile_taxes ${filter} ORDER BY jurisdiction_id COLLATE "C", fiscal_category COLLATE "C", seq`,
    params,
  );
  const rates = await db.query<JurisdictionWire['tax_rates'][number] & { jurisdiction_id: string }>(
    `SELECT jurisdiction_id, fiscal_category, tax_code, payment_class, integration_status, effective_from::text AS effective_from,
            rate_bp, notification_ref, source_note
       FROM jurisdiction_tax_rates ${filter}
      ORDER BY jurisdiction_id COLLATE "C", fiscal_category COLLATE "C", tax_code COLLATE "C", payment_class, integration_status, effective_from`,
    params,
  );
  return heads.rows.map((h) => ({
    ...h,
    rules: rules.rows
      .filter((r) => r.jurisdiction_id === h.jurisdiction_id)
      .map((row) => {
        const r = withoutJurisdiction(row);
        return {
        ...r,
        catch_up_window_ms: r.catch_up_window_ms === null ? null : Number(r.catch_up_window_ms),
        };
      }),
    profile_taxes: taxes.rows.filter((t) => t.jurisdiction_id === h.jurisdiction_id).map(withoutJurisdiction),
    tax_rates: rates.rows.filter((r) => r.jurisdiction_id === h.jurisdiction_id).map(withoutJurisdiction),
  }));
}

function withoutJurisdiction<T extends { jurisdiction_id: string }>(row: T): Omit<T, 'jurisdiction_id'> {
  const copy: Partial<T> = { ...row };
  delete copy.jurisdiction_id;
  return copy as Omit<T, 'jurisdiction_id'>;
}

/**
 * The snapshot builder's read: the tenant's currency, the branch's saved document and its jurisdiction with rules,
 * profile taxes and rates (the `JurisdictionWire` shape) — 1 statement, so the config builder's count stays fixed.
 * undefined = no such branch; `jurisdiction` null when no document is saved.
 */
export async function selectSnapshotBilling(
  db: TenantSql,
  branchId: string,
): Promise<{ currency_code: string; document: BillingSettings | null; jurisdiction: JurisdictionWire | null } | undefined> {
  const rows = await db.query<{ currency_code: string; document: BillingSettings | null; jurisdiction: JurisdictionWire | null }>(
    `SELECT t.currency_code, s.document,
            (SELECT jsonb_build_object(
                      'jurisdiction_id', j.jurisdiction_id, 'name', j.name, 'adapter_key', j.adapter_key,
                      'currency_code', j.currency_code,
                      'rules', COALESCE((SELECT jsonb_agg(to_jsonb(r) - 'jurisdiction_id' ORDER BY r.effective_from)
                                           FROM jurisdiction_rules r WHERE r.jurisdiction_id = j.jurisdiction_id), '[]'),
                      'profile_taxes', COALESCE((SELECT jsonb_agg(to_jsonb(p) - 'jurisdiction_id' ORDER BY p.fiscal_category, p.seq)
                                                   FROM jurisdiction_profile_taxes p WHERE p.jurisdiction_id = j.jurisdiction_id), '[]'),
                      'tax_rates', COALESCE((SELECT jsonb_agg(to_jsonb(x) - 'jurisdiction_id'
                                                              ORDER BY x.fiscal_category, x.tax_code, x.payment_class,
                                                                       x.integration_status, x.effective_from)
                                               FROM jurisdiction_tax_rates x WHERE x.jurisdiction_id = j.jurisdiction_id), '[]'))
               FROM jurisdictions j WHERE j.jurisdiction_id = s.jurisdiction_id) AS jurisdiction
       FROM branches b
       JOIN tenants t ON t.tenant_id = b.tenant_id
       LEFT JOIN branch_billing_settings s ON s.tenant_id = b.tenant_id AND s.branch_id = b.branch_id
      WHERE b.tenant_id = $1 AND b.branch_id = $2`,
    [branchId],
  );
  return rows[0];
}
