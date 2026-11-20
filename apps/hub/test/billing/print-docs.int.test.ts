// 05 §6.22 `PrintBillDocument { doc: 'receipt' | 'credit_note', ref_id, printer_id? }` and §6.23 `RetargetBillPrint
// { job_id, printer_id }` (task 27; 05-plan §3 row 27): #60, #61 (extended: the command half), B18, B19, B21, §3.16,
// R-55, row P-5. Real commands over HTTP (CloseSplit closes the invoices), the real `billing` fold (invoice, outbox
// row, FiscalNumberAssigned / FiscalSubmitRejected / InvoiceCredited), 03c's print_config fold for printers and bill
// routes, 03c's real print worker and 05's real buyer filler (registered by CloseSplit). In-test pieces (their tasks
// are not built): the fiscal answers and the credit invoice are appended as their real events (29b / task 19 write
// them). The permanent privacy scan (afterEach) holds every buyer ID and name to `invoice_buyers` and to the bytes of
// that customer's receipt.
import { BUYER_ID_FILL, renderText, type Doc } from '@pos/domain';
import { rateBpRates, type BranchConfig, type EventDraft, type PosEvent, type SnapshotBilling } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hubBilling } from '../../src/billing/defaults';
import { noneAdapter } from '../../src/billing/fiscal/none';
import { registerFiscalAdapter, resetFiscalAdapters } from '../../src/billing/fiscal/port';
import type { CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { printDocument } from '../../src/print/api';
import type { SendResult } from '../../src/print/transport/lan';
import { createPrintWorker, type PrinterTransport, type PrintWorker } from '../../src/print/worker';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';
import { fakeClock, type FakeClock } from '../print/fixtures';
import { openDay, voidsMenu } from '../voids/fixtures';
import { fakeAdapter } from './fiscal/fake-adapter';
import { appendOrder, billingDirectory, drawerDevice, FX, openSeating, post, signIn, signInOn, STAFF, VX, type Reply, type Who } from './fixtures';

let hub: TestHub;
let timers: FakeClock;
let worker: PrintWorker | null = null;
/** printer_id → the bytes (latin1) it was sent; `answer` decides each send's result */
let sends: Map<string, string[]>;
let answer: (printer_id: string) => Promise<SendResult>;
const workerLogs: string[] = [];

/** Every buyer ID and name a test sends: the afterEach scan holds each to `invoice_buyers` (B19, H-4). */
const SECRETS = new Set<string>();
const secret = (s: string): string => {
  SECRETS.add(s);
  return s;
};

beforeEach(() => {
  registerFiscalAdapter(noneAdapter);
  registerFiscalAdapter(fakeAdapter({ key: 'FAKE', ordering: 'strict_per_pos_id', credentialNames: ['token'] }));
  sends = new Map();
  answer = () => Promise.resolve({ ok: true });
  workerLogs.length = 0;
});

afterEach(async () => {
  // B19, H-4: the permanent scan — hub.logs(), the worker log, every table but invoice_buyers (print_jobs payloads too)
  const found = hub === undefined ? [] : [...SECRETS].flatMap((s) => leaksOf(s).map((place) => `${s} in ${place}`));
  SECRETS.clear();
  worker?.stop();
  worker = null;
  swapBranchConfig(null);
  resetFiscalAdapters();
  await hub?.close();
  hub = undefined as unknown as TestHub;
  expect(found).toEqual([]);
});

// ------------------------------------------------------------------------------------------------ config

const QR_TEMPLATE = 'https://verify.test/{fiscal_number}';
const BUYER_TYPES = [
  { type: 'CNIC', label: 'CNIC', pattern: '^[0-9]{13}$', strip: '-' },
  { type: 'NTN', label: 'NTN', pattern: '^[A-Za-z0-9]{7,9}$', strip: '' },
];

/** PK (adapter none), or TEST-J on the fake adapter (QR on, buyer ID on the receipt), 16 % cash / 5 % card, buyer threshold 100,000.00 (a buyer given below it is still stored). */
function billingDoc(adapter: 'none' | 'FAKE'): SnapshotBilling {
  const pk = hubBilling({ currency_code: 'PKR', tax_classes: [], billing: undefined });
  const code = (c: string) => (adapter === 'none' ? [] : [{ adapter_key: adapter, code: c }]);
  const cash = pk.settings.payment_modes[0]!;
  const jurisdiction_id = adapter === 'none' ? pk.jurisdiction.jurisdiction_id : 'TEST-J';
  return {
    ...pk.settings,
    jurisdiction_id,
    payment_modes: [
      { ...cash, authority_codes: code('1') },
      { mode_id: 'card', name: 'Card', kind: 'card' as const, payment_class: 'digital' as const, reference_required: false, is_active: true, sort_order: 1, authority_codes: code('2') },
    ],
    receipt: { ...pk.settings.receipt, invoice_prefix: '', tax_registrations: adapter === 'none' ? [] : [{ code: 'NTN', number: '1234567' }] },
    fiscal: { ...pk.settings.fiscal, pos_ids: adapter === 'none' ? [] : [{ pos_id: 'POS-1', label: 'Counter' }], default_pos_id: adapter === 'none' ? null : 'POS-1', switched_at: null },
    jurisdiction: {
      ...pk.jurisdiction,
      jurisdiction_id,
      adapter_key: adapter,
      rules: pk.jurisdiction.rules.map((r) => ({
        ...r,
        rounding_step_minor: 100,
        rounding_mode: 'nearest' as const,
        rounding_applies_to: 'all' as const,
        buyer_id: { threshold_minor: 10_000_000, accepted_types: BUYER_TYPES },
        receipt:
          adapter === 'none'
            ? { ...r.receipt, buyer_id_on_receipt: true }
            : { fiscal_number_label: 'TEST fiscal no.', tax_reg_labels: [{ code: 'NTN', label: 'NTN' }], show_qr: true, qr_url_template: QR_TEMPLATE, buyer_id_on_receipt: true },
      })),
    },
    tax_profiles: [
      {
        tax_class_id: 'tc-food',
        taxes: [{ seq: 1, tax_code: 'TAX', label: 'Sales tax', compound: false, rates: [...rateBpRates(1_600).filter((x) => x.payment_class === 'cash'), ...rateBpRates(500).filter((x) => x.payment_class === 'digital')] }],
      },
    ],
  } as SnapshotBilling;
}

function menu(billing: SnapshotBilling): BranchConfig {
  const m = voidsMenu();
  return {
    ...m,
    tax_enabled: true,
    tax_classes: [{ tax_class_id: 'tc-food', name: 'Sales tax', rate_bp: 1_600, is_archived: false, fiscal_category: 'restaurant_service' }],
    items: m.items.map((i) => (i.item_id === FX.piece || i.item_id === FX.naan ? { ...i, tax_class_id: 'tc-food' } : i)),
    billing,
  };
}

const P = { counter: 'P_COUNTER', other: 'P_OTHER', archived: 'P_ARCHIVED' } as const;
const db = () => hub.deps.db;
const branch = () => hub.deps.config.provisioned!.branch_id;

let cashier: Who;
let device: { deviceId: string; token: string };

let directoryVersion = 1;
type Directory = Awaited<ReturnType<typeof billingDirectory>>;
type Grants = Directory['roles'][number]['permissions'];

/** The order taker's role grants, changed by `f` (the grant-state tests). */
async function orderTakerGrants(f: (g: Grants) => Grants): Promise<void> {
  directoryVersion += 1; // a re-seed applies only with a newer directory version
  const dir = await billingDirectory({ directory_version: directoryVersion });
  await seedDirectory(hub, { ...dir, roles: dir.roles.map((r) => (r.role_id === 'R_WAIT' ? { ...r, permissions: f(r.permissions) } : r)) });
}

async function start(adapter: 'none' | 'FAKE' = 'none', o: { route?: boolean } = {}): Promise<void> {
  hub = await createTestHub();
  await seedDirectory(hub, await billingDirectory());
  openDay(hub, { menu: menu(billingDoc(adapter)), stock: { [FX.stock]: 1_000_000, [VX.naanStock]: 1_000 } });
  timers = fakeClock();
  device = drawerDevice(hub, 'Counter kiosk');
  cashier = signInOn(hub, STAFF.cashier, device);
  const shift = await post(hub, cashier, 'open-shift', 'OpenShift', { float_minor: 0, as_drawer: true });
  expect(shift.status, JSON.stringify(shift.error)).toBe(200);
  hubEvents([
    { stream_type: 'hub', stream_id: branch(), event_type: 'PrinterSaved', payload: { printer_id: P.counter, name: 'Counter', connection: 'lan', address: '192.168.1.20:9100', paper_width_mm: 80, archived: false } },
    { stream_type: 'hub', stream_id: branch(), event_type: 'PrinterSaved', payload: { printer_id: P.other, name: 'Bar', connection: 'lan', address: '192.168.1.21:9100', paper_width_mm: 58, archived: false } },
    { stream_type: 'hub', stream_id: branch(), event_type: 'PrinterSaved', payload: { printer_id: P.archived, name: 'Old', connection: 'lan', address: '192.168.1.22:9100', paper_width_mm: 80, archived: true } },
    ...(o.route === false ? [] : [{ stream_type: 'hub' as const, stream_id: branch(), event_type: 'BillRouteSet', payload: { scope: 'device', ref_id: device.deviceId, printer_id: P.counter } }]),
  ]);
}

/** One writer transaction of raw drafts (clock +1 s). */
function hubEvents(drafts: Array<Pick<EventDraft, 'stream_type' | 'stream_id' | 'event_type'> & { payload: unknown }>): PosEvent[] {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  return hub.deps.writer.run((tx) =>
    tx.append(drafts.map((d) => ({ ...d, schema_version: 1, payload: d.payload as PosEvent['payload'], occurred_at: now, actor_id: STAFF.manager, device_id: 'D_FIXTURE' }))),
  ).appended;
}

// ------------------------------------------------------------------------------------------------ bills

type Invoice = Record<string, unknown> & { invoice_id: string; invoice_ref: string; bill_id: string };
interface Closed {
  invoice: Invoice;
  invoice_id: string;
  bill_id: string;
  seating_id: string;
  receipt_job: string | null;
}

let seatNo = 0;
/**
 * A dine-in seating (T4 unless given, held by `holder`, default the order taker) with a karahi and two naans
 * (1,260.00 net), paid by card (5 % → 1,323.00) in `parts`, closed by the cashier, with an optional buyer.
 */
async function closedBill(o: { buyer?: { name: string; tax_id: { type: string; value: string } }; parts?: number[]; table_id?: string; holder?: string } = {}): Promise<Closed> {
  seatNo += 1;
  const seating_id = `SEAT_R${seatNo}`;
  openSeating(hub, { table_id: o.table_id ?? VX.tables.T4, seating_id, ...(o.holder === undefined ? {} : { holder_staff_id: o.holder }) });
  appendOrder(hub, {
    order_type: 'dine_in',
    seating_id,
    placed_by: STAFF.orderTaker,
    lines: [
      { order_item_id: `R${seatNo}_K`, item_id: FX.piece },
      { order_item_id: `R${seatNo}_N`, item_id: FX.naan, quantity: 2 },
    ],
  });
  const ref = { seating_id };
  for (const amount_minor of o.parts ?? [132_300]) {
    const p = await post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref: ref, split_no: 1, mode_id: 'card', direction: 'in', amount_minor });
    expect(p.status, JSON.stringify(p.error)).toBe(200);
  }
  const r = await post(hub, cashier, 'close-split', 'CloseSplit', { bill_ref: ref, split_no: 1, expected_total_minor: 132_300, ...(o.buyer === undefined ? {} : { buyer: o.buyer }) });
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  const invoice = r.events.find((e) => e.event_type === 'InvoiceIssued')!.payload as Invoice;
  return { invoice, invoice_id: invoice.invoice_id, bill_id: invoice.bill_id, seating_id, receipt_job: (r.result!['receipt'] as { job_id: string | null }).job_id };
}

