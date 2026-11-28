// 05 §6 ensure bill, §6.1 `GET /queries/bill`, §6.2 `GET /queries/open-bills` (task 10; 05-plan §3 row 10; R-29 `added_after_close`, `blocks`,
// `reopen_count`; G-14 unit price from LineView). Real events through the hub's writer, the real `billing` fold, the
// query over HTTP as the client calls it. Ensure-bill is driven through a test-only command name carrying the real
// `ensureBill` (no 05 command that uses it is merged yet; the call-waiter SG-3 pattern). Closes are in-test events
// (task 17's `CloseSplit` is not built): an `InvoiceIssued` built by task 5's builder, folded by task 7.
import {
  BillReopened,
  BillSplitsSet,
  CheckBillPrinted,
  DiscountApplied,
  DiscountFrozen,
  draftOf,
  InvoiceIssued,
  OrdersBilled,
  OrdersBilledPayload,
  PaymentAdded,
  rateBpRates,
  SnapshotBillingSchema,
  type BranchConfig,
  type EventDef,
  type EventDraft,
  type PosEvent,
  type SnapshotBilling,
} from '@pos/events';
import { aBillReopened, aBillSplitsSet, aCheckBillPrinted, aDiscountApplied, anInvoiceIssued, aPaymentAdded } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BillRef, ensureBill } from '../../src/billing/commands/ensure-bill';
import { hubBilling } from '../../src/billing/defaults';
import type { BillView } from '../../src/billing/queries/bill';
import { LINE_BASE, type OpenBillRow } from '../../src/billing/queries/open-bills';
import { orderLines } from '../../src/orders/exports';
import { commandRegistry } from '../../src/commands/route';
import { defineCommand } from '../../src/commands/registry';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { seedDirectory, type TestHub } from '../helpers/test-hub';
import { openDay, voidsMenu } from '../voids/fixtures';
import {
  addedTakeaway,
  appendOrder,
  billingDirectory,
  compedLine,
  dineInTwoRounds,
  FX,
  openSeating,
  parkingTwoDays,
  pendingWeight,
  remakeLine,
  dealX2,
  optionChildOrder,
  post,
  raiseVoid,
  signIn,
  STAFF,
  startBilling,
  VX,
  type Who,
} from './fixtures';

const FOOD = 'tc-food';
/** a second profile at 500 bp (review: the leftover discount unit across two profiles) */
const LOW = 'tc-low';
let hub: TestHub;

// ------------------------------------------------------------------------------------------------ set-up

/** The PK built-in document with a 1 600 bp food class, `service_charge_bp.dine_in`, an optional buyer threshold. */
function billingDoc(o: { sc_bp?: number; threshold_minor?: number | null; prices_include_tax?: boolean; no_rounding?: boolean } = {}): SnapshotBilling {
  const pk = hubBilling({ currency_code: 'PKR', tax_classes: [], billing: undefined });
  return SnapshotBillingSchema.parse({
    ...pk.settings,
    service_charge_bp: { ...pk.settings.service_charge_bp, dine_in: o.sc_bp ?? 1_000 },
    payment_modes: [...pk.settings.payment_modes, { mode_id: 'card', name: 'Card', kind: 'card', payment_class: 'digital', reference_required: false, is_active: true, sort_order: 1, authority_codes: [] }],
    jurisdiction: {
      ...pk.jurisdiction,
      rules: pk.jurisdiction.rules.map((r) => ({
        ...r,
        prices_include_tax: o.prices_include_tax ?? r.prices_include_tax,
        rounding_step_minor: o.no_rounding === true ? null : r.rounding_step_minor,
        buyer_id:
          o.threshold_minor === undefined || o.threshold_minor === null
            ? { ...r.buyer_id, threshold_minor: null }
            : { threshold_minor: o.threshold_minor, accepted_types: [{ type: 'CNIC', label: 'CNIC', pattern: '^[0-9]{13}$', strip: '-' }, { type: 'NTN', label: 'NTN', pattern: '^[0-9A-Z]{7,9}$', strip: '' }] },
      })),
    },
    tax_profiles: [
      { tax_class_id: FOOD, taxes: [{ seq: 1, tax_code: 'TAX', label: 'Sales tax', compound: false, rates: rateBpRates(1_600) }] },
      { tax_class_id: LOW, taxes: [{ seq: 1, tax_code: 'TAX', label: 'Low rate', compound: false, rates: rateBpRates(500) }] },
    ],
  });
}

/** voidsMenu() taxed: Karahi, Naan and Fish carry the food class; `billing` as given. */
function taxedMenu(billing: SnapshotBilling = billingDoc()): BranchConfig {
  const menu = voidsMenu();
  const taxed = new Set<string>([FX.piece, FX.naan, FX.gram]);
  return {
    ...menu,
    tax_enabled: true,
    tax_classes: [
      { tax_class_id: FOOD, name: 'Sales tax', rate_bp: 1_600, is_archived: false, fiscal_category: 'restaurant_service' },
      { tax_class_id: LOW, name: 'Low rate', rate_bp: 500, is_archived: false, fiscal_category: 'restaurant_service' },
    ],
    items: menu.items.map((i) => (taxed.has(i.item_id) ? { ...i, tax_class_id: FOOD } : i)),
    billing,
  };
}

/** Swaps the branch config in place (same business day). */
function setConfig(config: BranchConfig): void {
  swapBranchConfig({ config, snapshotHash: 'e'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 4, appliedAt: hub.clock.branchNow() });
}

const TestEnsureBill = defineCommand({
  commandType: 'TestEnsureBill',
  payloadSchema: z.object({ bill_ref: BillRef }).strict(),
  sessionKind: 'device',
  permission: 'take-payment',
  handle(ctx, p) {
    const { head, events, created } = ensureBill(ctx, p.bill_ref);
    return { events, result: { bill_id: head.bill_id, created, state: head.state } };
  },
});

let cashier: Who;
let manager: Who;
let waiter: Who;

async function start(billing?: SnapshotBilling): Promise<void> {
  hub = await startBilling({ open: false });
  openDay(hub, { menu: taxedMenu(billing), stock: { [FX.stock]: 0, [VX.naanStock]: 0 } });
  commandRegistry(hub.app).register(TestEnsureBill);
  cashier = signIn(hub, STAFF.cashier);
  manager = signIn(hub, STAFF.manager);
  waiter = signIn(hub, STAFF.orderTaker);
}

afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

interface Got<T = BillView> {
  status: number;
  data: T;
  error: { code: string; details: Record<string, unknown> } | undefined;
  statements: number;
}

async function get<T = BillView>(who: Who, resource: string, qs: Record<string, string>): Promise<Got<T>> {
  const counter = statementCounter(hub.deps.readDb);
  const url = `/queries/${resource}?${new URLSearchParams(qs).toString()}`;
  const before = counter.count;
  const res = await hub.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
  const body = res.json() as { data?: T; error?: { code: string; details: Record<string, unknown> } };
  return { status: res.statusCode, data: (body.data ?? {}) as T, error: body.error === undefined ? undefined : { code: body.error.code, details: body.error.details }, statements: counter.count - before };
}

