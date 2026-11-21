// 05 §6.12 `CloseSplit` (task 17; 05-plan §3 row 17): §3.3 rules 1–9 in order, the gap-free sale number, `InvoiceIssued`
// + `closed_split_units`, `DiscountFrozen` at the first close (R-41), `OrdersBilled` + `BillClosed` at the last split,
// the outbox row (task 7's fold through 28a's outboxRowFor), the `invoice_buyers` row, the receipt job; B12, B13, B15,
// B19, B20, B21, H8-3, R-46, R-55, §3.15, §3.16, §5, §6.29, §9. Real commands over HTTP through the hub's writer, the
// real `billing`, `shifts`, `orders`, `tables` folds, real `OpenShift` / `AddPayment` / `SetSplits` /
// `RemoveServiceCharge`. In-test pieces (their tasks are not built): a `DiscountApplied` event (task 13), a raised
// `remove_comp` request (task 20). Every PKR amount below is pinned.
import { BUYER_ID_FILL, type Doc } from '@pos/domain';
import { DiscountApplied, draftOf, rateBpRates, type BranchConfig, type EventDef, type EventDraft, type PosEvent, type SnapshotBilling } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { alerts } from '../../src/alerts/raise';
import { currentDirectory } from '../../src/auth/guards';
import { hubBilling } from '../../src/billing/defaults';
import { noneAdapter } from '../../src/billing/fiscal/none';
import { registerFiscalAdapter, resetFiscalAdapters } from '../../src/billing/fiscal/port';
import type { BillView } from '../../src/billing/queries/bill';
import type { CommandCtx, CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { createPrintWorker, type PrinterTransport } from '../../src/print/worker';
import type { SendResult } from '../../src/print/transport/lan';
import { currentConfigEntry, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';
import { fakeClock } from '../print/fixtures';
import { openDay, voidsMenu } from '../voids/fixtures';
import { fakeAdapter, type FakeAdapter } from './fiscal/fake-adapter';
import {
  answer,
  appendOrder,
  billingDirectory,
  dineInTwoRounds,
  drawerDevice,
  FX,
  openSeating,
  pendingWeight,
  post,
  raiseVoid,
  signIn,
  signInOn,
  STAFF,
  VX,
  type Reply,
  type Who,
} from './fixtures';

let hub: TestHub;
const commit = { fail: false };
const fake: FakeAdapter = fakeAdapter({ key: 'FAKE', ordering: 'strict_per_pos_id', credentialNames: ['token'] });

/** Every buyer ID and name a test sends: the afterEach scan holds each to `invoice_buyers` (B19, H-4). */
const SECRETS = new Set<string>();
const secret = (s: string): string => {
  SECRETS.add(s);
  return s;
};

beforeEach(() => {
  registerFiscalAdapter(noneAdapter);
  registerFiscalAdapter(fake);
});

afterEach(async () => {
  // B19, H-4, §7 Privacy: the permanent scan — every buyer ID / name a test sent, after every test
  const found = hub === undefined ? [] : [...SECRETS].flatMap((s) => leaksOf(s).map((place) => `${s} in ${place}`));
  SECRETS.clear();
  commit.fail = false;
  swapBranchConfig(null);
  resetFiscalAdapters();
  await hub?.close();
  hub = undefined as unknown as TestHub;
  expect(found).toEqual([]);
});

// ------------------------------------------------------------------------------------------------ config

/** PK-PB's buyer types (cloud 0014 seed). */
const BUYER_TYPES = [
  { type: 'CNIC', label: 'CNIC', pattern: '^[0-9]{13}$', strip: '-' },
  { type: 'NTN', label: 'NTN', pattern: '^[A-Za-z0-9]{7,9}$', strip: '' },
];

interface DocOptions {
  /** default 'none' (the PK built-in jurisdiction); 'FAKE' = a test jurisdiction on the fake adapter */
  adapter_key?: 'none' | 'FAKE';
  switched_at?: string | null;
  fiscalize?: { dine_in: boolean; takeaway: boolean; parking: boolean; delivery: boolean };
  /** buyer-ID threshold (null = never asked) */
  threshold?: number | null;
  buyer_on_receipt?: boolean;
  /** dine-in service charge (bp) and its tax profile */
  sc_bp?: number;
  sc_profile?: string | null;
  prefix?: string;
  /** no printer route at all */
  no_printer?: boolean;
  /** permissions denied to the Order taker (the grant-first test) */
  deny?: string[];
}

/**
 * The PK built-in document (rounding Rs 1 nearest, all) with three modes — cash, card (digital), voucher (digital,
 * no authority code) — 'tc-food' at 16 % cash / 5 % card. `FAKE`: jurisdiction TEST-J on the fake adapter, seller NTN,
 * default POS-1, a fiscal number label, PK-PB's buyer types.
 */
function billingDoc(o: DocOptions = {}): SnapshotBilling {
  const pk = hubBilling({ currency_code: 'PKR', tax_classes: [], billing: undefined });
  const adapter = o.adapter_key ?? 'none';
  const code = (c: string) => (adapter === 'none' ? [] : [{ adapter_key: adapter, code: c }]);
  const cash = pk.settings.payment_modes[0]!;
  const digital = (mode_id: string, name: string, sort_order: number, codes: Array<{ adapter_key: string; code: string }>) => ({
    mode_id,
    name,
    kind: 'card' as const,
    payment_class: 'digital' as const,
    reference_required: false,
    is_active: true,
    sort_order,
    authority_codes: codes,
  });
  const jurisdiction_id = adapter === 'none' ? pk.jurisdiction.jurisdiction_id : 'TEST-J';
  return {
    ...pk.settings,
    jurisdiction_id,
    payment_modes: [{ ...cash, authority_codes: code('1') }, digital('card', 'Card', 1, code('2')), digital('voucher', 'Voucher', 2, [])],
    service_charge_bp: { ...pk.settings.service_charge_bp, dine_in: o.sc_bp ?? 0 },
    service_charge_tax_profile_id: o.sc_profile === undefined ? null : o.sc_profile,
    receipt: { ...pk.settings.receipt, invoice_prefix: o.prefix ?? '', tax_registrations: adapter === 'none' ? [] : [{ code: 'NTN', number: '1234567' }] },
    fiscal: {
      ...pk.settings.fiscal,
      pos_ids: adapter === 'none' ? [] : [{ pos_id: 'POS-1', label: 'Counter' }],
      default_pos_id: adapter === 'none' ? null : 'POS-1',
      switched_at: o.switched_at ?? null,
      fiscalize_by_order_type: o.fiscalize ?? pk.settings.fiscal.fiscalize_by_order_type,
    },
    jurisdiction: {
      ...pk.jurisdiction,
      jurisdiction_id,
      adapter_key: adapter,
      rules: pk.jurisdiction.rules.map((r) => ({
        ...r,
        rounding_step_minor: 100,
        rounding_mode: 'nearest' as const,
        rounding_applies_to: 'all' as const,
        buyer_id: { threshold_minor: o.threshold ?? null, accepted_types: BUYER_TYPES },
        receipt:
          adapter === 'none'
            ? { ...r.receipt, buyer_id_on_receipt: o.buyer_on_receipt ?? false }
            : { fiscal_number_label: 'TEST fiscal no.', tax_reg_labels: [{ code: 'NTN', label: 'NTN' }], show_qr: false, qr_url_template: null, buyer_id_on_receipt: o.buyer_on_receipt ?? true },
      })),
    },
    tax_profiles: [
      {
        tax_class_id: 'tc-food',
        taxes: [
          {
            seq: 1,
            tax_code: 'TAX',
            label: 'Sales tax',
            compound: false,
            rates: [...rateBpRates(1_600).filter((x) => x.payment_class === 'cash'), ...rateBpRates(500).filter((x) => x.payment_class === 'digital')],
          },
        ],
      },
    ],
  } as SnapshotBilling;
}

/** voidsMenu() with the karahi and naan taxed under 'tc-food'. */
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

/** A new billing document on the applied config (the menu and everything else kept). */
function reconfigure(o: DocOptions): void {
  const cur = currentConfigEntry()!;
  swapBranchConfig({ ...cur, config: { ...cur.config, billing: billingDoc(o) } });
}

const STOCK = { [FX.stock]: 1_000_000, [VX.naanStock]: 1_000 };
const PRINTER = 'PR_COUNTER';
/** the empty close with one request to close obsolete (closeMany 1 + its request_result raise) */
const EMPTY_CLOSE_STATEMENTS = 14; // the 7 of a bare empty close + alerts.closeMany and its request_result raise (01d's)

/** handler statements of the last close, without the append and its folds (00's envelope) */
const handled: { count?: number; append?: number } = {};

function countHandle(path: string): void {
  const def = commandRegistry(hub.app).byPath(path) as CommandDef | undefined;
  if (def === undefined) return; // not registered: every call answers 404 (the failing-first state)
  const counter = statementCounter(hub.deps.db);
  const original = def.handle;
  def.handle = (ctx, payload, cmd) => {
    counter.reset();
    let appendCost = 0;
    const tx = ctx.tx;
    const realAppend = tx.append.bind(tx);
    const counted = (drafts: Parameters<typeof tx.append>[0]) => {
      const before = counter.count;
      try {
        return realAppend(drafts);
      } finally {
        appendCost += counter.count - before;
      }
    };
    const wrapped = new Proxy(tx, { get: (t, k) => (k === 'append' ? counted : Reflect.get(t, k)) });
    try {
      return original.call(def, { ...ctx, tx: wrapped } as CommandCtx, payload, cmd);
    } finally {
      handled.count = counter.count - appendCost;
      handled.append = appendCost;
    }
  };
}

let cashier: { who: Who; shift_id: string };

async function start(o: DocOptions = {}): Promise<void> {
  hub = await createTestHub({ testHooks: { beforeCommit: () => { if (commit.fail) throw new Error('commit failed'); } } });
  const directory = await billingDirectory();
  const denied = o.deny;
  await seedDirectory(hub, denied === undefined ? directory : ({ ...directory, staff: directory.staff.map((x) => (x.staff_id === STAFF.orderTaker ? { ...x, denied_permissions: denied } : x)) } as typeof directory));
  openDay(hub, { menu: menu(billingDoc(o)), stock: STOCK });
  delete handled.count;
  delete handled.append;
  countHandle('close-split');
  const device = drawerDevice(hub, 'Counter kiosk');
  const who = signInOn(hub, STAFF.cashier, device);
  const shift = await post(hub, who, 'open-shift', 'OpenShift', { float_minor: 0, as_drawer: true });
  expect(shift.status, JSON.stringify(shift.error)).toBe(200);
  cashier = { who, shift_id: shift.result!['shift_id'] as string };
  if (o.no_printer !== true) {
    hubEvents([
      { stream_type: 'hub', stream_id: branch(), event_type: 'PrinterSaved', payload: { printer_id: PRINTER, name: 'Counter', connection: 'lan', address: '192.168.1.20:9100', paper_width_mm: 80, archived: false } },
      { stream_type: 'hub', stream_id: branch(), event_type: 'BillRouteSet', payload: { scope: 'device', ref_id: device.deviceId, printer_id: PRINTER } },
    ]);
  }
}

const db = () => hub.deps.db;
const branch = () => hub.deps.config.provisioned!.branch_id;

/** One writer transaction of raw drafts (clock +1 s). */
function hubEvents(drafts: Array<Pick<EventDraft, 'stream_type' | 'stream_id' | 'event_type'> & { payload: unknown }>): PosEvent[] {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  return hub.deps.writer.run((tx) =>
    tx.append(drafts.map((d) => ({ ...d, schema_version: 1, payload: d.payload as PosEvent['payload'], occurred_at: now, actor_id: STAFF.manager, device_id: 'D_FIXTURE' }))),
  ).appended;
}

function appendEvent(def: EventDef<z.ZodType>, stream_id: string, payload: unknown): void {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  hub.deps.writer.run((tx) => tx.append([draftOf(def, { stream_type: 'bill', stream_id, payload: def.payload.parse(payload), occurred_at: now, actor_id: STAFF.manager, device_id: 'D_FIXTURE' })]));
}

function close(who: Who, payload: Record<string, unknown>, commandId?: string): Promise<Reply> {
  return post(hub, who, 'close-split', 'CloseSplit', payload, commandId);
}

function pay(who: Who, bill_ref: Record<string, string>, split_no: number, mode_id: string, amount_minor: number, tendered_minor?: number): Promise<Reply> {
  return post(hub, who, 'add-payment', 'AddPayment', {
    bill_ref,
    split_no,
    mode_id,
    direction: 'in',
    amount_minor,
    ...(tendered_minor === undefined ? {} : { tendered_minor }),
  }).then((r) => {
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    return r;
  });
}

async function view(who: Who, qs: Record<string, string>): Promise<BillView> {
  const res = await hub.app.inject({ method: 'GET', url: `/queries/bill?${new URLSearchParams(qs).toString()}`, headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: BillView }).data;
}

let seatNo = 0;
/** A seating (default T4) with one dine-in round of `lines`. */
function seated(lines: Array<{ order_item_id: string; item_id: string; quantity?: number }>, table_id: string = VX.tables.T4, holder?: string): { seating_id: string; order_id: string } {
  seatNo += 1;
  const seating_id = `SEAT_C${seatNo}`;
  openSeating(hub, { table_id, seating_id, ...(holder === undefined ? {} : { holder_staff_id: holder }) });
  const { order_id } = appendOrder(hub, { order_type: 'dine_in', seating_id, placed_by: STAFF.orderTaker, lines });
  return { seating_id, order_id };
}

/** A takeaway of `n` naans (3 000 each): 30.00 × n net. */
function takeaway(n: number, prefix: string): { order_id: string; line: string } {
  const line = `${prefix}_N`;
  const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: line, item_id: FX.naan, quantity: n }] });
  return { order_id, line };
}

