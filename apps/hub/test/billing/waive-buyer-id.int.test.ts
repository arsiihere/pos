// 05 §6.11 `WaiveBuyerId` (approvable), §3.14 kind `close_without_buyer_id` (its re-check on approve only, H6-2 /
// H7-5), B19, H-4, P-5 and the buyer redaction across every store task 18 can reach — task 18; 05-plan §3 row 18.
// Tests #42, #42b and #43 (once with a CNIC, once with an NTN). Real events through the hub's writer, the real
// `billing` / `shifts` / `orders` / `tables` folds, every command over HTTP as the client posts it (OpenShift,
// SetSplits, AddPayment, CloseSplit, PrintCheckBill, PrintBillDocument, AnswerRequest), the 03c print worker filling
// the buyer block at send. The permanent afterEach scan holds every buyer ID, buyer name, note, PIN and token a test
// sends to the one table allowed to keep it (`invoice_buyers` for the buyer, `bill_texts` for a note, none for a PIN
// or a token) — over `hub.logs()`, the print worker's log and every `sqlite_master` table. Every PKR amount below is
// pinned: the menu is Rs 20,000 naans (A) and Rs 10,000 raitas (B), food taxed 16 % exclusive, Rs 1 rounding.
import { rateBpRates, SnapshotBillingSchema, type BranchConfig, type EventDef, type EventDraft, type PosEvent, type SnapshotBilling } from '@pos/events';
import { aBillReopened } from '@pos/events/testing';
import { BillClosedEmpty, BillReopened, draftOf } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { kindOf, type AlertApplyCtx } from '../../src/alerts/kinds';
import { alerts } from '../../src/alerts/raise';
import { currentDirectory } from '../../src/auth/guards';
import { hubBilling } from '../../src/billing/defaults';
import { noneAdapter } from '../../src/billing/fiscal/none';
import { registerFiscalAdapter, resetFiscalAdapters } from '../../src/billing/fiscal/port';
import { billingProjection } from '../../src/billing/projections/billing';
import type { BillView } from '../../src/billing/queries/bill';
import type { CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { readOnlyTx } from '../../src/engine-host/read-only-tx';
import { payloadHash } from '../../src/lib/hash';
import { createPrintWorker, type PrinterTransport } from '../../src/print/worker';
import type { SendResult } from '../../src/print/transport/lan';
import { createProjectionRegistry } from '../../src/projections/registry';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { PIN } from '../helpers/fixtures';
import { seedDirectory, type TestHub } from '../helpers/test-hub';
import { fakeClock } from '../print/fixtures';
import { openDay, voidsMenu } from '../voids/fixtures';
import { answer, appendOrder, billingDirectory, drawerDevice, FX, openSeating, post, signIn, signInOn, STAFF, startBilling, VX, type Reply, type Who } from './fixtures';

let hub: TestHub;
let manager: Who;
let cashier: Who;
let waiter: Who;
let counter: ReturnType<typeof statementCounter>;

const FOOD = 'tc-food';
/** Rs 20,000 and Rs 10,000 (PKR, exponent 2) */
const A_PRICE = 2_000_000;
const B_PRICE = 1_000_000;
/** PK-PB's threshold: Rs 50,000 (B19) */
const THRESHOLD = 5_000_000;
const PRINTER = 'PR_COUNTER';

/** PK-PB's buyer types (cloud 0014 seed). */
const BUYER_TYPES = [
  { type: 'CNIC', label: 'CNIC', pattern: '^[0-9]{13}$', strip: '-' },
  { type: 'NTN', label: 'NTN', pattern: '^[A-Za-z0-9]{7,9}$', strip: '' },
];

// ------------------------------------------------------------------------------------------------ the privacy scan

/** A value a test sent and the only table allowed to keep it (null = none: never stored anywhere). */
const SECRETS = new Map<string, string | null>();
const buyerSecret = (s: string): string => (SECRETS.set(s, 'invoice_buyers'), s);
const noteSecret = (s: string): string => (SECRETS.set(s, 'bill_texts'), s);
/** the print worker's log lines (03c: `job_id` only on an error) */
const workerLog: string[] = [];

/** B19, H-4, §7 Privacy: `s` in the hub log, the worker log or any table but `allowed`. */
function leaksOf(s: string, allowed: string | null): string[] {
  const places: string[] = [];
  if (hub.logs().includes(s)) places.push('hub.logs()');
  if (workerLog.join('\n').includes(s)) places.push('worker log');
  const tables = hub.deps.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).pluck().all() as string[];
  for (const t of tables) {
    if (t === allowed) continue;
    const dump = JSON.stringify(hub.deps.db.prepare(`SELECT * FROM "${t}"`).all(), (_k, v: unknown) => (Buffer.isBuffer(v) ? v.toString('latin1') : v));
    if (dump.includes(s)) places.push(`table ${t}`);
  }
  return places;
}

/** PINs and session tokens: never in a log line (a request body or header logged would carry them). */
function secretsInLogs(): string[] {
  const logs = hub.logs() + '\n' + workerLog.join('\n');
  const found: string[] = [];
  for (const pin of Object.values(PIN)) if (logs.includes(`"pin":"${pin}"`)) found.push(`pin ${pin}`);
  for (const who of [manager, cashier, waiter]) {
    if (who === undefined) continue;
    if (logs.includes(who.token)) found.push(`device token of ${who.staffId}`);
    if (logs.includes(who.sessionToken)) found.push(`session token of ${who.staffId}`);
  }
  return found;
}

beforeEach(() => {
  registerFiscalAdapter(noneAdapter);
});

