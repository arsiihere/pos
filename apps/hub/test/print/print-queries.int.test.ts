import type { BranchConfig } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PRINT_QUEUE_JOBS_LIMIT } from '../../src/queries/print-queue';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FX, appendOrder, append as kdsAppend, fireLines, openDay, pairDevice, pairKds } from '../kds/fixtures';

// 03c §6.6, §6.7, §3.2, §3.10 (task c20): GET /admin/queries/print-config (warnings per kind; 4 statements) and
// GET /admin/queries/print-queue (2 statements), through the real admin query route. fixtureMenu stations: S1 Tandoor-
// like (FX.station), S2 "Counter" (FX.zoneStation).

let hub: TestHub;
let device: { deviceId: string; token: string };
let admin: string;
let noDevices: string;

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  const directory = await aDirectory();
  directory.staff.push({ ...directory.staff.find((s) => s.staff_id === 'S_MGR')!, staff_id: 'S_NODEV', display_name: 'No devices', denied_permissions: ['manage-devices'] });
  await seedDirectory(hub, directory);
  openDay(hub);
  device = pairDevice(hub, { type: 'tablet' });
  admin = openSession(hub, { kind: 'admin', staffId: 'S_MGR', deviceId: device.deviceId }).token;
  noDevices = openSession(hub, { kind: 'admin', staffId: 'S_NODEV', deviceId: device.deviceId }).token;
});
afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

const branch = (): string => hub.deps.config.provisioned!.branch_id;
function printer(printer_id: string, archived = false): void {
  kdsAppend(hub, [{ stream_type: 'hub', stream_id: branch(), event_type: 'PrinterSaved', payload: { printer_id, name: printer_id, connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived } }], {
    actor: null,
  });
}
function output(station_id: string, mode: 'screen' | 'both' | 'printer', printer_id: string | null): void {
  kdsAppend(hub, [{ stream_type: 'hub', stream_id: branch(), event_type: 'StationOutputSet', payload: { station_id, mode, printer_id, show_taker: false, show_order_id: true } }], {
    actor: null,
  });
}
async function get(resource: string, session = admin): Promise<{ status: number; data?: Record<string, unknown>; error?: { code: string } }> {
  const r = await hub.app.inject({ method: 'GET', url: `/admin/queries/${resource}`, headers: { authorization: `Bearer ${device.token}`, 'x-admin-session': session } });
  return { status: r.statusCode, ...(r.json() as object) };
}
function rename(item_id: string, name: string, station_name?: string): void {
  const config = branchConfig()!;
  const next: BranchConfig = {
    ...config,
    items: config.items.map((i) => (i.item_id === item_id ? { ...i, name } : i)),
    stations: config.stations.map((s) => (s.station_id === FX.station && station_name !== undefined ? { ...s, name: station_name } : s)),
  };
  swapBranchConfig({ config: next, snapshotHash: 'e'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 4, appliedAt: 0 });
}

