// 05 §6.9 `AddPayment`, §6.10 `RemovePayment`, §3.5 (7), §3.7, B10, B11, B30, H1-20, H8-3 / R-46, R-44 (task 16; 05-plan §3
// row 16). Real commands over HTTP through the hub's writer, the real `billing` and `shifts` folds (tasks 7, 8), the real
// `OpenShift` (task 15) and the bill view (task 10). Closes, reopens and shift counts are in-test events (tasks 17, 19,
// 21 are not built): task 5's builders, folded by tasks 7 and 8.
import { InvoiceIssued, BillReopened, ItemRemoved, ShiftCounted, ShiftClosed, draftOf, rateBpRates, type BranchConfig, type EventDef, type EventDraft, type PosEvent, type SnapshotBilling } from '@pos/events';
import { aBillReopened, anInvoiceIssued, aShiftClosed, aShiftCounted } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { hubBilling } from '../../src/billing/defaults';
import { shiftsProjection } from '../../src/billing/projections/shifts';
import type { BillView } from '../../src/billing/queries/bill';
import type { CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { createProjectionRegistry } from '../../src/projections/registry';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import type { TestHub } from '../helpers/test-hub';
import { openDay, startVoids, voidsMenu } from '../voids/fixtures';
import { appendOrder, billingDirectory, drawerDevice, FX, openSeating, post, signIn, signInOn, STAFF, startBilling, VX, type Reply, type Who } from './fixtures';

let hub: TestHub;

/** Every reference and note text a test sends: the afterEach scan holds each of them to its text store. */
const SECRETS = new Set<string>();
const secret = (s: string): string => {
  SECRETS.add(s);
  return s;
};

afterEach(async () => {
  // B30, H1-20, H-4: the permanent leak scan — every secret a test registered, after every test
  const found = hub === undefined ? [] : [...SECRETS].flatMap((s) => leaksOf(s).map((place) => `${s} in ${place}`));
  SECRETS.clear();
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
  expect(found).toEqual([]);
});

// ------------------------------------------------------------------------------------------------ config

interface DocOptions {
  cash_bp?: number;
  card_bp?: number;
  /** rounding step (null = none); default 100 (Rs 1) */
  step?: number | null;
  applies_to?: 'all' | 'cash';
  adapter_key?: string;
  switched_at?: string | null;
  fiscalize?: { dine_in: boolean; takeaway: boolean; parking: boolean; delivery: boolean };
  /** permissions denied to the Order taker (the grant-first tests) */
  deny?: string[];
}

/**
 * The PK built-in document with four modes — cash, card (digital), wallet (digital, reference required), voucher
 * (digital, no authority code) — 'tc-food' at cash_bp / card_bp, rounding `step` nearest on `applies_to`, buyer ID off.
 */
function billingDoc(o: DocOptions = {}): SnapshotBilling {
  const pk = hubBilling({ currency_code: 'PKR', tax_classes: [], billing: undefined });
  const adapter = o.adapter_key ?? 'none';
  const code = (c: string) => (adapter === 'none' ? [] : [{ adapter_key: adapter, code: c }]);
  const cash = pk.settings.payment_modes[0]!;
  const mode = (mode_id: string, name: string, sort_order: number, reference_required: boolean, codes: Array<{ adapter_key: string; code: string }>) => ({
    mode_id,
    name,
    kind: 'card' as const,
    payment_class: 'digital' as const,
    reference_required,
    is_active: true,
    sort_order,
    authority_codes: codes,
  });
  return {
    ...pk.settings,
    payment_modes: [
      { ...cash, authority_codes: code('1') },
      mode('card', 'Card', 1, false, code('2')),
      mode('wallet', 'Wallet', 2, true, code('5')),
      mode('voucher', 'Voucher', 3, false, []),
      { ...mode('old', 'Old card', 4, false, code('2')), is_active: false },
    ],
    fiscal: {
      ...pk.settings.fiscal,
      pos_ids: adapter === 'none' ? [] : [{ pos_id: 'POS-1', label: 'Counter' }],
      default_pos_id: adapter === 'none' ? null : 'POS-1',
      switched_at: o.switched_at ?? null,
      fiscalize_by_order_type: o.fiscalize ?? pk.settings.fiscal.fiscalize_by_order_type,
    },
    jurisdiction: {
      ...pk.jurisdiction,
      adapter_key: adapter,
      rules: pk.jurisdiction.rules.map((r) => ({
        ...r,
        rounding_step_minor: o.step === undefined ? 100 : o.step,
        rounding_mode: 'nearest',
        rounding_applies_to: o.applies_to ?? 'all',
        buyer_id: { ...r.buyer_id, threshold_minor: null },
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
            rates: [...rateBpRates(o.cash_bp ?? 1_600).filter((x) => x.payment_class === 'cash'), ...rateBpRates(o.card_bp ?? 500).filter((x) => x.payment_class === 'digital')],
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

const STOCK = { [FX.stock]: 1_000_000, [VX.naanStock]: 1_000 };
let doc: SnapshotBilling;

/** handler statements of the last call per command path (the set-splits countHandle pattern) */
const handled: Record<string, number> = {};

function countHandle(path: string): void {
  const def = commandRegistry(hub.app).byPath(path) as CommandDef | undefined;
  if (def === undefined) return; // not registered: every call answers 404 (the failing-first state)
  const counter = statementCounter(hub.deps.db);
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

async function start(o: DocOptions = {}): Promise<void> {
  if (o.deny === undefined) hub = await startBilling({ open: false });
  else {
    const directory = await billingDirectory();
    const denied = o.deny;
    hub = await startVoids({ open: false, directory: { ...directory, staff: directory.staff.map((s) => (s.staff_id === STAFF.orderTaker ? { ...s, denied_permissions: denied } : s)) } as typeof directory });
  }
  doc = billingDoc(o);
  openDay(hub, { menu: menu(doc), stock: STOCK });
  for (const k of Object.keys(handled)) delete handled[k];
  countHandle('add-payment');
  countHandle('remove-payment');
}

// ------------------------------------------------------------------------------------------------ helpers

const db = () => hub.deps.db;

function addPayment(who: Who, payload: Record<string, unknown>, commandId?: string): Promise<Reply> {
  return post(hub, who, 'add-payment', 'AddPayment', payload, commandId);
}

function removePayment(who: Who, payload: Record<string, unknown>, commandId?: string): Promise<Reply> {
  return post(hub, who, 'remove-payment', 'RemovePayment', payload, commandId);
}

async function openShift(who: Who, o: { float_minor?: number; as_drawer?: boolean } = {}): Promise<string> {
  const r = await post(hub, who, 'open-shift', 'OpenShift', { float_minor: o.float_minor ?? 0, as_drawer: o.as_drawer ?? true });
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  return r.result!['shift_id'] as string;
}

/** `staffId` signed in on a new cashier kiosk, with a drawer shift open on it. */
async function drawer(staffId: string, name: string, float_minor = 0): Promise<{ who: Who; shift_id: string }> {
  const who = signInOn(hub, staffId, drawerDevice(hub, name));
  return { who, shift_id: await openShift(who, { float_minor }) };
}

/** A takeover on a device (§3.11): `prev`'s session ends, `staffId` signs in on the same device. */
function takeover(prev: Who, staffId: string): Who {
  db().prepare(`UPDATE staff_sessions SET ended_at = ?, end_reason = 'logout' WHERE session_id = ?`).run(hub.clock.branchNow(), prev.sessionId);
  return signInOn(hub, staffId, { deviceId: prev.deviceId, token: prev.token });
}

async function view(who: Who, qs: Record<string, string>): Promise<BillView> {
  const res = await hub.app.inject({ method: 'GET', url: `/queries/bill?${new URLSearchParams(qs).toString()}`, headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: BillView }).data;
}

let seatNo = 0;
/** A seating (held by `holder`, default the order taker) with one dine-in round; returns its ids. */
function seated(lines: Array<{ order_item_id: string; item_id: string; quantity?: number }>, o: { holder?: string; table_id?: string } = {}): { seating_id: string; order_id: string } {
  seatNo += 1;
  const seating_id = `SEAT_P${seatNo}`;
  openSeating(hub, { table_id: o.table_id ?? VX.tables.T4, seating_id, ...(o.holder === undefined ? {} : { holder_staff_id: o.holder }) });
  const { order_id } = appendOrder(hub, { order_type: 'dine_in', seating_id, placed_by: STAFF.orderTaker, lines });
  return { seating_id, order_id };
}

/** Karahi 1,200 + naan 30 + naan 30 = 1,260.00 net: cash 16 % → 1,461.60 (→ 1,462.00), card 5 % → 1,323.00. */
function table7(o: { holder?: string; table_id?: string } = {}): { seating_id: string } {
  return seated(
    [
      { order_item_id: `K${seatNo + 1}`, item_id: FX.piece },
      { order_item_id: `N${seatNo + 1}a`, item_id: FX.naan },
      { order_item_id: `N${seatNo + 1}b`, item_id: FX.naan },
    ],
    o,
  );
}

/** Four karahis: 4,800.00 net, cash 16 % → 5,568.00 (no rounding). */
function fourKarahi(): { seating_id: string } {
  return seated([{ order_item_id: `K4_${seatNo + 1}`, item_id: FX.piece, quantity: 4 }]);
}

const billIdOf = (seating_id: string) => db().prepare('SELECT bill_id FROM bills WHERE seating_id = ?').pluck().get(seating_id) as string;
const shiftRow = (shift_id: string) => db().prepare('SELECT expected_cash_minor FROM shifts WHERE shift_id = ?').pluck().get(shift_id) as number;
const takings = (shift_id: string) =>
  db().prepare('SELECT mode_id, taken_by_staff_id, in_minor, out_minor, change_minor FROM shift_takings WHERE shift_id = ? ORDER BY mode_id, taken_by_staff_id').all(shift_id);
const added = (r: Reply) => r.events.find((e) => e.event_type === 'PaymentAdded')!.payload;

/**
 * B30, H1-20, H3-5 (the spike's leaksOf): `secret` in the captured hub logs or in any table but the two text stores
 * (`payment_references` for a reference, `bill_texts` for a note) — every event stream, processed_commands (stored
 * reply), print jobs, projections, audit. Returns the places.
 */
function leaksOf(secret: string): string[] {
  const places: string[] = [];
  if (hub.logs().includes(secret)) places.push('hub.logs()');
  const tables = db().prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('payment_references', 'bill_texts') ORDER BY name`).pluck().all() as string[];
  for (const t of tables) if (JSON.stringify(db().prepare(`SELECT * FROM "${t}"`).all()).includes(secret)) places.push(`table ${t}`);
  return places;
}

/** One writer transaction of in-test events (clock +1 s). */
function appendEvents(items: Array<{ def: EventDef<z.ZodType>; stream_type: EventDraft['stream_type']; stream_id: string; payload: unknown }>): PosEvent[] {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  const drafts: EventDraft[] = items.map((i) => draftOf(i.def, { stream_type: i.stream_type, stream_id: i.stream_id, payload: i.def.payload.parse(i.payload), occurred_at: now, actor_id: STAFF.cashier, device_id: 'D_FIXTURE' }));
  return hub.deps.writer.run((tx) => tx.append(drafts)).appended;
}
const asDef = (d: unknown) => d as EventDef<z.ZodType>;

/** In-test close of split 1 (task 17 not built): task 5's InvoiceIssued, not fiscalized. */
function closeInTest(bill_id: string, lines: Array<{ order_item_id: string; base_minor: number }>, payment_ids: string[]): void {
  const base = anInvoiceIssued().payload as { lines: Array<Record<string, unknown>>; fiscal: Record<string, unknown> } & Record<string, unknown>;
  const subtotal = lines.reduce((a, l) => a + l.base_minor, 0);
  appendEvents([
    {
      def: asDef(InvoiceIssued),
      stream_type: 'bill',
      stream_id: bill_id,
      payload: {
        ...base,
        invoice_id: 'INV_P1',
        number: 1,
        invoice_ref: 'T-S000001',
        bill_id,
        split_no: 1,
        lines: lines.map((l) => ({ ...base.lines[0], order_item_id: l.order_item_id, units: 1, base_minor: l.base_minor, discount_minor: 0, unit_price_minor: 0, taxes: [] })),
        service_charge: null,
        subtotal_minor: subtotal,
        discount_minor: 0,
        service_charge_minor: 0,
        taxes: [],
        rounding_minor: 0,
        total_minor: subtotal,
        payment_ids,
        change_minor: 0,
        discount_line_ids: null,
        fiscal: { ...base.fiscal, adapter_key: 'none', required: false, pos_id: null, payment_codes: [] },
      },
    },
  ]);
}

const DUE_KEYS = ['balance_minor', 'card_due_minor', 'cash_due_minor', 'card_refund_due_minor', 'cash_refund_due_minor', 'rounding_minor', 'change_due_minor'] as const;
const dues = (r: Reply) => Object.fromEntries(DUE_KEYS.map((k) => [k, r.result?.[k]]));

// ================================================================================================= AddPayment

describe('[05 §6.9, §3.5 (7), §3.7] AddPayment — dues, change, shifts', () => {
  it('[05 #21] cash 430 000 tendered 500 000 → change 70 000 on that payment’s shift; expected +430 000; a second cash payment on another shift keeps its own change', async () => {
    await start();
    const a = await drawer(STAFF.cashier, 'Kiosk A');
    const b = await drawer(STAFF.manager, 'Kiosk B');
    const t = fourKarahi();

    const r1 = await addPayment(a.who, { bill_ref: { seating_id: t.seating_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 430_000, tendered_minor: 500_000 });
    expect(r1.status, JSON.stringify(r1.error)).toBe(200);
    const bill_id = billIdOf(t.seating_id);
    expect(r1.events.map((e) => e.event_type)).toEqual(['BillOpened', 'PaymentAdded']);
    expect(added(r1)).toEqual({
      payment_id: r1.result!['payment_id'],
      bill_id,
      split_no: 1,
      mode_id: 'cash',
      payment_class: 'cash',
      direction: 'in',
      amount_minor: 430_000,
      tendered_minor: 500_000,
      change_minor: 70_000,
      has_reference: false,
      taken_by_staff_id: STAFF.cashier,
      shift_id: a.shift_id,
    });
    expect(dues(r1)).toEqual({ balance_minor: 126_800, card_due_minor: 126_800, cash_due_minor: 126_800, card_refund_due_minor: 0, cash_refund_due_minor: 0, rounding_minor: 0, change_due_minor: 70_000 });

    // a cash amount above cash_due → refused with that due
    const over = await addPayment(b.who, { bill_ref: { bill_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 126_801 });
    expect(over.status).toBe(422);
    expect(over.error).toEqual({ code: 'PAYMENT_EXCEEDS_BALANCE', details: { balance_minor: 126_800 } });

    const r2 = await addPayment(b.who, { bill_ref: { bill_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 126_800, tendered_minor: 130_000 });
    expect(r2.status, JSON.stringify(r2.error)).toBe(200);
    expect(added(r2)).toMatchObject({ shift_id: b.shift_id, change_minor: 3_200, taken_by_staff_id: STAFF.manager });
    expect(dues(r2)).toEqual({ balance_minor: 0, card_due_minor: 0, cash_due_minor: 0, card_refund_due_minor: 0, cash_refund_due_minor: 0, rounding_minor: 0, change_due_minor: 3_200 });

    // §3.7: expected cash moves by the amount only (tendered and change cancel out on the receiving shift)
    expect(shiftRow(a.shift_id)).toBe(430_000);
    expect(shiftRow(b.shift_id)).toBe(126_800);
    expect(takings(a.shift_id)).toEqual([{ mode_id: 'cash', taken_by_staff_id: STAFF.cashier, in_minor: 430_000, out_minor: 0, change_minor: 70_000 }]);
    expect(takings(b.shift_id)).toEqual([{ mode_id: 'cash', taken_by_staff_id: STAFF.manager, in_minor: 126_800, out_minor: 0, change_minor: 3_200 }]);

    // the bill view: exact balance 0, both payments with their own change
    const v = await view(a.who, { bill_id });
    expect(v.splits[0]).toMatchObject({ balance_minor: 0, totals: { as_paid: { total_minor: 556_800 } } });
    expect(v.splits[0]!.payments.map((p) => [p.amount_minor, p.tendered_minor, p.change_minor])).toEqual([
      [430_000, 500_000, 70_000],
      [126_800, 130_000, 3_200],
    ]);
  });

  it('[05 #21, #24, H16-1, H17-3] card first then cash: a cash in above the balance but ≤ cash_due is accepted; the result recomputes the class and the tax (M-7)', async () => {
    await start();
    const a = await drawer(STAFF.cashier, 'Kiosk A');
    const t = table7();
    const ref = { seating_id: t.seating_id };

    // unpaid: cash class 1,462.00; card due at 5 % 1,323.00
    const card = await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id: 'card', direction: 'in', amount_minor: 50_000 });
    expect(card.status, JSON.stringify(card.error)).toBe(200);
    expect(added(card)).toMatchObject({ payment_class: 'digital', tendered_minor: null, change_minor: null });
    // now digital: total 1,323.00, balance 823.00; cash due at 16 % = 1,462.00 − 500.00
    expect(dues(card)).toEqual({ balance_minor: 82_300, card_due_minor: 82_300, cash_due_minor: 96_200, card_refund_due_minor: 0, cash_refund_due_minor: 0, rounding_minor: 0, change_due_minor: 0 });
    expect(card.result!['totals']).toMatchObject({ as_paid: { total_minor: 132_300, taxes: [{ payment_class: 'digital', rate_bp: 500, tax_minor: 6_300 }] } });

    const tooMuch = await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 96_201 });
    expect(tooMuch.error).toEqual({ code: 'PAYMENT_EXCEEDS_BALANCE', details: { balance_minor: 96_200 } });

    // 962.00 > the 823.00 balance, ≤ cash due: accepted; the split is mixed → cash rates on the whole (higher_rate)
    const cash = await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 96_200, tendered_minor: 100_000 });
    expect(cash.status, JSON.stringify(cash.error)).toBe(200);
    expect(dues(cash)).toEqual({ balance_minor: 0, card_due_minor: 0, cash_due_minor: 0, card_refund_due_minor: 0, cash_refund_due_minor: 0, rounding_minor: 40, change_due_minor: 3_800 });
    expect(cash.result!['totals']).toMatchObject({ as_paid: { total_minor: 146_200, rounding_minor: 40, taxes: [{ payment_class: 'cash', rate_bp: 1_600, tax_minor: 20_160 }] } });

    // H17-1: a paid split takes no further in, whatever the mode
    for (const mode_id of ['cash', 'card']) {
      const more = await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id, direction: 'in', amount_minor: 1 });
      expect(more.error).toEqual({ code: 'PAYMENT_EXCEEDS_BALANCE', details: { balance_minor: 0 } });
    }
    const v = await view(a.who, ref);
    expect(v.splits[0]).toMatchObject({ balance_minor: 0, totals: { as_paid: { total_minor: 146_200 } } });
    expect(shiftRow(a.shift_id)).toBe(96_200);
  });

  it('[05 #22] a card above card_due → PAYMENT_EXCEEDS_BALANCE; reference required → PAYMENT_REFERENCE_REQUIRED', async () => {
    await start();
    const a = await drawer(STAFF.cashier, 'Kiosk A');
    const t = table7();
    const ref = { seating_id: t.seating_id };
    const over = await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id: 'card', direction: 'in', amount_minor: 132_301 });
    expect(over.status).toBe(422);
    expect(over.error).toEqual({ code: 'PAYMENT_EXCEEDS_BALANCE', details: { balance_minor: 132_300 } });
    const noRef = await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id: 'wallet', direction: 'in', amount_minor: 1_000 });
    expect(noRef.status).toBe(422);
    expect(noRef.error).toEqual({ code: 'PAYMENT_REFERENCE_REQUIRED', details: { mode_id: 'wallet' } });
    const exact = await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id: 'card', direction: 'in', amount_minor: 132_300 });
    expect(exact.status, JSON.stringify(exact.error)).toBe(200);
    expect(exact.result!['balance_minor']).toBe(0);
  });

  it('[05 #22, H18-3] under cash-only rounding a card above the balance but ≤ card_due is accepted', async () => {
    await start({ card_bp: 1_600, step: 500, applies_to: 'cash' });
    const a = await drawer(STAFF.cashier, 'Kiosk A');
    const t = table7();
    const ref = { seating_id: t.seating_id };
    // G = 1,461.60 both classes; cash class rounds to 1,460.00 (R −1.60), a card pays G exactly
    const v0 = await view(a.who, ref);
    expect(v0.splits[0]!.balance_minor).toBe(146_000);
    const over = await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id: 'card', direction: 'in', amount_minor: 146_161 });
    expect(over.error).toEqual({ code: 'PAYMENT_EXCEEDS_BALANCE', details: { balance_minor: 146_160 } });
    const card = await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id: 'card', direction: 'in', amount_minor: 146_160 });
    expect(card.status, JSON.stringify(card.error)).toBe(200);
    expect(dues(card)).toMatchObject({ balance_minor: 0, rounding_minor: 0 });
  });

  it('[05 §3.5 (7), H10-2] under applies_to cash a cash amount off the step → PAYMENT_CASH_STEP; cash_due is floored to the step', async () => {
    await start({ card_bp: 1_600, step: 500, applies_to: 'cash' });
    const a = await drawer(STAFF.cashier, 'Kiosk A');
    const t = table7();
    const ref = { seating_id: t.seating_id };
    const off = await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 145_900 });
    expect(off.status).toBe(422);
    expect(off.error).toEqual({ code: 'PAYMENT_CASH_STEP', details: { step_minor: 500 } });
    const above = await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 146_500 });
    expect(above.error).toEqual({ code: 'PAYMENT_EXCEEDS_BALANCE', details: { balance_minor: 146_000 } });
    const part = await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 145_500, tendered_minor: 150_000 });
    expect(part.status, JSON.stringify(part.error)).toBe(200);
    expect(dues(part)).toMatchObject({ balance_minor: 500, cash_due_minor: 500, rounding_minor: -160, change_due_minor: 4_500 });
    const rest = await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 500 });
    expect(rest.result!['balance_minor']).toBe(0);
    expect(shiftRow(a.shift_id)).toBe(146_000);
  });

  it('[05 §6.9] refusals in script order: mode, tender, shift, split, out on a positive balance; nothing is written', async () => {
    await start();
    const cashierOnTablet = signIn(hub, STAFF.cashier);
    const t = table7();
    const ref = { seating_id: t.seating_id };
    const pay = (who: Who, p: Record<string, unknown>) => addPayment(who, { bill_ref: ref, split_no: 1, direction: 'in', amount_minor: 1_000, ...p });

    // no shift anywhere → SHIFT_NOT_OPEN no_shift
    const noShift = await pay(cashierOnTablet, { mode_id: 'cash' });
    expect(noShift.status).toBe(409);
    expect(noShift.error).toEqual({ code: 'SHIFT_NOT_OPEN', details: { reason: 'no_shift' } });

    const a = await drawer(STAFF.cashier, 'Kiosk A');
    for (const mode_id of ['nope', 'old']) {
      const r = await pay(a.who, { mode_id });
      expect(r.status).toBe(404);
      expect(r.error).toEqual({ code: 'PAYMENT_MODE_NOT_FOUND', details: { mode_id } });
    }
    // H2-28: tendered only on a cash in
    const cardTender = await pay(a.who, { mode_id: 'card', tendered_minor: 2_000 });
    expect(cardTender.status).toBe(400);
    expect(cardTender.error!.code).toBe('VALIDATION_FAILED');
    expect(cardTender.error!.details['issues']).toEqual([expect.objectContaining({ path: 'tendered_minor' })]);
    const outTender = await pay(a.who, { mode_id: 'cash', direction: 'out', tendered_minor: 2_000 });
    expect(outTender.status).toBe(400);
    expect(outTender.error!.details['issues']).toEqual([expect.objectContaining({ path: 'tendered_minor' })]);
    const short = await pay(a.who, { mode_id: 'cash', tendered_minor: 999 });
    expect(short.status).toBe(400);
    expect(short.error!.details['issues']).toEqual([expect.objectContaining({ path: 'tendered_minor' })]);
    const zero = await pay(a.who, { mode_id: 'cash', amount_minor: 0 });
    expect(zero.status).toBe(400);

    // a split that does not exist → BILL_NOT_OPEN
    const split2 = await addPayment(a.who, { bill_ref: ref, split_no: 2, mode_id: 'cash', direction: 'in', amount_minor: 1_000 });
    expect(split2.status).toBe(409);
    expect(split2.error!.code).toBe('BILL_NOT_OPEN');

    // §3.7: an out only while the balance is negative (each type's refund due is 0)
    for (const mode_id of ['cash', 'card']) {
      const out = await pay(a.who, { mode_id, direction: 'out' });
      expect(out.status).toBe(422);
      expect(out.error).toEqual({ code: 'PAYMENT_EXCEEDS_BALANCE', details: { balance_minor: 0 } });
    }
    expect(db().prepare('SELECT COUNT(*) FROM bill_payments').pluck().get()).toBe(0);
    expect(db().prepare(`SELECT COUNT(*) FROM events WHERE event_type IN ('PaymentAdded', 'BillOpened')`).pluck().get()).toBe(0);
  });

  it('[05 §6.9] a closed split takes no payment (BILL_NOT_OPEN)', async () => {
    await start();
    const a = await drawer(STAFF.cashier, 'Kiosk A');
    const t = table7();
    const r = await addPayment(a.who, { bill_ref: { seating_id: t.seating_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 146_200 });
    const bill_id = billIdOf(t.seating_id);
    closeInTest(bill_id, [{ order_item_id: 'K1', base_minor: 120_000 }], [r.result!['payment_id'] as string]);
    const after = await addPayment(a.who, { bill_ref: { bill_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 100 });
    expect(after.status).toBe(409);
    expect(after.error).toEqual({ code: 'BILL_NOT_OPEN', details: { bill_id, state: 'closed' } });
  });

  it('[05 #48] takeover on a drawer kiosk: the second person’s cash and card land in the drawer shift with taken_by = them, even with an own shift elsewhere', async () => {
    await start();
    const a = await drawer(STAFF.cashier, 'Kiosk A');
    const managerTablet = signIn(hub, STAFF.manager);
    const managerOwn = await openShift(managerTablet, { as_drawer: false });
    const t = fourKarahi();
    const ref = { seating_id: t.seating_id };
    const c1 = await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 100_000 });
    expect(added(c1)).toMatchObject({ shift_id: a.shift_id, taken_by_staff_id: STAFF.cashier });

    const m = takeover(a.who, STAFF.manager);
    const c2 = await addPayment(m, { bill_ref: ref, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 50_000, tendered_minor: 60_000 });
    const c3 = await addPayment(m, { bill_ref: ref, split_no: 1, mode_id: 'card', direction: 'in', amount_minor: 20_000 });
    for (const r of [c2, c3]) {
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      expect(added(r)).toMatchObject({ shift_id: a.shift_id, taken_by_staff_id: STAFF.manager });
    }
    expect(takings(a.shift_id)).toEqual([
      { mode_id: 'card', taken_by_staff_id: STAFF.manager, in_minor: 20_000, out_minor: 0, change_minor: 0 },
      { mode_id: 'cash', taken_by_staff_id: STAFF.cashier, in_minor: 100_000, out_minor: 0, change_minor: 0 },
      { mode_id: 'cash', taken_by_staff_id: STAFF.manager, in_minor: 50_000, out_minor: 0, change_minor: 10_000 },
    ]);
    expect(takings(managerOwn)).toEqual([]);
    expect(shiftRow(a.shift_id)).toBe(150_000);

    // the drawer's shift view: the breakdown by taker (card amounts shown, cash before the count by count only, B23)
    const res = await hub.app.inject({ method: 'GET', url: `/queries/shift?shift_id=${a.shift_id}`, headers: { authorization: `Bearer ${m.token}`, 'x-session-token': m.sessionToken } });
    expect(res.statusCode, res.body).toBe(200);
    const takingRows = (res.json() as { data: { takings: Array<{ mode_id: string; by: Array<{ taken_by_name: string | null; payments_count: number; in_minor: number | null }> }> } }).data.takings;
    const cashBy = takingRows.find((x) => x.mode_id === 'cash')!.by;
    expect(cashBy.map((b) => b.payments_count).sort()).toEqual([1, 1]);
    expect(cashBy.every((b) => b.in_minor === null)).toBe(true);
    expect(takingRows.find((x) => x.mode_id === 'card')!.by).toEqual([expect.objectContaining({ payments_count: 1, in_minor: 20_000 })]);
  });

  it('[05 #49] an order taker (take-payment own_tables) with an own shift collects on an own table only, into that shift', async () => {
    await start();
    const taker = signIn(hub, STAFF.orderTaker);
    const own = await openShift(taker, { as_drawer: false });
    const mine = table7();
    const theirs = table7({ holder: STAFF.manager, table_id: VX.tables.T5 });

    const ok = await addPayment(taker, { bill_ref: { seating_id: mine.seating_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 10_000 });
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    expect(added(ok)).toMatchObject({ shift_id: own, taken_by_staff_id: STAFF.orderTaker });

    const refused = await addPayment(taker, { bill_ref: { seating_id: theirs.seating_id }, split_no: 1, mode_id: 'wallet', direction: 'in', amount_minor: 10_000, reference: secret('REF-SCOPE-0001') });
    expect(refused.status).toBe(403);
    expect(refused.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: [VX.tables.T5] } });
    expect(db().prepare('SELECT COUNT(*) FROM payment_references').pluck().get()).toBe(0);
    expect(db().prepare('SELECT COUNT(*) FROM bills WHERE seating_id = ?').pluck().get(theirs.seating_id)).toBe(0);
    expect(shiftRow(own)).toBe(10_000);
  });
});

describe('[05 §6.9, H8-3, R-46] AddPayment — PAYMENT_MODE_NOT_FISCAL', () => {
  const FISCALIZE = { dine_in: true, takeaway: false, parking: true, delivery: false };

  it('[05 #74b add half] adapter ≠ none, a fiscalized order type, a mode with no code for the adapter → 422; a non-fiscalized type takes it', async () => {
    await start({ adapter_key: 'TEST', fiscalize: FISCALIZE });
    const a = await drawer(STAFF.cashier, 'Kiosk A');
    const t = table7();
    const refused = await addPayment(a.who, { bill_ref: { seating_id: t.seating_id }, split_no: 1, mode_id: 'voucher', direction: 'in', amount_minor: 1_000 });
    expect(refused.status).toBe(422);
    expect(refused.error).toEqual({ code: 'PAYMENT_MODE_NOT_FISCAL', details: { mode_id: 'voucher', adapter_key: 'TEST' } });
    const coded = await addPayment(a.who, { bill_ref: { seating_id: t.seating_id }, split_no: 1, mode_id: 'card', direction: 'in', amount_minor: 1_000 });
    expect(coded.status, JSON.stringify(coded.error)).toBe(200);

    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'TW_N', item_id: FX.naan }] });
    const takeaway = await addPayment(a.who, { bill_ref: { order_id }, split_no: 1, mode_id: 'voucher', direction: 'in', amount_minor: 1_000 });
    expect(takeaway.status, JSON.stringify(takeaway.error)).toBe(200);
  });

  it('[05 R-46] before switched_at the split is not fiscalized: any mode is taken', async () => {
    await start({ adapter_key: 'TEST', fiscalize: FISCALIZE, switched_at: '2999-01-01T00:00:00.000Z' });
    const a = await drawer(STAFF.cashier, 'Kiosk A');
    const t = table7();
    const r = await addPayment(a.who, { bill_ref: { seating_id: t.seating_id }, split_no: 1, mode_id: 'voucher', direction: 'in', amount_minor: 1_000 });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
  });

  it('[05 #74b add half] adapter none takes a mode with no code', async () => {
    await start({ fiscalize: FISCALIZE });
    const a = await drawer(STAFF.cashier, 'Kiosk A');
    const t = table7();
    const r = await addPayment(a.who, { bill_ref: { seating_id: t.seating_id }, split_no: 1, mode_id: 'voucher', direction: 'in', amount_minor: 1_000 });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
  });
});

describe('[05 B30, H1-20, H-4, H16-7] AddPayment — the reference stays in payment_references', () => {
  it('[05 #43 reference half] the reference text is only in payment_references and the full bill view; a resend with only the reference changed replays the stored reply', async () => {
    await start();
    const a = await drawer(STAFF.cashier, 'Kiosk A');
    const t = table7();
    const ref1 = secret('WREF-SECRET-4471');
    const payload = { bill_ref: { seating_id: t.seating_id }, split_no: 1, mode_id: 'wallet', direction: 'in', amount_minor: 20_000, reference: ref1 };
    const r = await addPayment(a.who, payload, 'cmd-ref-1');
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(added(r)).toMatchObject({ has_reference: true });
    expect(JSON.stringify(r)).not.toContain(ref1);
    expect(db().prepare('SELECT reference FROM payment_references WHERE payment_id = ?').pluck().get(r.result!['payment_id'])).toBe(ref1);

    // H16-7: payload_hash without the reference → the same command_id with another reference is a retransmit
    const other = secret('WREF-OTHER-9999');
    const again = await addPayment(a.who, { ...payload, reference: other }, 'cmd-ref-1');
    expect(again.status, JSON.stringify(again.error)).toBe(200);
    expect(again.result).toEqual(r.result);
    expect(db().prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'PaymentAdded'`).pluck().get()).toBe(1);

    // a reference over 60 characters: VALIDATION_FAILED without the value
    const long = secret(`LONG-${'x'.repeat(60)}`);
    const bad = await addPayment(a.who, { ...payload, reference: long });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.error)).not.toContain(long);

    // the full view (take-payment, branch) shows it; a take-order-only view does not (task 10's rule)
    const v = await view(a.who, { seating_id: t.seating_id });
    expect(v.splits[0]!.payments[0]).toMatchObject({ has_reference: true, reference: ref1 });

    expect(leaksOf(ref1)).toEqual([]);
    expect(leaksOf(other)).toEqual([]);
    expect(leaksOf(long)).toEqual([]);
    expect(leaksOf(r.result!['payment_id'] as string).length).toBeGreaterThan(0); // the scan is live
  });
});

describe('[05 §6.9] AddPayment — statements and retransmit', () => {
  it('[05 #91 add-payment] ≤ 7 statements, fixed at 1 and at 40 lines: projected bill 5, open bill 6, with a reference 7', async () => {
    await start();
    const a = await drawer(STAFF.cashier, 'Kiosk A');
    const counts: number[][] = [];
    for (const n of [1, 40]) {
      const s = seated(Array.from({ length: n }, (_, i) => ({ order_item_id: `S${n}_${i}`, item_id: FX.naan })), { table_id: n === 1 ? VX.tables.T6 : VX.tables.T7 });
      const ref = { seating_id: s.seating_id };
      const row: number[] = [];
      for (const extra of [{ mode_id: 'cash' }, { mode_id: 'cash' }, { mode_id: 'wallet', reference: secret('REF-STMT-0001') }]) {
        const r = await addPayment(a.who, { bill_ref: ref, split_no: 1, direction: 'in', amount_minor: 100, ...extra });
        expect(r.status, JSON.stringify(r.error)).toBe(200);
        row.push(handled['add-payment']!);
      }
      counts.push(row);
    }
    expect(counts).toEqual([
      [5, 6, 7],
      [5, 6, 7],
    ]);
  });

  it('[05 §6, D32] a retransmit with the same command_id returns the stored reply and writes nothing more', async () => {
    await start();
    const a = await drawer(STAFF.cashier, 'Kiosk A');
    const t = table7();
    const payload = { bill_ref: { seating_id: t.seating_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 5_000, tendered_minor: 10_000 };
    const r1 = await addPayment(a.who, payload, 'cmd-same');
    const r2 = await addPayment(a.who, payload, 'cmd-same');
    expect(r2.status).toBe(200);
    expect(r2.result).toEqual(r1.result);
    expect(db().prepare('SELECT COUNT(*) FROM bill_payments').pluck().get()).toBe(1);
    expect(shiftRow(a.shift_id)).toBe(5_000);
  });
});

// ================================================================================================= RemovePayment

describe('[05 §6.10, R-44] RemovePayment', () => {
  it('[05 #25, #47b command half] own removal: PaymentRemoved copies the payment; another’s needs close-shift-for-others (not_own_payment)', async () => {
    await start();
    const a = await drawer(STAFF.cashier, 'Kiosk A');
    const t = table7();
    const ref = { seating_id: t.seating_id };
    const p1 = await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 40_000, tendered_minor: 50_000 });
    const m = takeover(a.who, STAFF.manager);
    const p2 = await addPayment(m, { bill_ref: ref, split_no: 1, mode_id: 'wallet', direction: 'in', amount_minor: 30_000, reference: secret('WREF-RM-0001') });
    expect(takings(a.shift_id)).toHaveLength(2);

    // the cashier (no close-shift-for-others) cannot remove the Manager's payment
    const c = takeover(m, STAFF.cashier);
    const notOwn = await removePayment(c, { payment_id: p2.result!['payment_id'], reason_code: 'wrong_mode' });
    expect(notOwn.status).toBe(403);
    expect(notOwn.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'not_own_payment' } });

    // own: the cash payment
    const r1 = await removePayment(c, { payment_id: p1.result!['payment_id'], reason_code: 'wrong_amount' });
    expect(r1.status, JSON.stringify(r1.error)).toBe(200);
    expect(handled['remove-payment']).toBe(1);
    const a1 = added(p1);
    expect(r1.events.map((e) => e.event_type)).toEqual(['PaymentRemoved']);
    expect(r1.events[0]!.payload).toEqual({
      payment_id: a1['payment_id'],
      bill_id: a1['bill_id'],
      split_no: 1,
      reason_code: 'wrong_amount',
      has_note: false,
      shift_id: a1['shift_id'],
      mode_id: a1['mode_id'],
      payment_class: a1['payment_class'],
      direction: a1['direction'],
      amount_minor: a1['amount_minor'],
      change_minor: a1['change_minor'],
      taken_by_staff_id: a1['taken_by_staff_id'],
    });
    expect(r1.result).toEqual({ payment_id: a1['payment_id'], bill_id: a1['bill_id'], split_no: 1 });
    // only the cashier's takings row moved; expected cash back to 0
    expect(takings(a.shift_id)).toEqual([
      { mode_id: 'cash', taken_by_staff_id: STAFF.cashier, in_minor: 0, out_minor: 0, change_minor: 0 },
      { mode_id: 'wallet', taken_by_staff_id: STAFF.manager, in_minor: 30_000, out_minor: 0, change_minor: 0 },
    ]);
    expect(shiftRow(a.shift_id)).toBe(0);

    // the Manager (holds close-shift-for-others) removes the wallet payment, with a note
    const m2 = takeover(c, STAFF.manager);
    const r2 = await removePayment(m2, { payment_id: p2.result!['payment_id'], reason_code: 'other', note: secret('NOTE-SECRET-77') }, 'cmd-rm-2');
    expect(r2.status, JSON.stringify(r2.error)).toBe(200);
    expect(handled['remove-payment']).toBe(2);
    expect(r2.events[0]!.payload).toMatchObject({ has_note: true, payment_class: 'digital', change_minor: 0, taken_by_staff_id: STAFF.manager });
    expect(Object.keys(r2.events[0]!.payload)).not.toContain('reference');
    expect(db().prepare(`SELECT text FROM bill_texts WHERE subject_id = ? AND field = 'note'`).pluck().get(p2.result!['payment_id'])).toBe('NOTE-SECRET-77');
    // H16-7: the same command_id with only the note changed is a retransmit
    const again = await removePayment(m2, { payment_id: p2.result!['payment_id'], reason_code: 'other', note: secret('NOTE-OTHER-88') }, 'cmd-rm-2');
    expect(again.status, JSON.stringify(again.error)).toBe(200);
    expect(again.result).toEqual(r2.result);
    expect(JSON.stringify(db().prepare('SELECT * FROM events').all())).not.toContain('NOTE-SECRET-77');
    expect(leaksOf('NOTE-SECRET-77')).toEqual([]);
    expect(leaksOf('NOTE-OTHER-88')).toEqual([]);
    expect(leaksOf('WREF-RM-0001')).toEqual([]);

    // already removed / unknown → PAYMENT_NOT_FOUND
    for (const payment_id of [p2.result!['payment_id'], 'NOPE']) {
      const r = await removePayment(m2, { payment_id, reason_code: 'wrong_mode' });
      expect(r.status).toBe(404);
      expect(r.error).toEqual({ code: 'PAYMENT_NOT_FOUND', details: { payment_id } });
    }
    // 'other' without a note
    const noNote = await removePayment(m2, { payment_id: 'X', reason_code: 'other' });
    expect(noNote.status).toBe(400);

    const v = await view(m2, ref);
    expect(v.splits[0]).toMatchObject({ payments: [], balance_minor: 146_200 });
  });

  it('[05 #47b command half] two takers on one drawer: removing one taker’s payment moves only that row; a rebuild of shifts alone equals live', async () => {
    await start();
    const a = await drawer(STAFF.cashier, 'Kiosk A', 1_000);
    const t = fourKarahi();
    const ref = { seating_id: t.seating_id };
    await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 1_000, tendered_minor: 1_500 });
    const m = takeover(a.who, STAFF.manager);
    const mp = await addPayment(m, { bill_ref: ref, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 2_000, tendered_minor: 5_000 });
    await addPayment(m, { bill_ref: ref, split_no: 1, mode_id: 'card', direction: 'in', amount_minor: 3_000 });
    const before = takings(a.shift_id);
    const r = await removePayment(m, { payment_id: mp.result!['payment_id'], reason_code: 'customer_changed' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const after = takings(a.shift_id) as Array<Record<string, unknown>>;
    expect(after.filter((x) => !(x['mode_id'] === 'cash' && x['taken_by_staff_id'] === STAFF.manager))).toEqual(
      (before as Array<Record<string, unknown>>).filter((x) => !(x['mode_id'] === 'cash' && x['taken_by_staff_id'] === STAFF.manager)),
    );
    expect(after.find((x) => x['mode_id'] === 'cash' && x['taken_by_staff_id'] === STAFF.manager)).toMatchObject({ in_minor: 0, change_minor: 0 });
    expect(shiftRow(a.shift_id)).toBe(2_000);

    const live = { shifts: db().prepare('SELECT * FROM shifts ORDER BY shift_id').all(), takings: db().prepare('SELECT * FROM shift_takings ORDER BY shift_id, mode_id, taken_by_staff_id').all() };
    db().prepare(`DELETE FROM projection_checkpoints WHERE projection = 'shifts'`).run();
    const registry = createProjectionRegistry();
    registry.register(shiftsProjection());
    registry.catchUp(db(), hub.deps.config.provisioned!.branch_id);
    expect({ shifts: db().prepare('SELECT * FROM shifts ORDER BY shift_id').all(), takings: db().prepare('SELECT * FROM shift_takings ORDER BY shift_id, mode_id, taken_by_staff_id').all() }).toEqual(live);
  });

  it('[05 §6.10] a payment of a closed split is not removed (BILL_NOT_OPEN)', async () => {
    await start();
    const a = await drawer(STAFF.cashier, 'Kiosk A');
    const t = table7();
    const p = await addPayment(a.who, { bill_ref: { seating_id: t.seating_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 146_200 });
    const bill_id = billIdOf(t.seating_id);
    closeInTest(bill_id, [{ order_item_id: 'K1', base_minor: 120_000 }], [p.result!['payment_id'] as string]);
    const r = await removePayment(a.who, { payment_id: p.result!['payment_id'], reason_code: 'wrong_mode' });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'BILL_NOT_OPEN', details: { bill_id, state: 'closed' } });
  });

  it('[05 #25b] a day-1 bill reopened on day 2: RemovePayment of the day-1 payment → payment_shift_closed; the lower total is paid out on today’s shift; shift A unchanged', async () => {
    await start();
    const device = drawerDevice(hub, 'Kiosk A');
    const c1 = signInOn(hub, STAFF.cashier, device);
    const shiftA = await openShift(c1, { float_minor: 10_000 });
    // a takeaway of two naans: 60.00 + 16 % = 69.60 → 70.00
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'TA_N1', item_id: FX.naan }, { order_item_id: 'TA_N2', item_id: FX.naan }] });
    const p1 = await addPayment(c1, { bill_ref: { order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 7_000 });
    expect(p1.status, JSON.stringify(p1.error)).toBe(200);
    const bill_id = p1.result!['bill_id'] as string;
    closeInTest(bill_id, [{ order_item_id: 'TA_N1', base_minor: 3_000 }, { order_item_id: 'TA_N2', base_minor: 3_000 }], [p1.result!['payment_id'] as string]);
    // shift A counted and closed; day 1 closed; day 2 opened at the next local noon
    const count = { ...(aShiftCounted().payload as Record<string, unknown>), shift_id: shiftA, counted_minor: 17_000, expected_minor: 17_000, variance_minor: 0, by_staff_id: STAFF.cashier, variance_alert_id: null };
    const closed = { ...(aShiftClosed().payload as Record<string, unknown>), shift_id: shiftA, closed_by: STAFF.cashier };
    appendEvents([
      { def: asDef(ShiftCounted), stream_type: 'shift', stream_id: shiftA, payload: count },
      { def: asDef(ShiftClosed), stream_type: 'shift', stream_id: shiftA, payload: closed },
    ]);
    const day1 = db().prepare('SELECT business_date FROM billing_day').pluck().get() as string;
    hub.deps.writer.run((tx) => tx.append([{ stream_type: 'hub', stream_id: tx.branchId, event_type: 'BusinessDayClosed', schema_version: 1, payload: {}, occurred_at: hub.clock.branchNow(), actor_id: STAFF.manager, device_id: 'D_FIXTURE' }]));
    const noon = new Date(`${day1}T12:00:00`);
    noon.setDate(noon.getDate() + 1);
    hub.clock.set(noon.getTime());
    openDay(hub, { menu: menu(doc), stock: STOCK });
    const c2 = takeover(c1, STAFF.cashier);
    const shiftB = await openShift(c2, { float_minor: 5_000 });

    // reopened (full) and one naan removed: 30.00 + 16 % = 34.80 → 35.00; paid 70.00 → balance −35.00
    appendEvents([{ def: asDef(BillReopened), stream_type: 'bill', stream_id: bill_id, payload: { ...(aBillReopened().payload as Record<string, unknown>), bill_id, order_ids: [order_id], mode: 'full' } }]);
    appendEvents([{ def: asDef(ItemRemoved), stream_type: 'order', stream_id: order_id, payload: { order_item_id: 'TA_N2' } }]);
    const v0 = await view(c2, { bill_id });
    expect(v0.splits[0]!.balance_minor).toBe(-3_500);

    const rm = await removePayment(c2, { payment_id: p1.result!['payment_id'], reason_code: 'wrong_amount' });
    expect(rm.status).toBe(409);
    expect(rm.error).toEqual({ code: 'SHIFT_NOT_OPEN', details: { reason: 'payment_shift_closed' } });

    // "jitna liya utna wapas": the card paid nothing; cash up to what it paid back
    const cardOut = await addPayment(c2, { bill_ref: { bill_id }, split_no: 1, mode_id: 'card', direction: 'out', amount_minor: 100 });
    expect(cardOut.error).toEqual({ code: 'PAYMENT_EXCEEDS_BALANCE', details: { balance_minor: 0 } });
    const tooMuch = await addPayment(c2, { bill_ref: { bill_id }, split_no: 1, mode_id: 'cash', direction: 'out', amount_minor: 3_501 });
    expect(tooMuch.error).toEqual({ code: 'PAYMENT_EXCEEDS_BALANCE', details: { balance_minor: 3_500 } });
    const out = await addPayment(c2, { bill_ref: { bill_id }, split_no: 1, mode_id: 'cash', direction: 'out', amount_minor: 3_500 });
    expect(out.status, JSON.stringify(out.error)).toBe(200);
    expect(added(out)).toMatchObject({ direction: 'out', shift_id: shiftB, tendered_minor: null, change_minor: null });
    expect(dues(out)).toMatchObject({ balance_minor: 0, cash_refund_due_minor: 0, card_refund_due_minor: 0 });

    expect(shiftRow(shiftA)).toBe(17_000);
    expect(shiftRow(shiftB)).toBe(1_500);
    expect(db().prepare('SELECT counted_minor FROM shifts WHERE shift_id = ?').pluck().get(shiftA)).toBe(17_000);
    expect((await view(c2, { bill_id })).splits[0]!.balance_minor).toBe(0);
  });
});

