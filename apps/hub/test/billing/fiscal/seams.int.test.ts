// 05 plan §3 row 29b — the fiscal worker's real seams (`fiscalWorkerSeams` in src/billing/fiscal/worker.ts), over a
// real test hub: real events (task 5 builders, parsed by the writer), the real 0023 tables, the real `billing` fold
// (task 7), 29a's `runOnce` and the port registry with the test fake adapter. Spec 05 v1.0.7 §3.15, §5, §6.29, B19–B22,
// Appendix P.2 (the neutral submission); plan ⚠️ P0.G G-1, G-4, G-5, G-6, G-7. No timing asserts (03a AD-32).
import type { PosEvent } from '@pos/events';
import {
  FiscalNumberAssigned,
  FiscalSubmitRejected,
  InvoiceIssued,
  SnapshotBillingSchema,
  type BranchConfig,
  type EventDef,
  type EventDraft,
  type SnapshotBilling,
} from '@pos/events';
import { aBillReopened, anInvoiceCredited, anInvoiceIssued, aPaymentAdded, aPaymentRemoved } from '@pos/events/testing';
import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';
import { hubBilling } from '../../../src/billing/defaults';
import { fiscalAdapterFor, registerFiscalAdapter, resetFiscalAdapters, type FiscalSubmission } from '../../../src/billing/fiscal/port';
import {
  BACKOFF_MS,
  FISCAL_ERRORS,
  fiscalWorkerSeams,
  resetFiscalWorker,
  runOnce,
  shortCode,
  type FiscalWorkRow,
  type FiscalWorkerDeps,
} from '../../../src/billing/fiscal/worker';
import { swapBranchConfig } from '../../../src/sync/branch-config-holder';
import { createLogCapture } from '../../helpers/log-capture';
import { statementCounter } from '../../helpers/statement-counter';
import { createTestHub, type TestHub } from '../../helpers/test-hub';
import { fixtureMenu, openDay } from '../../orders/fixtures';
import { fakeAdapter, type FakeAdapter } from './fake-adapter';

const TOKEN = 'test-token';
const BUYER_ID = '3520212345678'; // a CNIC-shaped test value (13 digits); never in a log, event or table but its own
const BUYER_NAME = 'Test Buyer Name';
const SETTINGS = { shop_code: 'SHOP-1' };
/** A fresh fake per test (no script carried over), registered under the invoices' adapter key. */
let fake: FakeAdapter;

let hub: TestHub;
const commit = { failOnce: false };

afterEach(async () => {
  commit.failOnce = false;
  await hub.close();
  swapBranchConfig(null);
  resetFiscalAdapters();
  resetFiscalWorker();
});

/**
 * The branch billing document after a switch back to `PK` (adapter `none`, §3.15 Switch / #78): the FAKE rows still
 * pending are sent with `base_urls.FAKE` and `adapter_settings.FAKE` (H10-6), never the branch's current adapter's.
 */
function branchBilling(o: { adapterSettings?: Record<string, unknown> } = {}): SnapshotBilling {
  const pk = hubBilling({ currency_code: 'PKR', tax_classes: [], billing: undefined });
  return {
    ...pk.settings,
    fiscal: {
      ...pk.settings.fiscal,
      environment: 'sandbox',
      base_urls: { FAKE: { sandbox: 'https://fake.example/sandbox', production: 'https://fake.example/live' }, none: { sandbox: 'https://none.example/x' } },
      adapter_settings: { FAKE: o.adapterSettings ?? SETTINGS, none: {} },
    },
    jurisdiction: pk.jurisdiction,
    tax_profiles: [],
  };
}

async function start(o: { adapterSettings?: Record<string, unknown> } = {}): Promise<void> {
  hub = await createTestHub({
    testHooks: {
      beforeCommit: () => {
        if (commit.failOnce) {
          commit.failOnce = false;
          throw new Error('commit failed');
        }
      },
    },
  });
  const menu: BranchConfig = { ...fixtureMenu(), billing: SnapshotBillingSchema.parse(branchBilling(o)) };
  openDay(hub, { menu });
  fake = fakeAdapter({ key: 'FAKE', ordering: 'strict_per_pos_id', credentialNames: ['token'], settingsSchema: z.object({ shop_code: z.string() }).strict() });
  registerFiscalAdapter(fake);
  setCredential('POS-1');
}

function setCredential(pos_id: string): void {
  hub.deps.db
    .prepare('INSERT INTO fiscal_credentials (pos_id, name, token, set_at, set_by_staff_id) VALUES (?, ?, ?, ?, ?)')
    .run(pos_id, 'token', TOKEN, hub.clock.branchNow(), 'S_OWNER');
}

