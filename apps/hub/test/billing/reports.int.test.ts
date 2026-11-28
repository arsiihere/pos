// 05 §6.26 `GET /queries/x-report` and `GET /queries/z-reports`, §6.25 / §3.16 the `ZReportIssued` live-only print fold
// (task 26b; plan 05 §3 row 26b, R-83 (8), R-84). Tests #63b, #63c, #64b, #67 (extended).
// Money is in-test events built from task 5's builders, appended through the hub's real writer and folded by the real
// `billing`, `shifts`, `audit` and `billing_prints` projections. Task 25 (CloseBusinessDay's 05 appender) is built in
// parallel: `closeDay` below stands in for it — it builds the Z exactly as the appender is specified to (§6.25:
// `loadReportInput` kind 'z' → `buildReport`, Z number MAX + 1) and appends `ZReportIssued` + `BusinessDayClosed` as raw
// events. Once task 25 merges, these tests can close the day with the real command.
// Every amount is literal PKR minor units (exponent 2: Rs 500 = 50_000).
import { buildReport, type ReportDocInput } from '@pos/domain';
import type { EventDraft, PosEvent } from '@pos/events';
import { aBillClosedEmpty, aBillOpened, aBillReopened, aBillSplitsSet, aDiscountApplied, anInvoiceCredited, anInvoiceIssued, aPaymentAdded, aShiftClosed, aShiftCounted, aShiftCountSkipped, aShiftOpened, aZReportIssued } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { billingProjection } from '../../src/billing/projections/billing';
import { billPrintsProjection } from '../../src/billing/print/folds';
import { loadReportInput, reportStaffIds } from '../../src/billing/queries/reports';
import { createProjectionRegistry, type Projection } from '../../src/projections/registry';
import { queryRegistry, type QueryDef } from '../../src/queries/registry';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import type { TestHub } from '../helpers/test-hub';
import { voidLine } from '../kds/fixtures';
import { append as appendRaw, openVoidsDay } from '../voids/fixtures';
import { addedTakeaway, appendOrder, BX, dineInTwoRounds, FX, signIn, STAFF, startBilling, takeawayOrder, type Who } from './fixtures';
import { tableLabel } from '../../src/kds/details';
import { hubBilling } from '../../src/billing/defaults';

let hub: TestHub;
let counter: ReturnType<typeof statementCounter> | undefined;
const handled: Record<string, number | undefined> = {};

const NAMES = ['Owner', 'Manager', 'Cashier', 'Order taker'];
const DAY_MS = 86_400_000;

// ------------------------------------------------------------------------------------------------ privacy scan