describe('[03c §6.6] GET /admin/queries/print-config (c20)', () => {
  it('[03c §6.6, §3.2] printers, station outputs (no row = screen) and every warning kind; 4 statements', async () => {
    printer('PR1');
    printer('PR_OLD', true);
    pairKds(hub, { stationId: FX.station }); // S1 has a screen
    output(FX.station, 'printer', 'PR1'); // → screen_unused
    output(FX.zoneStation, 'screen', 'PR1'); // fallback printer, no screen → no_screen
    rename(FX.naan, 'Naan ★', 'Tandoor — ✓'); // ★ and ✓ are not in PC437 (— maps to -)
    hub.deps.db.prepare(`INSERT INTO print_fold_skips (event_id, station_id, order_ids, reason, at) VALUES ('E1', ?, '[]', 'line_missing', 1)`).run(FX.zoneStation);
    hub.deps.db.prepare(`INSERT INTO print_jobs (job_id, kind, station_id, payload, created_at, acked_at, suspect_at) VALUES ('J1', 'kitchen', ?, '{}', 1, 1, 2)`).run(FX.station);
    hub.deps.db.prepare(`INSERT INTO print_jobs (job_id, kind, printer_id, payload, created_at, acked_at, suspect_at, suspect_resolved_at) VALUES ('J2', 'document', 'PR1', '{}', 1, 1, 2, 3)`).run();
    const counter = statementCounter(hub.deps.readDb);
    const r = await get('print-config');
    expect(counter.count).toBe(4);
    expect(r.status).toBe(200);
    const data = r.data as { printers: Array<Record<string, unknown>>; station_outputs: Array<Record<string, unknown>>; warnings: unknown[] };
    expect(data.printers.map((p) => [p.printer_id, p.archived_at === null])).toEqual([
      ['PR1', true],
      ['PR_OLD', false],
    ]);
    expect(data.printers[0]).toMatchObject({ name: 'PR1', connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, supports_status: null, last_status: null });
    expect(data.station_outputs).toEqual([
      { station_id: FX.station, name: 'Tandoor — ✓', mode: 'printer', printer_id: 'PR1', show_taker: false, show_order_id: true, screen_paired: true, archived: false },
      { station_id: FX.zoneStation, name: 'Counter', mode: 'screen', printer_id: 'PR1', show_taker: false, show_order_id: true, screen_paired: false, archived: false },
    ]);
    expect(data.warnings).toEqual([
      { station_id: FX.station, kind: 'screen_unused' },
      { station_id: FX.station, kind: 'lossy_name' },
      { station_id: FX.zoneStation, kind: 'no_screen' },
      { station_id: FX.station, item_id: FX.naan, kind: 'lossy_name' },
      { station_id: FX.zoneStation, kind: 'fold_skipped' },
      { station_id: FX.station, kind: 'suspect_waiting' },
    ]);
  });

  it('[03c §6.6] no outputs: every station `screen`, no printer, no warnings; a lossy name at a station without a printer is not a warning', async () => {
    rename(FX.naan, 'Naan ★');
    const r = await get('print-config');
    const data = r.data as { station_outputs: Array<Record<string, unknown>>; warnings: unknown[] };
    expect(data.station_outputs.map((s) => [s.station_id, s.mode, s.printer_id])).toEqual([
      [FX.station, 'screen', null],
      [FX.zoneStation, 'screen', null],
    ]);
    expect(data.warnings).toEqual([]);
  });

  it('[03c §3.2] lossy_name covers every printable name: a zone-routed item (S1 → S2 printer), modifier options, deals', async () => {
    printer('PR1');
    output(FX.zoneStation, 'both', 'PR1'); // only S2 prints; Naan's home S1 has no printer, Z1 routes it to S2
    const config = branchConfig()!;
    swapBranchConfig({
      config: {
        ...config,
        items: config.items.map((i) => (i.item_id === FX.naan ? { ...i, name: 'Naan ★' } : i)),
        modifier_groups: config.modifier_groups.map((g) => ({ ...g, options: g.options.map((o) => (o.option_id === FX.option ? { ...o, name: 'رائتہ' } : o)) })),
        deals: config.deals.map((d) => (d.deal_id === FX.deal ? { ...d, name: 'Combo ✓' } : d)),
      },
      snapshotHash: 'f'.repeat(64),
      configVersion: config.config_version,
      snapshotSchemaVersion: 4,
      appliedAt: 0,
    });
    const lossyOf = async () => ((await get('print-config')).data as { warnings: Array<{ kind: string }> }).warnings.filter((w) => w.kind === 'lossy_name');
    // Naan prints at S2 through the zone route; the deal has a Naan part; Karahi (the option's item) is S1-only
    expect(await lossyOf()).toEqual([
      { station_id: FX.station, item_id: FX.naan, kind: 'lossy_name' },
      { station_id: null, item_id: FX.deal, kind: 'lossy_name' },
    ]);
    output(FX.station, 'both', 'PR1'); // now Karahi prints too: its option's Urdu name cannot
    expect(await lossyOf()).toEqual([
      { station_id: FX.station, item_id: FX.naan, kind: 'lossy_name' },
      { station_id: null, item_id: FX.option, kind: 'lossy_name' },
      { station_id: null, item_id: FX.deal, kind: 'lossy_name' },
    ]);
  });

  it('[03c §3.2] station_outputs also lists the output rows of archived or unknown stations (archived: true; why archiving a printer is CONFIG_IN_USE)', async () => {
    printer('PR1');
    const config = branchConfig()!;
    swapBranchConfig({
      config: { ...config, stations: [...config.stations, { ...config.stations[0]!, station_id: 'S_OLD', name: 'Old', is_archived: true }] },
      snapshotHash: 'a'.repeat(64),
      configVersion: config.config_version,
      snapshotSchemaVersion: 4,
      appliedAt: 0,
    });
    output('S_OLD', 'printer', 'PR1');
    output('S_GONE', 'both', 'PR1');
    const data = (await get('print-config')).data as { station_outputs: Array<Record<string, unknown>>; warnings: unknown[] };
    expect(data.station_outputs.filter((o) => o.archived === true)).toEqual([
      { station_id: 'S_GONE', name: null, mode: 'both', printer_id: 'PR1', show_taker: false, show_order_id: true, screen_paired: false, archived: true },
      { station_id: 'S_OLD', name: 'Old', mode: 'printer', printer_id: 'PR1', show_taker: false, show_order_id: true, screen_paired: false, archived: true },
    ]);
    expect(data.warnings).toEqual([]); // archived rows raise no station warnings
  });

  it('[03c §3.10] manage-devices required → 403', async () => {
    expect((await get('print-config', noDevices)).error?.code).toBe('PERMISSION_DENIED');
  });
});

