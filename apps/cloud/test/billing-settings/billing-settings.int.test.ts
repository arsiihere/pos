import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BILLING_MIN_EFFECTIVE_FROM,
  defaultBillingSettings,
  JURISDICTION_SEEDS,
  RATE_BP_TAX_CODE,
  type BillingSettings,
  type JurisdictionRuleValues,
} from '@pos/events';
import { issueRegistrationCode } from '../../src/cli/issue-registration-code';
import { seedTenant } from '../../src/cli/seed-tenant';
import { SystemContext } from '../../src/cli/system-context';
import { fixedClock } from '../../src/lib/clock';
import { loadCloudEnv } from '../../src/lib/env';
import { testIdGen, type IdGen } from '../../src/lib/ids';
import { cryptoSecrets, testSecrets } from '../../src/lib/secrets';
import { buildBillingSnapshot } from '../../src/modules/billing-settings/service';
import { buildSnapshot } from '../../src/modules/config-sync/builder';
import { buildCloudServer } from '../../src/server';
import { legacyToken } from '../helpers/legacy-token';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 05 §4.5 rows A-1 / A-2 (01a v2.6 §5.2b, §6.25, §6.26), plan P0.9b: the 0014 catalog and its seeds, the
// mixed_class_rule CHECK, the billing settings GET / PUT with the A-2 checks, the jurisdiction catalog GET and the
// snapshot `billing` key. A scratch database of its own (migrated to 0014): the shared test DB is truncated by other
// files (truncateAll), which would empty the seeded global catalog under this file. Tenants, emails and ids are unique.

const env = loadCloudEnv({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://pos:pos@127.0.0.1:5433/pos_test',
  JWT_SECRET: 'j'.repeat(32),
  REFRESH_TOKEN_SECRET: 'r'.repeat(32),
  PORT: '3001',
  HUB_MIN_VERSION: '1.0.0',
});
const clock = fixedClock(1_761_000_000_000);
const run = randomBytes(4).toString('hex');

function seedIds(prefix: string): IdGen {
  const base = testIdGen();
  return { next: () => `${prefix}${run}${base.next()}` };
}

interface Tenant {
  tenantId: string;
  token: string;
  branchId: string;
  otherBranchId: string;
}

let pool: pg.Pool;
let app: FastifyInstance;
let pk: Tenant; // PKR tenant
let eu: Tenant; // EUR tenant
const sysIds = seedIds('Z');
// random codes: the test generator's bytes repeat after 256, and this file issues many codes
const sysSecrets = cryptoSecrets;

async function tenant(currency: string, label: string): Promise<Tenant> {
  const sys = new SystemContext(pool);
  const deps = { clock, ids: sysIds, secrets: sysSecrets };
  const t = await seedTenant(
    sys,
    { name: `Billing ${label} ${run}`, currency, ownerEmail: `billing-${label}-${run}@example.com`, ownerName: 'Ada', password: 'password-1', pin: '1234' },
    deps,
  );
  const a = await issueRegistrationCode(sys, { tenantId: t.tenant_id, branchName: `A ${run}` }, deps);
  const b = await issueRegistrationCode(sys, { tenantId: t.tenant_id, branchName: `B ${run}` }, deps);
  return {
    tenantId: t.tenant_id,
    branchId: a.branch_id,
    otherBranchId: b.branch_id,
    token: legacyToken({ env, clock }, { sub: t.user_id, tenant_id: t.tenant_id, allowed_branch_ids: [a.branch_id, b.branch_id] }),
  };
}

const auth = (t: Tenant) => ({ authorization: `Bearer ${t.token}` });
const url = (branchId: string) => `/v1/admin/branches/${branchId}/billing`;