afterEach(async () => {
  // the permanent scan, after every test (B19, H-4, H3-5, §7)
  const found =
    hub === undefined ? [] : [...[...SECRETS].flatMap(([s, allowed]) => leaksOf(s, allowed).map((place) => `${s} in ${place}`)), ...secretsInLogs()];
  SECRETS.clear();
  workerLog.length = 0;
  swapBranchConfig(null);
  resetFiscalAdapters();
  await hub?.close();
  hub = undefined as unknown as TestHub;
  expect(found).toEqual([]);
});

// ------------------------------------------------------------------------------------------------ set-up

/** The PK built-in document (Rs 1 nearest, all), food 1 600 bp exclusive, no service charge, the buyer rule of PK-PB. */
function billingDoc(o: { threshold?: number | null } = {}): SnapshotBilling {
  const pk = hubBilling({ currency_code: 'PKR', tax_classes: [], billing: undefined });
  return SnapshotBillingSchema.parse({
    ...pk.settings,
    service_charge_bp: { ...pk.settings.service_charge_bp, dine_in: 0 },
    jurisdiction: {
      ...pk.jurisdiction,
      rules: pk.jurisdiction.rules.map((r) => ({
        ...r,
        rounding_step_minor: 100,
        rounding_mode: 'nearest' as const,
        rounding_applies_to: 'all' as const,
        buyer_id: { threshold_minor: o.threshold === undefined ? THRESHOLD : o.threshold, accepted_types: BUYER_TYPES },
        receipt: { ...r.receipt, buyer_id_on_receipt: true },
      })),
    },
    tax_profiles: [{ tax_class_id: FOOD, taxes: [{ seq: 1, tax_code: 'TAX', label: 'Sales tax', compound: false, rates: rateBpRates(1_600) }] }],
  });
}

/** voidsMenu() with the naan at Rs 20,000 and the raita at Rs 10,000, both taxed food. */
function menu(billing: SnapshotBilling): BranchConfig {
  const m = voidsMenu();
  return {
    ...m,
    tax_enabled: true,
    tax_classes: [{ tax_class_id: FOOD, name: 'Sales tax', rate_bp: 1_600, is_archived: false, fiscal_category: 'restaurant_service' }],
    items: m.items.map((i) =>
      i.item_id === FX.naan ? { ...i, price_minor: A_PRICE, tax_class_id: FOOD } : i.item_id === FX.optionItem ? { ...i, price_minor: B_PRICE, tax_class_id: FOOD } : i,
    ),
    billing,
  };
}

/** Each named command's handler statements of its last call (discount.int.test.ts pattern; the envelope excluded). */
const handled: Record<string, number | undefined> = {};

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

async function start(o: { threshold?: number | null } = {}): Promise<void> {
  hub = await startBilling({ open: false });
  openDay(hub, { menu: menu(billingDoc(o)), stock: { [FX.stock]: 0, [VX.naanStock]: 0 } });
  // the counter kiosk: the cashier's drawer shift and the receipt route
  const kiosk = drawerDevice(hub, 'Counter kiosk');
  cashier = signInOn(hub, STAFF.cashier, kiosk);
  manager = signIn(hub, STAFF.manager);
  waiter = signIn(hub, STAFF.orderTaker);
  const shift = await post(hub, cashier, 'open-shift', 'OpenShift', { float_minor: 0, as_drawer: true });
  expect(shift.status, JSON.stringify(shift.error)).toBe(200);
  hubEvents([
    { stream_type: 'hub', stream_id: branch(), event_type: 'PrinterSaved', payload: { printer_id: PRINTER, name: 'Counter', connection: 'lan', address: '192.168.1.20:9100', paper_width_mm: 80, archived: false } },
    { stream_type: 'hub', stream_id: branch(), event_type: 'BillRouteSet', payload: { scope: 'device', ref_id: kiosk.deviceId, printer_id: PRINTER } },
  ]);
  counter = statementCounter(hub.deps.db);
  for (const k of Object.keys(handled)) delete handled[k];
  countHandler('waive-buyer-id');
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

function appendBill(bill_id: string, def: EventDef<z.ZodType>, payload: unknown): void {
  hub.clock.advance(1_000);
  const draft = draftOf(def, { stream_type: 'bill', stream_id: bill_id, payload: def.payload.parse(payload), occurred_at: hub.clock.branchNow(), actor_id: STAFF.manager, device_id: 'D_FIXTURE' });
  hub.deps.writer.run((tx) => tx.append([draft]));
}

const waive = (who: Who, payload: Record<string, unknown>, commandId?: string): Promise<Reply> => post(hub, who, 'waive-buyer-id', 'WaiveBuyerId', payload, commandId);
const close = (payload: Record<string, unknown>, commandId?: string): Promise<Reply> => post(hub, cashier, 'close-split', 'CloseSplit', payload, commandId);

async function pay(bill_ref: Record<string, string>, split_no: number, amount_minor: number): Promise<void> {
  const r = await post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref, split_no, mode_id: 'cash', direction: 'in', amount_minor });
  expect(r.status, JSON.stringify(r.error)).toBe(200);
}