/** The handler's own statements: the request minus a probe that fails at Zod (auth / session only). */
async function handlerStatements(who: Who, resource: string, qs: Record<string, string>): Promise<number> {
  const probe = await get(who, resource, { __zod_fail: '1' });
  const real = await get(who, resource, qs);
  expect(real.status).toBe(200);
  return real.statements - probe.statements;
}

const bill = (who: Who, qs: Record<string, string>) => get(who, 'bill', qs);

async function ensure(ref: Record<string, string>, who: Who = cashier, commandId?: string) {
  return post(hub, who, 'test-ensure-bill', 'TestEnsureBill', { bill_ref: ref }, commandId);
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

let invoiceNo = 0;
/**
 * In-test close of one split (task 17 not built): the task-5 InvoiceIssued builder with this split's lines, a
 * not-fiscalized snapshot; task 7's fold closes the split, fills closed_split_units and (first close) bill_discount_lines.
 */
function closeInTest(bill_id: string, split_no: number, lines: Array<{ order_item_id: string; units: number; base_minor: number; discount_minor?: number }>, discount_line_ids: string[] | null): void {
  invoiceNo += 1;
  const base = anInvoiceIssued().payload as { lines: Array<Record<string, unknown>>; fiscal: Record<string, unknown> } & Record<string, unknown>;
  const subtotal = lines.reduce((a, l) => a + l.base_minor, 0);
  const discount = lines.reduce((a, l) => a + (l.discount_minor ?? 0), 0);
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
        service_charge: null,
        subtotal_minor: subtotal,
        discount_minor: discount,
        service_charge_minor: 0,
        taxes: [],
        rounding_minor: 0,
        total_minor: subtotal - discount,
        payment_ids: [],
        change_minor: 0,
        discount_line_ids,
        fiscal: { ...base.fiscal, adapter_key: 'none', required: false, pos_id: null, payment_codes: [] },
      },
    },
  ]);
}

function splitsSet(bill_id: string, mode: 'items' | 'amount' | 'equal', splits: unknown[]): void {
  const payload = { ...(aBillSplitsSet().payload as object), bill_id, mode, splits };
  appendBill(bill_id, [{ def: BillSplitsSet as unknown as EventDef<z.ZodType>, payload }]);
}

function discountAmount(bill_id: string, value: number): void {
  appendBill(bill_id, [{ def: DiscountApplied as unknown as EventDef<z.ZodType>, payload: { ...(aDiscountApplied().payload as object), bill_id, kind: 'amount', value, amount_minor: value } }]);
}

function freeze(bill_id: string, frozen_minor: number, line_ids: string[]): void {
  appendBill(bill_id, [{ def: DiscountFrozen as unknown as EventDef<z.ZodType>, payload: { bill_id, frozen_minor, line_ids } }]);
}

/** The directory with the order taker's take-payment and take-order at `scope`, and his floors. */
let directoryVersion = 1;
async function reseedWaiter(o: { scope?: 'branch' | 'my_floors' | 'own_tables'; floor_ids?: string[]; drop?: string[] }): Promise<void> {
  directoryVersion += 1;
  const dir = await billingDirectory({ directory_version: directoryVersion });
  await seedDirectory(hub, {
    ...dir,
    staff: dir.staff.map((x) => (x.staff_id === STAFF.orderTaker ? { ...x, floor_ids: o.floor_ids ?? [] } : x)),
    roles: dir.roles.map((r) =>
      r.role_id !== 'R_WAIT'
        ? r
        : {
            ...r,
            permissions: r.permissions
              .filter((g) => !(o.drop ?? []).includes(g.permission))
              .map((g) => (o.scope !== undefined && (g.permission === 'take-payment' || g.permission === 'take-order') ? { ...g, scope: o.scope } : g)),
          },
    ),
  });
}

function reopen(bill_id: string, order_ids: string[]): void {
  appendBill(bill_id, [{ def: BillReopened as unknown as EventDef<z.ZodType>, payload: { ...(aBillReopened().payload as object), bill_id, order_ids, mode: 'full' } }]);
}

function pay(bill_id: string, split_no: number, amount_minor: number, payment_id: string, has_reference = false): void {
  const payload = {
    ...(aPaymentAdded().payload as object),
    payment_id,
    bill_id,
    split_no,
    mode_id: 'cash',
    payment_class: 'cash',
    direction: 'in',
    amount_minor,
    tendered_minor: amount_minor,
    change_minor: 0,
    has_reference,
    taken_by_staff_id: STAFF.cashier,
    shift_id: 'SHIFT_1',
  };
  appendBill(bill_id, [{ def: PaymentAdded as unknown as EventDef<z.ZodType>, payload }]);
}

const strip = (v: BillView) => {
  const rest: Partial<BillView> = { ...v };
  delete rest.bill_id;
  delete rest.state;
  delete rest.as_of_seq;
  return rest;
};

// ================================================================================================= ensure bill