/** One writer transaction of `events` (task-5 builder events, parsed by the writer's parseEvent). */
function append(events: PosEvent[]): PosEvent[] {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  const drafts: EventDraft[] = events.map((e) => ({
    stream_type: e.stream_type,
    stream_id: e.stream_id,
    event_type: e.event_type,
    schema_version: e.schema_version,
    payload: e.payload,
    occurred_at: now,
    actor_id: 'S_CASHIER',
    device_id: 'D_FIXTURE',
  }));
  return hub.deps.writer.run((tx) => tx.append(drafts)).appended;
}

const ids = (n: number) => `01J0000000000000000000S${String(n).padStart(3, '0')}`;

/** A FAKE-fiscalized sale (builder defaults: one Karahi line, a service charge, one tax row incl. its tax). */
function sale(o: {
  n: number;
  pos_id?: string;
  payments: { payment_id: string; code?: string | null }[];
  bill_id?: string;
  has_buyer_id?: boolean;
}): Record<string, unknown> {
  const base = anInvoiceIssued().payload as Record<string, unknown> & { fiscal: Record<string, unknown> };
  return {
    invoice_id: ids(o.n),
    number: o.n,
    invoice_ref: `AC1-S${String(o.n).padStart(6, '0')}`,
    bill_id: o.bill_id ?? `BILL_${o.n}`,
    jurisdiction_id: 'TEST-J',
    payment_ids: o.payments.map((p) => p.payment_id),
    has_buyer_id: o.has_buyer_id ?? false,
    fiscal: {
      ...base.fiscal,
      adapter_key: 'FAKE',
      pos_id: o.pos_id ?? 'POS-1',
      seller_registrations: [{ code: 'NTN', number: '1234567' }],
      payment_codes: o.payments.filter((p) => p.code !== null).map((p) => ({ payment_id: p.payment_id, authority_code: p.code ?? '1' })),
    },
  };
}

function payment(payment_id: string, bill_id: string, o: { amount_minor: number; payment_class?: 'cash' | 'digital'; direction?: 'in' | 'out' }): PosEvent {
  const cls = o.payment_class ?? 'digital';
  return aPaymentAdded({
    stream_id: bill_id,
    payload: {
      payment_id,
      bill_id,
      mode_id: cls === 'cash' ? 'cash' : 'card',
      payment_class: cls,
      direction: o.direction ?? 'in',
      amount_minor: o.amount_minor,
      tendered_minor: null,
      change_minor: null,
    },
  });
}

/** Appends a sale invoice and returns its outbox row as the worker reads it. */
function issue(payload: Record<string, unknown>): FiscalWorkRow {
  const bill_id = payload['bill_id'] as string;
  append([anInvoiceIssued({ stream_id: bill_id, payload })]);
  return workRow(payload['invoice_id'] as string);
}

function workRow(invoice_id: string): FiscalWorkRow {
  return hub.deps.db
    .prepare(
      `SELECT invoice_id, ord, ref_invoice_id, jurisdiction_id, adapter_key, pos_id, attempts, next_try_at, in_flight_at
       FROM fiscal_outbox WHERE invoice_id = ?`,
    )
    .get(invoice_id) as FiscalWorkRow;
}

function setBuyer(invoice_id: string): void {
  hub.deps.db
    .prepare('INSERT INTO invoice_buyers (invoice_id, buyer_name, id_type, id_value) VALUES (?, ?, ?, ?)')
    .run(invoice_id, BUYER_NAME, 'CNIC', BUYER_ID);
}

/** The worker deps the hub boots with (index.ts startBillingWorkers), over this test hub. */
function workerDeps(log?: FiscalWorkerDeps['log']): FiscalWorkerDeps {
  return {
    db: hub.deps.db,
    clock: hub.clock,
    adapterFor: fiscalAdapterFor,
    loadSubmission: (row) => fiscalWorkerSeams.loadSubmission(hub.deps, row),
    onAnswer: (row, answer) => fiscalWorkerSeams.onAnswer(hub.deps, row, answer),
    ...(log === undefined ? {} : { log }),
  };
}

const outbox = (invoice_id: string) =>
  hub.deps.db.prepare('SELECT state, attempts, last_error, in_flight_at FROM fiscal_outbox WHERE invoice_id = ?').get(invoice_id) as {
    state: string;
    attempts: number;
    last_error: string | null;
    in_flight_at: number | null;
  };

const eventsOf = <P extends z.ZodType>(def: EventDef<P>) =>
  (
    hub.deps.db.prepare('SELECT stream_type, stream_id, actor_id, device_id, payload FROM events WHERE event_type = ? ORDER BY seq').all(def.eventType) as {
      stream_type: string;
      stream_id: string;
      actor_id: string | null;
      device_id: string;
      payload: string;
    }[]
  ).map((e) => ({ ...e, payload: JSON.parse(e.payload) as unknown }));