async function viewRaw(who: Who, qs: Record<string, string>): Promise<string> {
  const res = await hub.app.inject({ method: 'GET', url: `/queries/bill?${new URLSearchParams(qs).toString()}`, headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
  expect(res.statusCode, res.body).toBe(200);
  return res.body;
}
const view = async (qs: Record<string, string>, who: Who = cashier): Promise<BillView> => (JSON.parse(await viewRaw(who, qs)) as { data: BillView }).data;

function eventsOf(type: string): PosEvent[] {
  return (db().prepare('SELECT * FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<Record<string, unknown>>).map(
    (row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent,
  );
}
const waivedOf = (bill_id: string) => db().prepare('SELECT buyer_waived FROM bills WHERE bill_id = ?').pluck().get(bill_id);
const textOf = (subject_id: string) => db().prepare(`SELECT text FROM bill_texts WHERE subject_id = ? AND field = 'note'`).pluck().get(subject_id);
const billIdOf = (seating_id: string) => db().prepare('SELECT bill_id FROM bills WHERE seating_id = ?').pluck().get(seating_id) as string;
const pendingOf = (r: Reply): string => (r.result!.pending as { alert_id: string }).alert_id;

let seatNo = 0;
/** A seating at `table_id` (default T4) with one dine-in round: `a` naans (A) and `b` raitas (B), one line each unit. */
function seated(a: number, b: number, table_id: string = VX.tables.T4): { seating_id: string; order_id: string; lines: string[] } {
  seatNo += 1;
  const seating_id = `SEAT_W${seatNo}`;
  openSeating(hub, { table_id, seating_id });
  const lines = [...Array.from({ length: a }, (_, i) => ({ order_item_id: `W${seatNo}_A${i}`, item_id: FX.naan })), ...Array.from({ length: b }, (_, i) => ({ order_item_id: `W${seatNo}_B${i}`, item_id: FX.optionItem }))];
  const { order_id } = appendOrder(hub, { order_type: 'dine_in', seating_id, placed_by: STAFF.orderTaker, lines });
  return { seating_id, order_id, lines: lines.map((l) => l.order_item_id) };
}

/** A bill row for the seating (ensure bill through SetSplits; mode items when `plan` is given, else none). */
async function itemSplits(seating_id: string, plan: string[][]): Promise<string> {
  const r = await post(hub, cashier, 'set-splits', 'SetSplits', {
    bill_ref: { seating_id },
    mode: 'items',
    splits: plan.map((ids, i) => ({ split_no: i + 1, lines: ids.map((order_item_id) => ({ order_item_id, units: 1 })) })),
  });
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  return billIdOf(seating_id);
}

/** A one-split bill row: `a` naans and `b` raitas at T4 (the manager's direct waive would open none: bill_id only). */
async function billOf(a: number, b: number, table_id: string = VX.tables.T4): Promise<{ seating_id: string; bill_id: string; lines: string[] }> {
  const s = seated(a, b, table_id);
  const r = await post(hub, cashier, 'set-splits', 'SetSplits', { bill_ref: { seating_id: s.seating_id }, mode: 'none' });
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  return { ...s, bill_id: billIdOf(s.seating_id) };
}

/** The print worker over every pending job; returns what each send carried (latin1). */
async function sendAll(n: number): Promise<string[]> {
  const sends: string[] = [];
  const transport: PrinterTransport = {
    send(bytes: Uint8Array): Promise<SendResult> {
      sends.push(Buffer.from(bytes).toString('latin1'));
      return Promise.resolve({ ok: true });
    },
    close: () => undefined,
  };
  const log = {
    info: (obj: Record<string, unknown>, msg?: string) => void workerLog.push(JSON.stringify({ obj, msg })),
    error: (obj: Record<string, unknown>, msg?: string) => void workerLog.push(JSON.stringify({ obj, msg })),
  };
  const w = createPrintWorker({ db: db(), state: hub.deps.state, clock: hub.clock, timers: fakeClock(), transportFor: () => transport, log });
  try {
    for (let i = 0; i < 50 && sends.length < n; i += 1) {
      w.pass();
      await new Promise((resolve) => setImmediate(resolve));
    }
  } finally {
    w.stop();
  }
  expect(sends).toHaveLength(n);
  return sends;
}

const jobPayload = (job_id: string): string => db().prepare('SELECT payload FROM print_jobs WHERE job_id = ?').pluck().get(job_id) as string;

// ================================================================================================= direct (allowed)

describe('[05 §6.11, B19, #42] WaiveBuyerId — direct (grant allowed: the Manager)', () => {
  it('[05 §6.11] a Rs 60,000 bill (net above Rs 50,000): BuyerIdWaived { bill_id, has_note, note_id, requester, approver null, alert_id null }; the bill is waived', async () => {
    await start();
    const { bill_id, seating_id } = await billOf(3, 0);
    expect((await view({ seating_id })).buyer).toEqual({ required: true, threshold_minor: THRESHOLD, waived: false });
    const r = await waive(manager, { bill_id });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toEqual({ bill_id, changed: true });
    expect(r.events.map((e) => [e.event_type, e.stream_type, e.stream_id, e.actor_id])).toEqual([['BuyerIdWaived', 'bill', bill_id, STAFF.manager]]);
    expect(r.events[0]!.payload).toEqual({ bill_id, has_note: false, note_id: null, requester_staff_id: STAFF.manager, approver_staff_id: null, alert_id: null });
    expect(waivedOf(bill_id)).toBe(1);
    const v = await view({ seating_id });
    expect(v.buyer).toEqual({ required: true, threshold_minor: THRESHOLD, waived: true });
    expect(v.blocks.map((b) => b.reason)).not.toContain('buyer_id_required');
  });

  it('[05 §6.11, H3-5] a note goes to bill_texts under a minted note_id; the event carries has_note / note_id only', async () => {
    await start();
    const { bill_id } = await billOf(3, 0);
    const note = noteSecret('Walk-in, no CNIC on him 7c1e');
    const r = await waive(manager, { bill_id, note });
    expect(r.status).toBe(200);
    const p = r.events[0]!.payload as { note_id: string; has_note: boolean };
    expect(p).toMatchObject({ has_note: true, note_id: expect.any(String) });
    expect(textOf(p.note_id)).toBe(note);
  });

  it('[05 §6.11] already waived → 200 { changed: false }, no event, no second note', async () => {
    await start();
    const { bill_id } = await billOf(3, 0);
    expect((await waive(manager, { bill_id })).status).toBe(200);
    const again = await waive(manager, { bill_id, note: noteSecret('second time 51aa') });
    expect(again.status).toBe(200);
    expect(again.result).toEqual({ bill_id, changed: false });
    expect(again.events).toEqual([]);
    expect(eventsOf('BuyerIdWaived')).toHaveLength(1);
    expect(db().prepare('SELECT COUNT(*) FROM bill_texts').pluck().get()).toBe(0);
  });

  it('[05 §6.11, B19] net not above the threshold (exactly Rs 50,000) → 200 { changed: false, reason: not_required }; no event', async () => {
    await start();
    // 2 naans + 1 raita = Rs 50,000: "above" is strict (B19, §3.3 rule 6)
    const { bill_id } = await billOf(2, 1);
    const r = await waive(manager, { bill_id });
    expect(r.status).toBe(200);
    expect(r.result).toEqual({ bill_id, changed: false, reason: 'not_required' });
    expect(r.events).toEqual([]);
    expect(waivedOf(bill_id)).toBe(0);
  });

  it('[05 #42, B19] jurisdiction with no threshold (null) never asks: a Rs 60,000 bill → not_required', async () => {
    await start({ threshold: null });
    const { bill_id, seating_id } = await billOf(3, 0);
    expect((await view({ seating_id })).buyer.required).toBe(false);
    const r = await waive(manager, { bill_id });
    expect(r.result).toEqual({ bill_id, changed: false, reason: 'not_required' });
  });

  it('[05 §6.11, B19] net is pre-tax after the discount: Rs 60,000 with a Rs 10,000 + 1 discount → Rs 49,999.99, not required', async () => {
    await start();
    const { bill_id, seating_id } = await billOf(3, 0);
    const d = await post(hub, manager, 'apply-discount', 'ApplyDiscount', { bill_ref: { bill_id }, kind: 'amount', value: 1_000_001, reason_code: 'regular_customer' });
    expect(d.status, JSON.stringify(d.error)).toBe(200);
    expect((await view({ seating_id })).buyer.required).toBe(false);
    expect((await waive(manager, { bill_id })).result).toEqual({ bill_id, changed: false, reason: 'not_required' });
  });

  it('[05 §6.11, §9] a closed bill → 409 BILL_NOT_OPEN { bill_id, state }; an unknown bill → 404 BILL_NOT_FOUND', async () => {
    await start();
    const { bill_id } = await billOf(3, 0);
    appendBill(bill_id, BillClosedEmpty as unknown as EventDef<z.ZodType>, { bill_id, seating_id: null, credit_invoice_ids: [] });
    const r = await waive(manager, { bill_id });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'BILL_NOT_OPEN', details: { bill_id, state: 'closed' } });
    const missing = await waive(manager, { bill_id: 'B_NOPE' });
    expect(missing.status).toBe(404);
    expect(missing.error).toEqual({ code: 'BILL_NOT_FOUND', details: { bill_id: 'B_NOPE' } });
    expect(eventsOf('BuyerIdWaived')).toEqual([]);
  });

  it('[05 §6.11] Zod .strict(): an unknown key, a bill_ref instead of bill_id, an empty id, a note over 200 → 400; nothing written', async () => {
    await start();
    const { bill_id, seating_id } = await billOf(3, 0);
    for (const payload of [{ bill_id, extra: 1 }, { bill_ref: { seating_id } }, { bill_id: '' }, { bill_id, note: 'x'.repeat(201) }]) {
      const r = await waive(manager, payload);
      expect(r.status, JSON.stringify(payload).slice(0, 60)).toBe(400);
      expect(r.error?.code).toBe('VALIDATION_FAILED');
    }
    expect(handled['waive-buyer-id']).toBeUndefined(); // the handler never ran
    expect(eventsOf('BuyerIdWaived')).toEqual([]);
  });

  it('[05 §6.11, C8] grant first: the Order taker (no close-without-buyer-id) → 403 before the handler reads anything', async () => {
    await start();
    const { bill_id } = await billOf(3, 0);
    const r = await waive(waiter, { bill_id });
    expect(r.status).toBe(403);
    expect(r.error?.code).toBe('PERMISSION_DENIED');
    expect(handled['waive-buyer-id']).toBeUndefined();
    expect((await waive(waiter, { bill_id: 'B_NOPE' })).status).toBe(403); // before the bill read
  });

  it('[05 §6.11, C8] scope last: a test-only my_floors grant (01b offers branch only) → 403 outside_scope; BILL_NOT_OPEN still comes first', async () => {
    await start();
    const { bill_id } = await billOf(3, 0);
    const { bill_id: closedId } = await billOf(3, 0, VX.tables.T5);
    appendBill(closedId, BillClosedEmpty as unknown as EventDef<z.ZodType>, { bill_id: closedId, seating_id: null, credit_invoice_ids: [] });
    const dir = await billingDirectory({ directory_version: 2 });
    await seedDirectory(hub, {
      ...dir,
      roles: dir.roles.map((role) => (role.role_id !== 'R_MGR' ? role : { ...role, permissions: role.permissions.map((g) => (g.permission === 'close-without-buyer-id' ? { ...g, scope: 'my_floors' } : g)) })),
    });
    const r = await waive(manager, { bill_id });
    expect(r.status).toBe(403);
    expect(r.error?.details).toMatchObject({ reason: 'outside_scope' });
    expect((await waive(manager, { bill_id: closedId })).error?.code).toBe('BILL_NOT_OPEN');
    expect(eventsOf('BuyerIdWaived')).toEqual([]);
  });

  it('[05 §6.11, D32, H-4] a retransmit with the same command_id replays the stored reply, also when only the note changed (note not hashed)', async () => {
    await start();
    const { bill_id } = await billOf(3, 0);
    const first = await waive(manager, { bill_id, note: noteSecret('first note 3b9d') }, 'waive-replay');
    expect(first.result).toEqual({ bill_id, changed: true });
    const again = await waive(manager, { bill_id, note: noteSecret('resent note e40f') }, 'waive-replay');
    expect(again.status).toBe(200);
    expect(again.result).toEqual(first.result);
    expect(eventsOf('BuyerIdWaived')).toHaveLength(1);
    const stored = db().prepare(`SELECT payload_hash FROM processed_commands WHERE command_id = 'waive-replay'`).pluck().get();
    expect(stored).toBe(payloadHash({ bill_id }));
  });
});

// ================================================================================================= approval path

describe('[05 §3.14, §6.11] WaiveBuyerId — approval path (the Cashier: requires_approval)', () => {
  function raisedOf(alert_id: string) {
    return eventsOf('AlertRaised').find((e) => (e.payload as { alert_id: string }).alert_id === alert_id)!.payload as Record<string, unknown> & {
      values: Record<string, unknown> & { note_id: string | null };
    };
  }

  it('[05 §3.14] the Cashier asks: one close_without_buyer_id request (values ids only, details { amount: net, identifier }, dedupe buyer_waiver:<bill>); no BuyerIdWaived', async () => {
    await start();
    const { bill_id, seating_id } = await billOf(3, 0);
    const note = noteSecret('Regular, ID at home 22f0');
    const r = await waive(cashier, { bill_id, note });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const alert_id = pendingOf(r);
    expect(r.result).toEqual({ bill_id, pending: { alert_id } });
    expect(r.events.map((e) => e.event_type)).not.toContain('BuyerIdWaived');
    const p = raisedOf(alert_id);
    expect(p).toMatchObject({ kind: 'close_without_buyer_id', subject_stream_type: 'bill', subject_stream_id: bill_id, dedupe_key: `buyer_waiver:${bill_id}`, requester_staff_id: STAFF.cashier });
    expect(p.values).toEqual({ bill_id, note_id: p.values.note_id, has_note: true });
    expect(p.details).toEqual({ amount: 6_000_000, identifier: 'T4' });
    expect(p.display).toMatchObject({ kind_label_key: 'alert.close_without_buyer_id.lock', table_code: 'T4' });
    expect(textOf(p.values.note_id as string)).toBe(note);
    expect(waivedOf(bill_id)).toBe(0);
    expect((await view({ seating_id })).open_requests).toEqual([{ kind: 'close_without_buyer_id', alert_id }]);
  });

  it('[05 §3.14, R-59 pattern] a second ask while the request is open → 200 with the same request; no second request, no second note', async () => {
    await start();
    const { bill_id } = await billOf(3, 0);
    const first = await waive(cashier, { bill_id });
    const second = await waive(cashier, { bill_id, note: noteSecret('again please 8d21') });
    expect(second.status).toBe(200);
    expect(second.result).toEqual({ bill_id, pending: { alert_id: pendingOf(first) } });
    expect(eventsOf('AlertRaised').filter((e) => (e.payload as { kind: string }).kind === 'close_without_buyer_id')).toHaveLength(1);
    expect(db().prepare('SELECT COUNT(*) FROM bill_texts').pluck().get()).toBe(0);
  });

  it('[05 §3.14] approve by the Manager\'s PIN on his own seat (05a D-2: was in person on the Cashier\'s kiosk): BuyerIdWaived { requester Cashier, approver = answerer, alert_id, note_id }', async () => {
    await start();
    const { bill_id, seating_id } = await billOf(3, 0);
    const asked = await waive(cashier, { bill_id, note: noteSecret('approved in person 0e77') });
    const alert_id = pendingOf(asked);
    const note_id = raisedOf(alert_id).values.note_id;
    const a = await post(hub, manager, 'answer-request', 'AnswerRequest', { alert_id, decision: 'approve', method: 'pin', pin: PIN.b });
    expect(a.status, JSON.stringify(a.error)).toBe(200);
    const waived = a.events.filter((e) => e.event_type === 'BuyerIdWaived');
    expect(waived).toHaveLength(1);
    expect(waived[0]).toMatchObject({ stream_type: 'bill', stream_id: bill_id, actor_id: STAFF.manager });
    expect(waived[0]!.payload).toEqual({ bill_id, has_note: true, note_id, requester_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager, alert_id });
    expect(waivedOf(bill_id)).toBe(1);
    const v = await view({ seating_id });
    expect(v.buyer.waived).toBe(true);
    expect(v.open_requests).toEqual([]);
  });

  it('[05 §3.14, H6-2] re-check on approve: the bill closed meanwhile → the answer is refused 409 BILL_NOT_OPEN; nothing written; reject still closes it', async () => {
    await start();
    const { bill_id } = await billOf(3, 0);
    const alert_id = pendingOf(await waive(cashier, { bill_id }));
    appendBill(bill_id, BillClosedEmpty as unknown as EventDef<z.ZodType>, { bill_id, seating_id: null, credit_invoice_ids: [] });
    const a = await answer(hub, manager, alert_id, 'approve');
    expect(a.status).toBe(409);
    expect(a.error).toEqual({ code: 'BILL_NOT_OPEN', details: { bill_id, state: 'closed' } });
    expect(eventsOf('BuyerIdWaived')).toEqual([]);
    expect(alerts.listOpen(db(), { kind: 'close_without_buyer_id' }).map((x) => x.alert_id)).toEqual([alert_id]);
    expect((await answer(hub, manager, alert_id, 'reject')).status).toBe(200);
    expect(alerts.listOpen(db(), { kind: 'close_without_buyer_id' })).toEqual([]);
  });

  it('[05 §3.14, reading 5] a direct waive while a request is open, then the approve: apply re-checks the state only, so two BuyerIdWaived; buyer_waived = 1', async () => {
    await start();
    const { bill_id } = await billOf(3, 0);
    const alert_id = pendingOf(await waive(cashier, { bill_id }));
    expect((await waive(manager, { bill_id })).result).toEqual({ bill_id, changed: true });
    const a = await answer(hub, manager, alert_id, 'approve');
    expect(a.status, JSON.stringify(a.error)).toBe(200);
    const waived = eventsOf('BuyerIdWaived');
    expect(waived).toHaveLength(2);
    expect(waived.map((e) => (e.payload as { alert_id: string | null }).alert_id)).toEqual([null, alert_id]);
    expect(waivedOf(bill_id)).toBe(1);
  });

  it('[05 §3.14] reject → no event, the request closes; withdraw (the Cashier) → nothing', async () => {
    await start();
    const { bill_id } = await billOf(3, 0);
    const a1 = pendingOf(await waive(cashier, { bill_id }));
    expect((await answer(hub, manager, a1, 'reject')).status).toBe(200);
    const a2 = pendingOf(await waive(cashier, { bill_id }));
    expect(a2).not.toBe(a1);
    expect((await answer(hub, cashier, a2, 'withdraw')).status).toBe(200);
    expect(eventsOf('BuyerIdWaived')).toEqual([]);
    expect(waivedOf(bill_id)).toBe(0);
  });

  it('[05 §6.11] the request path answers as the direct path before raising: not required → no request; already waived → { changed: false }', async () => {
    await start();
    const small = await billOf(2, 1);
    expect((await waive(cashier, { bill_id: small.bill_id })).result).toEqual({ bill_id: small.bill_id, changed: false, reason: 'not_required' });
    const { bill_id } = await billOf(3, 0, VX.tables.T5);
    expect((await waive(manager, { bill_id })).status).toBe(200);
    expect((await waive(cashier, { bill_id })).result).toEqual({ bill_id, changed: false });
    expect(eventsOf('AlertRaised').filter((e) => (e.payload as { kind: string }).kind === 'close_without_buyer_id')).toEqual([]);
  });
});

// ================================================================================================= #42, #42b with the close

describe('[05 #42, #42b, B19, H1-16] the waiver and the close', () => {
  it('[05 #42] Rs 60,000 in two item splits each below Rs 50,000: each close needs the ID; one waiver covers both; it survives a reopen (and a rebuild)', async () => {
    await start();
    const s = seated(3, 0);
    const bill_id = await itemSplits(s.seating_id, [[s.lines[0]!, s.lines[1]!], [s.lines[2]!]]);
    const ref = { bill_id };
    // split 1: Rs 40,000 + 16 % = Rs 46,400; split 2: Rs 20,000 + 16 % = Rs 23,200
    await pay(ref, 1, 4_640_000);
    const refused = await close({ bill_ref: ref, split_no: 1, expected_total_minor: 4_640_000 });
    expect(refused.status).toBe(409);
    expect(refused.error).toEqual({ code: 'BUYER_ID_REQUIRED', details: { threshold_minor: THRESHOLD, net_minor: 6_000_000, accepted_types: ['CNIC', 'NTN'] } });
    expect((await waive(manager, { bill_id })).result).toEqual({ bill_id, changed: true });
    const c1 = await close({ bill_ref: ref, split_no: 1, expected_total_minor: 4_640_000 });
    expect(c1.status, JSON.stringify(c1.error)).toBe(200);
    await pay(ref, 2, 2_320_000);
    const c2 = await close({ bill_ref: ref, split_no: 2, expected_total_minor: 2_320_000 });
    expect(c2.status, JSON.stringify(c2.error)).toBe(200);
    for (const c of [c1, c2]) expect(c.events.find((e) => e.event_type === 'InvoiceIssued')!.payload).toMatchObject({ has_buyer_id: false, buyer_id_refused: true });
    expect(db().prepare('SELECT COUNT(*) FROM invoice_buyers').pluck().get()).toBe(0);
    // a reopen (task 19's event, its fold built in task 7) keeps the waiver: the customer is the same
    appendBill(bill_id, BillReopened as unknown as EventDef<z.ZodType>, { ...(aBillReopened().payload as object), bill_id, order_ids: [s.order_id], mode: 'full' });
    expect(waivedOf(bill_id)).toBe(1);
    expect((await view({ bill_id })).buyer).toMatchObject({ required: true, waived: true });
    // the fold alone decides it: a rebuild from events gives the same
    db().prepare(`DELETE FROM projection_checkpoints WHERE projection = 'billing'`).run();
    const registry = createProjectionRegistry();
    registry.register(billingProjection());
    registry.catchUp(db(), branch());
    expect(waivedOf(bill_id)).toBe(1);
    // and on the reopened bill the waiver still answers changed: false
    expect((await waive(manager, { bill_id })).result).toEqual({ bill_id, changed: false });
  });

  it('[05 #42] a bill under the threshold never asks: Rs 40,000 closes without buyer data, buyer_id_refused false', async () => {
    await start();
    const { bill_id } = await billOf(2, 0);
    await pay({ bill_id }, 1, 4_640_000);
    const c = await close({ bill_ref: { bill_id }, split_no: 1, expected_total_minor: 4_640_000 });
    expect(c.status, JSON.stringify(c.error)).toBe(200);
    expect(c.events.find((e) => e.event_type === 'InvoiceIssued')!.payload).toMatchObject({ has_buyer_id: false, buyer_id_refused: false });
  });

  it('[05 #42b, H1-16] split 1 closes on a Rs 30,000 bill with no buyer data; a Rs 30,000 round joins; split 2 needs the ID or the approved waiver; invoice 1 and its outbox row unchanged', async () => {
    await start();
    const s = seated(1, 1);
    const bill_id = await itemSplits(s.seating_id, [[s.lines[0]!], [s.lines[1]!]]);
    const ref = { bill_id };
    // split 1: the naan, Rs 20,000 + 16 % = Rs 23,200 (the whole bill is Rs 30,000: not required)
    await pay(ref, 1, 2_320_000);
    const c1 = await close({ bill_ref: ref, split_no: 1, expected_total_minor: 2_320_000 });
    expect(c1.status, JSON.stringify(c1.error)).toBe(200);
    expect(c1.events.find((e) => e.event_type === 'InvoiceIssued')!.payload).toMatchObject({ buyer_id_refused: false });
    const invoice1 = db().prepare('SELECT * FROM invoices').all();
    const outbox1 = db().prepare('SELECT * FROM fiscal_outbox').all();
    // a Rs 30,000 round (3 raitas) joins the open split 2: the whole bill is now Rs 60,000
    appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: s.seating_id,
      placed_by: STAFF.orderTaker,
      lines: [0, 1, 2].map((i) => ({ order_item_id: `R2_B${i}`, item_id: FX.optionItem })),
    });
    const v = await view({ bill_id });
    expect(v.buyer).toEqual({ required: true, threshold_minor: THRESHOLD, waived: false });
    // split 2: Rs 40,000 + 16 % = Rs 46,400
    expect(v.splits.find((x) => x.split_no === 2)!.totals.as_paid.total_minor).toBe(4_640_000);
    await pay(ref, 2, 4_640_000);
    const refused = await close({ bill_ref: ref, split_no: 2, expected_total_minor: 4_640_000 });
    expect(refused.error).toEqual({ code: 'BUYER_ID_REQUIRED', details: { threshold_minor: THRESHOLD, net_minor: 6_000_000, accepted_types: ['CNIC', 'NTN'] } });
    // the waiver, asked by the Cashier and approved by the Manager
    const alert_id = pendingOf(await waive(cashier, { bill_id }));
    expect((await answer(hub, manager, alert_id, 'approve')).status).toBe(200);
    const c2 = await close({ bill_ref: ref, split_no: 2, expected_total_minor: 4_640_000 });
    expect(c2.status, JSON.stringify(c2.error)).toBe(200);
    expect(c2.result).toMatchObject({ bill_state: 'closed' });
    expect(c2.events.find((e) => e.event_type === 'InvoiceIssued')!.payload).toMatchObject({ has_buyer_id: false, buyer_id_refused: true });
    // invoice 1 and its outbox row are untouched (H1-16)
    const inv1 = (invoice1 as Array<{ invoice_id: string }>)[0]!.invoice_id;
    expect(db().prepare('SELECT * FROM invoices WHERE invoice_id = ?').all(inv1)).toEqual(invoice1);
    expect(db().prepare('SELECT * FROM fiscal_outbox WHERE invoice_id = ?').all(inv1)).toEqual(outbox1);
  });
});

