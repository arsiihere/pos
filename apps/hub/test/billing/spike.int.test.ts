// 05 plan §2B.6 P0.Sb — spike, 0b half (GATE for every command lane; PL-0, PL-19). Spec §3.1, §3.15, §3.16, §5,
// §6.12, §6.29; B20, B21, B22, G-10; owner ruling R-46 (05 v1.0.8). Over real events (task 5 builders, parsed by their schemas), the real 05 migration (0023),
// the real `billing` fold (task 7) and every other hub projection, the 0a money core (computeSplit / spreadLineTaxes),
// the P0.9b billing mapper (hubBilling / computeRulesAt / ruleInForce), 28a's outbox, 29a's worker (`runOnce`), the
// port registry, 03c's print queue and bill routing (`billPrinterFor`, row P-1) and the `Doc` builders. Seatings,
// orders and the directory come from the P0.F fixtures.
// ⚠️ Task 17 (§2B.6 DoD, PL-19): the close is the real `CloseSplit` command over HTTP (`closeSplit` below; it was the
// in-test `closeSplitInTest` until task 17). The worker seams stay the spike's own, as written before 29b:
// `loadSubmissionInTest` and `onAnswerInTest` (the latter appends the real `FiscalNumberAssigned` event).
// No timing asserts (03a AD-32). Test-only DDL: TEMP triggers on this test's connection for G-10 (never a migration).
import {
  buildReceiptDoc,
  isFiscalized,
  type Doc,
  type DocContext,
  type PAYMENT_CLASSES,
} from '@pos/domain';
import type { EngineState } from '@pos/engine';
import {
  BillOpened,
  draftOf,
  FiscalNumberAssigned,
  InvoiceIssuedPayload,
  PaymentAdded,
  PrinterSaved,
  BillRouteSet,
  rateBpRates,
  SnapshotBillingSchema,
  type BranchConfig,
  type EventDef,
  type EventDraft,
  type PosEvent,
  type SnapshotBilling,
} from '@pos/events';
import { aBillOpened, aFiscalNumberAssigned, aPaymentAdded } from '@pos/events/testing';
import type Database from 'better-sqlite3';
import type { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeRulesAt, hubBilling } from '../../src/billing/defaults';
import { noneAdapter } from '../../src/billing/fiscal/none';
import { fiscalAdapterFor, registerFiscalAdapter, resetFiscalAdapters, type FiscalSubmission } from '../../src/billing/fiscal/port';
import { resetFiscalWorker, runOnce, type FiscalFinalAnswer, type FiscalWorkRow, type LoadedSubmission } from '../../src/billing/fiscal/worker';
import { billPrinterFor } from '../../src/print/api';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { createLogCapture } from '../helpers/log-capture';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';
import { openDay, voidsMenu } from '../voids/fixtures';
import { fakeAdapter, type FakeAdapter } from './fiscal/fake-adapter';
import type { BillView } from '../../src/billing/queries/bill';
import { billingDirectory, dineInTwoRounds, drawerDevice, JURISDICTIONS, post, signInOn, STAFF, type Who } from './fixtures';

// ------------------------------------------------------------------------------------------------ hub set-up

type PaymentClass = (typeof PAYMENT_CLASSES)[number]; // compute.ts / docs.ts keep this alias module-private

const FOOD = JURISDICTIONS.PK.tax_profile_id; // 'tc-food' (P0.F): the 01a tax class id = the line's tax_profile_id (§3.4)
const PRINTER_COUNTER = 'PR_COUNTER';
const PRINTER_DEFAULT = 'PR_DEFAULT';
const SHIFT = 'SHIFT_1';
const fake: FakeAdapter = fakeAdapter({ key: 'FAKE', ordering: 'strict_per_pos_id', credentialNames: ['token'] });

/** voidsMenu() (the P0.F seatings' menu) with tax on: Karahi and Naan carry the 16 % food class. */
function taxedMenu(billing?: SnapshotBilling): BranchConfig {
  const menu = voidsMenu();
  const taxed = new Set<string>(['I_KARAHI', 'I_NAAN']);
  return {
    ...menu,
    tax_enabled: true,
    tax_classes: [{ tax_class_id: FOOD, name: 'Sales tax', rate_bp: 1600, is_archived: false, fiscal_category: 'restaurant_service' }],
    items: menu.items.map((i) => (taxed.has(i.item_id) ? { ...i, tax_class_id: FOOD } : i)),
    ...(billing === undefined ? {} : { billing: SnapshotBillingSchema.parse(billing) }),
  };
}

/**
 * A test jurisdiction on the fake adapter (shaped like PK-PB, §6.31): the PK defaults' document with a card mode, the
 * adapter's payment codes, a seller NTN, invoice prefix `AC1-`, default POS `POS-1`; cash 16 %, card 5 %.
 */
function testJurisdictionBilling(): SnapshotBilling {
  const pk = hubBilling({ currency_code: 'PKR', tax_classes: [], billing: undefined });
  const cash = pk.settings.payment_modes[0]!;
  return {
    ...pk.settings,
    jurisdiction_id: 'TEST-J',
    payment_modes: [
      { ...cash, authority_codes: [{ adapter_key: fake.key, code: '1' }] },
      { mode_id: 'card', name: 'Card', kind: 'card', payment_class: 'digital', reference_required: false, is_active: true, sort_order: 1, authority_codes: [{ adapter_key: fake.key, code: '2' }] },
    ],
    receipt: { ...pk.settings.receipt, tax_registrations: [{ code: 'NTN', number: '1234567' }], invoice_prefix: 'AC1-' },
    fiscal: { ...pk.settings.fiscal, pos_ids: [{ pos_id: 'POS-1', label: 'Counter' }], default_pos_id: 'POS-1' },
    jurisdiction: {
      ...pk.jurisdiction,
      jurisdiction_id: 'TEST-J',
      adapter_key: fake.key,
      rules: pk.jurisdiction.rules.map((r) => ({
        ...r,
        receipt: { fiscal_number_label: 'TEST fiscal no.', tax_reg_labels: [{ code: 'NTN', label: 'NTN' }], show_qr: false, qr_url_template: null, buyer_id_on_receipt: false },
      })),
    },
    tax_profiles: [
      {
        tax_class_id: FOOD,
        taxes: [
          {
            seq: 1,
            tax_code: 'TAX',
            label: 'Sales tax on services',
            compound: false,
            rates: [...rateBpRates(1600).filter((x) => x.payment_class === 'cash'), ...rateBpRates(500).filter((x) => x.payment_class === 'digital')],
          },
        ],
      },
    ],
  };
}