/** The credit invoice of `c` as task 19 will append it (§6.13, §6.29: the sale's fields − discount_line_ids). */
function credit(c: Closed, n = 1): string {
  const sale: Record<string, unknown> = { ...c.invoice };
  delete sale['discount_line_ids'];
  const invoice_id = `CR_${c.invoice_id}`;
  hubEvents([
    {
      stream_type: 'bill',
      stream_id: c.bill_id,
      event_type: 'InvoiceCredited',
      payload: { ...sale, invoice_id, series: 'credit', number: n, invoice_ref: `C${String(n).padStart(6, '0')}`, issued_at: hub.clock.branchNow() + 1_000, ref_invoice_id: c.invoice_id, ref_invoice_ref: c.invoice.invoice_ref, alert_id: null },
    },
  ]);
  return invoice_id;
}

const assigned = (c: Closed, invoice_id: string, fiscal_number: string, qr_payload: string | null = null) =>
  hubEvents([{ stream_type: 'bill', stream_id: c.bill_id, event_type: 'FiscalNumberAssigned', payload: { invoice_id, adapter_key: 'FAKE', pos_id: 'POS-1', fiscal_number, qr_payload } }]);
const rejected = (c: Closed, invoice_id: string) =>
  hubEvents([{ stream_type: 'bill', stream_id: c.bill_id, event_type: 'FiscalSubmitRejected', payload: { invoice_id, adapter_key: 'FAKE', error_code: 'invalid_payload', http_status: 400 } }]);