// ================================================================================================= #43 redaction

describe('[05 #43, B19, H-4, H6-5, H7-2, P-5] buyer redaction — the full ID lives in invoice_buyers and on that customer\'s receipt only', () => {
  for (const [type, sent, stored] of [
    ['CNIC', '35202-7654321-9', '3520276543219'],
    ['NTN', 'Z9Y8X7W', 'Z9Y8X7W'],
  ] as const) {
    it(`[05 #43 ${type}] close, receipt, reprint, check bill, views, a bad value, the waiver request: the ID is nowhere but invoice_buyers and the receipt paper`, async () => {
      await start();
      buyerSecret(sent);
      buyerSecret(stored);
      const name = buyerSecret(`Redacted Buyer ${type}`);
      const s = seated(3, 0);
      const bill_id = await itemSplits(s.seating_id, [[s.lines[0]!, s.lines[1]!], [s.lines[2]!]]);
      const ref = { bill_id };
      await pay(ref, 1, 4_640_000);

      // a value of the wrong shape: 400 at the value's path, never the value (H-4)
      const badValue = type === 'CNIC' ? buyerSecret('35202-765432') : buyerSecret('Z9Y8X');
      const bad = await close({ bill_ref: ref, split_no: 1, expected_total_minor: 4_640_000, buyer: { name, tax_id: { type, value: badValue } } });
      expect(bad.status).toBe(400);
      expect(bad.error!.details).toEqual({ issues: [{ path: 'buyer.tax_id.value', message: expect.any(String) }] });

      // split 1 closes with the buyer: invoice_buyers holds it normalised; payload_hash is over the payload without buyer
      const payload = { bill_ref: ref, split_no: 1, expected_total_minor: 4_640_000, buyer: { name, tax_id: { type, value: sent } } };
      const c1 = await close(payload, `redact-${type}`);
      expect(c1.status, JSON.stringify(c1.error)).toBe(200);
      const invoice_id = c1.result!['invoice_id'] as string;
      expect(db().prepare('SELECT invoice_id, buyer_name, id_type, id_value FROM invoice_buyers').all()).toEqual([{ invoice_id, buyer_name: name, id_type: type, id_value: stored }]);
      expect(db().prepare(`SELECT payload_hash FROM processed_commands WHERE command_id = ?`).pluck().get(`redact-${type}`)).toBe(
        payloadHash({ bill_ref: ref, split_no: 1, expected_total_minor: 4_640_000 }),
      );
      expect(JSON.stringify(c1)).not.toContain(stored);
      const last4 = `${type}: ****${stored.slice(-4)}`;
      const receiptJob = (c1.result!['receipt'] as { job_id: string }).job_id;
      expect(jobPayload(receiptJob)).toContain(last4);

      // a reprint of that receipt (task 27): a new job, built from invoice_buyers, the queue copy keeps the last 4
      const re = await post(hub, cashier, 'print-bill-document', 'PrintBillDocument', { doc: 'receipt', ref_id: invoice_id });
      expect(re.status, JSON.stringify(re.error)).toBe(200);
      const reprintJob = re.result!['job_id'] as string;
      expect(jobPayload(reprintJob)).toContain(last4);

      // the check bill of the open remainder: no buyer block at all
      const cb = await post(hub, cashier, 'print-check-bill', 'PrintCheckBill', { bill_ref: ref, printer_id: PRINTER });
      expect(cb.status, JSON.stringify(cb.error)).toBe(200);
      const checkJob = cb.result!['job_id'] as string;
      expect(jobPayload(checkJob)).not.toContain(`****${stored.slice(-4)}`);

      // the paper: the receipt and its reprint carry the full ID and the name; the check bill neither
      const sends = await sendAll(3);
      const byJob = new Map((db().prepare(`SELECT job_id FROM print_jobs WHERE kind = 'document' ORDER BY created_at, rowid`).pluck().all() as string[]).map((j, i) => [j, sends[i]!]));
      expect(byJob.get(receiptJob)).toContain(`${type}: ${stored}`);
      expect(byJob.get(receiptJob)).toContain(name);
      expect(byJob.get(reprintJob)).toContain(`${type}: ${stored}`);
      expect(byJob.get(checkJob)).not.toContain(stored);
      expect(byJob.get(checkJob)).not.toContain(name);
      // the stored job copies still hold the last 4 only (the filler never writes back, P-5)
      for (const j of [receiptJob, reprintJob]) expect(jobPayload(j)).not.toContain(stored);

      // screens: the bill view (full and take-order) carries neither the ID nor the name
      for (const who of [cashier, manager, waiter]) {
        const body = await viewRaw(who, { bill_id });
        expect(body).not.toContain(stored);
        expect(body).not.toContain(name);
      }

      // split 2: the waiver request (values, details, display) and its approval carry no buyer data
      await pay(ref, 2, 2_320_000);
      const alert_id = pendingOf(await waive(cashier, { bill_id }));
      expect((await answer(hub, manager, alert_id, 'approve')).status).toBe(200);
      const c2 = await close({ bill_ref: ref, split_no: 2, expected_total_minor: 2_320_000 });
      expect(c2.status, JSON.stringify(c2.error)).toBe(200);
      expect(c2.events.find((e) => e.event_type === 'InvoiceIssued')!.payload).toMatchObject({ has_buyer_id: false, buyer_id_refused: true });
      // the afterEach scan holds the sent and stored ID, the bad value and the name to invoice_buyers (logs included)
    });
  }

  it('[05 #43] the scan is live: a probe value in an event, a hub log line and a worker log line is found in each place', async () => {
    await start();
    const probe = 'PROBE-3520299999999';
    hubEvents([{ stream_type: 'hub', stream_id: branch(), event_type: 'PrinterSaved', payload: { printer_id: 'PR_PROBE', name: probe, connection: 'lan', address: '192.168.1.21:9100', paper_width_mm: 80, archived: false } }]);
    hub.app.log.info({ probe }, 'scan probe');
    workerLog.push(JSON.stringify({ obj: { probe } }));
    const places = leaksOf(probe, 'invoice_buyers');
    expect(places).toContain('table events');
    expect(places).toContain('hub.logs()');
    expect(places).toContain('worker log');
    // the allowed table is the only one skipped
    expect(leaksOf(probe, 'events')).not.toContain('table events');
    workerLog.length = 0; // the probe is not one of SECRETS: the afterEach scan stays green
  });
});