const billIdOf = (seating_id: string) => db().prepare('SELECT bill_id FROM bills WHERE seating_id = ?').pluck().get(seating_id) as string;
const docText = (doc: Doc): string => doc.blocks.flatMap((b) => ('text' in b ? [b.text] : [])).join('\n');
const row48 = (left: string, right: string): string => left + ' '.repeat(48 - left.length - right.length) + right;
const jobDoc = (job_id: string): Doc => (JSON.parse(db().prepare('SELECT payload FROM print_jobs WHERE job_id = ?').pluck().get(job_id) as string) as { doc: Doc }).doc;
const invoiceOf = (r: Reply) => r.events.find((e) => e.event_type === 'InvoiceIssued')!.payload as Record<string, unknown> & { lines: Array<Record<string, unknown>>; fiscal: Record<string, unknown> };

/** What a close writes anywhere (#5, #36: none of it after a refused or rolled-back close). */
function written() {
  const one = (sql: string) => db().prepare(sql).pluck().get() as number;
  return {
    invoices: one('SELECT COUNT(*) FROM invoices'),
    outbox: one('SELECT COUNT(*) FROM fiscal_outbox'),
    print_jobs: one(`SELECT COUNT(*) FROM print_jobs WHERE kind = 'document'`),
    bill_print_jobs: one('SELECT COUNT(*) FROM bill_print_jobs'),
    buyers: one('SELECT COUNT(*) FROM invoice_buyers'),
    close_events: one(`SELECT COUNT(*) FROM events WHERE event_type IN ('InvoiceIssued', 'DiscountFrozen', 'OrdersBilled', 'BillClosed')`),
    closed_units: one('SELECT COUNT(*) FROM closed_split_units'),
    close_commands: one(`SELECT COUNT(*) FROM processed_commands WHERE command_type = 'CloseSplit'`),
  };
}
const NOTHING = { invoices: 0, outbox: 0, print_jobs: 0, bill_print_jobs: 0, buyers: 0, close_events: 0, closed_units: 0, close_commands: 0 };