async function get(t: Tenant, branchId = t.branchId) {
  return app.inject({ method: 'GET', url: url(branchId), headers: auth(t) });
}
async function put(t: Tenant, body: unknown, branchId = t.branchId) {
  return app.inject({ method: 'PUT', url: url(branchId), headers: auth(t), payload: body as object });
}
async function current(t: Tenant, branchId = t.branchId): Promise<BillingSettings & { version: string; branch_id: string }> {
  const res = await get(t, branchId);
  expect(res.statusCode).toBe(200);
  return res.json().data.billing;
}
function bodyOf(b: BillingSettings & { version: string; branch_id: string }, patch: Partial<BillingSettings> = {}) {
  const doc: Partial<typeof b> = { ...b };
  delete doc.version;
  delete doc.branch_id;
  return { expected_version: b.version, ...doc, ...patch };
}
async function taxClass(t: Tenant, id: string, rate_bp: number, archived = false) {
  await pool.query(
    `INSERT INTO tax_classes (tenant_id, tax_class_id, name, rate_bp, archived_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 1, 1)`,
    [t.tenantId, id, `Class ${id}`, rate_bp, archived ? 1 : null],
  );
}
async function configVersion(branchId: string): Promise<number> {
  const rows = await pool.query<{ v: string }>(`SELECT config_version AS v FROM branches WHERE branch_id = $1`, [branchId]);
  return Number(rows.rows[0]!.v);
}
function pkPb(b: BillingSettings & { version: string; branch_id: string }, patch: Partial<BillingSettings> = {}) {
  return bodyOf(b, {
    jurisdiction_id: 'PK-PB',
    payment_modes: [{ ...b.payment_modes[0]!, authority_codes: [{ adapter_key: 'PRA', code: '1' }] }],
    fiscal: { ...b.fiscal, pos_ids: [{ pos_id: 'P1', label: 'Counter' }], default_pos_id: 'P1' },
    ...patch,
  });
}

beforeAll(async () => {
  ({ pool } = await scratchDatabaseAt(14));
  app = buildCloudServer({ pool, env, clock, ids: seedIds('A'), secrets: testSecrets() });
  await app.ready();
  pk = await tenant('PKR', 'pk');
  eu = await tenant('EUR', 'eu');
}, 60_000);

afterAll(async () => {
  await app?.close();
  await dropScratchDatabases();
});

// ---------------------------------------------------------------------------------------------------- 0014 catalog

async function seededRule(id: 'none' | 'PK'): Promise<JurisdictionRuleValues> {
  const rows = await pool.query(
    `SELECT j.jurisdiction_id, j.adapter_key, j.currency_code, r.prices_include_tax, r.rounding_step_minor, r.rounding_mode,
            r.rounding_applies_to, r.mixed_class_rule, r.buyer_id, r.receipt_fiscal, r.catch_up_window_ms, r.credit_support
       FROM jurisdictions j JOIN jurisdiction_rules r USING (jurisdiction_id) WHERE j.jurisdiction_id = $1`,
    [id],
  );
  expect(rows.rows).toHaveLength(1);
  const r = rows.rows[0];
  return { ...r, catch_up_window_ms: r.catch_up_window_ms === null ? null : Number(r.catch_up_window_ms) };
}

