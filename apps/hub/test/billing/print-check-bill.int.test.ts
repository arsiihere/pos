// 05 §6.3 `PrintCheckBill`, §6.4 the live-only `BillRequested` fold, §6.4a (R-30, row T-4), §3.16, B17 (task 11;
// 05-plan §3 row 11): #58, #59 (extended: the command half; the Doc half is 4a / 4b's), #6b (print half). Real events
// through the hub's writer, the real `billing` fold, the command over HTTP as the client sends it, 03c's real
// print_config fold for printers and bill routes (P-1), and the check bill read back from 03c's `print_jobs` payload.
import { renderText, type Doc } from '@pos/domain';
import { BillRouteSet, BillSplitsSet, DiscountApplied, parseEvent, PaymentAdded, PrinterSaved, SnapshotBillingSchema, rateBpRates, type BranchConfig, type EventDef, type EventDraft, type PosEvent, type SnapshotBilling } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { aBillSplitsSet, aDiscountApplied, aPaymentAdded } from '@pos/events/testing';
import { printCheckBillCommand } from '../../src/billing/commands/print-check-bill';
import { hubBilling } from '../../src/billing/defaults';
import type { BillView } from '../../src/billing/queries/bill';
import { billPrintsProjection, bindBillPrints, type BillPrintSkip } from '../../src/billing/print/folds';
import { billTileMarks } from '../../src/billing/tile-marks';
import { createProjectionRegistry } from '../../src/projections/registry';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { seedDirectory, type TestHub } from '../helpers/test-hub';
import { openDay, voidsMenu } from '../voids/fixtures';
import { appendOrder, billingDirectory, FX, openSeating, post, signIn, STAFF, startBilling, takeawayOrder, VX, type Who } from './fixtures';

const FOOD = 'tc-food';
const ZONE = 'Z_GARDEN';
const P = { zone: 'P_ZONE', floor: 'P_FLOOR', other: 'P_OTHER', fallback: 'P_DEFAULT', device: 'P_DEVICE', narrow: 'P_NARROW' } as const;

let hub: TestHub;
let cashier: Who;
let waiter: Who;
let floorId: string;

afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

// ------------------------------------------------------------------------------------------------ set-up

/** The PK document: 1 600 bp food tax, dine-in service charge `sc_bp`, a card mode (the digital-rate line). */
function billingDoc(o: { sc_bp?: number; prices_include_tax?: boolean } = {}): SnapshotBilling {
  const pk = hubBilling({ currency_code: 'PKR', tax_classes: [], billing: undefined });
  return SnapshotBillingSchema.parse({
    ...pk.settings,
    service_charge_bp: { ...pk.settings.service_charge_bp, dine_in: o.sc_bp ?? 1_000 },
    service_charge_tax_profile_id: FOOD,
    payment_modes: [...pk.settings.payment_modes, { mode_id: 'card', name: 'Card', kind: 'card', payment_class: 'digital', reference_required: false, is_active: true, sort_order: 1, authority_codes: [] }],
    jurisdiction: { ...pk.jurisdiction, rules: pk.jurisdiction.rules.map((r) => ({ ...r, prices_include_tax: o.prices_include_tax ?? r.prices_include_tax })) },
    tax_profiles: [{ tax_class_id: FOOD, taxes: [{ seq: 1, tax_code: 'TAX', label: 'Sales tax', compound: false, rates: rateBpRates(1_600).map((r) => (r.payment_class === 'digital' ? { ...r, rate_bp: 500 } : r)) }] }],
  });
}

/** voidsMenu() taxed (Karahi, Naan, Fish), T4 in zone Z_GARDEN on the first floor, T5 in no zone. */
function menu(billing: SnapshotBilling = billingDoc()): BranchConfig {
  const m = voidsMenu();
  const taxed = new Set<string>([FX.piece, FX.naan, FX.gram]);
  return {
    ...m,
    tax_enabled: true,
    tax_classes: [{ tax_class_id: FOOD, name: 'Sales tax', rate_bp: 1_600, is_archived: false, fiscal_category: 'restaurant_service' }],
    items: m.items.map((i) => (taxed.has(i.item_id) ? { ...i, tax_class_id: FOOD } : i)),
    floors: m.floors.map((f) => ({ ...f, tables: f.tables.map((t) => (t.table_id === VX.tables.T4 ? { ...t, zone_id: ZONE } : t)) })),
    billing,
  };
}

type HubDraft = Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id'>;
function hubAppend(drafts: HubDraft[]): PosEvent[] {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  return hub.deps.writer.run((tx) => tx.append(drafts.map((x) => ({ ...x, occurred_at: now, actor_id: STAFF.manager, device_id: 'D_FIXTURE' })))).appended;
}
function onHub<S extends z.ZodType>(def: EventDef<S>, payload: unknown): HubDraft {
  return { stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, event_type: def.eventType, schema_version: def.version, payload: def.payload.parse(payload) as PosEvent['payload'] };
}

