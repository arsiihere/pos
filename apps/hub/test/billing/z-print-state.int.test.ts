// 05 v1.0.32 §6.26 Z list `print` (owner ruling R-93, gap G-96; E2E re-run R-3), test #67b. Each Z row carries
// `print: { job_id, state, printer_name } | null` — the Z's latest print job from `bill_print_jobs` (`doc_kind 'report'`,
// `ref_id` = the date, at or after the Z's `issued_at`, before a later Z of the same date, a 'Z report' job) with its 03c
// state; null = no Z job was written (no `report` / `default` route at the close and no print since). The days close
// with the real CloseBusinessDay (task 25), so the job is the live fold's (§6.25); reprints go through PrintReport
// (§6.22). The Z list stays 1 statement with 1 and with N Zs. Privacy: ids, state and printer name only.
import type { EventDraft, PosEvent } from '@pos/events';
import { aShiftClosed, aShiftCountSkipped, aShiftOpened } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { documentJobsStatus } from '../../src/print/document-jobs';
import { queryRegistry, type QueryDef } from '../../src/queries/registry';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import type { TestHub } from '../helpers/test-hub';
import { append as appendRaw, openVoidsDay } from '../voids/fixtures';
import { post, signIn, STAFF, startBilling, type Reply, type Who } from './fixtures';

let hub: TestHub;
const DAY_MS = 86_400_000;
const handled: { count?: number } = {};

afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
  delete handled.count;
});

type ZPrint = { job_id: string; state: string; printer_name: string | null } | null;
type ZRow = { business_date: string; z_no: number; print: ZPrint };

async function start(routes: Array<[string, string]>): Promise<Who> {
  hub = await startBilling();
  noGap();
  printers([{ printer_id: 'PR_DEF', name: 'Counter' }, { printer_id: 'PR_REP', name: 'Office' }], routes);
  const def = queryRegistry(hub.app).byResource('z-reports') as QueryDef;
  const counter = statementCounter(hub.deps.readDb); // queries read on the read connection
  const original = def.handle;
  def.handle = (ctx, q) => {
    counter.reset();
    try {
      return original.call(def, ctx, q);
    } finally {
      handled.count = counter.count;
    }
  };
  return signIn(hub, STAFF.manager);
}

function noGap(): void {
  const config = branchConfig()!;
  swapBranchConfig({ config: { ...config, day_min_gap_hours: 0 }, snapshotHash: 'h'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 4, appliedAt: 0 });
}

const branch = () => hub.deps.config.provisioned!.branch_id;
const today = () => hub.deps.state.get().business_day!;
const db = () => hub.deps.db;

function printers(list: Array<{ printer_id: string; name: string }>, routes: Array<[string, string]>): void {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  const env = { stream_type: 'hub' as const, stream_id: branch(), schema_version: 1, occurred_at: now, actor_id: STAFF.manager, device_id: 'D_FIXTURE' };
  hub.deps.writer.run((tx) =>
    tx.append([
      ...list.map((p, i) => ({ ...env, event_type: 'PrinterSaved', payload: { printer_id: p.printer_id, name: p.name, connection: 'lan', address: `192.168.4.${i + 1}:9100`, paper_width_mm: 80, archived: false } })),
      ...routes.map(([scope, printer_id]) => ({ ...env, event_type: 'BillRouteSet', payload: { scope, ref_id: '', printer_id } })),
    ]),
  );
}

/** A bill route added later (the E2E fix: a `default` route appended after the close). */
function addRoute(scope: string, printer_id: string): void {
  printers([], [[scope, printer_id]]);
}

type Draft = Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id' | 'schema_version'>;
const on = (e: PosEvent, stream_id: string, payload: Record<string, unknown>): Draft => ({ stream_type: e.stream_type, stream_id, event_type: e.event_type, payload: { ...e.payload, ...payload } });