/** B19, H-4 (the spike's scan): `secret` in the captured hub logs or any table but `invoice_buyers`. */
function leaksOf(s: string): string[] {
  const places: string[] = [];
  if (hub.logs().includes(s)) places.push('hub.logs()');
  const tables = db().prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('invoice_buyers') ORDER BY name`).pluck().all() as string[];
  for (const t of tables) if (JSON.stringify(db().prepare(`SELECT * FROM "${t}"`).all()).includes(s)) places.push(`table ${t}`);
  return places;
}

/** A 05 / 02b request raised through 01d's real raiseMany (its command is not built here), as the manager's request. */
function raiseRequest(kind: string, subject: { stream_type: 'order' | 'bill'; stream_id: string }, values: Record<string, unknown>, dedupe_key: string, requester: Who): string {
  const directory = currentDirectory(hub.app);
  return hub.deps.writer.run((tx) => {
    const ctx = {
      tx,
      state: tx.state,
      clock: tx.clock,
      ids: tx.ids,
      actor: { kind: 'device', staffId: requester.staffId, stationId: null, sessionId: requester.sessionId, deviceId: requester.deviceId },
      branch: { tenantId: 'tenant-a', branchId: 'branch-1' },
      directory,
      permission: directory.resolve(requester.staffId, 'take-payment'),
      queuedAt: null,
    } as unknown as CommandCtx;
    const [res] = alerts.raiseMany(ctx, [
      {
        kind,
        subject,
        target: { kind: 'answerers' },
        values,
        details: {},
        display: { kind_label_key: `alert.${kind}.lock`, table_code: null, requester_name: null },
        dedupe_key,
        requester_staff_id: requester.staffId,
        request: { approver_role_ids: ['R_MGR'] },
      },
    ]);
    tx.append(res!.events);
    return res!.alert_id;
  }).result;
}
const alertState = (alert_id: string) => db().prepare('SELECT state FROM alerts WHERE alert_id = ?').pluck().get(alert_id);

// ================================================================================================= the close

describe('[05 §6.12] CloseSplit — one transaction: invoice, folds, outbox row, receipt', () => {
  it('[05 §6.12, #6, #29, #34, #69] dine-in, two rounds, PK: result, events in order, the invoice money pinned, every fold, the receipt job', async () => {
    await start();
    const t = dineInTwoRounds(hub, { prefix: 'A' });
    const ref = { seating_id: t.seating_id };
    // 1,260.00 + 16 % 201.60 = 1,461.60 → 1,462.00 (+0.40); cash 1,500.00 → change 38.00
    await pay(cashier.who, ref, 1, 'cash', 146_200, 150_000);
    const bill_id = billIdOf(t.seating_id);
    const before = await view(cashier.who, ref);
    expect(before.splits[0]!.totals.as_paid.total_minor).toBe(146_200);

    const r = await close(cashier.who, { bill_ref: ref, split_no: 1, expected_total_minor: 146_200 });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toEqual({
      invoice_id: expect.any(String),
      invoice_ref: 'S000001',
      total_minor: 146_200,
      change_minor: 3_800,
      bill_state: 'closed',
      receipt: { job_id: expect.any(String), printer_name: 'Counter' },
      fiscal_state: 'not_required',
    });
    expect(r.events.map((e) => [e.event_type, e.stream_type, e.stream_id])).toEqual([
      ['InvoiceIssued', 'bill', bill_id],
      ['DiscountFrozen', 'bill', bill_id],
      ['OrdersBilled', 'order', t.rounds[0].order_id],
      ['BillClosed', 'table', t.table_id],
    ]);
    expect(r.events[1]!.payload).toEqual({ bill_id, frozen_minor: 0, line_ids: [...t.rounds[0].lines, ...t.rounds[1].lines] });
    expect(r.events[2]!.payload).toEqual({ order_ids: [t.rounds[0].order_id, t.rounds[1].order_id], bill_id });
    expect(r.events[3]!.payload).toEqual({ seating_id: t.seating_id });

    const inv = invoiceOf(r);
    expect(inv).toMatchObject({
      invoice_id: r.result!['invoice_id'],
      series: 'sale',
      number: 1,
      invoice_ref: 'S000001',
      bill_id,
      split_no: 1,
      order_type: 'dine_in',
      jurisdiction_id: 'PK',
      currency_code: 'PKR',
      prices_include_tax: false,
      service_charge: null,
      subtotal_minor: 126_000,
      discount_minor: 0,
      service_charge_minor: 0,
      rounding_minor: 40,
      total_minor: 146_200,
      payment_class: 'cash',
      mixed_rule: 'higher_rate',
      change_minor: 3_800,
      discount_line_ids: [...t.rounds[0].lines, ...t.rounds[1].lines],
      has_buyer_id: false,
      buyer_id_refused: false,
      closed_by: STAFF.cashier,
    });
    expect((inv['taxes'] as Array<Record<string, unknown>>).map((x) => [x['tax_profile_id'], x['payment_class'], x['rate_bp'], x['base_minor'], x['tax_minor']])).toEqual([['tc-food', 'cash', 1_600, 126_000, 20_160]]);
    expect(inv.lines.map((l) => [l['order_item_id'], l['name'], l['units'], l['unit_price_minor'], l['base_minor'], l['fiscal_category'], (l['taxes'] as Array<{ tax_minor: number }>).map((x) => x.tax_minor)])).toEqual([
      ['A1_K', 'Chicken Karahi', 1, 120_000, 120_000, 'restaurant_service', [19_200]],
      ['A1_N', 'Naan', 1, 3_000, 3_000, 'restaurant_service', [480]],
      ['A2_N', 'Naan', 1, 3_000, 3_000, 'restaurant_service', [480]],
    ]);
    // R-46: adapter none → required false, not fiscalized, not_required
    expect(inv.fiscal).toMatchObject({ adapter_key: 'none', pos_id: null, required: false, payment_codes: [{ payment_id: (inv['payment_ids'] as string[])[0], authority_code: null }] });

    // the folds of the same transaction
    expect(db().prepare('SELECT state FROM fiscal_outbox WHERE invoice_id = ?').pluck().get(r.result!['invoice_id'])).toBe('not_required');
    expect(db().prepare('SELECT order_item_id, units, share_minor FROM closed_split_units WHERE bill_id = ? ORDER BY order_item_id').all(bill_id)).toEqual([
      { order_item_id: 'A1_K', units: 1, share_minor: 120_000 },
      { order_item_id: 'A1_N', units: 1, share_minor: 3_000 },
      { order_item_id: 'A2_N', units: 1, share_minor: 3_000 },
    ]);
    expect(db().prepare('SELECT state FROM bills WHERE bill_id = ?').pluck().get(bill_id)).toBe('closed');
    expect(db().prepare('SELECT COUNT(*) FROM orders WHERE billed_at IS NOT NULL').pluck().get()).toBe(2);
    expect(db().prepare('SELECT state FROM seatings WHERE seating_id = ?').pluck().get(t.seating_id)).toBe('NEEDS_CLEANING');

    // #34: the receipt job at the device route, its Doc
    const job_id = (r.result!['receipt'] as { job_id: string }).job_id;
    expect(db().prepare('SELECT job_id, bill_id, doc_kind, ref_id FROM bill_print_jobs').all()).toEqual([{ job_id, bill_id, doc_kind: 'receipt', ref_id: r.result!['invoice_id'] }]);
    const lines = docText(jobDoc(job_id)).split('\n');
    expect(lines).toContain(row48('Subtotal', '1,260.00'));
    expect(lines).toContain(row48('Sales tax 16% cash', '201.60'));
    expect(lines).toContain(row48('Rounding adjustment', '0.40'));
    expect(lines).toContain(row48('TOTAL PKR', '1,462.00'));
    expect(lines).toContain(row48('Cash', '1,462.00'));
    expect(lines).toContain(row48('Change', '38.00'));
    expect(lines.join('\n')).not.toMatch(/fiscal/i);
    expect(jobDoc(job_id).blocks).toContainEqual({ drawer: true }); // a cash payment opens the drawer (§3.16)

    // the bill view after: the split closed with its invoice
    const after = await view(cashier.who, { bill_id });
    expect(after.state).toBe('closed');
    expect(after.splits[0]!.invoice).toEqual({ invoice_id: r.result!['invoice_id'], invoice_ref: 'S000001', fiscal_number: null, fiscal_state: 'not_required' }); // R-90: + invoice_id
  });

  it('[05 #29, #16d, R-29] two item splits with a 10 % discount on Rs 2,000: DiscountFrozen 20000 at the first close only; OrdersBilled + BillClosed once, at the last', async () => {
    await start();
    // karahi 1,200 (taxed) | 2 lassi 500 (untaxed) + 10 naan 300 (taxed) = Rs 2,000
    const s = seated([
      { order_item_id: 'D_K', item_id: FX.piece },
      { order_item_id: 'D_L', item_id: VX.drink, quantity: 2 },
      { order_item_id: 'D_N', item_id: FX.naan, quantity: 10 },
    ]);
    const ref = { seating_id: s.seating_id };
    const sp = await post(hub, cashier.who, 'set-splits', 'SetSplits', {
      bill_ref: ref,
      mode: 'items',
      splits: [
        { split_no: 1, lines: [{ order_item_id: 'D_K', units: 1 }] },
        { split_no: 2, lines: [{ order_item_id: 'D_L', units: 2 }, { order_item_id: 'D_N', units: 10 }] },
      ],
    });
    expect(sp.status, JSON.stringify(sp.error)).toBe(200);
    const bill_id = billIdOf(s.seating_id);
    appendEvent(DiscountApplied as unknown as EventDef<z.ZodType>, bill_id, { bill_id, kind: 'percent', value: 1_000, amount_minor: 20_000, reason_code: 'regular', has_note: false, note_id: null, replaces: false, requester_staff_id: STAFF.manager, approver_staff_id: null, alert_id: null });
    const v = await view(cashier.who, ref);
    expect(v.totals_default.subtotal_minor).toBe(200_000);
    expect(v.discount?.discount_minor).toBe(20_000);
    // split 1: 1,200 − 120 = 1,080 + 16 % 172.80 = 1,252.80 → 1,253.00
    const t1 = v.splits[0]!.totals.as_paid.total_minor;
    expect(t1).toBe(125_300);
    await pay(cashier.who, ref, 1, 'cash', t1);
    const r1 = await close(cashier.who, { bill_ref: ref, split_no: 1, expected_total_minor: t1 });
    expect(r1.status, JSON.stringify(r1.error)).toBe(200);
    expect(r1.result).toMatchObject({ bill_state: 'partly_paid', invoice_ref: 'S000001', total_minor: 125_300 });
    expect(r1.events.map((e) => e.event_type)).toEqual(['InvoiceIssued', 'DiscountFrozen']);
    expect(invoiceOf(r1)).toMatchObject({ subtotal_minor: 120_000, discount_minor: 12_000, rounding_minor: 20, discount_line_ids: ['D_K', 'D_L', 'D_N'] });
    expect(r1.events[1]!.payload).toEqual({ bill_id, frozen_minor: 20_000, line_ids: ['D_K', 'D_L', 'D_N'] });
    expect(JSON.parse(db().prepare('SELECT discount_json FROM bills WHERE bill_id = ?').pluck().get(bill_id) as string)).toMatchObject({ frozen_minor: 20_000 });
    expect(db().prepare('SELECT order_item_id FROM bill_discount_lines WHERE bill_id = ? ORDER BY order_item_id').pluck().all(bill_id)).toEqual(['D_K', 'D_L', 'D_N']);
    expect(db().prepare('SELECT state FROM seatings WHERE seating_id = ?').pluck().get(s.seating_id)).not.toBe('NEEDS_CLEANING');

    // split 2: lassi 500 − 50 = 450 untaxed; naan 300 − 30 = 270 + 16 % 43.20; 763.20 → 763.00
    const t2 = (await view(cashier.who, ref)).splits[1]!.totals.as_paid.total_minor;
    expect(t2).toBe(76_300);
    await pay(cashier.who, ref, 2, 'cash', t2);
    const r2 = await close(cashier.who, { bill_ref: ref, split_no: 2, expected_total_minor: t2 });
    expect(r2.status, JSON.stringify(r2.error)).toBe(200);
    expect(r2.result).toMatchObject({ bill_state: 'closed', invoice_ref: 'S000002', total_minor: 76_300 });
    expect(r2.events.map((e) => e.event_type)).toEqual(['InvoiceIssued', 'OrdersBilled', 'BillClosed']);
    expect(invoiceOf(r2)).toMatchObject({ subtotal_minor: 80_000, discount_minor: 8_000, rounding_minor: -20, discount_line_ids: null });
    expect(invoiceOf(r2).lines.map((l) => [l['order_item_id'], l['units'], l['base_minor'], l['discount_minor'], l['tax_profile_id']])).toEqual([
      ['D_L', 2, 50_000, 5_000, null],
      ['D_N', 10, 30_000, 3_000, 'tc-food'],
    ]);
    expect(db().prepare(`SELECT COUNT(*) FROM events WHERE event_type IN ('OrdersBilled', 'BillClosed')`).pluck().get()).toBe(2);
    expect(db().prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'DiscountFrozen'`).pluck().get()).toBe(1);
  });

  it('[05 H1-27, #29] an equal split in two: each close invoices every line with its live units and its share; the whole line freezes', async () => {
    await start();
    const t = dineInTwoRounds(hub, { prefix: 'EQ' });
    const ref = { seating_id: t.seating_id };
    const sp = await post(hub, cashier.who, 'set-splits', 'SetSplits', { bill_ref: ref, mode: 'equal', n: 2 });
    expect(sp.status, JSON.stringify(sp.error)).toBe(200);
    // each half: 630.00 + 16 % 100.80 = 730.80 → 731.00
    const totals = (await view(cashier.who, ref)).splits.map((x) => x.totals.as_paid.total_minor);
    expect(totals).toEqual([73_100, 73_100]);
    const shares: unknown[] = [];
    for (const split_no of [1, 2]) {
      await pay(cashier.who, ref, split_no, 'cash', 73_100);
      const r = await close(cashier.who, { bill_ref: ref, split_no, expected_total_minor: 73_100 });
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      shares.push(invoiceOf(r).lines.map((l) => [l['order_item_id'], l['units'], l['base_minor']]));
    }
    expect(shares).toEqual([
      [['EQ1_K', 1, 60_000], ['EQ1_N', 1, 1_500], ['EQ2_N', 1, 1_500]],
      [['EQ1_K', 1, 60_000], ['EQ1_N', 1, 1_500], ['EQ2_N', 1, 1_500]],
    ]);
    const bill_id = billIdOf(t.seating_id);
    expect(db().prepare('SELECT order_item_id, SUM(units) AS units, SUM(share_minor) AS share FROM closed_split_units WHERE bill_id = ? GROUP BY order_item_id ORDER BY order_item_id').all(bill_id)).toEqual([
      { order_item_id: 'EQ1_K', units: 2, share: 120_000 },
      { order_item_id: 'EQ1_N', units: 2, share: 3_000 },
      { order_item_id: 'EQ2_N', units: 2, share: 3_000 },
    ]);
    expect(db().prepare('SELECT state FROM bills WHERE bill_id = ?').pluck().get(bill_id)).toBe('closed');
  });

  it('[05 §6.12, #6, H6-11] a projected takeaway bill closes at its own total in one command (BillOpened first); no BillClosed for takeaway', async () => {
    await start();
    const o = takeaway(2, 'TK');
    // 60.00 + 16 % 9.60 = 69.60 → 70.00; no payment → BILL_BALANCE_DUE, nothing written, no bill opened
    const refused = await close(cashier.who, { bill_ref: { order_id: o.order_id }, split_no: 1, expected_total_minor: 7_000 });
    expect(refused.status).toBe(409);
    expect(refused.error).toEqual({ code: 'BILL_BALANCE_DUE', details: { split_no: 1, balance_minor: 7_000 } });
    expect(db().prepare('SELECT COUNT(*) FROM bills').pluck().get()).toBe(0);
    await pay(cashier.who, { order_id: o.order_id }, 1, 'card', 6_300); // 60.00 + 5 % 3.00 = 63.00
    const r = await close(cashier.who, { bill_ref: { order_id: o.order_id }, split_no: 1, expected_total_minor: 6_300 });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['InvoiceIssued', 'DiscountFrozen', 'OrdersBilled']);
    expect(invoiceOf(r)).toMatchObject({ order_type: 'takeaway', payment_class: 'digital', total_minor: 6_300, change_minor: 0 });
    expect(jobDoc((r.result!['receipt'] as { job_id: string }).job_id).blocks).not.toContainEqual({ drawer: true });
  });

  it('[05 G-27] card + cash on one split: invoice payment_class mixed, taxed at the cash rate (higher_rate)', async () => {
    await start();
    const t = dineInTwoRounds(hub, { prefix: 'M' });
    const ref = { seating_id: t.seating_id };
    await pay(cashier.who, ref, 1, 'card', 50_000);
    await pay(cashier.who, ref, 1, 'cash', 96_200);
    const r = await close(cashier.who, { bill_ref: ref, split_no: 1, expected_total_minor: 146_200 });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const inv = invoiceOf(r);
    expect(inv).toMatchObject({ payment_class: 'mixed', total_minor: 146_200 });
    expect((inv['taxes'] as Array<{ payment_class: string; rate_bp: number }>).map((x) => [x.payment_class, x.rate_bp])).toEqual([['cash', 1_600]]);
    expect(db().prepare('SELECT payment_class FROM invoices').pluck().get()).toBe('mixed');
  });

  it('[05 §6.12 step 7, §3.16] a zero-total bill (every line comped) closes with no payment, total 0', async () => {
    await start();
    const s = seated([{ order_item_id: 'Z_N', item_id: FX.naan }]);
    hubEvents([{ stream_type: 'order', stream_id: s.order_id, event_type: 'LineComped', payload: { order_item_id: 'Z_N', units: 1, value_minor: 3_000, reason_code: 'quality', note: null, requester_staff_id: STAFF.manager, alert_id: null, approver_staff_id: null } }]);
    const r = await close(cashier.who, { bill_ref: { seating_id: s.seating_id }, split_no: 1, expected_total_minor: 0 });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toMatchObject({ total_minor: 0, change_minor: 0, bill_state: 'closed' });
    expect(invoiceOf(r)).toMatchObject({ subtotal_minor: 0, total_minor: 0, payment_ids: [] });
  });
});