describe('[05 row A-1 (2)] 0014 jurisdiction catalog', () => {
  it('[05 row A-1 H11-5] the seeded none and PK rows equal the shared seed constant', async () => {
    expect(await seededRule('none')).toEqual(JURISDICTION_SEEDS.none);
    expect(await seededRule('PK')).toEqual(JURISDICTION_SEEDS.PK);
    const dates = await pool.query(`SELECT jurisdiction_id, effective_from::text AS d FROM jurisdiction_rules WHERE jurisdiction_id IN ('none', 'PK') ORDER BY jurisdiction_id COLLATE "C"`);
    expect(dates.rows).toEqual([
      { jurisdiction_id: 'PK', d: BILLING_MIN_EFFECTIVE_FROM },
      { jurisdiction_id: 'none', d: BILLING_MIN_EFFECTIVE_FROM },
    ]);
  });

  it('[05 row A-1 (2)] PK-PB: adapter PRA, PKR, eIMS rules, PST on restaurant_service, digital 500 / cash 1600', async () => {
    const j = await pool.query(`SELECT adapter_key, currency_code FROM jurisdictions WHERE jurisdiction_id = 'PK-PB'`);
    expect(j.rows).toEqual([{ adapter_key: 'PRA', currency_code: 'PKR' }]);
    const r = await pool.query(`SELECT rounding_step_minor, buyer_id, receipt_fiscal, catch_up_window_ms::int AS cu FROM jurisdiction_rules WHERE jurisdiction_id = 'PK-PB'`);
    expect(r.rows[0]).toMatchObject({ rounding_step_minor: 100, cu: 604_800_000 });
    expect(r.rows[0].buyer_id.threshold_minor).toBe(5_000_000);
    expect(r.rows[0].buyer_id.accepted_types.map((t: { type: string }) => t.type)).toEqual(['CNIC', 'NTN']);
    expect(r.rows[0].receipt_fiscal).toMatchObject({ fiscal_number_label: 'PRA invoice no.', tax_reg_labels: [{ code: 'NTN', label: 'NTN' }], show_qr: true, buyer_id_on_receipt: true });
    expect(r.rows[0].receipt_fiscal.qr_url_template).toContain('{fiscal_number}');
    const p = await pool.query(`SELECT fiscal_category, seq, tax_code, label, compound FROM jurisdiction_profile_taxes`);
    expect(p.rows).toEqual([{ fiscal_category: 'restaurant_service', seq: 1, tax_code: 'PST', label: 'Punjab sales tax on services', compound: false }]);
    const rates = await pool.query(
      `SELECT payment_class, integration_status, effective_from::text AS d, rate_bp, notification_ref FROM jurisdiction_tax_rates ORDER BY payment_class`,
    );
    expect(rates.rows).toEqual([
      { payment_class: 'cash', integration_status: 'integrated', d: '2026-02-19', rate_bp: 1600, notification_ref: 'PRA.32-24/2026/1313' },
      { payment_class: 'digital', integration_status: 'integrated', d: '2026-02-19', rate_bp: 500, notification_ref: 'PRA.32-24/2026/1313' },
    ]);
  });

  it('[05 row A-2 H16-10] no seed row has pro_rata', async () => {
    const rows = await pool.query(`SELECT mixed_class_rule FROM jurisdiction_rules`);
    expect(rows.rows.length).toBe(3);
    expect(rows.rows.every((r) => r.mixed_class_rule === 'higher_rate')).toBe(true);
  });

  it('[05 #15 row A-2] a catalog row with pro_rata is refused by the 0014 CHECK', async () => {
    await expect(
      pool.query(
        `INSERT INTO jurisdiction_rules (jurisdiction_id, effective_from, prices_include_tax, rounding_step_minor, rounding_mode,
            rounding_applies_to, mixed_class_rule, buyer_id, credit_support)
         VALUES ('PK', '2030-01-01', false, 100, 'nearest', 'all', 'pro_rata', '{}', 'credit_invoice')`,
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'jurisdiction_rules_mixed_class_rule_check' });
  });

  it('[05 R-31 01a v2.7 §5.2b] fiscal_category CHECK ^[a-z][a-z0-9_]{0,39}$ on tax_classes and the catalog profile rows', async () => {
    // one rolled-back transaction, a savepoint per insert: nothing reaches the shared catalog of this file
    const client = await pool.connect();
    const attempt = async (sql: string, params: unknown[]) => {
      await client.query('SAVEPOINT s');
      try {
        await client.query(sql, params);
        await client.query('RELEASE SAVEPOINT s');
        return 'ok';
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT s');
        return (error as { code?: string }).code;
      }
    };
    const profile = (v: string) =>
      attempt(
        `INSERT INTO jurisdiction_profile_taxes (jurisdiction_id, fiscal_category, seq, tax_code, label, compound)
         VALUES ('PK', $1, 1, 'T', 'T', false)`,
        [v],
      );
    const taxClassRow = (v: string, i: number) =>
      attempt(
        `INSERT INTO tax_classes (tenant_id, tax_class_id, name, rate_bp, fiscal_category, created_at, updated_at)
         VALUES ($1, $2, $2, 0, $3, 1, 1)`,
        [pk.tenantId, `chk${run}${i}`, v],
      );
    try {
      await client.query('BEGIN');
      for (const [i, v] of ['', 'x'.repeat(41), 'Bad Value', '1abc'].entries()) {
        expect(await profile(v), v).toBe('23514');
        expect(await taxClassRow(v, i), v).toBe('23514');
      }
      expect(await profile('a' + 'x'.repeat(39))).toBe('ok');
      expect(await taxClassRow('a' + 'x'.repeat(39), 9)).toBe('ok');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

// ------------------------------------------------------------------------------------------- GET / PUT …/billing

describe('[05 row A-1 (4)] GET / PUT /v1/admin/branches/:branch_id/billing', () => {
  it('[05 row A-1 (3) (5)] with no saved document the GET answers the default document (PK for a PKR tenant, none otherwise)', async () => {
    const p = await current(pk);
    const { version, branch_id, ...doc } = p;
    expect(branch_id).toBe(pk.branchId);
    expect(version).toMatch(/^[0-9a-f]{64}$/);
    expect(doc).toEqual(defaultBillingSettings({ currency_code: 'PKR', currency_exponent: 2 }));
    expect((await current(eu)).jurisdiction_id).toBe('none');
  });

  it('[05 C2] another tenant’s branch → 404 BRANCH_NOT_FOUND on GET and PUT', async () => {
    const res = await get(pk, eu.branchId);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('BRANCH_NOT_FOUND');
    const p = await current(pk);
    const w = await put(pk, bodyOf(p), eu.branchId);
    expect(w.statusCode).toBe(404);
  });

  it('[05 row A-1 (4)] a PUT saves the document: new version, one config_audit row, a branch bump; GET returns it', async () => {
    const before = await current(pk, pk.otherBranchId);
    const v0 = await configVersion(pk.otherBranchId);
    const res = await put(pk, bodyOf(before, { max_discount_pct: 50 }), pk.otherBranchId);
    expect(res.statusCode).toBe(200);
    const saved = res.json().data.billing;
    expect(saved.max_discount_pct).toBe(50);
    expect(saved.version).not.toBe(before.version);
    expect(await current(pk, pk.otherBranchId)).toEqual(saved);
    expect(await configVersion(pk.otherBranchId)).toBe(v0 + 1);
    const audit = await pool.query(
      `SELECT action, entity_id, before, after FROM config_audit WHERE tenant_id = $1 AND entity = 'billing_settings' AND branch_id = $2`,
      [pk.tenantId, pk.otherBranchId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ action: 'create', entity_id: pk.otherBranchId });
    expect(audit.rows[0].after.max_discount_pct).toBe(50);
  });

  it('[05 row A-1 (4) S26] the same document again is a no-op: 200, no audit row, no bump', async () => {
    const b = await current(pk, pk.otherBranchId);
    const v0 = await configVersion(pk.otherBranchId);
    const res = await put(pk, bodyOf(b), pk.otherBranchId);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.billing.version).toBe(b.version);
    expect(await configVersion(pk.otherBranchId)).toBe(v0);
  });

  it('[05 row A-1 (4)] a stale expected_version → 409 CONFIG_STALE, nothing written', async () => {
    const b = await current(pk);
    const res = await put(pk, { ...bodyOf(b, { max_discount_pct: 10 }), expected_version: 'stale' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'billing_settings', id: pk.branchId } });
    expect((await current(pk)).version).toBe(b.version);
  });

  it('[05 row A-2 C6] a schema-invalid body → 400 VALIDATION_FAILED (duplicate key at <list>.N.<key>)', async () => {
    const b = await current(pk);
    const res = await put(pk, bodyOf(b, { discount_reasons: [{ code: 'x', label: 'X' }, { code: 'x', label: 'Y' }] }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.issues.map((i: { path: string }) => i.path)).toContain('discount_reasons.1.code');
  });

  it('[05 row A-1 (3) H16-13] rounding_step_minor above 10^(exponent + 4) → 400, by the tenant’s currency', async () => {
    const b = await current(pk);
    expect((await put(pk, bodyOf(b, { rounding_step_minor: 1_000_001 }))).statusCode).toBe(400);
  });

  it('[05 #14c] a jurisdiction whose currency is not the tenant’s → 422 currency_mismatch', async () => {
    const b = await current(eu);
    const res = await put(eu, bodyOf(b, { jurisdiction_id: 'PK' }));
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'jurisdiction_id', reason: 'currency_mismatch' } });
  });

  it('[05 row A-2 C1] an unknown jurisdiction_id → 422 not_found', async () => {
    const b = await current(pk);
    const res = await put(pk, bodyOf(b, { jurisdiction_id: 'XX' }));
    expect(res.json().error.details).toEqual({ field: 'jurisdiction_id', reason: 'not_found' });
  });

  it('[05 row A-2 R-13 G-11] PK-PB without fiscal.default_pos_id → 422 { field: fiscal.default_pos_id }', async () => {
    const b = await current(pk);
    const body = pkPb(b);
    const res = await put(pk, { ...body, fiscal: { ...body.fiscal, default_pos_id: null } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details).toEqual({ field: 'fiscal.default_pos_id' });
  });

  it('[05 row A-2 R-36] PK-PB with fiscal.integration_status not_integrated (no such catalog rate rows) → 422, nothing stored', async () => {
    const t = await tenant('PKR', `ri${run.slice(0, 2)}`);
    await pool.query(
      `INSERT INTO tax_classes (tenant_id, tax_class_id, name, rate_bp, fiscal_category, created_at, updated_at)
       VALUES ($1, $2, 'Food', 1600, 'restaurant_service', 1, 1)`,
      [t.tenantId, `tri${run}`],
    );
    const b = await current(t);
    const v0 = await configVersion(t.branchId);
    const body = pkPb(b);
    const res = await put(t, { ...body, fiscal: { ...body.fiscal, integration_status: 'not_integrated' } });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'fiscal.integration_status' } });
    expect(res.json().error.details).toEqual({ field: 'fiscal.integration_status' });
    expect(await current(t)).toEqual(b);
    expect(await configVersion(t.branchId)).toBe(v0);
    const stored = await pool.query(`SELECT 1 FROM branch_billing_settings WHERE branch_id = $1`, [t.branchId]);
    expect(stored.rows).toHaveLength(0);
    const audit = await pool.query(`SELECT 1 FROM config_audit WHERE tenant_id = $1 AND entity = 'billing_settings'`, [t.tenantId]);
    expect(audit.rows).toHaveLength(0);
    // integrated (the catalog's rows) saves
    expect((await put(t, pkPb(b))).statusCode).toBe(200);
  });

  it('[05 row A-1 (3) J-5] PK-PB: an active mode with no PRA code on a fiscalized order type → payment_modes.N.authority_codes', async () => {
    const b = await current(pk);
    const res = await put(pk, pkPb(b, { payment_modes: b.payment_modes }));
    expect(res.json().error.details).toEqual({ field: 'payment_modes.0.authority_codes' });
  });

  it('[05 row A-2 C1] unknown service_charge_tax_profile_id / override tax_class_id → 422 not_found', async () => {
    const b = await current(pk);
    expect((await put(pk, bodyOf(b, { service_charge_tax_profile_id: 'nope' }))).json().error.details).toEqual({
      field: 'service_charge_tax_profile_id',
      reason: 'not_found',
    });
    const override = { tax_class_id: 'nope', tax_code: RATE_BP_TAX_CODE, payment_class: 'cash', integration_status: 'integrated', rate_bp: 100, effective_from: '2026-01-01', notification_ref: null } as const;
    expect((await put(pk, bodyOf(b, { rate_overrides: [override] }))).json().error.details).toEqual({
      field: 'rate_overrides.0.tax_class_id',
      reason: 'not_found',
    });
  });

  it('[05 row A-2] PK-PB with an active tax class that has no profile row there → 422 profile_missing with ids', async () => {
    await taxClass(pk, `tcm${run}`, 1600);
    await taxClass(pk, `tca${run}`, 1600, true);
    const b = await current(pk);
    const res = await put(pk, pkPb(b));
    expect(res.statusCode).toBe(422);
    // R-31 (01a v2.7 §5.2b): the check reads tax_classes.fiscal_category; these classes were inserted without one (NULL)
    expect(res.json().error.details).toEqual({ field: 'jurisdiction_id', reason: 'profile_missing', ids: [`tcm${run}`] });
  });

  it('[05 #14b] switching PK → none (another jurisdiction) sets fiscal.switched_at; keeping it keeps it', async () => {
    const t = await tenant('PKR', `sw${run.slice(0, 2)}`);
    const b = await current(t);
    expect(b.fiscal.switched_at).toBeNull();
    clock.set(1_761_000_060_000);
    const res = await put(t, bodyOf(b, { jurisdiction_id: 'none' }));
    expect(res.statusCode).toBe(200);
    const saved = res.json().data.billing;
    expect(saved.fiscal.switched_at).toBe(new Date(1_761_000_060_000).toISOString());
    clock.set(1_761_000_120_000);
    const again = await put(t, bodyOf(saved, { max_discount_pct: 20 }));
    expect(again.json().data.billing.fiscal.switched_at).toBe(saved.fiscal.switched_at);
    // a switched_at sent by the client is ignored (the service sets it)
    const sent = await put(t, bodyOf(again.json().data.billing, { fiscal: { ...saved.fiscal, switched_at: '2000-01-01T00:00:00.000Z' } }));
    expect(sent.json().data.billing.fiscal.switched_at).toBe(saved.fiscal.switched_at);
  });

  it('[05 row A-1 (3) B22] the document holds no secret field: an unknown key (token) is dropped, never stored', async () => {
    const b = await current(pk, pk.otherBranchId);
    const body = bodyOf(b, { max_discount_pct: 33 });
    const res = await put(pk, { ...body, fiscal: { ...body.fiscal, token: 'test-token' } }, pk.otherBranchId);
    expect(res.statusCode).toBe(200);
    const rows = await pool.query(`SELECT document::text AS d FROM branch_billing_settings WHERE branch_id = $1`, [pk.otherBranchId]);
    expect(rows.rows[0].d).not.toContain('test-token');
  });
});

