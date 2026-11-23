// 05 task 3b (05-plan §3 row 3b, PL-15): the command-level halves of task 3's money tests. Spec 05 v1.0.20 §3.5 (8),
// §3.7, §3.8; §10 tests #10b, #10c, #10e, #10f, #16b and #16c (command halves), #23 (shifts half). Written by a fresh
// tester who wrote none of tasks 2, 12, 16, 17, 24. 3a's pure halves live in packages/domain/src/billing/
// compute.property.test.ts and are not repeated here.
//
// Every bill action is a real command over HTTP (`post` from ./fixtures): SubmitOrder (every round), SetSplits,
// ApplyDiscount, RemoveItems, VoidItems, CompLine, SetLineWeight, AddPayment, RemovePayment, CloseSplit, OpenShift,
// RecordPettyCash, SettlePettyAdvance, HandoverCount, CountShift. The only non-command set-up is the fixtures' seating
// (`openSeating`, 02a) and, for a void, the kitchen stage of a line (`toStage`, 03b), neither of which is billing.
// The invariants are read back from the bill view and the tables the folds wrote; the scripted scenarios use literal
// PKR amounts (exponent 2) and the seeded ones a mulberry32 PRNG in this file (no dependency).
import { rateBpRates, SnapshotBillingSchema, type BranchConfig, type SnapshotBilling } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hubBilling } from '../../src/billing/defaults';
import { noneAdapter } from '../../src/billing/fiscal/none';
import { registerFiscalAdapter, resetFiscalAdapters } from '../../src/billing/fiscal/port';
import type { BillView, BillViewSplit, Totals } from '../../src/billing/queries/bill';
import { resetLineGuard } from '../../src/orders/line-guard';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import type { TestHub } from '../helpers/test-hub';
import { appendOrder, type FixtureOrder } from '../orders/fixtures';
import { openDay, toStage, voidsMenu } from '../voids/fixtures';
import { drawerDevice, FX, openSeating, post, signIn, signInOn, STAFF, startBilling, VX, type Reply, type Who } from './fixtures';

// ------------------------------------------------------------------------------------------------ config

const FOOD = 'tc-food';
/** Rs 1,000.00 — the naan in this file (so #10f / #16b's "3 × Rs 1,000" and "Rs 2,000" are literal) */
const NAAN = 100_000;
/** Rs 1,200.00 — the karahi (fixtureMenu) */
const KARAHI = 120_000;
/** fish Rs 4,000 per kg (fixtureMenu), sold by the gram */
const FISH_PER_KG = 400_000;
/** Rs 500.00 — the raita in this file (a plain piece item) */
const RAITA = 50_000;