// ================================================================================================= the empty close (H7-3, H8-4)

describe('[05 §6.12 step 3, H7-3, H8-4, #16d] CloseSplit — the empty close: BillClosedEmpty, no invoice', () => {
  /**
   * A dine-in bill with a row (a payment taken) whose only order is then cancelled by RemoveItems, then the payment
   * removed. ⚠️ task 19 (row Q-7): the payment is removed after the cancel, so the order-cancelled hook (balance −Rs 10
   * at the cancel) appends no BillClosedEmpty and the bill stays open for this empty close (RemovePayment appends none).
   */
  async function emptiedBill(prefix: string): Promise<{ seating_id: string; bill_id: string; order_id: string }> {
    const s = seated([{ order_item_id: `${prefix}_N`, item_id: FX.naan }]);
    const p = await pay(cashier.who, { seating_id: s.seating_id }, 1, 'cash', 1_000);
    const taker = signIn(hub, STAFF.orderTaker);
    const ri = await post(hub, taker, 'remove-items', 'RemoveItems', { order_id: s.order_id, seating_id: s.seating_id, lines: [{ order_item_id: `${prefix}_N` }] });
    expect(ri.status, JSON.stringify(ri.error)).toBe(200);
    expect(ri.events.map((e) => e.event_type)).toContain('OrderCancelled');
    expect(ri.events.map((e) => e.event_type)).not.toContain('BillClosedEmpty');
    const rm = await post(hub, cashier.who, 'remove-payment', 'RemovePayment', { payment_id: p.result!['payment_id'], reason_code: 'wrong_amount' });
    expect(rm.status, JSON.stringify(rm.error)).toBe(200);
    return { seating_id: s.seating_id, bill_id: billIdOf(s.seating_id), order_id: s.order_id };
  }

  it('[05 §6.12 step 3] every order cancelled, every balance 0 → BillClosedEmpty (+ the 02a fold, the bill requests closed); no invoice, outbox row, receipt, DiscountFrozen or OrdersBilled', async () => {
    await start();
    const b = await emptiedBill('EC');
    const manager = signIn(hub, STAFF.manager);
    const waiver = raiseRequest('close_without_buyer_id', { stream_type: 'bill', stream_id: b.bill_id }, { bill_id: b.bill_id, note_id: null, has_note: false }, `buyer_waiver:${b.bill_id}`, manager);
    const r = await close(cashier.who, { bill_ref: { bill_id: b.bill_id }, split_no: 1, expected_total_minor: 0 });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toEqual({ bill_state: 'closed', empty: true });
    expect(r.events.map((e) => e.event_type)).toEqual(['BillClosedEmpty', 'AlertClosed', 'AlertRaised', 'AttemptSent']);
    expect(r.events[0]).toMatchObject({ stream_type: 'bill', stream_id: b.bill_id, payload: { bill_id: b.bill_id, seating_id: b.seating_id, credit_invoice_ids: [] } });
    expect(r.events[1]!.payload).toMatchObject({ alert_id: waiver, reason: 'obsolete', note: 'bill_closed' });
    expect(alertState(waiver)).toBe('closed');
    // the folds: billing CLOSED with every split closed and no invoice; 02a NEEDS_CLEANING
    expect(db().prepare('SELECT state FROM bills WHERE bill_id = ?').pluck().get(b.bill_id)).toBe('closed');
    expect(db().prepare('SELECT state, invoice_id FROM bill_splits WHERE bill_id = ?').all(b.bill_id)).toEqual([{ state: 'closed', invoice_id: null }]);
    expect(db().prepare('SELECT state FROM seatings WHERE seating_id = ?').pluck().get(b.seating_id)).toBe('NEEDS_CLEANING');
    expect(written()).toEqual({ ...NOTHING, close_commands: 1 });
    // pinned statements: the bare empty close's 7 + alerts.closeMany with its request_result raise
    expect(handled.count).toBe(EMPTY_CLOSE_STATEMENTS);
  });

  it('[05 §6.12 step 3] the empty close with no request open: BillClosedEmpty alone; statements fixed', async () => {
    await start();
    const b = await emptiedBill('EN');
    const r = await close(cashier.who, { bill_ref: { seating_id: b.seating_id }, split_no: 1, expected_total_minor: 0 });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toEqual({ bill_state: 'closed', empty: true });
    expect(r.events.map((e) => e.event_type)).toEqual(['BillClosedEmpty']);
    // ensure bill, splits, orders, the bill's cancelled orders, credits, the seating's other open bills, listOpen
    expect(handled.count).toBe(7);
  });

  it('[05 §6.12 step 3] every order cancelled but a split still holds money → BILL_BALANCE_DUE (negative), nothing written', async () => {
    await start();
    const s = seated([{ order_item_id: 'EB_N', item_id: FX.naan }]);
    await pay(cashier.who, { seating_id: s.seating_id }, 1, 'cash', 1_000);
    const taker = signIn(hub, STAFF.orderTaker);
    expect((await post(hub, taker, 'remove-items', 'RemoveItems', { order_id: s.order_id, seating_id: s.seating_id, lines: [{ order_item_id: 'EB_N' }] })).status).toBe(200);
    const r = await close(cashier.who, { bill_ref: { bill_id: billIdOf(s.seating_id) }, split_no: 1, expected_total_minor: 0 });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'BILL_BALANCE_DUE', details: { split_no: 1, balance_minor: -1_000 } });
    expect(written()).toEqual(NOTHING);
    expect(db().prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'BillClosedEmpty'`).pluck().get()).toBe(0);
  });
});

// ================================================================================================= §3.3 rules

describe('[05 §3.3, #5] CloseSplit — the rules in order; nothing written on a refusal', () => {
  it('[05 #5 rule 1] unknown bill → BILL_NOT_FOUND; an unknown or closed split → BILL_NOT_OPEN', async () => {
    await start();
    const nf = await close(cashier.who, { bill_ref: { bill_id: 'NO_SUCH' }, split_no: 1, expected_total_minor: 0 });
    expect(nf.status).toBe(404);
    expect(nf.error).toEqual({ code: 'BILL_NOT_FOUND', details: { bill_id: 'NO_SUCH' } });
    const t = dineInTwoRounds(hub, { prefix: 'R1' });
    const ref = { seating_id: t.seating_id };
    await pay(cashier.who, ref, 1, 'cash', 146_200);
    const bill_id = billIdOf(t.seating_id);
    const two = await close(cashier.who, { bill_ref: ref, split_no: 2, expected_total_minor: 146_200 });
    expect(two.status).toBe(409);
    expect(two.error).toEqual({ code: 'BILL_NOT_OPEN', details: { bill_id, state: 'closed' } });
    expect(written()).toEqual(NOTHING);
    const ok = await close(cashier.who, { bill_ref: ref, split_no: 1, expected_total_minor: 146_200 });
    expect(ok.status).toBe(200);
    const again = await close(cashier.who, { bill_ref: { bill_id }, split_no: 1, expected_total_minor: 146_200 });
    expect(again.status).toBe(409);
    expect(again.error).toEqual({ code: 'BILL_NOT_OPEN', details: { bill_id, state: 'closed' } });
  });

  it('[05 #5, #31, #27, #8] void pending → BILL_CLOSE_BLOCKED; then a discount request → DISCOUNT_PENDING; then a stale total → BILL_TOTAL_CHANGED; then BILL_BALANCE_DUE; in that order', async () => {
    await start();
    const t = dineInTwoRounds(hub, { prefix: 'R2' });
    const ref = { seating_id: t.seating_id };
    await pay(cashier.who, ref, 1, 'cash', 100_000);
    const bill_id = billIdOf(t.seating_id);
    const taker = signIn(hub, STAFF.orderTaker);
    const manager = signIn(hub, STAFF.manager);
    const v = raiseVoid(hub, { requester: taker, order_id: t.rounds[1].order_id, order_item_id: t.rounds[1].lines[0]! });
    const disc = raiseRequest('discount', { stream_type: 'bill', stream_id: bill_id }, { bill_id, kind: 'percent', value: 500, reason_code: 'regular', note_id: null, has_note: false }, `discount:${bill_id}`, manager);
    const payload = { bill_ref: ref, split_no: 1, expected_total_minor: 999 };

    const r2 = await close(cashier.who, payload);
    expect(r2.status).toBe(409);
    expect(r2.error).toEqual({ code: 'BILL_CLOSE_BLOCKED', details: { reason: 'void_pending', order_item_ids: [t.rounds[1].lines[0]] } });
    expect((await answer(hub, taker, v.alert_id, 'withdraw')).status).toBe(200);

    const r4 = await close(cashier.who, payload);
    expect(r4.status).toBe(409);
    expect(r4.error).toEqual({ code: 'DISCOUNT_PENDING', details: { alert_id: disc } });
    expect((await answer(hub, manager, disc, 'withdraw')).status).toBe(200);

    const r7 = await close(cashier.who, payload);
    expect(r7.status).toBe(409);
    expect(r7.error).toEqual({ code: 'BILL_TOTAL_CHANGED', details: { expected_minor: 999, total_minor: 146_200 } });

    const r8 = await close(cashier.who, { ...payload, expected_total_minor: 146_200 });
    expect(r8.status).toBe(409);
    expect(r8.error).toEqual({ code: 'BILL_BALANCE_DUE', details: { split_no: 1, balance_minor: 46_200 } });
    expect(written()).toEqual(NOTHING);
    expect(db().prepare('SELECT state FROM bills WHERE bill_id = ?').pluck().get(bill_id)).toBe('open');
  });

  it('[05 #33, rule 3] a pending weight on a line of the split → BILL_CLOSE_BLOCKED weight_pending', async () => {
    await start();
    const w = pendingWeight(hub, { prefix: 'PW' });
    const r = await close(cashier.who, { bill_ref: { order_id: w.order_id }, split_no: 1, expected_total_minor: 0 });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'BILL_CLOSE_BLOCKED', details: { reason: 'weight_pending', order_item_ids: [w.line] } });
    expect(written()).toEqual(NOTHING);
    expect(db().prepare('SELECT COUNT(*) FROM bills').pluck().get()).toBe(0);
  });

  it('[05 #13b close half, R-1] an applied service charge whose tax profile is unresolved → BILL_CLOSE_BLOCKED tax_unresolved [service_charge]', async () => {
    await start({ sc_bp: 1_000, sc_profile: 'tc-missing' });
    const t = dineInTwoRounds(hub, { prefix: 'SC' });
    const r = await close(cashier.who, { bill_ref: { seating_id: t.seating_id }, split_no: 1, expected_total_minor: 0 });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'BILL_CLOSE_BLOCKED', details: { reason: 'tax_unresolved', order_item_ids: ['service_charge'] } });
    expect(written()).toEqual(NOTHING);
  });

  it('[05 #42, rule 6] whole-bill net above the threshold: no buyer → BUYER_ID_REQUIRED; a bad type / value → VALIDATION_FAILED without the value', async () => {
    await start({ threshold: 100_000 });
    const t = dineInTwoRounds(hub, { prefix: 'B6' });
    const ref = { seating_id: t.seating_id };
    await pay(cashier.who, ref, 1, 'cash', 146_200);
    const base = { bill_ref: ref, split_no: 1, expected_total_minor: 146_200 };
    const none = await close(cashier.who, base);
    expect(none.status).toBe(409);
    expect(none.error).toEqual({ code: 'BUYER_ID_REQUIRED', details: { threshold_minor: 100_000, net_minor: 126_000, accepted_types: ['CNIC', 'NTN'] } });
    const badType = await close(cashier.who, { ...base, buyer: { name: secret('Buyer Bad Type'), tax_id: { type: 'PASSPORT', value: secret('AB1234567') } } });
    expect(badType.status).toBe(400);
    expect(badType.error!.details).toEqual({ issues: [{ path: 'buyer.tax_id.type', message: expect.any(String) }] });
    const shortNtn = await close(cashier.who, { ...base, buyer: { name: secret('Buyer Short Ntn'), tax_id: { type: 'NTN', value: secret('ABC123') } } });
    expect(shortNtn.status).toBe(400);
    expect(shortNtn.error!.details).toEqual({ issues: [{ path: 'buyer.tax_id.value', message: expect.any(String) }] });
    expect(JSON.stringify(shortNtn.error)).not.toContain('ABC123');
    expect(written()).toEqual(NOTHING);
  });

  it('[05 #74b close half, H8-3] a payment taken on none, closed after the switch to the fake adapter in a mode with no code → PAYMENT_MODE_NOT_FISCAL', async () => {
    // switched_at in the future at payment time: AddPayment takes the voucher (not fiscalized yet)
    await start({ adapter_key: 'FAKE', switched_at: new Date(Date.now() + 10 * 365 * 86_400_000).toISOString() });
    const t = dineInTwoRounds(hub, { prefix: 'NF' });
    const ref = { seating_id: t.seating_id };
    await pay(cashier.who, ref, 1, 'voucher', 132_300);
    // the switch now in the past (a new config): the close is fiscalized and the voucher has no FAKE code
    reconfigure({ adapter_key: 'FAKE', switched_at: '2000-01-01T00:00:00.000Z' });
    const r = await close(cashier.who, { bill_ref: ref, split_no: 1, expected_total_minor: 132_300 });
    expect(r.status).toBe(422);
    expect(r.error).toEqual({ code: 'PAYMENT_MODE_NOT_FISCAL', details: { mode_id: 'voucher', adapter_key: 'FAKE' } });
    expect(written()).toEqual(NOTHING);
  });

  it('[05 §6.12, C8] scope last: an order taker (take-payment own_tables) on another holder\'s table gets the rule refusals first, then outside_scope', async () => {
    await start();
    const taker = signIn(hub, STAFF.orderTaker);
    const s = seated([{ order_item_id: 'SC_K', item_id: FX.piece }], VX.tables.T4, STAFF.manager);
    const ref = { seating_id: s.seating_id };
    const due = await close(taker, { bill_ref: ref, split_no: 1, expected_total_minor: 139_200 });
    expect(due.status).toBe(409);
    expect(due.error!.code).toBe('BILL_BALANCE_DUE');
    await pay(cashier.who, ref, 1, 'cash', 139_200);
    const r = await close(taker, { bill_ref: ref, split_no: 1, expected_total_minor: 139_200 });
    expect(r.status).toBe(403);
    expect(r.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: [VX.tables.T4] } });
    expect(written()).toEqual(NOTHING);
  });

  it('[05 §6.12, C8] the grant first: a caller without take-payment is refused before the handler reads anything', async () => {
    await start({ deny: ['take-payment'] });
    const taker = signIn(hub, STAFF.orderTaker);
    const r = await close(taker, { bill_ref: { bill_id: 'NO_SUCH' }, split_no: 1, expected_total_minor: 0, buyer: { name: secret('Denied Buyer'), tax_id: { type: 'CNIC', value: secret('1111122223333') } } });
    expect(r.status).toBe(403);
    expect(r.error).toEqual({ code: 'PERMISSION_DENIED', details: { permission: 'take-payment', grant: 'denied' } });
    expect(handled.count).toBeUndefined();
  });
});

// ================================================================================================= fiscal (B20, B21, R-46)

describe('[05 §3.15, R-46, #69] CloseSplit — the fiscal snapshot and the outbox row', () => {
  it('[05 #69, §6.31] fake adapter: required, pending row with POS-1, receipt FISCAL NUMBER PENDING, prefix AC1-', async () => {
    await start({ adapter_key: 'FAKE', prefix: 'AC1-' });
    const t = dineInTwoRounds(hub, { prefix: 'F' });
    const ref = { seating_id: t.seating_id };
    // all card: 1,260.00 + 5 % 63.00 = 1,323.00
    await pay(cashier.who, ref, 1, 'card', 132_300);
    const r = await close(cashier.who, { bill_ref: ref, split_no: 1, expected_total_minor: 132_300 });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toMatchObject({ invoice_ref: 'AC1-S000001', total_minor: 132_300, fiscal_state: 'pending' });
    const inv = invoiceOf(r);
    expect(inv.fiscal).toMatchObject({ adapter_key: 'FAKE', pos_id: 'POS-1', required: true, seller_registrations: [{ code: 'NTN', number: '1234567' }], payment_codes: [{ authority_code: '2' }] });
    expect(db().prepare('SELECT adapter_key, pos_id, state, jurisdiction_id FROM fiscal_outbox').all()).toEqual([{ adapter_key: 'FAKE', pos_id: 'POS-1', state: 'pending', jurisdiction_id: 'TEST-J' }]);
    const text = docText(jobDoc((r.result!['receipt'] as { job_id: string }).job_id));
    expect(text).toContain('FISCAL NUMBER PENDING');
    expect(text).toContain('AC1-S000001');
  });

  it('[05 #69, R-46] not fiscalized: an order type with fiscalize off, or an invoice before switched_at → required false, not_required', async () => {
    await start({ adapter_key: 'FAKE', fiscalize: { dine_in: false, takeaway: true, parking: true, delivery: false } });
    const t = dineInTwoRounds(hub, { prefix: 'NT' });
    await pay(cashier.who, { seating_id: t.seating_id }, 1, 'card', 132_300);
    const r = await close(cashier.who, { bill_ref: { seating_id: t.seating_id }, split_no: 1, expected_total_minor: 132_300 });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toMatchObject({ fiscal_state: 'not_required' });
    expect(invoiceOf(r).fiscal).toMatchObject({ adapter_key: 'FAKE', required: false });

    reconfigure({ adapter_key: 'FAKE', switched_at: new Date(hub.clock.branchNow() + 86_400_000).toISOString() });
    const o = takeaway(1, 'NS');
    await pay(cashier.who, { order_id: o.order_id }, 1, 'card', 3_200); // 30 + 5 % 1.50 = 31.50 → 32.00
    const r2 = await close(cashier.who, { bill_ref: { order_id: o.order_id }, split_no: 1, expected_total_minor: 3_200 });
    expect(r2.status, JSON.stringify(r2.error)).toBe(200);
    expect(r2.result).toMatchObject({ fiscal_state: 'not_required' });
    expect(db().prepare('SELECT state FROM fiscal_outbox ORDER BY ord').pluck().all()).toEqual(['not_required', 'not_required']);
  });

  it('[05 4b contract] the receipt Doc failing to build (fiscal state ≠ snapshot) never stops the close: committed, receipt null, logged with ids', async () => {
    await start();
    const t = dineInTwoRounds(hub, { prefix: 'DF' });
    await pay(cashier.who, { seating_id: t.seating_id }, 1, 'cash', 146_200);
    // test-only DDL on this connection: the fold's not_required row turns pending, so the builder's check throws
    db().exec(`CREATE TEMP TRIGGER df AFTER INSERT ON main.fiscal_outbox BEGIN UPDATE fiscal_outbox SET state = 'pending' WHERE invoice_id = NEW.invoice_id; END`);
    try {
      const r = await close(cashier.who, { bill_ref: { seating_id: t.seating_id }, split_no: 1, expected_total_minor: 146_200 });
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      expect(r.result).toMatchObject({ receipt: { job_id: null, printer_name: null }, bill_state: 'closed' });
      expect(written()).toMatchObject({ invoices: 1, outbox: 1, print_jobs: 0, bill_print_jobs: 0 });
      expect(hub.logs()).toContain(r.result!['invoice_id'] as string);
    } finally {
      db().exec('DROP TRIGGER IF EXISTS temp.df');
    }
  });
});

// ================================================================================================= buyer (B19, H-4)

describe('[05 B19, H-4, #42, #43] CloseSplit — the buyer tax ID lives in invoice_buyers only', () => {
  for (const [type, value, stored] of [
    ['CNIC', '35202-1234567-1', '3520212345671'],
    ['NTN', 'A1B2C3D', 'A1B2C3D'],
  ] as const) {
    it(`[05 #42, #43 ${type}] the close stores the ID (strip characters removed); the receipt carries the fill block; the worker prints the full ID; nothing else holds it`, async () => {
      await start({ adapter_key: 'FAKE', threshold: 100_000 });
      const name = secret(`Test Buyer ${type}`);
      secret(stored);
      secret(value);
      const t = dineInTwoRounds(hub, { prefix: `BY${type}` });
      const ref = { seating_id: t.seating_id };
      await pay(cashier.who, ref, 1, 'card', 132_300);
      const payload = { bill_ref: ref, split_no: 1, expected_total_minor: 132_300, buyer: { name, tax_id: { type, value } } };
      const r = await close(cashier.who, payload, `close-buyer-${type}`);
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      const invoice_id = r.result!['invoice_id'] as string;
      expect(db().prepare('SELECT invoice_id, buyer_name, id_type, id_value FROM invoice_buyers').all()).toEqual([{ invoice_id, buyer_name: name, id_type: type, id_value: stored }]);
      expect(invoiceOf(r)).toMatchObject({ has_buyer_id: true, buyer_id_refused: false });
      const job_id = (r.result!['receipt'] as { job_id: string }).job_id;
      expect(jobDoc(job_id).blocks.filter((b) => 'fill' in b)).toEqual([{ fill: BUYER_ID_FILL, ref: invoice_id, last4: `${type}: ****${stored.slice(-4)}` }]);

      // a retransmit with the same command_id and another buyer replays (H-4: buyer is not hashed)
      const again = await close(cashier.who, { ...payload, buyer: { name: secret('Other Buyer Zed'), tax_id: { type, value } } }, `close-buyer-${type}`);
      expect(again.status).toBe(200);
      expect(again.result).toEqual(r.result);

      // the 03c worker fills the block at send through 05's filler (registered by the close task)
      const sends: string[] = [];
      const transport: PrinterTransport = {
        send(bytes: Uint8Array): Promise<SendResult> {
          sends.push(Buffer.from(bytes).toString('latin1'));
          return Promise.resolve({ ok: true });
        },
        close: () => undefined,
      };
      const w = createPrintWorker({ db: db(), state: hub.deps.state, clock: hub.clock, timers: fakeClock(), transportFor: () => transport, log: { info: () => undefined, error: () => undefined } });
      try {
        for (let i = 0; i < 50 && sends.length < 1; i += 1) {
          w.pass();
          await new Promise((resolve) => setImmediate(resolve));
        }
      } finally {
        w.stop();
      }
      expect(sends).toHaveLength(1);
      expect(sends[0]).toContain(`${type}: ${stored}`);
      expect(sends[0]).toContain(name);
      // the permanent scan (afterEach) holds the ID and the name to invoice_buyers
    });
  }

  it('[05 B19] a waived bill (BuyerIdWaived) closes without a buyer: buyer_id_refused, no invoice_buyers row', async () => {
    await start({ threshold: 100_000 });
    const t = dineInTwoRounds(hub, { prefix: 'WV' });
    const ref = { seating_id: t.seating_id };
    await pay(cashier.who, ref, 1, 'cash', 146_200);
    const bill_id = billIdOf(t.seating_id);
    hubEvents([{ stream_type: 'bill', stream_id: bill_id, event_type: 'BuyerIdWaived', payload: { bill_id, has_note: false, note_id: null, requester_staff_id: STAFF.cashier, approver_staff_id: null, alert_id: null } }]);
    const r = await close(cashier.who, { bill_ref: ref, split_no: 1, expected_total_minor: 146_200 });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(invoiceOf(r)).toMatchObject({ has_buyer_id: false, buyer_id_refused: true });
    expect(written().buyers).toBe(0);
  });
});