let hub: TestHub;
/** beforeCommit switch for case (c) (the writer's own test hook, D45 pattern) */
const commit = { fail: false };

/** P0.F's billingDirectory() over a fresh hub, the taxed menu's day open (startBilling's steps, with the commit hook). */
async function startSpikeHub(billing?: SnapshotBilling): Promise<{ device: { deviceId: string; token: string } }> {
  hub = await createTestHub({ testHooks: { beforeCommit: () => { if (commit.fail) throw new Error('commit failed'); } } });
  await seedDirectory(hub, await billingDirectory());
  openDay(hub, { menu: taxedMenu(billing), stock: { K1: 0, K_NAAN: 0 } });
  const device = drawerDevice(hub);
  sessions.set(device.deviceId, signInOn(hub, STAFF.cashier, device)); // the session the real CloseSplit runs in
  // 03c print config by its real events (print_config fold): a counter printer routed to the drawer device, a default.
  const branch = hub.deps.config.provisioned!.branch_id;
  const onHub = <P extends z.ZodType>(def: EventDef<P>, payload: unknown): Draft => ({
    stream_type: 'hub',
    stream_id: branch,
    event_type: def.eventType,
    schema_version: def.version,
    payload: def.payload.parse(payload) as PosEvent['payload'],
  });
  hubAppend([
    ...[PRINTER_COUNTER, PRINTER_DEFAULT].map((printer_id, i) =>
      onHub(PrinterSaved, { printer_id, name: printer_id, connection: 'lan', address: `192.168.1.${20 + i}:9100`, paper_width_mm: 80, archived: false }),
    ),
    onHub(BillRouteSet, { scope: 'device', ref_id: device.deviceId, printer_id: PRINTER_COUNTER }),
    onHub(BillRouteSet, { scope: 'default', ref_id: '', printer_id: PRINTER_DEFAULT }),
  ]);
  return { device };
}

beforeEach(() => {
  registerFiscalAdapter(noneAdapter);
  registerFiscalAdapter(fake);
  fake.calls.length = 0;
  sinkSaw.length = 0;
});

afterEach(async () => {
  commit.fail = false;
  sessions.clear();
  await hub.close();
  swapBranchConfig(null);
  resetFiscalAdapters();
  resetFiscalWorker();
});

type Draft = Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id'>;

/** One writer transaction of `drafts` (clock +1 s), actor the cashier. */
function hubAppend(drafts: Draft[], o: { actor?: string; device?: string } = {}): PosEvent[] {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  return hub.deps.writer.run((tx) => tx.append(drafts.map((d) => ({ ...d, occurred_at: now, actor_id: o.actor ?? STAFF.cashier, device_id: o.device ?? 'D_FIXTURE' })))).appended;
}

/**
 * A task-5 builder's event with `payload` as the whole payload, parsed by the event's own schema. Every builder key
 * must be given (a missing one would silently keep the builder's default, e.g. its PRA snapshot).
 */
function built<P extends z.ZodType>(def: EventDef<P>, builder: (o: { payload: Record<string, unknown> }) => PosEvent, payload: Record<string, unknown>): z.infer<P> {
  const event = builder({ payload });
  const missing = Object.keys(event.payload).filter((k) => !(k in payload));
  if (missing.length > 0) throw new Error(`spike: ${def.eventType} builder keys not given: ${missing.join(', ')}`);
  return def.payload.parse(event.payload);
}

// ------------------------------------------------------------------------------------------------ bill set-up

/** BillOpened (§6.29) for a dine-in seating; price mode and rounding frozen at open from the rule in force (H9-9, H16-2). */
function openBill(seating_id: string, bill_id: string): void {
  const billing = hubBilling(branchConfig()!);
  const day = (hub.deps.state.get() as EngineState).business_day!.business_date;
  const rules = computeRulesAt(billing, { business_date: day, tax_enabled: true })!;
  const payload = built(BillOpened, aBillOpened, {
    bill_id,
    scope: 'seating',
    seating_id,
    bill_key: null,
    order_type: 'dine_in',
    prices_include_tax: rules.prices_include_tax,
    rounding: rules.rounding,
  });
  hubAppend([{ stream_type: 'bill', stream_id: bill_id, event_type: BillOpened.eventType, schema_version: 1, payload }]);
}

/** PaymentAdded (§6.9) on split 1; `tendered_minor` only on cash. */
function pay(bill_id: string, p: { payment_id: string; mode_id: string; payment_class: PaymentClass; amount_minor: number; tendered_minor: number | null }): void {
  const payload = built(PaymentAdded, aPaymentAdded, {
    payment_id: p.payment_id,
    bill_id,
    split_no: 1,
    mode_id: p.mode_id,
    payment_class: p.payment_class,
    direction: 'in',
    amount_minor: p.amount_minor,
    tendered_minor: p.tendered_minor,
    change_minor: p.tendered_minor === null ? null : p.tendered_minor - p.amount_minor,
    has_reference: false,
    taken_by_staff_id: STAFF.cashier,
    shift_id: SHIFT,
  });
  hubAppend([{ stream_type: 'bill', stream_id: bill_id, event_type: PaymentAdded.eventType, schema_version: 1, payload }]);
}