// ------------------------------------------------------------------------------------- GET /v1/admin/jurisdictions

describe('[05 row A-1 (4)] GET /v1/admin/jurisdictions', () => {
  it('[05 row A-1 (4)] lists the catalog (rules, profile taxes, rates), filtered by jurisdiction_id', async () => {
    const all = await app.inject({ method: 'GET', url: '/v1/admin/jurisdictions', headers: auth(pk) });
    expect(all.statusCode).toBe(200);
    expect(all.json().data.jurisdictions.map((j: { jurisdiction_id: string }) => j.jurisdiction_id)).toEqual(['PK', 'PK-PB', 'none']);
    const one = await app.inject({ method: 'GET', url: '/v1/admin/jurisdictions?jurisdiction_id=PK-PB', headers: auth(pk) });
    const [j] = one.json().data.jurisdictions;
    expect(one.json().data.jurisdictions).toHaveLength(1);
    expect(j).toMatchObject({ jurisdiction_id: 'PK-PB', adapter_key: 'PRA', currency_code: 'PKR' });
    expect(j.rules[0]).toMatchObject({ effective_from: BILLING_MIN_EFFECTIVE_FROM, mixed_class_rule: 'higher_rate', rounding_step_minor: 100, catch_up_window_ms: 604_800_000 });
    expect(j.profile_taxes).toEqual([{ fiscal_category: 'restaurant_service', seq: 1, tax_code: 'PST', label: 'Punjab sales tax on services', compound: false }]);
    expect(j.tax_rates).toHaveLength(2);
    expect(j.tax_rates[0]).toMatchObject({ effective_from: '2026-02-19' });
  });

  it('[05 row A-1 (4)] needs a JWT', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/admin/jurisdictions' })).statusCode).toBe(401);
  });
});