describe('[03c §6.7] GET /admin/queries/print-queue (c20)', () => {
  it('[03c §6.7] per printer: status, waiting (station jobs follow the current printer), suspect, head_error, last_ack_at; pending jobs; 2 statements', async () => {
    printer('PR1');
    printer('PR2');
    printer('PR_GONE', true); // archived, nothing pending → not listed
    printer('PR_OLD', true); // archived, a pending document → listed
    output(FX.station, 'both', 'PR1');
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan, quantity: 1 }] });
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'B1', item_id: FX.naan, quantity: 1 }] });
    fireLines(hub, FX.station, ['A1']);
    fireLines(hub, FX.station, ['B1']);
    const db = hub.deps.db;
    const ticket = (id: string) => db.prepare('SELECT ticket_id FROM ticket_lines WHERE order_item_id = ?').pluck().get(id) as string;
    db.prepare(`UPDATE print_jobs SET attempts = 3, last_error = 'connect_failed:ECONNREFUSED' WHERE job_id = ?`).run(`${ticket('A1')}:kitchen`);
    db.prepare(`INSERT INTO print_jobs (job_id, kind, printer_id, payload, created_at) VALUES ('DOC_OLD', 'document', 'PR_OLD', '{}', ?)`).run(hub.clock.branchNow());
    db.prepare(`INSERT INTO print_jobs (job_id, kind, printer_id, payload, created_at, sent_at, sent_printer_id, acked_at, suspect_at) VALUES ('S', 'document', 'PR2', '{}', 1, 1, 'PR2', 1, 2)`).run();
    db.prepare(`INSERT INTO printer_runtime (printer_id, last_status, last_ack_at) VALUES ('PR2', 'paper_out', 1)`).run();
    const counter = statementCounter(hub.deps.readDb);
    const r = await get('print-queue');
    expect(counter.count).toBe(2);
    const data = r.data as { printers: unknown[]; jobs: Array<Record<string, unknown>> };
    expect(data.printers).toEqual([
      { printer_id: 'PR1', name: 'PR1', status: 'unknown', waiting: 2, suspect: 0, head_error: 'connect_failed:ECONNREFUSED', last_ack_at: null },
      { printer_id: 'PR2', name: 'PR2', status: 'paper_out', waiting: 0, suspect: 1, head_error: null, last_ack_at: 1 },
      { printer_id: 'PR_OLD', name: 'PR_OLD', status: 'unknown', waiting: 1, suspect: 0, head_error: null, last_ack_at: null },
    ]);
    expect(data.jobs.map((j) => [j.job_id, j.printer_id])).toEqual([
      ['DOC_OLD', 'PR_OLD'],
      [`${ticket('B1')}:kitchen`, 'PR1'],
      [`${ticket('A1')}:kitchen`, 'PR1'],
    ]);
    expect(data.jobs[2]).toMatchObject({ kind: 'kitchen', station_id: FX.station, attempts: 3, last_error: 'connect_failed:ECONNREFUSED', is_reprint: false, sent_at: null });
    // station output moved: the station's pending jobs follow the new printer
    output(FX.station, 'both', 'PR2');
    const moved = (await get('print-queue')).data as { printers: Array<{ printer_id: string; waiting: number }> };
    expect(moved.printers.map((p) => [p.printer_id, p.waiting])).toEqual([
      ['PR1', 0],
      ['PR2', 2],
      ['PR_OLD', 1],
    ]);
  });

  it('[03c §6.7] pending jobs with no printer now (the station\'s output lost its printer) are counted and flagged', async () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan, quantity: 1 }] });
    fireLines(hub, FX.station, ['A1']);
    let data = (await get('print-queue')).data as { jobs: Array<Record<string, unknown>>; no_printer: number };
    expect(data.no_printer).toBe(0);
    expect(data.jobs[0]).toMatchObject({ printer_id: 'PR1', no_printer: false });
    output(FX.station, 'screen', null);
    data = (await get('print-queue')).data as { jobs: Array<Record<string, unknown>>; no_printer: number };
    expect(data.no_printer).toBe(1);
    expect(data.jobs[0]).toMatchObject({ kind: 'kitchen', printer_id: null, no_printer: true });
    expect(((await get('print-queue')).data as { printers: Array<{ waiting: number }> }).printers[0]!.waiting).toBe(0);
  });

  it('[03c §6.7] jobs: pending only, newest 100', async () => {
    printer('PR1');
    const ins = hub.deps.db.prepare(`INSERT INTO print_jobs (job_id, kind, printer_id, payload, created_at, acked_at) VALUES (?, 'document', 'PR1', '{}', ?, ?)`);
    for (let i = 0; i < 105; i += 1) ins.run(`D${String(i).padStart(3, '0')}`, i, null);
    ins.run('ACKED', 500, 501);
    const data = (await get('print-queue')).data as { jobs: Array<{ job_id: string }> };
    expect(PRINT_QUEUE_JOBS_LIMIT).toBe(100);
    expect(data.jobs).toHaveLength(100);
    expect(data.jobs[0]!.job_id).toBe('D104');
    expect(data.jobs[99]!.job_id).toBe('D005');
  });

  it('[03c §3.10] manage-devices required → 403', async () => {
    expect((await get('print-queue', noDevices)).error?.code).toBe('PERMISSION_DENIED');
  });
});