// ================================================================================== the close (task 17: the real CloseSplit)

/** §6.12 Result, exactly: what task 17's `CloseSplit` answers (the tests read the rest back from the hub). */
interface CloseResult {
  invoice_id: string;
  invoice_ref: string;
  total_minor: number;
  change_minor: number;
  bill_state: 'open' | 'partly_paid' | 'closed';
  receipt: { job_id: string | null; printer_name: string | null };
  fiscal_state: 'pending' | 'not_required';
}

const docContext = (billing: ReturnType<typeof hubBilling>): DocContext => ({
  width_cols: 48, // 80 mm paper (both spike printers)
  currency_exponent: billing.jurisdiction.currency_exponent,
  utc_offset_ms: 5 * 3_600_000,
  branch_name: 'Arif Chatkhara Main',
  template: billing.settings.receipt,
});

/** The cashier's session on each device the spike closes from (signed in once per device). */
const sessions = new Map<string, Who>();

/** The message of the last unhandled error the hub logged (a 500's cause; the reply itself carries none). */
function lastUnhandled(): string {
  const lines = hub
    .logs()
    .split('\n')
    .filter((l) => l.includes('unhandled error'))
    .map((l) => JSON.parse(l) as { err?: { message?: string } });
  return lines.at(-1)?.err?.message ?? 'no unhandled error logged';
}

/**
 * THE CLOSE — task 17's real `CloseSplit` (§6.12) over HTTP (05 plan §2B.6: "task 17's PR switches the spike to the
 * real CloseSplit command"): the cashier signed in on `device_id`, `expected_total_minor` = the split's total as the
 * bill view shows it. A refusal or a failed transaction throws (`CloseSplit <status> <code>: <the logged cause>`).
 */