// ================================================================================================= statement counts

describe('[05 §6.11 Statements, #91] WaiveBuyerId — statements fixed (00 envelope excluded; 01d raise its own bound)', () => {
  for (const n of [1, 40]) {
    it(`[05 §6.11] direct at ${n} line(s): openBillOf, SPLITS_OF_BILL, orders, orderLines, pendingVoids (5); + 1 with a note (6); a refusal stops early`, async () => {
      await start();
      const { bill_id } = await billOf(n + 2, 0); // ≥ 3 naans: above the threshold
      await waive(manager, { bill_id, note: noteSecret(`counted note ${n} 1f0c`) });
      expect(handled['waive-buyer-id']).toBe(6);
      await waive(manager, { bill_id }); // already waived: the same reads, no write
      expect(handled['waive-buyer-id']).toBe(5);
      const missing = await waive(manager, { bill_id: 'B_NOPE' });
      expect(missing.status).toBe(404);
      expect(handled['waive-buyer-id']).toBe(1);
    });
  }

  it('[05 §6.11] the request path: 6 with a note besides 01d\'s raise', async () => {
    await start();
    const { bill_id } = await billOf(3, 0);
    let inRaise = 0;
    const real = alerts.raise.bind(alerts);
    const original = alerts.raise;
    alerts.raise = ((ctx, input) => {
      const before = counter.count;
      try {
        return real(ctx, input);
      } finally {
        inRaise = counter.count - before;
      }
    }) as typeof alerts.raise;
    try {
      const r = await waive(cashier, { bill_id, note: noteSecret('please waive 6a2b') });
      expect(r.result).toMatchObject({ pending: { alert_id: expect.any(String) } });
      expect(inRaise).toBeGreaterThan(0);
      expect(handled['waive-buyer-id']! - inRaise).toBe(6);
    } finally {
      alerts.raise = original;
    }
  });

  for (const n of [1, 40]) {
    it(`[05 §3.14] the kind's apply on approve at ${n} line(s): 1 statement (openBillOf), read-only; reject 0; the approver is the answerer, never the actor`, async () => {
      await start();
      const { bill_id } = await billOf(n + 2, 0);
      const alert_id = pendingOf(await waive(cashier, { bill_id }));
      const record = alerts.listOpen(db(), { kind: 'close_without_buyer_id' }).find((x) => x.alert_id === alert_id)!;
      const request = kindOf('close_without_buyer_id')!.request!;
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
      expect(approved.statements).toBe(1);
      expect(approved.out.map((d) => d.event_type)).toEqual(['BuyerIdWaived']);
      expect(approved.out[0]!.payload).toEqual({ bill_id, has_note: false, note_id: null, requester_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager, alert_id });
      expect(run('reject')).toEqual({ out: [], statements: 0 });
    });
  }
});
