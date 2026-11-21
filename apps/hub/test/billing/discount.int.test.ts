// 05 §6.6 `ApplyDiscount` (approvable) and §6.7 `RemoveDiscount`, B7, §3.5 (2), §3.14 kind `discount` (its re-check
// on approve only, H7-5), §6.29 (`DiscountApplied.replaces`, `DiscountRemoved { bill_id, reason_code, has_note,
// note_id }`), §9 (`BILL_PARTLY_PAID`, `DISCOUNT_PENDING`, `DISCOUNT_TOO_LARGE`) — task 13; 05-plan §3 row 13.
// Tests #16 (command half) and #17. Real events through the hub's writer, the real `billing` fold, the commands over
// HTTP as the client posts them, the approval answered through 01d's `AnswerRequest` with the Manager's PIN. Totals
// are read back from `GET /queries/bill` with exact amounts. A split close (task 17) is stood in for by its folded
// events (`InvoiceIssued` + `DiscountFrozen`, task 5's builders), as set-splits.int.test.ts does.
import {
  BillClosedEmpty,
  BillReopened,
  DiscountFrozen,
  draftOf,
  InvoiceIssued,
  rateBpRates,
  SnapshotBillingSchema,
  type BranchConfig,
  type EventDef,
  type PosEvent,
  type SnapshotBilling,
} from '@pos/events';
import { aBillReopened, anInvoiceIssued } from '@pos/events/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { kindOf, type AlertApplyCtx } from '../../src/alerts/kinds';
import { alerts } from '../../src/alerts/raise';
import { currentDirectory } from '../../src/auth/guards';
import { hubBilling } from '../../src/billing/defaults';
import { billingProjection } from '../../src/billing/projections/billing';
import type { BillView, Totals } from '../../src/billing/queries/bill';
import type { CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { readOnlyTx } from '../../src/engine-host/read-only-tx';
import { createProjectionRegistry } from '../../src/projections/registry';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { seedDirectory, type TestHub } from '../helpers/test-hub';
import { openDay, voidsMenu } from '../voids/fixtures';
import { answer, appendOrder, billingDirectory, FX, openSeating, post, raiseVoid, signIn, STAFF, startBilling, takeawayOrder, VX, type Reply, type Who } from './fixtures';

let hub: TestHub;
let cashier: Who;
let manager: Who;
let waiter: Who;
let counter: ReturnType<typeof statementCounter>;

const FOOD = 'tc-food';
/** 1 000.00 and 30.00 (PKR, exponent 2): the menu prices of the two taxed items below */
const BIG = 100_000;
const SMALL = 3_000;

// ------------------------------------------------------------------------------------------------ set-up

/** The PK built-in document (rounding Rs 1 nearest, applies to all), food at 1 600 bp exclusive, no service charge. */
function billingDoc(o: { max_discount_pct?: number; sc_bp?: number } = {}): SnapshotBilling {
  const pk = hubBilling({ currency_code: 'PKR', tax_classes: [], billing: undefined });
  return SnapshotBillingSchema.parse({
    ...pk.settings,
    max_discount_pct: o.max_discount_pct ?? pk.settings.max_discount_pct,
    service_charge_bp: { ...pk.settings.service_charge_bp, dine_in: o.sc_bp ?? 0 },
    jurisdiction: { ...pk.jurisdiction, rules: pk.jurisdiction.rules.map((r) => ({ ...r, buyer_id: { ...r.buyer_id, threshold_minor: null } })) },
    tax_profiles: [{ tax_class_id: FOOD, taxes: [{ seq: 1, tax_code: 'TAX', label: 'Sales tax', compound: false, rates: rateBpRates(1_600) }] }],
  });
}

/** voidsMenu() with the naan at 1 000.00 and the raita at 30.00, both taxed food (plain piece items, no stock). */
function menu(billing: SnapshotBilling = billingDoc()): BranchConfig {
  const m = voidsMenu();
  return {
    ...m,
    tax_enabled: true,
    tax_classes: [{ tax_class_id: FOOD, name: 'Sales tax', rate_bp: 1_600, is_archived: false, fiscal_category: 'restaurant_service' }],
    items: m.items.map((i) =>
      i.item_id === FX.naan ? { ...i, price_minor: BIG, tax_class_id: FOOD } : i.item_id === FX.optionItem ? { ...i, price_minor: SMALL, tax_class_id: FOOD } : i,
    ),
    billing,
  };
}

/** Each named command's handler statements of its last call (set-splits.int.test.ts pattern). */
const handled: Record<string, number> = {};

function countHandler(path: string): void {
  const def = commandRegistry(hub.app).byPath(path) as CommandDef | undefined;
  if (def === undefined) return; // not registered: every call answers 404 (the failing-first state)
  const original = def.handle;
  def.handle = (ctx, payload, cmd) => {
    counter.reset();
    try {
      return original.call(def, ctx, payload, cmd);
    } finally {
      handled[path] = counter.count;
    }
  };
}

async function start(billing?: SnapshotBilling): Promise<void> {
  hub = await startBilling({ open: false });
  openDay(hub, { menu: menu(billing), stock: { [FX.stock]: 0, [VX.naanStock]: 0 } });
  cashier = signIn(hub, STAFF.cashier);
  manager = signIn(hub, STAFF.manager);
  waiter = signIn(hub, STAFF.orderTaker);
  counter = statementCounter(hub.deps.db);
  countHandler('apply-discount');
  countHandler('remove-discount');
}

afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

// ------------------------------------------------------------------------------------------------ helpers

const apply = (who: Who, payload: Record<string, unknown>, commandId?: string): Promise<Reply> => post(hub, who, 'apply-discount', 'ApplyDiscount', payload, commandId);
const removeD = (who: Who, payload: Record<string, unknown>): Promise<Reply> => post(hub, who, 'remove-discount', 'RemoveDiscount', payload);

async function view(qs: Record<string, string>): Promise<BillView> {
  const res = await hub.app.inject({ method: 'GET', url: `/queries/bill?${new URLSearchParams(qs).toString()}`, headers: { authorization: `Bearer ${cashier.token}`, 'x-session-token': cashier.sessionToken } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: BillView }).data;
}

function eventsOf(type: string): PosEvent[] {
  return (hub.deps.db.prepare('SELECT * FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<Record<string, unknown>>).map(
    (row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent,
  );
}

function discountJson(bill_id: string): unknown {
  const r = hub.deps.db.prepare('SELECT discount_json FROM bills WHERE bill_id = ?').get(bill_id) as { discount_json: string | null };
  return r.discount_json === null ? null : JSON.parse(r.discount_json);
}

function textOf(subject_id: string): string | undefined {
  return (hub.deps.db.prepare(`SELECT text FROM bill_texts WHERE subject_id = ? AND field = 'note'`).get(subject_id) as { text: string } | undefined)?.text;
}

function appendBill(bill_id: string, def: EventDef<z.ZodType>, payload: unknown): void {
  hub.clock.advance(1_000);
  const draft = draftOf(def, { stream_type: 'bill', stream_id: bill_id, payload: def.payload.parse(payload), occurred_at: hub.clock.branchNow(), actor_id: STAFF.manager, device_id: 'D_FIXTURE' });
  hub.deps.writer.run((tx) => tx.append([draft]));
}

function rebuildBilling(): void {
  hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'billing'`).run();
  const registry = createProjectionRegistry();
  registry.register(billingProjection());
  registry.catchUp(hub.deps.db, hub.deps.config.provisioned!.branch_id);
}

/** A seating at T4 with one round of the given lines (naan = BIG, raita = SMALL). */
function seated(lines: Array<{ id: string; item: 'big' | 'small' }>, o: { seating_id?: string; table_id?: string } = {}): { seating_id: string; order_id: string } {
  const seating_id = o.seating_id ?? 'SEAT_D';
  openSeating(hub, { table_id: o.table_id ?? VX.tables.T4, seating_id });
  const { order_id } = appendOrder(hub, {
    order_type: 'dine_in',
    seating_id,
    placed_by: STAFF.orderTaker,
    lines: lines.map((l) => ({ order_item_id: l.id, item_id: l.item === 'big' ? FX.naan : FX.optionItem })),
  });
  return { seating_id, order_id };
}

/** Two 1 000.00 lines: S = 200 000. The bill is opened by a refused-free direct ApplyDiscount when asked. */
const TWO_BIG = [
  { id: 'A', item: 'big' },
  { id: 'B', item: 'big' },
] as const;

/** Exclusive totals of one profile at 1 600 bp with Rs 1 nearest rounding, no service charge: §3.5 by hand. */
function expectedTotals(subtotal: number, discount: number): Pick<Totals, 'subtotal_minor' | 'discount_minor' | 'rounding_minor' | 'total_minor'> & { tax: number; base: number } {
  const base = subtotal - discount;
  const tax = Math.floor((base * 1_600 + 5_000) / 10_000);
  const g = base + tax;
  const t = Math.floor((g + 50) / 100) * 100;
  return { subtotal_minor: subtotal, discount_minor: discount, base, tax, rounding_minor: t - g, total_minor: t };
}

function expectTotals(t: Totals, subtotal: number, discount: number): void {
  const e = expectedTotals(subtotal, discount);
  expect(t).toMatchObject({ subtotal_minor: e.subtotal_minor, discount_minor: e.discount_minor, service_charge_minor: 0, rounding_minor: e.rounding_minor, total_minor: e.total_minor });
  expect(t.taxes.map((x) => [x.tax_profile_id, x.payment_class, x.rate_bp, x.base_minor, x.tax_minor])).toEqual([[FOOD, 'cash', 1_600, e.base, e.tax]]);
}

let invoiceNo = 0;
/** In-test first close of split 1 (task 17 not built): its InvoiceIssued and, right after, DiscountFrozen (R-41). */
function closeSplit1(bill_id: string, lines: Array<{ order_item_id: string; base_minor: number; discount_minor: number }>, frozen: number, line_ids: string[]): void {
  invoiceNo += 1;
  const base = anInvoiceIssued().payload as { lines: Array<Record<string, unknown>>; fiscal: Record<string, unknown> } & Record<string, unknown>;
  const subtotal = lines.reduce((a, l) => a + l.base_minor, 0);
  const discount = lines.reduce((a, l) => a + l.discount_minor, 0);
  appendBill(bill_id, InvoiceIssued as unknown as EventDef<z.ZodType>, {
    ...base,
    invoice_id: `INV_D${invoiceNo}`,
    number: invoiceNo,
    invoice_ref: `T-D${String(invoiceNo).padStart(6, '0')}`,
    bill_id,
    split_no: 1,
    lines: lines.map((l) => ({ ...base.lines[0], order_item_id: l.order_item_id, units: 1, base_minor: l.base_minor, discount_minor: l.discount_minor, unit_price_minor: 0, taxes: [] })),
    service_charge: null,
    subtotal_minor: subtotal,
    discount_minor: discount,
    service_charge_minor: 0,
    taxes: [],
    rounding_minor: 0,
    total_minor: subtotal - discount,
    payment_ids: [],
    change_minor: 0,
    discount_line_ids: line_ids,
    fiscal: { ...base.fiscal, adapter_key: 'none', required: false, pos_id: null, payment_codes: [] },
  });
  appendBill(bill_id, DiscountFrozen as unknown as EventDef<z.ZodType>, { bill_id, frozen_minor: frozen, line_ids });
}

/** A two-split item bill (A | B) with 10 % applied, then split 1 closed and the discount frozen at 20 000 (#16d shape). */
async function partlyPaid(): Promise<{ seating_id: string; bill_id: string }> {
  const { seating_id } = seated([...TWO_BIG]);
  const d = await apply(manager, { bill_ref: { seating_id }, kind: 'percent', value: 1_000, reason_code: 'regular_customer' });
  expect(d.status).toBe(200);
  const bill_id = d.result!.bill_id as string;
  const s = await post(hub, cashier, 'set-splits', 'SetSplits', {
    bill_ref: { bill_id },
    mode: 'items',
    splits: [
      { split_no: 1, lines: [{ order_item_id: 'A', units: 1 }] },
      { split_no: 2, lines: [{ order_item_id: 'B', units: 1 }] },
    ],
  });
  expect(s.status).toBe(200);
  closeSplit1(bill_id, [{ order_item_id: 'A', base_minor: BIG, discount_minor: 10_000 }], 20_000, ['A', 'B']);
  expect((await view({ bill_id })).state).toBe('partly_paid');
  return { seating_id, bill_id };
}

const pendingOf = (r: Reply): string => (r.result!.pending as { alert_id: string }).alert_id;

// ================================================================================================= ApplyDiscount, direct

describe('[05 §6.6, B7, #16] ApplyDiscount — direct (grant allowed)', () => {
  it('[05 #16 command half] amount 20 000 on S 200 000: DiscountApplied { amount_minor 20 000, replaces false }; result.applied = the view’s totals, exact', async () => {
    await start();
    const { seating_id } = seated([...TWO_BIG]);
    expectTotals((await view({ seating_id })).totals_default, 200_000, 0);
    const r = await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 20_000, reason_code: 'regular_customer' });
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['BillOpened', 'DiscountApplied']);
    const bill_id = r.events[0]!.stream_id;
    expect(r.events[1]).toMatchObject({ stream_type: 'bill', stream_id: bill_id, actor_id: STAFF.manager });
    expect(r.events[1]!.payload).toEqual({
      bill_id,
      kind: 'amount',
      value: 20_000,
      amount_minor: 20_000,
      reason_code: 'regular_customer',
      has_note: false,
      note_id: null,
      requester_staff_id: STAFF.manager,
      approver_staff_id: null,
      alert_id: null,
      replaces: false,
    });
    const v = await view({ bill_id });
    // net 180 000, tax 28 800, total 208 800 (a step multiple: rounding 0)
    expectTotals(v.totals_default, 200_000, 20_000);
    expect(v.totals_default.total_minor).toBe(208_800);
    expect(r.result).toEqual({ bill_id, applied: v.totals_default });
    expect(v.discount).toEqual({ kind: 'amount', value: 20_000, reason_code: 'regular_customer', frozen_minor: null, discount_minor: 20_000 });
    expect(discountJson(bill_id)).toEqual({ kind: 'amount', value: 20_000, reason_code: 'regular_customer', alert_id: null, frozen_minor: null });
  });

  it('[05 §3.5 (2)] percent 333 bp on 1 030.00: amount = floor(S × bp / 10 000) = 3 429, spread capped over both lines; tax after discount; rounding −2', async () => {
    await start();
    const { seating_id } = seated([
      { id: 'A', item: 'big' },
      { id: 'C', item: 'small' },
    ]);
    const r = await apply(manager, { bill_ref: { seating_id }, kind: 'percent', value: 333, reason_code: 'staff' });
    expect(r.status).toBe(200);
    expect(r.events[1]!.payload).toMatchObject({ kind: 'percent', value: 333, amount_minor: 3_429, replaces: false });
    const v = await view({ seating_id });
    // net 99 571, tax 15 931 (15 931.36 half up), G 115 502 → 115 500, R −2
    expectTotals(v.totals_default, 103_000, 3_429);
    expect(v.totals_default).toMatchObject({ rounding_minor: -2, total_minor: 115_500 });
    expect(r.result).toMatchObject({ applied: v.totals_default });
  });

  it('[05 §6.29] a second discount replaces the first: replaces true, the bill holds the new one only', async () => {
    await start();
    const { seating_id } = seated([...TWO_BIG]);
    await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 20_000, reason_code: 'regular_customer' });
    const r = await apply(manager, { bill_ref: { seating_id }, kind: 'percent', value: 500, reason_code: 'complaint' });
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['DiscountApplied']);
    expect(r.events[0]!.payload).toMatchObject({ kind: 'percent', value: 500, amount_minor: 10_000, replaces: true });
    expectTotals((await view({ seating_id })).totals_default, 200_000, 10_000);
  });

  it('[05 §6.6, H3-5] a note goes to bill_texts under a minted note_id; the event carries has_note / note_id only', async () => {
    await start();
    const { seating_id } = seated([...TWO_BIG]);
    const r = await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 100, reason_code: 'other', note: 'Birthday of the owner’s friend' });
    expect(r.status).toBe(200);
    const p = r.events[1]!.payload as { has_note: boolean; note_id: string };
    expect(p.has_note).toBe(true);
    expect(p.note_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(textOf(p.note_id)).toBe('Birthday of the owner’s friend');
    expect(JSON.stringify(r.events)).not.toContain('Birthday');
  });

  it('[05 §6.6] Zod: amount ≥ 1, percent 1–10 000 bp, an integer value, other needs a note, note ≤ 200 → 400, nothing written', async () => {
    await start();
    const { seating_id } = seated([...TWO_BIG]);
    const ref = { seating_id };
    const bad = [
      { bill_ref: ref, kind: 'amount', value: 0, reason_code: 'staff' },
      { bill_ref: ref, kind: 'percent', value: 0, reason_code: 'staff' },
      { bill_ref: ref, kind: 'percent', value: 10_001, reason_code: 'staff' },
      { bill_ref: ref, kind: 'amount', value: 10.5, reason_code: 'staff' },
      { bill_ref: ref, kind: 'free', value: 10, reason_code: 'staff' },
      { bill_ref: ref, kind: 'amount', value: 10, reason_code: 'other' },
      { bill_ref: ref, kind: 'amount', value: 10, reason_code: 'other', note: '  ' },
      { bill_ref: ref, kind: 'amount', value: 10, reason_code: 'staff', note: 'x'.repeat(201) },
      { bill_ref: ref, kind: 'amount', value: 10, reason_code: 'staff', split_no: 1 },
    ];
    for (const payload of bad) {
      const r = await apply(manager, payload);
      expect(r.status, JSON.stringify(payload)).toBe(400);
      expect(r.error?.code).toBe('VALIDATION_FAILED');
    }
    expect(eventsOf('BillOpened')).toEqual([]);
  });

  it('[05 §6.6] reason_code ∈ the branch’s discount reasons: an unknown code → 400 VALIDATION_FAILED at reason_code, nothing written', async () => {
    await start();
    const { seating_id } = seated([...TWO_BIG]);
    const r = await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 100, reason_code: 'birthday' });
    expect(r.status).toBe(400);
    expect(r.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [expect.objectContaining({ path: 'reason_code' })] } });
    expect(eventsOf('BillOpened')).toEqual([]);
    // §6.6 / 00 §3.7: the reason check is part of the Zod step, so it answers before the grant (the Order taker has none)
    const noGrant = await apply(waiter, { bill_ref: { seating_id }, kind: 'amount', value: 100, reason_code: 'birthday' });
    expect(noGrant.status).toBe(400);
    expect(noGrant.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [expect.objectContaining({ path: 'reason_code' })] } });
    const noGrantR = await removeD(waiter, { bill_id: 'B_NOPE', reason_code: 'birthday' });
    expect(noGrantR.status).toBe(400);
    expect(noGrantR.error?.code).toBe('VALIDATION_FAILED');
  });

  it('[05 §6.6, §9] DISCOUNT_TOO_LARGE: an amount above S → { max_minor: S }; percent 10 000 bp = S is accepted (total 0)', async () => {
    await start();
    const { seating_id } = seated([...TWO_BIG]);
    const r = await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 200_001, reason_code: 'staff' });
    expect(r.status).toBe(422);
    expect(r.error).toEqual({ code: 'DISCOUNT_TOO_LARGE', details: { max_minor: 200_000 } });
    expect(eventsOf('BillOpened')).toEqual([]);
    const all = await apply(manager, { bill_ref: { seating_id }, kind: 'percent', value: 10_000, reason_code: 'owner_guest' });
    expect(all.status).toBe(200);
    expect(all.events[1]!.payload).toMatchObject({ amount_minor: 200_000 });
    expect((await view({ seating_id })).totals_default).toMatchObject({ subtotal_minor: 200_000, discount_minor: 200_000, rounding_minor: 0, total_minor: 0 });
    expectTotals((await view({ seating_id })).totals_default, 200_000, 200_000); // the tax row stays, at base 0 / tax 0
  });

  it('[05 §6.6, §9] the max-discount cap: max_discount_pct 10 → max_minor floor(S × 10 / 100) = 20 000, amount and percent alike', async () => {
    await start(billingDoc({ max_discount_pct: 10 }));
    const { seating_id } = seated([...TWO_BIG]);
    for (const p of [
      { kind: 'amount', value: 20_001 },
      { kind: 'percent', value: 1_001 },
    ]) {
      const r = await apply(manager, { bill_ref: { seating_id }, ...p, reason_code: 'staff' });
      expect(r.status, JSON.stringify(p)).toBe(422);
      expect(r.error).toEqual({ code: 'DISCOUNT_TOO_LARGE', details: { max_minor: 20_000 } });
    }
    const ok = await apply(manager, { bill_ref: { seating_id }, kind: 'percent', value: 1_000, reason_code: 'staff' });
    expect(ok.status).toBe(200);
    expect(ok.events.at(-1)!.payload).toMatchObject({ amount_minor: 20_000 });
  });

  it('[05 §3.1, §3.5 (2)] S is the bill’s line bases: a pending void’s refund is out of S (the cap follows it)', async () => {
    await start();
    const { seating_id, order_id } = seated([...TWO_BIG]);
    raiseVoid(hub, { requester: waiter, order_id, order_item_id: 'B', units: 1 });
    const r = await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 100_001, reason_code: 'staff' });
    expect(r.status).toBe(422);
    expect(r.error).toEqual({ code: 'DISCOUNT_TOO_LARGE', details: { max_minor: 100_000 } });
  });

  it('[05 §6.6] a percent that comes to 0 minor units (1 bp of 30.00) is refused 400 VALIDATION_FAILED at value (Reading R13-a)', async () => {
    await start();
    const { seating_id } = seated([{ id: 'C', item: 'small' }]);
    const r = await apply(manager, { bill_ref: { seating_id }, kind: 'percent', value: 1, reason_code: 'staff' });
    expect(r.status).toBe(400);
    expect(r.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [expect.objectContaining({ path: 'value' })] } });
  });

  it('[05 #16, B7] after the first close: ApplyDiscount and RemoveDiscount → 409 BILL_PARTLY_PAID { bill_id }; the frozen amount stays', async () => {
    await start();
    const { bill_id } = await partlyPaid();
    const before = await view({ bill_id });
    expect(before.discount).toMatchObject({ frozen_minor: 20_000 });
    const a = await apply(manager, { bill_ref: { bill_id }, kind: 'amount', value: 100, reason_code: 'staff' });
    expect(a.status).toBe(409);
    expect(a.error).toEqual({ code: 'BILL_PARTLY_PAID', details: { bill_id } });
    const r = await removeD(manager, { bill_id, reason_code: 'staff' });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'BILL_PARTLY_PAID', details: { bill_id } });
    const after = await view({ bill_id });
    expect(after.discount).toEqual(before.discount);
    expect(after.splits).toEqual(before.splits);
    expect(eventsOf('DiscountApplied')).toHaveLength(1);
    expect(eventsOf('DiscountRemoved')).toEqual([]);
  });

  it('[05 #16, B7, Q-1] a line joining after the first close carries no discount; split 2 keeps its frozen share', async () => {
    await start();
    const { seating_id, bill_id } = await partlyPaid();
    appendOrder(hub, { order_type: 'dine_in', seating_id, placed_by: STAFF.orderTaker, follow_up: true, lines: [{ order_item_id: 'C', item_id: FX.optionItem }] });
    const v = await view({ bill_id });
    expect(v.lines.find((l) => l.order_item_id === 'C')!.added_after_close).toBe(true);
    const s2 = v.splits.find((s) => s.split_no === 2)!;
    // B 100 000 with the frozen remainder 10 000; C 3 000 at full price
    expect(s2.totals.cash).toMatchObject({ subtotal_minor: 103_000, discount_minor: 10_000 });
  });

  it('[05 §3.2, §9] a closed bill → 409 BILL_NOT_OPEN { bill_id, state } for apply and remove', async () => {
    await start();
    const { seating_id } = seated([...TWO_BIG]);
    const d = await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 100, reason_code: 'staff' });
    const bill_id = d.result!.bill_id as string;
    appendBill(bill_id, BillClosedEmpty as unknown as EventDef<z.ZodType>, { bill_id, seating_id: null, credit_invoice_ids: [] });
    const a = await apply(manager, { bill_ref: { bill_id }, kind: 'amount', value: 100, reason_code: 'staff' });
    expect(a.status).toBe(409);
    expect(a.error).toEqual({ code: 'BILL_NOT_OPEN', details: { bill_id, state: 'closed' } });
    const r = await removeD(manager, { bill_id, reason_code: 'staff' });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'BILL_NOT_OPEN', details: { bill_id, state: 'closed' } });
  });

  it('[05 §6.6, C8] grant first: the Order taker (no apply-discount) → 403 before any bill is opened; unknown bill → 404', async () => {
    await start();
    const { seating_id } = seated([...TWO_BIG]);
    const r = await apply(waiter, { bill_ref: { seating_id }, kind: 'amount', value: 100, reason_code: 'staff' });
    expect(r.status).toBe(403);
    expect(r.error?.code).toBe('PERMISSION_DENIED');
    expect((await removeD(waiter, { bill_id: 'B_NOPE', reason_code: 'staff' })).status).toBe(403);
    expect(eventsOf('BillOpened')).toEqual([]);
    const missing = await apply(manager, { bill_ref: { bill_id: 'B_NOPE' }, kind: 'amount', value: 100, reason_code: 'staff' });
    expect(missing.status).toBe(404);
    expect(missing.error).toEqual({ code: 'BILL_NOT_FOUND', details: { bill_id: 'B_NOPE' } });
    const missingR = await removeD(manager, { bill_id: 'B_NOPE', reason_code: 'staff' });
    expect(missingR.status).toBe(404);
    expect(missingR.error).toEqual({ code: 'BILL_NOT_FOUND', details: { bill_id: 'B_NOPE' } });
  });

  it('[05 §6.6, C8] scope last: a test-only my_floors grant (01b offers branch only) → 403 outside_scope after the bill and amount checks', async () => {
    await start();
    const { seating_id } = seated([...TWO_BIG]);
    const dir = await billingDirectory({ directory_version: 2 });
    await seedDirectory(hub, {
      ...dir,
      roles: dir.roles.map((role) => (role.role_id !== 'R_MGR' ? role : { ...role, permissions: role.permissions.map((g) => (g.permission === 'apply-discount' ? { ...g, scope: 'my_floors' } : g)) })),
    });
    const r = await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 100, reason_code: 'staff' });
    expect(r.status).toBe(403);
    expect(r.error?.details).toMatchObject({ reason: 'outside_scope' });
    expect(eventsOf('BillOpened')).toEqual([]);
    // the amount check still comes first
    expect((await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 200_001, reason_code: 'staff' })).error?.code).toBe('DISCOUNT_TOO_LARGE');
  });

  it('[05 §6.6] a takeaway bill by order_id: ensure bill opens it; the discount applies to its lines', async () => {
    await start();
    const { order_id } = takeawayOrder(hub, { placed_by: STAFF.orderTaker });
    const r = await apply(manager, { bill_ref: { order_id }, kind: 'amount', value: 500, reason_code: 'staff' });
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['BillOpened', 'DiscountApplied']);
    expect((await view({ order_id })).totals_default.discount_minor).toBe(500);
  });
});

// ================================================================================================= RemoveDiscount

describe('[05 §6.7, B7] RemoveDiscount', () => {
  it('[05 #16 command half] remove: DiscountRemoved { bill_id, reason_code, has_note, note_id } and nothing else; totals back to full, exact', async () => {
    await start();
    const { seating_id } = seated([
      { id: 'A', item: 'big' },
      { id: 'C', item: 'small' },
    ]);
    const d = await apply(manager, { bill_ref: { seating_id }, kind: 'percent', value: 333, reason_code: 'staff' });
    const bill_id = d.result!.bill_id as string;
    const r = await removeD(manager, { bill_id, reason_code: 'other', note: 'Wrong table' });
    expect(r.status).toBe(200);
    expect(r.result).toEqual({ bill_id, changed: true });
    expect(r.events.map((e) => e.event_type)).toEqual(['DiscountRemoved']);
    const p = r.events[0]!.payload as { note_id: string };
    expect(r.events[0]!.payload).toEqual({ bill_id, reason_code: 'other', has_note: true, note_id: p.note_id });
    expect(textOf(p.note_id)).toBe('Wrong table');
    expect(discountJson(bill_id)).toBeNull();
    const v = await view({ bill_id });
    expect(v.discount).toBeNull();
    // net 103 000, tax 16 480, G 119 480 → 119 500, R +20
    expectTotals(v.totals_default, 103_000, 0);
    expect(v.totals_default).toMatchObject({ rounding_minor: 20, total_minor: 119_500 });
  });

  it('[05 §6.7] no discount → 200 { changed: false }, no event; the Cashier (requires_approval) may remove directly, no request', async () => {
    await start();
    const { seating_id } = seated([...TWO_BIG]);
    const d = await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 100, reason_code: 'staff' });
    const bill_id = d.result!.bill_id as string;
    const r = await removeD(cashier, { bill_id, reason_code: 'complaint' });
    expect(r.status).toBe(200);
    expect(r.result).toEqual({ bill_id, changed: true });
    expect(r.events[0]!.payload).toEqual({ bill_id, reason_code: 'complaint', has_note: false, note_id: null });
    expect(alerts.listOpen(hub.deps.db, { kind: 'discount' })).toEqual([]);
    const again = await removeD(cashier, { bill_id, reason_code: 'complaint' });
    expect(again.status).toBe(200);
    expect(again.result).toEqual({ bill_id, changed: false });
    expect(again.events).toEqual([]);
  });

  it('[05 §6.7] Zod: other needs a note; an unknown reason code → 400; a bill_ref is not accepted (bill_id only)', async () => {
    await start();
    const { seating_id } = seated([...TWO_BIG]);
    const d = await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 100, reason_code: 'staff' });
    const bill_id = d.result!.bill_id as string;
    for (const payload of [{ bill_id, reason_code: 'other' }, { bill_id, reason_code: 'nope' }, { bill_ref: { bill_id }, reason_code: 'staff' }]) {
      const r = await removeD(manager, payload);
      expect(r.status, JSON.stringify(payload)).toBe(400);
      expect(r.error?.code).toBe('VALIDATION_FAILED');
    }
    expect(eventsOf('DiscountRemoved')).toEqual([]);
  });

  it('[05 §5] rebuild from events gives the same discount_json after apply, replace and remove', async () => {
    await start();
    const { seating_id } = seated([...TWO_BIG]);
    const d = await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 100, reason_code: 'staff' });
    const bill_id = d.result!.bill_id as string;
    await apply(manager, { bill_ref: { bill_id }, kind: 'percent', value: 250, reason_code: 'complaint' });
    const live = discountJson(bill_id);
    rebuildBilling();
    expect(discountJson(bill_id)).toEqual(live);
    await removeD(manager, { bill_id, reason_code: 'staff' });
    rebuildBilling();
    expect(discountJson(bill_id)).toBeNull();
  });
});

// ================================================================================================= approval path (#17)

describe('[05 §3.14, #17] ApplyDiscount — approval path (grant requires_approval)', () => {
  async function asked(o: { note?: string; lines?: Array<{ id: string; item: 'big' | 'small' }>; kind?: 'amount' | 'percent'; value?: number } = {}) {
    const { seating_id, order_id } = seated(o.lines ?? [...TWO_BIG]);
    const reply = await apply(cashier, {
      bill_ref: { seating_id },
      kind: o.kind ?? 'percent',
      value: o.value ?? 1_000,
      reason_code: o.note === undefined ? 'regular_customer' : 'other',
      ...(o.note === undefined ? {} : { note: o.note }),
    });
    expect(reply.status).toBe(200);
    const alert_id = pendingOf(reply);
    const bill_id = reply.result!.bill_id as string;
    return { seating_id, order_id, bill_id, alert_id, reply };
  }

  function raisedOf(alert_id: string) {
    return eventsOf('AlertRaised').find((e) => (e.payload as { alert_id: string }).alert_id === alert_id)!.payload as {
      kind: string;
      values: Record<string, unknown> & { note_id: string | null };
      details: unknown;
      dedupe_key: string;
      requester_staff_id: string;
      subject_stream_id: string;
    };
  }

  it('[05 #17] the Cashier asks: one discount request (values ids / codes only, details { amount, reason, identifier }, dedupe discount:<bill>), no DiscountApplied', async () => {
    await start();
    const { bill_id, alert_id, reply } = await asked({ note: 'Regular since 2019' });
    expect(reply.result).toEqual({ bill_id, pending: { alert_id } });
    expect(reply.events.map((e) => e.event_type)).toContain('AlertRaised');
    expect(reply.events.map((e) => e.event_type)).not.toContain('DiscountApplied');
    const p = raisedOf(alert_id);
    expect(p).toMatchObject({ kind: 'discount', subject_stream_id: bill_id, dedupe_key: `discount:${bill_id}`, requester_staff_id: STAFF.cashier });
    expect(p.values).toEqual({ bill_id, kind: 'percent', value: 1_000, reason_code: 'other', note_id: p.values.note_id, has_note: true });
    expect(p.details).toEqual({ amount: 20_000, reason: 'other', identifier: 'T4' });
    expect(textOf(p.values.note_id as string)).toBe('Regular since 2019');
    expect(JSON.stringify(eventsOf('AlertRaised'))).not.toContain('2019');
    expect(discountJson(bill_id)).toBeNull();
    const v = await view({ bill_id });
    expect(v.open_requests).toEqual([{ kind: 'discount', alert_id }]);
    // §3.3 rule 4 / R-29: the close would be refused DISCOUNT_PENDING (the close itself is task 17)
    expect(v.blocks).toContainEqual({ reason: 'discount_pending', split_no: null, details: { alert_id } });
    expect(v.totals_default.discount_minor).toBe(0);
  });

  it('[05 #17] approve through AnswerRequest (Manager PIN): DiscountApplied { alert_id, requester = Cashier, approver = answerer, amount at apply, note_id }', async () => {
    await start();
    const { seating_id, bill_id, alert_id } = await asked({ note: 'Regular since 2019' });
    const note_id = raisedOf(alert_id).values.note_id;
    const a = await answer(hub, manager, alert_id, 'approve');
    expect(a.status).toBe(200);
    const applied = a.events.filter((e) => e.event_type === 'DiscountApplied');
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ stream_type: 'bill', stream_id: bill_id });
    expect(applied[0]!.payload).toEqual({
      bill_id,
      kind: 'percent',
      value: 1_000,
      amount_minor: 20_000,
      reason_code: 'other',
      has_note: true,
      note_id,
      requester_staff_id: STAFF.cashier,
      approver_staff_id: STAFF.manager,
      alert_id,
      replaces: false,
    });
    expect(discountJson(bill_id)).toEqual({ kind: 'percent', value: 1_000, reason_code: 'other', alert_id, frozen_minor: null });
    const v = await view({ seating_id });
    expectTotals(v.totals_default, 200_000, 20_000);
    expect(v.open_requests).toEqual([]);
    expect(v.blocks.map((b) => b.reason)).not.toContain('discount_pending');
  });

  it('[05 §6.6] the amount is recomputed at apply: a percent asked on 2 000.00, a line added before the answer → 10 % of 2 030.00', async () => {
    await start();
    const { seating_id, alert_id } = await asked();
    appendOrder(hub, { order_type: 'dine_in', seating_id, placed_by: STAFF.orderTaker, follow_up: true, lines: [{ order_item_id: 'C', item_id: FX.optionItem }] });
    const a = await answer(hub, manager, alert_id, 'approve');
    expect(a.status).toBe(200);
    expect(a.events.find((e) => e.event_type === 'DiscountApplied')!.payload).toMatchObject({ amount_minor: 20_300 });
    expectTotals((await view({ seating_id })).totals_default, 203_000, 20_300);
  });

  it('[05 #17, H7-5] reject → no event, the request closes, no discount', async () => {
    await start();
    const { bill_id, alert_id } = await asked();
    const a = await answer(hub, manager, alert_id, 'reject');
    expect(a.status).toBe(200);
    expect(a.events.map((e) => e.event_type)).not.toContain('DiscountApplied');
    expect(eventsOf('DiscountApplied')).toEqual([]);
    expect(discountJson(bill_id)).toBeNull();
    expect(alerts.listOpen(hub.deps.db, { kind: 'discount' })).toEqual([]);
  });

  it('[05 #17] withdraw (the Cashier) → nothing: no event, the request closes', async () => {
    await start();
    const { bill_id, alert_id } = await asked();
    const w = await answer(hub, cashier, alert_id, 'withdraw');
    expect(w.status).toBe(200);
    expect(w.events.map((e) => e.event_type)).not.toContain('DiscountApplied');
    expect(discountJson(bill_id)).toBeNull();
    expect(alerts.listOpen(hub.deps.db, { kind: 'discount' })).toEqual([]);
  });

  it('[05 #17, §3.14] re-check on approve: the bill closed meanwhile → the answer is refused 409 BILL_NOT_OPEN; nothing written; the request stays open', async () => {
    await start();
    const { bill_id, alert_id } = await asked();
    appendBill(bill_id, BillClosedEmpty as unknown as EventDef<z.ZodType>, { bill_id, seating_id: null, credit_invoice_ids: [] });
    const a = await answer(hub, manager, alert_id, 'approve');
    expect(a.status).toBe(409);
    expect(a.error).toEqual({ code: 'BILL_NOT_OPEN', details: { bill_id, state: 'closed' } });
    expect(eventsOf('DiscountApplied')).toEqual([]);
    expect(alerts.listOpen(hub.deps.db, { kind: 'discount' }).map((x) => x.alert_id)).toEqual([alert_id]);
    // reject never re-checks: it closes the request
    expect((await answer(hub, manager, alert_id, 'reject')).status).toBe(200);
  });

  it('[05 §6.6, §3.14] re-check order on approve: a closed split meanwhile → BILL_PARTLY_PAID (before not OPEN)', async () => {
    await start();
    const { bill_id, alert_id } = await asked();
    const s = await post(hub, cashier, 'set-splits', 'SetSplits', {
      bill_ref: { bill_id },
      mode: 'items',
      splits: [
        { split_no: 1, lines: [{ order_item_id: 'A', units: 1 }] },
        { split_no: 2, lines: [{ order_item_id: 'B', units: 1 }] },
      ],
    });
    expect(s.status).toBe(200);
    closeSplit1(bill_id, [{ order_item_id: 'A', base_minor: BIG, discount_minor: 0 }], 0, ['A', 'B']);
    const a = await answer(hub, manager, alert_id, 'approve');
    expect(a.status).toBe(409);
    expect(a.error).toEqual({ code: 'BILL_PARTLY_PAID', details: { bill_id } });
    expect(eventsOf('DiscountApplied')).toEqual([]);
  });

  it('[05 §3.14] re-check on approve: the amount no longer fits (a line voided meanwhile) → 422 DISCOUNT_TOO_LARGE { max_minor }', async () => {
    await start();
    const { order_id, alert_id } = await asked({ kind: 'amount', value: 150_000 });
    raiseVoid(hub, { requester: waiter, order_id, order_item_id: 'B', units: 1 });
    const a = await answer(hub, manager, alert_id, 'approve');
    expect(a.status).toBe(422);
    expect(a.error).toEqual({ code: 'DISCOUNT_TOO_LARGE', details: { max_minor: 100_000 } });
    expect(eventsOf('DiscountApplied')).toEqual([]);
  });

  it('[05 §6.6, §9, #17] while a request is open: a second ask (Cashier or Manager) → 409 DISCOUNT_PENDING { alert_id }, no second request, no note written', async () => {
    await start();
    const { bill_id, alert_id } = await asked();
    const raisedBefore = eventsOf('AlertRaised').length;
    const textsBefore = (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM bill_texts').get() as { n: number }).n;
    for (const who of [cashier, manager]) {
      const again = await apply(who, { bill_ref: { bill_id }, kind: 'amount', value: 100, reason_code: 'other', note: 'second try' });
      expect(again.status).toBe(409);
      expect(again.error).toEqual({ code: 'DISCOUNT_PENDING', details: { alert_id } });
    }
    expect(eventsOf('AlertRaised')).toHaveLength(raisedBefore);
    expect((hub.deps.db.prepare('SELECT COUNT(*) AS n FROM bill_texts').get() as { n: number }).n).toBe(textsBefore);
    // PARTLY_PAID / not OPEN come before DISCOUNT_PENDING; a removal is not blocked by the open request
    expect((await removeD(manager, { bill_id, reason_code: 'staff' })).result).toEqual({ bill_id, changed: false });
  });

  it('[05 §6.6] the request path refuses as the direct path does, before raising: too large, unknown reason', async () => {
    await start();
    const { seating_id } = seated([...TWO_BIG]);
    const big = await apply(cashier, { bill_ref: { seating_id }, kind: 'amount', value: 200_001, reason_code: 'staff' });
    expect(big.error).toEqual({ code: 'DISCOUNT_TOO_LARGE', details: { max_minor: 200_000 } });
    expect((await apply(cashier, { bill_ref: { seating_id }, kind: 'amount', value: 1, reason_code: 'birthday' })).status).toBe(400);
    expect(alerts.listOpen(hub.deps.db, { kind: 'discount' })).toEqual([]);
  });

  it('[05 §6.6, D32] a retransmit with the same command_id returns the stored reply: one request, one bill', async () => {
    await start();
    const { seating_id } = seated([...TWO_BIG]);
    const first = await apply(cashier, { bill_ref: { seating_id }, kind: 'amount', value: 100, reason_code: 'staff' }, 'disc-retransmit');
    const second = await apply(cashier, { bill_ref: { seating_id }, kind: 'amount', value: 100, reason_code: 'staff' }, 'disc-retransmit');
    expect(second.status).toBe(200);
    expect(second.result).toEqual(first.result);
    expect(eventsOf('BillOpened')).toHaveLength(1);
    expect(alerts.listOpen(hub.deps.db, { kind: 'discount' })).toHaveLength(1);
  });

  it('[05 §6.29] a request approved on a bill that already has a discount → replaces true', async () => {
    await start();
    const { seating_id } = seated([...TWO_BIG]);
    await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 100, reason_code: 'staff' });
    const r = await apply(cashier, { bill_ref: { seating_id }, kind: 'amount', value: 5_000, reason_code: 'staff' });
    const a = await answer(hub, manager, pendingOf(r), 'approve');
    expect(a.events.find((e) => e.event_type === 'DiscountApplied')!.payload).toMatchObject({ amount_minor: 5_000, replaces: true });
    expectTotals((await view({ seating_id })).totals_default, 200_000, 5_000);
  });

  it('[05 §3.10] after a reopen (state OPEN again, freeze cleared) a discount may be applied again', async () => {
    await start();
    const { bill_id } = await partlyPaid();
    appendBill(bill_id, BillReopened as unknown as EventDef<z.ZodType>, { ...(aBillReopened().payload as object), bill_id, order_ids: [(await view({ bill_id })).orders[0]], mode: 'full' });
    const r = await apply(manager, { bill_ref: { bill_id }, kind: 'amount', value: 1_000, reason_code: 'staff' });
    expect(r.status).toBe(200);
    expect(r.events[0]!.payload).toMatchObject({ amount_minor: 1_000, replaces: true });
  });
});

// ================================================================================================= privacy (H-4, H16-7, H3-5)

describe('[05 H-4, H16-7, #43] the note is never hashed, stored or echoed outside bill_texts', () => {
  it('[05 #43] ApplyDiscount: a resend with the same command_id and only the note changed replays the stored reply', async () => {
    await start();
    const { seating_id } = seated([...TWO_BIG]);
    const payload = { bill_ref: { seating_id }, kind: 'amount', value: 100, reason_code: 'other' };
    const first = await apply(manager, { ...payload, note: 'first wording' }, 'disc-note-resend');
    expect(first.status).toBe(200);
    const second = await apply(manager, { ...payload, note: 'second wording' }, 'disc-note-resend');
    expect(second.status).toBe(200);
    expect(second.result).toEqual(first.result);
    expect(eventsOf('DiscountApplied')).toHaveLength(1);
  });

  it('[05 #43] RemoveDiscount: a resend with the same command_id and only the note changed replays the stored reply', async () => {
    await start();
    const { seating_id } = seated([...TWO_BIG]);
    const d = await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 100, reason_code: 'staff' });
    const bill_id = d.result!.bill_id as string;
    const send = (note: string) => post(hub, manager, 'remove-discount', 'RemoveDiscount', { bill_id, reason_code: 'other', note }, 'rmd-note-resend');
    const first = await send('first wording');
    const second = await send('second wording');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.result).toEqual(first.result);
    expect(eventsOf('DiscountRemoved')).toHaveLength(1);
  });

  it('[05 H3-5, H-4] after raise, a retransmit, a pending refusal, approve and a direct remove, the note texts appear only in bill_texts (every table, the logs)', async () => {
    await start();
    const NOTE_ASK = 'SECRET-ASK-7f3a';
    const NOTE_AGAIN = 'SECRET-AGAIN-91c2';
    const NOTE_REMOVE = 'SECRET-REMOVE-44d0';
    const NOTE_RESEND = 'SECRET-RESEND-0b6e';
    const { seating_id } = seated([...TWO_BIG]);
    const ask = { bill_ref: { seating_id }, kind: 'percent', value: 1_000, reason_code: 'other' };
    const r = await apply(cashier, { ...ask, note: NOTE_ASK }, 'disc-privacy-ask');
    const bill_id = r.result!.bill_id as string;
    // the retransmit of the ask with only the note changed: the stored reply, nothing new written
    const resent = await apply(cashier, { ...ask, note: NOTE_RESEND }, 'disc-privacy-ask');
    expect(resent.result).toEqual(r.result);
    const again = await apply(cashier, { bill_ref: { bill_id }, kind: 'amount', value: 1, reason_code: 'other', note: NOTE_AGAIN });
    expect(again.error?.code).toBe('DISCOUNT_PENDING');
    expect((await answer(hub, manager, pendingOf(r), 'approve')).status).toBe(200);
    expect((await removeD(manager, { bill_id, reason_code: 'other', note: NOTE_REMOVE })).status).toBe(200);

    const db = hub.deps.db;
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'bill_texts'`).all() as Array<{ name: string }>).map((t) => t.name);
    expect(tables.length).toBeGreaterThan(10);
    for (const name of tables) {
      const dump = JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all(), (_k, v: unknown) => (Buffer.isBuffer(v) ? v.toString('latin1') : v));
      for (const note of [NOTE_ASK, NOTE_AGAIN, NOTE_REMOVE, NOTE_RESEND]) expect(dump.includes(note), `${note} in ${name}`).toBe(false);
    }
    const logs = hub.logs();
    for (const note of [NOTE_ASK, NOTE_AGAIN, NOTE_REMOVE, NOTE_RESEND]) expect(logs.includes(note), `${note} in logs`).toBe(false);
    // bill_texts holds the ask and the removal notes; the refused second ask wrote none
    const texts = (db.prepare('SELECT text FROM bill_texts').all() as Array<{ text: string }>).map((t) => t.text);
    expect(texts).toContain(NOTE_ASK);
    expect(texts).toContain(NOTE_REMOVE);
    expect(texts).not.toContain(NOTE_AGAIN);
    expect(texts).not.toContain(NOTE_RESEND);
  });
});

