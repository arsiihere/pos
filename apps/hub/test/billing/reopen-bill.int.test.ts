// 05 §6.13 `ReopenBill` + kind `reopen_bill` `apply` (task 19; 05-plan §3 row 19, G-30, G-37, G-40; ⚠️ 05 v1.0.15
// R-66 / G-62: the request's `credit_invoice_ids`, minted at raise), §3.10, §6.4a, B14, the order-cancelled hook (row
// Q-7) and AddPayment's `out` → BillClosedEmpty (§6.9, task 19 plan fix). Real commands over HTTP through the hub's
// writer, the real `billing`, `shifts`, `orders`, `tables` folds and 01d's real AnswerRequest. Every PKR amount pinned.
import { rateBpRates, type BranchConfig, type EventDraft, type PosEvent, type SnapshotBilling } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hubBilling } from '../../src/billing/defaults';
import type { BillView } from '../../src/billing/queries/bill';
import { noneAdapter } from '../../src/billing/fiscal/none';
import { registerFiscalAdapter, resetFiscalAdapters } from '../../src/billing/fiscal/port';
import type { CommandCtx, CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { currentConfigEntry, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { alerts } from '../../src/alerts/raise';
import { currentDirectory } from '../../src/auth/guards';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';
import { openDay, toStage, voidsMenu } from '../voids/fixtures';
import { fakeAdapter } from './fiscal/fake-adapter';
import {
  answer,
  appendOrder,
  billingDirectory,
  dineInTwoRounds,
  drawerDevice,
  FX,
  openSeating,
  PIN,
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
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Every note text a test sends: the afterEach scan holds each to `bill_texts` (H3-5, row H-4). */
const NOTES = new Set<string>();
const secret = (s: string): string => {
  NOTES.add(s);
  return s;
};
/** Every buyer tax ID a test sends: held to `invoice_buyers` (B19, H-4, #43). */
const BUYER_IDS = new Set<string>();

beforeEach(() => {
  registerFiscalAdapter(noneAdapter);
  registerFiscalAdapter(fakeAdapter({ key: 'FAKE', credit: true }));
  registerFiscalAdapter(fakeAdapter({ key: 'FAKE_NC', credit: false }));
});

afterEach(async () => {
  // H3-5, row H-4, §7 Privacy: the permanent scan — every note a test sent, after every test
  const found =
    hub === undefined
      ? []
      : [...[...NOTES].flatMap((s) => leaksOf(s).map((place) => `${s} in ${place}`)), ...[...BUYER_IDS].flatMap((s) => leaksOf(s, 'invoice_buyers').map((place) => `${s} in ${place}`))];
  NOTES.clear();
  BUYER_IDS.clear();
  swapBranchConfig(null);
  resetFiscalAdapters();
  await hub?.close();
  hub = undefined as unknown as TestHub;
  expect(found).toEqual([]);
});

// ------------------------------------------------------------------------------------------------ config

interface DocOptions {
  adapter_key?: 'none' | 'FAKE' | 'FAKE_NC';
  /** the cash rate of 'tc-food' (default 1 600 bp) */
  cash_bp?: number;
  prefix?: string;
  fiscalize?: { dine_in: boolean; takeaway: boolean; parking: boolean; delivery: boolean };
}

/** close-split's document: PK (rounding Rs 1 nearest, all), cash / card, 'tc-food' 16 % cash / 5 % card; or a fake adapter. */
function billingDoc(o: DocOptions = {}): SnapshotBilling {
  const pk = hubBilling({ currency_code: 'PKR', tax_classes: [], billing: undefined });
  const adapter = o.adapter_key ?? 'none';
  const code = (c: string) => (adapter === 'none' ? [] : [{ adapter_key: adapter, code: c }]);
  const cash = pk.settings.payment_modes[0]!;
  const card = { mode_id: 'card', name: 'Card', kind: 'card' as const, payment_class: 'digital' as const, reference_required: false, is_active: true, sort_order: 1, authority_codes: code('2') };
  const jurisdiction_id = adapter === 'none' ? pk.jurisdiction.jurisdiction_id : 'TEST-J';
  return {
    ...pk.settings,
    jurisdiction_id,
    payment_modes: [{ ...cash, authority_codes: code('1') }, card],
    service_charge_bp: { ...pk.settings.service_charge_bp, dine_in: 0 },
    service_charge_tax_profile_id: null,
    receipt: { ...pk.settings.receipt, invoice_prefix: o.prefix ?? '', tax_registrations: adapter === 'none' ? [] : [{ code: 'NTN', number: '1234567' }] },
    fiscal: {
      ...pk.settings.fiscal,
      pos_ids: adapter === 'none' ? [] : [{ pos_id: 'POS-1', label: 'Counter' }],
      default_pos_id: adapter === 'none' ? null : 'POS-1',
      switched_at: null,
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
        buyer_id: { threshold_minor: null, accepted_types: [{ type: 'CNIC', label: 'CNIC', pattern: '^[0-9]{13}$', strip: '-' }] },
        receipt: adapter === 'none' ? r.receipt : { fiscal_number_label: 'TEST fiscal no.', tax_reg_labels: [{ code: 'NTN', label: 'NTN' }], show_qr: false, qr_url_template: null, buyer_id_on_receipt: false },
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
            rates: [...rateBpRates(o.cash_bp ?? 1_600).filter((x) => x.payment_class === 'cash'), ...rateBpRates(500).filter((x) => x.payment_class === 'digital')],
          },
        ],
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

function reconfigure(o: DocOptions): void {
  const cur = currentConfigEntry()!;
  swapBranchConfig({ ...cur, config: { ...cur.config, billing: billingDoc(o) } });
}

// ------------------------------------------------------------------------------------------------ harness

/** handler statements of the last call per command path, without the append and its folds (00's envelope) */
const handled: Record<string, number> = {};

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
      handled[path] = counter.count - appendCost;
    }
  };
}

let cashier: Who;
let manager: Who;
let taker: Who;

async function start(o: DocOptions = {}): Promise<void> {
  hub = await createTestHub();
  await seedDirectory(hub, await billingDirectory());
  openDay(hub, { menu: menu(billingDoc(o)), stock: { [FX.stock]: 1_000_000, [VX.naanStock]: 1_000 } });
  for (const k of Object.keys(handled)) delete handled[k];
  countHandle('reopen-bill');
  countHandle('add-payment');
  const device = drawerDevice(hub, 'Counter kiosk');
  cashier = signInOn(hub, STAFF.cashier, device);
  const shift = await post(hub, cashier, 'open-shift', 'OpenShift', { float_minor: 0, as_drawer: true });
  expect(shift.status, JSON.stringify(shift.error)).toBe(200);
  manager = signIn(hub, STAFF.manager);
  const mshift = await post(hub, manager, 'open-shift', 'OpenShift', { float_minor: 0, as_drawer: false });
  expect(mshift.status, JSON.stringify(mshift.error)).toBe(200);
  taker = signIn(hub, STAFF.orderTaker);
  hubEvents([
    { stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, event_type: 'PrinterSaved', payload: { printer_id: PRINTER, name: 'Counter', connection: 'lan', address: '192.168.1.20:9100', paper_width_mm: 80, archived: false } },
    { stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, event_type: 'BillRouteSet', payload: { scope: 'device', ref_id: device.deviceId, printer_id: PRINTER } },
  ]);
}
const PRINTER = 'PR_COUNTER';
/**
 * 01d's request_result raise inside alerts.closeMany: 01d's own statements (raiseMany), outside 05's R-73 budget; the
 * same 6 that close-split's empty close measures (EMPTY_CLOSE_STATEMENTS = 7 + 1 closeMany + 6).
 */
const RAISE_RESULT = 6;

const db = () => hub.deps.db;
const one = (sql: string, ...args: unknown[]) => db().prepare(sql).pluck().get(...args);

function hubEvents(drafts: Array<Pick<EventDraft, 'stream_type' | 'stream_id' | 'event_type'> & { payload: unknown }>): PosEvent[] {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  return hub.deps.writer.run((tx) =>
    tx.append(drafts.map((d) => ({ ...d, schema_version: 1, payload: d.payload as PosEvent['payload'], occurred_at: now, actor_id: STAFF.manager, device_id: 'D_FIXTURE' }))),
  ).appended;
}

const ok = (r: Reply): Reply => {
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  return r;
};
const pay = (who: Who, bill_ref: Record<string, string>, split_no: number, mode_id: string, amount_minor: number, direction: 'in' | 'out' = 'in') =>
  post(hub, who, 'add-payment', 'AddPayment', { bill_ref, split_no, mode_id, direction, amount_minor });
const close = (who: Who, bill_ref: Record<string, string>, split_no: number, expected_total_minor: number) =>
  post(hub, who, 'close-split', 'CloseSplit', { bill_ref, split_no, expected_total_minor });
const reopen = (who: Who, payload: Record<string, unknown>, commandId?: string) => post(hub, who, 'reopen-bill', 'ReopenBill', payload, commandId);
/** 01d in person (R-66 house rule: actor ≠ answerer): the requester's session, the Manager's PIN. */
const approveInPerson = (requester: Who, alert_id: string) =>
  post(hub, requester, 'answer-request', 'AnswerRequest', { alert_id, decision: 'approve', method: 'in_person', answerer_staff_id: STAFF.manager, pin: PIN.b });

const billOfSeating = (seating_id: string) => one('SELECT bill_id FROM bills WHERE seating_id = ? ORDER BY opened_at LIMIT 1', seating_id) as string;
const billOfOrder = (order_id: string) => one('SELECT bill_id FROM bill_orders WHERE order_id = ? LIMIT 1', order_id) as string;
const typesOf = (r: Reply) => r.events.map((e) => e.event_type);
const ofType = (r: Reply, t: string) => r.events.filter((e) => e.event_type === t);
const count = (event_type: string) => one('SELECT COUNT(*) FROM events WHERE event_type = ?', event_type) as number;

/** What a reopen writes anywhere: nothing after a refusal. */
function written() {
  return {
    credits: one(`SELECT COUNT(*) FROM invoices WHERE series = 'credit'`),
    outbox: one('SELECT COUNT(*) FROM fiscal_outbox'),
    reopen_events: one(`SELECT COUNT(*) FROM events WHERE event_type IN ('BillReopened', 'InvoiceCredited', 'OrdersUnbilled', 'SeatingReopened', 'TableMarksChanged')`),
    reopen_commands: one(`SELECT COUNT(*) FROM processed_commands WHERE command_type = 'ReopenBill'`),
    texts: one('SELECT COUNT(*) FROM bill_texts'),
  };
}

/** H3-5 (close-split's scan): `s` in the captured hub logs or any table but `bill_texts`. */
function leaksOf(s: string, home = 'bill_texts'): string[] {
  const places: string[] = [];
  if (hub.logs().includes(s)) places.push('hub.logs()');
  const tables = db().prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name <> ? ORDER BY name`).pluck().all(home) as string[];
  for (const t of tables) if (JSON.stringify(db().prepare(`SELECT * FROM "${t}"`).all()).includes(s)) places.push(`table ${t}`);
  return places;
}

let seatNo = 0;
/** A dine-in seating at `table_id` with one round of naans (Rs 30 each). */
function seated(n: number, table_id: string = VX.tables.T4): { seating_id: string; order_id: string; line: string; table_id: string } {
  seatNo += 1;
  const seating_id = `SEAT_R${seatNo}`;
  openSeating(hub, { table_id, seating_id });
  const line = `R${seatNo}_N`;
  const { order_id } = appendOrder(hub, { order_type: 'dine_in', seating_id, placed_by: STAFF.orderTaker, lines: [{ order_item_id: line, item_id: FX.naan, quantity: n }] });
  return { seating_id, order_id, line, table_id };
}

/** A takeaway of `n` naans: Rs 30 × n net + 16 %. */
function takeaway(n: number, prefix: string): { order_id: string; line: string } {
  const line = `${prefix}_N`;
  const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: line, item_id: FX.naan, quantity: n }] });
  return { order_id, line };
}

/** dineInTwoRounds (Rs 1,260.00 + 16 % = Rs 1,462.00) closed in two equal splits of Rs 731.00 cash. */
async function closedTwoSplits(prefix: string) {
  const t = dineInTwoRounds(hub, { prefix });
  const ref = { seating_id: t.seating_id };
  ok(await post(hub, cashier, 'set-splits', 'SetSplits', { bill_ref: ref, mode: 'equal', n: 2 }));
  const sales: Reply[] = [];
  for (const split_no of [1, 2]) {
    ok(await pay(cashier, ref, split_no, 'cash', 73_100));
    sales.push(ok(await close(cashier, ref, split_no, 73_100)));
  }
  return { ...t, ref, bill_id: billOfSeating(t.seating_id), sales };
}

/** A takeaway of 2 naans (Rs 60.00 + 16 % 9.60 = Rs 69.60 → Rs 70.00) paid in cash and closed. */
async function closedTakeaway(prefix: string, mode_id = 'cash', total = 7_000) {
  const o = takeaway(2, prefix);
  const ref = { order_id: o.order_id };
  ok(await pay(cashier, ref, 1, mode_id, total));
  const sale = ok(await close(cashier, ref, 1, total));
  return { ...o, ref, bill_id: billOfOrder(o.order_id), sale };
}

const invoiceIdOf = (r: Reply) => r.result!['invoice_id'] as string;

/** An open 05 request on the bill through 01d's real raiseMany (its own command is another task's), as the Manager. */
function raiseOnBill(kind: string, bill_id: string, values: Record<string, unknown>, dedupe_key: string): string {
  const directory = currentDirectory(hub.app);
  return hub.deps.writer.run((tx) => {
    const ctx = {
      tx,
      state: tx.state,
      clock: tx.clock,
      ids: tx.ids,
      actor: { kind: 'device', staffId: manager.staffId, stationId: null, sessionId: manager.sessionId, deviceId: manager.deviceId },
      branch: { tenantId: 'tenant-a', branchId: 'branch-1' },
      directory,
      permission: directory.resolve(manager.staffId, 'take-payment'),
      queuedAt: null,
    } as unknown as CommandCtx;
    const [res] = alerts.raiseMany(ctx, [
      {
        kind,
        subject: { stream_type: 'bill', stream_id: bill_id },
        target: { kind: 'answerers' },
        values,
        details: {},
        display: { kind_label_key: `alert.${kind}.lock`, table_code: null, requester_name: null },
        dedupe_key,
        requester_staff_id: manager.staffId,
        request: { approver_role_ids: ['R_MGR'] },
      },
    ]);
    tx.append(res!.events);
    return res!.alert_id;
  }).result;
}

/** A never-closed dine-in bill (2 naans, Rs 70.00 cash taken) whose only order is removed: the out pay-back empties it. */
async function emptiedDineIn(): Promise<string> {
  const s = seated(2);
  ok(await pay(cashier, { seating_id: s.seating_id }, 1, 'cash', 7_000));
  ok(await post(hub, taker, 'remove-items', 'RemoveItems', { order_id: s.order_id, seating_id: s.seating_id, lines: [{ order_item_id: s.line }] }));
  return billOfSeating(s.seating_id);
}

/** dineInTwoRounds split by items in three: karahi Rs 1,200.00 + 16 % 192.00 = Rs 1,392.00 | naan Rs 30.00 + 4.80 → Rs 35.00 | naan Rs 35.00. */
const SPLIT3 = [139_200, 3_500, 3_500];

async function view(ref: Record<string, string>): Promise<BillView> {
  const res = await hub.app.inject({ method: 'GET', url: `/queries/bill?${new URLSearchParams(ref).toString()}`, headers: { authorization: `Bearer ${cashier.token}`, 'x-session-token': cashier.sessionToken } });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: BillView }).data;
}

// ================================================================================================= direct path

describe('[05 §6.13, §3.10, #37] ReopenBill (direct) — credits, OrdersUnbilled, the 02a frame, splits open', () => {
  it('[05 #37, #37b, #91c] a closed 2-split dine-in bill on an uncleaned seating: full edit; two credits copying each original; re-close → new sale numbers and BillClosed again', async () => {
    await start();
    const b = await closedTwoSplits('A');
    const originals = b.sales.map((s) => s.events.find((e) => e.event_type === 'InvoiceIssued')!.payload);
    expect(one('SELECT state FROM seatings WHERE seating_id = ?', b.seating_id)).toBe('NEEDS_CLEANING');

    const r = ok(await reopen(manager, { bill_id: b.bill_id, reason_code: 'wrong_payment_mode' }));
    expect(r.result).toEqual({ reopened: { mode: 'full', credits: [{ invoice_ref: 'C000001', total_minor: 73_100 }, { invoice_ref: 'C000002', total_minor: 73_100 }] } });
    expect(r.events.map((e) => [e.event_type, e.stream_type, e.stream_id])).toEqual([
      ['BillReopened', 'bill', b.bill_id],
      ['InvoiceCredited', 'bill', b.bill_id],
      ['InvoiceCredited', 'bill', b.bill_id],
      ['OrdersUnbilled', 'order', b.rounds[0].order_id],
      ['SeatingReopened', 'table', b.table_id],
    ]);
    const order_ids = [b.rounds[0].order_id, b.rounds[1].order_id];
    expect(r.events[0]!.payload).toEqual({ bill_id: b.bill_id, order_ids, mode: 'full', reason_code: 'wrong_payment_mode', has_note: false, note_id: null, requester_staff_id: STAFF.manager, approver_staff_id: null, alert_id: null });
    expect(r.events[3]!.payload).toEqual({ order_ids, bill_id: b.bill_id });
    expect(r.events[4]!.payload).toEqual({ seating_id: b.seating_id, bill_id: b.bill_id });
    // each credit = the full original (amounts, lines, tax rows, snapshot); its own number, ref, day, issued_at; closed_by = the requester (#91c)
    const credits = ofType(r, 'InvoiceCredited').map((e) => e.payload);
    credits.forEach((c, i) => {
      const o = originals[i]!;
      const OWN = ['invoice_id', 'series', 'number', 'invoice_ref', 'issued_at', 'business_date', 'closed_by', 'discount_line_ids'];
      const copied = Object.fromEntries(Object.entries(o).filter(([key]) => !OWN.includes(key)));
      expect(c).toMatchObject(copied);
      expect(c).toMatchObject({ series: 'credit', number: i + 1, invoice_ref: `C00000${i + 1}`, ref_invoice_id: o['invoice_id'], ref_invoice_ref: o['invoice_ref'], alert_id: null, closed_by: STAFF.manager, total_minor: 73_100 });
      expect(c['invoice_id']).toMatch(ULID);
      expect(c).not.toHaveProperty('discount_line_ids');
    });
    expect(originals.map((o) => o['closed_by'])).toEqual([STAFF.cashier, STAFF.cashier]);
    // folds: the bill OPEN (full), every split open with its payments, originals credited, credit outbox rows behind theirs
    expect(db().prepare('SELECT state, reopen_mode, reopen_count FROM bills WHERE bill_id = ?').get(b.bill_id)).toEqual({ state: 'open', reopen_mode: 'full', reopen_count: 1 });
    expect(db().prepare('SELECT split_no, state, invoice_id FROM bill_splits WHERE bill_id = ? ORDER BY split_no').all(b.bill_id)).toEqual([
      { split_no: 1, state: 'open', invoice_id: null },
      { split_no: 2, state: 'open', invoice_id: null },
    ]);
    expect(one('SELECT COUNT(*) FROM bill_payments WHERE bill_id = ? AND removed_at IS NULL', b.bill_id)).toBe(2);
    expect(db().prepare(`SELECT ref_invoice_id, state FROM fiscal_outbox WHERE ref_invoice_id IS NOT NULL ORDER BY ord`).all()).toEqual(originals.map((o) => ({ ref_invoice_id: o['invoice_id'], state: 'not_required' })));
    expect(db().prepare('SELECT billed_at FROM orders WHERE order_id IN (?, ?)').pluck().all(...order_ids)).toEqual([null, null]);
    expect(one('SELECT state FROM seatings WHERE seating_id = ?', b.seating_id)).not.toBe('NEEDS_CLEANING');
    // statements fixed: ensure bill, open request, invoices, order set, other open, credit number
    expect(handled['reopen-bill']).toBe(6);

    // re-close each split → new sale numbers 3, 4; the last writes BillClosed again
    const re1 = ok(await close(cashier, b.ref, 1, 73_100));
    const re2 = ok(await close(cashier, b.ref, 2, 73_100));
    expect([re1.result!['invoice_ref'], re2.result!['invoice_ref']]).toEqual(['S000003', 'S000004']);
    expect(typesOf(re2)).toContain('BillClosed');
    expect(one('SELECT state FROM seatings WHERE seating_id = ?', b.seating_id)).toBe('NEEDS_CLEANING');
  });

  it('[05 #91, §6.13] statements stay 6 for one split as for two (+1 with a note)', async () => {
    await start();
    const t = await closedTakeaway('ST');
    ok(await reopen(manager, { bill_id: t.bill_id, reason_code: 'other', note: secret('NOTE-statements-1') }));
    expect(handled['reopen-bill']).toBe(7);
  });

  it('[05 #37, #37c, #6b] dine-in after CleanTable → corrections; no SeatingReopened, no TableMarksChanged; re-close writes no BillClosed', async () => {
    await start();
    const s = seated(2);
    ok(await pay(cashier, { seating_id: s.seating_id }, 1, 'cash', 7_000));
    ok(await close(cashier, { seating_id: s.seating_id }, 1, 7_000));
    const bill_id = billOfSeating(s.seating_id);
    ok(await post(hub, taker, 'clean-table', 'CleanTable', { table_id: s.table_id, seating_id: s.seating_id }));
    const r = ok(await reopen(manager, { bill_id, reason_code: 'price_error' }));
    expect(r.result).toEqual({ reopened: { mode: 'corrections', credits: [{ invoice_ref: 'C000001', total_minor: 7_000 }] } });
    expect(typesOf(r)).toEqual(['BillReopened', 'InvoiceCredited', 'OrdersUnbilled']);
    expect(r.events[0]!.payload['mode']).toBe('corrections');
    expect(one('SELECT reopen_mode FROM bills WHERE bill_id = ?', bill_id)).toBe('corrections');
    const re = ok(await close(cashier, { bill_id }, 1, 7_000));
    expect(typesOf(re)).not.toContain('BillClosed');
    expect(one('SELECT state FROM seatings WHERE seating_id = ?', s.seating_id)).toBe('CLOSED');
  });

  it('[05 #37h, #6b, §6.4a] a PARTLY_PAID dine-in bill: full, one credit, no OrdersUnbilled / SeatingReopened, one TableMarksChanged with no alert_id key', async () => {
    await start();
    const b = dineInTwoRounds(hub, { prefix: 'PP' });
    const ref = { seating_id: b.seating_id };
    ok(await post(hub, cashier, 'set-splits', 'SetSplits', { bill_ref: ref, mode: 'equal', n: 2 }));
    ok(await pay(cashier, ref, 1, 'cash', 73_100));
    ok(await close(cashier, ref, 1, 73_100));
    const bill_id = billOfSeating(b.seating_id);
    const r = ok(await reopen(manager, { bill_id, reason_code: 'wrong_item_billed' }));
    expect(r.result).toEqual({ reopened: { mode: 'full', credits: [{ invoice_ref: 'C000001', total_minor: 73_100 }] } });
    expect(typesOf(r)).toEqual(['BillReopened', 'InvoiceCredited', 'TableMarksChanged']);
    expect(r.events[0]!.payload['order_ids']).toEqual([b.rounds[0].order_id, b.rounds[1].order_id]);
    expect(r.events[2]).toMatchObject({ stream_type: 'table', stream_id: b.table_id });
    expect(r.events[2]!.payload).toEqual({ seating_id: b.seating_id });
    expect(db().prepare('SELECT order_id FROM bill_orders WHERE bill_id = ? ORDER BY order_id').pluck().all(bill_id)).toEqual([b.rounds[0].order_id, b.rounds[1].order_id].sort());
    expect(one(`SELECT COUNT(*) FROM bills WHERE seating_id = ?`, b.seating_id)).toBe(1);
  });

  it('[05 #44, #44c, #44g, #6b] a takeaway closed before the food: credit + OrdersUnbilled, no table event; an addition joins and the re-close invoices both orders', async () => {
    await start();
    const t = await closedTakeaway('TA');
    const r = ok(await reopen(manager, { bill_id: t.bill_id, reason_code: 'customer_returned_item' }));
    expect(typesOf(r)).toEqual(['BillReopened', 'InvoiceCredited', 'OrdersUnbilled']);
    expect(r.result!['reopened']).toMatchObject({ mode: 'full' });
    // the kitchen keeps cooking: the engine still holds the line
    expect(one('SELECT COUNT(*) FROM order_lines WHERE order_id = ? AND voided_units = 0', t.order_id)).toBe(1);
    const add = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, adds_to_order_id: t.order_id, lines: [{ order_item_id: 'TA_ADD', item_id: FX.naan }] });
    // #44g: the addition keeps the root's token and bill_key, with its own table_key
    const pair = db().prepare('SELECT token, bill_key, table_key FROM orders WHERE order_id IN (?, ?) ORDER BY placed_at').all(t.order_id, add.order_id) as Array<{ token: number; bill_key: string; table_key: string }>;
    expect(pair[1]!.token).toBe(pair[0]!.token);
    expect(pair[1]!.bill_key).toBe(pair[0]!.bill_key);
    expect(pair[1]!.table_key).not.toBe(pair[0]!.table_key);
    // Rs 90.00 + 16 % 14.40 = 104.40 → Rs 104.00; Rs 70.00 already paid
    ok(await pay(cashier, { bill_id: t.bill_id }, 1, 'cash', 3_400));
    const re = ok(await close(cashier, { bill_id: t.bill_id }, 1, 10_400));
    expect(re.result!['invoice_ref']).toBe('S000002');
    expect(new Set(re.events.find((e) => e.event_type === 'InvoiceIssued')!.payload['lines'] as Array<{ order_item_id: string }>).size).toBe(2);
    expect(re.events.find((e) => e.event_type === 'OrdersBilled')!.payload['order_ids']).toEqual([t.order_id, add.order_id]);
  });

  it('[05 #44f, #44e] close → an addition opens a new bill on the key → reopen the first → corrections; the addition stays on the new bill', async () => {
    await start();
    const t = await closedTakeaway('TF');
    const add = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, adds_to_order_id: t.order_id, lines: [{ order_item_id: 'TF_ADD', item_id: FX.naan }] });
    ok(await pay(cashier, { order_id: add.order_id }, 1, 'cash', 3_500)); // opens the new bill: Rs 30.00 + 4.80 → Rs 35.00
    const r = ok(await reopen(manager, { bill_id: t.bill_id, reason_code: 'wrong_item_billed' }));
    expect(r.result!['reopened']).toMatchObject({ mode: 'corrections' });
    expect(r.events[0]!.payload['order_ids']).toEqual([t.order_id]);
    expect(billOfOrder(add.order_id)).toBeUndefined();
    expect(one('SELECT COUNT(*) FROM bills WHERE table_key IS NOT NULL')).toBe(2);
  });

  it('[05 #38, #44i] a day-1 takeaway reopened on day 2 → corrections; the credit is in day 2, the day-1 invoice unchanged', async () => {
    await start();
    const t = await closedTakeaway('D1');
    const day1 = one('SELECT business_date FROM invoices WHERE series = ?', 'sale') as string;
    hubEvents([{ stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, event_type: 'BusinessDayClosed', payload: {} }]);
    const noon = new Date(`${day1}T12:00:00`);
    noon.setDate(noon.getDate() + 1);
    hub.clock.set(noon.getTime());
    const { business_date: day2 } = openDay(hub, { menu: menu(billingDoc()), stock: { [FX.stock]: 1_000_000, [VX.naanStock]: 1_000 } });
    expect(day2 > day1).toBe(true);
    manager = signIn(hub, STAFF.manager); // the clock moved a day: a fresh session
    const r = ok(await reopen(manager, { bill_id: t.bill_id, reason_code: 'price_error' }));
    expect(r.result!['reopened']).toMatchObject({ mode: 'corrections' });
    expect(ofType(r, 'InvoiceCredited')[0]!.payload['business_date']).toBe(day2);
    expect(db().prepare(`SELECT series, business_date FROM invoices ORDER BY series`).all()).toEqual([
      { series: 'credit', business_date: day2 },
      { series: 'sale', business_date: day1 },
    ]);
  });

  it('[05 #14 credit half, B5] after a rate change the credit copies the original tax rows; the new invoice takes today’s rate and the difference is paid in', async () => {
    await start();
    const t = await closedTakeaway('RT');
    reconfigure({ cash_bp: 1_700 });
    const r = ok(await reopen(manager, { bill_id: t.bill_id, reason_code: 'price_error' }));
    const credit = ofType(r, 'InvoiceCredited')[0]!.payload as { taxes: Array<{ rate_bp: number; tax_minor: number }>; total_minor: number };
    expect(credit.taxes.map((x) => [x.rate_bp, x.tax_minor])).toEqual([[1_600, 960]]);
    expect(credit.total_minor).toBe(7_000);
    // Rs 60.00 + 17 % 10.20 = 70.20 → Rs 70.00: no difference at Rs 1 rounding; the tax row is today's
    const re = ok(await close(cashier, { bill_id: t.bill_id }, 1, 7_000));
    const sale = re.events.find((e) => e.event_type === 'InvoiceIssued')!.payload as { taxes: Array<{ rate_bp: number; tax_minor: number }> };
    expect(sale.taxes.map((x) => [x.rate_bp, x.tax_minor])).toEqual([[1_700, 1_020]]);
  });

  it('[05 #78, J-1, H9-6] an original under the fake adapter, credited after the branch switched back to PK: the credit keeps the original snapshot, jurisdiction and adapter; its outbox row waits behind the original', async () => {
    await start({ adapter_key: 'FAKE' });
    const t = await closedTakeaway('FK');
    const original = t.sale.events.find((e) => e.event_type === 'InvoiceIssued')!.payload;
    reconfigure({ adapter_key: 'none' });
    const r = ok(await reopen(manager, { bill_id: t.bill_id, reason_code: 'wrong_payment_mode' }));
    const credit = ofType(r, 'InvoiceCredited')[0]!.payload;
    expect(credit).toMatchObject({ jurisdiction_id: 'TEST-J', fiscal: original['fiscal'], taxes: original['taxes'] });
    expect(db().prepare('SELECT invoice_id, ref_invoice_id, adapter_key, jurisdiction_id, pos_id, state FROM fiscal_outbox ORDER BY ord').all()).toEqual([
      { invoice_id: original['invoice_id'], ref_invoice_id: null, adapter_key: 'FAKE', jurisdiction_id: 'TEST-J', pos_id: 'POS-1', state: 'pending' },
      { invoice_id: credit['invoice_id'], ref_invoice_id: original['invoice_id'], adapter_key: 'FAKE', jurisdiction_id: 'TEST-J', pos_id: 'POS-1', state: 'pending' },
    ]);
  });

  it('[05 #78b, J-1, J-6] an adapter that cannot credit: a pending invoice → BILL_REOPEN_NOT_SUPPORTED, nothing written; a not_required invoice on the same branch reopens', async () => {
    await start({ adapter_key: 'FAKE_NC', fiscalize: { dine_in: false, takeaway: true, parking: true, delivery: false } });
    const t = await closedTakeaway('NC');
    const sale = invoiceIdOf(t.sale);
    const refused = await reopen(manager, { bill_id: t.bill_id, reason_code: 'price_error' });
    expect(refused.status).toBe(409);
    expect(refused.error).toEqual({ code: 'BILL_REOPEN_NOT_SUPPORTED', details: { invoice_id: sale } });
    expect(written()).toEqual({ credits: 0, outbox: 1, reopen_events: 0, reopen_commands: 0, texts: 0 });
    // a dine-in invoice on the same branch is not fiscalized (not_required): it reopens
    const s = seated(2);
    ok(await pay(cashier, { seating_id: s.seating_id }, 1, 'cash', 7_000));
    ok(await close(cashier, { seating_id: s.seating_id }, 1, 7_000));
    expect(ok(await reopen(manager, { bill_id: billOfSeating(s.seating_id), reason_code: 'price_error' })).result!['reopened']).toMatchObject({ mode: 'full' });
  });

  it('[05 §6.13, §9] refusals in order, nothing written: unknown bill, OPEN bill, an open reopen request; Zod note for other', async () => {
    await start();
    const nf = await reopen(manager, { bill_id: 'NO_SUCH', reason_code: 'price_error' });
    expect([nf.status, nf.error]).toEqual([404, { code: 'BILL_NOT_FOUND', details: { bill_id: 'NO_SUCH' } }]);
    const s = seated(1);
    ok(await pay(cashier, { seating_id: s.seating_id }, 1, 'cash', 1_000));
    const bill_id = billOfSeating(s.seating_id);
    const openBill = await reopen(manager, { bill_id, reason_code: 'price_error' });
    expect([openBill.status, openBill.error]).toEqual([409, { code: 'BILL_NOT_OPEN', details: { bill_id, state: 'open' } }]);
    const zod = await reopen(manager, { bill_id, reason_code: 'other' });
    expect(zod.status).toBe(400);
    const extra = await reopen(manager, { bill_id, reason_code: 'price_error', mode: 'full' });
    expect(extra.status).toBe(400);
    const t = await closedTakeaway('PD');
    const pending = ok(await reopen(cashier, { bill_id: t.bill_id, reason_code: 'price_error' }));
    const alert_id = (pending.result!['pending'] as { alert_id: string }).alert_id;
    const again = await reopen(manager, { bill_id: t.bill_id, reason_code: 'price_error' });
    expect([again.status, again.error]).toEqual([409, { code: 'BILL_REOPEN_PENDING', details: { alert_id } }]);
    expect(written()).toMatchObject({ credits: 0, reopen_events: 0 });
  });

  it('[05 row H-4, H3-5] command_id replay returns the stored reply (a changed note does not matter); the note is only in bill_texts', async () => {
    await start();
    const t = await closedTakeaway('RP');
    const first = ok(await reopen(manager, { bill_id: t.bill_id, reason_code: 'other', note: secret('NOTE-first-77') }, 'ro-replay'));
    const second = ok(await reopen(manager, { bill_id: t.bill_id, reason_code: 'other', note: secret('NOTE-second-88') }, 'ro-replay'));
    expect(second.result).toEqual(first.result);
    expect(count('BillReopened')).toBe(1);
    expect(count('InvoiceCredited')).toBe(1);
    const note_id = first.events[0]!.payload['note_id'] as string;
    expect(first.events[0]!.payload).toMatchObject({ has_note: true, note_id: expect.stringMatching(ULID) });
    expect(db().prepare('SELECT subject_id, text FROM bill_texts').all()).toEqual([{ subject_id: note_id, text: 'NOTE-first-77' }]);
  });

  it('[05 #40, #37b] a reopened bill with a lower total (the holder’s RemoveItems passes the lock after the reopen): negative balance → AddPayment out from the shift; above the refund due → PAYMENT_EXCEEDS_BALANCE', async () => {
    await start();
    const s = seated(2);
    ok(await pay(cashier, { seating_id: s.seating_id }, 1, 'cash', 7_000));
    ok(await close(cashier, { seating_id: s.seating_id }, 1, 7_000));
    const bill_id = billOfSeating(s.seating_id);
    ok(await reopen(manager, { bill_id, reason_code: 'customer_returned_item' }));
    ok(await post(hub, taker, 'remove-items', 'RemoveItems', { order_id: s.order_id, seating_id: s.seating_id, lines: [{ order_item_id: s.line, units: 1 }] }));
    // Rs 30.00 + 4.80 = 34.80 → Rs 35.00; Rs 70.00 paid → Rs 35.00 back
    const over = await pay(cashier, { bill_id }, 1, 'cash', 3_600, 'out');
    expect([over.status, over.error]).toEqual([422, { code: 'PAYMENT_EXCEEDS_BALANCE', details: { balance_minor: 3_500 } }]);
    const back = ok(await pay(cashier, { bill_id }, 1, 'cash', 3_500, 'out'));
    expect(typesOf(back)).toEqual(['PaymentAdded']);
    expect(back.result!['balance_minor']).toBe(0);
    expect(ok(await close(cashier, { bill_id }, 1, 3_500)).result!['invoice_ref']).toBe('S000002');
  });
});

// ================================================================================================= approval path

describe('[05 §6.13, §3.14, R-66 / G-62] ReopenBill (approval) — credit ids minted at raise, apply mints nothing', () => {
  it('[05 #39, #37j, R-66, #91c] raise: values carry one ULID credit id per invoice in order, the note at raise; approve in person (actor ≠ answerer): every draft carries the alert_id, the credits take the minted ids, approver = answerer, closed_by = requester', async () => {
    await start();
    const b = await closedTwoSplits('AP');
    const sales = b.sales.map(invoiceIdOf);
    const raise = ok(await reopen(cashier, { bill_id: b.bill_id, reason_code: 'other', note: secret('NOTE-raise-42') }));
    const alert_id = (raise.result as { pending: { alert_id: string } }).pending.alert_id;
    expect(typesOf(raise)[0]).toBe('AlertRaised');
    expect(typesOf(raise).filter((t) => ['BillReopened', 'InvoiceCredited', 'OrdersUnbilled'].includes(t))).toEqual([]);
    const values = JSON.parse(one('SELECT values_json FROM alerts WHERE alert_id = ?', alert_id) as string) as Record<string, unknown> & { credit_invoice_ids: string[] };
    expect(values).toEqual({ bill_id: b.bill_id, invoice_ids: sales, credit_invoice_ids: [expect.stringMatching(ULID), expect.stringMatching(ULID)], reason_code: 'other', note_id: expect.stringMatching(ULID), has_note: true });
    expect(new Set(values.credit_invoice_ids).size).toBe(2);
    expect(written()).toMatchObject({ credits: 0, reopen_events: 0, texts: 1 });

    const a = ok(await approveInPerson(cashier, alert_id));
    const effect = a.events.filter((e) => ['BillReopened', 'InvoiceCredited', 'OrdersUnbilled', 'SeatingReopened', 'TableMarksChanged'].includes(e.event_type));
    expect(effect.map((e) => e.event_type)).toEqual(['BillReopened', 'InvoiceCredited', 'InvoiceCredited', 'OrdersUnbilled', 'SeatingReopened']);
    for (const e of effect) expect(e.payload['alert_id'], e.event_type).toBe(alert_id);
    expect(effect[0]!.actor_id).toBe(STAFF.cashier); // in person: the requester's session
    expect(effect[0]!.payload).toMatchObject({ mode: 'full', reason_code: 'other', has_note: true, note_id: values['note_id'], requester_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager });
    const credits = ofType(a, 'InvoiceCredited').map((e) => e.payload);
    expect(credits.map((c) => [c['invoice_id'], c['ref_invoice_id'], c['closed_by']])).toEqual([
      [values.credit_invoice_ids[0], sales[0], STAFF.cashier],
      [values.credit_invoice_ids[1], sales[1], STAFF.cashier],
    ]);
    expect(db().prepare(`SELECT invoice_id FROM invoices WHERE series = 'credit' ORDER BY number`).pluck().all()).toEqual(values.credit_invoice_ids);
    expect(one('SELECT state FROM alerts WHERE alert_id = ?', alert_id)).toBe('closed');
  });

  it('[05 #6c, R-43 / G-40] approve of a PARTLY_PAID dine-in bill on an open seating: TableMarksChanged { seating_id, alert_id } and checkAlertIds accepts the answer', async () => {
    await start();
    const b = dineInTwoRounds(hub, { prefix: 'MK' });
    const ref = { seating_id: b.seating_id };
    ok(await post(hub, cashier, 'set-splits', 'SetSplits', { bill_ref: ref, mode: 'equal', n: 2 }));
    ok(await pay(cashier, ref, 1, 'cash', 73_100));
    ok(await close(cashier, ref, 1, 73_100));
    const bill_id = billOfSeating(b.seating_id);
    const alert_id = ((ok(await reopen(cashier, { bill_id, reason_code: 'price_error' })).result as { pending: { alert_id: string } }).pending).alert_id;
    const a = ok(await answer(hub, manager, alert_id, 'approve'));
    const marks = ofType(a, 'TableMarksChanged');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.payload).toEqual({ seating_id: b.seating_id, alert_id });
    expect(ofType(a, 'SeatingReopened')).toHaveLength(0);
    expect(ofType(a, 'OrdersUnbilled')).toHaveLength(0);
  });

  it('[05 #39, #39b, #37j, H2-17, R-66, R-74] the invoices change between raise and approve → the answer is refused (no credit id reused for another invoice); reject succeeds and closes the request', async () => {
    await start();
    const b = dineInTwoRounds(hub, { prefix: 'CH' });
    const ref = { seating_id: b.seating_id };
    const [k, n1] = b.rounds[0].lines;
    const n2 = b.rounds[1].lines[0]!;
    ok(await post(hub, cashier, 'set-splits', 'SetSplits', { bill_ref: ref, mode: 'items', splits: [
      { split_no: 1, lines: [{ order_item_id: k, units: 1 }] },
      { split_no: 2, lines: [{ order_item_id: n1, units: 1 }] },
      { split_no: 3, lines: [{ order_item_id: n2, units: 1 }] },
    ] }));
    const totals = (await view(ref)).splits.map((x) => x.totals.as_paid.total_minor);
    expect(totals).toEqual(SPLIT3);
    ok(await pay(cashier, ref, 1, 'cash', SPLIT3[0]!));
    ok(await close(cashier, ref, 1, SPLIT3[0]!));
    const bill_id = billOfSeating(b.seating_id);
    const alert_id = ((ok(await reopen(cashier, { bill_id, reason_code: 'price_error' })).result as { pending: { alert_id: string } }).pending).alert_id;
    // split 2 closes meanwhile (not the last): the bill's current sale invoices are now two; the request stays open
    ok(await pay(cashier, ref, 2, 'cash', SPLIT3[1]!));
    ok(await close(cashier, ref, 2, SPLIT3[1]!));
    expect(one('SELECT state FROM alerts WHERE alert_id = ?', alert_id)).not.toBe('closed');
    const refused = await answer(hub, manager, alert_id, 'approve');
    expect(refused.status).toBe(409);
    expect(refused.error).toEqual({ code: 'BILL_NOT_OPEN', details: { bill_id, state: 'partly_paid' } });
    expect(written()).toMatchObject({ credits: 0, reopen_events: 0 });
    ok(await answer(hub, manager, alert_id, 'reject'));
    expect(one('SELECT state FROM alerts WHERE alert_id = ?', alert_id)).toBe('closed');
    expect(written()).toMatchObject({ credits: 0, reopen_events: 0 });
  });

  it('[05 #37d, R-40] a request raised before CleanTable and approved after it → the mode is the one read at approve: corrections, no table event', async () => {
    await start();
    const s = seated(2);
    ok(await pay(cashier, { seating_id: s.seating_id }, 1, 'cash', 7_000));
    ok(await close(cashier, { seating_id: s.seating_id }, 1, 7_000));
    const bill_id = billOfSeating(s.seating_id);
    const alert_id = ((ok(await reopen(cashier, { bill_id, reason_code: 'price_error' })).result as { pending: { alert_id: string } }).pending).alert_id;
    ok(await post(hub, taker, 'clean-table', 'CleanTable', { table_id: s.table_id, seating_id: s.seating_id }));
    const a = ok(await answer(hub, manager, alert_id, 'approve'));
    expect(ofType(a, 'BillReopened')[0]!.payload['mode']).toBe('corrections');
    expect(ofType(a, 'SeatingReopened').length + ofType(a, 'TableMarksChanged').length).toBe(0);
    expect(one('SELECT reopen_mode FROM bills WHERE bill_id = ?', bill_id)).toBe('corrections');
  });

  it('[05 #39] reject and withdraw write nothing; a second ask while one is open → BILL_REOPEN_PENDING', async () => {
    await start();
    const t = await closedTakeaway('RJ');
    const first = (ok(await reopen(cashier, { bill_id: t.bill_id, reason_code: 'price_error' })).result as { pending: { alert_id: string } }).pending.alert_id;
    const dup = await reopen(cashier, { bill_id: t.bill_id, reason_code: 'price_error' });
    expect([dup.status, dup.error]).toEqual([409, { code: 'BILL_REOPEN_PENDING', details: { alert_id: first } }]);
    ok(await answer(hub, manager, first, 'reject'));
    const second = (ok(await reopen(cashier, { bill_id: t.bill_id, reason_code: 'price_error' })).result as { pending: { alert_id: string } }).pending.alert_id;
    ok(await answer(hub, cashier, second, 'withdraw'));
    expect(written()).toMatchObject({ credits: 0, reopen_events: 0 });
    expect(one('SELECT state FROM bills WHERE bill_id = ?', t.bill_id)).toBe('closed');
  });

  it('[05 #78b, J-1] an approved reopen_bill re-checks BILL_REOPEN_NOT_SUPPORTED at answer time', async () => {
    await start({ adapter_key: 'FAKE_NC' });
    const t = await closedTakeaway('RC');
    // the row was rejected at raise (no credit needed), back to pending before the answer
    db().prepare(`UPDATE fiscal_outbox SET state = 'rejected'`).run();
    const alert_id = ((ok(await reopen(cashier, { bill_id: t.bill_id, reason_code: 'price_error' })).result as { pending: { alert_id: string } }).pending).alert_id;
    db().prepare(`UPDATE fiscal_outbox SET state = 'pending'`).run();
    const refused = await answer(hub, manager, alert_id, 'approve');
    expect([refused.status, refused.error]).toEqual([409, { code: 'BILL_REOPEN_NOT_SUPPORTED', details: { invoice_id: invoiceIdOf(t.sale) } }]);
    expect(written()).toMatchObject({ credits: 0, reopen_events: 0 });
  });
});

// ================================================================================================= empty close

describe('[05 §3.10, H6-6, H7-3, H8-4, row Q-7] BillClosedEmpty — AddPayment out and the order-cancelled hook', () => {
  it('[05 #44j, §6.9 plan fix] full return: reopen, remove every line, pay back with out → BillClosedEmpty naming the credit; no sale invoice; NEEDS_CLEANING', async () => {
    await start();
    const s = seated(2);
    ok(await pay(cashier, { seating_id: s.seating_id }, 1, 'cash', 7_000));
    ok(await close(cashier, { seating_id: s.seating_id }, 1, 7_000));
    const bill_id = billOfSeating(s.seating_id);
    const r = ok(await reopen(manager, { bill_id, reason_code: 'customer_returned_item' }));
    const credit_id = ofType(r, 'InvoiceCredited')[0]!.payload['invoice_id'];
    const ri = ok(await post(hub, taker, 'remove-items', 'RemoveItems', { order_id: s.order_id, seating_id: s.seating_id, lines: [{ order_item_id: s.line }] }));
    expect(typesOf(ri)).toContain('OrderCancelled');
    expect(typesOf(ri)).not.toContain('BillClosedEmpty'); // Rs 70.00 still held
    const back = ok(await pay(cashier, { bill_id }, 1, 'cash', 7_000, 'out'));
    expect(typesOf(back)).toEqual(['PaymentAdded', 'BillClosedEmpty']);
    expect(back.events[1]).toMatchObject({ stream_type: 'bill', stream_id: bill_id, payload: { bill_id, seating_id: s.seating_id, credit_invoice_ids: [credit_id] } });
    expect(one('SELECT state FROM bills WHERE bill_id = ?', bill_id)).toBe('closed');
    expect(one(`SELECT COUNT(*) FROM invoices WHERE series = 'sale'`)).toBe(1);
    expect(one('SELECT state FROM seatings WHERE seating_id = ?', s.seating_id)).toBe('NEEDS_CLEANING');
    // AddPayment's ensure bill, splits, money shift, orders (no lines, no voids to read) + the cancelled orders, credits, the seating's other open bills, listOpen
    // 05 v1.0.17 R-73: AddPayment ≤ 8 on the empty-close path only (every other path ≤ 7, §6.9)
    expect(handled['add-payment']).toBe(8);
  });

  it('[05 #44l, H8-4] a never-closed bill: cash taken, every order removed, the cash paid back → BillClosedEmpty, no fiscal row, gone from open-bills', async () => {
    await start();
    const o = takeaway(2, 'NV');
    ok(await pay(cashier, { order_id: o.order_id }, 1, 'cash', 7_000));
    const bill_id = one('SELECT bill_id FROM bills') as string;
    ok(await post(hub, taker, 'remove-items', 'RemoveItems', { order_id: o.order_id, lines: [{ order_item_id: o.line }] }));
    const back = ok(await pay(cashier, { bill_id }, 1, 'cash', 7_000, 'out'));
    expect(typesOf(back)).toEqual(['PaymentAdded', 'BillClosedEmpty']);
    expect(back.events[1]!.payload).toEqual({ bill_id, seating_id: null, credit_invoice_ids: [] });
    expect(one('SELECT COUNT(*) FROM fiscal_outbox')).toBe(0);
    const list = await hub.app.inject({ method: 'GET', url: '/queries/open-bills', headers: { authorization: `Bearer ${cashier.token}`, 'x-session-token': cashier.sessionToken } });
    expect(JSON.stringify(list.json())).not.toContain(bill_id);
  });

  it('[05 #44k (b), row Q-7] RemoveItems of the last line while every split balance is already 0 → the hook appends BillClosedEmpty after OrderCancelled (no alert_id key)', async () => {
    await start();
    const s = seated(1);
    const p = ok(await pay(cashier, { seating_id: s.seating_id }, 1, 'cash', 1_000));
    ok(await post(hub, cashier, 'remove-payment', 'RemovePayment', { payment_id: p.result!['payment_id'], reason_code: 'wrong_amount' }));
    const bill_id = billOfSeating(s.seating_id);
    const ri = ok(await post(hub, taker, 'remove-items', 'RemoveItems', { order_id: s.order_id, seating_id: s.seating_id, lines: [{ order_item_id: s.line }] }));
    const types = typesOf(ri);
    expect(types.indexOf('BillClosedEmpty')).toBe(types.indexOf('OrderCancelled') + 1);
    expect(ofType(ri, 'BillClosedEmpty')[0]!.payload).toEqual({ bill_id, seating_id: s.seating_id, credit_invoice_ids: [] });
    expect(one('SELECT state FROM bills WHERE bill_id = ?', bill_id)).toBe('closed');
    expect(one('SELECT state FROM seatings WHERE seating_id = ?', s.seating_id)).toBe('NEEDS_CLEANING');
  });

  it('[05 #44k, row Q-7] full takeaway return in the natural order: void requested, money paid back, the manager approves the void → BillClosedEmpty with the void request’s alert_id', async () => {
    await start();
    const t = await closedTakeaway('VD');
    ok(await reopen(manager, { bill_id: t.bill_id, reason_code: 'customer_returned_item' }));
    toStage(hub, t.order_id, [t.line], 'cooking');
    const v = raiseVoid(hub, { requester: taker, order_id: t.order_id, order_item_id: t.line });
    // the pending void's refund takes the bill to −Rs 70.00: the cash goes back first
    const back = ok(await pay(cashier, { bill_id: t.bill_id }, 1, 'cash', 7_000, 'out'));
    expect(typesOf(back)).toEqual(['PaymentAdded']);
    const a = ok(await answer(hub, manager, v.alert_id, 'approve'));
    const empty = ofType(a, 'BillClosedEmpty');
    expect(empty).toHaveLength(1);
    expect(empty[0]!.payload).toMatchObject({ bill_id: t.bill_id, seating_id: null, alert_id: v.alert_id });
    expect(empty[0]!.payload['credit_invoice_ids']).toHaveLength(1);
    expect(one('SELECT state FROM bills WHERE bill_id = ?', t.bill_id)).toBe('closed');
    expect(one(`SELECT COUNT(*) FROM invoices WHERE series = 'sale'`)).toBe(1);
  });

  it('[05 #44k (c)] an empty close of a corrections-only bill (another bill open on the seating) → seating_id null, the table state unchanged', async () => {
    await start();
    const s = seated(2);
    ok(await pay(cashier, { seating_id: s.seating_id }, 1, 'cash', 7_000));
    ok(await close(cashier, { seating_id: s.seating_id }, 1, 7_000));
    const bill_id = billOfSeating(s.seating_id);
    // S-9 (b): a new round on the uncleaned seating → a new (projected) bill on it
    appendOrder(hub, { order_type: 'dine_in', seating_id: s.seating_id, placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'S9_N', item_id: FX.naan }] });
    expect(ok(await reopen(manager, { bill_id, reason_code: 'customer_returned_item' })).result!['reopened']).toMatchObject({ mode: 'corrections' });
    ok(await post(hub, taker, 'remove-items', 'RemoveItems', { order_id: s.order_id, seating_id: s.seating_id, lines: [{ order_item_id: s.line }] }));
    const state = one('SELECT state FROM seatings WHERE seating_id = ?', s.seating_id);
    const back = ok(await pay(cashier, { bill_id }, 1, 'cash', 7_000, 'out'));
    expect(ofType(back, 'BillClosedEmpty')[0]!.payload).toMatchObject({ bill_id, seating_id: null });
    expect(one('SELECT state FROM seatings WHERE seating_id = ?', s.seating_id)).toBe(state);
  });
});

// ================================================================================================= review additions

describe('[05 §3.10, §6.13] ReopenBill — takeaway / parking corrections, tables races, privacy', () => {
  it('[05 #44a] takeaway before close: an addition (adds_to_order_id) joins the open bill and the close invoices both orders', async () => {
    await start();
    const root = takeaway(2, 'AA');
    ok(await pay(cashier, { order_id: root.order_id }, 1, 'cash', 3_000));
    const add = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, adds_to_order_id: root.order_id, lines: [{ order_item_id: 'AA_ADD', item_id: FX.naan }] });
    // Rs 90.00 + 16 % 14.40 = 104.40 → Rs 104.00
    ok(await pay(cashier, { order_id: root.order_id }, 1, 'cash', 7_400));
    const r = ok(await close(cashier, { order_id: add.order_id }, 1, 10_400));
    expect(r.events.find((e) => e.event_type === 'OrdersBilled')!.payload['order_ids']).toEqual([root.order_id, add.order_id]);
  });

  it('[05 #44b] takeaway before close: a wrong item removed and the right one added; too many units removed by units — the bill follows', async () => {
    await start();
    const root = takeaway(3, 'AB');
    ok(await post(hub, taker, 'remove-items', 'RemoveItems', { order_id: root.order_id, lines: [{ order_item_id: root.line, units: 1 }] }));
    appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, adds_to_order_id: root.order_id, lines: [{ order_item_id: 'AB_ADD', item_id: FX.naan }] });
    // 3 − 1 + 1 naans: Rs 90.00 + 14.40 → Rs 104.00
    ok(await pay(cashier, { order_id: root.order_id }, 1, 'cash', 10_400));
    expect(ok(await close(cashier, { order_id: root.order_id }, 1, 10_400)).result!['total_minor']).toBe(10_400);
  });

  it('[05 #44d] takeaway after close: reopen → remove the extra unit → close → credit + new invoice', async () => {
    await start();
    const t = await closedTakeaway('AD');
    ok(await reopen(manager, { bill_id: t.bill_id, reason_code: 'customer_returned_item' }));
    ok(await post(hub, taker, 'remove-items', 'RemoveItems', { order_id: t.order_id, lines: [{ order_item_id: t.line, units: 1 }] }));
    // Rs 30.00 + 4.80 → Rs 35.00; Rs 70.00 paid → Rs 35.00 back
    ok(await pay(cashier, { bill_id: t.bill_id }, 1, 'cash', 3_500, 'out'));
    const re = ok(await close(cashier, { bill_id: t.bill_id }, 1, 3_500));
    expect(re.result!['invoice_ref']).toBe('S000002');
    expect(db().prepare('SELECT series, total_minor FROM invoices ORDER BY series, number').all()).toEqual([
      { series: 'credit', total_minor: 7_000 },
      { series: 'sale', total_minor: 7_000 },
      { series: 'sale', total_minor: 3_500 },
    ]);
  });

  it('[05 #44d parking] a second order of the same plate joins the bill before close and the reopened bill after', async () => {
    await start();
    const first = appendOrder(hub, { order_type: 'parking', placed_by: STAFF.orderTaker, car_number: 'LEB 1234', lines: [{ order_item_id: 'PK1_N', item_id: FX.naan }] });
    const second = appendOrder(hub, { order_type: 'parking', placed_by: STAFF.orderTaker, car_number: 'LEB 1234', lines: [{ order_item_id: 'PK2_N', item_id: FX.naan }] });
    // 2 naans: Rs 70.00
    ok(await pay(cashier, { order_id: first.order_id }, 1, 'cash', 7_000));
    const c = ok(await close(cashier, { order_id: second.order_id }, 1, 7_000));
    expect(c.events.find((e) => e.event_type === 'OrdersBilled')!.payload['order_ids']).toEqual([first.order_id, second.order_id]);
    const bill_id = billOfOrder(first.order_id);
    expect(ok(await reopen(manager, { bill_id, reason_code: 'wrong_item_billed' })).result!['reopened']).toMatchObject({ mode: 'full' });
    const third = appendOrder(hub, { order_type: 'parking', placed_by: STAFF.orderTaker, car_number: 'LEB 1234', lines: [{ order_item_id: 'PK3_N', item_id: FX.naan }] });
    // Rs 90.00 + 14.40 → Rs 104.00; Rs 70.00 paid
    ok(await pay(cashier, { bill_id }, 1, 'cash', 3_400));
    const re = ok(await close(cashier, { bill_id }, 1, 10_400));
    expect(re.events.find((e) => e.event_type === 'OrdersBilled')!.payload['order_ids']).toEqual([first.order_id, second.order_id, third.order_id]);
  });

  it('[05 #44h, Q-3, Q-4] a parking bill of day 1 reopened on day 2 → corrections; the same plate on day 2 is its own bill', async () => {
    await start();
    const first = appendOrder(hub, { order_type: 'parking', placed_by: STAFF.orderTaker, car_number: 'LEB 9', lines: [{ order_item_id: 'PH1_N', item_id: FX.naan, quantity: 2 }] });
    ok(await pay(cashier, { order_id: first.order_id }, 1, 'cash', 7_000));
    ok(await close(cashier, { order_id: first.order_id }, 1, 7_000));
    const day1 = one('SELECT business_date FROM orders WHERE order_id = ?', first.order_id) as string;
    hubEvents([{ stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, event_type: 'BusinessDayClosed', payload: {} }]);
    const noon = new Date(`${day1}T12:00:00`);
    noon.setDate(noon.getDate() + 1);
    hub.clock.set(noon.getTime());
    openDay(hub, { menu: menu(billingDoc()), stock: { [FX.stock]: 1_000_000, [VX.naanStock]: 1_000 } });
    manager = signIn(hub, STAFF.manager);
    cashier = signIn(hub, STAFF.cashier);
    const second = appendOrder(hub, { order_type: 'parking', placed_by: STAFF.orderTaker, car_number: 'LEB 9', lines: [{ order_item_id: 'PH2_N', item_id: FX.naan }] });
    const bill_id = billOfOrder(first.order_id);
    const r = ok(await reopen(manager, { bill_id, reason_code: 'price_error' }));
    expect(r.result!['reopened']).toMatchObject({ mode: 'corrections' });
    expect(r.events[0]!.payload['order_ids']).toEqual([first.order_id]);
    // the day-2 order opens its own bill (bill_key with day 2's date)
    ok(await pay(cashier, { order_id: second.order_id }, 1, 'cash', 3_500));
    expect(one('SELECT COUNT(*) FROM bills')).toBe(2);
    expect(one('SELECT bill_key FROM orders WHERE order_id = ?', second.order_id)).not.toBe(one('SELECT bill_key FROM orders WHERE order_id = ?', first.order_id));
  });

  it('[05 #37b] after a full-edit reopen of a CLOSED dine-in bill the holder’s SubmitOrder passes the lock and joins the bill; the re-close writes BillClosed', async () => {
    await start();
    const s = seated(2);
    ok(await pay(cashier, { seating_id: s.seating_id }, 1, 'cash', 7_000));
    ok(await close(cashier, { seating_id: s.seating_id }, 1, 7_000));
    const bill_id = billOfSeating(s.seating_id);
    ok(await reopen(manager, { bill_id, reason_code: 'wrong_item_billed' }));
    expect(['ORDERED', 'FOOD_ON_TABLE']).toContain(one('SELECT state FROM seatings WHERE seating_id = ?', s.seating_id));
    const sub = ok(await post(hub, taker, 'submit-order', 'SubmitOrder', { order_id: 'O_37B', order_type: 'dine_in', table_id: s.table_id, seating_id: s.seating_id, lines: [{ order_item_id: 'O37B_N', item_id: FX.naan, quantity: 1 }] }));
    expect(typesOf(sub)).toContain('OrderPlaced');
    // Rs 90.00 + 14.40 → Rs 104.00; Rs 70.00 paid
    ok(await pay(cashier, { bill_id }, 1, 'cash', 3_400));
    const re = ok(await close(cashier, { bill_id }, 1, 10_400));
    expect(typesOf(re)).toContain('BillClosed');
    expect(one('SELECT state FROM seatings WHERE seating_id = ?', s.seating_id)).toBe('NEEDS_CLEANING');
  });

  it('[05 #37d] races: reopen then CleanTable → TABLE_HAS_OPEN_ORDERS; reopen then OpenTable re-enters the reopened seating, a stale seating_id → TABLE_SEATING_CHANGED', async () => {
    await start();
    const s = seated(2);
    ok(await pay(cashier, { seating_id: s.seating_id }, 1, 'cash', 7_000));
    ok(await close(cashier, { seating_id: s.seating_id }, 1, 7_000));
    ok(await reopen(manager, { bill_id: billOfSeating(s.seating_id), reason_code: 'wrong_item_billed' }));
    const clean = await post(hub, taker, 'clean-table', 'CleanTable', { table_id: s.table_id, seating_id: s.seating_id });
    expect([clean.status, clean.error?.code]).toEqual([409, 'TABLE_HAS_OPEN_ORDERS']);
    const reenter = ok(await post(hub, taker, 'open-table', 'OpenTable', { table_id: s.table_id, seating_id: s.seating_id }));
    expect(JSON.stringify(reenter.result)).toContain(s.seating_id);
    const stale = await post(hub, taker, 'open-table', 'OpenTable', { table_id: s.table_id, seating_id: 'SEAT_STALE' });
    expect([stale.status, stale.error?.code]).toEqual([409, 'TABLE_SEATING_CHANGED']);
  });

  it('[05 #37f, S-9 (b), §6.4a] reopen of the first bill while the S-9 new bill is open on the uncleaned seating → corrections; TableMarksChanged (no SeatingReopened); the two bills never share an order', async () => {
    await start();
    const s = seated(2);
    ok(await pay(cashier, { seating_id: s.seating_id }, 1, 'cash', 7_000));
    ok(await close(cashier, { seating_id: s.seating_id }, 1, 7_000));
    const first = billOfSeating(s.seating_id);
    const next = appendOrder(hub, { order_type: 'dine_in', seating_id: s.seating_id, placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'S9F_N', item_id: FX.naan }] });
    ok(await pay(cashier, { order_id: next.order_id }, 1, 'cash', 1_000)); // the new bill gets its row
    expect(one('SELECT state FROM seatings WHERE seating_id = ?', s.seating_id)).not.toBe('CLOSED');
    const r = ok(await reopen(manager, { bill_id: first, reason_code: 'price_error' }));
    expect(r.result!['reopened']).toMatchObject({ mode: 'corrections' });
    expect(typesOf(r)).toEqual(['BillReopened', 'InvoiceCredited', 'OrdersUnbilled', 'TableMarksChanged']);
    expect(r.events[3]).toMatchObject({ stream_type: 'table', stream_id: s.table_id, payload: { seating_id: s.seating_id } });
    expect(r.events[0]!.payload['order_ids']).toEqual([s.order_id]);
    const shared = one('SELECT COUNT(*) FROM bill_orders a JOIN bill_orders b ON a.order_id = b.order_id AND a.bill_id <> b.bill_id');
    expect(shared).toBe(0);
    expect(one('SELECT COUNT(*) FROM bills WHERE seating_id = ? AND state <> ?', s.seating_id, 'closed')).toBe(2);
  });

  it('[05 #43, B19, Q-3] a bill closed with a buyer CNIC, reopened: the credit note job carries the last 4 only; the full ID is nowhere but invoice_buyers', async () => {
    await start();
    const cnic = '3520212345671';
    BUYER_IDS.add(cnic);
    BUYER_IDS.add('35202-1234567-1');
    const o = takeaway(2, 'PV');
    ok(await pay(cashier, { order_id: o.order_id }, 1, 'cash', 7_000));
    const sale = ok(await post(hub, cashier, 'close-split', 'CloseSplit', { bill_ref: { order_id: o.order_id }, split_no: 1, expected_total_minor: 7_000, buyer: { name: 'Buyer PV', tax_id: { type: 'CNIC', value: '35202-1234567-1' } } }));
    const r = ok(await reopen(manager, { bill_id: billOfOrder(o.order_id), reason_code: 'price_error' }));
    const credit_id = ofType(r, 'InvoiceCredited')[0]!.payload['invoice_id'] as string;
    expect(ofType(r, 'InvoiceCredited')[0]!.payload).toMatchObject({ has_buyer_id: true, buyer_id_refused: false, ref_invoice_id: invoiceIdOf(sale) });
    const job = ok(await post(hub, cashier, 'print-bill-document', 'PrintBillDocument', { doc: 'credit_note', ref_id: credit_id }));
    expect(job.result).toMatchObject({ printed: true, job_id: expect.any(String) });
    const payload = one('SELECT payload FROM print_jobs WHERE job_id = ?', job.result!['job_id']) as string;
    expect(payload).toContain('5671');
    expect(payload).not.toContain(cnic);
    expect(db().prepare('SELECT id_value FROM invoice_buyers').pluck().all()).toEqual([cnic]);
  });
});

describe('[05 §6.9, R-73 (owner ruling, 05 v1.0.20)] AddPayment empty-close statements (dine-in): 8, +1 with a reference, +1 when closeMany closes open 05 requests', () => {
  const NONE_OPEN = 8;
  it('[05 R-73] no reference, no open request → 8', async () => {
    await start();
    const bill_id = await emptiedDineIn();
    expect(typesOf(ok(await pay(cashier, { bill_id }, 1, 'cash', 7_000, 'out')))).toEqual(['PaymentAdded', 'BillClosedEmpty']);
    expect(handled['add-payment']).toBe(NONE_OPEN);
  });

  it('[05 R-73] with a reference → 9', async () => {
    await start();
    const bill_id = await emptiedDineIn();
    const r = ok(await post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref: { bill_id }, split_no: 1, mode_id: 'cash', direction: 'out', amount_minor: 7_000, reference: 'REF-E9R' }));
    expect(typesOf(r)).toEqual(['PaymentAdded', 'BillClosedEmpty']);
    expect(handled['add-payment']).toBe(NONE_OPEN + 1);
  });

  it('[05 R-73] with an open 05 request closed by closeMany → 9 (+ 01d’s request_result raise)', async () => {
    await start();
    const bill_id = await emptiedDineIn();
    const waiver = raiseOnBill('close_without_buyer_id', bill_id, { bill_id, note_id: null, has_note: false }, `buyer_waiver:${bill_id}`);
    const r = ok(await pay(cashier, { bill_id }, 1, 'cash', 7_000, 'out'));
    expect(typesOf(r).slice(0, 3)).toEqual(['PaymentAdded', 'BillClosedEmpty', 'AlertClosed']);
    expect(one('SELECT state FROM alerts WHERE alert_id = ?', waiver)).toBe('closed');
    expect(handled['add-payment']).toBe(NONE_OPEN + 1 + RAISE_RESULT);
  });

  it('[05 R-73] with both → 10 (+ 01d’s request_result raise)', async () => {
    await start();
    const bill_id = await emptiedDineIn();
    raiseOnBill('close_without_buyer_id', bill_id, { bill_id, note_id: null, has_note: false }, `buyer_waiver:${bill_id}`);
    const r = ok(await post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref: { bill_id }, split_no: 1, mode_id: 'cash', direction: 'out', amount_minor: 7_000, reference: 'REF-E10' }));
    expect(typesOf(r).slice(0, 3)).toEqual(['PaymentAdded', 'BillClosedEmpty', 'AlertClosed']);
    expect(handled['add-payment']).toBe(NONE_OPEN + 2 + RAISE_RESULT);
  });
});
