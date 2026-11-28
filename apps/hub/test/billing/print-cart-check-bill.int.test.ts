// ⚠️ 05 v1.0.35 §6.3a `PrintCartCheckBill` (OR-5; hostile run 2 R2-M-1 … R2-M-6, R2-m-1, R2-m-2, R2-m-7; run 3 R3-M-1,
// R3-M-2, R3-M-3, R3-M-7, R3-m-2), §6.29–6.30, task 11a / 02b-TK CB-2: tests #60f, #60g, #60i, #91b. Real commands over
// HTTP (SubmitOrder, PrintCheckBill, PrintCartCheckBill), 03c's print_config fold for printers and routes, and the paper
// read back from `print_jobs`.
import { renderText, type Doc } from '@pos/domain';
import { BillRouteSet, PrinterSaved, rateBpRates, SnapshotBillingSchema, type BranchConfig, type DirectoryInput, type EventDef, type EventDraft, type PosEvent } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { printCartCheckBillCommand } from '../../src/billing/commands/print-cart-check-bill';
import { hubBilling } from '../../src/billing/defaults';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { audienceAllows } from '../../src/ws/audience';
import type { SocketCtx } from '../../src/ws/catch-up';
import { aDirectory } from '../helpers/fixtures';
import { seenDue } from '../voids/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { fixtureMenu, FX, openDay } from '../orders/fixtures';

const FOOD = 'tc-food';
const P = { device: 'P_DEVICE', fallback: 'P_DEFAULT', archived: 'P_OLD' } as const;

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;
afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

// ------------------------------------------------------------------------------------------------ set-up

/** fixtureMenu with exclusive 16 % tax on every item and a 5 % takeaway / parking service charge. */
function menu(): BranchConfig {
  const m = fixtureMenu();
  const pk = hubBilling({ currency_code: 'PKR', tax_classes: [], billing: undefined });
  const billing = SnapshotBillingSchema.parse({
    ...pk.settings,
    service_charge_bp: { ...pk.settings.service_charge_bp, takeaway: 500, parking: 500 },
    service_charge_tax_profile_id: FOOD,
    jurisdiction: { ...pk.jurisdiction, rules: pk.jurisdiction.rules.map((r) => ({ ...r, prices_include_tax: false })) },
    tax_profiles: [{ tax_class_id: FOOD, taxes: [{ seq: 1, tax_code: 'TAX', label: 'Sales tax', compound: false, rates: rateBpRates(1_600) }] }],
  });
  return {
    ...m,
    tax_enabled: true,
    tax_classes: [{ tax_class_id: FOOD, name: 'Sales tax', rate_bp: 1_600, is_archived: false, fiscal_category: 'restaurant_service' }],
    items: m.items.map((i) => ({ ...i, tax_class_id: FOOD })),
    billing,
  };
}

const grant = (permission: string, scope: 'branch' | 'own_tables' = 'branch') => ({ permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [] as string[], scope });
async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const person = (staff_id: string, role_id: string) => ({ staff_id, display_name: staff_id, pin_hash: pin, role_ids: [role_id], denied_permissions: [], lead_staff_id: null, floor_ids: [] });
  const role = (role_id: string, permissions: ReturnType<typeof grant>[]) => ({ role_id, name: role_id, session_idle_ttl_ms: 36_000_000, permissions });
  return {
    ...base,
    roles: [...base.roles, role('R_TILL', [grant('take-order')]), role('R_OWN', [grant('take-order', 'own_tables')]), role('R_NONE', [grant('mark-served')]), role('R_PAY', [grant('take-payment'), grant('take-order'), grant('manage-own-shift')])],
    staff: [...base.staff, person('S_ALI', 'R_TILL'), person('S_OWN1', 'R_OWN'), person('S_OWN2', 'R_OWN'), person('S_NONE', 'R_NONE'), person('S_PAYER', 'R_PAY')],
  };
}

async function start(o: { open?: boolean } = {}): Promise<void> {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  if (o.open !== false) openDay(hub, { menu: menu() });
  commandRegistry(hub.app).register(
    defineCommand({
      ...printCartCheckBillCommand,
      commandType: 'TestPrintCartCheckBillCounted',
      handle(ctx, payload, cmd) {
        const before = counter.count;
        try {
          return printCartCheckBillCommand.handle(ctx, payload, cmd);
        } finally {
          lastStatements = counter.count - before;
        }
      },
    }),
  );
  counter = statementCounter(hub.deps.db);
  lastStatements = -1;
}