// ------------------------------------------------------------------------------------------------ commands and reads

const reprint = (payload: Record<string, unknown>, who: Who = cashier, commandId?: string): Promise<Reply> => post(hub, who, 'print-bill-document', 'PrintBillDocument', payload, commandId);
const retarget = (payload: Record<string, unknown>, who: Who = cashier, commandId?: string): Promise<Reply> => post(hub, who, 'retarget-bill-print', 'RetargetBillPrint', payload, commandId);

const jobDoc = (job_id: string): Doc => (JSON.parse(db().prepare('SELECT payload FROM print_jobs WHERE job_id = ?').pluck().get(job_id) as string) as { doc: Doc }).doc;
const jobText = (job_id: string): string => {
  const doc = jobDoc(job_id);
  return renderText(doc, doc.width_cols ?? 48);
};
const jobPrinter = (job_id: string) => db().prepare('SELECT printer_id FROM print_jobs WHERE job_id = ?').pluck().get(job_id);
const billJob = (job_id: string) => db().prepare('SELECT job_id, bill_id, doc_kind, ref_id FROM bill_print_jobs WHERE job_id = ?').get(job_id);
const counts = () => ({
  print_jobs: db().prepare(`SELECT COUNT(*) FROM print_jobs WHERE kind = 'document'`).pluck().get() as number,
  bill_print_jobs: db().prepare('SELECT COUNT(*) FROM bill_print_jobs').pluck().get() as number,
  events: db().prepare('SELECT COUNT(*) FROM events').pluck().get() as number,
});