/** One skipped, closed shift (nothing blocks the close). */
function shift(tag: string): void {
  const shift_id = `SH_${tag}`;
  appendRaw(hub, [on(aShiftOpened(), shift_id, { shift_id, staff_id: STAFF.cashier, drawer_device_id: null, float_minor: 500_000, business_date: today().business_date })], { actor: STAFF.cashier });
  appendRaw(hub, [on(aShiftCountSkipped(), shift_id, { shift_id }), on(aShiftClosed(), shift_id, { shift_id, closed_by: STAFF.manager })], { actor: STAFF.manager });
}

async function closeDay(manager: Who): Promise<void> {
  hub.clock.advance(1_000);
  const r = await post(hub, manager, 'close-business-day', 'CloseBusinessDay', {});
  expect(r.status, JSON.stringify(r.error)).toBe(200);
}

/** The next day (or the same date again); a fresh Manager session (a day's gap ends the idle one). The test hub's
 *  device tokens repeat after 8 pairings, so a test signs in at most 7 times. */
function nextDay(o: { sameDate?: boolean } = {}): Who {
  hub.clock.advance(o.sameDate === true ? 60_000 : DAY_MS);
  openVoidsDay(hub);
  noGap();
  return signIn(hub, STAFF.manager);
}

const print = (who: Who, payload: Record<string, unknown>): Promise<Reply> => {
  hub.clock.advance(1_000);
  return post(hub, who, 'print-report', 'PrintReport', payload);
};

async function zList(who: Who, query = ''): Promise<ZRow[]> {
  const res = await hub.app.inject({ method: 'GET', url: `/queries/z-reports${query}`, headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: { reports: ZRow[] } }).data.reports;
}

const zEventIds = () => db().prepare(`SELECT event_id FROM events WHERE event_type = 'ZReportIssued' ORDER BY seq`).pluck().all() as string[];
const ack = (job_id: string) => db().prepare('UPDATE print_jobs SET sent_at = ?, acked_at = ? WHERE job_id = ?').run(hub.clock.branchNow(), hub.clock.branchNow(), job_id);