// --------------------------------------------------------------------------------------------- snapshot `billing`

describe('[05 row A-1 (5)] snapshot billing key (buildBillingSnapshot)', () => {
  const classes = [{ tax_class_id: 'tc-food', name: 'Food', rate_bp: 1600 }];

  it('[05 row A-1 (5)] no saved document → no billing key (the hub uses its built-in defaults)', async () => {
    const t = await tenant('PKR', `ns${run.slice(0, 2)}`);
    expect(await buildBillingSnapshot(pool, { tenantId: t.tenantId, branchId: t.branchId, taxClasses: classes })).toBeUndefined();
  });

  it('[05 #14 G-3] PK: one TAX at rate_bp per class from the minimum date; null receipt_fiscal mapped; overrides beat the catalog', async () => {
    const t = await tenant('PKR', `pk${run.slice(0, 2)}`);
    await taxClass(t, 'tc-food', 1600);
    const b = await current(t);
    const override = { tax_class_id: 'tc-food', tax_code: RATE_BP_TAX_CODE, payment_class: 'cash', integration_status: 'integrated', rate_bp: 1500, effective_from: BILLING_MIN_EFFECTIVE_FROM, notification_ref: 'OWN-1' } as const;
    const res = await put(t, bodyOf(b, { rate_overrides: [override], rounding_step_minor: 500, prices_include_tax: true }));
    expect(res.statusCode).toBe(200);
    const s = (await buildBillingSnapshot(pool, { tenantId: t.tenantId, branchId: t.branchId, taxClasses: classes }))!;
    expect(s.jurisdiction).toMatchObject({ jurisdiction_id: 'PK', adapter_key: 'none', currency_code: 'PKR', currency_exponent: 2 });
    expect(s.jurisdiction.rules).toHaveLength(1);
    // the branch overrides are applied to every rule row (#14b)
    expect(s.jurisdiction.rules[0]).toMatchObject({ rounding_step_minor: 500, prices_include_tax: true, rounding_mode: 'nearest' });
    expect(s.jurisdiction.rules[0]!.receipt).toEqual({ fiscal_number_label: null, tax_reg_labels: [], show_qr: false, qr_url_template: null, buyer_id_on_receipt: false });
    const [tax] = s.tax_profiles[0]!.taxes;
    expect(s.tax_profiles[0]!.tax_class_id).toBe('tc-food');
    expect(tax).toMatchObject({ seq: 1, tax_code: RATE_BP_TAX_CODE, label: 'Food', compound: false });
    expect(tax!.rates).toHaveLength(4);
    expect(tax!.rates.find((r) => r.payment_class === 'cash' && r.integration_status === 'integrated')).toEqual({
      payment_class: 'cash',
      integration_status: 'integrated',
      effective_from: BILLING_MIN_EFFECTIVE_FROM,
      rate_bp: 1500,
      ref: 'OWN-1',
    });
    expect(tax!.rates.find((r) => r.payment_class === 'digital' && r.integration_status === 'integrated')!.rate_bp).toBe(1600);
    expect(s.rate_overrides).toEqual([override]);
  });

  it('[05 #14 row A-1 (5)] a later-dated override replaces the catalog only from its date: before it the catalog rate', async () => {
    const t = await tenant('PKR', `od${run.slice(0, 2)}`);
    const id = `tod${run}`;
    await pool.query(
      `INSERT INTO tax_classes (tenant_id, tax_class_id, name, rate_bp, fiscal_category, created_at, updated_at)
       VALUES ($1, $2, 'Food', 1600, 'restaurant_service', 1, 1)`,
      [t.tenantId, id],
    );
    const b = await current(t);
    const override = { tax_class_id: id, tax_code: 'PST', payment_class: 'cash', integration_status: 'integrated', rate_bp: 1200, effective_from: '2026-12-01', notification_ref: 'OWN-2' } as const;
    const res = await put(t, pkPb(b, { rate_overrides: [override] }));
    expect(res.statusCode, res.body).toBe(200);
    const taxClasses = [{ tax_class_id: id, name: 'Food', rate_bp: 1600, fiscal_category: 'restaurant_service' }];
    const s = (await buildBillingSnapshot(pool, { tenantId: t.tenantId, branchId: t.branchId, taxClasses }))!;
    const [pst] = s.tax_profiles[0]!.taxes;
    expect(pst!.tax_code).toBe('PST');
    // the hub picks the row with the latest effective_from ≤ the business date (compute.ts rateInForce)
    const at = (payment_class: 'cash' | 'digital', date: string) =>
      pst!.rates
        .filter((r) => r.payment_class === payment_class && r.integration_status === 'integrated' && r.effective_from <= date)
        .sort((x, y) => (x.effective_from < y.effective_from ? 1 : -1))[0];
    expect(at('cash', '2026-11-30')).toMatchObject({ rate_bp: 1600, ref: 'PRA.32-24/2026/1313' });
    expect(at('cash', '2026-12-01')).toMatchObject({ rate_bp: 1200, ref: 'OWN-2' });
    expect(at('cash', '2027-06-01')).toMatchObject({ rate_bp: 1200, ref: 'OWN-2' });
    expect(at('digital', '2027-06-01')).toMatchObject({ rate_bp: 500 });
    expect(pst!.rates).toHaveLength(3);
  });
});

