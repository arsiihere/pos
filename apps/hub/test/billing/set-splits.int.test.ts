// 05 §6.5 `SetSplits`, §3.8, B15 (task 12; 05-plan §3 row 12): items / amount / equal / none over the open remainder,
// re-basing on a later round, new lines joining the highest open split. Real events through the hub's writer, the real
// `billing` fold (task 7), the command over HTTP and the bill view (task 10) as the client reads them. Payments and
// closes are in-test events (tasks 16 and 17 are not built): task 5's builders, folded by task 7.
import { DiscountApplied, DiscountFrozen, draftOf, InvoiceIssued, PaymentAdded, rateBpRates, SnapshotBillingSchema, type BranchConfig, type EventDef, type EventDraft, type PosEvent, type SnapshotBilling } from '@pos/events';
import { aDiscountApplied, anInvoiceIssued, aPaymentAdded } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { hubBilling } from '../../src/billing/defaults';
import type { BillView } from '../../src/billing/queries/bill';
import { billingProjection } from '../../src/billing/projections/billing';
import { commandRegistry } from '../../src/commands/route';
import { createProjectionRegistry } from '../../src/projections/registry';
import type { CommandDef } from '../../src/commands/registry';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { seedDirectory, type TestHub } from '../helpers/test-hub';
import { openDay, voidsMenu } from '../voids/fixtures';
import { appendOrder, billingDirectory, dealX2, FX, openSeating, optionChildOrder, post, raiseVoid, signIn, STAFF, startBilling, VX, type Reply, type Who } from './fixtures';

let hub: TestHub;
let cashier: Who;
let waiter: Who;

/** The PK built-in document, the service charge at `sc_bp` for dine-in (default 0), rounding off unless asked. */
function billingDoc(o: { sc_bp?: number; rounding?: boolean } = {}): SnapshotBilling {
  const pk = hubBilling({ currency_code: 'PKR', tax_classes: [], billing: undefined });
  return SnapshotBillingSchema.parse({
    ...pk.settings,
    service_charge_bp: { ...pk.settings.service_charge_bp, dine_in: o.sc_bp ?? 0 },
    jurisdiction: {
      ...pk.jurisdiction,
      rules: pk.jurisdiction.rules.map((r) => ({ ...r, rounding_step_minor: o.rounding === true ? r.rounding_step_minor : null, buyer_id: { ...r.buyer_id, threshold_minor: null } })),
    },
    tax_profiles: [{ tax_class_id: 'tc-food', taxes: [{ seq: 1, tax_code: 'TAX', label: 'Sales tax', compound: false, rates: rateBpRates(1_600) }] }],
  });
}

/** voidsMenu() with the karahi and naan taxed at 1 600 bp; the lassi untaxed. */
function menu(billing: SnapshotBilling = billingDoc()): BranchConfig {
  const m = voidsMenu();
  return {
    ...m,
    tax_enabled: true,
    tax_classes: [{ tax_class_id: 'tc-food', name: 'Sales tax', rate_bp: 1_600, is_archived: false, fiscal_category: 'restaurant_service' }],
    items: m.items.map((i) => (i.item_id === FX.piece || i.item_id === FX.naan ? { ...i, tax_class_id: 'tc-food' } : i)),
    billing,
  };
}

/** The handler's statements of the last `set-splits` call (the repo's countHandle pattern, merge-tables.int.test.ts). */
const handled = { count: -1 };