async function closeSplit(c: { bill_id: string; split_no: number; device_id: string; staff_id: string }): Promise<CloseResult> {
  const who = sessions.get(c.device_id);
  if (who === undefined || who.staffId !== c.staff_id) throw new Error(`spike: no ${c.staff_id} session on ${c.device_id}`);
  const res = await hub.app.inject({ method: 'GET', url: `/queries/bill?bill_id=${c.bill_id}`, headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
  if (res.statusCode !== 200) throw new Error(`spike: bill view ${res.statusCode}`);
  const view = (res.json() as { data: BillView }).data;
  const expected_total_minor = view.splits.find((s) => s.split_no === c.split_no)!.totals.as_paid.total_minor;
  const r = await post(hub, who, 'close-split', 'CloseSplit', { bill_ref: { bill_id: c.bill_id }, split_no: c.split_no, expected_total_minor });
  if (r.status !== 200) throw new Error(`CloseSplit ${r.status} ${r.error?.code ?? ''}${r.status === 500 ? `: ${lastUnhandled()}` : ''}`);
  return r.result as unknown as CloseResult;
}

// ================================================================================== in-test 29b seams

/** The invoice as the event store holds it (the source 29b's loadSubmission and reprints read, H9-6). */
function storedInvoice(invoice_id: string): InvoiceIssuedPayload {
  const raw = hub.deps.db
    .prepare(`SELECT payload FROM events WHERE event_type = 'InvoiceIssued' AND json_extract(payload, '$.invoice_id') = ?`)
    .pluck()
    .get(invoice_id) as string;
  return InvoiceIssuedPayload.parse(JSON.parse(raw));
}

/** In-test 29b `loadSubmission`: the neutral submission from InvoiceIssued + its payments + the branch fiscal settings. */
function loadSubmissionInTest(row: FiscalWorkRow): LoadedSubmission {
  const inv = storedInvoice(row.invoice_id);
  const billing = hubBilling(branchConfig()!);
  const codes = new Map(inv.fiscal.payment_codes.map((p) => [p.payment_id, p.authority_code]));
  // G-6 (29b's plan row): the invoice's own payment_ids, joined by payment_id, in the invoice's order
  const pays = hub.deps.db
    .prepare(
      `SELECT p.payment_id, p.payment_class, p.direction, p.amount_minor FROM json_each(?) j
         JOIN bill_payments p ON p.payment_id = j.value ORDER BY j.key`,
    )
    .all(JSON.stringify(inv.payment_ids)) as { payment_id: string; payment_class: PaymentClass; direction: 'in' | 'out'; amount_minor: number }[];
  return {
    ok: true,
    original: null,
    submission: {
      currency_code: inv.currency_code,
      currency_exponent: billing.jurisdiction.currency_exponent,
      prices_include_tax: inv.prices_include_tax,
      seller: { branch_id: hub.deps.config.provisioned!.branch_id, tax_registrations: inv.fiscal.seller_registrations },
      config: { environment: billing.settings.fiscal.environment, base_url: null, settings: billing.settings.fiscal.adapter_settings[row.adapter_key] ?? {} },
      invoice: {
        invoice_ref: inv.invoice_ref,
        issued_at: inv.issued_at,
        order_type: inv.order_type,
        lines: inv.lines.map((l) => ({ ...l })),
        service_charge: inv.service_charge === null ? null : { amount_minor: inv.service_charge.amount_minor, taxes: inv.service_charge.taxes },
        subtotal_minor: inv.subtotal_minor,
        discount_minor: inv.discount_minor,
        tax_minor: inv.taxes.reduce((s, x) => s + x.tax_minor, 0),
        rounding_minor: inv.rounding_minor,
        total_minor: inv.total_minor,
        taxes: inv.taxes.map((x) => ({ tax_profile_id: x.tax_profile_id, tax_code: x.tax_code, payment_class: x.payment_class, rate_bp: x.rate_bp, base_minor: x.base_minor, tax_minor: x.tax_minor })),
        payments: pays.map((p) => ({ authority_code: codes.get(p.payment_id) ?? null, payment_class: p.payment_class, direction: p.direction, amount_minor: p.amount_minor })),
        buyer: null,
        buyer_id_refused: inv.buyer_id_refused,
      },
    },
  };
}

type WorkerCols = { state: string; in_flight_at: number | null; last_error: string | null };
/** What the sink saw of its row inside its own transaction: before its writes, and right before COMMIT. */
const sinkSaw: { before: WorkerCols; atCommit: WorkerCols }[] = [];
const workerCols = (d: Database.Database, invoice_id: string): WorkerCols =>
  d.prepare('SELECT state, in_flight_at, last_error FROM fiscal_outbox WHERE invoice_id = ?').get(invoice_id) as WorkerCols;

/**
 * In-test 29b `onAnswer` (ok only in the spike): the real `FiscalNumberAssigned` and the worker-column clear in one
 * writer transaction (worker.ts onAnswer contract), before the worker's own clear afterwards.
 */
function onAnswerInTest(row: FiscalWorkRow, answer: FiscalFinalAnswer): void {
  if (answer.outcome !== 'ok') throw new Error(`spike: unexpected answer ${answer.outcome}`);
  const payload = built(FiscalNumberAssigned, aFiscalNumberAssigned, {
    invoice_id: row.invoice_id,
    adapter_key: row.adapter_key,
    pos_id: row.pos_id,
    fiscal_number: answer.fiscal_number,
    qr_payload: answer.qr_payload,
  });
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  hub.deps.writer.run((tx) => {
    const before = workerCols(tx.db, row.invoice_id);
    tx.append([draftOf(FiscalNumberAssigned, { stream_type: 'bill', stream_id: storedInvoice(row.invoice_id).bill_id, payload, occurred_at: now, actor_id: null, device_id: 'hub' })]);
    tx.db.prepare('UPDATE fiscal_outbox SET in_flight_at = NULL, last_error = NULL WHERE invoice_id = ?').run(row.invoice_id);
    sinkSaw.push({ before, atCommit: workerCols(tx.db, row.invoice_id) });
  });
}

// ================================================================================== reads

const db = () => hub.deps.db;
const docText = (doc: Doc): string => doc.blocks.flatMap((b) => ('text' in b ? [b.text] : [])).join('\n');
const row48 = (left: string, right: string): string => left + ' '.repeat(48 - left.length - right.length) + right;

/** What a close writes, anywhere (#c: none of it after a rolled-back close). */
function written() {
  const one = (sql: string) => db().prepare(sql).pluck().get() as number;
  return {
    invoices: one('SELECT COUNT(*) FROM invoices'),
    invoice_taxes: one('SELECT COUNT(*) FROM invoice_taxes'),
    outbox: one('SELECT COUNT(*) FROM fiscal_outbox'),
    print_jobs: one(`SELECT COUNT(*) FROM print_jobs WHERE kind = 'document'`),
    bill_print_jobs: one('SELECT COUNT(*) FROM bill_print_jobs'),
    close_events: one(`SELECT COUNT(*) FROM events WHERE event_type IN ('InvoiceIssued', 'DiscountFrozen', 'OrdersBilled', 'BillClosed')`),
    closed_splits: one(`SELECT COUNT(*) FROM bill_splits WHERE state = 'closed'`),
    billed_orders: one('SELECT COUNT(*) FROM orders WHERE billed_at IS NOT NULL'),
    bill_orders: one('SELECT COUNT(*) FROM bill_orders'),
  };
}
const NOTHING = { invoices: 0, invoice_taxes: 0, outbox: 0, print_jobs: 0, bill_print_jobs: 0, close_events: 0, closed_splits: 0, billed_orders: 0, bill_orders: 0 };

const jobDoc = (job_id: string): { doc: Doc; kind_label?: string } =>
  JSON.parse(db().prepare('SELECT payload FROM print_jobs WHERE job_id = ?').pluck().get(job_id) as string) as { doc: Doc; kind_label?: string };

/** The events appended after `seq`, as the store holds them. */
const eventsAfter = (seq: number) =>
  (
    db().prepare('SELECT event_id, seq, event_type, stream_type, stream_id, recorded_at, payload FROM events WHERE seq > ? ORDER BY seq').all(seq) as {
      event_id: string;
      seq: number;
      event_type: string;
      stream_type: string;
      stream_id: string;
      recorded_at: number;
      payload: string;
    }[]
  ).map((e) => ({ ...e, payload: JSON.parse(e.payload) as Record<string, unknown> }));

/**
 * B22 / §7 Secrets: every place a secret could leak to, scanned generically — the hub log stream, and every row of
 * every table in sqlite_master (all `events` streams, `print_jobs`, the outbox, …) except the one table that holds it.
 * Returns the places that contain `secret`.
 */
function leaksOf(secret: string): string[] {
  const places: string[] = [];
  if (hub.logs().includes(secret)) places.push('hub.logs()');
  const tables = db().prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'fiscal_credentials' ORDER BY name`).pluck().all() as string[];
  for (const t of tables) {
    if (JSON.stringify(db().prepare(`SELECT * FROM "${t}"`).all()).includes(secret)) places.push(`table ${t}`);
  }
  return places;
}

/** The P0.F dine-in seating (T4: Karahi 1,200 + Naan 30, then a follow-up Naan 30) with its bill open. */
function seatedBill(prefix = 'SP'): { seating_id: string; table_id: string; order_ids: string[]; line_ids: string[]; bill_id: string } {
  const s = dineInTwoRounds(hub, { prefix });
  const bill_id = `BILL_${prefix}`;
  openBill(s.seating_id, bill_id);
  return { seating_id: s.seating_id, table_id: s.table_id, order_ids: s.rounds.map((r) => r.order_id), line_ids: s.rounds.flatMap((r) => r.lines), bill_id };
}

// =============================================================================================================== (a)

describe('[05 spike] (a) jurisdiction PK (adapter none): one close transaction, not_required outbox row, receipt at the bill printer', () => {
  it('[05 spike] (a) InvoiceIssued + DiscountFrozen + OrdersBilled + BillClosed in one transaction; the fold writes the invoice and a not_required row', async () => {
    const { device } = await startSpikeHub();
    const b = seatedBill();
    // 1,260.00 + 16 % 201.60 = 1,461.60 → 1,462.00 (+0.40), PK rounding Rs 1 nearest; cash 1,500 → change 38
    pay(b.bill_id, { payment_id: 'PAY_A1', mode_id: 'cash', payment_class: 'cash', amount_minor: 146_200, tendered_minor: 150_000 });
    const lastSeq = hub.deps.writer.lastSeq();
    const published = hub.published.length;

    const r = await closeSplit({ bill_id: b.bill_id, split_no: 1, device_id: device.deviceId, staff_id: STAFF.cashier });

    // the §6.12 result
    expect(r).toEqual({
      invoice_id: expect.any(String),
      invoice_ref: 'S000001', // the default prefix is '' (R-10)
      total_minor: 146_200,
      change_minor: 3_800,
      bill_state: 'closed',
      receipt: { job_id: expect.any(String), printer_name: PRINTER_COUNTER },
      fiscal_state: 'not_required',
    });
    // one writer transaction: one append, consecutive seqs, one recorded_at, one publish
    const appended = eventsAfter(lastSeq);
    expect(appended.map((e) => [e.event_type, e.stream_type, e.stream_id])).toEqual([
      ['InvoiceIssued', 'bill', b.bill_id],
      ['DiscountFrozen', 'bill', b.bill_id],
      ['OrdersBilled', 'order', b.order_ids[0]],
      ['BillClosed', 'table', b.table_id],
    ]);
    expect(appended.map((e) => e.seq)).toEqual([lastSeq + 1, lastSeq + 2, lastSeq + 3, lastSeq + 4]);
    expect(new Set(appended.map((e) => e.recorded_at)).size).toBe(1);
    expect(hub.published.slice(published).map((batch) => batch.map((e) => e.event_id))).toEqual([appended.map((e) => e.event_id)]);
    expect(appended[2]!.payload).toEqual({ order_ids: b.order_ids, bill_id: b.bill_id });
    expect(appended[3]!.payload).toEqual({ seating_id: b.seating_id });

    // the money, read back from the event store: the 0a core under the PK defaults (P0.9b hubBilling, no billing key)
    const inv = storedInvoice(r.invoice_id);
    expect(inv).toMatchObject({
      series: 'sale',
      number: 1,
      invoice_ref: r.invoice_ref,
      jurisdiction_id: 'PK',
      currency_code: 'PKR',
      prices_include_tax: false,
      subtotal_minor: 126_000,
      service_charge: null,
      service_charge_minor: 0,
      rounding_minor: 40,
      total_minor: 146_200,
      payment_class: 'cash',
      change_minor: 3_800,
      payment_ids: ['PAY_A1'],
      discount_line_ids: b.line_ids,
    });
    expect(inv.taxes.map((x) => [x.tax_profile_id, x.payment_class, x.rate_bp, x.base_minor, x.tax_minor])).toEqual([[FOOD, 'cash', 1600, 126_000, 20_160]]);
    expect(inv.lines.map((l) => [l.name, l.units, l.unit_price_minor, l.base_minor, l.fiscal_category, l.taxes.map((x) => x.tax_minor)])).toEqual([
      ['Chicken Karahi', 1, 120_000, 120_000, 'restaurant_service', [19_200]],
      ['Naan', 1, 3_000, 3_000, 'restaurant_service', [480]],
      ['Naan', 1, 3_000, 3_000, 'restaurant_service', [480]],
    ]);
    // R-46: required false under adapter none
    expect(inv.fiscal).toMatchObject({ adapter_key: 'none', pos_id: null, required: false, payment_codes: [{ payment_id: 'PAY_A1', authority_code: null }] });
    expect(isFiscalized(inv.fiscal)).toBe(false);

    // the real billing fold, in that transaction: invoice, tax row, outbox row not_required (ord = the event's seq)
    const issued = appended[0]!;
    expect(db().prepare('SELECT invoice_id, invoice_ref, bill_id, adapter_key, tax_minor, total_minor, fiscal_number FROM invoices').all()).toEqual([
      { invoice_id: r.invoice_id, invoice_ref: 'S000001', bill_id: b.bill_id, adapter_key: 'none', tax_minor: 20_160, total_minor: 146_200, fiscal_number: null },
    ]);
    expect(db().prepare('SELECT invoice_id, ord, ref_invoice_id, jurisdiction_id, adapter_key, pos_id, state, queued_at, attempts FROM fiscal_outbox').all()).toEqual([
      { invoice_id: r.invoice_id, ord: issued.seq, ref_invoice_id: null, jurisdiction_id: 'PK', adapter_key: 'none', pos_id: null, state: 'not_required', queued_at: issued.recorded_at, attempts: 0 },
    ]);
    // …and the other folds of the same transaction: bill closed, payment carries the invoice, 02b billed, 02a NEEDS_CLEANING
    expect(db().prepare('SELECT state, closed_at FROM bills WHERE bill_id = ?').get(b.bill_id)).toEqual({ state: 'closed', closed_at: issued.recorded_at });
    expect(db().prepare('SELECT invoice_id FROM bill_payments WHERE payment_id = ?').pluck().get('PAY_A1')).toBe(r.invoice_id);
    expect(db().prepare('SELECT order_id FROM bill_orders WHERE bill_id = ? ORDER BY order_id').pluck().all(b.bill_id)).toEqual([...b.order_ids].sort());
    expect(db().prepare('SELECT COUNT(*) FROM orders WHERE billed_at = ?').pluck().get(issued.recorded_at)).toBe(2);
    expect(db().prepare('SELECT state FROM seatings WHERE seating_id = ?').pluck().get(b.seating_id)).toBe('NEEDS_CLEANING');

    // the worker never sends a not_required row (none.ts would throw)
    expect(await runOnce({ db: db(), clock: hub.clock, adapterFor: fiscalAdapterFor, loadSubmission: loadSubmissionInTest, onAnswer: onAnswerInTest })).toBe(0);
  });

  it('[05 spike] (a) a receipt job is queued at the bill printer (device route, P-1) in the close transaction; the receipt has no fiscal block', async () => {
    const { device } = await startSpikeHub();
    const b = seatedBill();
    pay(b.bill_id, { payment_id: 'PAY_A1', mode_id: 'cash', payment_class: 'cash', amount_minor: 146_200, tendered_minor: 150_000 });
    // the route the close reads: device → counter (default would be PR_DEFAULT)
    expect(billPrinterFor(db(), { device_id: device.deviceId })).toBe(PRINTER_COUNTER);
    expect(billPrinterFor(db(), { device_id: 'D_OTHER' })).toBe(PRINTER_DEFAULT);
    const lastSeq = hub.deps.writer.lastSeq();

    const r = await closeSplit({ bill_id: b.bill_id, split_no: 1, device_id: device.deviceId, staff_id: STAFF.cashier });

    const job_id = r.receipt.job_id!;
    expect(r.receipt.printer_name).toBe(PRINTER_COUNTER);
    expect(db().prepare(`SELECT job_id, kind, printer_id, created_at, sent_at, cancelled_at FROM print_jobs WHERE kind = 'document'`).all()).toEqual([
      { job_id, kind: 'document', printer_id: PRINTER_COUNTER, created_at: eventsAfter(lastSeq)[0]!.recorded_at, sent_at: null, cancelled_at: null },
    ]);
    expect(db().prepare('SELECT job_id, bill_id, doc_kind, ref_id FROM bill_print_jobs').all()).toEqual([
      { job_id, bill_id: b.bill_id, doc_kind: 'receipt', ref_id: r.invoice_id },
    ]);
    // the queued payload is the receipt Doc (03c renders it at send)
    const queued = jobDoc(job_id);
    expect(queued.kind_label).toBe('Receipt');
    const text = docText(queued.doc);
    const lines = text.split('\n');
    expect(lines).toContain(row48('Subtotal', '1,260.00'));
    expect(lines).toContain(row48('Sales tax 16% cash', '201.60'));
    expect(lines).toContain(row48('Rounding adjustment', '0.40'));
    expect(lines).toContain(row48('TOTAL PKR', '1,462.00'));
    expect(lines).toContain(row48('Change', '38.00'));
    expect(text).toContain(r.invoice_ref);
    // B21 / §3.15: not fiscalized → no fiscal block at all; a cash payment opens the drawer (§3.16)
    expect(text).not.toMatch(/fiscal/i);
    expect(queued.doc.blocks).toContainEqual({ drawer: true });
  });
});

// =============================================================================================================== (b)

describe('[05 spike] (b) test jurisdiction on the fake adapter: pending row → runOnce (idempotency_key = invoice_ref) → FiscalNumberAssigned → reprint', () => {
  it('[05 spike] (b) the row is pending; the worker sends with idempotency_key = invoice_ref; FiscalNumberAssigned is appended; a reprint shows the number', async () => {
    const { device } = await startSpikeHub(testJurisdictionBilling());
    db().prepare('INSERT INTO fiscal_credentials (pos_id, name, token, set_at, set_by_staff_id) VALUES (?, ?, ?, ?, ?)').run('POS-1', 'token', 'test-token', hub.clock.branchNow(), STAFF.cashier);
    const b = seatedBill();
    // all card: 1,260.00 + 5 % 63.00 = 1,323.00 (no rounding move)
    pay(b.bill_id, { payment_id: 'PAY_B1', mode_id: 'card', payment_class: 'digital', amount_minor: 132_300, tendered_minor: null });
    const lastSeq = hub.deps.writer.lastSeq();

    const r = await closeSplit({ bill_id: b.bill_id, split_no: 1, device_id: device.deviceId, staff_id: STAFF.cashier });

    expect(r).toMatchObject({ invoice_ref: 'AC1-S000001', total_minor: 132_300, change_minor: 0, bill_state: 'closed', fiscal_state: 'pending' });
    const appended = eventsAfter(lastSeq);
    expect(appended.map((e) => e.event_type)).toEqual(['InvoiceIssued', 'DiscountFrozen', 'OrdersBilled', 'BillClosed']);
    const inv = storedInvoice(r.invoice_id);
    expect(inv).toMatchObject({ invoice_ref: 'AC1-S000001', jurisdiction_id: 'TEST-J', subtotal_minor: 126_000, rounding_minor: 0, total_minor: 132_300, payment_class: 'digital', change_minor: 0 });
    expect(inv.taxes.map((x) => [x.payment_class, x.rate_bp, x.tax_minor])).toEqual([['digital', 500, 6_300]]);
    expect(inv.fiscal).toMatchObject({
      adapter_key: 'FAKE',
      pos_id: 'POS-1',
      required: true,
      capabilities: { ordering: 'strict_per_pos_id', credit: true },
      seller_registrations: [{ code: 'NTN', number: '1234567' }],
      payment_codes: [{ payment_id: 'PAY_B1', authority_code: '2' }],
    });
    expect(db().prepare('SELECT invoice_id, ord, jurisdiction_id, adapter_key, pos_id, state, attempts, in_flight_at FROM fiscal_outbox').all()).toEqual([
      { invoice_id: r.invoice_id, ord: appended[0]!.seq, jurisdiction_id: 'TEST-J', adapter_key: 'FAKE', pos_id: 'POS-1', state: 'pending', attempts: 0, in_flight_at: null },
    ]);

    // the receipt printed at close, before any answer (§6.12 step 7, B21): pending block, no drawer (all card)
    const atClose = jobDoc(r.receipt.job_id!).doc;
    expect(docText(atClose)).toContain('FISCAL NUMBER PENDING');
    expect(docText(atClose)).not.toContain('TEST fiscal no.');
    expect(atClose.blocks).not.toContainEqual({ drawer: true });

    // 29a runOnce over the hub's own database, the port registry and the in-test 29b seams
    const cap = createLogCapture();
    const line = (level: string) => (obj: Record<string, unknown>, msg?: string) => {
      cap.stream.write(`${JSON.stringify({ level, msg, ...obj })}\n`);
    };
    fake.script({ outcome: 'ok', fiscal_number: 'FN-000777', qr_payload: null });
    const sent = await runOnce({
      db: db(),
      clock: hub.clock,
      adapterFor: fiscalAdapterFor,
      loadSubmission: loadSubmissionInTest,
      onAnswer: onAnswerInTest,
      log: { info: line('info'), error: line('error') },
    });
    expect(sent).toBe(1);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.kind).toBe('sale');
    const sub: FiscalSubmission = fake.calls[0]!.sub;
    expect(sub.idempotency_key).toBe(r.invoice_ref);
    expect(sub.idempotency_key).toBe('AC1-S000001');
    expect(sub).toMatchObject({ pos_id: 'POS-1', jurisdiction_id: 'TEST-J', credentials: { token: 'test-token' }, currency_exponent: 2 });
    expect(sub.invoice).toMatchObject({ subtotal_minor: 126_000, tax_minor: 6_300, rounding_minor: 0, total_minor: 132_300 });
    expect(sub.invoice.payments).toEqual([{ authority_code: '2', payment_class: 'digital', direction: 'in', amount_minor: 132_300 }]);

    // the sink cleared the worker columns inside its own transaction (the row was in flight when it began)
    expect(sinkSaw).toEqual([
      { before: { state: 'pending', in_flight_at: expect.any(Number), last_error: null }, atCommit: { state: 'acked', in_flight_at: null, last_error: null } },
    ]);

    // FiscalNumberAssigned appended (real event) and folded: invoice number set, row acked, worker columns cleared
    const assigned = db().prepare(`SELECT stream_type, stream_id, payload FROM events WHERE event_type = 'FiscalNumberAssigned'`).all() as { stream_type: string; stream_id: string; payload: string }[];
    expect(assigned.map((e) => ({ ...e, payload: JSON.parse(e.payload) as unknown }))).toEqual([
      { stream_type: 'bill', stream_id: b.bill_id, payload: { invoice_id: r.invoice_id, adapter_key: 'FAKE', pos_id: 'POS-1', fiscal_number: 'FN-000777', qr_payload: null } },
    ]);
    expect(db().prepare('SELECT fiscal_number FROM invoices WHERE invoice_id = ?').pluck().get(r.invoice_id)).toBe('FN-000777');
    expect(db().prepare('SELECT state, in_flight_at, last_error, attempts FROM fiscal_outbox WHERE invoice_id = ?').get(r.invoice_id)).toEqual({
      state: 'acked',
      in_flight_at: null,
      last_error: null,
      attempts: 0,
    });
    expect(await runOnce({ db: db(), clock: hub.clock, adapterFor: fiscalAdapterFor, loadSubmission: loadSubmissionInTest, onAnswer: onAnswerInTest })).toBe(0);

    // a reprint, from what the hub holds (the stored InvoiceIssued + the folded number), shows the number (B21, H9-6)
    const reprint = buildReceiptDoc(
      {
        invoice: storedInvoice(r.invoice_id),
        payments: [{ mode_name: 'Card', payment_class: 'digital', direction: 'in', amount_minor: 132_300 }],
        change_minor: 0,
        cashier_name: null,
        order_label: null,
        bill_label: b.table_id,
        fiscal: { state: 'acked', fiscal_number: db().prepare('SELECT fiscal_number FROM invoices WHERE invoice_id = ?').pluck().get(r.invoice_id) as string, qr_payload: null },
        buyer: null,
        is_reprint: true,
      },
      docContext(hubBilling(branchConfig()!)),
    );
    const text = docText(reprint);
    expect(text).toContain('** REPRINT **');
    expect(text.split('\n')).toContain(row48('TEST fiscal no.', 'FN-000777'));
    expect(text).not.toContain('FISCAL NUMBER PENDING');
    expect(text.split('\n')).toContain(row48('TOTAL PKR', '1,323.00'));

    // privacy (B22): the token reaches the adapter only — never the worker log, the hub log, a Doc, or any table row
    // (every events stream, print_jobs, the outbox, …) other than fiscal_credentials
    expect(cap.text()).toContain('fiscal.answered'); // the worker capture is live
    expect(cap.text()).not.toContain('test-token');
    expect(JSON.stringify(reprint)).not.toContain('test-token');
    expect(leaksOf('FN-000777').length).toBeGreaterThan(0); // the scan is live: the number is in events / invoices
    expect(leaksOf('test-token')).toEqual([]);
  });
});

// =============================================================================================================== (c)

describe('[05 spike] (c) a pre-COMMIT throw (beforeCommit): no invoice, no outbox row, no job', () => {
  it.each([
    ['PK (not_required)', undefined, { payment_id: 'PAY_C1', mode_id: 'cash', payment_class: 'cash' as const, amount_minor: 146_200, tendered_minor: 150_000 }],
    ['TEST-J (pending)', 'test', { payment_id: 'PAY_C1', mode_id: 'card', payment_class: 'digital' as const, amount_minor: 132_300, tendered_minor: null }],
  ])('[05 spike] (c) %s: a pre-COMMIT throw (beforeCommit) → nothing of the close stays; the same close then commits', async (_label, billing, payment) => {
    const { device } = await startSpikeHub(billing === undefined ? undefined : testJurisdictionBilling());
    const b = seatedBill();
    pay(b.bill_id, payment);
    const seq = hub.deps.writer.lastSeq();
    const state = hub.deps.state.get();
    const published = hub.published.length;

    commit.fail = true;
    await expect(closeSplit({ bill_id: b.bill_id, split_no: 1, device_id: device.deviceId, staff_id: STAFF.cashier })).rejects.toThrow('commit failed');

    expect(written()).toEqual(NOTHING);
    expect(hub.deps.writer.lastSeq()).toBe(seq);
    expect(db().prepare('SELECT MAX(seq) FROM events').pluck().get()).toBe(seq);
    expect(hub.deps.state.get()).toBe(state);
    expect(hub.published.length).toBe(published);
    expect(db().prepare('SELECT state FROM bills WHERE bill_id = ?').pluck().get(b.bill_id)).toBe('open');
    expect(db().prepare('SELECT invoice_id FROM bill_payments').pluck().all()).toEqual([null]);
    expect(db().prepare('SELECT state FROM seatings WHERE seating_id = ?').pluck().get(b.seating_id)).not.toBe('NEEDS_CLEANING');

    commit.fail = false;
    const r = await closeSplit({ bill_id: b.bill_id, split_no: 1, device_id: device.deviceId, staff_id: STAFF.cashier });
    expect(storedInvoice(r.invoice_id).number).toBe(1); // the failed close used no number
    expect(written()).toMatchObject({ invoices: 1, outbox: 1, print_jobs: 1, bill_print_jobs: 1, close_events: 4 });
  });
});

// =============================================================================================================== G-10

// ⚠️ P0.G G-10: in the real fold the invoice and its outbox row commit or roll back together. Each fault is a TEMP
// trigger on this test's connection raising inside the real INSERT the fold runs (no mock, no production change):
// (i) the invoice INSERT, (ii) the outbox INSERT once the invoice row of this transaction exists, (iii) right after the
// outbox row is written. Order in the fold (billing.ts applyInvoiceIssued): invoice → … → outbox row.
describe('[05 spike] G-10: the invoice and its outbox row commit or roll back together (real fold)', () => {
  const faults = [
    ['(i) the invoice INSERT throws', `CREATE TEMP TRIGGER g10 BEFORE INSERT ON main.invoices BEGIN SELECT RAISE(ABORT, 'g10 invoice insert'); END`, 'g10 invoice insert'],
    [
      '(ii) the outbox INSERT throws after the invoice row is written',
      `CREATE TEMP TRIGGER g10 BEFORE INSERT ON main.fiscal_outbox
         WHEN EXISTS (SELECT 1 FROM main.invoices WHERE invoice_id = NEW.invoice_id)
       BEGIN SELECT RAISE(ABORT, 'g10 outbox insert'); END`,
      'g10 outbox insert',
    ],
    [
      '(iii) a throw right after both rows are written',
      `CREATE TEMP TRIGGER g10 AFTER INSERT ON main.fiscal_outbox
         WHEN EXISTS (SELECT 1 FROM main.invoices WHERE invoice_id = NEW.invoice_id)
       BEGIN SELECT RAISE(ABORT, 'g10 after both'); END`,
      'g10 after both',
    ],
  ] as const;

  for (const [jurisdiction, billing] of [['PK', false], ['TEST-J', true]] as const) {
    it.each(faults)(`[05 spike] G-10 ${jurisdiction}: %s → neither row, nothing of the close`, async (_label, ddl, message) => {
      const { device } = await startSpikeHub(billing ? testJurisdictionBilling() : undefined);
      const b = seatedBill();
      pay(
        b.bill_id,
        billing
          ? { payment_id: 'PAY_G1', mode_id: 'card', payment_class: 'digital', amount_minor: 132_300, tendered_minor: null }
          : { payment_id: 'PAY_G1', mode_id: 'cash', payment_class: 'cash', amount_minor: 146_200, tendered_minor: 150_000 },
      );
      const seq = hub.deps.writer.lastSeq();
      const state = hub.deps.state.get();
      const published = hub.published.length;
      db().exec(ddl);
      try {
        await expect(closeSplit({ bill_id: b.bill_id, split_no: 1, device_id: device.deviceId, staff_id: STAFF.cashier })).rejects.toThrow(message);
      } finally {
        db().exec('DROP TRIGGER IF EXISTS temp.g10');
      }
      expect(written()).toEqual(NOTHING);
      expect(hub.deps.writer.lastSeq()).toBe(seq);
      expect(db().prepare('SELECT MAX(seq) FROM events').pluck().get()).toBe(seq);
      expect(hub.deps.state.get()).toBe(state);
      expect(hub.published.length).toBe(published);
      expect(db().prepare('SELECT state FROM bills WHERE bill_id = ?').pluck().get(b.bill_id)).toBe('open');

      // the trigger gone, the same close commits both rows together
      const r = await closeSplit({ bill_id: b.bill_id, split_no: 1, device_id: device.deviceId, staff_id: STAFF.cashier });
      expect(db().prepare('SELECT i.invoice_id, o.state FROM invoices i JOIN fiscal_outbox o ON o.invoice_id = i.invoice_id').all()).toEqual([
        { invoice_id: r.invoice_id, state: billing ? 'pending' : 'not_required' },
      ]);
    });
  }
});