/** Handler statements of the last call of `path` (no append: these commands write no event). */
const handled: { count?: number } = {};
function countHandle(path: string): void {
  const def = commandRegistry(hub.app).byPath(path) as CommandDef | undefined;
  if (def === undefined) return; // not registered: every call answers 404 (the failing-first state)
  const counter = statementCounter(db());
  const original = def.handle;
  def.handle = (ctx, payload, cmd) => {
    counter.reset();
    try {
      return original.call(def, ctx, payload, cmd);
    } finally {
      handled.count = counter.count;
    }
  };
}

function startWorker(): PrintWorker {
  const transportFor = (p: { printer_id: string }): PrinterTransport => ({
    send: (bytes) => {
      const list = sends.get(p.printer_id) ?? [];
      list.push(Buffer.from(bytes).toString('latin1'));
      sends.set(p.printer_id, list);
      return answer(p.printer_id);
    },
    close: () => undefined,
  });
  const log = { info: (obj: Record<string, unknown>, msg?: string) => workerLogs.push(JSON.stringify(obj) + (msg ?? '')), error: (obj: Record<string, unknown>, msg?: string) => workerLogs.push(JSON.stringify(obj) + (msg ?? '')) };
  worker = createPrintWorker({ db: db(), state: hub.deps.state, clock: hub.clock, timers, transportFor, log });
  return worker;
}
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
async function passes(n = 3): Promise<void> {
  const w = worker ?? startWorker();
  for (let i = 0; i < n; i += 1) {
    w.pass();
    await flush();
    timers.advance(60_000);
    await flush();
  }
}
const sentTo = (printer_id: string): string[] => sends.get(printer_id) ?? [];