describe('[05 §6] ensure bill', () => {
  beforeEach(() => start());

  it('[05 #1] the projected bill equals the bill after BillOpened for the same lines (same computeBill)', async () => {
    const { seating_id } = dineInTwoRounds(hub);
    const projected = await bill(cashier, { seating_id });
    expect(projected.status).toBe(200);
    expect(projected.data.bill_id).toBeNull();
    expect(projected.data.state).toBe('projected');
    expect(projected.data.totals_default.total_minor).toBeGreaterThan(0);
    const opened = await ensure({ seating_id });
    expect(opened.status).toBe(200);
    expect(opened.result).toMatchObject({ created: true, state: 'open' });
    const after = await bill(cashier, { seating_id });
    expect(after.data.bill_id).toBe(opened.result!.bill_id);
    expect(after.data.state).toBe('open');
    expect(strip(after.data)).toEqual(strip(projected.data));
  });

  it('[05 §6, H9-9, H16-2, B8] BillOpened freezes the price mode and rounding in force; ChargeApplied { source: rule, rate_bp }', async () => {
    const { seating_id } = dineInTwoRounds(hub);
    const r = await ensure({ seating_id });
    expect(r.events.map((e) => e.event_type)).toEqual(['BillOpened', 'ChargeApplied']);
    const [opened, charge] = r.events;
    expect(opened!.payload).toEqual({
      bill_id: r.result!.bill_id,
      scope: 'seating',
      seating_id,
      bill_key: null,
      order_type: 'dine_in',
      prices_include_tax: false,
      rounding: { step_minor: 100, mode: 'nearest', applies_to: 'all' },
    });
    expect(opened!.stream_type).toBe('bill');
    expect(charge!.payload).toEqual({ bill_id: r.result!.bill_id, charge: 'service', rate_bp: 1_000, source: 'rule', has_note: false, note_id: null });
  });

  it('[05 §6] a 0 rate → BillOpened only; a takeaway key bill from an order ref', async () => {
    const { root, addition } = addedTakeaway(hub);
    const r = await ensure({ order_id: addition.order_id });
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['BillOpened']);
    expect(r.events[0]!.payload).toMatchObject({ scope: 'key', seating_id: null, bill_key: `takeaway:${root.order_id}`, order_type: 'takeaway' });
  });

  it('[05 §6, D32] an existing bill → no event; a retransmit returns the stored response and writes nothing', async () => {
    const { seating_id } = dineInTwoRounds(hub);
    const first = await ensure({ seating_id }, cashier, 'cmd-ensure-1');
    const count = () => hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number;
    const n = count();
    const again = await ensure({ seating_id }, cashier, 'cmd-ensure-1');
    expect(again.status).toBe(200);
    expect(again.result).toEqual(first.result);
    expect(count()).toBe(n);
    const second = await ensure({ seating_id });
    expect(second.result).toMatchObject({ bill_id: first.result!.bill_id, created: false });
    expect(second.events).toEqual([]);
    const byBill = await ensure({ bill_id: first.result!.bill_id as string });
    expect(byBill.result).toMatchObject({ bill_id: first.result!.bill_id, created: false });
  });

  it('[05 §6] refusals: unknown bill 404, unknown order 404, closed seating 409 TABLE_NOT_OPEN, cancelled order 409 BILL_NOT_OPEN', async () => {
    expect((await ensure({ bill_id: 'NOPE' })).error).toEqual({ code: 'BILL_NOT_FOUND', details: { bill_id: 'NOPE' } });
    expect((await ensure({ order_id: 'NOPE' })).error).toEqual({ code: 'ORDER_NOT_FOUND', details: { order_id: 'NOPE' } });
    expect((await ensure({ seating_id: 'NO_SEAT' })).error?.code).toBe('TABLE_NOT_OPEN');
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'CX_N', item_id: FX.naan }] });
    hub.deps.writer.run((tx) =>
      tx.append([{ stream_type: 'order', stream_id: order_id, event_type: 'OrderCancelled', schema_version: 1, payload: { order_id }, occurred_at: hub.clock.branchNow(), actor_id: STAFF.manager, device_id: 'D_FIXTURE' }]),
    );
    const r = await ensure({ order_id });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'BILL_NOT_OPEN', details: { bill_id: null, state: 'cancelled' } });
  });

  it('[05 §6, H9-9] an open bill keeps its price mode across a mode change; a projected bill uses the mode in force now', async () => {
    const a = dineInTwoRounds(hub, { prefix: 'PA' });
    const b = dineInTwoRounds(hub, { prefix: 'PB', table_id: VX.tables.T5 });
    await ensure({ seating_id: a.seating_id });
    const before = (await bill(cashier, { seating_id: a.seating_id })).data;
    setConfig(taxedMenu(billingDoc({ prices_include_tax: true })));
    const kept = (await bill(cashier, { seating_id: a.seating_id })).data;
    expect(kept.prices_include_tax).toBe(false);
    expect(kept.totals_default).toEqual(before.totals_default);
    const projected = (await bill(cashier, { seating_id: b.seating_id })).data;
    expect(projected.prices_include_tax).toBe(true);
    // inclusive: the menu amounts are the total before the service charge's own part
    expect(projected.totals_default.subtotal_minor).toBe(before.totals_default.subtotal_minor);
    expect(projected.totals_default.total_minor).toBeLessThan(before.totals_default.total_minor);
  });
});

// ================================================================================================= bill view

