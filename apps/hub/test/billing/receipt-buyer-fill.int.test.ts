import { BUYER_ID_FILL, buildCreditNoteDoc, buildReceiptDoc, type Doc, type DocContext, type FiscalSaleInvoiceFields } from '@pos/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { printDocument } from '../../src/print/api';
import type { SendResult } from '../../src/print/transport/lan';
import { createPrintWorker, registerDocumentFiller, resetDocumentFillers, type PrinterTransport } from '../../src/print/worker';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { append as kdsAppend, openDay } from '../kds/fixtures';
import { fakeClock, type FakeClock } from '../print/fixtures';

// 05 §11 task 4b — B19, §6.12 step 7, §6.22, row P-5 (03c v1.0.14 §3.6, §3.7): the receipt Doc carries the buyer block
// as `{ fill: 'buyer_id', ref: invoice_id, last4 }`; the full tax ID lives only in `invoice_buyers`, reaches the paper
// at send through the filler, and is never in a Doc, `print_jobs.payload`, a log line or an event. Only that
// customer's receipt (and its reprint) is filled; another invoice's receipt and the credit note are not.
// The filler here is a test stand-in for 05's (registered by the close / print tasks, 17 / 27): one SELECT on
// invoice_buyers by ref. The ID and name are obviously fake values, used only in this file.

const FULL_ID = '9999900001234';
const BUYER_NAME = 'Test Buyer Zed';

let hub: TestHub;
let clock: FakeClock;
const stops: Array<() => void> = [];
const workerLogs: Array<{ obj: Record<string, unknown>; msg: string | undefined }> = [];
const asked: string[] = [];

const CTX: DocContext = {
  width_cols: 48,
  currency_exponent: 2,
  utc_offset_ms: 0,
  branch_name: 'Test branch',
  template: {
    header_lines: [],
    footer_lines: [],
    show: { tax_reg_no: false, address: false, phone: false, cashier: false, order_no: false, bill_no: false },
    address: null,
    phone: null,
  },
};

function invoice(invoice_id: string, invoice_ref: string): FiscalSaleInvoiceFields {
  return {
    series: 'sale',
    invoice_id,
    invoice_ref,
    issued_at: Date.UTC(2026, 10, 20, 8, 0),
    order_type: 'dine_in',
    jurisdiction_id: 'TEST-J',
    currency_code: 'PKR',
    prices_include_tax: false,
    lines: [],
    service_charge: null,
    subtotal_minor: 6_000_000,
    discount_minor: 0,
    taxes: [],
    rounding_minor: 0,
    total_minor: 6_000_000,
    payment_ids: [],
    buyer_id_refused: false,
    fiscal: {
      adapter_key: 'FAKE',
      pos_id: 'POS-1',
      required: true,
      capabilities: { ordering: 'none', credit: true },
      credit_support: 'credit_invoice',
      rounding: { step_minor: 100, mode: 'nearest', applies_to: 'all' },
      receipt: { fiscal_number_label: 'Fiscal no.', tax_reg_labels: [], show_qr: true, qr_url_template: 'https://verify.test/{fiscal_number}', buyer_id_on_receipt: true },
      seller_registrations: [],
      payment_codes: [],
    },
  };
}

beforeEach(async () => {
  workerLogs.length = 0;
  asked.length = 0;
  hub = await createTestHub({ provisioned: true });
  openDay(hub);
  clock = fakeClock();
  kdsAppend(
    hub,
    [
      {
        stream_type: 'hub',
        stream_id: hub.deps.config.provisioned!.branch_id,
        event_type: 'PrinterSaved',
        payload: { printer_id: 'PR1', name: 'PR1', connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived: false },
      },
    ],
    { actor: null },
  );
  // B19: written by CloseSplit in the close transaction (plain statement, hub state, never an event)
  hub.deps.db.prepare(`INSERT INTO invoice_buyers (invoice_id, buyer_name, id_type, id_value) VALUES ('INV-B', ?, 'CNIC', ?)`).run(BUYER_NAME, FULL_ID);
  registerDocumentFiller(BUYER_ID_FILL, (db, ref) => {
    asked.push(ref);
    const r = db.prepare('SELECT buyer_name, id_type, id_value FROM invoice_buyers WHERE invoice_id = ?').get(ref) as
      | { buyer_name: string; id_type: string; id_value: string }
      | undefined;
    return r === undefined ? null : `${r.buyer_name}\n${r.id_type}: ${r.id_value}`;
  });
});
afterEach(async () => {
  for (const s of stops.splice(0)) s();
  resetDocumentFillers();
  await hub.close();
});

const queue = (doc: Doc): string => hub.deps.writer.run((tx) => printDocument(tx, 'PR1', doc, { kind_label: 'Receipt' }).job_id).result;

