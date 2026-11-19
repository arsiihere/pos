import { currencyExponent, DomainError } from '@pos/domain';
import {
  billingSettingsDocument,
  billingSettingsReferenceIssue,
  defaultBillingSettings,
  RATE_BP_TAX_CODE,
  rateBpRates,
  snapshotReceipt,
  type BillingSettings,
  type BillingSettingsWire,
  type PutBillingSettingsBodyShape,
  type SnapshotBilling,
} from '@pos/events';
import type pg from 'pg';
import type { z } from 'zod';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import type { TenantContext } from '../../db/tenant-scoped-repository.js';
import type { Clock } from '../../lib/clock.js';
import { writeConfigAudit } from '../../lib/config-audit.js';
import { bumpConfigVersion } from '../../lib/config-version.js';
import { inTransaction } from '../../lib/idempotency.js';
import type { IdGen } from '../../lib/ids.js';
import type { CloudTestHooks } from '../../server.js';
import { assertBranchAllowed } from '../restaurant/service.js';
import { billingSettingsVersion, plainDocument as plain } from './versions.js';
import { selectBilling, selectJurisdictions, selectSnapshotBilling, selectTaxClasses, upsertBilling } from './repository.js';

// 05 §4.5 rows A-1 (3)–(5), A-2 (01a v2.6 §5.2b, §6.25, §6.26): the branch billing settings document, the read-only
// jurisdiction catalog and the snapshot `billing` key. A branch with no saved document has the default document
// (`defaultBillingSettings`) and no `billing` key in its snapshot (the hub's built-in defaults equal it).

export interface BillingSettingsDeps {
  pool: pg.Pool;
  clock: Clock;
  ids: IdGen;
  testHooks?: CloudTestHooks;
}

export interface BillingOwnerRequest {
  tenant: TenantContext;
  ownerUserId: string;
}

function wire(branchId: string, document: BillingSettings): BillingSettingsWire {
  return { ...plain(document), branch_id: branchId, version: billingSettingsVersion(branchId, document) };
}

function documentOf(stored: { currency_code: string; document: BillingSettings | null }): BillingSettings {
  return (
    stored.document ??
    defaultBillingSettings({ currency_code: stored.currency_code, currency_exponent: currencyExponent(stored.currency_code) })
  );
}

// §6.25 GET: the path branch among the owner's (C2, no statement), then 1 statement.
export async function getBillingSettings(deps: BillingSettingsDeps, tenant: TenantContext, branchId: string) {
  assertBranchAllowed(tenant, branchId);
  const stored = await selectBilling(new TenantLevelRepository(tenant, deps.pool), branchId, { lock: false });
  if (stored === undefined) throw new DomainError('BRANCH_NOT_FOUND', { branch_id: branchId });
  return { billing: wire(branchId, documentOf(stored)) };
}

/**
 * §6.25 PUT, C4 order: (1) 400 schema (C6; the step bound by the tenant's exponent once the currency is read);
 * (2) 404 branch (C2: allowed branch, then the locked row); (3) 409 CONFIG_STALE; (4) the A-2 checks
 * (`billingSettingsReferenceIssue`: the catalog, the tenant's currency and tax classes); `fiscal.switched_at` is the
 * service's (set when jurisdiction_id changes, else kept); (5) no-op → 200 with the stored document; then upsert,
 * one `billing_settings` audit row (create / update), the branch bump (S8).
 */