describe('[05 §6.1] GET /queries/bill', () => {
  beforeEach(() => start());

  it('[05 #2] dine-in follows seating_orders: a second round joins, a cancelled order leaves, an archived table stays billable', async () => {
    const { seating_id, rounds } = dineInTwoRounds(hub);
    let v = (await bill(cashier, { seating_id })).data;
    expect(v.orders).toEqual([rounds[0].order_id, rounds[1].order_id]);
    expect(v.lines.map((l) => l.order_item_id)).toEqual([...rounds[0].lines, ...rounds[1].lines]);
    hub.deps.writer.run((tx) =>
      tx.append([{ stream_type: 'order', stream_id: rounds[1].order_id, event_type: 'OrderCancelled', schema_version: 1, payload: { order_id: rounds[1].order_id }, occurred_at: hub.clock.branchNow(), actor_id: STAFF.manager, device_id: 'D_FIXTURE' }]),
    );
    v = (await bill(cashier, { seating_id })).data;
    expect(v.orders).toEqual([rounds[0].order_id]);
    const menu = taxedMenu();
    setConfig({ ...menu, floors: menu.floors.map((f) => ({ ...f, tables: f.tables.filter((t) => t.table_id !== VX.tables.T4) })) });
    v = (await bill(cashier, { order_id: rounds[0].order_id })).data;
    expect(v.orders).toEqual([rounds[0].order_id]);
    expect(v.identifier).toBe(VX.tables.T4);
  });

  it('[05 #3] takeaway bill = one bill_key (root + addition); parking: one key per business day', async () => {
    const { root, addition } = addedTakeaway(hub);
    const v = (await bill(cashier, { order_id: addition.order_id })).data;
    expect(v.scope).toBe('key');
    expect(v.orders).toEqual([root.order_id, addition.order_id]);
    expect(v.identifier).toBe(`#${root.token}`);
    const { day1, day2 } = parkingTwoDays(hub);
    cashier = signIn(hub, STAFF.cashier); // the clock moved a day: a fresh session
    const p2r = await bill(cashier, { order_id: day2.order_id });
    expect(p2r.error).toBeUndefined();
    const p2 = p2r.data;
    expect(p2.orders).toEqual([day2.order_id]);
    expect(p2.identifier).toMatch(/^PARKING /);
    const p1 = (await bill(cashier, { order_id: day1.order_id })).data;
    expect(p1.orders).toEqual([day1.order_id]);
  });

  it('[05 #4] lines: COMP at value with deduction; PENDING VOID tagged with only refund_minor off; pending weight 0 + weight_pending', async () => {
    const comp = compedLine(hub);
    const c = (await bill(cashier, { order_id: comp.order_id })).data;
    expect(c.lines[0]).toMatchObject({ order_item_id: comp.line, units: 3, base_minor: 6_000, tags: ['comp'] });
    const w = pendingWeight(hub);
    const wv = (await bill(cashier, { order_id: w.order_id })).data;
    const weighed = wv.lines.find((l) => l.order_item_id === w.line);
    expect(weighed).toMatchObject({ base_minor: 0, tags: ['weight_needed'] });
    expect(wv.blocks).toContainEqual({ reason: 'weight_pending', split_no: 1, details: { reason: 'weight_pending', order_item_ids: [w.line] } });
    const t = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'PV_N', item_id: FX.naan, quantity: 2 }] });
    const raised = raiseVoid(hub, { requester: cashier, order_id: t.order_id, order_item_id: 'PV_N', units: 1 });
    const pv = (await bill(cashier, { order_id: t.order_id })).data;
    expect(pv.lines[0]).toMatchObject({ order_item_id: 'PV_N', units: 2, base_minor: 6_000 - raised.values.refund_minor, tags: ['pending_void'] });
    expect(pv.blocks[0]).toEqual({ reason: 'void_pending', split_no: null, details: { reason: 'void_pending', order_item_ids: ['PV_N'] } });
  });

  it('[05 #4b] added_after_close: projected and no closed split → false; a round after split 1 closes → true; reopen → all false; 7 statements here (task 12: the invoices ride the splits statement)', async () => {
    const { seating_id, rounds } = dineInTwoRounds(hub);
    const [A, B] = rounds[0].lines as [string, string];
    let v = (await bill(cashier, { seating_id })).data;
    expect(v.lines.every((l) => l.added_after_close === false)).toBe(true);
    const bill_id = (await ensure({ seating_id })).result!.bill_id as string;
    const C = rounds[1].lines[0]!;
    // item split: A + the second round's naan in split 1, B in split 2
    splitsSet(bill_id, 'items', [
      { split_no: 1, lines: [{ order_item_id: A, order_id: rounds[0].order_id, units: 1 }, { order_item_id: C, order_id: rounds[1].order_id, units: 1 }], share_minor: null },
      { split_no: 2, lines: [{ order_item_id: B, order_id: rounds[0].order_id, units: 1 }], share_minor: null },
    ]);
    v = (await bill(cashier, { seating_id })).data;
    expect(v.lines.every((l) => l.added_after_close === false)).toBe(true);
    const base = new Map(v.lines.map((l) => [l.order_item_id, l.base_minor]));
    closeInTest(bill_id, 1, [{ order_item_id: A, units: 1, base_minor: base.get(A) as number }, { order_item_id: C, units: 1, base_minor: base.get(C) as number }], [A, B, C]);
    const D = 'DI3_N';
    appendOrder(hub, { order_type: 'dine_in', seating_id, follow_up: true, lines: [{ order_item_id: D, item_id: FX.naan }] });
    v = (await bill(cashier, { seating_id })).data;
    expect(v.state).toBe('partly_paid');
    expect(Object.fromEntries(v.lines.map((l) => [l.order_item_id, l.added_after_close]))).toEqual({ [A]: false, [B]: false, [C]: false, [D]: true });
    expect(v.splits.map((s) => s.state)).toEqual(['closed', 'open']);
    // the round joins the highest open split (§3.8): split 2 = B + D
    expect(v.splits[1].totals.as_paid.subtotal_minor).toBe((base.get(B) as number) + 3_000);
    expect(await handlerStatements(cashier, 'bill', { seating_id })).toBe(7); // no print job: documentJobsStatus reads nothing
    reopen(bill_id, rounds.map((r) => r.order_id));
    v = (await bill(cashier, { seating_id })).data;
    expect(v.reopen_count).toBe(1);
    expect(v.lines.every((l) => l.added_after_close === false)).toBe(true);
  });

  it('[05 #4c] blocks: each rule with its pinned reason and details, ordered by rule then split_no; none → []', async () => {
    await hub.close();
    await start(billingDoc({ threshold_minor: 1_000 }));
    const { seating_id, rounds } = dineInTwoRounds(hub);
    const bill_id = (await ensure({ seating_id })).result!.bill_id as string;
    splitsSet(bill_id, 'amount', [{ split_no: 1, lines: null, share_minor: 99_999_999 }, { split_no: 2, lines: null, share_minor: 1 }]);
    pay(bill_id, 1, 1_000, 'P1');
    raiseVoid(hub, { requester: cashier, order_id: rounds[1].order_id, order_item_id: rounds[1].lines[0]!, units: 1 });
    const v = (await bill(cashier, { seating_id })).data;
    expect(v.buyer).toMatchObject({ required: true, threshold_minor: 1_000, waived: false });
    expect(v.blocks.map((b) => [b.reason, b.split_no])).toEqual([
      ['void_pending', null],
      ['buyer_id_required', null],
      ['balance_due', 1],
      ['shares_sum', 2],
    ]);
    const buyer = v.blocks.find((b) => b.reason === 'buyer_id_required');
    expect(buyer!.details).toEqual({ threshold_minor: 1_000, net_minor: v.totals_default.subtotal_minor - v.totals_default.discount_minor, accepted_types: ['CNIC', 'NTN'] });
    expect(v.blocks.find((b) => b.split_no === 1)!.details).toEqual({ split_no: 1, balance_minor: v.splits[0]!.balance_minor });
    expect(v.blocks.at(-1)!.details).toEqual({ reason: 'shares_sum' });
  });

  it('[05 #4c rules 1, 3a] a CLOSED bill → bill_not_open only; an unresolved profile → tax_unresolved on its split', async () => {
    const { seating_id, rounds } = dineInTwoRounds(hub);
    const bill_id = (await ensure({ seating_id })).result!.bill_id as string;
    // 3a: a class the jurisdiction has no tax list for (the line keeps its profile id)
    appendOrder(hub, { order_type: 'dine_in', seating_id, follow_up: true, lines: [{ order_item_id: 'TU_N', item_id: FX.naan, item: { tax_class_id: 'tc-unmapped' } }] });
    let v = (await bill(cashier, { seating_id })).data;
    expect(v.lines.find((l) => l.order_item_id === 'TU_N')!.tags).toEqual(['tax_unresolved']);
    expect(v.blocks).toContainEqual({ reason: 'tax_unresolved', split_no: 1, details: { reason: 'tax_unresolved', order_item_ids: ['TU_N'] } });
    // 1: closed
    const all = v.lines.map((l) => ({ order_item_id: l.order_item_id, units: l.units, base_minor: l.base_minor }));
    closeInTest(bill_id, 1, all, all.map((l) => l.order_item_id));
    v = (await bill(cashier, { bill_id })).data;
    expect(v.state).toBe('closed');
    expect(v.blocks).toEqual([{ reason: 'bill_not_open', split_no: null, details: { bill_id, state: 'closed' } }]);
    expect(v.splits[0]).toMatchObject({ state: 'closed', balance_minor: 0, invoice: { invoice_ref: expect.any(String), fiscal_number: null, fiscal_state: 'not_required' } });
    void rounds;
  });

  it('[05 #4c] no rule refuses → blocks []', async () => {
    const { seating_id } = dineInTwoRounds(hub);
    const bill_id = (await ensure({ seating_id })).result!.bill_id as string;
    const v0 = (await bill(cashier, { seating_id })).data;
    pay(bill_id, 1, v0.splits[0].balance_minor, 'P_ALL');
    const v = (await bill(cashier, { seating_id })).data;
    expect(v.splits[0].balance_minor).toBe(0);
    expect(v.blocks).toEqual([]);
  });

  it('[05 #4d] reopen_count: 0 projected and never reopened; 1, then 2; a re-close leaves it', async () => {
    const { seating_id, rounds } = dineInTwoRounds(hub);
    expect((await bill(cashier, { seating_id })).data.reopen_count).toBe(0);
    const bill_id = (await ensure({ seating_id })).result!.bill_id as string;
    expect((await bill(cashier, { bill_id })).data.reopen_count).toBe(0);
    const closeAll = async () => {
      const v = (await bill(cashier, { bill_id })).data;
      const all = v.lines.map((l) => ({ order_item_id: l.order_item_id, units: l.units, base_minor: l.base_minor }));
      closeInTest(bill_id, 1, all, all.map((l) => l.order_item_id));
    };
    await closeAll();
    reopen(bill_id, rounds.map((r) => r.order_id));
    expect((await bill(cashier, { bill_id })).data.reopen_count).toBe(1);
    await closeAll();
    expect((await bill(cashier, { bill_id })).data.reopen_count).toBe(1);
    reopen(bill_id, rounds.map((r) => r.order_id));
    expect((await bill(cashier, { bill_id })).data.reopen_count).toBe(2);
  });

  it('[05 #4e, R-90] ids: a closed split invoice carries invoice_id; payments carry taken_by_staff_id; statements unchanged at 1 and at 40', async () => {
    const closedBill = async (table_id: string, seating_id: string, n: number) => {
      openSeating(hub, { table_id, seating_id });
      appendOrder(hub, { order_type: 'dine_in', seating_id, lines: Array.from({ length: n }, (_, i) => ({ order_item_id: `${seating_id}_L${i}`, item_id: FX.naan })) });
      const bill_id = (await ensure({ seating_id })).result!.bill_id as string;
      for (let i = 0; i < n; i += 1) pay(bill_id, 1, 3_000, `${seating_id}_P${i}`);
      const open = (await bill(cashier, { bill_id })).data;
      expect(open.splits[0].state).toBe('open');
      expect(open.splits[0].invoice).toBeNull();
      expect(open.splits[0].payments.map((x) => x.taken_by_staff_id)).toEqual(Array.from({ length: n }, () => STAFF.cashier));
      const all = open.lines.map((l) => ({ order_item_id: l.order_item_id, units: l.units, base_minor: l.base_minor }));
      closeInTest(bill_id, 1, all, all.map((l) => l.order_item_id));
      return { bill_id, invoice_id: `INV_${invoiceNo}`, invoice_ref: `T-S${String(invoiceNo).padStart(6, '0')}` };
    };
    const one = await closedBill(VX.tables.T4, 'SEAT_IDS1', 1);
    const v = (await bill(cashier, { bill_id: one.bill_id })).data;
    expect(v.splits[0].state).toBe('closed');
    expect(v.splits[0].invoice).toMatchObject({ invoice_id: one.invoice_id, invoice_ref: one.invoice_ref });
    expect(v.splits[0].payments).toHaveLength(1);
    expect(v.splits[0].payments[0]).toMatchObject({ payment_id: 'SEAT_IDS1_P0', taken_by_staff_id: STAFF.cashier });
    expect(Object.keys(v.splits[0].payments[0]!)).toEqual(expect.arrayContaining(['taken_by_name', 'taken_by_staff_id']));
    const at1 = await handlerStatements(cashier, 'bill', { bill_id: one.bill_id });
    const forty = await closedBill(VX.tables.T7, 'SEAT_IDS40', 40);
    const v40 = (await bill(cashier, { bill_id: forty.bill_id })).data;
    expect(v40.splits[0].invoice?.invoice_id).toBe(forty.invoice_id);
    expect(v40.splits[0].payments.every((x) => x.taken_by_staff_id === STAFF.cashier)).toBe(true);
    const at40 = await handlerStatements(cashier, 'bill', { bill_id: forty.bill_id });
    expect(at1).toBe(5); // as before R-90: a closed bill with no print job (documentJobsStatus reads nothing); both fields ride the splits statement
    expect(at40).toBe(at1);
  });

  it('[05 #5b] a fully comped bill totals 0 with no block (closes with no payment)', async () => {
    const comp = compedLine(hub, { units: 3, value_minor: 9_000 });
    const v = (await bill(cashier, { order_id: comp.order_id })).data;
    expect(v.totals_default.total_minor).toBe(0);
    expect(v.splits[0].balance_minor).toBe(0);
    expect(v.blocks).toEqual([]);
  });

  it('[05 §6.1, H2-20] permissions: take-payment in scope sees references; take-order own_tables holder reads; out of scope 403; unknown 404', async () => {
    const { seating_id, rounds } = dineInTwoRounds(hub); // holder S_WAIT
    const bill_id = (await ensure({ seating_id })).result!.bill_id as string;
    pay(bill_id, 1, 1_000, 'P_REF', true);
    hub.deps.db.prepare('INSERT INTO payment_references (payment_id, reference) VALUES (?, ?)').run('P_REF', 'REF-123');
    const full = (await bill(cashier, { seating_id })).data;
    expect(full.splits[0].payments[0]).toMatchObject({ payment_id: 'P_REF', has_reference: true, reference: 'REF-123', mode_name: 'Cash' });
    const own = await bill(waiter, { seating_id });
    expect(own.status).toBe(200);
    // the order taker's take-payment is own_tables: he holds the seating, so he gets the full view
    expect(own.data.splits[0].payments[0].reference).toBe('REF-123');
    openSeating(hub, { table_id: VX.tables.T6, seating_id: 'SEAT_OTHER', holder_staff_id: STAFF.manager });
    const other0 = (await ensure({ seating_id: 'SEAT_OTHER' })).result!.bill_id as string;
    pay(other0, 1, 1_000, 'P_REF2', true);
    hub.deps.db.prepare('INSERT INTO payment_references (payment_id, reference) VALUES (?, ?)').run('P_REF2', 'REF-456');
    // take-payment own_tables does not cover another's table; take-order (branch) gives the read-only view: no reference
    const read = await bill(waiter, { seating_id: 'SEAT_OTHER' });
    expect(read.status).toBe(200);
    expect(read.data.splits[0].payments[0]).toMatchObject({ payment_id: 'P_REF2', has_reference: true });
    expect('reference' in read.data.splits[0].payments[0]).toBe(false);
    // a directory where the order taker's take-order is own_tables too → out of scope
    const dir = await billingDirectory({ directory_version: 2 });
    await seedDirectory(hub, { ...dir, roles: dir.roles.map((r) => (r.role_id !== 'R_WAIT' ? r : { ...r, permissions: r.permissions.map((g) => (g.permission === 'take-order' ? { ...g, scope: 'own_tables' as const } : g)) })) });
    const other = await bill(waiter, { seating_id: 'SEAT_OTHER' });
    expect(other.status).toBe(403);
    expect(other.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: [VX.tables.T6] } });
    expect((await bill(manager, { bill_id: 'NOPE' })).error).toEqual({ code: 'BILL_NOT_FOUND', details: { bill_id: 'NOPE' } });
    expect((await bill(manager, { bill_id, seating_id })).status).toBe(400);
    void rounds;
  });

  it('[05 #91] the bill query stays ≤ 8 statements at 1 and at 40 lines (task 12: was ≤ 9)', async () => {
    const one = dineInTwoRounds(hub, { prefix: 'ONE' });
    await ensure({ seating_id: one.seating_id });
    const at1 = await handlerStatements(cashier, 'bill', { seating_id: one.seating_id });
    openSeating(hub, { table_id: VX.tables.T7, seating_id: 'SEAT_40' });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT_40', lines: Array.from({ length: 40 }, (_, i) => ({ order_item_id: `L40_${i}`, item_id: FX.naan })) });
    const id40 = (await ensure({ seating_id: 'SEAT_40' })).result!.bill_id as string;
    for (let i = 0; i < 5; i += 1) pay(id40, 1, 100, `P40_${i}`);
    const at40 = await handlerStatements(cashier, 'bill', { seating_id: 'SEAT_40' });
    expect(at1).toBeLessThanOrEqual(8);
    expect(at40).toBe(at1);
    const projected = await handlerStatements(cashier, 'bill', { order_id: addedTakeaway(hub).addition.order_id });
    expect(projected).toBeLessThanOrEqual(8);
  });
});