async function start(billing?: SnapshotBilling): Promise<void> {
  hub = await startBilling({ open: false });
  openDay(hub, { menu: menu(billing), stock: { [FX.stock]: 0, [VX.naanStock]: 0 } });
  cashier = signIn(hub, STAFF.cashier);
  waiter = signIn(hub, STAFF.orderTaker);
  const def = commandRegistry(hub.app).byPath('set-splits') as CommandDef | undefined;
  if (def === undefined) return; // not registered: every call answers 404 (the failing-first state)
  const counter = statementCounter(hub.deps.db);
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

afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

function setSplits(payload: Record<string, unknown>, who: Who = cashier, commandId?: string): Promise<Reply> {
  return post(hub, who, 'set-splits', 'SetSplits', payload, commandId);
}

async function view(qs: Record<string, string>): Promise<BillView> {
  const res = await hub.app.inject({ method: 'GET', url: `/queries/bill?${new URLSearchParams(qs).toString()}`, headers: { authorization: `Bearer ${cashier.token}`, 'x-session-token': cashier.sessionToken } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: BillView }).data;
}

/** One writer transaction of bill-stream events (clock +1 s), each payload parsed by its schema. */
function appendBill(bill_id: string, items: Array<{ def: EventDef<z.ZodType>; payload: unknown }>): PosEvent[] {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  const drafts: EventDraft[] = items.map((i) =>
    draftOf(i.def, { stream_type: 'bill', stream_id: bill_id, payload: i.def.payload.parse(i.payload), occurred_at: now, actor_id: STAFF.cashier, device_id: 'D_FIXTURE' }),
  );
  return hub.deps.writer.run((tx) => tx.append(drafts)).appended;
}

let paymentNo = 0;
function pay(bill_id: string, split_no: number, amount_minor: number): void {
  paymentNo += 1;
  const payload = {
    ...(aPaymentAdded().payload as object),
    payment_id: `PAY_${paymentNo}`,
    bill_id,
    split_no,
    mode_id: 'cash',
    payment_class: 'cash',
    direction: 'in',
    amount_minor,
    tendered_minor: amount_minor,
    change_minor: 0,
    has_reference: false,
    taken_by_staff_id: STAFF.cashier,
    shift_id: 'SHIFT_1',
  };
  appendBill(bill_id, [{ def: PaymentAdded as unknown as EventDef<z.ZodType>, payload }]);
}

let invoiceNo = 0;
/** In-test close of one split (task 17 not built): task 5's InvoiceIssued, not fiscalized; task 7 folds it. */
function closeInTest(
  bill_id: string,
  split_no: number,
  lines: Array<{ order_item_id: string; units: number; base_minor: number; discount_minor?: number }>,
  discount_line_ids: string[] | null,
  o: { sc_minor?: number } = {},
): void {
  invoiceNo += 1;
  const base = anInvoiceIssued().payload as { lines: Array<Record<string, unknown>>; fiscal: Record<string, unknown> } & Record<string, unknown>;
  const subtotal = lines.reduce((a, l) => a + l.base_minor, 0);
  const discount = lines.reduce((a, l) => a + (l.discount_minor ?? 0), 0);
  const sc = o.sc_minor ?? 0;
  appendBill(bill_id, [
    {
      def: InvoiceIssued as unknown as EventDef<z.ZodType>,
      payload: {
        ...base,
        invoice_id: `INV_${invoiceNo}`,
        number: invoiceNo,
        invoice_ref: `T-S${String(invoiceNo).padStart(6, '0')}`,
        bill_id,
        split_no,
        lines: lines.map((l) => ({ ...base.lines[0], order_item_id: l.order_item_id, units: l.units, base_minor: l.base_minor, discount_minor: l.discount_minor ?? 0, unit_price_minor: 0, taxes: [] })),
        service_charge: sc === 0 ? null : { amount_minor: sc, tax_profile_id: null, taxes: [] },
        subtotal_minor: subtotal,
        discount_minor: discount,
        service_charge_minor: sc,
        taxes: [],
        rounding_minor: 0,
        total_minor: subtotal - discount + sc,
        payment_ids: [],
        change_minor: 0,
        discount_line_ids,
        fiscal: { ...base.fiscal, adapter_key: 'none', required: false, pos_id: null, payment_codes: [] },
      },
    },
  ]);
}

/** A seating at T4 held by the order taker with one round; returns its ids. */
function seated(lines: Array<{ order_item_id: string; item_id?: string; option_id?: string; parent_order_item_id?: string; quantity?: number }>, o: { seating_id?: string; table_id?: string; holder?: string } = {}) {
  const seating_id = o.seating_id ?? 'SEAT_SS';
  openSeating(hub, { table_id: o.table_id ?? VX.tables.T4, seating_id, ...(o.holder === undefined ? {} : { holder_staff_id: o.holder }) });
  const { order_id } = appendOrder(hub, { order_type: 'dine_in', seating_id, placed_by: STAFF.orderTaker, lines });
  return { seating_id, order_id };
}

function round(seating_id: string, lines: Array<{ order_item_id: string; item_id: string; quantity?: number }>): string {
  return appendOrder(hub, { order_type: 'dine_in', seating_id, placed_by: STAFF.orderTaker, follow_up: true, lines }).order_id;
}

const subtotals = (v: BillView) => v.splits.map((s) => [s.split_no, s.totals.as_paid.subtotal_minor]);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Every table the billing fold writes for splits, ordered (rebuild = live). */
function splitTables(): unknown[] {
  const all = (sql: string) => hub.deps.db.prepare(sql).all();
  return [
    all('SELECT * FROM bills ORDER BY bill_id'),
    all('SELECT * FROM bill_splits ORDER BY bill_id, split_no'),
    all('SELECT * FROM bill_split_lines ORDER BY bill_id, split_no, order_item_id'),
    all('SELECT * FROM closed_split_units ORDER BY bill_id, split_no, order_item_id'),
    all('SELECT * FROM bill_discount_lines ORDER BY bill_id, order_item_id'),
  ];
}

/** Deletes the `billing` checkpoint and replays it alone from seq 0 (projection.int.test.ts's rebuildBillingAlone). */
function rebuildBilling(): void {
  hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'billing'`).run();
  const registry = createProjectionRegistry();
  registry.register(billingProjection());
  registry.catchUp(hub.deps.db, hub.deps.config.provisioned!.branch_id);
}

// ================================================================================================= items

describe('[05 §6.5, §3.8] SetSplits — items', () => {
  beforeEach(() => start());

  it('[05 #7] units over 2 splits on a projected bill: BillOpened + BillSplitsSet { lines with order_id }; the result = the bill view splits', async () => {
    const { seating_id, order_id } = seated([
      { order_item_id: 'K', item_id: FX.piece },
      { order_item_id: 'N', item_id: FX.naan, quantity: 3 },
    ]);
    const r = await setSplits({
      bill_ref: { seating_id },
      mode: 'items',
      splits: [
        { split_no: 1, lines: [{ order_item_id: 'K', units: 1 }, { order_item_id: 'N', units: 1 }] },
        { split_no: 2, lines: [{ order_item_id: 'N', units: 2 }] },
      ],
    });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['BillOpened', 'BillSplitsSet']);
    const bill_id = r.events[0]!.stream_id;
    expect(r.events[1]!.payload).toEqual({
      bill_id,
      mode: 'items',
      splits: [
        { split_no: 1, lines: [{ order_item_id: 'K', order_id, units: 1 }, { order_item_id: 'N', order_id, units: 1 }], share_minor: null },
        { split_no: 2, lines: [{ order_item_id: 'N', order_id, units: 2 }], share_minor: null },
      ],
    });
    const v = await view({ seating_id });
    expect(r.result).toEqual({ bill_id, splits: v.splits });
    expect(v.splits.map((s) => s.plan)).toEqual([{ lines: [{ order_item_id: 'K', units: 1 }, { order_item_id: 'N', units: 1 }] }, { lines: [{ order_item_id: 'N', units: 2 }] }]);
    // money: naan 3 000 a unit; Σ split subtotals = the bill's lines
    expect(v.splits[1]!.totals.as_paid.subtotal_minor).toBe(6_000);
    expect(sum(v.splits.map((s) => s.totals.as_paid.subtotal_minor))).toBe(v.totals_default.subtotal_minor);
    expect(sum(v.splits.map((s) => s.totals.cash.total_minor))).toBe(v.totals_default.total_minor);
  });

  it('[05 #7] a deal goes whole (parts with the deal unit for unit); a deal part apart → deal_whole', async () => {
    openSeating(hub, { table_id: VX.tables.T4, seating_id: 'SEAT_DL' });
    const d = dealX2(hub, { seating_id: 'SEAT_DL' });
    // deal × 2: karahi part 1 a deal (2 units), naan part 2 a deal (4 units)
    const ok = await setSplits({
      bill_ref: { seating_id: 'SEAT_DL' },
      mode: 'items',
      splits: [
        { split_no: 1, lines: [{ order_item_id: d.deal, units: 1 }, { order_item_id: d.karahiPart, units: 1 }, { order_item_id: d.naanPart, units: 2 }] },
        { split_no: 2, lines: [{ order_item_id: d.deal, units: 1 }, { order_item_id: d.karahiPart, units: 1 }, { order_item_id: d.naanPart, units: 2 }] },
      ],
    });
    expect(ok.error).toBeUndefined();
    const v = await view({ seating_id: 'SEAT_DL' });
    expect(v.splits[0]!.totals.as_paid.subtotal_minor).toBe(v.splits[1]!.totals.as_paid.subtotal_minor);
    const bad = await setSplits({
      bill_ref: { seating_id: 'SEAT_DL' },
      mode: 'items',
      splits: [
        { split_no: 1, lines: [{ order_item_id: d.deal, units: 2 }, { order_item_id: d.karahiPart, units: 1 }, { order_item_id: d.naanPart, units: 4 }] },
        { split_no: 2, lines: [{ order_item_id: d.karahiPart, units: 1 }] },
      ],
    });
    expect(bad.status).toBe(422);
    expect(bad.error).toEqual({ code: 'BILL_SPLIT_INVALID', details: { reason: 'deal_whole', order_item_id: d.karahiPart } });
    expect(bad.events).toEqual([]);
  });

  it('[05 #7] an option child follows its parent; apart → option_with_parent', async () => {
    openSeating(hub, { table_id: VX.tables.T4, seating_id: 'SEAT_OC' });
    const oc = optionChildOrder(hub, { seating_id: 'SEAT_OC' });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT_OC', placed_by: STAFF.orderTaker, follow_up: true, lines: [{ order_item_id: 'OC_N', item_id: FX.naan }] });
    const ok = await setSplits({
      bill_ref: { seating_id: 'SEAT_OC' },
      mode: 'items',
      splits: [
        { split_no: 1, lines: [{ order_item_id: oc.item, units: 1 }, { order_item_id: oc.child, units: 1 }] },
        { split_no: 2, lines: [{ order_item_id: 'OC_N', units: 1 }] },
      ],
    });
    expect(ok.error).toBeUndefined();
    const bad = await setSplits({
      bill_ref: { seating_id: 'SEAT_OC' },
      mode: 'items',
      splits: [
        { split_no: 1, lines: [{ order_item_id: oc.item, units: 1 }] },
        { split_no: 2, lines: [{ order_item_id: oc.child, units: 1 }, { order_item_id: 'OC_N', units: 1 }] },
      ],
    });
    expect(bad.status).toBe(422);
    expect(bad.error).toEqual({ code: 'BILL_SPLIT_INVALID', details: { reason: 'option_with_parent', order_item_id: oc.child } });
  });

  it('[05 #7] every live unit not in a closed split exactly once: units_missing, units_exceed (also a line not on the bill)', async () => {
    const { seating_id } = seated([
      { order_item_id: 'K', item_id: FX.piece },
      { order_item_id: 'N', item_id: FX.naan, quantity: 3 },
    ]);
    const plan = (n2: number, extra: Array<{ order_item_id: string; units: number }> = []) =>
      setSplits({ bill_ref: { seating_id }, mode: 'items', splits: [{ split_no: 1, lines: [{ order_item_id: 'K', units: 1 }] }, { split_no: 2, lines: [{ order_item_id: 'N', units: n2 }, ...extra] }] });
    expect((await plan(2)).error).toEqual({ code: 'BILL_SPLIT_INVALID', details: { reason: 'units_missing', order_item_id: 'N' } });
    expect((await plan(4)).error).toEqual({ code: 'BILL_SPLIT_INVALID', details: { reason: 'units_exceed', order_item_id: 'N' } });
    expect((await plan(3, [{ order_item_id: 'GHOST', units: 1 }])).error).toEqual({ code: 'BILL_SPLIT_INVALID', details: { reason: 'units_exceed', order_item_id: 'GHOST' } });
    const missingK = await setSplits({ bill_ref: { seating_id }, mode: 'items', splits: [{ split_no: 1, lines: [{ order_item_id: 'N', units: 1 }] }, { split_no: 2, lines: [{ order_item_id: 'N', units: 2 }] }] });
    expect(missingK.error).toEqual({ code: 'BILL_SPLIT_INVALID', details: { reason: 'units_missing', order_item_id: 'K' } });
    // no event and no bill row from a refused command
    expect(hub.deps.db.prepare(`SELECT COUNT(*) FROM events WHERE stream_type = 'bill'`).pluck().get()).toBe(0);
  });

  it('[05 #7, §3.8, B15] a later round joins the highest-numbered open split; the bill view adds it there', async () => {
    const { seating_id } = seated([
      { order_item_id: 'K', item_id: FX.piece },
      { order_item_id: 'N', item_id: FX.naan, quantity: 2 },
    ]);
    const r = await setSplits({ bill_ref: { seating_id }, mode: 'items', splits: [{ split_no: 1, lines: [{ order_item_id: 'K', units: 1 }] }, { split_no: 2, lines: [{ order_item_id: 'N', units: 2 }] }] });
    expect(r.error).toBeUndefined();
    const before = await view({ seating_id });
    round(seating_id, [{ order_item_id: 'N2', item_id: FX.naan, quantity: 1 }]);
    const after = await view({ seating_id });
    expect(after.splits[0]!.totals.as_paid.subtotal_minor).toBe(before.splits[0]!.totals.as_paid.subtotal_minor);
    expect(after.splits[1]!.totals.as_paid.subtotal_minor).toBe(before.splits[1]!.totals.as_paid.subtotal_minor + 3_000);
    expect(sum(after.splits.map((s) => s.totals.as_paid.subtotal_minor))).toBe(after.totals_default.subtotal_minor);
    // a re-plan must now place the new line too
    const again = await setSplits({ bill_ref: { seating_id }, mode: 'items', splits: [{ split_no: 1, lines: [{ order_item_id: 'K', units: 1 }] }, { split_no: 2, lines: [{ order_item_id: 'N', units: 2 }] }] });
    expect(again.error).toEqual({ code: 'BILL_SPLIT_INVALID', details: { reason: 'units_missing', order_item_id: 'N2' } });
  });
});

// ================================================================================================= amount / equal

describe('[05 §6.5, §3.8] SetSplits — amount and equal', () => {
  beforeEach(() => start());

  it('[05 #8] amount: Σ shares ≠ the open remainder default-class total → shares_sum { expected_minor }; = → BillSplitsSet { share_minor }', async () => {
    const { seating_id } = seated([{ order_item_id: 'K', item_id: FX.piece }, { order_item_id: 'N', item_id: FX.naan, quantity: 3 }]);
    const total = (await view({ seating_id })).totals_default.total_minor;
    const bad = await setSplits({ bill_ref: { seating_id }, mode: 'amount', splits: [{ split_no: 1, share_minor: 1_000 }, { split_no: 2, share_minor: total - 999 }] });
    expect(bad.status).toBe(422);
    expect(bad.error).toEqual({ code: 'BILL_SPLIT_INVALID', details: { reason: 'shares_sum', expected_minor: total } });
    const ok = await setSplits({ bill_ref: { seating_id }, mode: 'amount', splits: [{ split_no: 2, share_minor: total - 1_000 }, { split_no: 1, share_minor: 1_000 }] });
    expect(ok.error).toBeUndefined();
    expect(ok.events.map((e) => e.event_type)).toEqual(['BillOpened', 'BillSplitsSet']);
    expect(ok.events[1]!.payload).toEqual({
      bill_id: ok.events[0]!.stream_id,
      mode: 'amount',
      splits: [
        { split_no: 1, lines: null, share_minor: 1_000 },
        { split_no: 2, lines: null, share_minor: total - 1_000 },
      ],
    });
    const v = await view({ seating_id });
    expect(v.splits.map((s) => s.plan)).toEqual([{ share_minor: 1_000 }, { share_minor: total - 1_000 }]);
    expect(ok.result).toEqual({ bill_id: ok.events[0]!.stream_id, splits: v.splits });
    expect(sum(v.splits.map((s) => s.totals.cash.subtotal_minor))).toBe(v.totals_default.subtotal_minor);
  });

  it('[05 #8] equal into 3 of Rs 1,000.00 → 333.33 / 333.33 / 333.34 net shares (remainder to the last split, §3.5); plan { n, k }', async () => {
    const { seating_id } = seated([{ order_item_id: 'L', item_id: VX.drink, quantity: 4 }]); // 4 × 250.00, untaxed
    const r = await setSplits({ bill_ref: { seating_id }, mode: 'equal', n: 3 });
    expect(r.error).toBeUndefined();
    expect(r.events[1]!.payload).toEqual({
      bill_id: r.events[0]!.stream_id,
      mode: 'equal',
      splits: [1, 2, 3].map((split_no) => ({ split_no, lines: null, share_minor: null })),
    });
    const v = await view({ seating_id });
    expect(subtotals(v)).toEqual([[1, 33_333], [2, 33_333], [3, 33_334]]);
    expect(v.splits.map((s) => s.plan)).toEqual([{ n: 3, k: 1 }, { n: 3, k: 2 }, { n: 3, k: 3 }]);
    expect(r.result).toEqual({ bill_id: r.events[0]!.stream_id, splits: v.splits });
  });

  it('[05 #8, H1-22] a later round re-bases the last open amount share; the other shares stay', async () => {
    const { seating_id } = seated([{ order_item_id: 'L', item_id: VX.drink, quantity: 4 }]); // 100 000, untaxed
    const r = await setSplits({ bill_ref: { seating_id }, mode: 'amount', splits: [{ split_no: 1, share_minor: 30_000 }, { split_no: 2, share_minor: 70_000 }] });
    expect(r.error).toBeUndefined();
    round(seating_id, [{ order_item_id: 'L2', item_id: VX.drink, quantity: 1 }]); // + 25 000
    const v = await view({ seating_id });
    expect(v.totals_default.total_minor).toBe(125_000);
    expect(v.splits.map((s) => s.totals.cash.total_minor)).toEqual([30_000, 95_000]);
    expect(v.splits.map((s) => s.plan)).toEqual([{ share_minor: 30_000 }, { share_minor: 70_000 }]);
    expect(v.blocks.filter((b) => b.reason === 'shares_sum')).toEqual([]);
  });

  it('[05 #8, R-52] equal: a later round is spread equally over the n splits (not absorbed by the highest)', async () => {
    const { seating_id } = seated([{ order_item_id: 'L', item_id: VX.drink, quantity: 4 }]); // 100 000, untaxed
    expect((await setSplits({ bill_ref: { seating_id }, mode: 'equal', n: 2 })).error).toBeUndefined();
    expect(subtotals(await view({ seating_id }))).toEqual([[1, 50_000], [2, 50_000]]);
    round(seating_id, [{ order_item_id: 'L2', item_id: VX.drink, quantity: 1 }]); // + 25 000
    const v = await view({ seating_id });
    expect(subtotals(v)).toEqual([[1, 62_500], [2, 62_500]]);
    expect(v.splits.map((s) => s.plan)).toEqual([{ n: 2, k: 1 }, { n: 2, k: 2 }]);
  });

  it('[05 #8] shares_sum expects the default-class total with a service charge, rounding on and tax-inclusive prices', async () => {
    swapBranchConfig(null);
    await hub.close();
    const doc = billingDoc({ sc_bp: 1_000, rounding: true });
    await start(SnapshotBillingSchema.parse({ ...doc, jurisdiction: { ...doc.jurisdiction, rules: doc.jurisdiction.rules.map((x) => ({ ...x, prices_include_tax: true })) } }));
    const { seating_id } = seated([{ order_item_id: 'K', item_id: FX.piece }, { order_item_id: 'N', item_id: FX.naan, quantity: 3 }, { order_item_id: 'L', item_id: VX.drink }]);
    const v = await view({ seating_id });
    expect(v.prices_include_tax).toBe(true);
    expect(v.totals_default.service_charge_minor).toBeGreaterThan(0);
    const total = v.totals_default.total_minor;
    expect(total % 100).toBe(0); // rounding step 100
    const off = await setSplits({ bill_ref: { seating_id }, mode: 'amount', splits: [{ split_no: 1, share_minor: 100 }, { split_no: 2, share_minor: total - 99 }] });
    expect(off.error).toEqual({ code: 'BILL_SPLIT_INVALID', details: { reason: 'shares_sum', expected_minor: total } });
    const ok = await setSplits({ bill_ref: { seating_id }, mode: 'amount', splits: [{ split_no: 1, share_minor: 100 }, { split_no: 2, share_minor: total - 100 }] });
    expect(ok.error).toBeUndefined();
    const after = await view({ seating_id });
    expect(ok.result).toEqual({ bill_id: ok.events[0]!.stream_id, splits: after.splits });
  });

  it('[05 #8, §3.1] a pending void comes off the base: shares_sum expects 100 000 − refund_minor; the open splits sum to it', async () => {
    const { seating_id, order_id } = seated([{ order_item_id: 'L', item_id: VX.drink, quantity: 4 }]); // 4 × 25 000, untaxed, no SC, no rounding
    const raised = raiseVoid(hub, { requester: waiter, order_id, order_item_id: 'L', units: 1 });
    const refund = raised.values.refund_minor;
    expect(refund).toBe(25_000);
    const expected = 100_000 - refund;
    const off = await setSplits({ bill_ref: { seating_id }, mode: 'amount', splits: [{ split_no: 1, share_minor: 50_000 }, { split_no: 2, share_minor: 50_000 }] });
    expect(off.error).toEqual({ code: 'BILL_SPLIT_INVALID', details: { reason: 'shares_sum', expected_minor: expected } });
    const ok = await setSplits({ bill_ref: { seating_id }, mode: 'amount', splits: [{ split_no: 1, share_minor: 30_000 }, { split_no: 2, share_minor: expected - 30_000 }] });
    expect(ok.error).toBeUndefined();
    const splits = (ok.result as { splits: BillView['splits'] }).splits;
    expect(splits.map((x) => [x.split_no, x.totals.as_paid.subtotal_minor])).toEqual([[1, 30_000], [2, 45_000]]);
  });

  it('[05 §6.5, reading] equal n above the free split numbers in 1–20 → 400 VALIDATION_FAILED { path: n }', async () => {
    const { seating_id } = seated([{ order_item_id: 'L', item_id: VX.drink, quantity: 4 }]);
    const r = await setSplits({ bill_ref: { seating_id }, mode: 'amount', splits: [{ split_no: 1, share_minor: 40_000 }, { split_no: 2, share_minor: 60_000 }] });
    const bill_id = r.events[0]!.stream_id;
    closeInTest(bill_id, 1, [{ order_item_id: 'L', units: 4, base_minor: 40_000 }], ['L']);
    const over = await setSplits({ bill_ref: { bill_id }, mode: 'equal', n: 20 });
    expect(over.status).toBe(400);
    expect(over.error?.code).toBe('VALIDATION_FAILED');
    expect((over.error?.details as { issues: Array<{ path: string }> }).issues.map((i) => i.path)).toEqual(['n']);
    expect((await setSplits({ bill_ref: { bill_id }, mode: 'equal', n: 19 })).error).toBeUndefined();
  });

  it('[05 §6.5] none: the open remainder as one split; split_mode cleared', async () => {
    const { seating_id } = seated([{ order_item_id: 'L', item_id: VX.drink, quantity: 4 }]);
    await setSplits({ bill_ref: { seating_id }, mode: 'equal', n: 2 });
    const r = await setSplits({ bill_ref: { seating_id }, mode: 'none' });
    expect(r.error).toBeUndefined();
    expect(r.events.map((e) => e.event_type)).toEqual(['BillSplitsSet']);
    expect(r.events[0]!.payload).toMatchObject({ mode: 'none', splits: [{ split_no: 1, lines: null, share_minor: null }] });
    const v = await view({ seating_id });
    expect(v.splits.map((s) => [s.split_no, s.plan])).toEqual([[1, null]]);
    expect(v.splits[0]!.totals.cash.total_minor).toBe(100_000);
  });
});

// ================================================================================================= payments, closes

describe('[05 §6.5, §3.8, G0-4] SetSplits — paid and closed splits', () => {
  beforeEach(() => start());

  async function amountBill(): Promise<{ seating_id: string; bill_id: string }> {
    const { seating_id } = seated([{ order_item_id: 'L', item_id: VX.drink, quantity: 4 }]); // 100 000
    const r = await setSplits({ bill_ref: { seating_id }, mode: 'amount', splits: [{ split_no: 1, share_minor: 40_000 }, { split_no: 2, share_minor: 60_000 }] });
    expect(r.error).toBeUndefined();
    return { seating_id, bill_id: r.events[0]!.stream_id };
  }

  it('[05 #9] a re-plan keeps a paid split number; dropping it → 409 BILL_HAS_PAYMENTS { split_nos }', async () => {
    const { bill_id } = await amountBill();
    pay(bill_id, 2, 10_000);
    const drop = await setSplits({ bill_ref: { bill_id }, mode: 'amount', splits: [{ split_no: 1, share_minor: 50_000 }, { split_no: 3, share_minor: 50_000 }] });
    expect(drop.status).toBe(409);
    expect(drop.error).toEqual({ code: 'BILL_HAS_PAYMENTS', details: { bill_id, split_nos: [2] } });
    const eq = await setSplits({ bill_ref: { bill_id }, mode: 'equal', n: 2 });
    expect(eq.error).toBeUndefined();
    const keep = await setSplits({ bill_ref: { bill_id }, mode: 'amount', splits: [{ split_no: 2, share_minor: 50_000 }, { split_no: 3, share_minor: 50_000 }] });
    expect(keep.error).toBeUndefined();
    const v = await view({ bill_id });
    expect(v.splits.map((s) => [s.split_no, s.payments.length])).toEqual([[2, 1], [3, 0]]);
    expect(keep.result).toEqual({ bill_id, splits: v.splits });
  });

  it('[05 #9, R-53] a paid split keeps only its number: an amount re-plan changes its share', async () => {
    const { bill_id } = await amountBill();
    pay(bill_id, 2, 10_000);
    const r = await setSplits({ bill_ref: { bill_id }, mode: 'amount', splits: [{ split_no: 1, share_minor: 70_000 }, { split_no: 2, share_minor: 30_000 }] });
    expect(r.error).toBeUndefined();
    expect(r.events[0]!.payload).toMatchObject({ mode: 'amount', splits: [{ split_no: 1, share_minor: 70_000 }, { split_no: 2, share_minor: 30_000 }] });
    const v = await view({ bill_id });
    expect(v.splits.map((s) => [s.split_no, s.plan, s.payments.map((x) => x.amount_minor), s.totals.cash.total_minor])).toEqual([
      [1, { share_minor: 70_000 }, [], 70_000],
      [2, { share_minor: 30_000 }, [10_000], 30_000],
    ]);
    expect(v.splits[1]!.balance_minor).toBe(20_000);
    expect(r.result).toEqual({ bill_id, splits: v.splits });
  });

  it('[05 #9, §6.5] none only when at most one open split has payments; it keeps the paid number', async () => {
    const { bill_id } = await amountBill();
    pay(bill_id, 2, 10_000);
    const one = await setSplits({ bill_ref: { bill_id }, mode: 'none' });
    expect(one.error).toBeUndefined();
    expect(one.events[0]!.payload).toMatchObject({ mode: 'none', splits: [{ split_no: 2 }] });
    await setSplits({ bill_ref: { bill_id }, mode: 'amount', splits: [{ split_no: 1, share_minor: 40_000 }, { split_no: 2, share_minor: 60_000 }] });
    pay(bill_id, 1, 10_000);
    const two = await setSplits({ bill_ref: { bill_id }, mode: 'none' });
    expect(two.status).toBe(409);
    expect(two.error).toEqual({ code: 'BILL_HAS_PAYMENTS', details: { bill_id, split_nos: [1, 2] } });
  });

  it('[05 #9, B15] after a close only the open remainder re-plans: naming the closed split → split_closed; equal skips its number; it keeps its plan', async () => {
    const { bill_id } = await amountBill();
    // split 1 closes at 40 000 (an amount split freezes every line's live units, H1-27)
    closeInTest(bill_id, 1, [{ order_item_id: 'L', units: 4, base_minor: 40_000 }], ['L']);
    const named = await setSplits({ bill_ref: { bill_id }, mode: 'amount', splits: [{ split_no: 1, share_minor: 30_000 }, { split_no: 2, share_minor: 30_000 }] });
    expect(named.status).toBe(422);
    expect(named.error).toEqual({ code: 'BILL_SPLIT_INVALID', details: { reason: 'split_closed' } });
    // the open remainder's default-class total is 60 000
    const bad = await setSplits({ bill_ref: { bill_id }, mode: 'amount', splits: [{ split_no: 2, share_minor: 30_000 }, { split_no: 3, share_minor: 40_000 }] });
    expect(bad.error).toEqual({ code: 'BILL_SPLIT_INVALID', details: { reason: 'shares_sum', expected_minor: 60_000 } });
    const eq = await setSplits({ bill_ref: { bill_id }, mode: 'equal', n: 3 });
    expect(eq.error).toBeUndefined();
    expect(eq.events[0]!.payload).toMatchObject({ splits: [{ split_no: 2 }, { split_no: 3 }, { split_no: 4 }] });
    const v = await view({ bill_id });
    expect(v.splits.map((s) => [s.split_no, s.state, s.plan])).toEqual([
      [1, 'closed', { share_minor: 40_000 }],
      [2, 'open', { n: 3, k: 1 }],
      [3, 'open', { n: 3, k: 2 }],
      [4, 'open', { n: 3, k: 3 }],
    ]);
    expect(subtotals(v)).toEqual([[1, 40_000], [2, 20_000], [3, 20_000], [4, 20_000]]);
    expect(eq.result).toEqual({ bill_id, splits: v.splits });
    // none after a close: one open split, the closed one untouched
    const none = await setSplits({ bill_ref: { bill_id }, mode: 'none' });
    expect(none.events[0]!.payload).toMatchObject({ splits: [{ split_no: 2 }] });
    expect((await view({ bill_id })).splits.map((s) => [s.split_no, s.state])).toEqual([[1, 'closed'], [2, 'open']]);
  });

  it('[05 §3.8, B15] a closed split keeps its own plan: an items-closed split shows its item plan after an amount re-plan', async () => {
    const { seating_id } = seated([{ order_item_id: 'K', item_id: FX.piece }, { order_item_id: 'N', item_id: FX.naan, quantity: 2 }]);
    const r = await setSplits({ bill_ref: { seating_id }, mode: 'items', splits: [{ split_no: 1, lines: [{ order_item_id: 'N', units: 2 }] }, { split_no: 2, lines: [{ order_item_id: 'K', units: 1 }] }] });
    expect(r.error).toBeUndefined();
    const bill_id = r.events[0]!.stream_id;
    closeInTest(bill_id, 1, [{ order_item_id: 'N', units: 2, base_minor: 6_000 }], ['K', 'N']);
    const total = (await view({ bill_id })).totals_default.total_minor;
    const amount = await setSplits({ bill_ref: { bill_id }, mode: 'amount', splits: [{ split_no: 2, share_minor: 1 }, { split_no: 3, share_minor: total - 1 }] });
    expect(amount.error).toBeUndefined();
    const v = await view({ bill_id });
    expect(v.splits.map((s) => [s.split_no, s.state, s.plan])).toEqual([
      [1, 'closed', { lines: [{ order_item_id: 'N', units: 2 }] }],
      [2, 'open', { share_minor: 1 }],
      [3, 'open', { share_minor: total - 1 }],
    ]);
    expect(amount.result).toEqual({ bill_id, splits: v.splits });
  });

  it('[05 §6.5, §6.1] with a discount, a pending void and a service charge on a closed split: result = view; rebuild = live', async () => {
    swapBranchConfig(null);
    await hub.close();
    await start(billingDoc({ sc_bp: 1_000, rounding: true }));
    const { seating_id, order_id } = seated([{ order_item_id: 'L', item_id: VX.drink, quantity: 4 }, { order_item_id: 'N', item_id: FX.naan, quantity: 3 }]);
    const r = await setSplits({ bill_ref: { seating_id }, mode: 'items', splits: [{ split_no: 1, lines: [{ order_item_id: 'L', units: 4 }] }, { split_no: 2, lines: [{ order_item_id: 'N', units: 3 }] }] });
    expect(r.error).toBeUndefined();
    const bill_id = r.events[0]!.stream_id;
    appendBill(bill_id, [{ def: DiscountApplied as unknown as EventDef<z.ZodType>, payload: { ...(aDiscountApplied().payload as object), bill_id, kind: 'amount', value: 10_000, amount_minor: 10_000 } }]);
    // split 1 closes with its discount share and a service charge; the discount freezes
    closeInTest(bill_id, 1, [{ order_item_id: 'L', units: 4, base_minor: 100_000, discount_minor: 9_174 }], ['L', 'N'], { sc_minor: 9_083 });
    appendBill(bill_id, [{ def: DiscountFrozen as unknown as EventDef<z.ZodType>, payload: { bill_id, frozen_minor: 10_000, line_ids: ['L', 'N'] } }]);
    raiseVoid(hub, { requester: waiter, order_id, order_item_id: 'N', units: 1 });
    const before = await view({ bill_id });
    expect(before.lines.find((l) => l.order_item_id === 'N')!.tags).toContain('pending_void');
    expect(before.splits[0]!.totals.as_paid.service_charge_minor).toBe(9_083);
    const eq = await setSplits({ bill_ref: { bill_id }, mode: 'equal', n: 2 });
    expect(eq.error).toBeUndefined();
    const live = await view({ bill_id });
    expect(eq.result).toEqual({ bill_id, splits: live.splits });
    expect(live.splits.map((s) => s.split_no)).toEqual([1, 2, 3]);
    expect(live.discount!.discount_minor).toBe(10_000);
    const am = await setSplits({ bill_ref: { bill_id }, mode: 'amount', splits: [{ split_no: 2, share_minor: 1_000 }, { split_no: 3, share_minor: live.totals_default.total_minor - 1_000 }] });
    expect(am.error).toBeUndefined();
    const liveAmount = await view({ bill_id });
    expect(am.result).toEqual({ bill_id, splits: liveAmount.splits });
    const tables = splitTables();
    rebuildBilling();
    expect(splitTables()).toEqual(tables);
    expect(await view({ bill_id })).toEqual(liveAmount);
  });

  it('[05 §6.5] a closed bill → 409 BILL_NOT_OPEN; an unknown bill → 404 BILL_NOT_FOUND', async () => {
    const { bill_id } = await amountBill();
    closeInTest(bill_id, 1, [{ order_item_id: 'L', units: 4, base_minor: 40_000 }], ['L']);
    closeInTest(bill_id, 2, [{ order_item_id: 'L', units: 4, base_minor: 60_000 }], null);
    const r = await setSplits({ bill_ref: { bill_id }, mode: 'equal', n: 2 });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'BILL_NOT_OPEN', details: { bill_id, state: 'closed' } });
    expect((await setSplits({ bill_ref: { bill_id: 'NOPE' }, mode: 'equal', n: 2 })).error).toEqual({ code: 'BILL_NOT_FOUND', details: { bill_id: 'NOPE' } });
  });
});

// ================================================================================================= envelope

describe('[05 §6.5] SetSplits — Zod, permission, scope, idempotency, statements', () => {
  beforeEach(() => start());

  it('[05 §6.5] Zod: splits 2–20 with distinct split_no; lines for items, share_minor for amount, n 2–20 for equal only', async () => {
    const { seating_id } = seated([{ order_item_id: 'N', item_id: FX.naan, quantity: 2 }]);
    const bad = [
      { mode: 'items', splits: [{ split_no: 1, lines: [{ order_item_id: 'N', units: 2 }] }] },
      { mode: 'items', splits: [{ split_no: 1, lines: [{ order_item_id: 'N', units: 1 }] }, { split_no: 1, lines: [{ order_item_id: 'N', units: 1 }] }] },
      { mode: 'items', splits: [{ split_no: 1, lines: [{ order_item_id: 'N', units: 1 }, { order_item_id: 'N', units: 1 }] }, { split_no: 2, lines: [{ order_item_id: 'N', units: 0 }] }] },
      { mode: 'items', splits: [{ split_no: 1, share_minor: 1 }, { split_no: 2, share_minor: 1 }] },
      { mode: 'amount', splits: [{ split_no: 1, share_minor: 0 }, { split_no: 2, share_minor: 1 }] },
      { mode: 'amount', splits: [{ split_no: 1, lines: [{ order_item_id: 'N', units: 1 }] }, { split_no: 2, share_minor: 1 }] },
      { mode: 'equal' },
      { mode: 'equal', n: 1 },
      { mode: 'equal', n: 21 },
      { mode: 'equal', n: 2, splits: [{ split_no: 1 }, { split_no: 2 }] },
      { mode: 'none', n: 2 },
      { mode: 'amount', splits: Array.from({ length: 21 }, (_, i) => ({ split_no: i + 1, share_minor: 1 })) },
    ];
    for (const p of bad) {
      const r = await setSplits({ bill_ref: { seating_id }, ...p });
      expect(r.status, JSON.stringify(p)).toBe(400);
      expect(r.error?.code).toBe('VALIDATION_FAILED');
    }
  });

  it('[05 §6.5, C8] take-payment first (403); the scope last, after the plan checks (outside_scope)', async () => {
    // the cashier holds the seating; the order taker's take-payment is own_tables
    const { seating_id } = seated([{ order_item_id: 'N', item_id: FX.naan, quantity: 2 }], { holder: STAFF.cashier });
    const invalid = await setSplits({ bill_ref: { seating_id }, mode: 'items', splits: [{ split_no: 1, lines: [{ order_item_id: 'N', units: 1 }] }, { split_no: 2, lines: [{ order_item_id: 'N', units: 2 }] }] }, waiter);
    expect(invalid.error?.code).toBe('BILL_SPLIT_INVALID');
    const outside = await setSplits({ bill_ref: { seating_id }, mode: 'equal', n: 2 }, waiter);
    expect(outside.status).toBe(403);
    expect(outside.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: [VX.tables.T4] } });
    // no take-payment at all → 403 before any read
    const dir = await billingDirectory({ directory_version: 2 });
    await seedDirectory(hub, { ...dir, roles: dir.roles.map((r) => (r.role_id === 'R_WAIT' ? { ...r, permissions: r.permissions.filter((g) => g.permission !== 'take-payment') } : r)) });
    handled.count = -1;
    const none = await setSplits({ bill_ref: { seating_id }, mode: 'equal', n: 2 }, signIn(hub, STAFF.orderTaker));
    expect(none.status).toBe(403);
    expect(none.error?.code).toBe('PERMISSION_DENIED');
    expect(handled.count).toBe(-1);
    expect(hub.deps.db.prepare(`SELECT COUNT(*) FROM events WHERE stream_type = 'bill'`).pluck().get()).toBe(0);
  });

  it('[05 §6, D32] a retransmit with the same command_id returns the stored response and writes nothing', async () => {
    const { seating_id } = seated([{ order_item_id: 'N', item_id: FX.naan, quantity: 2 }]);
    const first = await setSplits({ bill_ref: { seating_id }, mode: 'equal', n: 2 }, cashier, 'cmd-split-1');
    const count = () => hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number;
    const n = count();
    const again = await setSplits({ bill_ref: { seating_id }, mode: 'equal', n: 2 }, cashier, 'cmd-split-1');
    expect(again.status).toBe(200);
    expect(again.result).toEqual(first.result);
    expect(count()).toBe(n);
  });

  it('[05 §6.5] ≤ 5 statements, the same at 2 lines / 2 splits and at 40 lines / 20 splits (items, amount, equal, none)', async () => {
    const small = seated([{ order_item_id: 'A0', item_id: FX.naan }, { order_item_id: 'A1', item_id: FX.naan }], { seating_id: 'SEAT_A' });
    const bigLines = Array.from({ length: 40 }, (_, i) => ({ order_item_id: `B${i}`, item_id: FX.naan }));
    const big = seated(bigLines.slice(0, 20), { seating_id: 'SEAT_B', table_id: VX.tables.T5 });
    round(big.seating_id, bigLines.slice(20));
    const counts = async (seating_id: string, ids: string[], nSplits: number): Promise<number[]> => {
      const out: number[] = [];
      const per = (k: number) => ids.filter((_, i) => i % nSplits === k);
      const items = await setSplits({ bill_ref: { seating_id }, mode: 'items', splits: Array.from({ length: nSplits }, (_, k) => ({ split_no: k + 1, lines: per(k).map((order_item_id) => ({ order_item_id, units: 1 })) })) });
      expect(items.error).toBeUndefined();
      out.push(handled.count);
      const total = (await view({ seating_id })).totals_default.total_minor;
      const shares = Array.from({ length: nSplits }, (_, k) => (k === nSplits - 1 ? total - (nSplits - 1) : 1));
      const amount = await setSplits({ bill_ref: { seating_id }, mode: 'amount', splits: shares.map((share_minor, k) => ({ split_no: k + 1, share_minor })) });
      expect(amount.error).toBeUndefined();
      out.push(handled.count);
      expect((await setSplits({ bill_ref: { seating_id }, mode: 'equal', n: nSplits })).error).toBeUndefined();
      out.push(handled.count);
      expect((await setSplits({ bill_ref: { seating_id }, mode: 'none' })).error).toBeUndefined();
      out.push(handled.count);
      return out;
    };
    const a = await counts(small.seating_id, ['A0', 'A1'], 2);
    const b = await counts(big.seating_id, bigLines.map((l) => l.order_item_id), 20);
    expect(a).toEqual(b);
    // the first call opens the bill (ensure bill; no splits row to read yet): 4; every later one 5
    expect(a).toEqual([4, 5, 5, 5]);
  });
});