/** B19 / B22: every place a secret could leak to — the hub log and every table but the one that holds it. */
function leaksOf(secret: string): string[] {
  const places: string[] = [];
  if (hub.logs().includes(secret)) places.push('hub.logs()');
  const tables = hub.deps.db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('fiscal_credentials', 'invoice_buyers') ORDER BY name`)
    .pluck()
    .all() as string[];
  for (const t of tables) {
    if (JSON.stringify(hub.deps.db.prepare(`SELECT * FROM "${t}"`).all()).includes(secret)) places.push(`table ${t}`);
  }
  return places;
}

// ============================================================================================= loadSubmission

describe('[05 29b] loadSubmission builds the neutral submission (§3.15) from InvoiceIssued + invoice_buyers + fiscal_credentials', () => {
  it('[05 #74 seams half] a sale: every §3.15 field from the stored event, the buyer row, the row adapter config (H10-6)', async () => {
    await start();
    append([payment('PAY_1', 'BILL_1', { amount_minor: 695_500 })]);
    const row = issue(sale({ n: 1, payments: [{ payment_id: 'PAY_1', code: '2' }], has_buyer_id: true }));
    setBuyer(ids(1));
    fake.script({ outcome: 'ok', fiscal_number: 'FN-1', qr_payload: null });

    expect(await runOnce(workerDeps())).toBe(1);

    expect(fake.calls.map((c) => c.kind)).toEqual(['sale']);
    const sub: FiscalSubmission = fake.calls[0]!.sub;
    const inv = InvoiceIssued.payload.parse(anInvoiceIssued({ payload: sale({ n: 1, payments: [{ payment_id: 'PAY_1', code: '2' }], has_buyer_id: true }) }).payload);
    expect(sub).toEqual({
      idempotency_key: 'AC1-S000001',
      pos_id: 'POS-1',
      credentials: { token: TOKEN },
      jurisdiction_id: 'TEST-J',
      currency_code: 'PKR',
      currency_exponent: 2,
      prices_include_tax: false,
      seller: { branch_id: 'branch-1', tax_registrations: [{ code: 'NTN', number: '1234567' }] },
      // the row's adapter (FAKE), not the branch's current one (none)
      config: { environment: 'sandbox', base_url: 'https://fake.example/sandbox', settings: SETTINGS },
      invoice: {
        invoice_ref: 'AC1-S000001',
        issued_at: inv.issued_at,
        order_type: 'dine_in',
        lines: inv.lines.map((l) => ({
          order_item_id: l.order_item_id,
          item_id: l.item_id,
          tax_profile_id: l.tax_profile_id,
          fiscal_category: l.fiscal_category,
          name: l.name,
          units: l.units,
          unit_price_minor: l.unit_price_minor,
          base_minor: l.base_minor,
          discount_minor: l.discount_minor,
          taxes: l.taxes,
        })),
        service_charge: { amount_minor: 28_550, taxes: inv.service_charge!.taxes },
        subtotal_minor: 571_000,
        discount_minor: 0,
        tax_minor: 95_928,
        rounding_minor: 22,
        total_minor: 695_500,
        taxes: [{ tax_profile_id: 'TP1', tax_code: 'PST', payment_class: 'cash', rate_bp: 1_600, base_minor: 599_550, tax_minor: 95_928 }],
        payments: [{ authority_code: '2', payment_class: 'digital', direction: 'in', amount_minor: 695_500 }],
        buyer: { name: BUYER_NAME, tax_id: { type: 'CNIC', value: BUYER_ID } },
        buyer_id_refused: false,
      },
    });
    expect(row.ref_invoice_id).toBeNull();
  });

  it('[05 P0.G G-5] tax_minor = Σ the invoice tax rows incl. the service-charge taxes (not the line taxes alone)', async () => {
    await start();
    append([payment('PAY_1', 'BILL_1', { amount_minor: 695_500 })]);
    const row = issue(sale({ n: 1, payments: [{ payment_id: 'PAY_1' }] }));
    const loaded = await fiscalWorkerSeams.loadSubmission(hub.deps, row);
    if (!loaded.ok) throw new Error(loaded.error_code);
    const lineTax = loaded.submission.invoice.lines.flatMap((l) => l.taxes).reduce((s, t) => s + t.tax_minor, 0);
    expect(lineTax).toBe(91_360);
    expect(loaded.submission.invoice.tax_minor).toBe(95_928); // 91 360 + 4 568 (service charge)
    expect(loaded.submission.invoice.tax_minor).toBe(loaded.submission.invoice.taxes.reduce((s, t) => s + t.tax_minor, 0));
    expect(loaded.original).toBeNull();
    expect(loaded.submission.invoice.buyer).toBeNull(); // no invoice_buyers row
  });

  it('[05 P0.G G-6] payments join by payment_id in the invoice order, a removed payment still joins, never by invoice_id; a missing code is null (G-4)', async () => {
    await start();
    append([
      payment('PAY_A', 'BILL_1', { amount_minor: 100_000, payment_class: 'cash' }),
      payment('PAY_B', 'BILL_1', { amount_minor: 595_500 }),
      payment('PAY_X', 'BILL_1', { amount_minor: 50_000 }), // same bill, not on the invoice
    ]);
    append([aPaymentRemoved({ stream_id: 'BILL_1', payload: { payment_id: 'PAY_A', bill_id: 'BILL_1', amount_minor: 100_000, change_minor: 0 } })]);
    expect(hub.deps.db.prepare(`SELECT removed_at IS NOT NULL FROM bill_payments WHERE payment_id = 'PAY_A'`).pluck().get()).toBe(1);
    // invoice order B, A (not the insertion order); A has no code for FAKE
    const row = issue(sale({ n: 1, payments: [{ payment_id: 'PAY_B', code: '2' }, { payment_id: 'PAY_A', code: null }] }));
    // an invoice_id mark on another payment must not pull it in (never joined by invoice_id)
    hub.deps.db.prepare(`UPDATE bill_payments SET invoice_id = ? WHERE payment_id = 'PAY_X'`).run(ids(1));

    const loaded = await fiscalWorkerSeams.loadSubmission(hub.deps, row);
    if (!loaded.ok) throw new Error(loaded.error_code);
    expect(loaded.submission.invoice.payments).toEqual([
      { authority_code: '2', payment_class: 'digital', direction: 'in', amount_minor: 595_500 },
      { authority_code: null, payment_class: 'cash', direction: 'in', amount_minor: 100_000 },
    ]);
  });

  it("[05 P0.G G-6] a reopened bill's payments still join; a credit reads its original's buyer row, original ref / number / issued_at and pos_id", async () => {
    await start();
    setCredential('POS-2');
    append([payment('PAY_1', 'BILL_1', { amount_minor: 695_500 })]);
    issue(sale({ n: 1, pos_id: 'POS-2', payments: [{ payment_id: 'PAY_1', code: '2' }], has_buyer_id: true }));
    setBuyer(ids(1));
    fake.script({ outcome: 'ok', fiscal_number: 'FN-ORIG', qr_payload: 'QR-ORIG' });
    expect(await runOnce(workerDeps())).toBe(1);
    expect(outbox(ids(1)).state).toBe('acked');

    // ReopenBill's transaction: BillReopened clears bill_payments.invoice_id (§6.13), then the credit
    const orig = InvoiceIssued.payload.parse(
      anInvoiceIssued({ payload: sale({ n: 1, pos_id: 'POS-2', payments: [{ payment_id: 'PAY_1', code: '2' }], has_buyer_id: true }) }).payload,
    );
    const { discount_line_ids: _drop, ...copied } = orig;
    void _drop;
    append([
      aBillReopened({ stream_id: 'BILL_1', payload: { bill_id: 'BILL_1' } }),
      anInvoiceCredited({
        stream_id: 'BILL_1',
        payload: {
          ...copied,
          series: 'credit',
          invoice_id: ids(901),
          number: 1,
          invoice_ref: 'AC1-C000001',
          ref_invoice_id: ids(1),
          ref_invoice_ref: 'AC1-S000001',
          issued_at: orig.issued_at + 60_000,
          alert_id: null,
          closed_by: 'S_MANAGER',
        },
      }),
    ]);
    expect(hub.deps.db.prepare(`SELECT invoice_id FROM bill_payments WHERE payment_id = 'PAY_1'`).pluck().get()).toBeNull();
    const credit = workRow(ids(901));
    expect(credit).toMatchObject({ ref_invoice_id: ids(1), pos_id: 'POS-2', adapter_key: 'FAKE' });

    fake.script({ outcome: 'ok', fiscal_number: 'FN-CRED', qr_payload: null });
    expect(await runOnce(workerDeps())).toBe(1);
    expect(fake.calls.map((c) => c.kind)).toEqual(['sale', 'credit']);
    const sub = fake.calls[1]!;
    if (sub.kind !== 'credit') throw new Error('expected a credit');
    expect(sub.sub.original).toEqual({ invoice_ref: 'AC1-S000001', fiscal_number: 'FN-ORIG', issued_at: orig.issued_at });
    expect(sub.sub).toMatchObject({ idempotency_key: 'AC1-C000001', pos_id: 'POS-2', credentials: { token: TOKEN } });
    expect(sub.sub.invoice.invoice_ref).toBe('AC1-C000001');
    expect(sub.sub.invoice.payments).toEqual([{ authority_code: '2', payment_class: 'digital', direction: 'in', amount_minor: 695_500 }]);
    expect(sub.sub.invoice.buyer).toEqual({ name: BUYER_NAME, tax_id: { type: 'CNIC', value: BUYER_ID } });
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM invoice_buyers').pluck().get()).toBe(1); // no copy for the credit (H7-2)
    expect(outbox(ids(901)).state).toBe('acked');
  });

  it('[05 29b G-6] a payment_ids entry with no bill_payments row → invoice_missing, the row waits, nothing is sent (never a short payment list)', async () => {
    await start();
    append([payment('PAY_1', 'BILL_1', { amount_minor: 695_500 })]);
    const row = issue(sale({ n: 1, payments: [{ payment_id: 'PAY_1' }, { payment_id: 'PAY_GHOST' }] }));
    expect(await fiscalWorkerSeams.loadSubmission(hub.deps, row)).toEqual({ ok: false, error_code: 'invoice_missing' });
    expect(await runOnce(workerDeps())).toBe(0);
    expect(fake.calls).toEqual([]);
    expect(outbox(ids(1))).toMatchObject({ state: 'pending', last_error: 'invoice_missing' });
  });

  it('[05 #91 loadSubmission] statements: 3 for a sale and 3 for a credit, at 2 and at 5 lines / payments', async () => {
    await start();
    const base = anInvoiceIssued().payload as { lines: Record<string, unknown>[] };
    const counts: Record<string, number> = {};
    for (const n of [2, 5]) {
      const bill_id = `BILL_N${n}`;
      const pays = Array.from({ length: n }, (_, i) => `PAY_N${n}_${i}`);
      append(pays.map((p) => payment(p, bill_id, { amount_minor: 100 })));
      const lines = Array.from({ length: n }, (_, i) => ({ ...base.lines[0]!, order_item_id: `L_N${n}_${i}` }));
      const payload = { ...sale({ n, bill_id, payments: pays.map((payment_id) => ({ payment_id })), has_buyer_id: true }), lines };
      const row = issue(payload);
      setBuyer(ids(n));
      hub.deps.db.prepare(`UPDATE fiscal_outbox SET state = 'acked' WHERE invoice_id = ?`).run(ids(n)); // the credit may go
      const orig = InvoiceIssued.payload.parse(anInvoiceIssued({ payload }).payload);
      const { discount_line_ids: _x, ...copied } = orig;
      void _x;
      append([
        anInvoiceCredited({
          stream_id: bill_id,
          payload: { ...copied, series: 'credit', invoice_id: ids(900 + n), number: n, invoice_ref: `AC1-C00000${n}`, ref_invoice_id: ids(n), ref_invoice_ref: orig.invoice_ref, alert_id: null },
        }),
      ]);
      const credit = workRow(ids(900 + n));
      const counter = statementCounter(hub.deps.db);
      for (const [kind, r] of [['sale', row], ['credit', credit]] as const) {
        counter.reset();
        const loaded = await fiscalWorkerSeams.loadSubmission(hub.deps, r);
        if (!loaded.ok) throw new Error(loaded.error_code);
        expect(loaded.submission.invoice.lines).toHaveLength(n);
        expect(loaded.submission.invoice.payments).toHaveLength(n);
        expect(loaded.submission.invoice.buyer).not.toBeNull();
        counts[`${kind}@${n}`] = counter.count;
      }
    }
    expect(counts).toEqual({ 'sale@2': 3, 'credit@2': 3, 'sale@5': 3, 'credit@5': 3 });
  });

  it('[05 29b] an invalid adapter_settings blob for the row adapter → pending, last_error adapter_settings_invalid, no send (§3.15)', async () => {
    await start({ adapterSettings: { shop_code: 42 } });
    append([payment('PAY_1', 'BILL_1', { amount_minor: 695_500 })]);
    const row = issue(sale({ n: 1, payments: [{ payment_id: 'PAY_1' }] }));
    expect(await fiscalWorkerSeams.loadSubmission(hub.deps, row)).toEqual({ ok: false, error_code: 'adapter_settings_invalid' });
    expect(await runOnce(workerDeps())).toBe(0);
    expect(fake.calls).toEqual([]);
    expect(outbox(ids(1))).toMatchObject({ state: 'pending', last_error: 'adapter_settings_invalid' });
  });
});

// ================================================================================================= onAnswer

describe('[05 29b] onAnswer: one writer transaction appends FiscalNumberAssigned / FiscalSubmitRejected and moves the row', () => {
  it('[05 29b] ok → FiscalNumberAssigned (bill stream, hub actor), invoice number folded, row acked; in_flight_at / last_error cleared in the answer tx', async () => {
    await start();
    append([payment('PAY_1', 'BILL_1', { amount_minor: 695_500 })]);
    const row = issue(sale({ n: 1, payments: [{ payment_id: 'PAY_1' }] }));
    hub.deps.db.prepare(`UPDATE fiscal_outbox SET in_flight_at = 5, last_error = 'timeout' WHERE invoice_id = ?`).run(ids(1));

    await fiscalWorkerSeams.onAnswer(hub.deps, row, { outcome: 'ok', fiscal_number: 'FN-9', qr_payload: 'QR-9' });

    expect(eventsOf(FiscalNumberAssigned)).toEqual([
      { stream_type: 'bill', stream_id: 'BILL_1', actor_id: null, device_id: 'hub', payload: { invoice_id: ids(1), adapter_key: 'FAKE', pos_id: 'POS-1', fiscal_number: 'FN-9', qr_payload: 'QR-9' } },
    ]);
    expect(outbox(ids(1))).toEqual({ state: 'acked', attempts: 0, last_error: null, in_flight_at: null });
    expect(hub.deps.db.prepare('SELECT fiscal_number, qr_payload FROM invoices WHERE invoice_id = ?').get(ids(1))).toEqual({ fiscal_number: 'FN-9', qr_payload: 'QR-9' });
  });

  it('[05 29b] rejected → FiscalSubmitRejected (short code, http_status), row rejected, last_error = the code; never resent', async () => {
    await start();
    append([payment('PAY_1', 'BILL_1', { amount_minor: 695_500 })]);
    issue(sale({ n: 1, payments: [{ payment_id: 'PAY_1' }] }));
    fake.script({ outcome: 'rejected', error_code: 'bad_ntn', http_status: 422 });
    expect(await runOnce(workerDeps())).toBe(1);
    expect(eventsOf(FiscalSubmitRejected).map((e) => e.payload)).toEqual([{ invoice_id: ids(1), adapter_key: 'FAKE', error_code: 'bad_ntn', http_status: 422 }]);
    expect(eventsOf(FiscalNumberAssigned)).toEqual([]);
    expect(outbox(ids(1))).toEqual({ state: 'rejected', attempts: 0, last_error: 'bad_ntn', in_flight_at: null });
    hub.clock.advance(BACKOFF_MS[3] * 2);
    expect(await runOnce(workerDeps())).toBe(0);
    expect(fake.calls).toHaveLength(1);
  });

  it('[05 29b] duplicate with a number → FiscalNumberAssigned (qr null); without → FiscalSubmitRejected duplicate_no_number; an out-of-range http_status → null', async () => {
    await start();
    append([payment('PAY_1', 'BILL_1', { amount_minor: 1 }), payment('PAY_2', 'BILL_2', { amount_minor: 1 })]);
    const a = issue(sale({ n: 1, payments: [{ payment_id: 'PAY_1' }] }));
    const b = issue(sale({ n: 2, payments: [{ payment_id: 'PAY_2' }] }));
    await fiscalWorkerSeams.onAnswer(hub.deps, a, { outcome: 'duplicate', fiscal_number: 'FN-D' });
    await fiscalWorkerSeams.onAnswer(hub.deps, b, { outcome: 'duplicate', fiscal_number: null });
    expect(eventsOf(FiscalNumberAssigned).map((e) => e.payload)).toEqual([{ invoice_id: ids(1), adapter_key: 'FAKE', pos_id: 'POS-1', fiscal_number: 'FN-D', qr_payload: null }]);
    expect(eventsOf(FiscalSubmitRejected).map((e) => e.payload)).toEqual([{ invoice_id: ids(2), adapter_key: 'FAKE', error_code: 'duplicate_no_number', http_status: null }]);
    expect(outbox(ids(1)).state).toBe('acked');
    expect(outbox(ids(2))).toMatchObject({ state: 'rejected', last_error: 'duplicate_no_number' });

    append([payment('PAY_3', 'BILL_3', { amount_minor: 1 })]);
    const c = issue(sale({ n: 3, payments: [{ payment_id: 'PAY_3' }] }));
    await fiscalWorkerSeams.onAnswer(hub.deps, c, { outcome: 'rejected', error_code: 'weird', http_status: 99 });
    expect(eventsOf(FiscalSubmitRejected).map((e) => e.payload)).toContainEqual({ invoice_id: ids(3), adapter_key: 'FAKE', error_code: 'weird', http_status: null });
  });

  it('[05 #70 one event in the log] a COMMIT failure in the answer tx → no event, row pending in flight; the resend carries the same key; one FiscalNumberAssigned', async () => {
    await start();
    append([payment('PAY_1', 'BILL_1', { amount_minor: 695_500 })]);
    issue(sale({ n: 1, payments: [{ payment_id: 'PAY_1' }] }));
    fake.script({ outcome: 'ok', fiscal_number: 'FN-1', qr_payload: null }, { outcome: 'duplicate', fiscal_number: 'FN-1' });

    commit.failOnce = true; // the crash between the answer and its commit
    expect(await runOnce(workerDeps())).toBe(1);
    expect(eventsOf(FiscalNumberAssigned)).toEqual([]);
    const after = outbox(ids(1));
    expect(after).toMatchObject({ state: 'pending', attempts: 1, last_error: FISCAL_ERRORS.answer_not_committed });
    expect(after.in_flight_at).not.toBeNull();

    hub.clock.advance(BACKOFF_MS[0]);
    expect(await runOnce(workerDeps())).toBe(1);
    expect(fake.calls.map((c) => c.sub.idempotency_key)).toEqual(['AC1-S000001', 'AC1-S000001']);
    expect(eventsOf(FiscalNumberAssigned)).toHaveLength(1);
    expect(outbox(ids(1))).toMatchObject({ state: 'acked', last_error: null, in_flight_at: null });

    // a late repeat of the same answer (the row already left pending) appends nothing
    await fiscalWorkerSeams.onAnswer(hub.deps, workRow(ids(1)), { outcome: 'ok', fiscal_number: 'FN-1', qr_payload: null });
    expect(eventsOf(FiscalNumberAssigned)).toHaveLength(1);
    expect(await runOnce(workerDeps())).toBe(0);
  });
});

// =================================================================================== #71 end to end, privacy

describe('[05 #71 re-run end to end] order per pos_id over the real seams', () => {
  it('[05 #71] a backing-off head of POS-1 holds only POS-1; POS-2 without a credential holds nothing; a credit waits behind its original and steps aside', async () => {
    await start();
    setCredential('POS-3');
    append([
      payment('PAY_1', 'BILL_1', { amount_minor: 1 }),
      payment('PAY_2', 'BILL_2', { amount_minor: 1 }),
      payment('PAY_3', 'BILL_3', { amount_minor: 1 }),
      payment('PAY_4', 'BILL_4', { amount_minor: 1 }),
    ]);
    issue(sale({ n: 1, pos_id: 'POS-1', payments: [{ payment_id: 'PAY_1' }] })); // head of POS-1: retries
    issue(sale({ n: 2, pos_id: 'POS-2', payments: [{ payment_id: 'PAY_2' }] })); // no credential for POS-2
    issue(sale({ n: 3, pos_id: 'POS-1', payments: [{ payment_id: 'PAY_3' }] })); // waits behind n 1
    issue(sale({ n: 4, pos_id: 'POS-3', payments: [{ payment_id: 'PAY_4' }] })); // sent
    // a credit of n 1 (POS-1, its original's pos_id) queued right away: it waits for n 1's answer
    const orig1 = InvoiceIssued.payload.parse(anInvoiceIssued({ payload: sale({ n: 1, pos_id: 'POS-1', payments: [{ payment_id: 'PAY_1' }] }) }).payload);
    const { discount_line_ids: _d1, ...c1 } = orig1;
    void _d1;
    append([
      anInvoiceCredited({
        stream_id: 'BILL_1',
        payload: { ...c1, series: 'credit', invoice_id: ids(901), number: 1, invoice_ref: 'AC1-C000001', ref_invoice_id: ids(1), ref_invoice_ref: 'AC1-S000001', alert_id: null },
      }),
    ]);
    fake.script({ outcome: 'retry', error_code: 'timeout' }, { outcome: 'ok', fiscal_number: 'FN-4', qr_payload: null });

    expect(await runOnce(workerDeps())).toBe(2);
    expect(fake.calls.map((c) => [c.kind, c.sub.invoice.invoice_ref])).toEqual([
      ['sale', 'AC1-S000001'],
      ['sale', 'AC1-S000004'],
    ]);
    expect(outbox(ids(2))).toMatchObject({ state: 'pending', last_error: FISCAL_ERRORS.token_missing });
    expect(outbox(ids(3))).toMatchObject({ state: 'pending', attempts: 0 });
    expect(outbox(ids(4)).state).toBe('acked');
    expect(outbox(ids(901))).toMatchObject({ state: 'pending', attempts: 0, in_flight_at: null });

    expect(await runOnce(workerDeps())).toBe(0); // POS-1's head backs off; the credit still waits
    hub.clock.advance(BACKOFF_MS[0]);
    fake.script(
      { outcome: 'ok', fiscal_number: 'FN-1', qr_payload: null },
      { outcome: 'ok', fiscal_number: 'FN-3', qr_payload: null },
      { outcome: 'ok', fiscal_number: 'FN-C1', qr_payload: null },
    );
    expect(await runOnce(workerDeps())).toBe(3); // POS-1 in ord order, then the credit behind its acked original
    expect(fake.calls.slice(2).map((c) => [c.kind, c.sub.idempotency_key])).toEqual([
      ['sale', 'AC1-S000001'],
      ['sale', 'AC1-S000003'],
      ['credit', 'AC1-C000001'],
    ]);
    expect(fake.calls.at(-1)).toMatchObject({ kind: 'credit', sub: { pos_id: 'POS-1', original: { invoice_ref: 'AC1-S000001', fiscal_number: 'FN-1' } } });
    expect(eventsOf(FiscalNumberAssigned).map((e) => (e.payload as { invoice_id: string }).invoice_id)).toEqual([ids(4), ids(1), ids(3), ids(901)]);
    expect(outbox(ids(2))).toMatchObject({ state: 'pending', last_error: FISCAL_ERRORS.token_missing });
  });
});

describe('[05 29b privacy] B19 / B22: the token and the full buyer ID reach the adapter only', () => {
  it('[05 #77 seams half] no token and no buyer field in the worker log, hub log, any event or any table but fiscal_credentials / invoice_buyers', async () => {
    await start();
    append([payment('PAY_1', 'BILL_1', { amount_minor: 1 }), payment('PAY_2', 'BILL_2', { amount_minor: 1 })]);
    issue(sale({ n: 1, payments: [{ payment_id: 'PAY_1' }], has_buyer_id: true }));
    issue(sale({ n: 2, payments: [{ payment_id: 'PAY_2' }], has_buyer_id: true }));
    setBuyer(ids(1));
    setBuyer(ids(2));
    fake.script({ outcome: 'retry', error_code: 'timeout' });
    const cap = createLogCapture();
    // the worker log goes to the capture and, as boot wires it (startBillingWorkers(deps, app.log)), to the hub logger
    const line = (level: 'info' | 'error') => (obj: Record<string, unknown>, msg?: string) => {
      cap.stream.write(`${JSON.stringify({ level, msg, ...obj })}\n`);
      hub.app.log[level](obj, msg);
    };
    const log = { info: line('info'), error: line('error') };
    expect(await runOnce(workerDeps(log))).toBe(1); // n 1 retries, n 2 waits behind it (strict)
    hub.clock.advance(BACKOFF_MS[0]);
    fake.script({ outcome: 'ok', fiscal_number: 'FN-1', qr_payload: null }, { outcome: 'rejected', error_code: 'bad_buyer', http_status: 400 });
    expect(await runOnce(workerDeps(log))).toBe(2);

    // the adapter got them (the scan below is live)
    expect(fake.calls.every((c) => c.sub.credentials['token'] === TOKEN)).toBe(true);
    expect(fake.calls.every((c) => c.sub.invoice.buyer?.tax_id.value === BUYER_ID)).toBe(true);
    expect(cap.text()).toContain('fiscal.answered');
    expect(hub.logs()).toContain('fiscal.answered'); // the hub log scan is live too
    expect(leaksOf('FN-1').length).toBeGreaterThan(0);
    for (const secret of [TOKEN, BUYER_ID, BUYER_NAME]) {
      expect(cap.text()).not.toContain(secret);
      expect(leaksOf(secret)).toEqual([]);
    }
  });

  it('[05 29b privacy] an adapter code holding a run of 5+ digits (an echoed CNIC / NTN) → invalid_code, never in last_error or FiscalSubmitRejected', async () => {
    expect(['3520212345678', 'bad_1234567', '12345', 'http_503', 'e1234', 'err_2026_11'].map(shortCode)).toEqual([
      'invalid_code',
      'invalid_code',
      'invalid_code',
      'http_503',
      'e1234',
      'err_2026_11',
    ]);
    await start();
    append([payment('PAY_1', 'BILL_1', { amount_minor: 1 }), payment('PAY_2', 'BILL_2', { amount_minor: 1 })]);
    issue(sale({ n: 1, pos_id: 'POS-1', payments: [{ payment_id: 'PAY_1' }], has_buyer_id: true }));
    setCredential('POS-2');
    issue(sale({ n: 2, pos_id: 'POS-2', payments: [{ payment_id: 'PAY_2' }], has_buyer_id: true }));
    setBuyer(ids(1));
    setBuyer(ids(2));
    fake.script({ outcome: 'retry', error_code: BUYER_ID }, { outcome: 'rejected', error_code: `cnic_${BUYER_ID}`, http_status: 400 });
    expect(await runOnce(workerDeps())).toBe(2);
    expect(outbox(ids(1))).toMatchObject({ state: 'pending', last_error: 'invalid_code' });
    expect(outbox(ids(2))).toMatchObject({ state: 'rejected', last_error: 'invalid_code' });
    expect(eventsOf(FiscalSubmitRejected).map((e) => e.payload)).toEqual([{ invoice_id: ids(2), adapter_key: 'FAKE', error_code: 'invalid_code', http_status: 400 }]);
    expect(leaksOf(BUYER_ID)).toEqual([]);
  });
});