describe('[05 v1.0.33 §6.1, #92] split lines on the bill view (STAB-5)', () => {
  beforeEach(() => start());

  it('[05 #92] a karahi ×5 split into parts → five lines with part_of K, units 1, Σ base = the unsplit line; an unsplit line part_of null; statements unchanged', async () => {
    const part = (order_item_id: string) => ({ order_item_id, item_id: FX.piece, item: { part_of: 'K' } });
    const split = appendOrder(hub, { order_type: 'takeaway', lines: [part('K'), part('K-p2'), part('K-p3'), part('K-p4'), part('K-p5')] });
    const whole = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'W', item_id: FX.piece, quantity: 5 }] });
    const v = (await bill(cashier, { order_id: split.order_id })).data;
    expect(v.lines.map((l) => [l.order_item_id, l.part_of, l.units])).toEqual([
      ['K', 'K', 1],
      ['K-p2', 'K', 1],
      ['K-p3', 'K', 1],
      ['K-p4', 'K', 1],
      ['K-p5', 'K', 1],
    ]);
    const w = (await bill(cashier, { order_id: whole.order_id })).data;
    expect(w.lines.map((l) => [l.order_item_id, l.part_of, l.units])).toEqual([['W', null, 5]]);
    expect(v.lines.reduce((n, l) => n + l.base_minor, 0)).toBe(w.lines[0]!.base_minor);
    expect(await handlerStatements(cashier, 'bill', { order_id: split.order_id })).toBeLessThanOrEqual(8);
  });
});

