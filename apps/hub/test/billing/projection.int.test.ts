import type { EventDraft, PosEvent } from '@pos/events';
import {
  aBillClosedEmpty,
  aBillOpened,
  aBillReopened,
  aBillSplitsSet,
  aBusinessDayOpened,
  aBuyerIdWaived,
  aChargeApplied,
  aChargeRemoved,
  aCheckBillPrinted,
  aDiscountApplied,
  aDiscountFrozen,
  aDiscountRemoved,
  aFiscalNumberAssigned,
  aFiscalSubmitRejected,
  aFiscalTokenSet,
  anInvoiceCredited,
  anInvoiceIssued,
  aPaymentAdded,
  aPaymentRemoved,
  aZReportIssued,
} from '@pos/events/testing';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BILLING_EVENT_TYPES, billingProjection } from '../../src/billing/projections/billing';
import { registerHubProjections } from '../../src/lib/boot';
import { createProjectionRegistry, type Projection } from '../../src/projections/registry';
import { createTestHub, type TestHub } from '../helpers/test-hub';

// G-10 review (B): the real 28a module, with insertOutboxRow made to throw on demand (after outboxRowFor succeeded).
const outboxFault = vi.hoisted(() => ({ on: false }));
vi.mock('../../src/billing/fiscal/outbox', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/billing/fiscal/outbox')>();
  return {
    ...real,
    insertOutboxRow: (...args: Parameters<typeof real.insertOutboxRow>) => {
      if (outboxFault.on) throw new Error('outbox insert failed');
      return real.insertOutboxRow(...args);
    },
  };
});

// 05 §5 (task 7): the `billing` projection, events only, fed real events through the hub writer (the task-5 builders,
// ids overridden). Rebuild from seq 0 = live (#88, billing half), 02b OrdersBilled → bill_orders (#88b), the
// DiscountFrozen fold (#16d fold half), BillReopened.mode (#37i fold half), the invoice + outbox joint commit (G-10).

let hub: TestHub;
let db: Database.Database;

beforeEach(async () => {
  hub = await createTestHub();
  db = hub.deps.db;
});

afterEach(async () => {
  outboxFault.on = false;
  await hub.close();
});

type Draft = Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id'>;

/** A builder's event as a draft, its payload merged with `payload`. */
function d(built: PosEvent, payload: Record<string, unknown> = {}, stream_id?: string): Draft {
  return {
    stream_type: built.stream_type,
    stream_id: stream_id ?? (payload['bill_id'] as string | undefined) ?? built.stream_id,
    event_type: built.event_type,
    schema_version: built.schema_version,
    payload: { ...(built.payload as Record<string, unknown>), ...payload },
  };
}

/** A raw draft of another module's event (02a / 02b / 01a). */
function raw(stream_type: EventDraft['stream_type'], stream_id: string, event_type: string, payload: Record<string, unknown>, schema_version = 1): Draft {
  return { stream_type, stream_id, event_type, schema_version, payload };
}

/** One writer transaction of `drafts`, clock +1 s first; returns the appended events. */
function append(...drafts: Draft[]): PosEvent[] {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  return hub.deps.writer.run((tx) => tx.append(drafts.map((x) => ({ ...x, occurred_at: now, actor_id: 'S_CASH', device_id: 'D_FIXTURE' })))).appended;
}

const branch = () => hub.deps.config.provisioned!.branch_id;

