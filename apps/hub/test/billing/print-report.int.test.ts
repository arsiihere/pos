// 05 §6.22 `PrintReport { doc: 'x_report' | 'z_report', ref_id?, printer_id? }` (task 27b, a plan gap: task 27 built
// only PrintBillDocument), §3.16, H6-7, R-75, R-85 (1), 05 v1.0.26 R-87 (owner 2026-11-20): X ≤ 13 statements (12 with
// `printer_id`), Z ≤ 9; readings 1–6 — `ref_id` is the Z's business date (the latest `z_no` of it), no `ref_id` = the
// latest Z, no Z → `Z_REPORT_NOT_FOUND { business_date: null }`, an X with a `ref_id` → 400, an X with no open day →
// 409 BUSINESS_DAY_NOT_OPEN, the printer = payload → `report` route → default → skipped, the job id is printDocument's
// own (never the fold's `<event_id>:z`), its `bill_print_jobs` row as the fold's (`report`, bill NULL, the date).
// Money and shifts are raw events through the hub's writer and the real folds (the reports test's pattern); days close
// with the real CloseBusinessDay (task 25). The permanent afterEach scan: a print adds staff names to print_jobs only
// (the Doc renders them, H16-5), never an event, a `bill_print_jobs` row, a result or a log line.
import { buildReportDoc, currencyExponent, renderText, type Doc, type ReportDocInput } from '@pos/domain';
import type { EventDraft, PosEvent } from '@pos/events';
import { aBillOpened, anInvoiceIssued, aPaymentAdded, aShiftClosed, aShiftCountSkipped, aShiftOpened } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { reportStaffIds, staffNamesOf } from '../../src/billing/queries/reports';
import type { CommandDef } from '../../src/commands/registry';
import { hubTime } from '../../src/lib/hub-time';
import { commandRegistry } from '../../src/commands/route';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import type { TestHub } from '../helpers/test-hub';
import { append as appendRaw, openVoidsDay } from '../voids/fixtures';
import { post, signIn, STAFF, startBilling, type Reply, type Who } from './fixtures';

let hub: TestHub;
const NAMES = ['Owner', 'Manager', 'Cashier', 'Order taker'];
const DAY_MS = 86_400_000;
let before: Map<string, number> | null = null;

/** Occurrences of every staff name per table (JSON of all rows). */
function nameCounts(): Map<string, number> {
  const out = new Map<string, number>();
  const tables = hub.deps.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).pluck().all() as string[];
  for (const t of tables) {
    const json = JSON.stringify(hub.deps.db.prepare(`SELECT * FROM "${t}"`).all());
    out.set(t, NAMES.reduce((n, name) => n + json.split(`"${name}`).length - 1 + json.split(` ${name}`).length - 1, 0));
  }
  return out;
}

/** The scan (every test): from the end of `start()` on, names grow in print_jobs only; no log line holds a name or an amount. */
function leaks(): string[] {
  const found: string[] = [];
  if (before === null) found.push('no table baseline (start() takes it)');
  else for (const [t, n] of nameCounts()) if (t !== 'print_jobs' && n !== (before.get(t) ?? 0)) found.push(`a staff name added to ${t}`);
  for (const line of hub.logs().split('\n')) {
    for (const name of NAMES) if (line.includes(name)) found.push(`name ${name} in a log line`);
    if (/_minor/.test(line)) found.push('an amount in a log line');
  }
  return found;
}
const mark = (): void => {
  before = nameCounts();
};

afterEach(async () => {
  const found = hub === undefined ? [] : leaks();
  before = null;
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
  expect(found).toEqual([]);
});

// ------------------------------------------------------------------------------------------------ set-up

const handled: { count?: number } = {};