// ================================================================================================= open bills

describe('[05 §6.2] GET /queries/open-bills', () => {
  beforeEach(() => start());

  const list = async (who: Who = cashier, qs: Record<string, string> = {}) => {
    const r = await get<{ bills: OpenBillRow[] }>(who, 'open-bills', qs);
    expect(r.error).toBeUndefined();
    return r.data.bills;
  };

  it('[05 §6.2, H1-21, H2-25] live bills, projected seatings and one row per bill_key; totals equal the bill view (H6-18)', async () => {
    const live = dineInTwoRounds(hub, { prefix: 'LV' });
    const bill_id = (await ensure({ seating_id: live.seating_id })).result!.bill_id as string;
    const projected = dineInTwoRounds(hub, { prefix: 'PJ', table_id: VX.tables.T5 });
    const { root, addition } = addedTakeaway(hub);
    const comp = compedLine(hub);
    openSeating(hub, { table_id: VX.tables.T8, seating_id: 'SEAT_EMPTY' }); // no order → no row
    const rows = await list();
    expect(rows).toHaveLength(4);
    const byKey = (pred: (r: OpenBillRow) => boolean) => rows.find(pred)!;
    const liveRow = byKey((r) => r.bill_id === bill_id);
    expect(liveRow).toMatchObject({ seating_id: live.seating_id, order_id: null, state: 'open', order_type: 'dine_in', identifier: VX.tables.T4, paid_minor: 0, partly_paid: false, has_open_request: false });
    const pj = byKey((r) => r.seating_id === projected.seating_id);
    expect(pj).toMatchObject({ bill_id: null, state: 'projected' });
    const tk = byKey((r) => r.order_id === root.order_id);
    expect(tk).toMatchObject({ bill_id: null, seating_id: null, order_type: 'takeaway', identifier: `#${root.token}` });
    for (const [row, qs] of [
      [liveRow, { bill_id }],
      [pj, { seating_id: projected.seating_id }],
      [tk, { order_id: addition.order_id }],
      [byKey((r) => r.order_id === comp.order_id), { order_id: comp.order_id }],
    ] as const) {
      expect(row.total_default_minor).toBe((await bill(cashier, qs)).data.totals_default.total_minor);
    }
  });

  it('[05 §6.2] a partly paid bill: open remainder total and payments; a closed bill leaves the list', async () => {
    const { seating_id, rounds } = dineInTwoRounds(hub);
    const bill_id = (await ensure({ seating_id })).result!.bill_id as string;
    const [A, B] = rounds[0].lines as [string, string];
    const C = rounds[1].lines[0]!;
    splitsSet(bill_id, 'items', [
      { split_no: 1, lines: [{ order_item_id: A, order_id: rounds[0].order_id, units: 1 }], share_minor: null },
      { split_no: 2, lines: [{ order_item_id: B, order_id: rounds[0].order_id, units: 1 }, { order_item_id: C, order_id: rounds[1].order_id, units: 1 }], share_minor: null },
    ]);
    const v0 = (await bill(cashier, { seating_id })).data;
    const baseA = v0.lines.find((l) => l.order_item_id === A)!.base_minor;
    pay(bill_id, 1, v0.splits[0].balance_minor, 'P_S1');
    closeInTest(bill_id, 1, [{ order_item_id: A, units: 1, base_minor: baseA }], [A, B, C]);
    pay(bill_id, 2, 500, 'P_S2');
    const row = (await list())[0]!;
    const v = (await bill(cashier, { seating_id })).data;
    expect(row).toMatchObject({ bill_id, state: 'partly_paid', partly_paid: true, paid_minor: v0.splits[0].balance_minor + 500 });
    expect(row.total_default_minor).toBe(v.totals_default.total_minor);
    closeInTest(bill_id, 2, [{ order_item_id: B, units: 1, base_minor: 3_000 }, { order_item_id: C, units: 1, base_minor: 3_000 }], null);
    // the last close's 02b OrdersBilled (§6.12 step 6, stream order of the first order)
    const order_ids = rounds.map((r) => r.order_id);
    hub.deps.writer.run((tx) =>
      tx.append([draftOf(OrdersBilled, { stream_type: 'order', stream_id: order_ids[0]!, payload: OrdersBilledPayload.parse({ order_ids, bill_id }), occurred_at: hub.clock.branchNow(), actor_id: STAFF.cashier, device_id: 'D_FIXTURE' })]),
    );
    expect((await bill(cashier, { bill_id })).data.state).toBe('closed');
    expect(await list()).toEqual([]);
  });

  it('[05 §6.2, H6-9] ordered by check_printed_at desc nulls last, then opened_at; flagged past open_bill_flag_minutes', async () => {
    const a = dineInTwoRounds(hub, { prefix: 'OA' });
    hub.clock.advance(60_000);
    const b = dineInTwoRounds(hub, { prefix: 'OB', table_id: VX.tables.T5 });
    hub.clock.advance(60_000);
    const c = dineInTwoRounds(hub, { prefix: 'OC', table_id: VX.tables.T6 });
    const billB = (await ensure({ seating_id: b.seating_id })).result!.bill_id as string;
    appendBill(billB, [{ def: CheckBillPrinted as unknown as EventDef<z.ZodType>, payload: { ...(aCheckBillPrinted().payload as object), bill_id: billB } }]);
    let rows = await list();
    expect(rows.map((r) => r.seating_id)).toEqual([b.seating_id, a.seating_id, c.seating_id]);
    expect(rows[0]!.check_printed_at).toBe(hub.clock.branchNow());
    expect(rows.every((r) => r.flagged === false)).toBe(true);
    hub.clock.advance(241 * 60_000);
    cashier = signIn(hub, STAFF.cashier);
    rows = await list();
    expect(rows.find((r) => r.seating_id === a.seating_id)).toMatchObject({ flagged: true });
    expect(rows.find((r) => r.seating_id === a.seating_id)!.open_minutes).toBeGreaterThan(240);
  });

  it('[05 v1.0.38 §6.2 QB-1; BUG-23] a check bill that makes the bill row keeps the "Open" minutes of its seating / root order', async () => {
    const t = dineInTwoRounds(hub, { prefix: 'QB' });
    const { root } = addedTakeaway(hub);
    hub.clock.advance(25 * 60_000);
    cashier = signIn(hub, STAFF.cashier);
    const before = await list();
    const seatBefore = before.find((r) => r.seating_id === t.seating_id)!;
    const keyBefore = before.find((r) => r.order_id === root.order_id)!;
    expect(seatBefore.open_minutes).toBeGreaterThanOrEqual(25);
    expect(keyBefore.open_minutes).toBeGreaterThanOrEqual(25);
    for (const ref of [{ seating_id: t.seating_id }, { order_id: root.order_id }] as Array<Record<string, string>>) {
      const bill_id = (await ensure(ref)).result!.bill_id as string;
      appendBill(bill_id, [{ def: CheckBillPrinted as unknown as EventDef<z.ZodType>, payload: { ...(aCheckBillPrinted().payload as object), bill_id } }]);
    }
    const after = await list();
    const seatAfter = after.find((r) => r.seating_id === t.seating_id)!;
    const keyAfter = after.find((r) => r.order_id === root.order_id)!;
    expect(seatAfter.bill_id).not.toBeNull();
    expect(keyAfter.bill_id).not.toBeNull();
    expect(seatAfter.opened_at).toBe(seatBefore.opened_at);
    expect(keyAfter.opened_at).toBe(keyBefore.opened_at);
    expect(seatAfter.open_minutes).toBe(seatBefore.open_minutes);
    expect(keyAfter.open_minutes).toBe(keyBefore.open_minutes);
  });

  it('[05 §6.2] floor_id keeps that floor\'s tables; take-payment own_tables sees its seatings and its own orders; not granted 403', async () => {
    const mine = dineInTwoRounds(hub, { prefix: 'MI' }); // holder S_WAIT
    openSeating(hub, { table_id: VX.tables.T6, seating_id: 'SEAT_MGR', holder_staff_id: STAFF.manager });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT_MGR', placed_by: STAFF.manager, lines: [{ order_item_id: 'MG_N', item_id: FX.naan }] });
    const tw = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'TW_N', item_id: FX.naan }] });
    appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.manager, lines: [{ order_item_id: 'TM_N', item_id: FX.naan }] });
    expect(await list()).toHaveLength(4);
    expect((await list(cashier, { floor_id: FX.floor })).map((r) => r.order_type)).toEqual(['dine_in', 'dine_in']);
    expect(await list(cashier, { floor_id: 'F_NONE' })).toEqual([]);
    const own = await list(waiter);
    expect(own.map((r) => r.seating_id ?? r.order_id).sort()).toEqual([mine.seating_id, tw.order_id].sort());
    const dir = await billingDirectory({ directory_version: 2 });
    await seedDirectory(hub, { ...dir, roles: dir.roles.map((r) => (r.role_id !== 'R_WAIT' ? r : { ...r, permissions: r.permissions.filter((g) => g.permission !== 'take-payment') })) });
    const denied = await get(waiter, 'open-bills', {});
    expect(denied.status).toBe(403);
    expect(denied.error?.code).toBe('PERMISSION_DENIED');
  });

  it('[05 #91] open-bills is 3 statements at 1 and at 40 bills', async () => {
    dineInTwoRounds(hub, { prefix: 'S1' });
    const at1 = await handlerStatements(cashier, 'open-bills', {});
    for (let i = 0; i < 39; i += 1) {
      const t = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: `K${i}_N`, item_id: FX.naan }, { order_item_id: `K${i}_K`, item_id: FX.piece }] });
      if (i % 2 === 0) await ensure({ order_id: t.order_id });
    }
    const rows = await list();
    expect(rows).toHaveLength(40);
    const at40 = await handlerStatements(cashier, 'open-bills', {});
    expect(at1).toBe(3);
    expect(at40).toBe(3);
  });
});