/** B19, H-4: `s` in the captured hub logs, the worker log, or any table but `invoice_buyers`. */
function leaksOf(s: string): string[] {
  const places: string[] = [];
  if (hub.logs().includes(s)) places.push('hub.logs()');
  if (workerLogs.join('\n').includes(s)) places.push('worker log');
  const tables = db().prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('invoice_buyers') ORDER BY name`).pluck().all() as string[];
  for (const t of tables) if (JSON.stringify(db().prepare(`SELECT * FROM "${t}"`).all()).includes(s)) places.push(`table ${t}`);
  return places;
}

// ================================================================================================= PrintBillDocument

describe('[05 §6.22, #61] PrintBillDocument — the receipt reprint, its fiscal state from the outbox row', () => {
  it('[05 #61] before FiscalNumberAssigned "FISCAL NUMBER PENDING"; after it the number and the QR block; REPRINT; a job at the device route', async () => {
    await start('FAKE');
    countHandle('print-bill-document');
    const c = await closedBill();
    expect(db().prepare('SELECT state FROM fiscal_outbox WHERE invoice_id = ?').pluck().get(c.invoice_id)).toBe('pending');

    const before = await reprint({ doc: 'receipt', ref_id: c.invoice_id });
    expect(before.status, JSON.stringify(before.error)).toBe(200);
    expect(before.events).toEqual([]); // §6.22: no event (a reprint changes no money)
    expect(before.result).toEqual({ printed: true, job_id: expect.any(String), printer_name: 'Counter' });
    const j1 = before.result!['job_id'] as string;
    expect(jobPrinter(j1)).toBe(P.counter);
    expect(billJob(j1)).toEqual({ job_id: j1, bill_id: c.bill_id, doc_kind: 'receipt', ref_id: c.invoice_id });
    const t1 = jobText(j1);
    expect(t1).toContain('** REPRINT **');
    expect(t1).toContain('FISCAL NUMBER PENDING');
    expect(t1).toContain(c.invoice.invoice_ref);
    expect(jobDoc(j1).blocks.some((b) => 'qr' in b)).toBe(false);
    // ≤ 9 (§6.22): invoice, bill, orders, payments, billPrinterFor, printer, printDocument (2), bill_print_jobs
    expect(handled.count).toBe(9);

    assigned(c, c.invoice_id, 'FN-0042');
    const after = await reprint({ doc: 'receipt', ref_id: c.invoice_id });
    expect(after.status, JSON.stringify(after.error)).toBe(200);
    const j2 = after.result!['job_id'] as string;
    const t2 = jobText(j2);
    expect(t2).toContain('** REPRINT **');
    expect(t2).toContain('TEST fiscal no.');
    expect(t2).toContain('FN-0042');
    expect(t2).not.toContain('FISCAL NUMBER PENDING');
    // the QR from the snapshot's template (H9-6: the invoice's own snapshot, never today's)
    expect(jobDoc(j2).blocks.filter((b) => 'qr' in b)).toEqual([{ qr: 'https://verify.test/FN-0042' }]);
    expect(handled.count).toBe(9);

    // the bytes: the number and the QR payload reach the printer
    await passes();
    expect(sentTo(P.counter).filter((s) => s.includes('FN-0042') && s.includes('https://verify.test/FN-0042'))).toHaveLength(1);
  });

  it('[05 #61, R-11] a rejected invoice reprints "FISCAL NUMBER NOT ISSUED", never PENDING', async () => {
    await start('FAKE');
    const c = await closedBill();
    rejected(c, c.invoice_id);
    const r = await reprint({ doc: 'receipt', ref_id: c.invoice_id });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const text = jobText(r.result!['job_id'] as string);
    expect(text).toContain('FISCAL NUMBER NOT ISSUED');
    expect(text).not.toContain('FISCAL NUMBER PENDING');
  });

  it('[05 R-55] a QR payload the printer cannot encode (over 400 code points) is left out; the number line still prints', async () => {
    await start('FAKE');
    const c = await closedBill();
    assigned(c, c.invoice_id, 'FN-0099', `https://verify.test/${'x'.repeat(400)}`);
    const r = await reprint({ doc: 'receipt', ref_id: c.invoice_id });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const job = r.result!['job_id'] as string;
    expect(jobDoc(job).blocks.some((b) => 'qr' in b)).toBe(false);
    expect(jobText(job)).toContain('FN-0099');
    await passes();
    expect(sentTo(P.counter).filter((s) => s.includes('FN-0099'))).toHaveLength(1);
  });

  it('[05 §6.22] a not-fiscalized invoice (PK, adapter none) reprints with no fiscal block; the payload printer_id wins over the route', async () => {
    await start('none');
    countHandle('print-bill-document');
    const c = await closedBill({ parts: [100_000, 20_000, 12_300] });
    const r = await reprint({ doc: 'receipt', ref_id: c.invoice_id, printer_id: P.other });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toEqual({ printed: true, job_id: expect.any(String), printer_name: 'Bar' });
    const job = r.result!['job_id'] as string;
    expect(jobPrinter(job)).toBe(P.other);
    expect(jobDoc(job).width_cols).toBe(32); // the 58 mm printer's width
    const text = jobText(job);
    expect(text).not.toContain('FISCAL NUMBER');
    expect(text).toContain('** REPRINT **');
    // the three payments of the invoice, joined by payment_id (fixed: 1 statement whatever their number)
    expect(text.split('\n').filter((l) => l.startsWith('Card'))).toHaveLength(3);
    expect(handled.count).toBe(8); // the payload printer: no route read
  });

  it('[05 §3.16, R8] no printer routed → printed: false, logged with ids only, no job; the command succeeds', async () => {
    await start('none', { route: false });
    const c = await closedBill();
    const before = counts();
    const r = await reprint({ doc: 'receipt', ref_id: c.invoice_id });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toEqual({ printed: false, job_id: null, printer_name: null });
    expect(counts()).toEqual(before);
    expect(hub.logs()).toContain('reprint skipped');
  });

  it('[05 §6.22, §9] errors: unknown invoice → 404 INVOICE_NOT_FOUND; a receipt asked for a credit (and back) → 404; unknown / archived printer → 404 PRINTER_NOT_FOUND; nothing written', async () => {
    await start('none');
    const c = await closedBill();
    const cr = credit(c);
    const before = counts();
    const unknown = await reprint({ doc: 'receipt', ref_id: 'NO_SUCH' });
    expect(unknown.status).toBe(404);
    expect(unknown.error).toEqual({ code: 'INVOICE_NOT_FOUND', details: { invoice_id: 'NO_SUCH' } });
    const wrongSeries = await reprint({ doc: 'receipt', ref_id: cr });
    expect(wrongSeries.error).toEqual({ code: 'INVOICE_NOT_FOUND', details: { invoice_id: cr } });
    const wrongBack = await reprint({ doc: 'credit_note', ref_id: c.invoice_id });
    expect(wrongBack.error).toEqual({ code: 'INVOICE_NOT_FOUND', details: { invoice_id: c.invoice_id } });
    const archived = await reprint({ doc: 'receipt', ref_id: c.invoice_id, printer_id: P.archived });
    expect(archived.status).toBe(404);
    expect(archived.error).toEqual({ code: 'PRINTER_NOT_FOUND', details: { printer_id: P.archived } });
    const missing = await reprint({ doc: 'receipt', ref_id: c.invoice_id, printer_id: 'P_NONE' });
    expect(missing.error).toEqual({ code: 'PRINTER_NOT_FOUND', details: { printer_id: 'P_NONE' } });
    const bad = await reprint({ doc: 'x_report', ref_id: c.invoice_id });
    expect(bad.status).toBe(400);
    expect(counts()).toEqual(before);
  });

  it('[05 D32] a retransmit with the same command_id returns the identical response and queues nothing more', async () => {
    await start('none');
    const c = await closedBill();
    const first = await reprint({ doc: 'receipt', ref_id: c.invoice_id }, cashier, 'reprint-once');
    expect(first.status, JSON.stringify(first.error)).toBe(200);
    const after = counts();
    const again = await reprint({ doc: 'receipt', ref_id: c.invoice_id }, cashier, 'reprint-once');
    expect(again.status).toBe(200);
    expect(again.result).toEqual(first.result);
    expect(counts()).toEqual(after);
  });

  it('[05 §6.22, C8, §10 grant states] take-payment: allowed in scope prints; own_tables outside the seating → 403 outside_scope; requires_approval → 403; not granted → 403; nothing written', async () => {
    await start('none');
    const held = await closedBill(); // held by the order taker (take-payment own_tables, row B-2)
    const notHeld = await closedBill({ table_id: VX.tables.T5, holder: STAFF.cashier });
    const taker = signIn(hub, STAFF.orderTaker);

    const ok = await reprint({ doc: 'receipt', ref_id: held.invoice_id }, taker);
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);

    const before = counts();
    const outside = await reprint({ doc: 'receipt', ref_id: notHeld.invoice_id }, taker);
    expect(outside.status).toBe(403);
    expect(outside.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope' } });
    expect(counts()).toEqual(before);

    // grant first: an unknown invoice with no grant is 403, not 404
    await orderTakerGrants((g) => g.filter((x) => x.permission !== 'take-payment'));
    const none = await reprint({ doc: 'receipt', ref_id: 'NO_SUCH' }, signIn(hub, STAFF.orderTaker));
    expect(none.status).toBe(403);
    expect(none.error).toMatchObject({ code: 'PERMISSION_DENIED' });

    await orderTakerGrants((g) => g.map((x) => (x.permission === 'take-payment' ? { ...x, grant_type: 'requires_approval' as const, approver_role_id: 'R_MGR', approver_role_ids: ['R_MGR'] } : x)));
    const approval = await reprint({ doc: 'receipt', ref_id: held.invoice_id }, signIn(hub, STAFF.orderTaker));
    expect(approval.status).toBe(403);
    expect(approval.error).toMatchObject({ code: 'PERMISSION_DENIED' });
    // the re-seeds append directory events of their own; no print was queued
    expect({ ...counts(), events: before.events }).toEqual(before);
  });
});