// ================================================================================================= requests (#30, #41)

describe('[05 #30, #41, H1-23, H6-2] CloseSplit — open comp / remove_comp requests close obsolete', () => {
  it('[05 #30, #41] a split close closes the comp and remove_comp requests on the units it invoices; the last close the rest and the 05 bill requests', async () => {
    await start();
    const taker = signIn(hub, STAFF.orderTaker);
    const s = seated([
      { order_item_id: 'Q_K', item_id: FX.piece },
      { order_item_id: 'Q_N', item_id: FX.naan, quantity: 2 },
    ]);
    const ref = { seating_id: s.seating_id };
    const sp = await post(hub, cashier.who, 'set-splits', 'SetSplits', {
      bill_ref: ref,
      mode: 'items',
      splits: [
        { split_no: 1, lines: [{ order_item_id: 'Q_K', units: 1 }] },
        { split_no: 2, lines: [{ order_item_id: 'Q_N', units: 2 }] },
      ],
    });
    expect(sp.status, JSON.stringify(sp.error)).toBe(200);
    const bill_id = billIdOf(s.seating_id);
    const compK = await post(hub, taker, 'comp-line', 'CompLine', { order_item_id: 'Q_K', units: 1, reason_code: 'quality' });
    const compN = await post(hub, taker, 'comp-line', 'CompLine', { order_item_id: 'Q_N', units: 1, reason_code: 'quality' });
    expect([compK.status, compN.status], JSON.stringify([compK.error, compN.error])).toEqual([200, 200]);
    expect([compK.result!['pending'], compN.result!['pending']]).toEqual([true, true]);
    const compKId = compK.result!['alert_id'] as string;
    const compNId = compN.result!['alert_id'] as string;
    const manager = signIn(hub, STAFF.manager);
    const rcK = raiseRequest('remove_comp', { stream_type: 'order', stream_id: s.order_id }, { order_id: s.order_id, order_item_id: 'Q_K', units: 1, reason_code: 'wrong_line', note_id: null, has_note: false }, 'remove_comp:Q_K', manager);
    const waiver = raiseRequest('close_without_buyer_id', { stream_type: 'bill', stream_id: bill_id }, { bill_id, note_id: null, has_note: false }, `buyer_waiver:${bill_id}`, manager);

    const v = await view(cashier.who, ref);
    const t1 = v.splits[0]!.totals.as_paid.total_minor; // 1,200 + 16 % = 1,392.00
    expect(t1).toBe(139_200);
    await pay(cashier.who, ref, 1, 'cash', t1);
    const r1 = await close(cashier.who, { bill_ref: ref, split_no: 1, expected_total_minor: t1 });
    expect(r1.status, JSON.stringify(r1.error)).toBe(200);
    expect(alertState(compKId)).toBe('closed');
    expect(alertState(rcK)).toBe('closed');
    expect(alertState(compNId)).toBe('open');
    expect(alertState(waiver)).toBe('open');
    const closedNow = r1.events.filter((e) => e.event_type === 'AlertClosed').map((e) => e.payload);
    expect(closedNow).toEqual(expect.arrayContaining([expect.objectContaining({ alert_id: compKId, reason: 'obsolete', note: 'bill_closed' }), expect.objectContaining({ alert_id: rcK, reason: 'obsolete', note: 'bill_closed' })]));

    const t2 = (await view(cashier.who, ref)).splits[1]!.totals.as_paid.total_minor;
    await pay(cashier.who, ref, 2, 'cash', t2);
    const r2 = await close(cashier.who, { bill_ref: ref, split_no: 2, expected_total_minor: t2 });
    expect(r2.status, JSON.stringify(r2.error)).toBe(200);
    expect(alertState(compNId)).toBe('closed');
    expect(alertState(waiver)).toBe('closed');
    // each obsolete close tells its requester (01d request_result: AlertRaised + AttemptSent)
    const tell = ['AlertClosed', 'AlertRaised', 'AttemptSent'];
    expect(r1.events.map((e) => e.event_type)).toEqual(['InvoiceIssued', 'DiscountFrozen', ...tell, ...tell]);
    expect(r2.events.map((e) => e.event_type)).toEqual(['InvoiceIssued', 'OrdersBilled', 'BillClosed', ...tell, ...tell]);
    expect(r2.events.filter((e) => e.event_type === 'AlertClosed').map((e) => e.payload['alert_id']).sort()).toEqual([compNId, waiver].sort());
  });
});