// ================================================================================================= grant, cash out, races, rows

describe('[05 §6.9, §6.10, C8] the grant first: 403 before any read', () => {
  it('[05 §6.9, §6.10] a caller without take-payment is refused before the handler reads anything (no 404 / 409 for an unknown bill, shift or payment)', async () => {
    await start({ deny: ['take-payment'] });
    const taker = signIn(hub, STAFF.orderTaker);
    const denied = { code: 'PERMISSION_DENIED', details: { permission: 'take-payment', grant: 'denied' } };
    const add = await addPayment(taker, { bill_ref: { bill_id: 'NO_SUCH_BILL' }, split_no: 1, mode_id: 'nope', direction: 'in', amount_minor: 1_000, reference: secret('REF-DENIED-0001') });
    expect(add.status).toBe(403);
    expect(add.error).toEqual(denied);
    const rm = await removePayment(taker, { payment_id: 'NO_SUCH_PAYMENT', reason_code: 'wrong_mode' });
    expect(rm.status).toBe(403);
    expect(rm.error).toEqual(denied);
    // the handlers never ran (countHandle records a count only when `handle` is entered)
    expect(handled['add-payment']).toBeUndefined();
    expect(handled['remove-payment']).toBeUndefined();
  });
});

describe('[05 §3.7, §3.5 (7), H10-2] an out on a negative open balance under cash-only rounding; shifts after add and remove', () => {
  it('[05 §3.5 (7), §3.7] a cash out is a step multiple ≤ the cash refund due; expected cash and takings move on add and back on each remove', async () => {
    await start({ card_bp: 1_600, step: 500, applies_to: 'cash' });
    const a = await drawer(STAFF.cashier, 'Kiosk A', 10_000);
    // Karahi 1,200 + naan 30 + naan 30 = 1,260.00 + 16 % = 1,461.60 → cash 1,460.00 (step Rs 5, nearest)
    const { seating_id, order_id } = seated([
      { order_item_id: 'CO_K', item_id: FX.piece },
      { order_item_id: 'CO_N1', item_id: FX.naan },
      { order_item_id: 'CO_N2', item_id: FX.naan },
    ]);
    const ref = { seating_id };
    const pin = await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 146_000, tendered_minor: 150_000 });
    expect(pin.status, JSON.stringify(pin.error)).toBe(200);
    expect(dues(pin)).toEqual({ balance_minor: 0, card_due_minor: 0, cash_due_minor: 0, card_refund_due_minor: 0, cash_refund_due_minor: 0, rounding_minor: -160, change_due_minor: 4_000 });
    expect(shiftRow(a.shift_id)).toBe(156_000);
    expect(takings(a.shift_id)).toEqual([{ mode_id: 'cash', taken_by_staff_id: STAFF.cashier, in_minor: 146_000, out_minor: 0, change_minor: 4_000 }]);

    // one naan comes off the open bill: 1,230.00 + 16 % = 1,426.80 → 1,425.00; paid 1,460.00 → balance −35.00
    appendEvents([{ def: asDef(ItemRemoved), stream_type: 'order', stream_id: order_id, payload: { order_item_id: 'CO_N2' } }]);
    const bill_id = billIdOf(seating_id);
    const v0 = await view(a.who, { bill_id });
    expect(v0.splits[0]).toMatchObject({ balance_minor: -3_500, totals: { as_paid: { total_minor: 142_500 } } });

    // off the step → PAYMENT_CASH_STEP; above the cash refund due → its due; the card paid nothing → 0
    const off = await addPayment(a.who, { bill_ref: { bill_id }, split_no: 1, mode_id: 'cash', direction: 'out', amount_minor: 3_400 });
    expect(off.status).toBe(422);
    expect(off.error).toEqual({ code: 'PAYMENT_CASH_STEP', details: { step_minor: 500 } });
    const over = await addPayment(a.who, { bill_ref: { bill_id }, split_no: 1, mode_id: 'cash', direction: 'out', amount_minor: 4_000 });
    expect(over.error).toEqual({ code: 'PAYMENT_EXCEEDS_BALANCE', details: { balance_minor: 3_500 } });
    const card = await addPayment(a.who, { bill_ref: { bill_id }, split_no: 1, mode_id: 'card', direction: 'out', amount_minor: 500 });
    expect(card.error).toEqual({ code: 'PAYMENT_EXCEEDS_BALANCE', details: { balance_minor: 0 } });
    // H17-1: no in while the balance is negative
    const inNeg = await addPayment(a.who, { bill_ref: { bill_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 500 });
    expect(inNeg.error).toEqual({ code: 'PAYMENT_EXCEEDS_BALANCE', details: { balance_minor: 0 } });

    const pout = await addPayment(a.who, { bill_ref: { bill_id }, split_no: 1, mode_id: 'cash', direction: 'out', amount_minor: 3_500 });
    expect(pout.status, JSON.stringify(pout.error)).toBe(200);
    expect(added(pout)).toMatchObject({ direction: 'out', amount_minor: 3_500, tendered_minor: null, change_minor: null, shift_id: a.shift_id });
    expect(dues(pout)).toEqual({ balance_minor: 0, card_due_minor: 0, cash_due_minor: 0, card_refund_due_minor: 0, cash_refund_due_minor: 0, rounding_minor: -180, change_due_minor: 0 });
    // §3.7: float 100.00 + in 1,460.00 − out 35.00
    expect(shiftRow(a.shift_id)).toBe(152_500);
    expect(takings(a.shift_id)).toEqual([{ mode_id: 'cash', taken_by_staff_id: STAFF.cashier, in_minor: 146_000, out_minor: 3_500, change_minor: 4_000 }]);

    // remove the out: back to the in alone; then the in: back to the float
    const r1 = await removePayment(a.who, { payment_id: pout.result!['payment_id'], reason_code: 'wrong_amount' });
    expect(r1.status, JSON.stringify(r1.error)).toBe(200);
    expect(r1.events[0]!.payload).toMatchObject({ direction: 'out', amount_minor: 3_500, change_minor: 0, payment_class: 'cash' });
    expect(shiftRow(a.shift_id)).toBe(156_000);
    expect(takings(a.shift_id)).toEqual([{ mode_id: 'cash', taken_by_staff_id: STAFF.cashier, in_minor: 146_000, out_minor: 0, change_minor: 4_000 }]);
    const r2 = await removePayment(a.who, { payment_id: pin.result!['payment_id'], reason_code: 'wrong_amount' });
    expect(r2.status, JSON.stringify(r2.error)).toBe(200);
    expect(r2.events[0]!.payload).toMatchObject({ direction: 'in', amount_minor: 146_000, change_minor: 4_000 });
    expect(shiftRow(a.shift_id)).toBe(10_000);
    expect(takings(a.shift_id)).toEqual([{ mode_id: 'cash', taken_by_staff_id: STAFF.cashier, in_minor: 0, out_minor: 0, change_minor: 0 }]);
    expect((await view(a.who, { bill_id })).splits[0]).toMatchObject({ balance_minor: 142_500, payments: [] });
  });
});