describe('[05 §6.22, B19, #43, row P-5] PrintBillDocument — the full buyer ID only on that customer\'s receipt, only at send', () => {
  for (const [type, value, stored] of [
    ['CNIC', '35202-1234567-1', '3520212345671'],
    ['NTN', 'A1B2C3D', 'A1B2C3D'],
  ] as const) {
    it(`[05 #43 ${type}] the reprint's job holds the last 4 only; the worker fills the full ID from invoice_buyers for that receipt; another customer's receipt and the credit note never carry it`, async () => {
      await start('FAKE');
      const name = secret(`Reprint Buyer ${type}`);
      secret(value);
      secret(stored);
      const mine = await closedBill({ buyer: { name, tax_id: { type, value } } });
      const other = await closedBill({ table_id: VX.tables.T5 });
      const cr = credit(mine);
      await passes(); // the two original receipts go out first (the close's own jobs)
      sends.clear();

      const r1 = await reprint({ doc: 'receipt', ref_id: mine.invoice_id });
      expect(r1.status, JSON.stringify(r1.error)).toBe(200);
      const mineJob = r1.result!['job_id'] as string;
      // the stored copy: the fill block with the mask, never the value or the name (B19, Q-2)
      expect(jobDoc(mineJob).blocks.filter((b) => 'fill' in b)).toEqual([{ fill: BUYER_ID_FILL, ref: mine.invoice_id, last4: `${type}: ****${stored.slice(-4)}` }]);

      const r2 = await reprint({ doc: 'receipt', ref_id: other.invoice_id });
      expect(r2.status, JSON.stringify(r2.error)).toBe(200);
      const otherJob = r2.result!['job_id'] as string;
      expect(jobDoc(otherJob).blocks.some((b) => 'fill' in b)).toBe(false);

      const r3 = await reprint({ doc: 'credit_note', ref_id: cr });
      expect(r3.status, JSON.stringify(r3.error)).toBe(200);
      const creditJob = r3.result!['job_id'] as string;
      expect(billJob(creditJob)).toEqual({ job_id: creditJob, bill_id: mine.bill_id, doc_kind: 'credit', ref_id: cr });
      expect(jobDoc(creditJob).blocks.some((b) => 'fill' in b)).toBe(false);
      const creditText = jobText(creditJob);
      expect(creditText).toContain('CREDIT NOTE');
      expect(creditText).toContain('** REPRINT **');
      expect(creditText).toContain(`${type}: ****${stored.slice(-4)}`); // Q-3: the last 4, from the original's row
      expect(creditText).toContain(mine.invoice.invoice_ref);
      expect(creditText).toContain('FISCAL NUMBER PENDING'); // its own outbox row

      // nothing in the results, the jobs or the logs so far
      for (const r of [r1, r2, r3]) expect(JSON.stringify(r)).not.toContain(stored.slice(0, -4));

      await passes();
      const bytes = sentTo(P.counter);
      expect(bytes).toHaveLength(3);
      const [b1, b2, b3] = bytes as [string, string, string];
      expect(b1).toContain(`${type}: ${stored}`);
      expect(b1).toContain(name);
      for (const b of [b2, b3]) {
        expect(b).not.toContain(stored);
        expect(b).not.toContain(name);
      }
      expect(b3).toContain(`****${stored.slice(-4)}`);
      // the scan (afterEach) is live: the mask is in print_jobs
      expect(leaksOf(`****${stored.slice(-4)}`)).toContain('table print_jobs');
    });
  }
});