/** 03c printers (print_config fold) and P-1 bill routes, by their real events. */
function printers(routes: Array<{ scope: 'zone' | 'floor' | 'device' | 'default'; ref_id: string; printer_id: string }>, o: { archived?: string[] } = {}): void {
  hubAppend([
    ...Object.values(P).map((printer_id, i) =>
      onHub(PrinterSaved, { printer_id, name: `Printer ${printer_id}`, connection: 'lan', address: `192.168.1.${30 + i}:9100`, paper_width_mm: printer_id === P.narrow ? 58 : 80, archived: false }),
    ),
    ...routes.map((r) => onHub(BillRouteSet, r)),
  ]);
  if (o.archived !== undefined) {
    hubAppend(o.archived.map((printer_id) => onHub(PrinterSaved, { printer_id, name: `Printer ${printer_id}`, connection: 'lan', address: '192.168.1.99:9100', paper_width_mm: 80, archived: true })));
  }
}

async function start(o: { billing?: SnapshotBilling } = {}): Promise<void> {
  hub = await startBilling({ open: false });
  const m = menu(o.billing);
  floorId = m.floors[0]!.floor_id;
  openDay(hub, { menu: m, stock: { [FX.stock]: 0, [VX.naanStock]: 0 } });
  cashier = signIn(hub, STAFF.cashier);
  waiter = signIn(hub, STAFF.orderTaker);
}

/** An open seating at `table_id` (held by the order taker) with `n` naans in one order. */
function seatingWith(table_id: string, n = 2, seating_id = `SEAT_${table_id}`): { seating_id: string; table_id: string; order_id: string } {
  openSeating(hub, { table_id, seating_id });
  const lines = Array.from({ length: n }, (_, i) => ({ order_item_id: `${seating_id}_L${i}`, item_id: FX.naan }));
  const { order_id } = appendOrder(hub, { order_type: 'dine_in', seating_id, placed_by: STAFF.orderTaker, lines });
  return { seating_id, table_id, order_id };
}

const print = (payload: Record<string, unknown>, who: Who = cashier, commandId?: string) => post(hub, who, 'print-check-bill', 'PrintCheckBill', payload, commandId);
const requestBill = (s: { seating_id: string; table_id: string }, who: Who = waiter, commandId?: string) =>
  post(hub, who, 'request-bill', 'RequestBill', { table_id: s.table_id, seating_id: s.seating_id }, commandId);

async function billView(qs: Record<string, string>): Promise<BillView> {
  const res = await hub.app.inject({ method: 'GET', url: `/queries/bill?${new URLSearchParams(qs).toString()}`, headers: { authorization: `Bearer ${cashier.token}`, 'x-session-token': cashier.sessionToken } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: BillView }).data;
}

interface JobRow {
  job_id: string;
  kind: string;
  printer_id: string;
  payload: string;
  created_at: number;
}
const db = () => hub.deps.db;
const jobs = (): JobRow[] => db().prepare(`SELECT job_id, kind, printer_id, payload, created_at FROM print_jobs WHERE kind = 'document' ORDER BY created_at, job_id`).all() as JobRow[];
const billJobs = () => db().prepare('SELECT job_id, bill_id, doc_kind, ref_id, created_at FROM bill_print_jobs ORDER BY created_at, job_id').all();
const textOf = (job: JobRow): string => {
  const p = JSON.parse(job.payload) as { doc: Doc; kind_label?: string };
  return renderText(p.doc, p.doc.width_cols ?? 48);
};

// ------------------------------------------------------------------------------------------------ PrintCheckBill