/** H16-5: no staff name in a ZReportIssued payload or a z_reports row; R-84 (2): the warning log line has ids only. */
function leaks(): string[] {
  const found: string[] = [];
  const zEvents = JSON.stringify(hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'ZReportIssued'`).pluck().all());
  const zRows = JSON.stringify(hub.deps.db.prepare('SELECT * FROM z_reports').all());
  for (const name of NAMES) {
    if (zEvents.includes(`"${name}"`)) found.push(`name ${name} in a ZReportIssued payload`);
    if (zRows.includes(`"${name}"`)) found.push(`name ${name} in z_reports`);
  }
  for (const line of hub.logs().split('\n').filter((l) => l.includes('billing.report_warning') || l.includes('billing.print_skipped'))) {
    for (const name of NAMES) if (line.includes(`"${name}"`)) found.push(`name ${name} in a log line`);
    if (/"amount_minor"|"total_minor"/.test(line)) found.push('an amount in a log line');
  }
  return found;
}

afterEach(async () => {
  const found = hub === undefined ? [] : leaks();
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
  counter = undefined;
  for (const k of Object.keys(handled)) delete handled[k];
  expect(found).toEqual([]);
});

// ------------------------------------------------------------------------------------------------ set-up

async function start(): Promise<void> {
  hub = await startBilling();
  counter = statementCounter(hub.deps.readDb); // queries read on the read connection
  for (const resource of ['x-report', 'z-reports']) {
    const def = queryRegistry(hub.app).byResource(resource) as QueryDef | undefined;
    if (def === undefined) continue; // not registered: every call answers 404 (the failing-first state)
    const original = def.handle;
    def.handle = (ctx, q) => {
      counter!.reset();
      try {
        return original.call(def, ctx, q);
      } finally {
        handled[resource] = counter!.count;
      }
    };
  }
}

const branch = () => hub.deps.config.provisioned!.branch_id;
const today = () => hub.deps.state.get().business_day!;

type Draft = Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id' | 'schema_version'>;
const on = (e: PosEvent, stream_id: string, payload: Record<string, unknown>): Draft => ({
  stream_type: e.stream_type,
  stream_id,
  event_type: e.event_type,
  payload: { ...e.payload, ...payload },
});
const put = (drafts: Draft[], actor: string = STAFF.cashier): PosEvent[] => appendRaw(hub, drafts, { actor });

function openShift(shift_id: string, staff_id: string, o: { drawer?: string | null; float_minor?: number } = {}): void {
  put([on(aShiftOpened(), shift_id, { shift_id, staff_id, drawer_device_id: o.drawer ?? null, float_minor: o.float_minor ?? 500_000, business_date: today().business_date })], staff_id);
}

/** CloseShift { skip_count } (§6.18): ShiftCountSkipped + ShiftClosed. */
function skipShift(shift_id: string): void {
  put([on(aShiftCountSkipped(), shift_id, { shift_id }), on(aShiftClosed(), shift_id, { shift_id, closed_by: STAFF.manager })], STAFF.manager);
}

/** A bill on its own seating; with `splits`, an amount plan of that many splits. */
function openBill(bill_id: string, splits?: number[]): void {
  const drafts = [on(aBillOpened(), bill_id, { bill_id, seating_id: `SEAT_${bill_id}` })];
  if (splits !== undefined) {
    drafts.push(on(aBillSplitsSet(), bill_id, { bill_id, mode: 'amount', splits: splits.map((share_minor, i) => ({ split_no: i + 1, lines: null, share_minor })) }));
  }
  put(drafts);
}

function pay(o: { payment_id: string; bill_id: string; split_no?: number; amount_minor: number; shift_id: string; taker: string; mode?: 'cash' | 'card'; direction?: 'in' | 'out' }): void {
  const mode = o.mode ?? 'cash';
  put(
    [
      on(aPaymentAdded(), o.bill_id, {
        payment_id: o.payment_id,
        bill_id: o.bill_id,
        split_no: o.split_no ?? 1,
        mode_id: mode,
        payment_class: mode === 'cash' ? 'cash' : 'digital',
        direction: o.direction ?? 'in',
        amount_minor: o.amount_minor,
        tendered_minor: null,
        change_minor: null,
        taken_by_staff_id: o.taker,
        shift_id: o.shift_id,
      }),
    ],
    o.taker,
  );
}

let invoiceNo = 0;
let creditNo = 0;

/** The amount fields of a plain invoice of `total` (no tax, no charge, no rounding: the builder sums what it is given). */
function amounts(total: number, discount = 0) {
  return {
    lines: [{ ...(anInvoiceIssued().payload['lines'] as Array<Record<string, unknown>>)[0], base_minor: total + discount, unit_price_minor: total + discount, taxes: [] }],
    service_charge: null,
    subtotal_minor: total + discount,
    discount_minor: discount,
    service_charge_minor: 0,
    taxes: [],
    rounding_minor: 0,
    total_minor: total,
  };
}

/** A sale invoice closing `split_no` (its payments listed); returns its id. */
function close(o: { bill_id: string; split_no?: number; total_minor: number; payment_ids: string[]; discount_minor?: number }): string {
  invoiceNo += 1;
  const invoice_id = `INV_${o.bill_id}_${invoiceNo}`;
  put([
    on(anInvoiceIssued(), o.bill_id, {
      invoice_id,
      number: invoiceNo,
      invoice_ref: `AC1-S${String(invoiceNo).padStart(6, '0')}`,
      bill_id: o.bill_id,
      split_no: o.split_no ?? 1,
      business_date: today().business_date,
      issued_at: hub.clock.branchNow(),
      ...amounts(o.total_minor, o.discount_minor),
      payment_ids: o.payment_ids,
    }),
  ]);
  return invoice_id;
}

/** §6.13: BillReopened then one InvoiceCredited per given sale invoice, one transaction; returns the credit ids. */
function reopen(bill_id: string, originals: Array<{ invoice_id: string; total_minor: number }>, o: { credit_date?: string } = {}): string[] {
  const credits = originals.map(() => `CR_${bill_id}_${(creditNo += 1)}`);
  put(
    [
      on(aBillReopened(), bill_id, { bill_id, order_ids: [`O_${bill_id}`], requester_staff_id: STAFF.manager }),
      ...originals.map((x, i) =>
        on(anInvoiceCredited(), bill_id, {
          invoice_id: credits[i],
          number: creditNo - originals.length + i + 1,
          invoice_ref: `AC1-C${String(creditNo - originals.length + i + 1).padStart(6, '0')}`,
          bill_id,
          business_date: o.credit_date ?? today().business_date,
          issued_at: hub.clock.branchNow(),
          ...amounts(x.total_minor),
          payment_ids: [],
          ref_invoice_id: x.invoice_id,
          ref_invoice_ref: 'AC1-S000000',
          closed_by: STAFF.manager,
        }),
      ),
    ],
    STAFF.manager,
  );
  return credits;
}

function carry(order_ids: string[]): void {
  put([{ stream_type: 'hub', stream_id: branch(), event_type: 'OrdersCarriedOver', payload: { order_ids, business_date: today().business_date, reason_code: 'customer_will_pay_later', has_note: false, note_id: null } }], STAFF.manager);
}

/**
 * Task 25 stand-in (§6.25): the Z built over the open day as the appender builds it, then `ZReportIssued` and
 * `BusinessDayClosed` in one transaction (raw events; the real CloseBusinessDay appender is task 25's).
 */
function closeDay(): PosEvent {
  hub.clock.advance(1_000);
  const d = today();
  const { appended } = hub.deps.writer.run((tx) => {
    const z_no = (tx.db.prepare('SELECT COALESCE(MAX(z_no), 0) + 1 FROM z_reports').pluck().get() as number);
    const report = buildReport(loadReportInput(tx.db, branchConfig()!, { kind: 'z', z_no, business_date: d.business_date, opened_at: d.opened_at, issued_at: tx.clock.branchNow() }));
    const env = { schema_version: 1, occurred_at: tx.clock.branchNow(), actor_id: STAFF.manager, device_id: 'D_FIXTURE' };
    return tx.append([
      { ...env, stream_type: 'hub', stream_id: tx.branchId, event_type: 'ZReportIssued', payload: { business_date: d.business_date, z_no, report } },
      { ...env, stream_type: 'hub', stream_id: tx.branchId, event_type: 'BusinessDayClosed', payload: {} },
    ] as EventDraft[]);
  });
  return appended.find((e) => e.event_type === 'ZReportIssued')!;
}

/** The next calendar day, opened with the voids menu. */
function nextDay(): void {
  hub.clock.advance(DAY_MS);
  openVoidsDay(hub);
}

async function get<T>(who: Who, url: string): Promise<{ status: number; body: { data: T; meta?: { next_cursor: string | null }; error?: { code: string; details?: unknown } } }> {
  const res = await hub.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
  return { status: res.statusCode, body: res.json() };
}

type XView = { report: ReportDocInput; staff_names: Record<string, string> };
type ZView = XView & { business_date: string; z_no: number };

async function x(who: Who): Promise<ReportDocInput> {
  const r = await get<XView>(who, '/queries/x-report');
  expect(r.status).toBe(200);
  return r.body.data.report;
}

function zOf(business_date: string): ReportDocInput {
  return JSON.parse(hub.deps.db.prepare('SELECT report_json FROM z_reports WHERE business_date = ?').pluck().get(business_date) as string) as ReportDocInput;
}

/** §6.26 invariant: Σ takings (in − out, all modes) = Z net + carried forward − brought forward. */
function invariant(r: ReportDocInput): { takings: number; rhs: number } {
  const takings = r.payments_by_mode.reduce((s, p) => s + p.in_minor - p.out_minor, 0);
  const sum = (rows: ReadonlyArray<{ amount_minor: number }>) => rows.reduce((s, x) => s + x.amount_minor, 0);
  return { takings, rhs: r.net_after_credits_minor + sum(r.carried_forward) - sum(r.brought_forward) };
}

// ------------------------------------------------------------------------------------------------ X

describe('[05 §6.26] GET /queries/x-report', () => {
  it('[05 §6.26] view-reports: the Cashier (no grant) → 403 before any read; no open day → 409 BUSINESS_DAY_NOT_OPEN', async () => {
    await start();
    const cashier = signIn(hub, STAFF.cashier);
    const refused = await get(cashier, '/queries/x-report');
    expect(refused.status).toBe(403);
    expect(refused.body.error?.code).toBe('PERMISSION_DENIED');
    expect(handled['x-report']).toBe(0);
    const manager = signIn(hub, STAFF.manager);
    closeDay();
    const closed = await get(manager, '/queries/x-report');
    expect(closed.status).toBe(409);
    expect(closed.body.error?.code).toBe('BUSINESS_DAY_NOT_OPEN');
  });

  it('[05 #67 extended, R-83 (8)] X over the open day: expected hidden for the open and the skipped shift, shown once counted; the Z shows the skipped shift\'s expected; names from staff_names', async () => {
    await start();
    const manager = signIn(hub, STAFF.manager);
    openShift('SH_CASH', STAFF.cashier, { drawer: 'D_DRAWER', float_minor: 500_000 }); // Rs 5,000 float, still open
    openShift('SH_WAIT', STAFF.orderTaker, { float_minor: 100_000 }); // Rs 1,000 float, closed with the count skipped
    skipShift('SH_WAIT');
    openShift('SH_MGR', STAFF.manager, { float_minor: 200_000 }); // Rs 2,000 float, counted exactly
    put([
      on(aShiftCounted(), 'SH_MGR', { shift_id: 'SH_MGR', counted_minor: 200_000, expected_minor: 200_000, variance_minor: 0, by_staff_id: STAFF.manager, variance_alert_id: null }),
      on(aShiftClosed(), 'SH_MGR', { shift_id: 'SH_MGR', closed_by: STAFF.manager }),
    ], STAFF.manager);
    // a Rs 6,384 cash sale after a Rs 571 discount the Manager approved
    openBill('B1');
    put([on(aDiscountApplied(), 'B1', { bill_id: 'B1', amount_minor: 57_100, requester_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager, alert_id: 'AL_DISC' })]);
    pay({ payment_id: 'P1', bill_id: 'B1', amount_minor: 638_400, shift_id: 'SH_CASH', taker: STAFF.cashier });
    close({ bill_id: 'B1', total_minor: 638_400, discount_minor: 57_100, payment_ids: ['P1'] });
    // one voided naan unit (04 ItemVoided, no refund → value 0, R-83 (4))
    const tw = takeawayOrder(hub, { prefix: 'TV' });
    voidLine(hub, tw.order_id, tw.line, 1);

    const r = await x(signIn(hub, STAFF.manager));
    expect(r.kind).toBe('x');
    expect(r.z_no).toBeNull();
    expect(r.business_date).toBe(today().business_date);
    expect(r.currency_code).toBe('PKR');
    expect(r.sales).toMatchObject({ invoice_count: 1, gross_minor: 695_500, net_minor: 638_400, total_minor: 638_400 });
    expect(r.sales.discounts).toEqual({
      count: 1,
      value_minor: 57_100,
      by_reason: [{ reason_code: 'regular_customer', count: 1, value_minor: 57_100 }],
      entries: [{ requester_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager, method: 'approval', value_minor: 57_100 }],
    });
    expect(r.payments_by_mode).toEqual([{ mode_name: 'Cash', in_minor: 638_400, out_minor: 0, change_minor: 0 }]);
    expect(r.voids).toEqual([{ disposition: null, count: 1, value_minor: 0 }]);
    expect(r.fiscal).toEqual({ pending: 1, acked: 0, rejected: 0, not_required: 0 });
    expect(r.bills).toEqual({ count: 1, average_minor: 638_400 });
    expect(r.shifts).toEqual([
      { staff_id: STAFF.cashier, float_minor: 500_000, expected_minor: null, counted_minor: null, variance_minor: null, skipped: false, signoff_state: null },
      { staff_id: STAFF.manager, float_minor: 200_000, expected_minor: 200_000, counted_minor: 200_000, variance_minor: 0, skipped: false, signoff_state: null },
      { staff_id: STAFF.orderTaker, float_minor: 100_000, expected_minor: null, counted_minor: null, variance_minor: null, skipped: true, signoff_state: null },
    ]);
    const view = (await get<XView>(manager, '/queries/x-report')).body.data;
    expect(view.staff_names).toEqual({ [STAFF.cashier]: 'Cashier', [STAFF.manager]: 'Manager', [STAFF.orderTaker]: 'Order taker' });

    // the Z of the same day (the appender's build) shows the skipped shift's expected (its float, no cash taken)
    closeDay();
    const z = zOf(r.business_date);
    expect(z.shifts.find((s) => s.staff_id === STAFF.orderTaker)).toEqual({ staff_id: STAFF.orderTaker, float_minor: 100_000, expected_minor: 100_000, counted_minor: null, variance_minor: null, skipped: true, signoff_state: null });
    expect(z.shifts.find((s) => s.staff_id === STAFF.cashier)!.expected_minor).toBe(1_138_400); // Rs 5,000 + Rs 6,384
    expect(z.open_bills).toEqual([]);
  });

  it('[05 v1.0.39 §6.26 QM-2, #63i (owner 2026-11-28 QA-R3, BUG-6)] Carried over lists a bill once, not once per order: a token with two additions and a two-round seating, carried two days', async () => {
    await start();
    const { root, addition } = addedTakeaway(hub, { prefix: 'CO' });
    const more = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, adds_to_order_id: root.order_id, lines: [{ order_item_id: 'CO_ADD2', item_id: FX.naan }] }).order_id;
    const seat = dineInTwoRounds(hub, { prefix: 'CS' });
    const ids = [root.order_id, addition.order_id, more, ...seat.rounds.map((r) => r.order_id)];
    carry(ids);
    const one = await x(signIn(hub, STAFF.manager));
    expect(one.carried_over.map((c) => c.label).sort()).toEqual([`#${root.token}`, tableLabel('T4')].sort());
    closeDay();
    expect(zOf(one.business_date).carried_over).toHaveLength(2);
    nextDay();
    carry(ids);
    const two = await x(signIn(hub, STAFF.manager));
    // each bill once carried in (yesterday's) and once carried over (today's)
    expect(two.carried_over.filter((c) => c.carried_in)).toHaveLength(2);
    expect(two.carried_over.filter((c) => !c.carried_in)).toHaveLength(2);
  });

  it('[05 §6.26, #91] X = 8 statements and the Z build = 6, the same with 1 and with 40 shifts, sales, open bills and carried orders', async () => {
    await start();
    const day = (n: number) => {
      for (let i = 1; i <= n; i += 1) {
        openBill(`OB_${n}_${i}`); // an open bill row
        carry([takeawayOrder(hub, { prefix: `TK${n}x${i}` }).order_id]); // a projected key, carried over
        const s = `SH_${n}_${i}`;
        openShift(s, `S_N${i}`);
        openBill(`B_${n}_${i}`);
        pay({ payment_id: `P_${n}_${i}`, bill_id: `B_${n}_${i}`, amount_minor: 100_000, shift_id: s, taker: STAFF.cashier });
        close({ bill_id: `B_${n}_${i}`, total_minor: 100_000, payment_ids: [`P_${n}_${i}`] });
        skipShift(s);
      }
    };
    const zStatements = (): number => {
      counter!.reset();
      const d = today();
      loadReportInput(hub.deps.readDb, branchConfig()!, { kind: 'z', z_no: 1, business_date: d.business_date, opened_at: d.opened_at, issued_at: hub.clock.branchNow() });
      return counter!.count;
    };
    day(1);
    const one = await x(signIn(hub, STAFF.manager));
    expect(one.shifts).toHaveLength(1);
    expect(one.open_bills).toHaveLength(2); // 1 bill row + 1 projected key
    expect(one.carried_over).toHaveLength(1);
    expect(handled['x-report']).toBe(8);
    expect(zStatements()).toBe(6);
    closeDay();
    nextDay();
    day(40);
    const r = await x(signIn(hub, STAFF.manager));
    expect(r.shifts).toHaveLength(40);
    expect(r.open_bills).toHaveLength(82); // 41 bill rows (day 1's still open) + 41 projected keys (day 1's carried in)
    expect(r.carried_over).toHaveLength(41); // 40 carried over + 1 carried in
    expect(r.carried_over.filter((c) => c.carried_in)).toHaveLength(1);
    expect(r.sales.total_minor).toBe(4_000_000); // 40 × Rs 1,000
    expect(handled['x-report']).toBe(8);
    expect(zStatements()).toBe(6);
  });

  it('[05 §6.2, §6.26] X open bills = §6.2 list: bill rows + an open seating with an unbilled order and no bill row + a takeaway key, flagged when open too long', async () => {
    await start();
    const seated = dineInTwoRounds(hub); // a table eating, no bills row
    const tw = takeawayOrder(hub, { prefix: 'TP' }); // a takeaway with no bills row
    openBill('B_ROW');
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM bills WHERE seating_id = ?').pluck().get(seated.seating_id)).toBe(0);
    const flag = hubBilling(branchConfig()!).settings.open_bill_flag_minutes;
    hub.clock.advance((flag + 5) * 60_000);
    const r = await x(signIn(hub, STAFF.manager));
    const name = branchConfig()!.floors.flatMap((f) => f.tables).find((t) => t.table_id === BX.dineInTable)!.name;
    expect(r.open_bills.map((b) => b.identifier).sort()).toEqual(['B_ROW', `#${tw.token}`, tableLabel(name)].sort());
    expect(r.open_bills.every((b) => b.open_minutes >= flag + 5 && b.flagged)).toBe(true);
    expect(handled['x-report']).toBe(8);
    // billed into a bill row: the seating is no longer listed twice
    put([on(aBillOpened(), 'B_SEAT', { bill_id: 'B_SEAT', seating_id: seated.seating_id })]);
    const again = await x(signIn(hub, STAFF.manager));
    expect(again.open_bills.filter((b) => b.identifier === tableLabel(name))).toHaveLength(1);
    expect(again.open_bills).toHaveLength(3);
  });

  it('[05 R-84 (2)] a reopen whose credit is not among the day\'s invoices: the X answers, the reopen is skipped, the hub log gets ids only', async () => {
    await start();
    openShift('SH_CASH', STAFF.cashier);
    openBill('B1');
    pay({ payment_id: 'P1', bill_id: 'B1', amount_minor: 100_000, shift_id: 'SH_CASH', taker: STAFF.cashier });
    const inv = close({ bill_id: 'B1', total_minor: 100_000, payment_ids: ['P1'] });
    // a credit dated another business day (not this day's invoices)
    const [credit] = reopen('B1', [{ invoice_id: inv, total_minor: 100_000 }], { credit_date: '2000-01-01' });
    const reopened = hub.deps.db.prepare(`SELECT event_id FROM events WHERE event_type = 'BillReopened'`).pluck().get() as string;
    const r = await x(signIn(hub, STAFF.manager));
    expect(r.reopens).toEqual({ count: 0, value_minor: 0, entries: [] });
    const line = hub.logs().split('\n').find((l) => l.includes('billing.report_warning'));
    expect(line).toBeDefined();
    const logged = JSON.parse(line!) as Record<string, unknown>;
    expect(logged).toMatchObject({ code: 'reopen_credit_missing', reopen_id: reopened, credit_invoice_id: credit });
  });
});