describe('[05 §6.9, §6.10] races: two tills on one split', () => {
  it('[05 §6.9] two full cash payments sent at once on a bill not yet opened: one bill, one payment; the other is refused — ⚠️ 05 v1.0.37 (R2-1): the due it saw is gone, BILL_DUE_CHANGED with due 0', async () => {
    await start();
    const a = await drawer(STAFF.cashier, 'Kiosk A');
    const b = await drawer(STAFF.manager, 'Kiosk B');
    const t = fourKarahi();
    const pay = (who: Who) => addPayment(who, { bill_ref: { seating_id: t.seating_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 556_800, expected_due_minor: 556_800 });
    const rs = await Promise.all([pay(a.who), pay(b.who)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(rs.find((r) => r.status === 409)!.error).toEqual({ code: 'BILL_DUE_CHANGED', details: { split_no: 1, expected_minor: 556_800, due_minor: 0 } });
    expect(db().prepare('SELECT COUNT(*) FROM bills WHERE seating_id = ?').pluck().get(t.seating_id)).toBe(1);
    expect(db().prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'BillOpened'`).pluck().get()).toBe(1);
    expect(db().prepare('SELECT COUNT(*) FROM bill_payments').pluck().get()).toBe(1);
    expect(shiftRow(a.shift_id) + shiftRow(b.shift_id)).toBe(556_800);
  });

  it('[05 §6.10] the same payment removed from two tills at once: one PaymentRemoved; the other is PAYMENT_NOT_FOUND; the shift reverses once', async () => {
    await start();
    const a = await drawer(STAFF.manager, 'Kiosk A');
    const b = await drawer('S_OWNER', 'Kiosk B');
    const t = fourKarahi();
    const p = await addPayment(a.who, { bill_ref: { seating_id: t.seating_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 200_000, tendered_minor: 250_000 });
    const payment_id = p.result!['payment_id'] as string;
    const rs = await Promise.all([removePayment(a.who, { payment_id, reason_code: 'wrong_mode' }), removePayment(b.who, { payment_id, reason_code: 'customer_changed' })]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 404]);
    expect(rs.find((r) => r.status === 404)!.error).toEqual({ code: 'PAYMENT_NOT_FOUND', details: { payment_id } });
    expect(db().prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'PaymentRemoved'`).pluck().get()).toBe(1);
    expect(shiftRow(a.shift_id)).toBe(0);
    expect(takings(a.shift_id)).toEqual([{ mode_id: 'cash', taken_by_staff_id: STAFF.manager, in_minor: 0, out_minor: 0, change_minor: 0 }]);
  });
});

describe('[05 §6.9, §6.10, #91] statements stay fixed as payments grow', () => {
  it('[05 #91 payments] AddPayment 6 and RemovePayment 1 with 1 and with 40 payments on the bill', async () => {
    await start();
    const a = await drawer(STAFF.cashier, 'Kiosk A');
    const counts: Array<{ add: number; remove: number }> = [];
    for (const n of [1, 40]) {
      const s = seated([{ order_item_id: `SG${n}`, item_id: FX.piece, quantity: 4 }], { table_id: n === 1 ? VX.tables.T6 : VX.tables.T7 });
      const ref = { seating_id: s.seating_id };
      let last = '';
      for (let i = 0; i < n; i += 1) {
        const r = await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id: i % 2 === 0 ? 'cash' : 'card', direction: 'in', amount_minor: 100 });
        expect(r.status, JSON.stringify(r.error)).toBe(200);
        last = r.result!['payment_id'] as string;
      }
      const next = await addPayment(a.who, { bill_ref: ref, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 100 });
      expect(next.status, JSON.stringify(next.error)).toBe(200);
      const add = handled['add-payment']!;
      const rm = await removePayment(a.who, { payment_id: last, reason_code: 'wrong_mode' });
      expect(rm.status, JSON.stringify(rm.error)).toBe(200);
      counts.push({ add, remove: handled['remove-payment']! });
    }
    expect(counts).toEqual([
      { add: 6, remove: 1 },
      { add: 6, remove: 1 },
    ]);
  });
});