// ------------------------------------------------------------------------- R-31 (01a v2.7): tax_classes.fiscal_category

describe('[05 R-31 01a v2.7] tax class fiscal_category', () => {
  async function createClass(t: Tenant, body: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/v1/admin/tax-classes',
      headers: { ...auth(t), 'idempotency-key': `01${cryptoSecrets.crockford(24)}` },
      payload: body,
    });
  }

  it('[05 R-31] the tax-class routes accept and return fiscal_category (POST, PATCH, menu GET); absent = null', async () => {
    const t = await tenant('PKR', `rt${run.slice(0, 2)}`);
    const created = await createClass(t, { name: 'Food', rate_bp: 1600, fiscal_category: 'restaurant_service' });
    expect(created.statusCode, created.body).toBe(201);
    const tc = created.json().data.tax_class;
    expect(tc.fiscal_category).toBe('restaurant_service');
    const plain = await createClass(t, { name: 'Plain', rate_bp: 500 });
    expect(plain.json().data.tax_class.fiscal_category).toBeNull();
    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/tax-classes/${tc.tax_class_id}`,
      headers: auth(t),
      payload: { fiscal_category: null },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json().data.tax_class.fiscal_category).toBeNull();
    const again = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/tax-classes/${tc.tax_class_id}`,
      headers: auth(t),
      payload: { fiscal_category: 'restaurant_service' },
    });
    expect(again.json().data.tax_class.fiscal_category).toBe('restaurant_service');
    const menu = await app.inject({ method: 'GET', url: '/v1/admin/menu', headers: auth(t) });
    expect(menu.statusCode, menu.body).toBe(200);
    const listed = menu.json().data.tax_classes.find((c: { tax_class_id: string }) => c.tax_class_id === tc.tax_class_id);
    expect(listed.fiscal_category).toBe('restaurant_service');
  });

  it('[05 R-31 #200] fiscal_category matches ^[a-z][a-z0-9_]{0,39}$, or null → else 400', async () => {
    const t = pk;
    for (const bad of ['', 'x'.repeat(41), 7, 'Bad Value', 'Restaurant']) {
      const res = await createClass(t, { name: `Bad ${String(bad).length}`, rate_bp: 0, fiscal_category: bad });
      expect(res.statusCode, String(bad)).toBe(400);
    }
    expect((await createClass(t, { name: `Max ${run}`, rate_bp: 0, fiscal_category: 'x'.repeat(40) })).statusCode).toBe(201);
  });

  it('[05 R-31 row A-2] PK-PB: an active class with fiscal_category restaurant_service saves; one without still gets profile_missing', async () => {
    const t = await tenant('PKR', `pm${run.slice(0, 2)}`);
    const food = (await createClass(t, { name: 'Food', rate_bp: 1600, fiscal_category: 'restaurant_service' })).json().data.tax_class;
    const b = await current(t);
    const ok = await put(t, pkPb(b));
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().data.billing.jurisdiction_id).toBe('PK-PB');
    const bare = (await createClass(t, { name: 'Bare', rate_bp: 1600 })).json().data.tax_class;
    const saved = ok.json().data.billing;
    const res = await put(t, bodyOf(saved, { max_discount_pct: 90 }));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details).toEqual({ field: 'jurisdiction_id', reason: 'profile_missing', ids: [bare.tax_class_id] });
    expect(food.tax_class_id).not.toBe(bare.tax_class_id);
  });

  it('[05 R-31 row A-1 (1), (5)] the branch snapshot carries tax_classes[].fiscal_category and the billing key with PST', async () => {
    const t = await tenant('PKR', `sn${run.slice(0, 2)}`);
    const food = (await createClass(t, { name: 'Food', rate_bp: 1600, fiscal_category: 'restaurant_service' })).json().data.tax_class;
    const none = await snapshotOf(t);
    expect(none.tax_classes).toEqual([{ tax_class_id: food.tax_class_id, name: 'Food', rate_bp: 1600, is_archived: false, fiscal_category: 'restaurant_service' }]);
    expect(none).not.toHaveProperty('billing');
    expect((await put(t, pkPb(await current(t)))).statusCode).toBe(200);
    const s = await snapshotOf(t);
    const billing = s.billing as { jurisdiction: { jurisdiction_id: string }; tax_profiles: Array<{ tax_class_id: string; taxes: Array<{ tax_code: string; rates: unknown[] }> }> };
    expect(billing.jurisdiction.jurisdiction_id).toBe('PK-PB');
    expect(billing.tax_profiles).toHaveLength(1);
    expect(billing.tax_profiles[0]).toMatchObject({ tax_class_id: food.tax_class_id, taxes: [{ tax_code: 'PST' }] });
    expect(billing.tax_profiles[0]!.taxes[0]!.rates).toHaveLength(2);
  });
});

async function snapshotOf(t: Tenant): Promise<Record<string, unknown> & { tax_classes: unknown[]; billing?: unknown }> {
  const client = await pool.connect();
  try {
    const header = { config_version: 1, currency_code: 'PKR', tax_enabled: true, day_stale_after_hours: 20, day_min_gap_hours: 4 };
    const ctx = Object.freeze({ tenantId: t.tenantId, branchIds: Object.freeze([t.branchId, t.otherBranchId]) });
    return (await buildSnapshot(client, ctx, t.branchId, header)) as Record<string, unknown> & { tax_classes: unknown[]; billing?: unknown };
  } finally {
    client.release();
  }
}