// ------------------------------------------------------------------------------------------------ days

describe('[05 §6.26 invariant] brought / carried forward over closed days', () => {
  it('[05 #63b] a PARTLY_PAID carry, a reopen left open and a reopen re-closed: Σ takings = Z net + CF − BF every day', async () => {
    await start();
    // day 1: P split 1 paid Rs 500 and closed, split 2 paid Rs 200 (carried); Y closed at Rs 1,000; W closed at Rs 2,000
    openShift('SH1', STAFF.cashier);
    openBill('P', [50_000, 50_000]);
    pay({ payment_id: 'P_1', bill_id: 'P', split_no: 1, amount_minor: 50_000, shift_id: 'SH1', taker: STAFF.cashier });
    close({ bill_id: 'P', split_no: 1, total_minor: 50_000, payment_ids: ['P_1'] });
    pay({ payment_id: 'P_2a', bill_id: 'P', split_no: 2, amount_minor: 20_000, shift_id: 'SH1', taker: STAFF.cashier });
    openBill('Y');
    pay({ payment_id: 'Y_1', bill_id: 'Y', amount_minor: 100_000, shift_id: 'SH1', taker: STAFF.cashier });
    const y = close({ bill_id: 'Y', total_minor: 100_000, payment_ids: ['Y_1'] });
    openBill('W');
    pay({ payment_id: 'W_1', bill_id: 'W', amount_minor: 200_000, shift_id: 'SH1', taker: STAFF.cashier });
    const w = close({ bill_id: 'W', total_minor: 200_000, payment_ids: ['W_1'] });
    carry(['O_P']);
    skipShift('SH1');
    const day1 = today().business_date;
    closeDay();
    const z1 = zOf(day1);
    expect(z1.net_after_credits_minor).toBe(350_000); // 500 + 1,000 + 2,000
    expect(z1.carried_forward).toEqual([{ mode_name: 'Cash', staff_id: STAFF.cashier, amount_minor: 20_000 }]);
    expect(z1.brought_forward).toEqual([]);
    expect(invariant(z1)).toEqual({ takings: 370_000, rhs: 370_000 });

    // day 2: P split 2 paid Rs 300 and closed at Rs 500; Y reopened and left open; W reopened and re-closed at Rs 2,000
    nextDay();
    openShift('SH2', STAFF.cashier);
    pay({ payment_id: 'P_2b', bill_id: 'P', split_no: 2, amount_minor: 30_000, shift_id: 'SH2', taker: STAFF.cashier });
    close({ bill_id: 'P', split_no: 2, total_minor: 50_000, payment_ids: ['P_2a', 'P_2b'] });
    reopen('Y', [{ invoice_id: y, total_minor: 100_000 }]);
    reopen('W', [{ invoice_id: w, total_minor: 200_000 }]);
    close({ bill_id: 'W', total_minor: 200_000, payment_ids: ['W_1'] });
    skipShift('SH2');
    const live = await x(signIn(hub, STAFF.manager));
    expect(live.brought_forward).toEqual([{ mode_name: 'Cash', staff_id: STAFF.cashier, amount_minor: 20_000 }]);
    const day2 = today().business_date;
    closeDay();
    const z2 = zOf(day2);
    expect(z2.sales.total_minor).toBe(250_000); // P 500 + W 2,000
    expect(z2.credits.value_minor).toBe(300_000); // Y 1,000 + W 2,000
    expect(z2.net_after_credits_minor).toBe(-50_000);
    expect(z2.reopens).toEqual({ count: 2, value_minor: 300_000, entries: [{ requester_staff_id: STAFF.manager, approver_staff_id: null }, { requester_staff_id: STAFF.manager, approver_staff_id: null }] });
    expect(z2.brought_forward).toEqual([{ mode_name: 'Cash', staff_id: STAFF.cashier, amount_minor: 20_000 }]);
    expect(z2.carried_forward).toEqual([{ mode_name: 'Cash', staff_id: STAFF.cashier, amount_minor: 100_000 }]); // Y's day-1 payment
    expect(invariant(z2)).toEqual({ takings: 30_000, rhs: 30_000 });
    expect(z2.carried_over).toEqual([{ label: 'O_P', carried_in: true }]); // no orders row: the order id
  });

  it('[05 #63c] the same order carried on day 1 and day 2: two carried_orders rows, no key error; day 2 lists it carried in and carried over; rebuild equal', async () => {
    await start();
    const tw = takeawayOrder(hub, { prefix: 'TC' });
    carry([tw.order_id]);
    const day1 = today().business_date;
    closeDay();
    expect(zOf(day1).carried_over).toEqual([{ label: `#${tw.token}`, carried_in: false }]);
    nextDay();
    carry([tw.order_id]);
    expect(hub.deps.db.prepare('SELECT order_id, business_date FROM carried_orders ORDER BY business_date').all()).toEqual([
      { order_id: tw.order_id, business_date: day1 },
      { order_id: tw.order_id, business_date: today().business_date },
    ]);
    const before = await x(signIn(hub, STAFF.manager));
    expect(before.carried_over).toEqual([
      { label: `#${tw.token} ${day1}`, carried_in: false },
      { label: `#${tw.token} ${day1}`, carried_in: true },
    ]);
    // rebuild the billing projection alone from seq 0: the same rows, the same X
    const rows = () => hub.deps.db.prepare('SELECT * FROM carried_orders ORDER BY order_id, business_date').all();
    const live = rows();
    hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'billing'`).run();
    const registry = createProjectionRegistry();
    registry.register(billingProjection());
    registry.catchUp(hub.deps.db, branch());
    expect(rows()).toEqual(live);
    const after = await x(signIn(hub, STAFF.manager));
    expect({ ...after, issued_at: 0 }).toEqual({ ...before, issued_at: 0 });
  });

  it('[05 #64b] a full refund paid back in another mode (cash in, card out): that day\'s carried forward and the next day\'s brought forward are 0 by mode', async () => {
    await start();
    openShift('SH1', STAFF.cashier);
    openBill('R');
    pay({ payment_id: 'R_in', bill_id: 'R', amount_minor: 100_000, shift_id: 'SH1', taker: STAFF.cashier });
    const inv = close({ bill_id: 'R', total_minor: 100_000, payment_ids: ['R_in'] });
    skipShift('SH1');
    closeDay();
    nextDay();
    openShift('SH2', STAFF.cashier);
    const credits = reopen('R', [{ invoice_id: inv, total_minor: 100_000 }]);
    pay({ payment_id: 'R_out', bill_id: 'R', amount_minor: 100_000, shift_id: 'SH2', taker: STAFF.cashier, mode: 'card', direction: 'out' });
    put([on(aBillClosedEmpty(), 'R', { bill_id: 'R', seating_id: null, credit_invoice_ids: credits, alert_id: undefined })]);
    skipShift('SH2');
    const day2 = today().business_date;
    closeDay();
    const z2 = zOf(day2);
    expect(z2.carried_forward).toEqual([]);
    expect(z2.full_refunds).toEqual({ count: 1, value_minor: 100_000 });
    expect(z2.payments_by_mode).toEqual([{ mode_name: 'card', in_minor: 0, out_minor: 100_000, change_minor: 0 }]);
    expect(invariant(z2)).toEqual({ takings: -100_000, rhs: -100_000 });
    nextDay();
    expect((await x(signIn(hub, STAFF.manager))).brought_forward).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ Z list

describe('[05 §6.26] GET /queries/z-reports', () => {
  it('[05 §6.26] newest first with a cursor; one Z by business_date; staff names resolved; a bad cursor → 400; the Cashier → 403', async () => {
    await start();
    const dates: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      openShift(`SH${i}`, STAFF.cashier);
      skipShift(`SH${i}`);
      dates.push(today().business_date);
      closeDay();
      nextDay();
    }
    const manager = signIn(hub, STAFF.manager);
    const first = await get<{ reports: ZView[] }>(manager, '/queries/z-reports?limit=2');
    expect(first.status).toBe(200);
    expect(first.body.data.reports.map((r) => [r.z_no, r.business_date])).toEqual([[3, dates[2]], [2, dates[1]]]);
    expect(first.body.data.reports[0]!.staff_names).toEqual({ [STAFF.cashier]: 'Cashier' });
    expect(first.body.data.reports[0]!.report).toEqual(zOf(dates[2]!));
    const cursor = first.body.meta!.next_cursor!;
    const second = await get<{ reports: ZView[] }>(manager, `/queries/z-reports?limit=2&cursor=${cursor}`);
    expect(second.body.data.reports.map((r) => r.z_no)).toEqual([1]);
    expect(second.body.meta!.next_cursor).toBeNull();
    const one = await get<{ reports: ZView[] }>(manager, `/queries/z-reports?business_date=${dates[1]}`);
    expect(one.body.data.reports.map((r) => r.z_no)).toEqual([2]);
    expect((await get<{ reports: ZView[] }>(manager, '/queries/z-reports?business_date=1999-01-01')).body.data.reports).toEqual([]);
    expect((await get(manager, '/queries/z-reports?cursor=bad')).status).toBe(400);
    const cashier = signIn(hub, STAFF.cashier);
    expect((await get(cashier, '/queries/z-reports')).status).toBe(403);
    expect(handled['z-reports']).toBe(0);
  });

  it('[05 §6.26] the Z list is 1 statement with 1, 3 and 40 Zs', async () => {
    await start();
    const manager = signIn(hub, STAFF.manager);
    const zs = (from: number, to: number) => {
      for (let n = from; n <= to; n += 1) {
        const business_date = `2026-01-${String(n).padStart(2, '0')}`;
        const z = aZReportIssued();
        put([{ stream_type: 'hub', stream_id: branch(), event_type: 'ZReportIssued', payload: { business_date, z_no: n, report: { ...(z.payload['report'] as object), z_no: n, business_date } } }], STAFF.manager);
      }
    };
    zs(1, 1);
    expect((await get<{ reports: ZView[] }>(manager, '/queries/z-reports')).body.data.reports.map((r) => r.z_no)).toEqual([1]);
    expect(handled['z-reports']).toBe(1);
    zs(2, 3);
    expect((await get<{ reports: ZView[] }>(manager, '/queries/z-reports')).body.data.reports).toHaveLength(3);
    expect(handled['z-reports']).toBe(1);
    zs(4, 31);
    zs(32, 40);
    const all = await get<{ reports: ZView[] }>(manager, '/queries/z-reports?limit=200');
    expect(all.body.data.reports).toHaveLength(40);
    expect(handled['z-reports']).toBe(1);
  });
});

// ------------------------------------------------------------------------------------------------ the print fold

function printers(list: Array<{ printer_id: string; name: string }>, routes: Array<[string, string]>): void {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  const env = { stream_type: 'hub' as const, stream_id: branch(), schema_version: 1, occurred_at: now, actor_id: STAFF.manager, device_id: 'D_FIXTURE' };
  hub.deps.writer.run((tx) =>
    tx.append([
      ...list.map((p, i) => ({ ...env, event_type: 'PrinterSaved', payload: { printer_id: p.printer_id, name: p.name, connection: 'lan', address: `192.168.2.${i + 1}:9100`, paper_width_mm: 80, archived: false } })),
      ...routes.map(([scope, printer_id]) => ({ ...env, event_type: 'BillRouteSet', payload: { scope, ref_id: '', printer_id } })),
    ]),
  );
}

const jobs = () => hub.deps.db.prepare(`SELECT job_id, printer_id, payload FROM print_jobs WHERE kind = 'document' ORDER BY created_at, job_id`).all() as Array<{ job_id: string; printer_id: string; payload: string }>;
const reportJobs = () => hub.deps.db.prepare(`SELECT job_id, bill_id, doc_kind, ref_id FROM bill_print_jobs WHERE doc_kind = 'report'`).all();

describe('[05 §6.25, §3.16] ZReportIssued live-only print fold', () => {
  it('[05 §3.16] prints the Z once at the report route (not the default), with names, job kept in bill_print_jobs', async () => {
    await start();
    printers([{ printer_id: 'PR_DEF', name: 'Counter' }, { printer_id: 'PR_REP', name: 'Office' }], [['default', 'PR_DEF'], ['report', 'PR_REP']]);
    openShift('SH1', STAFF.cashier);
    const day1 = today().business_date;
    const z = closeDay();
    const printed = jobs();
    expect(printed).toHaveLength(1);
    expect(printed[0]!.job_id).toBe(`${z.event_id}:z`);
    expect(printed[0]!.printer_id).toBe('PR_REP');
    expect(printed[0]!.payload).toContain('Z REPORT #1');
    expect(printed[0]!.payload).toContain('Cashier'); // resolved at render from staff_names (H16-5)
    expect(JSON.parse(printed[0]!.payload)).toMatchObject({ kind_label: 'Z report' });
    expect(reportJobs()).toEqual([{ job_id: `${z.event_id}:z`, bill_id: null, doc_kind: 'report', ref_id: day1 }]);
    expect(reportStaffIds(zOf(day1))).toEqual([STAFF.cashier]);
  });

  it('[05 §6.25 live only] a rebuild or catch-up with no claimed job prints no Z; live prints once; the same event live again prints nothing more', async () => {
    await start();
    printers([{ printer_id: 'PR_DEF', name: 'Counter' }], [['default', 'PR_DEF']]); // no report route → default
    const z = closeDay();
    expect(jobs().map((j) => j.printer_id)).toEqual(['PR_DEF']);
    // forget the print entirely (no claimed bill_print_jobs row, no job), as on a fresh rebuild
    const unclaim = () => {
      hub.deps.db.prepare(`DELETE FROM bill_print_jobs WHERE doc_kind = 'report'`).run();
      hub.deps.db.prepare(`DELETE FROM print_jobs WHERE kind = 'document'`).run();
    };
    unclaim();
    // rebuild billing and billing_prints from seq 0 (billing_prints is forward-only: its replay is 'catchup')
    hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection IN ('billing', 'billing_prints')`).run();
    const registry = createProjectionRegistry();
    registry.register(billingProjection());
    registry.register(billPrintsProjection(registry));
    registry.catchUp(hub.deps.db, branch());
    expect(jobs()).toEqual([]);
    expect(reportJobs()).toEqual([]);
    // the fold itself in catch-up mode, nothing claimed: no print
    const fold: Projection = billPrintsProjection(createProjectionRegistry());
    hub.deps.db.transaction(() => fold.apply(hub.deps.db, z, 'catchup'))();
    expect(jobs()).toEqual([]);
    // live: one print; the same event live again: claimed, no second job
    hub.deps.db.transaction(() => fold.apply(hub.deps.db, z, 'live'))();
    hub.deps.db.transaction(() => fold.apply(hub.deps.db, z, 'live'))();
    expect(jobs()).toHaveLength(1);
    expect(reportJobs()).toHaveLength(1);
  });

  it('[05 §6.25] the Z print fold is 6 statements with 1 shift and with 40 shifts', async () => {
    await start();
    printers([{ printer_id: 'PR_REP', name: 'Office' }], [['report', 'PR_REP']]);
    const foldCount = (z: PosEvent): number => {
      hub.deps.db.prepare(`DELETE FROM bill_print_jobs WHERE job_id = ?`).run(`${z.event_id}:z`);
      hub.deps.db.prepare(`DELETE FROM print_jobs WHERE job_id = ?`).run(`${z.event_id}:z`);
      const fold = billPrintsProjection(createProjectionRegistry());
      const c = statementCounter(hub.deps.db);
      hub.deps.db.transaction(() => fold.apply(hub.deps.db, z, 'live'))();
      return c.count;
    };
    openShift('SH1', STAFF.cashier);
    skipShift('SH1');
    const z1 = closeDay();
    expect(zOf(today().business_date).shifts).toHaveLength(1);
    expect(foldCount(z1)).toBe(6);
    nextDay();
    for (let i = 1; i <= 40; i += 1) {
      openShift(`SH40_${i}`, `S_N${i}`);
      skipShift(`SH40_${i}`);
    }
    const z40 = closeDay();
    expect((z40.payload as { report: ReportDocInput }).report.shifts).toHaveLength(40);
    expect(foldCount(z40)).toBe(6);
    expect(jobs().filter((j) => j.job_id === `${z40.event_id}:z`)).toHaveLength(1);
  });

  it('[05 §3.16, R8] no printer routed → the Z is still issued, the print is skipped and logged with ids only', async () => {
    await start();
    const z = closeDay();
    expect(jobs()).toEqual([]);
    expect(reportJobs()).toEqual([]);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM z_reports').pluck().get()).toBe(1);
    const line = hub.logs().split('\n').find((l) => l.includes('billing.print_skipped') && l.includes(z.event_id));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ event_id: z.event_id, event_type: 'ZReportIssued', seating_id: null, reason: 'no_printer' });
  });
});