describe('[05 §6.3, #59] PrintCheckBill', () => {
  it('[05 #59] opens the bill, queues the check bill at the zone printer, appends CheckBillPrinted (ids and counts, source manual)', async () => {
    await start();
    printers([
      { scope: 'zone', ref_id: ZONE, printer_id: P.zone },
      { scope: 'floor', ref_id: floorId, printer_id: P.floor },
      { scope: 'default', ref_id: '', printer_id: P.fallback },
    ]);
    const s = seatingWith(VX.tables.T4, 2);
    const r = await print({ bill_ref: { seating_id: s.seating_id } });
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['BillOpened', 'ChargeApplied', 'CheckBillPrinted', 'TableMarksChanged']);
    const bill_id = r.events[0]!.stream_id;
    const [job] = jobs();
    expect(job).toBeDefined();
    expect(job!.printer_id).toBe(P.zone);
    const view = await billView({ bill_id });
    const printed = r.events[2]!;
    expect(printed).toMatchObject({ stream_type: 'bill', stream_id: bill_id, actor_id: STAFF.cashier, device_id: cashier.deviceId });
    expect(printed.payload).toEqual({
      bill_id,
      total_default_minor: view.totals_default.total_minor,
      line_count: 2,
      printer_id: P.zone,
      job_id: job!.job_id,
      source: 'manual',
    });
    expect(r.result).toEqual({ bill_id, printed: true, job_id: job!.job_id, printer_name: `Printer ${P.zone}`, totals_default: view.totals_default });
    expect(billJobs()).toEqual([{ job_id: job!.job_id, bill_id, doc_kind: 'check', ref_id: null, created_at: expect.any(Number) }]);
    // the billing fold took the print time (§6.4a check_printed_at)
    expect(db().prepare('SELECT check_printed_at FROM bills WHERE bill_id = ?').pluck().get(bill_id)).toBe(hub.clock.branchNow());
  });

  it('[05 #59, B17] the check bill Doc: banner, no invoice / fiscal number / QR, the cash total equal to the bill view, the card-rate line', async () => {
    await start();
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const s = seatingWith(VX.tables.T5, 3);
    const r = await print({ bill_ref: { seating_id: s.seating_id } });
    expect(r.status).toBe(200);
    const view = await billView({ seating_id: s.seating_id });
    const job = jobs()[0]!;
    expect((JSON.parse(job.payload) as { kind_label?: string }).kind_label).toBe('Check bill');
    const text = textOf(job);
    expect(text).toContain('PROVISIONAL - NOT A TAX INVOICE');
    expect(text).toContain('Total if paid in cash');
    expect(text).toContain('Total if paid by card');
    expect(text).not.toMatch(/FISCAL/);
    expect(text).not.toMatch(/-S\d{6}/); // no invoice ref
    const doc = (JSON.parse(job.payload) as { doc: Doc }).doc;
    expect(doc.blocks.some((b) => 'qr' in b)).toBe(false);
    expect(doc.width_cols).toBe(48);
    expect((r.events.find((e) => e.event_type === 'CheckBillPrinted')!.payload as { total_default_minor: number }).total_default_minor).toBe(view.totals_default.total_minor);
    expect(view.check_printed_at).toBe(hub.clock.branchNow());
  });

  it('[05 §3.16, P-1] route order: zone → floor → default; a 58 mm printer gets a 32-column Doc', async () => {
    await start();
    printers([
      { scope: 'floor', ref_id: floorId, printer_id: P.narrow },
      { scope: 'default', ref_id: '', printer_id: P.fallback },
    ]);
    const t4 = seatingWith(VX.tables.T4, 1);
    const r1 = await print({ bill_ref: { seating_id: t4.seating_id } });
    expect(r1.result).toMatchObject({ printed: true, printer_name: `Printer ${P.narrow}` });
    expect((JSON.parse(jobs()[0]!.payload) as { doc: Doc }).doc.width_cols).toBe(32);
    const narrow = textOf(jobs()[0]!).split('\n');
    expect(narrow.length).toBeGreaterThan(5);
    for (const line of narrow) expect(line.length, line).toBeLessThanOrEqual(32);
    // a zone route wins over the floor route for T4; T5 (no zone) still takes the floor
    hubAppend([onHub(BillRouteSet, { scope: 'zone', ref_id: ZONE, printer_id: P.zone })]);
    const r2 = await print({ bill_ref: { seating_id: t4.seating_id } });
    expect(r2.result).toMatchObject({ printer_name: `Printer ${P.zone}` });
    const t5 = seatingWith(VX.tables.T5, 1);
    const r3 = await print({ bill_ref: { seating_id: t5.seating_id } });
    expect(r3.result).toMatchObject({ printer_name: `Printer ${P.narrow}` });
    // no zone and no floor route → default
    hubAppend([onHub(BillRouteSet, { scope: 'floor', ref_id: floorId, printer_id: null })]);
    const r4 = await print({ bill_ref: { seating_id: t5.seating_id } });
    expect(r4.result).toMatchObject({ printer_name: `Printer ${P.fallback}` });
    expect(jobs().map((j) => j.printer_id)).toEqual([P.narrow, P.zone, P.narrow, P.fallback]);
  });

  it('[05 §6.3] payload printer_id wins over the routes; an unknown or archived printer → 404 PRINTER_NOT_FOUND, nothing written', async () => {
    await start();
    printers([{ scope: 'zone', ref_id: ZONE, printer_id: P.zone }], { archived: [P.other] });
    const s = seatingWith(VX.tables.T4, 1);
    const seqBefore = db().prepare('SELECT MAX(seq) FROM events').pluck().get();
    for (const printer_id of ['P_NOPE', P.other]) {
      const r = await print({ bill_ref: { seating_id: s.seating_id }, printer_id });
      expect(r.status).toBe(404);
      expect(r.error).toEqual({ code: 'PRINTER_NOT_FOUND', details: { printer_id } });
    }
    expect(db().prepare('SELECT MAX(seq) FROM events').pluck().get()).toBe(seqBefore);
    expect(jobs()).toEqual([]);
    expect(billJobs()).toEqual([]);
    const ok = await print({ bill_ref: { seating_id: s.seating_id }, printer_id: P.fallback });
    expect(ok.result).toMatchObject({ printed: true, printer_name: `Printer ${P.fallback}` });
    expect(jobs().map((j) => j.printer_id)).toEqual([P.fallback]);
  });

  it('[05 §6.3, R8] no printer routed → the event with nulls, result printed: false, no job', async () => {
    await start();
    const s = seatingWith(VX.tables.T4, 1);
    const r = await print({ bill_ref: { seating_id: s.seating_id } });
    expect(r.status).toBe(200);
    const printed = r.events.find((e) => e.event_type === 'CheckBillPrinted')!;
    expect(printed.payload).toMatchObject({ printer_id: null, job_id: null, source: 'manual', line_count: 1 });
    expect(r.result).toMatchObject({ printed: false, job_id: null, printer_name: null });
    expect(jobs()).toEqual([]);
    expect(billJobs()).toEqual([]);
  });

  it('[05 §6.3] a CLOSED bill → 409 BILL_NOT_OPEN', async () => {
    await start();
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const s = seatingWith(VX.tables.T4, 1);
    const opened = await print({ bill_ref: { seating_id: s.seating_id } });
    const bill_id = opened.events[0]!.stream_id;
    db().prepare(`UPDATE bills SET state = 'closed' WHERE bill_id = ?`).run(bill_id); // a closed bill (task 17's close is not built)
    const r = await print({ bill_ref: { bill_id } });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'BILL_NOT_OPEN', details: { bill_id, state: 'closed' } });
  });

  it('[05 §3.16] takeaway: the device route → default; no TableMarksChanged', async () => {
    await start();
    printers([
      { scope: 'device', ref_id: cashier.deviceId, printer_id: P.device },
      { scope: 'zone', ref_id: ZONE, printer_id: P.zone },
      { scope: 'default', ref_id: '', printer_id: P.fallback },
    ]);
    const t = takeawayOrder(hub, { prefix: 'TK' });
    const r = await print({ bill_ref: { order_id: t.order_id } });
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['BillOpened', 'CheckBillPrinted']);
    expect(r.result).toMatchObject({ printed: true, printer_name: `Printer ${P.device}` });
    // another device (no route of its own) → default
    const other = signIn(hub, STAFF.cashier);
    const r2 = await print({ bill_ref: { order_id: t.order_id } }, other);
    expect(r2.result).toMatchObject({ printer_name: `Printer ${P.fallback}` });
  });

  it('[05 §6.3, C8] scope last: an own_tables taker who does not hold the seating → 403 outside_scope, nothing written', async () => {
    await start();
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const dir = await billingDirectory({ directory_version: 2 });
    await seedDirectory(hub, { ...dir, roles: dir.roles.map((role) => (role.role_id !== 'R_WAIT' ? role : { ...role, permissions: role.permissions.map((g) => (g.permission === 'take-order' ? { ...g, scope: 'own_tables' as const } : g)) })) });
    openSeating(hub, { table_id: VX.tables.T4, seating_id: 'SEAT_MGR', holder_staff_id: STAFF.manager });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT_MGR', placed_by: STAFF.manager, lines: [{ order_item_id: 'M_L1', item_id: FX.naan }] });
    const seqBefore = db().prepare('SELECT MAX(seq) FROM events').pluck().get();
    const r = await print({ bill_ref: { seating_id: 'SEAT_MGR' } }, waiter);
    expect(r.status).toBe(403);
    expect(r.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope' } });
    expect(db().prepare('SELECT MAX(seq) FROM events').pluck().get()).toBe(seqBefore);
    expect(jobs()).toEqual([]);
    // the holder may
    const own = seatingWith(VX.tables.T5, 1);
    expect((await print({ bill_ref: { seating_id: own.seating_id } }, waiter)).status).toBe(200);
  });
});