type HubDraft = Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id'>;
function hubAppend(drafts: HubDraft[]): PosEvent[] {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  return hub.deps.writer.run((tx) => tx.append(drafts.map((x) => ({ ...x, occurred_at: now, actor_id: 'S_MGR', device_id: 'D_FIXTURE' })))).appended;
}
function onHub<S extends z.ZodType>(def: EventDef<S>, payload: unknown): HubDraft {
  return { stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, event_type: def.eventType, schema_version: def.version, payload: def.payload.parse(payload) as PosEvent['payload'] };
}
function printers(routes: Array<{ scope: 'device' | 'default'; ref_id: string; printer_id: string }>): void {
  hubAppend([
    ...Object.values(P).map((printer_id, i) => onHub(PrinterSaved, { printer_id, name: `Printer ${printer_id}`, connection: 'lan', address: `192.168.1.${30 + i}:9100`, paper_width_mm: 80, archived: false })),
    ...routes.map((r) => onHub(BillRouteSet, r)),
    onHub(PrinterSaved, { printer_id: P.archived, name: 'Old', connection: 'lan', address: '192.168.1.99:9100', paper_width_mm: 80, archived: true }),
  ]);
}

interface Who { staffId: string; deviceId: string; token: string; sessionToken: string }
function signIn(staffId: string): Who {
  const d = pairDevice(hub, { type: 'tablet' });
  const s = openSession(hub, { kind: 'staff', staffId, deviceId: d.deviceId });
  return { staffId, deviceId: d.deviceId, token: d.token, sessionToken: s.token };
}