const bill = (bill_id: string) => db.prepare('SELECT * FROM bills WHERE bill_id = ?').get(bill_id) as Record<string, unknown> | undefined;
const rows = (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as Array<Record<string, unknown>>;
const frozen = (bill_id: string) =>
  (db.prepare(`SELECT json_extract(discount_json, '$.frozen_minor') AS f, discount_json FROM bills WHERE bill_id = ?`).get(bill_id) as {
    f: number | null;
    discount_json: string | null;
  });

/** Every `billing` table (§5), ordered; `fiscal_outbox` without the worker columns (#88). */
function dump(): Record<string, unknown[]> {
  const all = (sql: string) => db.prepare(sql).all();
  return {
    bills: all('SELECT * FROM bills ORDER BY bill_id'),
    bill_orders: all('SELECT * FROM bill_orders ORDER BY bill_id, order_id'),
    bill_splits: all('SELECT * FROM bill_splits ORDER BY bill_id, split_no'),
    bill_discount_lines: all('SELECT * FROM bill_discount_lines ORDER BY bill_id, order_item_id'),
    bill_split_lines: all('SELECT * FROM bill_split_lines ORDER BY bill_id, split_no, order_item_id'),
    bill_payments: all('SELECT * FROM bill_payments ORDER BY payment_id'),
    invoices: all('SELECT * FROM invoices ORDER BY invoice_id'),
    invoice_taxes: all('SELECT * FROM invoice_taxes ORDER BY invoice_id, tax_profile_id, tax_code, payment_class'),
    fiscal_outbox: all(
      'SELECT invoice_id, ord, ref_invoice_id, jurisdiction_id, adapter_key, pos_id, state, queued_at, acked_at FROM fiscal_outbox ORDER BY invoice_id',
    ),
    closed_split_units: all('SELECT * FROM closed_split_units ORDER BY bill_id, split_no, order_item_id'),
    carried_orders: all('SELECT * FROM carried_orders ORDER BY order_id, business_date'),
    z_reports: all('SELECT * FROM z_reports ORDER BY business_date'),
    billing_day: all('SELECT * FROM billing_day'),
  };
}

/** Deletes the `billing` checkpoint and replays it alone from seq 0 (reset first); returns the replayed count. */
function rebuildBillingAlone(): number {
  db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'billing'`).run();
  const registry = createProjectionRegistry();
  registry.register(billingProjection());
  return registry.catchUp(db, branch()).replayed['billing'] ?? 0;
}

/** Every hub projection replayed from seq 0 (all checkpoints deleted). */
function rebuildAll(): void {
  db.prepare('DELETE FROM projection_checkpoints').run();
  const registry = createProjectionRegistry();
  registerHubProjections(registry);
  registry.catchUp(db, branch());
}

// ---------------------------------------------------------------------------------------------------- ids

const S1 = 'SEAT1';
const S2 = 'SEAT2';
const S3 = 'SEAT3';
const S4 = 'SEAT4';
const S5 = 'SEAT5';

const opened = (bill_id: string, seating_id: string) => d(aBillOpened(), { bill_id, seating_id });
const openedKey = (bill_id: string, bill_key: string) =>
  d(aBillOpened(), { bill_id, scope: 'key', seating_id: null, bill_key, order_type: 'takeaway', prices_include_tax: true });

/** A sale invoice of `bill_id` / `split_no` (the §6.31 builder, ids overridden). */
function sale(o: {
  invoice_id: string;
  bill_id: string;
  split_no: number;
  number: number;
  payment_ids: string[];
  discount_line_ids: string[] | null;
  lines?: Array<{ order_item_id: string; units: number; base_minor: number }>;
  fiscal?: Record<string, unknown>;
}): Draft {
  const base = anInvoiceIssued().payload as Record<string, unknown>;
  const line0 = (base['lines'] as Array<Record<string, unknown>>)[0]!;
  const lines = (o.lines ?? [{ order_item_id: 'L1', units: 1, base_minor: 571_000 }]).map((l) => ({ ...line0, ...l }));
  return d(anInvoiceIssued(), {
    invoice_id: o.invoice_id,
    bill_id: o.bill_id,
    split_no: o.split_no,
    number: o.number,
    invoice_ref: `AC1-S${String(o.number).padStart(6, '0')}`,
    payment_ids: o.payment_ids,
    discount_line_ids: o.discount_line_ids,
    lines,
    ...(o.fiscal === undefined ? {} : { fiscal: { ...(base['fiscal'] as Record<string, unknown>), ...o.fiscal } }),
  });
}

function credit(o: { invoice_id: string; ref: Draft; number: number }): Draft {
  const p = o.ref.payload as Record<string, unknown>;
  const { discount_line_ids: _drop, series: _series, ...rest } = p;
  void _drop;
  void _series;
  return d(anInvoiceCredited(), {
    ...rest,
    invoice_id: o.invoice_id,
    number: o.number,
    invoice_ref: `AC1-C${String(o.number).padStart(6, '0')}`,
    ref_invoice_id: p['invoice_id'],
    ref_invoice_ref: p['invoice_ref'],
    closed_by: 'S_MGR',
    alert_id: null,
  });
}

const NONE_FISCAL = {
  adapter_key: 'none',
  pos_id: null,
  required: false,
  capabilities: { ordering: 'none', credit: true },
  credit_support: 'credit_invoice',
};

const payment = (payment_id: string, bill_id: string, split_no: number, o: Record<string, unknown> = {}) =>
  d(aPaymentAdded(), { payment_id, bill_id, split_no, amount_minor: 1_000, tendered_minor: 1_500, change_minor: 500, ...o });

/**
 * A scripted day covering every `billing` event type (§5 list): splits of every mode, a merge that absorbs and one
 * that re-points, a seating split, a void across two splits, a removal, discounts, charges, payments and a removal,
 * three sales and a freeze, fiscal answers, a corrections reopen with credits, a takeaway (adapter `none`) closed and
 * fully reopened, an empty close, a carry-over, a Z and a token set. Returns the invoice drafts.
 */
function scriptedDay(): void {
  append(d(aBusinessDayOpened(), {}, branch()));
  append(opened('B1', S1), d(aChargeApplied(), { bill_id: 'B1' }));
  append(opened('B3', S2));
  append(d(aBillSplitsSet(), { bill_id: 'B3', mode: 'amount', splits: [{ split_no: 1, lines: null, share_minor: 100 }, { split_no: 2, lines: null, share_minor: 200 }] }));
  append(raw('table', 'T1', 'TablesMerged', { into_seating_id: S1, into_table_id: 'T1', table_ids: ['T2'], absorbed_seating_id: S2, order_ids: ['O5'], by_staff_id: 'S_MGR' }));
  append(opened('B4', S3));
  append(raw('table', 'T4', 'TablesMerged', { into_seating_id: S4, into_table_id: 'T4', table_ids: ['T3'], absorbed_seating_id: S3, order_ids: [], by_staff_id: 'S_MGR' }));
  append(
    d(aBillSplitsSet(), {
      bill_id: 'B4',
      mode: 'equal',
      splits: [2, 1].map((split_no) => ({ split_no, lines: null, share_minor: null })),
    }),
  );
  append(d(aBillSplitsSet(), { bill_id: 'B4', mode: 'none', splits: [{ split_no: 1, lines: null, share_minor: null }] }));
  append(d(aCheckBillPrinted(), { bill_id: 'B1' }));
  append(
    d(aBillSplitsSet(), {
      bill_id: 'B1',
      mode: 'items',
      splits: [
        { split_no: 1, lines: [{ order_item_id: 'L1', order_id: 'O1', units: 1 }], share_minor: null },
        { split_no: 2, lines: [{ order_item_id: 'L2', order_id: 'O1', units: 2 }, { order_item_id: 'L4', order_id: 'O1', units: 1 }], share_minor: null },
        { split_no: 3, lines: [{ order_item_id: 'L2', order_id: 'O1', units: 1 }, { order_item_id: 'L3', order_id: 'O2', units: 1 }], share_minor: null },
      ],
    }),
  );
  append(raw('order', 'O1', 'ItemVoided', { order_item_id: 'L2', units: 2 }));
  append(raw('order', 'O1', 'ItemRemoved', { order_item_id: 'L4' }));
  append(raw('table', 'T1', 'SeatingSplit', { from_seating_id: S1, new_seating_id: 'SEAT9', to_table_id: 'T9', order_ids: ['O2'], by_staff_id: 'S_MGR' }));
  append(d(aDiscountApplied(), { bill_id: 'B1' }));
  append(d(aDiscountRemoved(), { bill_id: 'B1' }));
  append(d(aDiscountApplied(), { bill_id: 'B1', kind: 'amount', value: 500, amount_minor: 500, replaces: false }));
  append(d(aChargeRemoved(), { bill_id: 'B1' }));
  append(d(aChargeApplied(), { bill_id: 'B1', source: 'manual' }));
  append(d(aBuyerIdWaived(), { bill_id: 'B1' }));
  append(payment('P1', 'B1', 1));
  append(payment('P2', 'B1', 1, { mode_id: 'card', payment_class: 'digital', tendered_minor: null, change_minor: null, amount_minor: 200 }));
  append(
    d(aPaymentRemoved(), { payment_id: 'P2', bill_id: 'B1', split_no: 1, mode_id: 'card', payment_class: 'digital', amount_minor: 200, change_minor: 0 }),
  );
  const i1 = sale({ invoice_id: 'I1', bill_id: 'B1', split_no: 1, number: 1, payment_ids: ['P1'], discount_line_ids: ['L1', 'L2', 'L3', 'L4'] });
  append(i1, d(aDiscountFrozen(), { bill_id: 'B1', frozen_minor: 500, line_ids: ['L1', 'L2', 'L3', 'L4'] }));
  append(payment('P3', 'B1', 2));
  const i2 = sale({ invoice_id: 'I2', bill_id: 'B1', split_no: 2, number: 2, payment_ids: ['P3'], discount_line_ids: null, lines: [{ order_item_id: 'L2', units: 1, base_minor: 1_000 }] });
  append(i2);
  const i3 = sale({ invoice_id: 'I3', bill_id: 'B1', split_no: 3, number: 3, payment_ids: [], discount_line_ids: null, lines: [{ order_item_id: 'L5', units: 2, base_minor: 2_000 }] });
  append(i3, raw('order', 'O1', 'OrdersBilled', { order_ids: ['O1', 'O5'], bill_id: 'B1' }));
  append(d(aFiscalNumberAssigned(), { invoice_id: 'I1' }, 'B1'));
  append(d(aFiscalSubmitRejected(), { invoice_id: 'I2' }, 'B1'));
  append(
    d(aBillReopened(), { bill_id: 'B1', mode: 'corrections', order_ids: ['O1', 'O5', 'O6'] }),
    credit({ invoice_id: 'C1', ref: i1, number: 1 }),
    credit({ invoice_id: 'C2', ref: i2, number: 2 }),
    credit({ invoice_id: 'C3', ref: i3, number: 3 }),
  );
  // takeaway on adapter `none`: closed (freeze 0, no discount), billed, fully reopened, credited
  append(openedKey('B2', 'takeaway:O9'));
  append(payment('P4', 'B2', 1));
  const i4 = sale({ invoice_id: 'I4', bill_id: 'B2', split_no: 1, number: 4, payment_ids: ['P4'], discount_line_ids: ['L9'], lines: [{ order_item_id: 'L9', units: 1, base_minor: 1_000 }], fiscal: NONE_FISCAL });
  append(i4, d(aDiscountFrozen(), { bill_id: 'B2', frozen_minor: 0, line_ids: ['L9'] }), raw('order', 'O9', 'OrdersBilled', { order_ids: ['O9'], bill_id: 'B2' }));
  append(d(aBillReopened(), { bill_id: 'B2', mode: 'full', order_ids: ['O9'] }), credit({ invoice_id: 'C4', ref: i4, number: 4 }));
  // an empty close
  append(opened('B5', S5));
  append(d(aBillClosedEmpty(), { bill_id: 'B5', seating_id: S5, credit_invoice_ids: [] }));
  append(raw('hub', branch(), 'OrdersCarriedOver', { order_ids: ['O7', 'O8'], business_date: '2025-10-20', reason_code: 'table_still_seated', has_note: false, note_id: null }));
  append(d(aZReportIssued(), {}, branch()));
  append(d(aFiscalTokenSet(), {}, branch()));
}

// ---------------------------------------------------------------------------------------------------- #88

describe('[05 §5] billing projection', () => {
  it('[05 §5] eventTypes = the §5 billing list (+ 02a / 02b / 01a events it folds), shifts-only events excluded', () => {
    expect([...BILLING_EVENT_TYPES].sort()).toEqual(
      [
        'BillOpened',
        'ChargeApplied',
        'ChargeRemoved',
        'CheckBillPrinted',
        'BillSplitsSet',
        'DiscountApplied',
        'DiscountRemoved',
        'DiscountFrozen',
        'PaymentAdded',
        'PaymentRemoved',
        'BuyerIdWaived',
        'InvoiceIssued',
        'BillReopened',
        'InvoiceCredited',
        'FiscalNumberAssigned',
        'FiscalSubmitRejected',
        'FiscalTokenSet',
        'OrdersCarriedOver',
        'ZReportIssued',
        'BillClosedEmpty',
        'OrdersBilled',
        'ItemVoided',
        'ItemRemoved',
        'TablesMerged',
        'SeatingSplit',
        'BusinessDayOpened',
      ].sort(),
    );
    for (const t of ['ShiftOpened', 'ShiftCounted', 'PettyCashOut', 'DrawerOpened']) expect(BILLING_EVENT_TYPES).not.toContain(t);
    const p = billingProjection();
    expect(p.name).toBe('billing');
    expect(p.reset).toBeTypeOf('function');
  });

  it('[05 #88 billing half] a scripted day of every billing event: rebuild from seq 0 equals live (alone and with every projection)', () => {
    scriptedDay();
    const live = dump();

    // the folds landed (spot checks; the equality below covers every column)
    expect(bill('B1')).toMatchObject({
      state: 'open',
      closed_at: null,
      reopen_count: 1,
      reopen_mode: 'corrections',
      sc_bp: 500,
      sc_removed: 0,
      buyer_waived: 1,
      split_mode: 'items',
      check_printed_at: expect.any(Number),
      prices_include_tax: 0,
      rounding_json: JSON.stringify({ step_minor: 100, mode: 'nearest', applies_to: 'all' }),
    });
    expect(JSON.parse(bill('B1')!['discount_json'] as string)).toEqual({ kind: 'amount', value: 500, reason_code: 'regular_customer', alert_id: null, frozen_minor: null });
    expect(bill('B3')).toMatchObject({ seating_id: S2, absorbed_into: 'B1' });
    expect(bill('B4')).toMatchObject({ seating_id: S4, absorbed_into: null, split_mode: null });
    expect(rows('SELECT split_no, plan_json, state FROM bill_splits WHERE bill_id = ?', 'B4')).toEqual([{ split_no: 1, plan_json: null, state: 'open' }]);
    expect(bill('B2')).toMatchObject({ scope: 'key', table_key: 'takeaway:O9', seating_id: null, reopen_mode: 'full', state: 'open', prices_include_tax: 1, discount_json: null });
    expect(bill('B5')).toMatchObject({ state: 'closed', closed_at: expect.any(Number) });
    // ItemVoided L2 ×2: split 3's 1 unit, then 1 of split 2's 2 (highest open split first); ItemRemoved L4 (all); SeatingSplit O2 → L3 gone
    expect(live.bill_split_lines).toEqual([
      { bill_id: 'B1', split_no: 1, order_item_id: 'L1', order_id: 'O1', units: 1 },
      { bill_id: 'B1', split_no: 2, order_item_id: 'L2', order_id: 'O1', units: 1 },
    ]);
    expect(rows('SELECT split_no, plan_json, state, invoice_id FROM bill_splits WHERE bill_id = ? ORDER BY split_no', 'B1')).toEqual([
      { split_no: 1, plan_json: null, state: 'open', invoice_id: null },
      { split_no: 2, plan_json: null, state: 'open', invoice_id: null },
      { split_no: 3, plan_json: null, state: 'open', invoice_id: null },
    ]);
    expect(rows('SELECT split_no, plan_json FROM bill_splits WHERE bill_id = ? ORDER BY split_no', 'B3')).toEqual([
      { split_no: 1, plan_json: '{"share_minor":100}' },
      { split_no: 2, plan_json: '{"share_minor":200}' },
    ]);
    expect(rows('SELECT payment_id, removed_at IS NOT NULL AS removed, invoice_id, tendered_minor FROM bill_payments ORDER BY payment_id')).toEqual([
      { payment_id: 'P1', removed: 0, invoice_id: null, tendered_minor: 1_500 },
      { payment_id: 'P2', removed: 1, invoice_id: null, tendered_minor: null },
      { payment_id: 'P3', removed: 0, invoice_id: null, tendered_minor: 1_500 },
      { payment_id: 'P4', removed: 0, invoice_id: null, tendered_minor: 1_500 },
    ]);
    expect(live.closed_split_units).toEqual([]); // both bills reopened (H1-27 rows deleted by BillReopened)
    expect(live.bill_discount_lines).toEqual([]); // H2-19
    expect(live.bill_orders).toEqual([
      { bill_id: 'B1', order_id: 'O1' },
      { bill_id: 'B1', order_id: 'O5' },
      { bill_id: 'B1', order_id: 'O6' },
      { bill_id: 'B2', order_id: 'O9' },
    ]);
    expect(rows('SELECT invoice_id, series, number, ref_invoice_id, credited_by, fiscal_number, adapter_key, closed_by FROM invoices ORDER BY invoice_id')).toEqual([
      { invoice_id: 'C1', series: 'credit', number: 1, ref_invoice_id: 'I1', credited_by: null, fiscal_number: null, adapter_key: 'PRA', closed_by: 'S_MGR' },
      { invoice_id: 'C2', series: 'credit', number: 2, ref_invoice_id: 'I2', credited_by: null, fiscal_number: null, adapter_key: 'PRA', closed_by: 'S_MGR' },
      { invoice_id: 'C3', series: 'credit', number: 3, ref_invoice_id: 'I3', credited_by: null, fiscal_number: null, adapter_key: 'PRA', closed_by: 'S_MGR' },
      { invoice_id: 'C4', series: 'credit', number: 4, ref_invoice_id: 'I4', credited_by: null, fiscal_number: null, adapter_key: 'none', closed_by: 'S_MGR' },
      { invoice_id: 'I1', series: 'sale', number: 1, ref_invoice_id: null, credited_by: 'C1', fiscal_number: 'FN-000777', adapter_key: 'PRA', closed_by: expect.any(String) },
      { invoice_id: 'I2', series: 'sale', number: 2, ref_invoice_id: null, credited_by: 'C2', fiscal_number: null, adapter_key: 'PRA', closed_by: expect.any(String) },
      { invoice_id: 'I3', series: 'sale', number: 3, ref_invoice_id: null, credited_by: 'C3', fiscal_number: null, adapter_key: 'PRA', closed_by: expect.any(String) },
      { invoice_id: 'I4', series: 'sale', number: 4, ref_invoice_id: null, credited_by: 'C4', fiscal_number: null, adapter_key: 'none', closed_by: expect.any(String) },
    ]);
    expect(live.invoice_taxes).toHaveLength(8);
    expect(live.fiscal_outbox.map((r) => [(r as { invoice_id: string }).invoice_id, (r as { state: string }).state])).toEqual([
      ['C1', 'pending'],
      ['C2', 'pending'],
      ['C3', 'pending'],
      ['C4', 'not_required'],
      ['I1', 'acked'],
      ['I2', 'rejected'],
      ['I3', 'pending'],
      ['I4', 'not_required'],
    ]);
    expect(live.carried_orders).toHaveLength(2);
    expect(live.z_reports).toHaveLength(1);
    expect(live.billing_day).toEqual([{ k: 1, business_date: '2025-10-20', opened_at: expect.any(Number) }]);

    // worker columns move; a rebuild resets them (harmless, §5) and they are not compared
    db.prepare(`UPDATE fiscal_outbox SET attempts = 3, last_error = 'timeout', next_try_at = 99 WHERE invoice_id = 'I3'`).run();
    expect(rebuildBillingAlone()).toBeGreaterThan(40);
    expect(dump()).toEqual(live);
    rebuildAll();
    expect(dump()).toEqual(live);
  });

  it('[05 §5] reset clears every billing table and leaves the hub-state tables alone', () => {
    scriptedDay();
    db.prepare(`INSERT INTO payment_references (payment_id, reference) VALUES ('P1', 'x')`).run();
    db.prepare(`INSERT INTO bill_print_jobs (job_id, bill_id, doc_kind, ref_id, created_at) VALUES ('J1', 'B1', 'check', NULL, 1)`).run();
    billingProjection().reset!(db);
    for (const [table, list] of Object.entries(dump())) expect(list, table).toEqual([]);
    expect(rows('SELECT * FROM payment_references')).toHaveLength(1);
    expect(rows('SELECT * FROM bill_print_jobs')).toHaveLength(1);
  });

  it('[05 §5, B13] a sale moves its split closed (bill partly_paid, then closed); payments get its invoice id; units and the first close\'s lines are kept', () => {
    append(opened('B1', S1));
    append(
      d(aBillSplitsSet(), {
        bill_id: 'B1',
        mode: 'equal',
        splits: [
          { split_no: 1, lines: null, share_minor: null },
          { split_no: 2, lines: null, share_minor: null },
        ],
      }),
    );
    expect(rows('SELECT split_no, plan_json FROM bill_splits WHERE bill_id = ? ORDER BY split_no', 'B1')).toEqual([
      { split_no: 1, plan_json: '{"n":2,"k":1}' },
      { split_no: 2, plan_json: '{"n":2,"k":2}' },
    ]);
    expect(bill('B1')).toMatchObject({ split_mode: 'equal' });
    append(payment('P1', 'B1', 1));
    append(sale({ invoice_id: 'I1', bill_id: 'B1', split_no: 1, number: 1, payment_ids: ['P1'], discount_line_ids: ['L1'] }));
    expect(bill('B1')).toMatchObject({ state: 'partly_paid', closed_at: null });
    expect(rows('SELECT split_no, state, invoice_id FROM bill_splits WHERE bill_id = ? ORDER BY split_no', 'B1')).toEqual([
      { split_no: 1, state: 'closed', invoice_id: 'I1' },
      { split_no: 2, state: 'open', invoice_id: null },
    ]);
    expect(rows('SELECT payment_id, invoice_id FROM bill_payments')).toEqual([{ payment_id: 'P1', invoice_id: 'I1' }]);
    expect(rows('SELECT * FROM closed_split_units')).toEqual([{ bill_id: 'B1', split_no: 1, order_item_id: 'L1', units: 1, share_minor: 571_000 }]);
    expect(rows('SELECT * FROM bill_discount_lines')).toEqual([{ bill_id: 'B1', order_item_id: 'L1' }]);
    expect(rows('SELECT invoice_id, ord, state, queued_at, pos_id FROM fiscal_outbox')).toEqual([
      { invoice_id: 'I1', ord: expect.any(Number), state: 'pending', queued_at: expect.any(Number), pos_id: 'POS-1' },
    ]);
    const ord = (rows('SELECT ord FROM fiscal_outbox')[0] as { ord: number }).ord;
    expect(ord).toBe((rows(`SELECT seq FROM events WHERE event_type = 'InvoiceIssued'`)[0] as { seq: number }).seq);
    const inv = rows('SELECT * FROM invoices')[0]!;
    expect(inv).toMatchObject({ jurisdiction_id: 'PK-PB', currency_code: 'PKR', prices_include_tax: 0, total_minor: 695_500, has_buyer_id: 0, business_date: '2025-10-20' });
    expect(JSON.parse(inv['doc_json'] as string)).toMatchObject({ lines: [expect.objectContaining({ order_item_id: 'L1' })], fiscal: expect.objectContaining({ adapter_key: 'PRA' }) });
    append(sale({ invoice_id: 'I2', bill_id: 'B1', split_no: 2, number: 2, payment_ids: [], discount_line_ids: null, lines: [{ order_item_id: 'L1', units: 1, base_minor: 1 }] }));
    expect(bill('B1')).toMatchObject({ state: 'closed', closed_at: hub.clock.branchNow() });
    expect(rows('SELECT * FROM bill_discount_lines')).toEqual([{ bill_id: 'B1', order_item_id: 'L1' }]);
    // a replayed invoice event is a no-op on the outbox row (INSERT OR IGNORE)
    expect(rows('SELECT COUNT(*) AS n FROM fiscal_outbox')).toEqual([{ n: 2 }]);
  });
});

// ---------------------------------------------------------------------------------------------------- #88b

describe('[05 §3.8, §5] BillSplitsSet plans', () => {
  it('[05 §5, A3] equal: k ranks the split by split_no among the listed open splits, whatever the array order', () => {
    append(opened('B1', S1));
    append(
      d(aBillSplitsSet(), {
        bill_id: 'B1',
        mode: 'equal',
        splits: [3, 1, 2].map((split_no) => ({ split_no, lines: null, share_minor: null })),
      }),
    );
    expect(rows('SELECT split_no, plan_json FROM bill_splits WHERE bill_id = ? ORDER BY split_no', 'B1')).toEqual([
      { split_no: 1, plan_json: '{"n":3,"k":1}' },
      { split_no: 2, plan_json: '{"n":3,"k":2}' },
      { split_no: 3, plan_json: '{"n":3,"k":3}' },
    ]);
    // after split 1 closes, a re-plan of the open remainder lists 4, 2 → k by split_no (2 → 1, 4 → 2)
    append(sale({ invoice_id: 'I1', bill_id: 'B1', split_no: 1, number: 1, payment_ids: [], discount_line_ids: ['L1'] }));
    append(d(aBillSplitsSet(), { bill_id: 'B1', mode: 'equal', splits: [4, 2].map((split_no) => ({ split_no, lines: null, share_minor: null })) }));
    expect(rows('SELECT split_no, plan_json, state FROM bill_splits WHERE bill_id = ? ORDER BY split_no', 'B1')).toEqual([
      { split_no: 1, plan_json: '{"n":3,"k":1}', state: 'closed' }, // §3.8: closed splits keep their plan
      { split_no: 2, plan_json: '{"n":2,"k":1}', state: 'open' },
      { split_no: 4, plan_json: '{"n":2,"k":2}', state: 'open' },
    ]);
  });

  it("[05 §3.8, A2] mode 'none' → split_mode NULL, one open split, the item plan rows gone; closed splits kept", () => {
    append(opened('B1', S1));
    append(
      d(aBillSplitsSet(), {
        bill_id: 'B1',
        mode: 'items',
        splits: [
          { split_no: 1, lines: [{ order_item_id: 'L1', order_id: 'O1', units: 1 }], share_minor: null },
          { split_no: 2, lines: [{ order_item_id: 'L2', order_id: 'O1', units: 1 }], share_minor: null },
          { split_no: 3, lines: [{ order_item_id: 'L3', order_id: 'O1', units: 1 }], share_minor: null },
        ],
      }),
    );
    append(sale({ invoice_id: 'I1', bill_id: 'B1', split_no: 1, number: 1, payment_ids: [], discount_line_ids: ['L1', 'L2', 'L3'] }));
    expect(bill('B1')).toMatchObject({ split_mode: 'items', state: 'partly_paid' });
    append(d(aBillSplitsSet(), { bill_id: 'B1', mode: 'none', splits: [{ split_no: 2, lines: null, share_minor: null }] }));
    expect(bill('B1')).toMatchObject({ split_mode: null, state: 'partly_paid' });
    expect(rows('SELECT split_no, plan_json, state FROM bill_splits WHERE bill_id = ? ORDER BY split_no', 'B1')).toEqual([
      { split_no: 1, plan_json: null, state: 'closed' },
      { split_no: 2, plan_json: null, state: 'open' },
    ]);
    expect(rows('SELECT split_no, order_item_id FROM bill_split_lines WHERE bill_id = ?', 'B1')).toEqual([{ split_no: 1, order_item_id: 'L1' }]);
  });
});

describe('[05 #88b] OrdersBilled → bill_orders', () => {
  it('[05 #88b] one row per order (INSERT OR IGNORE); a repeat changes nothing; OrdersBilled is in eventTypes; rebuild = live', () => {
    expect(billingProjection().eventTypes).toContain('OrdersBilled');
    append(opened('B1', S1));
    append(raw('order', 'O1', 'OrdersBilled', { order_ids: ['O1', 'O2', 'O3'], bill_id: 'B1' }));
    expect(rows('SELECT * FROM bill_orders ORDER BY order_id')).toEqual([
      { bill_id: 'B1', order_id: 'O1' },
      { bill_id: 'B1', order_id: 'O2' },
      { bill_id: 'B1', order_id: 'O3' },
    ]);
    append(raw('order', 'O1', 'OrdersBilled', { order_ids: ['O1', 'O2'], bill_id: 'B1' }));
    expect(rows('SELECT COUNT(*) AS n FROM bill_orders')).toEqual([{ n: 3 }]);
    // BillReopened.order_ids adds to it (H3-2)
    append(d(aBillReopened(), { bill_id: 'B1', order_ids: ['O3', 'O4'] }));
    expect(rows('SELECT order_id FROM bill_orders ORDER BY order_id').map((r) => r['order_id'])).toEqual(['O1', 'O2', 'O3', 'O4']);
    const live = dump();
    rebuildBillingAlone();
    expect(dump()).toEqual(live);
  });
});

// ---------------------------------------------------------------------------------------------------- #16d

describe('[05 #16d fold half] DiscountFrozen', () => {
  it('[05 #16d fold half] only DiscountFrozen sets discount_json.frozen_minor; no discount stays NULL; BillReopened clears it and the lines; rebuild = live', () => {
    append(opened('B1', S1));
    append(d(aDiscountApplied(), { bill_id: 'B1', kind: 'percent', value: 1_000, amount_minor: 20_000 }));
    expect(frozen('B1').f).toBeNull();
    const lineIds = ['L1', 'L2'];
    append(sale({ invoice_id: 'I1', bill_id: 'B1', split_no: 1, number: 1, payment_ids: [], discount_line_ids: lineIds }));
    expect(frozen('B1').f).toBeNull(); // the InvoiceIssued fold alone never sets it
    expect(rows('SELECT order_item_id FROM bill_discount_lines ORDER BY order_item_id').map((r) => r['order_item_id'])).toEqual(lineIds);
    append(d(aDiscountFrozen(), { bill_id: 'B1', frozen_minor: 20_000, line_ids: lineIds }));
    expect(frozen('B1').f).toBe(20_000);
    expect(JSON.parse(frozen('B1').discount_json!)).toEqual({ kind: 'percent', value: 1_000, reason_code: 'regular_customer', alert_id: null, frozen_minor: 20_000 });

    // a bill with no discount: DiscountFrozen { 0 } leaves discount_json NULL
    append(opened('B2', S2));
    append(d(aDiscountFrozen(), { bill_id: 'B2', frozen_minor: 0, line_ids: ['L9'] }));
    expect(frozen('B2').discount_json).toBeNull();

    // BillReopened → frozen_minor null and bill_discount_lines empty (H2-19); the next first close freezes again
    append(d(aBillReopened(), { bill_id: 'B1', mode: 'full' }));
    expect(frozen('B1').f).toBeNull();
    expect(JSON.parse(frozen('B1').discount_json!)).toMatchObject({ kind: 'percent', frozen_minor: null });
    expect(rows('SELECT * FROM bill_discount_lines')).toEqual([]);
    append(sale({ invoice_id: 'I2', bill_id: 'B1', split_no: 1, number: 2, payment_ids: [], discount_line_ids: ['L1', 'L2', 'L3'] }));
    append(d(aDiscountFrozen(), { bill_id: 'B1', frozen_minor: 19_000, line_ids: ['L1', 'L2', 'L3'] }));
    expect(frozen('B1').f).toBe(19_000);
    expect(rows('SELECT COUNT(*) AS n FROM bill_discount_lines')).toEqual([{ n: 3 }]);

    const live = dump();
    rebuildBillingAlone();
    expect(dump()).toEqual(live);
    expect(frozen('B1').f).toBe(19_000);
  });
});

// ---------------------------------------------------------------------------------------------------- #37i

/** Records every SQL text prepared on `db` while `fn` runs. */
function sqlDuring(fn: () => void): string[] {
  const seen: string[] = [];
  const prepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    seen.push(sql);
    return prepare(sql);
  }) as typeof db.prepare;
  try {
    fn();
  } finally {
    db.prepare = prepare as typeof db.prepare;
  }
  return seen;
}

describe('[05 #37i fold half] BillReopened.mode → bills.reopen_mode', () => {
  it('[05 #37i fold half] corrections → out of bills_live_seating (a newer bill inserts); full → in it (a newer bill clashes); overwrite; no seating read; rebuild = live', () => {
    append(opened('B1', S1));
    append(sale({ invoice_id: 'I1', bill_id: 'B1', split_no: 1, number: 1, payment_ids: [], discount_line_ids: ['L1'] }));
    expect(bill('B1')).toMatchObject({ state: 'closed' });
    const sql = sqlDuring(() => append(d(aBillReopened(), { bill_id: 'B1', mode: 'corrections' })));
    // the fold's SQL only: 02b §6.19's before-commit hook (billing/lanes/open-order-bill.ts) does its own one
    // affected-order read after the folds (owner 2026-11-27)
    const fold = sql.filter((s) => !s.includes('unpaid_handover_approved_at'));
    expect(fold.filter((s) => /seatings|seating_tables|seating_orders|orders\b|order_lines/.test(s.replace(/bill_orders/g, '')))).toEqual([]);
    expect(bill('B1')).toMatchObject({ reopen_mode: 'corrections', reopen_count: 1, state: 'open' });
    // corrections: the bill is in neither live index, so a newer open bill on the same seating inserts (#37f)
    append(opened('B2', S1));
    expect(bill('B2')).toMatchObject({ seating_id: S1, state: 'open' });
    // a second BillReopened overwrites the mode; a 'full' bill is in bills_live_seating, so it clashes with B2
    append(sale({ invoice_id: 'I2', bill_id: 'B1', split_no: 1, number: 2, payment_ids: [], discount_line_ids: ['L1'] }));
    expect(() => append(d(aBillReopened(), { bill_id: 'B1', mode: 'full' }))).toThrow(/UNIQUE constraint failed: bills\.seating_id/);
    expect(bill('B1')).toMatchObject({ reopen_mode: 'corrections', reopen_count: 1, state: 'closed' }); // rolled back

    // the key index likewise
    append(openedKey('K1', 'takeaway:O9'));
    append(sale({ invoice_id: 'I3', bill_id: 'K1', split_no: 1, number: 3, payment_ids: [], discount_line_ids: ['L9'], fiscal: NONE_FISCAL }));
    append(d(aBillReopened(), { bill_id: 'K1', mode: 'full' }));
    expect(bill('K1')).toMatchObject({ reopen_mode: 'full', state: 'open' });
    expect(() => append(openedKey('K2', 'takeaway:O9'))).toThrow(/UNIQUE constraint failed: bills\.table_key/);
    append(sale({ invoice_id: 'I4', bill_id: 'K1', split_no: 1, number: 4, payment_ids: [], discount_line_ids: ['L9'], fiscal: NONE_FISCAL }));
    append(d(aBillReopened(), { bill_id: 'K1', mode: 'corrections' }));
    expect(bill('K1')).toMatchObject({ reopen_mode: 'corrections', reopen_count: 2 });
    append(openedKey('K2', 'takeaway:O9'));

    const live = dump();
    rebuildBillingAlone();
    expect(dump()).toEqual(live);
    expect(bill('B1')).toMatchObject({ reopen_mode: 'corrections' });
    expect(bill('K1')).toMatchObject({ reopen_mode: 'corrections' });
  });
});

// ---------------------------------------------------------------------------------------------------- G-10

describe('[05 G-10, B20] the invoice and its outbox row commit or roll back together', () => {
  const counts = () => rows(`SELECT (SELECT COUNT(*) FROM invoices) AS invoices, (SELECT COUNT(*) FROM fiscal_outbox) AS outbox, (SELECT COUNT(*) FROM events WHERE event_type = 'InvoiceIssued') AS events`)[0];

  it('[05 G-10] the close transaction throws after the append → no invoice row, no outbox row, no event', () => {
    append(opened('B1', S1));
    const before = counts();
    expect(() =>
      hub.deps.writer.run((tx) => {
        tx.append([{ ...sale({ invoice_id: 'I1', bill_id: 'B1', split_no: 1, number: 1, payment_ids: [], discount_line_ids: ['L1'] }), occurred_at: hub.clock.branchNow(), actor_id: 'S_CASH', device_id: 'D' }]);
        expect(counts()).toEqual({ invoices: 1, outbox: 1, events: 1 }); // folded in the same transaction
        throw new Error('later step failed');
      }),
    ).toThrow('later step failed');
    expect(counts()).toEqual(before);
    expect(bill('B1')).toMatchObject({ state: 'open' });
  });

  it('[05 G-10] a forced COMMIT failure (beforeCommit) → neither row', async () => {
    await hub.close();
    let fail = false;
    hub = await createTestHub({ testHooks: { beforeCommit: () => { if (fail) throw new Error('commit failed'); } } });
    db = hub.deps.db;
    append(opened('B1', S1));
    fail = true;
    expect(() => append(sale({ invoice_id: 'I1', bill_id: 'B1', split_no: 1, number: 1, payment_ids: [], discount_line_ids: ['L1'] }))).toThrow('commit failed');
    expect(counts()).toEqual({ invoices: 0, outbox: 0, events: 0 });
  });

  it('[05 G-10] an invoice whose outbox row cannot be written (fiscalized, no pos_id) → the invoice rolls back too', () => {
    append(opened('B1', S1));
    expect(() => append(sale({ invoice_id: 'I1', bill_id: 'B1', split_no: 1, number: 1, payment_ids: [], discount_line_ids: ['L1'], fiscal: { pos_id: null } }))).toThrow(
      /needs a pos_id/,
    );
    expect(counts()).toEqual({ invoices: 0, outbox: 0, events: 0 });
    expect(rows('SELECT * FROM bill_splits WHERE state = ?', 'closed')).toEqual([]);
  });

  const snapshot = () =>
    rows(`SELECT (SELECT COUNT(*) FROM invoices) AS invoices, (SELECT COUNT(*) FROM invoice_taxes) AS taxes,
            (SELECT COUNT(*) FROM fiscal_outbox) AS outbox, (SELECT COUNT(*) FROM closed_split_units) AS units,
            (SELECT COUNT(*) FROM bill_discount_lines) AS discount_lines,
            (SELECT COUNT(*) FROM events WHERE stream_type = 'bill') AS bill_events,
            (SELECT json_group_array(json_array(split_no, state, invoice_id)) FROM bill_splits) AS splits,
            (SELECT json_group_array(json_array(payment_id, invoice_id)) FROM bill_payments) AS payments,
            (SELECT json_object('state', state, 'reopen_count', reopen_count, 'reopen_mode', reopen_mode) FROM bills WHERE bill_id = 'B1') AS bill`)[0];

  it('[05 G-10, B20] a sale whose insertOutboxRow throws (outboxRowFor succeeded) → no invoice, split, payment or event change', () => {
    append(opened('B1', S1));
    append(payment('P1', 'B1', 1));
    const before = snapshot();
    outboxFault.on = true;
    expect(() => append(sale({ invoice_id: 'I1', bill_id: 'B1', split_no: 1, number: 1, payment_ids: ['P1'], discount_line_ids: ['L1'] }))).toThrow(
      'outbox insert failed',
    );
    expect(snapshot()).toEqual(before);
    expect(before).toMatchObject({ invoices: 0, outbox: 0, splits: '[[1,"open",null]]', payments: '[["P1",null]]', bill: '{"state":"open","reopen_count":0,"reopen_mode":null}' });
  });

  it('[05 G-10, B20] a credit whose insertOutboxRow throws → the reopen and the credit roll back (invoice, splits, payments, events)', () => {
    append(opened('B1', S1));
    append(payment('P1', 'B1', 1));
    const i1 = sale({ invoice_id: 'I1', bill_id: 'B1', split_no: 1, number: 1, payment_ids: ['P1'], discount_line_ids: ['L1'] });
    append(i1);
    const before = snapshot();
    expect(before).toMatchObject({ invoices: 1, outbox: 1, splits: '[[1,"closed","I1"]]', payments: '[["P1","I1"]]' });
    outboxFault.on = true;
    expect(() => append(d(aBillReopened(), { bill_id: 'B1' }), credit({ invoice_id: 'C1', ref: i1, number: 1 }))).toThrow('outbox insert failed');
    expect(snapshot()).toEqual(before);
    expect(rows(`SELECT credited_by FROM invoices WHERE invoice_id = 'I1'`)).toEqual([{ credited_by: null }]);
  });

  it('[05 G-10, H6-8] a credit follows its original row; a credit of an unknown original throws and writes nothing', () => {
    append(opened('B1', S1));
    const i1 = sale({ invoice_id: 'I1', bill_id: 'B1', split_no: 1, number: 1, payment_ids: [], discount_line_ids: ['L1'] });
    append(i1);
    const ghost = credit({ invoice_id: 'C9', ref: sale({ invoice_id: 'IX', bill_id: 'B1', split_no: 1, number: 9, payment_ids: [], discount_line_ids: null }), number: 9 });
    expect(() => append(d(aBillReopened(), { bill_id: 'B1' }), ghost)).toThrow(/original outbox row missing/);
    expect(bill('B1')).toMatchObject({ reopen_count: 0, state: 'closed' });
    expect(rows(`SELECT COUNT(*) AS n FROM invoices WHERE series = 'credit'`)).toEqual([{ n: 0 }]);
    append(d(aBillReopened(), { bill_id: 'B1' }), credit({ invoice_id: 'C1', ref: i1, number: 1 }));
    expect(rows(`SELECT invoice_id, ref_invoice_id, state, adapter_key, pos_id FROM fiscal_outbox WHERE invoice_id = 'C1'`)).toEqual([
      { invoice_id: 'C1', ref_invoice_id: 'I1', state: 'pending', adapter_key: 'PRA', pos_id: 'POS-1' },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------- no N+1

describe('[05 §5] fold statements are fixed (no per-line, per-split or per-payment statement)', () => {
  const projection: Projection = billingProjection();
  const statementsOf = (event: PosEvent): number => {
    let n = 0;
    const prepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      const st = prepare(sql);
      const wrap = <A extends unknown[], R>(f: (...a: A) => R) => (...a: A): R => {
        n += 1;
        return f(...a);
      };
      st.run = wrap(st.run.bind(st));
      st.get = wrap(st.get.bind(st));
      st.all = wrap(st.all.bind(st));
      return st;
    }) as typeof db.prepare;
    try {
      db.transaction(() => projection.apply(db, event, 'live'))();
    } finally {
      db.prepare = prepare as typeof db.prepare;
    }
    return n;
  };

  it('[05 §5] an InvoiceIssued / BillSplitsSet / ItemVoided costs the same statements for 1 and for 20 lines / splits', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ order_item_id: `L${i}`, units: 1, base_minor: 100 }));
    append(opened('B1', S1), opened('B2', S2), opened('B3', S3), opened('B4', S4));
    const e1 = { ...anInvoiceIssued(), seq: 900, payload: sale({ invoice_id: 'I1', bill_id: 'B1', split_no: 1, number: 1, payment_ids: ['P1'], discount_line_ids: ['L0'], lines: many(1) }).payload } as PosEvent;
    const e40 = {
      ...anInvoiceIssued(),
      seq: 901,
      payload: sale({ invoice_id: 'I2', bill_id: 'B2', split_no: 1, number: 2, payment_ids: Array.from({ length: 40 }, (_, i) => `P${i}`), discount_line_ids: many(40).map((l) => l.order_item_id), lines: many(40) }).payload,
    } as PosEvent;
    expect(statementsOf(e40)).toBe(statementsOf(e1));

    const splits = (n: number) => Array.from({ length: n }, (_, i) => ({ split_no: i + 1, lines: [{ order_item_id: `L${i}`, order_id: 'O1', units: 1 }], share_minor: null }));
    const s2 = { ...aBillSplitsSet(), payload: { bill_id: 'B3', mode: 'items', splits: splits(2) } } as PosEvent;
    const s20 = { ...aBillSplitsSet(), payload: { bill_id: 'B4', mode: 'items', splits: splits(20) } } as PosEvent;
    expect(statementsOf(s20)).toBe(statementsOf(s2));

    const v = { ...aBillSplitsSet(), event_type: 'ItemVoided', stream_type: 'order', payload: { order_item_id: 'L0', units: 1 } } as PosEvent;
    const v20 = { ...v, payload: { order_item_id: 'L0', units: 20 } } as PosEvent;
    expect(statementsOf(v20)).toBe(statementsOf(v));

    // A1: a line in 1 open split vs the same line spread over 20 open splits (the void spans all of them)
    append(opened('B5', S5), opened('B6', 'SEAT6'));
    const spread = (bill_id: string, n: number, id: string) =>
      ({
        ...aBillSplitsSet(),
        payload: {
          bill_id,
          mode: n === 1 ? 'none' : 'items',
          splits: Array.from({ length: n }, (_, i) => ({ split_no: i + 1, lines: n === 1 ? null : [{ order_item_id: id, order_id: 'O9', units: 1 }], share_minor: null })),
        },
      }) as PosEvent;
    projection.apply(db, spread('B5', 2, 'LX'), 'live');
    db.prepare(`DELETE FROM bill_split_lines WHERE bill_id = 'B5' AND split_no = 1`).run(); // LX in one open split only
    projection.apply(db, spread('B6', 20, 'LY'), 'live');
    expect(rows(`SELECT COUNT(*) AS n FROM bill_split_lines WHERE order_item_id = 'LX'`)).toEqual([{ n: 1 }]);
    expect(rows(`SELECT COUNT(*) AS n FROM bill_split_lines WHERE order_item_id = 'LY'`)).toEqual([{ n: 20 }]);
    const one = statementsOf({ ...v, payload: { order_item_id: 'LX', units: 1 } } as PosEvent);
    const spreadMany = statementsOf({ ...v, payload: { order_item_id: 'LY', units: 20 } } as PosEvent);
    expect(spreadMany).toBe(one);
    expect(rows(`SELECT COUNT(*) AS n FROM bill_split_lines WHERE order_item_id IN ('LX', 'LY')`)).toEqual([{ n: 0 }]);
  });
});