/** The PK built-in (rounding Rs 1 nearest on every split), food 16 % cash / 5 % card exclusive, buyer ID off. */
function billingDoc(o: { sc_bp?: number } = {}): SnapshotBilling {
  const pk = hubBilling({ currency_code: 'PKR', tax_classes: [], billing: undefined });
  return SnapshotBillingSchema.parse({
    ...pk.settings,
    payment_modes: [
      pk.settings.payment_modes[0]!,
      { mode_id: 'card', name: 'Card', kind: 'card', payment_class: 'digital', reference_required: false, is_active: true, sort_order: 1, authority_codes: [] },
    ],
    service_charge_bp: { ...pk.settings.service_charge_bp, dine_in: o.sc_bp ?? 0 },
    jurisdiction: { ...pk.jurisdiction, rules: pk.jurisdiction.rules.map((r) => ({ ...r, buyer_id: { ...r.buyer_id, threshold_minor: null } })) },
    tax_profiles: [
      {
        tax_class_id: FOOD,
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
  });
}

function menu(billing: SnapshotBilling): BranchConfig {
  const m = voidsMenu();
  return {
    ...m,
    tax_enabled: true,
    tax_classes: [{ tax_class_id: FOOD, name: 'Sales tax', rate_bp: 1_600, is_archived: false, fiscal_category: 'restaurant_service' }],
    items: m.items.map((i) =>
      i.item_id === FX.naan
        ? { ...i, price_minor: NAAN, tax_class_id: FOOD }
        : i.item_id === FX.optionItem
          ? { ...i, price_minor: RAITA, tax_class_id: FOOD }
          : i.item_id === FX.piece || i.item_id === FX.gram ? { ...i, tax_class_id: FOOD } : i,
    ),
    billing,
  };
}

// ------------------------------------------------------------------------------------------------ set-up

let hub: TestHub;
let cashier: Who;
let manager: Who;
let cashierShift: string;

beforeEach(() => {
  registerFiscalAdapter(noneAdapter);
});

afterEach(async () => {
  swapBranchConfig(null);
  resetFiscalAdapters();
  await hub?.close();
  hub = undefined as unknown as TestHub;
  resetLineGuard();
});

const FLOAT = 500_000;

async function start(o: { sc_bp?: number } = {}): Promise<void> {
  hub = await startBilling({ open: false });
  openDay(hub, { menu: menu(billingDoc(o)), stock: { [FX.stock]: 1_000_000, [VX.naanStock]: 100_000 } });
  cashier = signInOn(hub, STAFF.cashier, drawerDevice(hub, 'Kiosk A'));
  const s = await post(hub, cashier, 'open-shift', 'OpenShift', { float_minor: FLOAT, as_drawer: true });
  expect(s.status, JSON.stringify(s.error)).toBe(200);
  cashierShift = s.result!['shift_id'] as string;
  manager = signIn(hub, STAFF.manager);
}

const db = () => hub.deps.db;

async function ok(r: Promise<Reply> | Reply, what: string): Promise<Reply> {
  const reply = await r;
  expect(reply.status, `${what}: ${JSON.stringify(reply.error)}`).toBe(200);
  return reply;
}

// ------------------------------------------------------------------------------------------------ commands

type CartLine = { order_item_id: string; item_id: string; quantity?: number };

let seatNo = 0;
/** An open seating at `table_id` held by the Manager (02a fixture); every round below is a real SubmitOrder. */
function seat(table_id: string = VX.tables.T4): string {
  seatNo += 1;
  const seating_id = `SEAT_M${seatNo}`;
  openSeating(hub, { table_id, seating_id, holder_staff_id: STAFF.manager });
  tableOf.set(seating_id, table_id);
  return seating_id;
}
const tableOf = new Map<string, string>();

let orderNo = 0;
/**
 * One dine-in round; returns the order_id. ⚠️ 02b v1.0.20 §3.2 step 4a (STAB-5): these money rules are about units
 * *inside one line* (split 1 of B's units, void 1 of 3, comp a unit) — lines that stay multi-unit (batch stations,
 * weighed items). SubmitOrder now sends a slot-station line of quantity n as n parts, so the rounds are written with
 * 02b's fixture (`appendOrder`: the same events through the hub's writer, as ./fixtures does); every bill action
 * stays a real command. Split lines on a bill are 05's own tests (STAB-5 phase 6).
 */
async function round(seating_id: string, lines: CartLine[]): Promise<string> {
  orderNo += 1;
  const order_id = `O_M${orderNo}`;
  appendOrder(hub, {
    order_id,
    order_type: 'dine_in',
    seating_id,
    placed_by: STAFF.manager,
    lines: lines.map((l) => ({ quantity: 1, ...l })) as FixtureOrder['lines'],
  });
  orderOf.set(order_id, seating_id);
  for (const l of lines) lineOrder.set(l.order_item_id, order_id);
  return order_id;
}
const orderOf = new Map<string, string>();
const lineOrder = new Map<string, string>();

const setSplits = (seating_id: string, payload: Record<string, unknown>) => post(hub, cashier, 'set-splits', 'SetSplits', { bill_ref: { seating_id }, ...payload });
const discount = (seating_id: string, pct_bp: number) =>
  post(hub, manager, 'apply-discount', 'ApplyDiscount', { bill_ref: { seating_id }, kind: 'percent', value: pct_bp, reason_code: 'regular_customer' });
const removeUnits = (seating_id: string, order_item_id: string, units: number) =>
  post(hub, manager, 'remove-items', 'RemoveItems', { order_id: lineOrder.get(order_item_id), seating_id, lines: [{ order_item_id, units }] });
const voidUnits = (order_item_id: string, units: number) =>
  post(hub, manager, 'void-items', 'VoidItems', {
    order_id: lineOrder.get(order_item_id),
    reason_code: 'customer_changed_mind',
    note: null,
    disposition_note: null,
    lines: [{ order_item_id, units, disposition: 'wastage' }],
  });
const comp = (order_item_id: string, units: number) => post(hub, manager, 'comp-line', 'CompLine', { order_item_id, units, reason_code: 'quality' });
const pay = (who: Who, seating_id: string, split_no: number, mode_id: 'cash' | 'card', amount_minor: number, tendered_minor?: number) =>
  post(hub, who, 'add-payment', 'AddPayment', {
    bill_ref: { seating_id },
    split_no,
    mode_id,
    direction: 'in',
    amount_minor,
    ...(tendered_minor === undefined ? {} : { tendered_minor }),
  });
const closeSplit = (who: Who, seating_id: string, split_no: number, expected_total_minor: number) =>
  post(hub, who, 'close-split', 'CloseSplit', { bill_ref: { seating_id }, split_no, expected_total_minor });

async function view(seating_id: string): Promise<BillView> {
  const res = await hub.app.inject({
    method: 'GET',
    url: `/queries/bill?seating_id=${seating_id}`,
    headers: { authorization: `Bearer ${cashier.token}`, 'x-session-token': cashier.sessionToken },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: BillView }).data;
}
const splitOf = (v: BillView, split_no: number): BillViewSplit => {
  const s = v.splits.find((x) => x.split_no === split_no);
  if (s === undefined) throw new Error(`no split ${split_no} in ${JSON.stringify(v.splits.map((x) => x.split_no))}`);
  return s;
};

/**
 * Pays `split_no` in full and closes it. `how`: all cash (tendered rounded up to the next Rs 500 note), all card, or
 * a Rs 100 card part then cash for the rest (the split turns mixed → cash rates, §3.5 (5)). Returns the invoice total.
 */
async function payAndClose(seating_id: string, split_no: number, how: 'cash' | 'card' | 'mixed', who: Who = cashier): Promise<number> {
  const s = splitOf(await view(seating_id), split_no);
  expect(s.state).toBe('open');
  if (how === 'card') await ok(pay(who, seating_id, split_no, 'card', s.totals.digital.total_minor - paidOf(s)), 'card in');
  else {
    if (how === 'mixed') await ok(pay(who, seating_id, split_no, 'card', 10_000), 'card part');
    const due = splitOf(await view(seating_id), split_no).totals.cash.total_minor - paidOf(splitOf(await view(seating_id), split_no));
    await ok(pay(who, seating_id, split_no, 'cash', due, Math.ceil(due / 50_000) * 50_000), 'cash in');
  }
  const after = splitOf(await view(seating_id), split_no);
  expect(after.balance_minor, `split ${split_no} balance after paying`).toBe(0);
  const c = await ok(closeSplit(who, seating_id, split_no, after.totals.as_paid.total_minor), `CloseSplit ${split_no}`);
  expect(c.result!['total_minor']).toBe(after.totals.as_paid.total_minor);
  return c.result!['total_minor'] as number;
}
const paidOf = (s: BillViewSplit) => s.payments.reduce((a, p) => a + (p.direction === 'in' ? p.amount_minor : -p.amount_minor), 0);

// ------------------------------------------------------------------------------------------------ invariants

const billIdOf = (seating_id: string) =>
  db().prepare(`SELECT bill_id FROM bills WHERE seating_id = ? AND absorbed_into IS NULL ORDER BY opened_at DESC LIMIT 1`).pluck().get(seating_id) as string;
const liveUnits = (order_item_id: string) =>
  db().prepare('SELECT units - removed_units - voided_units FROM order_lines WHERE order_item_id = ?').pluck().get(order_item_id) as number;
const closedUnits = (bill_id: string) =>
  db().prepare('SELECT split_no, order_item_id, units, share_minor FROM closed_split_units WHERE bill_id = ? ORDER BY split_no, order_item_id').all(bill_id) as Array<{
    split_no: number;
    order_item_id: string;
    units: number;
    share_minor: number;
  }>;
interface InvoiceRow {
  invoice_id: string;
  split_no: number;
  subtotal_minor: number;
  discount_minor: number;
  service_charge_minor: number;
  tax_minor: number;
  rounding_minor: number;
  total_minor: number;
  change_minor: number;
  payment_class: string;
  doc_json: string;
}
const invoicesOf = (bill_id: string) =>
  db()
    .prepare(
      `SELECT invoice_id, split_no, subtotal_minor, discount_minor, service_charge_minor, tax_minor, rounding_minor, total_minor, change_minor, payment_class, doc_json
         FROM invoices WHERE bill_id = ? AND series = 'sale' AND credited_by IS NULL ORDER BY split_no`,
    )
    .all(bill_id) as InvoiceRow[];

/** What a closed split looked like when it closed: the invoice row and its closed_split_units rows. */
type Frozen = Map<number, { invoice: InvoiceRow; units: Array<{ order_item_id: string; units: number; share_minor: number }> }>;

function freeze(bill_id: string, frozen: Frozen): void {
  const units = closedUnits(bill_id);
  for (const inv of invoicesOf(bill_id)) {
    if (frozen.has(inv.split_no)) continue;
    frozen.set(inv.split_no, { invoice: inv, units: units.filter((u) => u.split_no === inv.split_no).map((u) => ({ order_item_id: u.order_item_id, units: u.units, share_minor: u.share_minor })) });
  }
}

const sumBasesOf = (v: BillView) => v.lines.reduce((a, l) => a + l.base_minor, 0);
const identity = (t: Totals) => t.subtotal_minor - t.discount_minor + t.service_charge_minor + t.taxes.reduce((a, x) => a + x.tax_minor, 0) + t.rounding_minor;

/**
 * The §3.5 (8) / §3.8 money invariants on one bill, from the bill view and the folded tables:
 * (a) every closed split's invoice and invoiced units are what they were at its close (#10b);
 * (b) item mode: Σ closed units + Σ open-plan units = the line's live units, per line; no negative entry (#10b, #10e);
 * (c) Σ closed shares + open base = the line's base (#10f), via Σ split subtotals = Σ line bases (§3.5 (8));
 * (d) every split: total = S − D + SC + Σ tax + R, D ≤ S, nothing negative; an invoice's tax = Σ its tax rows;
 * (e) every closed split: Σ in − Σ out of its payments = the invoice total; its change = Σ (tendered − amount) (#23).
 */
function checkBill(v: BillView, frozen: Frozen, label: string): void {
  const bill_id = v.bill_id!;
  const ctx = (m: string) => `${label}: ${m}`;
  // (a)
  freeze(bill_id, frozen);
  const nowInv = new Map(invoicesOf(bill_id).map((i) => [i.split_no, i]));
  const nowUnits = closedUnits(bill_id);
  for (const [split_no, f] of frozen) {
    expect(nowInv.get(split_no), ctx(`invoice of closed split ${split_no} unchanged`)).toEqual(f.invoice);
    expect(
      nowUnits.filter((u) => u.split_no === split_no).map((u) => ({ order_item_id: u.order_item_id, units: u.units, share_minor: u.share_minor })),
      ctx(`closed_split_units of split ${split_no} unchanged`),
    ).toEqual(f.units);
    expect(splitOf(v, split_no).state, ctx(`split ${split_no} still closed`)).toBe('closed');
  }
  // (b) item mode
  const closedByLine = new Map<string, number>();
  for (const u of nowUnits) closedByLine.set(u.order_item_id, (closedByLine.get(u.order_item_id) ?? 0) + u.units);
  const itemMode = v.splits.some((s) => s.plan !== null && 'lines' in s.plan);
  if (itemMode) {
    const openByLine = new Map<string, number>();
    for (const s of v.splits.filter((x) => x.state === 'open')) {
      const plan = s.plan as { lines: Array<{ order_item_id: string; units: number }> };
      for (const l of plan.lines) {
        expect(l.units, ctx(`open plan units of ${l.order_item_id} in split ${s.split_no} > 0`)).toBeGreaterThan(0);
        openByLine.set(l.order_item_id, (openByLine.get(l.order_item_id) ?? 0) + l.units);
      }
    }
    // §3.8: a live unit in no plan row (a later round) belongs to the highest-numbered open split, which compute adds
    // at read time (the stored rows are the staff's plan, §6.1 `plan` "as the fold stores it"); so closed + planned ≤ live
    for (const line of v.lines) {
      const live = liveUnits(line.order_item_id);
      expect(line.units, ctx(`view units of ${line.order_item_id} = live units`)).toBe(live);
      expect((closedByLine.get(line.order_item_id) ?? 0) + (openByLine.get(line.order_item_id) ?? 0), ctx(`Σ closed + planned units of ${line.order_item_id} ≤ live ${live} (no unit in two splits)`)).toBeLessThanOrEqual(live);
    }
    for (const id of openByLine.keys()) expect(v.lines.some((l) => l.order_item_id === id), ctx(`plan line ${id} is a bill line`)).toBe(true);
  }
  // (c) Σ split S = Σ line bases (closed splits by their invoice subtotal)
  const sumS = v.splits.reduce((a, s) => a + (s.state === 'closed' ? nowInv.get(s.split_no)!.subtotal_minor : s.totals.as_paid.subtotal_minor), 0);
  const sumBases = v.lines.reduce((a, l) => a + l.base_minor, 0);
  expect(sumS, ctx('Σ split subtotals = Σ line bases')).toBe(sumBases);
  for (const line of v.lines) {
    const closedShare = nowUnits.filter((u) => u.order_item_id === line.order_item_id).reduce((a, u) => a + u.share_minor, 0);
    expect(closedShare, ctx(`Σ closed shares of ${line.order_item_id} ≤ its base`)).toBeLessThanOrEqual(line.base_minor);
  }
  // (f) the frozen discount (B7 R3, H2-8, §3.5 (2)): before any close Σ D = floor(Σ bases × pct); after, the open D =
  // min(frozen − Σ closed D, the open base of the bill_discount_lines still on the bill); lines added later carry none
  if (v.discount !== null && v.discount.kind === 'percent') {
    const openD = v.splits.filter((s) => s.state === 'open').reduce((a, s) => a + s.totals.as_paid.discount_minor, 0);
    if (v.discount.frozen_minor === null) {
      expect(openD, ctx('Σ D = floor(Σ bases × pct)')).toBe(Math.floor((sumBasesOf(v) * v.discount.value) / 10_000));
    } else {
      const eligible = new Set(db().prepare('SELECT order_item_id FROM bill_discount_lines WHERE bill_id = ?').pluck().all(bill_id) as string[]);
      const openBase = v.lines
        .filter((l) => eligible.has(l.order_item_id))
        .reduce((a, l) => a + l.base_minor - nowUnits.filter((u) => u.order_item_id === l.order_item_id).reduce((x, u) => x + u.share_minor, 0), 0);
      const closedD = [...nowInv.values()].reduce((a, i) => a + i.discount_minor, 0);
      expect(openD, ctx('open D = min(frozen − Σ closed D, eligible open base)')).toBe(Math.max(0, Math.min(v.discount.frozen_minor - closedD, openBase)));
      for (const l of v.lines.filter((x) => !eligible.has(x.order_item_id))) expect(l.added_after_close, ctx(`${l.order_item_id} joined after the first close`)).toBe(true);
    }
  }
  // (d)
  for (const s of v.splits) {
    for (const [k, t] of Object.entries(s.totals) as Array<[string, Totals]>) {
      expect(t.total_minor, ctx(`split ${s.split_no} ${k}: T = S − D + SC + Σ tax + R`)).toBe(identity(t));
      expect(t.discount_minor, ctx(`split ${s.split_no} ${k}: 0 ≤ D ≤ S`)).toBeLessThanOrEqual(t.subtotal_minor);
      for (const n of [t.subtotal_minor, t.discount_minor, t.service_charge_minor, t.total_minor, ...t.taxes.map((x) => x.tax_minor), ...t.taxes.map((x) => x.base_minor)])
        expect(n, ctx(`split ${s.split_no} ${k}: no negative figure`)).toBeGreaterThanOrEqual(0);
    }
    expect(s.balance_minor, ctx(`split ${s.split_no} balance = T − paid`)).toBe(s.totals.as_paid.total_minor - paidOf(s));
  }
  for (const inv of nowInv.values()) {
    const rows = db().prepare('SELECT COALESCE(SUM(tax_minor), 0) FROM invoice_taxes WHERE invoice_id = ?').pluck().get(inv.invoice_id) as number;
    expect(inv.tax_minor, ctx(`invoice ${inv.split_no}: tax = Σ tax rows`)).toBe(rows);
    expect(inv.total_minor, ctx(`invoice ${inv.split_no}: T = S − D + SC + tax + R`)).toBe(
      inv.subtotal_minor - inv.discount_minor + inv.service_charge_minor + inv.tax_minor + inv.rounding_minor,
    );
    // (e)
    const pays = db().prepare('SELECT direction, amount_minor, tendered_minor FROM bill_payments WHERE invoice_id = ? AND removed_at IS NULL').all(inv.invoice_id) as Array<{
      direction: string;
      amount_minor: number;
      tendered_minor: number | null;
    }>;
    expect(pays.reduce((a, p) => a + (p.direction === 'in' ? p.amount_minor : -p.amount_minor), 0), ctx(`invoice ${inv.split_no}: Σ in − Σ out = total`)).toBe(inv.total_minor);
    expect(inv.change_minor, ctx(`invoice ${inv.split_no}: change = Σ (tendered − amount)`)).toBe(pays.reduce((a, p) => a + (p.tendered_minor === null ? 0 : p.tendered_minor - p.amount_minor), 0));
  }
}

// ================================================================================================= #10c

describe('[05 #10c] a round after split 1 closed joins the highest-numbered open split; the last close closes the bill; a later order opens a new bill', () => {
  it('[05 #10c, §3.8] item split {K, N} | {K, N, N}; split 1 closes; round 2 (2 naans) joins split 2 with no SetSplits and no block; split 2 closes → CLOSED; round 3 → a new bill with its own BillOpened', async () => {
    await start();
    const seating_id = seat();
    await round(seating_id, [
      { order_item_id: 'C_K', item_id: FX.piece, quantity: 2 },
      { order_item_id: 'C_N', item_id: FX.naan, quantity: 3 },
    ]);
    await ok(
      setSplits(seating_id, {
        mode: 'items',
        splits: [
          { split_no: 1, lines: [{ order_item_id: 'C_K', units: 1 }, { order_item_id: 'C_N', units: 1 }] },
          { split_no: 2, lines: [{ order_item_id: 'C_K', units: 1 }, { order_item_id: 'C_N', units: 2 }] },
        ],
      }),
      'SetSplits',
    );
    const frozen: Frozen = new Map();
    // split 1: 1,200 + 1,000 = 2,200.00 net, cash 16 % = 352.00 → 2,552.00
    expect(splitOf(await view(seating_id), 1).totals.cash.total_minor).toBe(255_200);
    expect(await payAndClose(seating_id, 1, 'cash')).toBe(255_200);
    const bill_id = billIdOf(seating_id);
    checkBill(await view(seating_id), frozen, 'after split 1');

    await round(seating_id, [{ order_item_id: 'C2_N', item_id: FX.naan, quantity: 2 }]);
    const v = await view(seating_id);
    expect(v.bill_id).toBe(bill_id);
    // the stored plan is unchanged (no staff action); C2_N is in no row, so it is the highest open split's (§3.8)
    expect(splitOf(v, 2).plan).toEqual({ lines: [{ order_item_id: 'C_K', units: 1 }, { order_item_id: 'C_N', units: 2 }] });
    expect(splitOf(v, 2).totals.cash.subtotal_minor).toBe(KARAHI + 4 * NAAN);
    // no close block from the new round: only the unpaid balance (§3.3 rule 8) until it is paid
    expect(v.blocks).toEqual([{ reason: 'balance_due', split_no: 2, details: { split_no: 2, balance_minor: 603_200 } }]);
    expect(v.lines.find((l) => l.order_item_id === 'C2_N')!.added_after_close).toBe(true);
    // split 2: 1,200 + 2,000 + 2,000 = 5,200.00 net, card 5 % = 260.00 → 5,460.00
    expect(splitOf(v, 2).totals.digital.total_minor).toBe(546_000);
    checkBill(v, frozen, 'after round 2');

    expect(await payAndClose(seating_id, 2, 'card')).toBe(546_000);
    checkBill(await view(seating_id), frozen, 'after split 2');
    expect(db().prepare('SELECT state FROM bills WHERE bill_id = ?').pluck().get(bill_id)).toBe('closed');
    expect(db().prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'BillClosed'`).pluck().get()).toBe(1);

    // S-9 (b), row T-3: an order after close (before CleanTable) is accepted and opens a new bill
    const before = db().prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'BillOpened'`).pluck().get() as number;
    await round(seating_id, [{ order_item_id: 'C3_N', item_id: FX.naan }]);
    const next = await view(seating_id);
    expect(next.state).not.toBe('closed');
    expect(next.lines.map((l) => l.order_item_id)).toEqual(['C3_N']);
    // the new bill opens on its first 05 write: a payment
    await payAndClose(seating_id, 1, 'cash');
    const opened = db().prepare(`SELECT payload FROM events WHERE event_type = 'BillOpened' ORDER BY seq`).pluck().all() as string[];
    expect(opened).toHaveLength(before + 1);
    const newBill = (JSON.parse(opened.at(-1)!) as { bill_id: string }).bill_id;
    expect(newBill).not.toBe(bill_id);
    expect(db().prepare('SELECT state FROM bills WHERE bill_id = ?').pluck().get(bill_id)).toBe('closed');
    expect(invoicesOf(bill_id).map((i) => i.total_minor)).toEqual([255_200, 546_000]);
    expect(invoicesOf(newBill).map((i) => i.total_minor)).toEqual([116_000]);
  });
});

// ================================================================================================= #10e

const closedErr = (order_item_id: string, bill_id: string, split_no = 1) => ({ code: 'LINE_IN_CLOSED_SPLIT', details: { order_item_id, bill_id, split_no } });
const planOf = (v: BillView, split_no: number) => (splitOf(v, split_no).plan as { lines: Array<{ order_item_id: string; units: number }> }).lines;

describe('[05 #10e] a unit leaving the bill comes off the highest-numbered open split holding the line', () => {
  it('[05 #10e, §3.8, H1-6] {B: 1} closed in split 1, {B: 2} open in split 2: a 1-unit void → from split 2 ({B: 1}); a further void → LINE_IN_CLOSED_SPLIT; Σ closed + open = live after each', async () => {
    await start();
    const seating_id = seat();
    const order_id = await round(seating_id, [{ order_item_id: 'E_B', item_id: FX.naan, quantity: 3 }]);
    toStage(hub, order_id, ['E_B'], 'cooking'); // a void needs a started line (04)
    await ok(
      setSplits(seating_id, {
        mode: 'items',
        splits: [
          { split_no: 1, lines: [{ order_item_id: 'E_B', units: 1 }] },
          { split_no: 2, lines: [{ order_item_id: 'E_B', units: 2 }] },
        ],
      }),
      'SetSplits',
    );
    const frozen: Frozen = new Map();
    expect(await payAndClose(seating_id, 1, 'cash')).toBe(116_000); // 1,000 + 16 %
    const bill_id = billIdOf(seating_id);
    checkBill(await view(seating_id), frozen, 'after close');

    await ok(voidUnits('E_B', 1), 'void 1');
    let v = await view(seating_id);
    expect(planOf(v, 2)).toEqual([{ order_item_id: 'E_B', units: 1 }]);
    expect(liveUnits('E_B')).toBe(2);
    expect(splitOf(v, 2).totals.cash.total_minor).toBe(116_000);
    checkBill(v, frozen, 'after 1-unit void');

    const two = await voidUnits('E_B', 2); // units_after 0 < closed 1
    expect(two.status).toBe(409);
    expect(two.error).toEqual(closedErr('E_B', bill_id));
    v = await view(seating_id);
    expect(planOf(v, 2)).toEqual([{ order_item_id: 'E_B', units: 1 }]);
    checkBill(v, frozen, 'after the refused void');
    expect(await payAndClose(seating_id, 2, 'card')).toBe(105_000); // 1,000 + 5 %
    checkBill(await view(seating_id), frozen, 'after split 2');
  });

  it('[05 #10e, §3.8] three splits {B: 1, K: 0} | {B: 1, K: 1} | {B: 1, K: 1}, split 1 closed: RemoveItems B 1 → off split 3; again → off split 2; a third → refused; money follows', async () => {
    await start();
    const seating_id = seat();
    await round(seating_id, [
      { order_item_id: 'H_B', item_id: FX.naan, quantity: 3 },
      { order_item_id: 'H_K', item_id: FX.piece, quantity: 2 },
    ]);
    await ok(
      setSplits(seating_id, {
        mode: 'items',
        splits: [
          { split_no: 1, lines: [{ order_item_id: 'H_B', units: 1 }] },
          { split_no: 2, lines: [{ order_item_id: 'H_B', units: 1 }, { order_item_id: 'H_K', units: 1 }] },
          { split_no: 3, lines: [{ order_item_id: 'H_B', units: 1 }, { order_item_id: 'H_K', units: 1 }] },
        ],
      }),
      'SetSplits',
    );
    const frozen: Frozen = new Map();
    await payAndClose(seating_id, 1, 'mixed');
    const bill_id = billIdOf(seating_id);
    checkBill(await view(seating_id), frozen, 'after close');

    await ok(removeUnits(seating_id, 'H_B', 1), 'remove 1');
    let v = await view(seating_id);
    expect(planOf(v, 3)).toEqual([{ order_item_id: 'H_K', units: 1 }]);
    expect(planOf(v, 2)).toEqual([{ order_item_id: 'H_B', units: 1 }, { order_item_id: 'H_K', units: 1 }]);
    expect(splitOf(v, 3).totals.cash.subtotal_minor).toBe(KARAHI);
    expect(splitOf(v, 2).totals.cash.subtotal_minor).toBe(KARAHI + NAAN);
    checkBill(v, frozen, 'after remove 1');

    await ok(removeUnits(seating_id, 'H_B', 1), 'remove 2');
    v = await view(seating_id);
    expect(planOf(v, 2)).toEqual([{ order_item_id: 'H_K', units: 1 }]);
    expect(planOf(v, 3)).toEqual([{ order_item_id: 'H_K', units: 1 }]);
    checkBill(v, frozen, 'after remove 2');

    const third = await removeUnits(seating_id, 'H_B', 1);
    expect(third.status).toBe(409);
    expect(third.error).toEqual(closedErr('H_B', bill_id));
    expect(liveUnits('H_B')).toBe(1);
    expect(await payAndClose(seating_id, 3, 'card')).toBe(126_000); // 1,200 + 5 %
    expect(await payAndClose(seating_id, 2, 'cash')).toBe(139_200); // 1,200 + 16 %
    checkBill(await view(seating_id), frozen, 'all closed');
    expect(db().prepare('SELECT state FROM bills WHERE bill_id = ?').pluck().get(bill_id)).toBe('closed');
  });
});

// ================================================================================================= #10f

describe('[05 #10f] LINE_IN_CLOSED_SPLIT residuals: Σ closed shares + open base = line base after every step', () => {
  /** line B's base on the bill view, its closed share and its open base (= its money in the open splits) */
  async function lineMoney(seating_id: string, line: string, otherOpenSubtotal: number, openSplit: number) {
    const v = await view(seating_id);
    const base = v.lines.find((l) => l.order_item_id === line)!.base_minor;
    const closed = closedUnits(v.bill_id!).filter((u) => u.order_item_id === line).reduce((a, u) => a + u.share_minor, 0);
    const open = splitOf(v, openSplit).totals.cash.subtotal_minor - otherOpenSubtotal;
    return { v, base, closed, open };
  }

  it('[05 #10f, H3-4] 3 × Rs 1,000, comp 1 before an item-split close (split 1 = 1 unit, share 666), then VoidItems 2 units → LINE_IN_CLOSED_SPLIT (residual 334 on 0 open units)', async () => {
    await start();
    const seating_id = seat();
    const order_id = await round(seating_id, [
      { order_item_id: 'F_B', item_id: FX.naan, quantity: 3 },
      { order_item_id: 'F_K', item_id: FX.piece },
    ]);
    toStage(hub, order_id, ['F_B'], 'cooking');
    await ok(comp('F_B', 1), 'comp 1');
    await ok(
      setSplits(seating_id, {
        mode: 'items',
        splits: [
          { split_no: 1, lines: [{ order_item_id: 'F_B', units: 1 }] },
          { split_no: 2, lines: [{ order_item_id: 'F_B', units: 2 }, { order_item_id: 'F_K', units: 1 }] },
        ],
      }),
      'SetSplits',
    );
    const frozen: Frozen = new Map();
    // the comped line's base 2,000.00 over 3 units: split 1 gets 666.66 (allocateDealMinor), split 2 the 1,333.34
    let m = await lineMoney(seating_id, 'F_B', KARAHI, 2);
    expect(m.base).toBe(200_000);
    expect(splitOf(m.v, 1).totals.cash.subtotal_minor).toBe(66_666);
    expect(m.open).toBe(133_334);
    await payAndClose(seating_id, 1, 'cash');
    const bill_id = billIdOf(seating_id);
    m = await lineMoney(seating_id, 'F_B', KARAHI, 2);
    expect(closedUnits(bill_id)).toEqual([{ split_no: 1, order_item_id: 'F_B', units: 1, share_minor: 66_666 }]);
    expect(m.closed + m.open).toBe(m.base);
    checkBill(m.v, frozen, 'after close');

    const r = await voidUnits('F_B', 2); // units_after 1 = closed 1, open base 2,000 − 666.66 − refund ≠ 0 → residual
    expect(r.status).toBe(409);
    expect(r.error).toEqual(closedErr('F_B', bill_id));
    expect(liveUnits('F_B')).toBe(3);
    m = await lineMoney(seating_id, 'F_B', KARAHI, 2);
    expect(m.closed + m.open).toBe(m.base);
    checkBill(m.v, frozen, 'after the refused void');
  });

  it('[05 #10f, H2-2] B 3 × Rs 1,000, 1 unit closed: comp 1 open unit → open part 1,000 (not 1,333); comp 3 → refused; a weight change on a closed-unit line → refused', async () => {
    await start();
    const seating_id = seat();
    await round(seating_id, [
      { order_item_id: 'G_B', item_id: FX.naan, quantity: 3 },
      { order_item_id: 'G_F', item_id: FX.gram, quantity: 250 }, // fish 250 g = Rs 1,000
      { order_item_id: 'G_K', item_id: FX.piece },
    ]);
    await ok(
      setSplits(seating_id, {
        mode: 'items',
        splits: [
          { split_no: 1, lines: [{ order_item_id: 'G_B', units: 1 }, { order_item_id: 'G_F', units: 1 }] },
          { split_no: 2, lines: [{ order_item_id: 'G_B', units: 2 }, { order_item_id: 'G_K', units: 1 }] },
        ],
      }),
      'SetSplits',
    );
    const frozen: Frozen = new Map();
    expect(splitOf(await view(seating_id), 1).totals.cash.subtotal_minor).toBe(NAAN + FISH_PER_KG / 4);
    await payAndClose(seating_id, 1, 'card');
    const bill_id = billIdOf(seating_id);
    let m = await lineMoney(seating_id, 'G_B', KARAHI, 2);
    expect([m.base, m.closed, m.open]).toEqual([300_000, 100_000, 200_000]);
    checkBill(m.v, frozen, 'after close');

    await ok(comp('G_B', 1), 'comp 1 open unit');
    m = await lineMoney(seating_id, 'G_B', KARAHI, 2);
    expect([m.base, m.closed, m.open]).toEqual([200_000, 100_000, 100_000]);
    checkBill(m.v, frozen, 'after comp 1');

    const c3 = await comp('G_B', 2); // comped_after 3 > units_after 3 − closed 1
    expect(c3.status).toBe(409);
    expect(c3.error).toEqual(closedErr('G_B', bill_id));
    const w = await post(hub, manager, 'set-line-weight', 'SetLineWeight', { order_item_id: 'G_F', quantity: 300 });
    expect(w.status).toBe(409);
    expect(w.error).toEqual(closedErr('G_F', bill_id));
    m = await lineMoney(seating_id, 'G_B', KARAHI, 2);
    expect([m.base, m.closed, m.open]).toEqual([200_000, 100_000, 100_000]);
    checkBill(m.v, frozen, 'after the refusals');
    // split 2: 1,000 (B's open part) + 1,200 = 2,200.00, cash 16 % → 2,552.00
    expect(await payAndClose(seating_id, 2, 'cash')).toBe(255_200);
    checkBill(await view(seating_id), frozen, 'all closed');
  });
});

// ================================================================================================= #16b / #16c

describe('[05 #16b, #16c] the frozen discount after a close (B7 R3, H2-8), through commands', () => {
  async function twoSplitDiscount(o: { b: CartLine; pct_bp: number }): Promise<{ seating_id: string; order_id: string; frozen: Frozen }> {
    await start();
    const seating_id = seat();
    const order_id = await round(seating_id, [{ order_item_id: 'D_A', item_id: FX.naan }, o.b]);
    toStage(hub, order_id, [o.b.order_item_id], 'cooking');
    await ok(
      setSplits(seating_id, {
        mode: 'items',
        splits: [
          { split_no: 1, lines: [{ order_item_id: 'D_A', units: 1 }] },
          { split_no: 2, lines: [{ order_item_id: o.b.order_item_id, units: o.b.quantity ?? 1 }] },
        ],
      }),
      'SetSplits',
    );
    await ok(discount(seating_id, o.pct_bp), 'ApplyDiscount');
    return { seating_id, order_id, frozen: new Map() };
  }

  it('[05 #16b] 10 % on Rs 2,000 (A split 1, B split 2); split 1 closes (D 100); void B → split 2 total 0, open discount 0, split 1 unchanged', async () => {
    const { seating_id, frozen } = await twoSplitDiscount({ b: { order_item_id: 'D_B', item_id: FX.naan }, pct_bp: 1_000 });
    let v = await view(seating_id);
    expect(splitOf(v, 1).totals.cash.discount_minor).toBe(10_000);
    expect(splitOf(v, 2).totals.cash.discount_minor).toBe(10_000);
    // split 1: 1,000 − 100 = 900 net, 16 % → 1,044.00
    expect(await payAndClose(seating_id, 1, 'cash')).toBe(104_400);
    const bill_id = billIdOf(seating_id);
    expect(invoicesOf(bill_id)[0]).toMatchObject({ subtotal_minor: 100_000, discount_minor: 10_000, total_minor: 104_400 });
    checkBill(await view(seating_id), frozen, 'after close');

    await ok(voidUnits('D_B', 1), 'void B');
    v = await view(seating_id);
    for (const t of Object.values(splitOf(v, 2).totals)) expect([t.subtotal_minor, t.discount_minor, t.total_minor]).toEqual([0, 0, 0]);
    expect(v.discount).toMatchObject({ frozen_minor: 20_000 });
    checkBill(v, frozen, 'after void B');
  });

  it('[05 #16b] void half of B instead (B = 2 raitas, Rs 1,000): open discount = min(100, B’s remaining 500) = 100; no invoice below 0', async () => {
    const { seating_id, frozen } = await twoSplitDiscount({ b: { order_item_id: 'D_R', item_id: FX.optionItem, quantity: 2 }, pct_bp: 1_000 });
    expect(await payAndClose(seating_id, 1, 'cash')).toBe(104_400);
    await ok(voidUnits('D_R', 1), 'void half of B');
    const v = await view(seating_id);
    expect(splitOf(v, 2).totals.cash).toMatchObject({ subtotal_minor: RAITA, discount_minor: 10_000 });
    // 500 − 100 = 400 net, card 5 % → 420.00
    checkBill(v, frozen, 'after the half void');
    expect(await payAndClose(seating_id, 2, 'card')).toBe(42_000);
    checkBill(await view(seating_id), frozen, 'all closed');
    for (const inv of invoicesOf(billIdOf(seating_id))) expect(inv.total_minor).toBeGreaterThanOrEqual(0);
  });

  it('[05 #16b, R3 cap] 90 % on Rs 2,000 (B = 2 raitas): split 1 D 900; void 1 raita → open D = min(900, 500) = 500, split 2 total 0, closes at 0 with no payment; Σ D ≤ frozen', async () => {
    const { seating_id, frozen } = await twoSplitDiscount({ b: { order_item_id: 'D_R', item_id: FX.optionItem, quantity: 2 }, pct_bp: 9_000 });
    // split 1: 1,000 − 900 = 100 net, 16 % → 116.00
    expect(await payAndClose(seating_id, 1, 'cash')).toBe(11_600);
    await ok(voidUnits('D_R', 1), 'void 1 raita');
    const v = await view(seating_id);
    expect(splitOf(v, 2).totals.as_paid).toMatchObject({ subtotal_minor: RAITA, discount_minor: RAITA, total_minor: 0 });
    checkBill(v, frozen, 'after the void');
    const c = await ok(closeSplit(cashier, seating_id, 2, 0), 'zero close');
    expect(c.result!['total_minor']).toBe(0);
    const invs = invoicesOf(billIdOf(seating_id));
    expect(invs.map((i) => [i.discount_minor, i.total_minor])).toEqual([
      [90_000, 11_600],
      [RAITA, 0],
    ]);
    expect(invs.reduce((a, i) => a + i.discount_minor, 0)).toBeLessThanOrEqual(180_000);
    checkBill(await view(seating_id), frozen, 'all closed');
  });

  it('[05 #16c, H2-8] 10 % on Rs 2,000; split 1 closes (D 100); a Rs 1,000 round C joins split 2; void B → open D = min(100, 0) = 0, C pays full Rs 1,000', async () => {
    const { seating_id, frozen } = await twoSplitDiscount({ b: { order_item_id: 'D_B', item_id: FX.naan }, pct_bp: 1_000 });
    expect(await payAndClose(seating_id, 1, 'cash')).toBe(104_400);
    const bill_id = billIdOf(seating_id);
    expect(db().prepare('SELECT order_item_id FROM bill_discount_lines WHERE bill_id = ? ORDER BY order_item_id').pluck().all(bill_id)).toEqual(['D_A', 'D_B']);
    await round(seating_id, [{ order_item_id: 'D_C', item_id: FX.naan }]);
    let v = await view(seating_id);
    // before the void: B carries the open 100, C none (later lines full price)
    expect(splitOf(v, 2).totals.cash).toMatchObject({ subtotal_minor: 2 * NAAN, discount_minor: 10_000 });
    checkBill(v, frozen, 'after round C');
    await ok(voidUnits('D_B', 1), 'void B');
    v = await view(seating_id);
    expect(splitOf(v, 2).totals.cash).toMatchObject({ subtotal_minor: NAAN, discount_minor: 0, total_minor: 116_000 });
    checkBill(v, frozen, 'after void B');
    expect(await payAndClose(seating_id, 2, 'cash')).toBe(116_000);
    checkBill(await view(seating_id), frozen, 'all closed');
    // "reopen clears bill_discount_lines" (#16c's last clause) needs ReopenBill (task 19, not built on this base)
  });
});

// ================================================================================================= #10b property

/** mulberry32 (packages/engine/test/sim/generate.ts pattern): a seeded PRNG in the test file, no dependency. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
const pick = <T>(rnd: () => number, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const int = (rnd: () => number, lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

const comped = (order_item_id: string) => db().prepare('SELECT comped_units FROM order_lines WHERE order_item_id = ?').pluck().get(order_item_id) as number;

/**
 * The open splits' effective item plan (§3.8): the stored rows, plus every live unit in no row and no closed split on
 * the highest-numbered open split (a later round). split_no → line → units.
 */
function effectivePlan(v: BillView): Map<number, Map<string, number>> {
  const open = v.splits.filter((s) => s.state === 'open').sort((a, b) => a.split_no - b.split_no);
  const plan = new Map<number, Map<string, number>>(open.map((s) => [s.split_no, new Map(planOf(v, s.split_no).map((l) => [l.order_item_id, l.units]))]));
  const closed = closedUnits(v.bill_id!);
  const highest = plan.get(open.at(-1)!.split_no)!;
  for (const l of v.lines) {
    const inRows = [...plan.values()].reduce((a, m) => a + (m.get(l.order_item_id) ?? 0), 0);
    const inClosed = closed.filter((u) => u.order_item_id === l.order_item_id).reduce((a, u) => a + u.units, 0);
    const uncovered = l.units - inRows - inClosed;
    if (uncovered > 0) highest.set(l.order_item_id, (highest.get(l.order_item_id) ?? 0) + uncovered);
  }
  return plan;
}
const flatPlan = (p: Map<number, Map<string, number>>) =>
  [...p].flatMap(([n, m]) => [...m].filter(([, u]) => u > 0).map(([id, u]) => `${n}:${id}:${u}`)).sort();

/** `units` of every line spread over `nos` at random, each split ≥ 1 unit (needs Σ units ≥ nos.length). */
function spread(rnd: () => number, units: Array<[string, number]>, nos: number[]): Array<{ split_no: number; lines: Array<{ order_item_id: string; units: number }> }> {
  const slots = units.flatMap(([id, u]) => Array.from({ length: u }, () => id));
  for (let i = slots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [slots[i], slots[j]] = [slots[j]!, slots[i]!];
  }
  const by = new Map<number, Map<string, number>>(nos.map((n) => [n, new Map()]));
  slots.forEach((id, i) => {
    const n = i < nos.length ? nos[i]! : pick(rnd, nos);
    const m = by.get(n)!;
    m.set(id, (m.get(id) ?? 0) + 1);
  });
  return nos.map((n) => ({ split_no: n, lines: [...by.get(n)!].map(([order_item_id, u]) => ({ order_item_id, units: u })).sort((a, b) => a.order_item_id.localeCompare(b.order_item_id)) }));
}

const ITEMS = [FX.naan, FX.piece, FX.optionItem] as const;

describe('[05 #10b] property: rounds, removals, comps and re-plans between item-split closes (seeded)', () => {
  it.each([3, 10, 41, 2026, 77_001, 5, 8_128, 314_159])('[05 #10b] seed %i: Σ closed + open units = live units, no unit in two splits, closed splits frozen, Σ S = Σ bases, Σ in − out = each invoice', async (seed) => {
    const rnd = prng(seed);
    const log: string[] = [];
    try {
      await start({ sc_bp: seed % 2 === 0 ? 1_000 : 0 });
      const seating_id = seat();
      let lineNo = 0;
      const cart = (n: number): CartLine[] =>
        Array.from({ length: n }, () => {
          lineNo += 1;
          return { order_item_id: `P${seed}_${lineNo}`, item_id: pick(rnd, ITEMS), quantity: int(rnd, 1, 3) };
        });
      const first = cart(int(rnd, 2, 4));
      await round(seating_id, first);
      log.push(`round ${JSON.stringify(first)}`);
      const total = first.reduce((a, l) => a + (l.quantity ?? 1), 0);
      const k = Math.min(total, int(rnd, 2, 4));
      const plan0 = spread(rnd, first.map((l) => [l.order_item_id, l.quantity ?? 1]), Array.from({ length: k }, (_, i) => i + 1));
      await ok(setSplits(seating_id, { mode: 'items', splits: plan0 }), 'SetSplits');
      log.push(`plan ${JSON.stringify(plan0)}`);
      if (rnd() < 0.6) {
        const pct = pick(rnd, [500, 1_000, 2_500]);
        await ok(discount(seating_id, pct), 'ApplyDiscount');
        log.push(`discount ${pct} bp`);
      }
      const frozen: Frozen = new Map();
      checkBill(await view(seating_id), frozen, `seed ${seed} start`);

      for (let step = 0; step < 40; step += 1) {
        const v = await view(seating_id);
        const open = v.splits.filter((x) => x.state === 'open').map((x) => x.split_no).sort((a, b) => a - b);
        if (open.length === 0) break;
        const eff = effectivePlan(v);
        const closedOf = (id: string) => closedUnits(v.bill_id!).filter((u) => u.order_item_id === id).reduce((a, u) => a + u.units, 0);
        const openUnits = (id: string) => liveUnits(id) - closedOf(id);
        const r = step < 4 || v.splits.some((x) => x.state === 'closed') ? rnd() : 0.99; // at least one close early
        const late = step > 25; // then only closes
        if (!late && r < 0.25) {
          const more = cart(int(rnd, 1, 2));
          await round(seating_id, more);
          log.push(`round ${JSON.stringify(more)}`);
          const after = effectivePlan(await view(seating_id));
          // §3.8: the new lines are on the highest-numbered open split, nothing else moved
          const expectPlan = new Map([...eff].map(([n, m]) => [n, new Map(m)]));
          for (const l of more) expectPlan.get(open.at(-1)!)!.set(l.order_item_id, l.quantity ?? 1);
          expect(flatPlan(after), 'a round joins the highest open split').toEqual(flatPlan(expectPlan));
        } else if (!late && r < 0.45) {
          // remove one unit of a line, keeping every open split non-empty (an empty split is not this test's case)
          const candidates = v.lines.filter((l) => {
            if (openUnits(l.order_item_id) - comped(l.order_item_id) < 2) return false;
            const holder = [...eff].filter(([, m]) => (m.get(l.order_item_id) ?? 0) > 0).at(-1);
            if (holder === undefined) return false;
            return [...holder[1].values()].reduce((a, u) => a + u, 0) > 1;
          });
          if (candidates.length === 0) continue;
          const l = pick(rnd, candidates);
          await ok(removeUnits(seating_id, l.order_item_id, 1), `remove ${l.order_item_id}`);
          log.push(`remove 1 ${l.order_item_id}`);
          const holder = [...eff].filter(([, m]) => (m.get(l.order_item_id) ?? 0) > 0).at(-1)![0];
          const expectPlan = new Map([...eff].map(([n, m]) => [n, new Map(m)]));
          const m = expectPlan.get(holder)!;
          m.set(l.order_item_id, m.get(l.order_item_id)! - 1);
          expect(flatPlan(effectivePlan(await view(seating_id))), `the unit leaves split ${holder}, the highest open split holding it`).toEqual(flatPlan(expectPlan));
        } else if (!late && r < 0.6) {
          // comp one open unit, leaving at least one paid open unit (comped_after ≤ units_after − closed, Q-3)
          const candidates = v.lines.filter((l) => comped(l.order_item_id) + 2 <= openUnits(l.order_item_id));
          if (candidates.length === 0) continue;
          const l = pick(rnd, candidates);
          const beforeBase = l.base_minor;
          await ok(comp(l.order_item_id, comped(l.order_item_id) + 1), `comp ${l.order_item_id}`);
          log.push(`comp ${l.order_item_id}`);
          const after = await view(seating_id);
          expect(after.lines.find((x) => x.order_item_id === l.order_item_id)!.base_minor, 'a comp lowers the line base').toBeLessThan(beforeBase);
          expect(flatPlan(effectivePlan(after)), 'a comp moves no unit').toEqual(flatPlan(eff));
        } else if (!late && r < 0.75) {
          // re-plan the open remainder (§3.8: closed splits untouched; every open unit exactly once)
          const units = v.lines.map((l) => [l.order_item_id, openUnits(l.order_item_id)] as [string, number]).filter(([, u]) => u > 0);
          if (open.length < 2 || units.reduce((a, [, u]) => a + u, 0) < open.length) continue;
          const next = spread(rnd, units, open);
          await ok(setSplits(seating_id, { mode: 'items', splits: next }), 'SetSplits re-plan');
          log.push(`replan ${JSON.stringify(next)}`);
          const want = new Map(next.map((x) => [x.split_no, new Map(x.lines.map((l) => [l.order_item_id, l.units]))]));
          expect(flatPlan(effectivePlan(await view(seating_id))), 're-plan stored as sent').toEqual(flatPlan(want));
        } else {
          const n = open[0]!;
          const how = pick(rnd, ['cash', 'card', 'mixed'] as const);
          const t = await payAndClose(seating_id, n, how);
          log.push(`close ${n} ${how} → ${t}`);
        }
        checkBill(await view(seating_id), frozen, `seed ${seed} step ${step}`);
      }
      const bill_id = billIdOf(seating_id);
      expect(db().prepare('SELECT state FROM bills WHERE bill_id = ?').pluck().get(bill_id), 'every split closed → the bill is CLOSED').toBe('closed');
      // §3.8: Σ split totals (all closed) = the bill as paid
      const paid = db().prepare(`SELECT COALESCE(SUM(CASE direction WHEN 'in' THEN amount_minor ELSE -amount_minor END), 0) FROM bill_payments WHERE bill_id = ? AND removed_at IS NULL`).pluck().get(bill_id) as number;
      expect(invoicesOf(bill_id).reduce((a, i) => a + i.total_minor, 0)).toBe(paid);
    } catch (e) {
      console.error(`[05 #10b] failing seed ${seed}\n${log.join('\n')}`);
      throw e;
    }
  });
});

// ================================================================================================= #23 shifts half

describe('[05 #23 shifts half, §3.7, §3.12, B11, B23] property: a shift’s expected cash across payments, change, petty cash and counts (seeded)', () => {
  interface Drawer {
    who: Who;
    shift_id: string;
    float: number;
    /** the model: §3.7 moves */
    cashIn: number;
    changeGiven: number;
    tendered: number;
    pettyOut: number;
    pettyIn: number;
    advanced: number;
    returned: number;
  }
  const expectedOf = (d: Drawer) => d.float + d.cashIn - d.pettyOut + d.pettyIn - d.advanced + d.returned;
  const dbExpected = (shift_id: string) => db().prepare('SELECT expected_cash_minor FROM shifts WHERE shift_id = ?').pluck().get(shift_id) as number;
  const changeOn = (shift_id: string) => db().prepare('SELECT COALESCE(SUM(change_minor), 0) FROM shift_takings WHERE shift_id = ?').pluck().get(shift_id) as number;

  it.each([7, 99, 1_234, 60_606])('[05 #23] seed %i: expected = float + Σ cash in − Σ petty out + Σ petty in − Σ advances + Σ returned; change stays on the paying shift; HandoverCount and CountShift answer that expected', async (seed) => {
    const rnd = prng(seed);
    const log: string[] = [];
    try {
      await start();
      const kioskB = signInOn(hub, STAFF.manager, drawerDevice(hub, 'Kiosk B'));
      const b = await ok(post(hub, kioskB, 'open-shift', 'OpenShift', { float_minor: 200_000, as_drawer: true }), 'OpenShift B');
      const drawers: Drawer[] = [
        { who: cashier, shift_id: cashierShift, float: FLOAT, cashIn: 0, changeGiven: 0, tendered: 0, pettyOut: 0, pettyIn: 0, advanced: 0, returned: 0 },
        { who: kioskB, shift_id: b.result!['shift_id'] as string, float: 200_000, cashIn: 0, changeGiven: 0, tendered: 0, pettyOut: 0, pettyIn: 0, advanced: 0, returned: 0 },
      ];
      const advances: Array<{ entry_id: string; amount: number }> = [];
      let saleNo = 0;
      const check = (label: string) => {
        for (const d of drawers) {
          expect(dbExpected(d.shift_id), `${label}: running expected of ${d.shift_id}`).toBe(expectedOf(d));
          expect(changeOn(d.shift_id), `${label}: change on ${d.shift_id} = Σ (tendered − amount) of its cash payments`).toBe(d.changeGiven);
          expect(d.changeGiven, `${label}: change ≤ Σ tendered`).toBeLessThanOrEqual(d.tendered);
        }
      };

      for (let step = 0; step < 14; step += 1) {
        const r = rnd();
        const d = pick(rnd, drawers);
        if (r < 0.5) {
          // a takeaway sale, paid in 1–3 parts from random drawers (cash with or without tender, card), then closed
          saleNo += 1;
          const order_id = `O_T${seed}_${saleNo}`;
          await ok(
            post(hub, cashier, 'submit-order', 'SubmitOrder', {
              order_id,
              order_type: 'takeaway',
              lines: [{ order_item_id: `${order_id}_L`, item_id: pick(rnd, ITEMS), quantity: int(rnd, 1, 4) }],
            }),
            'SubmitOrder takeaway',
          );
          const ref = { order_id };
          const viewOf = async () => {
            const res = await hub.app.inject({ method: 'GET', url: `/queries/bill?order_id=${order_id}`, headers: { authorization: `Bearer ${cashier.token}`, 'x-session-token': cashier.sessionToken } });
            expect(res.statusCode, res.body).toBe(200);
            return splitOf((res.json() as { data: BillView }).data, 1);
          };
          for (let part = 0; part < 3; part += 1) {
            const sp = await viewOf();
            if (sp.balance_minor <= 0) break;
            const payer = pick(rnd, drawers);
            const hasCash = sp.payments.some((p) => p.direction === 'in' && p.mode_id === 'cash');
            const cash = rnd() < 0.65;
            const due = (cash || hasCash ? sp.totals.cash.total_minor : sp.totals.digital.total_minor) - paidOf(sp);
            const last = part === 2;
            const amount = last ? due : Math.max(100, Math.min(due, Math.round((due * int(rnd, 20, 100)) / 100 / 100) * 100));
            if (cash) {
              const tendered = rnd() < 0.6 ? Math.ceil((amount + 1) / 50_000) * 50_000 : undefined;
              // a mis-keyed cash payment, removed again (RemovePayment): it never moves the expected
              if (rnd() < 0.25) {
                const wrong = await ok(post(hub, payer.who, 'add-payment', 'AddPayment', { bill_ref: ref, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: Math.min(due, 100) }), 'wrong cash');
                await ok(post(hub, payer.who, 'remove-payment', 'RemovePayment', { payment_id: wrong.result!['payment_id'], reason_code: 'wrong_amount' }), 'RemovePayment');
                log.push(`wrong cash 100 removed on ${payer.shift_id}`);
              }
              const res = await ok(
                post(hub, payer.who, 'add-payment', 'AddPayment', { bill_ref: ref, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: amount, ...(tendered === undefined ? {} : { tendered_minor: tendered }) }),
                'cash in',
              );
              const p = res.events.find((e) => e.event_type === 'PaymentAdded')!.payload;
              expect(p['shift_id'], 'a payment lands on the payer’s own drawer shift').toBe(payer.shift_id);
              payer.cashIn += amount;
              payer.tendered += tendered ?? amount;
              payer.changeGiven += (tendered ?? amount) - amount;
              log.push(`cash ${amount} tendered ${tendered ?? '-'} on ${payer.shift_id}`);
            } else {
              await ok(post(hub, payer.who, 'add-payment', 'AddPayment', { bill_ref: ref, split_no: 1, mode_id: 'card', direction: 'in', amount_minor: amount }), 'card in');
              log.push(`card ${amount} on ${payer.shift_id}`);
            }
            check(`seed ${seed} step ${step} part ${part}`);
          }
          let sp = await viewOf();
          if (sp.balance_minor > 0) {
            // settle the rest in cash on a random drawer
            const payer = pick(rnd, drawers);
            await ok(post(hub, payer.who, 'add-payment', 'AddPayment', { bill_ref: ref, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: sp.balance_minor }), 'rest cash');
            payer.cashIn += sp.balance_minor;
            payer.tendered += sp.balance_minor;
            log.push(`rest cash ${sp.balance_minor} on ${payer.shift_id}`);
            sp = await viewOf();
          }
          expect(sp.balance_minor).toBe(0);
          const c = await ok(post(hub, pick(rnd, drawers).who, 'close-split', 'CloseSplit', { bill_ref: ref, split_no: 1, expected_total_minor: sp.totals.as_paid.total_minor }), 'CloseSplit');
          // #23: Σ in − Σ out = the split total at close; the invoice's change = Σ (tendered − amount)
          const inv = db().prepare('SELECT total_minor, change_minor FROM invoices WHERE invoice_id = ?').get(c.result!['invoice_id']) as { total_minor: number; change_minor: number };
          const pays = db().prepare('SELECT direction, amount_minor, tendered_minor FROM bill_payments WHERE invoice_id = ? AND removed_at IS NULL').all(c.result!['invoice_id']) as Array<{ direction: string; amount_minor: number; tendered_minor: number | null }>;
          expect(pays.reduce((a, x) => a + (x.direction === 'in' ? x.amount_minor : -x.amount_minor), 0)).toBe(inv.total_minor);
          expect(inv.change_minor).toBe(pays.reduce((a, x) => a + (x.tendered_minor === null ? 0 : x.tendered_minor - x.amount_minor), 0));
          log.push(`close ${order_id} → ${inv.total_minor}`);
        } else if (r < 0.65) {
          const amount = int(rnd, 1, 40) * 5_000;
          if (amount > expectedOf(d)) continue; // no more cash out of a drawer than it holds
          await ok(post(hub, d.who, 'record-petty-cash', 'RecordPettyCash', { kind: 'out', amount_minor: amount, category_id: 'supplies' }), 'petty out');
          d.pettyOut += amount;
          log.push(`petty out ${amount} on ${d.shift_id}`);
        } else if (r < 0.75) {
          const amount = int(rnd, 1, 20) * 5_000;
          await ok(post(hub, d.who, 'record-petty-cash', 'RecordPettyCash', { kind: 'in', amount_minor: amount, category_id: 'other' }), 'petty in');
          d.pettyIn += amount;
          log.push(`petty in ${amount} on ${d.shift_id}`);
        } else if (r < 0.85) {
          const amount = int(rnd, 2, 40) * 5_000;
          if (amount > expectedOf(d)) continue;
          const a = await ok(
            post(hub, d.who, 'record-petty-cash', 'RecordPettyCash', { kind: 'advance', amount_minor: amount, category_id: 'staff_advance', advance_staff_id: STAFF.orderTaker }),
            'advance',
          );
          d.advanced += amount;
          advances.push({ entry_id: a.result!['entry_id'] as string, amount });
          log.push(`advance ${amount} on ${d.shift_id}`);
        } else if (r < 0.95 && advances.length > 0) {
          // §3.12: settled on any shift — the returned cash lands on the settling shift
          const [adv] = advances.splice(Math.floor(rnd() * advances.length), 1);
          const returned = int(rnd, 0, adv!.amount / 5_000) * 5_000;
          await ok(post(hub, d.who, 'settle-petty-advance', 'SettlePettyAdvance', { entry_id: adv!.entry_id, spent_minor: adv!.amount - returned, returned_minor: returned }), 'settle');
          d.returned += returned;
          log.push(`settle ${adv!.entry_id} returned ${returned} on ${d.shift_id}`);
        } else {
          // HandoverCount: a count while OPEN — answers the expected, moves nothing
          const counted = expectedOf(d) + int(rnd, -5, 5) * 100;
          hub.clock.advance(1_000);
          const h = await ok(post(hub, d.who, 'handover-count', 'HandoverCount', { shift_id: d.shift_id, counted_minor: counted }), 'HandoverCount');
          expect(h.result).toMatchObject({ expected_minor: expectedOf(d), variance_minor: counted - expectedOf(d) });
          log.push(`handover ${counted} on ${d.shift_id}`);
        }
        check(`seed ${seed} step ${step}`);
      }
      // every advance still open is settled now, on a random drawer (§3.12: the returned cash lands there)
      for (const adv of advances.splice(0)) {
        const d = pick(rnd, drawers);
        const returned = int(rnd, 0, adv.amount / 5_000) * 5_000;
        await ok(post(hub, d.who, 'settle-petty-advance', 'SettlePettyAdvance', { entry_id: adv.entry_id, spent_minor: adv.amount - returned, returned_minor: returned }), 'settle');
        d.returned += returned;
        log.push(`settle ${adv.entry_id} returned ${returned} on ${d.shift_id}`);
        check(`seed ${seed} final settle`);
      }
      // Σ shifts' expected moves = Σ cash in − out + petty (§3.7, #23)
      const cashNet = db().prepare(`SELECT COALESCE(SUM(CASE direction WHEN 'in' THEN amount_minor ELSE -amount_minor END), 0) FROM bill_payments WHERE payment_class = 'cash' AND removed_at IS NULL`).pluck().get() as number;
      expect(drawers.reduce((a, x) => a + x.cashIn, 0)).toBe(cashNet);
      // CountShift on both: counts and closes; its response carries the model's expected and the variance (B23)
      for (const dr of drawers) {
        const counted = Math.max(0, expectedOf(dr) - int(rnd, 0, 50) * 100); // within the Rs 100 threshold
        const c = await ok(post(hub, dr.who, 'count-shift', 'CountShift', { shift_id: dr.shift_id, counted_minor: counted }), 'CountShift');
        expect(c.result).toMatchObject({ expected_minor: expectedOf(dr), variance_minor: counted - expectedOf(dr) });
        expect(db().prepare('SELECT state, counted_minor, variance_minor FROM shifts WHERE shift_id = ?').get(dr.shift_id)).toEqual({
          state: 'closed',
          counted_minor: counted,
          variance_minor: counted - expectedOf(dr),
        });
        log.push(`count ${counted} on ${dr.shift_id}`);
      }
    } catch (e) {
      console.error(`[05 #23 shifts] failing seed ${seed}\n${log.join('\n')}`);
      throw e;
    }
  });
});

describe('[05 #23 shifts half] scripted: literal PKR moves on two drawers', () => {
  it('[05 #23, §3.7, §3.12] float 5,000; cash 1,044 tendered 1,500 (change 456); petty out 1,200, in 800; advance 3,000 on A settled on B (returned 500) → A 2,644.00, B 2,500.00', async () => {
    await start();
    const kioskB = signInOn(hub, STAFF.manager, drawerDevice(hub, 'Kiosk B'));
    const shiftB = (await ok(post(hub, kioskB, 'open-shift', 'OpenShift', { float_minor: 200_000, as_drawer: true }), 'OpenShift B')).result!['shift_id'] as string;
    const expected = (id: string) => db().prepare('SELECT expected_cash_minor FROM shifts WHERE shift_id = ?').pluck().get(id);
    expect([expected(cashierShift), expected(shiftB)]).toEqual([500_000, 200_000]);

    const seating_id = seat();
    await round(seating_id, [{ order_item_id: 'S_N', item_id: FX.naan }]);
    // 1,000 + 16 % = 1,160.00 (a mixed split is at the cash rates, §3.6): card 116.00 on B, then cash 1,044.00
    // tendered 1,500.00 on A → change 456.00 on A
    await ok(pay(kioskB, seating_id, 1, 'card', 11_600), 'card');
    const c = await ok(pay(cashier, seating_id, 1, 'cash', 104_400, 150_000), 'cash');
    expect(c.events.find((e) => e.event_type === 'PaymentAdded')!.payload).toMatchObject({ shift_id: cashierShift, amount_minor: 104_400, tendered_minor: 150_000, change_minor: 45_600 });
    await ok(closeSplit(cashier, seating_id, 1, 116_000), 'close');
    expect([expected(cashierShift), expected(shiftB)]).toEqual([604_400, 200_000]); // card moves no drawer
    checkBill(await view(seating_id), new Map(), 'closed');

    await ok(post(hub, cashier, 'record-petty-cash', 'RecordPettyCash', { kind: 'out', amount_minor: 120_000, category_id: 'supplies' }), 'out');
    await ok(post(hub, cashier, 'record-petty-cash', 'RecordPettyCash', { kind: 'in', amount_minor: 80_000, category_id: 'other' }), 'in');
    const adv = await ok(post(hub, cashier, 'record-petty-cash', 'RecordPettyCash', { kind: 'advance', amount_minor: 300_000, category_id: 'staff_advance', advance_staff_id: STAFF.orderTaker }), 'advance');
    expect(expected(cashierShift)).toBe(264_400);
    await ok(post(hub, kioskB, 'settle-petty-advance', 'SettlePettyAdvance', { entry_id: adv.result!['entry_id'], spent_minor: 250_000, returned_minor: 50_000 }), 'settle');
    expect([expected(cashierShift), expected(shiftB)]).toEqual([264_400, 250_000]);

    hub.clock.advance(1_000);
    const h = await ok(post(hub, cashier, 'handover-count', 'HandoverCount', { shift_id: cashierShift, counted_minor: 264_000 }), 'handover');
    expect(h.result).toMatchObject({ expected_minor: 264_400, variance_minor: -400 });
    expect(expected(cashierShift)).toBe(264_400); // a handover moves nothing
    const a = await ok(post(hub, cashier, 'count-shift', 'CountShift', { shift_id: cashierShift, counted_minor: 264_400 }), 'count A');
    expect(a.result).toMatchObject({ expected_minor: 264_400, variance_minor: 0 });
    const b = await ok(post(hub, kioskB, 'count-shift', 'CountShift', { shift_id: shiftB, counted_minor: 249_000 }), 'count B');
    expect(b.result).toMatchObject({ expected_minor: 250_000, variance_minor: -1_000 });
    expect(db().prepare('SELECT shift_id, change_minor FROM shift_takings WHERE change_minor > 0').all()).toEqual([{ shift_id: cashierShift, change_minor: 45_600 }]);
  });
});

describe('[05 §3.11, §6.19, R-81] HandoverCount twice in one millisecond (found by the #23 shifts property)', () => {
  // FINDING (task 3b): §3.11 allows a HandoverCount "any time while OPEN", but §5's `shift_handovers` key is
  // (shift_id, at) with `at` in ms; two handovers of one shift at the same hub time (the test clock does not move
  // between commands; in the field, two queued commands replayed together) answered 500 INTERNAL_ERROR.
  // 05 v1.0.21 (R-81, owner 2026-11-20): the `shifts` fold writes `at` = max(recorded_at, last at + 1 ms) —
  // strictly increasing per shift, no migration; no envelope field is redefined (occurred_at stays the device clock).
  const rows = () =>
    db().prepare('SELECT at, counted_minor FROM shift_handovers WHERE shift_id = ? ORDER BY at').all(cashierShift) as Array<{ at: number; counted_minor: number }>;

  it('[05 §6.19, R-81] two HandoverCounts of the drawer shift at the same hub time → both 200, two shift_handovers rows, at strictly increasing', async () => {
    await start();
    const now = hub.clock.branchNow();
    const first = await ok(post(hub, cashier, 'handover-count', 'HandoverCount', { shift_id: cashierShift, counted_minor: FLOAT }), 'first');
    const second = await ok(post(hub, cashier, 'handover-count', 'HandoverCount', { shift_id: cashierShift, counted_minor: FLOAT - 1_000 }), 'second');
    expect(hub.clock.branchNow()).toBe(now); // the clock never moved
    expect(second.result).toMatchObject({ expected_minor: FLOAT, variance_minor: -1_000 });
    expect(rows()).toEqual([
      { at: now, counted_minor: FLOAT },
      { at: now + 1, counted_minor: FLOAT - 1_000 },
    ]);
    // the envelopes are untouched: both events carry the same recorded_at; the bump is the fold's alone
    expect([first, second].map((r) => r.events.map((e) => e.event_type))).toEqual([['HandoverCounted'], ['HandoverCounted']]);
    expect(db().prepare(`SELECT recorded_at FROM events WHERE event_type = 'HandoverCounted' AND stream_id = ? ORDER BY seq`).pluck().all(cashierShift)).toEqual([now, now]);
  });

  it('[05 §6.19, R-81] three HandoverCounts in one millisecond → three rows at now, now + 1, now + 2; a later one at a real later time keeps its own now', async () => {
    await start();
    const now = hub.clock.branchNow();
    for (const counted of [FLOAT, FLOAT - 100, FLOAT - 200]) {
      await ok(post(hub, cashier, 'handover-count', 'HandoverCount', { shift_id: cashierShift, counted_minor: counted }), `handover ${counted}`);
    }
    expect(rows()).toEqual([
      { at: now, counted_minor: FLOAT },
      { at: now + 1, counted_minor: FLOAT - 100 },
      { at: now + 2, counted_minor: FLOAT - 200 },
    ]);
    hub.clock.advance(1_000);
    await ok(post(hub, cashier, 'handover-count', 'HandoverCount', { shift_id: cashierShift, counted_minor: FLOAT - 300 }), 'later');
    expect(rows().at(-1)).toEqual({ at: now + 1_000, counted_minor: FLOAT - 300 });
    const ats = rows().map((r) => r.at);
    expect(ats.every((a, i) => i === 0 || a > ats[i - 1]!)).toBe(true);
  });
});