async function sendAll(n: number): Promise<string[]> {
  const sends: string[] = [];
  const t: PrinterTransport = {
    send(bytes: Uint8Array): Promise<SendResult> {
      sends.push(Buffer.from(bytes).toString('latin1'));
      return Promise.resolve({ ok: true });
    },
    close: () => undefined,
  };
  const log = {
    info: (obj: Record<string, unknown>, msg?: string) => workerLogs.push({ obj, msg }),
    error: (obj: Record<string, unknown>, msg?: string) => workerLogs.push({ obj, msg }),
  };
  const w = createPrintWorker({ db: hub.deps.db, state: hub.deps.state, clock: hub.clock, timers: clock, transportFor: () => t, log });
  stops.push(() => w.stop());
  for (let i = 0; i < 50 && sends.length < n; i += 1) {
    w.pass();
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(sends).toHaveLength(n);
  return sends;
}

/** The spike's scan (B22 / §7), for the buyer ID: every table but invoice_buyers, the hub log and the worker log. */
function leaksOf(secret: string): string[] {
  const places: string[] = [];
  if (hub.logs().includes(secret)) places.push('hub.logs()');
  if (JSON.stringify(workerLogs).includes(secret)) places.push('worker log');
  const tables = hub.deps.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'invoice_buyers' ORDER BY name`).pluck().all() as string[];
  for (const t of tables) {
    if (JSON.stringify(hub.deps.db.prepare(`SELECT * FROM "${t}"`).all()).includes(secret)) places.push(`table ${t}`);
  }
  return places;
}

const receipt = (inv: FiscalSaleInvoiceFields, buyer: { type_label: string; last4: string } | null, is_reprint: boolean): Doc =>
  buildReceiptDoc(
    {
      invoice: inv,
      payments: [{ mode_name: 'Cash', payment_class: 'cash', direction: 'in', amount_minor: 6_000_000 }],
      change_minor: 0,
      cashier_name: null,
      order_label: null,
      bill_label: null,
      fiscal: is_reprint ? { state: 'acked', fiscal_number: 'FN-42', qr_payload: null } : { state: 'pending' },
      buyer,
      is_reprint,
    },
    CTX,
  );

describe('[05 4b] buyer tax ID: filled only at send, only on that customer\'s receipt (B19, row P-5)', () => {
  it('[05 B19, row P-5] the receipt and its reprint print the full ID; no Doc, print job, log, event or other table holds it', async () => {
    // the full value is passed as last4 on purpose: the builder itself cuts it to the last 4 (B19)
    const buyer = { type_label: 'CNIC', last4: FULL_ID };
    const original = receipt(invoice('INV-B', 'S000001'), buyer, false);
    const reprint = receipt(invoice('INV-B', 'S000001'), buyer, true); // §6.22: rebuilt from the invoice, never from the queue
    const other = receipt(invoice('INV-O', 'S000002'), null, false); // another customer's receipt: no buyer, no fill block
    for (const doc of [original, reprint, other]) expect(JSON.stringify(doc)).not.toContain(FULL_ID);
    expect(original.blocks.filter((b) => 'fill' in b)).toEqual([{ fill: 'buyer_id', ref: 'INV-B', last4: 'CNIC: ****1234' }]);
    expect(other.blocks.some((b) => 'fill' in b)).toBe(false);

    queue(original);
    queue(other);
    queue(reprint);
    const [s1, s2, s3] = await sendAll(3);
    expect(asked).toEqual(['INV-B', 'INV-B']); // the filler is asked for that invoice only, at each send
    expect(s1).toContain(`CNIC: ${FULL_ID}`);
    expect(s1).toContain(BUYER_NAME);
    expect(s2).not.toContain(FULL_ID);
    expect(s2).not.toContain(BUYER_NAME);
    expect(s3).toContain('REPRINT');
    expect(s3).toContain(`CNIC: ${FULL_ID}`);
    expect(s3).toContain('https://verify.test/FN-42'); // the QR block's payload in the GS ( k bytes

    // the scan is live in each part: the mask is in print_jobs, the worker logged its sends, the hub log has a probe
    expect(leaksOf('CNIC: ****1234')).toContain('table print_jobs');
    expect(leaksOf('print.sent')).toContain('worker log');
    hub.app.log.info({ probe: 'scan-probe-4b' }, 'scan probe');
    expect(leaksOf('scan-probe-4b')).toContain('hub.logs()');
    expect(leaksOf(FULL_ID)).toEqual([]);
    expect(leaksOf(BUYER_NAME)).toEqual([]);
  });

  it('[05 Q-3] the credit note prints the last 4 only: no fill block, the filler is never asked', async () => {
    const inv = invoice('INV-B', 'S000001');
    const credit = buildCreditNoteDoc(
      {
        invoice: { ...inv, series: 'credit', invoice_id: 'CR-1', invoice_ref: 'C000001', ref_invoice_id: 'INV-B', ref_invoice_ref: 'S000001' },
        buyer_id: { type_label: 'CNIC', last4: FULL_ID }, // the full value: the builder cuts it (Q-3)
        fiscal: { state: 'pending' },
        is_reprint: false,
        cashier_name: null,
      },
      CTX,
    );
    queue(credit);
    const [sent] = await sendAll(1);
    expect(asked).toEqual([]);
    expect(sent).toContain('CNIC: ****1234');
    expect(sent).not.toContain(FULL_ID);
    expect(leaksOf(FULL_ID)).toEqual([]);
  });
});