export async function putBillingSettings(
  deps: BillingSettingsDeps,
  req: BillingOwnerRequest,
  branchId: string,
  body: z.infer<typeof PutBillingSettingsBodyShape>,
) {
  assertBranchAllowed(req.tenant, branchId);
  return inTransaction(deps.pool, async (client) => {
    const repo = new TenantLevelRepository(req.tenant, client);
    const stored = await selectBilling(repo, branchId, { lock: true });
    if (stored === undefined) throw new DomainError('BRANCH_NOT_FOUND', { branch_id: branchId });
    const { expected_version: expectedVersion, ...sent } = body;
    // Reading (C4 step 1 split): the route's Zod body checks every shape bound before the transaction; only the
    // exponent-dependent `rounding_step_minor` bound (1 … 10^(exponent + 4), H16-13) waits until here, because the
    // tenant's currency (hence its exponent) is read by `selectBilling` inside this transaction. So a body that fails
    // only that bound answers 404 for a foreign branch first, and takes the branch row lock before its 400.
    const parsed = billingSettingsDocument(currencyExponent(stored.currency_code)).safeParse(sent);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    const before = documentOf(stored);
    if (expectedVersion !== billingSettingsVersion(branchId, before)) {
      throw new DomainError('CONFIG_STALE', { entity: 'billing_settings', id: branchId });
    }
    const switched = parsed.data.jurisdiction_id !== before.jurisdiction_id;
    const after: BillingSettings = plain({
      ...parsed.data,
      fiscal: {
        ...parsed.data.fiscal,
        switched_at: switched ? new Date(deps.clock.branchNow()).toISOString() : before.fiscal.switched_at,
      },
    });
    const [jurisdiction] = await selectJurisdictions(client, after.jurisdiction_id);
    const taxClasses = await selectTaxClasses(repo);
    const issue = billingSettingsReferenceIssue(after, {
      tenant_currency_code: stored.currency_code,
      jurisdiction:
        jurisdiction === undefined
          ? null
          : {
              jurisdiction_id: jurisdiction.jurisdiction_id,
              adapter_key: jurisdiction.adapter_key,
              currency_code: jurisdiction.currency_code,
              tax_reg_codes: jurisdiction.rules.flatMap((r) => r.receipt_fiscal?.tax_reg_labels.map((l) => l.code) ?? []),
              profile_taxes: jurisdiction.profile_taxes,
              rate_integration_statuses: jurisdiction.tax_rates.map((r) => r.integration_status),
            },
      tax_classes: taxClasses,
    });
    if (issue !== null) throw new DomainError('CONFIG_REFERENCE_INVALID', { ...issue });
    if (stored.document !== null && billingSettingsVersion(branchId, after) === billingSettingsVersion(branchId, before)) {
      return { billing: wire(branchId, before) };
    }
    const now = deps.clock.branchNow();
    await upsertBilling(repo, branchId, after, now);
    await writeConfigAudit(
      repo,
      {
        actor: { kind: 'owner', ownerUserId: req.ownerUserId },
        entity: 'billing_settings',
        entityId: branchId,
        branchId,
        action: stored.document === null ? 'create' : 'update',
        before: stored.document,
        after,
      },
      deps,
    );
    await deps.testHooks?.beforeBump?.();
    await bumpConfigVersion(repo, { kind: 'branch', branchId });
    return { billing: wire(branchId, after) };
  });
}

// §6.26: read-only, global; 4 statements.
export async function listJurisdictions(deps: BillingSettingsDeps, jurisdictionId: string | undefined) {
  return { jurisdictions: await selectJurisdictions(deps.pool, jurisdictionId ?? null) };
}

/**
 * 05 §4.5 row A-1 (5) (01a v2.6 §4.3): the snapshot's optional `billing` key for a branch, or undefined when the
 * branch has no saved document (the hub then uses its built-in defaults, which equal the default document).
 * `jurisdiction.rules`: every effective_from row with the branch overrides applied (price mode, rounding step /
 * mode / applies_to) and `receipt_fiscal` mapped by `snapshotReceipt` (G-3). `tax_profiles`, per tax class given:
 * a jurisdiction with no profile rows → one `RATE_BP_TAX_CODE` tax at the class's rate_bp (§3.4); else the class's
 * `fiscal_category` profile list with its catalog rates (none for an unmapped class: the hub blocks it, §3.3 3a).
 * Rate overrides beat the catalog (#14) from their date on: for each (class, tax_code, payment_class,
 * integration_status) with overrides, the catalog rows dated before that key's earliest override stay (they still rule
 * the dates before it) and the rest are replaced by the override rows. 1 statement.
 */