async function start(o: { routes?: Array<[string, string]> } = {}): Promise<Who> {
  hub = await startBilling();
  noGap();
  printers(
    [
      { printer_id: 'PR_DEF', name: 'Counter', paper_width_mm: 80 },
      { printer_id: 'PR_REP', name: 'Office', paper_width_mm: 80 },
      { printer_id: 'PR_BAR', name: 'Bar', paper_width_mm: 58 },
      { printer_id: 'PR_OLD', name: 'Old', paper_width_mm: 80, archived: true },
    ],
    o.routes ?? [['default', 'PR_DEF'], ['report', 'PR_REP']],
  );
  const def = commandRegistry(hub.app).byPath('print-report') as CommandDef | undefined;
  if (def !== undefined) {
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
  const manager = signIn(hub, STAFF.manager);
  mark(); // the table scan's baseline: every later write is the test's
  return manager;
}

function noGap(): void {
  const config = branchConfig()!;
  swapBranchConfig({ config: { ...config, day_min_gap_hours: 0 }, snapshotHash: 'h'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 4, appliedAt: 0 });
}

const branch = () => hub.deps.config.provisioned!.branch_id;
const today = () => hub.deps.state.get().business_day!;

function printers(list: Array<{ printer_id: string; name: string; paper_width_mm: number; archived?: boolean }>, routes: Array<[string, string]>): void {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  const env = { stream_type: 'hub' as const, stream_id: branch(), schema_version: 1, occurred_at: now, actor_id: STAFF.manager, device_id: 'D_FIXTURE' };
  hub.deps.writer.run((tx) =>
    tx.append([
      ...list.map((p, i) => ({ ...env, event_type: 'PrinterSaved', payload: { printer_id: p.printer_id, name: p.name, connection: 'lan', address: `192.168.3.${i + 1}:9100`, paper_width_mm: p.paper_width_mm, archived: p.archived ?? false } })),
      ...routes.map(([scope, printer_id]) => ({ ...env, event_type: 'BillRouteSet', payload: { scope, ref_id: '', printer_id } })),
    ]),
  );
}

type Draft = Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id' | 'schema_version'>;
const on = (e: PosEvent, stream_id: string, payload: Record<string, unknown>): Draft => ({ stream_type: e.stream_type, stream_id, event_type: e.event_type, payload: { ...e.payload, ...payload } });
const put = (drafts: Draft[], actor: string = STAFF.cashier): PosEvent[] => appendRaw(hub, drafts, { actor });

let invoiceNo = 0;
/** `n` shifts, each with a cash sale of Rs 1,000 taken by the Cashier, skipped and closed (nothing blocks the close). */
function day(n: number, tag: string): void {
  for (let i = 1; i <= n; i += 1) {
    const shift_id = `SH_${tag}_${i}`;
    const bill_id = `B_${tag}_${i}`;
    const payment_id = `P_${tag}_${i}`;
    put([on(aShiftOpened(), shift_id, { shift_id, staff_id: STAFF.cashier, drawer_device_id: null, float_minor: 500_000, business_date: today().business_date })]);
    put([on(aBillOpened(), bill_id, { bill_id, seating_id: `SEAT_${bill_id}` })]);
    put([
      on(aPaymentAdded(), bill_id, { payment_id, bill_id, split_no: 1, mode_id: 'cash', payment_class: 'cash', direction: 'in', amount_minor: 100_000, tendered_minor: null, change_minor: null, taken_by_staff_id: STAFF.cashier, shift_id }),
    ]);
    invoiceNo += 1;
    const line = (anInvoiceIssued().payload['lines'] as Array<Record<string, unknown>>)[0];
    put([
      on(anInvoiceIssued(), bill_id, {
        invoice_id: `INV_${tag}_${i}`,
        number: invoiceNo,
        invoice_ref: `AC1-S${String(invoiceNo).padStart(6, '0')}`,
        bill_id,
        split_no: 1,
        business_date: today().business_date,
        issued_at: hub.clock.branchNow(),
        lines: [{ ...line, base_minor: 100_000, unit_price_minor: 100_000, taxes: [] }],
        service_charge: null,
        subtotal_minor: 100_000,
        discount_minor: 0,
        service_charge_minor: 0,
        taxes: [],
        rounding_minor: 0,
        total_minor: 100_000,
        payment_ids: [payment_id],
      }),
    ]);
    put([on(aShiftCountSkipped(), shift_id, { shift_id }), on(aShiftClosed(), shift_id, { shift_id, closed_by: STAFF.manager })], STAFF.manager);
  }
}

async function closeDay(manager: Who): Promise<void> {
  const r = await post(hub, manager, 'close-business-day', 'CloseBusinessDay', {});
  expect(r.status, JSON.stringify(r.error)).toBe(200);
}

/** The next day (or the same date again); a fresh Manager session (a day's gap ends the idle one). */
function nextDay(o: { sameDate?: boolean } = {}): Who {
  hub.clock.advance(o.sameDate === true ? 60_000 : DAY_MS);
  openVoidsDay(hub);
  noGap();
  return signIn(hub, STAFF.manager);
}

const print = (who: Who, payload: Record<string, unknown>, commandId?: string): Promise<Reply> => post(hub, who, 'print-report', 'PrintReport', payload, commandId);

const db = () => hub.deps.db;
const jobDoc = (job_id: string): Doc => (JSON.parse(db().prepare('SELECT payload FROM print_jobs WHERE job_id = ?').pluck().get(job_id) as string) as { doc: Doc }).doc;
const jobText = (job_id: string): string => {
  const doc = jobDoc(job_id);
  return renderText(doc, doc.width_cols ?? 48);
};
const jobRow = (job_id: string) => db().prepare('SELECT printer_id, payload FROM print_jobs WHERE job_id = ?').get(job_id) as { printer_id: string; payload: string };
const billJob = (job_id: string) => db().prepare('SELECT job_id, bill_id, doc_kind, ref_id FROM bill_print_jobs WHERE job_id = ?').get(job_id);
const counts = () => ({
  print_jobs: db().prepare(`SELECT COUNT(*) FROM print_jobs WHERE kind = 'document'`).pluck().get() as number,
  bill_print_jobs: db().prepare('SELECT COUNT(*) FROM bill_print_jobs').pluck().get() as number,
  events: db().prepare('SELECT COUNT(*) FROM events').pluck().get() as number,
});
const zEventIds = () => db().prepare(`SELECT event_id FROM events WHERE event_type = 'ZReportIssued' ORDER BY seq`).pluck().all() as string[];

// ================================================================================================= X

describe('[05 §6.22, R-87] PrintReport x_report — the open day\'s X', () => {
  it('[05 §6.22, §3.16] prints the open day\'s X at the report route (not the default); no event; a report job in bill_print_jobs with the date; names rendered; 13 statements at 1 and at 40 shifts', async () => {
    const manager = await start();
    day(1, 'x1');
    const one = await print(manager, { doc: 'x_report' });
    expect(one.status, JSON.stringify(one.error)).toBe(200);
    expect(one.events).toEqual([]);
    expect(one.result).toEqual({ printed: true, job_id: expect.any(String), printer_name: 'Office' });
    const j1 = one.result!['job_id'] as string;
    expect(jobRow(j1).printer_id).toBe('PR_REP');
    expect(JSON.parse(jobRow(j1).payload)).toMatchObject({ kind_label: 'X report' });
    expect(billJob(j1)).toEqual({ job_id: j1, bill_id: null, doc_kind: 'report', ref_id: today().business_date });
    const t1 = jobText(j1);
    expect(t1).toContain('X REPORT (DAY NOT CLOSED)');
    expect(t1).toContain('Cashier'); // the taker's name from staff_names, at render (H16-5)
    expect(t1).toContain('1,000.00');
    // R-87: loadReportInput (7) + names (1) + billPrinterFor (1) + printer row (1) + printDocument (2) + bill_print_jobs (1)
    expect(handled.count).toBe(13);

    day(40, 'x40');
    const forty = await print(manager, { doc: 'x_report' });
    expect(forty.status, JSON.stringify(forty.error)).toBe(200);
    expect(jobText(forty.result!['job_id'] as string)).toContain('41,000.00'); // 41 sales of Rs 1,000
    expect(handled.count).toBe(13);
  });

  it('[05 §6.22, R-87] the payload printer_id wins over the route: 12 statements at 1 and at 40 shifts; the 58 mm width', async () => {
    const manager = await start();
    day(1, 'p1');
    const one = await print(manager, { doc: 'x_report', printer_id: 'PR_BAR' });
    expect(one.status, JSON.stringify(one.error)).toBe(200);
    expect(one.result).toEqual({ printed: true, job_id: expect.any(String), printer_name: 'Bar' });
    const job = one.result!['job_id'] as string;
    expect(jobRow(job).printer_id).toBe('PR_BAR');
    expect(jobDoc(job).width_cols).toBe(32);
    expect(handled.count).toBe(12);
    day(40, 'p40');
    expect((await print(manager, { doc: 'x_report', printer_id: 'PR_BAR' })).status).toBe(200);
    expect(handled.count).toBe(12);
  });

  it('[05 §3.16] no report route → the default printer', async () => {
    const manager = await start({ routes: [['default', 'PR_DEF']] });
    const r = await print(manager, { doc: 'x_report' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(jobRow(r.result!['job_id'] as string).printer_id).toBe('PR_DEF');
  });

  it('[05 §3.16, R8, R-87 (5)] no printer routed → printed: false, no job, logged with ids only; the command succeeds', async () => {
    const manager = await start({ routes: [] });
    day(1, 'n1');
    const was = counts();
    const r = await print(manager, { doc: 'x_report' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toEqual({ printed: false, job_id: null, printer_name: null });
    expect(counts()).toEqual(was);
    const line = hub.logs().split('\n').find((l) => l.includes('report print skipped'));
    expect(line).toBeDefined();
    expect(line).toContain('PrintReport');
    expect(handled.count).toBe(1); // the route only: nothing is built for a print that cannot go out
  });

  it('[05 §6.22, R-87 (3), (4)] refusals: an X with a ref_id → 400; no open day → 409 BUSINESS_DAY_NOT_OPEN; an unknown or archived printer → 404 PRINTER_NOT_FOUND; nothing written', async () => {
    const manager = await start();
    const was = counts();
    const withRef = await print(manager, { doc: 'x_report', ref_id: today().business_date });
    expect(withRef.status).toBe(400);
    expect(withRef.error?.code).toBe('VALIDATION_FAILED');
    const unknown = await print(manager, { doc: 'x_report', printer_id: 'PR_NONE' });
    expect(unknown.status).toBe(404);
    expect(unknown.error).toEqual({ code: 'PRINTER_NOT_FOUND', details: { printer_id: 'PR_NONE' } });
    const archived = await print(manager, { doc: 'x_report', printer_id: 'PR_OLD' });
    expect(archived.error).toEqual({ code: 'PRINTER_NOT_FOUND', details: { printer_id: 'PR_OLD' } });
    expect(handled.count).toBe(1);
    const bad = await print(manager, { doc: 'receipt' });
    expect(bad.status).toBe(400);
    const extra = await print(manager, { doc: 'x_report', more: 1 });
    expect(extra.status).toBe(400);
    expect(counts()).toEqual(was);

    await closeDay(manager);
    const closedWas = counts();
    const closed = await print(manager, { doc: 'x_report' });
    expect(closed.status).toBe(409);
    expect(closed.error?.code).toBe('BUSINESS_DAY_NOT_OPEN');
    expect(handled.count).toBe(0);
    expect(counts()).toEqual(closedWas);
  });
});

// ================================================================================================= Z

describe('[05 §6.22, R-85 (1), R-87] PrintReport z_report — the stored Z', () => {
  it('[05 §6.22, R-87 (1), (6)] ref_id = the business date prints that date\'s stored Z, a fresh job id (never the fold\'s <event_id>:z); 7 statements at 1 and at 40 shifts', async () => {
    let manager = await start();
    day(1, 'z1');
    const day1 = today().business_date;
    await closeDay(manager);
    manager = nextDay();
    day(40, 'z40');
    const day2 = today().business_date;
    await closeDay(manager);
    const [z1, z2] = zEventIds();

    const one = await print(manager, { doc: 'z_report', ref_id: day1 });
    expect(one.status, JSON.stringify(one.error)).toBe(200);
    expect(one.events).toEqual([]);
    expect(one.result).toEqual({ printed: true, job_id: expect.any(String), printer_name: 'Office' });
    const j1 = one.result!['job_id'] as string;
    expect(j1).not.toBe(`${z1}:z`);
    expect(billJob(`${z1}:z`)).toBeDefined(); // the fold's own job of the close stays
    expect(billJob(j1)).toEqual({ job_id: j1, bill_id: null, doc_kind: 'report', ref_id: day1 });
    expect(JSON.parse(jobRow(j1).payload)).toMatchObject({ kind_label: 'Z report' });
    const t1 = jobText(j1);
    expect(t1).toContain('Z REPORT #1');
    expect(t1).toContain('Cashier');
    // the stored Z (1) + names (1) + billPrinterFor (1) + printer row (1) + printDocument (2) + bill_print_jobs (1)
    expect(handled.count).toBe(7);

    const forty = await print(manager, { doc: 'z_report', ref_id: day2 });
    expect(forty.status, JSON.stringify(forty.error)).toBe(200);
    const j2 = forty.result!['job_id'] as string;
    expect(j2).not.toBe(`${z2}:z`);
    expect(jobText(j2)).toContain('Z REPORT #2');
    expect(jobText(j2)).toContain('40,000.00');
    expect(handled.count).toBe(7);

    // the payload printer: 6
    const bar = await print(manager, { doc: 'z_report', ref_id: day2, printer_id: 'PR_BAR' });
    expect(bar.result).toMatchObject({ printed: true, printer_name: 'Bar' });
    expect(handled.count).toBe(6);
  });

  it('[05 R-85 (1), #63d] a date closed twice prints the latest z_no of that date; no ref_id prints the latest Z (R-87 (2))', async () => {
    let manager = await start();
    day(1, 'a');
    const day1 = today().business_date;
    await closeDay(manager);
    manager = nextDay({ sameDate: true });
    expect(today().business_date).toBe(day1);
    day(1, 'b');
    await closeDay(manager);
    manager = nextDay();
    await closeDay(manager);
    expect(db().prepare('SELECT z_no, business_date FROM z_reports ORDER BY z_no').all()).toEqual([
      { z_no: 1, business_date: day1 },
      { z_no: 2, business_date: day1 },
      { z_no: 3, business_date: expect.not.stringMatching(day1) },
    ]);

    const byDate = await print(manager, { doc: 'z_report', ref_id: day1 });
    expect(byDate.status, JSON.stringify(byDate.error)).toBe(200);
    const z2Job = byDate.result!['job_id'] as string;
    expect(jobText(z2Job)).toContain('Z REPORT #2');
    // R-85 (1): Z #2 is session b's only (one Rs 1,000 sale), and the job prints exactly the stored Z #2 — a rebuild
    // over the whole date (two sales, Rs 2,000) at the same statement cost fails here
    const stored = db().prepare('SELECT issued_at, report_json FROM z_reports WHERE z_no = 2').get() as { issued_at: number; report_json: string };
    const z2 = JSON.parse(stored.report_json) as ReportDocInput;
    expect(z2.sales).toMatchObject({ invoice_count: 1, total_minor: 100_000 });
    expect(jobDoc(z2Job)).toEqual(
      buildReportDoc(z2, staffNamesOf(db(), reportStaffIds(z2)), { width_cols: 48, currency_exponent: currencyExponent(z2.currency_code), utc_offset_ms: hubTime({ branchNow: () => stored.issued_at }).utc_offset_ms }),
    );
    expect(jobText(z2Job)).not.toContain('2,000.00');
    const latest = await print(manager, { doc: 'z_report' });
    expect(latest.status, JSON.stringify(latest.error)).toBe(200);
    const job = latest.result!['job_id'] as string;
    expect(jobText(job)).toContain('Z REPORT #3');
    expect((billJob(job) as { ref_id: string }).ref_id).not.toBe(day1);
    expect(handled.count).toBe(7);
  });

  it('[05 §6.22, §9, R-87 (2)] errors: a date with no Z → 404 Z_REPORT_NOT_FOUND { business_date }; no Z at all → { business_date: null }; an unknown printer → 404; nothing written', async () => {
    const manager = await start();
    const was = counts();
    const none = await print(manager, { doc: 'z_report' });
    expect(none.status).toBe(404);
    expect(none.error).toEqual({ code: 'Z_REPORT_NOT_FOUND', details: { business_date: null } });
    expect(handled.count).toBe(1);
    const missing = await print(manager, { doc: 'z_report', ref_id: '2020-01-01' });
    expect(missing.error).toEqual({ code: 'Z_REPORT_NOT_FOUND', details: { business_date: '2020-01-01' } });
    expect(counts()).toEqual(was);
    const day1 = today().business_date;
    await closeDay(manager);
    const closedWas = counts();
    const printer = await print(manager, { doc: 'z_report', ref_id: day1, printer_id: 'PR_NONE' });
    expect(printer.status).toBe(404);
    expect(printer.error).toEqual({ code: 'PRINTER_NOT_FOUND', details: { printer_id: 'PR_NONE' } });
    expect(counts()).toEqual(closedWas);
  });

  it('[05 §6.22] a Z prints with no open day (the stored report needs none)', async () => {
    const manager = await start();
    const day1 = today().business_date;
    await closeDay(manager);
    expect(today().closed_at).not.toBeNull();
    const r = await print(manager, { doc: 'z_report', ref_id: day1 });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toMatchObject({ printed: true });
  });
});

// ================================================================================================= grants, replay

describe('[05 §6.22, H6-7] PrintReport — view-reports and command_id replay', () => {
  it('[05 H6-7, §10 grant states] the Cashier (no view-reports) → 403 before any read; the Owner and the Manager print', async () => {
    const manager = await start();
    const was = counts();
    const cashier = signIn(hub, STAFF.cashier);
    const refused = await print(cashier, { doc: 'x_report' });
    expect(refused.status).toBe(403);
    expect(refused.error?.code).toBe('PERMISSION_DENIED');
    const refusedZ = await print(cashier, { doc: 'z_report', ref_id: '2020-01-01' });
    expect(refusedZ.status).toBe(403); // the grant first: not the 404
    expect({ ...counts(), events: was.events }).toEqual(was); // no print (a refusal may write its own audit event)
    expect((await print(signIn(hub, 'S_OWNER'), { doc: 'x_report' })).status).toBe(200);
    expect((await print(manager, { doc: 'x_report' })).status).toBe(200);
  });

  it('[05 D32] a retransmit with the same command_id returns the identical response and queues nothing more (X and Z)', async () => {
    const manager = await start();
    const day1 = today().business_date;
    const first = await print(manager, { doc: 'x_report' }, 'x-once');
    expect(first.status, JSON.stringify(first.error)).toBe(200);
    const after = counts();
    const again = await print(manager, { doc: 'x_report' }, 'x-once');
    expect(again.status).toBe(200);
    expect(again.result).toEqual(first.result);
    expect(counts()).toEqual(after);

    await closeDay(manager);
    const z = await print(manager, { doc: 'z_report', ref_id: day1 }, 'z-once');
    expect(z.status, JSON.stringify(z.error)).toBe(200);
    const zAfter = counts();
    const zAgain = await print(manager, { doc: 'z_report', ref_id: day1 }, 'z-once');
    expect(zAgain.result).toEqual(z.result);
    expect(counts()).toEqual(zAfter);
  });
});