// ------------------------------------------------------------------------------------------------ #6b print half

describe('[05 #6b print half, §6.4a] TableMarksChanged with CheckBillPrinted', () => {
  it('[05 #6b] a dine-in print on an open seating appends exactly one TableMarksChanged { seating_id } on the primary table; the tile mark = the print time', async () => {
    await start();
    const s = seatingWith(VX.tables.T4, 1);
    const r = await print({ bill_ref: { seating_id: s.seating_id } });
    const marks = r.events.filter((e) => e.event_type === 'TableMarksChanged');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ stream_type: 'table', stream_id: s.table_id, payload: { seating_id: s.seating_id } });
    expect(Object.keys(marks[0]!.payload)).toEqual(['seating_id']); // no alert_id key on the direct path (R-43)
    expect(billTileMarks(db(), [s.seating_id]).get(s.seating_id)).toEqual({ reopened: false, check_printed_at: hub.clock.branchNow() });
    // a second print: one more, again exactly one
    const again = await print({ bill_ref: { seating_id: s.seating_id } });
    expect(again.events.map((e) => e.event_type)).toEqual(['CheckBillPrinted', 'TableMarksChanged']);
  });

  it('[05 #6b] an open bill on a CLOSED seating: CheckBillPrinted only, no TableMarksChanged', async () => {
    await start();
    const s = seatingWith(VX.tables.T4, 1);
    const opened = await print({ bill_ref: { seating_id: s.seating_id } });
    const bill_id = opened.events[0]!.stream_id;
    // the seating closes (02a TableCleaned by its real fold) while the bill stays open
    hub.clock.advance(1_000);
    hub.deps.writer.run((tx) =>
      tx.append([{ stream_type: 'table', stream_id: s.table_id, event_type: 'TableCleaned', schema_version: 1, payload: { seating_id: s.seating_id, table_ids: [s.table_id], reason: 'cleaned', by_staff_id: STAFF.manager }, occurred_at: hub.clock.branchNow(), actor_id: STAFF.manager, device_id: 'D_FIXTURE' }]),
    );
    expect(db().prepare('SELECT state FROM seatings WHERE seating_id = ?').pluck().get(s.seating_id)).toBe('CLOSED');
    const r = await print({ bill_ref: { bill_id } });
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['CheckBillPrinted']);
  });
});