describe('[05 §6.22] PrintBillDocument — the credit note reprint', () => {
  it('[05 §6.22, #61] a credit note reprints with its own fiscal state: pending, then its number; a doc_kind credit job at the route', async () => {
    await start('FAKE');
    countHandle('print-bill-document');
    const c = await closedBill();
    const cr = credit(c);
    const r = await reprint({ doc: 'credit_note', ref_id: cr });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toEqual({ printed: true, job_id: expect.any(String), printer_name: 'Counter' });
    expect(jobText(r.result!['job_id'] as string)).toContain('FISCAL NUMBER PENDING');
    // invoice (+ original's ref and buyer last 4 in the same statement), bill, orders, route (2), printDocument (2), job row
    expect(handled.count).toBe(8);
    assigned(c, cr, 'FN-C-7');
    const again = await reprint({ doc: 'credit_note', ref_id: cr });
    const text = jobText(again.result!['job_id'] as string);
    expect(text).toContain('FN-C-7');
    expect(text).toContain('Against invoice');
  });
});

// ================================================================================================= RetargetBillPrint

describe('[05 §6.23, #60, B18] RetargetBillPrint — Print to', () => {
  it('[05 #60] a waiting receipt job moves to another printer; the result is its new status; it prints there once and never on the first', async () => {
    await start('none');
    countHandle('retarget-bill-print');
    const c = await closedBill();
    const job = c.receipt_job!;
    const r = await retarget({ job_id: job, printer_id: P.other });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.events).toEqual([]); // no event
    expect(r.result).toEqual({ job_id: job, printer_id: P.other, printer_name: 'Bar', state: 'waiting', last_error: null });
    expect(handled.count).toBe(2); // the bill_print_jobs row, the move (§6.23: ≤ 3; the third names a refusal)
    await passes();
    expect(sentTo(P.other)).toHaveLength(1);
    expect(sentTo(P.counter)).toHaveLength(0);
  });

  it('[05 #60] a failed reprint job moves and prints once on the new printer; the old printer never retries it', async () => {
    await start('none');
    const c = await closedBill();
    await passes(); // the close's own receipt
    sends.clear();
    const rp = await reprint({ doc: 'receipt', ref_id: c.invoice_id });
    const job = rp.result!['job_id'] as string;
    answer = (p) => Promise.resolve(p === P.counter ? { ok: false, error: 'connect_failed', detail: null, wrote: false } : { ok: true });
    worker!.pass();
    await flush();
    expect(db().prepare('SELECT attempts FROM print_jobs WHERE job_id = ?').pluck().get(job)).toBe(1);
    const r = await retarget({ job_id: job, printer_id: P.other });
    expect(r.result).toEqual({ job_id: job, printer_id: P.other, printer_name: 'Bar', state: 'waiting', last_error: null });
    await passes();
    expect(sentTo(P.counter)).toHaveLength(1); // the one failed attempt
    expect(sentTo(P.other)).toHaveLength(1);
    expect(sentTo(P.other)[0]).toContain('REPRINT');
  });

  it('[05 #60, §9] a printed job → 409 PRINT_JOB_NOT_PENDING; an archived or unknown printer → 404 PRINTER_NOT_FOUND; an unknown job or a non-bill job → 404 PRINT_JOB_NOT_FOUND; nothing moves', async () => {
    await start('none');
    countHandle('retarget-bill-print');
    const c = await closedBill();
    const job = c.receipt_job!;
    const archived = await retarget({ job_id: job, printer_id: P.archived });
    expect(archived.status).toBe(404);
    expect(archived.error).toEqual({ code: 'PRINTER_NOT_FOUND', details: { printer_id: P.archived } });
    expect(handled.count).toBe(3);
    const missingPrinter = await retarget({ job_id: job, printer_id: 'P_NONE' });
    expect(missingPrinter.error).toEqual({ code: 'PRINTER_NOT_FOUND', details: { printer_id: 'P_NONE' } });
    expect(jobPrinter(job)).toBe(P.counter);

    const unknown = await retarget({ job_id: 'NO_SUCH', printer_id: P.other });
    expect(unknown.status).toBe(404);
    expect(unknown.error).toEqual({ code: 'PRINT_JOB_NOT_FOUND', details: { job_id: 'NO_SUCH' } });
    expect(handled.count).toBe(1);
    // a 03c document job that is not a bill document (no bill_print_jobs row)
    const foreign = hub.deps.writer.run((tx) => printDocument(tx, P.counter, { blocks: [{ text: 'not a bill' }] }, { kind_label: 'Other' })).result.job_id;
    const notBill = await retarget({ job_id: foreign, printer_id: P.other });
    expect(notBill.error).toEqual({ code: 'PRINT_JOB_NOT_FOUND', details: { job_id: foreign } });
    expect(jobPrinter(foreign)).toBe(P.counter);

    await passes();
    const printed = await retarget({ job_id: job, printer_id: P.other });
    expect(printed.status).toBe(409);
    expect(printed.error).toEqual({ code: 'PRINT_JOB_NOT_PENDING', details: { job_id: job, state: 'printed' } });
    expect(jobPrinter(job)).toBe(P.counter);
    await passes();
    expect(sentTo(P.other)).toHaveLength(0); // nothing prints twice
  });

  it('[05 §6.23, §10 grant states] take-order allowed (any scope) moves; requires_approval → 403 (not approvable); not granted → 403 before the 404', async () => {
    await start('none');
    const c = await closedBill();
    await orderTakerGrants((g) => g.map((x) => (x.permission === 'take-order' ? { ...x, scope: 'own_tables' as const } : x)));
    const taker = signIn(hub, STAFF.orderTaker);
    const ok = await retarget({ job_id: c.receipt_job!, printer_id: P.other }, taker);
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);

    await orderTakerGrants((g) => g.map((x) => (x.permission === 'take-order' ? { ...x, grant_type: 'requires_approval' as const, approver_role_id: 'R_MGR', approver_role_ids: ['R_MGR'] } : x)));
    const approval = await retarget({ job_id: c.receipt_job!, printer_id: P.counter }, signIn(hub, STAFF.orderTaker));
    expect(approval.status).toBe(403);
    expect(approval.error).toMatchObject({ code: 'PERMISSION_DENIED' });

    await orderTakerGrants((g) => g.filter((x) => x.permission !== 'take-order'));
    const none = await retarget({ job_id: 'NO_SUCH', printer_id: P.counter }, signIn(hub, STAFF.orderTaker));
    expect(none.status).toBe(403);
    expect(jobPrinter(c.receipt_job!)).toBe(P.other);
  });

  it('[05 D32] a retarget retransmit with the same command_id returns the identical response and moves nothing again', async () => {
    await start('none');
    const c = await closedBill();
    const first = await retarget({ job_id: c.receipt_job!, printer_id: P.other }, cashier, 'retarget-once');
    expect(first.status, JSON.stringify(first.error)).toBe(200);
    // moved back by hand: a replay must not move it again
    db().prepare('UPDATE print_jobs SET printer_id = ? WHERE job_id = ?').run(P.counter, c.receipt_job!);
    const again = await retarget({ job_id: c.receipt_job!, printer_id: P.other }, cashier, 'retarget-once');
    expect(again.status).toBe(200);
    expect(again.result).toEqual(first.result);
    expect(jobPrinter(c.receipt_job!)).toBe(P.counter);
  });
});