// ================================================================================================= property

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

describe('[05 #23] property: payments, change and shifts', () => {
  it.each([11, 23, 2026])('[05 #23] seed %i: Σ in − Σ out = the split total at balance 0; change = Σ (tendered − amount) ≤ Σ tendered; Σ shifts’ expected moves = Σ cash in − out', async (seed) => {
    await start();
    const rnd = prng(seed);
    const kioskA = await drawer(STAFF.cashier, 'Kiosk A');
    const kioskB = await drawer(STAFF.manager, 'Kiosk B');
    const t = fourKarahi();
    const ref = { seating_id: t.seating_id };
    let cashDue = 556_800;
    let cardDue = 504_000;
    const payments: Array<{ id: string; who: Who }> = [];
    try {
      for (let step = 0; step < 14; step += 1) {
        const remove = payments.length > 0 && rnd() < 0.25;
        if (remove) {
          const i = Math.floor(rnd() * payments.length);
          const [p] = payments.splice(i, 1);
          const r = await removePayment(kioskB.who, { payment_id: p!.id, reason_code: 'wrong_amount' });
          expect(r.status, JSON.stringify(r.error)).toBe(200);
        } else {
          const cash = rnd() < 0.6;
          const due = cash ? cashDue : cardDue;
          if (due <= 0) break;
          const amount = Math.max(1, Math.min(due, 1 + Math.floor(rnd() * 200_000)));
          const who = rnd() < 0.5 ? kioskA.who : kioskB.who;
          const tendered = cash && rnd() < 0.5 ? amount + Math.floor(rnd() * 10_000) : undefined;
          const r = await addPayment(who, { bill_ref: ref, split_no: 1, mode_id: cash ? 'cash' : 'card', direction: 'in', amount_minor: amount, ...(tendered === undefined ? {} : { tendered_minor: tendered }) });
          expect(r.status, JSON.stringify(r.error)).toBe(200);
          payments.push({ id: r.result!['payment_id'] as string, who });
        }
        // invariants after every step, from the tables the folds wrote
        const live = db().prepare('SELECT payment_class, direction, amount_minor, tendered_minor FROM bill_payments WHERE removed_at IS NULL').all() as Array<{ payment_class: string; direction: string; amount_minor: number; tendered_minor: number | null }>;
        const cashNet = live.filter((p) => p.payment_class === 'cash').reduce((s, p) => s + (p.direction === 'in' ? p.amount_minor : -p.amount_minor), 0);
        const change = live.filter((p) => p.tendered_minor !== null).reduce((s, p) => s + (p.tendered_minor! - p.amount_minor), 0);
        const tendered = live.filter((p) => p.tendered_minor !== null).reduce((s, p) => s + p.tendered_minor!, 0);
        expect(shiftRow(kioskA.shift_id) + shiftRow(kioskB.shift_id)).toBe(cashNet);
        expect(db().prepare('SELECT COALESCE(SUM(change_minor), 0) FROM shift_takings').pluck().get()).toBe(change);
        expect(change).toBeLessThanOrEqual(tendered);
        const v = await view(kioskA.who, ref);
        const s = v.splits[0]!;
        const paid = live.reduce((x, p) => x + (p.direction === 'in' ? p.amount_minor : -p.amount_minor), 0);
        expect(s.balance_minor).toBe(s.totals.as_paid.total_minor - paid);
        if (s.balance_minor === 0) expect(paid).toBe(s.totals.as_paid.total_minor);
        // the dues for the next step: from the bill view's two class totals (B ≤ 0 → nothing due, H17-1)
        const hasCash = live.some((p) => p.payment_class === 'cash' && p.direction === 'in');
        cashDue = s.balance_minor <= 0 ? 0 : Math.max(0, s.totals.cash.total_minor - paid);
        cardDue = s.balance_minor <= 0 ? 0 : Math.max(0, (hasCash ? s.totals.cash.total_minor : s.totals.digital.total_minor) - paid);
      }
    } catch (e) {
      console.error(`[05 #23] failing seed ${seed}`);
      throw e;
    }
  });
});