// ------------------------------------------------------------------------------------------------ statements

describe('[05 §6.3, #91] PrintCheckBill statements', () => {
  const counted = { statements: -1 };
  function registerCounted(): void {
    commandRegistry(hub.app).register(
      defineCommand({
        ...printCheckBillCommand,
        commandType: 'TestPrintCheckBillCounted',
        handle(ctx, payload, cmd) {
          const counter = statementCounter(hub.deps.db);
          const before = counter.count;
          try {
            return printCheckBillCommand.handle(ctx, payload, cmd);
          } finally {
            counted.statements = counter.count - before;
          }
        },
      }),
    );
  }

  it('[05 #91] ≤ 10, the same at 1 and at 40 lines: existing bill + routed printer = 10; payload printer = 9', async () => {
    await start();
    printers([
      { scope: 'zone', ref_id: ZONE, printer_id: P.zone },
      { scope: 'floor', ref_id: floorId, printer_id: P.floor },
    ]);
    registerCounted();
    const per: number[] = [];
    for (const [table, n] of [[VX.tables.T4, 1], [VX.tables.T5, 40]] as const) {
      const s = seatingWith(table, n);
      await print({ bill_ref: { seating_id: s.seating_id } }); // opens the bill
      const r = await post(hub, cashier, 'test-print-check-bill-counted', 'TestPrintCheckBillCounted', { bill_ref: { seating_id: s.seating_id } });
      expect(r.status).toBe(200);
      per.push(counted.statements);
      const p = await post(hub, cashier, 'test-print-check-bill-counted', 'TestPrintCheckBillCounted', { bill_ref: { seating_id: s.seating_id }, printer_id: P.zone });
      expect(p.status).toBe(200);
      per.push(counted.statements);
    }
    expect(per).toEqual([10, 9, 10, 9]);
  });
});

// ------------------------------------------------------------------------------------------------ BillRequested fold