// ================================================================================================= review round 1

describe('[05 §6.1, §6.2] review round 1', () => {
  const list = async (who: Who = cashier, qs: Record<string, string> = {}) => {
    const r = await get<{ bills: OpenBillRow[] }>(who, 'open-bills', qs);
    expect(r.error).toBeUndefined();
    return r.data.bills;
  };

  it('[05 §6.2, H6-18] two profiles and an amount discount with a leftover unit: list total = the bill view totals_default', async () => {
    await start(billingDoc({ no_rounding: true }));
    // A 16 %, B 5 %, C 5 %, 3 000 each; 10 off → per line 4 / 3 / 3 (the leftover unit to the first line)
    const t = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'TP_A', item_id: FX.naan },
        { order_item_id: 'TP_B', item_id: FX.naan, item: { tax_class_id: LOW } },
        { order_item_id: 'TP_C', item_id: FX.naan, item: { tax_class_id: LOW } },
      ],
    });
    const bill_id = (await ensure({ order_id: t.order_id })).result!.bill_id as string;
    discountAmount(bill_id, 10);
    const v = (await bill(cashier, { bill_id })).data;
    expect(v.totals_default.discount_minor).toBe(10);
    expect((await list())[0]!.total_default_minor).toBe(v.totals_default.total_minor);
  });

  it('[05 §6.2, H2-2] a bill with a closed split (two profiles, frozen discount): list total = the bill view totals_default', async () => {
    await start(billingDoc({ no_rounding: true }));
    const { seating_id, rounds } = dineInTwoRounds(hub);
    const [A, B] = rounds[0].lines as [string, string];
    const C = rounds[1].lines[0]!;
    const D = 'CS_LOW';
    appendOrder(hub, { order_type: 'dine_in', seating_id, follow_up: true, lines: [{ order_item_id: D, item_id: FX.naan, item: { tax_class_id: LOW } }] });
    const bill_id = (await ensure({ seating_id })).result!.bill_id as string;
    discountAmount(bill_id, 10);
    const orderOf = new Map([[A, rounds[0].order_id], [B, rounds[0].order_id], [C, rounds[1].order_id]]);
    splitsSet(bill_id, 'items', [
      { split_no: 1, lines: [{ order_item_id: A, order_id: orderOf.get(A)!, units: 1 }], share_minor: null },
      { split_no: 2, lines: [{ order_item_id: B, order_id: orderOf.get(B)!, units: 1 }, { order_item_id: C, order_id: orderOf.get(C)!, units: 1 }], share_minor: null },
    ]);
    const v0 = (await bill(cashier, { bill_id })).data;
    const a = v0.lines.find((l) => l.order_item_id === A)!;
    const ids = v0.lines.map((l) => l.order_item_id);
    closeInTest(bill_id, 1, [{ order_item_id: A, units: 1, base_minor: a.base_minor, discount_minor: v0.splits[0]!.totals.as_paid.discount_minor }], ids);
    freeze(bill_id, 10, ids);
    appendOrder(hub, { order_type: 'dine_in', seating_id, follow_up: true, lines: [{ order_item_id: 'CS_LATE', item_id: FX.naan }] });
    const v = (await bill(cashier, { bill_id })).data;
    expect(v.state).toBe('partly_paid');
    expect((await list())[0]!.total_default_minor).toBe(v.totals_default.total_minor);
  });

  it('[05 §6.1, C8] a caller with neither take-payment nor take-order gets 403 before the ref is resolved', async () => {
    await start();
    await reseedWaiter({ drop: ['take-payment', 'take-order'] });
    const r = await bill(waiter, { bill_id: 'NOPE' });
    expect(r.status).toBe(403);
    expect(r.error?.code).toBe('PERMISSION_DENIED');
  });

  it('[05 §6.2, H6-9] two check bills printed at different times: the later print comes first', async () => {
    await start();
    const a = dineInTwoRounds(hub, { prefix: 'QA' });
    const b = dineInTwoRounds(hub, { prefix: 'QB', table_id: VX.tables.T5 });
    const billA = (await ensure({ seating_id: a.seating_id })).result!.bill_id as string;
    const billB = (await ensure({ seating_id: b.seating_id })).result!.bill_id as string;
    const print = (id: string) => appendBill(id, [{ def: CheckBillPrinted as unknown as EventDef<z.ZodType>, payload: { ...(aCheckBillPrinted().payload as object), bill_id: id } }]);
    print(billB);
    print(billA); // later
    const rows = await list();
    expect(rows.map((r) => r.bill_id)).toEqual([billA, billB]);
    expect(rows[0]!.check_printed_at!).toBeGreaterThan(rows[1]!.check_printed_at!);
  });

  it('[05 §6.1, §6.2] my_floors: a seating on the caller\'s floor (not held) is covered; a key bill only when he placed an order', async () => {
    await start();
    openSeating(hub, { table_id: VX.tables.T6, seating_id: 'SEAT_F', holder_staff_id: STAFF.manager });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT_F', placed_by: STAFF.manager, lines: [{ order_item_id: 'MF_N', item_id: FX.naan }] });
    const his = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'MF_T1', item_id: FX.naan }] });
    const other = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.manager, lines: [{ order_item_id: 'MF_T2', item_id: FX.naan }] });
    await reseedWaiter({ scope: 'my_floors', floor_ids: [FX.floor] });
    expect((await bill(waiter, { seating_id: 'SEAT_F' })).status).toBe(200);
    expect((await bill(waiter, { order_id: his.order_id })).status).toBe(200);
    expect((await bill(waiter, { order_id: other.order_id })).error?.details).toEqual({ reason: 'outside_scope' });
    expect((await list(waiter)).map((r) => r.seating_id ?? r.order_id).sort()).toEqual(['SEAT_F', his.order_id].sort());
    await reseedWaiter({ scope: 'my_floors', floor_ids: [] });
    expect((await bill(waiter, { seating_id: 'SEAT_F' })).error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: [VX.tables.T6] } });
    expect((await list(waiter)).map((r) => r.order_id)).toEqual([his.order_id]);
  });

  it('[05 §6.2 R9] open-bills LINE_BASE equals 02b billed_minor (§3.1 base rules), line by line, over option child, deal, return, comp and pending void', async () => {
    await start();
    const opt = optionChildOrder(hub);
    const deal = dealX2(hub);
    const ret = await remakeLine(hub);
    const comp = compedLine(hub);
    const pv = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'LB_PV', item_id: FX.naan, quantity: 2 }] });
    raiseVoid(hub, { requester: cashier, order_id: pv.order_id, order_item_id: 'LB_PV', units: 1 });
    const order_ids = [opt.order_id, deal.order_id, ret.order_id, comp.order_id, pv.order_id];
    const listed = new Map(
      (hub.deps.db.prepare(`SELECT l.order_item_id AS id, ${LINE_BASE} AS base FROM order_lines l WHERE l.order_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(order_ids)) as Array<{ id: string; base: number }>).map((r) => [r.id, r.base]),
    );
    const lines = [...orderLines(hub.deps.db, order_ids).values()].flat();
    expect(lines.some((l) => l.line_kind === 'option_child') && lines.some((l) => l.line_kind === 'deal_part') && lines.some((l) => l.return_of !== null)).toBe(true);
    for (const l of lines) {
      // the list never subtracts pending voids (§6.2); deal parts and return lines are 0, nothing below 0 (§3.1)
      const expected = l.line_kind === 'deal_part' || l.return_of !== null ? 0 : Math.max(0, l.billed_minor);
      expect([l.order_item_id, listed.get(l.order_item_id)]).toEqual([l.order_item_id, expected]);
    }
  });
});