// ================================================================================================= statement counts

describe('[05 §6.6, §6.7] statement counts (00 envelope excluded; 01d raise its own bound)', () => {
  function lines(n: number): Array<{ id: string; item: 'big' | 'small' }> {
    return Array.from({ length: n }, (_, i) => ({ id: `L${String(i).padStart(2, '0')}`, item: i % 2 === 0 ? ('big' as const) : ('small' as const) }));
  }

  for (const n of [1, 40]) {
    it(`[05 §6.6, #91] ApplyDiscount direct at ${n} line(s): new bill 4; existing bill 5; + 1 with a note (≤ 6)`, async () => {
      await start();
      const { seating_id } = seated(lines(n));
      await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 1, reason_code: 'staff' });
      expect(handled['apply-discount']).toBe(4); // ensure bill, orders, orderLines, pendingVoids
      await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 2, reason_code: 'staff' });
      expect(handled['apply-discount']).toBe(5); // + the open-request read
      await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 3, reason_code: 'other', note: 'n' });
      expect(handled['apply-discount']).toBe(6); // + bill_texts
    });
  }

  it("[05 §6.6] the request path: 6 with a note besides 01d's raise; a refusal stops early (DISCOUNT_PENDING after 2)", async () => {
    await start();
    const { seating_id } = seated(lines(3));
    await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 1, reason_code: 'staff' }); // opens the bill
    let inRaise = 0;
    const real = alerts.raise.bind(alerts);
    const spy = vi.spyOn(alerts, 'raise').mockImplementation((ctx, input) => {
      const before = counter.count;
      try {
        return real(ctx, input);
      } finally {
        inRaise = counter.count - before;
      }
    });
    try {
      const r = await apply(cashier, { bill_ref: { seating_id }, kind: 'amount', value: 5, reason_code: 'other', note: 'please' });
      expect(r.result).toMatchObject({ pending: { alert_id: expect.any(String) } });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(handled['apply-discount']! - inRaise).toBe(6);
      await apply(cashier, { bill_ref: { seating_id }, kind: 'amount', value: 5, reason_code: 'staff' });
      expect(handled['apply-discount']).toBe(2); // ensure bill + the open-request read, then DISCOUNT_PENDING
    } finally {
      spy.mockRestore();
    }
  });

  it('[05 §6.7] RemoveDiscount: 1 (openBillOf); + 1 with a note (= 2); no discount: 1', async () => {
    await start();
    const { seating_id } = seated(lines(40));
    const d = await apply(manager, { bill_ref: { seating_id }, kind: 'amount', value: 1, reason_code: 'staff' });
    const bill_id = d.result!.bill_id as string;
    await removeD(manager, { bill_id, reason_code: 'other', note: 'x' });
    expect(handled['remove-discount']).toBe(2);
    await removeD(manager, { bill_id, reason_code: 'staff' });
    expect(handled['remove-discount']).toBe(1);
    await apply(manager, { bill_ref: { bill_id }, kind: 'amount', value: 1, reason_code: 'staff' });
    await removeD(manager, { bill_id, reason_code: 'staff' });
    expect(handled['remove-discount']).toBe(1);
  });

  for (const n of [1, 40]) {
    it(`[05 §3.14, #91] the kind’s apply on approve at ${n} line(s): 4 statements (openBillOf, orders, orderLines, pendingVoids), read-only; reject 0`, async () => {
      await start();
      const { seating_id } = seated(lines(n));
      const r = await apply(cashier, { bill_ref: { seating_id }, kind: 'amount', value: 1, reason_code: 'staff' });
      const alert_id = pendingOf(r);
      const record = alerts.listOpen(hub.deps.db, { kind: 'discount' }).find((x) => x.alert_id === alert_id)!;
      const request = kindOf('discount')!.request!;
      const run = (decision: 'approve' | 'reject') =>
        hub.deps.writer.run((tx) => {
          const ctx = {
            tx: readOnlyTx(tx),
            state: tx.state,
            clock: tx.clock,
            ids: tx.ids,
            actor: { kind: 'staff', staffId: STAFF.cashier, stationId: null, sessionId: cashier.sessionId, deviceId: cashier.deviceId },
            permission: null,
            directory: currentDirectory(hub.app),
            alert: record,
          } as unknown as AlertApplyCtx<never, never>;
          counter.reset();
          const out = request.apply(ctx, { decision, answerer_staff_id: STAFF.manager, method: 'pin', device_id: manager.deviceId, answered_at: hub.clock.branchNow() });
          return { out, statements: counter.count };
        }).result;
      const approved = run('approve');
      expect(approved.statements).toBe(4);
      expect(approved.out.map((d) => d.event_type)).toEqual(['DiscountApplied']);
      expect(approved.out[0]!.payload).toMatchObject({ alert_id, requester_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager });
      expect(run('reject')).toEqual({ out: [], statements: 0 });
    });
  }
});