describe('[05 v1.0.32 §6.26, R-93, #67b] the Z list shows the Z print state', () => {
  it('with a report route: the fold job at the report route, waiting; after an ack, printed', async () => {
    const manager = await start([['default', 'PR_DEF'], ['report', 'PR_REP']]);
    shift('a');
    const date = today().business_date;
    await closeDay(manager);
    const [zId] = zEventIds();
    // the read the day-close screen makes after the close: the Z of the closed date, newest z_no first
    const [z] = await zList(manager, `?business_date=${date}`);
    expect(z!.print).toEqual({ job_id: `${zId}:z`, state: 'waiting', printer_name: 'Office' });
    ack(`${zId}:z`);
    expect((await zList(manager, `?business_date=${date}`))[0]!.print).toEqual({ job_id: `${zId}:z`, state: 'printed', printer_name: 'Office' });
    expect(Object.keys(z!.print!).sort()).toEqual(['job_id', 'printer_name', 'state']); // ids, state and printer name only
  });

  it('with no report or default route: print null (not printed); a print from the Z screen later shows its job', async () => {
    const manager = await start([]);
    shift('a');
    const date = today().business_date;
    await closeDay(manager);
    expect(db().prepare(`SELECT COUNT(*) FROM bill_print_jobs WHERE doc_kind = 'report'`).pluck().get()).toBe(0);
    expect((await zList(manager))[0]!.print).toBeNull();
    // E2E R-3's fix path: a default route, then Print on the Z screen
    addRoute('default', 'PR_DEF');
    const r = await print(manager, { doc: 'z_report', ref_id: date });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const job_id = r.result!['job_id'] as string;
    expect((await zList(manager))[0]!.print).toEqual({ job_id, state: 'waiting', printer_name: 'Counter' });
  });

  it('the state is 03c\'s document-job state (printing, failed, cancelled) and the latest Z job wins over an earlier one', async () => {
    const manager = await start([['report', 'PR_REP']]);
    shift('a');
    const date = today().business_date;
    await closeDay(manager);
    const fold = `${zEventIds()[0]}:z`;
    const state = async () => (await zList(manager))[0]!.print;
    const same = async (job_id: string) => expect((await state())!.state).toBe(documentJobsStatus(db(), [job_id])[0]!.state);
    db().prepare('UPDATE print_jobs SET sent_at = ? WHERE job_id = ?').run(hub.clock.branchNow(), fold);
    expect((await state())!.state).toBe('printing');
    await same(fold);
    db().prepare(`UPDATE print_jobs SET sent_at = NULL, attempts = 1, last_error = 'offline' WHERE job_id = ?`).run(fold);
    expect(await state()).toEqual({ job_id: fold, state: 'failed', printer_name: 'Office' }); // never last_error
    await same(fold);
    db().prepare('UPDATE print_jobs SET cancelled_at = ? WHERE job_id = ?').run(hub.clock.branchNow(), fold);
    expect((await state())!.state).toBe('cancelled');
    await same(fold);
    // a reprint from the Z screen is the latest job: its state is shown
    const r = await print(manager, { doc: 'z_report', ref_id: date });
    expect(await state()).toEqual({ job_id: r.result!['job_id'], state: 'waiting', printer_name: 'Office' });
  });

  it('a date closed twice: an X printed in the second session is not the first Z\'s; each Z shows its own job', async () => {
    const manager = await start([['report', 'PR_REP']]);
    shift('a');
    const date = today().business_date;
    await closeDay(manager);
    const again = nextDay({ sameDate: true });
    expect(today().business_date).toBe(date);
    shift('b');
    const x = await print(again, { doc: 'x_report' });
    expect(x.status, JSON.stringify(x.error)).toBe(200);
    const [z1] = await zList(again);
    expect(z1!.print!.job_id).toBe(`${zEventIds()[0]}:z`); // not the X job (also `report`, ref_id = the date)
    await closeDay(again);
    const [second, first] = await zList(again, `?business_date=${date}`);
    expect([second!.z_no, first!.z_no]).toEqual([2, 1]);
    expect(second!.print!.job_id).toBe(`${zEventIds()[1]}:z`);
    expect(first!.print!.job_id).toBe(`${zEventIds()[0]}:z`);
    // a reprint of the date prints its latest Z (R-85 (1)): only the second Z's print changes
    const r = await print(again, { doc: 'z_report', ref_id: date });
    const [s2, f2] = await zList(again, `?business_date=${date}`);
    expect(s2!.print!.job_id).toBe(r.result!['job_id']);
    expect(f2!.print!.job_id).toBe(`${zEventIds()[0]}:z`);
  });

  it('a done job swept by 03c retention (7 days) shows state expired, never null', async () => {
    const manager = await start([['report', 'PR_REP']]);
    shift('a');
    await closeDay(manager);
    const fold = `${zEventIds()[0]}:z`;
    ack(fold);
    db().prepare('DELETE FROM print_jobs WHERE job_id = ?').run(fold); // what retention.ts deletes for a done job
    expect((await zList(manager))[0]!.print).toEqual({ job_id: fold, state: 'expired', printer_name: null });
  });

  it('the Z list stays 1 statement with 1 Z and with 6 Zs, each with its print', async () => {
    let manager = await start([['report', 'PR_REP']]);
    shift('d1');
    await closeDay(manager);
    expect((await zList(manager))[0]!.print!.state).toBe('waiting');
    expect(handled.count).toBe(1);
    for (let i = 2; i <= 6; i += 1) {
      manager = nextDay();
      shift(`d${i}`);
      if (i % 2 === 0) for (let k = 0; k < 2; k += 1) expect((await print(manager, { doc: 'x_report' })).status).toBe(200);
      await closeDay(manager);
      if (i % 3 === 0) expect((await print(manager, { doc: 'z_report' })).status).toBe(200);
    }
    const all = await zList(manager, '?limit=50');
    expect(all).toHaveLength(6);
    expect(all.every((z) => z.print !== null && z.print.printer_name === 'Office')).toBe(true);
    expect(handled.count).toBe(1);
  });
});