export async function buildBillingSnapshot(
  db: pg.Pool | pg.PoolClient,
  o: {
    tenantId: string;
    branchId: string;
    taxClasses: ReadonlyArray<{ tax_class_id: string; name: string; rate_bp: number; fiscal_category?: string | null }>;
  },
): Promise<SnapshotBilling | undefined> {
  const repo = new TenantLevelRepository(Object.freeze({ tenantId: o.tenantId, branchIds: Object.freeze([o.branchId]) }), db);
  const stored = await selectSnapshotBilling(repo, o.branchId);
  if (stored === undefined || stored.document === null) return undefined;
  const settings = stored.document;
  const j = stored.jurisdiction;
  if (j === null) throw new Error(`jurisdiction ${settings.jurisdiction_id} missing from the catalog`);
  const rules = j.rules.map((r) => ({
    effective_from: r.effective_from,
    prices_include_tax: settings.prices_include_tax ?? r.prices_include_tax,
    rounding_step_minor: settings.rounding_step_minor ?? r.rounding_step_minor,
    rounding_mode: settings.rounding_method ?? r.rounding_mode,
    rounding_applies_to: settings.rounding_applies_to ?? r.rounding_applies_to,
    mixed_class_rule: 'higher_rate' as const,
    buyer_id: r.buyer_id,
    receipt: snapshotReceipt(r.receipt_fiscal),
    catch_up_window_ms: r.catch_up_window_ms === null ? null : Number(r.catch_up_window_ms),
    credit_support: r.credit_support,
    ref: r.ref,
  }));
  for (const r of j.rules) {
    if (r.mixed_class_rule !== 'higher_rate') throw new Error('only higher_rate is supported (row A-2)');
  }
  const rateBpRule = j.profile_taxes.length === 0;
  const tax_profiles = o.taxClasses.map((c) => {
    const taxes = rateBpRule
      ? [{ seq: 1, tax_code: RATE_BP_TAX_CODE, label: c.name, compound: false, rates: rateBpRates(c.rate_bp) }]
      : j.profile_taxes
          .filter((p) => p.fiscal_category === (c.fiscal_category ?? null))
          .map((p) => ({
            seq: p.seq,
            tax_code: p.tax_code,
            label: p.label,
            compound: p.compound,
            rates: j.tax_rates
              .filter((r) => r.fiscal_category === p.fiscal_category && r.tax_code === p.tax_code)
              .map((r) => ({
                payment_class: r.payment_class,
                integration_status: r.integration_status,
                effective_from: r.effective_from,
                rate_bp: r.rate_bp,
                ref: r.notification_ref,
              })),
          }));
    return {
      tax_class_id: c.tax_class_id,
      taxes: taxes.map((t) => {
        const overrides = settings.rate_overrides.filter((ov) => ov.tax_class_id === c.tax_class_id && ov.tax_code === t.tax_code);
        if (overrides.length === 0) return t;
        // per (payment_class, integration_status): the earliest override date (ISO dates compare as strings)
        const earliest = new Map<string, string>();
        for (const ov of overrides) {
          const key = `${ov.payment_class}|${ov.integration_status}`;
          const seen = earliest.get(key);
          if (seen === undefined || ov.effective_from < seen) earliest.set(key, ov.effective_from);
        }
        return {
          ...t,
          rates: [
            ...t.rates.filter((r) => {
              const from = earliest.get(`${r.payment_class}|${r.integration_status}`);
              return from === undefined || r.effective_from < from;
            }),
            ...overrides.map((ov) => ({
              payment_class: ov.payment_class,
              integration_status: ov.integration_status,
              effective_from: ov.effective_from,
              rate_bp: ov.rate_bp,
              ref: ov.notification_ref,
            })),
          ],
        };
      }),
    };
  });
  return {
    ...settings,
    jurisdiction: {
      jurisdiction_id: j.jurisdiction_id,
      adapter_key: j.adapter_key,
      currency_code: j.currency_code ?? stored.currency_code,
      currency_exponent: currencyExponent(stored.currency_code),
      rules,
    },
    tax_profiles,
  };
}