let seq = 0;
async function post(who: Who, path: string, command_type: string, payload: Record<string, unknown>, o: { commandId?: string; queuedAt?: number } = {}) {
  // ⚠️ 05 v1.0.37 §6.9 (R2-1): a payment carries the due the bill shows, as a client sends it
  if (command_type === 'AddPayment' && !('expected_due_minor' in payload)) payload = { ...payload, expected_due_minor: await seenDue(hub, who as Parameters<typeof seenDue>[1], payload) };
  seq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${path}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken, ...(o.queuedAt === undefined ? {} : { 'x-queued-at': String(o.queuedAt) }) },
    payload: { command_id: o.commandId ?? `cc-${seq}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type, payload, occurred_at: hub.clock.branchNow(), actor_id: who.staffId, device_id: who.deviceId },
  });
  const body = res.json() as { data?: { result: Record<string, unknown> }; error?: { code: string; details: Record<string, unknown> } };
  return { status: res.statusCode, result: body.data?.result, error: body.error };
}
const cart = (who: Who, payload: Record<string, unknown>, o: { commandId?: string; queuedAt?: number; counted?: boolean } = {}) =>
  o.counted === true ? post(who, 'test-print-cart-check-bill-counted', 'TestPrintCartCheckBillCounted', payload, o) : post(who, 'print-cart-check-bill', 'PrintCartCheckBill', payload, o);

/** SubmitOrder of `draft` under `order_id` (keys become order_item_ids). */
async function send(who: Who, order_id: string, draft: Record<string, unknown>): Promise<void> {
  const payload = JSON.parse(JSON.stringify({ order_id, ...draft }).replace(/"key":/g, '"order_item_id":')) as Record<string, unknown>;
  const r = await post(who, 'submit-order', 'SubmitOrder', payload);
  expect(r.status, JSON.stringify(r.error)).toBe(200);
}

/** A karahi ×2 with a linked raita, a combo deal, two naans split per unit (no: as one line of 2). */
const lines = () => [
  { key: 'K1', item_id: FX.piece, quantity: 2, options: [{ option_id: FX.option, quantity: 1, key: 'K1o' }] },
  { key: 'D1', deal_id: FX.deal, quantity: 1, deal_choices: [{ deal_part_id: FX.dealParts[0], item_id: FX.piece, key: 'D1a' }, { deal_part_id: FX.dealParts[1], item_id: FX.naan, key: 'D1b' }] },
  { key: 'N1', item_id: FX.naan, quantity: 2 },
];

const db = () => hub.deps.db;
interface JobRow { job_id: string; printer_id: string; order_id: string | null; payload: string }
const jobs = (): JobRow[] => db().prepare(`SELECT job_id, printer_id, order_id, payload FROM print_jobs WHERE kind = 'document' ORDER BY created_at, job_id`).all() as JobRow[];
const paper = (j: JobRow): { text: string; kind_label?: string } => {
  const p = JSON.parse(j.payload) as { doc: Doc; kind_label?: string };
  return { text: renderText(p.doc, p.doc.width_cols ?? 48), ...(p.kind_label === undefined ? {} : { kind_label: p.kind_label }) };
};
const eventsOf = (type: string) => db().prepare('SELECT stream_type, stream_id, payload FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<{ stream_type: string; stream_id: string; payload: string }>;
const count = (sql: string): number => (db().prepare(sql).get() as { n: number }).n;
const audits = (action: string) => db().prepare('SELECT subject_type, subject_id, detail_json FROM audit_entries WHERE action = ?').all(action) as Array<{ subject_type: string; subject_id: string; detail_json: string }>;

// ------------------------------------------------------------------------------------------------ #60f

describe('[05 #60f] PrintCartCheckBill prints an unsent cart', () => {
  it('one document job at the device route, NOT SENT YET first, no token or number; one CartCheckBillPrinted, audited; no bill / order row; 5 statements routed, 4 with printer_id; a retransmit → the stored result', async () => {
    await start();
    const ali = signIn('S_ALI');
    printers([{ scope: 'device', ref_id: ali.deviceId, printer_id: P.device }, { scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const ordersBefore = count('SELECT COUNT(*) AS n FROM orders');
    const draft = { order_type: 'takeaway', lines: lines() };

    const r = await cart(ali, { draft }, { counted: true, commandId: 'cart-1' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(lastStatements).toBe(5);
    const [job] = jobs();
    expect(jobs()).toHaveLength(1);
    expect(job).toMatchObject({ printer_id: P.device, order_id: null });
    const { text, kind_label } = paper(job!);
    expect(kind_label).toBe('Check bill (not sent)');
    expect(text.split('\n')[0]!.trim()).toBe('NOT SENT YET - CHECK BILL');
    expect(text).toContain('PROVISIONAL - NOT A TAX INVOICE');
    expect(text).toContain('Printed at');
    expect(text).toContain('Gross total');
    expect(text).not.toMatch(/#\d/);
    expect(text).not.toContain('Includes items not sent yet');
    expect(r.result).toMatchObject({ printed: true, job_id: job!.job_id, printer_name: `Printer ${P.device}`, totals_default: { total_minor: expect.any(Number) } });
    const total = (r.result!.totals_default as { total_minor: number }).total_minor;
    expect(r.result!.due_minor).toBe(total);

    const printed = eventsOf('CartCheckBillPrinted');
    expect(printed).toHaveLength(1);
    expect(printed[0]!.stream_type).toBe('hub');
    expect(JSON.parse(printed[0]!.payload)).toEqual({ job_id: job!.job_id, printer_id: P.device, line_count: expect.any(Number), total_default_minor: total, device_id: ali.deviceId });
    expect(audits('cart_check_bill_printed')).toEqual([expect.objectContaining({ subject_type: 'hub' })]);
    expect(count('SELECT COUNT(*) AS n FROM bills')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM bill_print_jobs')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM orders')).toBe(ordersBefore);

    const again = await cart(ali, { draft }, { commandId: 'cart-1', counted: true });
    expect(again.result).toEqual(r.result);
    expect(jobs()).toHaveLength(1);

    expect((await cart(ali, { draft, printer_id: P.fallback }, { counted: true })).status).toBe(200);
    expect(lastStatements).toBe(4);
  });

  it('parity with Send: the same draft → PrintCheckBill { order_id }’s total after SubmitOrder (exclusive tax, service charge, deal, linked option)', async () => {
    await start();
    const ali = signIn('S_ALI');
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const draft = { order_type: 'takeaway', lines: lines() };
    const quote = await cart(ali, { draft });
    await send(ali, 'O_SENT', draft);
    const sent = await post(ali, 'print-check-bill', 'PrintCheckBill', { bill_ref: { order_id: 'O_SENT' } });
    expect(sent.status, JSON.stringify(sent.error)).toBe(200);
    expect(quote.result!.totals_default).toEqual(sent.result!.totals_default);
    expect((quote.result!.totals_default as { service_charge_minor: number }).service_charge_minor).toBeGreaterThan(0);
  });

  it('a weighed line with no weight prints "weighed at the counter" and Total (+ weighed items)', async () => {
    await start();
    const ali = signIn('S_ALI');
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const r = await cart(ali, { draft: { order_type: 'takeaway', lines: [{ key: 'N1', item_id: FX.naan, quantity: 1 }, { key: 'F1', item_id: FX.gram }] } });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const { text } = paper(jobs()[0]!);
    expect(text).toContain('weighed at the counter');
    expect(text).toContain('Total (+ weighed items)');
  });
});

// ------------------------------------------------------------------------------------------------ #60g

describe('[05 #60g] PrintCartCheckBill refusals', () => {
  it('dine-in → 400 at payload.draft.order_type (exact details); a parking draft without parking → 400 at parking; nothing written', async () => {
    await start();
    const ali = signIn('S_ALI');
    const before = count('SELECT COUNT(*) AS n FROM events');
    const dine = await cart(ali, { draft: { order_type: 'dine_in', table_id: FX.table, lines: [{ key: 'N1', item_id: FX.naan, quantity: 1 }] } });
    expect(dine.status).toBe(400);
    expect(dine.error?.code).toBe('VALIDATION_FAILED');
    expect(dine.error?.details).toEqual({ issues: [{ path: 'payload.draft.order_type', message: 'takeaway_or_parking_only' }] });
    const parking = await cart(ali, { draft: { order_type: 'parking', lines: [{ key: 'N1', item_id: FX.naan, quantity: 1 }] } });
    expect(parking.status).toBe(400);
    expect((parking.error!.details.issues as Array<{ path: string }>).some((i) => i.path.endsWith('parking'))).toBe(true);
    expect(count('SELECT COUNT(*) AS n FROM events')).toBe(before);
  });

  it('no open day → 409 BUSINESS_DAY_NOT_OPEN, nothing written', async () => {
    await start({ open: false });
    swapBranchConfig({ config: menu(), snapshotHash: 'h'.repeat(64), configVersion: 1, snapshotSchemaVersion: 4, appliedAt: 0 });
    const ali = signIn('S_ALI');
    const before = count('SELECT COUNT(*) AS n FROM events');
    const r = await cart(ali, { draft: { order_type: 'takeaway', lines: [{ key: 'N1', item_id: FX.naan, quantity: 1 }] } });
    expect([r.status, r.error?.code]).toEqual([409, 'BUSINESS_DAY_NOT_OPEN']);
    expect(count('SELECT COUNT(*) AS n FROM events')).toBe(before);
  });

  it('one Off item among three lines → 409 ITEM_UNAVAILABLE with details.key, no event; a sold-out item still prints (step 8 not checked)', async () => {
    await start();
    const ali = signIn('S_ALI');
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    hubAppend([{ stream_type: 'stock', stream_id: FX.ready, event_type: 'ItemMadeUnavailable', schema_version: 1, payload: { item_id: FX.ready } }]);
    const before = count('SELECT COUNT(*) AS n FROM events');
    const r = await cart(ali, { draft: { order_type: 'takeaway', lines: [{ key: 'A', item_id: FX.naan, quantity: 1 }, { key: 'B', item_id: FX.ready, quantity: 1 }, { key: 'C', item_id: FX.naan, quantity: 1 }] } });
    expect([r.status, r.error?.code]).toEqual([409, 'ITEM_UNAVAILABLE']);
    expect(r.error!.details).toMatchObject({ key: 'B' });
    expect(count('SELECT COUNT(*) AS n FROM events')).toBe(before);
    expect(jobs()).toEqual([]);
  });

  it('an archived printer_id → 404 PRINTER_NOT_FOUND; no route → printed false, the event with nulls; no take-order → 403; X-Queued-At is ignored', async () => {
    await start();
    const ali = signIn('S_ALI');
    const draft = { order_type: 'takeaway', lines: [{ key: 'N1', item_id: FX.naan, quantity: 1 }] };
    const none = await cart(ali, { draft }, { counted: true });
    expect(none.result).toMatchObject({ printed: false, job_id: null, printer_name: null });
    expect(lastStatements).toBe(2);
    expect(JSON.parse(eventsOf('CartCheckBillPrinted')[0]!.payload)).toMatchObject({ job_id: null, printer_id: null });

    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const old = await cart(ali, { draft, printer_id: P.archived });
    expect([old.status, old.error?.code]).toEqual([404, 'PRINTER_NOT_FOUND']);
    const denied = await cart(signIn('S_NONE'), { draft });
    expect([denied.status, denied.error?.code]).toEqual([403, 'PERMISSION_DENIED']);
    const queued = await cart(ali, { draft }, { queuedAt: hub.clock.branchNow() - 60_000 });
    expect(queued.result).toMatchObject({ printed: true });
  });
});

// ------------------------------------------------------------------------------------------------ #60i

describe('[05 #60i] the addition cart (R2-M-6; run 3 R3-M-1, R3-M-2, R3-M-3)', () => {
  it('a sent token plus unsent lines → one combined paper (sent then unsent, "Includes items not sent yet"); gross = PrintCheckBill after Send; no bill row written; ≤ 10 statements', async () => {
    await start();
    const ali = signIn('S_ALI');
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    await send(ali, 'O_ROOT', { order_type: 'takeaway', lines: [{ key: 'R1', item_id: FX.naan, quantity: 2 }] });
    const addition = { order_type: 'takeaway', adds_to_order_id: 'O_ROOT', lines: [{ key: 'A1', item_id: FX.piece, quantity: 1 }] };
    const bills = count('SELECT COUNT(*) AS n FROM bills');
    const r = await cart(ali, { draft: addition }, { counted: true });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(lastStatements).toBeLessThanOrEqual(10);
    expect(count('SELECT COUNT(*) AS n FROM bills')).toBe(bills);
    const { text } = paper(jobs()[0]!);
    expect(text).toContain('Includes items not sent yet');
    expect(text.indexOf('Naan')).toBeLessThan(text.indexOf('Karahi'));

    await send(ali, 'O_ADD', addition);
    const after = await post(ali, 'print-check-bill', 'PrintCheckBill', { bill_ref: { order_id: 'O_ROOT' } });
    expect(after.status, JSON.stringify(after.error)).toBe(200);
    expect(r.result!.totals_default).toEqual(after.result!.totals_default);
    expect(r.result!.due_minor).toBe(after.result!.due_minor);
  });

  it('PARTLY_PAID target: gross = the combined open remainder, remaining payable = gross − paid (paper and result); a CLOSED target prints the draft alone', async () => {
    await start();
    const ali = signIn('S_ALI');
    const cash = signIn('S_PAYER');
    const shift = await post(cash, 'open-shift', 'OpenShift', { float_minor: 0, as_drawer: false });
    expect(shift.status, JSON.stringify(shift.error)).toBe(200);
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    await send(ali, 'O_ROOT', { order_type: 'takeaway', lines: [{ key: 'R1', item_id: FX.naan, quantity: 2 }] });
    const paid = await post(cash, 'add-payment', 'AddPayment', { bill_ref: { order_id: 'O_ROOT' }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 1_000, tendered_minor: 1_000 });
    expect(paid.status, JSON.stringify(paid.error)).toBe(200);
    const addition = { order_type: 'takeaway', adds_to_order_id: 'O_ROOT', lines: [{ key: 'A1', item_id: FX.piece, quantity: 1 }] };
    const r = await cart(ali, { draft: addition });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const gross = (r.result!.totals_default as { total_minor: number }).total_minor;
    expect(r.result!.due_minor).toBe(gross - 1_000);
    const { text } = paper(jobs()[0]!);
    expect(text).toContain('Already paid');
    expect(text).toContain('Remaining payable');

    await send(ali, 'O_ADD', addition);
    const after = await post(ali, 'print-check-bill', 'PrintCheckBill', { bill_ref: { order_id: 'O_ROOT' } });
    expect([after.result!.totals_default, after.result!.due_minor]).toEqual([r.result!.totals_default, r.result!.due_minor]);

    // paid in full and closed → the paper is the draft alone
    const rest = await post(cash, 'add-payment', 'AddPayment', { bill_ref: { order_id: 'O_ROOT' }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: r.result!.due_minor as number, tendered_minor: r.result!.due_minor as number });
    expect(rest.status, JSON.stringify(rest.error)).toBe(200);
    const closed = await post(cash, 'close-split', 'CloseSplit', { bill_ref: { order_id: 'O_ROOT' }, split_no: 1, expected_total_minor: gross });
    expect(closed.status, JSON.stringify(closed.error)).toBe(200);
    const alone = await cart(ali, { draft: addition });
    expect(alone.status, JSON.stringify(alone.error)).toBe(200);
    const plain = await cart(ali, { draft: { order_type: 'takeaway', lines: addition.lines } });
    expect(alone.result!.totals_default).toEqual(plain.result!.totals_default);
    expect(paper(jobs().at(-2)!).text).not.toContain('Includes items not sent yet');
  });

  it('target guards: unknown → 404 ORDER_NOT_FOUND; cancelled → 422 CONFIG_REFERENCE_INVALID { field: adds_to_order_id }; each with no job, event or audit row', async () => {
    await start();
    const ali = signIn('S_ALI');
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const before = count('SELECT COUNT(*) AS n FROM events');
    const unknown = await cart(ali, { draft: { order_type: 'takeaway', adds_to_order_id: 'NOPE', lines: [{ key: 'A1', item_id: FX.naan, quantity: 1 }] } });
    expect([unknown.status, unknown.error?.code]).toEqual([404, 'ORDER_NOT_FOUND']);
    expect(count('SELECT COUNT(*) AS n FROM events')).toBe(before);

    await send(ali, 'O_GONE', { order_type: 'takeaway', lines: [{ key: 'G1', item_id: FX.naan, quantity: 1 }] });
    hubAppend([{ stream_type: 'order', stream_id: 'O_GONE', event_type: 'OrderCancelled', schema_version: 1, payload: { order_id: 'O_GONE' } }]);
    const events = count('SELECT COUNT(*) AS n FROM events');
    const gone = await cart(ali, { draft: { order_type: 'takeaway', adds_to_order_id: 'O_GONE', lines: [{ key: 'A1', item_id: FX.naan, quantity: 1 }] } });
    expect(gone.status).toBe(422);
    expect(gone.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'adds_to_order_id' } });
    expect(count('SELECT COUNT(*) AS n FROM events')).toBe(events);
    expect(jobs()).toEqual([]);
    expect(audits('cart_check_bill_printed')).toEqual([]);
  });

  it('two cashiers with own-order scopes: the other cashier’s target → 403, no job; the same plain draft succeeds', async () => {
    await start();
    const own1 = signIn('S_OWN1');
    const own2 = signIn('S_OWN2');
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    await send(own1, 'O_MINE', { order_type: 'takeaway', lines: [{ key: 'M1', item_id: FX.naan, quantity: 1 }] });
    const lines1 = [{ key: 'A1', item_id: FX.naan, quantity: 1 }];
    const r = await cart(own2, { draft: { order_type: 'takeaway', adds_to_order_id: 'O_MINE', lines: lines1 } });
    expect([r.status, r.error?.code]).toEqual([403, 'PERMISSION_DENIED']);
    expect(jobs()).toEqual([]);
    expect((await cart(own2, { draft: { order_type: 'takeaway', lines: lines1 } })).status).toBe(200);
    expect((await cart(own1, { draft: { order_type: 'takeaway', adds_to_order_id: 'O_MINE', lines: lines1 } })).status).toBe(200);
  });
});

// ------------------------------------------------------------------------------------------------ #91b

describe('[05 #91b] CartCheckBillPrinted wiring (R3-M-7)', () => {
  it('reaches no socket (staff, kiosk, station); one cart_check_bill_printed audit row', async () => {
    await start();
    const ali = signIn('S_ALI');
    expect((await cart(ali, { draft: { order_type: 'takeaway', lines: [{ key: 'N1', item_id: FX.naan, quantity: 1 }] } })).status).toBe(200);
    const e = db().prepare(`SELECT * FROM events WHERE event_type = 'CartCheckBillPrinted'`).get() as PosEvent & { payload: string };
    const event = { ...e, payload: JSON.parse(e.payload as unknown as string) } as PosEvent;
    const socket = (o: Partial<SocketCtx>): SocketCtx => ({ deviceId: 'D', deviceType: 'tablet', sessionId: 'X', kind: 'staff', staffId: 'S_MGR', stationId: null, asOfSeq: 0, ...o });
    expect(audienceAllows(event, socket({}))).toBe(false);
    expect(audienceAllows(event, socket({ deviceType: 'cashier_kiosk' }))).toBe(false);
    expect(audienceAllows(event, socket({ kind: 'station', staffId: null, stationId: 'S1', deviceType: 'kds' as never }))).toBe(false);
    expect(audits('cart_check_bill_printed')).toHaveLength(1);
  });
});

// ---- 02b-tk L-CLOSE-4: 04 v1.0.9 §3.6 test 61 (05 V-4) through the real command ----

describe('[04 #61] cart_check_bill_printed audit rows', () => {
  it('a routed plain cart, an addition cart and a cart with no route → one row each (hub subject, actor, amount, the §3.6 detail allowlist; null ids with no route); the audit-log filter takes the action; a retransmit adds no row', async () => {
    await start();
    const ali = signIn('S_ALI');
    const branch = 'branch-1';
    // no route first
    const none = await cart(ali, { draft: { order_type: 'takeaway', lines: [{ key: 'N1', item_id: FX.naan, quantity: 1 }] } });
    expect(none.result).toMatchObject({ printed: false });
    printers([{ scope: 'default', ref_id: '', printer_id: P.fallback }]);
    const plain = await cart(ali, { draft: { order_type: 'takeaway', lines: lines() } }, { commandId: 'cart-61' });
    expect(plain.status, JSON.stringify(plain.error)).toBe(200);
    await send(ali, 'O_ROOT61', { order_type: 'takeaway', lines: [{ key: 'R1', item_id: FX.naan, quantity: 2 }] });
    const addition = await cart(ali, { draft: { order_type: 'takeaway', adds_to_order_id: 'O_ROOT61', lines: [{ key: 'A1', item_id: FX.piece, quantity: 1 }] } });
    expect(addition.status, JSON.stringify(addition.error)).toBe(200);
    // the retransmit of the plain cart: the stored result, no second event or row
    expect((await cart(ali, { draft: { order_type: 'takeaway', lines: lines() } }, { commandId: 'cart-61' })).result).toEqual(plain.result);

    const rows = db().prepare("SELECT * FROM audit_entries WHERE action = 'cart_check_bill_printed' ORDER BY seq").all() as Array<Record<string, unknown> & { detail_json: string }>;
    const events = eventsOf('CartCheckBillPrinted').map((e) => JSON.parse(e.payload) as { job_id: string | null; printer_id: string | null; line_count: number; total_default_minor: number; device_id: string });
    expect(events).toHaveLength(3);
    expect(rows).toHaveLength(3);
    rows.forEach((r, i) => {
      const e = events[i]!;
      expect(r).toMatchObject({ subject_type: 'hub', subject_id: branch, actor_staff_id: 'S_ALI', approver_staff_id: null, amount_minor: e.total_default_minor, order_id: null });
      // §3.6: exactly the payload's five fields (+ the usual envelope actor); no bill / order id, no line text
      expect(JSON.parse(r.detail_json)).toStrictEqual({ job_id: e.job_id, printer_id: e.printer_id, line_count: e.line_count, total_default_minor: e.total_default_minor, device_id: ali.deviceId, envelope_actor_id: 'S_ALI' });
    });
    expect(events[0]).toMatchObject({ job_id: null, printer_id: null });
    expect(events[1]!.printer_id).toBe(P.fallback);
    expect(events[2]!.printer_id).toBe(P.fallback);
    // the audit-log filter
    const mgr = signIn('S_MGR');
    const res = await hub.app.inject({
      method: 'GET',
      url: `/queries/audit-log?from=${hub.clock.branchNow() - 86_400_000}&to=${hub.clock.branchNow() + 1}&action=cart_check_bill_printed`,
      headers: { authorization: `Bearer ${mgr.token}`, 'x-session-token': mgr.sessionToken },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { entries: Array<{ action: string }> } }).data.entries.map((e) => e.action)).toEqual(['cart_check_bill_printed', 'cart_check_bill_printed', 'cart_check_bill_printed']);
  });
});