// ================================================================================================= atomicity, numbers, races

describe('[05 #36, #26, #28] CloseSplit — atomic, gap-free, one winner', () => {
  it('[05 #36] a forced COMMIT failure → no event, outbox row, print job, invoice_buyers row or processed_commands row; the same close then commits number 1', async () => {
    await start({ adapter_key: 'FAKE', threshold: 100_000 });
    const t = dineInTwoRounds(hub, { prefix: 'CF' });
    const ref = { seating_id: t.seating_id };
    await pay(cashier.who, ref, 1, 'card', 132_300);
    const seq = hub.deps.writer.lastSeq();
    const payload = { bill_ref: ref, split_no: 1, expected_total_minor: 132_300, buyer: { name: secret('Commit Fail Buyer'), tax_id: { type: 'CNIC', value: secret('9999911112222') } } };
    commit.fail = true;
    const failed = await close(cashier.who, payload);
    expect(failed.status).toBe(500);
    commit.fail = false;
    expect(written()).toEqual(NOTHING);
    expect(hub.deps.writer.lastSeq()).toBe(seq);
    const r = await close(cashier.who, payload);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toMatchObject({ invoice_ref: 'S000001' });
    expect(written()).toMatchObject({ invoices: 1, outbox: 1, print_jobs: 1, bill_print_jobs: 1, buyers: 1, close_commands: 1 });
  });

  it('[05 #26] 200 closes interleaved with forced rollbacks leave sale numbers 1..200, no gap', async () => {
    await start({ no_printer: true });
    const numbers: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const o = takeaway(1, `GP${i}`);
      await pay(cashier.who, { order_id: o.order_id }, 1, 'cash', 3_500); // 30 + 16 % 4.80 = 34.80 → 35.00
      const payload = { bill_ref: { order_id: o.order_id }, split_no: 1, expected_total_minor: 3_500 };
      if (i % 3 === 1) {
        commit.fail = true;
        expect((await close(cashier.who, payload)).status).toBe(500);
        commit.fail = false;
      }
      const r = await close(cashier.who, payload);
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      numbers.push(invoiceOf(r)['number'] as number);
    }
    expect(numbers).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
    expect(db().prepare(`SELECT number FROM invoices WHERE series = 'sale' ORDER BY number`).pluck().all()).toEqual(numbers);
  }, 120_000);

  it('[05 #26, #28] closes sent at once: different bills get distinct consecutive numbers; one split closed from two kiosks → one invoice, the other BILL_NOT_OPEN', async () => {
    await start();
    const orders = Array.from({ length: 6 }, (_, i) => takeaway(1, `CC${i}`));
    for (const o of orders) await pay(cashier.who, { order_id: o.order_id }, 1, 'cash', 3_500);
    const rs = await Promise.all(orders.map((o) => close(cashier.who, { bill_ref: { order_id: o.order_id }, split_no: 1, expected_total_minor: 3_500 })));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(rs.map((r) => invoiceOf(r)['number'] as number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);

    const t = dineInTwoRounds(hub, { prefix: 'RC' });
    await pay(cashier.who, { seating_id: t.seating_id }, 1, 'cash', 146_200);
    const other = signInOn(hub, STAFF.manager, drawerDevice(hub, 'Kiosk B'));
    const payload = { bill_ref: { seating_id: t.seating_id }, split_no: 1, expected_total_minor: 146_200 };
    const two = await Promise.all([close(cashier.who, payload), close(other, payload)]);
    expect(two.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(two.find((r) => r.status === 409)!.error).toEqual({ code: 'BILL_NOT_OPEN', details: { bill_id: billIdOf(t.seating_id), state: 'closed' } });
    expect(db().prepare('SELECT COUNT(*) FROM invoices WHERE bill_id = ?').pluck().get(billIdOf(t.seating_id))).toBe(1);
  });
});

// ================================================================================================= printing, statements

describe('[05 #35, §6.12 Statements] CloseSplit — no printer; statements fixed', () => {
  it('[05 #35] no printer routed → the close succeeds, receipt { job_id: null, printer_name: null }, logged with ids', async () => {
    await start({ no_printer: true });
    const t = dineInTwoRounds(hub, { prefix: 'NP' });
    await pay(cashier.who, { seating_id: t.seating_id }, 1, 'cash', 146_200);
    const r = await close(cashier.who, { bill_ref: { seating_id: t.seating_id }, split_no: 1, expected_total_minor: 146_200 });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toMatchObject({ receipt: { job_id: null, printer_name: null } });
    expect(written()).toMatchObject({ invoices: 1, print_jobs: 0, bill_print_jobs: 0 });
    expect(hub.logs()).toContain(r.result!['invoice_id'] as string);
  });

  it('[05 §6.12 Statements, #91] 13 handler statements (≤ 18), the same at 1 and at 40 lines (dine-in, last split, receipt printed)', async () => {
    await start();
    const counts: number[] = [];
    for (const [n, table] of [[1, VX.tables.T6], [40, VX.tables.T7]] as const) {
      const s = seated(Array.from({ length: n }, (_, i) => ({ order_item_id: `ST${n}_${i}`, item_id: FX.naan })), table);
      const ref = { seating_id: s.seating_id };
      const total = (await view(cashier.who, ref)).splits[0]!.totals.as_paid.total_minor;
      await pay(cashier.who, ref, 1, 'cash', total);
      const r = await close(cashier.who, { bill_ref: ref, split_no: 1, expected_total_minor: total });
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      counts.push(handled.count!);
    }
    // ensure bill, splits, orders, orderLines, pendingVoids, listOpen, number, the seating's other bills,
    // billPrinterFor, the post-fold read, printDocument (2), bill_print_jobs = 13 (§6.12: ≤ 18, fixed)
    expect(counts).toEqual([13, 13]);
  });
});