describe('[05 §6.4, #58] BillRequested → check bill (live only)', () => {
  it('[05 #58] RequestBill prints the projected bill at the zone printer, records bill_print_jobs (bill_id NULL, ref_id = seating), raises no 01d notice', async () => {
    await start();
    printers([
      { scope: 'zone', ref_id: ZONE, printer_id: P.zone },
      { scope: 'floor', ref_id: floorId, printer_id: P.floor },
      { scope: 'default', ref_id: '', printer_id: P.fallback },
    ]);
    const s = seatingWith(VX.tables.T4, 2);
    const alertsBefore = db().prepare('SELECT COUNT(*) FROM alerts').pluck().get();
    const r = await requestBill(s);
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['BillRequested']); // the fold writes no event
    const [job] = jobs();
    expect(job!.printer_id).toBe(P.zone);
    expect(textOf(job!)).toContain('PROVISIONAL - NOT A TAX INVOICE');
    expect(billJobs()).toEqual([{ job_id: job!.job_id, bill_id: null, doc_kind: 'check', ref_id: s.seating_id, created_at: expect.any(Number) }]);
    expect(db().prepare('SELECT COUNT(*) FROM alerts').pluck().get()).toBe(alertsBefore);
    expect(db().prepare('SELECT COUNT(*) FROM bills').pluck().get()).toBe(0); // ensure-bill is not possible in a fold
    // the projected bill's total, as the bill view computes it
    const view = await billView({ seating_id: s.seating_id });
    const cash = view.totals_default.total_minor;
    expect(textOf(job!)).toContain((cash / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    expect(view.prints).toEqual([expect.objectContaining({ job_id: job!.job_id, doc_kind: 'check', state: 'waiting' })]);
  });

  it('[05 #58] zone → floor → default', async () => {
    await start();
    printers([
      { scope: 'floor', ref_id: floorId, printer_id: P.floor },
      { scope: 'default', ref_id: '', printer_id: P.fallback },
    ]);
    await requestBill(seatingWith(VX.tables.T4, 1)); // T4's zone has no route → floor
    hubAppend([onHub(BillRouteSet, { scope: 'zone', ref_id: ZONE, printer_id: P.zone }), onHub(BillRouteSet, { scope: 'floor', ref_id: floorId, printer_id: null })]);
    await requestBill(seatingWith(VX.tables.T6, 1)); // no zone, no floor route → default
    await requestBill(seatingWith(VX.tables.T7, 1, 'SEAT_T7')); // same
    expect(jobs().map((j) => j.printer_id)).toEqual([P.floor, P.fallback, P.fallback]);
  });

  it('[05 §6.4, H6-9, M-3] with a bills row: the bill\'s own service charge (a removed charge is never printed back) and its bill_id', async () => {
    await start();
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const s = seatingWith(VX.tables.T4, 2);
    const opened = await print({ bill_ref: { seating_id: s.seating_id } });
    const bill_id = opened.events[0]!.stream_id;
    db().prepare('UPDATE bills SET sc_removed = 1 WHERE bill_id = ?').run(bill_id); // the projected flag RemoveServiceCharge (task 14) sets, written directly
    await requestBill(s);
    const [, folded] = jobs();
    expect(textOf(folded!)).not.toContain('Service charge');
    expect(textOf(jobs()[0]!)).toContain('Service charge');
    expect(billJobs()).toEqual([expect.objectContaining({ bill_id, ref_id: null }), expect.objectContaining({ job_id: folded!.job_id, bill_id, ref_id: null })]);
    const view = await billView({ bill_id });
    expect(view.service_charge.removed).toBe(true);
  });

  it('[05 #58] a replayed queued RequestBill (same command_id) prints once; a second request on a BILL_REQUESTED seating prints nothing', async () => {
    await start();
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const s = seatingWith(VX.tables.T4, 1);
    const first = await requestBill(s, waiter, 'queued-rb-1');
    const retry = await requestBill(s, waiter, 'queued-rb-1');
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(jobs()).toHaveLength(1);
    const again = await requestBill(s);
    expect(again.result).toEqual({ requested: false });
    expect(jobs()).toHaveLength(1);
  });

  it('[05 §6.4, D1] no print on replay or rebuild: a catch-up from seq 0 queues no job', async () => {
    await start();
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    await requestBill(seatingWith(VX.tables.T4, 1));
    await requestBill(seatingWith(VX.tables.T5, 1));
    expect(jobs()).toHaveLength(2);
    // the jobs pruned (03c retention, 7 days), then the projection rebuilt from seq 0: history is never printed again
    db().prepare('DELETE FROM bill_print_jobs').run();
    db().prepare(`DELETE FROM print_jobs WHERE kind = 'document'`).run();
    const branch = hub.deps.config.provisioned!.branch_id;
    expect(db().prepare(`DELETE FROM projection_checkpoints WHERE projection = 'billing_prints'`).run().changes).toBe(1);
    const { replayed } = hub.deps.projections.catchUp(db(), branch);
    expect(replayed['billing_prints']).toBe(2);
    expect(jobs()).toEqual([]);
    expect(billJobs()).toEqual([]);
  });

  it('[05 §3.16, R8] no printer routed → nothing queued, RequestBill still succeeds', async () => {
    await start();
    const r = await requestBill(seatingWith(VX.tables.T4, 1));
    expect(r.status).toBe(200);
    expect(jobs()).toEqual([]);
    expect(billJobs()).toEqual([]);
  });

  it('[05 §6.4] statements per BillRequested, fixed at 1 and at 40 lines: 9 projected, 10 with a bills row (≤ 10, owner ruling R-54, 05 v1.0.10)', async () => {
    await start();
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const fold = billPrintsProjection(createProjectionRegistry());
    const measure = (seating_id: string): number => {
      const row = db().prepare(`SELECT * FROM events WHERE event_type = 'BillRequested' AND json_extract(payload, '$.seating_id') = ? ORDER BY seq DESC LIMIT 1`).get(seating_id) as Record<string, unknown> & { payload: string };
      const event = parseEvent({ ...row, payload: JSON.parse(row.payload) } as never);
      const counter = statementCounter(db());
      let n = -1;
      db().transaction(() => {
        const before = counter.count;
        fold.apply(db(), { ...event, event_id: `${event.event_id}-again` }, 'live');
        n = counter.count - before;
      })();
      return n;
    };
    const per: number[] = [];
    for (const [table, n] of [[VX.tables.T4, 1], [VX.tables.T5, 40]] as const) {
      const s = seatingWith(table, n);
      await requestBill(s);
      per.push(measure(s.seating_id));
    }
    for (const [table, n] of [[VX.tables.T6, 1], [VX.tables.T7, 40]] as const) {
      const s = seatingWith(table, n);
      await print({ bill_ref: { seating_id: s.seating_id } }); // a bills row
      await requestBill(s);
      per.push(measure(s.seating_id));
    }
    expect(per).toEqual([9, 9, 10, 10]);
  });

  // ---------------------------------------------------------------------------------------- review round 1 (A, B)

  /** Captures `billing.print_skipped` lines (rebinds the fold's log on the hub's own registry). */
  function captureSkips(): BillPrintSkip[] {
    const lines: BillPrintSkip[] = [];
    bindBillPrints(hub.deps.projections, { log: (l) => lines.push(l), config: hub.deps.config });
    return lines;
  }

  it('[05 §6.4, R8] a print that fails partway leaves no print_jobs / bill_print_jobs row (savepoint); the skip line carries ids only; RequestBill returns 200', async () => {
    await start();
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const skips = captureSkips();
    const s = seatingWith(VX.tables.T4, 1);
    // the last write of the print fails (printDocument's print_jobs insert), after the bill_print_jobs claim was written
    db().exec(`CREATE TEMP TRIGGER fail_pj BEFORE INSERT ON print_jobs WHEN NEW.kind = 'document' BEGIN SELECT RAISE(ABORT, 'secret text must not be logged'); END`);
    const r = await requestBill(s);
    db().exec('DROP TRIGGER fail_pj');
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['BillRequested']);
    expect(db().prepare('SELECT bill_requested_at FROM seatings WHERE seating_id = ?').pluck().get(s.seating_id)).not.toBeNull();
    expect(jobs()).toEqual([]);
    expect(billJobs()).toEqual([]);
    const event_id = db().prepare(`SELECT event_id FROM events WHERE event_type = 'BillRequested'`).pluck().get();
    expect(skips).toEqual([{ event_id, event_type: 'BillRequested', seating_id: s.seating_id, reason: 'fold_error' }]);
  });

  it('[05 §6.4] a DomainError inside the fold is logged with its own code', async () => {
    await start();
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const skips = captureSkips();
    const s = seatingWith(VX.tables.T4, 1);
    db().prepare('DELETE FROM billing_day').run(); // no business day the fold can read → BUSINESS_DAY_NOT_OPEN
    expect((await requestBill(s)).status).toBe(200);
    expect(skips.map((l) => l.reason)).toEqual(['BUSINESS_DAY_NOT_OPEN']);
    expect(jobs()).toEqual([]);
  });

  it('[05 §6.4, B-review] the job id is `<event_id>:check`: the same event applied live twice gives one print_jobs and one bill_print_jobs row, and a clean skip', async () => {
    await start();
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const s = seatingWith(VX.tables.T4, 1);
    await requestBill(s);
    const row = db().prepare(`SELECT * FROM events WHERE event_type = 'BillRequested'`).get() as Record<string, unknown> & { payload: string; event_id: string };
    expect(jobs().map((j) => j.job_id)).toEqual([`${row.event_id}:check`]);
    const event = parseEvent({ ...row, payload: JSON.parse(row.payload) } as never);
    const registry = createProjectionRegistry();
    const fold = billPrintsProjection(registry);
    const skips: BillPrintSkip[] = [];
    bindBillPrints(registry, { log: (l) => skips.push(l), config: hub.deps.config });
    db().transaction(() => fold.apply(db(), event, 'live'))();
    expect(jobs()).toHaveLength(1);
    expect(billJobs()).toHaveLength(1);
    expect(skips).toEqual([]);
  });

  it('[05 §6.3, §9] an absorbed bill → 409 BILL_NOT_OPEN { bill_id, state: absorbed }; nothing written', async () => {
    await start();
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const into = seatingWith(VX.tables.T4, 1);
    const from = seatingWith(VX.tables.T5, 1);
    await print({ bill_ref: { seating_id: into.seating_id } });
    const absorbed = (await print({ bill_ref: { seating_id: from.seating_id } })).events[0]!.stream_id;
    hub.clock.advance(1_000);
    hub.deps.writer.run((tx) =>
      tx.append([
        {
          stream_type: 'table',
          stream_id: into.table_id,
          event_type: 'TablesMerged',
          schema_version: 1,
          payload: { into_seating_id: into.seating_id, into_table_id: into.table_id, table_ids: [from.table_id], absorbed_seating_id: from.seating_id, order_ids: [from.order_id], by_staff_id: STAFF.manager },
          occurred_at: hub.clock.branchNow(),
          actor_id: STAFF.manager,
          device_id: 'D_FIXTURE',
        },
      ]),
    );
    expect(db().prepare('SELECT absorbed_into FROM bills WHERE bill_id = ?').pluck().get(absorbed)).not.toBeNull();
    const seqBefore = db().prepare('SELECT MAX(seq) FROM events').pluck().get();
    const jobsBefore = jobs().length;
    const r = await print({ bill_ref: { bill_id: absorbed } });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'BILL_NOT_OPEN', details: { bill_id: absorbed, state: 'absorbed' } });
    expect(db().prepare('SELECT MAX(seq) FROM events').pluck().get()).toBe(seqBefore);
    expect(jobs()).toHaveLength(jobsBefore);
  });

  it('[05 §6.3, H-1] a PrintCheckBill retransmit with the same command_id prints once and appends once', async () => {
    await start();
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const s = seatingWith(VX.tables.T4, 1);
    const first = await print({ bill_ref: { seating_id: s.seating_id } }, cashier, 'pcb-once');
    const again = await print({ bill_ref: { seating_id: s.seating_id } }, cashier, 'pcb-once');
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.result).toEqual(first.result);
    expect(jobs()).toHaveLength(1);
    expect(db().prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'CheckBillPrinted'`).pluck().get()).toBe(1);
  });

  it('[05 #1, §6.3] the check-bill total equals the bill view with a discount, a service charge, a split and a payment', async () => {
    await start();
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const s = seatingWith(VX.tables.T4, 3);
    const bill_id = (await print({ bill_ref: { seating_id: s.seating_id } })).events[0]!.stream_id;
    const env = () => ({ stream_type: 'bill' as const, stream_id: bill_id, occurred_at: hub.clock.branchNow(), actor_id: STAFF.cashier, device_id: 'D_FIXTURE' });
    const appendBill = (def: EventDef<z.ZodType>, payload: unknown) => {
      hub.clock.advance(1_000);
      hub.deps.writer.run((tx) => tx.append([{ ...env(), event_type: def.eventType, schema_version: def.version, payload: def.payload.parse(payload) as PosEvent['payload'] }]));
    };
    appendBill(DiscountApplied as unknown as EventDef<z.ZodType>, { ...(aDiscountApplied().payload as object), bill_id, kind: 'amount', value: 777, amount_minor: 777 });
    appendBill(BillSplitsSet as unknown as EventDef<z.ZodType>, { ...(aBillSplitsSet().payload as object), bill_id, mode: 'amount', splits: [{ split_no: 1, lines: null, share_minor: 1_000 }, { split_no: 2, lines: null, share_minor: 1 }] });
    appendBill(PaymentAdded as unknown as EventDef<z.ZodType>, {
      ...(aPaymentAdded().payload as object),
      payment_id: 'PAY_1', bill_id, split_no: 1, mode_id: 'cash', payment_class: 'cash', direction: 'in', amount_minor: 600, tendered_minor: 600, change_minor: 0, has_reference: false, taken_by_staff_id: STAFF.cashier, shift_id: 'SHIFT_1',
    });
    const view = await billView({ bill_id });
    expect(view.splits).toHaveLength(2);
    expect(view.discount).not.toBeNull();
    expect(view.totals_default.service_charge_minor).toBeGreaterThan(0);
    const r = await print({ bill_ref: { bill_id } });
    expect(r.status).toBe(200);
    expect((r.result as { totals_default: unknown }).totals_default).toEqual(view.totals_default);
    expect((r.events.find((e) => e.event_type === 'CheckBillPrinted')!.payload as { total_default_minor: number }).total_default_minor).toBe(view.totals_default.total_minor);
  });

  it('[05 G-24] inclusive prices: the charge\'s own tax row above the total (with its label), the rest as a memo; total = the bill view', async () => {
    await start({ billing: billingDoc({ prices_include_tax: true }) });
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const s = seatingWith(VX.tables.T4, 2);
    const r = await print({ bill_ref: { seating_id: s.seating_id } });
    expect(r.status).toBe(200);
    const view = await billView({ seating_id: s.seating_id });
    expect(view.prices_include_tax).toBe(true);
    const t = view.totals_default;
    const lines = textOf(jobs()[0]!).split('\n');
    const scTax = lines.find((l) => l.startsWith('Sales tax 16% cash on service charge'));
    expect(scTax).toBeDefined();
    const amount = (l: string) => Math.round(Number(l.trim().split(/\s+/).pop()!.replace(/,/g, '')) * 100);
    // the charge's own tax: half-up of the charge at 16 % (the charge is never tax-inclusive, §3.5 (4))
    expect(amount(scTax!)).toBe(Math.floor((t.service_charge_minor * 1_600 + 5_000) / 10_000));
    expect(lines).toContain('Tax included in prices');
    expect((r.events.find((e) => e.event_type === 'CheckBillPrinted')!.payload as { total_default_minor: number }).total_default_minor).toBe(t.total_minor);
  });
});
